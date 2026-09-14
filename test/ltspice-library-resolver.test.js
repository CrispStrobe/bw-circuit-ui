/**
 * The library resolver, against a library this test AUTHORS.
 *
 * Not a single byte of Analog Devices' library appears here. That is a licence
 * requirement -- we may run their library as an oracle input and may not
 * redistribute it -- and it is also better testing: a fixture I wrote can be
 * made to contain exactly the shapes that broke, including the ones no real
 * library happens to have next to each other.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildLibraryIndex, undeclaredReferences, declaredNames, librariesForDeck, readLibraryFile }
  from '../scripts/ltspice-library-resolver.mjs';

/** A library tree shaped like LTspice's, with contents of my own. */
function authorLibrary() {
  const root = mkdtempSync(join(tmpdir(), 'lib-'));
  mkdirSync(join(root, 'sub'), { recursive: true });
  mkdirSync(join(root, 'cmp'), { recursive: true });
  mkdirSync(join(root, 'sub', 'Contrib'), { recursive: true });

  writeFileSync(join(root, 'sub', 'AC_REG.sub'),
    '* a regulator of my own invention\n.subckt AC_REG in out gnd\nR1 in out 10\nR2 out gnd 100\n.ends\n');
  writeFileSync(join(root, 'cmp', 'my.dio'),
    '.model MYDIODE D(IS=1e-14 N=1 RS=0.1)\n.model OTHERDIODE D(IS=2e-14 N=1 RS=0.2)\n');
  // A nested directory, because LTspice has one and a non-recursive walk would
  // silently miss every name in it.
  writeFileSync(join(root, 'sub', 'Contrib', 'DEEP.sub'),
    '.subckt DEEPPART a b\nR1 a b 1k\n.ends\n');
  // UTF-16LE with a BOM: LTspice writes some of its library files this way and
  // a UTF-8 read of one yields NUL-separated mojibake that matches no regex.
  writeFileSync(join(root, 'cmp', 'wide.bjt'),
    Buffer.concat([Buffer.from([0xff, 0xfe]),
      Buffer.from('.model WIDEBJT NPN(IS=1e-14 BF=100)\n', 'utf16le')]));
  // An ENCRYPTED vendor model. LTspice ships its proprietary IC macromodels
  // like this. It must contribute NO names -- claiming one would send the
  // sweep looking for an importer defect where the real answer is that neither
  // we nor ngspice can ever read the file.
  writeFileSync(join(root, 'sub', 'SECRET.sub'),
    Buffer.concat([Buffer.from('\r\n<Binary File>\r\n\r\n'), Buffer.from([0x1a, 0x98, 0xc0, 0xed, 0xab])]));
  return root;
}

describe('LTspice library resolver', () => {
  test('indexes every plain-text definition, at any depth and in either encoding', () => {
    const root = authorLibrary();
    try {
      const index = buildLibraryIndex(root);
      assert.equal(index.has('ac_reg'), true, 'a .subckt in sub/');
      assert.equal(index.has('mydiode'), true, 'a .model in cmp/');
      assert.equal(index.has('otherdiode'), true, 'the second .model in the same file');
      assert.equal(index.has('deeppart'), true, 'a .subckt in a NESTED directory');
      assert.equal(index.has('widebjt'), true, 'a .model in a UTF-16LE file with a BOM');
      assert.equal(index.has('secret'), false,
        'an encrypted vendor model defines no readable name and must contribute none');
      assert.equal(buildLibraryIndex(join(root, 'nope')).size, 0, 'a missing root is empty, not a throw');
      assert.equal(readLibraryFile(join(root, 'cmp', 'wide.bjt')).includes('WIDEBJT'), true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('reads the subcircuit name and not the pin-name comment beside it', () => {
    // THE DEFECT THIS HOLDS. An LTspice-exported X card carries a trailing
    // comment listing the symbol's pin names:
    //   XU1 IN 0 N001 IN N002 0 LTC3405A ;pnba Run)GND)SW)Vin)FB)Mode
    // Taking the last bare token WITHOUT stripping the comment reads
    // `Mode` -- or with a different separator, `in+)in-)v+)v-)out` -- as the
    // subcircuit's name. It does not fail loudly: it reports the library as
    // missing a definition no deck ever asked for. Measured: that put
    // `in+)in-)v+)v-)out` at the top of a still-missing census, 9,167 times.
    const refs = undeclaredReferences(
      '* pin names in a comment\n'
      + 'XU1 IN 0 N001 IN N002 0 AC_REG ;pnba Run)GND)SW)Vin)FB)Mode\n'
      + '.end\n');
    assert.deepEqual([...refs], ['ac_reg']);

    // `$` comments too, and only at a token start -- a `$` inside a name stays.
    assert.deepEqual([...undeclaredReferences('X1 a b MY$PART $ trailing note\n')], ['my$part']);

    // The model name's position differs per element letter, and a node is not
    // a model: D has two nodes, Q and J three, M four.
    assert.deepEqual([...undeclaredReferences('D1 a b MYDIODE\n')], ['mydiode']);
    assert.deepEqual([...undeclaredReferences('Q1 c b e MYBJT\n')], ['mybjt']);
    assert.deepEqual([...undeclaredReferences('M1 d g s b MYMOS W=1u\n')], ['mymos']);
    // A parameter assignment is never the name, wherever it sits.
    assert.deepEqual([...undeclaredReferences('X1 a b AC_REG tol=1 temp=27\n')], ['ac_reg']);
  });

  test("a deck's own declaration wins, so it is not looked up at all", () => {
    const deck = '* declares its own\nD1 a b MYDIODE\n.model MYDIODE D(IS=9e-15 N=1 RS=1)\n.end\n';
    assert.equal(declaredNames(deck).has('mydiode'), true);
    assert.deepEqual([...undeclaredReferences(deck)], [],
      'SPICE gives the deck the last word; resolving it from a library would '
      + 'silently swap the deck\'s own device for the vendor\'s');
  });

  test('splits what the library HAS from what it does not, and supplies only the former', () => {
    const root = authorLibrary();
    try {
      const index = buildLibraryIndex(root);
      const { libraries, resolved, missing } = librariesForDeck(
        '* two references, one known\nX1 a b c AC_REG\nD1 a b NOSUCHDIODE\n.end\n', index);
      assert.deepEqual(resolved, ['ac_reg']);
      assert.deepEqual(missing, ['nosuchdiode']);
      assert.equal(libraries.length, 1);
      assert.match(libraries[0], /\.subckt AC_REG/);

      // WHY THE SPLIT IS REPORTED AND NOT JUST THE TEXT. "The library had
      // nothing for this deck" and "the library had it and the import still
      // failed" are an acquisition problem and an importer problem. A census
      // that reports both as one number is how a lane spends its time on the
      // wrong half. Measured on 7,866 Si7li decks: 3,126 need an encrypted
      // vendor model and can never be judged, while 2,263 resolve completely.
      const encrypted = librariesForDeck('X1 a b SECRET\n.end\n', index);
      assert.deepEqual(encrypted.resolved, []);
      assert.deepEqual(encrypted.missing, ['secret']);
      assert.deepEqual(encrypted.libraries, []);

      // One file defining both references is supplied ONCE, not twice.
      const twice = librariesForDeck('D1 a b MYDIODE\nD2 b c OTHERDIODE\n.end\n', index);
      assert.deepEqual(twice.resolved, ['mydiode', 'otherdiode']);
      assert.equal(twice.libraries.length, 1, 'one file, one supply');

      // And a deck needing nothing gets nothing: no library is spliced into a
      // deck that is already complete.
      assert.deepEqual(librariesForDeck('R1 a b 1k\n.end\n', index),
        { libraries: [], resolved: [], missing: [] });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

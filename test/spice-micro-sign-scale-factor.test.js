/**
 * The micro sign is a scale factor, and a CP1252 library file is not UTF-8.
 *
 * Both halves of one defect, measured on the Si7li LTspice corpus: 3,010 of the
 * 4,908 `.sub`/`.lib` files in the LTspice 24.x tree are not valid UTF-8, and
 * 2,957 of those contain byte 0xB5 -- the micro sign, which is how vendor models
 * spell microamps. Decoded as UTF-8 that byte became U+FFFD, so LT1086-12's
 * `I2 3 N002 55<micro>` reached the parser as `55<FFFD>` and the deck lost a
 * current source to a named semantic loss. The value was in the file all along.
 *
 * WHY IT IS TWO FIXES AND NOT ONE. Repairing only the decoder leaves a deck that
 * is itself UTF-8 and spells the sign properly still failing, because neither
 * number parser accepted a non-ASCII suffix. Repairing only the parsers leaves
 * the CP1252 files delivering U+FFFD, which is not the micro sign either. Each
 * test below names which half it holds; deleting either fix must red.
 *
 * Not one byte of Analog Devices' library appears here -- every fixture is
 * authored, which is a licence requirement and also lets the CP1252 case be a
 * file whose bytes I chose.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSpiceValue } from '../src/model/si.js';
import { parseConstantExpression, evaluateConstantExpression } from '../src/model/spice-constant.js';
import { readLibraryFile } from '../scripts/ltspice-library-resolver.mjs';
import { importSpice } from '../src/importers/spice.js';

const MICRO_1252 = 0xb5;     // CP1252 / Latin-1 MICRO SIGN
const MICRO = 'µ';      // MICRO SIGN, what 0xB5 decodes to
const GREEK_MU = 'μ';   // GREEK SMALL LETTER MU, what editors emit

describe('the micro sign as a SPICE scale factor (parser half)', () => {
  test('both spellings parse as 1e-6, and are the same number', () => {
    assert.equal(parseSpiceValue(`55${MICRO}`), 55e-6);
    assert.equal(parseSpiceValue(`55${GREEK_MU}`), 55e-6);
    assert.equal(parseSpiceValue(`55${MICRO}`), parseSpiceValue('55u'));
    assert.equal(parseSpiceValue(`100${MICRO}F`), 100e-6, 'a unit may follow the factor');
  });

  test('the milli/mega/mil/femto semantics are UNCHANGED by the new suffix', () => {
    // U+00B5 upper-cases to U+039C GREEK CAPITAL MU, not to `M`. This is the
    // assertion that fails if the fix is ever rewritten as a scale-table row
    // spelled with a mu, because that row would sit next to `M` = milli.
    assert.equal(MICRO.toUpperCase(), 'Μ');
    assert.equal(parseSpiceValue('1M'), 1e-3);
    assert.equal(parseSpiceValue('1MEG'), 1e6);
    assert.equal(parseSpiceValue('1MIL'), 25.4e-6);
    assert.equal(parseSpiceValue('1F'), 1e-15);
    assert.equal(parseSpiceValue('4.7kOhm'), 4700);
  });

  test('a constant expression tokenises the sign instead of dying on it', () => {
    // The old failure was specifically NOT "no number": `55<micro>` matched `55`
    // and then threw `unsupported token at "<micro>"`, so a test asserting only
    // that the expression parses would have passed on the broken code for `55`.
    assert.equal(parseConstantExpression(`55${MICRO}`).value, 55e-6);
    assert.equal(evaluateConstantExpression(`{2*55${MICRO}}`, new Map()), 110e-6);
    assert.equal(evaluateConstantExpression(`100${GREEK_MU}`, new Map()), 100e-6);
  });

  test('a non-numeric non-ASCII character is still refused BY NAME', () => {
    // The fix must not become "accept any non-ASCII trailer".
    assert.equal(Number.isNaN(parseSpiceValue('55Ω')), true, 'the ohm sign is not a scale factor');
    assert.throws(() => parseConstantExpression('55 © 3'), /unsupported token/);
  });
});

describe('library file encodings (decoder half)', () => {
  let root;
  const write = (name, bytes) => { const p = join(root, name); writeFileSync(p, bytes); return p; };

  test('a CP1252 file decodes to the micro sign, not to U+FFFD', () => {
    root = mkdtempSync(join(tmpdir(), 'enc-'));
    try {
      // Authored bytes in the shape the vendor models use: a copyright sign in
      // the header comment and a micro suffix on a current source.
      const body = Buffer.from([
        ...Buffer.from('* Copyright '), 0xa9,
        ...Buffer.from(' nobody\r\n.subckt REG 1 2\r\nI2 1 2 55'), MICRO_1252,
        ...Buffer.from('\r\n.ends\r\n'),
      ]);
      assert.throws(() => new TextDecoder('utf-8', { fatal: true }).decode(body),
        'the fixture must be genuinely invalid UTF-8, or this test proves nothing');
      const text = readLibraryFile(write('reg.sub', body));
      assert.ok(text.includes(`55${MICRO}`), `expected a micro sign, got ${JSON.stringify(text.slice(-24))}`);
      assert.equal(text.includes('�'), false, 'no replacement character may survive');
      assert.ok(text.includes('Copyright ©'));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('a real UTF-8 file is NOT mis-decoded by the fallback', () => {
    // The control. A naive "always CP1252" reader turns this two-byte micro
    // sign into two characters and the assertion below fails, which is the
    // point: the strict UTF-8 decode is the detector, not a guess about a tree.
    root = mkdtempSync(join(tmpdir(), 'enc-'));
    try {
      const text = readLibraryFile(write('u8.sub',
        Buffer.from(`.subckt REG 1 2\r\nI2 1 2 55${MICRO}\r\n.ends\r\n`, 'utf8')));
      assert.ok(text.includes(`55${MICRO}`));
      assert.equal(text.includes('Â'), false, 'a UTF-8 lead byte read as CP1252 shows up as A-circumflex');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('UTF-16LE with a BOM still wins over both', () => {
    root = mkdtempSync(join(tmpdir(), 'enc-'));
    try {
      const text = readLibraryFile(write('u16.sub', Buffer.concat([
        Buffer.from([0xff, 0xfe]),
        Buffer.from(`.subckt REG 1 2\r\nI2 1 2 55${MICRO}\r\n.ends\r\n`, 'utf16le'),
      ])));
      assert.ok(text.includes(`55${MICRO}`));
      assert.equal(text.includes('\u0000'), false, 'UTF-16 read as single bytes leaves NULs');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe('end to end: the value reaches the circuit', () => {
  test('a supplied library carrying a micro suffix imports with NO loss', () => {
    // The corpus case reduced to a deck and a library of my own: `55<micro>`
    // must arrive as a 55 uA source, not as a named loss.
    const library = `.subckt REG in out\nI2 in out 55${MICRO}\nR9 in out 1k\n.ends\n`;
    // Line one is the SPICE title and is eaten by any SPICE reader, ngspice
    // included. Without it the `X1` card itself is the title and this test
    // would pass on a circuit that never contained the subcircuit at all.
    const deck = '* micro-suffix fixture\nX1 A B REG\nV1 A 0 DC 5\nR1 B 0 1k\n.op\n';
    const out = importSpice(deck, { libraries: [library] });
    const bad = (out.losses || []).filter(l => /constant|expression/i.test(String(l.kind)));
    assert.deepEqual(bad.map(l => l.source), [], 'no constant-expression loss may remain');
    assert.deepEqual((out.unmapped || []).map(u => u.ref ?? u.kind), []);
    assert.deepEqual(out.usedLibraries, [{ kind: 'subckt', name: 'reg', ref: 'X1' }],
      'the supplied library must be the thing that defined REG');
    const src = out.parts.find(p => p.id === 'X1.I2');
    assert.ok(src, `the current source must be in the circuit: ${out.parts.map(p => p.id).join(',')}`);
    assert.equal(src.kind, 'isource');
    assert.equal(Math.abs(Number(src.params.amps)), 55e-6);
  });
});

/**
 * TWO IMPORTER GAPS FOUND BY SWEEPING 14,115 FOREIGN DECKS, and one parse
 * defect that had been wearing a missing-model reason.
 *
 * 1. A LEVEL-1 JFET IS THE MOSFET SQUARE LAW. Shichman-Hodges is the same
 *    equation for both; the JFET's Vto is simply negative and Beta plays the
 *    role of `k` directly. So a `J` card MAPS to the engine's nmos/pmos rather
 *    than becoming a fourth kind — "a kind exists when the stamp differs", and
 *    at DC in the normal region it does not. 3,349 J-card occurrences in the
 *    symbench corpus had no path at all before this.
 *
 *    What DOES differ is stated: a JFET's gate-channel junction is a diode
 *    where a MOSFET's gate is insulated, so a FORWARD-biased gate is not
 *    represented, and ngspice's JFET carries RD/RS series resistances this
 *    mapping does not.
 *
 * 2. THE X-CARD SUBCIRCUIT NAME IS NOT THE LAST TOKEN. An X card is
 *    `Xname node1 .. nodeN subcktname [param=value ...]`. Taking the last token
 *    made every call with trailing parameters name a PARAMETER as its
 *    subcircuit: on Si7li the top three "undefined subcircuits" were
 *    `rin=500meg` (406), `gbw=10meg` (193) and `bot=1t` (26). A parse defect
 *    wearing a missing-model reason is worse than a missing model, because it
 *    sends the reader looking for a library.
 *
 * 3. LIBRARIES ARE INJECTED, NEVER READ. `.include` names a path and following
 *    one means opening whatever a foreign deck points at — security is
 *    independent of licensing. The caller resolves the path and hands over the
 *    bytes. An undefined subcircuit is the SOLE blocker on 3,290 decks, so this
 *    is the highest-yield thing in the importer; nothing unlocks any of them
 *    until a library can be supplied at all.
 *
 * The fixtures are self-authored, and the ngspice numbers in the JFET case were
 * taken from the reference before the mapping existed.
 */
import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importSpice } from '../src/importers/spice.js';
import { judgeForeignDeck, haveNgspice } from '../scripts/spice-oracle.mjs';

const SKIP = haveNgspice() ? false : 'ngspice not installed';

const JFET = [
  '* self-authored JFET bench, level-1 Shichman-Hodges',
  'VDD D0 0 DC 12',
  'VG  G0 0 DC -1',
  'RD  D0 D 2k',
  'RS  S 0 470',
  'J1  D G0 S NJF',
  '.MODEL NJF NJF (VTO=-2 BETA=1e-3 LAMBDA=0.01)',
  '.op',
  '.end',
].join('\n');

test('a J card maps to the square law with BETA as k and a negative VTO', () => {
  const r = importSpice(JFET);
  assert.deepEqual(r.unmapped, [], `a J card was refused: ${JSON.stringify(r.unmapped)}`);
  const j = r.parts.find((p) => p.id === 'J1');
  assert.ok(j, `no J1 in ${r.parts.map((p) => p.id).join(', ')}`);
  assert.equal(j.kind, 'nmos', 'an NJF is the n-channel square law');
  assert.equal(j.params.vth, -2, 'VTO becomes vth, sign intact — a JFET is depletion mode');
  assert.equal(j.params.k, 1e-3, 'BETA becomes k directly: no W/L, no KP/2');
  assert.equal(j.params.lambda, 0.01);

  // A PJF is the other polarity, and the two must not collapse to one.
  const pj = importSpice(JFET.replace(/NJF NJF/, 'NJF PJF'));
  assert.equal(pj.parts.find((p) => p.id === 'J1').kind, 'pmos');
});

test('the JFET bench agrees with ngspice in saturation and near the knee',
  { skip: SKIP }, () => {
    // ngspice, read from these exact bytes before the mapping existed:
    //   RD = 2k    S 0.2739353 V   D 10.83432 V
    //   RD = 100   S 0.2754905 V   D 11.94139 V
    const dir = mkdtempSync(join(tmpdir(), 'jfet-'));
    try {
      for (const [label, deck] of [['saturated', JFET],
        ['near the knee', JFET.replace('RD  D0 D 2k', 'RD  D0 D 100')]]) {
        const r = judgeForeignDeck(`jfet-${label.replace(/\s+/g, '-')}`, deck, dir);
        assert.ok(r.compared >= 4, `${label}: only ${r.compared} node(s) compared`);
        assert.ok(r.ok, `${label}:\n${r.lines.join('\n')}`);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

test('the X-card subcircuit name is the last token that is not a parameter', () => {
  const lib = ['* library', '.subckt amp inp inn out', 'R1 inp out 1k', 'R2 out inn 1k',
    '.ends', ''].join('\n');
  const deck = ['*t', 'X1 a b c amp rin=500meg gbw=10meg', 'V1 a 0 5', 'R9 b 0 1k',
    'R8 c 0 1k', '.op', '.end'].join('\n');

  // Without the library the name is still read correctly — the refusal must
  // name `amp`, not `gbw=10meg`.
  const bare = importSpice(deck);
  assert.equal(bare.unmapped.length, 1);
  assert.match(bare.unmapped[0].libsource, /undefined subcircuit "amp"/,
    `the refusal named a parameter instead of the subcircuit: ${bare.unmapped[0].libsource}`);

  const r = importSpice(deck, { libraries: [lib] });
  assert.deepEqual(r.unmapped, []);
  assert.ok(r.parts.some((p) => p.id === 'X1.R1'), 'the body did not flatten');
  // A parameter OVERRIDE is not applied, and that is said out loud rather than
  // dropped: the body flattens with its own defaults.
  assert.ok(r.warnings.some((w) => /parameter override/.test(w)),
    `the dropped overrides were not reported: ${JSON.stringify(r.warnings)}`);
});

test('an injected library resolves names, and a local definition wins', () => {
  const lib = ['* library', '.subckt amp inp inn out', 'R1 inp out 1k', 'R2 out inn 1k', '.ends',
    '.model MYD D(IS=2e-12 N=1.3 RS=4)', ''].join('\n');
  const deck = ['*t', 'X1 a b c amp', 'D1 c 0 MYD', 'V1 a 0 5', 'R9 b 0 1k', '.op', '.end'].join('\n');

  const r = importSpice(deck, { libraries: [lib] });
  assert.deepEqual(r.unmapped, []);
  assert.deepEqual(r.usedLibraries.map((u) => `${u.kind}:${u.name}`).sort(),
    ['model:myd', 'subckt:amp']);

  // PRECEDENCE, and the provenance that goes with it. A deck that defines the
  // same names uses its OWN, and `usedLibraries` must then be empty — a false
  // provenance record is the one thing that field exists to avoid.
  const local = ['*t', '.subckt amp a b c', 'R9 a c 42', '.ends',
    '.model MYD D(IS=1e-9 N=1 RS=1)', 'X1 a b c amp', 'D1 c 0 MYD', 'V1 a 0 5',
    'R8 b 0 1k', '.op', '.end'].join('\n');
  const r2 = importSpice(local, { libraries: [lib] });
  assert.deepEqual(r2.usedLibraries, [],
    'a local definition was reported as taken from the library');
  assert.ok(r2.parts.some((p) => p.id === 'X1.R9'), 'the local body was not the one used');

  // A library's ELEMENT cards must not join the circuit: a library is a
  // definition file, and adopting its elements would build a circuit the deck
  // never described.
  const withElements = lib + 'R_LIB_STRAY 1 2 999\n';
  const r3 = importSpice(deck, { libraries: [withElements] });
  assert.ok(!r3.parts.some((p) => /STRAY/i.test(p.id)),
    `a library element card entered the circuit: ${r3.parts.map((p) => p.id).join(', ')}`);
});

test('a library-resolved deck is its own evidence class', { skip: SKIP }, () => {
  // It is not `original-direct`: the comparison depends on a file the source
  // did not ship, and which ngspice is NOT given — it sees the original bytes
  // and its own unfollowed `.include`.
  const dir = mkdtempSync(join(tmpdir(), 'jfet-'));
  try {
    const lib = '.model MYD D(IS=2e-12 N=1.3 RS=4)\n';
    const deck = ['*t', 'V1 a 0 DC 5', 'R1 a c 1k', 'D1 c 0 MYD', '.op', '.end'].join('\n');
    const r = judgeForeignDeck('libclass', deck, dir, { libraries: [lib] });
    assert.equal(r.evidence, 'library-resolved', `evidence was ${r.evidence}`);
    assert.ok(r.usedLibraries.length >= 1);
    // Without the library the same deck is self-contained in its own terms.
    const plain = judgeForeignDeck('plainclass',
      deck.replace('.op', '.model MYD D(IS=2e-12 N=1.3 RS=4)\n.op'), dir);
    assert.equal(plain.evidence, 'original-direct', `evidence was ${plain.evidence}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

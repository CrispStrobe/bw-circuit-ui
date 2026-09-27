/**
 * A FOREIGN SPICE DECK, IMPORTED, SOLVED, AND JUDGED BY NGSPICE.
 *
 * The corpus lane acquired tens of thousands of valued decks and almost none
 * of them were reachable: `judgeCase` starts from a bw-circuit-ui circuit JSON
 * and `judgeRoundTrip` starts from one too, so both judge OUR decks. A foreign
 * `.cir` had no path in at all, and "how many can we run" was a question about
 * the harness rather than about the engine.
 *
 * Measured on ADI2005 v3 (12,471 valued decks, all with analysis cards) as each
 * blocker fell:
 *
 *     nothing compared, no path                      0.0 %
 *     + the deck's own node names kept              43.5 %
 *     + `AC 1` is not a DC bias                     ...
 *     + sweeps commented out so `.op` is the table  79.0 %
 *
 * The three tests below are one per blocker, on self-authored decks, because a
 * corpus row is neither redistributable nor a stable fixture.
 */
import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importSpice } from '../src/importers/spice.js';
import { Circuit } from '../src/model/circuit.js';
import { extractNetlist } from '../src/model/netlist.js';
import { judgeForeignDeck, haveNgspice } from '../scripts/spice-oracle.mjs';

const NG = haveNgspice();

test('the importer keeps the deck\'s own node names', () => {
  // Without this the engine calls the net `net-lgc-1`, ngspice calls it `vdd`,
  // and a comparison by name finds zero shared nodes — which reads as a
  // harness failure and is really a dropped fact. 195 of 200 ADI decks.
  const r = importSpice('*t\nV1 VDD 0 DC 5\nR1 VDD OUT 1k\nR2 OUT 0 1k\n.op\n.end');
  assert.ok(Array.isArray(r.netNames), 'importSpice returned no netNames');
  const names = r.netNames.map(n => n.name).sort();
  assert.deepEqual(names, ['0', 'OUT', 'VDD']);
  // Each carries the terminals on it, so a consumer can join to the engine's
  // netlist through any one of them without a shared naming convention.
  const vdd = r.netNames.find(n => n.name === 'VDD');
  assert.ok(vdd.terminals.some(t => t.partId === 'R1'),
    `VDD names no R1 terminal: ${JSON.stringify(vdd)}`);
});

test('`AC 1` is a small-signal magnitude, not a bias', () => {
  // `V1 IN 0 AC 1` has NO DC term, and SPICE solves its operating point at
  // zero. The bare-number fallback took the first numeric field it saw and
  // imported a 1 V source, so every AC-only filter deck disagreed by exactly
  // the magnitude at every node.
  const ac = importSpice('*t\nV1 IN 0 AC 1\nR1 IN 0 1k\n.op\n.end');
  const v1 = ac.parts.find(p => p.id === 'V1');
  assert.equal(v1.params.volts, 0,
    'an AC-only source must bias at 0 V — its number is a magnitude');
  assert.equal(v1.params.acMagnitude, 1, 'the magnitude is kept, not dropped');

  // The counter-examples, so the rule cannot have eaten the DC case. All four
  // orderings, because the descriptor was once anchored at END OF LINE and
  // `AC 1m DC 1.8` — the house style of every small-signal bench in ADI2005 —
  // was then refused outright as "undefined constant ac".
  const cases = [
    ['V1 IN 0 DC 5 AC 1', 5, 1],
    ['V1 IN 0 AC 1 DC 5', 5, 1],
    ['V1 IN 0 AC 1m DC 1.8', 1.8, 0.001],
    ['V1 IN 0 5', 5, undefined],
    // A negative magnitude is a PHASE, not an error. Refusing it discarded the
    // DC bias with it, on every deck that writes a differential pair as
    // `AC 0.5` / `AC -0.5` — 31 of the first 400 ADI2005 decks.
    ['V1 IN 0 DC 0 AC -0.5', 0, 0.5],
  ];
  for (const [card, volts, mag] of cases) {
    const r = importSpice(`*t\n${card}\nR1 IN 0 1k\n.op\n.end`);
    assert.deepEqual(r.losses, [], `${card} was refused: ${JSON.stringify(r.losses)}`);
    const p = r.parts.find(x => x.id === 'V1');
    assert.equal(p.params.volts, volts, `${card} biased at ${p.params.volts}, expected ${volts}`);
    assert.equal(p.params.acMagnitude, mag, `${card} magnitude ${p.params.acMagnitude}`);
  }
  const neg = importSpice('*t\nV1 IN 0 DC 0 AC -0.5\nR1 IN 0 1k\n.op\n.end');
  assert.equal(neg.parts.find(x => x.id === 'V1').params.acPhase, 180,
    'a negative magnitude must become +180 degrees, not a refusal');
});

test('a level-1 MOSFET keeps KP, W, L and LAMBDA', () => {
  // The engine's `mosK` reads `kp` with per-instance `w`/`l` and has since
  // before this; the importer simply never passed them, so a deck stating
  // KP=1e-4 with W=20u L=1u was solved at the fallback k = 0.5 — five hundred
  // times too big.
  const r = importSpice('*t\nVD D 0 DC 5\nM1 D G 0 0 NM W=20u L=1u\n'
    + '.MODEL NM NMOS (LEVEL=1 VTO=1 KP=1.0e-4 LAMBDA=0.005)\n.op\n.end');
  const m = r.parts.find(p => p.id === 'M1');
  assert.equal(m.kind, 'nmos');
  assert.equal(m.params.vth, 1);
  assert.equal(m.params.kp, 1.0e-4);
  assert.equal(m.params.w, 20e-6);
  assert.equal(m.params.l, 1e-6);
  assert.equal(m.params.lambda, 0.005);
});

test('only the spellings ngspice aliases are ground', () => {
  // MEASURED against the reference simulator, one deck per name:
  //
  //     0        the reference
  //     gnd      the reference     (aliased; it vanishes from the .op table)
  //     gnd!     2.5 V — an ordinary node
  //     ground   2.5 V — an ordinary node
  //     vss      2.5 V — an ordinary node
  //
  // Aliasing a node the simulator does not alias does not make our answer
  // approximate, it makes it an answer about a DIFFERENT CIRCUIT. `vss` was the
  // expensive one: in an analogue deck it is the NEGATIVE SUPPLY, and
  // collapsing it to 0 deleted the rail. 876 of 12,471 ADI2005 decks name it,
  // all 876 drive it with a source, and none rely on it as their only ground.
  const split = importSpice('*t\nVDD VDD 0 DC 15\nVSS VSS 0 DC -15\n'
    + 'R1 VDD N 10k\nR2 N VSS 10k\n.op\n.end');
  const names = split.netNames.map(n => n.name.toLowerCase()).sort();
  assert.ok(names.includes('vss'),
    `VSS was swallowed by ground: ${JSON.stringify(names)}`);
  const c = Circuit.fromJSON({ parts: split.parts, wires: split.wires });
  c.setPower(true);
  const idOf = (name) => {
    const dn = split.netNames.find(x => x.name.toLowerCase() === name);
    const nl = extractNetlist(c);
    for (const net of nl.nets) {
      for (const nd of net.nodes || []) {
        if (dn.terminals.some(t => t.partId === nd.refdes && t.terminal === nd.pin)) return net.id;
      }
    }
    return null;
  };
  assert.ok(Math.abs(c.nodeVoltage(idOf('vss')) + 15) < 1e-6,
    `VSS reads ${c.nodeVoltage(idOf('vss'))} V, expected -15`);
  // Equal resistors between +15 and -15 put the midpoint at 0 — the number
  // that is only right if the negative rail survived.
  assert.ok(Math.abs(c.nodeVoltage(idOf('n'))) < 1e-6,
    `the divider midpoint reads ${c.nodeVoltage(idOf('n'))} V, expected 0`);
});

test('a deck whose only return is spelled `vss` still gets a reference, and says so', () => {
  // The counter-example. Without the fallback, dropping `vss` from the alias
  // list would leave such a deck with nothing to measure against — and without
  // the WARNING, the fallback is the silent guess that caused the original
  // defect.
  const r = importSpice('*t\nV1 A VSS DC 5\nR1 A VSS 1k\n.op\n.end');
  assert.ok(r.parts.some(p => p.kind === 'gnd'), 'no reference was adopted');
  assert.ok(r.warnings.some(w => /names no node 0 and no gnd/.test(w)),
    `the guess was not reported: ${JSON.stringify(r.warnings)}`);
});

test('a foreign cascode deck agrees with ngspice', { skip: NG ? false : 'ngspice not installed' }, () => {
  // The bench every MOSFET fix above was measured on. ngspice, on these exact
  // bytes: V(out) 11.40361, V(casc) 4.803472, Id 655 uA. The engine read
  // V(out) 0.0188 before the importer carried KP/W/L, 7.85 before `mosGds`
  // stopped putting a 1 kOhm across the channel, and 11.4161 before LAMBDA.
  const dir = mkdtempSync(join(tmpdir(), 'bw-foreign-'));
  try {
    const deck = [
      '*NMOS Cascode Amplifier',
      'VDD VDD 0 DC 12',
      'VIN IN 0 AC 1m DC 1.8',
      'VBIAS BIAS 0 DC 6.6',
      'RD VDD OUT 910',
      'M1 CASC IN 0 0 NMOS W=20u L=1u',
      'M2 OUT BIAS CASC 0 NMOS W=20u L=1u',
      '.MODEL NMOS NMOS (LEVEL=1 VTO=1 KP=1.0e-4 LAMBDA=0.005)',
      '.OP',
      '.AC DEC 50 1 1Meg',
      '.END',
    ].join('\n');
    const r = judgeForeignDeck('cascode', deck, dir);
    assert.ok(r.compared >= 4, `only ${r.compared} node(s) compared: ${r.lines.join(' | ')}`);
    assert.ok(r.ok, r.lines.join('\n'));
    // The edit is recorded, because a deck we changed is a deck we have to say
    // we changed: the `.ac` sweep would otherwise overwrite the `.op` table.
    assert.ok(r.lines.some(l => /deck edited/.test(l)),
      'the .ac card was commented out and the judge did not say so');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an import loss refuses the case instead of comparing it', { skip: NG ? false : 'ngspice not installed' }, () => {
  // A deck we only partly understood is a DIFFERENT circuit, and agreeing with
  // it would be worse than failing. The judge must refuse by name.
  //
  // THE FIXTURE CHANGED AND THE CLAIM DID NOT. This used to be
  // `PULSE(0 5 0 0 1n 10n 20n)`, whose TR = 0 fails the strict waveform check —
  // and that is now a BIAS-SAFE loss, because the importer keeps the source's
  // initial value and ngspice's `.op` uses exactly that. So the example moved
  // category while "a blocking loss refuses" stayed true, and the fixture is
  // now a loss that really does change the circuit: a diode whose model the
  // deck never declares.
  const dir = mkdtempSync(join(tmpdir(), 'bw-foreign-'));
  try {
    const deck = '*t\nV1 IN 0 DC 5\nR1 IN M 1k\nD1 M 0 NOSUCHMODEL\n.op\n.end';
    const r = judgeForeignDeck('lossy', deck, dir);
    assert.equal(r.ok, false);
    assert.match(r.reason, /loss|unmapped/,
      `expected a refusal naming the loss, got "${r.reason}"`);
    assert.equal(r.compared, 0, 'a refused case must compare nothing');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a waveform-only loss is COMPARED at the initial value, and says so',
  { skip: NG ? false : 'ngspice not installed' }, () => {
  /**
   * `unsupported-inline-waveform` says the importer could not keep a source's
   * WAVEFORM. It kept its initial value, and for a `.op` that is the whole
   * answer. ngspice's own `.op` values, measured:
   *
   *   PULSE(1 4 10u 1u 1u 5u 20u)        -> 1.000000   (V1)
   *   SINE(2 3 1k)                       -> 2.000000   (the offset)
   *   DC 0.5 PULSE(1 4 10u 1u 1u 5u 20u) -> 0.500000   (DC wins)
   *
   * so the two sides agree about what the source is worth at the bias point.
   * Refusing it answers a question nobody asked. ~180 of the 1,129 losses in
   * the 7,866-deck Si7li corpus are this kind.
   */
  const dir = mkdtempSync(join(tmpdir(), 'bw-foreign-'));
  try {
    // TR = 0 fails the strict seven-scalar check, so this is a waveform loss.
    const deck = '*t\nV1 IN 0 PULSE(0 5 0 0 1n 10n 20n)\nR1 IN 0 1k\n.op\n.end';
    const r = judgeForeignDeck('waveform-only', deck, dir);
    assert.ok(r.compared > 0,
      `a waveform-only loss must be compared, not refused: ${r.reason}`);
    assert.equal(r.ok, true, JSON.stringify(r.lines));
    assert.ok((r.adapted || []).some((e) => /waveform/.test(e) && /initial value/.test(e)),
      `the dropped waveform must be recorded as an edit: ${JSON.stringify(r.adapted)}`);
    assert.equal(r.evidence, 'original-adapted',
      'a deck compared at a source initial value is adapted, not direct');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

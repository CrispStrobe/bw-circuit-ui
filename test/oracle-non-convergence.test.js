/**
 * THE ORACLE IS HELD TO THE SAME STANDARD AS THE ENGINE.
 *
 * `judgeForeignDeck` already refuses OUR answer when the solver reports
 * `converged: false`, on the ground that a non-converged solve is an iterate and
 * not an answer. It was not applying that to ngspice — the same claim about the
 * other operand — and ngspice STILL PRINTS A BIAS-POINT TABLE after giving up,
 * with no change in exit status.
 *
 * The corpus case (ADI2005 v3 row 11, a common-emitter amplifier whose output
 * hangs off a 3 uF coupling capacitor and is therefore floating at `.op`):
 *
 *   Warning: singular matrix:  check node out
 *   Warning: Dynamic gmin stepping failed
 *   Warning: True gmin stepping failed
 *   Warning: source stepping failed
 *   base 1.110813e-03   emit 3.073119e-12   coll 1.200000e+01
 *
 * A 36k/7.5k divider off 12 V puts that base at 2.07 V and nothing in the deck
 * says otherwise. Scoring against those numbers manufactures false
 * disagreements AND false agreements, and the second kind is worse because it
 * inflates the corpus figure: 277 of a 2,000-deck sample were being scored
 * against a non-converged run, and 257 of them were counted as AGREEING.
 *
 * It is also an independent confirmation of where ngspice puts GMIN. A
 * junction-free floating node makes its matrix singular, which cannot happen if
 * every node carries a conductance to the reference.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runNgspice, judgeForeignDeck, haveNgspice,
  isolatedUnreferencedComponents } from '../scripts/spice-oracle.mjs';
import { Circuit } from '../src/model/circuit.js';
import { extractNetlist } from '../src/model/netlist.js';

const HAVE = haveNgspice();

// Self-authored: the output node is reachable only through the capacitor, so at
// a bias point it is floating and ngspice's matrix is singular.
const FLOATING = [
  '* a node reachable only through a coupling capacitor',
  'VCC VCC 0 12',
  'R1 VCC BASE 36k',
  'R2 BASE 0 7.5k',
  'RC VCC COLL 510',
  'RE EMIT 0 240',
  'Q1 COLL BASE EMIT QN',
  'COUT COLL OUT 3u',
  '.model QN NPN (BF=200 IS=1e-14)',
  '.op',
  '.end',
].join('\n');

// The same circuit with the dangling node tied down: ngspice converges.
const GROUNDED = FLOATING.replace('COUT COLL OUT 3u', 'ROUT COLL OUT 1k\nR3 OUT 0 1k');

describe('ngspice non-convergence is reported, not scored', () => {
  it('runNgspice reports a singular matrix separately from a deck error', (t) => {
    if (!HAVE) { t.skip('ngspice not installed'); return; }
    const dir = mkdtempSync(join(tmpdir(), 'nonconv-'));
    try {
      const r = runNgspice(FLOATING, dir, 'floating');
      assert.equal(r.error, null, 'the deck itself is accepted — this is not a syntax refusal');
      assert.ok(r.nonConverged, 'a singular matrix must be reported');
      assert.match(r.nonConverged, /singular matrix/i);
      // And it printed a table anyway, which is exactly the trap.
      assert.ok(Object.keys(r.nodes).length > 0,
        'ngspice prints a bias-point table after giving up; that is why this check exists');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('and reports nothing for a deck it does solve', (t) => {
    if (!HAVE) { t.skip('ngspice not installed'); return; }
    const dir = mkdtempSync(join(tmpdir(), 'nonconv-'));
    try {
      const r = runNgspice(GROUNDED, dir, 'grounded');
      assert.equal(r.error, null);
      assert.equal(r.nonConverged, null,
        `a converging deck must not be flagged: ${r.nonConverged}`);
      assert.ok(Object.keys(r.nodes).length > 0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('the judge REFUSES rather than comparing, and says which node', async (t) => {
    if (!HAVE) { t.skip('ngspice not installed'); return; }
    const dir = mkdtempSync(join(tmpdir(), 'nonconv-'));
    try {
      const r = await judgeForeignDeck('floating.cir', FLOATING, dir, {});
      assert.equal(r.ok, false);
      assert.equal(r.compared, 0, 'nothing may be compared against a failed iterate');
      assert.match(r.reason, /^oracle-non-convergence:/,
        `the reason must name the cause, got: ${r.reason}`);
      assert.ok(r.lines.some((l) => /failed iterate/.test(l)),
        'the report must say what the printed table is');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('the same circuit with the node tied down is judged normally', async (t) => {
    if (!HAVE) { t.skip('ngspice not installed'); return; }
    // The separating control: without it, a refusal that fired for ANY reason
    // would satisfy the test above.
    const dir = mkdtempSync(join(tmpdir(), 'nonconv-'));
    try {
      const r = await judgeForeignDeck('grounded.cir', GROUNDED, dir, {});
      assert.ok(r.compared > 0,
        `the control deck must actually be compared, got compared=${r.compared} reason=${r.reason}`);
      assert.ok(!/oracle-non-convergence/.test(r.reason || ''),
        `the control must not be refused for non-convergence: ${r.reason}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

/**
 * AN UNBOUNDED READING IS NOT AN ANSWER EITHER, ON EITHER SIDE.
 *
 * A passive network cannot bias a node past its own sources. A reading of 1e9 V
 * on a 12 V deck is an artefact, and scoring it produces a delta of 1e9 that
 * says nothing about either model — it is neither a disagreement nor evidence
 * of one.
 *
 * Both sides do it, which is why the test is symmetric:
 *
 *   ADI2005 v3 rows 339, 633, 1255 — an ideal 1 mA source drives a node with
 *     NOTHING else on it, so our blanket 1e-12 node shunt is the only load and
 *     1e-3/1e-12 pins the node at the clamp. ngspice prints -0.001 V, with no
 *     warning of any kind.
 *   ADI2005 v3 row 1396 — ngspice ITSELF prints 1.669e17 V, and prints no
 *     warning, so the non-convergence check above cannot see it.
 *
 * The bound is derived from the deck, not chosen: 100x the largest magnitude
 * any voltage source states, plus a volt. Generous on purpose — this is a
 * nonsense filter, not a tolerance.
 */
describe('a reading outside the deck\'s own source envelope', () => {
  // Self-authored: a 1 mA current source into a node nothing else touches.
  const DANGLING_ISOURCE = [
    '* an ideal current source into a node with nothing else on it',
    'V1 rail 0 DC 12',
    'R1 rail a 1k',
    'R2 a 0 1k',
    'I1 dangling 0 DC 1m',
    '.op',
    '.end',
  ].join('\n');

  it('is refused as a whole deck, naming which side produced it', async (t) => {
    if (!HAVE) { t.skip('ngspice not installed'); return; }
    const dir = mkdtempSync(join(tmpdir(), 'unbounded-'));
    try {
      const r = await judgeForeignDeck('dangling.cir', DANGLING_ISOURCE, dir, {});
      assert.equal(r.ok, false);
      assert.equal(r.compared, 0,
        'a network with one unbounded node has an unbounded solution; the rest '
        + 'of its table is not independently trustworthy');
      assert.match(r.reason, /^unbounded:/, `got: ${r.reason}`);
      assert.ok(/engine|ngspice|both/.test(r.reason),
        `the reason must name which side: ${r.reason}`);
      assert.ok(r.lines.some((l) => /source envelope/.test(l)),
        'the report must state the bound it applied');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('does NOT fire on the same deck with the dangling node tied down', async (t) => {
    if (!HAVE) { t.skip('ngspice not installed'); return; }
    // The separating control. Without it, a refusal firing for any reason at
    // all would satisfy the assertion above.
    const dir = mkdtempSync(join(tmpdir(), 'unbounded-'));
    try {
      const tied = DANGLING_ISOURCE.replace('I1 dangling 0 DC 1m',
        'I1 dangling 0 DC 1m\nR3 dangling 0 1k');
      const r = await judgeForeignDeck('tied.cir', tied, dir, {});
      assert.ok(r.compared > 0,
        `the control must be compared, got compared=${r.compared} reason=${r.reason}`);
      assert.ok(!/unbounded/.test(r.reason || ''),
        `the control must not be refused as unbounded: ${r.reason}`);
      assert.equal(r.ok, true, `and it must AGREE: ${JSON.stringify(r.lines)}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('scales the bound with the deck, so a 12 V deck is not judged like a 1 V one', async (t) => {
    if (!HAVE) { t.skip('ngspice not installed'); return; }
    // A 1 kV source must not make ordinary nodes look unbounded, and an
    // ordinary deck's nodes must stay well inside the bound.
    const dir = mkdtempSync(join(tmpdir(), 'unbounded-'));
    try {
      const kilovolt = ['* a kilovolt divider', 'V1 hv 0 DC 1000',
        'R1 hv mid 1k', 'R2 mid 0 1k', '.op', '.end'].join('\n');
      const r = await judgeForeignDeck('kv.cir', kilovolt, dir, {});
      assert.ok(!/unbounded/.test(r.reason || ''),
        `500 V on a 1 kV deck is ordinary: ${r.reason}`);
      assert.equal(r.ok, true, JSON.stringify(r.lines));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

/**
 * A CRASHED ORACLE MUST NOT READ AS A HARNESS FAULT.
 *
 * ngspice announces most deck errors in text and exits 0, so the exit status is
 * not the signal — but a CRASH does the opposite: `ERROR: fatal error in
 * ngspice, exit(1)`, with no line the text parser recognised. That pattern was
 * missing from the refusal list, so a crash arrived at the comparison as an
 * EMPTY NODE TABLE and the judge reported "nothing compared" — which is its
 * message for a failure of its OWN namespace join between deck node names and
 * engine net ids.
 *
 * A red that accuses the wrong component. 56 Si7li decks blamed the importer
 * for a deck ngspice could not get through, and the fix those rows pointed at
 * was in the wrong file.
 *
 * The general guard is the stronger one: an empty node table is the oracle
 * answering nothing, whatever its exit status, and a `.op` run that printed no
 * nodes has not produced a bias point.
 */
describe('an oracle that produced no table says so', () => {
  it('reports a crash as a refusal, naming it, not as an empty comparison', async (t) => {
    if (!HAVE) { t.skip('ngspice not installed'); return; }
    // THE CAUSE, MEASURED. ngspice exits fatally on a `.model` card carrying
    // string-valued vendor metadata:
    //
    //   .model DM D(Is=2.52n ... mfg=OnSemi type=silicon)
    //       -> ERROR: fatal error in ngspice, exit(1)
    //   the same card with mfg= and type= removed
    //       -> b = 6.532286e-01 V, solved
    //
    // My first version of this test guessed the cause was the title rule
    // eating the deck's only source, and the deck it built solved cleanly --
    // a true test of a false claim. The metadata is what does it.
    //
    // Written into the DECK here rather than a library, because the library
    // splice now strips these fields; this asserts what happens when the judge
    // does NOT get to rewrite the card.
    const deck = [
      '* a model card carrying manufacturer metadata',
      'V1 a 0 5',
      'R1 a b 1k',
      'D1 b 0 DM',
      '.model DM D(Is=2.52n Rs=.568 N=1.752 mfg=OnSemi type=silicon)',
      '.op',
      '.end',
    ].join('\n');
    const dir = mkdtempSync(join(tmpdir(), 'silent-'));
    try {
      const r = await judgeForeignDeck('crash.cir', deck, dir, {});
      assert.equal(r.ok, false);
      assert.ok(/^ngspice refused/.test(r.reason || ''),
        `the reason must blame the oracle, not the join: ${r.reason}`);
      assert.ok(!/nothing compared/.test(r.reason || ''),
        '"nothing compared" is the message for a namespace-join failure and '
        + 'must not be used for an oracle that produced no table');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('and the SAME model without the metadata is judged normally', async (t) => {
    if (!HAVE) { t.skip('ngspice not installed'); return; }
    // The separating control: one pair of fields is the whole difference.
    const deck = [
      '* the same card, vendor strings removed',
      'V1 a 0 5', 'R1 a b 1k', 'D1 b 0 DM',
      '.model DM D(Is=2.52n Rs=.568 N=1.752)',
      '.op', '.end',
    ].join('\n');
    const dir = mkdtempSync(join(tmpdir(), 'silent-'));
    try {
      const r = await judgeForeignDeck('nometa.cir', deck, dir, {});
      assert.ok(r.compared > 0, `must be compared: ${r.reason}`);
      assert.equal(r.ok, true, JSON.stringify(r.lines));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('a spliced library model is stripped so the oracle survives it', async (t) => {
    if (!HAVE) { t.skip('ngspice not installed'); return; }
    // The remedy, end to end, on a self-authored library. A real manufacturer
    // library carries exactly this shape on 926 of its diode models.
    const library = '.model LIBDIO D(Is=2.52n Rs=.568 N=1.752 Iave=200m Vpk=75 '
      + 'mfg=SomeVendor type=silicon)\n';
    const deck = ['* resolves its diode against a library it does not ship',
      'V1 a 0 5', 'R1 a b 1k', 'D1 b 0 LIBDIO', '.op', '.end'].join('\n');
    const dir = mkdtempSync(join(tmpdir(), 'silent-'));
    try {
      const r = await judgeForeignDeck('lib.cir', deck, dir, { libraries: [library] });
      assert.ok(r.compared > 0, `must be compared, got: ${r.reason}`);
      assert.equal(r.ok, true, JSON.stringify(r.lines));
      assert.ok((r.adapted || []).some((e) => /vendor metadata/.test(e)),
        `the strip must be recorded as an edit: ${JSON.stringify(r.adapted)}`);
      assert.equal(r.evidence, 'library-resolved');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('reports an empty node table even when nothing in the text looked fatal', async (t) => {
    if (!HAVE) { t.skip('ngspice not installed'); return; }
    // The general form: a deck ngspice accepts but for which it prints no `.op`
    // table. Driven through runNgspice directly so the assertion is about that
    // function's contract rather than about one deck's luck.
    const dir = mkdtempSync(join(tmpdir(), 'silent-'));
    try {
      const r = runNgspice('* nothing to solve\n.end\n', dir, 'empty');
      assert.deepEqual(r.nodes, {});
      assert.ok(r.error, 'an empty node table must be an error, not a null result');
      assert.ok(/no node table|refused|fatal/i.test(r.error), r.error);
      assert.equal(typeof r.status, 'number', 'the exit status is reported beside it');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('and a deck that DOES produce a table is untouched', async (t) => {
    if (!HAVE) { t.skip('ngspice not installed'); return; }
    const dir = mkdtempSync(join(tmpdir(), 'silent-'));
    try {
      const r = runNgspice(
        '* a divider\nV1 a 0 5\nR1 a b 1k\nR2 b 0 1k\n.op\n.end\n', dir, 'fine');
      assert.equal(r.error, null, `a healthy deck must not be refused: ${r.error}`);
      assert.ok(Math.abs(r.nodes.b - 2.5) < 1e-6, JSON.stringify(r.nodes));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

/**
 * TWO GAUGES ARE NOT TWO ANSWERS.
 *
 * `pc80-quellen-vergleich` is two independent 9 V batteries, each with its own
 * resistor and LED, and NO ground part. The exporter names one net node 0; the
 * engine picks its own reference. The second loop then floats, and the answers
 * differ by a RIGID SHIFT:
 *
 *   net_13   engine  5.305443   ngspice  3.517839   delta 1.787604
 *   net_15   engine -1.685230   ngspice -3.472830   delta 1.787600
 *   net_17   engine -3.620188   ngspice -5.407790   delta 1.787602
 *
 * Identical to six decimals across every node of that subgraph, while the other
 * loop's `net_7` agrees at 8.992494 exactly. That is not a model difference; it
 * is two valid gauge choices, and both answers are right.
 *
 * The detector counts galvanic components over PARTS, not wires — two nets
 * joined only through a part share a gauge — and tolerates ONE unreferenced
 * component, because with no gnd anywhere the exporter still assigns node 0 to
 * one of them. Two or more is the ambiguity.
 */
describe('a circuit with two floating gauges is refused, not scored', () => {
  const twoIsolatedLoops = () => Circuit.fromJSON({
    parts: [
      { id: 'b1', kind: 'battery', params: { volts: 9, rInternal: 0.5 }, x: 0, y: 0 },
      { id: 'r1', kind: 'resistor', params: { ohms: 470 }, x: 0, y: 0 },
      { id: 'b2', kind: 'battery', params: { volts: 9, rInternal: 5 }, x: 0, y: 0 },
      { id: 'r2', kind: 'resistor', params: { ohms: 470 }, x: 0, y: 0 },
    ],
    wires: [
      { from: 'b1', fromTerminal: 'pos', to: 'r1', toTerminal: 'a' },
      { from: 'r1', fromTerminal: 'b', to: 'b1', toTerminal: 'neg' },
      { from: 'b2', fromTerminal: 'pos', to: 'r2', toTerminal: 'a' },
      { from: 'r2', fromTerminal: 'b', to: 'b2', toTerminal: 'neg' },
    ],
  });

  it('detects exactly the two unreferenced components', () => {
    const c = twoIsolatedLoops(); c.setPower(true);
    const comps = isolatedUnreferencedComponents(extractNetlist(c));
    assert.equal(comps.length, 2, JSON.stringify(comps));
    // Each component must hold its own loop's nets, not be split further.
    for (const names of comps) assert.ok(names.length >= 2, JSON.stringify(comps));
  });

  it('tolerates ONE unreferenced component, because node 0 goes to it', () => {
    // The control that keeps this from refusing every ground-free circuit:
    // a single floating loop has a unique gauge once the exporter names node 0.
    const c = Circuit.fromJSON({
      parts: [
        { id: 'b1', kind: 'battery', params: { volts: 9, rInternal: 0.5 }, x: 0, y: 0 },
        { id: 'r1', kind: 'resistor', params: { ohms: 470 }, x: 0, y: 0 },
      ],
      wires: [
        { from: 'b1', fromTerminal: 'pos', to: 'r1', toTerminal: 'a' },
        { from: 'r1', fromTerminal: 'b', to: 'b1', toTerminal: 'neg' },
      ],
    });
    c.setPower(true);
    assert.deepEqual(isolatedUnreferencedComponents(extractNetlist(c)), []);
  });

  it('and a grounded circuit is never flagged, however many loops', () => {
    const c = Circuit.fromJSON({
      parts: [
        { id: 'b1', kind: 'battery', params: { volts: 9 }, x: 0, y: 0 },
        { id: 'r1', kind: 'resistor', params: { ohms: 470 }, x: 0, y: 0 },
        { id: 'b2', kind: 'battery', params: { volts: 9 }, x: 0, y: 0 },
        { id: 'r2', kind: 'resistor', params: { ohms: 470 }, x: 0, y: 0 },
        { id: 'g1', kind: 'gnd', params: {}, x: 0, y: 0 },
      ],
      wires: [
        { from: 'b1', fromTerminal: 'pos', to: 'r1', toTerminal: 'a' },
        { from: 'r1', fromTerminal: 'b', to: 'g1', toTerminal: 'gnd' },
        { from: 'b1', fromTerminal: 'neg', to: 'g1', toTerminal: 'gnd' },
        { from: 'b2', fromTerminal: 'pos', to: 'r2', toTerminal: 'a' },
        { from: 'r2', fromTerminal: 'b', to: 'g1', toTerminal: 'gnd' },
        { from: 'b2', fromTerminal: 'neg', to: 'g1', toTerminal: 'gnd' },
      ],
    });
    c.setPower(true);
    assert.deepEqual(isolatedUnreferencedComponents(extractNetlist(c)), [],
      'a shared ground gives every loop the same gauge');
  });
});

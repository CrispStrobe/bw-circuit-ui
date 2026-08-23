/**
 * SCHEMATIC GEOMETRY GATE — what the two netlist gates structurally cannot see.
 *
 * schematic-rendered-netlist.test.js reconstructs the netlist a reader infers
 * from the artwork, and it is careful and honest about doing so. But it builds
 * that netlist from the PIN-SIDE endpoint of each conductor only, on the stated
 * ground that trunk-side vertices "sit in free space":
 *
 *     "ONLY the pin-side endpoint of a conductor is a connection. The
 *      trunk-side endpoint and every intermediate vertex sit in free space"
 *
 * That is an assumption about geometry, not a check of it — and it was false.
 * `bodyBounds`, which the router uses to keep a wire off a symbol, stops 26px
 * from a symbol's centre, while that symbol's pins reach 30px. A trunk placed
 * in the 4px band between the two cleared the collision test and ran straight
 * down a column of pins. Measured over the whole corpus before the fix:
 *
 *     799 of 2,107 circuits drew at least one such conductor
 *     4,213 pin incidences in all, across 105 example directories
 *     worst: 46-port-overcurrent/circuit-flat.arduino-mega.json, 33 incidences
 *
 * In 46-port-overcurrent one trunk ran through four MCU port pins on four
 * DIFFERENT nets. A line touching a pin reads as attached to it — that is why
 * no schematic convention routes copper through a pin — so the drawing asserted
 * a four-way short that the solver does not have, and the netlist gate reported
 * a clean bill of health because it never looked at the geometry.
 *
 * So this gate measures the geometry directly. It shares ONE implementation
 * with scripts/schematic-audit.mjs, which is the tool that produced the numbers
 * in docs/SCHEMATIC-AUDIT.md; a gate and a report that disagree are worse than
 * either alone.
 *
 * === The classes ===
 *
 *   C  a drawn pin the projection could not resolve to any net
 *   D  an electrical part in the file with no symbol in the artwork
 *   E  a solver net with >=2 visible terminals and neither copper nor a label
 *   F  two DIFFERENT nets crossing where a junction dot is drawn
 *      (a dot means connected — the opposite of what a crossing means)
 *   G  one net's T-branch with NO junction dot
 *      (no dot means passing over — again the opposite meaning)
 *   H  two nets' trunks closer than 4px over an overlapping span
 *      (they render as one wire)
 *   I  a conductor running through a pin that is not on its net
 *   J  one solver net drawn under two different label texts
 *      (a false DISCONNECTION: the reader sees two nets)
 *   K  one net drawn as copper in one place and as a label in another
 *
 * Every class must be ZERO except C, which is a CORPUS fact rather than a
 * viewer defect: those circuits ship with genuinely unwired pins and the
 * viewer is right to draw them dangling. Its ratchet may only shrink.
 *
 * @module
 */

import './_setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyse, discover, wireThroughForeignPinOf, crossingsOf } from '../scripts/schematic-audit.mjs';
import { Circuit, resetIds } from '../src/model/circuit.js';
import { projectSchematic } from '../src/model/schematic-projection.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// An EXPLICIT corpus never falls through to a different one — see the same
// rule in schematic-rendered-netlist.test.js.
const EXPLICIT_ROOT = process.env.EXAMPLES_DIR || null;
if (EXPLICIT_ROOT && !existsSync(EXPLICIT_ROOT)) {
  throw new Error(`EXAMPLES_DIR=${EXPLICIT_ROOT} does not exist. An explicitly selected `
    + 'corpus is never silently replaced by another one — fix the path or unset it.');
}
const CORPUS_ROOTS = EXPLICIT_ROOT ? [EXPLICIT_ROOT] : [
  path.resolve(here, '../../sb3-creator/examples'),
  path.resolve(here, '../../lego/brickwright-lite/overlay/scratch-gui/examples'),
  path.join(process.env.HOME || '', 'code', 'sb3-creator', 'examples'),
];
const examplesRoot = CORPUS_ROOTS.find(r => existsSync(r)) || null;

/**
 * Circuits that ship with pins on no net at all. NOT a viewer defect — the
 * projection draws a disconnected part with its shape and no connections,
 * which is the honest rendering. Recorded so the number cannot grow quietly.
 * MAY ONLY SHRINK.
 */
const KNOWN_UNCONNECTED_PINS = new Map([
  ['eater6502-full-build/circuit-flat.json', 4],  // kbd d0/d1, bargraph a0/k0 — seated on empty columns
  ['eater6502-full-build/circuit.json', 2],       // kbd d0/d1
  ['pico01-blink/circuit-flat.json', 3],          // the file has ZERO wires: 2 parts, nothing joins them
  ['pico01-blink/circuit.json', 1],               // likewise, 3 parts and no wires
]);

describe('schematic geometry across the whole shipped corpus', () => {
  const files = examplesRoot ? discover(examplesRoot) : null;
  const rows = [];
  const failedToLoad = [];
  if (files) {
    for (const f of files) {
      try { rows.push({ id: f.id, ...analyse(f.path) }); }
      catch (e) { failedToLoad.push(`${f.id}: ${String(e && e.message).slice(0, 100)}`); }
    }
  }

  const totalOf = (get) => rows.reduce((n, r) => n + get(r).length, 0);
  const circuitsWith = (get) => rows.filter(r => get(r).length > 0);
  const report = (label, get) => {
    const hit = circuitsWith(get);
    console.log(`  ${label.padEnd(46)} ${String(hit.length).padStart(5)} / ${rows.length} circuits, ${totalOf(get)} occurrences`);
    return hit;
  };

  test('corpus is present, and the whole of it was analysed', () => {
    assert.notEqual(files, null,
      `Corpus absent. Tried:\n  ${CORPUS_ROOTS.join('\n  ')}\nA gate that cannot run must `
      + 'not report green. Set EXAMPLES_DIR or clone sb3-creator beside this repo.');
    console.log(`\nCorpus: ${examplesRoot}`);
    console.log(`  discovered ${files.length}, analysed ${rows.length}, failed ${failedToLoad.length}`);
    // The measured floor. A discovery pattern that quietly stops matching
    // circuit-flat.<target>.json halves this and must fail, not pass.
    assert.ok(files.length >= 2000,
      `only ${files.length} circuit files discovered — expected the whole corpus (2,107 at audit time)`);
    assert.deepEqual(failedToLoad, [], 'every discovered circuit must project');
    assert.equal(rows.length, files.length, 'every discovered circuit must be analysed');
  });

  test('ANTI-VACUITY: the gate actually inspected geometry', () => {
    const segs = rows.reduce((n, r) => n + r.segCount, 0);
    const pins = rows.reduce((n, r) => n + r.visibleCount, 0);
    const drawn = rows.filter(r => r.segCount > 0).length;
    console.log(`\n  ${segs} drawn segments and ${pins} pins inspected across ${drawn} circuits with copper`);
    // Floors set WELL BELOW the measured values (21,006 segments / 34,340 pins
    // / 1,930 circuits at audit time), because this test's job is "the gate had
    // material to work on", nothing more. A first draft used 20,000 segments,
    // which sat BETWEEN the fixed state and the unfixed one (19,173) — so
    // reverting the router fix turned anti-vacuity red as well, and a vacuity
    // check that doubles as a defect check tells you neither thing clearly.
    assert.ok(segs > 15000, `only ${segs} segments inspected — the geometry checks are vacuous`);
    assert.ok(pins > 25000, `only ${pins} pins inspected — the geometry checks are vacuous`);
    assert.ok(drawn > 1500, `only ${drawn} circuits had any drawn copper`);
  });

  test('I: no conductor runs through a pin that is not on its net', () => {
    console.log('');
    const hit = report('I conductor through a foreign pin', r => r.wireThroughPin);
    const worst = [...hit].sort((a, b) => b.wireThroughPin.length - a.wireThroughPin.length).slice(0, 10);
    for (const r of worst) {
      const w = r.wireThroughPin[0];
      console.log(`    ${r.id}: ${r.wireThroughPin.length}, e.g. net ${w.netId} through ${w.pin} (net ${w.pinNet})`);
    }
    assert.deepEqual(hit.map(r => r.id), [],
      `${hit.length} circuit(s) draw a conductor through a foreign pin, ${totalOf(r => r.wireThroughPin)} `
      + 'incidences. A line touching a pin reads as attached to it, so the drawing asserts a '
      + 'connection the solver does not have. The router must treat foreign pins as obstacles '
      + '(segmentHitsForeignPin in schematic-projection.js), not only symbol bodies.');
  });

  test('F/G: a junction dot means connected and its absence means crossing', () => {
    const f = report('F foreign crossing carrying a junction dot', r => r.foreignCrossWithDot);
    const g = report('G same-net tee with no junction dot', r => r.sameNetTeeNoDot);
    assert.deepEqual(f.map(r => r.id), [],
      'a junction dot on a crossing between two DIFFERENT nets asserts a connection that '
      + 'does not exist — the exact opposite of what the crossing means');
    assert.deepEqual(g.map(r => r.id), [],
      'a T-branch in one net with no junction dot reads as two wires passing over each '
      + 'other — again the opposite of the truth');
  });

  test('H/J/K: one net reads as one net, and two nets read as two', () => {
    const h = report('H two trunks within 4px over a shared span', r => r.trunkOverlaps);
    const j = report('J one net under two label texts', r => r.splitLabelNets);
    const k = report('K one net as both copper and label', r => r.mixedRouting);
    assert.deepEqual(h.map(r => r.id), [], 'two trunks that close render as a single wire');
    assert.deepEqual(j.map(r => r.id), [],
      'one net drawn under two label texts reads as two nets — a false DISCONNECTION, the '
      + 'mirror of the label-collision case the rendered-netlist gate already covers');
    assert.deepEqual(k.map(r => r.id), [],
      'half a net joined by visible copper and half only by label text leaves nothing telling '
      + 'the reader the two halves are the same net');
  });

  test('D/E: every electrical part is drawn, every visible net is routed', () => {
    const d = report('D electrical part with no symbol', r => r.droppedParts);
    const e = report('E visible net with neither copper nor label', r => r.undrawnNets);
    assert.deepEqual(d.map(r => r.id), [], 'a part present in the circuit and absent from the artwork');
    assert.deepEqual(e.map(r => r.id), [],
      'a solver net with two or more DRAWN pins and no drawn path between them');
  });

  test('C: the unconnected-pin ratchet matches the corpus exactly, and may only shrink', () => {
    const hit = report('C drawn pin resolving to no net', r => r.unresolvedPins);
    const actual = new Map(hit.map(r => [r.id, r.unresolvedPins.length]));
    for (const [id, n] of actual) {
      assert.ok(KNOWN_UNCONNECTED_PINS.has(id),
        `${id} draws ${n} pin(s) on no net and is not in KNOWN_UNCONNECTED_PINS. Either the `
        + 'circuit lost its wiring or the projection stopped resolving a net. Fix the cause; '
        + 'do NOT add an entry to make this pass.');
      assert.equal(n, KNOWN_UNCONNECTED_PINS.get(id),
        `${id} now has ${n} unconnected drawn pins, recorded as ${KNOWN_UNCONNECTED_PINS.get(id)}`);
    }
    for (const id of KNOWN_UNCONNECTED_PINS.keys()) {
      assert.ok(actual.has(id),
        `${id} no longer draws an unconnected pin — its circuit was wired up. Delete the entry: `
        + 'a ratchet that keeps a fixed case starts hiding the next one.');
    }
  });

  // ── Mutation proofs for the detector this gate exists for ────────────

  /** Project a real corpus circuit, so a mutation acts on real geometry. */
  function projectOne(idFragment) {
    const f = files.find(x => x.id.includes(idFragment));
    assert.ok(f, `fixture ${idFragment} not in corpus`);
    resetIds();
    const loaded = Circuit.fromJSON(JSON.parse(readFileSync(f.path, 'utf-8')));
    return { proj: projectSchematic(loaded.parts, loaded.resolvedNets || []), path: f.path };
  }

  test('MUTATION: dragging a trunk onto a foreign pin turns class I red', () => {
    const { proj } = projectOne('46-port-overcurrent/circuit.json');
    const before = analyse(files.find(x => x.id.includes('46-port-overcurrent/circuit.json')).path);
    assert.equal(before.wireThroughPin.length, 0, 'fixture must be clean before mutation');

    // Move one trunk onto a pin of another net — the exact defect the router
    // used to produce, re-created on real geometry.
    const victim = proj.symbols.flatMap(s => s.pins).find(p => p.netId);
    const trunkWire = proj.wires.find(w => w.trunk && w.netId !== victim.netId);
    assert.ok(victim && trunkWire, 'fixture must have a pin and a foreign trunk to work with');
    const saved = { x: trunkWire.trunk.x, y1: trunkWire.trunk.y1, y2: trunkWire.trunk.y2 };
    trunkWire.trunk.x = victim.x;
    trunkWire.trunk.y1 = victim.y - 20;
    trunkWire.trunk.y2 = victim.y + 20;

    const hits = wireThroughForeignPinOf(proj);
    assert.ok(hits.length > 0,
      'moving a trunk onto a foreign pin was NOT caught — the detector is not reading geometry');

    trunkWire.trunk.x = saved.x; trunkWire.trunk.y1 = saved.y1; trunkWire.trunk.y2 = saved.y2;
    assert.equal(wireThroughForeignPinOf(proj).length, 0, 'restoring the trunk returns the drawing to clean');
  });

  /**
   * Find a corpus circuit whose projection satisfies `want`. Searching beats a
   * hard-coded fixture here: a mutation applied to geometry that has no
   * crossing (or no junction dot) proves nothing, and 01-blink — the obvious
   * fixture — has neither. Failing to find ANY such circuit is itself a
   * failure, because then the detector has never been exercised.
   */
  function findProjection(want, what) {
    for (const f of files) {
      try {
        resetIds();
        const loaded = Circuit.fromJSON(JSON.parse(readFileSync(f.path, 'utf-8')));
        const proj = projectSchematic(loaded.parts, loaded.resolvedNets || []);
        if (want(proj)) return { proj, id: f.id };
      } catch { /* another gate's problem */ }
    }
    assert.fail(`no circuit in the corpus has ${what} — the detector is never exercised, `
      + 'so its zero means nothing');
  }

  test('MUTATION: a junction dot on a foreign crossing turns class F red', () => {
    const { proj, id } = findProjection(
      p => crossingsOf(p).anyForeignCrossing, 'a crossing between two different nets');
    console.log(`\n  class F mutation fixture: ${id}`);
    assert.equal(crossingsOf(proj).foreignCrossWithDot.length, 0, 'fixture must be clean');
    const spot = crossingsOf(proj).anyForeignCrossing;
    proj.junctions.push({ x: spot.x, y: spot.y, netId: spot.a });
    assert.ok(crossingsOf(proj).foreignCrossWithDot.length > 0,
      'a junction dot placed on a crossing between two DIFFERENT nets was NOT caught — the '
      + 'detector cannot tell "connected here" from "passing over"');
    proj.junctions.pop();
    assert.equal(crossingsOf(proj).foreignCrossWithDot.length, 0, 'removing the dot returns it to clean');
  });

  test('MUTATION: removing a junction dot from a real tee turns class G red', () => {
    const { proj, id } = findProjection(
      p => p.junctions.length > 0 && crossingsOf(p).sameNetTeeNoDot.length === 0,
      'junction dots on a clean drawing');
    console.log(`  class G mutation fixture: ${id}`);
    // Remove dots one at a time: not every dot sits on a T (the two extreme
    // pins of a trunk are corners), so the proof must find one that does.
    let caught = false;
    for (let i = 0; i < proj.junctions.length && !caught; i++) {
      const [dropped] = proj.junctions.splice(i, 1);
      caught = crossingsOf(proj).sameNetTeeNoDot.length > 0;
      proj.junctions.splice(i, 0, dropped);
    }
    assert.ok(caught,
      `removing any single junction dot from ${id} left class G silent — a branch with no dot `
      + 'reads as two wires passing over each other, and the detector must say so');
    assert.equal(crossingsOf(proj).sameNetTeeNoDot.length, 0,
      'every dot restored, the drawing is clean again');
  });
});

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
 *   L  one net's conductor ENDING on another net's conductor (a T)
 *   M  two nets' conductors sharing a corner vertex
 *   N  two nets' conductors collinear within 4px over a shared span
 *   O  a terminal the solver has on a multi-pin net with NO drawn pin
 *   P  a net label's leader touching a foreign net's conductor
 *   Q  a drawn pin the symbol's OWN artwork does not reach
 *   R  a junction dot whose drawn disc (r=2.4) covers a foreign conductor
 *   S  a conductor TOUCHING a foreign symbol's own copper
 *   T  a drawn pin whose netId disagrees with the SOLVER's net
 *
 * Q, R, S and T are the third pass. Every class up to P measures
 * `projection.wires`; a symbol's own strokes are drawn by the two renderers
 * straight from schematic-symbols.js and never appear there, so no class
 * could see any of them. 403 drawn pins across 109 shipped circuits sat
 * where their symbol's artwork does not reach — `disp-sevenseg` draws a digit
 * outline with two whiskers at y=0 and lands EIGHT wires on eight points that
 * touch no copper at all. T closes a different hole: I through S all compare a
 * wire's netId with a pin's netId and BOTH are written by the projection, so
 * they are the projection checked against itself; T compares the drawn pin
 * against `resolvedNets`, which is the engine's answer.
 *
 * L, M and N are the second half of the same story class I told. The router
 * knew about symbol bodies, and (after class I) about foreign pins, and about
 * nothing else — so two nets could end on each other, share a corner, or run
 * down the SAME x. obstacleRoute derives its candidate coordinates from box
 * edges, so every net detouring round one column proposes the same x and the
 * cheapest candidate wins for all of them. Class H was aimed at exactly this
 * and read 0, because it inspects `w.trunk` wires only and every one of these
 * is a `segments` detour — and the class-I fix had just converted 799
 * circuits' trunks INTO detours. Measured over 2,098 files before the fix:
 *
 *     L  426 circuits / 3,461 incidences   (worst: arduino-05-arrays .pico, 39)
 *     M   85 circuits /   218 incidences
 *     N  426 circuits / 1,807 incidences
 *
 * O is the same blind spot in the netlist gates a third time. They restrict
 * the SOLVER side of the comparison to terminals the projection chose to draw,
 * so a terminal the projection omits leaves both sides at once and every class
 * stays green. A seated MCU ships `terminals: ["pb0"]` while its seat.leadMap
 * puts 28 leads into holes; the strips resolve vcc/avcc/gnd onto that part and
 * the drawing showed an ATtiny88 with one pin and no supply at all:
 *
 *     O  365 circuits /   763 terminals
 *
 *   P  a net label's LEADER line touching a foreign net's conductor
 *
 * P is copper's own rule applied to the stub that joins a pin to its label
 * text, which is drawn in the same stroke: it may CROSS another net and must
 * not TOUCH one. Worth recording how this one was nearly got wrong — the first
 * detector counted crossings as well and reported 578 circuits / 1,232
 * incidences, 14x the truth, which would have driven a large and pointless
 * change through the drawing. Contact only:
 *
 *     P   43 circuits /    86 incidences
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
import { analyse, discover, wireThroughForeignPinOf, crossingsOf, foreignContactOf,
  parallelMergeOf, missingPinsOf, segmentRefsOf, labelLeaderContactOf,
  orphanPinsOf, orphanLeadsOf, fatJunctionsOf, symbolContactOf,
  pinNetDisagreementOf } from '../scripts/schematic-audit.mjs';
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
  // BOTH pico01-blink entries came OFF this list on 2026-08-24. They were
  // recorded as "ZERO wires: 2 parts, nothing joins them" and "likewise, 3 parts
  // and no wires"; the files now hold 4 parts / 3 wires and 5 parts / 4 wires.
  // They were wired up upstream, the entries stopped reproducing, and the
  // ratchet said so — removed rather than re-numbered, exactly as its own
  // message asks. The second only surfaced once the first was gone, which is
  // the ordinary shape of a masked list: fix one, the next appears.
]);

/**
 * Symbol lead ends that reach no pin. NOT a defect — measured, then DISPROVED
 * as one. Every entry is a part with a terminal this circuit does not use: a
 * potentiometer wired as a rheostat (`b` left open), a slide switch using one
 * throw, a relay's armature drawn mid-swing. Drawing the unused lead is how a
 * schematic says the terminal is there and unconnected, and hiding it would be
 * the lie. Recorded per KIND so the number cannot grow quietly.
 * MAY ONLY SHRINK.
 */
const KNOWN_UNUSED_LEADS = new Map([
  // 70-calculator-simple's `pwr` is wired com + a: the second throw is spare,
  // and the SPDT drawing shows it, which is the point of drawing an SPDT.
  ['slide_switch', 24],
  // 74-ammeter / 76-multimeter / the two 555 benches wire the pot as a
  // RHEOSTAT — `a` and `wiper`, with `b` open.
  ['potentiometer', 18],
  // pc25-relay-isolator: the armature end, drawn mid-swing between contacts.
  ['relay', 2],
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

  /**
   * DO NOT READ THIS CLASS'S REVERT NUMBER AS ITS IMPORTANCE.
   *
   * `segmentHitsForeignPin` and the symbol-lead registration (class S) forbid
   * nearly the same geometry from opposite sides — a pin sits at the END of
   * its own lead — so each masks about 98% of the other's corpus evidence.
   * Measured in all four combinations by scripts/rule-isolation.mjs:
   *
   *              lead rule ON        lead rule OFF
   *   pin ON     I 0    S 0          I 0    S 7        <- shipped is top-left
   *   pin OFF    I 18   S 14         I 801  S 585
   *
   * Reverting the pin rule alone breaks 18 circuits and reverting the lead
   * rule alone breaks 7, either of which reads as "nearly dead code".
   * Reverting both breaks 801. Neither rule is redundant — each leaves a
   * remainder the other cannot see — and neither may be judged by its own
   * revert while the other stands.
   */
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

  test('L/M/N: two nets touch nowhere — they may only cross', () => {
    const l = report('L conductor tees onto a foreign conductor', r => r.foreignTees);
    const m = report('M two nets share a corner vertex', r => r.foreignCorners);
    const n = report('N two nets collinear within 4px', r => r.parallelMerge);
    assert.deepEqual(l.map(r => r.id), [],
      `${l.length} circuit(s) end one net's conductor on another net's, ${totalOf(r => r.foreignTees)} `
      + 'incidences. A T is a branch by convention — there is no reason to draw one otherwise — so '
      + 'this asserts a connection the solver denies. A proper X crossing with no dot is fine and is '
      + 'not counted here; only TOUCHING is. See segmentTouchesForeignConductor in schematic-projection.js.');
    assert.deepEqual(m.map(r => r.id), [],
      'two nets whose conductors end at the same vertex read as one wire turning a corner');
    assert.deepEqual(n.map(r => r.id), [],
      `${n.length} circuit(s) draw two different nets collinear within 4px, `
      + `${totalOf(r => r.parallelMerge)} incidences. Two lines that close are one line to a reader. `
      + 'This is class H generalised off `w.trunk` and onto both axes, which is where it was blind.');
  });

  test('O: every terminal the solver connects has a pin to connect to', () => {
    const o = report('O connected terminal with no drawn pin', r => r.missingPins);
    for (const r of [...o].sort((a, b) => b.missingPins.length - a.missingPins.length).slice(0, 10)) {
      console.log(`    ${r.id}: ${r.missingPins.map(x => x.terminal).join(' ')}`);
    }
    assert.deepEqual(o.map(r => r.id), [],
      `${o.length} circuit(s) leave ${totalOf(r => r.missingPins)} solver-connected terminal(s) with no `
      + 'drawn pin. The part is drawn, the net has two or more terminals on drawn parts, and one of '
      + 'them has nowhere to attach — so the drawing silently omits a connection the circuit has. '
      + 'The projection must take its terminal list from the declared list UNIONED with what the '
      + 'resolved nets attribute to the part (declaredAndWired), not the declared list alone.');
  });

  test('P: a label leader may cross a foreign net, never touch one', () => {
    const p = report('P label leader touching a foreign conductor', r => r.leaderContact);
    assert.deepEqual(p.map(r => r.id), [],
      `${p.length} circuit(s) draw a net label's leader touching another net's conductor, `
      + `${totalOf(r => r.leaderContact)} incidences. The leader is drawn in the same stroke as `
      + 'copper, so a wire ending on it reads as connected to that label\'s net. labelPin shortens '
      + 'the leader until it is clear and registers it as a conductor so later routes avoid it.');
  });


  test('Q: every drawn pin has the symbol\'s own copper to meet', () => {
    const q = report('Q drawn pin the symbol art does not reach', r => r.orphanPins);
    for (const r of [...q].sort((a, b) => b.orphanPins.length - a.orphanPins.length).slice(0, 10)) {
      console.log(`    ${r.id}: ${r.orphanPins.length}, e.g. ${r.orphanPins[0].kind} ${r.orphanPins[0].pin}`);
    }
    assert.deepEqual(q.map(r => r.id), [],
      `${q.length} circuit(s) draw ${totalOf(r => r.orphanPins)} pin(s) where the symbol's own `
      + 'artwork does not reach. The wire arrives and there is nothing there to arrive at — a wire '
      + 'ending in blank space beside the part. A symbol description carries its leads at FIXED '
      + 'local coordinates while the projection places pins on its own grid, and the two coincide '
      + 'only for a two-terminal part with leads at y=0 or where the art declares `anchors`. '
      + 'Artwork must be used only when it reaches every pin (artReachesPins in '
      + 'schematic-symbols.js); the labelled generic box draws a lead to every pin by construction.');
  });

  test('Q2: the unused-lead ratchet matches the corpus by kind, and may only shrink', () => {
    const q2 = report('Q2 symbol lead reaching no pin', r => r.orphanLeads);
    const byKind = new Map();
    for (const r of q2) for (const o of r.orphanLeads) byKind.set(o.kind, (byKind.get(o.kind) || 0) + 1);
    for (const [kind, n] of byKind) {
      assert.ok(KNOWN_UNUSED_LEADS.has(kind),
        `${kind} draws ${n} lead(s) reaching no pin and is not in KNOWN_UNUSED_LEADS. Either the `
        + 'symbol acquired a lead its pins cannot reach, or a kind started falling back to art '
        + 'that does not fit it. Fix the cause; do NOT add an entry to make this pass.');
      assert.equal(n, KNOWN_UNUSED_LEADS.get(kind),
        `${kind} now leaves ${n} lead(s) unreached, recorded as ${KNOWN_UNUSED_LEADS.get(kind)}`);
    }
    for (const kind of KNOWN_UNUSED_LEADS.keys()) {
      assert.ok(byKind.has(kind),
        `${kind} no longer leaves a lead unreached. Delete the entry: a ratchet that keeps a `
        + 'fixed case starts hiding the next one.');
    }
  });

  test('R/S: a symbol\'s own copper is copper, and a dot is as wide as it is drawn', () => {
    const r_ = report('R junction dot disc covering foreign copper', r => r.fatJunctions);
    const s_ = report('S conductor touching foreign symbol copper', r => r.symbolContact);
    assert.deepEqual(r_.map(r => r.id), [],
      `${r_.length} circuit(s) draw a junction dot whose DISC covers another net's conductor. `
      + 'Class F asks whether a dot sits exactly on a foreign meet; the dot is drawn r=2.4 '
      + '(schematic-svg.js), wider than the 2px pin clearance and three times the 0.75px contact '
      + 'tolerance, so a dot 2px from foreign copper is a filled blob touching it.');
    assert.deepEqual(s_.map(r => r.id), [],
      `${s_.length} circuit(s) end a conductor on a foreign symbol's own copper, `
      + `${totalOf(r => r.symbolContact)} incidences. This is class L against SYMBOL strokes `
      + 'instead of wires: the router avoided body boxes and foreign pins and knew nothing about '
      + 'a symbol\'s leads, so a route could end on one — 74-ammeter drew a potentiometer whose '
      + 'unconnected `b` lead ends at (300,163) with another net\'s wire ending on that point. '
      + 'The projection registers every lead that leaves the body box as a conductor.');
  });

  test('T: a drawn pin carries the net the SOLVER puts that terminal on', () => {
    const t = report('T drawn pin netId disagrees with the solver', r => r.pinNetDisagreement);
    assert.deepEqual(t.map(r => r.id), [],
      `${t.length} circuit(s) draw a pin whose netId is not the net resolvedNets puts that `
      + 'terminal on. Every class from I to S compares a wire\'s netId with a pin\'s netId and '
      + 'BOTH are written by the projection — that is the projection checked against itself, and '
      + 'a systematically wrong pin.netId would leave all of them green. This one compares the '
      + 'drawn pin against the engine\'s answer.');
  });

  // ── Mutation proofs for the detector this gate exists for ────────────

  /** Project a real corpus circuit, so a mutation acts on real geometry. */
  function projectOne(idFragment) {
    const f = files.find(x => x.id.includes(idFragment));
    assert.ok(f, `fixture ${idFragment} not in corpus`);
    resetIds();
    const loaded = Circuit.fromJSON(JSON.parse(readFileSync(f.path, 'utf-8')));
    return { proj: projectSchematic(loaded.parts, loaded.resolvedNets || []), path: f.path, loaded };
  }

  /**
   * A REAL proper crossing between two different nets, with the live segment
   * objects, so an L/M mutation can shorten a conductor until it TOUCHES the
   * one it used to cross — turning a legitimate crossing into a false
   * connection without inventing a single coordinate.
   */
  function findForeignCrossing() {
    const near = (a, b) => Math.abs(a - b) < 0.75;
    const inside = (v, p, q) => v > Math.min(p, q) + 0.75 && v < Math.max(p, q) - 0.75;
    for (const f of files) {
      try {
        resetIds();
        const loaded = Circuit.fromJSON(JSON.parse(readFileSync(f.path, 'utf-8')));
        const proj = projectSchematic(loaded.parts, loaded.resolvedNets || []);
        const segs = segmentRefsOf(proj);
        const hs = segs.filter(x => near(x.a.y, x.b.y) && !near(x.a.x, x.b.x));
        const vs = segs.filter(x => near(x.a.x, x.b.x) && !near(x.a.y, x.b.y));
        for (const h of hs) {
          for (const v of vs) {
            if (h.netId === v.netId) continue;
            if (inside(v.a.x, h.a.x, h.b.x) && inside(h.a.y, v.a.y, v.b.y)) {
              return { proj, id: f.id, h, v };
            }
          }
        }
      } catch { /* another gate's problem */ }
    }
    assert.fail('no circuit in the corpus has two different nets properly crossing — the L/M '
      + 'detectors are never exercised, so their zero means nothing');
  }

  test('MUTATION: shortening one net onto another turns class L red', () => {
    const { proj, id, h, v } = findForeignCrossing();
    console.log(`\n  class L mutation fixture: ${id}`);
    assert.equal(foreignContactOf(proj).tees.length, 0, 'fixture must be clean before mutation');
    // The crossing is interior to h. Pull h's far end back to the crossing and
    // the X becomes a T: h now ENDS on v, which reads as h tapping into v.
    const savedX = h.b.x;
    h.b.x = v.a.x;
    assert.ok(foreignContactOf(proj).tees.length > 0,
      `ending one net's conductor on another net's was NOT caught in ${id} — the detector cannot `
      + 'tell a branch from a crossing, which is the one distinction a schematic exists to make');
    h.b.x = savedX;
    assert.equal(foreignContactOf(proj).tees.length, 0, 'restoring the conductor returns it to clean');
  });

  test('MUTATION: two nets meeting at one vertex turns class M red', () => {
    const { proj, id, h, v } = findForeignCrossing();
    console.log(`  class M mutation fixture: ${id}`);
    assert.equal(foreignContactOf(proj).corners.length, 0, 'fixture must be clean before mutation');
    const saved = { hx: h.b.x, vy: v.b.y };
    h.b.x = v.a.x;   // both conductors now END at (v.a.x, h.a.y)
    v.b.y = h.a.y;
    assert.ok(foreignContactOf(proj).corners.length > 0,
      `two nets ending at the same vertex was NOT caught in ${id} — a reader sees one wire `
      + 'turning a corner');
    h.b.x = saved.hx; v.b.y = saved.vy;
    assert.equal(foreignContactOf(proj).corners.length, 0, 'restored');
  });

  test('MUTATION: sliding one net onto another\'s x turns class N red', () => {
    const near = (a, b) => Math.abs(a - b) < 0.75;
    const { proj, id } = findProjection(p => {
      const vs = segmentRefsOf(p).filter(x => near(x.a.x, x.b.x) && Math.abs(x.a.y - x.b.y) > 20);
      return vs.some(a => vs.some(b => b.netId !== a.netId &&
        Math.min(Math.max(a.a.y, a.b.y), Math.max(b.a.y, b.b.y)) -
        Math.max(Math.min(a.a.y, a.b.y), Math.min(b.a.y, b.b.y)) > 8));
    }, 'two different nets running vertically over a shared span');
    console.log(`  class N mutation fixture: ${id}`);
    assert.equal(parallelMergeOf(proj).length, 0, 'fixture must be clean before mutation');
    const vs = segmentRefsOf(proj).filter(x => near(x.a.x, x.b.x) && Math.abs(x.a.y - x.b.y) > 20);
    const a = vs.find(x => vs.some(y => y.netId !== x.netId &&
      Math.min(Math.max(x.a.y, x.b.y), Math.max(y.a.y, y.b.y)) -
      Math.max(Math.min(x.a.y, x.b.y), Math.min(y.a.y, y.b.y)) > 8));
    const b = vs.find(y => y.netId !== a.netId &&
      Math.min(Math.max(a.a.y, a.b.y), Math.max(y.a.y, y.b.y)) -
      Math.max(Math.min(a.a.y, a.b.y), Math.min(y.a.y, y.b.y)) > 8);
    const saved = { x1: b.a.x, x2: b.b.x };
    b.a.x = a.a.x; b.b.x = a.a.x;      // two nets, one line
    assert.ok(parallelMergeOf(proj).length > 0,
      `two nets slid onto the same x over a shared span were NOT caught in ${id} — they render `
      + 'as a single wire and the reader has no way to know there are two');
    b.a.x = saved.x1; b.b.x = saved.x2;
    assert.equal(parallelMergeOf(proj).length, 0, 'restored');
  });

  test('MUTATION: stretching a label leader onto a foreign net turns class P red', () => {
    const near = (a, b) => Math.abs(a - b) < 0.75;
    // A circuit that has BOTH labels and copper — a drawing that is all labels
    // has no foreign conductor for a leader to reach, so it proves nothing.
    const { proj, id } = findProjection(
      p => (p.netLabels || []).length > 0 && (p.wires || []).length > 0,
      'a drawing carrying both net labels and drawn copper');
    console.log(`  class P mutation fixture: ${id}`);
    assert.equal(labelLeaderContactOf(proj).length, 0, 'fixture must be clean before mutation');
    // Stretch one leader until its far end lands on a foreign conductor.
    const segs = segmentRefsOf(proj).filter(x => near(x.a.x, x.b.x));
    let caught = false, victim = null, saved = null;
    for (const l of proj.netLabels) {
      if (!near(l.y1, l.y2)) continue;
      const target = segs.find(v => v.netId !== l.netId &&
        l.y1 >= Math.min(v.a.y, v.b.y) && l.y1 <= Math.max(v.a.y, v.b.y));
      if (!target) continue;
      victim = l; saved = l.x2;
      l.x2 = target.a.x;                       // the leader now ENDS on that net
      caught = labelLeaderContactOf(proj).length > 0;
      if (caught) break;
      l.x2 = saved; victim = null;
    }
    assert.ok(caught,
      `no leader in ${id} could be stretched onto a foreign conductor, so class P was never `
      + 'exercised — its zero would mean nothing');
    victim.x2 = saved;
    assert.equal(labelLeaderContactOf(proj).length, 0, 'restoring the leader returns it to clean');
  });

  test('MUTATION: deleting a connected pin turns class O red', () => {
    const { proj, loaded, path: fixture } = projectOne('01-blink/circuit.attiny88.json');
    const nets = loaded.resolvedNets || [];
    assert.equal(missingPinsOf(proj, nets, loaded.parts).length, 0,
      `${fixture} must be clean before mutation`);
    // Drop one drawn pin whose net the solver shares with another drawn pin —
    // exactly what the declared-terminals-only projection used to do to the
    // MCU's vcc, avcc and gnd.
    const sym = proj.symbols.find(s => s.pins.length > 1 && s.pins.some(p => p.netId));
    const idx = sym.pins.findIndex(p => p.netId);
    const [dropped] = sym.pins.splice(idx, 1);
    const hits = missingPinsOf(proj, nets, loaded.parts);
    assert.ok(hits.length > 0,
      `deleting the drawn pin for ${sym.id}:${dropped.name} was NOT caught — the detector is `
      + 'reading the projection back to itself instead of comparing it against the solver');
    sym.pins.splice(idx, 0, dropped);
    assert.equal(missingPinsOf(proj, nets, loaded.parts).length, 0, 'restored');
  });

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

  test('MUTATION: moving a pin off its symbol\'s copper turns class Q red', () => {
    // A symbol with ART, not the generic box: the box draws a lead to wherever
    // the pin is, so moving a pin on one proves nothing about the class.
    const { proj, id } = findProjection(
      p => p.symbols.some(s => !s.generic && (s.pins || []).length > 0),
      'a symbol drawn with its own artwork');
    console.log(`\n  class Q mutation fixture: ${id}`);
    assert.equal(orphanPinsOf(proj).length, 0, 'fixture must be clean before mutation');
    const sym = proj.symbols.find(s => !s.generic && (s.pins || []).length > 0);
    const pin = sym.pins[0];
    const saved = pin.y;
    pin.y += 23;                       // one PIN_PITCH-ish off the lead
    assert.ok(orphanPinsOf(proj).length > 0,
      `sliding ${sym.kind}:${pin.name} off its own lead in ${id} was NOT caught — the detector `
      + 'is not reading the symbol\'s artwork, and the 403 pins this class found would have '
      + 'stayed invisible');
    pin.y = saved;
    assert.equal(orphanPinsOf(proj).length, 0, 'restored');
  });

  test('MUTATION: a symbol whose art cannot host its pins must fall back to the box', () => {
    // The FIX, proved on the corpus rather than asserted: the seven-segment
    // digit outline has two whiskers at y=0 and the part has eight terminals,
    // so no placement of eight pins can land on it and the projection must
    // choose the labelled box. If it ever chooses the art again, class Q
    // returns — this catches that at the decision instead of at the geometry.
    const { proj, id } = findProjection(
      p => p.symbols.some(s => /^seven_seg/.test(s.kind) && (s.pins || []).length > 2),
      'a seven-segment display with more than two connected terminals');
    console.log(`  seven-segment fallback fixture: ${id}`);
    const sym = proj.symbols.find(s => /^seven_seg/.test(s.kind) && (s.pins || []).length > 2);
    assert.equal(sym.generic, true,
      `${id} draws ${sym.kind} with ${sym.pins.length} pins using its artwork, which reaches `
      + 'only (±30, 0). Every other pin lands in blank space.');
    // And the box really does reach them all.
    assert.equal(orphanPinsOf(proj).length, 0, 'the box must reach every pin it draws');
  });

  test('MUTATION: fattening a junction dot onto foreign copper turns class R red', () => {
    const { proj, id } = findProjection(
      p => (p.junctions || []).length > 0 && segmentRefsOf(p).length > 4,
      'a drawing with junction dots and copper');
    console.log(`  class R mutation fixture: ${id}`);
    assert.equal(fatJunctionsOf(proj).length, 0, 'fixture must be clean before mutation');
    // Move one dot to 2px off a foreign conductor: inside the drawn r=2.4 disc
    // and outside the 0.75px contact tolerance, which is exactly the gap
    // between "class F is silent" and "the reader sees a blob on that wire".
    const dot = proj.junctions[0];
    const own = new Set(proj.wires.filter(w => (w.segments || []).some(
      ([a, b]) => Math.abs(a.x - dot.x) < 1 && Math.abs(a.y - dot.y) < 1)).map(w => w.netId));
    const target = segmentRefsOf(proj).find(v => !own.has(v.netId) && Math.abs(v.a.x - v.b.x) < 0.75);
    assert.ok(target, `${id} has no foreign vertical conductor to move a dot beside`);
    const saved = { x: dot.x, y: dot.y };
    dot.x = target.a.x + 2;
    dot.y = (Math.min(target.a.y, target.b.y) + Math.max(target.a.y, target.b.y)) / 2;
    assert.ok(fatJunctionsOf(proj).length > 0,
      `a junction dot placed 2px from a foreign conductor in ${id} was NOT caught — class F only `
      + 'looks for an exact coincidence, and the dot is drawn three times wider than that');
    dot.x = saved.x; dot.y = saved.y;
    assert.equal(fatJunctionsOf(proj).length, 0, 'restored');
  });

  test('MUTATION: ending a wire on a foreign symbol\'s lead turns class S red', () => {
    const { proj, id } = findProjection(
      p => p.symbols.some(s => (s.pins || []).length > 0) && (p.wires || []).some(w => w.segments),
      'a drawing with symbols and detour-routed copper');
    console.log(`  class S mutation fixture: ${id}`);
    assert.equal(symbolContactOf(proj).length, 0, 'fixture must be clean before mutation');
    // End one net's conductor exactly on ANOTHER symbol's pin-lead — the
    // 74-ammeter shape, re-created on real geometry.
    const wire = proj.wires.find(w => w.segments && w.segments.length);
    const victim = proj.symbols.find(s => (s.pins || []).length &&
      !s.pins.some(p => p.netId === wire.netId));
    assert.ok(victim, `${id} has no symbol foreign to a routed net`);
    const pin = victim.pins[0];
    const seg = wire.segments[wire.segments.length - 1];
    const saved = { x: seg[1].x, y: seg[1].y };
    // 2px inboard of the pin, ON the lead and NOT on the pin, so this proves
    // class S and not class I.
    seg[1].x = pin.x + (pin.side === 'left' ? 2 : -2);
    seg[1].y = pin.y;
    assert.ok(symbolContactOf(proj).length > 0,
      `ending a conductor on ${victim.kind}:${pin.name}'s own lead in ${id} was NOT caught — a `
      + 'symbol\'s strokes never appear in projection.wires, so every class up to P is blind to '
      + 'them, and 7 shipped circuits did exactly this');
    seg[1].x = saved.x; seg[1].y = saved.y;
    assert.equal(symbolContactOf(proj).length, 0, 'restored');
  });

  test('MUTATION: relabelling a pin\'s net turns class T red', () => {
    const { proj, loaded, path: fixture } = projectOne('46-port-overcurrent/circuit.json');
    const nets = loaded.resolvedNets || [];
    assert.equal(pinNetDisagreementOf(proj, nets).length, 0,
      `${fixture} must be clean before mutation`);
    const sym = proj.symbols.find(s => (s.pins || []).some(p => p.netId));
    const pin = sym.pins.find(p => p.netId);
    const saved = pin.netId;
    pin.netId = 'not-a-net';
    assert.ok(pinNetDisagreementOf(proj, nets).length > 0,
      'a drawn pin carrying a net the solver does not put that terminal on was NOT caught — '
      + 'then every class that compares one projection netId with another is comparing the '
      + 'projection with itself');
    pin.netId = saved;
    assert.equal(pinNetDisagreementOf(proj, nets).length, 0, 'restored');
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

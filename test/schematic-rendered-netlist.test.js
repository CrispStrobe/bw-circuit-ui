/**
 * RENDERED-NETLIST CORRESPONDENCE GATE
 *
 * Sibling gate to schematic-electrical-correspondence.test.js, closing the
 * gap that one structurally cannot see.
 *
 * === Why a second gate ===
 *
 * The correspondence gate derives the schematic's connectivity from
 * `pin.netId`. But `projectSchematic` sets `pin.netId = findPinNet(nets,…)`
 * — it COPIES the solver's net id onto the pin. Two pins therefore share a
 * projected net id if and only if they share a solver net, so that gate's
 * SOUNDNESS direction is very nearly a tautology and cannot fail on a
 * rendering defect.
 *
 * This gate never reads `pin.netId`. It reconstructs the netlist a READER
 * infers from the drawn artwork, which is what the invariant is actually
 * about.
 *
 * === The invariant ===
 *
 * Let VISIBLE be the drawn pins of non-infrastructure symbols.
 *
 * RENDERED partition R — two visible pins are connected iff the artwork
 * says so, by exactly the two mechanisms the renderer uses:
 *
 *   (a) DRAWN COPPER. A trunk route joins every pin its stubs land on; an
 *       obstacle-routed polyline joins its two endpoints. Derived from
 *       segment/stub geometry, matched to pins by coordinate.
 *
 *   (b) REPEATED NET LABELS. When a net is too dense to draw (`labelledRouting`)
 *       or its trunk collides with a symbol, the renderer falls back to
 *       labelled stubs. That is standard schematic convention: same label
 *       text = same net. So label text ties pins together, and the text is
 *       the ONLY connectivity a reader has for those pins.
 *
 * SOLVER partition S — two terminals are connected iff they share a
 * resolved net.
 *
 * "Equal" means R and S induce the same partition on VISIBLE.
 *
 *   SOUNDNESS    R-connected ⟹ S-connected. The artwork must never invent a
 *                connection. This is the direction with teeth here.
 *   COMPLETENESS S-connected ⟹ R-connected, modulo the documented gaps
 *                (a terminal the projection never draws cannot be joined).
 *
 * === What "equal" means for the renderer's legitimate devices ===
 *
 *   Repeated net labels for ONE net: correct, and expected — that is the
 *     convention. Not a divergence.
 *   Repeated net labels across TWO nets: a divergence. The reader cannot
 *     distinguish them, so the artwork asserts a connection the solver does
 *     not have. Enforced as label injectivity below.
 *   Breadboard strips: infrastructure, excluded on BOTH sides. A strip is
 *     not a symbol; its job is to put terminals in a common net, which the
 *     solver side already reflects.
 *   Implicit ground: the projection may add a synthetic `__implicit_gnd__`
 *     symbol with no solver counterpart. Excluded — it is a reference
 *     marker, not a claimed connection.
 *
 * === Known conservatism, stated rather than hidden ===
 *
 * Terminal keys are lowercased on both sides, because `findPinNet` matches
 * case-insensitively. Where a circuit has the case-split-net defect, this
 * makes the SOLVER partition COARSER than the solver truly is. A coarser S
 * can only SUPPRESS soundness findings, never invent one, so this gate
 * under-reports rather than false-alarms.
 *
 * @module
 */

import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, resetIds } from '../src/model/circuit.js';
import { projectSchematic } from '../src/model/schematic-projection.js';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const INFRA_KINDS = new Set([
  'breadboard', 'breadboard_full', 'breadboard_half', 'breadboard_mini', 'meter',
]);

const tKey = (part, terminal) => `${part}:${String(terminal).toLowerCase()}`;
const IMPLICIT_GND = '__implicit_gnd__';

class UF {
  constructor() { this.parent = new Map(); }
  find(x) {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let r = x;
    while (this.parent.get(r) !== r) r = this.parent.get(r);
    while (this.parent.get(x) !== r) { const n = this.parent.get(x); this.parent.set(x, r); x = n; }
    return r;
  }
  union(a, b) { const ra = this.find(a), rb = this.find(b); if (ra !== rb) this.parent.set(ra, rb); }
  same(a, b) { return this.find(a) === this.find(b); }
  has(x) { return this.parent.has(x); }
  groups() {
    const g = new Map();
    for (const k of this.parent.keys()) {
      const r = this.find(k);
      if (!g.has(r)) g.set(r, new Set());
      g.get(r).add(k);
    }
    return [...g.values()].filter(s => s.size >= 2);
  }
}

/** Coordinate index of every drawn, non-infrastructure pin. */
function pinIndex(projection) {
  const byCoord = new Map(); // "x,y" → [tKey]
  const visible = new Set();
  for (const sym of projection.symbols) {
    if (INFRA_KINDS.has(sym.kind)) continue;
    if (sym.id === IMPLICIT_GND) continue;
    for (const pin of sym.pins) {
      const k = tKey(sym.id, pin.name);
      visible.add(k);
      const c = `${Math.round(pin.x)},${Math.round(pin.y)}`;
      if (!byCoord.has(c)) byCoord.set(c, []);
      byCoord.get(c).push(k);
    }
  }
  return { byCoord, visible };
}

/**
 * Connectivity a reader infers from the ARTWORK — drawn copper plus
 * repeated net labels. Never consults pin.netId.
 */
function renderedUF(projection) {
  const { byCoord } = pinIndex(projection);
  const uf = new UF();
  const at = (x, y) => byCoord.get(`${Math.round(x)},${Math.round(y)}`) || [];

  // (a) Drawn copper.
  for (const w of projection.wires) {
    const touched = [];
    // ONLY the pin-side endpoint of a conductor is a connection. The
    // trunk-side endpoint and every intermediate vertex sit in free space:
    // resolving pins there unions any pin a trunk merely PASSES THROUGH,
    // which fabricates connections between adjacent DIP pins. That artifact
    // produced a 21-circuit false soundness report on first run.
    if (w.stubs) {
      // stubs[i] = [{pin}, {trunk}] — index 0 only.
      for (const seg of w.stubs) if (seg.length) touched.push(...at(seg[0].x, seg[0].y));
    }
    if (w.segments && w.segments.length) {
      // obstacleRoute polyline: joins its two ENDS, pins[0] and pins[1].
      const first = w.segments[0];
      const last = w.segments[w.segments.length - 1];
      if (first.length) touched.push(...at(first[0].x, first[0].y));
      if (last.length) touched.push(...at(last[last.length - 1].x, last[last.length - 1].y));
    }
    const uniq = [...new Set(touched)];
    for (let i = 1; i < uniq.length; i++) uf.union(uniq[0], uniq[i]);
  }

  // (b) Repeated net labels — same text, same net, by convention.
  const byText = new Map();
  for (const l of projection.netLabels) {
    const pins = at(l.x1, l.y1);
    if (!byText.has(l.text)) byText.set(l.text, []);
    byText.get(l.text).push(...pins);
  }
  for (const pins of byText.values()) {
    const uniq = [...new Set(pins)];
    for (let i = 1; i < uniq.length; i++) uf.union(uniq[0], uniq[i]);
  }
  return uf;
}

/** Solver partition over visible pins. */
function solverUF(resolvedNets, parts, visible) {
  const infra = new Set(parts.filter(p => INFRA_KINDS.has(p.kind)).map(p => p.id));
  const uf = new UF();
  for (const net of resolvedNets) {
    const members = [...new Set(net.terminals
      .filter(t => !infra.has(t.part))
      .map(t => tKey(t.part, t.terminal))
      .filter(k => visible.has(k)))];
    for (let i = 1; i < members.length; i++) uf.union(members[0], members[i]);
  }
  return uf;
}

/**
 * Distinct solver nets that the artwork renders under one label text.
 * A reader cannot tell them apart, so the artwork asserts a connection.
 */
function labelCollisions(projection) {
  const byText = new Map();
  for (const l of projection.netLabels) {
    if (!byText.has(l.text)) byText.set(l.text, new Set());
    byText.get(l.text).add(l.netId);
  }
  return [...byText].filter(([, nets]) => nets.size > 1)
    .map(([text, nets]) => ({ text, netIds: [...nets] }));
}

/** Terminals the projection never draws — cannot be joined by artwork. */
function undrawnTerminals(parts, resolvedNets, visible) {
  const gaps = new Set();
  const infra = new Set(parts.filter(p => INFRA_KINDS.has(p.kind)).map(p => p.id));
  for (const net of resolvedNets) {
    for (const t of net.terminals) {
      if (infra.has(t.part)) continue;
      const k = tKey(t.part, t.terminal);
      if (!visible.has(k)) gaps.add(k);
    }
  }
  return gaps;
}

function analyse(resolvedNets, parts, projection) {
  const { visible } = pinIndex(projection);
  const ruf = renderedUF(projection);
  const suf = solverUF(resolvedNets, parts, visible);

  const invents = [];   // artwork connects, solver does not
  const drops = [];     // solver connects, artwork does not
  for (const group of ruf.groups()) {
    const m = [...group];
    for (let i = 0; i < m.length; i++) for (let j = i + 1; j < m.length; j++) {
      if (!suf.has(m[i]) || !suf.has(m[j]) || !suf.same(m[i], m[j])) invents.push([m[i], m[j]]);
    }
  }
  for (const group of suf.groups()) {
    const m = [...group];
    for (let i = 0; i < m.length; i++) for (let j = i + 1; j < m.length; j++) {
      if (!ruf.has(m[i]) || !ruf.has(m[j]) || !ruf.same(m[i], m[j])) drops.push([m[i], m[j]]);
    }
  }
  // Pairs actually compared. A gate reporting "0 failures" while comparing
  // nothing is the most expensive kind of green.
  let renderedPairs = 0;
  for (const g of ruf.groups()) renderedPairs += (g.size * (g.size - 1)) / 2;
  return { invents, drops, collisions: labelCollisions(projection),
    visibleCount: visible.size, renderedPairs };
}

// ── Corpus ──────────────────────────────────────────────────────

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * The corpus is cross-repo. It is byte-identical in sb3-creator and in
 * brickwright-lite (verified 2026-08-23: both the file-name list and the
 * concatenated contents hash the same across all 1,034 variants), so the
 * gate resolves whichever sibling is present. CI already clones
 * sb3-creator, which is why this gate can run there; cloning lite would
 * cost ~1.1 GB.
 */
const CORPUS_ROOTS = [
  process.env.EXAMPLES_DIR,
  path.resolve(here, '../../sb3-creator/examples'),
  path.resolve(here, '../../lego/brickwright-lite/overlay/scratch-gui/examples'),
  path.join(process.env.HOME || '', 'code', 'sb3-creator', 'examples'),
].filter(Boolean);

const examplesRoot = CORPUS_ROOTS.find(r => existsSync(r)) || null;

function discoverVariants() {
  if (!examplesRoot) return null; // null = corpus absent, distinct from empty
  const variants = [];
  for (const dir of readdirSync(examplesRoot, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const dirPath = path.join(examplesRoot, dir.name);
    for (const file of readdirSync(dirPath)) {
      if (/^circuit(?:\.[^.]+)*\.json$/i.test(file)) {
        variants.push({ id: `${dir.name}/${file}`, path: path.join(dirPath, file) });
      }
    }
  }
  return variants.sort((a, b) => a.id.localeCompare(b.id));
}

const variants = discoverVariants();

/**
 * Cross-repo corpus. ROADMAP §5: a gate that silently skips when its inputs
 * are absent reports as a pass forever. This one FAILS instead, loudly.
 */
test('corpus is present and complete (cross-repo gate must not silently skip)', () => {
  console.log(`\nCorpus root: ${examplesRoot}`);
  assert.notEqual(variants, null,
    `Corpus absent. Tried:\n  ${CORPUS_ROOTS.join('\n  ')}\n` +
    `A missing sibling checkout is a FAILURE, not a skip — a gate that cannot run ` +
    `must not report green (ROADMAP §5). Set EXAMPLES_DIR or clone sb3-creator.`);
  assert.ok(variants.length >= 1000, `Expected >=1000 variants, found ${variants.length}`);
});

function runCorpus() {
  const rows = [];
  const loadErrors = [];
  for (const v of variants) {
    let data;
    try { data = JSON.parse(readFileSync(v.path, 'utf-8')); }
    catch (e) { loadErrors.push({ id: v.id, why: `parse: ${e.message}` }); continue; }
    try {
      resetIds();
      const loaded = Circuit.fromJSON(data);
      const nets = loaded.resolvedNets || [];
      const proj = projectSchematic(loaded.parts, nets);
      rows.push({ id: v.id, ...analyse(nets, loaded.parts, proj) });
    } catch (e) { loadErrors.push({ id: v.id, why: `project: ${e.message}` }); }
  }
  return { rows, loadErrors };
}

const corpus = variants && variants.length ? runCorpus() : { rows: [], loadErrors: [] };

/**
 * Coverage is asserted, not assumed. An analysis that silently drops
 * circuits reports a clean corpus it never looked at.
 */
test('coverage: every discovered variant was analysed, none silently dropped', () => {
  const { rows, loadErrors } = corpus;
  console.log(`\n=== Rendered-netlist gate coverage ===`);
  console.log(`  discovered : ${variants.length}`);
  console.log(`  analysed   : ${rows.length}`);
  console.log(`  errored    : ${loadErrors.length}`);
  for (const e of loadErrors.slice(0, 10)) console.log(`    ${e.id} — ${e.why}`);
  assert.equal(rows.length + loadErrors.length, variants.length, 'accounting must balance');
  assert.equal(loadErrors.length, 0,
    `${loadErrors.length} variant(s) could not be analysed — coverage would be silently capped`);
});

/**
 * The finding this gate exists for. When connectivity is carried by label
 * text, the text must identify the net uniquely.
 */
test('net labels are injective: one label text never spans two solver nets', () => {
  const offenders = corpus.rows.filter(r => r.collisions.length > 0);
  if (offenders.length) {
    console.log(`\nLABEL COLLISIONS (${offenders.length} circuit(s)):`);
    for (const o of offenders) {
      for (const c of o.collisions) {
        console.log(`  ${o.id}: label "${c.text}" is drawn for ${c.netIds.length} distinct nets: ${c.netIds.join(' , ')}`);
      }
    }
  }
  assert.equal(offenders.length, 0,
    `${offenders.length} circuit(s) render two distinct solver nets under one label text — ` +
    `the artwork asserts a connection the solver does not have`);
});

test('SOUNDNESS: the rendered artwork never invents a connection', () => {
  const offenders = corpus.rows.filter(r => r.invents.length > 0);
  console.log(`\nSoundness: ${corpus.rows.length} circuits analysed, ${offenders.length} with invented connections`);
  for (const o of offenders.slice(0, 10)) {
    console.log(`  ${o.id}:`);
    for (const [a, b] of o.invents.slice(0, 4)) console.log(`    artwork joins ${a} <-> ${b}; solver does not`);
  }
  assert.equal(offenders.length, 0,
    `${offenders.length} circuit(s) draw a connection the solver does not have`);
});

test('COMPLETENESS: report solver connections the artwork does not draw', () => {
  const withDrops = corpus.rows.filter(r => r.drops.length > 0);
  const totalDrops = corpus.rows.reduce((n, r) => n + r.drops.length, 0);
  console.log(`\nCompleteness: ${withDrops.length} circuit(s) with undrawn solver connections, ${totalDrops} pairs total`);
  for (const o of withDrops.slice(0, 10)) {
    console.log(`  ${o.id}: ${o.drops.length} pairs, e.g. ${o.drops[0][0]} <-> ${o.drops[0][1]}`);
  }
  // Reported, not asserted-zero: see the documented gap classes in
  // ELECTRICAL-CORRESPONDENCE-REPORT.md. Asserted below in mutation form.
  assert.ok(true);
});

// ── Anti-vacuity and mutation proofs ────────────────────────────

/**
 * The prior gate's SOUNDNESS direction is near-tautological because
 * projectSchematic copies the solver's net id onto every pin. This gate
 * must actually be comparing something.
 */
test('ANTI-VACUITY: the gate compares a substantial number of real pairs', () => {
  const pairs = corpus.rows.reduce((n, r) => n + r.renderedPairs, 0);
  const withArtwork = corpus.rows.filter(r => r.renderedPairs > 0).length;
  console.log(`\nAnti-vacuity: ${pairs} rendered pairs compared across ${withArtwork} circuits`);
  assert.ok(pairs > 5000, `only ${pairs} pairs compared — gate is vacuous`);
  assert.ok(withArtwork > 900, `only ${withArtwork} circuits had drawn connectivity`);
});

/** Load a real corpus circuit for mutation work. */
function loadVariant(idFragment) {
  const v = variants.find(x => x.id.includes(idFragment));
  assert.ok(v, `fixture ${idFragment} not in corpus`);
  resetIds();
  const loaded = Circuit.fromJSON(JSON.parse(readFileSync(v.path, 'utf-8')));
  const nets = loaded.resolvedNets || [];
  return { loaded, nets, proj: projectSchematic(loaded.parts, nets) };
}

test('MUTATION: dropping a drawn wire turns COMPLETENESS red, restoring turns it green', () => {
  const { loaded, nets, proj } = loadVariant('01-blink/circuit.json');
  const before = analyse(nets, loaded.parts, proj);
  assert.equal(before.drops.length, 0, 'fixture must be clean before mutation');
  assert.ok(proj.wires.length > 0, 'fixture must draw at least one wire');

  const removed = proj.wires.pop();                       // drop a wire
  const mutated = analyse(nets, loaded.parts, proj);
  assert.ok(mutated.drops.length > 0,
    'dropping a drawn wire MUST turn the gate red — a gate you cannot make fail is not checking');

  proj.wires.push(removed);                               // restore
  const restored = analyse(nets, loaded.parts, proj);
  assert.equal(restored.drops.length, 0, 'restoring the wire MUST return the gate to green');
});

test('MUTATION: merging two label texts turns SOUNDNESS red', () => {
  const { loaded, nets, proj } = loadVariant('70-calculator/circuit.json');
  const before = analyse(nets, loaded.parts, proj);
  assert.equal(before.invents.length, 0, 'fixture must be clean after the injectivity fix');
  assert.ok(proj.netLabels.length > 2, 'fixture must use labelled routing');

  // Re-introduce exactly the defect this gate was built to find: give two
  // distinct nets the same label text.
  const texts = [...new Set(proj.netLabels.map(l => l.text))];
  assert.ok(texts.length >= 2, 'need two distinct labels to merge');
  const victim = texts[1];
  const saved = proj.netLabels.map(l => l.text);
  for (const l of proj.netLabels) if (l.text === victim) l.text = texts[0];

  const mutated = analyse(nets, loaded.parts, proj);
  assert.ok(mutated.invents.length > 0,
    'two nets sharing a label text MUST turn SOUNDNESS red');
  assert.ok(mutated.collisions.length > 0, 'and MUST be reported as a label collision');

  proj.netLabels.forEach((l, i) => { l.text = saved[i]; });
  assert.equal(analyse(nets, loaded.parts, proj).invents.length, 0, 'restore returns to green');
});

/**
 * The decisive A/B. The label-text mutation above leaves every pin.netId
 * untouched, so a gate that derives connectivity from pin.netId cannot see
 * it. This test asserts that blindness directly — it is the reason this
 * gate exists alongside schematic-electrical-correspondence.test.js.
 */
test('A/B: a netId-derived gate is BLIND to the label-text defect this gate catches', () => {
  const { loaded, nets, proj } = loadVariant('70-calculator/circuit.json');

  // Connectivity as the prior gate derives it: group pins by pin.netId.
  const netIdPartition = (projection) => {
    const byNet = new Map();
    for (const sym of projection.symbols) {
      for (const pin of sym.pins) {
        if (!pin.netId) continue;
        if (!byNet.has(pin.netId)) byNet.set(pin.netId, new Set());
        byNet.get(pin.netId).add(tKey(sym.id, pin.name));
      }
    }
    return JSON.stringify([...byNet.entries()]
      .map(([k, v]) => [k, [...v].sort()]).sort());
  };

  const netIdBefore = netIdPartition(proj);
  const renderedBefore = analyse(nets, loaded.parts, proj).invents.length;

  const texts = [...new Set(proj.netLabels.map(l => l.text))];
  for (const l of proj.netLabels) if (l.text === texts[1]) l.text = texts[0];

  const netIdAfter = netIdPartition(proj);
  const renderedAfter = analyse(nets, loaded.parts, proj).invents.length;

  assert.equal(netIdAfter, netIdBefore,
    'the netId-derived view is unchanged by the defect — it is structurally blind');
  assert.equal(renderedBefore, 0);
  assert.ok(renderedAfter > 0,
    'the artwork-derived view catches it. That difference is why this gate exists.');
});

/**
 * Instrument check. ROADMAP §Working rules: an A/B whose two sides ran with
 * different device registries produced a whole fictional blast-radius
 * report. Both sides here must come from one process and one registry.
 */
test('INSTRUMENT: both sides share one device registry and one module instance', async () => {
  const mod = await import('../src/model/schematic-projection.js');
  assert.equal(mod.projectSchematic, projectSchematic,
    're-import must be the same module instance — a second copy is a second registry');

  const { loaded, nets, proj } = loadVariant('01-blink/circuit.json');
  const { visible } = pinIndex(proj);
  const solverTerms = new Set();
  for (const net of nets) for (const t of net.terminals) solverTerms.add(tKey(t.part, t.terminal));
  const shared = [...visible].filter(k => solverTerms.has(k));
  assert.ok(shared.length > 0,
    'the two sides must reference the same terminals; zero overlap means one side saw an empty registry');
  console.log(`\nInstrument: ${shared.length}/${visible.size} drawn pins also present in solver nets`);
});

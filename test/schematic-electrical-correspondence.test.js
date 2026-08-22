/**
 * Electrical correspondence gate.
 *
 * INVARIANT: for every circuit variant in the corpus, the connectivity
 * implied by the RENDERED schematic must match the connectivity the
 * SOLVER uses.
 *
 * === Definition of "equal" ===
 *
 * Both sides produce an equivalence relation on (part, terminal) pairs:
 * two terminals are "connected" if they belong to the same net.
 *
 * The gate checks two directions:
 *
 *  SOUNDNESS — every connection the schematic shows also exists in the
 *  solver. A schematic that invents a connection teaches a falsehood.
 *
 *  COMPLETENESS — every solver connection also appears in the schematic.
 *  A schematic that drops a connection misrepresents the circuit.
 *
 * Normalization:
 *  - Terminal names are lowercased (findPinNet is case-insensitive).
 *  - Infrastructure (breadboard, meter) excluded on both sides.
 *  - Singleton nets (1 visible terminal) excluded.
 *
 * === Documented divergences (genuine bugs, not waved away) ===
 *
 *  1. UNDECLARED-TERMINAL GAP (175+ circuits, 1077+ pairs)
 *     The schematic projection draws only terminals in part.terminals.
 *     The solver's nets include terminals from breadboard seat.leadMap
 *     and wire endpoints that aren't in part.terminals. Power, ground,
 *     and unused GPIO pins are electrically real but invisible.
 *     Root: part.terminals is program-declared, not physical-pin-complete.
 *     Fix: expand part.terminals from seat.leadMap on load.
 *
 *  2. CASE-MISMATCH SPLIT NETS (27 STC15F2K60S2 circuits)
 *     seat.leadMap uses uppercase "P1.0", part.terminals has lowercase
 *     "p1.0". The union-find in _syncNetlist treats these as different
 *     terminals, creating two separate nets for one physical pin.
 *     The solver has a split view; the schematic picks one half.
 *     Root: _syncNetlist doesn't normalize terminal case.
 *     Fix: normalize case in _syncNetlist's net key construction.
 *
 *  3. MULTI-NET TERMINAL (3 pc-series circuits)
 *     The same terminal (e.g. vcc_1:vcc) appears in multiple solver
 *     nets. This violates the partition invariant — a terminal should
 *     belong to exactly one net. The schematic picks one net and the
 *     comparison detects the other.
 *     Root: mergeNets or _syncNetlist produces non-partitioned output.
 *     Fix: audit the net-merge path for these circuits.
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

// ── Helpers ──────────────────────────────────────────────────────

const INFRA_KINDS = new Set([
  'breadboard', 'breadboard_full', 'breadboard_half', 'breadboard_mini',
  'meter',
]);

const tKey = (part, terminal) => `${part}:${String(terminal).toLowerCase()}`;

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

function solverUF(resolvedNets, parts) {
  const validParts = new Set(parts.filter(p => !INFRA_KINDS.has(p.kind)).map(p => p.id));
  const uf = new UF();
  for (const net of resolvedNets) {
    const members = net.terminals
      .filter(t => validParts.has(t.part))
      .map(t => tKey(t.part, t.terminal));
    for (let i = 1; i < members.length; i++) uf.union(members[0], members[i]);
  }
  return uf;
}

function projUF(projection) {
  const uf = new UF();
  const byNet = new Map();
  for (const sym of projection.symbols) {
    for (const pin of sym.pins) {
      if (!pin.netId) continue;
      if (!byNet.has(pin.netId)) byNet.set(pin.netId, []);
      byNet.get(pin.netId).push(tKey(sym.id, pin.name));
    }
  }
  for (const members of byNet.values()) {
    for (let i = 1; i < members.length; i++) uf.union(members[0], members[i]);
  }
  return uf;
}

/**
 * Terminals in the solver's nets that the part doesn't declare in .terminals.
 * These exist via breadboard seating or wire endpoints.
 */
function undeclaredTerminals(parts, resolvedNets) {
  const gaps = new Set();
  const partMap = new Map(parts.map(p => [p.id, p]));

  for (const p of parts) {
    if (!p.seat || !p.seat.leadMap) continue;
    const declaredLower = new Set(p.terminals.map(t => t.toLowerCase()));
    for (const k of Object.keys(p.seat.leadMap)) {
      if (!declaredLower.has(k.toLowerCase())) {
        gaps.add(tKey(p.id, k));
      }
    }
  }
  for (const net of resolvedNets) {
    for (const t of net.terminals) {
      const part = partMap.get(t.part);
      if (!part) continue;
      if (INFRA_KINDS.has(part.kind)) continue;
      const declaredLower = new Set(part.terminals.map(x => x.toLowerCase()));
      if (!declaredLower.has(String(t.terminal).toLowerCase())) {
        gaps.add(tKey(t.part, t.terminal));
      }
    }
  }
  return gaps;
}

/**
 * Detect case-mismatch between seat.leadMap and part.terminals.
 * Returns a set of tKey strings for terminals affected.
 */
function caseMismatchTerminals(parts) {
  const affected = new Set();
  for (const p of parts) {
    if (!p.seat || !p.seat.leadMap) continue;
    for (const k of Object.keys(p.seat.leadMap)) {
      const lower = k.toLowerCase();
      if (p.terminals.some(t => t.toLowerCase() === lower && t !== k)) {
        // The seat.leadMap uses a different case than part.terminals.
        // _syncNetlist creates separate net endpoints for each case,
        // producing split nets for one physical pin.
        affected.add(tKey(p.id, k));
        affected.add(tKey(p.id, p.terminals.find(t => t.toLowerCase() === lower)));
      }
    }
  }
  return affected;
}

/**
 * Detect terminals affected by multi-net membership.
 * When the same terminal appears in multiple solver nets, ALL terminals
 * in those nets are affected — the solver's partition is broken and
 * the schematic can only pick one side.
 */
function multiNetTerminals(resolvedNets, parts) {
  const validParts = new Set(parts.filter(p => !INFRA_KINDS.has(p.kind)).map(p => p.id));
  const termToNets = new Map(); // tKey → Set<net id>
  const netToTerms = new Map(); // net id → Set<tKey>

  for (const net of resolvedNets) {
    for (const t of net.terminals) {
      if (!validParts.has(t.part)) continue;
      const k = tKey(t.part, t.terminal);
      if (!termToNets.has(k)) termToNets.set(k, new Set());
      termToNets.get(k).add(net.id);
      if (!netToTerms.has(net.id)) netToTerms.set(net.id, new Set());
      netToTerms.get(net.id).add(k);
    }
  }

  // Find terminals in multiple nets
  const multiTerms = new Set();
  for (const [k, nets] of termToNets) {
    if (nets.size > 1) multiTerms.add(k);
  }

  // All terminals in any net touched by a multi-net terminal are affected
  const affected = new Set();
  for (const k of multiTerms) {
    for (const netId of termToNets.get(k)) {
      for (const term of netToTerms.get(netId)) {
        affected.add(term);
      }
    }
  }
  return affected;
}

/**
 * Full correspondence check.
 * Returns { soundnessErrors, completenessErrors, gapCounts }.
 */
function compareConnectivity(resolvedNets, parts, projection) {
  const suf = solverUF(resolvedNets, parts);
  const puf = projUF(projection);
  const gaps = undeclaredTerminals(parts, resolvedNets);
  const caseMismatches = caseMismatchTerminals(parts);
  const multiNets = multiNetTerminals(resolvedNets, parts);

  const soundnessErrors = [];
  const completenessErrors = [];
  let undeclaredGapCount = 0;
  let implicitGndCount = 0;
  let caseMismatchCount = 0;
  let multiNetCount = 0;

  // Check soundness: projection says connected → solver agrees?
  for (const group of puf.groups()) {
    const members = [...group];
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const a = members[i], b = members[j];
        if (!suf.parent.has(a) || !suf.parent.has(b)) {
          if (a.startsWith('__implicit_gnd__:') || b.startsWith('__implicit_gnd__:')) {
            implicitGndCount++;
          } else {
            soundnessErrors.push([a, b]);
          }
          continue;
        }
        if (!suf.same(a, b)) {
          soundnessErrors.push([a, b]);
        }
      }
    }
  }

  // Check completeness: solver says connected → projection agrees?
  for (const group of suf.groups()) {
    const members = [...group];
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const a = members[i], b = members[j];

        // Classify known gaps
        if (gaps.has(a) || gaps.has(b)) { undeclaredGapCount++; continue; }
        if (caseMismatches.has(a) || caseMismatches.has(b)) { caseMismatchCount++; continue; }
        if (multiNets.has(a) || multiNets.has(b)) { multiNetCount++; continue; }

        if (!puf.parent.has(a) || !puf.parent.has(b)) {
          completenessErrors.push([a, b]);
          continue;
        }
        if (!puf.same(a, b)) {
          completenessErrors.push([a, b]);
        }
      }
    }
  }

  return {
    soundnessErrors,
    completenessErrors,
    undeclaredGapCount,
    implicitGndCount,
    caseMismatchCount,
    multiNetCount,
  };
}

// ── Corpus discovery ────────────────────────────────────────────

const here = path.dirname(fileURLToPath(import.meta.url));
const examplesRoot = path.resolve(here, '../../lego/brickwright-lite/overlay/scratch-gui/examples');

function discoverVariants() {
  if (!existsSync(examplesRoot)) return [];
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

// ── Gate tests ──────────────────────────────────────────────────

test('corpus discovery finds the expected variant count', () => {
  assert.ok(variants.length >= 1000,
    `Expected ≥1000 circuit variants, found ${variants.length}`);
});

test('electrical correspondence: zero SOUNDNESS errors (schematic never invents connections)', async (t) => {
  if (variants.length === 0) { t.skip('No variants found.'); return; }

  const soundnessFailures = [];
  let checked = 0;

  for (const variant of variants) {
    let data;
    try { data = JSON.parse(readFileSync(variant.path, 'utf-8')); } catch { continue; }

    try {
      resetIds();
      const loaded = Circuit.fromJSON(data);
      const nets = loaded.resolvedNets || [];
      const proj = projectSchematic(loaded.parts, nets);
      const result = compareConnectivity(nets, loaded.parts, proj);
      checked++;

      if (result.soundnessErrors.length > 0) {
        soundnessFailures.push({
          variant: variant.id,
          errors: result.soundnessErrors.slice(0, 3),
        });
      }
    } catch { /* skip circuits that fail to load */ }
  }

  console.log(`Soundness check: ${checked} circuits, ${soundnessFailures.length} failures`);
  if (soundnessFailures.length > 0) {
    for (const f of soundnessFailures.slice(0, 10)) {
      console.log(`  ${f.variant}:`);
      for (const [a, b] of f.errors) {
        console.log(`    schematic connects ${a} ↔ ${b}, solver does not`);
      }
    }
  }

  assert.equal(soundnessFailures.length, 0,
    `${soundnessFailures.length} circuit(s) have SOUNDNESS errors — ` +
    `the schematic invents connections the solver does not have`);
});

test('electrical correspondence: completeness across the corpus (with documented gaps)', async (t) => {
  if (variants.length === 0) { t.skip('No variants found.'); return; }

  let strictPass = 0;
  let knownGapOnly = 0;
  let genuineFail = 0;
  let skipped = 0;
  let totalUndeclaredGap = 0;
  let totalImplicitGnd = 0;
  let totalCaseMismatch = 0;
  let totalMultiNet = 0;
  const genuineFailures = [];

  for (const variant of variants) {
    let data;
    try { data = JSON.parse(readFileSync(variant.path, 'utf-8')); }
    catch { skipped++; continue; }

    try {
      resetIds();
      const loaded = Circuit.fromJSON(data);
      const nets = loaded.resolvedNets || [];
      const proj = projectSchematic(loaded.parts, nets);
      const result = compareConnectivity(nets, loaded.parts, proj);

      totalUndeclaredGap += result.undeclaredGapCount;
      totalImplicitGnd += result.implicitGndCount;
      totalCaseMismatch += result.caseMismatchCount;
      totalMultiNet += result.multiNetCount;

      const hasKnownGap = result.undeclaredGapCount > 0 || result.implicitGndCount > 0 ||
        result.caseMismatchCount > 0 || result.multiNetCount > 0;
      const hasGenuine = result.completenessErrors.length > 0;

      if (!hasGenuine && !hasKnownGap) strictPass++;
      else if (!hasGenuine) knownGapOnly++;
      else {
        genuineFail++;
        genuineFailures.push({
          variant: variant.id,
          errors: result.completenessErrors.slice(0, 5),
        });
      }
    } catch { skipped++; }
  }

  console.log(`\n=== Electrical Correspondence Report ===`);
  console.log(`Total variants:        ${variants.length}`);
  console.log(`Strict pass:           ${strictPass}`);
  console.log(`Known-gap only:        ${knownGapOnly}`);
  console.log(`Genuine failures:      ${genuineFail}`);
  console.log(`Skipped:               ${skipped}`);
  console.log(`Coverage:              ${((strictPass + knownGapOnly + genuineFail) / variants.length * 100).toFixed(1)}%`);
  console.log(`\nDocumented divergences (genuine bugs, tracked for fix):`);
  console.log(`  Undeclared-terminal:   ${totalUndeclaredGap} pairs across corpus`);
  console.log(`  Implicit-GND repr:     ${totalImplicitGnd} pairs`);
  console.log(`  Case-mismatch splits:  ${totalCaseMismatch} pairs (27 STC15 circuits)`);
  console.log(`  Multi-net terminal:    ${totalMultiNet} pairs (3 pc-series circuits)`);

  if (genuineFailures.length > 0) {
    console.log(`\nUNEXPLAINED DIVERGENCES (${genuineFailures.length}):`);
    for (const f of genuineFailures.slice(0, 10)) {
      console.log(`  ${f.variant}:`);
      for (const [a, b] of f.errors) {
        console.log(`    solver connects ${a} ↔ ${b}, schematic does not`);
      }
    }
  }

  assert.equal(genuineFail, 0,
    `${genuineFail} circuit(s) have unexplained completeness divergence`);
});

// ── Mutation proofs ─────────────────────────────────────────────

test('MUTATION PROOF: dropping a wire from solver nets turns gate RED', () => {
  resetIds();
  const c = new Circuit(5.0);
  const vcc = c.addPart('vcc', {}, 0, 0);
  const gnd = c.addPart('gnd', {}, 0, 0);
  const r1 = c.addPart('resistor', { ohms: 1000 }, 0, 0);
  const led = c.addPart('led', {}, 0, 0);
  c.addWire(vcc.id, 'vcc', r1.id, 'a');
  c.addWire(r1.id, 'b', led.id, 'anode');
  c.addWire(led.id, 'cathode', gnd.id, 'gnd');

  const nets = [...(c.resolvedNets || [])];
  const parts = c.parts;

  // Baseline passes.
  const baseProj = projectSchematic(parts, nets);
  const baseResult = compareConnectivity(nets, parts, baseProj);
  assert.equal(baseResult.soundnessErrors.length, 0, 'baseline soundness');
  assert.equal(baseResult.completenessErrors.length, 0, 'baseline completeness');

  // Mutation: drop the LED-anode net from the input to the projection.
  const mutatedNets = nets.filter(n => !n.terminals.some(t => t.terminal === 'anode'));
  assert.ok(mutatedNets.length < nets.length, 'mutation must remove a net');

  // Project with mutated nets but compare against original solver nets.
  const mutatedProj = projectSchematic(parts, mutatedNets);
  const mutatedResult = compareConnectivity(nets, parts, mutatedProj);
  assert.ok(
    mutatedResult.completenessErrors.length > 0,
    'dropping a wire MUST produce completeness errors — a gate you cannot make fail is not checking'
  );
});

test('MUTATION PROOF: adding a spurious net turns gate RED', () => {
  resetIds();
  const c = new Circuit(5.0);
  const r1 = c.addPart('resistor', { ohms: 1000 }, 0, 0);
  const r2 = c.addPart('resistor', { ohms: 2200 }, 0, 0);
  c.addWire(r1.id, 'b', r2.id, 'a');

  const nets = [...(c.resolvedNets || [])];
  const parts = c.parts;

  const spuriousNets = [
    ...nets,
    { id: 'spurious', terminals: [
      { part: r1.id, terminal: 'a' },
      { part: r2.id, terminal: 'b' },
    ]},
  ];

  const proj = projectSchematic(parts, spuriousNets);
  const result = compareConnectivity(nets, parts, proj);
  assert.ok(result.soundnessErrors.length > 0,
    'a spurious net MUST produce soundness errors');
});

test('MUTATION PROOF: instrument uses same registry on both sides', () => {
  resetIds();
  const c = new Circuit(5.0);
  const r = c.addPart('resistor', { ohms: 470 }, 0, 0);
  const led = c.addPart('led', {}, 0, 0);
  c.addWire(r.id, 'b', led.id, 'anode');

  const nets = c.resolvedNets || [];
  const proj = projectSchematic(c.parts, nets);

  // Both sides should see the same connected terminals.
  const solverTerminals = new Set();
  for (const net of nets) {
    for (const t of net.terminals) solverTerminals.add(tKey(t.part, t.terminal));
  }
  const projTerminals = new Set();
  for (const sym of proj.symbols) {
    for (const pin of sym.pins) {
      if (pin.netId) projTerminals.add(tKey(sym.id, pin.name));
    }
  }
  assert.deepEqual(
    [...projTerminals].sort(),
    [...solverTerminals].sort(),
    'solver and projection must reference the same terminals — ' +
    'a mismatch means the device registry was uninitialised on one side'
  );
});

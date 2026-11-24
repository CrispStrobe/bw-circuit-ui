/**
 * Serialiser round-trip over the gallery corpus.
 *
 * Loads each circuit.json through the real circuit.js model, serialises
 * it back out, and compares. Reports what is lost per field rather than
 * normalising to make the test pass.
 *
 * This is the test bw-blocks handed off: "The serialiser round-trip
 * belongs in bw-circuit-ui." It catches: dropped fields, parameters
 * silently defaulted, coordinates rounded, kinds normalised on load.
 *
 * Expected differences (not losses):
 * - IDs: addPart generates new IDs; we map and compare structurally
 * - Wire shape: gallery uses flat {from, fromTerminal, to, toTerminal},
 *   model uses nested {from: {part, terminal}, to: {part, terminal}}
 * - terminals: addPart computes terminals from kind; gallery may omit them
 *
 * Scope: the serialiser is lossless FOR THESE 52 circuits. A user's
 * circuit can contain kinds, parameter combinations and terminal names
 * none of these files contain.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, resetIds, resolveLoadedKind } from '../src/model/circuit.js';
import { resolveTerminal, resolveKind, ENGINE_MODEL_WINS } from '../src/model/terminal-aliases.js';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { corpusRoots } from './corpus-root.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
// Resolved the way every other corpus suite does. This read ONE path,
// ../../bw-cfront/sb3-creator/examples, which exists on no machine and cannot
// exist on CI, where sb3-creator is cloned beside the repo — so this gate had
// never run anywhere. Absence is a failure, not a skip: CI provides the
// corpus, so not finding it means a broken checkout.
const CORPUS_ROOTS = corpusRoots(here);
const examplesDir = CORPUS_ROOTS.find((r) => existsSync(r)) || null;

// Kinds resolve exactly as Circuit.fromJSON resolves them (resolveLoadedKind):
// the engine's own model wins over an alias. This loader used the bare
// resolveKind, so a `74hc595` collapsed onto `shift_register`, which has none
// of vcc/gnd/ser/srclk/rclk/srclr/qa..qh; addWire refused all 14 wires to it
// in board-prechin-a2-learning-board and the gate reported 375 "losses" for a
// file the real loader round-trips intact.
function loadGalleryRaw(raw) {
  resetIds();
  const c = new Circuit(raw.vcc || 5.0);
  const idMap = new Map(); // original id → model id

  for (const p of raw.parts || []) {
    const resolvedKind = resolveLoadedKind(p.kind);
    const part = c.addPart(resolvedKind, p.params || {}, p.x || 0, p.y || 0);
    idMap.set(p.id, part.id);
  }

  // Wires this harness cannot represent. A gallery wire may terminate on a
  // BREADBOARD HOLE — `to` is {board, hole}, not a part id — and idMap.get()
  // on an object is undefined, so it is skipped. That is a limit of this
  // part-to-part loader, NOT a serialiser loss, and counting it as one is what
  // made this gate report 2432 losses the day it started running again.
  let unattached = 0;
  // One entry per attachable raw wire, in raw order: the wire addWire
  // returned, or null when it refused it. The comparator matches on this, so
  // a refused wire is reported as ONE loss instead of shifting every later
  // positional comparison.
  const placed = [];
  for (const w of raw.wires || []) {
    const fromId = idMap.get(w.from);
    const toId = idMap.get(w.to);
    if (!fromId || !toId) unattached++;
    if (fromId && toId) {
      const fromPart = c.parts.find(p => p.id === fromId);
      const toPart = c.parts.find(p => p.id === toId);
      const fromTerm = fromPart
        ? resolveTerminal(fromPart.kind, w.fromTerminal, fromPart.terminals)
        : w.fromTerminal;
      const toTerm = toPart
        ? resolveTerminal(toPart.kind, w.toTerminal, toPart.terminals)
        : w.toTerminal;
      placed.push(c.addWire(fromId, fromTerm, toId, toTerm));
    }
  }

  return { circuit: c, raw, idMap, unattached, placed };
}

/**
 * Everything that does not survive load -> serialise for one gallery file,
 * plus how many wires this part-to-part loader could not attach (hole wires).
 */
function galleryLosses(raw) {
  const { circuit, idMap, unattached, placed } = loadGalleryRaw(raw);
  const saved = circuit.toJSON();
  const losses = [];

  // ── Check VCC voltage ────────────────────────────────────
  if (raw.vcc !== undefined && saved.vcc !== raw.vcc) {
    losses.push(`vcc: ${raw.vcc} → ${saved.vcc}`);
  }

  // ── Check part count ─────────────────────────────────────
  if (saved.parts.length !== (raw.parts || []).length) {
    losses.push(`part count: ${(raw.parts || []).length} → ${saved.parts.length}`);
  }

  // ── Check each part's fields ─────────────────────────────
  for (const orig of raw.parts || []) {
    const modelId = idMap.get(orig.id);
    const savedPart = saved.parts.find(p => p.id === modelId);
    if (!savedPart) {
      losses.push(`part ${orig.id} (${orig.kind}): MISSING after round-trip`);
      continue;
    }

    const resolvedKind = resolveLoadedKind(orig.kind);
    if (savedPart.kind !== resolvedKind) {
      losses.push(`part ${orig.id}: kind ${orig.kind} → ${savedPart.kind}`);
    }

    // Coordinates
    const origX = orig.x || 0;
    const origY = orig.y || 0;
    if (savedPart.x !== origX) losses.push(`part ${orig.id}: x ${origX} → ${savedPart.x}`);
    if (savedPart.y !== origY) losses.push(`part ${orig.id}: y ${origY} → ${savedPart.y}`);

    // Parameters — the critical one
    for (const [key, val] of Object.entries(orig.params || {})) {
      const savedVal = savedPart.params?.[key];
      if (JSON.stringify(savedVal) !== JSON.stringify(val)) {
        losses.push(`part ${orig.id}: params.${key} ${JSON.stringify(val)} → ${JSON.stringify(savedVal)}`);
      }
    }
  }

  // ── Check wire count ─────────────────────────────────────
  // Against what the loader could actually take, not the raw file: the
  // difference is hole-terminated wires, which never reached the circuit
  // and so cannot have been lost by serialising it.
  if (saved.wires.length !== (raw.wires || []).length - unattached) {
    losses.push(`wire count: ${(raw.wires || []).length - unattached} → ${saved.wires.length}`);
  }

  // ── Check each wire's endpoints ──────────────────────────
  // Compared over the wires the loader could take, each against the saved
  // wire with the id addWire gave it — never by position. One skipped
  // hole-terminated wire shifted every index after it (2260 of this gate's
  // 2432 "losses" once), and so did one wire addWire refused (375 in
  // board-prechin-a2-learning-board): a single loss must read as one.
  const attachable = (raw.wires || []).filter((w) => idMap.get(w.from) && idMap.get(w.to));
  for (let i = 0; i < attachable.length; i++) {
    const origW = attachable[i];
    if (!placed[i]) {
      losses.push(`wire[${i}]: ${origW.from}.${origW.fromTerminal} -> ${origW.to}.${origW.toTerminal} `
        + 'refused at load (no such terminal on the loaded kind, or a duplicate)');
      continue;
    }
    const savedW = saved.wires.find((sw) => sw.id === placed[i].id);
    if (!savedW) {
      losses.push(`wire[${i}]: MISSING after round-trip`);
      continue;
    }

    // Resolve original IDs to model IDs for comparison
    const origFrom = idMap.get(origW.from);
    const origTo = idMap.get(origW.to);
    const savedFrom = savedW.from?.part || savedW.from;
    const savedTo = savedW.to?.part || savedW.to;

    if (origFrom && savedFrom !== origFrom) {
      losses.push(`wire[${i}]: from ${origW.from} mapped to ${origFrom} but saved as ${savedFrom}`);
    }
    if (origTo && savedTo !== origTo) {
      losses.push(`wire[${i}]: to ${origW.to} mapped to ${origTo} but saved as ${savedTo}`);
    }

    // Terminal names — compare after alias resolution (aliases are
    // a known, documented transformation, not a loss)
    const savedFromTerm = savedW.from?.terminal || savedW.fromTerminal;
    const savedToTerm = savedW.to?.terminal || savedW.toTerminal;
    const fromPart = raw.parts.find(p => p.id === origW.from);
    const toPart = raw.parts.find(p => p.id === origW.to);
    const expectedFromTerm = fromPart
      ? resolveTerminal(resolveLoadedKind(fromPart.kind), origW.fromTerminal,
          circuit.parts.find(p => p.id === origFrom)?.terminals || [])
      : origW.fromTerminal;
    const expectedToTerm = toPart
      ? resolveTerminal(resolveLoadedKind(toPart.kind), origW.toTerminal,
          circuit.parts.find(p => p.id === origTo)?.terminals || [])
      : origW.toTerminal;
    if (savedFromTerm !== expectedFromTerm) {
      losses.push(`wire[${i}]: fromTerminal ${origW.fromTerminal} → ${savedFromTerm} (expected ${expectedFromTerm})`);
    }
    if (savedToTerm !== expectedToTerm) {
      losses.push(`wire[${i}]: toTerminal ${origW.toTerminal} → ${savedToTerm} (expected ${expectedToTerm})`);
    }
  }

  return { losses, unattached };
}

describe('serialiser round-trip over gallery corpus', () => {
  it('the gallery corpus is present', () => {
    assert.notEqual(examplesDir, null,
      `Corpus absent. Tried:\n  ${CORPUS_ROOTS.join('\n  ')}\nA round-trip gate that loads `
      + 'nothing must not report green.');
  });
  if (!examplesDir) return;

  const dirs = readdirSync(examplesDir).filter(d => {
    return existsSync(path.join(examplesDir, d, 'circuit.json'));
  }).sort();

  it(`non-vacuity: found ${dirs.length} circuit.json files`, () => {
    assert.ok(dirs.length >= 30, `expected >=30, got ${dirs.length}`);
  });

  // Track losses across all files
  const allLosses = [];
  let filesChecked = 0;
  let totalUnattached = 0;

  for (const dir of dirs) {
    it(`${dir}: load → save preserves content`, () => {
      const filePath = path.join(examplesDir, dir, 'circuit.json');
      const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
      const { losses, unattached } = galleryLosses(raw);
      totalUnattached += unattached;

      if (losses.length > 0) {
        allLosses.push({ file: dir, losses });
      }
      filesChecked++;

      // Report losses but don't fail — the finding IS the value
      // When losses reach zero, change this to assert.equal
    });
  }

  /**
   * What the serialiser is known to lose today. MAY ONLY SHRINK: if a fix
   * lands, this comes down in the same commit, and the assertion below fails
   * loudly rather than letting the improvement go unrecorded.
   */
  const KNOWN_LOSSES = { total: 0, files: 0 };

  /**
   * Wires this harness cannot carry: their endpoint is a breadboard HOLE, not
   * a part, so a part-to-part loader never attaches them. Not a serialiser
   * loss — counted separately so the limitation is visible instead of inflating
   * the number above, which is exactly what it used to do.
   */
  // The count is a property of the CORPUS REVISION, so it is recorded per
  // revision. CI checks out the reviewed pin (docs/schematic-baselines/
  // CORPUS.json corpusSha), and that pin's entry is mandatory. 2026-11-23:
  // sb3-creator added 88 breadboard-seated lab-* examples (PRs #186/#187), every
  // one wired hole-to-hole, then rerouted them and added 5 radio benches. The
  // single number was raised 731 -> 1375 -> 1310 from a checkout of sb3-creator
  // master, while CI still read the pin, where it is 731 — so the test went red
  // on every master run from #142 on. Measured with EXAMPLES_DIR on fetched
  // checkouts of each revision:
  //   c593574 (the CI pin)        255 files   731
  //   01e1280 (master 2026-11-23) 360 files  1310
  //   539a3d9 (main 2026-11-23, #192)        1310
  //   cafdfb1 (main 2026-11-24, #193: 38 round-4 lab benches)  1426
  //   de3c53c (main 2026-11-24, the CI pin from bw-circuit-ui's corpus bump;
  //            397 files)                                           1423
  //            Same with and without that bump's loader change (an unstamped
  //            wire adopting a stamped net), so the -3 is the corpus.
  // A revision not listed here is compared with the pin's count and fails with
  // its own revision in the message: record it here deliberately, never widen.
  const KNOWN_UNATTACHED_BY_CORPUS = {
    c593574367179132aa193d7f5a4477c0299e3ab3: 731,
    '01e1280652a95a147a24b00cf72a7dfbc04702d9': 1310,
    '539a3d9eefd6d6be804f8f6b48e83465861d99ce': 1310,
    cafdfb1a673e38e0fee853bbd9dddfaef2286fe7: 1426,
    de3c53c83ba4df23478b35645b47ead76c43e2e6: 1423,
  };
  const PINNED_CORPUS = JSON.parse(readFileSync(
    path.join(here, '..', 'docs', 'schematic-baselines', 'CORPUS.json'), 'utf8')).corpusSha;
  const corpusRevision = (() => {
    try {
      return execFileSync('git', ['-C', examplesDir, 'rev-parse', 'HEAD'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch { return null; }
  })();
  const KNOWN_UNATTACHED = KNOWN_UNATTACHED_BY_CORPUS[corpusRevision]
    ?? KNOWN_UNATTACHED_BY_CORPUS[PINNED_CORPUS];

  it('the pinned corpus revision has a recorded hole-wire count', () => {
    assert.ok(Number.isInteger(KNOWN_UNATTACHED_BY_CORPUS[PINNED_CORPUS]),
      `CORPUS.json pins ${PINNED_CORPUS}, which has no entry in KNOWN_UNATTACHED_BY_CORPUS: `
      + 'measure it on that revision (EXAMPLES_DIR) and record it with the pin bump');
  });

  it('summary: report all losses across corpus', () => {
    console.log(`  Serialiser round-trip: ${filesChecked} files checked`);
    if (allLosses.length === 0) {
      console.log('  No losses — serialiser is lossless across all gallery files');
    } else {
      console.log(`  ${allLosses.length} files with losses:`);
      for (const { file, losses } of allLosses) {
        console.log(`    ${file}: ${losses.length} losses`);
        for (const l of losses.slice(0, 5)) console.log(`      - ${l}`);
        if (losses.length > 5) console.log(`      ... and ${losses.length - 5} more`);
      }
    }
    // The interesting number — and now a RATCHET, not just a print.
    //
    // This test reported these figures and asserted nothing, so it passed
    // whatever they were: losses could triple and the suite would stay green
    // while cheerfully printing the larger number. A reporter that cannot fail
    // occupies the slot the check would go in. Same shape as the three vacuous
    // debug-status tests; found by sweeping every test() in the repo for a body
    // with no assertion (docs/TEST-REGISTRATION.md).
    const totalLosses = allLosses.reduce((s, f) => s + f.losses.length, 0);
    console.log(`  Total losses: ${totalLosses} across ${allLosses.length} files`);

    console.log(`  Hole-terminated wires this loader cannot carry: ${totalUnattached}`);
    assert.equal(totalUnattached, KNOWN_UNATTACHED,
      `${totalUnattached} hole-terminated wires vs ${KNOWN_UNATTACHED} recorded `
      + `(corpus ${corpusRevision ?? 'not a git checkout'}; recorded for `
      + `${corpusRevision in KNOWN_UNATTACHED_BY_CORPUS ? 'this revision' : `the pin ${PINNED_CORPUS}`}). Not a serialiser `
      + 'loss — but it moved, so either the corpus changed or the loader learned/forgot how to '
      + 'seat a wire. Update the number deliberately.');
    assert.ok(filesChecked >= 200,
      `only ${filesChecked} files round-tripped — a summary over nothing reports "no losses" `
      + 'and means nothing. The corpus is ~204 files.');
    assert.ok(totalLosses <= KNOWN_LOSSES.total,
      `${totalLosses} serialiser losses across ${allLosses.length} files, ratcheted at `
      + `${KNOWN_LOSSES.total} across ${KNOWN_LOSSES.files}. A loss is a field that does not `
      + 'survive load→serialise; the list is printed above. MAY ONLY SHRINK.');
    assert.ok(allLosses.length <= KNOWN_LOSSES.files,
      `${allLosses.length} files with losses, ratcheted at ${KNOWN_LOSSES.files}`);
    if (totalLosses < KNOWN_LOSSES.total || allLosses.length < KNOWN_LOSSES.files) {
      assert.fail(`the serialiser improved (${totalLosses}/${allLosses.length} vs `
        + `${KNOWN_LOSSES.total}/${KNOWN_LOSSES.files}) — lower KNOWN_LOSSES to lock it in. `
        + 'A ratchet left above the measurement has stopped ratcheting.');
    }
  });
});

// ── Negative controls ──────────────────────────────────────────────
// Prove the comparator can detect each class of mutation. Without these,
// "0 losses" could mean "the comparator is broken" as easily as "the
// serialiser is correct".

/**
 * Reusable comparator: returns losses between original raw JSON and a
 * circuit that was loaded from it then serialised back.
 */
function compareRoundTrip(raw, circuit, idMap) {
  const saved = circuit.toJSON();
  const losses = [];

  if (raw.vcc !== undefined && saved.vcc !== raw.vcc)
    losses.push(`vcc: ${raw.vcc} → ${saved.vcc}`);
  if (saved.parts.length !== (raw.parts || []).length)
    losses.push(`part count: ${(raw.parts || []).length} → ${saved.parts.length}`);

  for (const orig of raw.parts || []) {
    const modelId = idMap.get(orig.id);
    const savedPart = saved.parts.find(p => p.id === modelId);
    if (!savedPart) { losses.push(`part ${orig.id}: MISSING`); continue; }
    const rk = resolveLoadedKind(orig.kind);
    if (savedPart.kind !== rk) losses.push(`part ${orig.id}: kind ${orig.kind} → ${savedPart.kind}`);
    if (savedPart.x !== (orig.x || 0)) losses.push(`part ${orig.id}: x changed`);
    if (savedPart.y !== (orig.y || 0)) losses.push(`part ${orig.id}: y changed`);
    for (const [key, val] of Object.entries(orig.params || {})) {
      if (JSON.stringify(savedPart.params?.[key]) !== JSON.stringify(val))
        losses.push(`part ${orig.id}: params.${key} changed`);
    }
  }

  if (saved.wires.length !== (raw.wires || []).length)
    losses.push(`wire count: ${(raw.wires || []).length} → ${saved.wires.length}`);

  return losses;
}

describe('negative controls: comparator detects mutations', () => {
  // Use a simple known circuit rather than depending on the gallery
  function makeTestCircuit() {
    return {
      vcc: 5.0,
      parts: [
        { id: 'v1', kind: 'vcc', params: {}, x: 100, y: 50 },
        { id: 'g1', kind: 'gnd', params: {}, x: 100, y: 350 },
        { id: 'r1', kind: 'resistor', params: { ohms: 1000 }, x: 200, y: 150 },
        { id: 'l1', kind: 'led', params: { vf: 2.0, color: 'red' }, x: 200, y: 250 },
      ],
      wires: [
        { from: 'v1', fromTerminal: 'vcc', to: 'r1', toTerminal: 'a' },
        { from: 'r1', fromTerminal: 'b', to: 'l1', toTerminal: 'anode' },
        { from: 'l1', fromTerminal: 'cathode', to: 'g1', toTerminal: 'gnd' },
      ],
    };
  }

  function loadAndCompare(raw) {
    resetIds();
    const c = new Circuit(raw.vcc || 5.0);
    const idMap = new Map();
    for (const p of raw.parts) {
      const part = c.addPart(resolveLoadedKind(p.kind), p.params || {}, p.x || 0, p.y || 0);
      idMap.set(p.id, part.id);
    }
    for (const w of raw.wires) {
      const fromId = idMap.get(w.from);
      const toId = idMap.get(w.to);
      if (fromId && toId) {
        const fp = c.parts.find(pp => pp.id === fromId);
        const tp = c.parts.find(pp => pp.id === toId);
        c.addWire(fromId,
          fp ? resolveTerminal(fp.kind, w.fromTerminal, fp.terminals) : w.fromTerminal,
          toId,
          tp ? resolveTerminal(tp.kind, w.toTerminal, tp.terminals) : w.toTerminal);
      }
    }
    return compareRoundTrip(raw, c, idMap);
  }

  it('baseline: unmodified circuit has zero losses', () => {
    const losses = loadAndCompare(makeTestCircuit());
    assert.equal(losses.length, 0, 'baseline must be clean');
  });

  it('detects a dropped parameter', () => {
    // Load the full circuit normally
    const raw = makeTestCircuit();
    resetIds();
    const c = new Circuit(raw.vcc);
    const idMap = new Map();
    for (const p of raw.parts) {
      const part = c.addPart(resolveLoadedKind(p.kind), p.params || {}, p.x, p.y);
      idMap.set(p.id, part.id);
    }
    // Tamper: pretend the original had ohms=2200 — the saved circuit has 1000
    const tampered = JSON.parse(JSON.stringify(raw));
    tampered.parts[2].params.ohms = 2200;
    const losses = compareRoundTrip(tampered, c, idMap);
    assert.ok(losses.some(l => l.includes('params.ohms')),
      `comparator must detect param change, got: ${losses.join('; ')}`);
  });

  it('detects a shifted coordinate', () => {
    const raw = makeTestCircuit();
    const original = JSON.parse(JSON.stringify(raw));
    // Load normally, then tamper with the original's x to simulate a mismatch
    resetIds();
    const c = new Circuit(raw.vcc);
    const idMap = new Map();
    for (const p of raw.parts) {
      const part = c.addPart(resolveLoadedKind(p.kind), p.params || {}, p.x, p.y);
      idMap.set(p.id, part.id);
    }
    // Tamper: shift original's recorded x by 1 after loading
    original.parts[2].x = 201;
    const losses = compareRoundTrip(original, c, idMap);
    assert.ok(losses.some(l => l.includes('x changed')),
      `comparator must detect x shift, got: ${losses.join('; ')}`);
  });

  it('detects a removed wire', () => {
    const raw = makeTestCircuit();
    raw.wires.pop(); // remove the last wire
    const losses = loadAndCompare(raw);
    // Wire count will differ: original had 3 wires, model only added 2
    // but the raw we compare against has 2 wires, so count matches.
    // The real detection: load the full circuit, then compare against
    // a raw with one wire removed.
    const fullRaw = makeTestCircuit();
    resetIds();
    const c = new Circuit(fullRaw.vcc);
    const idMap = new Map();
    for (const p of fullRaw.parts) {
      const part = c.addPart(resolveLoadedKind(p.kind), p.params || {}, p.x, p.y);
      idMap.set(p.id, part.id);
    }
    for (const w of fullRaw.wires) {
      c.addWire(idMap.get(w.from), w.fromTerminal, idMap.get(w.to), w.toTerminal);
    }
    // Compare the full circuit against the truncated raw
    const truncatedRaw = makeTestCircuit();
    truncatedRaw.wires.pop();
    const losses2 = compareRoundTrip(truncatedRaw, c, idMap);
    assert.ok(losses2.some(l => l.includes('wire count')),
      `comparator must detect wire count mismatch, got: ${losses2.join('; ')}`);
  });

  it('detects a changed VCC voltage', () => {
    const raw = makeTestCircuit();
    resetIds();
    const c = new Circuit(raw.vcc);
    const idMap = new Map();
    for (const p of raw.parts) {
      const part = c.addPart(resolveLoadedKind(p.kind), p.params || {}, p.x, p.y);
      idMap.set(p.id, part.id);
    }
    // Tamper: pretend original was 3.3V
    raw.vcc = 3.3;
    const losses = compareRoundTrip(raw, c, idMap);
    assert.ok(losses.some(l => l.includes('vcc')),
      `comparator must detect VCC change, got: ${losses.join('; ')}`);
  });
});

// ── Regression: an engine-modelled alias kind (corpus-independent) ──
// board-prechin-a2-learning-board reported 375 losses: wire count 123 -> 109
// and "wire[2]: from vcc1 mapped to vcc_1 but saved as gnd_2". The file has a
// `74hc595`; this harness resolved it with the bare resolveKind, which
// collapses it onto the built-in `shift_register` (no vcc/gnd/ser/srclk/rclk/
// srclr/qa..qh), so addWire refused all 14 of its wires and every later wire
// was compared against the wrong saved one. Circuit.fromJSON asks the engine
// first and kept the chip; the harness now resolves kinds the same way.
describe('regression: a 74hc595 round-trips through the harness loader', () => {
  function fixture() {
    return {
      vcc: 5,
      parts: [
        { id: 'vcc1', kind: 'vcc', params: {}, x: 40, y: 40 },
        { id: 'gnd1', kind: 'gnd', params: {}, x: 40, y: 640 },
        { id: 'sr1', kind: '74hc595', params: {}, x: 820, y: 190 },
        { id: 'r1', kind: 'resistor', params: { ohms: 330 }, x: 900, y: 190 },
        { id: 'led1', kind: 'led', params: { color: 'red' }, x: 960, y: 190 },
      ],
      wires: [
        { from: 'vcc1', fromTerminal: 'vcc', to: 'sr1', toTerminal: 'vcc' },
        { from: 'gnd1', fromTerminal: 'gnd', to: 'sr1', toTerminal: 'gnd' },
        { from: 'vcc1', fromTerminal: 'vcc', to: 'sr1', toTerminal: 'srclr' },
        { from: 'gnd1', fromTerminal: 'gnd', to: 'sr1', toTerminal: 'oe' },
        { from: 'sr1', fromTerminal: 'qa', to: 'r1', toTerminal: 'a' },
        { from: 'r1', fromTerminal: 'b', to: 'led1', toTerminal: 'anode' },
        { from: 'led1', fromTerminal: 'cathode', to: 'gnd1', toTerminal: 'gnd' },
      ],
    };
  }

  it('the fixture exercises the alias: bare resolveKind would collapse the chip', () => {
    assert.equal(resolveKind('74hc595'), 'shift_register');
    assert.equal(resolveLoadedKind('74hc595'), '74hc595',
      'the engine registers 74hc595, so the load path must keep it');
  });

  it('load -> save through the harness loader loses nothing', () => {
    const { losses, unattached } = galleryLosses(fixture());
    assert.equal(unattached, 0);
    assert.deepEqual(losses, []);
  });

  it('Circuit.fromJSON agrees: same kind, every wire kept, fixed point on reload', () => {
    const saved = Circuit.fromJSON(fixture()).toJSON();
    assert.equal(saved.parts.find((p) => p.id === 'sr1').kind, '74hc595');
    assert.equal(saved.wires.length, fixture().wires.length);
    const again = Circuit.fromJSON(JSON.parse(JSON.stringify(saved))).toJSON();
    assert.equal(again.wires.length, saved.wires.length);
  });

  it('the harness resolves every engine-wins kind exactly as fromJSON does', () => {
    for (const kind of ENGINE_MODEL_WINS) {
      const loaded = Circuit.fromJSON({ vcc: 5, parts: [{ id: 'p', kind, params: {}, x: 0, y: 0 }], wires: [] });
      assert.equal(resolveLoadedKind(kind), loaded.parts[0].kind, kind);
    }
  });

  it('negative control: one refused wire is one wire loss, not a cascade', () => {
    const raw = fixture();
    // A terminal no resistor has, in the middle of the list.
    raw.wires.splice(1, 0, { from: 'vcc1', fromTerminal: 'vcc', to: 'r1', toTerminal: 'nope' });
    const { losses } = galleryLosses(raw);
    const perWire = losses.filter((l) => l.startsWith('wire['));
    assert.equal(perWire.length, 1, losses.join('\n'));
    assert.match(perWire[0], /^wire\[1\]: vcc1\.vcc -> r1\.nope refused at load/);
    assert.ok(losses.some((l) => l.startsWith('wire count: 8 → 7')), losses.join('\n'));
  });
});

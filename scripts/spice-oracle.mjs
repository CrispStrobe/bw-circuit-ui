/**
 * The SPICE oracle: a real simulator judges OUR exporter.
 *
 * The defect this exists for (ROADMAP X0.1) was not "the deck is slightly
 * wrong". It was that no deck we had ever exported could RUN: `extractNetlist`
 * dissolves vcc/gnd parts into net names, so every .cir we shipped had no
 * node 0, no source and no analysis directive. Nobody noticed because nothing
 * ever fed one to a simulator. A test that only reads our own output back
 * cannot catch that class of defect — only a foreign parser can.
 *
 * So this script exports each case through the shipping path
 * (Circuit -> extractNetlist -> toSpice), hands the deck to ngspice, and
 * compares ngspice's operating point against the engine's own solve for the
 * SAME circuit. Two independent implementations of the same device equations
 * must agree; where they disagree, one of them is wrong.
 *
 * Why the LEDs declare `model: 'shockley'`: the designer's DEFAULT diode
 * model is piecewise-linear (a knee at Vf plus a series rd) and has no SPICE
 * spelling, so a PWL bench and a SPICE deck can only ever agree to within the
 * gap between two different models. The exporter writes the Shockley
 * calibration of the part's own Vf, which is the engine's OTHER model,
 * available behind that param and identical in its equations. Running the
 * oracle on shockley parts is therefore an exact differential; the PWL gap
 * is measured separately and reported (see MODEL_GAP below) so the number is
 * on the record rather than hidden by a loose tolerance.
 *
 * ngspice is GPL. It is a DEVELOPMENT AND CI ORACLE ONLY — never bundled,
 * never shipped, never linked. Same standing as ucsim for the 8051.
 *
 * Where ngspice is absent the script says so loudly and exits 0; the CI job
 * installs it and runs it for real (.github/workflows/ci.yml).
 *
 * Usage: node scripts/spice-oracle.mjs [--keep]
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import '../test/_setup.js';
import { Circuit } from '../src/model/circuit.js';
import { extractNetlist } from '../src/model/netlist.js';
import { toSpice } from '../src/model/exporters/spice.js';
import { importSpice } from '../src/importers/spice.js';

/** Agreement required between ngspice and the engine on a shared node. */
const V_TOL_ABS = 5e-3;      // volts
const V_TOL_REL = 0.01;      // 1 %
/** Agreement required on the supply branch current. */
const I_TOL_REL = 0.02;      // 2 %

const KEEP = process.argv.includes('--keep');

/** Hand-written decks in spellings our exporter never emits. */
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../test/fixtures/spice');

// ── Cases ────────────────────────────────────────────────────────────
// Deterministic, self-contained, and each one exercises a different piece
// of what X0.1 had to add: the ground node, the synthesized rail, the
// per-part diode model, the potentiometer split, a second rail net.

const rail = (id = 'VCC1') => ({ id, kind: 'vcc', params: {}, x: 0, y: 0 });
const gnd = (id = 'GND1') => ({ id, kind: 'gnd', params: {}, x: 0, y: 200 });

const CASES = [
  ['divider', {
    // Purely linear: if this disagrees, the disagreement is not the diode.
    parts: [rail(), gnd(),
      { id: 'R1', kind: 'resistor', params: { ohms: 10000 }, x: 60, y: 0 },
      { id: 'R2', kind: 'resistor', params: { ohms: 4700 }, x: 120, y: 0 }],
    wires: [
      { from: 'VCC1', fromTerminal: 'vcc', to: 'R1', toTerminal: 'a' },
      { from: 'R1', fromTerminal: 'b', to: 'R2', toTerminal: 'a' },
      { from: 'R2', fromTerminal: 'b', to: 'GND1', toTerminal: 'gnd' },
    ],
  }],
  ['canonical-bench', {
    // The 5 V / 1 kOhm / LED bench the ROADMAP names in X0.1's acceptance.
    parts: [rail(), gnd(),
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, x: 60, y: 0 },
      { id: 'LED1', kind: 'led', params: { color: 'red', model: 'shockley' }, x: 120, y: 0 }],
    wires: [
      { from: 'VCC1', fromTerminal: 'vcc', to: 'R1', toTerminal: 'a' },
      { from: 'R1', fromTerminal: 'b', to: 'LED1', toTerminal: 'anode' },
      { from: 'LED1', fromTerminal: 'cathode', to: 'GND1', toTerminal: 'gnd' },
    ],
  }],
  ['megohm-divider', {
    // X0.2's regression, end to end: a 1 MOhm arm. Written as `1M` the deck
    // says one MILLIOHM and this divider reads ~0 V instead of ~2.5 V.
    parts: [rail(), gnd(),
      { id: 'R1', kind: 'resistor', params: { ohms: 1e6 }, x: 60, y: 0 },
      { id: 'R2', kind: 'resistor', params: { ohms: 1e6 }, x: 120, y: 0 }],
    wires: [
      { from: 'VCC1', fromTerminal: 'vcc', to: 'R1', toTerminal: 'a' },
      { from: 'R1', fromTerminal: 'b', to: 'R2', toTerminal: 'a' },
      { from: 'R2', fromTerminal: 'b', to: 'GND1', toTerminal: 'gnd' },
    ],
  }],
  ['two-diode-string', {
    // Two junctions with DIFFERENT forward voltages: one shared `.model LED`
    // card cannot describe both, which is why the exporter writes one per
    // part.
    parts: [rail(), gnd(),
      { id: 'R1', kind: 'resistor', params: { ohms: 470 }, x: 60, y: 0 },
      { id: 'LED1', kind: 'led', params: { vf: 2.0, model: 'shockley' }, x: 120, y: 0 },
      { id: 'D1', kind: 'diode', params: { vf: 0.7, model: 'shockley' }, x: 180, y: 0 }],
    wires: [
      { from: 'VCC1', fromTerminal: 'vcc', to: 'R1', toTerminal: 'a' },
      { from: 'R1', fromTerminal: 'b', to: 'LED1', toTerminal: 'anode' },
      { from: 'LED1', fromTerminal: 'cathode', to: 'D1', toTerminal: 'anode' },
      { from: 'D1', fromTerminal: 'cathode', to: 'GND1', toTerminal: 'gnd' },
    ],
  }],
  ['potentiometer', {
    // Three terminals, one element letter. The old exporter wrote a single
    // two-node R at the full value and the wiper net left the deck entirely.
    parts: [rail(), gnd(),
      { id: 'RV1', kind: 'potentiometer', params: { ohms: 10000, position: 0.3 }, x: 60, y: 0 },
      { id: 'R1', kind: 'resistor', params: { ohms: 2200 }, x: 140, y: 0 }],
    wires: [
      { from: 'VCC1', fromTerminal: 'vcc', to: 'RV1', toTerminal: 'a' },
      { from: 'RV1', fromTerminal: 'b', to: 'GND1', toTerminal: 'gnd' },
      { from: 'RV1', fromTerminal: 'wiper', to: 'R1', toTerminal: 'a' },
      { from: 'R1', fromTerminal: 'b', to: 'GND1', toTerminal: 'gnd' },
    ],
  }],
  ['rc-and-parallel', {
    // A cap beside two parallel resistors. `.op` opens every capacitor by
    // definition; the engine is a TRANSIENT solver and an uncharged 1 uF cap
    // holds its node at 0 V until it charges — the two only describe the same
    // circuit once the RC has settled. tau here is about 1.1 ms, so the case
    // carries a settle time and the comparison is made after it. (Without it
    // the engine reports 0 V against ngspice's 2.512 V, which is not a defect
    // in either one; it is the oracle asking the wrong question.)
    settleNs: 50_000_000n,
    parts: [rail(), gnd(),
      { id: 'R1', kind: 'resistor', params: { ohms: 2200 }, x: 60, y: 0 },
      { id: 'R2', kind: 'resistor', params: { ohms: 3300 }, x: 120, y: 0 },
      { id: 'R3', kind: 'resistor', params: { ohms: 6800 }, x: 120, y: 80 },
      { id: 'C1', kind: 'capacitor', params: { farads: 1e-6 }, x: 180, y: 0 }],
    wires: [
      { from: 'VCC1', fromTerminal: 'vcc', to: 'R1', toTerminal: 'a' },
      { from: 'R1', fromTerminal: 'b', to: 'R2', toTerminal: 'a' },
      { from: 'R1', fromTerminal: 'b', to: 'R3', toTerminal: 'a' },
      { from: 'R1', fromTerminal: 'b', to: 'C1', toTerminal: 'a' },
      { from: 'C1', fromTerminal: 'b', to: 'GND1', toTerminal: 'gnd' },
      { from: 'R2', fromTerminal: 'b', to: 'GND1', toTerminal: 'gnd' },
      { from: 'R3', fromTerminal: 'b', to: 'GND1', toTerminal: 'gnd' },
    ],
  }],
];

// ── ngspice ──────────────────────────────────────────────────────────

export function haveNgspice() {
  const r = spawnSync('ngspice', ['--version'], { encoding: 'utf-8' });
  return r.status === 0 || /ngspice/i.test(String(r.stdout || r.stderr));
}

/**
 * Run a deck and parse the operating point out of ngspice's batch output.
 *
 * @param {string} deck
 * @param {string} dir
 * @param {string} name
 * @returns {{ nodes: Record<string, number>, branches: Record<string, number>,
 *             raw: string, error: string|null }}
 */
export function runNgspice(deck, dir, name) {
  const file = join(dir, `${name}.cir`);
  writeFileSync(file, deck);
  const r = spawnSync('ngspice', ['-b', file], { encoding: 'utf-8', timeout: 60_000 });
  const raw = String(r.stdout || '') + String(r.stderr || '');

  // ngspice announces a refusal rather than exiting non-zero for most deck
  // errors, so the exit status is not the signal — the text is.
  const errLine = raw.match(/^\s*(Error on line.*|.*unknown device type.*|.*Simulation interrupted.*)$/mi);
  const fatal = /Simulation interrupted|unknown device type|no such (?:vector|node)/i.test(raw);

  const nodes = {};
  const branches = {};
  // Batch .op output is a two-column table under a "Node / Voltage" header.
  // ngspice prints a NUMERIC node as `V(2)` and a named one bare, so both
  // spellings have to be accepted — matching only `V(...)` reads every named
  // net as absent and silently compares nothing, which is exactly the shape
  // of failure this oracle exists to catch.
  const lines = raw.split('\n');
  let inNodes = false;
  for (const line of lines) {
    if (/^\s*Node\s+Voltage\s*$/.test(line)) { inNodes = true; continue; }
    if (/^\s*Source\s+Current\s*$/.test(line)) { inNodes = false; continue; }
    if (/^\s*-+\s+-+\s*$/.test(line) || /^\s*-+\t-+\s*$/.test(line)) continue;
    const m = line.match(/^\s*([^\s]+)\s+([-+]?[0-9][-+0-9.eE]*)\s*$/);
    if (!m) { if (inNodes && /^\s*$/.test(line)) inNodes = false; continue; }
    const [, rawName, value] = m;
    if (/#branch$/.test(rawName)) {
      branches[rawName.replace(/#branch$/, '').toLowerCase()] = Number(value);
    } else if (inNodes) {
      const name = rawName.replace(/^V\((.*)\)$/, '$1').toLowerCase();
      nodes[name] = Number(value);
    }
  }
  return { nodes, branches, raw, error: fatal ? (errLine ? errLine[1] : 'ngspice refused the deck') : null };
}

// ── Comparison ───────────────────────────────────────────────────────

/** The name the ground net WOULD carry if it were not mapped to node 0. */
function groundNetOf(netlist) {
  const g = netlist.nets.find(n => n.rail === 'gnd');
  return g ? g.name : null;
}

function agree(a, b) {
  const d = Math.abs(a - b);
  return d <= V_TOL_ABS || d <= V_TOL_REL * Math.max(Math.abs(a), Math.abs(b));
}

/**
 * Build, solve, export and judge one case.
 * @returns {{name: string, ok: boolean, lines: string[]}}
 */
export function judgeCase(name, json, dir) {
  const lines = [];
  const circuit = Circuit.fromJSON(json);
  circuit.setPower(true);
  // Reactive cases need the transient to settle before an operating point
  // means anything (see rc-and-parallel).
  if (json.settleNs) circuit.advanceTo(json.settleNs);

  const netlist = extractNetlist(circuit);
  const { text, warnings } = toSpice(netlist, `oracle: ${name}`);

  // Structural floor: these are what "unsimulatable" meant.
  //
  // The ground assertion is deliberately about the DECK, not about whether
  // ngspice liked it. ngspice aliases a node literally named `gnd` to node 0,
  // so a deck that never maps ground to 0 still simulates HERE and would
  // still be wrong: that alias is an ngspice courtesy, not part of the SPICE
  // netlist language, and readers that lack it see a ground net floating
  // beside an unconnected node 0. Measured: with the ground->0 mapping
  // removed, all six decks still passed every numeric comparison. A gate that
  // a simulator's convenience feature can satisfy is not a gate.
  const elementLines = text.split('\n')
    .filter(l => l.trim() && !l.trim().startsWith('*') && !l.trim().startsWith('.'));
  const tokensOf = (l) => l.trim().split(/\s+/).slice(1);
  const allTokens = new Set(elementLines.flatMap(tokensOf));

  const structural = [];
  if (!/(^|\n)V[^\s]*\s+\S+\s+0\s+DC\s/.test(text)) structural.push('no synthesized supply');
  if (!allTokens.has('0')) structural.push('no node 0 on any element');
  if (groundNetOf(netlist) && allTokens.has(groundNetOf(netlist))) {
    structural.push(`ground net is spelled '${groundNetOf(netlist)}' instead of node 0`);
  }
  if (!/^\.op\s*$/m.test(text)) structural.push('no analysis directive');
  if (!/^\.end\s*$/m.test(text)) structural.push('no .end');
  if (structural.length) {
    lines.push(`  STRUCTURE: ${structural.join('; ')}`);
    return { name, ok: false, lines };
  }

  const run = runNgspice(text, dir, name);
  if (run.error) {
    lines.push(`  ngspice REFUSED the deck: ${run.error}`);
    lines.push(...run.raw.split('\n').slice(0, 24).map(l => `    | ${l}`));
    return { name, ok: false, lines };
  }

  // Node-by-node: the engine's solve for the same net.
  let ok = true;
  let compared = 0;
  for (const net of netlist.nets) {
    if (net.name === 'GND' || !net.id) continue;
    const engineV = circuit.nodeVoltage(net.id);
    if (typeof engineV !== 'number' || !isFinite(engineV)) continue;
    const key = net.name.toLowerCase();
    if (!(key in run.nodes)) continue;   // ngspice folds unused nodes away
    compared++;
    const spiceV = run.nodes[key];
    if (!agree(engineV, spiceV)) {
      ok = false;
      lines.push(`  V(${net.name}): engine ${engineV.toFixed(6)} V  ngspice `
        + `${spiceV.toFixed(6)} V  delta ${Math.abs(engineV - spiceV).toExponential(2)}`);
    } else {
      lines.push(`  V(${net.name}) = ${spiceV.toFixed(6)} V  (engine ${engineV.toFixed(6)})`);
    }
  }
  if (compared === 0) {
    lines.push('  no shared node between the deck and the engine solve — nothing was compared');
    ok = false;
  }

  // Supply branch current: ngspice reports it negative (current INTO the
  // source's positive terminal), the engine reports it as drawn.
  const branch = Object.entries(run.branches).find(([k]) => k.includes('supply'));
  if (branch) {
    const spiceI = Math.abs(branch[1]);
    lines.push(`  I(supply) = ${spiceI.toExponential(6)} A`);
    // Cross-check against the engine by summing what the rail feeds.
    const supplyNet = netlist.nets.find(n => n.rail === 'vcc');
    if (supplyNet) {
      let engineI = 0;
      for (const nd of supplyNet.nodes) {
        const i = circuit.branchCurrent(nd.partId, nd.pin);
        if (typeof i === 'number' && isFinite(i)) engineI += i;
      }
      if (engineI !== 0) {
        const rel = Math.abs(spiceI - Math.abs(engineI)) / Math.max(spiceI, Math.abs(engineI));
        lines.push(`    engine draws ${Math.abs(engineI).toExponential(6)} A `
          + `(relative difference ${(rel * 100).toFixed(3)} %)`);
        if (rel > I_TOL_REL) { ok = false; lines.push('    ABOVE TOLERANCE'); }
      }
    }
  }

  if (warnings.length) for (const w of warnings) lines.push(`  export warning: ${w}`);
  return { name, ok, lines };
}

// ── Round trip through our own importer, judged by ngspice ───────────
//
// ROADMAP X1.1's acceptance: our exporter's output re-imports with an
// identical net partition. test/spice-import.test.js compares the partition
// symbolically; this compares what a SIMULATOR makes of both decks, which
// catches what a partition cannot — a value that survived the trip as a
// different number, a diode model that came back as a different curve, a
// source that lost its polarity. The node NAMES differ between the two decks
// (the second is written from imported refdes), so the comparison is the
// sorted multiset of node voltages: name-independent, and equal if and only
// if the two decks are the same circuit.
function judgeRoundTrip(name, json, dir) {
  const lines = [];
  const circuit = Circuit.fromJSON(json);
  circuit.setPower(true);
  if (json.settleNs) circuit.advanceTo(json.settleNs);

  const deckA = toSpice(extractNetlist(circuit), `${name} (exported)`).text;
  const back = importSpice(deckA);
  if (back.unmapped.length) {
    lines.push(`  re-import left ${back.unmapped.length} unmapped: `
      + back.unmapped.map(u => `${u.ref} (${u.libsource})`).join('; '));
    return { name, ok: false, lines };
  }

  const rebuilt = Circuit.fromJSON({ parts: back.parts, wires: back.wires });
  rebuilt.setPower(true);
  const deckB = toSpice(extractNetlist(rebuilt), `${name} (re-exported)`).text;

  const runA = runNgspice(deckA, dir, `${name}-rt-a`);
  const runB = runNgspice(deckB, dir, `${name}-rt-b`);
  if (runA.error || runB.error) {
    lines.push(`  ngspice refused a deck: A=${runA.error || 'ok'} B=${runB.error || 'ok'}`);
    if (runB.error) lines.push(...deckB.split('\n').map(l => `    | ${l}`));
    return { name, ok: false, lines };
  }

  const spectrum = (run) => Object.values(run.nodes)
    .map(v => Number(v.toFixed(6))).sort((a, b) => a - b);
  const a = spectrum(runA);
  const b = spectrum(runB);
  lines.push(`  exported  ${a.map(v => v.toFixed(6)).join(' ')}`);
  lines.push(`  re-exported ${b.map(v => v.toFixed(6)).join(' ')}`);

  let ok = a.length === b.length;
  if (ok) for (let i = 0; i < a.length; i++) if (!agree(a[i], b[i])) ok = false;
  if (!ok) lines.push('  the two decks are not the same circuit');
  return { name, ok, lines };
}

// ── Foreign decks: the round trip that is not symmetric ──────────────
//
// judgeRoundTrip above runs a deck WE wrote through a reader WE wrote, and
// that pairing has a blind spot it cannot see past: a symmetric error is
// invisible to it. Measured, by mutation — reintroducing X0.2's mega/milli
// bug on the READ side left all six self round-trips green, because our
// exporter never writes a bare `M` for mega and so never asks the question.
//
// test/fixtures/spice/*.cir are written in spellings our exporter does not
// use: bare `M` beside `MEG`, units trailing the scale letter, scientific
// notation, a `.model` in another house's capitalisation, a two-instance
// subcircuit. Each is simulated AS AUTHORED, then read by our importer,
// written back by our exporter, and simulated again. The two operating
// points must match — which is only possible if the reader understood the
// foreign spelling.
function judgeForeign(file, dir) {
  const lines = [];
  const name = file.replace(/\.cir$/, '');
  const original = readFileSync(join(FIXTURES, file), 'utf-8');

  const runOriginal = runNgspice(original, dir, `${name}-orig`);
  if (runOriginal.error) {
    lines.push(`  ngspice refused the FIXTURE itself: ${runOriginal.error}`);
    return { name, ok: false, lines };
  }

  const back = importSpice(original);
  if (back.unmapped.length) {
    lines.push(`  our importer refused ${back.unmapped.length}: `
      + back.unmapped.map(u => `${u.ref} (${u.libsource})`).join('; '));
    return { name, ok: false, lines };
  }

  const rebuilt = Circuit.fromJSON({ parts: back.parts, wires: back.wires });
  rebuilt.setPower(true);
  const ours = toSpice(extractNetlist(rebuilt), `${name} (through us)`).text;
  const runOurs = runNgspice(ours, dir, `${name}-ours`);
  if (runOurs.error) {
    lines.push(`  ngspice refused OUR re-export: ${runOurs.error}`);
    lines.push(...ours.split('\n').map(l => `    | ${l}`));
    return { name, ok: false, lines };
  }

  const spectrum = (run) => Object.values(run.nodes)
    .map(v => Number(v.toFixed(6))).sort((a, b) => a - b);
  const a = spectrum(runOriginal);
  const b = spectrum(runOurs);
  lines.push(`  as authored  ${a.map(v => v.toFixed(6)).join(' ')}`);
  lines.push(`  through us   ${b.map(v => v.toFixed(6)).join(' ')}`);

  let ok = a.length === b.length;
  if (!ok) lines.push(`  node count differs: ${a.length} vs ${b.length}`);
  if (ok) for (let i = 0; i < a.length; i++) if (!agree(a[i], b[i])) ok = false;
  if (!ok) lines.push('  our reader did not understand this deck');
  return { name, ok, lines };
}

// ── The measured PWL-vs-Shockley gap, stated rather than hidden ──────
//
// The shipped default LED model is piecewise. A deck cannot express it, so
// the exporter writes the Shockley calibration of the same Vf. This measures
// what that substitution costs on the canonical bench and prints it. It does
// not gate — it is a number on the record, re-measured every run, so a
// change in either model shows up here instead of silently widening.
function modelGap() {
  const build = (model) => Circuit.fromJSON({
    parts: [rail(), gnd(),
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, x: 60, y: 0 },
      { id: 'LED1', kind: 'led', params: model ? { color: 'red', model } : { color: 'red' }, x: 120, y: 0 }],
    wires: [
      { from: 'VCC1', fromTerminal: 'vcc', to: 'R1', toTerminal: 'a' },
      { from: 'R1', fromTerminal: 'b', to: 'LED1', toTerminal: 'anode' },
      { from: 'LED1', fromTerminal: 'cathode', to: 'GND1', toTerminal: 'gnd' },
    ],
  });
  const pwl = build(null); pwl.setPower(true);
  const sh = build('shockley'); sh.setPower(true);
  const a = pwl.branchCurrent('LED1', 'anode');
  const b = sh.branchCurrent('LED1', 'anode');
  return { pwl: a, shockley: b, rel: Math.abs(a - b) / Math.max(a, b) };
}

// ── Main ─────────────────────────────────────────────────────────────

function main() {
  if (!haveNgspice()) {
    console.log('');
    console.log('  ================================================================');
    console.log('  SPICE ORACLE SKIPPED — ngspice is not installed on this machine.');
    console.log('');
    console.log('  Install it (apt-get install ngspice) to run the exporter against');
    console.log('  a real simulator. CI installs it; a skip here is NOT a pass.');
    console.log('  ================================================================');
    console.log('');
    console.log('0 decks simulated - 0 passed - 0 failed - SKIPPED (no ngspice)');
    process.exit(0);
  }

  const ver = spawnSync('ngspice', ['--version'], { encoding: 'utf-8' });
  const verLine = String(ver.stdout || '').split('\n').find(l => /ngspice-/.test(l)) || 'ngspice';
  console.log(`SPICE oracle - ${verLine.trim()}`);
  console.log('');

  const dir = mkdtempSync(join(tmpdir(), 'bw-spice-oracle-'));
  let passed = 0; let failed = 0;
  for (const [name, json] of CASES) {
    let res;
    try {
      res = judgeCase(name, json, dir);
    } catch (e) {
      res = { name, ok: false, lines: [`  threw: ${e && e.stack || e}`] };
    }
    console.log(`${res.ok ? 'PASS' : 'FAIL'}  ${name}`);
    for (const l of res.lines) console.log(l);
    console.log('');
    if (res.ok) passed++; else failed++;
  }

  console.log('Round trip (X1.1): export -> our importer -> re-export, both decks');
  console.log('simulated and compared by their node-voltage spectra.');
  console.log('');
  let rtPassed = 0; let rtFailed = 0;
  for (const [name, json] of CASES) {
    let res;
    try { res = judgeRoundTrip(name, json, dir); }
    catch (e) { res = { name, ok: false, lines: [`  threw: ${e && e.stack || e}`] }; }
    console.log(`${res.ok ? 'PASS' : 'FAIL'}  round-trip ${name}`);
    for (const l of res.lines) console.log(l);
    if (res.ok) rtPassed++; else rtFailed++;
  }
  console.log('');
  failed += rtFailed;
  passed += rtPassed;

  const foreignFiles = existsSync(FIXTURES)
    ? readdirSync(FIXTURES).filter(f => f.endsWith('.cir')).sort() : [];
  console.log('Foreign decks: written in spellings our exporter does not use,');
  console.log('simulated as authored and again after our importer read them.');
  console.log('');
  for (const file of foreignFiles) {
    let res;
    try { res = judgeForeign(file, dir); }
    catch (e) { res = { name: file, ok: false, lines: [`  threw: ${e && e.stack || e}`] }; }
    console.log(`${res.ok ? 'PASS' : 'FAIL'}  foreign ${res.name}`);
    for (const l of res.lines) console.log(l);
    if (res.ok) passed++; else failed++;
  }
  if (!foreignFiles.length) {
    console.log('  NO FOREIGN FIXTURES FOUND — the asymmetric half of the round');
    console.log('  trip did not run. That is not a pass.');
    failed++;
  }
  console.log('');

  const gap = modelGap();
  console.log('Model note (not a gate): the shipped piecewise LED model and the');
  console.log('Shockley model the deck carries differ on the canonical bench by');
  console.log(`  PWL      ${gap.pwl.toExponential(6)} A`);
  console.log(`  Shockley ${gap.shockley.toExponential(6)} A`);
  console.log(`  relative ${(gap.rel * 100).toFixed(3)} %`);
  console.log('');

  if (!KEEP) rmSync(dir, { recursive: true, force: true });
  else console.log(`decks kept in ${dir}`);

  // The count line, last, so a log tail always shows it.
  const total = CASES.length * 2 + foreignFiles.length;
  console.log(`${total} decks simulated - ${passed} passed - ${failed} failed`);
  if (failed > 0 || passed !== total) process.exit(1);
}

if (process.argv[1] && process.argv[1].endsWith('spice-oracle.mjs')) main();

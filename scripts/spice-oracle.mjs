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
import { pinThevenin } from 'bw-board/pin-model.js';
import { getDevice } from 'bw-board';
import { JUNCTION_ROUTING } from 'bw-board/mna.js';
import { extractNetlist } from '../src/model/netlist.js';
import { toSpice } from '../src/model/exporters/spice.js';
import { importSpice } from '../src/importers/spice.js';

/** Agreement required between ngspice and the engine on a shared node. */
const V_TOL_ABS = 5e-3;      // volts
const V_TOL_REL = 0.01;      // 1 %
/** Agreement required on the supply branch current. */
const I_TOL_REL = 0.02;      // 2 %
/**
 * Below this, two answers are both "no current" and a RELATIVE difference
 * between them is not a measurement.
 *
 * Found by the corpus sweep on its first twelve circuits: three idle boards
 * failed with "relative difference 100.000 %" comparing ngspice's 4.34e-18 A
 * against the engine's 9.995e-12 A. Four attoamps against ten picoamps — both
 * are numerical zero, one is ngspice folding an unpowered branch away and the
 * other is our GMIN leakage, and dividing one by the other yields 1 every time.
 *
 * DERIVED, not chosen: the smallest current this corpus meaningfully carries is
 * a UV LED (vf 3.8) on a 3.3 V rail, 20.21 uA. One nanoamp is 20,000x below
 * that and six orders above the leakage being compared here, so it separates
 * "no current" from every real reading without reaching any of them.
 */
const I_ZERO_FLOOR = 1e-9;   // amps

/** Put both external readings on signed current delivered by the VCC supply. */
export function signedSupplyCurrent(spiceBranchInto, nonRailTerminalCurrentsOut) {
  const spiceSupplyOut = -spiceBranchInto;
  const engineSupplyOut = -nonRailTerminalCurrentsOut.reduce((sum, amps) => sum + amps, 0);
  const scale = Math.max(Math.abs(spiceSupplyOut), Math.abs(engineSupplyOut));
  return { spiceSupplyOut, engineSupplyOut,
    relativeDifference: scale ? Math.abs(spiceSupplyOut - engineSupplyOut) / scale : 0 };
}

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

/**
 * Add the parts the ENGINE synthesized but the netlist never saw.
 *
 * `extractNetlist` builds from the UI's part list; the board builds its own,
 * and for some devices it SYNTHESIZES extra analog parts. A Pico grows
 * `pico1_onboard_r` (1 kOhm) and `pico1_onboard` (an LED) hanging off gp25,
 * because the onboard LED is on the PCB whether or not anyone wires it.
 *
 * So the engine solves a circuit with a load the deck does not have, and the
 * comparison is between two different circuits -- the same species as comparing
 * a PWL knee against a Shockley model. Measured on 01-blink/circuit-flat.pico:
 * engine 3.226 V against ngspice 4.921 V at gp25, because in the deck that node
 * drives nothing but the external chain.
 *
 * The board is the authority here, so the missing parts are read from it. The
 * netlist keeps `partId` on every part and node and uses the BOARD's net id as
 * the net id, which is what makes the two addressable against each other; rails
 * are the exception, renamed to GND/VCC, and those are already present.
 *
 * ORACLE PATH ONLY. extractNetlist feeds the KiCad exporter and the UI too, and
 * a synthesized part appearing in a user's exported netlist is a different
 * decision from making a comparison honest.
 */
const SYN_LETTER = {resistor: 'R', led: 'D', diode: 'D', zener: 'D', capacitor: 'C',
  inductor: 'L', npn: 'Q', pnp: 'Q', nmos: 'M', pmos: 'M'};

function withSynthesizedParts(circuit, netlist) {
  const board = circuit.board;
  if (!board || !Array.isArray(board.parts)) return netlist;
  const known = new Set(netlist.parts.map(p => p.partId));
  const missing = board.parts.filter(p => !known.has(p.id) && SYN_LETTER[p.kind]);
  if (!missing.length) return netlist;

  const nets = netlist.nets.map(n => ({...n, nodes: [...n.nodes]}));
  const byId = new Map(nets.map(n => [n.id, n]));
  const parts = [...netlist.parts];
  let seq = 900;
  for (const p of missing) {
    const refdes = `${SYN_LETTER[p.kind]}${seq++}`;
    parts.push({partId: p.id, refdes, kind: p.kind, value: '', valueNumber: null,
      footprint: '', symbol: '', params: {...(p.params || {})}});
    for (const bn of board.nets || []) {
      for (const t of bn.terminals || []) {
        if (t.part !== p.id) continue;
        let net = byId.get(bn.id);
        if (!net) {   // a net that exists only inside the device, e.g. the onboard mid-point
          net = {id: bn.id, name: bn.id, nodes: [], rail: null, railPartId: null};
          nets.push(net); byId.set(bn.id, net);
        }
        net.nodes.push({partId: p.id, refdes, pin: t.terminal});
      }
    }
  }
  return {...netlist, parts, nets};
}

export function judgeCase(name, json, dir, {drivePins = false, driveHigh = true} = {}) {
  const lines = [];
  // ONE MODEL ON BOTH SIDES, THROUGH THE ENGINE'S OWN SWITCH.
  //
  // The exporter can only write Shockley -- the designer's DEFAULT piecewise
  // knee has no SPICE spelling -- while the engine ROUTES per circuit and picks
  // PWL wherever supply headroom is comfortable. Undriven that never showed
  // because nothing conducted; the moment the sweep drove the pins it broke 873
  // circuits that had "agreed", every one the same shape: engine 1.830918 V
  // against ngspice 1.747075 V on a red LED, the PWL answer against the
  // Shockley answer, 2.573 % apart. Widening a tolerance to swallow that would
  // be comparing two devices and calling the difference noise.
  //
  // `JUNCTION_ROUTING.mode` is mna.js's documented escape hatch and it covers
  // EVERY junction, which rewriting `params.model` on the incoming JSON does
  // not: a device synthesizes its own junctions during setNetlist -- a Pico's
  // onboard LED -- and those are created after the JSON is read, so they kept
  // their piecewise routing and left 0.116 V on `pico1__onboard_mid` after
  // everything else was fixed. Re-running setNetlist to re-stamp them is not
  // available either; that duplicates the composite (fixed in bw-board, but not
  // something to lean on from here).
  //
  // Restored in a finally, because it is module-global: leaking 'shockley' into
  // a later caller would silently change what THEY measure.
  const priorRouting = JUNCTION_ROUTING.mode;
  if (drivePins) JUNCTION_ROUTING.mode = 'shockley';
  try {
  const circuit = Circuit.fromJSON(json);
  circuit.setPower(true);
  // Reactive cases need the transient to settle before an operating point
  // means anything (see rc-and-parallel).
  if (json.settleNs) circuit.advanceTo(json.settleNs);

  const netlist = extractNetlist(circuit);

  // A DRIVEN PIN IS A SOURCE, AND WITHOUT ONE MOST OF THE CORPUS IS UNPOWERED.
  //
  // A gallery circuit ships with no program run, so `board.pinStates` is empty
  // and every MCU pin is high-Z: `168p01-blink` is `gnd, resistor, led,
  // arduino_uno` with NO vcc part, so nothing supplies it and there is nothing
  // to oracle. Measured over 2,163 corpus circuits, 127 decks had no source at
  // all for exactly this reason.
  //
  // So the sweep DRIVES. `pinSource` below hands the exporter the same Thevenin
  // the engine solves with, read from the engine's own pin state rather than
  // recomputed here — one definition, so the deck and the solve cannot describe
  // different drivers. Parts the exporter already emitted are excluded by the
  // exporter itself, which is the only place that knows.
  let pinSource = null;
  if (drivePins) {
    const b = circuit.board;
    // WHICH PINS, and the rule is narrow on purpose. Drive only a pin that
    //   (a) belongs to a part the exporter SKIPPED -- driving one it emitted
    //       would put two sources on one node,
    //   (b) shares its net with at least one other node, so it reaches the
    //       analog network at all, and
    //   (c) is not the part's ground or supply pin. Driving `gnd2` high was the
    //       first thing this policy did wrong: an Arduino's ground pin took a
    //       5 V Thevenin, which ngspice solves happily and which is a short
    //       from the rail to the reference, not the board anyone built. The
    //       exporter refuses a node that resolves to 0 as a second line of
    //       defence; this is the first.
    const probe = toSpice(extractNetlist(circuit), 'probe');
    const skippedRef = new Set((probe.skipped || []).map(x => String(x).split(' ')[0]));
    // AND IT MUST ACTUALLY BE A DRIVER. "The exporter skipped it" is not the
    // same claim as "it drives pins": a BUZZER is skipped too, and the first
    // version of this policy called setPin('a') on one, inventing a GPIO out of
    // a passive terminal. On 07-buzzer-siren that put the shared node at
    // 4.000000 V against ngspice's 5.0.
    //
    // The MCU surface is not `kind === 'mcu'` — a dev board is its own kind and
    // declares itself with `gpioFollowsPinStates`, which is what board.js reads
    // in _syncDeviceGpioDrives. Same predicate here, so the sweep and the engine
    // agree about what a pin is.
    const drives = (kind) => kind === 'mcu' || !!getDevice(kind)?.gpioFollowsPinStates;
    const kindByRefdes = new Map(netlist.parts.map(p => [p.refdes, p.kind]));
    // Second line of defence for a power pin that is NOT on a rail net.
    const POWER_PIN = /^(gnd|vss|vcc|vdd|vbus|vsys|v\+|v-|agnd|avcc|aref|vin|3v3|5v|vbat)/i;
    for (const net of netlist.nets) {
      if ((net.nodes || []).length < 2) continue;
      // NEVER DRIVE A PIN THAT SITS ON A SUPPLY RAIL, either rail.
      //
      // The gnd half was here from the start; the vcc half was not, and a name
      // filter is the wrong instrument for it. A Pico's VBUS is a power pin
      // whose name matches none of gnd/vss/vcc/vdd/vin/3v3/5v, so it took a
      // 3.3 V GPIO Thevenin while sitting on the 5 V rail:
      //
      //     VU1_vbus nth_U1_vbus 0 DC 3.3
      //     RU1_vbus nth_U1_vbus VCC 25
      //
      // Two stiff sources 1.7 V apart across R_STRONG — (5 - 3.3)/25 = 68 mA of
      // current that exists in no circuit. Every NODE VOLTAGE still agreed,
      // because both ends are held by sources, so it showed up only as
      // I(supply) 6.834e-2 A against the engine's 3.416e-4: a factor of 200,
      // on 176 Pico circuits.
      //
      // Whether a net is a rail is structural and the netlist already says so,
      // which beats enumerating power-pin spellings — refusal by name needs the
      // reachable set, and nobody has that for every device's pin naming.
      if (net.rail) continue;
      for (const nd of net.nodes) {
        if (!skippedRef.has(nd.refdes)) continue;
        if (!drives(kindByRefdes.get(nd.refdes))) continue;
        if (POWER_PIN.test(String(nd.pin))) continue;
        try { circuit.setPin(nd.pin, 'pushpull', driveHigh); } catch { /* not a pin this board knows */ }
      }
    }
    // THE DEVICE'S LOGIC LEVEL, NOT THE BOARD'S RAIL. `pinThevenin` takes the
    // supply the pin drives to, and board.vcc is the wrong one for any part that
    // is not a 5 V part. A Pico is 3.3 V, and passing 5 V put the deck's pin
    // 1.7 V above the engine's:
    //
    //   engine V(gp25 net) 3.2264 V sourcing 2.944 mA
    //   3.3 - 0.002944*25 = 3.2264   <- exactly, with R_STRONG
    //   5.0 - 0.002944*25 = 4.9264   <- what the deck had, and what ngspice returned
    //
    // The engine reads it as `getDevice(kind).vcc ?? board.vcc`
    // (board.js _syncDeviceGpioDrives), so the freeze reads it the same way
    // rather than keeping a second opinion about how tall a pin is.
    const kindOf = new Map(netlist.parts.map(p => [p.refdes, p.kind]));
    pinSource = (refdes, pin) => {
      const st = b.getPinState ? b.getPinState(pin) : null;
      if (!st) return null;
      const model = getDevice(kindOf.get(refdes));
      const vLogic = (model && model.vcc) ?? b.vcc;
      const th = pinThevenin(st.mode, st.driveHigh, vLogic);
      return (th && th !== 'high-z') ? th : null;   // high-Z contributes no card
    };
  }

  // Re-extract after driving: setPin changes the solve, and a netlist taken
  // before it describes the undriven board.
  const solved = drivePins ? withSynthesizedParts(circuit, extractNetlist(circuit)) : netlist;
  // The board's LIVE controls, not an empty map: an LDR the bench has set to
  // bright is a 100 Ohm part, and a deck built with the default dark control
  // would be a different circuit by four orders of magnitude.
  // A PART WITH NO SPICE CARD MUST NOT SIMPLY VANISH.
  //
  // 42 kinds present the engine an impedance or a source and have no card, in
  // 1,250 of the 2,163 corpus circuits. A skipped `74hc595` left eight LED
  // branches at 0 V in the deck against 1.84 V in the engine; a skipped
  // `buzzer` left its node at the full 5 V rail against the engine's 4.0
  // (5 x 100/125). The deck was a different circuit and ngspice answered about
  // it with total confidence.
  //
  // `deviceCompanions` hands back the companions bw-board's final Newton
  // iteration STAMPED — the same records its own terminal currents are derived
  // from — so the deck carries the engine's DC linearisation of that device
  // verbatim while every OTHER element stays independently judged. That makes
  // these cases `original-adapted`, not `original-direct`.
  //
  // `deviceCompanions` returns a SNAPSHOT, not a list: {converged, timeNs,
  // records}. It reads the board's live solve — the same one nodeVoltage and
  // branchCurrent report — so it can carry transient state, and a
  // non-converged solve is an iterate rather than an answer. The judge compares
  // a bias point, so a non-converged snapshot is refused here rather than
  // exported and silently oracled against.
  const partIdOf = new Map(solved.parts.map(p => [p.refdes, p.partId]));
  const b2 = circuit.board;
  const companionsFor = b2?.deviceCompanions
    ? (refdes) => {
        const id = partIdOf.get(refdes);
        if (!id) return null;
        const snap = b2.deviceCompanions(id);
        if (!snap || snap.converged === false) return null;
        return snap.records;
      }
    : null;
  // The engine's own stored capacitor voltage, read off its own solve rather
  // than from a second opinion: V(a) - V(b) on the nets the cap sits between.
  // See toSpice — `.op` opens a capacitor and the engine holds it, so without
  // this the two solvers are answering different questions and 27 corpus
  // circuits scored as disagreements for that reason alone.
  const netOfPin = new Map();
  for (const net of solved.nets) {
    for (const nd of net.nodes || []) netOfPin.set(`${nd.refdes}\u0000${nd.pin}`, net.id);
  }
  const capacitorVoltage = (refdes) => {
    const na = netOfPin.get(`${refdes}\u0000a`);
    const nb = netOfPin.get(`${refdes}\u0000b`);
    const va = na ? circuit.nodeVoltage(na) : 0;
    const vb = nb ? circuit.nodeVoltage(nb) : 0;
    if (typeof va !== 'number' || typeof vb !== 'number') return null;
    if (!isFinite(va) || !isFinite(vb)) return null;
    return va - vb;
  };
  const { text, warnings } = toSpice(solved, `oracle: ${name}`,
    { pinSource, companionsFor, capacitorVoltage,
      controls: circuit.board?.controls ?? new Map() });

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
  // ANY INDEPENDENT SOURCE, NOT A SYNTHESIZED ONE WITH THE `DC` KEYWORD.
  //
  // This demanded `V... <node> 0 DC <v>`, which is the shape the SYNTHESIZED
  // rail card has. A circuit powered by a `vsource` or a `battery` part emits a
  // real element instead — `V1 bb1:n-col-t3 0 1` — where `DC` is optional in
  // SPICE and the exporter does not write it. So a complete, runnable deck was
  // failed for lacking a spelling:
  //
  //     R1 bb1:n-col-t3 0 1k
  //     V1 bb1:n-col-t3 0 1
  //     .op
  //     .end
  //
  // 113 corpus circuits, every one of them battery- or vsource-powered rather
  // than rail-powered. The check's INTENT — "nothing supplies this deck" — is
  // still worth having and is what it now asserts: at least one independent
  // source of either kind, however it is spelled.
  if (!/^[VI]\S*\s+\S+\s+\S+/m.test(text)) {
    structural.push('no independent source (no V or I element, and no synthesized rail)');
  }
  if (!allTokens.has('0')) structural.push('no node 0 on any element');
  if (groundNetOf(solved) && allTokens.has(groundNetOf(solved))) {
    structural.push(`ground net is spelled '${groundNetOf(solved)}' instead of node 0`);
  }
  if (!/^\.op\s*$/m.test(text)) structural.push('no analysis directive');
  if (!/^\.end\s*$/m.test(text)) structural.push('no .end');
  if (structural.length) {
    lines.push(`  STRUCTURE: ${structural.join('; ')}`);
    return { name, ok: false, lines, compared: 0, reason: 'structure: ' + structural.join('; ') };
  }

  const run = runNgspice(text, dir, name);
  if (run.error) {
    lines.push(`  ngspice REFUSED the deck: ${run.error}`);
    lines.push(...run.raw.split('\n').slice(0, 24).map(l => `    | ${l}`));
    return { name, ok: false, lines, compared: 0, reason: 'ngspice refused: ' + run.error };
  }

  // Node-by-node: the engine's solve for the same net.
  let ok = true;
  let compared = 0;
  // STRUCTURED RESULT ALONGSIDE THE PROSE. A corpus sweep has to aggregate
  // thousands of these, and parsing the human lines to do it would compare a
  // different thing than the judgement did. Both callers read the same fields.
  let worstAbs = 0, worstRel = 0, worstAt = null;
  // `solved`, not `netlist`: the deck was built from the post-drive extraction,
  // and comparing nets from a different one would judge two circuits against
  // each other. Identical objects when drivePins is off.
  for (const net of solved.nets) {
    if (net.name === 'GND' || !net.id) continue;
    const engineV = circuit.nodeVoltage(net.id);
    if (typeof engineV !== 'number' || !isFinite(engineV)) continue;
    const key = net.name.toLowerCase();
    if (!(key in run.nodes)) continue;   // ngspice folds unused nodes away
    compared++;
    const spiceV = run.nodes[key];
    {
      const d = Math.abs(engineV - spiceV);
      const rel = Math.max(Math.abs(engineV), Math.abs(spiceV)) > 0
        ? d / Math.max(Math.abs(engineV), Math.abs(spiceV)) : 0;
      if (d > worstAbs) { worstAbs = d; worstRel = rel; worstAt = net.name; }
    }
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

  // Supply branch current. ngspice's voltage-source branch is positive INTO
  // the source terminal, while the engine's raw reader is positive OUT of
  // every part terminal. Convert both to signed current delivered by the
  // supply; do not compare magnitudes or rely on unlike signs cancelling.
  const branch = Object.entries(run.branches).find(([k]) => k.includes('supply'));
  if (branch) {
    const nonRailCurrentsOut = [];
    // Cross-check by summing only non-rail terminals on the supply net. Their
    // signed OUT currents negate to the current the rail delivers. Including
    // the rail terminal itself would merely sum KCL to zero.
    const supplyNet = solved.nets.find(n => n.rail === 'vcc');
    if (supplyNet) {
      // COUNT THE CONTRIBUTORS, NOT JUST THE SUM. A rail's nodes are often
      // parts whose branch current the engine does not expose — a `vcc` rail is
      // dissolved into a net name, and an MCU pin reports none — so the sum can
      // be 0 because NOTHING ANSWERED rather than because no current flows.
      // Comparing that against ngspice's real reading produced "relative
      // difference 100.000 %" on 375 circuits whose every NODE VOLTAGE agreed
      // to between 1e-6 and 1e-3 V. A zero nobody drove is not a measurement.
      let contributors = 0;
      const kindByPart = new Map(circuit.parts.map(part => [part.id, part.kind]));
      for (const nd of supplyNet.nodes) {
        if (kindByPart.get(nd.partId) === 'vcc') continue;
        const i = circuit.branchCurrent(nd.partId, nd.pin);
        // DEBUG_SUPPLY=1 names the CONTRIBUTORS, not just their sum. Two
        // engine defects were found by reading this list and nothing else: a
        // Pico reporting 34 A on VBUS (a terminal sourced twice) and -3 A on
        // VSYS (a board fighting an ideal rail). A summed current cannot say
        // which pin invented it.
        if (process.env.DEBUG_SUPPLY) console.error(`   [supply] ${nd.partId}.${nd.pin} = ${i}`);
        if (typeof i === 'number' && isFinite(i)) { nonRailCurrentsOut.push(i); contributors++; }
      }
      const { spiceSupplyOut, engineSupplyOut, relativeDifference } =
        signedSupplyCurrent(branch[1], nonRailCurrentsOut);
      lines.push(`  I(supply, OUT) = ${spiceSupplyOut.toExponential(6)} A`);
      if (contributors === 0) {
        lines.push('    the engine exposes no branch current on this rail '
          + `(${supplyNet.nodes.length} node(s), none reporting), so there is nothing to `
          + 'compare against ngspice here — the node voltages above are the comparison');
      } else if (Math.max(Math.abs(spiceSupplyOut), Math.abs(engineSupplyOut)) < I_ZERO_FLOOR) {
        lines.push(`    engine supply OUT ${engineSupplyOut.toExponential(6)} A `
          + `— both below ${I_ZERO_FLOOR} A, so this branch carries no current in either `
          + 'solve and there is no ratio to take');
      } else {
        lines.push(`    engine supply OUT ${engineSupplyOut.toExponential(6)} A `
          + `(relative difference ${(relativeDifference * 100).toFixed(3)} %)`);
        if (relativeDifference > I_TOL_REL) { ok = false; lines.push('    ABOVE TOLERANCE'); }
      }
    }
  }

  if (warnings.length) for (const w of warnings) lines.push(`  export warning: ${w}`);
  return { name, ok, lines, compared, worstAbs, worstRel, worstAt,
    reason: ok ? null : (compared === 0 ? 'nothing compared' : `worst ${worstAbs.toExponential(2)} V at ${worstAt}`) };
  } finally { JUNCTION_ROUTING.mode = priorRouting; }
}

// ── A FOREIGN DECK, JUDGED BY THE SIMULATOR THAT WROTE ITS DIALECT ───
//
// The corpus lane has acquired tens of thousands of valued SPICE decks, and
// almost none of them were reachable: `judgeCase` starts from a bw-circuit-ui
// circuit JSON, and `judgeRoundTrip` starts from one too. Both judge OUR
// decks. A foreign `.cir` had no path in at all, so "how many can we run" was
// a question about the harness, not about the engine.
//
// This closes that. Import the deck, solve it with our engine, run the
// ORIGINAL BYTES through ngspice, and compare node voltages BY NAME — the
// importer keeps the deck's own node names, so there is a shared namespace and
// no need for the order-independent spectrum the round trip uses.
//
// WHAT IT CAN AND CANNOT CLAIM, and the row says which.
//
// A comparison happens at all only when the import reports NO loss and NO
// unmapped part: with either, the case is refused by name, because a deck we
// partly understood is a different circuit and agreeing with it would be worse
// than failing.
//
// Beyond that, the class depends on whether the ANALYSIS was adapted, and the
// returned `evidence` field says so:
//
//   original-direct    the deck already declared `.op` and carried no sweep,
//                      so ngspice answered the source's own question
//   original-adapted   a sweep was commented out and/or `.op` added — an
//                      adapted bias experiment, valuable but NOT the source's
//                      original analysis, even though every device card is
//                      byte-identical
//
// I had been calling the whole set `original-direct` on the strength of the
// bytes being untouched. That was wrong, and not by a little: 10,542 of the
// 12,471 ADI2005 decks carry a sweep card, so the adaptation covers most of the
// population. Byte preservation and analysis preservation are independent.
//
// `thermal` is reported for the same reason. Our engine solves at a FIXED
// thermal voltage; a deck declaring no `.options temp` is solved by ngspice at
// its own default. That mismatch is named rather than silently corrected,
// because injecting our temperature would change the source's stated
// conditions.
//
// @param {string} name
// @param {string} deckText   the foreign deck, verbatim
// @param {string} dir
export function judgeForeignDeck(name, deckText, dir, { libraries = [] } = {}) {
  const lines = [];
  let imported;
  try {
    // `libraries` is SPICE TEXT the CALLER chose to supply. The importer never
    // opens a file: `.include` names a path, and following one means opening
    // whatever a foreign deck points at.
    imported = importSpice(deckText, { libraries });
  } catch (e) {
    return { name, ok: false, lines: [`  importer threw: ${e.message}`], compared: 0,
      reason: 'import-error: ' + e.message };
  }
  if (imported.unmapped.length) {
    return { name, ok: false, compared: 0,
      lines: [`  ${imported.unmapped.length} unmapped part(s): `
        + imported.unmapped.slice(0, 4).map(u => u.ref ?? u.kind ?? '?').join(', ')],
      reason: `unmapped ${imported.unmapped.length}` };
  }
  if (imported.losses.length) {
    return { name, ok: false, compared: 0,
      lines: [`  ${imported.losses.length} semantic loss: `
        + imported.losses.slice(0, 3).map(l => l.reason).join('; ')],
      reason: `loss: ${imported.losses[0].reason}` };
  }
  if (!imported.parts.length) {
    return { name, ok: false, lines: ['  the import produced no parts'], compared: 0,
      reason: 'empty import' };
  }

  // The ENGINE's answer, on the imported circuit.
  let circuit, solved;
  try {
    circuit = Circuit.fromJSON({ parts: imported.parts, wires: imported.wires });
    circuit.setPower(true);
    solved = extractNetlist(circuit);
  } catch (e) {
    return { name, ok: false, lines: [`  engine refused the imported circuit: ${e.message}`],
      compared: 0, reason: 'engine-error: ' + e.message };
  }

  // A `.control` BLOCK IS A PROGRAM, AND THIS RUNS AN UNRESTRICTED LAUNCHER.
  //
  // ngspice's control language has `shell`, `system` and `source`. A deck is
  // therefore executable input, and running foreign bytes through `spawnSync`
  // with no sandbox is a decision, not a default. It was mine, and it was made
  // on the wrong axis: I had reasoned about it as a LICENSING question, and
  // security is independent of licensing — a permissively licensed deck can
  // carry a control block just as easily. (Corpus lane's point; they are right.)
  //
  // Refused BY NAME rather than stripped, because stripping a program is a
  // transformation whose result nobody inspected. Measured on ADI2005 v3:
  // **0 of 12,471 decks carry a `.control` block**, so this costs that corpus
  // nothing — and that is a property of the corpus, not of this function, which
  // is exactly why the guard belongs here before a corpus that does.
  //
  // A deck that needs one belongs in the corpus lane's worker, which rebuilds
  // inert cards under prlimit in a scratch HOME. That is the right tool for it.
  if (/^\s*\.control\b/im.test(deckText)) {
    return { name, ok: false, compared: 0,
      lines: ['  the deck carries a .control block, which is an executable program — '
        + 'refused rather than run through an unrestricted launcher'],
      reason: 'control-block: not run unsandboxed' };
  }

  // NGSPICE's answer, on the ORIGINAL BYTES. Only `.op` is added, and only when
  // the deck declares none.
  //
  // A SWEEP OVERWRITES THE BIAS-POINT TABLE, so a deck carrying one is not
  // reporting the operating point it was written at. `.DC VIN 12.5 17.0 0.1`
  // left ngspice printing V(VIN) = 12.5 — the first sweep step — against the
  // deck's own `VIN VIN 0 DC 15`, and the judge scored a 2.5 V disagreement
  // that was entirely its own doing. The sweeps are commented out, not deleted,
  // and the edit is recorded: a deck we changed is a deck we have to say we
  // changed.
  let text = deckText;
  const edits = [];

  // A LIBRARY MUST BE GIVEN TO BOTH SIDES, OR IT IS NOT A COMPARISON.
  //
  // Resolving a deck's models from an injected library and then handing
  // ngspice the ORIGINAL BYTES asks the two engines different questions:
  // ngspice's `.include` is unfollowed too, so it refuses a deck naming a
  // model it was never given. Measured the first time this ran: the import
  // resolved cleanly and ngspice returned "Error on line 4".
  //
  // So the definitions the import actually USED are spliced in ahead of
  // `.end`, and only those — appending all 2,427 definitions of the LTspice
  // standard libraries to every deck would be slower and would also claim the
  // deck needed them. This is an adaptation and is recorded as one.
  const used = imported.usedLibraries || [];
  if (used.length) {
    const wanted = new Set(used.map(u => `${u.kind}:${u.name}`));
    const picked = [];
    for (const libText of libraries) {
      const lines = String(libText).split(/\r?\n/);
      let keep = null;
      for (const raw of lines) {
        const line = raw.replace(/\s+[$;].*$/, '');
        if (keep) {
          picked.push(raw);
          if (/^\s*\.ends\b/i.test(line)) keep = null;
          continue;
        }
        const sub = /^\s*\.subckt\s+(\S+)/i.exec(line);
        if (sub && wanted.has(`subckt:${sub[1].toLowerCase()}`)) {
          keep = sub[1]; picked.push(raw); continue;
        }
        const mod = /^\s*\.model\s+(\S+)/i.exec(line);
        if (mod && wanted.has(`model:${mod[1].toLowerCase()}`)) picked.push(raw);
        // A continuation belongs to whatever was last kept.
        else if (/^\s*\+/.test(raw) && picked.length) picked.push(raw);
      }
    }
    if (picked.length) {
      const splice = picked.join('\n') + '\n';
      text = /^\s*\.end\s*$/im.test(text)
        ? text.replace(/^\s*\.end\s*$/im, `${splice}.end`)
        : `${text}\n${splice}.end\n`;
      edits.push(`spliced ${used.length} library definition(s) in so ngspice sees them too`);
    }
  }
  const SWEEP = /^\s*\.(ac|dc|tran|noise|tf|four|disto|pz|sens|sp)\b.*$/gim;
  if (SWEEP.test(text)) {
    SWEEP.lastIndex = 0;
    const seen = new Set();
    text = text.replace(SWEEP, (m) => {
      seen.add(m.trim().split(/\s+/)[0].toLowerCase());
      return '* [oracle] ' + m.trim();
    });
    edits.push(`commented out ${[...seen].join(', ')} so the .op table is the bias point`);
  }
  if (!/^\s*\.op\b/im.test(text)) {
    text = text.replace(/^\s*\.end\s*$/im, '.op\n.end');
    if (!/^\s*\.op\b/im.test(text)) text += '\n.op\n.end\n';
    edits.push('added .op to read the bias point');
  }
  if (edits.length) lines.push(`  (deck edited: ${edits.join('; ')})`);

  // THE EVIDENCE CLASS IS A FIELD, NOT A SENTENCE IN A REPORT.
  //
  // Commenting out a sweep and adding `.op` is an ADAPTED BIAS EXPERIMENT even
  // when every device card stays byte-identical — it is not the source's own
  // analysis. I had been calling these cases `original-direct` on the strength
  // of the bytes being untouched, and that was wrong: 10,542 of the 12,471
  // ADI2005 decks carry a sweep card, so the adaptation covers most of the
  // population rather than an edge of it. The row now says which it is, so an
  // aggregate cannot quietly mix them.
  //
  // THERMAL is named for the same reason and NOT silently corrected. Our engine
  // solves at a fixed thermal voltage of 0.02585 V, i.e. 26.826793 C, and a
  // foreign deck that declares no `.options temp` is solved by ngspice at its
  // default 27 C. Injecting our temperature would change the source's stated
  // conditions; leaving it unnamed would hide a systematic offset (a flat
  // +0.686 mV per junction if only `temp` is set, and the full mismatch if
  // neither key is). So it is reported, and a caller that wants strict thermal
  // equality builds a separate native-matched profile.
  const declaresTemp = /^\s*\.options?\b.*\btemp\s*=/im.test(deckText);
  // A DECK RESOLVED AGAINST A LIBRARY IS NOT SELF-CONTAINED, and that is a
  // third evidence class, not a footnote: the comparison then depends on a file
  // the source did not ship, and which ngspice is NOT given (it sees the
  // original bytes and its own `.include`, unfollowed). Saying so is the
  // difference between "this deck agreed" and "this deck agreed once we
  // supplied its models".
  const usedLib = (imported.usedLibraries || []).length > 0;
  const evidence = usedLib ? 'library-resolved'
    : edits.length ? 'original-adapted' : 'original-direct';
  const thermal = declaresTemp ? 'deck-declared' : 'native-fixed-vs-oracle-default';
  const run = runNgspice(text, dir, name.replace(/[^A-Za-z0-9_.-]/g, '_'));
  if (run.error) {
    return { name, ok: false, lines: [`  ngspice refused the deck: ${run.error}`], compared: 0,
      reason: 'ngspice refused: ' + run.error };
  }

  // JOIN THE TWO NAMESPACES THROUGH A TERMINAL, not through a net name.
  //
  // The engine names its nets `net-lgc-1`; the deck calls the same node `vdd`.
  // `netNames` carries the deck's name beside the terminals on it, so one
  // terminal is enough to find the engine net — and no convention has to be
  // shared between an importer and a solver that never agreed on one.
  const netIdOfTerminal = new Map();
  for (const net of solved.nets) {
    for (const nd of net.nodes || []) netIdOfTerminal.set(`${nd.partId}\u0000${nd.pin}`, net.id);
  }
  const deckNets = [];
  for (const dn of imported.netNames || []) {
    let netId;
    for (const t of dn.terminals) {
      netId = netIdOfTerminal.get(`${t.partId}\u0000${t.terminal}`);
      if (netId) break;
    }
    if (netId) deckNets.push({ name: dn.name, id: netId });
  }

  let ok = true, compared = 0, worstAbs = 0, worstRel = 0, worstAt = null;
  for (const net of deckNets) {
    const key = String(net.name || '').toLowerCase();
    if (!key || !(key in run.nodes)) continue;   // ngspice folds unused nodes away
    const engineV = circuit.nodeVoltage(net.id);
    if (typeof engineV !== 'number' || !isFinite(engineV)) continue;
    compared++;
    const spiceV = run.nodes[key];
    const d = Math.abs(engineV - spiceV);
    const rel = d / Math.max(1e-9, Math.abs(spiceV));
    if (d > worstAbs) { worstAbs = d; worstRel = rel; worstAt = net.name; }
    if (d > V_TOL_ABS && rel > V_TOL_REL) {
      ok = false;
      lines.push(`  V(${net.name}): engine ${engineV.toFixed(6)} V  `
        + `ngspice ${spiceV.toFixed(6)} V  delta ${d.toExponential(2)}`);
    }
  }
  if (compared === 0) {
    // A zero you did not drive: no shared node means nothing was measured, and
    // that is a refusal, not agreement.
    return { name, ok: false, lines: ['  no node name is shared between the deck and the '
      + 'imported circuit — nothing was compared'], compared: 0, reason: 'nothing compared' };
  }
  return { name, ok, lines, compared, worstAbs, worstRel, worstAt, evidence, thermal,
    adapted: edits, usedLibraries: imported.usedLibraries || [],
    reason: ok ? null : `worst ${worstAbs.toExponential(2)} V at ${worstAt}` };
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
  if (back.losses.length) {
    lines.push(`  re-import has ${back.losses.length} semantic loss: `
      + back.losses.map(loss => `${loss.ref} (${loss.reason})`).join('; '));
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
  if (back.losses.length) {
    lines.push(`  our importer reported ${back.losses.length} semantic loss: `
      + back.losses.map(loss => `${loss.ref} (${loss.reason})`).join('; '));
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
  // Raw current is positive OUT. Forward LED current enters the anode, so its
  // positive model-comparison magnitude is the explicit negative of the raw
  // anode reading.
  const a = -pwl.branchCurrent('LED1', 'anode');
  const b = -sh.branchCurrent('LED1', 'anode');
  return { pwl: a, shockley: b,
    rel: Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b)) };
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

/**
 * SPICE netlist serializer (.cir).
 *
 * Takes a neutral Netlist (from netlist.js) and produces a deck a real
 * SPICE engine can PARSE AND RUN. That last part is the whole point and it
 * is what the first version of this file did not do: `extractNetlist`
 * dissolves `vcc`/`gnd` parts into net names, so the deck it produced had
 * no node 0, no ground reference, no source and no analysis directive. It
 * loaded and sat there. Four things make a deck runnable and all four are
 * this serializer's job, because nothing upstream knows SPICE:
 *
 *   1. GROUND IS NODE 0. SPICE has no ground element; the reference node is
 *      spelled `0`. Every net carrying a `gnd` part becomes `0`. With no
 *      `gnd` part we follow the engine's own documented fallback (the first
 *      voltage source's negative net is the reference) so the deck is
 *      referenced the same way the solve was.
 *   2. RAILS ARE SOURCES. A `vcc` part is a net name to the engine and a
 *      missing power supply to SPICE. Each distinct supply rail gets a
 *      synthesized `V… <rail> 0 DC <circuit.vcc>` card.
 *   3. AN ANALYSIS IS REQUIRED. A deck with no `.op`/`.tran`/`.dc` computes
 *      nothing. We emit `.op` and a commented `.tran` template sized from
 *      the circuit.
 *   4. VALUES GO THROUGH formatSpiceValue. `formatSi` writes megohms as
 *      `M`, which SPICE reads as milli — see si.js.
 *
 * DIODE AND LED MODELS. The designer's default LED model is piecewise
 * (a knee at Vf with a series rd) and has no SPICE spelling. The deck
 * therefore carries a per-part `.model` derived from the part's OWN Vf
 * using the engine's Shockley calibration — same ideality, same bulk
 * resistance, same "Is chosen so junction + Rs drop exactly Vf at the
 * rated 20 mA" rule (bw-board src/mna.js, shockleyParams). A deck built
 * this way is not merely plausible: it is the same device equations the
 * engine solves, which is what makes scripts/spice-oracle.mjs a real
 * differential oracle rather than a plausibility check.
 *
 * @module
 */

import { PART_SYMBOLS } from '../../data/easyeda-symbols.js';
import { optionsCard } from 'bw-board/ngspice.js';
// THE CARD IS THE ONLY HOME OF AN ELECTRICAL NUMBER (bw-board parts-library):
// a part that names `params.part` takes its junction numbers from the card, and
// every named `.model` body is DERIVED from the same numbers the solver uses.
// Until 2026-09-13 this file kept its own `.model LED ... Rs=5` beside the
// solver's rd = 10 and the exponential path's rs = 2 — three homes, no authority.
// The class defaults for an UN-carded part come from `classDefaults(kind)`, the
// same accessor `mna.js junctionOpts` reads, so the number the deck is written
// with and the number the solve uses have ONE definition. (It replaced
// JUNCTION_RD/SILICON_RD on 2026-09-13: those were the PIECEWISE constants, and
// a deck is the exponential model — importing the wrong one of the two is how
// the spice-oracle job reddened.)
import { spiceModelFor, resolveParams, cardFor, classDefaults, allCards } from 'bw-board/parts-library.js';
import { formatSpiceValue } from '../si.js';
import {
  validateStrictSpiceExpParams, validateStrictSpicePulseParams,
  validateStrictSpicePwlParams, validateStrictSpiceSineParams,
} from '../spice-source.js';
import { controlledResistance } from 'bw-board/mna.js';
import { isExplicitShockleyPart } from '../spice-diode.js';

/** SPICE element types that take a simple two-terminal card */
const TWO_TERMINAL = new Set(['R', 'C', 'L', 'V', 'I', 'F']);

/**
 * Engine defaults for parts whose value param was never set. These are
 * bw-board's own `params.X ?? default` fallbacks (src/mna.js). The old
 * serializer wrote `1` for anything valueless, which turned a default
 * 1 kOhm resistor into 1 Ohm — a deck that runs and lies.
 */
// ldr/ntc are NOT in this table any more. They are resistors whose value is a
// function of a CONTROL rather than a stored number, so `valueNumber` is null
// and a fallback here is a second opinion about the device: this said 1000
// where the engine's own function says 1,000,000 at the default dark control.
// A thousandfold, and it made all 45 LDR circuits in the corpus disagree with
// ngspice. They come from `controlledResistance` in bw-board now — see below.
const ENGINE_DEFAULTS = {
  resistor: 1000, fuse: 1000,
  potentiometer: 10000,
  capacitor: 1e-4, polarized_cap: 1e-4,
  inductor: 1e-3,
};

/** Thermal voltage at 25 C, and the ideality/bulk defaults — bw-board mna.js. */
const VT_25C = 0.02585;

/**
 * Shockley parameters for a junction, calibrated exactly as the engine
 * calibrates it: Is is chosen so that the junction plus its bulk Rs drop
 * `vf` at the rated 20 mA.
 *
 * @param {{kind: string, params: Record<string,*>}} part
 * @returns {{is: number, n: number, rs: number, vf: number}}
 */
export function junctionModel(part) {
  const params = resolveParams(part.params || {});
  const cls = classDefaults(part.kind);
  const n = Number(params.n ?? cls.n ?? 1.0);
  const rs = Number(params.rs ?? cls.rs ?? 0);
  const vf = Number(params.vf ?? cls.vf ?? 0.7);
  const nVt = n * VT_25C;
  let is = params.is;
  if (is === undefined) {
    const vJrated = vf - 0.020 * rs;
    const expVf = Math.exp(Math.min(vJrated / nVt, 80));
    is = 0.020 / Math.max(expVf - 1, 1e-30);
  }
  return { is: Number(is), n, rs, vf };
}

/**
 * Build a node-name map: for each part+pin, find which net it belongs to.
 * Returns a function (refdes, pin) -> netName.
 */
function buildNodeMap(netlist, groundNetName) {
  const map = new Map();  // "refdes:pin" -> netName
  for (const net of netlist.nets) {
    const spiceName = net.name === groundNetName ? '0' : sanitizeNode(net.name);
    for (const node of net.nodes) {
      map.set(`${node.refdes}:${node.pin}`, spiceName);
    }
  }
  return (refdes, pin) => map.get(`${refdes}:${pin}`);
}

/**
 * SPICE node names are whitespace-delimited fields; anything else in them
 * is legal but a leading digit makes a name that reads as a number in some
 * parsers. Prefix those and strip whitespace.
 */
function sanitizeNode(name) {
  const s = String(name).trim().replace(/\s+/g, '_');
  if (s === '0') return '0';
  return /^[0-9]/.test(s) ? `N${s}` : s;
}

/**
 * The lowest periodic source frequency in the circuit, for sizing the
 * `.tran` template. Nothing in the model is required to declare one, so
 * this returns null far more often than not and the caller falls back.
 */
function lowestSourceFrequency(netlist) {
  let lowest = null;
  for (const part of netlist.parts) {
    const p = part.params || {};
    for (const key of ['hz', 'freq', 'frequency', 'hertz']) {
      const v = Number(p[key]);
      if (isFinite(v) && v > 0 && (lowest === null || v < lowest)) lowest = v;
    }
  }
  return lowest;
}

/**
 * Serialize a netlist to a runnable SPICE deck.
 *
 * @param {import('../netlist.js').Netlist} netlist
 * @param {string} [title='BrickWright Circuit']
 * @returns {{ text: string, skipped: string[], warnings: string[] }}
 */
/**
 * THE INTERNAL RESISTANCE THE ENGINE SOLVES WITH IS NOT ALWAYS ON THE CARD.
 *
 * A `battery_aa` in the gallery declares `{volts: 1.45}` and nothing else, and
 * `bw-board/src/devices/named-parts.js` then stamps it with
 * `part.params?.rInternal ?? 0.3` -- so 0.3 Ohm is the value that SOLVED, and it
 * is invisible to anything reading `part.params`. The first version of the
 * EMF/series-R export read only the card, so `75-battery-tester` kept
 * disagreeing: engine 1.429559 V against ngspice's 1.450000 V, the EMF again.
 *
 * So ASK THE ENGINE, which is the rule this exporter already follows for a
 * controlled resistance. `companionsFor` returns the companions the final
 * Newton iteration stamped; a two-terminal source appears as one `between`
 * record carrying `g` and `vth`, and the resistance is `1/g`.
 *
 *     battery_aa {volts: 1.45}
 *       -> [{kind: 'between', tP: 'pos', tN: 'neg', g: 3.3333333, vth: 1.45}]
 *       -> 1/g = 0.3 Ohm, EMF = 1.45 V
 *
 * An AUTHORED `rInternal` wins over a derived one, because a number a person
 * wrote is the one they meant. A derived one is reported as a warning and
 * marked in the deck comment, because taking the engine's linearisation makes
 * this an `original-adapted` export rather than a straight translation -- the
 * same distinction the `companionsFor` path below already draws.
 *
 * Returns null when there is no internal resistance to export, which is the
 * ideal-source case and must stay a single bare V card.
 */
function internalResistanceOf(part, companionsFor) {
  const authored = Number(part.params?.rInternal);
  if (Number.isFinite(authored) && authored > 0) {
    return { rInt: authored, volts: null, source: 'authored' };
  }
  if (!companionsFor) return null;
  let snap = null;
  try { snap = companionsFor(part.refdes); } catch { return null; }
  // A non-converged snapshot is an iterate, not an answer.
  const records = Array.isArray(snap) ? snap
    : (snap && snap.converged !== false ? snap.records : null);
  if (!Array.isArray(records)) return null;
  const between = records.find(r => r && r.kind === 'between'
    && ((r.tP === 'pos' && r.tN === 'neg') || (r.tP === 'neg' && r.tN === 'pos')));
  if (!between) return null;
  const g = Number(between.g);
  const vth = Number(between.vth);
  if (!Number.isFinite(g) || g <= 0) return null;
  const rInt = 1 / g;
  // An ideal source stamps a huge conductance; below a milliohm there is
  // nothing a deck can usefully say and the round-off would dominate.
  if (!(rInt > 1e-3)) return null;
  return { rInt, volts: Number.isFinite(vth) ? Math.abs(vth) : null,
    source: 'engine-companion' };
}

export function toSpice(netlist, title = 'BrickWright Circuit',
  {modelFor = spiceModelFor, pinSource = null, controls = new Map(),
   companionsFor = null, capacitorVoltage = null} = {}) {
  // EVERY `.model` line is derived from the parts library — no literals remain.
  // The last one was `MOSFET`, kept while `cardFor('MOSFET')` could not find the
  // generic card (its key is NMOS_GENERIC) and `spiceModelFor` had no branch for
  // kind `nmos`. Both were fixed upstream on 2026-09-13, so the literal went
  // with them: a literal nothing reaches is a defect that looks like a feature.
  //
  // `modelLine` returns null when a model cannot be produced, and the part loop
  // REFUSES such a part by name instead of writing an element that references a
  // `.model` the deck never defines. That silent state is what this shape
  // produced for `tip120` the moment the literals were replaced by derivation:
  // a deck that reads as complete, exports without a warning, and cannot
  // simulate. An export that cannot run is not a feature.
  const modelLine = name => {
    const m = modelFor(name);
    return m ? `.model ${m.name} ${m.type} (${m.body})` : null;
  };
  // `modelFor` is injectable ONLY so a test can perturb a card and watch the deck
  // move — the proof that models are derived, not copied. Production callers
  // never pass it.
  const skipped = [];
  // Parts the deck DOES export, with a card that is not the engine's device.
  const approximated = [];
  const warnings = [];

  // ── Ground reference ─────────────────────────────────────────────
  // A named `gnd` part wins. With none, mirror the engine's fallback
  // rather than inventing a different one: the first voltage source's
  // negative net becomes the reference.
  const groundNet = netlist.nets.find(n => n.rail === 'gnd');
  const supplyNets = netlist.nets.filter(n => n.rail === 'vcc');
  let groundNetName = groundNet ? groundNet.name : null;

  if (!groundNetName) {
    const vsource = netlist.parts.find(p => p.kind === 'vsource'
      || p.kind === 'battery_9v' || p.kind === 'battery_aa' || p.kind === 'battery_coin');
    const negNet = vsource && netlist.nets.find(n =>
      n.nodes.some(nd => nd.refdes === vsource.refdes && nd.pin === 'neg'));
    if (negNet) {
      groundNetName = negNet.name;
      warnings.push(
        `No gnd part: node 0 is ${vsource.refdes}'s negative net, the same `
        + 'reference the engine falls back to.');
    } else {
      warnings.push(
        'No ground reference in this circuit — no gnd part and no voltage '
        + 'source to fall back on. The deck names no node 0 and SPICE will '
        + 'refuse it. Add a GND part.');
    }
  }

  if (supplyNets.length === 0) {
    warnings.push(
      'No vcc part: nothing supplies this circuit, so the deck has no '
      + 'source. Add a VCC part (or a voltage source) before simulating.');
  }

  const nodeOf = buildNodeMap(netlist, groundNetName);
  const lines = [
    `* ${title}`,
    '* Exported by BrickWright. Ground is node 0; supply rails are',
    '* synthesized as DC sources. Diode/LED models are derived from each',
    '* part\'s forward voltage using the same Shockley calibration the',
    '* designer\'s engine solves with.',
    '',
  ];

  /**
   * Node pairs already fixed by an IDEAL voltage source, as `min\u0000max`.
   *
   * TWO IDEAL SOURCES ACROSS ONE PAIR IS A SINGULAR MATRIX, and the deck was
   * writing seven. `eater6502-full-build` has six decoupling capacitors across
   * VCC and ground; each became `V<ref> VCC 0 DC 5` beside the synthesized
   * `V1_SUPPLY VCC 0 DC 5`, and ngspice answered `singular matrix: check node
   * vc1#branch`, then "Dynamic gmin stepping failed", then printed no node
   * table at all. A deck that cannot run is not a deck.
   *
   * The second source carries no information -- the pair's potential
   * difference is already determined -- so it is dropped rather than
   * reconciled. Where the stored voltage DISAGREES with what already pins the
   * pair, that is a fact about the engine's state and is reported.
   */
  const pinnedPairs = new Map();
  /** Sources dropped because their pair was already pinned -- see `pinnedPairs`. */
  const redundantSources = [];
  const pairKey = (a, b) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);

  // ── Supply rails ─────────────────────────────────────────────────
  const railVolts = typeof netlist.vcc === 'number' ? netlist.vcc : 5;
  if (supplyNets.length) {
    lines.push('* Supply rails (synthesized: the designer models these as rail parts)');
    supplyNets.forEach((net, i) => {
      const railNode = sanitizeNode(net.name);
      lines.push(`V${i + 1}_SUPPLY ${railNode} 0 DC ${formatSpiceValue(railVolts)}`);
      pinnedPairs.set(pairKey(railNode, '0'), { volts: railVolts, by: `V${i + 1}_SUPPLY` });
    });
    lines.push('');
  }

  // ── Elements ─────────────────────────────────────────────────────
  const usedModels = new Set();
  const modelCards = [];
  /** refdes that became a real element, so the freeze below never double-drives one. */
  const emitted = new Set();

  for (const part of netlist.parts) {
    if (part.kind === 'vcvs' || part.kind === 'vccs') {
      const card = part.kind === 'vcvs' ? 'E' : 'G';
      const parameter = part.kind === 'vcvs' ? 'gain' : 'gm';
      const nonIdeal = ['railLow', 'railHigh', 'rout', 'iShort', 'iMax']
        .filter(key => Object.prototype.hasOwnProperty.call(part.params || {}, key));
      const amount = part.params?.[parameter];
      if (typeof amount !== 'number' || !Number.isFinite(amount) || nonIdeal.length) {
        const reason = nonIdeal.length
          ? `non-ideal parameter${nonIdeal.length > 1 ? 's' : ''} ${nonIdeal.join(', ')} not exported`
          : `explicit finite ${parameter} is required`;
        skipped.push(`${part.refdes} (${part.kind}): ${reason}`);
        lines.push(`* ${part.refdes} ${part.kind} — skipped (${reason})`);
        continue;
      }

      const pins = getSpicePins(part.kind, part);
      const nodes = pins.map(pin => nodeOf(part.refdes, pin));
      const floating = pins.filter((pin, i) => !nodes[i]);
      if (floating.length) {
        warnings.push(`${part.refdes} (${part.kind}): pin${floating.length > 1 ? 's' : ''} `
          + `${floating.join(', ')} on no net — left floating in the deck.`);
      }
      const nodeFields = pins
        .map((pin, i) => nodes[i] || `UNCONNECTED_${part.refdes}_${pin}`)
        .join(' ');
      emitted.add(part.refdes);
      lines.push(`${card}${part.refdes.replace(/^[EG]/i, '')} ${nodeFields} ${formatSpiceValue(amount)}`);
      continue;
    }

    const sym = PART_SYMBOLS[part.kind];
    const card = sym ? sym.spiceCard : null;

    if (part.kind === 'opamp') {
      // AN OP-AMP WITH RAILS IS A TABLE, AND SPICE HAS ONE.
      //
      // This kind was omitted from the deck entirely, so `pc54-opamp-follower`
      // refused as `unrepresented-part: U1` -- honest, and a comparison we
      // simply were not having. The engine's stamp is a gain block that CLAMPS
      // at `railLow`/`railHigh`, which a bare `E` card cannot express: an E
      // card is linear forever and would agree only while the output stayed
      // between the rails.
      //
      // A `B` source with `min(max(...))` is exactly the stamp, and an
      // `E ... TABLE` is NOT -- which cost a regression to find out. ngspice's
      // TABLE form ROUNDS ITS CORNERS to keep the derivative continuous, so a
      // breakpoint sitting on the operating point reads the smoothed value
      // rather than the corner: with `(0,0) (50u,5)` and the inputs exactly
      // equal, ngspice answers 0.125 V where the clamp says 0. That is
      // `pc40-opamp-threshold`, a comparator whose inputs sit at 2.5 V each --
      // it AGREED while the op-amp was missing from the deck and went 125 mV
      // out the moment a rounded corner stood in for a sharp one.
      //
      // The B form clamps sharply. Verified against ngspice-42 on the same
      // shape: inputs equal gives 0.000000, +/-1 mV gives the rails, and
      // +30 uV gives 3.000000 V, which is gain x 3e-5 exactly.
      //
      // Every number is READ from the part; the expression's shape is the
      // stamp's own `clamp(gain * dV, railLow, railHigh)`.
      // `nodeFields` is built further down, after the no-card branch this sits
      // in front of, so the three nodes are looked up directly.
      const [nOut, nInp, nInn] = ['out', 'inp', 'inn']
        .map((t) => nodeOf(part.refdes, t) || `UNCONNECTED_${part.refdes}_${t}`);
      const gain = Number(part.params?.gain);
      const railLow = Number(part.params?.railLow ?? 0);
      const railHigh = Number(part.params?.railHigh ?? (netlist.vcc ?? 5));
      if (!(Number.isFinite(gain) && gain > 0) || !Number.isFinite(railLow)
          || !Number.isFinite(railHigh) || railHigh <= railLow) {
        skipped.push(`${part.refdes} (${part.kind}): needs a positive gain and an ordered `
          + 'rail pair to be written as a clamped gain block');
        lines.push(`* ${part.refdes} ${part.kind} — incomplete gain/rail parameters`);
        continue;
      }
      lines.push(`B${part.refdes} ${nOut} 0 V = `
        + `min(max(${gain}*V(${nInp},${nInn}), ${railLow}), ${railHigh})`);
      // THE OUTPUT CURRENT LIMIT IS OPT-IN AND NOT EXPRESSIBLE. Without
      // `iLimit` the card above is a COMPLETE description and nothing is
      // declared; with it, the engine has a region this card does not, so it is
      // declared rather than left to look like a solver disagreement.
      if (Number(part.params?.iLimit) > 0) {
        approximated.push(`${part.refdes} (${part.kind}): the gain and the rails are exact, but `
          + `its ${part.params.iLimit} A output current limit has no SPICE spelling on this `
          + 'card -- a limited output reads as a rail here');
      }
      continue;
    }


    if (!card || card === 'X' || card === 'S') {
      // DECOMPOSE, RATHER THAN VANISH.
      //
      // A part with no SPICE card used to leave the deck entirely, and for a
      // display that is right. For anything that drives current or presents an
      // impedance it is not: the deck then describes a circuit nobody built,
      // and ngspice answers a different question with total confidence.
      // Measured on the corpus — a `74hc595` skipped this way left eight LED
      // branches at 0 V in the deck against 1.84 V in the engine, and a
      // `buzzer` skipped this way left its node at the full 5 V rail against
      // the engine's 4.0 (5 x 100/125, the buzzer being a 100 Ohm load).
      // 42 kinds are in this state, in 1,250 of 2,163 corpus circuits.
      //
      // `companionsFor` hands back the very companions bw-board's final Newton
      // iteration STAMPED for this part — the same records its own terminal
      // currents are derived from. So the deck carries the engine's DC
      // linearisation of the device verbatim, and every OTHER element in the
      // circuit is still judged by ngspice independently. That is the
      // `original-adapted` evidence class, not `original-direct`: the device's
      // internal model is taken as given and says so in the deck.
      const comps = companionsFor ? companionsFor(part.refdes) : null;
      if (comps && comps.length) {
        const emittedCards = emitCompanions(part, comps, nodeOf, warnings);
        if (emittedCards.length) {
          lines.push(`* ${part.refdes} ${part.kind} — no SPICE card; `
            + `${emittedCards.length} companion element(s) from the engine's own stamp`);
          lines.push(...emittedCards);
          emitted.add(part.refdes);
          continue;
        }
      }
      skipped.push(`${part.refdes} (${part.kind}): no SPICE model`);
      lines.push(`* ${part.refdes} ${part.kind} — skipped (no simple SPICE card)`);
      continue;
    }
    emitted.add(part.refdes);

    // IN SPICE THE FIRST CHARACTER OF AN ELEMENT NAME IS ITS TYPE.
    //
    // The deck wrote the netlist's refdes verbatim, and a refdes is a
    // SCHEMATIC convention, not a SPICE one. Two of them collide:
    //
    //   BT1 (battery_aa)  ->  `BT1 net 0 1.45` is a B card, a BEHAVIOURAL
    //                         source, not the V card that was meant. All 14
    //                         `75-battery-tester` circuits had no comparable
    //                         node at all as a result.
    //   Q1  (nmos)        ->  `q1 ... MOS` made ngspice refuse the deck with
    //                         "model type mismatch": a Q card is a BJT, and it
    //                         was handed a MOS model.
    //
    // Both read as a deck problem in someone else's tool rather than as ours.
    // The name keeps the refdes so a reader can still find the part; only the
    // type letter is forced.
    const el = part.refdes.toUpperCase().startsWith(card)
      ? part.refdes : `${card}${part.refdes}`;

    // A potentiometer is three terminals and one element letter. Exported
    // as ONE two-node R at the full value it was neither the wiper the
    // schematic shows nor the two resistors the engine stamps; the wiper
    // net simply vanished from the deck.
    if (part.kind === 'potentiometer' || part.kind === 'trimpot') {
      const total = Number(part.valueNumber ?? ENGINE_DEFAULTS.potentiometer);
      const position = Number.isFinite(part.params?.position) ? part.params.position : 0.5;
      const rAW = Math.max(1, total * (1 - position));
      const rWB = Math.max(1, total * position);
      const na = nodeOf(part.refdes, 'a');
      const nw = nodeOf(part.refdes, 'wiper');
      const nb = nodeOf(part.refdes, 'b');
      const missing = [['a', na], ['wiper', nw], ['b', nb]].filter(([, v]) => !v);
      if (missing.length) {
        warnings.push(`${part.refdes}: ${missing.map(([p]) => p).join(', ')} on no net — `
          + 'that leg is left floating in the deck, as it is in the circuit.');
      }
      lines.push(`* ${part.refdes} potentiometer, wiper at ${position} of travel`);
      lines.push(`R${part.refdes}A ${na || 'UNCONNECTED_' + part.refdes + '_a'} `
        + `${nw || 'UNCONNECTED_' + part.refdes + '_w'} ${formatSpiceValue(rAW)}`);
      lines.push(`R${part.refdes}B ${nw || 'UNCONNECTED_' + part.refdes + '_w'} `
        + `${nb || 'UNCONNECTED_' + part.refdes + '_b'} ${formatSpiceValue(rWB)}`);
      continue;
    }

    const pins = getSpicePins(part.kind, part);
    const nodes = pins.map(p => nodeOf(part.refdes, p));
    const floating = pins.filter((p, i) => !nodes[i]);
    if (floating.length) {
      warnings.push(`${part.refdes} (${part.kind}): pin${floating.length > 1 ? 's' : ''} `
        + `${floating.join(', ')} on no net — left floating in the deck.`);
    }
    const nodeFields = pins
      .map((p, i) => nodes[i] || `UNCONNECTED_${part.refdes}_${p}`)
      .join(' ');

    // AC magnitude/phase describe small-signal excitation; they are not a
    // time waveform and do not replace the independently authored DC value.
    // Preserve both fields exactly so `.op` still sees the DC bias while an
    // external `.ac` analysis can consume the descriptor.
    if ((part.kind === 'vsource' || part.kind === 'isource')
      && Object.prototype.hasOwnProperty.call(part.params || {}, 'acMagnitude')
      && (!part.params?.wave || part.params.wave === 'dc')) {
      const p = part.params || {};
      const dcKey = part.kind === 'vsource' ? 'volts' : 'amps';
      const allowed = new Set([dcKey, 'acMagnitude', 'acPhase']);
      const extra = Object.keys(p).filter(key => !allowed.has(key));
      const phase = p.acPhase ?? 0;
      if (Number.isFinite(p[dcKey]) && Number.isFinite(p.acMagnitude)
          && p.acMagnitude >= 0 && Number.isFinite(phase) && extra.length === 0) {
        lines.push(`${part.refdes} ${nodeFields} DC ${formatSpiceValue(p[dcKey])} `
          + `AC ${formatSpiceValue(p.acMagnitude)} ${formatSpiceValue(phase)}`);
      } else {
        const detail = extra.length ? `; unsupported parameters ${extra.join(', ')}` : '';
        skipped.push(`${part.refdes} (${part.kind}): AC descriptor is not losslessly exportable${detail}`);
        lines.push(`* ${part.refdes} ${part.kind} — skipped (invalid AC descriptor${detail})`);
      }
      continue;
    }

    // A time-varying source must either retain its complete supported shape
    // or be refused. Falling through to valueNumber here used to serialize a
    // waveform as DC while producing a plausible, runnable, different deck.
    if ((part.kind === 'vsource' || part.kind === 'isource')
      && part.params?.wave && part.params.wave !== 'dc') {
      const p = part.params;
      const dc = p.dcBiasOrigin === 'explicit-dc' && Number.isFinite(p.dcValue)
        ? `DC ${formatSpiceValue(p.dcValue)} ` : '';
      const ac = Number.isFinite(p.acMagnitude) && Number.isFinite(p.acPhase ?? 0)
        ? ` AC ${formatSpiceValue(p.acMagnitude)} ${formatSpiceValue(p.acPhase ?? 0)}` : '';
      let emittedWave = null;
      let invalidReason = null;
      if (p.wave === 'sine') {
        const allowed = new Set(['wave', 'volts', 'offset', 'amplitude', 'freq', 'phase']);
        const extra = Object.keys(p).filter(key => !allowed.has(key));
        const phase = p.phase ?? 0;
        if ([p.offset, p.amplitude, p.freq, phase].every(Number.isFinite)
            && p.freq > 0 && phase === 0 && extra.length === 0) {
          emittedWave = `SINE(${[p.offset, p.amplitude, p.freq].map(formatSpiceValue).join(' ')})`;
        } else invalidReason = extra.length ? `unsupported parameters ${extra.join(', ')}`
          : 'native sine requires finite offset/amplitude/frequency and zero phase';
      } else if (p.wave === 'spice-sine') {
        const sine = validateStrictSpiceSineParams(p);
        if (sine.ok) emittedWave = `SINE(${sine.values.map(formatSpiceValue).join(' ')})`;
        else invalidReason = sine.reason;
      } else if (p.wave === 'spice-pulse') {
        const pulse = validateStrictSpicePulseParams(p);
        if (pulse.ok) emittedWave = `PULSE(${pulse.values.map(formatSpiceValue).join(' ')})`;
        else invalidReason = pulse.reason;
      } else if (p.wave === 'spice-pwl') {
        const pwl = validateStrictSpicePwlParams(p);
        if (pwl.ok) emittedWave = `PWL(${pwl.points.flat().map(formatSpiceValue).join(' ')})`;
        else invalidReason = pwl.reason;
      } else if (p.wave === 'spice-exp') {
        const exp = validateStrictSpiceExpParams(p);
        if (exp.ok) emittedWave = `EXP(${exp.values.map(formatSpiceValue).join(' ')})`;
        else invalidReason = exp.reason;
      }
      if (emittedWave) {
        lines.push(`${part.refdes} ${nodeFields} ${dc}${emittedWave}${ac}`);
      } else {
        const detail = invalidReason ? `; ${invalidReason}` : '';
        skipped.push(`${part.refdes} (${part.kind}): time-varying ${String(p.wave)} source is not losslessly exportable${detail}`);
        lines.push(`* ${part.refdes} ${part.kind} — skipped (time-varying source not losslessly exportable${detail})`);
      }
      continue;
    }

    // A CAPACITOR IS AN OPEN IN `.op` AND A HELD VOLTAGE IN THE ENGINE'S
    // INSTANTANEOUS SOLVE. THOSE ARE DIFFERENT QUESTIONS.
    //
    // ngspice's `.op` is the DC steady state: the capacitor is fully charged
    // and carries no current, so it is an open. bw-board's non-transient solve
    // holds the capacitor at its STORED voltage as a source row — the circuit
    // at THIS instant, which at t = 0 is an uncharged cap, i.e. a short.
    //
    // Neither is wrong; they answer different questions, and comparing them
    // scored 27 corpus circuits as disagreements. `29-capacitor-charge` is
    // 5 V -> 10k -> 100uF -> gnd: ngspice says 5 V at the junction (open cap),
    // the engine says 0 V (uncharged cap), and both are right.
    //
    // With `capacitorVoltage` the deck asks the SAME question the engine
    // answered: the cap becomes a source at the voltage the engine holds it at.
    // Opt-in, so an ordinary downloaded deck still carries a real C card and
    // still means "solve the steady state".
    if (card === 'C' && capacitorVoltage) {
      const v = capacitorVoltage(part.refdes);
      if (typeof v === 'number' && isFinite(v)) {
        const [na, nb] = String(nodeFields).trim().split(/\s+/);
        const key = pairKey(na, nb);
        const already = pinnedPairs.get(key);
        if (already !== undefined) {
          // Already pinned: a second ideal source here is a singular branch,
          // not a stronger statement. Dropped, and named, with the numbers so
          // a disagreement between them is visible rather than assumed away.
          lines.push(`* ${part.refdes} ${part.kind} — its stored `
            + `${formatSpiceValue(v)} V is not written: ${na} and ${nb} are already fixed `
            + `at ${formatSpiceValue(already.volts)} V by ${already.by}, and two ideal `
            + 'sources across one pair is a singular matrix');
          redundantSources.push({ ref: part.refdes, kind: part.kind, volts: v,
            nodes: [na, nb], pinnedBy: already.by, pinnedAt: already.volts });
          if (Math.abs(already.volts - v) > 1e-9) {
            warnings.push(`${part.refdes}: the engine holds it at ${v} V while ${already.by} `
              + `fixes the same pair at ${already.volts} V; the deck keeps ${already.by}`);
          }
          continue;
        }
        pinnedPairs.set(key, { volts: v, by: `V${part.refdes}` });
        lines.push(`* ${part.refdes} ${part.kind} — held at the engine's stored voltage, `
          + 'because `.op` would open it and solve a different instant');
        lines.push(`V${part.refdes} ${nodeFields} DC ${formatSpiceValue(v)}`);
        continue;
      }
    }

    // A BATTERY'S INTERNAL RESISTANCE IS WHY A BATTERY IS NOT AN IDEAL SOURCE,
    // AND THE DECK WAS DELETING IT.
    //
    // The engine puts `rInternal` in series between the EMF and `pos`; the deck
    // wrote a bare V card, so ngspice returned the EMF to six decimals every
    // time and the comparison read as an engine error. Measured, 9 V with
    // rInternal = 1 into a 10 Ohm load:
    //
    //   engine                                    8.181818 V
    //   9 * 10/(10+1)                             8.181818 V
    //   deck as a bare V card, ngspice            9.000000 V
    //
    // and with the two cards below ngspice reads 8.181818 V — the same
    // question, the same answer.
    //
    // The irony is where it bit: `pc77-klemmenspannung` and
    // `pc80-quellen-vergleich` are the gallery examples that EXIST to teach
    // terminal voltage versus EMF, and the deck removed the lesson. Four rows
    // of the 47 remaining gallery disagreements.
    //
    // An internal node is introduced rather than folding the resistance into a
    // neighbour, because the EMF is a value a reader must still be able to see:
    // `V(BT1_EMF)` is the cell's 9 V and `V(pos)` is what a meter on the
    // terminals would show. The series resistor takes its own R card name from
    // the refdes so it cannot collide with a part.
    if (TWO_TERMINAL.has(card) && card === 'V'
        && internalResistanceOf(part, companionsFor)) {
      // NAMED `emfVolts`, NOT `emf`. This block briefly had both a destructured
      // `emf` holding the engine's EMF and a local `const emf` holding the NODE
      // NAME, and the local shadowed it -- so the V card's DC value became the
      // string "BT1_EMF" and `formatSpiceValue` rendered it as nothing:
      // `VBT1 BT1_EMF 0 DC` with no value at all. A deck that parses and means
      // something else.
      const { rInt, volts: emfVolts, source: rSource } = internalResistanceOf(part, companionsFor);
      const fields = String(nodeFields).trim().split(/\s+/);
      if (fields.length === 2) {
        const [posNode, negNode] = fields;
        let value = emfVolts ?? part.valueNumber;
        if (value == null) value = ENGINE_DEFAULTS[part.kind] ?? null;
        if (value == null) {
          warnings.push(`${part.refdes} (${part.kind}): no numeric value — `
            + 'internal resistance cannot be exported without an EMF.');
        } else {
          const emfNode = `${part.refdes.toUpperCase()}_EMF`;
          lines.push(`* ${part.refdes} ${part.kind} — EMF at ${emfNode}, `
            + `${formatSpiceValue(rInt)} internal resistance in series to ${posNode}`
            + (rSource === 'engine-companion'
              ? ' (resistance read from the engine\'s own stamp, not the card)' : ''));
          lines.push(`${el} ${emfNode} ${negNode} DC ${formatSpiceValue(value)}`);
          lines.push(`R${part.refdes}_INT ${emfNode} ${posNode} ${formatSpiceValue(rInt)}`);
          emitted.add(`${part.refdes}_INT`);
          if (rSource === 'engine-companion') {
            warnings.push(`${part.refdes} (${part.kind}): internal resistance `
              + `${formatSpiceValue(rInt)} taken from the engine's stamp; the part `
              + 'declares none.');
          }
          continue;
        }
      } else {
        warnings.push(`${part.refdes} (${part.kind}): internal resistance needs exactly `
          + `two nodes, got ${fields.length} — exported as an ideal source.`);
      }
    }

    if (TWO_TERMINAL.has(card)) {
      let value = part.valueNumber;
      // A CONTROLLED PASSIVE'S VALUE IS THE ENGINE'S TO STATE. Asking bw-board
      // rather than keeping a default here is what stops the deck describing a
      // different resistor than the solve.
      if (value == null) {
        const controlled = controlledResistance(
          {id: part.partId, kind: part.kind, params: part.params}, controls);
        if (controlled != null) value = controlled;
      }
      if (value == null) {
        const fallback = ENGINE_DEFAULTS[part.kind];
        if (fallback != null) {
          value = fallback;
          warnings.push(`${part.refdes} (${part.kind}): no value set — the deck uses the `
            + `engine's own default, ${formatSpiceValue(fallback)}.`);
        }
      }
      if (value == null) {
        // No number and no engine default: say so rather than write 1.
        lines.push(`${el} ${nodeFields} ${part.value || '1'}`);
        warnings.push(`${part.refdes} (${part.kind}): no numeric value — deck value is a guess.`);
      } else {
        lines.push(`${el} ${nodeFields} ${formatSpiceValue(value)}`);
      }
    } else if (card === 'D') {
      const modelName = `D_${part.refdes}`;
      const explicitShockleyFields = ['is', 'n', 'rs'].some(key =>
        Object.prototype.hasOwnProperty.call(part.params || {}, key));
      if (part.params?._spiceBlocked) {
        skipped.push(`${part.refdes} (${part.kind}): blocked imported SPICE model is not reinterpreted`);
        lines.push(`* ${part.refdes} ${part.kind} — blocked imported SPICE model`);
        continue;
      }
      if (part.kind === 'diode' && explicitShockleyFields
        && !isExplicitShockleyPart(part)) {
        skipped.push(`${part.refdes} (diode): explicit Shockley export requires only finite IS, N and RS`);
        lines.push(`* ${part.refdes} diode — unsupported Shockley parameters`);
        continue;
      }
      const j = junctionModel(part);
      const extra = part.kind === 'zener' && part.params?.vz
        ? ` BV=${formatSpiceValue(Number(part.params.vz))}` : '';
      modelCards.push(`.model ${modelName} D (Is=${j.is.toExponential(6)} N=${j.n} `
        + `Rs=${j.rs}${extra})  $ Vf=${j.vf} V at 20 mA`);
      usedModels.add(modelName);
      lines.push(`${el} ${nodeFields} ${modelName}`);
    } else if (part.kind === 'tip120') {
      // A DARLINGTON DRIVER IS A SWITCH, AND SPICE HAS ONE.
      //
      // This kind used to be exported as `.model <X> NPN (Bf=1000 Is=1e-12)`
      // and DECLARED an approximation, because bw-board's stamp is not an
      // Ebers-Moll device: it is a base resistance plus a threshold switch that
      // conducts when Vbe exceeds `vbe` and clamps Vce through `rceSat`, and it
      // draws no base current at all. Measured on `33-inductive-no-flyback`,
      // the largest disagreement the gallery had: our base sat at 4.949270 V
      // against ngspice's 0.696071 V, a 4.25 V gap between two different
      // devices.
      //
      // ngspice has exactly those two elements, so the deck can say what the
      // engine solves instead of apologising for not saying it: a resistor and
      // an `S` voltage-controlled switch with a `SW` model. Verified against
      // ngspice-42 directly -- `S1 c 0 ctl 0 SWMOD` with `SW(VT=1.4 RON=2
      // ROFF=1e12)` and the control above VT puts a 100 Ohm load's node at
      // 5*2/102 = 0.098039 V, which is the stamp's own arithmetic.
      //
      // Every number is READ, none typed: `vbe`, `rceSat` and `rBase` come from
      // the part or from `classDefaults('tip120')`, which is where bw-board's
      // stamp reads them too. `rBase` was a literal inside the stamp
      // (`R_INPUT / 10`) that no exporter could see, and declaring it is what
      // made this emission possible at all.
      const [nColl, nBase, nEmit] = String(nodeFields).trim().split(/\s+/);
      const d = classDefaults('tip120') || {};
      const vt = Number(part.params?.vbe ?? d.vbe);
      const ron = Number(part.params?.rceSat ?? d.rceSat);
      const rBase = Number(part.params?.rBase) > 0 ? Number(part.params.rBase) : Number(d.rBase);
      if (![vt, ron, rBase].every(Number.isFinite)) {
        skipped.push(`${part.refdes} (${part.kind}): the switch threshold, saturation `
          + 'resistance or base resistance is not a finite number');
        lines.push(`* ${part.refdes} ${part.kind} — incomplete switch parameters`);
        continue;
      }
      // OFF is 1 TOhm, the same value this exporter already writes for an open
      // switch companion. The stamp leaves NO collector-emitter path when off,
      // and an exactly-infinite resistance is not a thing a deck can say.
      lines.push(`RB${part.refdes} ${nBase} ${nEmit} ${formatSpiceValue(rBase)}`);
      lines.push(`S${part.refdes} ${nColl} ${nEmit} ${nBase} ${nEmit} SW_${part.refdes}`);
      modelCards.push(`.model SW_${part.refdes} SW(VT=${vt} RON=${ron} ROFF=1e12)`
        + `  $ Darlington threshold ${vt} V, Vce(sat) resistance ${ron} Ohm`);
      usedModels.add(`SW_${part.refdes}`);
      continue;
    } else if (card === 'Q') {
      // A named part (params.part) is the card's model. A BARE class resolves to
      // the GENERIC CARD OF ITS KIND, and only then to the symbol table's name.
      //
      // The symbol table used to be the whole answer, and it named part
      // numbers: `2N2222` for npn, `2N2907` for pnp. Both carry Bf = 200, while
      // bw-board's default for a transistor with no params is 100 — so an
      // unconfigured transistor was exported as a device the engine does not
      // solve. Measured on `10-motor-speed`: engine collector 0.912 V (still
      // active at Bf = 100), ngspice 0.147 V (saturated at Bf = 200), 15.8 % on
      // supply current across 15 corpus circuits. It read as a model gap until
      // the two betas were compared.
      //
      // Resolved from the LIBRARY rather than by renaming the symbol-table
      // entry, because that name would then have to exist at every pin this
      // repo can be built against. `genericCardOf` finds nothing for a kind
      // with no generic card and the symbol table still answers — which is what
      // happens for `pnp` before bw-board e175bf4, where `Q_DEFAULT_PNP` does
      // not yet exist.
      const named = cardFor(part.params?.part) || genericCardOf(part.kind);
      const model = (named && named.id) || (sym && sym.spiceModel);
      if (!model || !modelLine(model)) {
        skipped.push(`${part.refdes} (${part.kind}): no \`.model\` line can be produced`
          + `${model ? ` for '${model}'` : ''} — the deck would reference a model it never defines`);
        lines.push(`* ${part.refdes} ${part.kind} — no model`);
        continue;
      }
      // AN AUTHORED BETA THE CARD DOES NOT CARRY IS STILL WHAT THE SOLVER USES.
      //
      // The card is resolved by NAME -- `params.part`, else the kind's generic
      // card -- and its Bf is written. A part carrying `beta` in its own params
      // and no `params.part` therefore got the GENERIC Bf while bw-board's stamp
      // solved the authored number. Measured on `44-darlington-motor`: the part
      // says beta 1000, the deck said `Bf=100`, and the comparison was between
      // two different transistors.
      //
      // So the authored value wins, in a per-part model card -- the same shape
      // the diode branch above already uses, and per-part because two BJTs with
      // different betas must not collide on one name. The card's own body is
      // the base, so everything else about the device still comes from the
      // library rather than from literals here.
      //
      // The population is small and was measured before the change: 2 of the 79
      // gallery circuits carrying a BJT have a part beta the deck contradicts,
      // and both already disagreed, so this costs no agreement anywhere.
      const authoredBeta = Number(part.params?.beta);
      const cardBeta = Number(named?.params?.beta);
      const base = modelFor(model);
      // AND THE SAME RULE FOR THE EARLY VOLTAGE, for the same reason.
      //
      // bw-board's Ebers-Moll stamp reads `params.vaf` and raises the transport
      // current by (1 - Vbc/VAF). A part carrying `vaf` whose deck does not
      // declare it is the authored-beta defect again with a different field:
      // the engine solves one transistor and ngspice solves another. Measured:
      // 700 ADI2005 v2 decks declare VAF on a BJT, 82 of them disagreed with
      // ngspice without the term and none with it, and on the "BJT Emitter
      // Follower" family it is worth 15.7 mV of base voltage -- 30x the
      // comparator's tolerance.
      //
      // No card in the parts library declares VAF today, so `cardVaf` is NaN
      // and the deck gains a `Vaf=` field only where a part authored one. That
      // keeps this identity for every shipped circuit while making the deck and
      // the solver agree the moment one does.
      const authoredVaf = Number(part.params?.vaf);
      const cardVaf = Number(/Vaf\s*=\s*([\d.eE+-]+)/i.exec(base?.body ?? '')?.[1]);
      const authoredRb = Number(part.params?.rb);
      const cardRb = Number(/Rb\s*=\s*([\d.eE+-]+)/i.exec(base?.body ?? '')?.[1]);
      const betaDiffers = Number.isFinite(authoredBeta) && Number.isFinite(cardBeta)
        && authoredBeta !== cardBeta && base && /Bf\s*=/i.test(base.body);
      const vafDiffers = Number.isFinite(authoredVaf) && authoredVaf > 0
        && authoredVaf !== cardVaf && base;
      // Omitted and explicit zero RB are the old ideal-base path and retain
      // the shared card byte for byte.  A positive authored value must cross
      // the exporter: otherwise ngspice receives a different transistor than
      // the native solver stamped.
      const rbDiffers = Number.isFinite(authoredRb) && authoredRb > 0
        && authoredRb !== cardRb && base;
      if (betaDiffers || vafDiffers || rbDiffers) {
        const perPart = `Q_${part.refdes}`;
        const why = [];
        let body = base.body;
        if (betaDiffers) {
          body = body.replace(/Bf\s*=\s*[\d.eE+-]+/i, `Bf=${authoredBeta}`);
          why.push(`authored beta ${authoredBeta}, not card ${model}'s ${cardBeta}`);
        }
        if (vafDiffers) {
          body = /Vaf\s*=/i.test(body)
            ? body.replace(/Vaf\s*=\s*[\d.eE+-]+/i, `Vaf=${authoredVaf}`)
            : `${body} Vaf=${authoredVaf}`;
          why.push(`authored Early voltage ${authoredVaf}`
            + `${Number.isFinite(cardVaf) ? `, not card ${model}'s ${cardVaf}` : ', which the card does not state'}`);
        }
        if (rbDiffers) {
          body = /Rb\s*=/i.test(body)
            ? body.replace(/Rb\s*=\s*[\d.eE+-]+/i, `Rb=${authoredRb}`)
            : `${body} Rb=${authoredRb}`;
          why.push(`authored base resistance ${authoredRb}`
            + `${Number.isFinite(cardRb) ? `, not card ${model}'s ${cardRb}` : ', which the card does not state'}`);
        }
        modelCards.push(`.model ${perPart} ${base.type} (${body})  $ ${why.join('; ')}`);
        usedModels.add(perPart);
        lines.push(`${el} ${nodeFields} ${perPart}`);
      } else {
        usedModels.add(model);
        lines.push(`${el} ${nodeFields} ${model}`);
      }
        } else if (card === 'M') {
      const nmosGroundBulk = part.params?.bulkAtGround === true
        && !Object.prototype.hasOwnProperty.call(part.params || {}, 'bulkOnSource');
      const nmosSourceBulk = part.params?.bulkOnSource === true
        && !Object.prototype.hasOwnProperty.call(part.params || {}, 'bulkAtGround');
      const explicitNmos = part.kind === 'nmos' && part.params?.model === 'level1'
        && (nmosGroundBulk || nmosSourceBulk);
      const explicitPmos = part.kind === 'pmos' && part.params?.model === 'level1'
        && pins.includes('bulk');
      if (explicitNmos) {
        const hasGamma = Object.prototype.hasOwnProperty.call(part.params ?? {}, 'gamma');
        const hasPhi = Object.prototype.hasOwnProperty.call(part.params ?? {}, 'phi');
        const bodyEffect = hasGamma && hasPhi;
        const required = ['vth', 'kp', 'w', 'l', 'lambda',
          ...(bodyEffect ? ['gamma', 'phi'] : [])];
        const missing = required.filter(key => !Number.isFinite(Number(part.params?.[key])));
        const invalid = Number(part.params?.vth) <= 0 || Number(part.params?.kp) <= 0
          || Number(part.params?.w) <= 0 || Number(part.params?.l) <= 0
          || Number(part.params?.lambda) < 0
          || hasGamma !== hasPhi
          || (bodyEffect && (Number(part.params?.gamma) < 0 || Number(part.params?.phi) <= 0));
        if (missing.length || invalid) {
          const reason = 'exact known-bulk NMOS export requires finite VTO/KP/W/L/LAMBDA, '
            + 'positive VTO/KP/W/L and non-negative LAMBDA';
          skipped.push(`${part.refdes} (${part.kind}): ${reason}`);
          lines.push(`* ${part.refdes} ${part.kind} — skipped (${reason})`);
          continue;
        }
        const perPart = `NM_${String(part.refdes).replace(/[^A-Za-z0-9_]/g, '_')}`;
        modelCards.push(`.model ${perPart} NMOS (LEVEL=1 VTO=${formatSpiceValue(part.params.vth)} `
          + `KP=${formatSpiceValue(part.params.kp)} LAMBDA=${formatSpiceValue(part.params.lambda)}`
          + `${bodyEffect ? ` GAMMA=${formatSpiceValue(part.params.gamma)} PHI=${formatSpiceValue(part.params.phi)}` : ''})`);
        const bulkNode = nmosSourceBulk ? nodes[2] : '0';
        lines.push(`${el} ${nodeFields} ${bulkNode} ${perPart} W=${formatSpiceValue(part.params.w)} `
          + `L=${formatSpiceValue(part.params.l)}`);
        continue;
      }
      if (explicitPmos) {
        if (!nodes[3]) {
          const reason = 'exact explicit-bulk PMOS export requires a connected bulk terminal';
          skipped.push(`${part.refdes} (${part.kind}): ${reason}`);
          lines.push(`* ${part.refdes} ${part.kind} — skipped (${reason})`);
          continue;
        }
        const required = ['vth', 'kp', 'w', 'l', 'lambda'];
        const missing = required.filter(key => !Number.isFinite(Number(part.params?.[key])));
        const invalid = Number(part.params?.kp) <= 0 || Number(part.params?.w) <= 0
          || Number(part.params?.l) <= 0 || Number(part.params?.lambda) < 0;
        if (missing.length || invalid) {
          const reason = 'exact explicit-bulk PMOS export requires finite VTO/KP/W/L/LAMBDA, '
            + 'positive KP/W/L and non-negative LAMBDA';
          skipped.push(`${part.refdes} (${part.kind}): ${reason}`);
          lines.push(`* ${part.refdes} ${part.kind} — skipped (${reason})`);
          continue;
        }
        const perPart = `PM_${String(part.refdes).replace(/[^A-Za-z0-9_]/g, '_')}`;
        modelCards.push(`.model ${perPart} PMOS (LEVEL=1 VTO=${formatSpiceValue(part.params.vth)} `
          + `KP=${formatSpiceValue(part.params.kp)} LAMBDA=${formatSpiceValue(part.params.lambda)})`);
        lines.push(`${el} ${nodeFields} ${perPart} W=${formatSpiceValue(part.params.w)} `
          + `L=${formatSpiceValue(part.params.l)}`);
        continue;
      }
      // A SPICE M CARD TAKES FOUR NODES: drain gate source BULK. With three,
      // ngspice refuses the deck outright — "not enough nodes" — which is how
      // both `pc39-nmos-switch` circuits failed. A discrete MOSFET has its bulk
      // tied to its source internally, and bw-board's model has no separate
      // bulk terminal, so the source node is the truthful fourth: writing
      // anything else would be a body diode the engine does not solve.
      const bulk = nodes[2] || `UNCONNECTED_${part.refdes}_source`;
      if (!modelLine('MOSFET')) {
        skipped.push(`${part.refdes} (${part.kind}): no \`.model\` line can be produced for `
          + "'MOSFET' — the deck would reference a model it never defines");
        lines.push(`* ${part.refdes} ${part.kind} — no model`);
        continue;
      }
      usedModels.add('MOSFET');
      lines.push(`${el} ${nodeFields} ${bulk} MOSFET`);
    } else {
      skipped.push(`${part.refdes} (${part.kind}): unsupported card '${card}'`);
      lines.push(`* ${part.refdes} ${part.kind} — unsupported`);
    }
  }

  // ── Models ───────────────────────────────────────────────────────
  const shared = [...usedModels].sort().map(modelLine).filter(Boolean);
  if (modelCards.length || shared.length) {
    lines.push('');
    lines.push('* Device models');
    // Only the models this deck actually references: a .model nothing uses
    // is noise, and some parsers warn on it.
    lines.push(...modelCards, ...shared);
  }

  // ── Frozen pins: a driven pin is a source behind a resistance ────
  //
  // OPT-IN, and off for ordinary exports. A part with no SPICE card is skipped
  // above and simply vanishes from the deck — which is right for a display and
  // WRONG for anything that drives current, because the deck then models a
  // circuit nobody built. Measured on 2,163 corpus circuits: 625 disagreed with
  // ngspice and every failure shape pointed here — 127 decks had no source at
  // all because the supply was an MCU pin, and the rest read nodes the engine
  // drives and the deck leaves floating.
  //
  // At a DC operating point such a pin IS a Thevenin source, which is what the
  // engine itself solves (`bw-board/src/pin-model.js`, `pinThevenin`). The
  // caller supplies `pinSource(refdes, pin)` because the STATE is the engine's,
  // not the netlist's; the exporter only knows which refdes it already emitted
  // and must not drive twice.
  //
  // Gated behind the oracle path deliberately. Turning it on for ordinary
  // exports changes every deck a user has ever downloaded, and that decision
  // waits until the sweep is green.
  if (pinSource) {
    const frozen = [];
    for (const net of netlist.nets) {
      if (net.name === groundNetName) continue;
      for (const nd of net.nodes || []) {
        if (emitted.has(nd.refdes)) continue;
        const th = pinSource(nd.refdes, nd.pin);
        if (!th || typeof th.vTh !== 'number' || typeof th.rTh !== 'number') continue;
        // `nodeOf` is keyed by refdes:pin, not by net name. Calling it with the
        // net name returned undefined and produced `R... nth_U1_d13 undefined 25`
        // -- a deck ngspice parses as a node literally named "undefined", which
        // simulates and is silently a different circuit.
        const node = nodeOf(nd.refdes, nd.pin);
        if (!node) continue;
        // NEVER DRIVE GROUND. A part's ground pin is on node 0; a Thevenin
        // source across it is a short from the supply to the reference, which
        // ngspice solves happily and which is not the circuit anyone built.
        if (node === '0') continue;
        const tag = `${nd.refdes}_${nd.pin}`.replace(/[^A-Za-z0-9_]/g, '_');
        const mid = `nth_${tag}`;
        frozen.push(`V${tag} ${mid} 0 DC ${formatSpiceValue(th.vTh)}`);
        frozen.push(`R${tag} ${mid} ${node} ${formatSpiceValue(th.rTh)}`);
      }
    }
    if (frozen.length) {
      lines.push('* Frozen pins (Thevenin equivalents of driven pins at this operating point)');
      lines.push(...frozen, '');
    }
  }

  // ── Analysis ─────────────────────────────────────────────────────
  const hz = lowestSourceFrequency(netlist);
  const tranStop = hz ? 10 / hz : 0.01;
  const tranStep = tranStop / 1000;
  lines.push('');
  // THE DECK MUST NAME THE TEMPERATURE IT WAS CALIBRATED AT, AND BOTH KEYS.
  //
  // Every `.model` body in this file is derived from a junction calibration at
  // the engine's own thermal voltage, 0.02585 V, which is 26.826793 C — not
  // ngspice's default 27. A deck with no `.options` line is therefore solved at
  // a temperature its own models were not written for, and 2,163 corpus
  // comparisons ran that way before this line existed.
  //
  // BOTH `temp` AND `tnom` ARE REQUIRED. `temp` alone leaves a flat +0.686 mV
  // at every current, because Is is rescaled from the TNOM = 27 default through
  // the bandgap law — a measured offset, not a rounding. `optionsCard` in
  // bw-board writes both from one constant, so the deck and the solve cannot
  // name different temperatures.
  lines.push('* The temperature the models above were calibrated at. Both keys:');
  lines.push('* temp alone rescales Is from the TNOM default and shifts every junction.');
  lines.push(optionsCard());
  lines.push('');
  lines.push('* Analysis. .op is the bias point the designer\'s bench shows.');
  lines.push('.op');
  lines.push(hz
    ? `* Transient over 10 periods of the lowest source frequency (${hz} Hz):`
    : '* Transient template — no periodic source declared, so 10 ms:');
  lines.push(`*.tran ${formatSpiceValue(tranStep)} ${formatSpiceValue(tranStop)}`);
  lines.push('');
  if (warnings.length) {
    lines.push('* Warnings from the export:');
    for (const w of warnings) lines.push(`*   ${w}`);
    lines.push('');
  }
  lines.push('.end');

  return { text: lines.join('\n') + '\n', skipped, warnings, approximated, redundantSources };
}

/**
 * Turn one part's stamped companions into SPICE cards.
 *
 * The record shapes are bw-board's (`src/mna.js`, `stampDevice`'s `rec`), and
 * each one has exactly one faithful spelling:
 *
 *   cond    {tA, tB, g}        internal current tA -> tB through g
 *                              ->  R  <netA> <netB> <1/g>
 *   norton  {t, g, vth}        Thevenin vth behind 1/g, referenced to GROUND
 *                              ->  V <mid> 0 DC <vth> ; R <mid> <netT> <1/g>
 *   between {tP, tN, g, vth}   the same, floating: vth raises tP above tN
 *                              ->  V <mid> <netN> DC <vth> ; R <mid> <netP> <1/g>
 *   inject  {t, amps}          amps pushed INTO the net at t
 *                              ->  I 0 <netT> <amps>
 *
 * A companion whose terminal is on no net is DROPPED with a warning, not
 * written against an invented node: the engine did not stamp that leg either
 * (`stampTwoTerminal` no-ops unless both legs are netted), so dropping it is
 * what keeps the two circuits the same one.
 *
 * A ground terminal has no matrix row in the engine and node 0 in the deck, so
 * it needs no special case here — `nodeOf` returns '0' and the card is right.
 *
 * @param {{refdes: string, kind: string}} part
 * @param {Array<Record<string, *>>} comps
 * @param {(refdes: string, pin: string) => string | undefined} nodeOf
 * @param {string[]} warnings
 * @returns {string[]}
 */
/**
 * The generic card for a kind, if the library ships one.
 *
 * `generic: true` marks a card that is a CLASS rather than a part number —
 * `Q_DEFAULT` for npn, `Q_DEFAULT_PNP` for pnp, `NMOS_GENERIC` for nmos. Its
 * numbers are the ones the solver uses for a part with no params, which is
 * exactly what an un-carded part must export as.
 *
 * Derived from the library each call rather than tabulated here: a table of
 * kind -> generic id is a second home for a fact the cards already carry, and
 * it would be wrong the day a kind gains or loses one.
 */
function genericCardOf(kind) {
  return allCards().find(c => c.generic && c.kind === kind) ?? null;
}

function emitCompanions(part, comps, nodeOf, warnings) {
  const out = [];
  const ref = part.refdes.replace(/[^A-Za-z0-9_]/g, '_');
  const nodeFor = (pin) => nodeOf(part.refdes, pin);
  let n = 0;
  for (const c of comps) {
    n++;
    const tag = `${ref}_c${n}`;
    if (c.kind === 'cond') {
      const a = nodeFor(c.tA), b = nodeFor(c.tB);
      if (!a || !b) {
        warnings.push(`${part.refdes} (${part.kind}): companion ${c.tA}-${c.tB} has a leg on no `
          + 'net, so it is left out of the deck exactly as the engine left it out of the solve.');
        continue;
      }
      if (!(c.g > 0)) continue;
      out.push(`R${tag} ${a} ${b} ${formatSpiceValue(1 / c.g)}`);
    } else if (c.kind === 'norton') {
      const t = nodeFor(c.t);
      if (!t || !(c.g > 0)) continue;
      // A source onto node 0 is a short across the reference, not a circuit.
      if (t === '0') continue;
      out.push(`V${tag} nth_${tag} 0 DC ${formatSpiceValue(c.vth)}`);
      out.push(`R${tag} nth_${tag} ${t} ${formatSpiceValue(1 / c.g)}`);
    } else if (c.kind === 'between') {
      const p2 = nodeFor(c.tP), nn = nodeFor(c.tN);
      if (!p2 || !nn || !(c.g > 0)) continue;
      out.push(`V${tag} nth_${tag} ${nn} DC ${formatSpiceValue(c.vth)}`);
      out.push(`R${tag} nth_${tag} ${p2} ${formatSpiceValue(1 / c.g)}`);
    } else if (c.kind === 'inject') {
      const t = nodeFor(c.t);
      if (!t || t === '0' || !c.amps) continue;
      // SPICE I flows from the first node through the source to the second,
      // so it LEAVES at the second node — which is the terminal being fed.
      out.push(`I${tag} 0 ${t} DC ${formatSpiceValue(c.amps)}`);
    } else {
      warnings.push(`${part.refdes} (${part.kind}): companion kind '${c.kind}' has no SPICE `
        + 'spelling here, so this part is not fully represented in the deck.');
    }
  }
  return out;
}

/**
 * Get ordered terminal names for SPICE output.
 * For two-terminal parts: [positive, negative].
 * For transistors: [collector, base, emitter] (BJT) or [drain, gate, source] (MOS).
 * For diodes: [anode, cathode].
 */
function getSpicePins(kind, part = null) {
  switch (kind) {
    case 'resistor': case 'ldr': case 'ntc': case 'fuse':
      return ['a', 'b'];
    case 'capacitor': case 'polarized_cap':
      return ['a', 'b'];
    case 'inductor':
      return ['a', 'b'];
    case 'diode': case 'zener':
      return ['anode', 'cathode'];
    case 'led':
      return ['anode', 'cathode'];
    case 'npn': case 'pnp': case 'tip120':
      return ['collector', 'base', 'emitter'];
    case 'pmos':
      if (part?.params?.model === 'level1') {
        return ['drain', 'gate', 'source', 'bulk'];
      }
      return ['drain', 'gate', 'source'];
    case 'nmos':
      return ['drain', 'gate', 'source'];
    case 'vsource': case 'battery_9v': case 'battery_aa':
      return ['pos', 'neg'];
    case 'isource':
      // SPICE positive I-card current flows first node -> second node, while
      // bw-board positive isource current flows neg -> pos.
      return ['neg', 'pos'];
    case 'opamp':
      // The E card's own order: output pair first, then the controlling pair.
      // The engine's op-amp has a single-ended output referenced to ground, so
      // the second output node is the reference and is written as `0`.
      return ['out', 'inp', 'inn'];
    case 'vcvs':
      return ['outp', 'outn', 'inp', 'inn'];
    case 'vccs':
      // SPICE G flows first output node -> second; native positive gm flows
      // outn -> outp, so this is the inverse of native terminal display order.
      return ['outn', 'outp', 'inp', 'inn'];
    case 'potentiometer':
      // Handled as two resistors in toSpice; kept for callers that ask.
      return ['a', 'wiper', 'b'];
    case 'buzzer': case 'dc_motor':
      return ['a', 'b'];
    default:
      return ['a', 'b'];
  }
}

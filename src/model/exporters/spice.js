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
import { formatSpiceValue } from '../si.js';

/** SPICE element types that take a simple two-terminal card */
const TWO_TERMINAL = new Set(['R', 'C', 'L', 'V', 'I', 'F']);

/**
 * Engine defaults for parts whose value param was never set. These are
 * bw-board's own `params.X ?? default` fallbacks (src/mna.js). The old
 * serializer wrote `1` for anything valueless, which turned a default
 * 1 kOhm resistor into 1 Ohm — a deck that runs and lies.
 */
const ENGINE_DEFAULTS = {
  resistor: 1000, ldr: 1000, ntc: 1000, fuse: 1000,
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
  const params = part.params || {};
  const n = Number(params.n ?? (part.kind === 'led' ? 1.8 : 1.0));
  const rs = Number(params.rs ?? 2);
  const vf = Number(params.vf ?? (part.kind === 'led' || part.kind === 'rgb_led' ? 2.0 : 0.7));
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
export function toSpice(netlist, title = 'BrickWright Circuit') {
  const skipped = [];
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

  // ── Supply rails ─────────────────────────────────────────────────
  const railVolts = typeof netlist.vcc === 'number' ? netlist.vcc : 5;
  if (supplyNets.length) {
    lines.push('* Supply rails (synthesized: the designer models these as rail parts)');
    supplyNets.forEach((net, i) => {
      lines.push(`V${i + 1}_SUPPLY ${sanitizeNode(net.name)} 0 DC ${formatSpiceValue(railVolts)}`);
    });
    lines.push('');
  }

  // ── Elements ─────────────────────────────────────────────────────
  const usedModels = new Set();
  const modelCards = [];

  for (const part of netlist.parts) {
    const sym = PART_SYMBOLS[part.kind];
    const card = sym ? sym.spiceCard : null;

    if (!card || card === 'X' || card === 'S') {
      skipped.push(`${part.refdes} (${part.kind}): no SPICE model`);
      lines.push(`* ${part.refdes} ${part.kind} — skipped (no simple SPICE card)`);
      continue;
    }

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

    const pins = getSpicePins(part.kind);
    const nodes = pins.map(p => nodeOf(part.refdes, p));
    const floating = pins.filter((p, i) => !nodes[i]);
    if (floating.length) {
      warnings.push(`${part.refdes} (${part.kind}): pin${floating.length > 1 ? 's' : ''} `
        + `${floating.join(', ')} on no net — left floating in the deck.`);
    }
    const nodeFields = pins
      .map((p, i) => nodes[i] || `UNCONNECTED_${part.refdes}_${p}`)
      .join(' ');

    if (TWO_TERMINAL.has(card)) {
      let value = part.valueNumber;
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
        lines.push(`${part.refdes} ${nodeFields} ${part.value || '1'}`);
        warnings.push(`${part.refdes} (${part.kind}): no numeric value — deck value is a guess.`);
      } else {
        lines.push(`${part.refdes} ${nodeFields} ${formatSpiceValue(value)}`);
      }
    } else if (card === 'D') {
      const modelName = `D_${part.refdes}`;
      const j = junctionModel(part);
      const extra = part.kind === 'zener' && part.params?.vz
        ? ` BV=${formatSpiceValue(Number(part.params.vz))}` : '';
      modelCards.push(`.model ${modelName} D (Is=${j.is.toExponential(6)} N=${j.n} `
        + `Rs=${j.rs}${extra})  $ Vf=${j.vf} V at 20 mA`);
      usedModels.add(modelName);
      lines.push(`${part.refdes} ${nodeFields} ${modelName}`);
    } else if (card === 'Q') {
      const model = (sym && sym.spiceModel) || 'Q_DEFAULT';
      usedModels.add(model);
      lines.push(`${part.refdes} ${nodeFields} ${model}`);
    } else if (card === 'M') {
      usedModels.add('MOSFET');
      lines.push(`${part.refdes} ${nodeFields} MOSFET`);
    } else {
      skipped.push(`${part.refdes} (${part.kind}): unsupported card '${card}'`);
      lines.push(`* ${part.refdes} ${part.kind} — unsupported`);
    }
  }

  // ── Models ───────────────────────────────────────────────────────
  const SHARED_MODELS = {
    '2N2222': '.model 2N2222 NPN (Bf=200 Is=1e-14)',
    '2N2907': '.model 2N2907 PNP (Bf=200 Is=1e-14)',
    'TIP120': '.model TIP120 NPN (Bf=1000 Is=1e-12)',
    'Q_DEFAULT': '.model Q_DEFAULT NPN (Bf=100 Is=1e-14)',
    'MOSFET': '.model MOSFET NMOS (Vto=2.0 Kp=20u)',
  };
  const shared = [...usedModels].filter(m => SHARED_MODELS[m]).sort()
    .map(m => SHARED_MODELS[m]);
  if (modelCards.length || shared.length) {
    lines.push('');
    lines.push('* Device models');
    // Only the models this deck actually references: a .model nothing uses
    // is noise, and some parsers warn on it.
    lines.push(...modelCards, ...shared);
  }

  // ── Analysis ─────────────────────────────────────────────────────
  const hz = lowestSourceFrequency(netlist);
  const tranStop = hz ? 10 / hz : 0.01;
  const tranStep = tranStop / 1000;
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

  return { text: lines.join('\n') + '\n', skipped, warnings };
}

/**
 * Get ordered terminal names for SPICE output.
 * For two-terminal parts: [positive, negative].
 * For transistors: [collector, base, emitter] (BJT) or [drain, gate, source] (MOS).
 * For diodes: [anode, cathode].
 */
function getSpicePins(kind) {
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
    case 'nmos': case 'pmos':
      return ['drain', 'gate', 'source'];
    case 'vsource': case 'battery_9v': case 'battery_aa':
      return ['pos', 'neg'];
    case 'isource':
      return ['pos', 'neg'];
    case 'potentiometer':
      // Handled as two resistors in toSpice; kept for callers that ask.
      return ['a', 'wiper', 'b'];
    case 'buzzer': case 'dc_motor':
      return ['a', 'b'];
    default:
      return ['a', 'b'];
  }
}

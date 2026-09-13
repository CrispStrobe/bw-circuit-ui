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
import { spiceModelFor, resolveParams, cardFor, classDefaults } from 'bw-board/parts-library.js';
import { formatSpiceValue } from '../si.js';
import { validateStrictSpicePulseParams } from '../spice-source.js';
import { controlledResistance } from 'bw-board/mna.js';
import { isExplicitShockleyPart, SHOCKLEY_FIXED_TEMP_C } from '../spice-diode.js';

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
export function toSpice(netlist, title = 'BrickWright Circuit',
  {modelFor = spiceModelFor, pinSource = null, controls = new Map(),
   companionsFor = null} = {}) {
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
  let hasExplicitShockley = false;
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

      const pins = getSpicePins(part.kind);
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

    // A time-varying source must either retain its complete supported shape
    // or be refused. Falling through to valueNumber here used to serialize a
    // waveform as DC while producing a plausible, runnable, different deck.
    if ((part.kind === 'vsource' || part.kind === 'isource')
      && part.params?.wave && part.params.wave !== 'dc') {
      const p = part.params;
      const allowed = new Set(['wave', 'volts', 'offset', 'amplitude', 'freq', 'phase']);
      const extra = Object.keys(p).filter(key => !allowed.has(key));
      const phase = p.phase ?? 0;
      const validSine = part.kind === 'vsource' && p.wave === 'sine'
        && [p.offset, p.amplitude, p.freq, phase].every(Number.isFinite)
        && p.freq > 0 && phase === 0 && extra.length === 0;
      if (validSine) {
        lines.push(`${part.refdes} ${nodeFields} SINE(${formatSpiceValue(p.offset)} `
          + `${formatSpiceValue(p.amplitude)} ${formatSpiceValue(p.freq)})`);
      } else if (part.kind === 'vsource' && p.wave === 'spice-pulse') {
        const pulse = validateStrictSpicePulseParams(p);
        if (pulse.ok) {
          lines.push(`${part.refdes} ${nodeFields} PULSE(${pulse.values.map(formatSpiceValue).join(' ')})`);
        } else {
          skipped.push(`${part.refdes} (${part.kind}): time-varying spice-pulse source is not losslessly exportable; ${pulse.reason}`);
          lines.push(`* ${part.refdes} ${part.kind} — skipped (time-varying source not losslessly exportable; ${pulse.reason})`);
        }
      } else {
        const detail = extra.length ? `; unsupported parameter${extra.length > 1 ? 's' : ''} ${extra.join(', ')}` : '';
        skipped.push(`${part.refdes} (${part.kind}): time-varying ${String(p.wave)} source is not losslessly exportable${detail}`);
        lines.push(`* ${part.refdes} ${part.kind} — skipped (time-varying source not losslessly exportable${detail})`);
      }
      continue;
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
      if (part.params?.model === 'shockley' && !isExplicitShockleyPart(part)) {
        skipped.push(`${part.refdes} (diode): explicit Shockley export requires only finite IS, N and RS`);
        lines.push(`* ${part.refdes} diode — unsupported Shockley parameters`);
        continue;
      }
      const j = junctionModel(part);
      if (isExplicitShockleyPart(part)) hasExplicitShockley = true;
      const extra = part.kind === 'zener' && part.params?.vz
        ? ` BV=${formatSpiceValue(Number(part.params.vz))}` : '';
      modelCards.push(`.model ${modelName} D (Is=${j.is.toExponential(6)} N=${j.n} `
        + `Rs=${j.rs}${extra})  $ Vf=${j.vf} V at 20 mA`);
      usedModels.add(modelName);
      lines.push(`${el} ${nodeFields} ${modelName}`);
    } else if (card === 'Q') {
      // A named part (params.part) is the card's model; a bare class falls back
      // to the symbol table's choice, then to the generic default.
      const named = cardFor(part.params?.part);
      const model = (named && named.id) || (sym && sym.spiceModel);
      if (!model || !modelLine(model)) {
        skipped.push(`${part.refdes} (${part.kind}): no \`.model\` line can be produced`
          + `${model ? ` for '${model}'` : ''} — the deck would reference a model it never defines`);
        lines.push(`* ${part.refdes} ${part.kind} — no model`);
        continue;
      }
      usedModels.add(model);
      lines.push(`${el} ${nodeFields} ${model}`);
    } else if (card === 'M') {
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
  if (hasExplicitShockley) {
    lines.push('', '* Fixed thermal profile matching bw-board VT=0.02585 V');
    lines.push(`.temp ${SHOCKLEY_FIXED_TEMP_C}`);
    lines.push(`.options tnom=${SHOCKLEY_FIXED_TEMP_C}`);
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
      // SPICE positive I-card current flows first node -> second node, while
      // bw-board positive isource current flows neg -> pos.
      return ['neg', 'pos'];
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

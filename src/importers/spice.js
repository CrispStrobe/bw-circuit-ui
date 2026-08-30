/**
 * SPICE netlist importer (.cir / .sp / .net).
 *
 * The universal bridge (ROADMAP X1.1). Every schematic tool exports a SPICE
 * netlist, including the ones whose native formats are closed or
 * undocumented, so one reader covers all of them without naming any.
 *
 * CLEAN ROOM. The SPICE netlist language is a published format: element
 * letters and their node counts, node 0 as the reference, `.model`/`.subckt`,
 * and the scale factors all come from the ngspice manual and from decks
 * written here and fed to ngspice to see what it made of them (the suffix
 * table in si.js records the measurements). No simulator's source was read.
 *
 * WHAT IS AND IS NOT MAPPED, re-measured against bw-board at 6571648 rather
 * than taken from the ROADMAP's older note:
 *
 *   R C L V I D Q      mapped
 *   M                  mapped, minus the bulk node — SPICE MOSFETs are four
 *                      terminals and the engine's are three, so the bulk
 *                      connection is dropped and NAMED
 *   E (VCVS)           mapped: bw-board E3.5a landed vcvs (params.gain)
 *   G (VCCS)           mapped: bw-board E3.5a landed vccs (params.gm)
 *   F (CCCS) H (CCVS)  NOT mapped: bw-board E3.5b is deferred by ruling.
 *                      They go to unmapped[] naming the deferral, never a
 *                      substitute.
 *   X (subckt call)    flattened ONE level with dotted refdes; deeper nesting
 *                      and undefined subcircuits go to unmapped[].
 *
 * Nothing is silently dropped. Anything this reader cannot represent lands in
 * `unmapped[]` or `ignored[]` and both are counted, which is the accounting
 * the acceptance asks for.
 *
 * No placement: a netlist states connections and says nothing about where
 * anything sits, so every part lands at 0,0 and is wired star-fashion, the
 * same as the other netlist-shaped importers here.
 *
 * @module
 */

import { parseSpiceValue } from '../model/si.js';

/** Nodes that mean "the reference" in every dialect. */
const GROUND_NODES = new Set(['0', 'gnd', 'gnd!', 'ground', 'vss']);

/** Analysis and control cards we recognise. Reported, never executed. */
const ANALYSIS_CARDS = new Set(['op', 'tran', 'ac', 'dc', 'noise', 'tf', 'four', 'disto', 'pz', 'sens']);

/**
 * Cards that carry no circuit and are correctly ignored — listed so the
 * accounting can say "recognised and skipped" rather than "unknown".
 */
const BENIGN_CARDS = new Set([
  'end', 'ends', 'model', 'subckt', 'include', 'inc', 'lib', 'options', 'option',
  'temp', 'width', 'print', 'plot', 'save', 'probe', 'ic', 'nodeset', 'global',
  'param', 'title', 'control', 'endc', 'meas', 'measure', 'func', 'csparam',
]);

/**
 * @typedef {object} SpiceImport
 * @property {Array} parts
 * @property {Array} wires
 * @property {string[]} warnings
 * @property {Array} unmapped   — elements that could not become parts
 * @property {string[]} ignored — cards that are not themselves components.
 *   `.model` is here because it declares no node; its CONTENT is consumed
 *   into the params of every part naming it. Together with parts[],
 *   unmapped[] and analyses[] this accounts for every card in the file,
 *   which is the accounting X1.1's acceptance asks for.
 * @property {string[]} analyses — the analyses the deck asked for
 * @property {string} title
 */

/**
 * Does this look like a SPICE deck?
 *
 * Deliberately conservative and checked LAST in detect.js: a SPICE deck has
 * no magic first line (line one is a free-text title, by definition), so the
 * only evidence is the shape of its body. Requiring both a terminator and a
 * real element card keeps prose files out.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeSpice(text) {
  if (typeof text !== 'string' || !text.trim()) return false;
  if (/^\s*[[{<]/.test(text)) return false;             // JSON or XML
  if (/^\s*\(/.test(text)) return false;                 // s-expression
  const hasEnd = /^\s*\.end\s*$/im.test(text);
  const hasAnalysisOrModel = /^\s*\.(op|tran|ac|dc|model|subckt)\b/im.test(text);
  // An element card: a letter-prefixed name, then at least two node fields.
  const elementCards = (text.match(/^\s*[RCLVIDQMEFGHKSTWXJZ]\w*\s+\S+\s+\S+/gim) || []).length;
  return elementCards >= 2 && (hasEnd || hasAnalysisOrModel);
}

/**
 * Strip comments and join continuation lines.
 *
 * SPICE comment rules, all three of them: a line whose first non-blank
 * character is `*` is a comment; `$` and `;` start an inline comment when
 * preceded by whitespace; and a line whose first non-blank character is `+`
 * continues the previous one.
 *
 * @param {string} text
 * @returns {{title: string, lines: string[]}}
 */
function logicalLines(text) {
  const raw = text.split(/\r?\n/);
  // Line one is the TITLE. Always — a deck whose first line looks like an
  // element card still has that card swallowed as the title, which is why
  // our own exporter writes a `*`-prefixed title line.
  let title = '';
  let start = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i].trim() === '') continue;
    title = raw[i].trim().replace(/^\*+\s*/, '');
    start = i + 1;
    break;
  }

  const out = [];
  for (let i = start; i < raw.length; i++) {
    let line = raw[i];
    if (/^\s*\*/.test(line)) continue;
    line = line.replace(/\s+[$;].*$/, '');
    if (!line.trim()) continue;
    if (/^\s*\+/.test(line)) {
      if (out.length) out[out.length - 1] += ' ' + line.replace(/^\s*\+/, '').trim();
      continue;
    }
    out.push(line.trim());
  }
  return { title, lines: out };
}

/** Split a `.model` parameter list: `(Is=1e-14 N=1.5)` or bare `Is=1e-14`. */
function modelParams(rest) {
  const params = {};
  const body = rest.replace(/[()]/g, ' ');
  for (const m of body.matchAll(/([A-Za-z_]\w*)\s*=\s*([^\s=]+)/g)) {
    params[m[1].toLowerCase()] = parseSpiceValue(m[2]);
  }
  return params;
}

/**
 * The DC value of a source card's trailing fields.
 *
 * `V1 1 0 5`, `V1 1 0 DC 5`, `V1 1 0 DC 5 AC 1` and `V1 1 0 PULSE(0 5 …)`
 * all state a bias point; the last is a waveform this reader does not model,
 * so it takes the pulse's initial value and says so.
 *
 * @returns {{value: number, note: string|null}}
 */
function sourceValue(fields) {
  const joined = fields.join(' ');
  const dc = joined.match(/\bDC\b\s+([^\s]+)/i);
  if (dc) return { value: parseSpiceValue(dc[1]), note: null };
  const wave = joined.match(/\b(PULSE|SIN|SINE|EXP|PWL|SFFM|AM)\b\s*\(([^)]*)\)/i);
  if (wave) {
    const nums = wave[2].trim().split(/[\s,]+/).map(parseSpiceValue);
    return {
      value: isFinite(nums[0]) ? nums[0] : 0,
      note: `${wave[1].toUpperCase()} waveform is not modelled here — imported at its `
        + `initial value ${isFinite(nums[0]) ? nums[0] : 0}.`,
    };
  }
  const bare = fields.find((f) => isFinite(parseSpiceValue(f)));
  return { value: bare !== undefined ? parseSpiceValue(bare) : 0, note: null };
}

/**
 * Element letter -> how to build a part.
 *
 * `nodes` is how many node fields the card carries, `terminals` the engine
 * terminal each maps to IN CARD ORDER. A null entry means the node exists in
 * SPICE and not here (the MOSFET bulk) and is reported.
 */
const ELEMENTS = {
  R: { nodes: 2, terminals: ['a', 'b'], kind: () => 'resistor', param: 'ohms' },
  C: { nodes: 2, terminals: ['a', 'b'], kind: () => 'capacitor', param: 'farads' },
  L: { nodes: 2, terminals: ['a', 'b'], kind: () => 'inductor', param: 'henrys' },
  V: { nodes: 2, terminals: ['pos', 'neg'], kind: () => 'vsource', source: 'volts' },
  I: { nodes: 2, terminals: ['pos', 'neg'], kind: () => 'isource', source: 'amps' },
  D: { nodes: 2, terminals: ['anode', 'cathode'], kind: () => 'diode', model: true },
  Q: { nodes: 3, terminals: ['collector', 'base', 'emitter'], kind: () => 'npn', model: true },
  M: { nodes: 4, terminals: ['drain', 'gate', 'source', null], kind: () => 'nmos', model: true },
  E: { nodes: 4, terminals: ['outp', 'outn', 'inp', 'inn'], kind: () => 'vcvs', param: 'gain' },
  G: { nodes: 4, terminals: ['outp', 'outn', 'inp', 'inn'], kind: () => 'vccs', param: 'gm' },
};

/** Element letters that are real SPICE and deliberately not mapped. */
const REFUSED = {
  F: 'current-controlled current source (CCCS): bw-board E3.5b is deferred by '
    + 'ruling, so there is no engine part to map it onto and none is invented.',
  H: 'current-controlled voltage source (CCVS): bw-board E3.5b is deferred by '
    + 'ruling, so there is no engine part to map it onto and none is invented.',
  K: 'coupled-inductor statement: it names two inductors rather than nodes, and '
    + 'the engine takes coupling as a param on the pair, not as an element.',
  S: 'voltage-controlled switch: no engine kind.',
  W: 'current-controlled switch: no engine kind.',
  T: 'lossless transmission line: no engine kind.',
  J: 'JFET: no engine kind.',
  Z: 'MESFET: no engine kind.',
  B: 'behavioural source: an arbitrary expression, which this reader will not '
    + 'approximate with a fixed value.',
  A: 'XSPICE code model: not a netlist element this reader can represent.',
};

/**
 * Import a SPICE netlist.
 *
 * @param {string} text
 * @returns {SpiceImport}
 */
export function importSpice(text) {
  const warnings = [];
  const unmapped = [];
  const ignored = [];
  const analyses = [];
  const models = new Map();     // name (lower) -> {type, params}
  const subckts = new Map();    // name (lower) -> {ports: string[], body: string[]}

  const { title, lines } = logicalLines(text);

  // ── pass 1: collect .model and .subckt bodies ────────────────────
  //
  // Every logical line leaves this pass in exactly one place: flat[], a
  // subcircuit body, analyses[] or ignored[]. Measured against the 410 decks
  // ngspice ships, an earlier version dropped subcircuit bodies and
  // `.control` script lines without recording them — 86 decks came up short
  // of their own card count, which is the silent drop X1.1's acceptance
  // forbids. The accounting test is what found it.
  const flat = [];
  let inSub = null;
  let inControl = false;
  const declareModel = (rest, line) => {
    ignored.push(line.trim());
    const f = rest.trim().split(/\s+/);
    const name = (f[0] || '').toLowerCase();
    const type = (f[1] || '').replace(/\(.*$/, '').toUpperCase();
    models.set(name, {
      type,
      params: modelParams(rest.slice(rest.indexOf(f[1] || '') + (f[1] || '').length)),
    });
  };

  for (const line of lines) {
    const dot = line.match(/^\.(\w+)\s*(.*)$/s);

    // `.control … .endc` holds SIMULATOR SCRIPT, not circuit: `run`, `plot`,
    // `let`, `write`. Parsed as cards those become nonsense elements (`run`
    // reads as an R with no nodes), so the block is recorded whole and
    // skipped.
    if (inControl) {
      ignored.push(line.trim());
      if (dot && dot[1].toLowerCase() === 'endc') inControl = false;
      continue;
    }
    if (dot && dot[1].toLowerCase() === 'control') {
      inControl = true;
      ignored.push(line.trim());
      continue;
    }

    if (dot) {
      const card = dot[1].toLowerCase();
      if (card === 'subckt') {
        const f = dot[2].trim().split(/\s+/);
        inSub = { name: (f[0] || '').toLowerCase(), ports: f.slice(1), body: [] };
        subckts.set(inSub.name, inSub);
        ignored.push(line.trim());
        continue;
      }
      if (card === 'ends') { inSub = null; ignored.push(line.trim()); continue; }
      if (inSub) {
        // A model declared INSIDE a subcircuit is scoped to it in SPICE. One
        // level of flattening cannot carry that scope, so it is registered
        // globally and the simplification is stated rather than hidden. Two
        // subcircuits declaring the same model name would collide; that is
        // reported when it happens rather than assumed impossible.
        if (card === 'model') {
          const f = dot[2].trim().split(/\s+/);
          if (models.has((f[0] || '').toLowerCase())) {
            // Still recorded: a card that is recognised and deliberately not
            // used is accounted for, or the redeclaration is a silent drop.
            ignored.push(line.trim());
            warnings.push(`Model "${f[0]}" is declared in more than one scope; `
              + 'one-level flattening keeps the first.');
          } else {
            declareModel(dot[2], line);
          }
          continue;
        }
        inSub.body.push(line);
        ignored.push(line.trim());   // consumed by the definition
        continue;
      }
      if (card === 'model') { declareModel(dot[2], line); continue; }
      if (ANALYSIS_CARDS.has(card)) { analyses.push(line.trim()); continue; }
      if (card === 'include' || card === 'inc' || card === 'lib') {
        ignored.push(line.trim());
        warnings.push(`${line.trim()} — external files are not followed; anything `
          + 'it defines is missing from this import.');
        continue;
      }
      if (BENIGN_CARDS.has(card)) { ignored.push(line.trim()); continue; }
      ignored.push(line.trim());
      warnings.push(`Unrecognised control card, ignored: ${line.trim()}`);
      continue;
    }
    if (inSub) {
      inSub.body.push(line);
      ignored.push(line.trim());     // consumed by the definition
      continue;
    }
    flat.push({ line, prefix: '', portMap: null });
  }

  // ── pass 2: flatten subcircuit calls, ONE level ──────────────────
  const expanded = [];
  for (const item of flat) {
    const f = item.line.split(/\s+/);
    if (!/^X/i.test(f[0])) { expanded.push(item); continue; }
    const inst = f[0];
    const subName = (f[f.length - 1] || '').toLowerCase();
    const sub = subckts.get(subName);
    if (!sub) {
      unmapped.push({ ref: inst, value: subName,
        libsource: `undefined subcircuit "${subName}" — it is not in this file and `
          + '.include is not followed' });
      continue;
    }
    const actuals = f.slice(1, f.length - 1);
    if (actuals.length !== sub.ports.length) {
      unmapped.push({ ref: inst, value: subName,
        libsource: `subcircuit "${subName}" takes ${sub.ports.length} nodes, the call gives ${actuals.length}` });
      continue;
    }
    // Formal port -> actual node. Anything else inside the body is INTERNAL
    // and gets the instance prefix so two instances do not share nets.
    const portMap = new Map();
    sub.ports.forEach((p, i) => portMap.set(p.toLowerCase(), actuals[i]));
    for (const body of sub.body) {
      if (/^X/i.test(body.split(/\s+/)[0])) {
        unmapped.push({ ref: `${inst}.${body.split(/\s+/)[0]}`, value: subName,
          libsource: 'nested subcircuit: flattening stops at one level' });
        continue;
      }
      expanded.push({ line: body, prefix: `${inst}.`, portMap });
    }
  }

  // ── pass 3: elements -> parts and nets ───────────────────────────
  const parts = [];
  const nets = new Map();   // net name -> [{partId, terminal}]
  let groundUsed = false;

  const netOf = (raw, item) => {
    const n = String(raw);
    if (GROUND_NODES.has(n.toLowerCase())) { groundUsed = true; return '__GND__'; }
    if (item.portMap) {
      const mapped = item.portMap.get(n.toLowerCase());
      if (mapped !== undefined) {
        return GROUND_NODES.has(String(mapped).toLowerCase())
          ? (groundUsed = true, '__GND__') : String(mapped);
      }
      return `${item.prefix}${n}`;      // internal to this instance
    }
    return n;
  };
  const join = (net, partId, terminal) => {
    if (!nets.has(net)) nets.set(net, []);
    nets.get(net).push({ partId, terminal });
  };

  for (const item of expanded) {
    const fields = item.line.split(/\s+/);
    const name = fields[0];
    const letter = name[0].toUpperCase();

    if (REFUSED[letter]) {
      unmapped.push({ ref: item.prefix + name, value: letter, libsource: REFUSED[letter] });
      continue;
    }
    const spec = ELEMENTS[letter];
    if (!spec) {
      unmapped.push({ ref: item.prefix + name, value: letter,
        libsource: `unknown element letter "${letter}"` });
      continue;
    }

    const nodeFields = fields.slice(1, 1 + spec.nodes);
    if (nodeFields.length < spec.nodes) {
      // A MOSFET written with three nodes (bulk tied to source implicitly) is
      // common enough to accept rather than refuse.
      if (letter === 'M' && nodeFields.length === 3) {
        warnings.push(`${name}: three-node MOSFET — bulk taken as tied to source.`);
      } else {
        unmapped.push({ ref: item.prefix + name, value: letter,
          libsource: `${spec.nodes} nodes expected, ${nodeFields.length} given` });
        continue;
      }
    }
    const rest = fields.slice(1 + nodeFields.length);
    const partId = item.prefix + name;

    // Kind and params, refined by the .model card where there is one.
    let kind = spec.kind();
    const params = {};
    if (spec.model) {
      const modelName = (rest[0] || '').toLowerCase();
      const model = models.get(modelName);
      if (!model) {
        warnings.push(`${partId}: model "${rest[0] || '(none)'}" is not declared in this `
          + 'file — engine defaults are used for it.');
      } else {
        Object.assign(params, mapModel(letter, model, warnings, partId));
        if (letter === 'Q') kind = model.type === 'PNP' ? 'pnp' : 'npn';
        if (letter === 'M') kind = model.type === 'PMOS' ? 'pmos' : 'nmos';
        if (letter === 'D' && model.params.bv) kind = 'zener';
      }
      params._model = rest[0] || null;
    } else if (spec.source) {
      const { value, note } = sourceValue(rest);
      params[spec.source] = value;
      if (note) warnings.push(`${partId}: ${note}`);
    } else if (spec.param) {
      const v = parseSpiceValue(rest[0]);
      if (isFinite(v)) params[spec.param] = v;
      else warnings.push(`${partId}: no numeric value ("${rest[0] ?? ''}") — engine default used.`);
    }

    parts.push({ id: partId, kind, params, x: 0, y: 0 });

    spec.terminals.forEach((terminal, i) => {
      if (terminal === null) {
        if (nodeFields[i] !== undefined) {
          warnings.push(`${partId}: bulk node "${nodeFields[i]}" dropped — the engine's `
            + 'MOSFET has three terminals.');
        }
        return;
      }
      if (nodeFields[i] === undefined) return;
      join(netOf(nodeFields[i], item), partId, terminal);
    });
  }

  // ── ground becomes a part, the way the designer models it ────────
  if (groundUsed) {
    parts.push({ id: 'GND1', kind: 'gnd', params: {}, x: 0, y: 0 });
    join('__GND__', 'GND1', 'gnd');
  }

  // ── nets -> star wiring ──────────────────────────────────────────
  // A netlist states membership, not geometry. Wiring every member to the
  // first one reproduces the partition exactly, which is what the round-trip
  // oracle compares; nothing here pretends to know a layout.
  const wires = [];
  for (const members of nets.values()) {
    if (members.length < 2) continue;
    const hub = members[0];
    for (const m of members.slice(1)) {
      wires.push({
        from: hub.partId, fromTerminal: hub.terminal,
        to: m.partId, toTerminal: m.terminal,
      });
    }
  }

  const singletons = [...nets.entries()].filter(([, m]) => m.length < 2);
  for (const [net] of singletons) {
    warnings.push(`Net "${net === '__GND__' ? '0' : net}" has one connection — nothing to wire it to.`);
  }

  return { parts, wires, warnings, unmapped, ignored, analyses, title };
}

/**
 * A `.model` card onto engine params.
 *
 * The engine's diode is described by a forward voltage; SPICE's is described
 * by Is/N/Rs. They are the same curve read from two ends, so Vf is RECOVERED
 * at the rated 20 mA — the inverse of the calibration the exporter uses
 * (model/exporters/spice.js junctionModel), which is what makes the round
 * trip close.
 */
function mapModel(letter, model, warnings, partId) {
  const p = model.params;
  const out = {};
  if (letter === 'D') {
    const n = isFinite(p.n) ? p.n : 1.0;
    const rs = isFinite(p.rs) ? p.rs : 0;
    const is = isFinite(p.is) ? p.is : null;
    out.n = n;
    out.rs = rs;
    if (is !== null) {
      out.is = is;
      // Vf at the rated 20 mA: nVt·ln(I/Is + 1) + I·Rs
      const nVt = n * 0.02585;
      out.vf = Number((nVt * Math.log(0.020 / is + 1) + 0.020 * rs).toFixed(6));
      out.model = 'shockley';
    } else {
      warnings.push(`${partId}: the diode model states no Is, so no forward voltage `
        + 'could be recovered from it — the engine default stands.');
    }
    if (isFinite(p.bv)) out.vz = p.bv;
  } else if (letter === 'Q') {
    if (isFinite(p.bf)) out.beta = p.bf;
  } else if (letter === 'M') {
    if (isFinite(p.vto)) out.vth = p.vto;
  }
  return out;
}

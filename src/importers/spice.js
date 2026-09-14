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
import { parseStrictSpicePulse, parseStrictSpiceSine } from '../model/spice-source.js';
import { evaluateConstantExpression, resolveConstantParameters } from '../model/spice-constant.js';
import { annotateImportedSingletonTerminals } from '../model/import-singleton-nets.js';
import { classifyShockleyThermal, validateExplicitShockley, validateDiodeForDc,
  diodeBreakdown } from '../model/spice-diode.js';
import { parseSpiceModelDeclaration } from '../model/spice-model.js';

/**
 * Nodes the REFERENCE SIMULATOR treats as the reference — measured, not assumed.
 *
 * This list used to read `0, gnd, gnd!, ground, vss`, and three of those five
 * are ordinary nodes to ngspice. Run the same deck four times with the node
 * renamed and read the operating point:
 *
 *     node      ngspice
 *     0         the reference
 *     gnd       the reference        (aliased; it vanishes from the table)
 *     gnd!      2.5 V — an ordinary node
 *     ground    2.5 V — an ordinary node
 *     vss       2.5 V — an ordinary node
 *
 * Aliasing a node the simulator does not alias does not make our answer
 * approximate, it makes it an answer about a DIFFERENT CIRCUIT. `vss` is the
 * expensive one: in an analogue deck it is the NEGATIVE SUPPLY, and collapsing
 * it to 0 deletes the rail. **876 of the 12,471 ADI2005 decks name a `vss`
 * node, all 876 have a source driving it, and NONE of them rely on it as their
 * only ground** — every one also names node `0` or `gnd`. So the alias was
 * wrong in 876 of 876 cases there, and removing it costs that corpus nothing.
 *
 * A deck whose ONLY return is spelled `vss`, `ground` or `gnd!` would then have
 * no reference at all, so those stay as a LAST-RESORT fallback below, applied
 * once and reported — the same shape as the exporter's "no gnd part: node 0 is
 * the vsource's negative net".
 */
const GROUND_NODES = new Set(['0', 'gnd']);

/**
 * Spellings that are NOT ground to ngspice, but are the only plausible
 * reference in a deck that names none. Ordered: the most explicit first.
 */
const FALLBACK_GROUND_NODES = ['gnd!', 'ground', 'vss'];

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
 * @property {Array} losses     — mapped elements whose authored semantics
 *   cannot be represented. Each entry retains the source card and the
 *   explicit fallback used; numeric oracles must refuse these imports.
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
  // Two elements plus either structural marker remains the broad, established
  // gate. A one-element deck needs BOTH: this admits legitimate source-only
  // stimulus decks without letting a lone netlist-looking prose line or an
  // unterminated fragment seize `.net` from KiCad's extension fallback.
  return elementCards >= 2
    ? (hasEnd || hasAnalysisOrModel)
    : elementCards === 1 && hasEnd && hasAnalysisOrModel;
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
/**
 * @param {string} text
 * @param {{titled?: boolean}} [opts]
 *   `titled: false` for a LIBRARY, which is not a deck and has no title line.
 *   Applying the title rule to one swallows its first definition: a library
 *   whose first line is `.model MYD D(...)` registered nothing, and the deck
 *   using it then reported "model is not declared in this file" — a missing
 *   model where the real fault was that we ate it.
 */
function logicalLines(text, opts = {}) {
  const raw = text.split(/\r?\n/);
  // Line one is the TITLE. Always — a deck whose first line looks like an
  // element card still has that card swallowed as the title, which is why
  // our own exporter writes a `*`-prefixed title line.
  let title = '';
  let start = 0;
  if (opts.titled !== false) {
    for (let i = 0; i < raw.length; i++) {
      if (raw[i].trim() === '') continue;
      title = raw[i].trim().replace(/^\*+\s*/, '');
      start = i + 1;
      break;
    }
  }

  const out = [];
  for (let i = start; i < raw.length; i++) {
    let line = raw[i];
    if (/^\s*\*/.test(line)) continue;
    // END-OF-LINE COMMENTS. The two characters do NOT follow the same rule,
    // and treating them alike breaks real decks in one direction or the other.
    // Measured against ngspice 44:
    //
    //   R1 a b 1k;nospace   -> b = 3.750000   ';' is a comment with no space
    //   R1 a b;x  1k        -> "not a valid resistor instance line, ignored"
    //                          -- so ';' cut the line mid-token, i.e. ANYWHERE
    //   R1 a b$x 1k         -> node 'b$x' reads 3.750000
    //                          -- so '$' INSIDE a token is an ordinary char
    //
    // So `;` ends the line wherever it appears, while `$` does so only at the
    // start of a token. That second half is not pedantry: KiCad and Eagle
    // exports in the corpus carry `U$1 MOUNTINGHOLE2.5` and node names like
    // `Net-_J202-PadP$3_`, and a blanket `$` rule truncates the refdes and the
    // net name. The `\s+` the old single rule required was wrong for `;`
    // (23 corpus decks carry a tight one) and right for `$` by accident.
    line = line.replace(/;.*$/, '').replace(/(^|\s)\$.*$/, '');
    if (!line.trim()) continue;
    if (/^\s*\+/.test(line)) {
      if (out.length) out[out.length - 1] += ' ' + line.replace(/^\s*\+/, '').trim();
      continue;
    }
    out.push(line.trim());
  }
  return { title, lines: out };
}

/**
 * The DC value of a source card's trailing fields.
 *
 * `V1 1 0 5`, `V1 1 0 DC 5`, and `V1 1 0 DC 5 AC 1` state a bias point.
 * Exact three-argument voltage SIN/SINE and strict seven-argument voltage
 * PULSE are retained as native waveforms; other inline waves take their
 * initial value and say so.
 *
 * @returns {{value: number, note: string|null, externalWaveform: boolean,
 *   waveformParams?: Record<string,*>, waveformLoss?: string}}
 */
function firstScalarExpression(fields) {
  const text = Array.isArray(fields) ? fields.join(' ').trim() : String(fields || '').trim();
  if (!text.startsWith('{')) return text.split(/\s+/)[0] || '';
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(0, i + 1);
  }
  return text;
}

function scalarValue(raw, constants) {
  const text = String(raw || '').trim();
  const direct = parseSpiceValue(text);
  if (Number.isFinite(direct)) return { ok: true, value: direct };
  try {
    return { ok: true, value: evaluateConstantExpression(text, name => constants.get(name)) };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

function sourceValue(fields, allowSine = false, constants = new Map()) {
  const joined = fields.join(' ');
  const externalWaveform = /\bwavefile\s*=/i.test(joined);
  const sine = parseStrictSpiceSine(joined);
  if (sine) {
    if (sine.ok && allowSine) {
      return { value: sine.params.volts, note: null, externalWaveform,
        waveformParams: sine.params };
    }
    const reason = sine.ok
      ? 'time-varying current sine sources are not modelled'
      : sine.reason;
    return {
      value: sine.ok ? sine.params.volts : sine.fallback,
      note: `SINE waveform is not modelled here — imported at its initial value ${sine.ok ? sine.params.volts : sine.fallback}.`,
      externalWaveform,
      waveformLoss: reason,
    };
  }
  const pulse = parseStrictSpicePulse(joined);
  if (pulse) {
    if (pulse.ok && allowSine) {
      return { value: pulse.params.volts, note: null, externalWaveform,
        waveformParams: pulse.params };
    }
    const reason = pulse.ok
      ? 'time-varying current PULSE sources are not modelled'
      : pulse.reason;
    return {
      value: pulse.ok ? pulse.params.volts : pulse.fallback,
      note: `PULSE waveform is not modelled here — imported at its initial value ${pulse.ok ? pulse.params.volts : pulse.fallback}.`,
      externalWaveform,
      waveformLoss: reason,
    };
  }
  // THE AC DESCRIPTOR IS NOT ALWAYS LAST, AND ITS PHASE IS A NUMBER.
  //
  // Anchoring this at end-of-line refused `VIN IN 0 AC 1m DC 1.8` — an ordinary
  // SPICE source line — because `AC` then fell through to the scalar resolver
  // as the DC expression and came back "undefined constant ac". Measured on
  // ADI2005 v3, where that ordering is the house style for every small-signal
  // bench. Matching anywhere and REMOVING the descriptor from the DC fields is
  // what makes `DC 5 AC 1`, `AC 1 DC 5`, `AC 1` and a bare `5` all read right.
  //
  // The optional phase is anything that is NOT another source keyword. It
  // cannot be "looks like a number": `AC {mag} {phase}` is legal and a brace
  // expression starts with `{`. It cannot be "any token" either, or
  // `AC 1m DC 1.8` swallows the `DC` and loses the bias. So the test is the
  // keyword list, which is the thing that actually distinguishes them.
  const SRC_KEYWORDS = 'DC|AC|PULSE|SINE|SIN|EXP|PWL|SFFM|AM|TRNOISE|TRRANDOM|WAVEFILE|DISTOF1|DISTOF2';
  const ac = new RegExp(
    `(?:^|\\s)AC\\s+(\\S+)(?:\\s+(?!(?:${SRC_KEYWORDS})\\b)(\\S+))?(?=\\s|$)`, 'i').exec(joined);
  let acParams = null;
  if (ac) {
    const magnitude = scalarValue(ac[1], constants);
    const phase = scalarValue(ac[2] ?? '0', constants);
    if (!magnitude.ok || !phase.ok) {
      return { value: null, note: null, externalWaveform,
        scalarLoss: `AC descriptor is not a resolved finite magnitude/phase`, acParams: null };
    }
    // A NEGATIVE AC MAGNITUDE IS LEGAL, AND IT MEANS PHASE + 180.
    //
    // Refusing it cost the whole card, DC BIAS INCLUDED, on every deck that
    // writes a differential pair as `AC 0.5` and `AC -0.5` — 31 of the first
    // 400 ADI2005 decks, which is the shape half the small-signal benches in
    // that corpus use. The sign is a phase, not an error: ngspice reads
    // `AC -0.5` as 0.5 at 180 degrees and simulates it, and there is nothing
    // about it we cannot represent.
    acParams = magnitude.value < 0
      ? { acMagnitude: -magnitude.value, acPhase: phase.value + 180 }
      : { acMagnitude: magnitude.value, acPhase: phase.value };
  }
  const dcFields = ac
    ? (joined.slice(0, ac.index) + ' ' + joined.slice(ac.index + ac[0].length)).trim()
    : joined;
  if (ac && !dcFields) return { value: 0, note: null, externalWaveform, acParams };
  const dc = dcFields.match(/^DC\b\s+([\s\S]+)$/i);
  if (dc) {
    const expression = firstScalarExpression(dc[1]);
    const resolved = scalarValue(expression, constants);
    return resolved.ok
      ? { value: resolved.value, note: null, externalWaveform, acParams }
      : { value: null, note: null, externalWaveform,
        scalarLoss: `DC value ${JSON.stringify(expression)} is not a resolved finite constant: ${resolved.reason}` };
  }
  const wave = joined.match(/\b(PULSE|SIN|SINE|EXP|PWL|SFFM|AM)\b\s*\(([^)]*)\)/i);
  if (wave) {
    const nums = wave[2].trim().split(/[\s,]+/).map(parseSpiceValue);
    return {
      value: isFinite(nums[0]) ? nums[0] : 0,
      note: `${wave[1].toUpperCase()} waveform is not modelled here — imported at its `
        + `initial value ${isFinite(nums[0]) ? nums[0] : 0}.`,
      externalWaveform,
    };
  }
  // WAVEFILE already carries a dedicated semantic loss and its historical,
  // explicit zero fallback. Do not manufacture a second "constant" loss for
  // the filename token.
  if (externalWaveform) return { value: 0, note: null, externalWaveform };
  const expression = firstScalarExpression(dcFields);
  const resolved = scalarValue(expression, constants);
  return resolved.ok
    ? { value: resolved.value, note: null, externalWaveform, acParams }
    : { value: null, note: null, externalWaveform,
      scalarLoss: `source value ${JSON.stringify(expression)} is not a resolved finite constant: ${resolved.reason}` };
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
  // SPICE defines positive I-card current from its first node to its second.
  // bw-board's isource defines positive current from terminal neg to terminal
  // pos, so card order maps to neg,pos. Keeping amps positive preserves both
  // conventions without hiding the direction in a negated parameter.
  I: { nodes: 2, terminals: ['neg', 'pos'], kind: () => 'isource', source: 'amps' },
  D: { nodes: 2, terminals: ['anode', 'cathode'], kind: () => 'diode', model: true },
  Q: { nodes: 3, terminals: ['collector', 'base', 'emitter'], kind: () => 'npn', model: true },
  M: { nodes: 4, terminals: ['drain', 'gate', 'source', null], kind: () => 'nmos', model: true },
  // A LEVEL-1 JFET'S DC STAMP **IS** THE MOSFET SQUARE LAW.
  //
  // Shichman-Hodges is the same equation for both: `Id = Beta*Vov^2*(1+Lambda*
  // Vds)` in saturation, `Beta*Vds*(2*Vov - Vds)*(1+Lambda*Vds)` in the linear
  // region, with `Vov = Vgs - Vto`. The JFET's Vto is NEGATIVE (depletion mode)
  // and the engine's nmos already takes `vth` as a parameter, so the sign
  // carries itself. Beta plays the role of `k` directly — no W/L, no KP/2 —
  // and `mosK` returns `params.k` untouched when it is given.
  //
  // So this is a MAPPING, not a new kind. "A kind exists when the stamp
  // differs", and at DC in the normal region it does not. What DOES differ is
  // recorded as a loss at the call site: a JFET's gate-channel junction is a
  // DIODE, where a MOSFET's gate is insulated, so a forward-biased gate is not
  // represented. ngspice's JFET also carries RD/RS series resistances, which
  // this mapping does not.
  //
  // Measured on a self-authored bench (VTO=-2 BETA=1e-3 LAMBDA=0.01, 12 V
  // through 2k into the drain, 470 R on the source) against ngspice: see
  // test/spice-jfet-import.test.js. 3,349 J-card occurrences in the symbench
  // corpus had no path at all before this.
  J: { nodes: 3, terminals: ['drain', 'gate', 'source'], kind: () => 'nmos', model: true },
  E: { nodes: 4, terminals: ['outp', 'outn', 'inp', 'inn'], kind: () => 'vcvs', param: 'gain' },
  // SPICE G-card current flows from its first output node to its second.
  // bw-board's positive gm instead injects current into outp (from outn), so
  // output card order maps to outn,outp. Keeping gm positive preserves the
  // authored polarity without hiding the conversion in a negated parameter.
  G: { nodes: 4, terminals: ['outn', 'outp', 'inp', 'inn'], kind: () => 'vccs', param: 'gm' },
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
/**
 * @param {string} text  the deck
 * @param {{libraries?: string[]}} [opts]
 *   `libraries` is SPICE TEXT, supplied BY THE CALLER, whose `.model` and
 *   `.subckt` definitions become resolvable for this deck.
 *
 *   THE IMPORTER DOES NOT READ FILES, and that is deliberate. `.include` and
 *   `.lib` name paths, and a parser that follows them is a parser that opens
 *   whatever a foreign deck points it at — the same axis the corpus lane
 *   correctly pressed on for the launcher, and security is independent of
 *   licensing. So the caller resolves the path, decides what it is willing to
 *   read, and hands over the bytes; `.include` remains recorded as not
 *   followed.
 *
 *   WHY IT IS WORTH HAVING. An X card naming a subcircuit this deck does not
 *   define is refused, and that refusal is the SOLE blocker on **3,290 decks**
 *   — 658 of symbench's 6,249 and 2,632 of Si7li's 7,866 — two orders more than
 *   any missing element. Nothing else in the importer unlocks that many, and
 *   nothing unlocks any of them until a library can be supplied at all.
 *
 *   A deck resolved this way is no longer self-contained, so `usedLibraries`
 *   comes back naming what was taken from where. Local definitions win over
 *   library ones, which is SPICE's own precedence.
 */
export function importSpice(text, opts = {}) {
  const warnings = [];
  const unmapped = [];
  const losses = [];
  const ignored = [];
  const analyses = [];
  const models = new Map();     // name (lower) -> {type, params}
  const subckts = new Map();    // name (lower) -> {ports: string[], body: string[]}
  const parameterCards = [];

  const { title, lines } = logicalLines(text);
  const diodeThermal = classifyShockleyThermal(lines);

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
  /** Names taken from a caller-supplied library rather than from this deck. */
  const usedLibraries = [];
  /** Which names a library supplied; a local declaration removes its own. */
  const libraryNames = { models: new Set(), subckts: new Set() };
  const declareModel = (rest, line) => {
    ignored.push(line.trim());
    const declaration = parseSpiceModelDeclaration(rest);
    const name = (declaration?.name || '').toLowerCase();
    const type = declaration?.type || '';
    const prior = models.get(name);
    const record = {
      type,
      params: declaration?.params || {},
      body: declaration?.body || '',
      source: line.trim(),
    };
    if (prior && (prior.type === 'D' || type === 'D')) {
      models.set(name, { ...record, ambiguous: true, source: `${prior.source}\n${line.trim()}` });
    } else models.set(name, record);
    libraryNames.models.delete(name);   // see the .subckt note
  };

  // LIBRARIES FIRST, so a local definition of the same name overrides one —
  // SPICE's own precedence. Only `.model` and `.subckt` are taken from a
  // library; its element cards are NOT added to the circuit, because a library
  // is a definition file and adopting its elements would build a circuit the
  // deck never described.
  for (const libText of (opts.libraries || [])) {
    if (typeof libText !== 'string' || !libText.trim()) continue;
    let libSub = null;
    for (const line of logicalLines(libText, { titled: false }).lines) {
      const d = line.match(/^\.(\w+)\s*(.*)$/s);
      if (libSub) {
        if (d && d[1].toLowerCase() === 'ends') { libSub = null; continue; }
        libSub.body.push(line);
        continue;
      }
      if (!d) continue;
      const card = d[1].toLowerCase();
      if (card === 'subckt') {
        const f = d[2].trim().split(/\s+/);
        libSub = { name: (f[0] || '').toLowerCase(), ports: f.slice(1), body: [] };
        subckts.set(libSub.name, libSub);
        libraryNames.subckts.add(libSub.name);
      } else if (card === 'model') {
        const decl = parseSpiceModelDeclaration(d[2]);
        const name = (decl?.name || '').toLowerCase();
        if (!name) continue;
        models.set(name, { type: decl?.type || '',
          params: decl?.params || {}, body: decl?.body || '',
          source: line.trim(), fromLibrary: true });
        libraryNames.models.add(name);
      }
    }
  }

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
        // A LOCAL DEFINITION IS NOT A LIBRARY USE. Without this the deck's own
        // `.subckt` still counted as taken from the library it shadowed, which
        // would make `usedLibraries` a false provenance record — the one thing
        // that field exists to be right about.
        libraryNames.subckts.delete(inSub.name);
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
        if (card === 'param' || card === 'params' || card === 'func') {
          ignored.push(line.trim());
          losses.push({ ref: `.${card}`, kind: 'unsupported-subcircuit-parameter',
            source: line.trim(),
            reason: 'subcircuit-local parameters and functions are not hoisted into top-level scope',
            fallback: null });
          continue;
        }
        inSub.body.push(line);
        ignored.push(line.trim());   // consumed by the definition
        continue;
      }
      if (card === 'model') { declareModel(dot[2], line); continue; }
      if (ANALYSIS_CARDS.has(card)) { analyses.push(line.trim()); continue; }
      if (card === 'param' || card === 'params') {
        parameterCards.push(line.trim());
        ignored.push(line.trim());
        continue;
      }
      if (card === 'func') {
        ignored.push(line.trim());
        losses.push({ ref: '.func', kind: 'unsupported-constant-function', source: line.trim(),
          reason: '.func definitions are not executed by the constant parameter evaluator', fallback: null });
        continue;
      }
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

  const constantParameters = resolveConstantParameters(parameterCards);
  for (const finding of constantParameters.losses) {
    losses.push({ ref: finding.name || '.param', kind: 'unsupported-constant-parameter',
      source: finding.source, reason: finding.reason, fallback: null });
  }

  // ── pass 2: flatten subcircuit calls, ONE level ──────────────────
  const expanded = [];
  for (const item of flat) {
    const f = item.line.split(/\s+/);
    if (!/^X/i.test(f[0])) { expanded.push(item); continue; }
    const inst = f[0];
    // THE SUBCIRCUIT NAME IS THE LAST TOKEN THAT IS NOT A PARAMETER.
    //
    // An X card is `Xname node1 .. nodeN subcktname [param=value ...]`, and
    // this took `f[f.length - 1]` — the last token full stop. Every call
    // carrying trailing parameters therefore named a PARAMETER as its
    // subcircuit and was refused as "undefined subcircuit". Measured on Si7li's
    // 7,866 LTspice netlists, the top three "undefined subcircuits" were
    // `rin=500meg` (406), `gbw=10meg` (193) and `bot=1t` (26) — none of which is
    // a subcircuit at all. That is our parse defect wearing a missing-model
    // reason, which is worse than a missing model: it sends the reader looking
    // for a library.
    //
    // `params:` is LTspice's optional separator and is dropped with the rest.
    let tail = f.length - 1;
    while (tail > 1 && (/=/.test(f[tail]) || /^params:?$/i.test(f[tail]))) tail--;
    const subName = (f[tail] || '').toLowerCase();
    const params = f.slice(tail + 1);
    const sub = subckts.get(subName);
    if (sub && libraryNames.subckts.has(subName)) {
      usedLibraries.push({ kind: 'subckt', name: subName, ref: inst });
    }
    if (!sub) {
      unmapped.push({ ref: inst, value: subName,
        libsource: `undefined subcircuit "${subName}" — it is not in this file and `
          + '.include is not followed' });
      continue;
    }
    const actuals = f.slice(1, tail);
    if (actuals.length !== sub.ports.length) {
      unmapped.push({ ref: inst, value: subName,
        libsource: `subcircuit "${subName}" takes ${sub.ports.length} nodes, the call gives ${actuals.length}` });
      continue;
    }
    // Formal port -> actual node. Anything else inside the body is INTERNAL
    // and gets the instance prefix so two instances do not share nets.
    if (params.length) {
      // A subcircuit parameter OVERRIDE changes the instance's behaviour, and
      // flattening the body without applying it would be a different circuit.
      // Said out loud rather than dropped.
      warnings.push(`${inst}: subcircuit parameter override(s) ${params.join(' ')} are not `
        + 'applied — the body is flattened with its own defaults.');
    }
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
        if (letter === 'D') losses.push({ ref: partId, kind: 'unsupported-diode-model',
          source: item.line, reason: 'explicit declared D model with IS, N and RS is required' });
      } else {
        if (model.fromLibrary) {
          usedLibraries.push({ kind: 'model', name: modelName, ref: partId });
        }
        if (letter === 'D') {
          const exact = rest.length !== 1
            ? { ok: false, reason: 'diode instance AREA, M, TEMP and other trailing fields are unsupported' }
            : model.ambiguous
              ? { ok: false, reason: 'duplicate diode model declarations are ambiguous' }
              : model.type === 'D' ? validateDiodeForDc(model.params, model.body)
                : { ok: false, reason: `model type ${model.type || '(missing)'} is not D` };
          if (exact.ok && diodeThermal.ok) {
            Object.assign(params, exact.params);
            // A BREAKDOWN VOLTAGE MAKES IT A ZENER, and only once the model is
            // otherwise admitted — a model blocked for another reason must not
            // become a zener on the way out, which is the invariant
            // `test/spice-diode-op.test.js` holds.
            const bv = diodeBreakdown(model.params);
            if (bv !== null) { kind = 'zener'; params.vz = bv; }
            // THE RAW MODEL IS KEPT EVEN ON SUCCESS. A DC solve is entitled to
            // ignore CJO/TT/VJ/M; an AC or transient consumer is not, and
            // without the text it could not tell that this part was admitted on
            // a DC-scoped rule rather than a complete one.
            const notes = exact.notes || { nonDc: [], nonParameter: [], defaulted: [] };
            if ((notes.defaulted || []).length) {
              warnings.push(`${partId}: the model states no ${notes.defaulted.join(', ').toUpperCase()}`
                + `, so ngspice's documented default(s) are used — the same value the reference `
                + 'simulator fills in.');
            }
            if (notes.nonDc.length || notes.nonParameter.length) {
              params._spiceModel = model.source;
              params._spiceNonDcFields = notes.nonDc.join(',') || undefined;
              const parts = [];
              if (notes.nonDc.length) {
                parts.push(`${notes.nonDc.join(', ').toUpperCase()} shape AC and transient `
                  + 'behaviour and are inert at a bias point');
              }
              if (notes.nonParameter.length) {
                parts.push(`${notes.nonParameter.join(', ').toUpperCase()} `
                  + (notes.nonParameter.length > 1 ? 'are' : 'is') + ' metadata, not a model parameter');
              }
              warnings.push(`${partId}: the DC curve is taken from IS, N and RS; ${parts.join('; ')}. `
                + 'The raw model is preserved for an analysis that reads them.');
            }
            if (!diodeThermal.explicit) warnings.push(`${partId}: omitted SPICE TEMP/TNOM uses bw-board's fixed VT=0.02585 V profile; raw default-temperature source fidelity is not established.`);
          } else {
            const reason = exact.ok ? diodeThermal.reason : exact.reason;
            Object.assign(params, { _spiceBlocked: reason, _spiceModel: model.source,
              ...(diodeThermal.source.length ? { _spiceTemperature: diodeThermal.source.join('\n') } : {}) });
            losses.push({ ref: partId, kind: 'unsupported-diode-model',
              source: [model.source, ...diodeThermal.source].join('\n'),
              reason });
          }
        } else Object.assign(params, mapModel(letter, model, warnings, partId));
        if (letter === 'Q') kind = model.type === 'PNP' ? 'pnp' : 'npn';
        if (letter === 'M') kind = model.type === 'PMOS' ? 'pmos' : 'nmos';
        if (letter === 'J') kind = model.type === 'PJF' ? 'pmos' : 'nmos';
        // A BLOCKED MODEL MUST NOT BECOME A ZENER. This line ran for every D
        // card with a BV, admitted or not, so a model refused for a DUPLICATE
        // FIELD still reached the engine wearing a kind nothing had validated
        // it for. The admitted path sets `params.vz` above; if that did not
        // happen, the model was blocked and keeps its blocker.
        if (letter === 'D' && model.params.bv && params.vz !== undefined) kind = 'zener';
      }
      if (letter !== 'D' || params.model !== 'shockley') params._model = rest[0] || null;
      // INSTANCE PARAMETERS. `W=20u L=1u` on the element line, not in the
      // model card, and for a level-1 MOSFET they are half the transconductance
      // — `mosK` computes KP/2 * W/L and falls back to a ratio of 1 without
      // them. Only the two the solver reads are taken; anything else on the
      // line (AD, AS, PD, PS, M, NRD...) is geometry for a model we do not
      // have, and is recorded as a loss below rather than silently ignored.
      const instance = {};
      for (const field of rest.slice(1)) {
        const kv = /^([A-Za-z_]+)\s*=\s*(\S+)$/.exec(field);
        if (!kv) continue;
        const value = parseSpiceValue(kv[2]);
        if (isFinite(value)) instance[kv[1].toLowerCase()] = value;
      }
      if (letter === 'M') {
        if (instance.w !== undefined) params.w = instance.w;
        if (instance.l !== undefined) params.l = instance.l;
        // WHERE THE BULK IS TIED DECIDES WHETHER THE BODY EFFECT APPLIES.
        //
        // The engine's nmos/pmos have three terminals, so the bulk node is not
        // wired — but it is not irrelevant either: a stacked device (a
        // cascode's upper transistor, a diff pair's tail-connected pair, a
        // mirror's output leg) has its source above the bulk BY CONSTRUCTION,
        // and its threshold is then not VTO at all.
        //
        // Three cases:
        //   bulk is node 0             -> flagged; Vsb = V(source), and both
        //                                 bulk junctions are live
        //   bulk is the source's node  -> both junctions shorted, Vsb = 0
        //   bulk is some THIRD node    -> left alone, not guessed
        //
        // THE FLAG MEANS "THE DECK TIED THE BULK TO THE REFERENCE", AND NOTHING
        // MORE. It once also required the source to be somewhere else, which
        // conflated two different needs: the body effect needs a source off the
        // bulk, but the bulk-DRAIN junction does not. A deck with source and
        // bulk both on node 0 and its drain pulled below ground got neither,
        // and read -5.000000 V where ngspice reads -0.633322 -- the drain
        // junction conducting 0.436 mA into a 10k pull-down. `mosVth` already
        // returns VTO unchanged when Vsb works out to 0, so widening this
        // costs the body effect nothing.
        //
        // Measured over ADI2005's 15,587 M cards: 11,950 bulk-on-source,
        // 3,334 bulk-at-ground, 303 a third node. Of 311 numeric
        // disagreements in a 2,000-deck sample, 107 are decks that state a
        // non-zero GAMMA and have a source off the bulk.
        const bulkField = nodeFields[3];
        const srcField = nodeFields[2];
        if (bulkField !== undefined && srcField !== undefined) {
          const bulkIsGround = GROUND_NODES.has(String(bulkField).toLowerCase());
          const sameNode = String(bulkField).toLowerCase() === String(srcField).toLowerCase();
          if (bulkIsGround) params.bulkAtGround = true;
          else if (!sameNode) {
            warnings.push(`${partId}: bulk node "${bulkField}" is neither ground nor the source, `
              + 'so the body effect is not applied — the engine MOSFET has no bulk terminal and '
              + 'this reader will not guess a potential for it.');
          }
        }
        const unsupported = Object.keys(instance).filter(k => k !== 'w' && k !== 'l');
        if (unsupported.length) {
          warnings.push(`${partId}: instance parameter(s) ${unsupported.join(', ')} are not `
            + 'read by the engine\'s square-law MOSFET.');
        }
      }
    } else if (spec.source) {
      const { value, note, externalWaveform, waveformParams, waveformLoss, scalarLoss, acParams } =
        sourceValue(rest, spec.source === 'volts', constantParameters.values);
      if (Number.isFinite(value)) params[spec.source] = value;
      if (waveformParams) Object.assign(params, waveformParams);
      if (acParams) Object.assign(params, acParams);
      if (note) warnings.push(`${partId}: ${note}`);
      if (waveformLoss) {
        losses.push({
          ref: partId,
          kind: 'unsupported-inline-waveform',
          source: item.line,
          reason: waveformLoss,
          fallback: { parameter: spec.source, value },
        });
      }
      if (externalWaveform) {
        const reason = 'external WAVEFILE waveform is not read or modelled';
        warnings.push(`${partId}: ${reason} — imported as a fixed ${value} `
          + `${spec.source === 'volts' ? 'V' : 'A'} source; numeric oracle comparison is unsafe.`);
        losses.push({
          ref: partId,
          kind: 'unsupported-external-waveform',
          source: item.line,
          reason,
          fallback: { parameter: spec.source, value },
        });
      }
      if (scalarLoss) {
        const finding = { type: 'semantic-import-loss', ref: partId,
          reason: scalarLoss, source: item.line, fallback: null };
        losses.push({ ref: partId, kind: 'unsupported-constant-expression',
          source: item.line, reason: scalarLoss, fallback: null });
        item.analysisBlocker = finding;
      }
    } else if (spec.param) {
      const expression = firstScalarExpression(rest);
      const resolved = scalarValue(expression, constantParameters.values);
      if (resolved.ok) params[spec.param] = resolved.value;
      else {
        const reason = `value ${JSON.stringify(expression)} is not a resolved finite constant: ${resolved.reason}`;
        warnings.push(`${partId}: ${reason}; no engine default is analysis-safe.`);
        losses.push({ ref: partId, kind: 'unsupported-constant-expression',
          source: item.line, reason, fallback: null });
        item.analysisBlocker = { type: 'semantic-import-loss', ref: partId,
          reason, source: item.line, fallback: null };
      }
    }

    parts.push({ id: partId, kind, params, x: 0, y: 0,
      ...(item.analysisBlocker ? { analysisBlockers: [item.analysisBlocker] } : {}) });

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

  // ── LAST-RESORT GROUND ────────────────────────────────────────────
  //
  // A deck that names no `0` and no `gnd` has no reference, and the solve
  // refuses a circuit with nothing to measure against. If exactly one of the
  // spellings ngspice does NOT alias is present, it is the only candidate, and
  // adopting it is better than refusing — but it is a GUESS about the deck and
  // it is reported as one, because a silent guess is how `vss` came to swallow
  // 876 negative supply rails.
  if (!groundUsed) {
    const present = FALLBACK_GROUND_NODES.filter(g => nets.has(g)
      || [...nets.keys()].some(k => k.toLowerCase() === g));
    if (present.length) {
      const chosen = [...nets.keys()].find(k => k.toLowerCase() === present[0]);
      const members = nets.get(chosen) || [];
      nets.delete(chosen);
      const existing = nets.get('__GND__') || [];
      nets.set('__GND__', existing.concat(members));
      groundUsed = true;
      warnings.push(`This deck names no node 0 and no gnd, so "${chosen}" is taken as the `
        + 'reference. ngspice does not alias that spelling — it would solve this deck with '
        + `"${chosen}" as an ordinary node and refuse it for having no reference.`);
    }
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
  annotateImportedSingletonTerminals(parts, singletons.map(([, members]) => members));
  for (const [net] of singletons) {
    warnings.push(`Net "${net === '__GND__' ? '0' : net}" has one connection — nothing to wire it to.`);
  }

  // THE DECK'S OWN NODE NAMES, kept rather than thrown away.
  //
  // The star wiring reproduces the PARTITION exactly, which is all the
  // round-trip oracle needs, and it discards what the deck CALLED each net.
  // That made a foreign deck unjudgeable: the engine's netlist names its nets
  // `net-lgc-1`, ngspice reports `vdd`, and a comparison by name found zero
  // shared nodes on 195 of 200 ADI decks — "nothing compared", which reads
  // like a harness failure and is really a dropped fact.
  //
  // One entry per deck net: its name (`0` for ground) and the part terminals
  // on it. A consumer joins that to the engine's netlist through any one
  // terminal, so no naming convention has to be shared.
  const netNames = [...nets.entries()].map(([net, members]) => ({
    name: net === '__GND__' ? '0' : net,
    terminals: members.map(m => ({ partId: m.partId, terminal: m.terminal })),
  }));

  return { parts, wires, warnings, unmapped, losses, ignored, analyses, title, netNames,
    usedLibraries };
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
    // A DECK THAT STATES `Is` IS ASKING FOR EBERS-MOLL, AND WE HAVE IT.
    //
    // The engine's default BJT is a piecewise knee, which is right for a
    // gallery part described by a datasheet `vbe` and has no SPICE spelling.
    // A FOREIGN deck is the other case entirely: `.model Q NPN (Bf=200
    // Is=1e-14)` states the saturation current outright, which is exactly what
    // full Ebers-Moll needs and what the reference simulator will solve with.
    // Importing that as a knee makes the two sides different devices.
    //
    // Same rule the diode branch above already applies — `out.model =
    // 'shockley'` when Is is stated — and the same per-part escape hatch
    // `ebersMollParams` reads. `Br` is SPICE's reverse beta, defaulting to 1.
    if (isFinite(p.bf)) out.beta = p.bf;
    if (isFinite(p.is)) {
      out.is = p.is;
      if (isFinite(p.br)) out.br = p.br;
      if (isFinite(p.nf)) out.n = p.nf;
      out.model = 'shockley';
    }
  } else if (letter === 'M') {
    // LEVEL-1 SQUARE LAW: VTO AND KP, AND KP WAS BEING DROPPED.
    //
    // The engine's `mosK` already reads `kp` with per-instance `w`/`l`
    // (`k = KP/2 * W/L`, src/mna.js) — the importer simply never passed them,
    // so a deck stating `KP=1.0e-4` with `W=20u L=1u` was solved at the
    // engine's fallback k = 0.5, five hundred times too big. On the ADI
    // cascode bench that put the output at 0.0188 V where the deck's own
    // numbers give about 11.4 V. Measured over that corpus: 15,587 M elements
    // in 12,471 decks, all of them level-1 with VTO and KP stated.
    //
    // W and L are INSTANCE parameters, not model ones, so they are read from
    // the element line below rather than here.
    if (isFinite(p.vto)) out.vth = p.vto;
    if (isFinite(p.kp)) out.kp = p.kp;
    // BODY EFFECT. GAMMA defaults to 0 in SPICE, so a model that omits it gets
    // no shift and this is identity. `bulkAtGround` is set at the ELEMENT below,
    // because whether the body effect applies depends on where the deck tied
    // the bulk, which is an instance fact and not a model one.
    if (isFinite(p.gamma)) out.gamma = p.gamma;
    if (isFinite(p.phi)) out.phi = p.phi;
    // THE BULK JUNCTIONS' SATURATION CURRENT. A SPICE MOSFET's bulk carries a
    // pn junction to the source and another to the drain, and `IS` is their
    // saturation current (SPICE's default, 1e-14 A, is the engine's too). It is
    // called `bulkIs` on the card because a part's bare `is` already means a
    // diode's own junction, and one name for two junctions is how a value ends
    // up with two meanings.
    if (isFinite(p.is)) out.bulkIs = p.is;
    // CHANNEL-LENGTH MODULATION. Level-1 saturation is
    // Id = k*Vov^2*(1 + LAMBDA*Vds), which is LINEAR in Vds — so it needs no
    // second Newton variable: the engine stamps `lambda * Id` as the
    // drain-source conductance beside the VCCS and the two terms reproduce the
    // law exactly. Without it the ADI cascode bench sat 12.5 mV off ngspice
    // after everything else agreed.
    if (isFinite(p.lambda)) out.lambda = p.lambda;
  } else if (letter === 'J') {
    // BETA is the transconductance directly, so it becomes `k` — `mosK` returns
    // `params.k` untouched and never reaches the KP/2 * W/L path.
    if (isFinite(p.vto)) out.vth = p.vto;
    if (isFinite(p.beta)) out.k = p.beta;
    if (isFinite(p.lambda)) out.lambda = p.lambda;
  }
  return out;
}

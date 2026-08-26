/**
 * Fritzing importer (`.fz`, and the `.fzz` archive's inner document).
 *
 * Fritzing is what the maker web is drawn in — Hackster, Instructables and
 * a decade of blog posts ship `.fzz` files — so this is the format that
 * turns those projects into something simulable here rather than a
 * picture of a breadboard.
 *
 * The document is XML, parsed the way eagle.js and kicad-netlist.js parse
 * theirs: minimal tag scanning, no XML dependency.
 *
 *   <instance moduleIdRef="ResistorModuleID" modelIndex="7">
 *     <property name="resistance" value="2.2k"/>
 *     <title>R1</title>
 *     <views>
 *       <schematicView layer="schematic">
 *         <connectors>
 *           <connector connectorId="connector0">
 *             <connects><connect connectorId="connector1" modelIndex="9"/></connects>
 *
 * Three facts decide the whole design:
 *
 *   - CONNECTIONS ARE PER VIEW, and the same circuit appears three times
 *     (breadboard, schematic, pcb). They are not equivalent: the breadboard
 *     view routes through the board's own strips, so it carries connections
 *     the circuit does not have. The SCHEMATIC view is the electrical one
 *     and is preferred; breadboard is the fallback for documents that have
 *     no schematic laid out.
 *   - A WIRE IS AN INSTANCE. `WireModuleID` parts have two connectors and
 *     no behaviour; they are the drawn line, not a component. They are
 *     dissolved into the nets they join, exactly as breadboard jumpers are
 *     everywhere else in this codebase.
 *   - `moduleIdRef` IS OFTEN A HASH. Fritzing core parts have readable ids
 *     (`ResistorModuleID`), but anything from a user's parts bin is a
 *     32-hex-digit name that says nothing about what the chip is. Those are
 *     REPORTED with their label and pin count, never guessed at — the same
 *     rule eagle.js states: a schematic that half-imports without saying so
 *     is worse than one that refuses, because the simulation then answers
 *     confidently about a circuit nobody drew.
 *
 * @module
 */

/** Attributes of a single tag, same helper shape as eagle.js. */
const attrs = (tag) => {
  const out = {};
  for (const m of tag.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = m[2];
  return out;
};

/** Cheap gate for detect.js. */
export function looksLikeFritzing(text) {
  return /<module\b[^>]*fritzingVersion|<instances>\s*<instance\b/.test(text)
    && /moduleIdRef=/.test(text);
}

/**
 * Fritzing core moduleIdRef → engine kind. Core ids are stable strings;
 * everything else (user parts, hashes) falls through to `unmapped`.
 * The value may be a string kind or {kind, params}.
 */
const MODULE_KINDS = [
  [/^ResistorModuleID/i, 'resistor'],
  [/LED.*ModuleID|^.*ColorLEDModuleID/i, 'led'],
  [/^CapacitorModuleID|Electrolytic.*Capacitor|CeramicCapacitor/i, 'capacitor'],
  [/^Diode.*ModuleID|1N4148|1N400/i, 'diode'],
  [/ZenerDiode/i, 'zener'],
  [/^Inductor/i, 'inductor'],
  [/Potentiometer/i, 'potentiometer'],
  [/PushbuttonModuleID|^.*[Pp]ushbutton/i, 'button'],
  [/ToggleSwitch|SpdtSwitch|SlideSwitch/i, 'slide_switch'],
  [/DipSwitch/i, 'dip_switch_spst'],
  [/Piezo|Buzzer/i, 'buzzer'],
  [/Photocell|LDRModuleID/i, 'ldr'],
  [/Thermistor/i, 'ntc'],
  [/NPN.*Transistor|^BC547|^2N3904/i, 'npn'],
  [/PNP.*Transistor|^BC557|^2N3906/i, 'pnp'],
  [/^BatteryModuleID|9V.*Battery|AA.*Battery/i, 'vsource'],
  [/PowerLabel|VCC/i, 'vcc'],
  [/GroundLabel|^GND/i, 'gnd'],
  [/SevenSegment/i, 'seven_segment'],
  [/^555|NE555|TimerModuleID/i, '555'],
];

/** Instances that are scenery, not circuit: boards, notes, frames, logos. */
const IGNORED = /Breadboard|PCBModuleID|^NoteModuleID|LogoImage|^RulerModuleID|Frame|Hole/i;

/** The drawn line — dissolved into the nets it joins. */
const IS_WIRE = /^WireModuleID/i;

const kindFor = (moduleId) => {
  for (const [re, kind] of MODULE_KINDS) if (re.test(moduleId)) return kind;
  return null;
};

/** Fritzing resistance/capacitance strings: "2.2k", "220Ω", "100nF". */
const SI = { p: 1e-12, n: 1e-9, u: 1e-6, µ: 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6 };
export function parseFritzingValue(raw) {
  if (!raw) return null;
  const s = String(raw).trim().replace(/(ohms?|Ω|F|farads?|H)$/i, '').trim();
  const m = /^(\d*\.?\d+)\s*([pnuµmkKM])?$/.exec(s);
  return m ? Number(m[1]) * (m[2] ? SI[m[2]] ?? 1 : 1) : null;
}

/** Union-find over connector nodes. */
class UF {
  constructor() { this.p = new Map(); }
  find(x) {
    if (!this.p.has(x)) { this.p.set(x, x); return x; }
    let r = x;
    while (this.p.get(r) !== r) r = this.p.get(r);
    this.p.set(x, r);
    return r;
  }
  union(a, b) { const ra = this.find(a); const rb = this.find(b); if (ra !== rb) this.p.set(ra, rb); }
}

/**
 * @param {string} text  Contents of the `.fz` document
 * @param {{view?: string}} [opts]
 * @returns {{parts: object[], wires: object[], warnings: string[], unmapped: object[]}}
 */
export function importFritzing(text, opts = {}) {
  const warnings = [];
  const unmapped = [];
  if (!looksLikeFritzing(text)) {
    return { parts: [], wires: [], warnings: ['Not a Fritzing document: no <instance moduleIdRef=…> found.'], unmapped };
  }

  // ── pass 1: instances, and which view carries the connections ────
  const instances = [];
  for (const m of text.matchAll(/<instance\b([^>]*)>([\s\S]*?)<\/instance>/g)) {
    const a = attrs(m[1]);
    const body = m[2];
    const title = (/<title>([^<]*)<\/title>/.exec(body) || [])[1] || '';
    const props = {};
    for (const p of body.matchAll(/<property\s+name="([^"]+)"\s+value="([^"]*)"/g)) props[p[1]] = p[2];
    instances.push({
      moduleId: a.moduleIdRef || '',
      modelIndex: String(a.modelIndex ?? ''),
      title, props, body,
    });
  }
  if (!instances.length) {
    return { parts: [], wires: [], warnings: ['Fritzing document has no instances.'], unmapped };
  }

  const hasSchematic = /<schematicView\b/.test(text);
  const view = opts.view || (hasSchematic ? 'schematicView' : 'breadboardView');
  if (!hasSchematic && !opts.view) {
    warnings.push('No schematic view in this document — connections were read from the BREADBOARD view, '
      + 'which routes through the board\'s own strips and can therefore show connections the circuit does not have.');
  }

  // ── pass 2: the connection graph, from ONE view only ─────────────
  const uf = new UF();
  const node = (modelIndex, connectorId) => `${modelIndex}/${connectorId}`;
  const byIndex = new Map(instances.map((i) => [i.modelIndex, i]));

  for (const inst of instances) {
    const viewBlock = new RegExp(`<${view}\\b[^>]*>([\\s\\S]*?)</${view}>`).exec(inst.body);
    if (!viewBlock) continue;
    for (const c of viewBlock[1].matchAll(/<connector\b([^>]*)>([\s\S]*?)<\/connector>/g)) {
      const cid = attrs(c[1]).connectorId;
      if (!cid) continue;
      const self = node(inst.modelIndex, cid);
      uf.find(self);
      for (const link of c[2].matchAll(/<connect\b([^>]*)\/?>/g)) {
        const la = attrs(link[1]);
        if (!la.modelIndex || !la.connectorId) continue;
        if (!byIndex.has(String(la.modelIndex))) continue;   // dangling reference
        uf.union(self, node(String(la.modelIndex), la.connectorId));
      }
    }
  }

  // ── pass 3: classify instances ───────────────────────────────────
  const parts = [];
  const seen = new Set();
  const terminalOf = new Map();       // "modelIndex/connectorId" -> {partId, terminal}
  let anon = 0;

  for (const inst of instances) {
    if (IS_WIRE.test(inst.moduleId)) continue;               // dissolved below
    // Scenery is matched on the LABEL too: a breadboard dragged from a
    // user's bin carries a hash for an id, and importing its holes as a
    // part would invent a 60-terminal component nobody placed.
    if (IGNORED.test(inst.moduleId) || IGNORED.test(inst.title)) continue;
    const kind = kindFor(inst.moduleId);
    const connectorIds = [...new Set(
      [...inst.body.matchAll(/<connector\b[^>]*connectorId="([^"]+)"/g)].map((x) => x[1]),
    )].sort();
    if (!kind) {
      unmapped.push({
        ref: inst.title || `?${anon++}`,
        moduleId: inst.moduleId,
        pins: connectorIds.length,
        reason: /^[0-9a-f]{12,}$/i.test(inst.moduleId)
          ? 'a custom part from the author\'s bin — the document carries no part definition, only this id'
          : 'no engine kind is mapped to this Fritzing module',
      });
      continue;
    }
    let id = (inst.title || kind).replace(/[^\w]/g, '_');
    while (seen.has(id)) id = `${id}_`;
    seen.add(id);

    const params = {};
    const ohms = parseFritzingValue(inst.props.resistance);
    if (kind === 'resistor' && ohms != null) params.ohms = ohms;
    const farads = parseFritzingValue(inst.props.capacitance);
    if (kind === 'capacitor' && farads != null) params.farads = farads;
    if (kind === 'led' && inst.props.color) params.color = String(inst.props.color).toLowerCase().split(' ')[0];

    // Fritzing numbers connectors connector0..N in the part's own pin
    // order; engine terminal names come from the kind. Two-terminal parts
    // are the honest case — anything wider needs a real part definition,
    // which a bare .fz does not carry.
    const TWO = { resistor: ['a', 'b'], capacitor: ['a', 'b'], inductor: ['a', 'b'],
      led: ['anode', 'cathode'], diode: ['anode', 'cathode'], zener: ['anode', 'cathode'],
      button: ['a', 'b'], ldr: ['a', 'b'], ntc: ['a', 'b'], buzzer: ['a', 'b'],
      vsource: ['pos', 'neg'] };
    const names = TWO[kind];
    connectorIds.forEach((cid, i) => {
      const t = names ? names[i] : (kind === 'vcc' ? 'vcc' : kind === 'gnd' ? 'gnd' : `p${i}`);
      if (t) terminalOf.set(node(inst.modelIndex, cid), { partId: id, terminal: t });
    });
    if (names && connectorIds.length > names.length) {
      warnings.push(`${id}: Fritzing part has ${connectorIds.length} connectors but ${kind} has ${names.length} terminals — extra pins ignored.`);
    }
    parts.push({ id, kind, params, x: 0, y: 0 });
  }

  // ── pass 4: nets → wires ─────────────────────────────────────────
  // Every mapped terminal in one union-find class is one net; emit a star
  // of wires from the first member so the circuit model sees the group.
  const groups = new Map();
  for (const [key, t] of terminalOf) {
    const root = uf.find(key);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(t);
  }
  const wires = [];
  for (const members of groups.values()) {
    for (let i = 1; i < members.length; i++) {
      wires.push({
        from: members[0].partId, fromTerminal: members[0].terminal,
        to: members[i].partId, toTerminal: members[i].terminal,
      });
    }
  }

  const wireCount = instances.filter((i) => IS_WIRE.test(i.moduleId)).length;
  if (wireCount) warnings.push(`${wireCount} drawn wire(s) dissolved into nets.`);
  if (unmapped.length) {
    warnings.push(`${unmapped.length} part(s) could not be mapped and were left out: `
      + `${unmapped.map((u) => `${u.ref} (${u.pins} pins)`).join(', ')}. `
      + 'Their connections are therefore absent from the imported circuit.');
  }
  return { parts, wires, warnings, unmapped };
}

/**
 * Open a `.fzz` archive and import the `.fz` document inside it.
 *
 * A Fritzing project is a zip whose payload is one `.fz` plus any custom
 * part definitions (`.fzp`) and their SVGs. Only the document is needed
 * for connectivity; the `.fzp` files would name the custom parts, and
 * are reported so a caller can see what the author shipped.
 *
 * @param {ArrayBuffer|Uint8Array} buf
 * @returns {Promise<{parts, wires, warnings, unmapped, partDefs: string[]}>}
 */
export async function importFzz(buf) {
  const { readZipText } = await import('./zip.js');
  const { files, warnings: zipWarnings } = await readZipText(buf, (n) => /\.(fz|fzp)$/i.test(n));
  const docName = Object.keys(files).find((n) => /\.fz$/i.test(n));
  const partDefs = Object.keys(files).filter((n) => /\.fzp$/i.test(n));
  if (!docName) {
    return { parts: [], wires: [], unmapped: [], partDefs,
      warnings: [...zipWarnings, 'No .fz document inside this .fzz archive.'] };
  }
  const result = importFritzing(files[docName]);
  result.partDefs = partDefs;
  result.warnings = [...zipWarnings, ...result.warnings];
  if (partDefs.length) {
    result.warnings.push(`${partDefs.length} custom part definition(s) ship with this project `
      + '(.fzp); their pin names are not read yet, so those parts import unmapped.');
  }
  return result;
}

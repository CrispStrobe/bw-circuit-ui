#!/usr/bin/env node
/**
 * bwc — the circuit workshop on the command line.
 *
 * Everything the app can do to a FILE, without the app: read a foreign
 * schematic, write one back, and render the schematic view headlessly. That
 * last one is the point — the schematic projection was previously only
 * observable by opening the app and looking, which is no way to find out how
 * it behaves across three hundred real boards.
 *
 *   bwc info      <file>                    what is in it, and what did not map
 *   bwc op        <file>                    independent static DC operating point
 *   bwc analyze   <file> --profile precision-v1 [--observations source-declared-v1|bounded-research-v1]
 *   bwc convert   <file> --to eagle|kicad-sch|kicad|spice|json [-o out]
 *   bwc render    <file> [-o out.svg] [--dark]
 *   bwc roundtrip <file>                    import -> export -> import, compared
 *   bwc batch     <dir>  [--render <outdir>] [--roundtrip]
 *
 * batch is what makes a corpus usable: it walks a directory of schematics,
 * imports each, and prints the totals that matter — coverage, what stayed
 * unmapped, and how many parts fell back to a generic box because no symbol
 * exists for their kind.
 *
 * Input format is detected from content (see src/importers/detect.js), so a
 * mis-named file still parses. `.json` is our own circuit format.
 *
 * PNG is deliberately absent: rasterising needs a real renderer (resvg,
 * sharp, a browser) and none is a dependency here. SVG is the honest output;
 * pipe it through whatever rasteriser you already trust.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');
/**
 * The engine's tree: the installed `bw-board` package (the same one the UI
 * imports by name), or `BW_BOARD=/path/to/checkout` for live work against a
 * sibling checkout.
 */
const engineDir = () => process.env.BW_BOARD
  || dirname(fileURLToPath(import.meta.resolve('bw-board/package.json')));

const { importCircuit } = await import(join(SRC, 'importers/index.js'));
const { detectFormat } = await import(join(SRC, 'importers/detect.js'));
const { toEagleSch } = await import(join(SRC, 'model/exporters/eagle.js'));
const { toKicadSch } = await import(join(SRC, 'model/exporters/kicad-sch.js'));
const { toLtspiceAsc } = await import(join(SRC, 'model/exporters/ltspice-asc.js'));
const { renderSchematicSvg, netsFromWires } = await import(join(SRC, 'model/schematic-svg.js'));

/** The engine is optional: only netlist exports need it. */
async function loadEngine() {
  const BWB = engineDir();
  try {
    const { setEngine } = await import(join(SRC, 'engine.js'));
    const eng = await import(join(BWB, 'src/index.js'));
    (await import(join(BWB, 'src/register-all.js'))).registerAllDevices();
    // getDevice makes bw-board authoritative for terminal names. Without it
    // this CLI reproduces the browser bug it is meant to check for: parts
    // placed by kind get terminals the engine rejects, and checkWiring
    // rejects the whole netlist rather than the pin.
    setEngine({ BoardImpl: eng.BoardImpl, inferNetlist: eng.inferNetlist,
      checkWiring: eng.checkWiring, getDevice: eng.getDevice });
    const { registerSidecar } = await import(join(SRC, 'model/parts-registry.js'));
    const { readdirSync } = await import('node:fs');
    for (const f of readdirSync(join(SRC, 'parts-data'))) {
      if (!f.endsWith('.json')) continue;
      try {
        const sc = JSON.parse(readFileSync(join(SRC, 'parts-data', f), 'utf8'));
        if (sc.kind) registerSidecar(sc);
      } catch { /* bw-parts' problem */ }
    }
    const { Circuit } = await import(join(SRC, 'model/circuit.js'));
    return { Circuit };
  } catch (e) {
    return { error: e && e.message };
  }
}

/** Connected components over wire endpoints. */
function partition(wires) {
  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); }
    return x;
  };
  for (const w of wires) {
    const a = find(w.from + ' ' + w.fromTerminal); const b = find(w.to + ' ' + w.toTerminal);
    if (a !== b) parent.set(a, b);
  }
  const g = new Map();
  for (const k of parent.keys()) { const r = find(k); if (!g.has(r)) g.set(r, []); g.get(r).push(k); }
  return [...g.values()].map((v) => v.sort().join('|')).sort();
}

const args = process.argv.slice(2);
const cmd = args[0];
const positional = [];
const opts = {};
for (let i = 1; i < args.length; i++) {
  // Value-taking flags must be listed, or the value silently becomes a
  // positional and the flag reads as a bare boolean — which is how --render
  // quietly rendered nothing.
  if (['-o', '--to', '--render', '--profile', '--observations'].includes(args[i])) opts[args[i].replace(/^-+/, '')] = args[++i];
  else if (args[i].startsWith('--')) opts[args[i].slice(2)] = true;
  else positional.push(args[i]);
}
const die = (m) => { console.error('bwc: ' + m); process.exit(2); };
const usage = () => {
  console.log('bwc — circuit workshop CLI\n'
    + '  bwc info    <file>\n'
    + '  bwc op      <file>\n'
    + '  bwc analyze <file> --profile precision-v1 [--observations source-declared-v1|bounded-research-v1] [--json]\n'
    + '  bwc convert <file> --to asc|eagle|kicad-sch|kicad|spice|json [-o out]\n'
    + '  bwc render  <file> [-o out.svg] [--dark]\n'
    + '\n  audit <dir> [dir...]        four-layer readiness per part kind'
    + '\nInput: EAGLE .sch, KiCad .kicad_sch, KiCad legacy .sch, KiCad netlist,\n'
    + '       EasyEDA .json, Wokwi diagram.json, or our circuit .json.');
};

/** Read any supported file into {parts, wires, unmapped, ignored, warnings}. */
async function load(path) {
  const bytes = readFileSync(path);
  const text = bytes.toString('utf8');
  if (/^\s*\{/.test(text)) {
    try {
      const j = JSON.parse(text);
      if (Array.isArray(j.parts)) {
        return { parts: j.parts, wires: j.wires || [], vcc: j.vcc,
          sourceDocuments: j.sourceDocuments || [],
          sourceAnalysis: j.sourceAnalysis || null,
          analysisBlockers: j.analysisBlockers || [],
          unmapped: [], ignored: [], warnings: [], losses: [], format: 'json' };
      }
    } catch { /* not our json; fall through to the importers */ }
  }
  const fmt = detectFormat(text, path);
  if (fmt === 'kicad-legacy') {
    // A legacy .sch keeps NO pin geometry: it lives in the project's
    // `<project>-cache.lib`, which KiCad writes beside the .sch for exactly
    // this reason. Without it every part imports and not one wire does, so
    // finding it is part of reading the file, not an extra.
    const dir = dirname(path) || '.';
    const libs = [];
    try {
      const { readdirSync } = await import('node:fs');
      for (const e of readdirSync(dir)) {
        if (/\.lib$/i.test(e)) libs.push(readFileSync(join(dir, e), 'utf8'));
      }
    } catch { /* no directory listing; the importer will say what is missing */ }
    const r = importCircuit(fmt, text, { lib: libs });
    return { ...r, format: fmt };
  }
  if (fmt === 'kicad-sch') {
    // The requested path is the explicit root. Supply only direct sibling
    // schematics as inert text; Sheetfile strings never trigger a filesystem
    // read, traversal, or network lookup inside the importer.
    const dir = dirname(path) || '.';
    const files = new Map();
    try {
      const { readdirSync } = await import('node:fs');
      for (const entry of readdirSync(dir)) {
        if (/\.kicad_sch$/i.test(entry)) files.set(entry, readFileSync(join(dir, entry), 'utf8'));
      }
    } catch { /* missing children become explicit hierarchy losses */ }
    const r = importCircuit(fmt, text, { files, rootName: basename(path) });
    return { ...r, format: fmt };
  }
  if (fmt === 'ltspice-asc') {
    // The explicitly requested ASC's sibling ASYs are caller-owned inputs.
    // Supplying them is bounded and inert: no library name in the ASC can
    // make this loader open another path, and SPICE .include remains unfollowed.
    const dir = dirname(path) || '.';
    const symbols = new Map();
    let totalBytes = 0;
    try {
      const { readdirSync } = await import('node:fs');
      const entries = readdirSync(dir).filter(entry => /\.asy$/i.test(entry)).sort();
      if (entries.length <= 256) {
        for (const entry of entries) {
          const asset = readFileSync(join(dir, entry));
          totalBytes += asset.byteLength;
          if (asset.byteLength > 1024 * 1024 || totalBytes > 16 * 1024 * 1024) {
            symbols.clear(); break;
          }
          symbols.set(entry.replace(/\.asy$/i, '').toLowerCase(), asset.toString('utf8'));
        }
      }
    } catch { /* unresolved symbols stay explicit document dependencies */ }
    const r = importCircuit(fmt, bytes, { resolveSymbol: ({ normalizedName }) =>
      symbols.get(normalizedName.split('/').at(-1)) || null });
    return { ...r, format: fmt };
  }
  if (!fmt) {
    // THROW, never exit: batch must survive a file it cannot read, and a
    // single unrecognised schematic must not abort a 335-file run.
    throw new Error('could not recognise ' + basename(path)
      + ' (not EAGLE, KiCad schematic, KiCad netlist, EasyEDA, Wokwi or circuit JSON)');
  }
  const r = importCircuit(fmt, text);
  return { ...r, format: fmt };
}

if (!cmd || cmd === '--help' || cmd === '-h') { usage(); process.exit(0); }
const file = positional[0];
if (!file) die(cmd + ' needs a file');
const loadOrDie = async (p2) => { try { return await load(p2); } catch (e) { return die(e.message); } };

switch (cmd) {
  case 'info': {
    const c = await loadOrDie(file);
    console.log(basename(file) + '  [' + c.format + ']');
    console.log('  parts    : ' + c.parts.length);
    console.log('  wires    : ' + c.wires.length);
    console.log('  nets     : ' + netsFromWires(c.wires).length);
    if (c.sourceDocument?.format === 'ltspice-asc') {
      const stats = c.sourceDocument.stats || {};
      console.log('  ASC doc  : ' + (stats.records || 0) + ' records, '
        + (stats.symbols || 0) + ' symbols, ' + (stats.pinsRecovered || 0) + ' pins recovered');
      console.log('  ASC gaps : ' + (c.sourceDocument.findings || []).length + ' document finding(s), '
        + (c.sourceDocument.electricalProjection?.refusedInstances || []).length
        + ' electrical projection refusal(s)');
    }
    const kinds = {};
    for (const p of c.parts) kinds[p.kind] = (kinds[p.kind] || 0) + 1;
    console.log('  kinds    : ' + Object.entries(kinds).sort((a, b) => b[1] - a[1])
      .map(([k, v]) => k + '×' + v).join(', '));
    if (c.ignored && c.ignored.length) console.log('  ignored  : ' + c.ignored.length + ' drawing artifacts');
    if (c.unmapped && c.unmapped.length) {
      console.log('  UNMAPPED : ' + c.unmapped.length + ' — not imported:');
      for (const u of c.unmapped) console.log('      ' + u.ref + '  ' + u.libsource);
    }
    if (c.losses && c.losses.length) {
      console.log('  LOSSES   : ' + c.losses.length + ' — imported with semantics not represented:');
      for (const loss of c.losses) console.log('      ' + loss.ref + '  ' + loss.reason);
    }
    break;
  }

  case 'op': {
    const c = await loadOrDie(file);
    if (c.unmapped && c.unmapped.length) {
      die(`op refuses ${c.unmapped.length} unmapped component(s); run \`bwc info ${file}\``);
    }
    if (c.losses && c.losses.length) {
      die(`op refuses ${c.losses.length} semantic import loss(es); run \`bwc info ${file}\``);
    }
    if (!c.parts.length) die('op needs at least one imported circuit part');

    const { Circuit, error } = await loadEngine();
    if (error) die('op needs a bw-board engine with operatingPoint support (' + error + ')');
    const circ = Circuit.fromJSON({ vcc: Number.isFinite(c.vcc) ? c.vcc : 5,
      parts: c.parts, wires: c.wires });
    if (circ.netlistError) die('op could not build an engine netlist (' + circ.netlistError + ')');
    circ.setPower(true);

    let result;
    try { result = circ.operatingPoint(); } catch (e) { die(e && e.message ? e.message : String(e)); }
    if (!result || result.converged !== true) {
      die('op did not converge' + (result && result.railConflicts && result.railConflicts.length
        ? ': ' + result.railConflicts.join('; ') : ''));
    }
    if (result.railConflicts && result.railConflicts.length) {
      die('op found rail conflicts: ' + result.railConflicts.join('; '));
    }

    console.log(basename(file) + '  [' + c.format + ']  DC operating point');
    console.log('  converged: yes');
    console.log('  scope    : ' + result.analysis.scope);
    console.log('  sources  : ' + result.analysis.sources);
    console.log('  controlled: ' + result.analysis.controlledSources);
    console.log('  kinds    : ' + result.analysis.supportedKinds.join(', '));
    console.log('  capacitors: ' + result.analysis.capacitors);
    if (result.analysis.diodes?.temperatureModel === 'fixed') console.log('  diodes  : explicit Shockley IS/N/RS; fixed VT=' + result.analysis.diodes.thermalVoltage + ' V (26.8267934421 C profile)');
    console.log('  currents : ' + result.analysis.currentConvention);
    console.log('  nodes:');
    for (const [net, volts] of [...result.nodeVoltages].sort(([a], [b]) => a.localeCompare(b))) {
      console.log('    ' + String(net).padEnd(18) + ' ' + Number(volts).toPrecision(12) + ' V');
    }
    console.log('  terminal currents:');
    const rows = [];
    for (const [part, terminals] of result.branchCurrents) {
      for (const [terminal, amps] of terminals) rows.push([`${part}.${terminal}`, amps]);
    }
    for (const [terminal, amps] of rows.sort(([a], [b]) => a.localeCompare(b))) {
      console.log('    ' + terminal.padEnd(18) + ' ' + Number(amps).toPrecision(12) + ' A');
    }
    break;
  }

  case 'analyze': {
    if (opts.profile !== 'precision-v1') {
      die('analyze is an explicit high-accuracy action; select --profile precision-v1');
    }
    const observationProfile = opts.observations || 'source-declared-v1';
    if (!['source-declared-v1', 'bounded-research-v1'].includes(observationProfile)) {
      die('analyze --observations must be source-declared-v1 or bounded-research-v1');
    }
    const c = await loadOrDie(file);
    const source = c.sourceAnalysis || c;
    if (!Array.isArray(source.analyses) || !source.analyses.length) {
      die('analyze needs at least one source-declared .op, .ac, or .tran card');
    }
    const { error } = await loadEngine();
    if (error) die('analyze needs a bw-board engine with transient profile support (' + error + ')');
    const { runSourceAnalyses } = await import(join(SRC, 'model/source-analysis.js'));
    const results = runSourceAnalyses({
      ...c, analyses: source.analyses, netNames: source.netNames || [],
      analysisBlockers: c.analysisBlockers || [],
    }, { format: source.format || c.format, sourceName: source.sourceName || basename(file),
      transientProfile: opts.profile, observationProfile });
    const retainedDirectives = source.retainedDirectives || c.retainedDirectives || [];
    if (opts.json) {
      console.log(JSON.stringify({ source: basename(file), format: c.format,
        liveGUIProfile: 'interactive-v1', requestedTransientProfile: opts.profile,
        requestedObservationProfile: observationProfile, retainedDirectives, results }, null, 2));
    } else {
      console.log(`${basename(file)}  [${c.format}]  source analyses`);
      console.log('  live GUI profile : interactive-v1');
      console.log('  requested profile: precision-v1 (transient analyses only)');
      console.log(`  observation profile: ${observationProfile}${observationProfile === 'bounded-research-v1' ? ' (opt-in adapted output grid)' : ''}`);
      if (retainedDirectives.length) console.log(`  retained unrequested directives: ${retainedDirectives.length}`);
      for (const result of results) {
        const execution = result.executionProfile || result.conditions?.executionProfile;
        const pass = result.status === 'pass';
        const atProfile = result.kind === 'tran' ? ' at precision-v1' : '';
        console.log(`  ${result.kind.toUpperCase()} ${pass ? `engine execution PASS${atProfile}` : `${result.status.toUpperCase()}: ${result.detail || result.code}`}`);
        console.log(`      evidence: ${result.evidence || result.classification}`);
        console.log(`      thermal : ${result.thermal || 'not reported by this analysis kind'}`);
        console.log('      oracle  : not performed; no agreement claim');
        if (execution) {
          console.log(`      profile : ${execution.configured?.id || execution.requested}`);
          console.log(`      mode    : ${execution.integrationMode || 'not reported'}`);
          console.log(`      qualified local steps: ${execution.qualification?.accuracyMet === true ? 'yes' : 'no'}; not a global output-accuracy guarantee`);
          if (execution.work) console.log(`      work    : ${execution.work.attempts} attempts, ${execution.work.solves} solves, ${execution.work.advances} advances`);
        }
        for (const adapted of result.adapted || []) console.log(`      adapted : ${adapted}`);
        for (const skipped of result.skipped || []) console.log(`      skipped ${skipped.ref}: ${skipped.consequence}`);
      }
    }
    if (!results.length || results.some(result => result.status !== 'pass')) process.exitCode = 1;
    break;
  }

  case 'convert': {
    const to = opts.to || die('convert needs --to asc|eagle|kicad-sch|kicad|spice|json');
    const c = await loadOrDie(file);
    let text; let ext; let companionFiles = [];
    if (to === 'eagle') {
      const r = toEagleSch({ parts: c.parts, wires: c.wires });
      for (const w of r.warnings) console.error('  warning: ' + w);
      text = r.xml; ext = '.sch';
    } else if (to === 'asc' || to === 'ltspice-asc') {
      const r = toLtspiceAsc(c);
      for (const w of r.warnings) console.error('  warning: ' + w);
      for (const sk of r.skipped) console.error('  skipped: ' + JSON.stringify(sk));
      text = r.text; ext = '.asc'; companionFiles = r.symbolFiles || [];
    } else if (to === 'kicad-sch') {
      // A .kicad_sch, unlike our EAGLE output, is a file KiCad will open: it
      // carries its own lib_symbols. Connectivity is written as labels, not
      // wires -- see the exporter's header for why.
      const r = toKicadSch({ parts: c.parts, wires: c.wires });
      for (const w of r.warnings) console.error('  warning: ' + w);
      text = r.text; ext = '.kicad_sch';
    } else if (to === 'json') {
      const sourceAnalysis = c.sourceAnalysis || (c.analyses?.length ? {
        version: 1, format: c.format, sourceName: basename(file), analyses: c.analyses,
        netNames: c.netNames || [], retainedDirectives: c.retainedDirectives || [],
      } : null);
      text = JSON.stringify({ vcc: 5, parts: c.parts, wires: c.wires,
        ...(sourceAnalysis ? { sourceAnalysis } : {}),
        ...(c.sourceDocument || c.sourceDocuments?.length
          ? { sourceDocuments: [c.sourceDocument, ...(c.sourceDocuments || [])].filter(Boolean) } : {}) }, null, 1) + '\n'; ext = '.json';
    } else if (to === 'kicad' || to === 'spice') {
      // These serialise a NETLIST, which needs the engine to build a Circuit
      // first. Loud if the engine is not beside us — a half-written netlist
      // would be worse than none.
      const { Circuit, error } = await loadEngine();
      if (error) die('--to ' + to + ' needs a bw-board checkout beside this repo (' + error + ')');
      const circ = Circuit.fromJSON({ vcc: 5, parts: c.parts, wires: c.wires });
      if (!circ.board || circ.board.parts.length === 0) {
        die('the engine rejected this circuit, so its netlist would be empty — run `bwc info` and check for unmapped parts');
      }
      const { extractNetlist } = await import(join(SRC, 'model/netlist.js'));
      const netlist = extractNetlist(circ);
      if (to === 'kicad') {
        const { toKicadNet } = await import(join(SRC, 'model/exporters/kicad.js'));
        text = toKicadNet(netlist); ext = '.net';
      } else {
        const { toSpice } = await import(join(SRC, 'model/exporters/spice.js'));
        const r = toSpice(netlist);
        for (const sk of r.skipped || []) console.error('  skipped: ' + JSON.stringify(sk));
        text = r.text; ext = '.cir';
      }
    } else {
      die('unknown --to "' + to + '" (asc, eagle, kicad-sch, kicad, spice, json)');
    }
    const out = opts.o || basename(file, extname(file)) + ext;
    writeFileSync(out, text);
    for (const companion of companionFiles) {
      const companionPath = join(dirname(out), companion.name);
      writeFileSync(companionPath, companion.text);
      console.log('wrote ' + companionPath + ' (' + companion.text.length + ' bytes)');
    }
    console.log('wrote ' + out + ' (' + text.length + ' bytes)');
    break;
  }

  case 'render': {
    const c = await loadOrDie(file);
    const r = renderSchematicSvg({ parts: c.parts, wires: c.wires }, { dark: !!opts.dark });
    const out = opts.o || basename(file, extname(file)) + '.svg';
    writeFileSync(out, r.svg);
    console.log('wrote ' + out + '  ' + r.width + 'x' + r.height
      + '  symbols=' + r.symbols + '  generic-boxes=' + r.generic
      + (r.generic ? '  (kinds without artwork)' : ''));
    break;
  }

  case 'roundtrip': {
    const c = await loadOrDie(file);
    const out = toEagleSch({ parts: c.parts, wires: c.wires });
    const back = importCircuit('eagle', out.xml);
    const idsA = JSON.stringify(c.parts.map((p) => [p.id, p.kind]).sort());
    const idsB = JSON.stringify(back.parts.map((p) => [p.id, p.kind]).sort());
    const pa = JSON.stringify(partition(c.wires)); const pb = JSON.stringify(partition(back.wires));
    console.log(basename(file));
    console.log('  parts     ' + c.parts.length + ' -> ' + back.parts.length + '   ' + (idsA === idsB ? 'IDENTICAL' : 'CHANGED'));
    console.log('  nets      ' + partition(c.wires).length + ' -> ' + partition(back.wires).length
      + '   ' + (pa === pb ? 'IDENTICAL' : 'CHANGED'));
    if (out.skipped.length) console.log('  skipped   ' + out.skipped.map((s2) => s2.id + ':' + s2.kind).join(', '));
    process.exit(idsA === idsB && pa === pb ? 0 : 1);
    break;
  }

  case 'audit': {
    // Four-layer readiness per part kind. A symbol is the visible layer and
    // the least of them: a kind can draw beautifully and still be unplaceable,
    // unsimulable, or unreachable from a .bw program. This walks one or more
    // directories of circuits, tallies the kinds actually in use, and reports
    // which layers each one has.
    const { readdirSync, statSync } = await import('node:fs');
    const dirs = positional.filter(Boolean);
    const files = [];
    for (const d of dirs) {
      (function walk(x) {
        for (const e of readdirSync(x)) {
          if (e === '.git' || e === 'node_modules') continue;
          const q = join(x, e);
          if (statSync(q).isDirectory()) walk(q);
          else if (/\.(sch|kicad_sch|net|json)$/i.test(e)) files.push(q);
        }
      })(d);
    }

    const count = new Map();
    for (const f of files) {
      let c; try { c = await load(f); } catch { continue; }
      for (const p of c.parts) count.set(p.kind, (count.get(p.kind) || 0) + 1);
    }

    const { shapeFor } = await import(join(SRC, 'model/schematic-symbols.js'));
    const { terminalsForKind } = await import(join(SRC, 'model/circuit.js'));
    let engineKinds = null;
    try {
      const eng = join(engineDir(), 'src');
      const { registeredKinds } = await import(join(eng, 'devices.js'));
      const { registerAllDevices } = await import(join(eng, 'register-all.js'));
      const { BoardImpl } = await import(join(eng, 'board.js'));
      registerAllDevices();                       // registry is EMPTY until this runs
      engineKinds = new Set([...registeredKinds(), ...BoardImpl.getPartKinds()]);
    } catch { /* engine not beside us; that column reads '?' */ }

    // Active kinds and the dialect verb that drives or reads each. Absence
    // from this table means "passive" — a resistor needs no verb.
    const DIALECT = {
      relay: 'devices_setrelay', dc_motor: 'devices_setmotor',
      gearmotor: 'devices_setmotor', servo: 'devices_setservo',
      neopixel: 'devices_setneopixel', matrix8x8: 'devices_setpixel',
      led_matrix: 'devices_setpixel', ssd1306: 'devices_oledprint',
      sh1106: 'devices_oledprint', ili9341: 'devices_tftprint',
      char_lcd_i2c: 'devices_lcdprint', hd44780: 'devices_lcdprint',
      seven_segment: 'devices_showdigit', seven_seg_3: 'devices_showdigit',
      seven_seg_4: 'devices_showdigit', ultrasonic: 'devices_distance',
      pir_sensor: 'devices_motion', tilt_sensor: 'devices_tilted',
      temp_sensor: 'devices_temperature', tmp36: 'devices_temperature',
      ldr: 'devices_light', ir_receiver: 'devices_ircode',
      button: 'devices_pressed',
    };
    // If the generator cannot be read, the dialect column must say so. An
    // earlier version defaulted `gen` to '' and swallowed the error, so a
    // missing checkout reported EVERY active part as unreachable from the
    // dialect -- a column full of confident, invented failures.
    let gen = null;
    const GEN_PATHS = [
      join(SRC, '..', '..', 'sb3-creator', 'src', 'utils', 'sb3Creator.js'),
      join(process.env.HOME || '', 'code', 'sb3-creator', 'src', 'utils', 'sb3Creator.js'),
    ];
    const { readFileSync } = await import('node:fs');
    for (const g of GEN_PATHS) {
      try { gen = readFileSync(g, 'utf8'); break; } catch { /* try the next */ }
    }
    if (gen === null) {
      console.error('bwc: sb3-creator not found beside us — the bw column reads "?"');
    }

    const rows = [...count].sort((a, b) => b[1] - a[1]).map(([kind, n]) => {
      const sym = shapeFor(kind) ? 'sym' : ' -  ';
      let term = ' -  ';
      try { const t = terminalsForKind(kind, { pins: 4 }); if (t && t.length) term = 'wire'; } catch { }
      const eng = engineKinds ? (engineKinds.has(kind) ? 'eng' : ' -  ') : ' ?  ';
      const verb = DIALECT[kind];
      const dia = !verb ? '  . ' : gen === null ? ' ?  ' : (gen.includes(verb) ? 'bw ' : ' -  ');
      return { kind, n, sym, term, eng, dia };
    });

    console.log('layers: sym=schematic symbol  wire=placeable/wireable  '
      + 'eng=engine model (MNA)  bw=dialect verb   ( . = passive, no verb needed)');
    console.log('');
    console.log('  count  kind             sym  wire  eng   bw');
    for (const r of rows.slice(0, 60)) {
      console.log('  ' + String(r.n).padStart(5) + '  ' + r.kind.padEnd(16)
        + ' ' + r.sym + ' ' + r.term + '  ' + r.eng + '  ' + r.dia);
    }
    // The breadboard is the substrate, not a component: it has no engine model
    // because it is not supposed to have one, and at 1058 instances it would
    // otherwise dominate this list and make the real gaps look like noise.
    const NOT_A_COMPONENT = new Set(['breadboard', 'meter']);
    const inert = rows.filter((r) => r.eng === ' -  ' && !NOT_A_COMPONENT.has(r.kind));
    const mute = rows.filter((r) => r.dia === ' -  ');
    console.log('');
    console.log('DRAWS BUT HAS NO ENGINE MODEL — inert on the board (' + inert.length + ' kinds, '
      + inert.reduce((a, r) => a + r.n, 0) + ' parts):');
    for (const r of inert.slice(0, 30)) console.log('  ' + String(r.n).padStart(5) + '  ' + r.kind);
    if (mute.length) {
      console.log('ACTIVE BUT UNREACHABLE FROM THE DIALECT (' + mute.length + '):');
      for (const r of mute) console.log('  ' + String(r.n).padStart(5) + '  ' + r.kind);
    }
    break;
  }

  case 'batch': {
    const { readdirSync, statSync, mkdirSync } = await import('node:fs');
    const files = [];
    (function walk(d) {
      for (const e of readdirSync(d)) {
        if (e === '.git' || e === 'node_modules') continue;
        const q = join(d, e);
        if (statSync(q).isDirectory()) walk(q);
        else if (/\.(sch|kicad_sch|net|json)$/i.test(e)) files.push(q);
      }
    })(file);
    const outDir = typeof opts.render === 'string' ? opts.render : null;
    if (outDir) mkdirSync(outDir, { recursive: true });
    const genericBy = new Map();
    const unreadable = new Map();
    let ok = 0; let failed = 0; let parts = 0; let unmapped = 0; let generic = 0; let rtBad = 0;
    const unmappedBy = new Map();
    for (const f of files) {
      let c;
      try { c = await load(f); } catch (e) {
        failed++;
        const why = /could not recognise/.test(e.message) ? 'unrecognised format' : e.message.slice(0, 40);
        unreadable.set(why, (unreadable.get(why) || 0) + 1);
        continue;
      }
      if (!c.parts.length) { failed++; continue; }
      ok++; parts += c.parts.length; unmapped += (c.unmapped || []).length;
      for (const u of c.unmapped || []) {
        const k = String(u.libsource).split('/').pop();
        unmappedBy.set(k, (unmappedBy.get(k) || 0) + 1);
      }
      if (outDir) {
        const r = renderSchematicSvg({ parts: c.parts, wires: c.wires }, { dark: !!opts.dark });
        generic += r.generic;
        for (const k of r.genericKinds) genericBy.set(k, (genericBy.get(k) || 0) + 1);
        writeFileSync(join(outDir, basename(f).replace(/\W+/g, '_') + '.svg'), r.svg);
      }
      if (opts.roundtrip) {
        const back = importCircuit('eagle', toEagleSch({ parts: c.parts, wires: c.wires }).xml);
        if (JSON.stringify(partition(c.wires)) !== JSON.stringify(partition(back.wires))) {
          rtBad++;
          console.log('  ROUND-TRIP CHANGED: ' + basename(f));
        }
      }
    }
    console.log('files      : ' + files.length + '  imported ' + ok + ', unusable ' + failed);
    for (const [why, n] of [...unreadable].sort((a, b) => b[1] - a[1])) {
      console.log('             ' + String(n).padStart(4) + '  ' + why);
    }
    console.log('parts      : ' + parts + ' mapped, ' + unmapped + ' unmapped ('
      + (100 * parts / (parts + unmapped || 1)).toFixed(1) + '% coverage)');
    if (outDir) console.log('rendered   : ' + ok + ' svg into ' + outDir + ', ' + generic + ' parts drawn as generic boxes');
    if (opts.roundtrip) console.log('round-trip : ' + (ok - rtBad) + '/' + ok + ' preserved the net partition');
    if (outDir && genericBy.size) {
      console.log('KINDS WITH NO SCHEMATIC SYMBOL (drawn as a generic box):');
      for (const [k, v] of [...genericBy].sort((a, b) => b[1] - a[1]).slice(0, 60)) {
        console.log('  ' + String(v).padStart(5) + '  ' + k);
      }
      console.log('  ' + genericBy.size + ' distinct kinds need artwork');
    }
    console.log('top unmapped:');
    for (const [k, v] of [...unmappedBy].sort((a, b) => b[1] - a[1]).slice(0, 45)) {
      console.log('  ' + String(v).padStart(4) + '  ' + k);
    }
    break;
  }

  default:
    usage();
    die('unknown command "' + cmd + '"');
}

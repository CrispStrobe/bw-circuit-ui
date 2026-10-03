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
 *   bwc measure   <file> --scope <tip>[,<ref>] [--meter <mode>:<probe>] [--receipt <file>]
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

import { readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { basename, extname, join, dirname, resolve } from 'node:path';
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
const { createMeterState, readMeter } = await import(join(SRC, 'model/multimeter.js'));
const { operatingPointRows } = await import(join(SRC, 'model/operating-point-view.js'));
const { scopeProbeOptions } = await import(join(SRC, 'model/scope-probes.js'));
const { scopeTracesToCsv } = await import(join(SRC, 'model/scope-csv.js'));
const {
  compareExpectedWaveforms, parseExpectedWaveforms, parseMeterSpec, parseScaledNumber,
  parseExpectedMeters, createExpectedMeterComparison,
  parseScopeSpec, resolveEndpointNet, summarizeScope, timedScopeSeries, latestTimedScopeSample,
  measurementSampleClock, MEASUREMENT_MAX_SAMPLES,
  validatePrecisionCaptureInput, precisionCaptureBudget, validatePrecisionCaptureWork,
  precisionStreamBudget, validatePrecisionStreamWork,
  validatePrecisionVoltageTopology,
} = await import(join(SRC, 'model/instrument-report.js'));

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
const valueFlags = new Set(['-o', '--to', '--render', '--profile', '--observations', '--initial',
  '--scope', '--meter', '--probe', '--duration', '--rate', '--csv', '--expect', '--expect-meters',
  '--abs-volts', '--rel', '--time-tolerance', '--receipt', '--input',
  '--source', '--from', '--points', '--observe', '--current', '--expect-ac']);
const repeatFlags = new Set(['scope', 'meter', 'observe', 'current']);
for (let i = 1; i < args.length; i++) {
  // Value-taking flags must be listed, or the value silently becomes a
  // positional and the flag reads as a bare boolean — which is how --render
  // quietly rendered nothing.
  if (valueFlags.has(args[i])) {
    const key = args[i].replace(/^-+/, '');
    const value = args[++i];
    if (value == null) { console.error(`bwc: --${key} needs a value`); process.exit(2); }
    if (repeatFlags.has(key)) (opts[key] ||= []).push(value);
    else opts[key] = value;
  }
  else if (args[i].startsWith('--')) opts[args[i].slice(2)] = true;
  else positional.push(args[i]);
}
const die = (m) => { console.error('bwc: ' + m); process.exit(2); };
if (opts.receipt && cmd !== 'measure') die('--receipt is supported only by measure');
if (opts['expect-ac'] !== undefined && cmd !== 'analyze') die('--expect-ac is supported only by analyze');
const usage = () => {
  console.log('bwc — circuit workshop CLI\n'
    + '  bwc info    <file>\n'
    + '  bwc op      <file>\n'
    + '  bwc dc-sweep <file> --source V1 --from -1 --to 1 --points 201\n'
    + '              [--observe <tip>[,<ref>]] [--current <part>.<terminal>] [--expect curve.json] [--json]\n'
    + '  bwc verify-receipt <receipt.json> --input <circuit> [--expect waveform.json]\n'
    + '              [--expect-meters meters.json] [--csv trace.csv] [--json]\n'
    + '  bwc measure <file> --scope <tip>[,<ref>] [--probe ideal|10x|1x]\n'
    + '              [--meter voltage:<red>,<black>] [--meter current:<part>.<terminal>]\n'
    + '              [--meter resistance:<red>,<black>] [--duration 10ms] [--rate 10kHz]\n'
    + '              [--profile interactive-v1] [--watch] [--expect waveform.json] [--expect-meters meters.json] [--json] [--csv trace.csv] [--receipt capture.json]\n'
    + '              precision batch: --profile precision-v1 --initial zero-state (passive/source or bounded ADP7118 current-limited envelope)\n'
    + '  bwc analyze <file> --profile precision-v1 [--observations source-declared-v1|bounded-research-v1] [--expect-ac reference.json] [--json]\n'
    + '  bwc convert <file> --to asc|eagle|kicad-sch|kicad|spice|json [-o out]\n'
    + '  bwc render  <file> [-o out.svg] [--dark]\n'
    + '\n  audit <dir> [dir...]        four-layer readiness per part kind'
    + '\nInput: EAGLE .sch, KiCad .kicad_sch, KiCad legacy .sch, KiCad netlist,\n'
    + '       EasyEDA .json, Wokwi diagram.json, or our circuit .json.');
};

/** Read any supported file into {parts, wires, unmapped, ignored, warnings}. */
async function load(path, suppliedBytes) {
  const bytes = suppliedBytes ?? readFileSync(path);
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
const loadOrDie = async (p2, bytes) => { try { return await load(p2, bytes); } catch (e) { return die(e.message); } };

switch (cmd) {
  case 'dc-sweep': {
    const unsupported=Object.keys(opts).find(key=>!['source','from','to','points','observe','current','expect','json'].includes(key));
    if (unsupported) die(`dc-sweep does not support --${unsupported}`);
    try {
      const {dcSweepGrid,validateDcSweepInput,parseExpectedDcSweep,compareExpectedDcSweep}=await import(join(SRC,'model/dc-sweep-report.js'));
      const grid=dcSweepGrid(Number(opts.from ?? 0),Number(opts.to ?? 5),Number(opts.points ?? 21));
      const observations=[...(opts.observe||[]).map(value=>{
        const spec=parseScopeSpec(value);
        return {kind:'voltage',selector:spec.tip,reference:spec.reference||'',unit:'V'};
      }),...(opts.current||[]).map(value=>({kind:'current',selector:parseMeterSpec(`current:${value}`).probes[0],reference:'',unit:'A'}))];
      let expected=null;
      if (opts.expect) {
        if (statSync(opts.expect).size>4*1024*1024) throw new Error('DC reference exceeds 4 MiB');
        expected=parseExpectedDcSweep(readFileSync(opts.expect,'utf8'));
      }
      const c=await load(file);
      validateDcSweepInput(c,opts.source,observations);
      const {Circuit,error}=await loadEngine();
      if (error) throw new Error(`DC sweep needs a strict operatingPoint engine (${error})`);
      const samples=[]; let analysis;
      for (const [index,sourceVolts] of grid.entries()) {
        try {
          const parts=structuredClone(c.parts);
          const source=parts.find(part=>part.id===opts.source);
          source.params={...source.params,volts:sourceVolts};
          const circ=Circuit.fromJSON({...c,vcc:Number.isFinite(c.vcc)?c.vcc:5,parts});
          if (circ.netlistError) throw new Error(circ.netlistError);
          if (circ.resolvedNets.length>32) throw new Error('DC sweep limits the graph to 32 nets');
          circ.setPower(true);
          const result=circ.operatingPoint();
          if (result?.converged!==true||result.railConflicts?.length) throw new Error(`strict OP did not converge without rail conflicts: ${result?.railConflicts?.join('; ')||'nonconvergence'}`);
          analysis ??= result.analysis;
          const voltage=selector=>{
            const net=resolveEndpointNet(circ.resolvedNets,selector);
            const value=result.nodeVoltages.get(net);
            if (!Number.isFinite(value)) throw new Error(`no finite OP voltage for ${selector}`);
            return value;
          };
          const values=observations.map(row=>{
            if (row.kind==='voltage') return voltage(row.selector)-(row.reference?voltage(row.reference):0);
            const split=row.selector.lastIndexOf('.');
            if (result.indeterminateBranchCurrents?.has(row.selector.slice(0,split))) {
              throw new Error(`indeterminate OP terminal current for ${row.selector}`);
            }
            const value=result.branchCurrents.get(row.selector.slice(0,split))?.get(row.selector.slice(split+1));
            if (!Number.isFinite(value)) throw new Error(`no finite OP terminal current for ${row.selector}`);
            return value;
          });
          if (values.some(value=>!Number.isFinite(value))) throw new Error('nonfinite DC observation');
          samples.push({sourceVolts,values});
        } catch (pointError) { throw new Error(`DC point ${index} (${sourceVolts} V): ${pointError.message}`); }
      }
      const report={schemaVersion:1,source:basename(file),format:c.format,sourceId:opts.source,
        observations,samples,analysis,
        claims:{analysis:'fresh static strict operating point per point',transient:false,independentOracle:false}};
      if (expected) report.comparison=compareExpectedDcSweep(report,expected);
      if (opts.json) console.log(JSON.stringify(report,null,2));
      else {
        console.log(`${basename(file)}: ${samples.length} strict DC points (${opts.source})`);
        console.log(['source[V]',...observations.map(row=>`${row.kind}:${row.selector}${row.reference?','+row.reference:''}[${row.unit}]`)].join('\t'));
        for (const row of samples) console.log([row.sourceVolts,...row.values].join('\t'));
        if (report.comparison) console.log(`reference curve: ${report.comparison.status.toUpperCase()}`);
        console.log('static operating points, not transient samples or an independent oracle certificate');
      }
      if (report.comparison?.status==='fail') process.exitCode=1;
    } catch (error) { die(`DC sweep failed: ${error.message}`); }
    break;
  }
  case 'verify-receipt': {
    if (!opts.input) die('verify-receipt requires an explicit --input circuit file');
    const unsupported=Object.keys(opts).find(key=>!['input','expect','expect-meters','csv','json'].includes(key));
    if (unsupported) die(`verify-receipt does not support --${unsupported}`);
    try {
      if (statSync(file).size>4*1024*1024) throw new Error('receipt exceeds 4 MiB');
      const { parseMeasurementReceipt, compareMeasurementReceiptIdentity,
        fileReceipt, runtimeReceipt, importedCircuitSha256 } = await import(join(SRC,'model/measurement-receipt.js'));
      const receipt=parseMeasurementReceipt(readFileSync(file,'utf8'));
      const bytes=readFileSync(opts.input);
      const c=await load(opts.input,bytes);
      const pkg=JSON.parse(readFileSync(join(HERE,'..','package.json'),'utf8'));
      const observed={input:fileReceipt(opts.input,bytes),
        references:{waveform:opts.expect?fileReceipt(opts.expect):null,
          meters:opts['expect-meters']?fileReceipt(opts['expect-meters']):null},
        csv:opts.csv?fileReceipt(opts.csv):null,
        importedCircuitSha256:importedCircuitSha256(c),
        engine:{selection:process.env.BW_BOARD?'BW_BOARD override':'installed package',
          declaredPackageSpec:pkg.devDependencies?.['bw-board'] ?? pkg.dependencies?.['bw-board'] ?? null,
          observed:runtimeReceipt(engineDir())},
        cli:runtimeReceipt(join(HERE,'..'),['bin/bwc.mjs']),nodeVersion:process.version};
      const result=compareMeasurementReceiptIdentity(receipt,observed);
      if (opts.json) console.log(JSON.stringify(result,null,2));
      else {
        console.log(`receipt identity: ${result.status.toUpperCase()}`);
        console.log(`  recorded measurement exit code: ${result.recordedMeasurementExitCode} (untrusted receipt field)`);
        for (const row of result.checks.filter(row=>!row.match)) console.log(`  ${row.field}: expected ${JSON.stringify(row.expected)}, observed ${JSON.stringify(row.actual)}`);
        console.log('  identity only; no simulation, numerical agreement or oracle certificate');
      }
      if (result.status!=='match') process.exitCode=1;
    } catch (error) { die(`receipt verification failed: ${error.message}`); }
    break;
  }
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
    const rows = operatingPointRows(result);
    for (const {id, value} of rows.currents) {
      console.log('    ' + id.padEnd(18) + ' ' + Number(value).toPrecision(12) + ' A');
    }
    for (const id of rows.unavailableCurrents) {
      console.log('    ' + id + ': current indeterminate (no individual measurement)');
    }
    break;
  }

  case 'measure': {
    let receiptIdentity = null; let inputBytes; let waveformReferenceBytes; let meterReferenceBytes;
    if (opts.receipt) {
      try {
        // Never overwrite the source, a reference, or an earlier receipt. The
        // final exclusive write also closes a create-between-check-and-write race.
        if (existsSync(opts.receipt)) throw new Error('receipt destination already exists');
        if (opts.csv && resolve(opts.csv)===resolve(opts.receipt)) throw new Error('receipt and CSV destinations must differ');
        const { fileReceipt, runtimeReceipt } = await import(join(SRC,'model/measurement-receipt.js'));
        inputBytes = readFileSync(file);
        if (opts.expect) waveformReferenceBytes = readFileSync(opts.expect);
        if (opts['expect-meters']) {
          if (statSync(opts['expect-meters']).size>16*1024*1024) throw new Error('meter reference exceeds 16 MiB');
          meterReferenceBytes = readFileSync(opts['expect-meters']);
        }
        const pkg = JSON.parse(readFileSync(join(HERE,'..','package.json'),'utf8'));
        receiptIdentity = { input: fileReceipt(file,inputBytes),
          references: {
            waveform: waveformReferenceBytes ? fileReceipt(opts.expect,waveformReferenceBytes) : null,
            meters: meterReferenceBytes ? fileReceipt(opts['expect-meters'],meterReferenceBytes) : null,
          },
          engine: { selection: process.env.BW_BOARD ? 'BW_BOARD override' : 'installed package',
            declaredPackageSpec: pkg.devDependencies?.['bw-board'] ?? pkg.dependencies?.['bw-board'] ?? null,
            observed: runtimeReceipt(engineDir()) },
          cli: runtimeReceipt(join(HERE,'..'),['bin/bwc.mjs']),
          invocation: { executable: process.execPath, nodeVersion: process.version,
            cwd: process.cwd(), argv: args.slice(), BW_BOARD: process.env.BW_BOARD || null },
        };
      } catch (receiptError) { die(`measure receipt failed: ${receiptError.message}`); }
    }
    const precision = opts.profile === 'precision-v1';
    if (opts.profile !== undefined && !['interactive-v1','precision-v1'].includes(opts.profile)) {
      die('measure supports --profile interactive-v1 or bounded precision-v1; use analyze --profile precision-v1 for source-declared analysis');
    }
    if (precision && opts.initial !== 'zero-state') {
      die('measure precision-v1 requires --initial zero-state; DC bias/startup is not implied');
    }
    if (!precision && opts.initial !== undefined) {
      die('measure --initial is supported only for an explicit precision-v1 batch');
    }
    const precisionWatch = precision && Boolean(opts.watch);
    const scopeSpecs = (opts.scope || []).map(value => {
      try { return parseScopeSpec(value); } catch (error) { return die(error.message); }
    });
    const meterSpecs = (opts.meter || []).map(value => {
      try { return parseMeterSpec(value); } catch (error) { return die(error.message); }
    });
    if (!scopeSpecs.length && !meterSpecs.length) die('measure needs at least one --scope or --meter');
    if (opts.watch && opts.json) die('measure --watch is NDJSON and cannot be combined with --json');
    if (opts.watch && meterSpecs.some(spec => spec.mode === 'resistance')) {
      die('measure --watch refuses resistance mode because resistance powers the circuit off');
    }
    if (opts.expect && !scopeSpecs.length) die('measure --expect needs at least one --scope');
    let meterReference=null;
    if (opts['expect-meters']) {
      if (!meterSpecs.length) die('measure --expect-meters needs at least one --meter');
      try {
        if (statSync(opts['expect-meters']).size>16*1024*1024) throw new Error('meter reference exceeds 16 MiB');
        const expected=parseExpectedMeters((meterReferenceBytes ?? readFileSync(opts['expect-meters'])).toString('utf8'));
        if (expected.acquisition!==(opts.watch?'watch':'batch')) throw new Error('meter reference acquisition differs from batch/watch command');
        meterReference=createExpectedMeterComparison(expected);
      } catch (referenceError) { die(`measure meter reference failed: ${referenceError.message}`); }
    }
    const probe = opts.probe || 'ideal';
    let durationSeconds; let rateHz;
    try {
      durationSeconds = parseScaledNumber(opts.duration || '10ms', 'duration');
      rateHz = parseScaledNumber(opts.rate || '10kHz', 'rate');
    } catch (error) { die(error.message); }
    if (!(durationSeconds > 0 && durationSeconds <= 10)) die('measure duration must be > 0 and <= 10 s');
    if (!opts.watch && durationSeconds>2 && meterSpecs.some(spec => spec.mode!=='resistance')) {
      die('powered meter batch capture is limited to the 2 s watch lifetime; use --watch for longer captures');
    }
    if (!(rateHz >= 1 && rateHz <= 2e6)) die('measure rate must be between 1 Hz and 2 MHz');
    const requestedSamples = Math.ceil(durationSeconds * rateHz);
    if (requestedSamples > MEASUREMENT_MAX_SAMPLES) die('measure refuses more than 200000 scope samples');
    let clock;
    try { clock = measurementSampleClock(durationSeconds, rateHz); }
    catch (clockError) { die(clockError.message); }
    const { durationNs, intervalNs, captureSamples, effectiveRateHz } = clock;

    const c = await loadOrDie(file,inputBytes);
    if (c.unmapped && c.unmapped.length) {
      die(`measure refuses ${c.unmapped.length} unmapped component(s); run \`bwc info ${file}\``);
    }
    if (c.losses && c.losses.length) {
      die(`measure refuses ${c.losses.length} semantic import loss(es); run \`bwc info ${file}\``);
    }
    if (c.analysisBlockers && c.analysisBlockers.length) {
      die(`measure refuses ${c.analysisBlockers.length} retained analysis blocker(s)`);
    }
    if (!c.parts.length) die('measure needs at least one imported circuit part');
    let precisionDomain = null;
    if (precision) {
      try { precisionDomain = validatePrecisionCaptureInput(c.parts,scopeSpecs.length,meterSpecs.map(spec => spec.mode)); }
      catch (policyError) { die(policyError.message); }
    }
    const { Circuit, error } = await loadEngine();
    if (error) die('measure needs a bw-board engine (' + error + ')');
    let circ;
    try {
      circ = Circuit.fromJSON({ vcc: Number.isFinite(c.vcc) ? c.vcc : 5,
        parts: c.parts, wires: c.wires });
    } catch (modelError) { die(`measure model admission failed: ${modelError.message}`); }
    if (circ.netlistError) die('measure could not build an engine netlist (' + circ.netlistError + ')');
    if (opts.profile) {
      try { circ.configureTransientAnalysis(opts.profile); }
      catch (profileError) { die(`measure profile selection failed: ${profileError.message}`); }
    }
    let precisionBudget = null;
    if (precision) {
      try {
        precisionBudget = precisionCaptureBudget(clock,circ.transientAnalysisStatus().profile,circ.resolvedNets.length,precisionDomain);
        if (precisionWatch) precisionBudget = precisionStreamBudget(clock,precisionBudget,precisionDomain);
        validatePrecisionVoltageTopology(circ.parts,circ.resolvedNets);
      } catch (policyError) { die(`precision batch admission failed: ${policyError.message}`); }
    }
    try { circ.setPower(true); }
    catch (modelError) { die(`measure model admission failed: ${modelError.message}`); }

    const scope = [];
    for (const spec of scopeSpecs) {
      let tipNet; let referenceNet = '';
      try {
        tipNet = resolveEndpointNet(circ.resolvedNets, spec.tip);
        if (spec.reference) referenceNet = resolveEndpointNet(circ.resolvedNets, spec.reference);
      } catch (error2) { die(error2.message); }
      let electrical;
      try { electrical = scopeProbeOptions(probe, referenceNet); } catch (error2) { die(error2.message); }
      const handle = circ.board.addScopeChannel({
        type: 'voltage', netId: tipNet, sampleRateHz: rateHz,
        depth: captureSamples + 2, capture: 'sample', ...electrical,
      });
      scope.push({ spec, tipNet, referenceNet, handle });
    }

    const poweredMeters = [];
    const resistance = [];
    for (const spec of meterSpecs) {
      const meter = createMeterState();
      meter.mode = spec.mode;
      if (spec.mode === 'current') {
        const endpoint = spec.probes[0];
        const dot = endpoint.lastIndexOf('.');
        if (dot <= 0 || dot === endpoint.length - 1) die(`current endpoint "${endpoint}" must be <part>.<terminal>`);
        try { resolveEndpointNet(circ.resolvedNets, endpoint); } catch (error2) { die(error2.message); }
        meter.probeA = { netId: null, partId: endpoint.slice(0, dot), terminal: endpoint.slice(dot + 1) };
      } else {
        let a; let b;
        try {
          a = resolveEndpointNet(circ.resolvedNets, spec.probes[0]);
          b = resolveEndpointNet(circ.resolvedNets, spec.probes[1]);
        } catch (error2) { die(error2.message); }
        meter.probeA = { netId: a, partId: null, terminal: null };
        meter.probeB = { netId: b, partId: null, terminal: null };
      }
      const row = { mode: spec.mode, probes: spec.probes, meter };
      if (spec.mode === 'resistance') resistance.push(row);
      else poweredMeters.push(row);
    }

    if (precision) {
      try {
        if (precisionDomain==='passive-source') {
          const admission = circ.operatingPoint({waveformBias:'time-zero'});
          if (admission.converged!==true) throw new Error('native time-zero constraint check did not converge');
        } else if (circ.board.deviceCompanions(circ.parts[0].id)?.converged!==true) {
          throw new Error('native cold ADP7118 model admission did not converge');
        }
        // Include physical probe loading in admission, but do NOT initialize
        // storage from this result: capture remains explicit zero-state.
      } catch (policyError) { die(`precision batch admission failed: ${policyError.message}`); }
    }
    const startNs = BigInt(circ.board.timeNs || 0);
    // The first read starts the engine watch; taking it only at the end
    // returns an instant, not the requested capture's observed DC mean.
    for (const row of poweredMeters) {
      const reading=readMeter(row.meter,circ);
      if (reading.note) die(`${row.mode} meter ${row.probes.join(',')} could not start capture: ${reading.note}`);
    }
    const endNs = startNs + durationNs;
    const capturedData = row => {
      try { return circ.board.getScopeData(row.handle); }
      catch (captureError) { die(`scope ${row.spec.tip} capture unavailable: ${captureError.message}`); }
    };
    let watchSamples = 0;
    // Inside the native observer, exit() would skip invalidation/unwinding.
    const captureDie = message => { if (precisionWatch) throw new Error(message); die(message); };
    try {
    try {
      if (opts.watch) {
        const observe = targetNs => {
          const watchedScope = scope.map(row => {
            const sample = latestTimedScopeSample(capturedData(row));
            if (!sample) captureDie(`scope ${row.spec.tip} captured no sample at ${targetNs} ns`);
            return { tip: row.spec.tip, reference: row.spec.reference || '', volts: sample.volts };
          });
          const watchedMeters = poweredMeters.map(row => ({ mode: row.mode, probes: row.probes,
            reading: readMeter(row.meter, circ) }));
          const bad = watchedMeters.find(row => row.reading.note);
          if (bad) captureDie(`${bad.mode} meter ${bad.probes.join(',')} could not be read: ${bad.reading.note}`);
          if (meterReference) meterReference.observe(watchedMeters.map(row=>({...row,
            timeSeconds:Number(targetNs)/1e9,quantity:'observed-dc-mean'})));
          process.stdout.write(`${JSON.stringify({ recordType: 'sample', index: watchSamples,
            ...(precisionWatch ? {qualified:false} : {}),
            timeSeconds: Number(targetNs) / 1e9, elapsedSeconds: Number(targetNs - startNs) / 1e9,
            scope: watchedScope, meters: watchedMeters })}\n`);
          watchSamples++;
        };
        if (precisionWatch) {
          circ.advanceToBoundedStream(endNs, {
            maxAttempts:precisionBudget.maxAttempts,maxSolves:precisionBudget.maxSolves,
            maxAdvances:precisionBudget.maxAdvances,
          }, {stepNs:intervalNs,onStep:packet=>observe(packet.timeNs)});
        } else {
        for (let targetNs = startNs + intervalNs; targetNs <= endNs; targetNs += intervalNs) {
          circ.advanceTo(targetNs);
          observe(targetNs);
        }
        if (BigInt(circ.board.timeNs || 0) < endNs) circ.advanceTo(endNs);
        }
      } else if (precisionDomain==='adp7118-current-limited') {
        circ.advanceToBounded(endNs,{
          maxAttempts:precisionBudget.maxAttempts,maxSolves:precisionBudget.maxSolves,
          maxAdvances:precisionBudget.maxAdvances,
        });
      } else circ.advanceTo(endNs);
    } catch (error2) { captureDie(`measure simulation failed: ${error2.message}`); }

    // Snapshot the powered capture before resistance mode powers the circuit off.
    // This is engine local-step status, not a global-accuracy or oracle certificate.
    const transient = circ.transientAnalysisStatus();
    if (precision) {
      try {
        if (precisionWatch) validatePrecisionStreamWork(transient,precisionBudget,watchSamples,circ.board.timeNs);
        else validatePrecisionCaptureWork(transient,precisionBudget);
      }
      catch (policyError) { captureDie(policyError.message); }
      if (circ.board.deviceCompanions(circ.parts[0].id)?.converged!==true) {
        captureDie('precision batch final native solve did not converge');
      }
    }
    // Resistance's extra power-off tick can cross a scope sample boundary.
    // Preserve both ring metadata and values from the requested powered capture.
    const capturedScopeData = scope.map(row => {
      const data = capturedData(row);
      return data && resistance.length ? { ...data, samples: data.samples.slice() } : data;
    });
    const meterRows = poweredMeters.map(row => ({ mode: row.mode, probes: row.probes,
      timeSeconds:Number(circ.board.timeNs)/1e9,quantity:'observed-dc-mean',
      reading: readMeter(row.meter, circ) }));
    if (resistance.length) {
      circ.setPower(false);
      circ.advanceTo(BigInt(circ.board.timeNs || 0) + 1n);
      for (const row of resistance) meterRows.push({
        mode: row.mode, probes: row.probes, reading: readMeter(row.meter, circ),
        timeSeconds:Number(circ.board.timeNs)/1e9,quantity:'power-off-resistance',
      });
    }

    for (const row of meterRows) {
      if (row.reading.note) {
        captureDie(`${row.mode} meter ${row.probes.join(',')} could not be read: ${row.reading.note}`);
      }
    }

    const scopeRows = scope.map((row, index) => {
      const data = capturedScopeData[index];
      const summary = summarizeScope(data);
      if (!summary.samples) captureDie(`scope ${row.spec.tip} captured no finite samples`);
      return {
        tip: row.spec.tip,
        reference: row.spec.reference || 'engine ground',
        tipNet: row.tipNet,
        referenceNet: row.referenceNet || null,
        probe,
        rateHz,
        effectiveRateHz,
        capture: data?.capture || null,
        startTimeSeconds: Number(data?.startTNs ?? 0n) / 1e9,
        sampleIntervalSeconds: Number(data?.sampleIntervalNs ?? 0) / 1e9,
        summary, selectorReference: row.spec.reference || '',
        data,
      };
    });
    let comparison = null;
    if (opts.expect) {
      let expected;
      try { expected = parseExpectedWaveforms((waveformReferenceBytes ?? readFileSync(opts.expect)).toString('utf8')); } catch (error2) {
        captureDie(`measure expected waveform failed: ${error2.message}`);
      }
      const tolerance = name => {
        const value = opts[name] == null ? undefined : Number(opts[name]);
        if (value != null && (!Number.isFinite(value) || value < 0)) {
          captureDie(`measure --${name} must be finite and non-negative`);
        }
        return value;
      };
      try {
        comparison = compareExpectedWaveforms(scopeRows.map(row => ({ tip: row.tip,
          reference: row.selectorReference, samples: timedScopeSeries(row.data) })), expected, {
          absoluteVolts: tolerance('abs-volts'), relative: tolerance('rel'),
          timeSeconds: tolerance('time-tolerance'),
        });
        comparison.provenance = expected.provenance;
      } catch (error2) { captureDie(`measure waveform comparison failed: ${error2.message}`); }
    }

    if (meterReference && !opts.watch) meterReference.observe(meterRows);
    const meterComparison=meterReference?.finish() ?? null;
    if (opts.csv) {
      if (!scopeRows.length) captureDie('--csv needs at least one --scope');
      const csv = scopeTracesToCsv(scopeRows.map(row => ({ data: row.data,
        netId: `${row.tip}${row.referenceNet ? ` - ${row.reference}` : ''}` })));
      writeFileSync(opts.csv, `${csv}\n`);
    }
    const report = {
      source: basename(file), format: c.format,
      durationSeconds, rateHz, requestedSamples,
      simulatedDurationSeconds: Number(durationNs) / 1e9,
      effectiveRateHz, plannedSamples: captureSamples,
      requestedTransientProfile: opts.profile || null,
      transient,
      ...(precision ? {precisionCapture:precisionBudget} : {}),
      scope: scopeRows.map(({ data, selectorReference, ...row }) => row),
      meters: meterRows,
      ...(poweredMeters.length ? {poweredMeterAcquisition:{quantity:'observed-dc-mean',
        startTimeSeconds:Number(startNs)/1e9,maximumWindowSeconds:.1,
        independentIntegralCertificate:false}} : {}),
      ...(comparison ? { comparison } : {}),
      ...(meterComparison ? {meterComparison} : {}),
      claims: {
        engineBacked: true,
        independentOracle: false,
        referenceProvided: Boolean(comparison || meterComparison),
        voltageMeterLoading: 'ideal observer; place a physical meter part to model input impedance',
      },
    };
    if (receiptIdentity) {
      try {
        const { importedCircuitSha256, fileReceipt } = await import(join(SRC,'model/measurement-receipt.js'));
        const receipt = { schemaVersion: 1, kind: 'bwc-measurement-receipt', ...receiptIdentity,
          importedCircuitSha256: importedCircuitSha256(c),
          acquisition: opts.watch ? 'watch' : 'batch',
          clock: { startNs: String(startNs), durationNs: String(durationNs), intervalNs: String(intervalNs) },
          watchSamples: opts.watch ? watchSamples : null,
          csv: opts.csv ? fileReceipt(opts.csv) : null,
          exitCode: comparison?.status==='fail' || meterComparison?.status==='fail' ? 1 : 0,
          report,
          limits: { independentOracle: false, hermeticExecution: false,
            importedDependencyClosure: false, runtimeFingerprintCaptured: 'before simulation',
            embeddedSourceOrWaveforms: false },
        };
        writeFileSync(opts.receipt,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
      } catch (receiptError) { captureDie(`measure receipt write failed: ${receiptError.message}`); }
    }
    if (opts.watch) process.stdout.write(`${JSON.stringify({ recordType: 'summary', watchSamples,
      ...(precisionWatch ? {qualified:true} : {}), report })}\n`);
    else if (opts.json) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`${basename(file)}  [${c.format}]  instrument measurements`);
      console.log(`  simulated: ${report.simulatedDurationSeconds} s at ${effectiveRateHz} Hz (${captureSamples} planned samples; requested ${rateHz} Hz)`);
      console.log(`  integration: ${transient.profile.id}; engine local step check ${transient.accuracyMet == null
        ? 'not assessed' : transient.accuracyMet ? 'met' : 'unmet'} (not an oracle check)`);
      if (precision) console.log('  initial state: zero stored energy; no DC operating-point initialization');
      for (const row of report.scope) {
        const s = row.summary;
        console.log(`  scope ${row.tip} relative to ${row.reference}  [${row.probe}, ${s.samples} samples]`);
        console.log(`      min ${Number(s.minVolts).toPrecision(9)} V  max ${Number(s.maxVolts).toPrecision(9)} V  mean ${Number(s.meanVolts).toPrecision(9)} V  rms ${Number(s.rmsVolts).toPrecision(9)} V  last ${Number(s.lastVolts).toPrecision(9)} V`);
      }
      for (const row of report.meters) {
        console.log(`  meter ${row.mode} ${row.probes.join(' ↔ ')}: ${row.reading.value} ${row.reading.unit}${row.reading.note ? `  (${row.reading.note})` : ''}`);
      }
      if (report.poweredMeterAcquisition) console.log('  powered meters: observed DC mean since capture start, rolling window at most 100 ms; not true RMS or an independent integral certificate');
      if (opts.csv) console.log(`  wrote ${opts.csv}`);
      if (comparison) console.log(`  expected waveform: ${comparison.status.toUpperCase()} (${comparison.counts.passed}/${comparison.counts.compared} samples)`);
      if (meterComparison) console.log(`  expected meters: ${meterComparison.status.toUpperCase()} (${meterComparison.counts.passed}/${meterComparison.counts.compared} readings)`);
      if (!comparison && !meterComparison) console.log('  oracle: not performed; these are engine measurements');
    }
    if (comparison?.status === 'fail' || meterComparison?.status==='fail') process.exitCode = 1;
    } catch (captureError) {
      if (precisionWatch) process.stdout.write(`${JSON.stringify({recordType:'failure',qualified:false,
        watchSamples,timeSeconds:Number(circ.board.timeNs)/1e9,error:captureError.message,
        transient:circ.transientAnalysisStatus()})}\n`);
      die(captureError.message);
    }
    break;
  }

  case 'analyze': {
    let expectedAc, compareAc;
    if (opts['expect-ac'] !== undefined) {
      try {
        const { parseExpectedAc, compareExpectedAc, AC_REFERENCE_MAX_BYTES } =
          await import(join(SRC, 'model/ac-reference-report.js'));
        if (statSync(opts['expect-ac']).size > AC_REFERENCE_MAX_BYTES) throw new Error('AC reference exceeds 4 MiB');
        expectedAc = parseExpectedAc(readFileSync(opts['expect-ac'], 'utf8'));
        compareAc = compareExpectedAc;
      } catch (error) { die(`invalid AC reference: ${error.message}`); }
    }
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
      const retainedCount = (source.retainedDirectives || c.retainedDirectives || []).length;
      die(`analyze needs at least one supported source-declared .op, .ac, .tran, or .dc card${retainedCount
        ? `; found ${retainedCount} preserved output request(s), which are not analyses` : ''}`);
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
    const acComparison = expectedAc ? compareAc(results, expectedAc) : null;
    if (opts.json) {
      console.log(JSON.stringify({ source: basename(file), format: c.format,
        liveGUIProfile: 'interactive-v1', requestedTransientProfile: opts.profile,
        requestedObservationProfile: observationProfile, retainedDirectives, results,
        ...(acComparison ? { acComparison } : {}) }, null, 2));
    } else {
      console.log(`${basename(file)}  [${c.format}]  source analyses`);
      console.log('  live GUI profile : interactive-v1');
      console.log('  requested profile: precision-v1 (transient analyses only)');
      console.log(`  observation profile: ${observationProfile}${observationProfile === 'bounded-research-v1' ? ' (opt-in adapted output grid)' : ''}`);
      if (retainedDirectives.length) console.log(`  retained unrequested directives: ${retainedDirectives.length}`);
      if (acComparison) console.log(`  AC reference ${acComparison.status.toUpperCase()}: ${acComparison.passed}/${acComparison.compared} complex voltages; ${acComparison.structuralFailures} structural failures`);
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
    if (!results.length || results.some(result => result.status !== 'pass')
        || acComparison?.status === 'fail') process.exitCode = 1;
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

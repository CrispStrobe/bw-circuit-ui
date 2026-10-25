// Node-only forensic identity helpers. Fingerprints are observations, not an
// attestation of a hermetic process or an independent numerical oracle.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import {createScopeDigitizer} from './scope-digitizer.js';

export const contentSha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function fileReceipt(path, bytes = readFileSync(path)) {
  return { name: basename(path), bytes: bytes.byteLength, sha256: contentSha256(bytes) };
}

export function runtimeReceipt(root, extraFiles = []) {
  root = realpathSync(root);
  const files = ['package.json', ...extraFiles];
  const visit = dir => {
    for (const name of readdirSync(join(root, dir)).sort()) {
      const path = join(dir, name);
      if (statSync(join(root, path)).isDirectory()) visit(path);
      else if (/\.(?:js|mjs|cjs|json)$/i.test(name)) files.push(path);
    }
  };
  visit('src');
  const hash = createHash('sha256');
  for (const path of files.sort((a,b)=>a.localeCompare(b))) {
    const bytes = readFileSync(join(root, path));
    hash.update(`${path.replaceAll('\\','/')}\0${bytes.byteLength}\0`);
    hash.update(bytes);
    hash.update('\0');
  }
  const pkg = JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
  return { packageName: pkg.name, version: pkg.version, root,
    jsJsonTreeSha256: hash.digest('hex'), files: files.length,
    scope: 'package.json, recursive src JS/JSON, and listed extra files', extraFiles };
}

export function importedCircuitSha256(circuit) {
  // Bind the actual importer result too: top-level input alone does not capture
  // sibling KiCad libraries/sheets or Fritzing assets consulted by the loader.
  return contentSha256(JSON.stringify({ parts: circuit.parts, wires: circuit.wires,
    vcc: circuit.vcc ?? null }));
}

const sameDescriptor = (actual, expected) => actual && typeof actual==='object' && !Array.isArray(actual)
  && JSON.stringify(Object.keys(actual).sort())===JSON.stringify(Object.keys(expected).sort())
  && Object.keys(expected).every(key=>Object.is(actual[key],expected[key]));
const descriptorIdentity = descriptor => descriptor==null ? 'null'
  : JSON.stringify(Object.keys(descriptor).sort().map(key=>[key,descriptor[key]]));

/** Read declared model/source headers only, not numerical agreement. */
export function scopeDigitizerCsvBindings(text) {
  return String(text).split(/\r?\n/).filter(line=>line.startsWith('# net=')).map(line=>{
    const match=/ adc=(\{.*?\}) source=(\{.*?\})(?:\s|$)/.exec(line);
    if (!match) throw new Error('ADC CSV descriptor/source header required');
    return {descriptor:JSON.parse(match[1]),source:JSON.parse(match[2])};
  });
}

/** Model metadata is bound to actual point-capture clocks, never a raw envelope. */
function validateScopeDigitizer(receipt,fail) {
  const modeled=Object.hasOwn(receipt,'scopeDigitizer');
  const rows=receipt.report.scope;
  if (!modeled) {
    if (receipt.report.scopeDigitizer || (Array.isArray(rows)&&rows.some(row=>row.adc))) fail('ADC report lacks descriptor/source binding');
    return;
  }
  const model=receipt.scopeDigitizer;
  if (!model || typeof model!=='object' || Array.isArray(model)
    || Object.keys(model).sort().join(',')!=='channels,descriptor') fail('ADC model binding required');
  let expected;
  try { expected=createScopeDigitizer({bits:model.descriptor?.bits,
    lowVolts:model.descriptor?.lowVolts,highVolts:model.descriptor?.highVolts}).descriptor; }
  catch(error){fail(`ADC descriptor: ${error.message}`);}
  if (!sameDescriptor(model.descriptor,expected) || !sameDescriptor(receipt.report.scopeDigitizer,expected)) fail('ADC descriptor mismatch');
  if (receipt.report.comparisonDomain!=='raw-voltage') fail('ADC comparison must retain raw voltage');
  if (!Array.isArray(rows)||!rows.length||!Array.isArray(model.channels)||model.channels.length!==rows.length) fail('ADC channel binding required');
  const clock=receipt.clock;
  for(const key of ['startNs','durationNs','intervalNs']) {
    if (typeof clock?.[key]!=='string'||!/^\d+$/.test(clock[key])) fail('ADC clock required');
  }
  const start=BigInt(clock.startNs),duration=BigInt(clock.durationNs),interval=BigInt(clock.intervalNs);
  if (duration<=0n||interval<=0n) fail('ADC positive capture clock required');
  for(const [index,row]of rows.entries()) {
    const bound=model.channels[index],source=bound?.source,adc=row.adc;
    if (bound?.tip!==row.tip||bound?.reference!==row.reference||row.capture!=='sample'
      || !sameDescriptor(adc?.descriptor,expected)) fail('ADC point channel/descriptor mismatch');
    if (!source||Object.keys(source).sort().join(',')!=='count,depth,sampleIntervalNs,startTimeNs,writeIndex'
      || !adc.source || Object.keys(adc.source).length!==5
      || !Object.keys(source).every(key=>Object.is(source[key],adc.source[key]))) fail('ADC source binding mismatch');
    if (typeof source.startTimeNs!=='string'||!/^\d+$/.test(source.startTimeNs)
      || source.sampleIntervalNs!==clock.intervalNs) fail('ADC source clock mismatch');
    for(const key of ['count','writeIndex','depth'])if(!Number.isSafeInteger(source[key]))fail('ADC integer source metadata required');
    if (source.count<=0||source.depth<=0||source.count>source.depth
      || source.writeIndex<0||source.writeIndex>=source.depth
      || source.writeIndex!==source.count%source.depth
      || source.count!==receipt.report.plannedSamples||source.count!==row.summary?.samples
      || source.count!==adc.summary?.samples||BigInt(source.count)!==duration/interval
      || source.depth!==receipt.report.plannedSamples+2) fail('ADC source count/depth mismatch');
    const first=BigInt(source.startTimeNs),last=first+BigInt(source.count-1)*interval;
    if (first!==start+interval||last>start+duration
      || Number(first)/1e9!==row.startTimeSeconds||Number(interval)/1e9!==row.sampleIntervalSeconds) fail('ADC source/report clock mismatch');
    const c=adc.clippingCounts;
    if (!c||Object.keys(c).sort().join(',')!=='above,below,finite,gaps'
      || ['below','above','gaps','finite'].some(k=>!Number.isSafeInteger(c[k])||c[k]<0)
      || c.gaps+c.finite!==source.count||c.below+c.above>c.finite) fail('ADC clipping counts mismatch');
    // CLI scope summaries reject any retained nonfinite point; helper/GUI
    // gap support does not widen the completed CLI acquisition domain.
    if (c.gaps!==0||c.finite!==source.count) fail('ADC completed CLI capture cannot contain gaps');
  }
}

export function parseMeasurementReceipt(text) {
  const receipt=JSON.parse(text);
  const fail=message=>{throw new Error(`invalid measurement receipt: ${message}`);};
  const digest=(value,label)=>{
    if (typeof value!=='string' || !/^[0-9a-f]{64}$/.test(value)) fail(`${label} SHA-256 required`);
  };
  const artifact=(value,label)=>{
    if (!value || typeof value.name!=='string' || !value.name
      || !Number.isSafeInteger(value.bytes) || value.bytes<0) fail(`${label} file identity required`);
    digest(value.sha256,label);
  };
  if (receipt?.schemaVersion!==1 || receipt.kind!=='bwc-measurement-receipt') fail('unsupported schema/kind');
  artifact(receipt.input,'input');
  if (!receipt.references || typeof receipt.references!=='object') fail('reference identities required');
  for (const key of ['waveform','meters']) {
    if (receipt.references[key]!==null) artifact(receipt.references[key],key);
  }
  if (receipt.csv!==null) artifact(receipt.csv,'CSV');
  digest(receipt.cli?.jsJsonTreeSha256,'CLI runtime');
  digest(receipt.engine?.observed?.jsJsonTreeSha256,'engine runtime');
  digest(receipt.importedCircuitSha256,'imported circuit');
  if (!['installed package','BW_BOARD override'].includes(receipt.engine.selection)) fail('engine selection required');
  if (receipt.engine.declaredPackageSpec!==null && typeof receipt.engine.declaredPackageSpec!=='string') fail('declared package spec required');
  if (!/^v\d+\.\d+\.\d+(?:[-+].*)?$/.test(receipt.invocation?.nodeVersion ?? '')) fail('Node version required');
  if (![0,1].includes(receipt.exitCode) || !['batch','watch'].includes(receipt.acquisition)
    || !receipt.report || typeof receipt.report!=='object' || Array.isArray(receipt.report)) fail('completed acquisition required');
  validateScopeDigitizer(receipt,fail);
  return receipt;
}

/** Compare only explicitly observed identities. No argv/path execution here. */
export function compareMeasurementReceiptIdentity(receipt, observed) {
  const checks=[];
  const check=(field,expected,actual)=>checks.push({field,expected,actual,match:expected===actual});
  const artifact=(field,expected,actual)=>{
    check(`${field}.sha256`,expected?.sha256 ?? null,actual?.sha256 ?? null);
    check(`${field}.bytes`,expected?.bytes ?? null,actual?.bytes ?? null);
  };
  artifact('input',receipt.input,observed.input);
  artifact('references.waveform',receipt.references.waveform,observed.references.waveform);
  artifact('references.meters',receipt.references.meters,observed.references.meters);
  artifact('csv',receipt.csv,observed.csv);
  check('importedCircuitSha256',receipt.importedCircuitSha256,observed.importedCircuitSha256);
  check('engine.selection',receipt.engine.selection,observed.engine.selection);
  check('engine.declaredPackageSpec',receipt.engine.declaredPackageSpec,observed.engine.declaredPackageSpec);
  check('engine.jsJsonTreeSha256',receipt.engine.observed.jsJsonTreeSha256,observed.engine.observed.jsJsonTreeSha256);
  check('cli.jsJsonTreeSha256',receipt.cli.jsJsonTreeSha256,observed.cli.jsJsonTreeSha256);
  check('nodeVersion',receipt.invocation.nodeVersion,observed.nodeVersion);
  if (receipt.scopeDigitizer || observed.scopeDigitizer) {
    check('scopeDigitizer.descriptor',descriptorIdentity(receipt.scopeDigitizer?.descriptor),
      descriptorIdentity(observed.scopeDigitizer));
    if (receipt.csv) {
      const rows=observed.scopeDigitizerCsv||[],channels=receipt.scopeDigitizer?.channels||[];
      check('scopeDigitizer.csv.channels',channels.length,rows.length);
      for(const [index,channel]of channels.entries()) {
        check(`scopeDigitizer.csv[${index}].descriptor`,descriptorIdentity(receipt.scopeDigitizer.descriptor),
          descriptorIdentity(rows[index]?.descriptor));
        for(const key of ['startTimeNs','sampleIntervalNs','count','writeIndex','depth']) {
          check(`scopeDigitizer.csv[${index}].source.${key}`,channel.source[key],rows[index]?.source?.[key]);
        }
      }
    }
  }
  return {schemaVersion:1,kind:'bwc-receipt-identity-verification',
    status:checks.every(row=>row.match)?'match':'mismatch',checks,
    recordedMeasurementExitCode:receipt.exitCode,
    limits:{identityOnly:true,numericalAgreement:false,independentOracle:false,
      signedProvenance:false,hermeticExecution:false,recordedInvocationExecuted:false}};
}

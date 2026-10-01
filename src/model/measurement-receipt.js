// Node-only forensic identity helpers. Fingerprints are observations, not an
// attestation of a hermetic process or an independent numerical oracle.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

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
  return {schemaVersion:1,kind:'bwc-receipt-identity-verification',
    status:checks.every(row=>row.match)?'match':'mismatch',checks,
    recordedMeasurementExitCode:receipt.exitCode,
    limits:{identityOnly:true,numericalAgreement:false,independentOracle:false,
      signedProvenance:false,hermeticExecution:false,recordedInvocationExecuted:false}};
}

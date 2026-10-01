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

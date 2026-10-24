import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {literalPulseOracle} from './helpers/literal-pulse-oracle.js';
const {ORACLE} = await import(new URL('./scripts/install-ngspice-oracle.mjs', import.meta.resolve('bw-board/package.json')).href);

test('missing and wrong consumer oracle paths refuse instead of falling back to the system binary', () => {
  assert.throws(() => literalPulseOracle(''), /must name/);
  assert.throws(() => literalPulseOracle(join(tmpdir(), 'nonexistent-literal-pulse-oracle', 'bin', 'ngspice')));
});

for (const fault of ['source', 'version', 'binary']) test(`consumer rejects altered ${fault} admission before execution`, () => {
  const root = mkdtempSync(join(tmpdir(), 'cui-oracle-refusal-'));
  try {
    mkdirSync(join(root, 'bin'));
    const binary = join(root, 'bin', 'ngspice'), bytes = '#!/bin/sh\nexit 99\n';
    writeFileSync(binary, bytes);
    const identity = {version: ORACLE.version, archiveSha256: ORACLE.archiveSha256,
      configure: ORACLE.configure, platform: process.platform, arch: process.arch,
      binarySha256: createHash('sha256').update(bytes).digest('hex')};
    if (fault === 'source') identity.archiveSha256 = '0'.repeat(64);
    if (fault === 'version') identity.version = 42;
    if (fault === 'binary') writeFileSync(binary, bytes + '# changed\n');
    writeFileSync(join(root, 'oracle-identity.json'), JSON.stringify(identity));
    assert.throws(() => literalPulseOracle(binary), /identity does not match/);
  } finally {rmSync(root, {recursive: true, force: true});}
});

test('the actual consumer input is admitted by the installed producer', () => {
  const result = literalPulseOracle();
  assert.equal(result.identity.version, 47);
  assert.equal(result.identity.archiveSha256, ORACLE.archiveSha256);
  assert.match(result.identity.binarySha256, /^[0-9a-f]{64}$/);
});

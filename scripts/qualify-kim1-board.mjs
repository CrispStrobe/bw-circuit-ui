#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Measure the identified clean source tree and compare it with the actual npm-loaded package.
// This produces evidence; the existing board-provenance guard remains a separate required step.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {boardRuntimeTreeSha256} from './board-provenance.mjs';

const source=resolve(process.argv[2]||'engine-source');
const output=resolve(process.argv[3]||'test-results/kim1-package');
const pkg=JSON.parse(readFileSync('package.json','utf8'));
const lock=JSON.parse(readFileSync('package-lock.json','utf8'));
const before=JSON.parse(execFileSync('git',['show','HEAD:package-lock.json'],{encoding:'utf8'}));
const commit=/#([a-f0-9]{40})$/.exec(pkg.devDependencies['bw-board'])?.[1];
assert.ok(commit,'exact engine SHA is required');
const git=args=>execFileSync('git',['-C',source,...args],{encoding:'utf8'}).trim();
assert.equal(git(['rev-parse','HEAD']),commit,'the measured source must be the requested commit');
assert.equal(git(['status','--porcelain']), '','the measured source must be clean');
const installed=realpathSync(dirname(fileURLToPath(import.meta.resolve('bw-board/package.json'))));
assert.notEqual(installed,realpathSync(source),'test the actual installed package, not a source symlink');
assert.equal(realpathSync(resolve('node_modules/bw-board')),installed);
const sourceHash=boardRuntimeTreeSha256(source),installedHash=boardRuntimeTreeSha256(installed);
assert.equal(installedHash,sourceHash,'installed runtime must equal identified source content');
assert.equal(lock.packages[''].devDependencies['bw-board'],pkg.devDependencies['bw-board']);
assert.ok(lock.packages['node_modules/bw-board'].resolved.endsWith('#'+commit));
const oldRest=structuredClone(before),newRest=structuredClone(lock);
delete oldRest.packages['node_modules/bw-board']; delete newRest.packages['node_modules/bw-board'];
assert.deepEqual(newRest,oldRest,'npm must not silently change unrelated dependency records');
const provenance={schemaVersion:1,commit,runtimeTreeSha256:sourceHash};
const evidence={provenance,packageSpec:pkg.devDependencies['bw-board'],
  lockBoardRecord:lock.packages['node_modules/bw-board'],installedRuntimeTreeSha256:installedHash,
  sourceHead:git(['rev-parse','HEAD']),sourceClean:true,installedViaNpm:true};
mkdirSync(output,{recursive:true});
writeFileSync(resolve(output,'board-provenance.json'),JSON.stringify(provenance,null,2)+'\n');
writeFileSync(resolve(output,'package-lock.json'),JSON.stringify(lock,null,2)+'\n');
writeFileSync(resolve(output,'evidence.json'),JSON.stringify(evidence,null,2)+'\n');
console.log('BW_KIM1_PACKAGE_EVIDENCE_BEGIN\n'+JSON.stringify(evidence)+'\nBW_KIM1_PACKAGE_EVIDENCE_END');

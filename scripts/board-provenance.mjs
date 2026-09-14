#!/usr/bin/env node
/** Verify that the Board package actually loaded by Node is the declared exact engine. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const sha256 = chunks => {
  const hash = createHash('sha256');
  for (const chunk of chunks) hash.update(chunk);
  return hash.digest('hex');
};

function runtimeFiles(root) {
  const files = [join(root, 'package.json')];
  const visit = dir => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      const stat = statSync(path);
      if (stat.isDirectory()) visit(path);
      else if (/\.(?:js|mjs|cjs|json)$/i.test(name)) files.push(path);
    }
  };
  visit(join(root, 'src'));
  return files.sort((a, b) => relative(root, a).localeCompare(relative(root, b)));
}

export function boardRuntimeTreeSha256(root) {
  const chunks = [];
  for (const path of runtimeFiles(root)) {
    const name = relative(root, path).replaceAll('\\', '/');
    const bytes = readFileSync(path);
    chunks.push(`${name}\0${bytes.byteLength}\0`, bytes, '\0');
  }
  return sha256(chunks);
}

const commitFrom = value => /#([0-9a-f]{40})(?:$|\b)/i.exec(String(value || ''))?.[1]?.toLowerCase() || null;
function git(root, args) {
  try {
    return execFileSync('git', ['-C', root, ...args],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return null; }
}

function checkoutIdentity(packageRoot) {
  const top = git(packageRoot, ['rev-parse', '--show-toplevel']);
  // Crucial: an installed node_modules copy sits inside the CUI repository.
  // Its enclosing CUI HEAD is not the Board identity.
  if (!top || realpathSync(top) !== packageRoot) return null;
  const status = git(packageRoot, ['status', '--porcelain=v1', '--untracked-files=all']) ?? '';
  const diff = git(packageRoot, ['diff', '--binary', 'HEAD']) ?? '';
  const untracked = status.split('\n').filter(line => line.startsWith('?? '))
    .map(line => line.slice(3)).sort();
  const untrackedChunks = [];
  for (const name of untracked) {
    const path = join(packageRoot, name);
    try {
      if (statSync(path).isFile()) untrackedChunks.push(name, '\0', readFileSync(path), '\0');
    } catch { /* named by status, now absent */ }
  }
  return { root: packageRoot, head: git(packageRoot, ['rev-parse', 'HEAD']),
    dirty: status.length > 0,
    dirtyFingerprintSha256: sha256([status, '\0', diff, '\0', ...untrackedChunks]) };
}

export function verifyBoardProvenance({ root = ROOT, throwOnFailure = false } = {}) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const expected = JSON.parse(readFileSync(join(root, 'scripts', 'board-provenance.json'), 'utf8'));
  const declaredSpec = pkg.devDependencies?.['bw-board'];
  const lockRecord = lock.packages?.['node_modules/bw-board'] || {};
  const declaredCommit = commitFrom(declaredSpec);
  const lockCommit = commitFrom(lockRecord.resolved);
  const logicalRoot = join(root, 'node_modules', 'bw-board');
  const loadedPackageJson = fileURLToPath(import.meta.resolve('bw-board/package.json'));
  const loadedRoot = realpathSync(dirname(loadedPackageJson));
  const logicalIsSymlink = (() => {
    try { return lstatSync(logicalRoot).isSymbolicLink(); } catch { return false; }
  })();
  const runtimeTreeSha256 = boardRuntimeTreeSha256(loadedRoot);
  const checkout = checkoutIdentity(loadedRoot);
  const failures = [];
  if (!declaredCommit) failures.push('package.json bw-board devDependency is not pinned to a full commit');
  if (!lockCommit) failures.push('package-lock.json bw-board resolution is not pinned to a full commit');
  if (declaredCommit !== lockCommit) failures.push('package.json and package-lock.json Board commits differ');
  if (expected.commit !== declaredCommit) failures.push('board-provenance.json commit differs from the declared package pin');
  if (runtimeTreeSha256 !== expected.runtimeTreeSha256) failures.push('loaded Board runtime content differs from the reviewed package artifact');
  if (logicalIsSymlink && !checkout) failures.push('symlinked Board package is not rooted at an independently identifiable git checkout');
  if (checkout && checkout.head !== declaredCommit) failures.push('symlinked Board checkout HEAD differs from the declared package pin');
  if (checkout?.dirty) failures.push('symlinked Board checkout is dirty');
  const result = { schemaVersion: 1, qualified: failures.length === 0,
    declared: { packageSpec: declaredSpec || null, packageCommit: declaredCommit,
      lockResolved: lockRecord.resolved || null, lockCommit, integrity: lockRecord.integrity || null },
    loaded: { packageJson: loadedPackageJson, logicalRoot, realRoot: loadedRoot,
      logicalIsSymlink, runtimeTreeSha256, expectedRuntimeTreeSha256: expected.runtimeTreeSha256 },
    checkout, failures };
  if (throwOnFailure && failures.length) {
    throw new Error(`Board provenance qualification failed: ${failures.join('; ')}`);
  }
  return result;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const result = verifyBoardProvenance();
  console.log(JSON.stringify(result, null, 2));
  if (!result.qualified) process.exitCode = 1;
}

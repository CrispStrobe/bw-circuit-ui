#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const pinsPath = resolve(repositoryRoot, '.github/ci-siblings.json');

export function readSiblingPins() {
  const pins = JSON.parse(readFileSync(pinsPath, 'utf8'));
  for (const [name, pin] of Object.entries(pins)) {
    if (!/^https:\/\/github\.com\/CrispStrobe\/[A-Za-z0-9._-]+\.git$/.test(pin?.repository ?? '')) {
      throw new Error(`CI sibling ${name} has an invalid repository URL`);
    }
    if (!/^[0-9a-f]{40}$/.test(pin?.sha ?? '')) {
      throw new Error(`CI sibling ${name} must use an exact 40-character SHA`);
    }
  }
  return pins;
}

export function checkoutSibling(name, destination) {
  const pin = readSiblingPins()[name];
  if (!pin) throw new Error(`CI sibling ${name} has no recorded pin`);

  const target = resolve(process.cwd(), destination);
  if (existsSync(target)) throw new Error(`CI sibling destination already exists: ${target}`);

  const git = (...args) => execFileSync('git', args, { stdio: 'inherit' });
  git('init', '--quiet', target);
  git('-C', target, 'remote', 'add', 'origin', pin.repository);
  git('-C', target, 'fetch', '--quiet', '--depth', '1', 'origin', pin.sha);
  git('-C', target, 'checkout', '--quiet', '--detach', 'FETCH_HEAD');

  const actual = execFileSync('git', ['-C', target, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (actual !== pin.sha) {
    throw new Error(`CI sibling ${name} checked out ${actual}, expected recorded pin ${pin.sha}`);
  }
  console.log(`${name}: ${actual}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , name, destination] = process.argv;
  if (!name || !destination) {
    console.error('usage: checkout-ci-sibling.mjs <recorded-name> <destination>');
    process.exitCode = 2;
  } else {
    checkoutSibling(name, destination);
  }
}

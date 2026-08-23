/**
 * DebugStatus must bind the fields the debug targets actually emit.
 *
 * Both targets build their task entries identically —
 * bw-board's emu8051-debug.js and avr8js-debug.js each do
 * `const entry = { task: name, state }` and add `until` while a task is
 * waiting. The panel bound `task.name` and `task.label` instead: `name` is
 * emitted by nobody, so the task-name column rendered EMPTY on every target,
 * and `label` is emitted by nobody either, so its branch was dead. Meanwhile
 * `until` — which the runner's stillWaiting() already consumes — was never
 * rendered at all. A display that exists and shows nothing.
 *
 * Nothing caught it because both sides are individually correct: the producers
 * emit a consistent shape and the consumer renders a consistent shape, and no
 * test compared the two. This one does, by deriving the producer's keys from
 * bw-board's source rather than restating them here — a hand-listed set would
 * stop covering the contract the moment a target emits a new field.
 *
 * Found by bw-lessons, confirmed by bw-bundle, verified here before fixing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const BWB = process.env.BW_BOARD || path.resolve(here, '../../bw-board');
const PANEL = path.join(here, '../src/components/DebugStatus.jsx');

/** Keys a producer puts on a task entry, read from its source. */
function emittedKeys (file) {
  const src = readFileSync(file, 'utf-8');
  const at = src.indexOf('const entry = {');
  assert.ok(at > 0, `${path.basename(file)}: no task-entry literal found — this test is `
    + 'reading the wrong thing and would pass vacuously');
  const region = src.slice(at, at + 700);
  const keys = new Set();
  const literal = /const entry = \{([^}]*)\}/.exec(region);
  for (const part of (literal?.[1] ?? '').split(',')) {
    const m = /^\s*(\w+)\s*(?::|$)/.exec(part);
    if (m) keys.add(m[1]);
  }
  // Fields attached conditionally afterwards: `entry.until = ...`
  for (const m of region.matchAll(/entry\.(\w+)\s*=/g)) keys.add(m[1]);
  return keys;
}


/** Source with comments removed: a comment naming a field is not a binding,
 *  and counting one made this fire on the very comment that documents the fix. */
const codeOf = (file) => readFileSync(file, 'utf-8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

const PRODUCERS = ['src/emu8051-debug.js', 'src/avr8js-debug.js']
  .map((rel) => path.join(BWB, rel));

test('the debug targets agree on the task-entry shape', () => {
  for (const f of PRODUCERS) {
    assert.ok(existsSync(f), `producer missing: ${f}. This gate compares the panel against `
      + 'what the targets emit; without them there is nothing to compare and it must fail, not skip');
  }
  const [a, b] = PRODUCERS.map(emittedKeys);
  assert.deepEqual([...a].sort(), [...b].sort(),
    'the two debug targets emit different task shapes — the panel cannot be correct for both');
  assert.ok(a.size >= 2, `only ${a.size} key(s) derived — the deriver matched almost nothing`);
});

test('DebugStatus binds only fields a debug target emits', () => {
  const emitted = emittedKeys(PRODUCERS[0]);
  const panel = codeOf(PANEL);
  const bound = new Set([...panel.matchAll(/\btask\.(\w+)/g)].map((m) => m[1]));
  assert.ok(bound.size > 0, 'no task.* bindings found in the panel — the scan matched nothing');
  const phantom = [...bound].filter((k) => !emitted.has(k));
  assert.deepEqual(phantom, [],
    `DebugStatus binds ${phantom.join(', ')}, which no debug target emits — `
    + `targets emit { ${[...emitted].join(', ')} }`);
});

test('every emitted field reaches the panel', () => {
  const emitted = emittedKeys(PRODUCERS[0]);
  const panel = codeOf(PANEL);
  const bound = new Set([...panel.matchAll(/\btask\.(\w+)/g)].map((m) => m[1]));
  const unrendered = [...emitted].filter((k) => !bound.has(k));
  assert.deepEqual(unrendered, [],
    `the targets emit ${unrendered.join(', ')} and the panel never renders it — `
    + 'that is how `until` stayed invisible while the runner consumed it');
});

/**
 * Every method the designer calls on a board is a method a board has.
 *
 * The stimulus and orientation panels wrote their params through
 * `circuit.board.setDeviceParam(...)` behind `if (circuit?.board?.setDeviceParam)`.
 * No board has ever defined that method — the write API is `setPartParam` —
 * so the guard was always false and every knock tap, distance slide and
 * accelerometer tilt was dropped without a word. The guard is the reason
 * nothing failed: it turns "this method does not exist" into "do nothing".
 *
 * So this reads the source for every call or existence check on a receiver
 * named like a board (`board`, `circuit.board`, `localBoard`, `externalBoard`)
 * and requires the method to exist on the engine's BoardImpl. An external
 * board is a different implementation, but it is driven through the same
 * interface, so a name BoardImpl lacks is a name to explain, not to assume.
 */
import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BoardImpl } from 'bw-board/board.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['src/components', 'src/hooks', 'src/model'];

// A call `xBoard.m(`, `xBoard?.m(`, or an existence probe `xBoard?.m)` /
// `xBoard.m &&` — the probe is the form that hid setDeviceParam. The receiver
// is `board` or a camelCase `...Board`, so `navigator.clipboard` is not one.
const CALL = /\b(board|\w+Board)\??\.(\w+)\s*(?:\?\.)?\(/g;
const PROBE = /\b(board|\w+Board)\??\.(\w+)\s*(?=\)|&&|\?(?!\.))/g;

/**
 * Methods an EXTERNAL board (an emulator adapter) offers that BoardImpl does
 * not, each with the reason it is legitimate. Empty until one is needed.
 */
const EXTERNAL_ONLY = new Map([]);

function scan() {
  const found = new Map();
  for (const dir of DIRS) {
    for (const f of readdirSync(join(ROOT, dir))) {
      if (!/\.(jsx?|mjs)$/.test(f)) continue;
      const src = readFileSync(join(ROOT, dir, f), 'utf8');
      for (const re of [CALL, PROBE]) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(src))) {
          const [, receiver, method] = m;
          // `board.parts` and friends are properties, read as values: only a
          // name used as a callable or probed for existence is in scope.
          if (re === PROBE && typeof BoardImpl.prototype[method] !== 'function'
            && !/^(set|get|run|advance|read|write|on|off|clear|reset)/.test(method)) continue;
          const key = method;
          if (!found.has(key)) found.set(key, new Set());
          found.get(key).add(`${dir}/${f} (${receiver})`);
        }
      }
    }
  }
  return found;
}

test('every board method the designer calls exists on BoardImpl', () => {
  const found = scan();
  assert.ok(found.size >= 10, `only ${found.size} board methods found — the scan is reading nothing`);
  const missing = [...found]
    .filter(([m]) => typeof BoardImpl.prototype[m] !== 'function' && !EXTERNAL_ONLY.has(m))
    .map(([m, where]) => `${m}  <- ${[...where].join(', ')}`);
  assert.deepEqual(missing, [],
    'these are called on a board but no board defines them; behind a `?.` or an existence '
    + 'guard they are silent no-ops:\n  ' + missing.join('\n  '));
});

test('CANARY: the probe form that hid setDeviceParam is caught', () => {
  const src = 'if (circuit?.board?.setDeviceParam) circuit.board.setDeviceParam(id, k, v);';
  const names = [];
  for (const re of [CALL, PROBE]) { re.lastIndex = 0; let m; while ((m = re.exec(src))) names.push(m[2]); }
  assert.ok(names.includes('setDeviceParam'));
  assert.equal(typeof BoardImpl.prototype.setDeviceParam, 'undefined',
    'if BoardImpl ever gains setDeviceParam this canary must change, not be deleted');
  assert.equal(typeof BoardImpl.prototype.setPartParam, 'function');
});

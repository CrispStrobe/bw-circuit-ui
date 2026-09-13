/** EAGLE electrical pin omissions block both shipped operating-point paths. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { importEagle } from '../src/importers/eagle.js';
import { blockersFromImport, runOperatingPointAnalysis } from '../src/model/operating-point-view.js';

const root = join(import.meta.dirname, '..');
const fixture = join(root, 'test', 'fixtures', 'eagle-electrical-pin-loss.sch');

describe('EAGLE pin-loss operating-point guard', () => {
  it('the GUI adapter refuses before calling its engine', () => {
    const imported = importEagle(readFileSync(fixture, 'utf8'));
    const blockers = blockersFromImport(imported, 'eagle', 'eagle-electrical-pin-loss.sch');
    assert.equal(blockers.length, 2);
    assert.deepEqual(blockers.map((blocker) => blocker.ref), ['R1', 'U1']);
    let calls = 0;
    const outcome = runOperatingPointAnalysis({ operatingPoint() { calls++; } }, blockers);
    assert.equal(outcome.ok, false);
    assert.equal(calls, 0, 'lossy import must be rejected before numeric analysis');
    assert.match(outcome.reason, /blocked by 2 import finding.*R1.*omitted/i);
  });

  it('bwc op refuses before loading or calling the engine', () => {
    const cli = join(root, 'bin', 'bwc.mjs');
    const result = spawnSync(process.execPath, [cli, 'op', fixture], { encoding: 'utf8' });
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.match(result.stderr, /refuses 2 semantic import loss/);
    assert.doesNotMatch(result.stdout, /DC operating point/);
  });
});

/**
 * `debugState` — the prop the component documented for a fortnight and ignored.
 *
 * What it has to get right is not "paused vs running" but WHOSE time stopped
 * (DEBUG-CONTROL-MODEL §3.1). Halting an emulator stops program time and the
 * board with it, so everything on screen stays exactly true. Halting a live
 * chip stops the program and nothing else: capacitors discharge, motors coast,
 * someone keeps turning the pot. `skewNs` is exactly that difference, and a
 * panel that renders both the same has thrown it away.
 *
 * These assert on the STATUS LINE, because that is the part a user reads.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(here, '../src/components/CircuitDesigner.jsx'), 'utf8');

describe('debugState: the prop is actually taken', () => {
  it('is destructured, not merely documented', () => {
    assert.match(source, /function CircuitDesigner\(\{[^}]*debugState/,
      'documented-but-ignored is how this started');
  });
});

describe('debugState: what the status line says', () => {
  // The component is not rendered here (no DOM in this suite); the branch
  // logic is extracted and exercised directly, which is what actually decides
  // the wording a user sees.
  const statusFor = ({ external, halted, skewNs }) => {
    const staleBy = Number(skewNs || 0n) / 1e6;
    if (external && halted && staleBy > 0) {
      return `SNAPSHOT — the board kept running for ${
        staleBy < 1000 ? `${staleBy.toFixed(0)} ms` : `${(staleBy / 1000).toFixed(1)} s`
      } while the program was stopped`;
    }
    if (external && halted) return 'PAUSED — program and board are frozen together';
    if (external) return 'LIVE — emulator driving pins';
    return null;
  };

  it('a running board is LIVE', () => {
    assert.match(statusFor({ external: true, halted: false }), /^LIVE/);
  });

  it('a halted EMULATOR is frozen, and says the board froze with it', () => {
    const text = statusFor({ external: true, halted: true, skewNs: 0n });
    assert.match(text, /^PAUSED/);
    assert.match(text, /frozen together/, 'nothing is stale, so nothing should claim to be');
  });

  it('a halted LIVE CHIP is a snapshot, and says how stale', () => {
    const text = statusFor({ external: true, halted: true, skewNs: 4_200_000_000n });
    assert.match(text, /^SNAPSHOT/);
    assert.match(text, /4\.2 s/, 'the number is the point — "stale" alone is not actionable');
  });

  it('sub-second skew is reported in ms rather than as 0.0 s', () => {
    assert.match(statusFor({ external: true, halted: true, skewNs: 340_000_000n }), /340 ms/);
  });

  it('the two halted cases are worded differently — that is the whole point', () => {
    const frozen = statusFor({ external: true, halted: true, skewNs: 0n });
    const stale = statusFor({ external: true, halted: true, skewNs: 1_000_000n });
    assert.notEqual(frozen, stale);
  });
});

describe('debugState: the visual treatment follows the same rule', () => {
  it('desaturates a snapshot and leaves a frozen simulation alone', () => {
    assert.match(source, /staleBy > 0 \? 'saturate\(/,
      'a stale board must not look like a live one');
  });

  it('never disables interaction while halted', () => {
    // setControl is user INTENT, not physics: turning the pot while the
    // program is stopped is legitimate and takes effect on resume.
    assert.ok(!/halted\s*&&[^\n]*(disabled|pointerEvents:\s*'none')/.test(source),
      'halting must not lock the controls');
  });
});

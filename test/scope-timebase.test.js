// The scope's CAPTURE RATE — D4 of brickwright-lite's docs/WAVE-OPEN-DEFECTS.md.
//
// ScopePanel's own header claimed the UI owns "timebase (a window into the
// ring)", and that was exactly true and exactly the defect: `windowFrac` zooms
// into the ring, and nothing ever chose how long the ring is. The panel called
// `addScopeChannel({type, netId})` and passed neither `sampleRateHz` nor
// `depth`, so every capture in the app was the engine default 100 kHz x 8192 =
// 81.92 ms — on every bench, against an RC step with tau = 1 s, a 555 reaching
// 127 ms, and a tone a decade below a 15.9 Hz cutoff.
//
// D4 is recorded as owned by "bw-board + bw-circuit-ui". It is not: every read
// inside the engine already uses ch.intervalNs and ch.depth rather than a
// constant, and passing a rate through changes the record length. Measured on
// 43-rc-timing through the real engine:
//
//     100 kHz x 8192 ->  0.082 s of record   (interval     10000 ns)
//      10 kHz x 8192 ->  0.819 s             (interval    100000 ns)
//       1 kHz x 8192 ->  8.192 s             (interval   1000000 ns)
//     100  Hz x 8192 -> 81.920 s             (interval  10000000 ns)
//
// So the repair is here alone, and the ledger's owner column is corrected.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SCOPE_DEPTH, SCOPE_RATES, formatSeconds, rateLabel, rateForSpan, recordSeconds,
} from '../src/model/scope-timebase.js';

describe('scope timebase', () => {
  it('a rate and a depth give a record length', () => {
    assert.equal(recordSeconds(100_000, 8192), 8192 / 100_000);
    assert.equal(recordSeconds(1_000, 8192), 8.192);
    assert.ok(Number.isNaN(recordSeconds(0, 8192)));
    assert.ok(Number.isNaN(recordSeconds(1000, 0)));
  });

  it('labels the record by the time it holds, not the rate it samples at', () => {
    // The question is "does my event fit". A sample rate does not answer it.
    assert.equal(rateLabel(100_000), '81.9 ms');
    assert.equal(rateLabel(10_000), '819 ms');
    assert.equal(rateLabel(1_000), '8.19 s');
    assert.equal(rateLabel(100), '81.9 s');
    assert.equal(formatSeconds(1e-6), '1.00 µs');
    assert.equal(formatSeconds(NaN), '—');
  });

  it('the offered rates span every bench the lessons name', () => {
    // 81.92 ms was the ONLY record before this. These four are the spread the
    // corpus needs, and the assertions below are the benches, not round numbers.
    const fits = s => recordSeconds(rateForSpan(s)) >= s;
    assert.ok(fits(0.005), 'a 1 MHz bus cycle and its neighbours');
    assert.ok(fits(0.127), "ttl-clock-module's slowest period, 127 ms");
    assert.ok(fits(0.63), 'one period of a tone a decade below 50-rc-scope\'s 15.9 Hz cutoff');
    assert.ok(fits(5), '43-rc-timing charged to five time constants');
    // Fastest rate that still fits, so resolution is not thrown away.
    assert.equal(rateForSpan(0.02), 100_000);
    assert.equal(rateForSpan(0.5), 10_000);
    assert.equal(rateForSpan(5), 1_000);
    // Nothing fits: answer with the longest record rather than refusing, and
    // let the caller compare recordSeconds against what it asked for.
    assert.equal(rateForSpan(1e6), 100);
    assert.ok(recordSeconds(rateForSpan(1e6)) < 1e6);
  });

  it('the offered set is exactly what the panel offers', () => {
    assert.deepEqual(SCOPE_RATES, [100_000, 10_000, 1_000, 100]);
    assert.equal(SCOPE_DEPTH, 8192);
    // The old fixed record is still reachable — this widens the choice rather
    // than moving it, so a bench that was fine stays fine.
    assert.ok(SCOPE_RATES.includes(100_000));
    assert.equal(recordSeconds(SCOPE_RATES[0]), 0.08192);
  });

  it('the panel passes the rate through, and re-attaches when it changes', () => {
    // A timebase module nothing calls is the same defect in a new place.
    const src = readFileSync(join(import.meta.dirname, '..', 'src/components/ScopePanel.jsx'), 'utf8');
    assert.match(src, /from '\.\.\/model\/scope-timebase\.js'/);
    assert.match(src, /data-testid="bw-scope-record"/, 'the record control is rendered');
    assert.match(src, /data-testid="bw-scope-span"/, 'the record length is stated on screen');
    // Both creation sites carry the rate — the initial attach and Add Channel.
    // Anchored on `board.` because the header comment quotes the OLD call shape
    // (`addScopeChannel({type, netId})`) to say what was wrong with it, and an
    // unanchored match counted that as a third call site.
    const calls = [...src.matchAll(/board\.addScopeChannel\(\{[\s\S]*?\}\)/g)].map(m => m[0]);
    assert.equal(calls.length, 2, `expected two addScopeChannel call sites, found ${calls.length}`);
    for (const c of calls) {
      assert.match(c, /sampleRateHz/, `a channel is still created without a rate: ${c}`);
      assert.match(c, /depth: SCOPE_DEPTH/, `a channel is still created without a depth: ${c}`);
    }
    // A channel's cadence is fixed at creation, so changing the rate must
    // rebuild them. Without this the control would move the label and nothing else.
    assert.match(src, /\}, \[board, sampleRateHz\]\);/,
        'the re-attach effect does not depend on the rate');
  });
});

// The sweep's numeric readout — D3 of brickwright-lite's docs/WAVE-OPEN-DEFECTS.md.
//
// `runBode` measures every point and returns it. Until 2026-08-25 `drawBode`
// discarded all of them and wrote four strings on a 260x140 canvas: the two dB
// extremes rounded to WHOLE decibels, and +180°/-180°. No frequency axis, no
// per-point value, no export. Four Wave 6 lessons ask for numbers off that plot
// and were reworded around it — `signals-model-measurement` was reduced to
// telling the learner to set the sweep's start and end to the same frequency and
// transcribe one point at a time, by hand, once per point.
//
// What is tested here is the readout, not the sweep: the engine's numbers were
// always right (its -3 dB and -45° crossings bracket the same cutoff to four
// figures), so this repair adds no measurement and changes none.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  formatHz, bodeAxisLabels, regionSummary, thinRows, sweepRowsToCsv,
} from '../src/model/sweep-readout.js';

// The pc50-two-stage-rc response, measured through bw-board and quoted by
// signals-bode-sweep. Used as the fixture because it is what a learner reads.
const PC50 = [
  { f: 15.915, magDb: -0.456, phaseDeg: -16.60 },
  { f: 50.334, magDb: -2.437, phaseDeg: -45.98 },
  { f: 159.155, magDb: -9.572, phaseDeg: -89.62 },
  { f: 503.248, magDb: -22.344, phaseDeg: -133.28 },
  { f: 1591.549, magDb: -40.738, phaseDeg: -161.98 },
];

describe('sweep readout', () => {
  it('says a frequency in the unit a reader would say it in', () => {
    assert.equal(formatHz(0.159155), '159 mHz');
    assert.equal(formatHz(15.9155), '15.9 Hz');
    assert.equal(formatHz(159.155), '159 Hz');
    assert.equal(formatHz(1591.549), '1.59 kHz');
    assert.equal(formatHz(1.2e6), '1.20 MHz');
    // Three significant figures throughout, so a corner and a decade either
    // side of it stay distinguishable on a 260-pixel axis.
    assert.equal(formatHz(9.99), '9.99 Hz');
    assert.equal(formatHz(99.9), '99.9 Hz');
    assert.equal(formatHz(NaN), '—');
  });

  it('labels the frequency axis the plot never had', () => {
    const ax = bodeAxisLabels(PC50);
    assert.equal(ax.fLo, '15.9 Hz');
    assert.equal(ax.fHi, '1.59 kHz');
    assert.equal(ax.dbLo, '-40.7 dB');
    assert.equal(ax.dbHi, '1.0 dB');
    assert.equal(bodeAxisLabels([]), null);
  });

  it('keeps dB to a decimal, because whole decibels collapse the corner', () => {
    // -3.010 dB is the half-power point and -3.5 dB is not, and the old label
    // rendered both as "-3dB". This is the whole reason the rounding changed.
    const half = bodeAxisLabels([{ f: 1, magDb: -3.010, phaseDeg: 0 }]);
    const other = bodeAxisLabels([{ f: 1, magDb: -3.5, phaseDeg: 0 }]);
    assert.notEqual(half.dbLo, other.dbLo);
    assert.equal(String(Math.round(-3.010)), String(Math.round(-3.5)),
      'the sanity check on the claim: rounded to whole dB they ARE the same string');
  });

  it('thins a long sweep but never drops the two points the axis names', () => {
    const many = Array.from({ length: 61 }, (_, i) => ({ f: 10 * (1.1 ** i), magDb: -i, phaseDeg: -i }));
    const shown = thinRows(many, 12);
    assert.equal(shown.length, 12);
    assert.equal(shown[0].f, many[0].f, 'first row kept');
    assert.equal(shown[11].f, many[60].f, 'last row kept');
    // A short sweep is shown whole rather than padded or truncated.
    assert.equal(thinRows(PC50, 12).length, 5);
    assert.deepEqual(thinRows(PC50, 2).map(r => r.f), [15.915, 1591.549]);
    assert.deepEqual(thinRows(null, 12), []);
  });

  it('exports FULL precision, not the display rounding', () => {
    const csv = sweepRowsToCsv(PC50, 'bode');
    const lines = csv.split('\n');
    assert.equal(lines[0], 'f_hz,mag_db,phase_deg,linearization_region');
    assert.equal(lines.length, PC50.length + 1);
    assert.equal(lines[5], '1591.549,-40.738,-161.98,');
    // The point of the export: a residual analysis that starts from three
    // significant figures is measuring the formatter, not the circuit.
    const precise = sweepRowsToCsv([{ f: 1 / 3, magDb: -1 / 7, phaseDeg: -1 / 9 }]);
    assert.match(precise, /0\.3333333333333333,-0\.14285714285714285,-0\.1111111111111111/);
    assert.equal(sweepRowsToCsv([{ v: 1.5, i: 0.0025 }], 'vi'), 'v,i_amps\n1.5,0.0025');
    const warned = { ...PC50[0], outOfLinear: [{ part: 'U1', region: 'high' }, { part: 'E1', region: 'current-low' }] };
    assert.equal(regionSummary(warned), 'U1:high;E1:current-low');
    assert.match(sweepRowsToCsv([warned]), /,U1:high;E1:current-low$/);
  });

  it('the panel actually uses it — the readout, the axis and the export', () => {
    // The functions above are pure and provable; what this asserts is that the
    // panel is wired to them. A readout module nothing renders is the same
    // defect in a new place.
    const src = readFileSync(join(import.meta.dirname, '..', 'src/components/SweepPanel.jsx'), 'utf8');
    assert.match(src, /from '\.\.\/model\/sweep-readout\.js'/);
    assert.match(src, /bodeAxisLabels\(rows\)/, 'drawBode labels its axis from the measured rows');
    assert.match(src, /data-testid="bw-sweep-readout"/, 'the numeric table is rendered');
    assert.match(src, /data-testid="bw-sweep-csv"/, 'the export is reachable');
    assert.match(src, /setRows\(result\.rows\)/, 'the measured rows are kept, not discarded after drawing');
    // Both Bode methods are OFFERED and both are NAMED for what they are.
    // The control used to be one checkbox reading "measure like a scope would
    // (slower)": it named one side, left the default — the linearised one,
    // whose model can silently not apply — unlabelled, and described the
    // difference as speed.
    assert.match(src, /testid: 'bw-sweep-scope-method'/, 'the scope-measured comparison remains reachable');
    assert.match(src, /testid: 'bw-sweep-smallsignal-method'/, 'the small-signal path is a named choice, not an unlabelled default');
    assert.match(src, /data-testid={m\.testid}/, 'both method buttons carry their id into the DOM');
    assert.match(src, /operating point/, 'the small-signal method says what it linearises around');
    assert.match(src, /correlated/i, 'the scope method says it correlates a driven sine');
    assert.ok(!/Measure like a scope would \(slower\)/.test(src),
      'the speed-only label is gone — "slower" is not what distinguishes them');
    assert.match(src, /data-testid="bw-sweep-region-warning"/, 'nonlinear operating regions reach a visible warning');
    assert.match(src, /regionPhrase\(r, de\)/, 'each ROW carries its own region verdict, not just the sweep');
    assert.match(src, /bw-sweep-row-nonlinear/, 'a point outside the linear region is marked in the table');
    // And the old rounding is gone rather than merely joined.
    assert.ok(!/dbHi\.toFixed\(0\)/.test(src) && !/dbLo\.toFixed\(0\)/.test(src),
      'whole-decibel labels still present — they collapse -3.010 dB onto -3.5 dB');
  });
});

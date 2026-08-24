/**
 * Turning a sweep into numbers a learner can write down.
 *
 * `runBode` returns every point it measured — `{f, magDb, phaseDeg}` — and
 * until 2026-08-25 `drawBode` threw all of them away. What reached the screen
 * was a 260x140 canvas carrying four strings: the two dB extremes rounded to
 * WHOLE decibels, and `+180°` / `-180°`. No frequency axis, no per-point value,
 * no export. Four Wave 6 lessons ask for numbers off that plot, and their
 * checkpoints had to be reworded around it — `signals-model-measurement` was
 * reduced to telling the learner to set the sweep's start and end to the SAME
 * frequency, run it, and transcribe one point by hand. (`docs/WAVE-OPEN-DEFECTS.md`
 * D3 in brickwright-lite.)
 *
 * The engine was never the problem: its −3 dB and −45° crossings bracket the
 * same cutoff to four figures. This is a readout gap, so the repair is a readout
 * and nothing else — no change to how a sweep is measured.
 *
 * Everything here is PURE and exported so it can be pinned by a node test.
 * The panel wires it; it computes nothing the panel cannot show and shows
 * nothing it did not compute.
 */

/**
 * A frequency, in the unit a reader would say it in.
 *
 * Three significant figures, because that is what the lessons quote (a corner
 * at 159 Hz, a crossing bracketed between 10 and 17.8 Hz) and because a Bode
 * axis carrying more is noise on a 260-pixel canvas.
 *
 * @param {number} f hertz
 * @returns {string}
 */
export function formatHz(f) {
  if (!Number.isFinite(f)) return '—';
  const a = Math.abs(f);
  if (a >= 1e6) return `${sig3(f / 1e6)} MHz`;
  if (a >= 1e3) return `${sig3(f / 1e3)} kHz`;
  if (a >= 1) return `${sig3(f)} Hz`;
  if (a >= 1e-3) return `${sig3(f * 1e3)} mHz`;
  return `${f.toExponential(2)} Hz`;
}

/** Three significant figures without exponent notation for ordinary magnitudes. */
function sig3(v) {
  const a = Math.abs(v);
  const dp = a >= 100 ? 0 : a >= 10 ? 1 : 2;
  return v.toFixed(dp);
}

/**
 * The labels a Bode plot needs in order to be readable at all.
 *
 * The dB extremes were already drawn but rounded to whole decibels, which loses
 * the distinction the lessons live on: −3.010 dB and −3.5 dB are different
 * answers to "where is the corner" and both rendered as "-3dB". One decimal is
 * the minimum that keeps them apart.
 *
 * @param {Array<{f:number, magDb:number, phaseDeg:number}>} rows
 * @returns {{fLo:string, fHi:string, dbHi:string, dbLo:string}|null}
 */
export function bodeAxisLabels(rows) {
  if (!rows || !rows.length) return null;
  const fs = rows.map(r => r.f);
  const dbs = rows.map(r => r.magDb);
  return {
    fLo: formatHz(Math.min(...fs)),
    fHi: formatHz(Math.max(...fs)),
    dbHi: `${Math.max(1, ...dbs).toFixed(1)} dB`,
    dbLo: `${Math.min(-3, ...dbs).toFixed(1)} dB`,
  };
}

/**
 * The rows to show as text, thinned to at most `max` so a 25-point sweep is a
 * table and a 250-point one is still a table.
 *
 * Thinning keeps the FIRST and LAST rows whatever else it drops, because those
 * are the two the axis labels name and a reader checks the table against them.
 *
 * @param {Array<object>} rows
 * @param {number} max
 * @returns {Array<object>}
 */
export function thinRows(rows, max = 12) {
  if (!rows || rows.length <= max) return rows ? [...rows] : [];
  if (max <= 2) return [rows[0], rows[rows.length - 1]];
  const out = [];
  const step = (rows.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(rows[Math.round(i * step)]);
  return out;
}

/**
 * Every measured point, as CSV — the export `signals-model-measurement`'s python
 * variant asks for when it says "export or transcribe sweep rows". Full
 * precision, not the display rounding: a residual analysis that starts from
 * three significant figures is measuring the formatter.
 *
 * @param {Array<object>} rows
 * @param {'bode'|'vi'} mode
 * @returns {string}
 */
export function sweepRowsToCsv(rows, mode = 'bode') {
  if (mode === 'vi') {
    const head = 'v,i_amps';
    return [head, ...(rows || []).map(r => `${r.v},${r.i}`)].join('\n');
  }
  const head = 'f_hz,mag_db,phase_deg';
  return [head, ...(rows || []).map(r => `${r.f},${r.magDb},${r.phaseDeg}`)].join('\n');
}

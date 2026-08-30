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

/**
 * A magnitude in decibels, for a table cell.
 *
 * `-Infinity` is a real answer here — an output pinned to a rail cannot move,
 * so the transfer is exactly zero — and `(-Infinity).toFixed(3)` renders as
 * "-Infinity", which reads like a crash rather than like a measurement.
 *
 * @param {number} db
 * @returns {string}
 */
export function formatDb(db) {
  if (Number.isFinite(db)) return db.toFixed(3);
  if (db === -Infinity) return '−∞';
  if (db === Infinity) return '+∞';
  return '—';
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
  // A RAILED stage's output cannot move at all, so its magnitude is exactly
  // zero and its dB is −Infinity. That is the correct answer and it is not an
  // axis bound: including it made dbLo −Infinity, every plotted y NaN, and the
  // label read "-Infinity dB". The point is still drawn (marked, at the floor)
  // — it just does not get to decide the scale for the points that have one.
  const dbs = rows.map(r => r.magDb).filter(Number.isFinite);
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
  const head = 'f_hz,mag_db,phase_deg,linearization_region';
  return [head, ...(rows || []).map(r => `${r.f},${r.magDb},${r.phaseDeg},${regionSummary(r)}`)].join('\n');
}

/** Machine-readable summary of nonlinear devices outside their linear region. */
export function regionSummary(row) {
  return (row?.outOfLinear || []).map(x => `${x.part}:${x.region}`).join(';');
}

/**
 * What each of bw-board's operating regions MEANS, in a sentence.
 *
 * The engine's vocabulary is `linear | high | low | ilim+ | ilim-`, settled by
 * the NR loop at the DC bias (mna.js). A reader shown `U1:ilim+` beside a Bode
 * point learns nothing; the point of surfacing the region at all is that the
 * number next to it is NOT the stage's gain, and that has to be readable.
 *
 * Rails and current limits are DIFFERENT failures of the same model and are
 * kept apart here for the reason spec-updates/ac-operating-region.md gives:
 * a railed stage cannot move its output VOLTAGE, a limited one cannot move its
 * output CURRENT, and collapsing the two is how a plausible wrong Bode plot
 * gets made.
 */
export const REGION_MEANING = {
  high: { en: 'output sitting at the positive rail', de: 'Ausgang an der oberen Versorgungsgrenze' },
  low: { en: 'output sitting at the negative rail', de: 'Ausgang an der unteren Versorgungsgrenze' },
  'ilim+': { en: 'output at its current limit, sinking', de: 'Ausgang an der Stromgrenze, senkend' },
  'ilim-': { en: 'output at its current limit, sourcing', de: 'Ausgang an der Stromgrenze, treibend' },
};

/**
 * One sweep point's region honesty, as a sentence a learner can act on.
 *
 * Empty string when every stage is linear — so the caller can render on truth
 * rather than on a placeholder.
 *
 * @param {{outOfLinear?: Array<{part: string, kind?: string, region: string}>}} row
 * @param {boolean} [de]
 * @returns {string}
 */
export function regionPhrase(row, de = false) {
  const flagged = row?.outOfLinear || [];
  if (!flagged.length) return '';
  const parts = flagged.map((x) => {
    const meaning = REGION_MEANING[x.region];
    const why = meaning ? (de ? meaning.de : meaning.en) : x.region;
    return `${x.part} (${why})`;
  }).join(', ');
  return de
    ? `nicht im linearen Bereich an diesem Punkt: ${parts} — die Kleinsignalzahl ist hier nicht die Verstärkung der Stufe`
    : `not in its linear region at this point: ${parts} — the small-signal number here is not the stage's gain`;
}

/** Whether a row's number is a small-signal answer the model actually supports. */
export function rowIsLinear(row) {
  return !(row?.outOfLinear || []).length;
}

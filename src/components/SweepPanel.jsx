/**
 * SweepPanel — the sweep instrument's face. Two modes over one engine core
 * (bw-board sweep.js, injected via setEngine):
 *
 *   Kennlinie — step a vsource, plot the delivered current against the
 *   voltage: the V/I characteristic of whatever load hangs on the source.
 *
 *   Bode — drive the vsource with a sine, step the frequency log-spaced,
 *   plot magnitude (dB) and phase (deg) of the transfer between two nets.
 *
 * Every run happens on an offline copy of the board (sweep-runner.js) —
 * the live circuit's time and state are never touched. A sweep is a
 * MEASUREMENT CAMPAIGN, not an animation: it runs once per click and the
 * plot is a finished artifact, which is also why this panel has no
 * requestAnimationFrame loop.
 */

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { getEngine } from '../engine.js';
import { listSweepSources, netOfTerminal } from '../model/sweep-runner.js';
import { runSweepAsync } from '../model/sweep-session.js';
import { bodeAxisLabels, formatDb, formatHz, regionPhrase, regionSummary, rowIsLinear, sweepRowsToCsv, thinRows } from '../model/sweep-readout.js';
import { downloadText } from '../model/exporters/download.js';

/**
 * The two ways to answer "what does this circuit do to a sine", named for what
 * they ARE rather than for which one is slower.
 *
 * They are not two implementations of one measurement. `runAc` linearises the
 * circuit around its DC operating point and solves the complex network once
 * per frequency: exact for the linearised circuit, and silent about the fact
 * that the linearisation may not apply — which is what `outOfLinear` is for.
 * `runAcSweep` drives a real sine into the real, nonlinear circuit and
 * correlates the response, the way a scope and a lock-in would: it measures
 * whatever the circuit actually does, distortion and slew included, at ~10
 * full transient integrations per point.
 *
 * A learner who is told only "slower" will pick the fast one and never find
 * out that the two disagree exactly where the interesting circuits live.
 */
const BODE_METHODS = [
  {
    id: 'analytic',
    testid: 'bw-sweep-smallsignal-method',
    label: { en: 'Small-signal', de: 'Kleinsignal' },
    what: {
      en: 'linearised around the operating point, solved once per frequency — '
        + 'exact for the linearised circuit, and it says when that model does not apply',
      de: 'um den Arbeitspunkt linearisiert, pro Frequenz einmal gelöst — exakt für die '
        + 'linearisierte Schaltung, und sagt, wenn dieses Modell nicht gilt',
    },
  },
  {
    id: 'scope',
    testid: 'bw-sweep-scope-method',
    label: { en: 'Correlated', de: 'Korreliert' },
    what: {
      en: 'a real sine driven in and correlated out, the way a scope would measure it — '
        + 'the real nonlinear circuit, and much slower',
      de: 'echter Sinus hinein, herauskorreliert, wie am Oszilloskop gemessen — '
        + 'die echte nichtlineare Schaltung, und viel langsamer',
    },
  },
];

const W = 260;
const H = 140;

function drawFrame(g) {
  g.fillStyle = '#0d1420';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = '#1e2d3d';
  g.lineWidth = 1;
  for (let i = 1; i < 5; i++) { g.beginPath(); g.moveTo(0, (H / 5) * i); g.lineTo(W, (H / 5) * i); g.stroke(); }
  for (let i = 1; i < 10; i++) { g.beginPath(); g.moveTo((W / 10) * i, 0); g.lineTo((W / 10) * i, H); g.stroke(); }
}

function drawKennlinie(canvas, rows) {
  const g = canvas.getContext('2d');
  drawFrame(g);
  if (!rows.length) return;
  const vLo = Math.min(...rows.map(r => r.v)), vHi = Math.max(...rows.map(r => r.v));
  let iLo = Math.min(0, ...rows.map(r => r.i)), iHi = Math.max(...rows.map(r => r.i));
  if (iHi - iLo < 1e-9) iHi = iLo + 1e-9;
  const x = (v) => ((v - vLo) / (vHi - vLo || 1)) * (W - 8) + 4;
  const y = (i) => H - 4 - ((i - iLo) / (iHi - iLo)) * (H - 8);
  g.strokeStyle = '#2ecc71';
  g.lineWidth = 1.5;
  g.beginPath();
  rows.forEach((r, k) => { k ? g.lineTo(x(r.v), y(r.i)) : g.moveTo(x(r.v), y(r.i)); });
  g.stroke();
  g.fillStyle = '#5d6d7e';
  g.font = '8px monospace';
  g.fillText(`${(iHi * 1000).toFixed(2)}mA`, 3, 9);
  g.fillText(`${(iLo * 1000).toFixed(2)}mA`, 3, H - 3);
  g.fillText(`${vLo.toFixed(1)}V`, W - 60, H - 3);
  g.fillText(`${vHi.toFixed(1)}V`, W - 28, H - 3);
}

function drawBode(canvas, rows) {
  const g = canvas.getContext('2d');
  drawFrame(g);
  if (!rows.length) return;
  const lf = rows.map(r => Math.log10(r.f));
  const fLo = Math.min(...lf), fHi = Math.max(...lf);
  // A railed output cannot move: its magnitude is exactly zero and its dB is
  // −Infinity. Real answer, useless axis bound — it is excluded from the
  // scale and drawn at the floor, marked, rather than turning every plotted y
  // into NaN (which is what including it did).
  const finite = rows.map(r => r.magDb).filter(Number.isFinite);
  const dbLo = Math.min(-3, ...finite), dbHi = Math.max(1, ...finite);
  const x = (f) => ((Math.log10(f) - fLo) / (fHi - fLo || 1)) * (W - 8) + 4;
  const yDb = (db) => (Number.isFinite(db)
    ? 4 + ((dbHi - db) / (dbHi - dbLo || 1)) * (H - 8)
    : H - 4);
  const yPh = (p) => 4 + ((180 - p) / 360) * (H - 8);
  g.strokeStyle = '#2ecc71';
  g.lineWidth = 1.5;
  g.beginPath();
  // The curve BREAKS at a point that has no magnitude, rather than being drawn
  // through it: joining a real point to a floored one draws a slope nothing
  // measured.
  let pen = false;
  for (const r of rows) {
    if (!Number.isFinite(r.magDb)) { pen = false; continue; }
    if (pen) g.lineTo(x(r.f), yDb(r.magDb)); else g.moveTo(x(r.f), yDb(r.magDb));
    pen = true;
  }
  g.stroke();
  g.strokeStyle = '#3498db';
  g.lineWidth = 1;
  g.beginPath();
  rows.forEach((r, k) => { k ? g.lineTo(x(r.f), yPh(r.phaseDeg)) : g.moveTo(x(r.f), yPh(r.phaseDeg)); });
  g.stroke();
  // Points the small-signal model does not actually cover are MARKED on the
  // curve, not only mentioned underneath it. An amber ring says "this number
  // is drawn but is not the stage's gain"; a smooth green line through a
  // railed stage's ideal gain is precisely the plausible wrong plot.
  g.strokeStyle = '#f39c12';
  g.lineWidth = 1.2;
  for (const r of rows) {
    if (rowIsLinear(r)) continue;
    g.beginPath();
    g.arc(x(r.f), yDb(r.magDb), 2.6, 0, Math.PI * 2);
    g.stroke();
  }
  // The axis. Until 2026-08-25 this plot had no frequency axis at all and its
  // dB labels were rounded to WHOLE decibels, which collapses -3.010 dB and
  // -3.5 dB — two different answers to "where is the corner" — onto one string.
  const ax = bodeAxisLabels(rows);
  g.fillStyle = '#5d6d7e';
  g.font = '8px monospace';
  g.fillText(ax.dbHi, 3, 9);
  g.fillText(ax.dbLo, 3, H - 12);
  g.fillText(ax.fLo, 3, H - 3);
  g.textAlign = 'right';
  g.fillText(ax.fHi, W - 34, H - 3);
  g.textAlign = 'left';
  g.fillStyle = '#3498db';
  g.fillText('+180°', W - 30, 9);
  g.fillText('-180°', W - 30, H - 3);
}

export function SweepPanel({ board, nets = [], lang = 'en' }) {
  const de = /^de/i.test(lang);
  const canvasRef = useRef(null);
  const [mode, setMode] = useState('vi'); // 'vi' | 'bode'
  const [sourceId, setSourceId] = useState('');
  const [vFrom, setVFrom] = useState(0);
  const [vTo, setVTo] = useState(5);
  const [fFrom, setFFrom] = useState(10);
  const [fTo, setFTo] = useState(100000);
  const [inNet, setInNet] = useState('');
  const [outNet, setOutNet] = useState('');
  const [bodeMethod, setBodeMethod] = useState('analytic');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  // The measured points, kept rather than discarded after drawing. Every number
  // the readout and the export show comes from here, so the table cannot
  // disagree with the curve beside it.
  const [rows, setRows] = useState([]);
  const [copied, setCopied] = useState('');
  // Progress is a READING, not a spinner: "17 / 41 points" answers "is it
  // stuck or is it slow", which a spinner never does.
  const [progress, setProgress] = useState(null);
  const cancelRef = useRef(null);

  const sources = listSweepSources(board);
  useEffect(() => {
    if (!sourceId && sources.length) setSourceId(sources[0].id);
  }, [sources.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!inNet && board && sourceId) {
      const n = netOfTerminal(board, sourceId, 'pos');
      if (n) setInNet(n);
    }
  }, [board, sourceId]); // eslint-disable-line react-hooks/exhaustive-deps

  // X2.6 / D9. This used to be one synchronous call inside a `setTimeout(…, 20)`
  // whose only job was to let the button repaint BEFORE the freeze: a Bode
  // point costs 10/f seconds of simulated time, a sweep is dozens of them, and
  // the tab did not paint again until the last one. Now the run yields between
  // points — to a worker when the host supplied one, otherwise to the event
  // loop — so the canvas stays draggable, progress is a number, and Stop stops
  // the machine rather than only the listener.
  const run = useCallback(() => {
    setBusy(true);
    setStatus('');
    setProgress(null);
    const token = { cancelled: false };
    cancelRef.current = token;
    const engine = typeof getEngine === 'function' ? getEngine() : {};
    const params = mode === 'vi'
      ? { sourceId, from: Number(vFrom), to: Number(vTo) }
      : { sourceId, inNet, outNet, fFrom: Number(fFrom), fTo: Number(fTo), method: bodeMethod };
    runSweepAsync({
      engine, board, mode, params, token,
      onProgress: (p) => setProgress({ index: p.index, total: p.total }),
    }).then((result) => {
      if (cancelRef.current !== token) return; // superseded by a newer run
      if (!result.ok) { setStatus(result.reason); setRows([]); return; }
      const canvas = canvasRef.current;
      if (canvas) (mode === 'vi' ? drawKennlinie : drawBode)(canvas, result.rows);
      setRows(result.rows);
      setCopied('');
      const via = result.via === 'worker'
        ? (de ? 'im Worker' : 'in a worker')
        : (de ? 'im Haupt-Thread, stückweise' : 'chunked on this thread');
      // WHICH MEASUREMENT produced these numbers, beside which thread did.
      // "41 points, in a worker" does not say whether they came from a
      // linearised model or from a driven sine, and those are two answers.
      const how = mode === 'bode'
        ? ` · ${BODE_METHODS.find(m => m.id === bodeMethod).label[de ? 'de' : 'en']}`
        : '';
      setStatus(`${result.rows.length} ${de ? 'Punkte' : 'points'}`
        + `${result.cancelled ? (de ? ' (abgebrochen)' : ' (stopped)') : ''}${how} · ${via}`);
    }).catch((e) => {
      if (cancelRef.current !== token) return;
      setStatus((e && e.message) || String(e));
      setRows([]);
    }).finally(() => {
      if (cancelRef.current !== token) return;
      cancelRef.current = null;
      setProgress(null);
      setBusy(false);
    });
  }, [board, mode, sourceId, vFrom, vTo, fFrom, fTo, inNet, outNet, bodeMethod, de]);

  const stop = useCallback(() => {
    if (cancelRef.current) cancelRef.current.cancelled = true;
  }, []);

  // Export. A model comparison that starts from the DISPLAY rounding is
  // measuring the formatter, so the CSV carries full precision while the table
  // above it stays readable.
  const copyCsv = useCallback(() => {
    const csv = sweepRowsToCsv(rows, mode);
    const done = () => setCopied(de ? '✓ kopiert' : '✓ copied');
    try {
      if (navigator?.clipboard?.writeText) navigator.clipboard.writeText(csv).then(done, () => setCopied(csv));
      else setCopied(csv);
    } catch { setCopied(csv); }
  }, [rows, mode, de]);

  const downloadCsv = useCallback(() => {
    downloadText(sweepRowsToCsv(rows, mode),
      mode === 'vi' ? 'sweep-vi.csv' : 'sweep-bode.csv', 'text/csv');
  }, [rows, mode]);

  const sel = { width: '100%', background: '#0d1420', color: '#aab', border: '1px solid #2c3e50', borderRadius: 3, fontFamily: 'monospace', fontSize: 10, padding: 2 };
  const num = { ...sel, width: 60 };
  const lbl = { color: '#5d6d7e', fontFamily: 'monospace', fontSize: 9 };

  return (
    <div style={{ background: '#16213e', border: '1px solid #9b59b6', borderRadius: 6, padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }} data-testid="bw-sweep-panel">
      <div style={{ display: 'flex', gap: 4 }}>
        {['vi', 'bode'].map(m => (
          <button key={m} onClick={() => setMode(m)} style={{ flex: 1, padding: '3px 4px', background: mode === m ? '#2c3e50' : '#0d1420', border: '1px solid #9b59b6', borderRadius: 3, color: '#9b59b6', fontFamily: 'monospace', fontSize: 10 }}>
            {m === 'vi' ? (de ? 'Kennlinie' : 'V/I curve') : 'Bode'}
          </button>
        ))}
      </div>

      <div>
        <div style={lbl}>{de ? 'Quelle (vsource)' : 'Source (vsource)'}</div>
        <select value={sourceId} onChange={e => setSourceId(e.target.value)} style={sel}>
          {!sources.length && <option value="">{de ? '— keine Spannungsquelle im Aufbau —' : '— no vsource on the board —'}</option>}
          {sources.map(s => <option key={s.id} value={s.id}>{s.id}</option>)}
        </select>
      </div>

      {mode === 'vi' ? (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={lbl}>V</span>
          <input type="number" value={vFrom} onChange={e => setVFrom(e.target.value)} style={num} />
          <span style={lbl}>…</span>
          <input type="number" value={vTo} onChange={e => setVTo(e.target.value)} style={num} />
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={lbl}>Hz</span>
            <input type="number" value={fFrom} onChange={e => setFFrom(e.target.value)} style={num} />
            <span style={lbl}>…</span>
            <input type="number" value={fTo} onChange={e => setFTo(e.target.value)} style={num} />
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <div style={{ flex: 1 }}>
              <div style={lbl}>{de ? 'Eingang' : 'In'}</div>
              <select value={inNet} onChange={e => setInNet(e.target.value)} style={sel}>
                <option value="">—</option>
                {nets.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <div style={lbl}>{de ? 'Ausgang' : 'Out'}</div>
              <select value={outNet} onChange={e => setOutNet(e.target.value)} style={sel}>
                <option value="">—</option>
                {nets.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>
          {/* WHAT THEY ARE, not which is slower. The old control was a single
              checkbox reading "measure like a scope would (slower)", which
              named one side and left the other — the DEFAULT, and the one
              whose model can silently not apply — with no label at all. */}
          <div role="radiogroup" aria-label={de ? 'Messverfahren' : 'Measurement method'}
            data-testid="bw-sweep-method" style={{ display: 'flex', gap: 4 }}>
            {BODE_METHODS.map(m => (
              <button key={m.id} type="button" role="radio" aria-checked={bodeMethod === m.id}
                data-testid={m.testid} data-selected={bodeMethod === m.id ? 'yes' : 'no'}
                onClick={() => setBodeMethod(m.id)}
                title={de ? m.what.de : m.what.en}
                style={{
                  flex: 1, padding: '3px 4px', borderRadius: 3,
                  background: bodeMethod === m.id ? '#2c3e50' : '#0d1420',
                  border: `1px solid ${bodeMethod === m.id ? '#9b59b6' : '#2c3e50'}`,
                  color: bodeMethod === m.id ? '#c39bd3' : '#5d6d7e',
                  fontFamily: 'monospace', fontSize: 10,
                }}>
                {de ? m.label.de : m.label.en}
              </button>
            ))}
          </div>
          <div data-testid="bw-sweep-method-what" style={{ ...lbl, fontSize: 8, lineHeight: 1.3 }}>
            {de ? BODE_METHODS.find(m => m.id === bodeMethod).what.de
              : BODE_METHODS.find(m => m.id === bodeMethod).what.en}
          </div>
        </>
      )}

      <div style={{ display: 'flex', gap: 4 }}>
        <button onClick={run} disabled={busy || !board} style={{ flex: 1, padding: '4px 6px', background: busy ? '#0d1420' : '#2c3e50', border: '1px solid #9b59b6', borderRadius: 4, color: '#c39bd3', fontFamily: 'monospace', fontSize: 11 }} data-testid="bw-sweep-run">
          {busy
            ? (progress
              ? `… ${progress.index}/${progress.total}`
              : (de ? '… misst' : '… sweeping'))
            : (de ? '▶ Messen' : '▶ Sweep')}
        </button>
        {busy && (
          <button onClick={stop} data-testid="bw-sweep-stop" style={{ padding: '4px 8px', background: '#2c3e50', border: '1px solid #e67e22', borderRadius: 4, color: '#e67e22', fontFamily: 'monospace', fontSize: 11 }}>
            {de ? '■ Stopp' : '■ Stop'}
          </button>
        )}
      </div>

      <canvas ref={canvasRef} width={W} height={H} style={{ width: '100%', imageRendering: 'pixelated', background: '#0d1420', borderRadius: 3 }} />

      {/* The numbers. The plot is a picture; four Wave 6 lessons ask for values
          off it, and before this existed the only way to attach a number to a
          point was to set the sweep's start and end to the same frequency and
          run it again — once per point. */}
      {rows.length > 0 && (
        <div data-testid="bw-sweep-readout" style={{ background: '#0d1420', border: '1px solid #2c3e50', borderRadius: 3, maxHeight: 108, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'monospace', fontSize: 9, color: '#aab' }}>
            <thead>
              <tr style={{ color: '#5d6d7e' }}>
                {mode === 'vi'
                  ? <><th style={{ textAlign: 'right', padding: '1px 4px' }}>V</th><th style={{ textAlign: 'right', padding: '1px 4px' }}>mA</th></>
                  : <><th style={{ textAlign: 'right', padding: '1px 4px' }}>f</th><th style={{ textAlign: 'right', padding: '1px 4px' }}>dB</th><th style={{ textAlign: 'right', padding: '1px 4px' }}>°</th><th style={{ textAlign: 'left', padding: '1px 4px' }}>{de ? 'Modell' : 'model'}</th></>}
              </tr>
            </thead>
            <tbody>
              {thinRows(rows, 12).map((r, k) => {
                // THE POINT, per point. A row whose stage is railed or current
                // limited carries the small-signal number the model produced,
                // and the model does not apply there — so the row SAYS so
                // instead of sitting in the table looking like a measurement.
                const phrase = mode === 'bode' ? regionPhrase(r, de) : '';
                return (
                <tr key={k} data-testid={phrase ? 'bw-sweep-row-nonlinear' : 'bw-sweep-row'}
                  style={phrase ? { color: '#f39c12' } : undefined}>
                  {mode === 'vi'
                    ? <><td style={{ textAlign: 'right', padding: '1px 4px' }}>{r.v.toFixed(3)}</td><td style={{ textAlign: 'right', padding: '1px 4px' }}>{(r.i * 1000).toFixed(3)}</td></>
                    : <><td style={{ textAlign: 'right', padding: '1px 4px' }}>{formatHz(r.f)}</td><td style={{ textAlign: 'right', padding: '1px 4px' }}>{formatDb(r.magDb)}</td><td style={{ textAlign: 'right', padding: '1px 4px' }}>{r.phaseDeg.toFixed(2)}</td>
                      <td style={{ textAlign: 'left', padding: '1px 4px', whiteSpace: 'nowrap' }} title={phrase}>
                        {phrase ? `⚠ ${regionSummary(r)}` : (de ? 'linear' : 'linear')}
                      </td></>}
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {mode === 'bode' && rows.some(r => !rowIsLinear(r)) && (
        <div data-testid="bw-sweep-region-warning" style={{ color: '#f39c12', border: '1px solid #f39c12', borderRadius: 3, padding: 4, fontFamily: 'monospace', fontSize: 9 }}>
          {'⚠ '}
          {(() => {
            const bad = rows.filter(r => !rowIsLinear(r));
            const where = bad.length === rows.length
              ? (de ? `alle ${rows.length} Punkte` : `all ${rows.length} points`)
              : `${bad.length} ${de ? `von ${rows.length} Punkten` : `of ${rows.length} points`}`;
            // The banner is the SUMMARY; the table above marks WHICH rows, and
            // each marked row carries the same sentence as its tooltip.
            return de
              ? `${where}: nicht im linearen Bereich — ${regionSummary(bad[0])}`
              : `${where}: not in its linear region at this point — ${regionSummary(bad[0])}`;
          })()}
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={copyCsv} style={{ flex: 1, padding: '3px 6px', background: '#0d1420', border: '1px solid #2c3e50', borderRadius: 3, color: '#5d6d7e', fontFamily: 'monospace', fontSize: 9 }} data-testid="bw-sweep-csv">
            {de ? `⧉ ${rows.length} Punkte kopieren` : `⧉ Copy ${rows.length} points`}
          </button>
          <button onClick={downloadCsv} style={{ flex: 1, padding: '3px 6px', background: '#0d1420', border: '1px solid #2c3e50', borderRadius: 3, color: '#5d6d7e', fontFamily: 'monospace', fontSize: 9 }} data-testid="bw-sweep-csv-download">
            {de ? '⇩ CSV speichern' : '⇩ Download CSV'}
          </button>
        </div>
      )}
      {copied && <div style={{ color: '#5d6d7e', fontFamily: 'monospace', fontSize: 8, whiteSpace: 'pre-wrap', maxHeight: 80, overflowY: 'auto' }}>{copied}</div>}

      {status && <div data-testid="bw-sweep-status" style={{ color: '#f39c12', fontFamily: 'monospace', fontSize: 9, whiteSpace: 'pre-wrap' }}>{status}</div>}
      <div style={{ ...lbl, fontSize: 8 }}>
        {mode === 'vi'
          ? (de ? 'Läuft auf einer Offline-Kopie — die laufende Schaltung bleibt unberührt.' : 'Runs on an offline copy — the live circuit is untouched.')
          : (de ? 'Grün: Betrag (dB), Blau: Phase (°), bernsteinfarbener Ring: Punkt außerhalb des linearen Bereichs. Log-Frequenzachse; die Tabelle zeigt bis zu zwölf Punkte, das CSV alle.' : 'Green: magnitude (dB), blue: phase (°), amber ring: a point outside the linear region. Log frequency axis; the table shows up to twelve points, the CSV all of them.')}
      </div>
    </div>
  );
}

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
import { listSweepSources, netOfTerminal, runKennlinie, runBode } from '../model/sweep-runner.js';

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
  const dbLo = Math.min(-3, ...rows.map(r => r.magDb)), dbHi = Math.max(1, ...rows.map(r => r.magDb));
  const x = (f) => ((Math.log10(f) - fLo) / (fHi - fLo || 1)) * (W - 8) + 4;
  const yDb = (db) => 4 + ((dbHi - db) / (dbHi - dbLo || 1)) * (H - 8);
  const yPh = (p) => 4 + ((180 - p) / 360) * (H - 8);
  g.strokeStyle = '#2ecc71';
  g.lineWidth = 1.5;
  g.beginPath();
  rows.forEach((r, k) => { k ? g.lineTo(x(r.f), yDb(r.magDb)) : g.moveTo(x(r.f), yDb(r.magDb)); });
  g.stroke();
  g.strokeStyle = '#3498db';
  g.lineWidth = 1;
  g.beginPath();
  rows.forEach((r, k) => { k ? g.lineTo(x(r.f), yPh(r.phaseDeg)) : g.moveTo(x(r.f), yPh(r.phaseDeg)); });
  g.stroke();
  g.fillStyle = '#5d6d7e';
  g.font = '8px monospace';
  g.fillText(`${dbHi.toFixed(0)}dB`, 3, 9);
  g.fillText(`${dbLo.toFixed(0)}dB`, 3, H - 3);
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
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

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

  const run = useCallback(() => {
    setBusy(true);
    setStatus('');
    // Let the button repaint before the synchronous sweep.
    setTimeout(() => {
      try {
        const engine = typeof getEngine === 'function' ? getEngine() : {};
        const result = mode === 'vi'
          ? runKennlinie(engine, board, { sourceId, from: Number(vFrom), to: Number(vTo) })
          : runBode(engine, board, { sourceId, inNet, outNet, fFrom: Number(fFrom), fTo: Number(fTo) });
        if (!result.ok) { setStatus(result.reason); return; }
        const canvas = canvasRef.current;
        if (canvas) (mode === 'vi' ? drawKennlinie : drawBode)(canvas, result.rows);
        setStatus(`${result.rows.length} ${de ? 'Punkte' : 'points'}`);
      } finally {
        setBusy(false);
      }
    }, 20);
  }, [board, mode, sourceId, vFrom, vTo, fFrom, fTo, inNet, outNet, de]);

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
        </>
      )}

      <button onClick={run} disabled={busy || !board} style={{ padding: '4px 6px', background: busy ? '#0d1420' : '#2c3e50', border: '1px solid #9b59b6', borderRadius: 4, color: '#c39bd3', fontFamily: 'monospace', fontSize: 11 }} data-testid="bw-sweep-run">
        {busy ? (de ? '… misst' : '… sweeping') : (de ? '▶ Messen' : '▶ Sweep')}
      </button>

      <canvas ref={canvasRef} width={W} height={H} style={{ width: '100%', imageRendering: 'pixelated', background: '#0d1420', borderRadius: 3 }} />

      {status && <div style={{ color: '#f39c12', fontFamily: 'monospace', fontSize: 9, whiteSpace: 'pre-wrap' }}>{status}</div>}
      <div style={{ ...lbl, fontSize: 8 }}>
        {mode === 'vi'
          ? (de ? 'Läuft auf einer Offline-Kopie — die laufende Schaltung bleibt unberührt.' : 'Runs on an offline copy — the live circuit is untouched.')
          : (de ? 'Grün: Betrag (dB), Blau: Phase (°). Log-Frequenzachse.' : 'Green: magnitude (dB), blue: phase (°). Log frequency axis.')}
      </div>
    </div>
  );
}

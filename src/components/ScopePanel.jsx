/**
 * ScopePanel — the oscilloscope, drawn from the engine's scope tap.
 *
 * Everything on screen comes from `getScopeData`: an interleaved (min, max)
 * Float64Array ring buffer sampled at fixed sim-time cadence inside the
 * engine (boundary-B v2 §5). Unwritten regions are NaN and are simply not
 * drawn — a scope that renders data it never captured is the
 * multimeter-that-lies failure in a new costume, so gaps stay gaps.
 *
 * The UI owns what the contract assigns it: timebase (a window into the
 * ring), drawing, run/freeze. Triggering can layer on later — the buffer
 * carries everything needed.
 *
 * The engine rebuilds on every netlist edit (board identity changes), which
 * discards capture history. The panel re-attaches its channels to the new
 * board and says so in the status line rather than pretending continuity.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';

const CHANNEL_COLORS = ['#2ecc71', '#3498db'];
const W = 260;
const H = 120;
const V_MAX = 5.5; // volts full scale, a hair above VCC

export function ScopePanel({ board, nets = [] }) {
  const canvasRef = useRef(null);
  const [channels, setChannels] = useState([]); // [{netId, handle}]
  const [running, setRunning] = useState(true);
  const [windowFrac, setWindowFrac] = useState(1); // 1 | 0.25 | 0.05 of the buffer
  const [pickNet, setPickNet] = useState('');

  // (Re)attach channels whenever the board instance changes — an edit
  // rebuilds the engine and the old handles die with it.
  useEffect(() => {
    if (!board || !board.addScopeChannel) return undefined;
    const attached = channels.map(c => ({
      ...c,
      handle: board.addScopeChannel({ type: 'voltage', netId: c.netId }),
    }));
    setChannels(attached);
    return () => {
      for (const c of attached) {
        try { board.removeScopeChannel(c.handle); } catch { /* board gone */ }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board]);

  const addChannel = useCallback(() => {
    if (!board || !pickNet || channels.length >= 2) return;
    if (channels.some(c => c.netId === pickNet)) return;
    const handle = board.addScopeChannel({ type: 'voltage', netId: pickNet });
    setChannels(cs => [...cs, { netId: pickNet, handle }]);
  }, [board, pickNet, channels]);

  const removeChannel = useCallback((netId) => {
    setChannels(cs => {
      const c = cs.find(x => x.netId === netId);
      if (c && board) { try { board.removeScopeChannel(c.handle); } catch { /* gone */ } }
      return cs.filter(x => x.netId !== netId);
    });
  }, [board]);

  // Draw loop: envelope fill between min and max per pixel column.
  useEffect(() => {
    if (!running || channels.length === 0) return undefined;
    let raf;
    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas || !board || !board.getScopeData) { raf = requestAnimationFrame(draw); return; }
      const g = canvas.getContext('2d');
      g.fillStyle = '#0d1420';
      g.fillRect(0, 0, W, H);
      // Graticule
      g.strokeStyle = '#1e2d3d';
      g.lineWidth = 1;
      for (let i = 1; i < 5; i++) {
        g.beginPath(); g.moveTo(0, (H / 5) * i); g.lineTo(W, (H / 5) * i); g.stroke();
      }
      for (let i = 1; i < 10; i++) {
        g.beginPath(); g.moveTo((W / 10) * i, 0); g.lineTo((W / 10) * i, H); g.stroke();
      }

      // Auto-range across all channels' windows: a scope with a fixed
      // 0..5.5 V scale clamps a floating (negative-voltage) net into a flat
      // line at the bottom edge — real instruments range to the signal.
      let vLo = 0, vHi = 5;
      const chData = channels.map((c) => {
        try { return board.getScopeData(c.handle); } catch { return null; }
      });
      for (const data of chData) {
        if (!data) continue;
        for (let i = 0; i < data.samples.length; i += 2) {
          const mn = data.samples[i], mx = data.samples[i + 1];
          if (!Number.isNaN(mn) && mn < vLo) vLo = mn;
          if (!Number.isNaN(mx) && mx > vHi) vHi = mx;
        }
      }
      const pad = (vHi - vLo) * 0.08 || 0.5;
      vLo -= pad; vHi += pad;
      g.fillStyle = '#5d6d7e';
      g.font = '8px monospace';
      g.fillText(`${vHi.toFixed(1)}V`, 3, 9);
      g.fillText(`${vLo.toFixed(1)}V`, 3, H - 3);

      channels.forEach((c, ci) => {
        const data = chData[ci];
        if (!data) return;
        const { samples } = data;
        const depth = samples.length / 2;
        const win = Math.max(16, Math.floor(depth * windowFrac));
        // Newest sample sits just before writeIndex; window ends there.
        const end = data.writeIndex;
        g.fillStyle = CHANNEL_COLORS[ci] + '55';
        g.strokeStyle = CHANNEL_COLORS[ci];
        g.lineWidth = 1;
        const yOf = (v) => Math.min(H - 1.5, Math.max(1.5, H - ((v - vLo) / (vHi - vLo)) * H));
        let started = false;
        g.beginPath();
        for (let px = 0; px < W; px++) {
          const idx = ((end - win + Math.floor((px / W) * win)) % depth + depth) % depth;
          const mn = samples[idx * 2];
          const mx = samples[idx * 2 + 1];
          if (Number.isNaN(mn) || Number.isNaN(mx)) { started = false; continue; }
          const yTop = yOf(mx);
          const yBot = yOf(mn);
          g.fillRect(px, yTop, 1, Math.max(1, yBot - yTop));
          if (!started) { g.moveTo(px, (yTop + yBot) / 2); started = true; }
          else g.lineTo(px, (yTop + yBot) / 2);
        }
        g.stroke();
      });
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [running, channels, board, windowFrac]);

  const timeLabel = (() => {
    if (!board || channels.length === 0) return '';
    try {
      const d = board.getScopeData(channels[0].handle);
      const winNs = Number(d.sampleIntervalNs) * (d.samples.length / 2) * windowFrac;
      const ms = winNs / 1e6;
      return ms >= 1 ? `${ms.toFixed(0)} ms window` : `${(winNs / 1e3).toFixed(0)} µs window`;
    } catch { return ''; }
  })();

  return (
    <div style={{
      background: '#16213e', borderRadius: '6px', padding: '8px',
      fontFamily: 'monospace', fontSize: '10px', color: '#7f8c8d',
    }} data-scope-panel>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
        <strong style={{ color: '#ecf0f1', fontSize: '11px' }}>Oscilloscope</strong>
        <span style={{ flex: 1 }} />
        <button onClick={() => setRunning(r => !r)} style={{
          background: running ? '#2c3e50' : '#e67e22', color: running ? '#2ecc71' : '#000',
          border: '1px solid #2c3e50', borderRadius: '3px', padding: '1px 8px',
          cursor: 'pointer', fontSize: '9px', fontFamily: 'monospace',
        }}>{running ? 'RUN' : 'HOLD'}</button>
        <select value={windowFrac} onChange={e => setWindowFrac(Number(e.target.value))}
          style={{ background: '#1a1a2e', color: '#7f8c8d', border: '1px solid #2c3e50', fontSize: '9px' }}>
          <option value={1}>slow</option>
          <option value={0.25}>medium</option>
          <option value={0.05}>fast</option>
        </select>
      </div>

      {channels.length === 0 ? (
        <div style={{
          width: W, height: H, background: '#0d1420', borderRadius: '4px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          add a channel to capture — nothing is drawn that was not measured
        </div>
      ) : (
        <canvas ref={canvasRef} width={W} height={H} style={{ borderRadius: '4px' }} />
      )}

      <div style={{ display: 'flex', gap: '4px', marginTop: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
        {channels.map((c, ci) => (
          <span key={c.netId} style={{
            border: `1px solid ${CHANNEL_COLORS[ci]}`, borderRadius: '3px',
            padding: '1px 5px', color: CHANNEL_COLORS[ci],
          }}>
            {c.netId}
            <button onClick={() => removeChannel(c.netId)} style={{
              background: 'none', border: 'none', color: '#e74c3c',
              cursor: 'pointer', fontSize: '9px', padding: '0 0 0 4px',
            }}>✕</button>
          </span>
        ))}
        {channels.length < 2 && (
          <>
            <select value={pickNet} onChange={e => setPickNet(e.target.value)}
              style={{ background: '#1a1a2e', color: '#7f8c8d', border: '1px solid #2c3e50', fontSize: '9px', maxWidth: 110 }}>
              <option value="">net…</option>
              {nets.filter(n => !channels.some(c => c.netId === n)).map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
            <button onClick={addChannel} disabled={!pickNet} style={{
              background: '#2c3e50', color: '#3498db', border: '1px solid #3498db',
              borderRadius: '3px', padding: '1px 6px', cursor: 'pointer', fontSize: '9px',
            }}>+ channel</button>
          </>
        )}
        <span style={{ marginLeft: 'auto' }}>{timeLabel}</span>
      </div>
      <div style={{ marginTop: '4px', color: '#556' }}>
        auto-ranging scale · capture resets when the circuit is edited
      </div>
    </div>
  );
}


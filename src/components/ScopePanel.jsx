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
 * ring), drawing, run/freeze, display scale, edge trigger, and time cursors.
 *
 * The engine rebuilds on every netlist edit (board identity changes), which
 * discards capture history. The panel re-attaches its channels to the new
 * board and says so in the status line rather than pretending continuity.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { t } from '../i18n/strings.js';
import {
  cursorDeltaSeconds,
  findTriggerIndex,
  triggeredWindowStart,
} from '../model/scope-tools.js';

const CHANNEL_COLORS = ['#2ecc71', '#3498db'];
const W = 260;
const H = 120;

export function ScopePanel({ board, nets = [], lang = 'en' }) {
  const canvasRef = useRef(null);
  const [channels, setChannels] = useState([]); // [{netId, handle}]
  const [running, setRunning] = useState(true);
  const [windowFrac, setWindowFrac] = useState(1); // 1 | 0.25 | 0.05 of the buffer
  const [pickNet, setPickNet] = useState('');
  const [voltsPerDiv, setVoltsPerDiv] = useState('auto');
  const [verticalCenter, setVerticalCenter] = useState(2.5);
  const [triggerMode, setTriggerMode] = useState('off');
  const [triggerLevel, setTriggerLevel] = useState(2.5);
  const [cursorA, setCursorA] = useState(0.25);
  const [cursorB, setCursorB] = useState(0.75);
  const [triggered, setTriggered] = useState(false);
  const triggeredRef = useRef(false);

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

      // Auto-range across all channels' windows, or use the learner's
      // explicit volts/div and vertical-position settings.
      let vLo = 0, vHi = 5;
      const chData = channels.map((c) => {
        try { return board.getScopeData(c.handle); } catch { return null; }
      });
      if (voltsPerDiv === 'auto') {
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
      } else {
        const span = Number(voltsPerDiv) * 5;
        vLo = verticalCenter - span / 2;
        vHi = verticalCenter + span / 2;
      }
      g.fillStyle = '#5d6d7e';
      g.font = '8px monospace';
      g.fillText(`${vHi.toFixed(1)}V`, 3, 9);
      g.fillText(`${vLo.toFixed(1)}V`, 3, H - 3);

      const triggerIndex = chData[0] ? findTriggerIndex(chData[0], triggerMode, triggerLevel) : null;
      const nextTriggered = triggerMode !== 'off' && triggerIndex !== null;
      if (nextTriggered !== triggeredRef.current) {
        triggeredRef.current = nextTriggered;
        setTriggered(nextTriggered);
      }
      channels.forEach((c, ci) => {
        const data = chData[ci];
        if (!data) return;
        const { samples } = data;
        const depth = samples.length / 2;
        const win = Math.max(16, Math.floor(depth * windowFrac));
        const start = triggeredWindowStart(data, win, triggerIndex);
        g.fillStyle = CHANNEL_COLORS[ci] + '55';
        g.strokeStyle = CHANNEL_COLORS[ci];
        g.lineWidth = 1;
        const yOf = (v) => Math.min(H - 1.5, Math.max(1.5, H - ((v - vLo) / (vHi - vLo)) * H));
        let started = false;
        g.beginPath();
        for (let px = 0; px < W; px++) {
          const idx = (start + Math.floor((px / W) * win)) % depth;
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
      g.save();
      g.setLineDash([4, 3]);
      [{x: cursorA * W, color: '#f1c40f'}, {x: cursorB * W, color: '#e67e22'}].forEach(cursor => {
        g.strokeStyle = cursor.color;
        g.beginPath(); g.moveTo(cursor.x, 0); g.lineTo(cursor.x, H); g.stroke();
      });
      g.restore();
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [running, channels, board, windowFrac, voltsPerDiv, verticalCenter,
    triggerMode, triggerLevel, cursorA, cursorB]);

  const timeLabel = (() => {
    if (!board || channels.length === 0) return '';
    try {
      const d = board.getScopeData(channels[0].handle);
      const winNs = Number(d.sampleIntervalNs) * (d.samples.length / 2) * windowFrac;
      const ms = winNs / 1e6;
      return ms >= 1 ? `${ms.toFixed(0)} ms` : `${(winNs / 1e3).toFixed(0)} µs`;
    } catch { return ''; }
  })();

  const cursorLabel = (() => {
    if (!board || channels.length === 0) return '';
    try {
      const data = board.getScopeData(channels[0].handle);
      const windowSamples = Math.max(16, Math.floor((data.samples.length / 2) * windowFrac));
      const seconds = cursorDeltaSeconds(data.sampleIntervalNs, windowSamples, cursorA, cursorB);
      return seconds >= 1 ? `${seconds.toFixed(3)} s` :
        seconds >= 0.001 ? `${(seconds * 1000).toFixed(2)} ms` : `${(seconds * 1e6).toFixed(1)} µs`;
    } catch { return ''; }
  })();

  return (
    <div style={{
      background: '#16213e', borderRadius: '6px', padding: '8px',
      fontFamily: 'monospace', fontSize: '10px', color: '#7f8c8d',
      width: '100%', maxWidth: '100%', boxSizing: 'border-box', overflow: 'auto',
    }} data-scope-panel>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
        <strong style={{ color: '#ecf0f1', fontSize: '11px' }}>{t('oscilloscope', lang)}</strong>
        <span style={{ flex: 1 }} />
        <button onClick={() => setRunning(r => !r)} style={{
          background: running ? '#2c3e50' : '#e67e22', color: running ? '#2ecc71' : '#000',
          border: '1px solid #2c3e50', borderRadius: '3px', padding: '1px 8px',
          cursor: 'pointer', fontSize: '9px', fontFamily: 'monospace',
        }}>{running ? t('scopeRun', lang) : t('scopeHold', lang)}</button>
        <select value={windowFrac} onChange={e => setWindowFrac(Number(e.target.value))}
          style={{ background: '#1a1a2e', color: '#7f8c8d', border: '1px solid #2c3e50', fontSize: '9px' }}>
          <option value={1}>{t('scopeSlow', lang)}</option>
          <option value={0.25}>{t('scopeMedium', lang)}</option>
          <option value={0.05}>{t('scopeFast', lang)}</option>
        </select>
      </div>

      <div style={{ display: 'flex', gap: '4px', marginBottom: '5px', alignItems: 'center', flexWrap: 'wrap' }}>
        <label>{t('scopeScale', lang)}{' '}
          <select value={voltsPerDiv} onChange={e => setVoltsPerDiv(e.target.value)}
            style={{ background: '#1a1a2e', color: '#bdc3c7', border: '1px solid #2c3e50', fontSize: '9px' }}>
            <option value="auto">{t('scopeAuto', lang)}</option>
            <option value="0.5">0.5</option><option value="1">1</option>
            <option value="2">2</option><option value="5">5</option>
          </select>
        </label>
        <label>{t('scopeCenter', lang)}{' '}
          <input type="number" value={verticalCenter} step="0.5" onChange={e => setVerticalCenter(Number(e.target.value))}
            disabled={voltsPerDiv === 'auto'} style={{ width: 48, background: '#1a1a2e', color: '#bdc3c7', border: '1px solid #2c3e50', fontSize: '9px' }} />
        </label>
      </div>

      <div style={{ display: 'flex', gap: '4px', marginBottom: '5px', alignItems: 'center', flexWrap: 'wrap' }}>
        <label>{t('scopeTrigger', lang)}{' '}
          <select value={triggerMode} onChange={e => setTriggerMode(e.target.value)}
            style={{ background: '#1a1a2e', color: '#bdc3c7', border: '1px solid #2c3e50', fontSize: '9px' }}>
            <option value="off">{t('scopeTriggerOff', lang)}</option>
            <option value="rising">{t('scopeTriggerRise', lang)}</option>
            <option value="falling">{t('scopeTriggerFall', lang)}</option>
          </select>
        </label>
        <label>{t('scopeLevel', lang)}{' '}
          <input type="number" value={triggerLevel} step="0.1" onChange={e => setTriggerLevel(Number(e.target.value))}
            disabled={triggerMode === 'off'} style={{ width: 48, background: '#1a1a2e', color: '#bdc3c7', border: '1px solid #2c3e50', fontSize: '9px' }} />
        </label>
        {triggerMode !== 'off' && <strong style={{ color: triggered ? '#2ecc71' : '#f39c12' }}>
          {triggered ? t('scopeTriggered', lang) : t('scopeWaiting', lang)}
        </strong>}
      </div>

      {channels.length === 0 ? (
        <div style={{
          width: W, height: H, background: '#0d1420', borderRadius: '4px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {t('scopeEmpty', lang)}
        </div>
      ) : (
        <canvas ref={canvasRef} width={W} height={H} style={{ borderRadius: '4px', width: '100%', height: 'auto', display: 'block' }} />
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
              <option value="">{t('scopeNet', lang)}</option>
              {nets.filter(n => !channels.some(c => c.netId === n)).map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
            <button onClick={addChannel} disabled={!pickNet} style={{
              background: '#2c3e50', color: '#3498db', border: '1px solid #3498db',
              borderRadius: '3px', padding: '1px 6px', cursor: 'pointer', fontSize: '9px',
            }}>{t('scopeAddChannel', lang)}</button>
          </>
        )}
        <span style={{ marginLeft: 'auto' }}>{timeLabel}</span>
      </div>
      <div style={{ marginTop: '5px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>{t('scopeCursors', lang)}</span>
          <strong style={{ color: '#f1c40f' }}>Δt {cursorLabel || '—'}</strong>
        </div>
        <input aria-label="Cursor A" type="range" min="0" max="1" step="0.01" value={cursorA}
          onChange={e => setCursorA(Number(e.target.value))} style={{ width: '100%', accentColor: '#f1c40f' }} />
        <input aria-label="Cursor B" type="range" min="0" max="1" step="0.01" value={cursorB}
          onChange={e => setCursorB(Number(e.target.value))} style={{ width: '100%', accentColor: '#e67e22' }} />
      </div>
      <div style={{ marginTop: '4px', color: '#556' }}>
        {t('scopeFooter', lang)}
      </div>
    </div>
  );
}

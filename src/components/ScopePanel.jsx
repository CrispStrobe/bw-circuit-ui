/**
 * ScopePanel — the oscilloscope, drawn from the engine's scope tap.
 *
 * Everything on screen comes from `getScopeData`: an interleaved (min, max)
 * Float64Array ring buffer sampled at fixed sim-time cadence inside the
 * engine (boundary-B v2 §5). Unwritten regions are NaN and are simply not
 * drawn — a scope that renders data it never captured is the
 * multimeter-that-lies failure in a new costume, so gaps stay gaps.
 *
 * The UI owns what the contract assigns it: the capture rate, the timebase (a
 * window into the ring), drawing, run/freeze, display scale, edge trigger, and
 * time cursors.
 *
 * The capture rate was missing until 2026-08-25, and its absence is worth a
 * sentence because the header above already claimed it. `windowFrac` zooms into
 * the ring; nothing chose how long the ring IS. This panel called
 * `addScopeChannel({type, netId})` and passed neither `sampleRateHz` nor
 * `depth`, so every capture in the app was the engine default 100 kHz x 8192 =
 * 81.92 ms, on every bench — against an RC step with tau = 1 s, a 555 whose
 * period reaches 127 ms, and a tone a decade below a 15.9 Hz cutoff. No amount
 * of zooming a ring that never held the event will show it.
 *
 * The engine rebuilds on every netlist edit (board identity changes), which
 * discards capture history. The panel re-attaches its channels to the new
 * board and says so in the status line rather than pretending continuity.
 *
 * Two more things the header used to claim by omission (both 2026-08-29):
 *
 * D31 — "display scale" was ONE setting for the instrument, so a bench with a
 * 5 V rail on CH1 and a 50 mV shunt drop on CH2 could show one of them or
 * neither, and in auto it was worse than a shared manual setting: the range
 * was taken across ALL channels at once, so the small trace drew as a line on
 * the axis, which is what a dead net looks like. Vertical scale is per channel
 * now (`model/scope-scale.js`), and each channel PRINTS the span it is using,
 * because a scale nobody can read is a scale nobody can reason about.
 *
 * D24 — the spectrum view is a SECOND TAP on the same nets, not a transform of
 * the trace above it. The ring drawn above is a (min, max) envelope: its two
 * numbers are two different instants reported as one, so an FFT over it
 * describes a waveform that never existed and would look plausible doing it.
 * The spectrum channels are opened with `capture: 'sample'` (bw-board), live
 * only while the view is open, and carry their own capture rate — a sample
 * channel puts a solve point on every sample instant, so the rate is a bill
 * the learner chooses, labelled by the bandwidth it buys.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { t } from '../i18n/strings.js';
import {
  cursorDeltaSeconds,
  findTriggerIndex,
  triggeredWindowStart,
} from '../model/scope-tools.js';
import {
  SCOPE_DEPTH, SCOPE_RATES, formatSeconds, rateLabel, recordSeconds,
} from '../model/scope-timebase.js';
import {
  VOLTS_PER_DIV, channelRange, defaultScale, scaleLabel,
} from '../model/scope-scale.js';
import {
  formatHz, peakBin, seriesFromScopeData, spectrum, spectrumToCsv, thd,
} from '../model/fft.js';
import { scopeTracesToCsv } from '../model/scope-csv.js';
import { downloadText } from '../model/exporters/download.js';

const CHANNEL_COLORS = ['#2ecc71', '#3498db'];
const W = 260;
const H = 120;
/** How often the spectrum is recomputed, in ms. An 8192-point transform per
 *  channel per animation frame would be 60 of them a second to look at four. */
const SPECTRUM_PERIOD_MS = 250;

export function ScopePanel({ board, nets = [], lang = 'en' }) {
  const canvasRef = useRef(null);
  const [channels, setChannels] = useState([]); // [{netId, handle}]
  const [running, setRunning] = useState(true);
  const [windowFrac, setWindowFrac] = useState(1); // 1 | 0.25 | 0.05 of the buffer
  // The ring's own length, as opposed to the window into it. Changing it
  // re-attaches the channels, because a channel's rate is fixed when it is
  // created — so the capture history is discarded, and the status line says so
  // rather than pretending the old samples belong to the new cadence.
  const [sampleRateHz, setSampleRateHz] = useState(SCOPE_RATES[0]);
  const [pickNet, setPickNet] = useState('');
  // Vertical scale is PER CHANNEL (D31) and lives on the channel record, so a
  // 5 V rail and a 50 mV shunt drop can both be on screen and both be legible.
  const [triggerMode, setTriggerMode] = useState('off');
  const [triggerLevel, setTriggerLevel] = useState(2.5);
  const [cursorA, setCursorA] = useState(0.25);
  const [cursorB, setCursorB] = useState(0.75);
  const [triggered, setTriggered] = useState(false);
  const triggeredRef = useRef(false);
  // The spectrum view (D24). It is a SECOND tap on the same nets, not a
  // transform of the trace above: the drawing ring stores a (min,max) envelope,
  // whose two numbers are two different instants, and an FFT over that
  // describes a waveform that never existed. These channels are opened with
  // capture:'sample' and live only while the view is open.
  const [view, setView] = useState('time'); // 'time' | 'spectrum'
  const [fftWindow, setFftWindow] = useState('hann');
  // The spectrum tap has its OWN capture rate, and the default is deliberately
  // not the time view's. A sample-series channel makes the engine put a solve
  // point on every sample instant (that is what makes the samples exact), so
  // the rate is a bill: at 10 kHz the step is 100 µs, which is the fidelity
  // floor the integrator was already using and therefore costs nothing extra;
  // at 100 kHz it is 10 µs and the whole simulation runs about five times
  // slower. Measured in a real browser at 100 kHz, the page stopped responding
  // to clicks for over 30 s. 10 kHz gives 5 kHz of bandwidth and 1.2 Hz bins,
  // which covers every tone the curriculum's function generator makes.
  const [specRateHz, setSpecRateHz] = useState(10_000);
  const [specChannels, setSpecChannels] = useState([]); // [{netId, handle}]
  const [spectra, setSpectra] = useState([]); // [{netId, spec}|{netId, reason}]
  const [specCopied, setSpecCopied] = useState('');
  const specCanvasRef = useRef(null);

  // (Re)attach channels whenever the board instance changes — an edit
  // rebuilds the engine and the old handles die with it — OR when the capture
  // rate changes, because a channel's cadence is fixed at creation.
  useEffect(() => {
    if (!board || !board.addScopeChannel) return undefined;
    const attached = channels.map(c => ({
      ...c,
      handle: board.addScopeChannel({
        type: 'voltage', netId: c.netId, sampleRateHz, depth: SCOPE_DEPTH,
      }),
    }));
    setChannels(attached);
    return () => {
      for (const c of attached) {
        try { board.removeScopeChannel(c.handle); } catch { /* board gone */ }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, sampleRateHz]);

  const addChannel = useCallback(() => {
    if (!board || !pickNet || channels.length >= 2) return;
    if (channels.some(c => c.netId === pickNet)) return;
    const handle = board.addScopeChannel({
      type: 'voltage', netId: pickNet, sampleRateHz, depth: SCOPE_DEPTH,
    });
    setChannels(cs => [...cs, { netId: pickNet, handle, scale: defaultScale() }]);
  }, [board, pickNet, channels, sampleRateHz]);

  /** Change one channel's vertical setting, leaving the other alone. */
  const setChannelScale = useCallback((netId, patch) => {
    setChannels(cs => cs.map(c => c.netId === netId
      ? { ...c, scale: { ...(c.scale || defaultScale()), ...patch } } : c));
  }, []);

  const removeChannel = useCallback((netId) => {
    setChannels(cs => {
      const c = cs.find(x => x.netId === netId);
      if (c && board) { try { board.removeScopeChannel(c.handle); } catch { /* gone */ } }
      return cs.filter(x => x.netId !== netId);
    });
  }, [board]);

  // The second tap. Opened when the spectrum view is, closed when it is not —
  // a sample-series channel makes the transient integrator step at the capture
  // cadence, so leaving one open on a bench nobody is transforming would be a
  // cost with no reading behind it.
  const netKey = channels.map(c => c.netId).join('|');
  useEffect(() => {
    if (view !== 'spectrum' || !board || !board.addScopeChannel) { setSpecChannels([]); return undefined; }
    const opened = channels.map(c => ({
      netId: c.netId,
      handle: board.addScopeChannel({
        type: 'voltage', netId: c.netId, sampleRateHz: specRateHz, depth: SCOPE_DEPTH, capture: 'sample',
      }),
    }));
    setSpecChannels(opened);
    return () => {
      setSpecChannels([]);
      for (const c of opened) {
        try { board.removeScopeChannel(c.handle); } catch { /* board gone */ }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, view, specRateHz, netKey]);

  // Recompute the spectra on a slow clock, into state, so the table and the
  // plot and the CSV are all reading the same numbers.
  useEffect(() => {
    if (view !== 'spectrum' || specChannels.length === 0) { setSpectra([]); return undefined; }
    const tick = () => {
      if (!running) return;
      setSpectra(specChannels.map((c) => {
        let data = null;
        try { data = board.getScopeData(c.handle); } catch { data = null; }
        const series = seriesFromScopeData(data);
        if (!series.ok) return { netId: c.netId, reason: series.reason };
        const spec = spectrum(series.values, series.sampleRateHz, { window: fftWindow });
        return spec.ok ? { netId: c.netId, spec } : { netId: c.netId, reason: spec.reason };
      }));
    };
    tick();
    const id = setInterval(tick, SPECTRUM_PERIOD_MS);
    return () => clearInterval(id);
  }, [view, specChannels, board, fftWindow, running]);

  // Draw the spectra: log frequency axis, dBV vertical, one trace per channel.
  useEffect(() => {
    if (view !== 'spectrum') return;
    const canvas = specCanvasRef.current;
    if (!canvas) return;
    const g = canvas.getContext('2d');
    g.fillStyle = '#0d1420';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = '#1e2d3d';
    g.lineWidth = 1;
    for (let i = 1; i < 5; i++) { g.beginPath(); g.moveTo(0, (H / 5) * i); g.lineTo(W, (H / 5) * i); g.stroke(); }
    for (let i = 1; i < 6; i++) { g.beginPath(); g.moveTo((W / 6) * i, 0); g.lineTo((W / 6) * i, H); g.stroke(); }
    const ready = spectra.filter(s => s.spec);
    if (!ready.length) return;
    // One shared axis, because two channels' spectra are only comparable on
    // one. Bottom of the frequency axis is the first bin above DC.
    const fLo = Math.max(ready[0].spec.binHz, 1);
    const fHi = ready[0].spec.sampleRateHz / 2;
    const dbHi = 20, dbLo = -80;
    const x = (f) => ((Math.log10(Math.max(f, fLo)) - Math.log10(fLo)) / (Math.log10(fHi) - Math.log10(fLo))) * (W - 6) + 3;
    const y = (db) => 3 + ((dbHi - Math.min(dbHi, Math.max(dbLo, db))) / (dbHi - dbLo)) * (H - 14);
    ready.forEach((s, ci) => {
      g.strokeStyle = CHANNEL_COLORS[ci % CHANNEL_COLORS.length];
      g.lineWidth = 1;
      g.beginPath();
      let started = false;
      for (let k = 1; k < s.spec.freqs.length; k++) {
        const px = x(s.spec.freqs[k]), py = y(s.spec.magDb[k]);
        if (!started) { g.moveTo(px, py); started = true; } else g.lineTo(px, py);
      }
      g.stroke();
    });
    // The axis, labelled. A spectrum plot with no frequency axis is the exact
    // thing D3 fixed on the Bode plot; repeating it here would be a choice.
    g.fillStyle = '#5d6d7e';
    g.font = '8px monospace';
    g.fillText(`${dbHi} dBV`, 3, 9);
    g.fillText(`${dbLo} dBV`, 3, H - 12);
    g.fillText(formatHz(fLo), 3, H - 3);
    g.textAlign = 'right';
    g.fillText(formatHz(fHi), W - 3, H - 3);
    g.textAlign = 'left';
  }, [view, spectra]);

  // Draw loop: envelope fill between min and max per pixel column.
  useEffect(() => {
    if (!running || channels.length === 0 || view !== 'time') return undefined;
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

      // One range PER CHANNEL, from that channel's own setting and its own
      // samples (D31). The frame's corner labels can no longer name "the"
      // scale, so each channel labels its own edge in its own colour — CH1
      // left, CH2 right — and the readout under the canvas states both.
      const chData = channels.map((c) => {
        try { return board.getScopeData(c.handle); } catch { return null; }
      });
      const ranges = channels.map((c, ci) => channelRange(c.scale, chData[ci]));
      g.font = '8px monospace';
      ranges.forEach((r, ci) => {
        g.fillStyle = CHANNEL_COLORS[ci];
        g.textAlign = ci === 0 ? 'left' : 'right';
        const x = ci === 0 ? 3 : W - 3;
        g.fillText(`${r.vHi.toFixed(2)}V`, x, 9);
        g.fillText(`${r.vLo.toFixed(2)}V`, x, H - 3);
      });
      g.textAlign = 'left';

      const triggerIndex = chData[0] ? findTriggerIndex(chData[0], triggerMode, triggerLevel) : null;
      const nextTriggered = triggerMode !== 'off' && triggerIndex !== null;
      if (nextTriggered !== triggeredRef.current) {
        triggeredRef.current = nextTriggered;
        setTriggered(nextTriggered);
      }
      channels.forEach((c, ci) => {
        const data = chData[ci];
        if (!data) return;
        const { vLo, vHi } = ranges[ci];
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
  }, [running, channels, board, windowFrac, view,
    triggerMode, triggerLevel, cursorA, cursorB]);

  const copySpectrumCsv = useCallback(() => {
    const parts = spectra.filter(s => s.spec)
      .map(s => `# net=${s.netId}\n${spectrumToCsv(s.spec)}`);
    if (!parts.length) return;
    const csv = parts.join('\n');
    const done = () => setSpecCopied(lang === 'de' ? '✓ kopiert' : '✓ copied');
    try {
      if (navigator?.clipboard?.writeText) navigator.clipboard.writeText(csv).then(done, () => setSpecCopied(csv));
      else setSpecCopied(csv);
    } catch { setSpecCopied(csv); }
  }, [spectra, lang]);

  const spectrumCsv = useCallback(() => spectra.filter(s => s.spec)
    .map(s => `# net=${s.netId}\n${spectrumToCsv(s.spec)}`).join('\n'), [spectra]);

  const downloadSpectrumCsv = useCallback(() => {
    const csv = spectrumCsv();
    if (csv) downloadText(csv, 'scope-spectrum.csv', 'text/csv');
  }, [spectrumCsv]);

  const downloadTraceCsv = useCallback(() => {
    if (!board) return;
    const traces = channels.map(c => {
      try { return { netId: c.netId, data: board.getScopeData(c.handle) }; }
      catch { return { netId: c.netId, data: null }; }
    });
    const csv = scopeTracesToCsv(traces);
    if (csv) downloadText(csv, 'scope-trace.csv', 'text/csv');
  }, [board, channels]);

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
        {/* The RECORD, labelled by how much sim-time it holds — the question a
            learner has is "does the thing I want to see fit", and a sample rate
            does not answer it. Beside the zoom, which is a different control
            and was long the only one. */}
        <select value={sampleRateHz} onChange={e => setSampleRateHz(Number(e.target.value))}
          title={lang === 'de' ? 'Aufzeichnungslänge (Abtastrate)' : 'Record length (capture rate)'}
          data-testid="bw-scope-record"
          style={{ background: '#1a1a2e', color: '#7f8c8d', border: '1px solid #2c3e50', fontSize: '9px' }}>
          {SCOPE_RATES.map(hz => (
            <option key={hz} value={hz}>{rateLabel(hz)}</option>
          ))}
        </select>
        <select value={windowFrac} onChange={e => setWindowFrac(Number(e.target.value))}
          title={lang === 'de' ? 'Zoom in die Aufzeichnung' : 'Zoom into the record'}
          style={{ background: '#1a1a2e', color: '#7f8c8d', border: '1px solid #2c3e50', fontSize: '9px' }}>
          <option value={1}>{t('scopeSlow', lang)}</option>
          <option value={0.25}>{t('scopeMedium', lang)}</option>
          <option value={0.05}>{t('scopeFast', lang)}</option>
        </select>
      </div>

      {/* Time or spectrum (D24). The two are different taps on the same nets,
          not two drawings of one buffer — see the second-tap effect above. */}
      <div style={{ display: 'flex', gap: 4, marginBottom: '6px' }} data-testid="bw-scope-view">
        {['time', 'spectrum'].map(v => (
          <button key={v} onClick={() => setView(v)} data-testid={`bw-scope-view-${v}`}
            style={{
              flex: 1, padding: '2px 4px', fontFamily: 'monospace', fontSize: 9,
              background: view === v ? '#2c3e50' : '#0d1420',
              border: '1px solid #2c3e50', borderRadius: 3,
              color: view === v ? '#ecf0f1' : '#7f8c8d', cursor: 'pointer',
            }}>
            {v === 'time' ? t('scopeViewTime', lang) : t('scopeViewSpectrum', lang)}
          </button>
        ))}
      </div>

      {/* What is on screen, in seconds, so "it does not fit" is a reading
          rather than a guess. */}
      <div data-testid="bw-scope-span" style={{ color: '#5d6d7e', fontFamily: 'monospace', fontSize: '8px', marginBottom: '4px' }}>
        {lang === 'de'
          ? `Aufzeichnung ${formatSeconds(recordSeconds(sampleRateHz))} · sichtbar ${formatSeconds(recordSeconds(sampleRateHz) * windowFrac)}`
          : `record ${formatSeconds(recordSeconds(sampleRateHz))} · showing ${formatSeconds(recordSeconds(sampleRateHz) * windowFrac)}`}
      </div>

      {/* One vertical control set PER CHANNEL (D31). A single V/div could show
          a 5 V rail or a 50 mV shunt drop, never both; and in auto it ranged
          across all channels at once, so the small signal drew as a flat line
          on the axis — present, wrong, and identical to a dead net. The span
          each channel is actually using is printed beside its knobs, because a
          scale nobody can read is a scale nobody can reason about (the D4
          lesson). */}
      {view === 'time' && channels.map((c, ci) => {
        const scale = c.scale || defaultScale();
        let data = null;
        try { data = board && board.getScopeData ? board.getScopeData(c.handle) : null; } catch { data = null; }
        const range = channelRange(scale, data);
        return (
          <div key={`scale-${c.netId}`} data-testid={`bw-scope-scale-${ci}`}
            style={{ display: 'flex', gap: '4px', marginBottom: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ color: CHANNEL_COLORS[ci], minWidth: 46, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.netId}</span>
            <label>{t('scopeScale', lang)}{' '}
              <select value={scale.mode === 'auto' ? 'auto' : String(scale.voltsPerDiv)}
                data-testid={`bw-scope-vdiv-${ci}`}
                onChange={e => setChannelScale(c.netId, e.target.value === 'auto'
                  ? { mode: 'auto' }
                  : { mode: 'manual', voltsPerDiv: Number(e.target.value) })}
                style={{ background: '#1a1a2e', color: '#bdc3c7', border: '1px solid #2c3e50', fontSize: '9px' }}>
                <option value="auto">{t('scopeAuto', lang)}</option>
                {VOLTS_PER_DIV.map(v => <option key={v} value={String(v)}>{v}</option>)}
              </select>
            </label>
            <label>{t('scopeCenter', lang)}{' '}
              <input type="number" value={scale.center} step="0.5"
                data-testid={`bw-scope-center-${ci}`}
                onChange={e => setChannelScale(c.netId, { center: Number(e.target.value) })}
                disabled={scale.mode === 'auto'}
                style={{ width: 48, background: '#1a1a2e', color: '#bdc3c7', border: '1px solid #2c3e50', fontSize: '9px' }} />
            </label>
            <span data-testid={`bw-scope-span-${ci}`} style={{ color: '#5d6d7e', fontSize: '8px' }}>
              {scaleLabel(range)}{range.auto ? ' (auto)' : ''}
            </span>
          </div>
        );
      })}

      {view === 'spectrum' && (
        <div style={{ display: 'flex', gap: '4px', marginBottom: '5px', alignItems: 'center', flexWrap: 'wrap' }}>
          <label>{t('scopeWindow', lang)}{' '}
            <select value={fftWindow} onChange={e => setFftWindow(e.target.value)}
              data-testid="bw-scope-fft-window"
              style={{ background: '#1a1a2e', color: '#bdc3c7', border: '1px solid #2c3e50', fontSize: '9px' }}>
              <option value="hann">Hann</option>
              <option value="rect">rectangular</option>
            </select>
          </label>
          {/* Labelled by the BANDWIDTH it buys, not the rate, for the same
              reason the record control is labelled by length: "will the tone I
              am looking for be on the axis" is the question, and a sample rate
              does not answer it. Faster costs solver steps — see the state's
              comment — so the title says so. */}
          <label>{lang === 'de' ? 'Bandbreite' : 'span'}{' '}
            <select value={specRateHz} onChange={e => setSpecRateHz(Number(e.target.value))}
              data-testid="bw-scope-fft-rate"
              title={lang === 'de'
                ? 'Nyquist-Bandbreite. Schneller heißt feinere Solver-Schritte und eine langsamere Simulation.'
                : 'Nyquist bandwidth. Faster means finer solver steps and a slower simulation.'}
              style={{ background: '#1a1a2e', color: '#bdc3c7', border: '1px solid #2c3e50', fontSize: '9px' }}>
              {SCOPE_RATES.map(hz => (
                <option key={hz} value={hz}>{`DC…${formatHz(hz / 2)}`}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      {view === 'time' && (
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
      )}

      {view === 'spectrum' ? (
        <div data-testid="bw-scope-spectrum">
          {channels.length === 0 ? (
            <div style={{
              width: W, height: H, background: '#0d1420', borderRadius: '4px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>{t('scopeEmpty', lang)}</div>
          ) : (
            <canvas ref={specCanvasRef} width={W} height={H}
              style={{ borderRadius: '4px', width: '100%', height: 'auto', display: 'block' }} />
          )}
          {/* The numbers. A spectrum drawn without them is the same picture-
              instead-of-a-reading failure D3 closed on the Bode plot. Every
              refusal is printed in full, because "the trace is incomplete" is
              a measurement result and silence is not. */}
          {spectra.map((s, ci) => (
            <div key={`spec-${s.netId}`} data-testid={`bw-scope-spectrum-${ci}`}
              style={{ marginTop: 4, fontSize: 9, color: CHANNEL_COLORS[ci % CHANNEL_COLORS.length] }}>
              <strong>{s.netId}</strong>{' '}
              {s.reason ? (
                <span style={{ color: '#f39c12' }}>{s.reason}</span>
              ) : (() => {
                const p = peakBin(s.spec);
                const d = thd(s.spec);
                return (
                  <span style={{ color: '#aab' }}>
                    {t('scopePeak', lang)} {formatHz(p ? p.fInterp : NaN)} @ {p ? p.amplitude.toFixed(4) : '—'} V
                    {d ? ` · ${t('scopeThd', lang)} ${d.thdPercent.toFixed(2)} %` : ''}
                    {` · ${s.spec.windowName}, ${s.spec.points} pts, ${s.spec.binHz.toFixed(3)} Hz/bin`}
                  </span>
                );
              })()}
            </div>
          ))}
          {spectra.some(s => s.spec) && (
            <div style={{ display: 'flex', gap: 4, marginTop: 5 }}>
              <button onClick={copySpectrumCsv} data-testid="bw-scope-spectrum-csv" style={{
                flex: 1, padding: '3px 6px', background: '#0d1420', border: '1px solid #2c3e50',
                borderRadius: 3, color: '#5d6d7e', fontFamily: 'monospace', fontSize: 9, cursor: 'pointer',
              }}>{t('scopeSpectrumCsv', lang)}</button>
              <button onClick={downloadSpectrumCsv} data-testid="bw-scope-spectrum-csv-download" style={{
                flex: 1, padding: '3px 6px', background: '#0d1420', border: '1px solid #2c3e50',
                borderRadius: 3, color: '#5d6d7e', fontFamily: 'monospace', fontSize: 9, cursor: 'pointer',
              }}>{lang === 'de' ? '⇩ CSV speichern' : '⇩ Download CSV'}</button>
            </div>
          )}
          {specCopied && <div style={{ color: '#5d6d7e', fontSize: 8, whiteSpace: 'pre-wrap', maxHeight: 80, overflowY: 'auto' }}>{specCopied}</div>}
          <div style={{ marginTop: 4, color: '#556', fontSize: 8 }}>{t('scopeSpectrumFoot', lang)}</div>
        </div>
      ) : channels.length === 0 ? (
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
      {view === 'time' && channels.length > 0 && (
        <button onClick={downloadTraceCsv} data-testid="bw-scope-trace-csv-download" style={{
          width: '100%', marginTop: 5, padding: '3px 6px', background: '#0d1420',
          border: '1px solid #2c3e50', borderRadius: 3, color: '#5d6d7e',
          fontFamily: 'monospace', fontSize: 9, cursor: 'pointer',
        }}>{lang === 'de' ? '⇩ Kurvendaten als CSV' : '⇩ Download trace CSV'}</button>
      )}
      {view === 'time' && <div style={{ marginTop: '5px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>{t('scopeCursors', lang)}</span>
          <strong style={{ color: '#f1c40f' }}>Δt {cursorLabel || '—'}</strong>
        </div>
        <input aria-label="Cursor A" type="range" min="0" max="1" step="0.01" value={cursorA}
          onChange={e => setCursorA(Number(e.target.value))} style={{ width: '100%', accentColor: '#f1c40f' }} />
        <input aria-label="Cursor B" type="range" min="0" max="1" step="0.01" value={cursorB}
          onChange={e => setCursorB(Number(e.target.value))} style={{ width: '100%', accentColor: '#e67e22' }} />
      </div>}
      <div style={{ marginTop: '4px', color: '#556' }}>
        {t('scopeFooter', lang)}
      </div>
    </div>
  );
}

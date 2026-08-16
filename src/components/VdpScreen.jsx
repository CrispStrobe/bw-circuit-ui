/**
 * VdpScreen — canvas face for video hardware (TMS9918A, simplevga, etc).
 *
 * Paints the RGBA frame from the debug target's video() method:
 *   { width, height, rgba: Uint8ClampedArray, frame, signal }
 *
 * Polls per animation frame but skips repaints when .frame is unchanged.
 * Scaled 2x with crisp pixels (imageRendering: pixelated).
 * Shows "NO SIGNAL" when video() returns null or signal===false.
 *
 * KEYBOARD INPUT: takes focus on click, captures Arrow keys + WASD,
 * maps to debugState.setButtons(mask):
 *   bit 0 = down   (ArrowDown / S)
 *   bit 1 = up     (ArrowUp / W)
 *   bit 2 = right  (ArrowRight / D)
 *   bit 3 = left   (ArrowLeft / A)
 * Releases all on blur. Shows a subtle focus ring + "click to play" hint.
 */

import React, { useRef, useEffect, useCallback, useState } from 'react';
import { t } from '../i18n/strings.js';

// Key → button bit mapping for setButtons (4-direction pad)
const KEY_MAP = {
  ArrowDown: 0, s: 0, S: 0,
  ArrowUp: 1, w: 1, W: 1,
  ArrowRight: 2, d: 2, D: 2,
  ArrowLeft: 3, a: 3, A: 3,
};

// Browser key → Spectrum key name for setKeys (ULA keyboard matrix)
const BROWSER_TO_SPECTRUM = {
  '0': '0', '1': '1', '2': '2', '3': '3', '4': '4',
  '5': '5', '6': '6', '7': '7', '8': '8', '9': '9',
  'a': 'a', 'b': 'b', 'c': 'c', 'd': 'd', 'e': 'e',
  'f': 'f', 'g': 'g', 'h': 'h', 'i': 'i', 'j': 'j',
  'k': 'k', 'l': 'l', 'm': 'm', 'n': 'n', 'o': 'o',
  'p': 'p', 'q': 'q', 'r': 'r', 's': 's', 't': 't',
  'u': 'u', 'v': 'v', 'w': 'w', 'x': 'x', 'y': 'y', 'z': 'z',
  'Enter': 'enter', ' ': 'space', 'Shift': 'caps shift',
  'Control': 'symbol shift',
};

export function VdpScreen({ videoFn, setButtonsFn, setKeysFn, loadSnapshotFn, lang = 'en' }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const lastFrameRef = useRef(-1);
  const rafRef = useRef(0);
  const maskRef = useRef(0);
  const heldKeysRef = useRef(new Set());
  const [focused, setFocused] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [nativeSize, setNativeSize] = useState({ w: 256, h: 192 });

  // Input routing: prefer setKeys (full keyboard) over setButtons (4-dir pad)
  const useUlaKeys = typeof setKeysFn === 'function';

  const updateButtons = useCallback((mask) => {
    maskRef.current = mask;
    if (typeof setButtonsFn === 'function') setButtonsFn(mask);
  }, [setButtonsFn]);

  const updateKeys = useCallback(() => {
    if (typeof setKeysFn === 'function') setKeysFn([...heldKeysRef.current]);
  }, [setKeysFn]);

  const handleKeyDown = useCallback((e) => {
    if (useUlaKeys) {
      const specKey = BROWSER_TO_SPECTRUM[e.key] || BROWSER_TO_SPECTRUM[e.key.toLowerCase()];
      if (specKey) {
        e.preventDefault();
        heldKeysRef.current.add(specKey);
        updateKeys();
      }
      return;
    }
    const bit = KEY_MAP[e.key];
    if (bit === undefined) return;
    e.preventDefault();
    updateButtons(maskRef.current | (1 << bit));
  }, [useUlaKeys, updateButtons, updateKeys]);

  const handleKeyUp = useCallback((e) => {
    if (useUlaKeys) {
      const specKey = BROWSER_TO_SPECTRUM[e.key] || BROWSER_TO_SPECTRUM[e.key.toLowerCase()];
      if (specKey) {
        e.preventDefault();
        heldKeysRef.current.delete(specKey);
        updateKeys();
      }
      return;
    }
    const bit = KEY_MAP[e.key];
    if (bit === undefined) return;
    e.preventDefault();
    updateButtons(maskRef.current & ~(1 << bit));
  }, [useUlaKeys, updateButtons, updateKeys]);

  const handleFocus = useCallback(() => {
    setFocused(true);
    setHasInteracted(true);
  }, []);

  const handleBlur = useCallback(() => {
    setFocused(false);
    // Release all on blur
    if (useUlaKeys) { heldKeysRef.current.clear(); updateKeys(); }
    else updateButtons(0);
  }, [useUlaKeys, updateButtons, updateKeys]);

  const handleClick = useCallback(() => {
    wrapRef.current?.focus();
  }, []);

  // Snapshot drop-zone: accept .sna and .z80 files
  const [dragOver, setDragOver] = useState(false);
  const [snapStatus, setSnapStatus] = useState(null); // null | 'ok' | 'fail'

  const handleDragOver = useCallback((e) => {
    if (typeof loadSnapshotFn !== 'function') return;
    e.preventDefault();
    setDragOver(true);
  }, [loadSnapshotFn]);

  const handleDragLeave = useCallback(() => setDragOver(false), []);

  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    setDragOver(false);
    if (typeof loadSnapshotFn !== 'function') return;
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    const ext = file.name.toLowerCase().split('.').pop();
    if (ext !== 'sna' && ext !== 'z80') { setSnapStatus('fail'); return; }
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const ok = loadSnapshotFn(buf);
      setSnapStatus(ok ? 'ok' : 'fail');
    } catch { setSnapStatus('fail'); }
    setTimeout(() => setSnapStatus(null), 2000);
  }, [loadSnapshotFn]);

  // Paint loop. videoFn is read through a ref so the loop's identity is
  // stable across renders: a host that re-renders at rAF cadence (a debug
  // panel emitting per pump) and passes a fresh arrow each time otherwise
  // makes the effect below cancel-and-reschedule the pending rAF every
  // frame — the paint callback is starved and never runs once, a black
  // screen over a perfectly rendering machine (measured, brickwright-lite
  // 2026-08-16).
  const videoFnRef = useRef(videoFn);
  videoFnRef.current = videoFn;
  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const fn = videoFnRef.current;
    const v = typeof fn === 'function' ? fn() : null;

    if (!v || !v.rgba || v.signal === false) {
      // NO SIGNAL: clear to dark, draw placeholder text
      const w = v?.width || 256, h = v?.height || 192;
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#555';
      ctx.font = `${Math.round(h / 14)}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(t('noSignal', lang).toUpperCase(), w / 2, h / 2);
      lastFrameRef.current = -1;
      rafRef.current = requestAnimationFrame(paint);
      return;
    }

    // Skip repaint if frame counter unchanged
    if (v.frame === lastFrameRef.current) {
      rafRef.current = requestAnimationFrame(paint);
      return;
    }
    lastFrameRef.current = v.frame;

    if (canvas.width !== v.width) { canvas.width = v.width; setNativeSize(s => s.w !== v.width || s.h !== v.height ? { w: v.width, h: v.height } : s); }
    if (canvas.height !== v.height) { canvas.height = v.height; setNativeSize(s => s.w !== v.width || s.h !== v.height ? { w: v.width, h: v.height } : s); }

    const img = new ImageData(v.rgba, v.width, v.height);
    ctx.putImageData(img, 0, 0);
    rafRef.current = requestAnimationFrame(paint);
  }, [lang]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(rafRef.current);
  }, [paint]);

  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onClick={handleClick}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      data-vdp-screen
      style={{
        background: '#000', borderRadius: 4, overflow: 'hidden',
        border: dragOver ? '2px solid #f59e0b' : focused ? '2px solid #3b82f6' : '1px solid #333',
        display: 'inline-block', position: 'relative',
        outline: 'none', cursor: focused ? 'default' : 'pointer',
      }}
    >
      <canvas
        ref={canvasRef}
        width={nativeSize.w}
        height={nativeSize.h}
        style={{
          width: Math.min(nativeSize.w * 2, 640),
          height: Math.min(nativeSize.w * 2, 640) * (nativeSize.h / nativeSize.w),
          imageRendering: 'pixelated',
          display: 'block',
        }}
      />
      {/* "Click to play" hint — shown until first interaction */}
      {!hasInteracted && (typeof setButtonsFn === 'function' || typeof setKeysFn === 'function') && (
        <div style={{
          position: 'absolute', bottom: 8, left: 0, right: 0,
          textAlign: 'center', pointerEvents: 'none',
        }}>
          <span style={{
            background: 'rgba(0,0,0,0.7)', color: '#94a3b8',
            padding: '3px 10px', borderRadius: 4,
            fontFamily: 'system-ui, sans-serif', fontSize: 11,
          }}>
            {t('clickToPlay', lang)}
          </span>
        </div>
      )}
      {/* Drag-over overlay for snapshot drop */}
      {dragOver && (
        <div style={{
          position: 'absolute', inset: 0, background: 'rgba(245,158,11,0.2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none',
        }}>
          <span style={{
            background: 'rgba(0,0,0,0.8)', color: '#f59e0b',
            padding: '6px 14px', borderRadius: 6,
            fontFamily: 'system-ui, sans-serif', fontSize: 13, fontWeight: 600,
          }}>
            {t('dropSnapshot', lang)}
          </span>
        </div>
      )}
      {/* Snapshot load status */}
      {snapStatus && (
        <div style={{
          position: 'absolute', top: 8, right: 8, pointerEvents: 'none',
        }}>
          <span style={{
            background: snapStatus === 'ok' ? 'rgba(34,197,94,0.9)' : 'rgba(239,68,68,0.9)',
            color: '#fff', padding: '3px 8px', borderRadius: 4,
            fontFamily: 'system-ui, sans-serif', fontSize: 10,
          }}>
            {snapStatus === 'ok' ? t('snapshotLoaded', lang) : t('snapshotFailed', lang)}
          </span>
        </div>
      )}
    </div>
  );
}

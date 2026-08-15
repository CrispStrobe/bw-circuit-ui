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

// Key → button bit mapping (active semantics handled machine-side)
const KEY_MAP = {
  ArrowDown: 0, s: 0, S: 0,
  ArrowUp: 1, w: 1, W: 1,
  ArrowRight: 2, d: 2, D: 2,
  ArrowLeft: 3, a: 3, A: 3,
};

export function VdpScreen({ videoFn, setButtonsFn, lang = 'en' }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const lastFrameRef = useRef(-1);
  const rafRef = useRef(0);
  const maskRef = useRef(0);
  const [focused, setFocused] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);

  // Button input via keyboard
  const updateButtons = useCallback((mask) => {
    maskRef.current = mask;
    if (typeof setButtonsFn === 'function') setButtonsFn(mask);
  }, [setButtonsFn]);

  const handleKeyDown = useCallback((e) => {
    const bit = KEY_MAP[e.key];
    if (bit === undefined) return;
    e.preventDefault();
    updateButtons(maskRef.current | (1 << bit));
  }, [updateButtons]);

  const handleKeyUp = useCallback((e) => {
    const bit = KEY_MAP[e.key];
    if (bit === undefined) return;
    e.preventDefault();
    updateButtons(maskRef.current & ~(1 << bit));
  }, [updateButtons]);

  const handleFocus = useCallback(() => {
    setFocused(true);
    setHasInteracted(true);
  }, []);

  const handleBlur = useCallback(() => {
    setFocused(false);
    updateButtons(0); // release all on blur
  }, [updateButtons]);

  const handleClick = useCallback(() => {
    wrapRef.current?.focus();
  }, []);

  // Paint loop
  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const v = typeof videoFn === 'function' ? videoFn() : null;

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

    if (canvas.width !== v.width) canvas.width = v.width;
    if (canvas.height !== v.height) canvas.height = v.height;

    const img = new ImageData(v.rgba, v.width, v.height);
    ctx.putImageData(img, 0, 0);
    rafRef.current = requestAnimationFrame(paint);
  }, [videoFn, lang]);

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
      style={{
        background: '#000', borderRadius: 4, overflow: 'hidden',
        border: focused ? '2px solid #3b82f6' : '1px solid #333',
        display: 'inline-block', position: 'relative',
        outline: 'none', cursor: focused ? 'default' : 'pointer',
      }}
    >
      <canvas
        ref={canvasRef}
        width={256}
        height={192}
        style={{
          width: 512, height: 384,
          imageRendering: 'pixelated',
          display: 'block',
        }}
      />
      {/* "Click to play" hint — shown until first interaction */}
      {!hasInteracted && typeof setButtonsFn === 'function' && (
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
    </div>
  );
}

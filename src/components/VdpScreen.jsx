/**
 * VdpScreen — canvas face for the TMS9918A video display processor.
 *
 * Paints the RGBA frame from the debug target's video() method:
 *   { width: 256, height: 192, rgba: Uint8ClampedArray, mode, frame }
 *
 * Polls per animation frame but skips repaints when .frame is unchanged.
 * Scaled 2x with crisp pixels (imageRendering: pixelated).
 * Shows "NO SIGNAL" when video() returns null mid-session.
 */

import React, { useRef, useEffect, useCallback } from 'react';
import { t } from '../i18n/strings.js';

export function VdpScreen({ videoFn, lang = 'en' }) {
  const canvasRef = useRef(null);
  const lastFrameRef = useRef(-1);
  const rafRef = useRef(0);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const v = typeof videoFn === 'function' ? videoFn() : null;

    if (!v || !v.rgba) {
      // NO SIGNAL: clear to dark, draw placeholder text
      canvas.width = 256;
      canvas.height = 192;
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, 256, 192);
      ctx.fillStyle = '#555';
      ctx.font = '14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(t('noSignal', lang), 128, 100);
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
    <div style={{
      background: '#000', borderRadius: 4, overflow: 'hidden',
      border: '1px solid #333', display: 'inline-block',
    }}>
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
    </div>
  );
}

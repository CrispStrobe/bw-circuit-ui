/**
 * FramebufferFace — canvas rendering for machine framebuffer chips.
 *
 * The machine's framebuffer chip exposes getFrame() → Uint8Array
 * (1bpp monochrome: bit set = pixel on). The face renders it as a
 * scaled canvas, polled per debug tick / animation frame.
 *
 * Supports arbitrary resolutions: the chip declares width/height
 * and an optional stride (bytes per row, may be wider than visible
 * width for alignment). Default: 128×64 stride 16 (128 pixels/row).
 *
 * Same face contract as VdpScreen/ArchitectureFace: a component
 * that reads chip state and renders a visual.
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { t } from '../i18n/strings.js';

export function FramebufferFace({ chipState, width = 128, height = 64, stride, lang = 'en' }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(0);
  const lastFrameRef = useRef(-1);
  const bytesPerRow = stride || Math.ceil(width / 8);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const buf = typeof chipState?.getFrame === 'function' ? chipState.getFrame() : null;
    if (!buf) {
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#444';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(t('noSignal', lang).toUpperCase(), width / 2, height / 2);
      rafRef.current = requestAnimationFrame(paint);
      return;
    }

    // Skip if frame counter unchanged (if available)
    const frame = chipState.frame ?? -1;
    if (frame === lastFrameRef.current && frame >= 0) {
      rafRef.current = requestAnimationFrame(paint);
      return;
    }
    lastFrameRef.current = frame;

    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;

    // 1bpp monochrome → ImageData
    const img = ctx.createImageData(width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const byteIdx = y * bytesPerRow + (x >> 3);
        const bitIdx = 7 - (x & 7);
        const on = (buf[byteIdx] >> bitIdx) & 1;
        const i = (y * width + x) * 4;
        img.data[i] = on ? 220 : 10;
        img.data[i + 1] = on ? 255 : 10;
        img.data[i + 2] = on ? 220 : 15;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    rafRef.current = requestAnimationFrame(paint);
  }, [chipState, width, height, bytesPerRow, lang]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(rafRef.current);
  }, [paint]);

  const scale = Math.min(4, Math.max(2, Math.floor(280 / width)));

  return (
    <div data-framebuffer-face style={{
      background: '#000', borderRadius: 4, overflow: 'hidden',
      border: '1px solid #333', display: 'inline-block',
    }}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{
          width: width * scale,
          height: height * scale,
          imageRendering: 'pixelated',
          display: 'block',
        }}
      />
    </div>
  );
}

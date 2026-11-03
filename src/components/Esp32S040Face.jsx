import React, { useEffect, useRef, useState } from 'react';
import { ESP32_S040_FACE, ESP32_S040_STATUS_TEXT, s040PointToTouch, s040TouchInputs, s040VideoStatus } from '../model/esp32-s040-face.js';

/** A projection of the explicitly bound target. No local firmware or touch model. */
export function Esp32S040Face({ width, height, videoFn, onInput }) {
  const canvas = useRef(null);
  const held = useRef(null);
  const lastStatus = useRef('unavailable');
  const [status, setStatus] = useState('unavailable');
  const release = event => {
    event?.stopPropagation();
    if (!held.current || (event?.pointerId !== undefined && held.current.pointerId !== event.pointerId)) return;
    const old = held.current;
    held.current = null;
    old.sink(s040TouchInputs(null, false));
  };
  // Releasing to the captured owner matters when a run stops or the host binds
  // another target during a drag. Never send that release to the new target.
  useEffect(() => () => release(), [onInput, videoFn]);
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    let request;
    let frameNumber;
    const clear = () => {
      if (ctx) { ctx.fillStyle = '#080d15'; ctx.fillRect(0, 0, 480, 480); }
      frameNumber = undefined;
    };
    clear();
    const render = () => {
      let video;
      try { video = typeof videoFn === 'function' ? videoFn() : null; } catch { video = null; }
      const next = s040VideoStatus(video);
      if (lastStatus.current !== next) {
        lastStatus.current = next;
        setStatus(next);
      }
      if (next !== 'live') { clear(); release(); }
      else if (ctx && (frameNumber === undefined || video.frame !== frameNumber)) {
        const rgba = new Uint8ClampedArray(video.rgba.buffer, video.rgba.byteOffset, video.rgba.byteLength);
        ctx.putImageData(new ImageData(rgba, 480, 480), 0, 0);
        frameNumber = Number.isFinite(video.frame) ? video.frame : undefined;
      }
      if (typeof videoFn === 'function') request = requestAnimationFrame(render);
    };
    render();
    return () => { cancelAnimationFrame(request); clear(); };
  }, [videoFn]);
  const pointFor = event => {
    const matrix = event.currentTarget.getScreenCTM();
    if (!matrix) return null;
    // Bounding boxes lose orientation. The inverse CTM includes the board's
    // rotation/flip, circuit pan/zoom and CSS layout, in one transformation.
    try {
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
      return s040PointToTouch(point.x, point.y);
    } catch { return null; }
  };
  const active = status === 'live' && typeof onInput === 'function';
  const { screen } = ESP32_S040_FACE;
  return <svg x={-width / 2} y={-height / 2} width={width} height={height}
    viewBox={`0 0 ${ESP32_S040_FACE.width} ${ESP32_S040_FACE.height}`} preserveAspectRatio="none"
    data-esp32-s040-live-face={status} style={{ pointerEvents: 'none' }}>
    <foreignObject x={screen.x} y={screen.y} width={screen.w} height={screen.h} style={{ overflow: 'hidden', pointerEvents: 'none' }}>
      <canvas ref={canvas} width={480} height={480} aria-label="ESP32-4848S040 emulator display"
        style={{ width: '100%', height: '100%', display: 'block', imageRendering: 'pixelated', background: '#080d15' }} />
    </foreignObject>
    {status !== 'live' && <g fill="#9caec4" fontFamily="sans-serif" textAnchor="middle">
      <text x={screen.x + screen.w / 2} y={screen.y + screen.h / 2 - 3} fontSize={6.5}>{ESP32_S040_STATUS_TEXT[status]}</text>
      <text x={screen.x + screen.w / 2} y={screen.y + screen.h / 2 + 9} fontSize={4.8}>ESP32-4848S040 · 480 × 480</text>
    </g>}
    <rect x={screen.x} y={screen.y} width={screen.w} height={screen.h} fill="transparent"
      data-esp32-s040-touch="screen" role="img" aria-label="ESP32-4848S040 touch screen"
      aria-disabled={!active} style={{ pointerEvents: active ? 'all' : 'none', touchAction: 'none', cursor: active ? 'crosshair' : 'default' }}
      onPointerDown={event => {
        if (!active || event.button !== 0) return;
        event.stopPropagation(); event.preventDefault();
        if (held.current) return;
        const point = pointFor(event);
        if (!point) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        held.current = { pointerId: event.pointerId, sink: onInput };
        onInput(s040TouchInputs(point, true));
      }}
      onPointerMove={event => {
        if (active) event.stopPropagation();
        if (held.current?.pointerId !== event.pointerId) return;
        event.stopPropagation(); event.preventDefault();
        const point = pointFor(event);
        if (point) held.current.sink(s040TouchInputs(point));
      }}
      onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}
      onClick={event => { if (active) event.stopPropagation(); }} />
  </svg>;
}

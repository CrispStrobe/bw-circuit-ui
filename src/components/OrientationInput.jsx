/**
 * OrientationInput — a face that sets {x,y,z} g acceleration values
 * consumed by adxl335, memsic2125, and mpu6050 alike.
 *
 * ONE contract, three consumers: the face reports tilt as g values;
 * the engine device model maps them to its physical output (analog
 * voltages for ADXL335, PWM duty for Memsic2125, I2C registers for
 * MPU6050). The face doesn't know which device — it just sets params.
 *
 * Two input modes:
 * - Drag: a ball in a circle represents the device tilting. Drag
 *   maps to x/y g values (-1..+1 range). Z is gravity remainder.
 * - Sliders: direct numeric control of x, y, z in ±2g range.
 */

import React, { useState, useCallback, useRef } from 'react';
import { t } from '../i18n/strings.js';

const RADIUS = 50;

/**
 * @param {{ partId: string, onSetParam: (partId, key, value) => void, lang?: string }} props
 */
// Param-name mapping per device kind:
// adxl335/memsic2125 use gx/gy/gz; mpu6050 uses accelX/accelY/accelZ.
const PARAM_MAP = {
  adxl335:    { x: 'gx', y: 'gy', z: 'gz' },
  memsic2125: { x: 'gx', y: 'gy', z: 'gz' },
  mpu6050:    { x: 'accelX', y: 'accelY', z: 'accelZ' },
};

export function OrientationInput({ partId, kind = 'mpu6050', onSetParam, lang = 'en', initialX = 0, initialY = 0, initialZ = 1 }) {
  const [gx, setGx] = useState(initialX);
  const [gy, setGy] = useState(initialY);
  const [gz, setGz] = useState(initialZ);
  const [mode, setMode] = useState('drag'); // 'drag' | 'sliders'
  const circleRef = useRef(null);

  const pm = PARAM_MAP[kind] || PARAM_MAP.mpu6050;

  const applyOrientation = useCallback((x, y, z) => {
    setGx(x); setGy(y); setGz(z);
    if (onSetParam) {
      onSetParam(partId, pm.x, x);
      onSetParam(partId, pm.y, y);
      if (pm.z) onSetParam(partId, pm.z, z);
    }
  }, [partId, onSetParam, pm]);

  const handleCircleDrag = useCallback((e) => {
    const rect = circleRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = (e.clientX - cx) / RADIUS;
    const dy = (e.clientY - cy) / RADIUS;
    const r = Math.sqrt(dx * dx + dy * dy);
    const clamped = r > 1 ? { x: dx / r, y: dy / r } : { x: dx, y: dy };
    const zRemainder = Math.sqrt(Math.max(0, 1 - clamped.x * clamped.x - clamped.y * clamped.y));
    applyOrientation(
      Math.round(clamped.x * 100) / 100,
      Math.round(clamped.y * 100) / 100,
      Math.round(zRemainder * 100) / 100,
    );
  }, [applyOrientation]);

  const handlePointerDown = useCallback((e) => {
    if (mode !== 'drag') return;
    e.preventDefault();
    handleCircleDrag(e);
    const move = (ev) => handleCircleDrag(ev);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [mode, handleCircleDrag]);

  return (
    <div data-orientation-input style={{
      background: '#16213e', borderRadius: 6, padding: 8,
      fontFamily: 'monospace', fontSize: 10, color: '#94a3b8',
      width: '100%', boxSizing: 'border-box',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <strong style={{ color: '#e2e8f0', fontSize: 11 }}>{t('orientation', lang)}</strong>
        <div style={{ display: 'flex', gap: 3 }}>
          <button onClick={() => setMode('drag')} style={{
            padding: '1px 6px', fontSize: 9, background: mode === 'drag' ? '#2563eb' : '#1e293b',
            color: '#fff', border: '1px solid #475569', borderRadius: 3, cursor: 'pointer',
          }}>{t('orientDrag', lang)}</button>
          <button onClick={() => setMode('sliders')} style={{
            padding: '1px 6px', fontSize: 9, background: mode === 'sliders' ? '#2563eb' : '#1e293b',
            color: '#fff', border: '1px solid #475569', borderRadius: 3, cursor: 'pointer',
          }}>{t('orientSliders', lang)}</button>
        </div>
      </div>

      {mode === 'drag' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <svg ref={circleRef} width={RADIUS * 2 + 10} height={RADIUS * 2 + 10}
            onPointerDown={handlePointerDown}
            style={{ cursor: 'crosshair', flexShrink: 0 }}>
            {/* Tilt circle */}
            <circle cx={RADIUS + 5} cy={RADIUS + 5} r={RADIUS}
              fill="#0f172a" stroke="#334155" strokeWidth={1.5} />
            {/* Cross-hair */}
            <line x1={5} y1={RADIUS + 5} x2={RADIUS * 2 + 5} y2={RADIUS + 5} stroke="#1e293b" strokeWidth={0.5} />
            <line x1={RADIUS + 5} y1={5} x2={RADIUS + 5} y2={RADIUS * 2 + 5} stroke="#1e293b" strokeWidth={0.5} />
            {/* Ball position */}
            <circle cx={RADIUS + 5 + gx * RADIUS} cy={RADIUS + 5 + gy * RADIUS} r={8}
              fill="#3b82f6" stroke="#93c5fd" strokeWidth={1.5} />
          </svg>
          <div style={{ fontSize: 9, lineHeight: 1.6 }}>
            <div>X: <span style={{ color: '#3b82f6' }}>{gx.toFixed(2)}g</span></div>
            <div>Y: <span style={{ color: '#22c55e' }}>{gy.toFixed(2)}g</span></div>
            <div>Z: <span style={{ color: '#f59e0b' }}>{gz.toFixed(2)}g</span></div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {[
            { axis: 'X', value: gx, color: '#3b82f6', set: (v) => applyOrientation(v, gy, gz) },
            { axis: 'Y', value: gy, color: '#22c55e', set: (v) => applyOrientation(gx, v, gz) },
            { axis: 'Z', value: gz, color: '#f59e0b', set: (v) => applyOrientation(gx, gy, v) },
          ].map(({ axis, value, color, set }) => (
            <label key={axis} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ color, minWidth: 14 }}>{axis}:</span>
              <input type="range" min={-2} max={2} step={0.01} value={value}
                onChange={e => set(Number(e.target.value))}
                style={{ flex: 1, height: 16 }} />
              <span style={{ minWidth: 40, textAlign: 'right' }}>{value.toFixed(2)}g</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

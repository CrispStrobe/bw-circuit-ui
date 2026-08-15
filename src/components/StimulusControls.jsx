/**
 * StimulusControls — UI controls for environment stimuli that the
 * fabric path (potentiometer/button) can't provide:
 *
 * - Knock/tap: a button that briefly sets the piezo sensor's analog
 *   voltage high (simulating a physical tap). The voltage decays
 *   automatically — the button is impulse, not toggle.
 *
 * - Distance: a slider that sets the ultrasonic sensor's target range
 *   (0-400 cm), updating the device's params.distance.
 *
 * These controls appear in the instruments column when the circuit
 * contains the relevant sensor parts.
 */

import React, { useState, useCallback, useRef } from 'react';
import { t } from '../i18n/strings.js';

/**
 * @param {{ parts: Array, onSetParam: (partId, key, value) => void, lang?: string }} props
 */
export function StimulusControls({ parts, onSetParam, lang = 'en' }) {
  // Find sensor parts that need stimulus controls
  const piezoSensors = parts.filter(p =>
    p.kind === 'piezo' || p.kind === 'knock_sensor' || p.kind === 'force_sensor');
  const ultrasonics = parts.filter(p => p.kind === 'ultrasonic');

  if (piezoSensors.length === 0 && ultrasonics.length === 0) return null;

  return (
    <div data-stimulus-controls style={{
      background: '#16213e', borderRadius: 6, padding: 8,
      fontFamily: 'monospace', fontSize: 10, color: '#94a3b8',
      width: '100%', boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      {piezoSensors.map(p => (
        <KnockTap key={p.id} partId={p.id} onSetParam={onSetParam} lang={lang} />
      ))}
      {ultrasonics.map(p => (
        <DistanceSet key={p.id} partId={p.id} onSetParam={onSetParam}
          initial={p.params?.distance ?? 100} lang={lang} />
      ))}
    </div>
  );
}

function KnockTap({ partId, onSetParam, lang }) {
  const timeoutRef = useRef(null);
  const [tapping, setTapping] = useState(false);

  const handleTap = useCallback(() => {
    if (onSetParam) onSetParam(partId, 'force', 0.8);
    setTapping(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      if (onSetParam) onSetParam(partId, 'force', 0);
      setTapping(false);
    }, 100);
  }, [partId, onSetParam]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <button onClick={handleTap} title={t('stimKnockTitle', lang)}
        style={{
          padding: '4px 10px', background: tapping ? '#f59e0b' : '#1e293b',
          border: '1px solid #475569', borderRadius: 4,
          color: tapping ? '#000' : '#e2e8f0', cursor: 'pointer',
          fontFamily: 'monospace', fontSize: 10, fontWeight: 600,
        }}>
        👆 {t('stimKnockTap', lang)}
      </button>
      <span style={{ color: '#475569', fontSize: 9 }}>{partId}</span>
    </div>
  );
}

function DistanceSet({ partId, onSetParam, initial, lang }) {
  const [dist, setDist] = useState(initial);

  const handleChange = useCallback((e) => {
    const v = Number(e.target.value);
    setDist(v);
    if (onSetParam) onSetParam(partId, 'distance', v);
  }, [partId, onSetParam]);

  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6 }} title={t('stimDistanceTitle', lang)}>
      <span style={{ color: '#e2e8f0', fontSize: 10, minWidth: 50 }}>📏 {t('stimDistance', lang)}</span>
      <input type="range" min={0} max={400} step={1} value={dist}
        onChange={handleChange} style={{ flex: 1, height: 16 }} />
      <span style={{ minWidth: 35, textAlign: 'right' }}>{dist} cm</span>
      <span style={{ color: '#475569', fontSize: 8 }}>{partId}</span>
    </label>
  );
}

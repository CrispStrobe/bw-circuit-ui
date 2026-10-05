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
 * - Motion: a toggle for a PIR module's params.motion. The module drives its
 *   own output, so there is no contact for the fabric to close — without this
 *   a PIR on a bench could never see anyone.
 *
 * - Sound: a slider for a sound module's params.level (0..1, which sets AO =
 *   level x VCC and DO = level >= threshold), plus a Clap button: a short loud
 *   burst that falls back to the slider's level, the way a clap does.
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
  const pirs = parts.filter(p => p.kind === 'pir');
  const sounds = parts.filter(p => p.kind === 'sound_module');

  if (piezoSensors.length === 0 && ultrasonics.length === 0
    && pirs.length === 0 && sounds.length === 0) return null;

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
      {pirs.map(p => (
        <MotionToggle key={p.id} partId={p.id} onSetParam={onSetParam}
          initial={p.params?.motion ?? 0} lang={lang} />
      ))}
      {sounds.map(p => (
        <SoundLevel key={p.id} partId={p.id} onSetParam={onSetParam}
          initial={p.params?.level ?? 0} lang={lang} />
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

function MotionToggle({ partId, onSetParam, initial, lang }) {
  const [moving, setMoving] = useState(initial ? 1 : 0);

  const handleToggle = useCallback(() => {
    const next = moving ? 0 : 1;
    setMoving(next);
    if (onSetParam) onSetParam(partId, 'motion', next);
  }, [partId, onSetParam, moving]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <button onClick={handleToggle} title={t('stimMotionTitle', lang)}
        data-stim-motion={partId} aria-pressed={moving ? 'true' : 'false'}
        style={{
          padding: '4px 10px', background: moving ? '#f59e0b' : '#1e293b',
          border: '1px solid #475569', borderRadius: 4,
          color: moving ? '#000' : '#e2e8f0', cursor: 'pointer',
          fontFamily: 'monospace', fontSize: 10, fontWeight: 600,
        }}>
        🚶 {t(moving ? 'stimMotionOn' : 'stimMotionOff', lang)}
      </button>
      <span style={{ color: '#475569', fontSize: 9 }}>{partId}</span>
    </div>
  );
}

// A clap: full level for long enough that a program polling every 10-20 ms
// sees it, then back to the background level the slider holds.
const CLAP_MS = 150;

function SoundLevel({ partId, onSetParam, initial, lang }) {
  const [level, setLevel] = useState(initial);
  const [clapping, setClapping] = useState(false);
  const levelRef = useRef(initial);
  const timeoutRef = useRef(null);

  const handleChange = useCallback((e) => {
    const v = Number(e.target.value);
    levelRef.current = v;
    setLevel(v);
    if (onSetParam) onSetParam(partId, 'level', v);
  }, [partId, onSetParam]);

  const handleClap = useCallback(() => {
    if (onSetParam) onSetParam(partId, 'level', 1);
    setClapping(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      if (onSetParam) onSetParam(partId, 'level', levelRef.current);
      setClapping(false);
    }, CLAP_MS);
  }, [partId, onSetParam]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }} title={t('stimSoundTitle', lang)}>
        <span style={{ color: '#e2e8f0', fontSize: 10, minWidth: 50 }}>🔊 {t('stimSound', lang)}</span>
        <input type="range" min={0} max={1} step={0.01} value={level}
          data-stim-sound={partId} onChange={handleChange} style={{ flex: 1, height: 16 }} />
        <span style={{ minWidth: 30, textAlign: 'right' }}>{Math.round(level * 100)}%</span>
      </label>
      <button onClick={handleClap} title={t('stimClapTitle', lang)} data-stim-clap={partId}
        style={{
          padding: '4px 8px', background: clapping ? '#f59e0b' : '#1e293b',
          border: '1px solid #475569', borderRadius: 4,
          color: clapping ? '#000' : '#e2e8f0', cursor: 'pointer',
          fontFamily: 'monospace', fontSize: 10, fontWeight: 600,
        }}>
        👏 {t('stimClap', lang)}
      </button>
      <span style={{ color: '#475569', fontSize: 8 }}>{partId}</span>
    </div>
  );
}

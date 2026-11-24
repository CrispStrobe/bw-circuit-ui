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
 * - Sensing transducers (bw-board acoustics.js / sensing-transducers.js):
 *   the sound level (dB SPL) at a speaker or earphone that listens, and its
 *   distance to the transducer it hears; a thermocouple's hot-junction
 *   temperature with match and lighter presets; a magnet to drop through a
 *   hand-wound coil (bumps params.drops) and the distance of metal from it.
 *
 * - Temperature of a part's own surroundings (bw-board thermal.js
 *   params.surroundC): a sensor transistor, diode or PTC held in the fingers,
 *   in ice water or in hot water while the rest of the bench stays put.
 *
 * - The load on a ruler scale (bending_ruler.loadG, grams) and the gap of a
 *   spark gap (spark_gap.gapMm).
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
  // A speaker/earphone listens when it carries a sound or hears another part.
  const listeners = parts.filter(p => (p.kind === 'speaker' || p.kind === 'earphone')
    && (p.params?.soundDb !== undefined || p.params?.listen === true || typeof p.params?.hears === 'string'));
  const thermocouples = parts.filter(p => p.kind === 'thermocouple');
  const coils = parts.filter(p => p.kind === 'air_coil');
  const surrounds = parts.filter(p => p.params?.surroundC !== undefined && p.params?.surroundC !== null && p.params?.surroundC !== '');
  const rulers = parts.filter(p => p.kind === 'bending_ruler');
  const gaps = parts.filter(p => p.kind === 'spark_gap');

  if (piezoSensors.length === 0 && ultrasonics.length === 0
    && pirs.length === 0 && sounds.length === 0 && listeners.length === 0
    && thermocouples.length === 0 && coils.length === 0
    && surrounds.length === 0 && rulers.length === 0 && gaps.length === 0) return null;

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
      {listeners.map(p => (
        <React.Fragment key={p.id}>
          {p.params?.soundDb !== undefined && (
            <ParamSlider partId={p.id} param="soundDb" onSetParam={onSetParam} initial={p.params.soundDb}
              min={0} max={120} step={1} unit="dB" icon="🗣" label={t('stimVoice', lang)} title={t('stimVoiceTitle', lang)} />
          )}
          {typeof p.params?.hears === 'string' && (
            <ParamSlider partId={p.id} param="distanceCm" onSetParam={onSetParam} initial={p.params.distanceCm ?? 5}
              min={0} max={100} step={0.5} unit="cm" icon="↔" label={t('stimDistance', lang)} title={t('stimHearsTitle', lang)} />
          )}
        </React.Fragment>
      ))}
      {thermocouples.map(p => (
        <ParamSlider key={p.id} partId={p.id} param="hotC" onSetParam={onSetParam} initial={p.params?.hotC ?? 25}
          min={0} max={1200} step={5} unit="°C" icon="🔥" label={t('stimHeat', lang)} title={t('stimHeatTitle', lang)}
          presets={[[t('stimMatch', lang), 600], [t('stimLighter', lang), 900], [t('stimRoom', lang), 25]]} />
      ))}
      {surrounds.map(p => (
        <ParamSlider key={`${p.id}.surroundC`} partId={p.id} param="surroundC" onSetParam={onSetParam} initial={Number(p.params.surroundC)}
          min={-10} max={100} step={1} unit="°C" icon="🌡" label={t('stimTemp', lang)} title={t('stimTempTitle', lang)}
          presets={[[t('stimIce', lang), 0], [t('stimRoom', lang), 25], [t('stimFingers', lang), 33], [t('stimHotWater', lang), 70]]} />
      ))}
      {rulers.map(p => (
        <ParamSlider key={p.id} partId={p.id} param="loadG" onSetParam={onSetParam} initial={p.params?.loadG ?? 0}
          min={0} max={500} step={5} unit="g" icon="⚖" label={t('stimLoad', lang)} title={t('stimLoadTitle', lang)}
          presets={[['0', 0], ['50', 50], ['100', 100], ['200', 200]]} />
      ))}
      {gaps.map(p => (
        <ParamSlider key={p.id} partId={p.id} param="gapMm" onSetParam={onSetParam} initial={p.params?.gapMm ?? 1}
          min={0.1} max={5} step={0.1} unit="mm" icon="⚡" label={t('stimGap', lang)} title={t('stimGapTitle', lang)} />
      ))}
      {coils.map(p => (
        <React.Fragment key={p.id}>
          <DropMagnet partId={p.id} onSetParam={onSetParam} initial={p.params?.drops ?? 0} lang={lang} />
          <ParamSlider partId={p.id} param="metalCm" onSetParam={onSetParam} initial={p.params?.metalCm ?? 20}
            min={0} max={20} step={0.1} unit="cm" icon="🪙" label={t('stimMetal', lang)} title={t('stimMetalTitle', lang)} />
        </React.Fragment>
      ))}
    </div>
  );
}

/**
 * A slider on one numeric part param, with optional preset buttons
 * ([label, value] pairs: a match and a lighter for a thermocouple).
 */
function ParamSlider({ partId, param, onSetParam, initial, min, max, step, unit, icon, label, title, presets = [] }) {
  const [value, setValue] = useState(Number(initial));
  const set = useCallback((v) => {
    setValue(v);
    if (onSetParam) onSetParam(partId, param, v);
  }, [partId, param, onSetParam]);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }} title={title}>
        <span style={{ color: '#e2e8f0', fontSize: 10, minWidth: 50 }}>{icon} {label}</span>
        <input type="range" min={min} max={max} step={step} value={value}
          data-stim-param={`${partId}.${param}`} onChange={(e) => set(Number(e.target.value))} style={{ flex: 1, height: 16 }} />
        <span style={{ minWidth: 42, textAlign: 'right' }}>{value} {unit}</span>
      </label>
      {presets.map(([name, v]) => (
        <button key={name} onClick={() => set(v)} data-stim-preset={`${partId}.${param}=${v}`}
          style={{
            padding: '3px 6px', background: value === v ? '#f59e0b' : '#1e293b',
            border: '1px solid #475569', borderRadius: 4,
            color: value === v ? '#000' : '#e2e8f0', cursor: 'pointer',
            fontFamily: 'monospace', fontSize: 10,
          }}>{name}</button>
      ))}
      <span style={{ color: '#475569', fontSize: 8 }}>{partId}</span>
    </div>
  );
}

/** Drop a magnet through a hand-wound coil: each press bumps params.drops. */
function DropMagnet({ partId, onSetParam, initial, lang }) {
  const count = useRef(Number(initial) || 0);
  const handleDrop = useCallback(() => {
    count.current += 1;
    if (onSetParam) onSetParam(partId, 'drops', count.current);
  }, [partId, onSetParam]);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <button onClick={handleDrop} title={t('stimDropTitle', lang)} data-stim-drop={partId}
        style={{
          padding: '4px 10px', background: '#1e293b',
          border: '1px solid #475569', borderRadius: 4,
          color: '#e2e8f0', cursor: 'pointer',
          fontFamily: 'monospace', fontSize: 10, fontWeight: 600,
        }}>
        🧲 {t('stimDrop', lang)}
      </button>
      <span style={{ color: '#475569', fontSize: 9 }}>{partId}</span>
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

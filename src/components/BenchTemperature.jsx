import React, { useState } from 'react';

/**
 * The bench temperature: the air around the board, in whole degrees Celsius.
 * The chips' own temperature sensors and every temperature-dependent part read
 * it (bw-board solves them against board.temperatureC). The host owns the
 * value and applies it to its boards; this only shows it and reports edits.
 *
 * While typing, the field shows what was typed (a lone "-", "1" on the way to
 * "12"); every edit is reported raw, the host ignores what is not a number,
 * and on blur the field shows the value in force again.
 */
export const BENCH_TEMPERATURE_STRINGS = {
  en: { label: 'Bench', title: 'Bench temperature: the air around the board. The chips\' own temperature sensors and every temperature-dependent part read it.', aria: 'Bench temperature in degrees Celsius' },
  de: { label: 'Umgebung', title: 'Umgebungstemperatur: die Luft um die Platine. Die Temperatursensoren der Chips und alle temperaturabhängigen Bauteile lesen sie.', aria: 'Umgebungstemperatur in Grad Celsius' },
};

export function BenchTemperature({ value, onChange, lang = 'en', min = -40, max = 125 }) {
  const [draft, setDraft] = useState(null);
  const s = BENCH_TEMPERATURE_STRINGS[lang] || BENCH_TEMPERATURE_STRINGS.en;
  return (
    <label data-bench-temperature title={s.title}
      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', color: '#e2e8f0', fontSize: 12, whiteSpace: 'nowrap' }}>
      <span aria-hidden="true">{'\u{1F321}'}</span>
      <span>{s.label}</span>
      <input type="number" aria-label={s.aria} min={min} max={max} step={1}
        value={draft === null ? value : draft}
        onChange={(e) => { setDraft(e.target.value); onChange?.(e.target.value); }}
        onBlur={() => setDraft(null)}
        style={{ width: 52, padding: '2px 4px', fontSize: 12, border: '1px solid #64748b', borderRadius: 4, background: '#1e293b', color: '#e2e8f0' }} />
      <span>{'°C'}</span>
    </label>
  );
}

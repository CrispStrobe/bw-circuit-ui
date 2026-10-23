import React, {useEffect, useState} from 'react';
import {componentMeasurements} from '../model/component-measurements.js';
import {t} from '../i18n/strings.js';

const number = value => value === null || !Number.isFinite(value) ? '—' :
  (Math.abs(value) < 1e-12 ? '0' : Number(value.toPrecision(5)).toString());

function LimitInput({value, onCommit, onCancel, ...props}) {
  const [draft, setDraft] = useState(String(value ?? ''));
  useEffect(() => setDraft(String(value ?? '')), [value]);
  return <input {...props} type="text" inputMode="decimal" value={draft}
    onChange={event => setDraft(event.target.value)}
    onBlur={() => onCommit(draft)} onKeyDown={event => {
      if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
      if (event.key === 'Escape') { event.preventDefault(); setDraft(String(value ?? '')); onCancel?.(); }
    }} />;
}

export function ComponentMeasurements({board, parts = [], selectedPart, onSelectPart, onLimitsChange,
  onReadings, annotate, onAnnotateChange, lang = 'en'}) {
  const [rows, setRows] = useState([]);
  const [limitError, setLimitError] = useState('');
  useEffect(() => {
    const read = () => {
      const next = componentMeasurements(board, parts);
      setRows(next);
      onReadings?.(board, next);
    };
    read();
    const timer = setInterval(read, 250);
    return () => clearInterval(timer);
  }, [board, parts, onReadings]);
  const selected = parts.find(p => p.id === selectedPart);
  useEffect(() => setLimitError(''), [selectedPart]);
  const editLimit = (key, value) => {
    if (value === String(selected.limits?.[key] ?? '')) { setLimitError(''); return; }
    const limits = {...selected.limits};
    if (value === '') delete limits[key];
    else limits[key] = Number(value);
    try { onLimitsChange(selected.id, limits); setLimitError(''); }
    catch (error) { setLimitError(String(error.message || error)); }
  };
  return <section data-testid="bw-component-measurements" style={{background: '#16213e', color: '#cbd5e1',
    padding: 8, font: '10px monospace', borderRadius: 6}}>
    <strong>{t('componentsTitle', lang)}</strong>
    {onAnnotateChange && <label style={{display: 'block', marginTop: 6}}>
      <input type="checkbox" checked={!!annotate} onChange={event => onAnnotateChange(event.target.checked)} />
      {t('componentsAnnotate', lang)}
    </label>}
    <p>{t('componentsPolarity', lang)}</p>
    <div style={{overflowX: 'auto', maxHeight: 380, overflowY: 'auto'}}>
      <table style={{width: '100%', borderCollapse: 'collapse', textAlign: 'right'}}>
        <thead><tr><th>{t('componentsPart', lang)}</th><th>V</th><th>mA</th><th>mW</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.id} data-testid={`bw-component-${row.id}`}>
          <th style={{textAlign: 'left'}}><button onClick={() => onSelectPart?.(row.id)}
            title={`${row.terminals.join(' → ')}${row.reason ? ': '+row.reason : ''}`}
            style={{background: 'transparent', color: row.warnings.length ? '#fbbf24' : '#93c5fd', border: 0,
              padding: '4px 2px', cursor: 'pointer'}}>{row.label}{row.warnings.length ? ' ⚠' : ''}</button></th>
          <td>{number(row.volts)}</td><td>{number(row.currentAmps === null ? null : row.currentAmps * 1000)}</td>
          <td>{number(row.powerWatts === null ? null : row.powerWatts * 1000)}</td>
        </tr>)}</tbody>
      </table>
    </div>
    {!rows.length && <p>{t('componentsEmpty', lang)}</p>}
    {rows.filter(r => r.status !== 'measured' || r.warnings.length).map(row =>
      <div key={row.id} role={row.warnings.length ? 'alert' : 'status'}>
        {row.label}: {row.status === 'open' ? t('componentsOpen', lang) : row.reason ||
          row.warnings.map(w => t(w === 'power' ? 'componentsPowerWarning' : 'componentsCurrentWarning', lang)).join('; ')}
      </div>)}
    {selected && onLimitsChange && <fieldset style={{marginTop: 8, border: '1px solid #475569'}}>
      <legend>{selected.label || selected.id} · {t('componentsLimits', lang)}</legend>
      {Object.entries({powerWatts: 'W', currentAmps: 'A'}).map(([key, unit]) => <label key={key}
        style={{display: 'block', margin: 4}}>{unit}{' '}<LimitInput key={`${selected.id}:${key}`}
          aria-label={`${selected.label || selected.id} ${unit} limit`} data-testid={`bw-component-limit-${key}`}
          value={selected.limits?.[key] ?? ''} placeholder="—" style={{width: 100}}
          onCommit={value => editLimit(key, value)} onCancel={() => setLimitError('')} /></label>)}
      <small>{t('componentsLimitHint', lang)}</small>
    </fieldset>}
    {limitError && <div role="alert">{limitError}</div>}
  </section>;
}

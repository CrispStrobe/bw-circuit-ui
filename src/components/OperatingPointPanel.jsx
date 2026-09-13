import React, { useEffect, useState } from 'react';
import { operatingPointRows, runOperatingPointAnalysis } from '../model/operating-point-view.js';

const value = (n, unit) => Number.isFinite(n) ? `${Number(n).toPrecision(6)} ${unit}` : `— ${unit}`;
const NO_BLOCKERS = [];

/** One-shot, non-mutating static DC analysis inside the existing Instruments controls. */
export function OperatingPointPanel({ board, blockers, lang = 'en' }) {
  const de = /^de/i.test(lang);
  const safeBlockers = Array.isArray(blockers) ? blockers : NO_BLOCKERS;
  const [outcome, setOutcome] = useState(null);
  useEffect(() => setOutcome(null), [board, safeBlockers]);

  const result = outcome?.ok ? outcome.result : null;
  const rows = operatingPointRows(result);
  const label = { fontSize: 9, color: '#64748b', fontFamily: 'monospace' };

  return (
    <div data-testid="bw-operating-point-panel" style={{marginTop: 8, paddingTop: 8, borderTop: '1px solid #cbd5e1'}}>
      <button type="button" data-testid="bw-operating-point-run"
        onClick={() => setOutcome(runOperatingPointAnalysis(board, safeBlockers))}
        style={{width: '100%', minHeight: 32, padding: '5px 8px', cursor: 'pointer'}}>
        {de ? '⎓ DC-Arbeitspunkt berechnen' : '⎓ Calculate DC operating point'}
      </button>
      <div style={{...label, marginTop: 4}}>
        {de ? 'Unabhängige Momentaufnahme; verändert den Simulationszustand nicht.'
          : 'Independent snapshot; does not change transient simulation state.'}
      </div>
      {outcome && !outcome.ok && (
        <div role="alert" data-testid="bw-operating-point-refusal"
          style={{marginTop: 6, padding: 5, borderRadius: 3, background: '#fee2e2', color: '#991b1b', fontSize: 10}}>
          {outcome.reason}
        </div>
      )}
      {result && (
        <div data-testid="bw-operating-point-result" style={{marginTop: 6, fontSize: 10, color: '#334155'}}>
          <div><strong>{de ? 'Konvergiert' : 'Converged'}</strong> — {result.analysis.scope}</div>
          <div style={label}>C: {result.analysis.capacitors}; {de ? 'Quellen' : 'sources'}: {result.analysis.sources}</div>
          <div style={label}>{result.analysis.currentConvention}</div>
          <div style={{...label, marginTop: 5}}>{de ? 'Knotenspannungen' : 'Node voltages'}</div>
          <div style={{maxHeight: 90, overflow: 'auto', fontFamily: 'monospace'}}>
            {rows.nodes.map((row) => <div key={row.id}>{row.id}: {value(row.value, 'V')}</div>)}
          </div>
          <div style={{...label, marginTop: 5}}>{de ? 'Ströme in Anschluss' : 'Currents into terminal'}</div>
          <div style={{maxHeight: 90, overflow: 'auto', fontFamily: 'monospace'}}>
            {rows.currents.map((row) => <div key={row.id}>{row.id}: {value(row.value, 'A')}</div>)}
          </div>
        </div>
      )}
    </div>
  );
}

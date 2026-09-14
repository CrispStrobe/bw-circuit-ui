import React, { useEffect, useState } from 'react';
import {
  LIVE_SIMULATION_PROFILE, SOURCE_ANALYSIS_PROFILE, runPrecisionSourceAnalysis,
} from '../model/source-analysis-view.js';

const PROFILE = SOURCE_ANALYSIS_PROFILE;
const LIVE_PROFILE = LIVE_SIMULATION_PROFILE;
const mono = { fontSize: 9, color: '#64748b', fontFamily: 'monospace' };

const workText = work => work
  ? `${work.attempts} attempts, ${work.solves} solves, ${work.advances} advances`
  : 'no transient work record';

/** Source-declared numerical analyses, intentionally separate from live simulation. */
export function SourceAnalysisPanel({ circuit, liveBoard = circuit?.board, lang = 'en' }) {
  const de = /^de/i.test(lang);
  const source = circuit?.sourceAnalysis;
  const analyses = Array.isArray(source?.analyses) ? source.analyses : [];
  let liveProfile = LIVE_PROFILE;
  try { liveProfile = liveBoard?.transientAnalysisStatus?.().profile?.id || LIVE_PROFILE; } catch { /* fallback names shipped default */ }
  const [outcome, setOutcome] = useState(null);
  useEffect(() => setOutcome(null), [circuit, source]);

  if (!analyses.length) return null;
  const run = () => {
    try {
      setOutcome({ results: runPrecisionSourceAnalysis(circuit) });
    } catch (error) {
      setOutcome({ error: String(error?.message || error) });
    }
  };

  return (
    <div data-testid="bw-source-analysis-panel"
      style={{marginTop: 8, paddingTop: 8, borderTop: '1px solid #cbd5e1'}}>
      <div style={mono} data-testid="bw-live-simulation-profile">
        {de ? 'Live-Simulation' : 'Live simulation'}: {liveProfile}
      </div>
      <button type="button" data-testid="bw-source-analysis-run" onClick={run}
        style={{width: '100%', minHeight: 32, marginTop: 4, padding: '5px 8px', cursor: 'pointer'}}>
        {de ? `Quellanalysen mit ${PROFILE} ausführen` : `Run source analyses at ${PROFILE}`}
      </button>
      <div style={{...mono, marginTop: 4}}>
        {de
          ? 'Opt-in; unabhängiger Lauf. Die Live-Simulation bleibt interactive-v1.'
          : `Opt-in independent run; live simulation remains ${liveProfile}.`}
      </div>
      {outcome?.error && <div role="alert" data-testid="bw-source-analysis-error"
        style={{marginTop: 6, color: '#991b1b', fontSize: 10}}>{outcome.error}</div>}
      {outcome?.results?.map(result => {
        const execution = result.executionProfile || result.conditions?.executionProfile;
        const passed = result.status === 'pass';
        return (
          <div key={result.analysisId} data-testid="bw-source-analysis-result"
            style={{marginTop: 6, padding: 5, borderRadius: 3,
              background: passed ? '#ecfdf5' : '#fff7ed', color: '#334155', fontSize: 10}}>
            <div><strong>{result.kind.toUpperCase()}</strong> — {passed
              ? (result.kind === 'tran' ? `engine execution passed at ${PROFILE}` : 'engine execution passed')
              : `${result.status}: ${result.detail || result.code}`}</div>
            <div style={mono}>evidence: {result.evidence || result.classification}</div>
            <div style={mono}>thermal: {result.thermal || 'not reported by this analysis kind'}</div>
            <div style={mono}>oracle agreement: not measured</div>
            {execution && <>
              <div style={mono}>execution profile: {execution.configured?.id || execution.requested}</div>
              <div style={mono}>qualification: {execution.qualification?.accuracyMet === true ? 'met' : 'not met'};
                {' '}{execution.qualification?.scope}; not a global output-accuracy guarantee</div>
              <div style={mono}>work: {workText(execution.work)}</div>
            </>}
            {(result.adapted || []).map((item, index) =>
              <div key={`adapt-${index}`} style={mono}>adapted: {item}</div>)}
            {(result.skipped || []).map((item, index) =>
              <div key={`skip-${index}`} style={{...mono, color: '#9a3412'}}>
                skipped {item.ref}: {item.consequence}
              </div>)}
          </div>
        );
      })}
    </div>
  );
}

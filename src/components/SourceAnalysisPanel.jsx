import React, { useEffect, useState } from 'react';
import {
  BOUNDED_RESEARCH_OBSERVATION_PROFILE, LIVE_SIMULATION_PROFILE,
  SOURCE_ANALYSIS_PROFILE, SOURCE_OBSERVATION_PROFILE, runPrecisionSourceAnalysis,
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
  const retainedDirectives = Array.isArray(source?.retainedDirectives)
    ? source.retainedDirectives : [];
  let liveProfile = LIVE_PROFILE;
  try { liveProfile = liveBoard?.transientAnalysisStatus?.().profile?.id || LIVE_PROFILE; } catch { /* fallback names shipped default */ }
  const [outcome, setOutcome] = useState(null);
  const [observationProfile, setObservationProfile] = useState(SOURCE_OBSERVATION_PROFILE);
  useEffect(() => setOutcome(null), [circuit, source]);

  if (!analyses.length && !retainedDirectives.length) return null;
  const run = () => {
    try {
      setOutcome({ results: runPrecisionSourceAnalysis(circuit, { observationProfile }) });
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
      {analyses.length > 0 ? <>
        <label style={{...mono, display: 'block', marginTop: 4}}>
          {de ? 'Beobachtungsprofil' : 'Observation profile'}:{' '}
          <select data-testid="bw-source-analysis-observation-profile"
            value={observationProfile} onChange={event => setObservationProfile(event.target.value)}>
            <option value={SOURCE_OBSERVATION_PROFILE}>source-declared-v1</option>
            <option value={BOUNDED_RESEARCH_OBSERVATION_PROFILE}>bounded-research-v1 (adapted)</option>
          </select>
        </label>
        <button type="button" data-testid="bw-source-analysis-run" onClick={run}
          style={{width: '100%', minHeight: 32, marginTop: 4, padding: '5px 8px', cursor: 'pointer'}}>
          {de ? `Quellanalysen mit ${PROFILE} ausführen` : `Run source analyses at ${PROFILE}`}
        </button>
        <div style={{...mono, marginTop: 4}}>
          {de
            ? 'Opt-in; unabhängiger Lauf. Die Live-Simulation bleibt interactive-v1.'
            : `Opt-in independent run; live simulation remains ${liveProfile}.`}
        </div>
      </> : <div data-testid="bw-source-analysis-no-analysis" style={{...mono, marginTop: 4}}>
        {de ? 'Keine unterstützte Quellanalyse angefordert.' : 'No supported source analysis was requested.'}
      </div>}
      {retainedDirectives.length > 0 && <div data-testid="bw-source-analysis-retained-directives"
        style={{...mono, marginTop: 4}}>
        {retainedDirectives.length} preserved output directive{retainedDirectives.length === 1 ? '' : 's'};
        {' '}not requested or executed by this action
      </div>}
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
            <div style={mono}>observation profile: {result.requestedObservationProfile || observationProfile}</div>
            <div style={mono}>thermal: {result.thermal || 'not reported by this analysis kind'}</div>
            <div style={mono}>oracle agreement: not measured</div>
            {execution && <>
              <div style={mono}>execution profile: {execution.configured?.id || execution.requested}</div>
              <div style={mono}>integration mode: {execution.integrationMode || 'not reported'}</div>
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

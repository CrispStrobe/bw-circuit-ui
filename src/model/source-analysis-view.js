import {
  BOUNDED_RESEARCH_OBSERVATION_PROFILE, SOURCE_OBSERVATION_PROFILE,
  runCircuitSourceAnalyses,
} from './source-analysis.js';

export const SOURCE_ANALYSIS_PROFILE = 'precision-v1';
export const LIVE_SIMULATION_PROFILE = 'interactive-v1';
export { BOUNDED_RESEARCH_OBSERVATION_PROFILE, SOURCE_OBSERVATION_PROFILE };

/** Exact action invoked by the shipped GUI source-analysis button. */
export const runPrecisionSourceAnalysis = (circuit, {
  observationProfile = SOURCE_OBSERVATION_PROFILE,
} = {}) => runCircuitSourceAnalyses(circuit, {
  transientProfile: SOURCE_ANALYSIS_PROFILE, observationProfile,
});

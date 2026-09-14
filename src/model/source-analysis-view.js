import { runCircuitSourceAnalyses } from './source-analysis.js';

export const SOURCE_ANALYSIS_PROFILE = 'precision-v1';
export const LIVE_SIMULATION_PROFILE = 'interactive-v1';

/** Exact action invoked by the shipped GUI source-analysis button. */
export const runPrecisionSourceAnalysis = circuit =>
  runCircuitSourceAnalyses(circuit, { transientProfile: SOURCE_ANALYSIS_PROFILE });

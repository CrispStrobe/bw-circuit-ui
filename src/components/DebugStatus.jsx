/**
 * DebugStatus — shows Level 1 position in the circuit designer.
 *
 * Level 1 is the intersection of all targets' capabilities:
 * - Which WHEN task is at which state
 * - bw_ms and whether it is advancing
 * - Halted or running, and WHY it halted
 *
 * Branches on capabilities, never on target name.
 * Shows which time (program vs wall) when skewNs > 0.
 *
 * From DEBUG-CONTROL-MODEL §2: "The default UI is the intersection
 * of boundary D's capability matrix."
 */

import React from 'react';

const HALT_REASONS = {
  breakpoint: 'Hit breakpoint',
  step: 'Step completed',
  user: 'Paused by user',
  reset: 'Reset',
};

/**
 * @param {{ debugState, capabilities }} props
 * - debugState: { halted, skewNs, haltReason, bwMs, tasks }
 * - capabilities: from DebugTarget.capabilities()
 */
export function DebugStatus({ debugState, capabilities }) {
  if (!debugState) return null;

  const { halted, skewNs, haltReason, bwMs, tasks } = debugState;
  const skew = Number(skewNs || 0n) / 1e6;

  // Determine what controls are available on this target
  const canStep = capabilities?.step !== false;
  const canBreakpoint = capabilities?.breakpoint !== false;
  const isLiveHardware = skew > 0 || capabilities?.skewNs === 'non-zero';

  return (
    <div style={{
      background: '#16213e',
      border: `1px solid ${halted ? '#f39c12' : '#2ecc71'}`,
      borderRadius: '4px',
      padding: '6px 8px',
      fontFamily: 'monospace',
      fontSize: '10px',
      marginBottom: '6px',
    }}>
      {/* Run state */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        marginBottom: '4px',
      }}>
        <span style={{
          display: 'inline-block',
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: halted ? '#f39c12' : '#2ecc71',
        }} />
        <span style={{ color: '#ecf0f1', fontWeight: 'bold' }}>
          {halted ? 'HALTED' : 'RUNNING'}
        </span>
        {halted && haltReason && (
          <span style={{ color: '#f39c12', fontSize: '9px' }}>
            — {HALT_REASONS[haltReason] || haltReason}
          </span>
        )}
      </div>

      {/* Program time */}
      {bwMs != null && (
        <div style={{ color: '#bdc3c7', fontSize: '9px', marginBottom: '2px' }}>
          Program time: {bwMs.toFixed(1)} ms
          {!halted && <span style={{ color: '#2ecc71' }}> (advancing)</span>}
          {halted && <span style={{ color: '#f39c12' }}> (frozen)</span>}
        </div>
      )}

      {/* Skew — only on live hardware */}
      {halted && skew > 0 && (
        <div style={{ color: '#e67e22', fontSize: '9px', marginBottom: '2px' }}>
          Wall time: +{skew < 1000 ? `${skew.toFixed(0)} ms` : `${(skew / 1000).toFixed(1)} s`} ahead
          <span style={{ color: '#7f8c8d' }}> (board kept running)</span>
        </div>
      )}

      {/* Task states — Level 1 position */}
      {tasks && tasks.length > 0 && (
        <div style={{ marginTop: '4px', borderTop: '1px solid #2c3e50', paddingTop: '4px' }}>
          {tasks.map((task, i) => (
            <div key={i} style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              color: '#bdc3c7',
              fontSize: '9px',
              marginBottom: '1px',
            }}>
              <span style={{ color: '#3498db', minWidth: '50px' }}>{task.name}</span>
              <span>state {task.state}</span>
              {task.blockId && (
                <span style={{ color: '#7f8c8d' }}>→ {task.blockId}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Capability notes — what this target can't do */}
      {!canStep && (
        <div style={{ color: '#7f8c8d', fontSize: '8px', marginTop: '4px' }}>
          Single-step not available on this target
        </div>
      )}
      {!canBreakpoint && (
        <div style={{ color: '#7f8c8d', fontSize: '8px' }}>
          Code breakpoints not available on this target
        </div>
      )}
    </div>
  );
}

/**
 * DebugStatus — capabilities-driven debugger surface.
 *
 * Branches on capabilities, never on target name:
 * - steps: ['insn','block','over','out'] → shows step-over/out buttons
 *   only when the target declares them (8051 has over/out+write today;
 *   6502/Z80 gain them in a later board release)
 * - breakpoints: includes 'write' → shows watchpoint add-field
 *
 * Shows Level 1 position (which WHEN task, at which state), program
 * time, skew, and halt reason. i18n via t().
 */

import React, { useState, useCallback } from 'react';
import { t } from '../i18n/strings.js';

/**
 * @param {{ debugState, capabilities, onStep?, onStepOver?, onStepOut?, onAddWatchpoint?, lang? }} props
 */
export function DebugStatus({ debugState, capabilities, onStep, onStepOver, onStepOut, onAddWatchpoint, lang = 'en' }) {
  if (!debugState) return null;

  const { halted, skewNs, haltReason, bwMs, tasks } = debugState;
  const skew = Number(skewNs || 0n) / 1e6;

  // Capability-driven feature flags
  const steps = capabilities?.steps || [];
  const breakpoints = capabilities?.breakpoints || [];
  const canStepOver = steps.includes('over');
  const canStepOut = steps.includes('out');
  const canWatchpoint = breakpoints.includes('write');
  const canStep = steps.length > 0;
  const canBreakpoint = breakpoints.length > 0;

  // Watchpoint address input
  const [wpAddr, setWpAddr] = useState('');
  const handleAddWp = useCallback(() => {
    if (!wpAddr || !onAddWatchpoint) return;
    const addr = parseInt(wpAddr, 16);
    if (!isNaN(addr)) { onAddWatchpoint(addr); setWpAddr(''); }
  }, [wpAddr, onAddWatchpoint]);

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
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
        <span style={{
          display: 'inline-block', width: '8px', height: '8px',
          borderRadius: '50%', background: halted ? '#f39c12' : '#2ecc71',
        }} />
        <span style={{ color: '#ecf0f1', fontWeight: 'bold' }}>
          {halted ? t('halted', lang) : t('running', lang)}
        </span>
        {halted && haltReason && (
          <span style={{ color: '#f39c12', fontSize: '9px' }}>
            — {t(`halt${haltReason.charAt(0).toUpperCase()}${haltReason.slice(1)}`, lang) || haltReason}
          </span>
        )}
      </div>

      {/* Program time */}
      {bwMs != null && (
        <div style={{ color: '#bdc3c7', fontSize: '9px', marginBottom: '2px' }}>
          {t('programTime', lang)}{bwMs.toFixed(1)} ms
          {!halted && <span style={{ color: '#2ecc71' }}>{t('advancing', lang)}</span>}
          {halted && <span style={{ color: '#f39c12' }}>{t('frozen', lang)}</span>}
        </div>
      )}

      {/* Skew — only on live hardware */}
      {halted && skew > 0 && (
        <div style={{ color: '#e67e22', fontSize: '9px', marginBottom: '2px' }}>
          {t('wallTimeAhead', lang, { ms: skew < 1000 ? `${skew.toFixed(0)} ms` : `${(skew / 1000).toFixed(1)} s` })}
          <span style={{ color: '#7f8c8d' }}>{t('boardKeptRunning', lang)}</span>
        </div>
      )}

      {/* Step-over / Step-out buttons — only when target declares them */}
      {halted && (canStepOver || canStepOut) && (
        <div style={{ display: 'flex', gap: '4px', marginTop: '4px', marginBottom: '4px' }}>
          {canStepOver && (
            <button onClick={onStepOver} title={t('stepOverTitle', lang)}
              style={{ flex: 1, padding: '3px 6px', background: '#1a1a2e', border: '1px solid #3498db',
                borderRadius: '3px', color: '#3498db', cursor: 'pointer', fontSize: '9px', fontFamily: 'monospace' }}>
              ⏭ {t('stepOver', lang)}
            </button>
          )}
          {canStepOut && (
            <button onClick={onStepOut} title={t('stepOutTitle', lang)}
              style={{ flex: 1, padding: '3px 6px', background: '#1a1a2e', border: '1px solid #9b59b6',
                borderRadius: '3px', color: '#9b59b6', cursor: 'pointer', fontSize: '9px', fontFamily: 'monospace' }}>
              ↩ {t('stepOut', lang)}
            </button>
          )}
        </div>
      )}

      {/* Watchpoint add-field — only when target supports write breakpoints */}
      {canWatchpoint && onAddWatchpoint && (
        <div style={{ display: 'flex', gap: '3px', marginTop: '4px', marginBottom: '4px', alignItems: 'center' }}>
          <input type="text" value={wpAddr} onChange={e => setWpAddr(e.target.value)}
            placeholder={t('watchpointPlaceholder', lang)}
            onKeyDown={e => { if (e.key === 'Enter') handleAddWp(); }}
            style={{ width: '60px', padding: '2px 4px', background: '#0a0a1a', border: '1px solid #2c3e50',
              borderRadius: '2px', color: '#ecf0f1', fontFamily: 'monospace', fontSize: '9px' }} />
          <button onClick={handleAddWp} disabled={!wpAddr}
            style={{ padding: '2px 6px', background: '#1a1a2e', border: '1px solid #e67e22',
              borderRadius: '3px', color: '#e67e22', cursor: wpAddr ? 'pointer' : 'default',
              fontSize: '9px', fontFamily: 'monospace', opacity: wpAddr ? 1 : 0.5 }}>
            {t('addWatchpoint', lang)}
          </button>
        </div>
      )}

      {/* Task states — Level 1 position */}
      {tasks && tasks.length > 0 && (
        <div style={{ marginTop: '4px', borderTop: '1px solid #2c3e50', paddingTop: '4px' }}>
          {tasks.map((task, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: '4px',
              color: '#bdc3c7', fontSize: '9px', marginBottom: '1px',
            }}>
              <span style={{ color: '#3498db', minWidth: '50px' }}>{task.name}</span>
              <span>{t('state', lang)}{task.state}</span>
              {task.label && (
                <span style={{ color: '#7f8c8d' }}>→ {task.label}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Capability notes */}
      {!canStep && (
        <div style={{ color: '#7f8c8d', fontSize: '8px', marginTop: '4px' }}>
          {t('noSingleStep', lang)}
        </div>
      )}
      {!canBreakpoint && (
        <div style={{ color: '#7f8c8d', fontSize: '8px' }}>
          {t('noBreakpoints', lang)}
        </div>
      )}
    </div>
  );
}

/**
 * DrcPanel — renders design-rule check warnings as teaching cards.
 *
 * Each warning explains what is wrong, why it matters, and offers a fix.
 * Clicking a warning highlights the offending part. Presentation-only.
 */

import React, { useState } from 'react';
import { PartThumbnail } from './PartThumbnail.jsx';

const SEVERITY_COLORS = {
  danger: '#e74c3c',
  warning: '#f39c12',
  info: '#3498db',
};

const SEVERITY_LABELS = {
  danger: 'Problem',
  warning: 'Check',
  info: 'Note',
};

const RULE_ICONS = {
  'source-current': '⚡',
  'missing-resistor': 'R',
  'missing-flyback': '↩',
  'floating-input': '?',
  'supply-short': '⚠',
  'polarity': '±',
  'missing-pullup': 'R↑',
  'aggregate-current': '⚡',
  'supply-current': '🔌',
  'engine': '⚠',
};

export function DrcPanel({ warnings, onSelectPart, onAddFixPart }) {
  const [expanded, setExpanded] = useState(null);

  if (!warnings || warnings.length === 0) {
    return (
      <div style={{
        background: '#1a2e1a', border: '1px solid #2ecc71', borderRadius: '8px',
        padding: '8px 12px', fontFamily: 'monospace', fontSize: '10px', color: '#2ecc71',
      }}>
        No issues found
      </div>
    );
  }

  return (
    <div style={{
      background: '#1a1a2e',
      border: '1px solid #2c3e50',
      borderRadius: '8px',
      padding: '8px',
      fontFamily: 'monospace',
      fontSize: '10px',
      maxHeight: '300px',
      overflowY: 'auto',
    }}>
      <div style={{
        color: '#ecf0f1', fontSize: '11px', fontWeight: 'bold', marginBottom: '6px',
        display: 'flex', justifyContent: 'space-between',
      }}>
        <span>Circuit Check ({warnings.length})</span>
        <span style={{ color: warnings.some(w => w.severity === 'danger') ? '#e74c3c' : '#f39c12' }}>
          {warnings.filter(w => w.severity === 'danger').length} problems,{' '}
          {warnings.filter(w => w.severity === 'warning').length} checks
        </span>
      </div>

      {warnings.map((w, i) => {
        const isExpanded = expanded === i;
        const color = SEVERITY_COLORS[w.severity] || '#7f8c8d';
        return (
          <div key={i} style={{
            marginBottom: '4px',
            background: isExpanded ? '#16213e' : 'transparent',
            border: `1px solid ${isExpanded ? color : '#2c3e50'}`,
            borderRadius: '6px',
            overflow: 'hidden',
            transition: 'border-color 80ms',
          }}>
            {/* Header — click to expand */}
            <div
              onClick={() => {
                setExpanded(isExpanded ? null : i);
                if (w.partId && onSelectPart) onSelectPart(w.partId);
              }}
              style={{
                padding: '6px 8px',
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: '6px',
              }}
            >
              <span style={{
                color, fontWeight: 'bold', fontSize: '12px',
                width: '18px', textAlign: 'center',
              }}>
                {RULE_ICONS[w.rule] || '!'}
              </span>
              <span style={{ color, fontSize: '9px', flexShrink: 0 }}>
                {SEVERITY_LABELS[w.severity]}
              </span>
              <span style={{ color: '#bdc3c7', fontSize: '9px', flex: 1 }}>
                {w.partId}{w.pinId ? `.${w.pinId}` : ''}: {w.rule.replace(/-/g, ' ')}
              </span>
              <span style={{ color: '#556', fontSize: '8px' }}>{isExpanded ? '▾' : '▸'}</span>
            </div>

            {/* Expanded detail */}
            {isExpanded && (
              <div style={{ padding: '4px 8px 8px 32px' }}>
                <div style={{ color: '#bdc3c7', fontSize: '9px', lineHeight: '1.5', marginBottom: '6px' }}>
                  {w.explanation}
                </div>
                {w.fix && (
                  <div style={{
                    color: '#2ecc71', fontSize: '9px', lineHeight: '1.4',
                    padding: '4px 8px', background: '#0a1a0a', borderRadius: '4px',
                    display: 'flex', alignItems: 'center', gap: '6px',
                  }}>
                    <span style={{ flexShrink: 0 }}>Fix:</span>
                    <span style={{ flex: 1 }}>{w.fix}</span>
                    {w.fixPart && onAddFixPart && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onAddFixPart(w.fixPart); }}
                        style={{
                          background: '#16213e', border: '1px solid #2ecc71',
                          borderRadius: '4px', padding: '2px 8px', cursor: 'pointer',
                          color: '#2ecc71', fontFamily: 'monospace', fontSize: '8px',
                          display: 'flex', alignItems: 'center', gap: '4px',
                          flexShrink: 0,
                        }}
                      >
                        <PartThumbnail kind={w.fixPart} displaySize={14} />
                        Add {w.fixPart}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

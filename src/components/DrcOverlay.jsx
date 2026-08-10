/**
 * DrcOverlay — SVG layer rendering warning badges near offending parts.
 *
 * Placed inside the canvas SVG, positioned at each warned part's
 * coordinates. Shows severity icon + short rule name. Pointer-events
 * are off (the interaction machine owns all hits).
 */

import React from 'react';

const SEVERITY_FILL = {
  danger: '#e74c3c',
  warning: '#f39c12',
  info: '#3498db',
};

const RULE_SHORT = {
  'source-current': '⚡ weak',
  'missing-resistor': 'no R',
  'missing-flyback': 'no diode',
  'floating-input': 'floating',
  'supply-short': 'SHORT',
  'polarity': '± wrong',
  'missing-pullup': 'no pull-up',
  'aggregate-current': '⚡ over limit',
  'engine': '⚠',
};

/**
 * @param {{ warnings: Array, parts: Array }} props
 */
export function DrcOverlay({ warnings, parts }) {
  if (!warnings || warnings.length === 0) return null;

  // Group warnings by partId, take worst severity per part
  const byPart = new Map();
  for (const w of warnings) {
    if (!w.partId) continue;
    const existing = byPart.get(w.partId);
    if (!existing || severityRank(w.severity) > severityRank(existing.severity)) {
      byPart.set(w.partId, w);
    }
  }

  return [...byPart.entries()].map(([partId, w]) => {
    const part = parts.find(p => p.id === partId);
    if (!part) return null;

    const fill = SEVERITY_FILL[w.severity] || '#7f8c8d';
    const label = RULE_SHORT[w.rule] || w.rule;

    return (
      <g key={`drc-${partId}`} style={{ pointerEvents: 'none' }}>
        {/* Badge background */}
        <rect
          x={part.x + 15} y={part.y - 25}
          width={label.length * 6 + 10} height={14}
          rx={3} fill={fill} opacity={0.9}
        />
        {/* Badge text */}
        <text
          x={part.x + 20} y={part.y - 15}
          fill="#fff" fontSize={8} fontFamily="monospace" fontWeight="bold"
        >
          {label}
        </text>
      </g>
    );
  });
}

function severityRank(s) {
  return s === 'danger' ? 3 : s === 'warning' ? 2 : 1;
}

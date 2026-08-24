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
  'aggregate-current': '⚡ chip limit',
  'supply-current': '⚡ USB limit',
  'engine': '⚠',
  // The engine's shared-terminal repair note (a terminal listed in two
  // nets is merged deterministically and REPORTED — bw-board setNetlist).
  // Without an entry the pill printed the raw rule id "net-coalesced",
  // which reads as jargon on the canvas (owner screenshot, 2026-08-25);
  // the full message stays available as the badge tooltip below.
  'net-coalesced': '⧉ nets merged',
};

// Rules whose information is conveyed by in-body visual cues (color-coded
// pins, corner badges) rather than floating pills. The DRC rule still
// fires for programmatic consumers; only the overlay pill is suppressed.
const PILL_SUPPRESSED = new Set(['mcu-power-pins']);

/**
 * @param {{ warnings: Array, parts: Array }} props
 */
export function DrcOverlay({ warnings, parts }) {
  if (!warnings || warnings.length === 0) return null;

  // Group warnings by partId, take worst severity per part.
  // Skip rules whose info is shown via in-body visual cues.
  const byPart = new Map();
  for (const w of warnings) {
    if (!w.partId || PILL_SUPPRESSED.has(w.rule)) continue;
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

    // Offset badge to the part's top-left, not directly on the body.
    // For DIP chips on crowded benches, the center-offset overlaps
    // adjacent chip bodies. Use a consistent top-left placement that
    // scales with the body size via a simple heuristic.
    const isDip = part.seat && part._seatTerminals;
    const bx = isDip ? part.x - 60 : part.x + 15;
    const by = isDip ? part.y - 40 : part.y - 25;

    return (
      <g key={`drc-${partId}`} style={{ pointerEvents: 'none' }}>
        <title>{w.explanation || w.rule}</title>
        <rect
          x={bx} y={by}
          width={label.length * 6 + 10} height={14}
          rx={3} fill={fill} opacity={0.9}
        />
        <text
          x={bx + 5} y={by + 10}
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

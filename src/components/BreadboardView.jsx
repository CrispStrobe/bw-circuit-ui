/**
 * BreadboardView — SVG renderer for the breadboard model.
 *
 * Renders holes, strips, rails, occupied holes, jumper wires,
 * and teaching notes. All values from the BreadboardModel — nothing
 * fabricated. Strip highlighting on hover shows a learner "these
 * five holes are one conductor."
 */

import React, { useState, useCallback, useRef } from 'react';

// ── Layout constants ──────────────────────────────────────────────

const HOLE_PITCH = 14;        // px between hole centres (≈ 2.54mm scale)
const HOLE_RADIUS = 3;        // visible hole
const HIT_RADIUS = 6;         // invisible click target
const MARGIN = 30;             // px around the board edge
const GUTTER_GAP = 24;        // px gap between row e and row f
const RAIL_GAP = 18;           // px gap between rail rows and terminal rows
const RAIL_STRIPE_H = 2;      // rail color-stripe height

const TOP_ROWS = ['a', 'b', 'c', 'd', 'e'];
const BOTTOM_ROWS = ['f', 'g', 'h', 'i', 'j'];
const ALL_ROWS = [...TOP_ROWS, ...BOTTOM_ROWS];
const RAILS = ['t+', 't-', 'b+', 'b-'];

/**
 * Map row/rail to pixel Y.
 */
function rowY(row) {
  if (row === 't+') return MARGIN;
  if (row === 't-') return MARGIN + HOLE_PITCH;
  const topBase = MARGIN + HOLE_PITCH * 2 + RAIL_GAP;
  const topIdx = TOP_ROWS.indexOf(row);
  if (topIdx >= 0) return topBase + topIdx * HOLE_PITCH;
  const botBase = topBase + TOP_ROWS.length * HOLE_PITCH + GUTTER_GAP;
  const botIdx = BOTTOM_ROWS.indexOf(row);
  if (botIdx >= 0) return botBase + botIdx * HOLE_PITCH;
  if (row === 'b+') return botBase + BOTTOM_ROWS.length * HOLE_PITCH + RAIL_GAP;
  if (row === 'b-') return botBase + BOTTOM_ROWS.length * HOLE_PITCH + RAIL_GAP + HOLE_PITCH;
  return 0;
}

function colX(col) {
  return MARGIN + (col - 1) * HOLE_PITCH;
}

/**
 * Parse a hole id into { row, col } or { rail, col }.
 */
function parseHole(holeId) {
  const rail = RAILS.find(r => holeId.startsWith(r));
  if (rail) return { row: rail, col: Number(holeId.slice(rail.length)) };
  return { row: holeId[0], col: Number(holeId.slice(1)) };
}

function holePos(holeId) {
  const { row, col } = parseHole(holeId);
  return { x: colX(col), y: rowY(row) };
}

// ── Board background ──────────────────────────────────────────────

function BoardBackground({ cols }) {
  const w = MARGIN * 2 + (cols - 1) * HOLE_PITCH;
  const h = rowY('b-') + MARGIN;
  return (
    <g>
      {/* Board body */}
      <rect x={0} y={0} width={w} height={h} rx={6}
        fill="#e8dcc8" stroke="#c5b99b" strokeWidth={1.5} />
      {/* Gutter */}
      <rect x={MARGIN - 4} y={rowY('e') + HOLE_PITCH / 2 + 2}
        width={(cols - 1) * HOLE_PITCH + 8} height={GUTTER_GAP - 4}
        rx={3} fill="#d4c8a8" />
      {/* Rail color stripes */}
      {[['t+', '#e74c3c'], ['t-', '#3498db'], ['b+', '#e74c3c'], ['b-', '#3498db']].map(([rail, color]) => (
        <rect key={rail}
          x={MARGIN - 4} y={rowY(rail) - RAIL_STRIPE_H / 2 - HOLE_PITCH * 0.4}
          width={(cols - 1) * HOLE_PITCH + 8} height={RAIL_STRIPE_H}
          fill={color} opacity={0.6} />
      ))}
      {/* Rail labels */}
      <text x={MARGIN - 18} y={rowY('t+') + 4} fontSize={10} fill="#e74c3c" fontFamily="monospace" fontWeight="bold">+</text>
      <text x={MARGIN - 18} y={rowY('t-') + 4} fontSize={10} fill="#3498db" fontFamily="monospace" fontWeight="bold">−</text>
      <text x={MARGIN - 18} y={rowY('b+') + 4} fontSize={10} fill="#e74c3c" fontFamily="monospace" fontWeight="bold">+</text>
      <text x={MARGIN - 18} y={rowY('b-') + 4} fontSize={10} fill="#3498db" fontFamily="monospace" fontWeight="bold">−</text>
      {/* Row labels */}
      {ALL_ROWS.map(row => (
        <text key={row} x={MARGIN - 16} y={rowY(row) + 4} fontSize={9} fill="#7f8c8d" fontFamily="monospace">{row}</text>
      ))}
      {/* Column numbers (every 5) */}
      {Array.from({ length: cols }, (_, i) => i + 1).filter(c => c === 1 || c % 5 === 0).map(c => (
        <text key={c} x={colX(c)} y={rowY('t+') - RAIL_GAP} fontSize={8} fill="#7f8c8d"
          fontFamily="monospace" textAnchor="middle">{c}</text>
      ))}
    </g>
  );
}

// ── Holes ──────────────────────────────────────────────────────────

function Holes({ cols, model, highlightStrip, hoveredHole, onHoverHole, onClickHole, netColors }) {
  const holes = [];

  // Rail holes
  for (const rail of RAILS) {
    for (let c = 1; c <= cols; c++) {
      const id = `${rail}${c}`;
      holes.push(id);
    }
  }
  // Terminal holes
  for (const row of ALL_ROWS) {
    for (let c = 1; c <= cols; c++) {
      holes.push(`${row}${c}`);
    }
  }

  return holes.map(id => {
    const pos = holePos(id);
    const occ = model.occupantOf(id);
    const strip = model.stripOf(id);
    const isHighlight = highlightStrip === strip;
    const isHovered = hoveredHole === id;
    const netColor = netColors?.[strip];

    let fill = occ ? '#2c3e50' : '#444';
    if (isHighlight) fill = '#f39c12';
    if (netColor && !occ) fill = netColor;
    if (isHovered) fill = '#f1c40f';

    return (
      <g key={id}>
        {/* Invisible hit area */}
        <circle cx={pos.x} cy={pos.y} r={HIT_RADIUS} fill="transparent"
          style={{ cursor: 'pointer' }}
          onMouseEnter={() => onHoverHole(id)}
          onMouseLeave={() => onHoverHole(null)}
          onClick={() => onClickHole(id)} />
        {/* Visible hole */}
        <circle cx={pos.x} cy={pos.y} r={HOLE_RADIUS}
          fill={fill}
          stroke={occ ? '#f39c12' : isHighlight ? '#e67e22' : '#666'}
          strokeWidth={occ ? 1.5 : 0.5}
          style={{ pointerEvents: 'none' }} />
      </g>
    );
  });
}

// ── Jumper wires ──────────────────────────────────────────────────

function Jumpers({ model }) {
  const wires = [];
  for (const [wireId, w] of model.wires) {
    const a = holePos(w.a);
    const b = holePos(w.b);
    const color = w.color || '#333';
    wires.push(
      <g key={wireId}>
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y}
          stroke={color} strokeWidth={3} strokeLinecap="round" opacity={0.85} />
        <circle cx={a.x} cy={a.y} r={2.5} fill={color} />
        <circle cx={b.x} cy={b.y} r={2.5} fill={color} />
      </g>
    );
  }
  return <>{wires}</>;
}

// ── Main component ────────────────────────────────────────────────

export function BreadboardView({
  model,            // BreadboardModel instance
  netColors,        // Map<stripId, color> from voltage coloring
  notes,            // string[] teaching notes from deriveNets
  onClickHole,      // (holeId) => void
  onHoverHole: onHoverHoleProp, // (holeId) => void — for ghost preview
  onEscape,         // () => void
  placingPart,      // { kind, leadMap } ghost preview
  selectedHole,
}) {
  const [hoveredHole, setHoveredHole] = useState(null);
  const [highlightStrip, setHighlightStrip] = useState(null);

  const handleHoverHole = useCallback((holeId) => {
    setHoveredHole(holeId);
    if (onHoverHoleProp) onHoverHoleProp(holeId);
    if (holeId) {
      try { setHighlightStrip(model.stripOf(holeId)); } catch { setHighlightStrip(null); }
    } else {
      setHighlightStrip(null);
    }
  }, [model, onHoverHoleProp]);

  const handleClickHole = useCallback((holeId) => {
    if (onClickHole) onClickHole(holeId);
  }, [onClickHole]);

  const cols = model.cols;
  const svgW = MARGIN * 2 + (cols - 1) * HOLE_PITCH;
  const svgH = rowY('b-') + MARGIN;

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape' && onEscape) onEscape();
  }, [onEscape]);

  return (
    <div style={{ overflowX: 'auto', overflowY: 'hidden' }}
      tabIndex={0} onKeyDown={handleKeyDown}>
      <svg width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`}
        style={{ display: 'block' }}>
        <BoardBackground cols={cols} />
        <Holes cols={cols} model={model} highlightStrip={highlightStrip}
          hoveredHole={hoveredHole} onHoverHole={handleHoverHole}
          onClickHole={handleClickHole} netColors={netColors} />
        <Jumpers model={model} />

        {/* Ghost preview for placing a part */}
        {placingPart && placingPart.leadMap && Object.entries(placingPart.leadMap).map(([term, holeId]) => {
          try {
            const pos = holePos(holeId);
            const occ = model.occupantOf(holeId);
            return (
              <circle key={`ghost-${term}`} cx={pos.x} cy={pos.y} r={HOLE_RADIUS + 2}
                fill={occ ? '#e74c3c' : '#2ecc71'} opacity={0.5}
                style={{ pointerEvents: 'none' }} />
            );
          } catch { return null; }
        })}

        {/* Hovered hole info */}
        {hoveredHole && (() => {
          const pos = holePos(hoveredHole);
          const occ = model.occupantOf(hoveredHole);
          const label = occ
            ? occ.kind === 'lead' ? `${occ.partId}.${occ.terminal}` : `wire ${occ.wireId}`
            : highlightStrip || hoveredHole;
          return (
            <text x={pos.x} y={pos.y - 10} textAnchor="middle" fontSize={9}
              fill="#ecf0f1" fontFamily="monospace"
              style={{ pointerEvents: 'none' }}>
              {label}
            </text>
          );
        })()}
      </svg>

      {/* Teaching notes */}
      {notes && notes.length > 0 && (
        <div style={{
          padding: '8px 12px', marginTop: '8px',
          background: '#1a1a2e', border: '1px solid #2c3e50',
          borderRadius: '6px', fontFamily: 'monospace', fontSize: '11px',
        }}>
          {notes.map((note, i) => (
            <div key={i} style={{ color: '#f39c12', marginBottom: '4px' }}>
              {note}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

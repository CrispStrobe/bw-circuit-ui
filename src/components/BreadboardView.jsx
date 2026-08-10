/**
 * BreadboardView — rich SVG renderer for a breadboard part on the canvas.
 *
 * Uses the SAME lattice geometry as src/interaction/breadboard-snap.js
 * (bbHoleOrigin, bbRows) so what you see is what snaps. Replaces the
 * minimal BreadboardSubstrate with: strip highlighting, hole labels,
 * placed-part outlines, jumper wires, ghost preview, and teaching notes.
 *
 * Rendered inside the canvas SVG as an inert layer (pointer-events: none).
 * The interaction machine owns all hits.
 */

import React from 'react';
import { bbHoleOrigin, bbRows, BB_PITCH } from '../interaction/breadboard-snap.js';

const HOLE_RADIUS = 2.5;
const TOP_ROWS = ['a', 'b', 'c', 'd', 'e'];
const BOTTOM_ROWS = ['f', 'g', 'h', 'i', 'j'];
const RAILS = ['t+', 't-', 'b+', 'b-'];

/**
 * Compute world-space position of a hole given a breadboard part and hole id.
 * @param {object} part — the breadboard part (with x, y)
 * @param {string} holeId — e.g. "a5", "t+3"
 * @returns {{ x: number, y: number }}
 */
function holeWorldPos(part, holeId) {
  const origin = bbHoleOrigin(part);
  const rows = bbRows(part);

  const rail = RAILS.find(r => holeId.startsWith(r));
  let rowName, col;
  if (rail) {
    rowName = rail;
    col = Number(holeId.slice(rail.length));
  } else {
    rowName = holeId[0];
    col = Number(holeId.slice(1));
  }

  const rowEntry = rows.find(r => r.name === rowName);
  if (!rowEntry) return { x: 0, y: 0 };
  return { x: origin.x + (col - 1) * BB_PITCH, y: rowEntry.y };
}

// ── Board background ──────────────────────────────────────────────

function BoardBg({ part, footprint }) {
  const origin = bbHoleOrigin(part);
  const rows = bbRows(part);

  const fw = footprint?.w || 920;
  const fh = footprint?.h || 240;

  const railTopRow = rows.find(r => r.name === 't+');
  const railBotRow = rows.find(r => r.name === 'b-');

  return (
    <g>
      {/* Board body */}
      <rect x={part.x - fw / 2} y={part.y - fh / 2} width={fw} height={fh}
        rx={10} fill="#e8e4d8" stroke="#b8b4a8" strokeWidth={2} />
      {/* Rail stripes */}
      {railTopRow && (
        <>
          <line x1={origin.x - 8} y1={railTopRow.y - 8}
            x2={origin.x + (origin.cols - 1) * BB_PITCH + 8} y2={railTopRow.y - 8}
            stroke="#e74c3c" strokeWidth={2} opacity={0.6} />
          <line x1={origin.x - 8} y1={railTopRow.y + BB_PITCH + 8}
            x2={origin.x + (origin.cols - 1) * BB_PITCH + 8} y2={railTopRow.y + BB_PITCH + 8}
            stroke="#3498db" strokeWidth={2} opacity={0.6} />
        </>
      )}
      {railBotRow && (
        <>
          <line x1={origin.x - 8} y1={railBotRow.y - BB_PITCH - 8}
            x2={origin.x + (origin.cols - 1) * BB_PITCH + 8} y2={railBotRow.y - BB_PITCH - 8}
            stroke="#e74c3c" strokeWidth={2} opacity={0.6} />
          <line x1={origin.x - 8} y1={railBotRow.y + 8}
            x2={origin.x + (origin.cols - 1) * BB_PITCH + 8} y2={railBotRow.y + 8}
            stroke="#3498db" strokeWidth={2} opacity={0.6} />
        </>
      )}
      {/* Center notch */}
      {(() => {
        const eRow = rows.find(r => r.name === 'e');
        const fRow = rows.find(r => r.name === 'f');
        if (!eRow || !fRow) return null;
        const cy = (eRow.y + fRow.y) / 2;
        return <circle cx={origin.x + ((origin.cols - 1) * BB_PITCH) / 2} cy={cy} r={8} fill="#c5b99b" />;
      })()}
      {/* Row labels — left */}
      {[...TOP_ROWS, ...BOTTOM_ROWS].map(name => {
        const row = rows.find(r => r.name === name);
        if (!row) return null;
        return <text key={`l-${name}`} x={origin.x - 14} y={row.y + 4} fontSize={8}
          fill="#7f8c8d" fontFamily="monospace">{name}</text>;
      })}
      {/* Row labels — right */}
      {[...TOP_ROWS, ...BOTTOM_ROWS].map(name => {
        const row = rows.find(r => r.name === name);
        if (!row) return null;
        return <text key={`r-${name}`} x={origin.x + (origin.cols - 1) * BB_PITCH + 10} y={row.y + 4}
          fontSize={8} fill="#7f8c8d" fontFamily="monospace">{name}</text>;
      })}
      {/* Column numbers — every 5 */}
      {Array.from({ length: origin.cols }, (_, i) => i + 1).filter(c => c === 1 || c % 5 === 0).map(c => {
        const x = origin.x + (c - 1) * BB_PITCH;
        return (
          <React.Fragment key={c}>
            <text x={x} y={rows[0].y - 10} textAnchor="middle" fontSize={7}
              fill="#7f8c8d" fontFamily="monospace">{c}</text>
            <text x={x} y={rows[rows.length - 1].y + 14} textAnchor="middle" fontSize={7}
              fill="#7f8c8d" fontFamily="monospace">{c}</text>
          </React.Fragment>
        );
      })}
      {/* Rail labels — a mini board has no rails to label */}
      {origin.hasRails && <>
      <text x={origin.x - 14} y={(rows.find(r => r.name === 't+')?.y || 0) + 4}
        fontSize={9} fill="#e74c3c" fontFamily="monospace" fontWeight="bold">+</text>
      <text x={origin.x - 14} y={(rows.find(r => r.name === 't-')?.y || 0) + 4}
        fontSize={9} fill="#3498db" fontFamily="monospace" fontWeight="bold">−</text>
      <text x={origin.x - 14} y={(rows.find(r => r.name === 'b+')?.y || 0) + 4}
        fontSize={9} fill="#e74c3c" fontFamily="monospace" fontWeight="bold">+</text>
      <text x={origin.x - 14} y={(rows.find(r => r.name === 'b-')?.y || 0) + 4}
        fontSize={9} fill="#3498db" fontFamily="monospace" fontWeight="bold">−</text>
      </>}
    </g>
  );
}

// ── Holes ──────────────────────────────────────────────────────────

function HoleGrid({ part, model, highlightStrip }) {
  const origin = bbHoleOrigin(part);
  const rows = bbRows(part);
  const holes = [];

  for (const row of rows) {
    const isRail = row.name.startsWith('t') || row.name.startsWith('b');
    for (let c = 0; c < origin.cols; c++) {
      // Real boards break rail contacts at column groups of 5–6
      if (isRail && (c % 6 === 5)) continue;

      const col = c + 1;
      const holeId = `${row.name}${col}`;
      const x = origin.x + c * BB_PITCH;
      const y = row.y;

      const occ = model?.occupantOf(holeId);
      let strip = null;
      try { strip = model?.stripOf(holeId); } catch { /* invalid */ }
      const isHighlight = highlightStrip && strip === highlightStrip;

      let fill, stroke, sw;
      if (isHighlight && !occ) {
        fill = '#c8850a'; stroke = '#e67e22'; sw = 1;
      } else if (occ) {
        fill = '#b0b8c0'; stroke = '#8090a0'; sw = 1;
      } else {
        fill = '#2c3e50'; stroke = 'none'; sw = 0;
      }

      holes.push(
        <circle key={holeId} cx={x} cy={y} r={HOLE_RADIUS}
          fill={fill} stroke={stroke} strokeWidth={sw} opacity={0.75} />
      );
    }
  }
  return <>{holes}</>;
}

// ── Jumper wires ──────────────────────────────────────────────────

function Jumpers({ part, model }) {
  if (!model) return null;
  const wires = [];
  for (const [wireId, w] of model.wires) {
    const a = holeWorldPos(part, w.a);
    const b = holeWorldPos(part, w.b);
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

// ── Placed parts ──────────────────────────────────────────────────

function PlacedParts({ part: bbPart, model }) {
  if (!model) return null;
  const partLeads = new Map();
  for (const [holeId, occ] of model.occupants) {
    if (occ.kind !== 'lead') continue;
    if (!partLeads.has(occ.partId)) partLeads.set(occ.partId, []);
    partLeads.get(occ.partId).push({ holeId, terminal: occ.terminal });
  }

  return [...partLeads.entries()].map(([partId, leads]) => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const { holeId } of leads) {
      const pos = holeWorldPos(bbPart, holeId);
      minX = Math.min(minX, pos.x);
      maxX = Math.max(maxX, pos.x);
      minY = Math.min(minY, pos.y);
      maxY = Math.max(maxY, pos.y);
    }
    const pad = 5;
    return (
      <g key={`part-${partId}`}>
        <rect x={minX - pad} y={minY - pad}
          width={maxX - minX + pad * 2} height={maxY - minY + pad * 2}
          rx={3} fill="rgba(52, 152, 219, 0.15)"
          stroke="#3498db" strokeWidth={1} strokeDasharray="3 2" />
        <text x={(minX + maxX) / 2} y={minY - pad - 3} textAnchor="middle"
          fontSize={8} fill="#3498db" fontFamily="monospace">{partId}</text>
        {leads.map(({ holeId, terminal }) => {
          const pos = holeWorldPos(bbPart, holeId);
          return (
            <text key={`${partId}-${terminal}`} x={pos.x} y={pos.y + HOLE_RADIUS + 9}
              textAnchor="middle" fontSize={6} fill="#7f8c8d" fontFamily="monospace">
              {terminal}
            </text>
          );
        })}
      </g>
    );
  });
}

// ── Main component ────────────────────────────────────────────────

/**
 * Rich breadboard substrate renderer — drop-in replacement for the
 * minimal BreadboardSubstrate in BoardCanvas.jsx.
 *
 * @param {{ part: object, model?: BreadboardModel, highlightStrip?: string, footprint?: object }} props
 */
export function BreadboardView({ part, model, highlightStrip, footprint }) {
  return (
    <g style={{ pointerEvents: 'none' }}>
      <BoardBg part={part} footprint={footprint} />
      <HoleGrid part={part} model={model} highlightStrip={highlightStrip} />
      {model && <Jumpers part={part} model={model} />}
      {model && <PlacedParts part={part} model={model} />}
    </g>
  );
}

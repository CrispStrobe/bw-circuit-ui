/**
 * SchematicPanel — the auto-generated schematic, rendered BESIDE the canvas.
 *
 * Strictly read-only: standard symbols drawn from projectSchematic's pure
 * output, regenerated on every circuit change. No handlers, no second
 * interaction world — the canvas remains the one editable surface, and this
 * view exists so a learner can read the same circuit both ways at once.
 */

import React from 'react';
import { projectSchematic } from '../model/schematic-projection.js';

const STROKE = '#9ab0c4';
const LABEL = '#6b8299';

function Symbol({ s }) {
  const { kind, x, y, params } = s;
  const g = (children) => (
    <g transform={`translate(${x} ${y})`} stroke={STROKE} strokeWidth={1.6}
      fill="none" strokeLinecap="round">
      {children}
      <text x={0} y={-24} textAnchor="middle" fill={LABEL} fontSize={9}
        fontFamily="monospace" stroke="none">{s.label}</text>
    </g>
  );

  switch (kind) {
    case 'resistor':
    case 'ldr':
    case 'ntc':
      return g(<>
        <path d="M -30 0 L -18 0 L -14 -7 L -6 7 L 2 -7 L 10 7 L 14 0 L 30 0"
          />
        <text x={0} y={18} textAnchor="middle" fill={LABEL} fontSize={8}
          fontFamily="monospace" stroke="none">
          {params.ohms != null ? fmtOhms(params.ohms) : ''}
        </text>
      </>);
    case 'potentiometer':
      return g(<>
        <path d="M -30 0 L -18 0 L -14 -7 L -6 7 L 2 -7 L 10 7 L 14 0 L 30 0" />
        <path d="M 0 -16 L 0 -6 M -4 -10 L 0 -6 L 4 -10" />
      </>);
    case 'capacitor':
      return g(<>
        <path d="M -30 0 L -4 0 M 4 0 L 30 0" />
        <path d="M -4 -10 L -4 10 M 4 -10 L 4 10" />
        <text x={0} y={20} textAnchor="middle" fill={LABEL} fontSize={8}
          fontFamily="monospace" stroke="none">
          {params.farads != null ? fmtFarads(params.farads) : ''}
        </text>
      </>);
    case 'diode':
    case 'led':
      return g(<>
        <path d="M -30 0 L -8 0 M 8 0 L 30 0" />
        <path d="M -8 -8 L -8 8 L 8 0 Z" />
        <path d="M 8 -8 L 8 8" />
        {kind === 'led' && <path d="M 2 -10 L 8 -16 M 8 -16 L 5 -15 M 8 -16 L 7 -13 M 8 -8 L 14 -14 M 14 -14 L 11 -13 M 14 -14 L 13 -11" strokeWidth={1.1} />}
      </>);
    case 'vsource': {
      const isBattery = !params.wave || params.wave === 'dc';
      if (isBattery) {
        return g(<>
          <path d="M -30 0 L -6 0 M 6 0 L 30 0" />
          <path d="M -6 -12 L -6 12 M 6 -6 L 6 6" strokeWidth={2} />
          <text x={0} y={24} textAnchor="middle" fill={LABEL} fontSize={8}
            fontFamily="monospace" stroke="none">{params.volts ?? 5}V</text>
        </>);
      }
      return g(<>
        <circle cx={0} cy={0} r={12} />
        <path d="M -30 0 L -12 0 M 12 0 L 30 0" />
        <path d="M -6 0 Q -3 -6 0 0 T 6 0" strokeWidth={1.2} />
      </>);
    }
    case 'vcc':
      return g(<>
        <path d="M -30 0 L 0 0 L 0 -10 M -6 -10 L 6 -10" />
        <text x={0} y={-14} textAnchor="middle" fill={LABEL} fontSize={8}
          fontFamily="monospace" stroke="none">+5V</text>
      </>);
    case 'gnd':
      return g(<>
        <path d="M -30 0 L 0 0 L 0 8 M -9 8 L 9 8 M -6 12 L 6 12 M -3 16 L 3 16" />
      </>);
    case 'button':
    case 'switch':
      return g(<>
        <path d="M -30 0 L -10 0 M 10 0 L 30 0" />
        <circle cx={-10} cy={0} r={2} fill={STROKE} />
        <circle cx={10} cy={0} r={2} fill={STROKE} />
        <path d="M -10 0 L 8 -10" />
      </>);
    case 'buzzer':
      return g(<>
        <circle cx={0} cy={0} r={11} />
        <path d="M -30 0 L -11 0 M 11 0 L 30 0" />
        <text x={0} y={4} textAnchor="middle" fill={STROKE} fontSize={9}
          fontFamily="monospace" stroke="none">♪</text>
      </>);
    case 'npn':
    case 'pnp':
      return g(<>
        <circle cx={0} cy={0} r={13} />
        <path d="M -30 0 L -6 0 M -6 -9 L -6 9" />
        <path d="M -6 -3 L 8 -10 L 8 -18 M -6 3 L 8 10 L 8 18" />
      </>);
    case 'opamp':
      return g(<>
        <path d="M -14 -14 L -14 14 L 16 0 Z" />
        <path d="M -30 -7 L -14 -7 M -30 7 L -14 7 M 16 0 L 30 0" />
      </>);
    default:
      // Generic IC/part box with the kind name — honest, identifiable.
      return g(<>
        <rect x={-24} y={-16} width={48} height={32} rx={2} />
        <path d="M -30 0 L -24 0 M 24 0 L 30 0" strokeWidth={1.2} />
        <text x={0} y={3} textAnchor="middle" fill={STROKE} fontSize={7}
          fontFamily="monospace" stroke="none">{kind.slice(0, 9)}</text>
      </>);
  }
}

function fmtOhms(v) {
  if (v >= 1e6) return `${v / 1e6}MΩ`;
  if (v >= 1e3) return `${v / 1e3}kΩ`;
  return `${v}Ω`;
}
function fmtFarads(v) {
  if (v >= 1e-3) return `${(v * 1e3).toFixed(0)}mF`;
  if (v >= 1e-6) return `${(v * 1e6).toFixed(0)}µF`;
  if (v >= 1e-9) return `${(v * 1e9).toFixed(0)}nF`;
  return `${(v * 1e12).toFixed(0)}pF`;
}

export function SchematicPanel({ parts, nets }) {
  const proj = projectSchematic(parts, nets);
  if (proj.symbols.length === 0) {
    return (
      <div style={{ padding: 16, color: '#556', fontFamily: 'monospace', fontSize: 11 }}>
        the schematic mirrors the canvas — add parts to see it
      </div>
    );
  }
  return (
    <svg data-schematic width="100%" height="100%"
      viewBox={`0 0 ${proj.width} ${proj.height}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ background: '#111a26', borderRadius: 6, display: 'block' }}>
      {proj.wires.map(w => (
        <g key={w.netId} stroke="#3d5a75" strokeWidth={1.3} fill="none">
          <line x1={w.trunk.x} y1={w.trunk.y1} x2={w.trunk.x} y2={w.trunk.y2} />
          {w.stubs.map((seg, i) => (
            <line key={i} x1={seg[0].x} y1={seg[0].y} x2={seg[1].x} y2={seg[1].y} />
          ))}
        </g>
      ))}
      {proj.junctions.map((j, i) => (
        <circle key={i} cx={j.x} cy={j.y} r={2.4} fill="#3d5a75" />
      ))}
      {proj.symbols.map(s => <Symbol key={s.id} s={s} />)}
    </svg>
  );
}

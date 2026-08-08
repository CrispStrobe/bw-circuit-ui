/**
 * BoardCanvas — renders parts and wires on a canvas.
 *
 * Phase 1: static render only. No interaction, no engine.
 *
 * Architecture: SVG layer for wires and simple symbols (VCC, GND, MCU),
 * with wokwi web components positioned absolutely on top via CSS.
 * This avoids foreignObject issues with shadow DOM in SVG.
 */

import React from 'react';
import { WokwiLed, WokwiResistor, WokwiBuzzer, WokwiPushbutton } from '../wokwi-wrappers/index.js';

const CANVAS_W = 700;
const CANVAS_H = 450;

/**
 * Get the absolute position of a terminal on the canvas.
 */
function terminalPos(part, terminal, terminalOffsets) {
  const offsets = terminalOffsets[part.id];
  const offset = offsets?.[terminal] ?? { dx: 0, dy: 0 };
  return { x: part.x + offset.dx, y: part.y + offset.dy };
}

/**
 * Render VCC/GND/MCU as pure SVG.
 */
function SvgParts({ parts }) {
  return parts.map(part => {
    const { id, kind, x, y } = part;
    switch (kind) {
      case 'vcc':
        return (
          <g key={id} transform={`translate(${x}, ${y})`}>
            <line x1={0} y1={20} x2={0} y2={5} stroke="#e74c3c" strokeWidth={2} />
            <line x1={-15} y1={5} x2={15} y2={5} stroke="#e74c3c" strokeWidth={2} />
            <text x={0} y={-2} textAnchor="middle" fill="#e74c3c" fontSize={12}
              fontFamily="monospace" fontWeight="bold">VCC</text>
          </g>
        );
      case 'gnd':
        return (
          <g key={id} transform={`translate(${x}, ${y})`}>
            <line x1={0} y1={-10} x2={0} y2={0} stroke="#3498db" strokeWidth={2} />
            <line x1={-15} y1={0} x2={15} y2={0} stroke="#3498db" strokeWidth={2} />
            <line x1={-10} y1={5} x2={10} y2={5} stroke="#3498db" strokeWidth={2} />
            <line x1={-5} y1={10} x2={5} y2={10} stroke="#3498db" strokeWidth={2} />
            <text x={0} y={24} textAnchor="middle" fill="#3498db" fontSize={12}
              fontFamily="monospace" fontWeight="bold">GND</text>
          </g>
        );
      case 'mcu':
        return (
          <g key={id} transform={`translate(${x}, ${y})`}>
            <rect x={-50} y={-60} width={120} height={140} rx={6}
              fill="#2c3e50" stroke="#7f8c8d" strokeWidth={2} />
            <text x={10} y={-40} textAnchor="middle" fill="#ecf0f1" fontSize={14}
              fontFamily="monospace" fontWeight="bold">STC12</text>
            {part.terminals.map((pin, i) => (
              <g key={pin}>
                <circle cx={-50} cy={-40 + i * 30} r={3} fill="#f39c12" />
                <text x={-42} y={-36 + i * 30} fill="#f39c12" fontSize={10}
                  fontFamily="monospace">{pin}</text>
              </g>
            ))}
          </g>
        );
      default:
        return null;
    }
  });
}

/**
 * Render wires as SVG paths.
 */
function Wires({ nets, parts, terminalOffsets: offsets }) {
  return nets.map(net => {
    const { terminals } = net;
    if (terminals.length < 2) return null;

    const points = terminals.map(({ part: partId, terminal }) => {
      const part = parts.find(p => p.id === partId);
      if (!part) return null;
      return terminalPos(part, terminal, offsets);
    }).filter(Boolean);

    if (points.length < 2) return null;

    return (
      <g key={net.id}>
        {/* L-shaped wire segments */}
        {points.slice(1).map((b, i) => {
          const a = points[i];
          const mid = { x: b.x, y: a.y };
          return (
            <path
              key={`${net.id}-${i}`}
              d={`M ${a.x} ${a.y} L ${mid.x} ${mid.y} L ${b.x} ${b.y}`}
              stroke="#2ecc71"
              strokeWidth={2}
              fill="none"
              strokeLinejoin="round"
            />
          );
        })}
        {/* Terminal dots */}
        {points.map((p, i) => (
          <circle key={`d${i}`} cx={p.x} cy={p.y} r={3} fill="#2ecc71" />
        ))}
        {/* Net label */}
        <text x={points[0].x + 8} y={points[0].y - 8}
          fill="#7f8c8d" fontSize={9} fontFamily="monospace">{net.id}</text>
      </g>
    );
  });
}

/**
 * Wokwi elements positioned absolutely over the SVG.
 */
function WokwiParts({ parts }) {
  return parts.map(part => {
    const { id, kind, params, x, y } = part;
    const style = {
      position: 'absolute',
      pointerEvents: 'none',
    };

    switch (kind) {
      case 'resistor':
        return (
          <div key={id} style={{ ...style, left: x - 40, top: y - 12 }}>
            <WokwiResistor value={String(params.ohms)} />
            <div style={{
              textAlign: 'center', color: '#aaa', fontSize: 10,
              fontFamily: 'monospace', marginTop: 2,
            }}>{id} ({params.ohms}Ω)</div>
          </div>
        );
      case 'led':
        return (
          <div key={id} style={{ ...style, left: x - 15, top: y - 20 }}>
            <WokwiLed
              color={params.color || 'red'}
              brightness={0}
              value={false}
            />
            <div style={{
              textAlign: 'center', color: '#aaa', fontSize: 10,
              fontFamily: 'monospace', marginTop: 2,
            }}>{id}</div>
          </div>
        );
      case 'buzzer':
        return (
          <div key={id} style={{ ...style, left: x - 20, top: y - 20 }}>
            <WokwiBuzzer hasSignal={false} />
            <div style={{
              textAlign: 'center', color: '#aaa', fontSize: 10,
              fontFamily: 'monospace', marginTop: 2,
            }}>{id}</div>
          </div>
        );
      case 'button':
        return (
          <div key={id} style={{ ...style, left: x - 15, top: y - 15 }}>
            <WokwiPushbutton color={params.color || 'red'} />
            <div style={{
              textAlign: 'center', color: '#aaa', fontSize: 10,
              fontFamily: 'monospace', marginTop: 2,
            }}>{id}</div>
          </div>
        );
      default:
        return null;
    }
  });
}

/**
 * The main board canvas.
 */
export function BoardCanvas({ parts, nets, terminalOffsets: offsets }) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '20px',
    }}>
      <h2 style={{
        color: '#ecf0f1',
        fontFamily: 'monospace',
        marginBottom: '10px',
      }}>
        Active-Low LED Circuit
      </h2>
      <p style={{
        color: '#7f8c8d',
        fontFamily: 'monospace',
        fontSize: '12px',
        marginBottom: '20px',
        textAlign: 'center',
      }}>
        VCC → 1kΩ → LED (Vf=2V) → P1.0<br/>
        Phase 1: static layout — no simulation values on screen
      </p>

      {/* Canvas container — SVG + absolutely positioned wokwi elements */}
      <div style={{
        position: 'relative',
        width: CANVAS_W,
        height: CANVAS_H,
        background: '#16213e',
        borderRadius: '8px',
        border: '1px solid #2c3e50',
        overflow: 'hidden',
      }}>
        {/* SVG layer: wires, VCC/GND symbols, MCU */}
        <svg
          width={CANVAS_W}
          height={CANVAS_H}
          viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
          style={{ position: 'absolute', top: 0, left: 0 }}
        >
          <defs>
            <pattern id="grid" width={20} height={20} patternUnits="userSpaceOnUse">
              <circle cx={10} cy={10} r={0.5} fill="#2c3e50" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
          <Wires nets={nets} parts={parts} terminalOffsets={offsets} />
          <SvgParts parts={parts} />
        </svg>

        {/* Wokwi element layer on top */}
        <WokwiParts parts={parts} />
      </div>
    </div>
  );
}

/**
 * BoardCanvas — renders parts and wires on a canvas with interaction.
 *
 * Phase 3: interactive. Drag parts, click terminals to wire, delete,
 * turn potentiometer, press buttons.
 *
 * LED brightness and node voltages come from the engine — never fabricated.
 *
 * Architecture: SVG layer for wires and simple symbols,
 * wokwi web components positioned absolutely on top via CSS.
 */

import React, { useState, useCallback } from 'react';
import { WokwiLed, WokwiResistor, WokwiBuzzer, WokwiPushbutton, WokwiPotentiometer, WokwiSevenSegment, WokwiLcd1602, WokwiIrReceiver } from '../wokwi-wrappers/index.js';
import { partLabel } from '../model/format.js';
import { routeWire, partBBoxes } from '../model/wire-router.js';
import { findSnapTarget } from '../model/snap.js';
import { PartTooltip } from './PartTooltip.jsx';
import { ContextMenu } from './ContextMenu.jsx';
import { InlineEditor } from './InlineEditor.jsx';

// Default canvas dimensions — used for viewBox and layout calculations.
// The actual rendered size fills the container via CSS.
const CANVAS_W = 700;
const CANVAS_H = 500;

/**
 * Rotate a {dx, dy} offset by deg degrees (0, 90, 180, 270).
 */
function rotateOffset(dx, dy, deg) {
  switch (((deg % 360) + 360) % 360) {
    case 0: return { dx, dy };
    case 90: return { dx: -dy, dy: dx };
    case 180: return { dx: -dx, dy: -dy };
    case 270: return { dx: dy, dy: -dx };
    default: return { dx, dy };
  }
}

/**
 * Terminal offset defaults per part kind, rotated by part.rotation.
 * Returns {terminalName: {dx, dy}} relative to part anchor.
 */
function terminalOffsetsForPart(part) {
  const rot = part.rotation || 0;
  const r = (dx, dy) => rotateOffset(dx, dy, rot);

  switch (part.kind) {
    case 'vcc': return { vcc: r(0, 20) };
    case 'gnd': return { gnd: r(0, -10) };
    case 'resistor': return { a: r(-30, 0), b: r(30, 0) };
    case 'led': return { anode: r(-20, 0), cathode: r(20, 0) };
    case 'potentiometer': return { a: r(-25, 20), wiper: r(0, -20), b: r(25, 20) };
    case 'button': return { a: r(-15, 0), b: r(15, 0) };
    case 'buzzer': return { a: r(-15, 0), b: r(15, 0) };
    case 'capacitor': return { a: r(-15, 0), b: r(15, 0) };
    case 'seven_segment': return { a: r(-30, 30), b: r(30, 30) }; // pins at bottom
    case 'char_lcd': return { rs: r(-50, 25), e: r(-30, 25), d4: r(-10, 25), d5: r(10, 25), d6: r(30, 25), d7: r(50, 25) };
    case 'ir_receiver': return { out: r(0, 15), vcc: r(-10, -10), gnd: r(10, -10) };
    case 'shift_register': return { data: r(-20, -15), clock: r(0, -15), latch: r(20, -15) };
    case 'led_matrix': return { a: r(-20, 0), b: r(20, 0) };
    case 'temp_sensor': return { dq: r(0, 15), vcc: r(-10, -10), gnd: r(10, -10) };
    case 'eeprom': return { sda: r(-10, 15), scl: r(10, 15) };
    case 'mcu': {
      const offsets = {};
      const pinCount = part.terminals.length;
      const chipH = Math.max(60, pinCount * 30 + 20);
      const chipY = -chipH / 2;
      part.terminals.forEach((pin, i) => {
        offsets[pin] = r(-60, chipY + 30 + i * 30);
      });
      return offsets;
    }
    default: return { a: r(-15, 0), b: r(15, 0) };
  }
}

function terminalPos(part, terminal) {
  const offsets = terminalOffsetsForPart(part);
  const offset = offsets[terminal] ?? { dx: 0, dy: 0 };
  return { x: part.x + offset.dx, y: part.y + offset.dy };
}

function fmtV(v) {
  if (v == null || typeof v !== 'number') return '';
  if (Math.abs(v) < 0.01) return '0V';
  if (Math.abs(v - Math.round(v)) < 0.01) return Math.round(v) + 'V';
  if (Math.abs(v) < 1) return (v * 1000).toFixed(0) + 'mV';
  return v.toFixed(1) + 'V';
}

// ── SVG part rendering ───────────────────────────────────────────

function SvgParts({ parts, selectedParts, onSelectPart, onPartBodyClick }) {
  return parts.map(part => {
    const { id, kind, x, y } = part;
    const isSelected = selectedParts?.has(id);
    const selStroke = isSelected ? '#f1c40f' : undefined;

    const handleClick = (e) => {
      e.stopPropagation();
      onSelectPart(id, e.shiftKey);
      if (onPartBodyClick) onPartBodyClick(id);
    };

    switch (kind) {
      case 'vcc':
        return (
          <g key={id} transform={`translate(${x}, ${y})`}
            onClick={handleClick}
            style={{ cursor: 'pointer' }}>
            {/* Larger hit area */}
            <rect x={-20} y={-8} width={40} height={32} fill="transparent" />
            <line x1={0} y1={20} x2={0} y2={5} stroke={selStroke || '#e74c3c'} strokeWidth={2} />
            <line x1={-15} y1={5} x2={15} y2={5} stroke={selStroke || '#e74c3c'} strokeWidth={2} />
            <text x={0} y={-2} textAnchor="middle" fill={selStroke || '#e74c3c'} fontSize={12}
              fontFamily="monospace" fontWeight="bold">VCC</text>
          </g>
        );
      case 'gnd':
        return (
          <g key={id} transform={`translate(${x}, ${y})`}
            onClick={handleClick}
            style={{ cursor: 'pointer' }}>
            <rect x={-20} y={-14} width={40} height={42} fill="transparent" />
            <line x1={0} y1={-10} x2={0} y2={0} stroke={selStroke || '#3498db'} strokeWidth={2} />
            <line x1={-15} y1={0} x2={15} y2={0} stroke={selStroke || '#3498db'} strokeWidth={2} />
            <line x1={-10} y1={5} x2={10} y2={5} stroke={selStroke || '#3498db'} strokeWidth={2} />
            <line x1={-5} y1={10} x2={5} y2={10} stroke={selStroke || '#3498db'} strokeWidth={2} />
            <text x={0} y={24} textAnchor="middle" fill={selStroke || '#3498db'} fontSize={12}
              fontFamily="monospace" fontWeight="bold">GND</text>
          </g>
        );
      case 'mcu': {
        // Scale chip body to match pin count
        const pinCount = part.terminals.length;
        const chipH = Math.max(60, pinCount * 30 + 20);
        const chipY = -chipH / 2;
        return (
          <g key={id} transform={`translate(${x}, ${y})`}
            onClick={handleClick}
            style={{ cursor: 'pointer' }}>
            <rect x={-50} y={chipY} width={120} height={chipH} rx={6}
              fill="#2c3e50" stroke={selStroke || '#7f8c8d'} strokeWidth={isSelected ? 3 : 2} />
            <text x={10} y={chipY + 18} textAnchor="middle" fill="#ecf0f1" fontSize={14}
              fontFamily="monospace" fontWeight="bold">STC12</text>
            {part.terminals.map((pin, i) => {
              const pinY = chipY + 30 + i * 30;
              return (
                <g key={pin}>
                  <circle cx={-50} cy={pinY} r={3} fill="#f39c12" />
                  <text x={-42} y={pinY + 4} fill="#f39c12" fontSize={10}
                    fontFamily="monospace">{pin}</text>
                </g>
              );
            })}
          </g>
        );
      }
      default:
        return null;
    }
  });
}

// ── Terminal dots (clickable for wiring) ─────────────────────────

function TerminalDots({ parts, wires, wiringFrom, onTerminalClick, onTerminalDown, onTerminalUp, placingProbe }) {
  const connected = new Set();
  for (const w of wires) {
    connected.add(`${w.from.part}:${w.from.terminal}`);
    connected.add(`${w.to.part}:${w.to.terminal}`);
  }

  // When wiring, all potential targets should glow
  const isWiring = !!wiringFrom;

  const dots = [];
  for (const part of parts) {
    for (const term of part.terminals) {
      const pos = terminalPos(part, term);
      const isSource = wiringFrom &&
        wiringFrom.part === part.id && wiringFrom.terminal === term;
      const isConnected = connected.has(`${part.id}:${term}`);
      const isSamePart = wiringFrom && wiringFrom.part === part.id;
      const isValidTarget = isWiring && !isSource && !isSamePart;

      // Sizes: large enough to tap on a tablet (minimum 10px radius)
      let fill, stroke, r, opacity;
      if (isSource) {
        fill = '#f1c40f'; stroke = '#f39c12'; r = 12; opacity = 1;
      } else if (isValidTarget) {
        // Pulsing green glow — "you can connect here"
        fill = '#2ecc71'; stroke = '#27ae60'; r = 10; opacity = 0.8;
      } else if (placingProbe) {
        fill = '#9b59b6'; stroke = '#8e44ad'; r = 10; opacity = 0.7;
      } else if (isConnected) {
        fill = '#2ecc71'; stroke = '#27ae60'; r = 6; opacity = 0.8;
      } else {
        // Unconnected — hollow, clearly visible
        fill = '#16213e'; stroke = '#e74c3c'; r = 8; opacity = 1;
      }

      dots.push(
        <g key={`${part.id}:${term}`}>
          {/* Invisible large hit area for touch */}
          <circle
            cx={pos.x} cy={pos.y} r={Math.max(r, 16)}
            fill="transparent"
            style={{ cursor: 'crosshair' }}
            onMouseDown={(e) => onTerminalDown(part.id, term, e)}
            onMouseUp={() => onTerminalUp(part.id, term)}
            onClick={(e) => { e.stopPropagation(); onTerminalClick(part.id, term); }}
            onTouchStart={(e) => { e.stopPropagation(); onTerminalDown(part.id, term); }}
            onTouchEnd={(e) => { e.stopPropagation(); onTerminalUp(part.id, term); }}
          />
          {/* Visible dot */}
          <circle
            cx={pos.x} cy={pos.y} r={r}
            fill={fill} stroke={stroke} strokeWidth={2}
            opacity={opacity}
            style={{ pointerEvents: 'none' }}
          />
          {/* Pulsing ring for valid wiring targets */}
          {isValidTarget && (
            <circle
              cx={pos.x} cy={pos.y} r={14}
              fill="none" stroke="#2ecc71" strokeWidth={1.5}
              opacity={0.5} strokeDasharray="3,3"
              style={{ pointerEvents: 'none' }}
            />
          )}
          {/* Terminal label — always show for unconnected, on hover otherwise */}
          {!isConnected && (
            <text
              x={pos.x} y={pos.y - r - 4}
              textAnchor="middle" fill="#bdc3c7" fontSize={9}
              fontFamily="monospace" style={{ pointerEvents: 'none' }}
            >{term}</text>
          )}
        </g>
      );
    }
  }
  return <>{dots}</>;
}

// ── Wires ────────────────────────────────────────────────────────

function Wires({ wires, parts, selectedWire, onSelectWire, hoveredNet, onHoverNet, nodeVoltages }) {
  // Group wires by net to find all terminals in each net
  const netTerminals = new Map();
  for (const w of wires) {
    if (!netTerminals.has(w.netId)) netTerminals.set(w.netId, new Set());
    const set = netTerminals.get(w.netId);
    set.add(`${w.from.part}:${w.from.terminal}`);
    set.add(`${w.to.part}:${w.to.terminal}`);
  }

  return wires.map(wire => {
    const fromPart = parts.find(p => p.id === wire.from.part);
    const toPart = parts.find(p => p.id === wire.to.part);
    if (!fromPart || !toPart) return null;

    const a = terminalPos(fromPart, wire.from.terminal);
    const b = terminalPos(toPart, wire.to.terminal);
    const obstacles = partBBoxes(parts, wire.from.part, wire.to.part);
    const pathD = routeWire(a, b, obstacles);
    const isSelected = selectedWire === wire.id;
    const isHovered = hoveredNet && hoveredNet === wire.netId;

    // Wire color by voltage: red at VCC, blue near GND, green/yellow in between
    let voltageColor = '#2ecc71'; // default green
    const v = nodeVoltages?.[wire.netId];
    if (v != null && typeof v === 'number') {
      const vcc = 5.0;
      const ratio = Math.max(0, Math.min(1, v / vcc));
      if (ratio > 0.8) voltageColor = '#e74c3c';      // red: near VCC
      else if (ratio > 0.4) voltageColor = '#f39c12';  // orange: mid-high
      else if (ratio > 0.15) voltageColor = '#2ecc71'; // green: mid
      else voltageColor = '#3498db';                    // blue: near GND
    }

    const wireColor = isSelected ? '#f1c40f' : isHovered ? '#9b59b6' : voltageColor;
    const wireWidth = isSelected ? 3 : isHovered ? 2.5 : 2;

    return (
      <g key={wire.id}>
        {/* Invisible wider hit area */}
        <path
          d={pathD}
          stroke="transparent"
          strokeWidth={10}
          fill="none"
          style={{ cursor: 'pointer' }}
          onClick={(e) => { e.stopPropagation(); onSelectWire(wire.id); }}
          onMouseEnter={() => onHoverNet(wire.netId)}
          onMouseLeave={() => onHoverNet(null)}
        />
        <path
          d={pathD}
          stroke={wireColor}
          strokeWidth={wireWidth}
          fill="none"
          strokeLinejoin="round"
        />
        {/* Animated current-flow dots along the wire */}
        {nodeVoltages && (() => {
          const v = nodeVoltages?.[wire.netId];
          if (v == null) return null;
          const len = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
          if (len < 30) return null;

          // Speed proportional to how far from mid-rail (more current = faster)
          const vcc = 5.0;
          const fromMid = Math.abs(v - vcc / 2) / (vcc / 2);
          if (fromMid < 0.05) return null; // negligible current
          const dur = Math.max(0.5, 3 - fromMid * 2.5); // seconds per cycle

          return (
            <circle r={2.5} fill={wireColor} opacity={0.8}
              style={{ pointerEvents: 'none' }}>
              <animateMotion
                dur={`${dur}s`}
                repeatCount="indefinite"
                path={pathD}
              />
            </circle>
          );
        })()}
      </g>
    );
  });
}

// ── Voltage labels ───────────────────────────────────────────────

function VoltageLabels({ wires, parts, nodeVoltages }) {
  if (!nodeVoltages) return null;
  const shownNets = new Set();
  return wires.map(wire => {
    if (shownNets.has(wire.netId)) return null;
    shownNets.add(wire.netId);
    const v = nodeVoltages[wire.netId];
    if (v == null) return null;

    const fromPart = parts.find(p => p.id === wire.from.part);
    const toPart = parts.find(p => p.id === wire.to.part);
    if (!fromPart || !toPart) return null;
    const a = terminalPos(fromPart, wire.from.terminal);
    const b = terminalPos(toPart, wire.to.terminal);

    // Offset label perpendicular to the wire so it doesn't overlap
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    // Perpendicular offset (to the right of the wire direction)
    const offsetX = (-dy / len) * 14;
    const offsetY = (dx / len) * 14;

    return (
      <g key={`v-${wire.netId}`}>
        <rect
          x={mx + offsetX - 18} y={my + offsetY - 8}
          width={36} height={14} rx={3}
          fill="#0a0a1a" fillOpacity={0.8}
          style={{ pointerEvents: 'none' }}
        />
        <text
          x={mx + offsetX} y={my + offsetY + 3}
          textAnchor="middle" fill="#f1c40f" fontSize={10}
          fontFamily="monospace" fontWeight="bold"
          style={{ pointerEvents: 'none' }}>
          {fmtV(v)}
        </text>
      </g>
    );
  });
}

// ── Wokwi element layer ─────────────────────────────────────────

function WokwiParts({ parts, ledBrightness, buzzerTones, onSelectPart, selectedParts, onControlChange, onButtonDown, onButtonUp, onDragStart, onHoverPart, onPartBodyClick, onDoubleClick }) {
  return parts.map(part => {
    const { id, kind, params, x, y } = part;
    const rot = part.rotation || 0;
    const isSelected = selectedParts?.has(id);
    const baseStyle = {
      position: 'absolute',
      outline: isSelected ? '2px solid #f1c40f' : 'none',
      borderRadius: '4px',
      transform: rot ? `rotate(${rot}deg)` : undefined,
      transformOrigin: 'center',
    };

    const dragProps = (extraOnDown) => ({
      onMouseDown: (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        if (extraOnDown) extraOnDown(e);
        else onDragStart(id);
      },
      onMouseEnter: (e) => onHoverPart(id, e.clientX, e.clientY),
      onMouseLeave: () => onHoverPart(null, 0, 0),
      onDoubleClick: (e) => { e.stopPropagation(); if (onDoubleClick) onDoubleClick(id, e.clientX, e.clientY); },
    });

    switch (kind) {
      case 'resistor':
        return (
          <div key={id}
            style={{ ...baseStyle, left: x - 30, top: y - 6, cursor: 'move' }}
            onClick={(e) => { e.stopPropagation(); onSelectPart(id, e.shiftKey); if (onPartBodyClick) onPartBodyClick(id); }}
            {...dragProps()}>
            <WokwiResistor value={String(params.ohms)} />
            <div style={{ textAlign: 'center', color: '#667', fontSize: 9, fontFamily: 'monospace', opacity: 0.8 }}>
              {partLabel(part)}
            </div>
          </div>
        );
      case 'led': {
        const b = ledBrightness?.(id) ?? 0;
        const isOn = b > 0.01;
        return (
          <div key={id}
            style={{ ...baseStyle, left: x - 20, top: y - 25, cursor: 'move' }}
            onClick={(e) => { e.stopPropagation(); onSelectPart(id, e.shiftKey); if (onPartBodyClick) onPartBodyClick(id); }}
            {...dragProps()}>
            <WokwiLed color={params.color || 'red'} brightness={b} value={isOn} />
            <div style={{
              textAlign: 'center',
              color: isOn ? '#2ecc71' : '#556',
              fontSize: 9, fontFamily: 'monospace', opacity: 0.8,
            }}>
              {isOn ? `${(b * 100).toFixed(0)}%` : ''}
            </div>
          </div>
        );
      }
      case 'potentiometer':
        return (
          <div key={id}
            style={{ ...baseStyle, left: x - 30, top: y - 30, cursor: 'move', pointerEvents: 'auto' }}
            onClick={(e) => { e.stopPropagation(); onSelectPart(id, e.shiftKey); if (onPartBodyClick) onPartBodyClick(id); }}>
            <WokwiPotentiometer
              min={0} max={1} step={0.01} value={0.5}
              onInput={(e) => {
                const val = parseFloat(e.target.value);
                if (!isNaN(val)) onControlChange(id, val);
              }}
            />
            <div style={{ textAlign: 'center', color: '#667', fontSize: 9, fontFamily: 'monospace', opacity: 0.8 }}>
              {partLabel(part)}
            </div>
          </div>
        );
      case 'buzzer': {
        const tone = buzzerTones?.(id);
        return (
          <div key={id}
            style={{ ...baseStyle, left: x - 20, top: y - 20, cursor: 'move' }}
            onClick={(e) => { e.stopPropagation(); onSelectPart(id, e.shiftKey); if (onPartBodyClick) onPartBodyClick(id); }}
            {...dragProps()}>
            <WokwiBuzzer hasSignal={tone?.on ?? false} />
            <div style={{
              textAlign: 'center',
              color: tone?.on ? '#2ecc71' : '#556',
              fontSize: 9, fontFamily: 'monospace', opacity: 0.8,
            }}>
              {tone?.on ? `${tone.hz.toFixed(0)} Hz` : ''}
            </div>
          </div>
        );
      }
      case 'button':
        return (
          <div key={id}
            style={{ ...baseStyle, left: x - 18, top: y - 18, cursor: 'move', pointerEvents: 'auto' }}
            onClick={(e) => { e.stopPropagation(); onSelectPart(id, e.shiftKey); if (onPartBodyClick) onPartBodyClick(id); }}
            onMouseDown={(e) => { e.stopPropagation(); onButtonDown(id); }}
            onMouseUp={() => onButtonUp(id)}
            onMouseLeave={() => onButtonUp(id)}>
            <WokwiPushbutton color={params.color || 'red'} />
            <div style={{ textAlign: 'center', color: '#667', fontSize: 9, fontFamily: 'monospace', opacity: 0.8 }}>
              {partLabel(part)}
            </div>
          </div>
        );
      case 'capacitor':
        return (
          <div key={id}
            style={{ ...baseStyle, left: x - 15, top: y - 15, cursor: 'move' }}
            onClick={(e) => { e.stopPropagation(); onSelectPart(id, e.shiftKey); if (onPartBodyClick) onPartBodyClick(id); }}
            {...dragProps()}>
            <svg width={30} height={30} viewBox="0 0 30 30">
              <line x1={5} y1={15} x2={12} y2={15} stroke="#7f8c8d" strokeWidth={2} />
              <line x1={12} y1={5} x2={12} y2={25} stroke="#ecf0f1" strokeWidth={2} />
              <line x1={18} y1={5} x2={18} y2={25} stroke="#ecf0f1" strokeWidth={2} />
              <line x1={18} y1={15} x2={25} y2={15} stroke="#7f8c8d" strokeWidth={2} />
            </svg>
            <div style={{ textAlign: 'center', color: '#667', fontSize: 9, fontFamily: 'monospace', opacity: 0.8 }}>
              {partLabel(part)}
            </div>
          </div>
        );
      case 'seven_segment':
        return (
          <div key={id}
            style={{ ...baseStyle, left: x - 30, top: y - 35, cursor: 'move' }}
            onClick={(e) => { e.stopPropagation(); onSelectPart(id, e.shiftKey); if (onPartBodyClick) onPartBodyClick(id); }}
            {...dragProps()}>
            <WokwiSevenSegment digits={1} values={[1,1,1,1,1,1,0,0]} color="#e74c3c" pins="none" />
            <div style={{ textAlign: 'center', color: '#667', fontSize: 9, fontFamily: 'monospace', opacity: 0.8 }}>
              {partLabel(part)}
            </div>
          </div>
        );
      case 'char_lcd':
        return (
          <div key={id}
            style={{ ...baseStyle, left: x - 60, top: y - 25, cursor: 'move' }}
            onClick={(e) => { e.stopPropagation(); onSelectPart(id, e.shiftKey); if (onPartBodyClick) onPartBodyClick(id); }}
            {...dragProps()}>
            <WokwiLcd1602 text="Hello World!" pins="none" screenOnly={true} />
            <div style={{ textAlign: 'center', color: '#667', fontSize: 9, fontFamily: 'monospace', opacity: 0.8 }}>
              {partLabel(part)}
            </div>
          </div>
        );
      case 'ir_receiver':
        return (
          <div key={id}
            style={{ ...baseStyle, left: x - 15, top: y - 15, cursor: 'move' }}
            onClick={(e) => { e.stopPropagation(); onSelectPart(id, e.shiftKey); if (onPartBodyClick) onPartBodyClick(id); }}
            {...dragProps()}>
            <WokwiIrReceiver />
            <div style={{ textAlign: 'center', color: '#667', fontSize: 9, fontFamily: 'monospace', opacity: 0.8 }}>
              {partLabel(part)}
            </div>
          </div>
        );
      case 'shift_register':
      case 'led_matrix':
      case 'temp_sensor':
      case 'eeprom':
        // Generic IC rendering for parts without wokwi elements
        return (
          <div key={id}
            style={{ ...baseStyle, left: x - 25, top: y - 15, cursor: 'move' }}
            onClick={(e) => { e.stopPropagation(); onSelectPart(id, e.shiftKey); if (onPartBodyClick) onPartBodyClick(id); }}
            {...dragProps()}>
            <svg width={50} height={30} viewBox="0 0 50 30">
              <rect x={2} y={2} width={46} height={26} rx={3} fill="#2c3e50" stroke="#7f8c8d" strokeWidth={1} />
              <text x={25} y={18} textAnchor="middle" fill="#ecf0f1" fontSize={8} fontFamily="monospace">
                {kind === 'shift_register' ? '595' : kind === 'led_matrix' ? '8×8' : kind === 'temp_sensor' ? '18B20' : 'IC'}
              </text>
            </svg>
            <div style={{ textAlign: 'center', color: '#667', fontSize: 9, fontFamily: 'monospace', opacity: 0.8 }}>
              {partLabel(part)}
            </div>
          </div>
        );
      default:
        return null;
    }
  });
}

// ── Wiring preview line ──────────────────────────────────────────

function WiringPreview({ wiringFrom, mousePos, parts }) {
  if (!wiringFrom || !mousePos) return null;
  const part = parts.find(p => p.id === wiringFrom.part);
  if (!part) return null;
  const from = terminalPos(part, wiringFrom.terminal);
  return (
    <line
      x1={from.x} y1={from.y}
      x2={mousePos.x} y2={mousePos.y}
      stroke="#f39c12" strokeWidth={2} strokeDasharray="5,3"
    />
  );
}

// ── Main BoardCanvas ─────────────────────────────────────────────

export function BoardCanvas({
  parts, wires, ledBrightness, buzzerTones, nodeVoltages,
  onAddWire, onRemoveWire, onRemovePart, onMovePart,
  onSelectPart, selectedPart, selectedParts,
  onSelectWire, selectedWire,
  onControlChange, onButtonDown, onButtonUp,
  statusText,
  placingProbe, onTerminalClickForProbe,
  onDuplicatePart, onRotatePart, onDropPart, onUpdateParams, warnings, annotations,
  circuit,
}) {
  const [wiringFrom, setWiringFrom] = useState(null);
  const [mousePos, setMousePos] = useState(null);
  const [dragging, setDragging] = useState(null);
  const [hoveredNet, setHoveredNet] = useState(null);
  const [hoveredPart, setHoveredPart] = useState(null);
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });
  const [snapTarget, setSnapTarget] = useState(null);
  const [contextMenu, setContextMenu] = useState(null); // { x, y, type }
  const [rubberBand, setRubberBand] = useState(null);
  const [inlineEdit, setInlineEdit] = useState(null); // { partId, x, y }

  // Zoom/pan state: viewBox = (panX, panY, CANVAS_W/zoom, CANVAS_H/zoom)
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  // Auto-fit: when parts change significantly, zoom to fit all content
  const prevPartCount = React.useRef(0);
  React.useEffect(() => {
    if (parts.length === 0 || parts.length === prevPartCount.current) return;
    prevPartCount.current = parts.length;
    // Calculate bounding box of all parts
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of parts) {
      minX = Math.min(minX, p.x - 80);
      maxX = Math.max(maxX, p.x + 80);
      minY = Math.min(minY, p.y - 60);
      maxY = Math.max(maxY, p.y + 60);
    }
    const contentW = maxX - minX + 40;
    const contentH = maxY - minY + 40;
    if (contentW <= 0 || contentH <= 0) return;
    const fitZoom = Math.min(1.5, Math.min(CANVAS_W / contentW, CANVAS_H / contentH));
    setZoom(Math.max(0.3, Math.min(1, fitZoom)));
    setPan({ x: minX - 20, y: minY - 20 });
  }, [parts.length]);
  const [panning, setPanning] = useState(false);
  const panStart = React.useRef(null);

  // Convert screen coordinates to canvas coordinates (accounting for zoom/pan)
  const screenToCanvas = useCallback((clientX, clientY, container) => {
    const rect = container.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    return {
      x: sx / zoom + pan.x,
      y: sy / zoom + pan.y,
    };
  }, [zoom, pan]);

  // Terminal interaction: drag to wire (TinkerCAD-style).
  // Mousedown/touchstart on a terminal starts wiring.
  // Mouseup/touchend on another terminal completes it.
  // Also supports click-click for accessibility.
  const handleTerminalDown = useCallback((partId, terminal, e) => {
    if (e) e.stopPropagation();

    // If placing a multimeter probe, route to probe handler
    if (placingProbe && onTerminalClickForProbe) {
      onTerminalClickForProbe(partId, terminal);
      return;
    }

    setWiringFrom({ part: partId, terminal });
  }, [placingProbe, onTerminalClickForProbe]);

  const handleTerminalUp = useCallback((partId, terminal) => {
    if (!wiringFrom) return;
    if (wiringFrom.part !== partId || wiringFrom.terminal !== terminal) {
      onAddWire(wiringFrom.part, wiringFrom.terminal, partId, terminal);
    }
    setWiringFrom(null);
    setMousePos(null);
  }, [wiringFrom, onAddWire]);

  const handleTerminalClick = useCallback((partId, terminal) => {
    // Click-click fallback: if already wiring, complete; if not, start
    if (placingProbe && onTerminalClickForProbe) {
      onTerminalClickForProbe(partId, terminal);
      return;
    }
    if (wiringFrom) {
      if (wiringFrom.part !== partId || wiringFrom.terminal !== terminal) {
        onAddWire(wiringFrom.part, wiringFrom.terminal, partId, terminal);
      }
      setWiringFrom(null);
      setMousePos(null);
    }
  }, [wiringFrom, onAddWire, placingProbe, onTerminalClickForProbe]);

  // Click on a part body: auto-wire from/to its first unconnected terminal.
  // VCC/GND have one terminal — clicking them means "wire from here."
  // If already wiring, clicking a part completes the wire.
  const handlePartBodyClick = useCallback((partId) => {
    const part = parts.find(p => p.id === partId);
    if (!part) return;

    // Build connected set
    const connected = new Set();
    for (const w of wires) {
      connected.add(`${w.from.part}:${w.from.terminal}`);
      connected.add(`${w.to.part}:${w.to.terminal}`);
    }

    // Find first unconnected terminal on this part
    const freeTerm = part.terminals.find(t => !connected.has(`${partId}:${t}`));
    if (!freeTerm) return; // all terminals connected

    if (wiringFrom) {
      // Complete wiring to this part's free terminal
      if (wiringFrom.part !== partId) {
        onAddWire(wiringFrom.part, wiringFrom.terminal, partId, freeTerm);
      }
      setWiringFrom(null);
      setMousePos(null);
    } else {
      // Start wiring from this part's free terminal
      setWiringFrom({ part: partId, terminal: freeTerm });
    }
  }, [parts, wires, wiringFrom, onAddWire]);

  const handleSvgClick = useCallback(() => {
    // Cancel wiring if clicking empty space
    if (wiringFrom) {
      setWiringFrom(null);
      setMousePos(null);
    }
    // Complete rubber-band select
    if (rubberBand) {
      const x1 = Math.min(rubberBand.startX, rubberBand.endX);
      const y1 = Math.min(rubberBand.startY, rubberBand.endY);
      const x2 = Math.max(rubberBand.startX, rubberBand.endX);
      const y2 = Math.max(rubberBand.startY, rubberBand.endY);
      if (x2 - x1 > 10 && y2 - y1 > 10) {
        // Select all parts inside the rectangle
        const inside = parts.filter(p => p.x >= x1 && p.x <= x2 && p.y >= y1 && p.y <= y2);
        if (inside.length > 0) {
          for (const p of inside) onSelectPart(p.id, true);
        }
      }
      setRubberBand(null);
      return;
    }
    onSelectPart(null);
    onSelectWire(null);
  }, [wiringFrom, onSelectPart, onSelectWire, rubberBand, parts]);

  const handleSvgMouseDown = useCallback((e) => {
    // Start rubber-band select on empty space (left button, not on a part)
    if (e.button === 0 && !wiringFrom && !dragging) {
      const container = e.currentTarget;
      const { x, y } = screenToCanvas(e.clientX, e.clientY, container);
      setRubberBand({ startX: x, startY: y, endX: x, endY: y });
    }
  }, [wiringFrom, dragging, screenToCanvas]);

  const handleSvgMouseMove = useCallback((e) => {
    const container = e.currentTarget;
    const { x, y } = screenToCanvas(e.clientX, e.clientY, container);

    // Update rubber-band
    if (rubberBand && !dragging && !wiringFrom && !panning) {
      setRubberBand(rb => rb ? { ...rb, endX: x, endY: y } : null);
    }

    if (panning && panStart.current) {
      const rect = container.getBoundingClientRect();
      const dx = (e.clientX - panStart.current.x) / zoom;
      const dy = (e.clientY - panStart.current.y) / zoom;
      setPan(p => ({ x: p.x - dx, y: p.y - dy }));
      panStart.current = { x: e.clientX, y: e.clientY };
      return;
    }

    if (wiringFrom) {
      setMousePos({ x, y });
    }
    if (dragging) {
      onMovePart(dragging, x, y);
      // Check for snap-to-connector
      const draggedPart = parts.find(p => p.id === dragging);
      if (draggedPart) {
        const snap = findSnapTarget({ ...draggedPart, x, y }, parts, wires);
        setSnapTarget(snap.autoWire ? snap : null);
      }
    }
  }, [wiringFrom, dragging, onMovePart, screenToCanvas, panning, zoom, parts, wires]);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const container = e.currentTarget;
    const { x: cx, y: cy } = screenToCanvas(e.clientX, e.clientY, container);

    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.3, Math.min(3, zoom * factor));

    // Zoom toward cursor position
    setPan(p => ({
      x: cx - (cx - p.x) * (zoom / newZoom),
      y: cy - (cy - p.y) * (zoom / newZoom),
    }));
    setZoom(newZoom);
  }, [zoom, screenToCanvas]);

  const handleMouseDown = useCallback((e) => {
    // Middle button or space+left → start panning
    if (e.button === 1) {
      e.preventDefault();
      setPanning(true);
      panStart.current = { x: e.clientX, y: e.clientY };
    }
  }, []);

  const handleDragStart = useCallback((e, partId) => {
    if (e.button === 0) {
      setDragging(partId);
    }
  }, []);

  const handleDragEnd = useCallback(() => {
    if (dragging && snapTarget) {
      // Snap to connector position
      onMovePart(dragging, snapTarget.snapX, snapTarget.snapY);
      // Auto-wire the snapped terminals
      if (snapTarget.autoWire) {
        const { fromPart, fromTerm, toPart, toTerm } = snapTarget.autoWire;
        onAddWire(fromPart, fromTerm, toPart, toTerm);
      }
    }
    setDragging(null);
    setSnapTarget(null);
    setPanning(false);
    panStart.current = null;
  }, [dragging, snapTarget, onMovePart, onAddWire]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedWire) {
        onRemoveWire(selectedWire);
        onSelectWire(null);
      } else if (selectedParts && selectedParts.size > 0) {
        for (const id of selectedParts) onRemovePart(id);
        onSelectPart(null);
      }
    }
    if (e.key === 'Escape') {
      setWiringFrom(null);
      setMousePos(null);
      onSelectPart(null);
      onSelectWire(null);
    }
    if (e.key === '0') {
      setZoom(1);
      setPan({ x: 0, y: 0 });
    }
    // F → fit all parts in view
    if (e.key === 'f' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      if (parts.length === 0) return;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of parts) {
        minX = Math.min(minX, p.x - 80); maxX = Math.max(maxX, p.x + 80);
        minY = Math.min(minY, p.y - 60); maxY = Math.max(maxY, p.y + 60);
      }
      const cw = maxX - minX + 40, ch = maxY - minY + 40;
      const fz = Math.max(0.3, Math.min(1, Math.min(CANVAS_W / cw, CANVAS_H / ch)));
      setZoom(fz);
      setPan({ x: minX - 20, y: minY - 20 });
    }
    // Arrow keys nudge all selected parts by grid size
    if (selectedParts && selectedParts.size > 0 && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      const step = e.shiftKey ? 5 : 20;
      const dx = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
      const dy = e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0;
      for (const id of selectedParts) {
        const part = parts.find(p => p.id === id);
        if (part) onMovePart(id, part.x + dx, part.y + dy);
      }
    }
  }, [selectedParts, selectedWire, onRemovePart, onRemoveWire, onSelectPart, onSelectWire, parts, onMovePart]);

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {/* Status/action bar */}
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '6px',
        fontFamily: 'monospace', fontSize: '10px',
        marginBottom: '4px', minHeight: '26px',
        padding: '2px 4px',
        background: '#16213e', borderRadius: '4px',
      }}>
        {/* Mode indicator */}
        <span style={{
          padding: '2px 8px', borderRadius: '3px',
          background: wiringFrom ? '#f39c12' : '#2c3e50',
          color: wiringFrom ? '#000' : '#7f8c8d',
          fontWeight: 'bold', fontSize: '9px',
        }}>
          {wiringFrom ? 'WIRING' : 'SELECT'}
        </span>

        {/* Status text */}
        <span style={{ color: '#7f8c8d', flex: 1, fontSize: '10px' }}>
          {wiringFrom
            ? `${wiringFrom.part}:${wiringFrom.terminal} → ?`
            : statusText || (selectedParts?.size > 0 ? `${selectedParts.size} selected` : '')}
        </span>

        {/* Selection actions */}
        {((selectedParts && selectedParts.size > 0) || selectedWire) && (
          <>
            {selectedPart && onRotatePart && (
              <button onClick={() => onRotatePart(selectedPart)}
                title="Rotate (R)"
                style={{ padding: '2px 6px', background: '#2c3e50', border: '1px solid #3498db', borderRadius: '3px', color: '#3498db', fontSize: '9px', cursor: 'pointer' }}>
                R
              </button>
            )}
            {selectedPart && onDuplicatePart && (
              <button onClick={() => onDuplicatePart(selectedPart)}
                title="Duplicate (Ctrl+D)"
                style={{ padding: '2px 6px', background: '#2c3e50', border: '1px solid #2ecc71', borderRadius: '3px', color: '#2ecc71', fontSize: '9px', cursor: 'pointer' }}>
                D
              </button>
            )}
            <button onClick={() => {
              if (selectedWire) { onRemoveWire(selectedWire); onSelectWire(null); }
              else if (selectedParts && selectedParts.size > 0) { for (const id of selectedParts) onRemovePart(id); onSelectPart(null); }
            }}
              title="Delete (Del)"
              style={{ padding: '2px 6px', background: '#2c3e50', border: '1px solid #e74c3c', borderRadius: '3px', color: '#e74c3c', fontSize: '9px', cursor: 'pointer' }}>
              Del
            </button>
          </>
        )}

        {/* Zoom info */}
        {zoom !== 1 && (
          <span style={{ color: '#556', fontSize: '9px' }}>{(zoom * 100).toFixed(0)}%</span>
        )}
      </div>

      {/* Zoom indicator removed — now in toolbar */}
      {false && (
        <div></div>
      )}

      {/* Canvas — fills container, minimum 700×500 */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          minWidth: CANVAS_W,
          height: '100%',
          minHeight: CANVAS_H,
          background: '#16213e',
          borderRadius: '8px',
          border: '1px solid #2c3e50',
          overflow: 'hidden',
        }}
        onMouseMove={handleSvgMouseMove}
        onMouseUp={handleDragEnd}
        onMouseDown={handleMouseDown}
        onWheel={handleWheel}
        onTouchMove={(e) => {
          if (e.touches.length === 1 && (dragging || wiringFrom)) {
            e.preventDefault();
            const touch = e.touches[0];
            // Reuse the mouse handler with a synthetic event shape
            handleSvgMouseMove({
              clientX: touch.clientX,
              clientY: touch.clientY,
              currentTarget: e.currentTarget,
            });
          }
        }}
        onTouchEnd={(e) => {
          if (dragging) handleDragEnd();
          if (wiringFrom && e.changedTouches.length === 1) {
            // If touch ended not on a terminal, cancel wiring
            setWiringFrom(null);
            setMousePos(null);
          }
        }}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
        onDrop={(e) => {
          e.preventDefault();
          const data = e.dataTransfer.getData('application/circuit-part');
          if (data && onDropPart) {
            const { kind, params } = JSON.parse(data);
            const { x, y } = screenToCanvas(e.clientX, e.clientY, e.currentTarget);
            onDropPart(kind, params, x, y);
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          // Right-click context menu
          if ((selectedParts && selectedParts.size > 0) || selectedWire) {
            setContextMenu({
              x: e.clientX,
              y: e.clientY,
              type: selectedPart ? 'part' : 'wire',
            });
          }
        }}
      >
        <svg
          width="100%"
          height="100%"
          viewBox={`${pan.x} ${pan.y} ${CANVAS_W / zoom} ${CANVAS_H / zoom}`}
          preserveAspectRatio="xMidYMid meet"
          style={{ position: 'absolute', top: 0, left: 0 }}
          onClick={handleSvgClick}
          onMouseDown={handleSvgMouseDown}
        >
          <defs>
            <pattern id="grid" width={20} height={20} patternUnits="userSpaceOnUse">
              <circle cx={10} cy={10} r={1} fill="#243447" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />

          {/* Voltage color legend (only when simulating and there are voltages) */}
          {nodeVoltages && Object.keys(nodeVoltages).length > 0 && (
            <g transform={`translate(${CANVAS_W - 100}, 10)`}>
              <rect x={-4} y={-2} width={95} height={58} rx={4}
                fill="#0a0a1a" fillOpacity={0.7} />
              <circle cx={6} cy={8} r={4} fill="#e74c3c" />
              <text x={16} y={12} fill="#7f8c8d" fontSize={8} fontFamily="monospace">~5V (VCC)</text>
              <circle cx={6} cy={22} r={4} fill="#f39c12" />
              <text x={16} y={26} fill="#7f8c8d" fontSize={8} fontFamily="monospace">2-4V</text>
              <circle cx={6} cy={36} r={4} fill="#2ecc71" />
              <text x={16} y={40} fill="#7f8c8d" fontSize={8} fontFamily="monospace">0.5-2V</text>
              <circle cx={6} cy={50} r={4} fill="#3498db" />
              <text x={16} y={54} fill="#7f8c8d" fontSize={8} fontFamily="monospace">~0V (GND)</text>
            </g>
          )}

          {/* Empty canvas hint */}
          {parts.length === 0 && (
            <g>
              <text x={CANVAS_W / 2} y={CANVAS_H / 2 - 30} textAnchor="middle"
                fill="#3498db" fontSize={16} fontFamily="monospace" fontWeight="bold">
                Circuit Designer
              </text>
              <text x={CANVAS_W / 2} y={CANVAS_H / 2} textAnchor="middle"
                fill="#7f8c8d" fontSize={12} fontFamily="monospace">
                Add parts from the palette, or load a preset
              </text>
              <text x={CANVAS_W / 2} y={CANVAS_H / 2 + 20} textAnchor="middle"
                fill="#7f8c8d" fontSize={11} fontFamily="monospace">
                Try "Correct (active-low)" vs "Naive (active-high)"
              </text>
              <text x={CANVAS_W / 2} y={CANVAS_H / 2 + 40} textAnchor="middle"
                fill="#7f8c8d" fontSize={11} fontFamily="monospace">
                to see why wiring matters
              </text>
            </g>
          )}

          <Wires wires={wires} parts={parts}
            selectedWire={selectedWire} onSelectWire={onSelectWire}
            hoveredNet={hoveredNet} onHoverNet={setHoveredNet}
            nodeVoltages={nodeVoltages} />
          <VoltageLabels wires={wires} parts={parts} nodeVoltages={nodeVoltages} />

          {/* Teaching annotations from inference */}
          {annotations && annotations.map((ann, i) => (
            <text key={`ann-${i}`}
              x={ann.x} y={ann.y}
              textAnchor="middle" fill={ann.color || '#7f8c8d'}
              fontSize={11} fontFamily="monospace" fontWeight="bold"
              style={{ pointerEvents: 'none' }}>
              {ann.text}
            </text>
          ))}
          <WiringPreview wiringFrom={wiringFrom} mousePos={mousePos} parts={parts} />

          {/* Rubber-band selection rectangle */}
          {rubberBand && (
            <rect
              x={Math.min(rubberBand.startX, rubberBand.endX)}
              y={Math.min(rubberBand.startY, rubberBand.endY)}
              width={Math.abs(rubberBand.endX - rubberBand.startX)}
              height={Math.abs(rubberBand.endY - rubberBand.startY)}
              fill="#3498db" fillOpacity={0.1}
              stroke="#3498db" strokeWidth={1} strokeDasharray="4,2"
              style={{ pointerEvents: 'none' }}
            />
          )}

          {/* Snap-to-connector indicator */}
          {snapTarget && snapTarget.autoWire && (() => {
            const targetPart = parts.find(p => p.id === snapTarget.autoWire.toPart);
            if (!targetPart) return null;
            const pos = terminalPos(targetPart, snapTarget.autoWire.toTerm);
            return (
              <g>
                <circle cx={pos.x} cy={pos.y} r={10} fill="none"
                  stroke="#f1c40f" strokeWidth={2} strokeDasharray="3,2" />
                <circle cx={pos.x} cy={pos.y} r={4} fill="#f1c40f" opacity={0.6} />
              </g>
            );
          })()}
          {/* Lead stubs: short wire segments from terminal dots to part body */}
          {parts.map(part => {
            if (['vcc', 'gnd', 'mcu'].includes(part.kind)) return null;
            return part.terminals.map(term => {
              const pos = terminalPos(part, term);
              const dx = part.x - pos.x;
              const dy = part.y - pos.y;
              const len = Math.sqrt(dx * dx + dy * dy);
              if (len < 5) return null;
              // Draw a short stub from the terminal toward the part center
              const stubLen = Math.min(8, len * 0.4);
              const nx = dx / len;
              const ny = dy / len;
              return (
                <line key={`stub-${part.id}-${term}`}
                  x1={pos.x} y1={pos.y}
                  x2={pos.x + nx * stubLen} y2={pos.y + ny * stubLen}
                  stroke="#7f8c8d" strokeWidth={2}
                  style={{ pointerEvents: 'none' }}
                />
              );
            });
          })}
          <SvgParts parts={parts} selectedParts={selectedParts} onSelectPart={onSelectPart} onPartBodyClick={handlePartBodyClick} />

          {/* Inline warning indicators on parts */}
          {warnings && warnings.map((w, i) => {
            if (!w.partId) return null;
            const part = parts.find(p => p.id === w.partId);
            if (!part) return null;
            const color = w.severity === 'danger' ? '#e74c3c' : '#f39c12';
            return (
              <g key={`warn-${i}`}>
                <circle cx={part.x + 20} cy={part.y - 25} r={8}
                  fill={color} fillOpacity={0.9} />
                <text x={part.x + 20} y={part.y - 21} textAnchor="middle"
                  fill="#fff" fontSize={12} fontWeight="bold"
                  fontFamily="monospace" style={{ pointerEvents: 'none' }}>!</text>
                <title>{w.message}</title>
              </g>
            );
          })}
          <TerminalDots parts={parts} wires={wires} wiringFrom={wiringFrom}
                onTerminalClick={handleTerminalClick}
                onTerminalDown={handleTerminalDown}
                onTerminalUp={handleTerminalUp}
                placingProbe={placingProbe} />
        </svg>

        {/* Wokwi element layer — transformed to match SVG viewBox */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          transformOrigin: '0 0',
          transform: `scale(${zoom}) translate(${-pan.x}px, ${-pan.y}px)`,
          pointerEvents: 'none', // let SVG handle clicks; children re-enable
        }}>
          <WokwiParts
            parts={parts}
            ledBrightness={ledBrightness}
            buzzerTones={buzzerTones}
            onSelectPart={onSelectPart}
            selectedParts={selectedParts}
            onControlChange={onControlChange}
            onButtonDown={onButtonDown}
            onButtonUp={onButtonUp}
            onDragStart={(partId) => setDragging(partId)}
            onHoverPart={(partId, cx, cy) => {
              setHoveredPart(partId);
              if (partId) setHoverPos({ x: cx, y: cy });
            }}
            onPartBodyClick={handlePartBodyClick}
            onDoubleClick={(partId, cx, cy) => setInlineEdit({ partId, x: cx, y: cy })}
          />
        </div>

        {/* Inline property editor (double-click) */}
        {inlineEdit && onUpdateParams && (
          <InlineEditor
            part={parts.find(p => p.id === inlineEdit.partId)}
            x={inlineEdit.x}
            y={inlineEdit.y}
            onUpdateParams={onUpdateParams}
            onClose={() => setInlineEdit(null)}
          />
        )}

        {/* Part tooltip */}
        {hoveredPart && (
          <PartTooltip
            part={parts.find(p => p.id === hoveredPart)}
            circuit={circuit}
            visible={true}
            x={hoverPos.x}
            y={hoverPos.y}
          />
        )}

        {/* Context menu (right-click / long-press) */}
        <ContextMenu
          x={contextMenu?.x}
          y={contextMenu?.y}
          type={contextMenu?.type}
          onClose={() => setContextMenu(null)}
          onDelete={() => {
            if (selectedWire) { onRemoveWire(selectedWire); onSelectWire(null); }
            else if (selectedPart) { onRemovePart(selectedPart); onSelectPart(null); }
            setContextMenu(null);
          }}
          onDuplicate={() => {
            if (selectedPart && onDuplicatePart) onDuplicatePart(selectedPart);
            setContextMenu(null);
          }}
          onRotate={() => {
            if (selectedPart && onRotatePart) onRotatePart(selectedPart);
            setContextMenu(null);
          }}
        />
      </div>
    </div>
  );
}

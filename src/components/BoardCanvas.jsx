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
import { WokwiLed, WokwiResistor, WokwiBuzzer, WokwiPushbutton, WokwiPotentiometer } from '../wokwi-wrappers/index.js';
import { partLabel } from '../model/format.js';
import { routeWire, partBBoxes } from '../model/wire-router.js';

const CANVAS_W = 700;
const CANVAS_H = 500;

/**
 * Terminal offset defaults per part kind.
 * Returns {terminalName: {dx, dy}} relative to part anchor.
 */
function terminalOffsetsForPart(part) {
  switch (part.kind) {
    case 'vcc': return { vcc: { dx: 0, dy: 20 } };
    case 'gnd': return { gnd: { dx: 0, dy: -10 } };
    case 'resistor': return { a: { dx: -35, dy: 0 }, b: { dx: 35, dy: 0 } };
    case 'led': return { anode: { dx: -10, dy: 0 }, cathode: { dx: 10, dy: 0 } };
    case 'potentiometer': return { a: { dx: -25, dy: 20 }, wiper: { dx: 0, dy: -20 }, b: { dx: 25, dy: 20 } };
    case 'button': return { a: { dx: -15, dy: 0 }, b: { dx: 15, dy: 0 } };
    case 'buzzer': return { a: { dx: -15, dy: 0 }, b: { dx: 15, dy: 0 } };
    case 'capacitor': return { a: { dx: -15, dy: 0 }, b: { dx: 15, dy: 0 } };
    case 'mcu': {
      const offsets = {};
      part.terminals.forEach((pin, i) => {
        offsets[pin] = { dx: -60, dy: -40 + i * 30 };
      });
      return offsets;
    }
    default: return { a: { dx: -15, dy: 0 }, b: { dx: 15, dy: 0 } };
  }
}

function terminalPos(part, terminal) {
  const offsets = terminalOffsetsForPart(part);
  const offset = offsets[terminal] ?? { dx: 0, dy: 0 };
  return { x: part.x + offset.dx, y: part.y + offset.dy };
}

function fmtV(v) {
  if (v == null || typeof v !== 'number') return '';
  return v.toFixed(3) + ' V';
}

// ── SVG part rendering ───────────────────────────────────────────

function SvgParts({ parts, selectedPart, onSelectPart }) {
  return parts.map(part => {
    const { id, kind, x, y } = part;
    const isSelected = selectedPart === id;
    const selStroke = isSelected ? '#f1c40f' : undefined;

    switch (kind) {
      case 'vcc':
        return (
          <g key={id} transform={`translate(${x}, ${y})`}
            onClick={(e) => { e.stopPropagation(); onSelectPart(id); }}
            style={{ cursor: 'pointer' }}>
            <line x1={0} y1={20} x2={0} y2={5} stroke={selStroke || '#e74c3c'} strokeWidth={2} />
            <line x1={-15} y1={5} x2={15} y2={5} stroke={selStroke || '#e74c3c'} strokeWidth={2} />
            <text x={0} y={-2} textAnchor="middle" fill={selStroke || '#e74c3c'} fontSize={12}
              fontFamily="monospace" fontWeight="bold">VCC</text>
          </g>
        );
      case 'gnd':
        return (
          <g key={id} transform={`translate(${x}, ${y})`}
            onClick={(e) => { e.stopPropagation(); onSelectPart(id); }}
            style={{ cursor: 'pointer' }}>
            <line x1={0} y1={-10} x2={0} y2={0} stroke={selStroke || '#3498db'} strokeWidth={2} />
            <line x1={-15} y1={0} x2={15} y2={0} stroke={selStroke || '#3498db'} strokeWidth={2} />
            <line x1={-10} y1={5} x2={10} y2={5} stroke={selStroke || '#3498db'} strokeWidth={2} />
            <line x1={-5} y1={10} x2={5} y2={10} stroke={selStroke || '#3498db'} strokeWidth={2} />
            <text x={0} y={24} textAnchor="middle" fill={selStroke || '#3498db'} fontSize={12}
              fontFamily="monospace" fontWeight="bold">GND</text>
          </g>
        );
      case 'mcu':
        return (
          <g key={id} transform={`translate(${x}, ${y})`}
            onClick={(e) => { e.stopPropagation(); onSelectPart(id); }}
            style={{ cursor: 'pointer' }}>
            <rect x={-50} y={-60} width={120} height={140} rx={6}
              fill="#2c3e50" stroke={selStroke || '#7f8c8d'} strokeWidth={isSelected ? 3 : 2} />
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

// ── Terminal dots (clickable for wiring) ─────────────────────────

function TerminalDots({ parts, wiringFrom, onTerminalClick, placingProbe }) {
  const dots = [];
  for (const part of parts) {
    for (const term of part.terminals) {
      const pos = terminalPos(part, term);
      const isWiringSource = wiringFrom &&
        wiringFrom.part === part.id && wiringFrom.terminal === term;
      dots.push(
        <circle
          key={`${part.id}:${term}`}
          cx={pos.x}
          cy={pos.y}
          r={isWiringSource ? 6 : placingProbe ? 5 : 4}
          fill={isWiringSource ? '#f1c40f' : placingProbe ? '#9b59b6' : '#e74c3c'}
          stroke={isWiringSource ? '#f39c12' : placingProbe ? '#8e44ad' : '#c0392b'}
          strokeWidth={1}
          style={{ cursor: 'pointer' }}
          onClick={(e) => {
            e.stopPropagation();
            onTerminalClick(part.id, term);
          }}
        />
      );
    }
  }
  return <>{dots}</>;
}

// ── Wires ────────────────────────────────────────────────────────

function Wires({ wires, parts, selectedWire, onSelectWire, hoveredNet, onHoverNet }) {
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
    const wireColor = isSelected ? '#f1c40f' : isHovered ? '#3498db' : '#2ecc71';
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
      </g>
    );
  });
}

// ── Voltage labels ───────────────────────────────────────────────

function VoltageLabels({ wires, parts, nodeVoltages }) {
  if (!nodeVoltages) return null;
  // Show voltage per net, positioned near first wire midpoint
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

    return (
      <text key={`v-${wire.netId}`}
        x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 10}
        textAnchor="middle" fill="#f1c40f" fontSize={10}
        fontFamily="monospace" fontWeight="bold">
        {fmtV(v)}
      </text>
    );
  });
}

// ── Wokwi element layer ─────────────────────────────────────────

function WokwiParts({ parts, ledBrightness, buzzerTones, onSelectPart, selectedPart, onControlChange, onButtonDown, onButtonUp, onDragStart }) {
  return parts.map(part => {
    const { id, kind, params, x, y } = part;
    const isSelected = selectedPart === id;
    const baseStyle = {
      position: 'absolute',
      outline: isSelected ? '2px solid #f1c40f' : 'none',
      borderRadius: '4px',
    };

    const dragProps = (extraOnDown) => ({
      onMouseDown: (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        if (extraOnDown) extraOnDown(e);
        else onDragStart(id);
      },
    });

    switch (kind) {
      case 'resistor':
        return (
          <div key={id}
            style={{ ...baseStyle, left: x - 40, top: y - 12, cursor: 'move' }}
            onClick={(e) => { e.stopPropagation(); onSelectPart(id); }}
            {...dragProps()}>
            <WokwiResistor value={String(params.ohms)} />
            <div style={{ textAlign: 'center', color: '#aaa', fontSize: 10, fontFamily: 'monospace' }}>
              {partLabel(part)}
            </div>
          </div>
        );
      case 'led': {
        const b = ledBrightness?.(id) ?? 0;
        const isOn = b > 0.01;
        return (
          <div key={id}
            style={{ ...baseStyle, left: x - 15, top: y - 20, cursor: 'move' }}
            onClick={(e) => { e.stopPropagation(); onSelectPart(id); }}
            {...dragProps()}>
            <WokwiLed color={params.color || 'red'} brightness={b} value={isOn} />
            <div style={{
              textAlign: 'center',
              color: isOn ? '#2ecc71' : '#aaa',
              fontSize: 10, fontFamily: 'monospace',
            }}>
              {isOn ? `${(b * 100).toFixed(1)}%` : 'off'}
            </div>
          </div>
        );
      }
      case 'potentiometer':
        return (
          <div key={id}
            style={{ ...baseStyle, left: x - 30, top: y - 30, cursor: 'move', pointerEvents: 'auto' }}
            onClick={(e) => { e.stopPropagation(); onSelectPart(id); }}>
            <WokwiPotentiometer
              min={0} max={1} step={0.01} value={0.5}
              onInput={(e) => {
                const val = parseFloat(e.target.value);
                if (!isNaN(val)) onControlChange(id, val);
              }}
            />
            <div style={{ textAlign: 'center', color: '#aaa', fontSize: 10, fontFamily: 'monospace' }}>
              pot
            </div>
          </div>
        );
      case 'buzzer': {
        const tone = buzzerTones?.(id);
        return (
          <div key={id}
            style={{ ...baseStyle, left: x - 20, top: y - 20, cursor: 'move' }}
            onClick={(e) => { e.stopPropagation(); onSelectPart(id); }}
            {...dragProps()}>
            <WokwiBuzzer hasSignal={tone?.on ?? false} />
            <div style={{
              textAlign: 'center',
              color: tone?.on ? '#2ecc71' : '#aaa',
              fontSize: 10, fontFamily: 'monospace',
            }}>
              {tone?.on ? `${tone.hz.toFixed(0)} Hz` : 'off'}
            </div>
          </div>
        );
      }
      case 'button':
        return (
          <div key={id}
            style={{ ...baseStyle, left: x - 18, top: y - 18, cursor: 'move', pointerEvents: 'auto' }}
            onClick={(e) => { e.stopPropagation(); onSelectPart(id); }}
            onMouseDown={(e) => { e.stopPropagation(); onButtonDown(id); }}
            onMouseUp={() => onButtonUp(id)}
            onMouseLeave={() => onButtonUp(id)}>
            <WokwiPushbutton color={params.color || 'red'} />
            <div style={{ textAlign: 'center', color: '#aaa', fontSize: 10, fontFamily: 'monospace' }}>
              btn
            </div>
          </div>
        );
      case 'capacitor':
        return (
          <div key={id}
            style={{ ...baseStyle, left: x - 15, top: y - 15, cursor: 'move' }}
            onClick={(e) => { e.stopPropagation(); onSelectPart(id); }}
            {...dragProps()}>
            <svg width={30} height={30} viewBox="0 0 30 30">
              <line x1={5} y1={15} x2={12} y2={15} stroke="#7f8c8d" strokeWidth={2} />
              <line x1={12} y1={5} x2={12} y2={25} stroke="#ecf0f1" strokeWidth={2} />
              <line x1={18} y1={5} x2={18} y2={25} stroke="#ecf0f1" strokeWidth={2} />
              <line x1={18} y1={15} x2={25} y2={15} stroke="#7f8c8d" strokeWidth={2} />
            </svg>
            <div style={{ textAlign: 'center', color: '#aaa', fontSize: 10, fontFamily: 'monospace' }}>
              cap
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
  onSelectPart, selectedPart,
  onSelectWire, selectedWire,
  onControlChange, onButtonDown, onButtonUp,
  statusText,
  placingProbe, onTerminalClickForProbe,
}) {
  const [wiringFrom, setWiringFrom] = useState(null);
  const [mousePos, setMousePos] = useState(null);
  const [dragging, setDragging] = useState(null);
  const [hoveredNet, setHoveredNet] = useState(null);

  const handleTerminalClick = useCallback((partId, terminal) => {
    // If placing a multimeter probe, route to probe handler
    if (placingProbe && onTerminalClickForProbe) {
      onTerminalClickForProbe(partId, terminal);
      return;
    }

    if (!wiringFrom) {
      setWiringFrom({ part: partId, terminal });
    } else {
      if (wiringFrom.part !== partId || wiringFrom.terminal !== terminal) {
        onAddWire(wiringFrom.part, wiringFrom.terminal, partId, terminal);
      }
      setWiringFrom(null);
      setMousePos(null);
    }
  }, [wiringFrom, onAddWire, placingProbe, onTerminalClickForProbe]);

  const handleSvgClick = useCallback(() => {
    // Cancel wiring if clicking empty space
    if (wiringFrom) {
      setWiringFrom(null);
      setMousePos(null);
    }
    onSelectPart(null);
    onSelectWire(null);
  }, [wiringFrom, onSelectPart, onSelectWire]);

  const handleSvgMouseMove = useCallback((e) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (wiringFrom) {
      setMousePos({ x, y });
    }
    if (dragging) {
      onMovePart(dragging, x, y);
    }
  }, [wiringFrom, dragging, onMovePart]);

  const handleDragStart = useCallback((e, partId) => {
    // Only start drag with left button on the SVG layer
    if (e.button === 0) {
      setDragging(partId);
    }
  }, []);

  const handleDragEnd = useCallback(() => {
    setDragging(null);
  }, []);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedWire) {
        onRemoveWire(selectedWire);
        onSelectWire(null);
      } else if (selectedPart) {
        onRemovePart(selectedPart);
        onSelectPart(null);
      }
    }
    if (e.key === 'Escape') {
      setWiringFrom(null);
      setMousePos(null);
      onSelectPart(null);
      onSelectWire(null);
    }
  }, [selectedPart, selectedWire, onRemovePart, onRemoveWire, onSelectPart, onSelectWire]);

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {/* Status bar */}
      <div style={{
        color: wiringFrom ? '#f39c12' : '#7f8c8d',
        fontFamily: 'monospace', fontSize: '11px',
        marginBottom: '8px', height: '16px',
      }}>
        {wiringFrom
          ? `Wiring from ${wiringFrom.part}:${wiringFrom.terminal} — click another terminal or ESC`
          : statusText || 'Click a terminal (red dot) to start wiring. Select + Delete to remove.'}
      </div>

      {/* Canvas */}
      <div
        style={{
          position: 'relative',
          width: CANVAS_W,
          height: CANVAS_H,
          background: '#16213e',
          borderRadius: '8px',
          border: '1px solid #2c3e50',
          overflow: 'hidden',
        }}
        onMouseMove={handleSvgMouseMove}
        onMouseUp={handleDragEnd}
      >
        <svg
          width={CANVAS_W}
          height={CANVAS_H}
          viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
          style={{ position: 'absolute', top: 0, left: 0 }}
          onClick={handleSvgClick}
        >
          <defs>
            <pattern id="grid" width={20} height={20} patternUnits="userSpaceOnUse">
              <circle cx={10} cy={10} r={0.5} fill="#2c3e50" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />

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
            hoveredNet={hoveredNet} onHoverNet={setHoveredNet} />
          <VoltageLabels wires={wires} parts={parts} nodeVoltages={nodeVoltages} />
          <WiringPreview wiringFrom={wiringFrom} mousePos={mousePos} parts={parts} />
          <SvgParts parts={parts} selectedPart={selectedPart} onSelectPart={onSelectPart} />
          <TerminalDots parts={parts} wiringFrom={wiringFrom} onTerminalClick={handleTerminalClick} placingProbe={placingProbe} />
        </svg>

        <WokwiParts
          parts={parts}
          ledBrightness={ledBrightness}
          buzzerTones={buzzerTones}
          onSelectPart={onSelectPart}
          selectedPart={selectedPart}
          onControlChange={onControlChange}
          onButtonDown={onButtonDown}
          onButtonUp={onButtonUp}
          onDragStart={(partId) => setDragging(partId)}
        />
      </div>
    </div>
  );
}

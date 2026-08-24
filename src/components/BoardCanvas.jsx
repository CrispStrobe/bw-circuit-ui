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

import React, { useState, useCallback, useRef } from 'react';
import { t } from '../i18n/strings.js';
import { InteractionMachine } from '../interaction/machine.js';
import { createHitTest } from '../interaction/hittest.js';
import { classifyWheel, computeFitView } from '../interaction/transform.js';
import { FOOTPRINTS, partBounds } from '../interaction/hittest.js';
import { snapGhost, seatSnapHole, BB_PITCH, bbHoleOrigin, nearestHole, bbFootprint } from '../interaction/breadboard-snap.js';
import { resolveSeatedParts, holeWorldPos } from '../interaction/seat-geometry.js';
import { getSidecar } from '../model/parts-registry.js';
import { distToSegment as distToSeg } from '../interaction/hittest.js';
import { FOOTPRINTS as BB_FOOTPRINTS, computeLeadMap } from '../model/footprints.js';
import { BreadboardView } from './BreadboardView.jsx';
import { ledDisplayLevel } from './led-perception.js';
import { DrcOverlay } from './DrcOverlay.jsx';
import { useTouch } from '../hooks/useTouch.js';
import { WokwiLed, WokwiResistor, WokwiBuzzer, WokwiPushbutton, WokwiPotentiometer, WokwiSevenSegment, WokwiLcd1602, WokwiIrReceiver, WokwiArduinoUno, WokwiArduinoNano, WokwiArduinoMega } from '../wokwi-wrappers/index.js';
import { partLabel } from '../model/format.js';
import ExportNetlistMenu from './ExportNetlistMenu.jsx';
import ImportCircuitMenu from './ImportCircuitMenu.jsx';

// DIP chip kinds that get a generic IC body renderer (not a custom SVG).
// These are discrete retro/logic ICs placed on breadboards — without a
// body they render as invisible dots, making bench circuits unreadable.
const DIP_CHIP_LABELS = {
  w65c02: 'W65C02S', w65c22: 'W65C22', w65c51: 'W65C51', ns16c550: 'NS16C550', m6532: 'M6532', ay8912: 'AY-3-8912', transformer: 'XFMR',
  '62256': '62256', '28c256': '28C256',
  z80: 'Z80 CPU', mc6850: 'MC6850',
  '74hc00': '74HC00', '74hc04': '74HC04', '74hc08': '74HC08',
  '74hc32': '74HC32', '74hc74': '74HC74', '74hc138': '74HC138',
  '74hc245': '74HC245', '74hc373': '74HC373', '74hc374': '74HC374', '74hc595': '74HC595',
  '74ls373': '74LS373', 'osc_can': 'OSC', 'max232': 'MAX232', 'rnet_sip': 'R-NET',
  // These three gained sidecars in the reconcile but not a DIP label, so they
  // fell back to {a,b} and rendered their pins stacked at the origin. Labels
  // only; the pin geometry comes from the sidecar terminals (74hc4050 is the
  // odd one — 16 pins with VCC on pin 1 and two real NCs).
  '74hc125': '74HC125', '74hc34': '74HC34', '74hc4050': '74HC4050',
  '74c922': '74C922', r6507: 'R6507', mos6532: 'MOS6532',
  at24c64: '24C64', shift_register: '74HC595', cd4093: 'CD4093',
  // Device-true MCU DIPs: without these the blinkenrocket pendant's
  // seated ATtiny88 rendered as a ghost outline (owner screenshot) —
  // 28 pin names floating around no body at all.
  attiny88: 'ATtiny88', attiny85: 'ATtiny85',
  attiny2313: 'ATtiny2313', attiny13: 'ATtiny13', at89c2051: 'AT89C2051',
  // Discrete DIP ICs that were ghost-faced in bus-computer benches
  '555': 'NE555', tms9918: 'TMS9918',
  ns16c550: 'NS16C550', mc6845: 'MC6845',
  // Part-matrix burn-down: DIP ICs with sidecars but no face
  '556': 'NE556', '74hc02': '74HC02', '74hc86': '74HC86',
  '74hc10': '74HC10', '74hc11': '74HC11', '74hc14': '74HC14',
  '74hc20': '74HC20', '74hc21': '74HC21', '74hc27': '74HC27',
  '74hc73': '74HC73', '74hc75': '74HC75', '74hc93': '74HC93',
  '74hc95': '74HC95', '74hc132': '74HC132', '74hc165': '74HC165',
  '74hc244': '74HC244', '74hc283': '74HC283', '74hc688': '74HC688',
  cd4511: 'CD4511', cd74hc4067: 'CD74HC4067',
  '74ls04': '74LS04', '74ls32': '74LS32', '74ls107': '74LS107',
  '74ls157': '74LS157', '74ls161': '74LS161', '74ls173': '74LS173',
  '74ls189': '74LS189',
  lm358: 'LM358', lm339: 'LM339', lm393: 'LM393',
  pcf8574: 'PCF8574', mcp4725: 'MCP4725', max7219: 'MAX7219',
  at24c02: '24C02', um245r: 'UM245R',
};
import { routeWire, routeWireWithWaypoints, partBBoxes, getPartBBox } from '../model/wire-router.js';
import { findSnapTarget } from '../model/snap.js';
import { PartTooltip } from './PartTooltip.jsx';
import { ContextMenu } from './ContextMenu.jsx';
import { InlineEditor } from './InlineEditor.jsx';
import { getMeterReading } from '../model/meter-reading.js';
import { computeCubeVoxels, testPattern, VOXEL_MAP } from '../model/ledcube.js';
import { getPinFunctionsForPart } from '../model/pin-functions.js';
import { isBoardEndpoint } from '../model/wire-endpoints.js';
import { boardTerminalOffsets, boardVisualGeometry } from '../model/board-geometry.js';
import { dipTerminalPositions, dipPackageGeometry, DIP_PIN_PITCH, DIP_ROW_OFFSET } from '../model/dip-geometry.js';

// Default canvas dimensions — used for viewBox and layout calculations.
// The actual rendered size fills the container via CSS.
const CANVAS_W = 700;
const CANVAS_H = 500;
const SEATED_PREVIEW_SCALE = Object.freeze({ led: 0.78 });

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
 * Derive chip display label and package from the device param.
 * Falls back to STC12 for the STC family or unknown devices.
 */
function mcuChipInfo(device) {
  const d = String(device || '').toLowerCase();
  if (/attiny2313/.test(d)) return { label: 'ATtiny2313', pkg: 'DIP-20' };
  if (/attiny88/.test(d)) return { label: 'ATtiny88', pkg: 'DIP-28' };
  if (/attiny85/.test(d)) return { label: 'ATtiny85', pkg: 'DIP-8' };
  if (/attiny13/.test(d)) return { label: 'ATtiny13', pkg: 'DIP-8' };
  if (/atmega168/.test(d)) return { label: 'ATmega168P', pkg: 'DIP-28' };
  if (/atmega2560/.test(d)) return { label: 'ATmega2560', pkg: 'TQFP-100' };
  if (/atmega328/.test(d)) return { label: 'ATmega328P', pkg: 'DIP-28' };
  if (/arduino.?mega/.test(d)) return { label: 'Arduino Mega', pkg: 'Board' };
  if (/arduino.?nano/.test(d)) return { label: 'Arduino Nano', pkg: 'Board' };
  if (/arduino.?uno/.test(d)) return { label: 'Arduino Uno', pkg: 'Board' };
  if (/gpascal/.test(d)) return { label: 'G-Pascal', pkg: '6502+VIA' };
  if (/eater.?6502/.test(d)) return { label: 'Eater 6502', pkg: 'Breadboard' };
  if (/micro.?bit/.test(d)) return { label: 'micro:bit', pkg: 'Board' };
  if (/w65c02/.test(d)) return { label: 'W65C02S', pkg: 'DIP-40' };
  if (/z80/.test(d)) return { label: 'Z80 CPU', pkg: 'DIP-40' };
  if (/stc89/.test(d)) return { label: 'STC89C52', pkg: 'DIP-40' };
  if (/stc15/.test(d)) return { label: 'STC15', pkg: 'DIP-40' };
  return { label: 'STC12C5A60S2', pkg: 'DIP-40' }; // default for STC family
}

/**
 * Terminal offset defaults per part kind, rotated by part.rotation.
 * Returns {terminalName: {dx, dy}} relative to part anchor.
 */
function terminalOffsetsForPart(part) {
  const rot = part.rotation || 0;
  const flip = part.flipped;
  const r = (dx, dy) => {
    const rotated = rotateOffset(dx, dy, rot);
    return flip ? { dx: -rotated.dx, dy: rotated.dy } : rotated;
  };

  switch (part.kind) {
    case 'vcc': return { vcc: r(0, 20) };
    case 'gnd': return { gnd: r(0, -10) };
    case 'resistor': return { a: r(-30, 0), b: r(30, 0) };
    case 'led': return { anode: r(-20, 0), cathode: r(20, 0) };
    case 'potentiometer': return { a: r(-25, 20), wiper: r(0, -20), b: r(25, 20) };
    case 'button': return { a: r(-15, 0), b: r(15, 0) };
    case 'buzzer': return { a: r(-15, 0), b: r(15, 0) };
    case 'capacitor': return { a: r(-15, 0), b: r(15, 0) };
    case 'diode':
    case 'zener': return { anode: r(-20, 0), cathode: r(20, 0) };
    case 'meter': return { probe_a: r(-25, 20), probe_b: r(25, 20) };
    case 'vsource': {
      const variant = String(part.params?.variant ?? (part.params?.wave && part.params.wave !== 'dc' ? 'fg' : '9v'));
      if (variant === '9v') return { pos: r(-9, -38), neg: r(9, -38) };
      if (variant === 'aa') return { pos: r(30, 0), neg: r(-30, 0) };
      if (variant === 'coin') return { pos: r(0, -22), neg: r(0, 22) };
      return { pos: r(-24, 30), neg: r(24, 30) }; // fg: front jacks
    }
    case 'led_cube': {
      const offsets = {};
      for (let i = 0; i < 8; i++) offsets[`sel_${i}`] = r(-60, -30 + i * 10);
      for (let i = 0; i < 8; i++) offsets[`data_${i}`] = r(60, -30 + i * 10);
      return offsets;
    }
    case 'max7219': return { vcc: r(-25, 30), gnd: r(-15, 30), din: r(-5, 30), clk: r(5, 30), cs: r(15, 30), dout: r(25, 30) };
    case 'seven_segment': return { a: r(-30, 30), b: r(30, 30) }; // pins at bottom
    case 'bargraph': {
      // 10 anodes (top) + 10 cathodes (bottom), spaced at 6px
      const offsets = {};
      for (let i = 0; i < 10; i++) offsets[`a${i}`] = r(-27 + i * 6, -12);
      for (let i = 0; i < 10; i++) offsets[`k${i}`] = r(-27 + i * 6, 12);
      return offsets;
    }
    case 'char_lcd':
    case 'hd44780':
      return { rs: r(-50, 25), e: r(-30, 25), d4: r(-10, 25), d5: r(10, 25), d6: r(30, 25), d7: r(50, 25) };
    case 'ir_receiver': return { out: r(0, 15), vcc: r(-10, -10), gnd: r(10, -10) };
    case 'shift_register': return { data: r(-20, -15), clock: r(0, -15), latch: r(20, -15) };
    case 'led_matrix': return { a: r(-20, 0), b: r(20, 0) };
    case 'temp_sensor': return { dq: r(0, 15), vcc: r(-10, -10), gnd: r(10, -10) };
    case 'eeprom': return { sda: r(-10, 15), scl: r(10, 15) };
    case 'ssd1306': return { vcc: r(-12, 24), gnd: r(-4, 24), sda: r(4, 24), scl: r(12, 24) };
    case 'sevenseg8': return {
      vcc: r(-52, 35), gnd: r(-44, 35),
      seg_a: r(-36, 35), seg_b: r(-28, 35), seg_c: r(-20, 35), seg_d: r(-12, 35),
      seg_e: r(-4, 35), seg_f: r(4, 35), seg_g: r(12, 35), seg_dp: r(20, 35),
      sel_a: r(28, 35), sel_b: r(36, 35), sel_c: r(44, 35),
    };
    case 'ledbank8': {
      const offsets = { vcc: r(-35, 15), gnd: r(-27, 15) };
      for (let i = 0; i < 8; i++) offsets[`d${i}`] = r(-19 + i * 8, 15);
      return offsets;
    }
    case 'joystick': return { vcc: r(-20, 30), gnd: r(-10, 30), vrx: r(0, 30), vry: r(10, 30), sw: r(20, 30) };
    case 'slider': return { a: r(-20, 15), wiper: r(0, 15), b: r(20, 15) };
    case 'gauge': return { signal: r(0, 25), vcc: r(-15, 25), gnd: r(15, 25) };
    case 'mono_lcd': return { vcc: r(-15, 40), gnd: r(15, 40) };
    case 'rgb_light': return { vcc: r(-10, 15), gnd: r(10, 15) };
    case 'keypad': return {
      r1: r(-21, 35), r2: r(-15, 35), r3: r(-9, 35), r4: r(-3, 35),
      c1: r(3, 35), c2: r(9, 35), c3: r(15, 35), c4: r(21, 35),
    };
    case 'mcu': {
      // Sidecar geometry (datasheet DIP-40) scaled to the canvas: every
      // physical pin sits where the package puts it. Fallback: the old
      // declared-pins-only single-column layout.
      const sc = typeof getSidecar === 'function' ? getSidecar('mcu') : null;
      if (sc && sc.terminals && sc.terminals.length > 2) {
        // The source sidecar uses a generous 200×260 art coordinate space;
        // the physical DIP package on this canvas is the compact 80×111
        // footprint. Keep the same scale for pins and body.
        const offsets = {};
        for (const [name, position] of Object.entries(dipTerminalPositions(sc))) {
          offsets[name] = r(position.dx, position.dy);
        }
        return offsets;
      }
      const offsets = {};
      const pinCount = part.terminals.length;
      const chipH = Math.max(60, pinCount * 30 + 20);
      const chipY = -chipH / 2;
      part.terminals.forEach((pin, i) => {
        offsets[pin] = r(-60, chipY + 30 + i * 30);
      });
      return offsets;
    }
    case 'arduino_uno':
    case 'arduino_nano':
    case 'arduino_mega':
    case 'pi_pico': {
      const sc = getSidecar(part.kind);
      const offsets = boardTerminalOffsets(part.kind, sc);
      if (Object.keys(offsets).length) {
        return Object.fromEntries(Object.entries(offsets).map(([name, p]) => [name, r(p.dx, p.dy)]));
      }
      return { a: r(-15, 0), b: r(15, 0) };
    }
    case 'ili9341':
      return { vcc: r(-30, -50), gnd: r(-30, -40), cs: r(-30, -30), rst: r(-30, -20),
        dc: r(-30, -10), mosi: r(-30, 0), sck: r(-30, 10), miso: r(-30, 20), led: r(-30, 30) };
    case 'ili9341_par':
    case 'ili9341_parallel': {
      // 16-pin 8080 parallel: VCC GND CS RST RS WR RD D0-D7 LED
      const offsets = {};
      const pins = ['vcc','gnd','cs','rst','rs','wr','rd','d0','d1','d2','d3','d4','d5','d6','d7','led'];
      for (let i = 0; i < pins.length; i++) offsets[pins[i]] = r(-30, -50 + i * 7);
      return offsets;
    }
    case 'matrix8x8': case 'matrix16x8': case 'matrix9x9': {
      const offsets = {};
      const cols = part.kind === 'matrix16x8' ? 16 : part.kind === 'matrix9x9' ? 9 : 8;
      const rows = part.kind === 'matrix9x9' ? 9 : 8;
      const maxN = Math.max(cols, rows);
      const span = maxN * 8;
      for (let i = 0; i < cols; i++) offsets[`col${i}`] = r(-span/2 - 8, -span/2 + 4 + i * (span / cols));
      for (let i = 0; i < rows; i++) offsets[`row${i}`] = r(span/2 + 8, -span/2 + 4 + i * (span / rows));
      return offsets;
    }
    case 'gate_and': case 'gate_or': case 'gate_nand': case 'gate_nor': case 'gate_xor':
      return { in0: r(-22, -10), in1: r(-22, 10), out: r(22, 0) };
    case 'gate_not':
      return { in0: r(-20, 0), out: r(20, 0) };
    default: {
      // Generic DIP chip terminal offsets from sidecar geometry
      if (DIP_CHIP_LABELS[part.kind]) {
        const sc = typeof getSidecar === 'function' ? getSidecar(part.kind) : null;
        if (sc && sc.terminals && sc.terminals.length > 2) {
          const positions = dipTerminalPositions(sc);
          const offsets = {};
          for (const [name, pos] of Object.entries(positions)) offsets[name] = r(pos.dx, pos.dy);
          return offsets;
        }
      }
      return { a: r(-15, 0), b: r(15, 0) };
    }
  }
}

function terminalPos(part, terminal) {
  // A seated part's terminals ARE its holes: wires, dots, stubs and hit
  // tests all attach where the leg physically enters the board.
  if (part._seatTerminals && part._seatTerminals[terminal]) {
    return part._seatTerminals[terminal];
  }
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

// Standard 4×4 keypad key labels, row-major (key 0 = '1', key 15 = 'D').
const KEYPAD_LABELS = ['1','2','3','A','4','5','6','B','7','8','9','C','*','0','#','D'];

function SvgParts({ parts, selectedParts, onSelectPart, onPartBodyClick, deviceStates, simulate, onKeypadKey, onSetPartParam, videoFn }) {
  return parts.map(part => {
    const { id, kind, x, y } = part;
    const seatRot = part.seat?.rot ? part.seat.rot * 90 : 0;
    const rot = (part.rotation || 0) + seatRot;
    const flip = part.flipped;
    const isSelected = selectedParts?.has(id);
    const selStroke = isSelected ? '#f1c40f' : undefined;
    let xform = `translate(${x}, ${y})`;
    if (rot) xform += ` rotate(${rot})`;
    if (flip) xform += ` scale(-1, 1)`;

    const handleClick = (e) => {
      e.stopPropagation();
      onSelectPart(id, e.shiftKey);
    };

    switch (kind) {
      case 'vcc':
      case 'gnd': {
        // A bench binding post: metal collar, colored cap, base plate.
        const capColor = kind === 'vcc' ? '#c0392b' : '#1b2631';
        const capHi = kind === 'vcc' ? '#e74c3c' : '#2c3e50';
        const ty = kind === 'vcc' ? 20 : -10; // terminal offset (kept from before)
        return (
          <g key={id} transform={xform} pointerEvents="none">
            <ellipse cx={0} cy={8} rx={16} ry={5} fill="#7f8c8d" opacity={0.35} />
            <rect x={-3} y={ty > 0 ? 4 : ty} width={6} height={Math.abs(ty) + 2} rx={2} fill="#95a5a6" />
            <rect x={-11} y={-14} width={22} height={20} rx={5}
              fill={capColor} stroke={selStroke || capHi} strokeWidth={2} />
            <rect x={-11} y={-14} width={22} height={8} rx={5} fill={capHi} opacity={0.5} />
            <circle cx={0} cy={-4} r={3.5} fill="#ecf0f1" opacity={0.9} />
            <text x={0} y={26} textAnchor="middle" fill={capHi} fontSize={8}
              fontFamily="monospace" fontWeight="bold">{kind === 'vcc' ? `+${part.params?.volts ?? 5}V` : 'GND'}</text>
          </g>
        );
      }
      case 'mcu': {
        // DIP body drawn from the device-specific sidecar when available,
        // falling back to the generic 'mcu' (STC12) sidecar.
        const chipInfo = mcuChipInfo(part.params?.device);
        const deviceKey = (part.params?.device || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const sc = (deviceKey && getSidecar(deviceKey)) || (typeof getSidecar === 'function' ? getSidecar('mcu') : null);
        if (sc && sc.terminals && sc.terminals.length > 2) {
          const positions = dipTerminalPositions(sc);
          const px = (t) => positions[t.name]?.dx || 0;
          const py = (t) => positions[t.name]?.dy || 0;
          const { w: bodyW, h: bodyH } = dipPackageGeometry(sc);
          return (
            <g key={id} data-part-face={kind} transform={xform} onClick={handleClick} style={{ cursor: 'pointer' }}>
              <rect x={-bodyW / 2} y={-bodyH / 2} width={bodyW} height={bodyH} rx={5}
                fill="#1a1a1a" stroke={selStroke || '#444'} strokeWidth={isSelected ? 3 : 1.5} />
              {/* Notch at left end — pin-1-bottom convention */}
              <path d={`M ${-bodyW / 2} -5 A 5 5 0 0 1 ${-bodyW / 2} 5`}
                fill="#2c3e50" stroke={selStroke || '#555'} strokeWidth={1} />
              {/* Pin 1 dot — bottom-left */}
              <circle cx={-bodyW / 2 + 10} cy={bodyH / 2 - 8} r={2.5} fill="#555" />
              <text x={0} y={-5} textAnchor="middle" fill="#bbb" fontSize={10}
                fontFamily="monospace" fontWeight="bold"
                transform="rotate(0)">{chipInfo.label}</text>
              <text x={0} y={9} textAnchor="middle" fill="#777" fontSize={7}
                fontFamily="monospace">{chipInfo.pkg}</text>
              {sc.terminals.map(t => {
                const isVCC = /^(VCC|AVCC|VDD)$/i.test(t.name);
                const isGND = /^(GND|VSS)$/i.test(t.name);
                const legColor = isVCC ? '#c0392b' : isGND ? '#2c2c2c' : '#b0b8c0';
                const padColor = isVCC ? '#e74c3c' : isGND ? '#444' : '#d8dee4';
                return (
                <g key={t.name}>
                  {(isVCC || isGND) && <title>{isVCC ? 'VCC — connect to +5 V rail' : 'GND — connect to ground rail'}</title>}
                  <line x1={px(t)} y1={py(t) < 0 ? -bodyH / 2 : bodyH / 2} x2={px(t)} y2={py(t)}
                    stroke={legColor} strokeWidth={3} />
                  <rect x={px(t) - 5} y={py(t) - 2.5} width={10} height={5}
                    fill={padColor} stroke={isVCC ? '#c0392b' : isGND ? '#333' : '#8090a0'} strokeWidth={0.5} />
                  <text x={px(t)} y={py(t) + (py(t) < 0 ? -7 : 12)} textAnchor="middle"
                    fill={isVCC ? '#e74c3c' : isGND ? '#777' : '#94a3b8'} fontSize={3.2} fontFamily="monospace"
                    fontWeight={isVCC || isGND ? 'bold' : 'normal'}>{t.name}</text>
                </g>
                );
              })}
            </g>
          );
        }
        // DIP chip body — real IC package appearance
        const pinCount = part.terminals.length;
        const pinsPerSide = Math.ceil(pinCount / 2);
        const pinSpacing = 14;
        const chipW = 80;
        const chipH = Math.max(50, pinsPerSide * pinSpacing + 16);
        const chipY = -chipH / 2;
        const legLen = 12;
        const legW = 3;
        return (
          <g key={id} transform={xform}
            onClick={handleClick}
            style={{ cursor: 'pointer' }}>
            {/* Chip body — black DIP package */}
            <rect x={-chipW / 2} y={chipY} width={chipW} height={chipH} rx={3}
              fill="#1a1a1a" stroke={selStroke || '#444'} strokeWidth={isSelected ? 3 : 1.5} />
            {/* Notch at pin 1 (top center) */}
            <path d={`M ${-6} ${chipY} A 6 6 0 0 1 ${6} ${chipY}`}
              fill="#2c3e50" stroke={selStroke || '#555'} strokeWidth={1} />
            {/* Pin 1 dot */}
            <circle cx={-chipW / 2 + 8} cy={chipY + 10} r={2.5} fill="#555" />
            {/* Label */}
            <text x={0} y={chipY + chipH / 2 - 4} textAnchor="middle" fill="#bbb" fontSize={9}
              fontFamily="monospace" fontWeight="bold">{chipInfo.label}</text>
            <text x={0} y={chipY + chipH / 2 + 6} textAnchor="middle" fill="#777" fontSize={7}
              fontFamily="monospace">{chipInfo.pkg}</text>
            {/* Left-side pins (1 to N/2) */}
            {part.terminals.slice(0, pinsPerSide).map((pin, i) => {
              const py = chipY + 12 + i * pinSpacing;
              const isVCC = /^(VCC|AVCC|VDD)$/i.test(pin);
              const isGND = /^(GND|VSS)$/i.test(pin);
              const legFill = isVCC ? '#c0392b' : isGND ? '#2c2c2c' : '#b0b8c0';
              const lblFill = isVCC ? '#e74c3c' : isGND ? '#555' : '#f39c12';
              return (
                <g key={pin}>
                  {(isVCC || isGND) && <title>{isVCC ? 'VCC — connect to +5 V rail' : 'GND — connect to ground rail'}</title>}
                  <rect x={-chipW / 2 - legLen} y={py - legW / 2} width={legLen} height={legW}
                    fill={legFill} stroke={isVCC ? '#c0392b' : isGND ? '#333' : '#8090a0'} strokeWidth={0.5} />
                  <text x={-chipW / 2 - legLen - 3} y={py + 3} textAnchor="end"
                    fill={lblFill} fontSize={7} fontFamily="monospace"
                    fontWeight={isVCC || isGND ? 'bold' : 'normal'}>{pin}</text>
                </g>
              );
            })}
            {/* Right-side pins (N/2+1 to N, bottom to top) */}
            {part.terminals.slice(pinsPerSide).map((pin, i) => {
              const py = chipY + 12 + (pinsPerSide - 1 - i) * pinSpacing;
              const isVCC = /^(VCC|AVCC|VDD)$/i.test(pin);
              const isGND = /^(GND|VSS)$/i.test(pin);
              const legFill = isVCC ? '#c0392b' : isGND ? '#2c2c2c' : '#b0b8c0';
              const lblFill = isVCC ? '#e74c3c' : isGND ? '#555' : '#f39c12';
              return (
                <g key={pin}>
                  {(isVCC || isGND) && <title>{isVCC ? 'VCC — connect to +5 V rail' : 'GND — connect to ground rail'}</title>}
                  <rect x={chipW / 2} y={py - legW / 2} width={legLen} height={legW}
                    fill={legFill} stroke={isVCC ? '#c0392b' : isGND ? '#333' : '#8090a0'} strokeWidth={0.5} />
                  <text x={chipW / 2 + legLen + 3} y={py + 3} textAnchor="start"
                    fill={lblFill} fontSize={7} fontFamily="monospace"
                    fontWeight={isVCC || isGND ? 'bold' : 'normal'}>{pin}</text>
                </g>
              );
            })}
          </g>
        );
      }
      case 'arduino_uno':
      case 'arduino_nano':
      case 'arduino_mega':
      case 'pi_pico': {
        const sc = getSidecar(kind);
        const geometry = boardVisualGeometry(kind, sc);
        const W = geometry?.w ?? 400;
        const H = geometry?.h ?? 150;
        const boardColor = kind === 'pi_pico' ? '#7b2cbf' : '#087ea4';
        const title = kind === 'arduino_uno' ? 'ARDUINO UNO' : kind === 'arduino_nano' ? 'ARDUINO NANO' : kind === 'arduino_mega' ? 'ARDUINO MEGA' : 'RASPBERRY PI PICO';
        const subtitle = kind === 'pi_pico' ? 'RP2040 · 3V3' : kind === 'arduino_mega' ? 'ATmega2560 · 5V' : 'ATmega328P · 5V';
        const offsets = boardTerminalOffsets(kind, sc);
        const WokwiFace = kind === 'arduino_uno' ? WokwiArduinoUno
          : kind === 'arduino_nano' ? WokwiArduinoNano
          : kind === 'arduino_mega' ? WokwiArduinoMega : null;
        const faceTransform = (rot || flip)
          ? `translate(${x} ${y}) rotate(${rot}) scale(${flip ? -1 : 1} 1) translate(${-x} ${-y})`
          : undefined;
        return (
          <React.Fragment key={id}>
            {WokwiFace && geometry ? (
              /* Chromium can drop a parent <g> translation when laying out
                 transformed HTML inside foreignObject. Anchor the licensed
                 face in world coordinates directly; its outline, pins and
                 hit box now share the same (x,y,W,H) contract. */
              <foreignObject x={x - W / 2} y={y - H / 2} width={W} height={H}
                transform={faceTransform}
                data-board-face={kind} data-board-face-license="MIT"
                style={{pointerEvents: 'none', overflow: 'hidden'}}>
                <div xmlns="http://www.w3.org/1999/xhtml" style={{
                  width: geometry.nativeW, height: geometry.nativeH,
                  transform: `scale(${geometry.wokwiScale})`, transformOrigin: '0 0',
                }}>
                  <WokwiFace style={{display: 'block'}} />
                </div>
              </foreignObject>
            ) : null}
          <g transform={xform} onClick={handleClick} style={{ cursor: 'pointer' }}
            data-board-face={kind} data-board-face-license={WokwiFace ? 'MIT' : 'code'}>
            <rect x={-W / 2} y={-H / 2} width={W} height={H} rx={5}
              fill={WokwiFace ? 'transparent' : boardColor} stroke={selStroke || '#164e63'} strokeWidth={isSelected ? 3 : 1.5} />
            {!WokwiFace && <>
              <rect x={-W / 2 + 8} y={-H / 2 + 8} width={Math.max(20, W - 16)} height={Math.max(20, H - 16)}
                rx={3} fill="#0b6b8a" opacity={0.35} />
              <text x={0} y={-4} textAnchor="middle"
              fill="#dff6ff" fontSize={kind === 'pi_pico' ? 5.5 : 7} fontFamily="monospace" fontWeight="bold">
                {title}
              </text>
              <text x={0} y={8} textAnchor="middle" fill="#a9dbea" fontSize={5} fontFamily="monospace">
                {subtitle}
              </text>
            </>}
            {!WokwiFace && Object.entries(offsets).map(([name, p]) => {
              if (geometry?.transpose) {
                const topSide = p.dy < 0;
                return (
                  <g key={name}>
                    <rect x={p.dx - 3} y={p.dy - 1.5} width={6} height={3}
                      fill="#d8dee4" stroke="#637381" strokeWidth={0.3} />
                    <text x={p.dx} y={p.dy + (topSide ? -5 : 8)}
                      textAnchor="middle"
                      fill="#d6eef5" fontSize={kind === 'pi_pico' ? 3.2 : 3.8}
                      fontFamily="monospace">{name.toUpperCase()}</text>
                  </g>
                );
              }
              const leftSide = p.dx < 0;
              return (
                <g key={name}>
                  <rect x={p.dx - 1.5} y={p.dy - 3} width={3} height={6}
                    fill="#d8dee4" stroke="#637381" strokeWidth={0.3} />
                  <text x={p.dx + (leftSide ? 5 : -5)} y={p.dy + 1.5}
                    textAnchor={leftSide ? 'start' : 'end'}
                    fill="#d6eef5" fontSize={4}
                    fontFamily="monospace">{name.toUpperCase()}</text>
                </g>
              );
            })}
            <text x={0} y={H / 2 + 12} textAnchor="middle" fill="#7f8c8d" fontSize={7}
              fontFamily="monospace">{part.declName || id}</text>
          </g>
          </React.Fragment>
        );
      }
      case 'servo': {
        // Servo: body + horn that rotates to the decoded angle from the board model.
        // Read from deviceStates (board.getDeviceState), NOT from block arguments.
        // Undriven = no valid pulse train → show "?" instead of a default angle.
        const ds = deviceStates?.get(id);
        const angle = ds?.actualAngle;
        const hasSignal = ds && ds._riseNs > 0n;
        const hornAngle = hasSignal && angle != null ? angle - 90 : null; // center = 0°
        return (
          <g key={id} transform={xform}
            pointerEvents="none"
            style={{ cursor: 'pointer' }}>
            {/* Body */}
            <rect x={-22} y={-14} width={44} height={28} rx={4}
              fill="#2c3e50" stroke={selStroke || '#3498db'} strokeWidth={isSelected ? 3 : 1.5} />
            {/* Shaft circle */}
            <circle cx={-8} cy={0} r={8} fill="#444" stroke="#666" strokeWidth={1} />
            {/* Horn — rotates with decoded angle */}
            {hornAngle != null ? (
              <g transform={`rotate(${hornAngle}, -8, 0)`}>
                <rect x={-10} y={-2} width={22} height={4} rx={2} fill="#ecf0f1" stroke="#bbb" strokeWidth={0.5} />
                <circle cx={10} cy={0} r={2} fill="#bbb" />
              </g>
            ) : (
              /* Undriven: show ? */
              <text x={-8} y={4} textAnchor="middle" fill="#f39c12" fontSize={12}
                fontFamily="monospace" fontWeight="bold">?</text>
            )}
            {/* Angle readout */}
            <text x={14} y={-6} fill={hasSignal ? '#2ecc71' : '#f39c12'} fontSize={8}
              fontFamily="monospace">
              {hasSignal && angle != null ? `${angle.toFixed(0)}°` : 'no signal'}
            </text>
            {/* Label */}
            <text x={0} y={22} textAnchor="middle" fill="#7f8c8d" fontSize={7}
              fontFamily="monospace">{part.declName || id}</text>
          </g>
        );
      }
      // ── NxM LED matrix display (with per-pixel brightness levels) ─
      case 'matrix8x8': case 'matrix16x8': case 'matrix9x9': {
        const ds = deviceStates?.get(id);
        const br = ds?.brightness;
        const levels = ds?.levels;  // Uint8Array, 0..MATRIX_LEVELS (quantized)
        const mCols = ds?.cols ?? (kind === 'matrix16x8' ? 16 : kind === 'matrix9x9' ? 9 : 8);
        const mRows = ds?.rows ?? (kind === 'matrix9x9' ? 9 : 8);
        const n = mRows * mCols;
        const S = 4;
        const G = mCols > 9 ? 4 : 6;
        const Wc = mCols * G, Wr = mRows * G;
        const maxDim = Math.max(Wc, Wr);
        const seatK = part.seat ? (Math.max(mCols, mRows) - 1) * BB_PITCH / maxDim : 1;
        return (
          <g key={id} transform={xform + (seatK !== 1 ? ` scale(${seatK.toFixed(3)})` : '')} onClick={handleClick} style={{ cursor: 'pointer' }}>
            <rect x={-Wc/2 - 3} y={-Wr/2 - 3} width={Wc + 6} height={Wr + 6} rx={3}
              fill="#111" stroke={selStroke || '#e74c3c'} strokeWidth={1.5} />
            {Array.from({ length: n }, (_, i) => {
              const row = Math.floor(i / mCols), col = i % mCols;
              // Two brightness paths:
              //  A. Quantized levels (0..MATRIX_LEVELS) from bw-board matrix
              //     model — 4-level graded brightness (off/dim/mid/full).
              //  B. Continuous brightness (Float64Array 0..1) with perceptual
              //     gamma lift via ledDisplayLevel (legacy / non-level models).
              let v;
              if (levels) {
                // Path A: quantized level → normalised 0..1
                // MATRIX_LEVELS = 3 in bw-board (4 values: off/dim/mid/full).
                v = levels[i] / 3;
              } else {
                // Path B: perceptual gamma lift on raw duty-cycle average
                v = ledDisplayLevel(br ? br[i] : 0);
              }
              const color = v > 0.05 ? `rgba(255,${Math.round(40 + 140 * v)},${Math.round(30 * v)},${Math.min(1, 0.25 + 0.75 * v)})` : '#1a0000';
              return <circle key={i}
                cx={-Wc/2 + col * G + G/2} cy={-Wr/2 + row * G + G/2} r={S/2}
                fill={color} />;
            })}
            <text x={0} y={Wr/2 + 12} textAnchor="middle" fill="#7f8c8d" fontSize={7}
              fontFamily="monospace">{part.declName || id}</text>
          </g>
        );
      }

      // ── MAX7219 8×8 LED matrix driver ────────────────────────────
      case 'max7219': {
        const ds = deviceStates?.get(id);
        // Two brightness paths:
        //  A. Per-pixel: ds.brightness (Float64Array, 0.0–1.0) — used when
        //     the device model provides graded intensity per LED (e.g. a
        //     PWM-driven matrix or a future MAX7219 model with duty-cycle
        //     measurement). Passed through ledDisplayLevel for perception.
        //  B. On/off + global intensity: ds.digits[0..7] bit patterns with
        //     ds.intensity 0..15. The current bw-board MAX7219 model uses
        //     this path.
        // shutdown = true means display off; displayTest = all on.
        const off = !ds || ds.shutdown;
        const testMode = ds && ds.displayTest;
        const perPixel = ds?.brightness; // path A
        const globalIntensity = ds ? (ds.intensity ?? 0) / 15 : 0;
        const G = 6, S = 4;
        const Wc = 8 * G, Wr = 8 * G;
        const seatK = part.seat ? 7 * BB_PITCH / Wc : 1;
        return (
          <g key={id} transform={xform + (seatK !== 1 ? ` scale(${seatK.toFixed(3)})` : '')} onClick={handleClick} style={{ cursor: 'pointer' }}>
            {/* Red PCB background */}
            <rect x={-Wc/2 - 4} y={-Wr/2 - 4} width={Wc + 8} height={Wr + 8} rx={3}
              fill="#2a0a0a" stroke={selStroke || '#e74c3c'} strokeWidth={1.5} />
            {Array.from({ length: 64 }, (_, i) => {
              const row = Math.floor(i / 8), col = i % 8;
              let v = 0;
              if (testMode) {
                v = 1;
              } else if (!off) {
                if (perPixel) {
                  // Path A: per-pixel brightness from device model
                  v = ledDisplayLevel(perPixel[i] ?? 0);
                } else if (ds?.digits) {
                  // Path B: on/off bits + global intensity
                  const lit = (ds.digits[row] >> col) & 1;
                  v = lit ? Math.max(0.15, 0.3 + 0.7 * globalIntensity) : 0;
                }
              }
              const color = v > 0.05
                ? `rgba(255,${Math.round(40 + 140 * v)},${Math.round(30 * v)},${Math.min(1, 0.25 + 0.75 * v)})`
                : '#1a0000';
              return <circle key={i}
                cx={-Wc/2 + col * G + G/2} cy={-Wr/2 + row * G + G/2} r={S/2}
                fill={color} />;
            })}
            <text x={0} y={Wr/2 + 12} textAnchor="middle" fill="#7f8c8d" fontSize={7}
              fontFamily="monospace">{part.declName || id}</text>
          </g>
        );
      }

      // ── ILI9341 TFT display (SPI + 8080 parallel variants) ───────
      case 'ili9341':
      case 'ili9341_par':
      case 'ili9341_parallel': {
        const ds = deviceStates?.get(id);
        const dark = ds && (ds.sleeping || !ds.displayOn);
        return (
          <g key={id} transform={xform} onClick={handleClick} style={{ cursor: 'pointer' }}>
            {/* PCB body */}
            <rect x={-24} y={-54} width={68} height={112} rx={3}
              fill="#1a472a" stroke={selStroke || '#2ecc71'} strokeWidth={1.5} />
            {/* Screen area — 240x320 scaled to ~48x64 */}
            <rect x={-10} y={-48} width={48} height={64} rx={1}
              fill={dark ? '#111' : '#000'} stroke="#333" strokeWidth={0.5} />
            {ds && ds.gram && !dark && (
              <foreignObject x={-10} y={-48} width={48} height={64}>
                <canvas
                  ref={el => {
                    if (!el) return;
                    // Convert RGB565 GRAM to RGBA inline (no sibling import)
                    const W = 240, H = 320;
                    const rgba = new Uint8ClampedArray(W * H * 4);
                    for (let i = 0; i < ds.gram.length; i++) {
                      const px = ds.gram[i];
                      rgba[i * 4] = ((px >> 11) & 0x1f) << 3;
                      rgba[i * 4 + 1] = ((px >> 5) & 0x3f) << 2;
                      rgba[i * 4 + 2] = (px & 0x1f) << 3;
                      rgba[i * 4 + 3] = 255;
                    }
                    if (el.width !== W) el.width = W;
                    if (el.height !== H) el.height = H;
                    el.style.width = '48px';
                    el.style.height = '64px';
                    el.style.imageRendering = 'pixelated';
                    const ctx = el.getContext('2d');
                    ctx.putImageData(new ImageData(rgba, W, H), 0, 0);
                  }}
                  style={{ width: 48, height: 64, imageRendering: 'pixelated' }}
                />
              </foreignObject>
            )}
            {dark && (
              <text x={14} y={-12} textAnchor="middle" fill="#333" fontSize={6}
                fontFamily="monospace">OFF</text>
            )}
            <text x={14} y={66} textAnchor="middle" fill="#7f8c8d" fontSize={7}
              fontFamily="monospace">{part.declName || id}</text>
          </g>
        );
      }

      // ── 10-LED bargraph display ────────────────────────────────
      case 'bargraph': {
        const ds = deviceStates?.get(id);
        const br = ds?.brightness;
        const N = 10;
        const G = 6;                   // gap between LED centres
        const W = N * G, H = 12;       // body dimensions
        const seatK = part.seat ? (9 * BB_PITCH) / W : 1;
        return (
          <g key={id} transform={xform + (seatK !== 1 ? ` scale(${seatK.toFixed(3)})` : '')} onClick={handleClick} style={{ cursor: 'pointer' }}>
            <rect x={-W / 2 - 3} y={-H / 2 - 3} width={W + 6} height={H + 6} rx={2}
              fill="#111" stroke={selStroke || '#27ae60'} strokeWidth={isSelected ? 3 : 1.5} />
            {Array.from({ length: N }, (_, i) => {
              const v = ledDisplayLevel(br ? br[i] : 0);
              const color = v > 0.05
                ? `rgba(${i < 8 ? '50,220,50' : '220,50,50'},${Math.min(1, 0.3 + 0.7 * v)})`
                : '#0a1a0a';
              return <rect key={i}
                x={-W / 2 + i * G + 1} y={-H / 2 + 1}
                width={G - 2} height={H - 2} rx={1}
                fill={color} />;
            })}
            <text x={0} y={H / 2 + 10} textAnchor="middle" fill="#7f8c8d" fontSize={7}
              fontFamily="monospace">{part.declName || id}</text>
          </g>
        );
      }

      // ── SSD1306 128×64 monochrome OLED ───────────────────────────
      case 'ssd1306': {
        const ds = deviceStates?.get(id);
        const dark = ds && !ds.displayOn;
        // 4-pin module: 3 gaps × BB_PITCH when seated.
        const W = 48, H = 28;
        const seatK = part.seat ? (3 * BB_PITCH) / W : 1;
        return (
          <g key={id} transform={xform + (seatK !== 1 ? ` scale(${seatK.toFixed(3)})` : '')} onClick={handleClick} style={{ cursor: 'pointer' }}>
            {/* PCB body */}
            <rect x={-W/2 - 2} y={-H/2 - 2} width={W + 4} height={H + 14} rx={3}
              fill="#0a0a1e" stroke={selStroke || '#3498db'} strokeWidth={1.5} />
            {/* Screen area — 128×64 rendered into 48×24 */}
            <rect x={-W/2} y={-H/2 + 2} width={W} height={H - 4} rx={1}
              fill={dark ? '#111' : '#000'} stroke="#333" strokeWidth={0.5} />
            {ds && ds.fb && !dark && (
              <foreignObject x={-W/2} y={-H/2 + 2} width={W} height={H - 4}>
                <canvas
                  ref={el => {
                    if (!el) return;
                    const FW = 128, FH = 64;
                    const rgba = new Uint8ClampedArray(FW * FH * 4);
                    const inv = ds.inverted;
                    for (let page = 0; page < 8; page++) {
                      for (let col = 0; col < FW; col++) {
                        const byte = ds.fb[page * FW + col];
                        for (let bit = 0; bit < 8; bit++) {
                          const y = page * 8 + bit;
                          const on = ((byte >> bit) & 1) !== 0;
                          const lit = inv ? !on : on;
                          const idx = (y * FW + col) * 4;
                          rgba[idx] = rgba[idx + 1] = rgba[idx + 2] = lit ? 255 : 0;
                          rgba[idx + 3] = 255;
                        }
                      }
                    }
                    if (el.width !== FW) el.width = FW;
                    if (el.height !== FH) el.height = FH;
                    el.style.width = `${W}px`;
                    el.style.height = `${H - 4}px`;
                    el.style.imageRendering = 'pixelated';
                    const ctx = el.getContext('2d');
                    ctx.putImageData(new ImageData(rgba, FW, FH), 0, 0);
                  }}
                  style={{ width: W, height: H - 4, imageRendering: 'pixelated' }}
                />
              </foreignObject>
            )}
            {dark && (
              <text x={0} y={2} textAnchor="middle" fill="#333" fontSize={6}
                fontFamily="monospace">OFF</text>
            )}
            <text x={0} y={H/2 + 10} textAnchor="middle" fill="#7f8c8d" fontSize={7}
              fontFamily="monospace">{part.declName || id}</text>
          </g>
        );
      }

      // ── 4×4 matrix keypad ──────────────────────────────────────────
      case 'keypad': {
        const ds = deviceStates?.get(id);
        const pressed = ds?._pressed ?? part.params?.pressed ?? -1;
        // Grid layout: 4 cols × 4 rows, each key 12×12 with 1px gaps
        const KS = 12, KG = 1;
        const gridW = 4 * KS + 3 * KG; // 51
        const gridH = 4 * KS + 3 * KG; // 51
        return (
          <g key={id} transform={xform} onClick={handleClick} style={{ cursor: 'pointer' }}>
            {/* Body */}
            <rect x={-30} y={-35} width={60} height={62} rx={3}
              fill="#e8e0d8" stroke={selStroke || '#999'} strokeWidth={isSelected ? 3 : 1.2} />
            {/* Connector strip */}
            <rect x={-22} y={24} width={44} height={5} rx={1} fill="#666" stroke="#444" strokeWidth={0.3} />
            {/* Key grid */}
            {Array.from({ length: 16 }, (_, i) => {
              const row = Math.floor(i / 4), col = i % 4;
              const kx = -gridW / 2 + col * (KS + KG);
              const ky = -30 + row * (KS + KG);
              const isPressed = pressed === i;
              return (
                <g key={i}>
                  <rect
                    x={kx} y={ky} width={KS} height={KS} rx={2}
                    fill={isPressed ? '#f39c12' : '#ddd'}
                    stroke={isPressed ? '#e67e22' : '#bbb'}
                    strokeWidth={isPressed ? 1.5 : 0.5}
                    style={simulate ? { cursor: 'pointer', pointerEvents: 'all' } : undefined}
                    onMouseDown={simulate && onKeypadKey ? (e) => { e.stopPropagation(); onKeypadKey(id, i); } : undefined}
                    onMouseUp={simulate && onKeypadKey ? (e) => { e.stopPropagation(); onKeypadKey(id, -1); } : undefined}
                    onMouseLeave={simulate && onKeypadKey ? () => onKeypadKey(id, -1) : undefined}
                  />
                  <text x={kx + KS / 2} y={ky + KS / 2 + 3} textAnchor="middle"
                    fill={isPressed ? '#fff' : '#555'} fontSize={7}
                    fontFamily="monospace" fontWeight={isPressed ? 'bold' : 'normal'}
                    style={{ pointerEvents: 'none' }}>
                    {KEYPAD_LABELS[i]}
                  </text>
                </g>
              );
            })}
            {/* Label */}
            <text x={0} y={40} textAnchor="middle" fill="#7f8c8d" fontSize={7}
              fontFamily="monospace">{part.declName || id}</text>
          </g>
        );
      }

      // ── SEVENSEG8: 8-digit 2×4 common-cathode 7-segment display ───
      case 'sevenseg8': {
        const ds = deviceStates?.get(id);
        // Two brightness paths:
        //  A. Per-segment brightness: ds.segBrightness (Float64Array,
        //     8 digits × 8 segments = 64 entries, 0.0–1.0) — used when
        //     the device model provides duty-cycle-averaged brightness
        //     per segment (ISR-scanned multiplexed display).
        //  B. On/off bits: ds.digits[0..7] (Uint8Array, bit 0=a..6=g, 7=dp).
        //     Current bw-board SEVENSEG8 model uses this path.
        const segBr = ds?.segBrightness; // path A
        // Layout: 2 rows × 4 columns (digits 0-3 top, 4-7 bottom)
        const DW = 18, DH = 26;  // per-digit cell
        const DG = 3;            // gap between digits
        const cols = 4, rows = 2;
        const totalW = cols * DW + (cols - 1) * DG; // 81
        const totalH = rows * DH + (rows - 1) * DG; // 55
        // 7-segment geometry within a digit cell (relative to digit top-left)
        const segW = 10, segH = 3; // horizontal segment size
        const segVW = 3, segVH = 8; // vertical segment size
        const ox = (DW - segW) / 2; // x offset to centre horizontals
        const oy = 2;               // top margin
        // Segment path definitions (relative to digit origin):
        //  a = top horizontal, b = top-right vertical, c = bottom-right vertical,
        //  d = bottom horizontal, e = bottom-left vertical, f = top-left vertical,
        //  g = middle horizontal, dp = decimal point
        const segDefs = [
          /* a */ { x: ox, y: oy, w: segW, h: segH },
          /* b */ { x: ox + segW - segVW, y: oy + segH, w: segVW, h: segVH },
          /* c */ { x: ox + segW - segVW, y: oy + segH + segVH + segH, w: segVW, h: segVH },
          /* d */ { x: ox, y: oy + segH + segVH + segH + segVH, w: segW, h: segH },
          /* e */ { x: ox, y: oy + segH + segVH + segH, w: segVW, h: segVH },
          /* f */ { x: ox, y: oy + segH, w: segVW, h: segVH },
          /* g */ { x: ox, y: oy + segH + segVH, w: segW, h: segH },
        ];
        const dpR = 1.5; // decimal point radius
        // Segment color from brightness value (0..1)
        const segColor = (v) => v > 0.05
          ? `rgba(255,${Math.round(40 + 140 * v)},${Math.round(30 * v)},${Math.min(1, 0.25 + 0.75 * v)})`
          : '#1a0000';
        return (
          <g key={id} transform={xform} onClick={handleClick} style={{ cursor: 'pointer' }}>
            {/* Dark PCB body */}
            <rect x={-totalW / 2 - 4} y={-totalH / 2 - 4} width={totalW + 8} height={totalH + 8}
              rx={3} fill="#0a0a0a" stroke={selStroke || '#e74c3c'} strokeWidth={1.5} />
            {Array.from({ length: 8 }, (_, di) => {
              const col = di % cols, row = Math.floor(di / cols);
              const dx = -totalW / 2 + col * (DW + DG);
              const dy = -totalH / 2 + row * (DH + DG);
              const seg = ds ? ds.digits[di] : 0;
              return (
                <g key={di}>
                  {/* Digit background */}
                  <rect x={dx} y={dy} width={DW} height={DH} rx={1}
                    fill="#111" stroke="#222" strokeWidth={0.3} />
                  {/* 7 segments — graded brightness or on/off */}
                  {segDefs.map((s, si) => {
                    let v;
                    if (segBr) {
                      // Path A: per-segment brightness (8 segments per digit)
                      v = ledDisplayLevel(segBr[di * 8 + si] ?? 0);
                    } else {
                      // Path B: on/off from digit bit pattern
                      v = (seg >> si) & 1 ? 1 : 0;
                    }
                    return <rect key={si}
                      x={dx + s.x} y={dy + s.y} width={s.w} height={s.h} rx={0.5}
                      fill={segColor(v)} />;
                  })}
                  {/* Decimal point — graded or on/off */}
                  {(() => {
                    let dpV;
                    if (segBr) {
                      dpV = ledDisplayLevel(segBr[di * 8 + 7] ?? 0);
                    } else {
                      dpV = (seg >> 7) & 1 ? 1 : 0;
                    }
                    return <circle cx={dx + DW - 2} cy={dy + DH - 3} r={dpR}
                      fill={segColor(dpV)} />;
                  })()}
                </g>
              );
            })}
            <text x={0} y={totalH / 2 + 12} textAnchor="middle" fill="#7f8c8d" fontSize={7}
              fontFamily="monospace">{part.declName || id}</text>
          </g>
        );
      }

      // ── JOYSTICK: 2-axis interactive controller pad ────────────────
      case 'joystick': {
        // Params: x (-1..1), y (-1..1), pressed (0/1)
        // Value contract: bw-board joystick device reads part.params.x/y
        // and maps to analog voltage dividers on vrx/vry terminals.
        const px = part.params?.x ?? 0;
        const py = part.params?.y ?? 0;
        const pressed = part.params?.pressed ? true : false;
        const R = 22; // pad radius
        // Thumb position: x maps left-right, y maps up-down (inverted for SVG)
        const thumbX = px * (R - 4);
        const thumbY = -py * (R - 4); // SVG y is down, joystick y is up
        return (
          <g key={id} transform={xform} onClick={handleClick} style={{ cursor: 'pointer' }}>
            {/* Body */}
            <rect x={-28} y={-28} width={56} height={50} rx={4}
              fill="#1a1a2e" stroke={selStroke || '#3498db'} strokeWidth={isSelected ? 3 : 1.5} />
            {/* Pad area */}
            <circle cx={0} cy={0} r={R} fill="#0d1117" stroke="#333" strokeWidth={0.8} />
            {/* Crosshair */}
            <line x1={-R + 2} y1={0} x2={R - 2} y2={0} stroke="#222" strokeWidth={0.5} />
            <line x1={0} y1={-R + 2} x2={0} y2={R - 2} stroke="#222" strokeWidth={0.5} />
            {/* Thumb */}
            <circle cx={thumbX} cy={thumbY} r={5}
              fill={pressed ? '#e74c3c' : '#3498db'} stroke={pressed ? '#c0392b' : '#2980b9'}
              strokeWidth={1.5} fillOpacity={0.9}
              style={simulate && onSetPartParam ? { cursor: 'grab', pointerEvents: 'all' } : undefined}
              onMouseDown={simulate && onSetPartParam ? (e) => {
                e.stopPropagation();
                const svg = e.target.closest('svg');
                if (!svg) return;
                const move = (me) => {
                  const pt = svg.createSVGPoint();
                  pt.x = me.clientX; pt.y = me.clientY;
                  const svgP = pt.matrixTransform(svg.getScreenCTM().inverse());
                  const dx = Math.max(-1, Math.min(1, (svgP.x - x) / (R - 4)));
                  const dy = Math.max(-1, Math.min(1, -(svgP.y - y) / (R - 4)));
                  onSetPartParam(id, 'x', Math.round(dx * 100) / 100);
                  onSetPartParam(id, 'y', Math.round(dy * 100) / 100);
                };
                const up = () => {
                  window.removeEventListener('mousemove', move);
                  window.removeEventListener('mouseup', up);
                  onSetPartParam(id, 'x', 0);
                  onSetPartParam(id, 'y', 0);
                };
                window.addEventListener('mousemove', move);
                window.addEventListener('mouseup', up);
              } : undefined}
            />
            <text x={0} y={30} textAnchor="middle" fill="#7f8c8d" fontSize={7}
              fontFamily="monospace">{part.declName || id}</text>
          </g>
        );
      }

      // ── SLIDER: single-axis interactive controller ─────────────────
      case 'slider': {
        // Params: value (0..1), min/max optional
        // Value contract: slider writes part.params.value (0..1),
        // device maps to wiper position on a resistive divider.
        const val = part.params?.value ?? 0.5;
        const mn = part.params?.min ?? 0;
        const mx = part.params?.max ?? 1;
        const norm = mx > mn ? (val - mn) / (mx - mn) : 0.5;
        const trackH = 40, trackW = 6;
        const thumbY = (1 - norm) * trackH - trackH / 2; // top = max
        return (
          <g key={id} transform={xform} onClick={handleClick} style={{ cursor: 'pointer' }}>
            {/* Body */}
            <rect x={-14} y={-trackH / 2 - 6} width={28} height={trackH + 12} rx={3}
              fill="#1a1a2e" stroke={selStroke || '#27ae60'} strokeWidth={isSelected ? 3 : 1.5} />
            {/* Track */}
            <rect x={-trackW / 2} y={-trackH / 2} width={trackW} height={trackH} rx={2}
              fill="#0d1117" stroke="#333" strokeWidth={0.5} />
            {/* Fill (bottom to thumb) */}
            <rect x={-trackW / 2 + 0.5} y={thumbY} width={trackW - 1}
              height={trackH / 2 - thumbY} rx={1.5} fill="#27ae60" fillOpacity={0.4} />
            {/* Thumb */}
            <rect x={-8} y={thumbY - 3} width={16} height={6} rx={2}
              fill="#27ae60" stroke="#1e8449" strokeWidth={1}
              style={simulate && onSetPartParam ? { cursor: 'ns-resize', pointerEvents: 'all' } : undefined}
              onMouseDown={simulate && onSetPartParam ? (e) => {
                e.stopPropagation();
                const svg = e.target.closest('svg');
                if (!svg) return;
                const move = (me) => {
                  const pt = svg.createSVGPoint();
                  pt.x = me.clientX; pt.y = me.clientY;
                  const svgP = pt.matrixTransform(svg.getScreenCTM().inverse());
                  const rawNorm = 1 - Math.max(0, Math.min(1, (svgP.y - y + trackH / 2) / trackH));
                  const mapped = mn + rawNorm * (mx - mn);
                  onSetPartParam(id, 'value', Math.round(mapped * 100) / 100);
                };
                const up = () => {
                  window.removeEventListener('mousemove', move);
                  window.removeEventListener('mouseup', up);
                };
                window.addEventListener('mousemove', move);
                window.addEventListener('mouseup', up);
              } : undefined}
            />
            {/* Value label */}
            <text x={0} y={trackH / 2 + 12} textAnchor="middle" fill="#7f8c8d" fontSize={7}
              fontFamily="monospace">{part.declName || id}</text>
          </g>
        );
      }

      // ── GAUGE: read-only indicator/meter face ──────────────────────
      case 'gauge': {
        // Reads ds.value (0..1) from device state, or part.params.value
        // as fallback. Renders an arc gauge with a needle.
        const ds = deviceStates?.get(id);
        const val = ds?.value ?? part.params?.value ?? 0;
        const mn = part.params?.min ?? 0;
        const mx = part.params?.max ?? 1;
        const norm = mx > mn ? Math.max(0, Math.min(1, (val - mn) / (mx - mn))) : 0;
        const R = 20; // arc radius
        // Arc from -135° to +135° (270° sweep)
        const startAngle = -135 * Math.PI / 180;
        const sweepAngle = 270 * Math.PI / 180;
        const needleAngle = startAngle + norm * sweepAngle;
        // Arc path for background
        const arcPath = (r, start, end) => {
          const x1 = Math.cos(start) * r, y1 = Math.sin(start) * r;
          const x2 = Math.cos(end) * r, y2 = Math.sin(end) * r;
          const largeArc = (end - start) > Math.PI ? 1 : 0;
          return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
        };
        // Tick marks at 0%, 25%, 50%, 75%, 100%
        const ticks = [0, 0.25, 0.5, 0.75, 1];
        return (
          <g key={id} transform={xform} onClick={handleClick} style={{ cursor: 'pointer' }}>
            {/* Body */}
            <rect x={-28} y={-24} width={56} height={46} rx={4}
              fill="#1a1a2e" stroke={selStroke || '#e67e22'} strokeWidth={isSelected ? 3 : 1.5} />
            {/* Arc track */}
            <path d={arcPath(R, startAngle, startAngle + sweepAngle)}
              fill="none" stroke="#333" strokeWidth={3} strokeLinecap="round" />
            {/* Arc fill (green to red gradient approximation via value) */}
            {norm > 0.01 && (
              <path d={arcPath(R, startAngle, needleAngle)}
                fill="none"
                stroke={norm < 0.6 ? '#2ecc71' : norm < 0.85 ? '#f39c12' : '#e74c3c'}
                strokeWidth={3} strokeLinecap="round" />
            )}
            {/* Tick marks */}
            {ticks.map((t, i) => {
              const a = startAngle + t * sweepAngle;
              return <line key={i}
                x1={Math.cos(a) * (R - 4)} y1={Math.sin(a) * (R - 4)}
                x2={Math.cos(a) * (R + 2)} y2={Math.sin(a) * (R + 2)}
                stroke="#666" strokeWidth={0.8} />;
            })}
            {/* Needle */}
            <line x1={0} y1={0}
              x2={Math.cos(needleAngle) * (R - 2)} y2={Math.sin(needleAngle) * (R - 2)}
              stroke="#e74c3c" strokeWidth={1.5} strokeLinecap="round" />
            <circle cx={0} cy={0} r={2} fill="#e74c3c" />
            {/* Value text */}
            <text x={0} y={14} textAnchor="middle" fill="#bdc3c7" fontSize={7}
              fontFamily="monospace">{typeof val === 'number' ? val.toFixed(2) : val}</text>
            <text x={0} y={28} textAnchor="middle" fill="#7f8c8d" fontSize={7}
              fontFamily="monospace">{part.declName || id}</text>
          </g>
        );
      }

      // ── Graphical mono LCD (EV3 178×128, NXT 100×64) ─────────────
      // Parametric W×H monochrome pixel buffer. The fb is a 1bpp packed
      // row-major buffer (byte 0 bit 7 = pixel (0,0)). Reads from
      // part.params.fb (set via setPartParam from the pump) or
      // deviceStates for engine-driven displays.
      case 'mono_lcd': {
        const ds = deviceStates?.get(id);
        const FW = part.params?.width ?? ds?.width ?? 178;
        const FH = part.params?.height ?? ds?.height ?? 128;
        const fb = ds?.fb ?? part.params?.fb;
        const displayOn = ds?.displayOn !== false && part.params?.displayOn !== false;
        // Scale the native resolution into a compact SVG footprint.
        // The rendered box is fixed at 60×40; the canvas stretches.
        const boxW = 60, boxH = 40;
        return (
          <g key={id} transform={xform} onClick={handleClick} style={{ cursor: 'pointer' }}>
            {/* Case body */}
            <rect x={-boxW/2 - 3} y={-boxH/2 - 3} width={boxW + 6} height={boxH + 16} rx={3}
              fill="#2c3e50" stroke={selStroke || '#95a5a6'} strokeWidth={isSelected ? 3 : 1.5} />
            {/* Screen bezel */}
            <rect x={-boxW/2} y={-boxH/2} width={boxW} height={boxH} rx={1}
              fill={displayOn ? '#a8b8a0' : '#666'} stroke="#555" strokeWidth={0.5} />
            {displayOn && fb && fb.length >= Math.ceil(FW * FH / 8) && (
              <foreignObject x={-boxW/2} y={-boxH/2} width={boxW} height={boxH}>
                <canvas
                  ref={el => {
                    if (!el) return;
                    const rgba = new Uint8ClampedArray(FW * FH * 4);
                    const stride = Math.ceil(FW / 8);
                    for (let y = 0; y < FH; y++) {
                      for (let x = 0; x < FW; x++) {
                        const byteIdx = y * stride + (x >> 3);
                        const bit = 7 - (x & 7); // MSB first
                        const on = (fb[byteIdx] >> bit) & 1;
                        const idx = (y * FW + x) * 4;
                        // Mono LCD: dark green on light green-gray
                        rgba[idx]     = on ? 0x20 : 0xa0;
                        rgba[idx + 1] = on ? 0x30 : 0xb0;
                        rgba[idx + 2] = on ? 0x10 : 0x90;
                        rgba[idx + 3] = 255;
                      }
                    }
                    if (el.width !== FW) el.width = FW;
                    if (el.height !== FH) el.height = FH;
                    el.style.width = `${boxW}px`;
                    el.style.height = `${boxH}px`;
                    el.style.imageRendering = 'pixelated';
                    el.getContext('2d').putImageData(new ImageData(rgba, FW, FH), 0, 0);
                  }}
                  style={{ width: boxW, height: boxH, imageRendering: 'pixelated' }}
                />
              </foreignObject>
            )}
            {!displayOn && (
              <text x={0} y={2} textAnchor="middle" fill="#444" fontSize={6}
                fontFamily="monospace">OFF</text>
            )}
            {/* Resolution label */}
            <text x={0} y={boxH/2 + 4} textAnchor="middle" fill="#7f8c8d" fontSize={5}
              fontFamily="monospace">{FW}×{FH}</text>
            <text x={0} y={boxH/2 + 12} textAnchor="middle" fill="#7f8c8d" fontSize={7}
              fontFamily="monospace">{part.declName || id}</text>
          </g>
        );
      }

      // ── RGB status light (WeDo 2 / Boost single-colour indicator) ──
      case 'rgb_light': {
        const ds = deviceStates?.get(id);
        const r0 = ds?.r ?? part.params?.r ?? 0;
        const g0 = ds?.g ?? part.params?.g ?? 0;
        const b0 = ds?.b ?? part.params?.b ?? 0;
        const on = r0 > 0 || g0 > 0 || b0 > 0;
        const fill = on ? `rgb(${r0},${g0},${b0})` : '#222';
        return (
          <g key={id} transform={xform} onClick={handleClick} style={{ cursor: 'pointer' }}>
            {/* Diffuser body */}
            <circle cx={0} cy={0} r={12}
              fill="#1a1a2e" stroke={selStroke || '#555'} strokeWidth={isSelected ? 3 : 1.5} />
            {/* Lit area */}
            <circle cx={0} cy={0} r={9} fill={fill} />
            {on && (
              <circle cx={0} cy={0} r={9} fill="white" opacity={0.15} />
            )}
            {/* Highlight */}
            <circle cx={-2} cy={-2} r={3} fill="white" opacity={on ? 0.25 : 0.05} />
            <text x={0} y={20} textAnchor="middle" fill="#7f8c8d" fontSize={7}
              fontFamily="monospace">{part.declName || id}</text>
          </g>
        );
      }

      // ── LEDBANK8: 8 discrete LEDs with graded brightness ──────────
      case 'ledbank8': {
        const ds = deviceStates?.get(id);
        // Two brightness paths:
        //  A. Per-LED brightness: ds.brightness (Float64Array(8), 0.0–1.0)
        //     — used when the device model provides duty-cycle-averaged
        //     brightness (e.g. ISR-scanned shared port with SEVENSEG8).
        //  B. On/off: ds.leds (Uint8Array(8), 0/1) — current bw-board
        //     LEDBANK8 model uses this path.
        const br = ds?.brightness; // path A
        const leds = ds?.leds;     // path B
        const N = 8;
        const G = 7;               // gap between LED centres
        const W = N * G, H = 10;   // body dimensions
        return (
          <g key={id} transform={xform} onClick={handleClick} style={{ cursor: 'pointer' }}>
            <rect x={-W / 2 - 3} y={-H / 2 - 3} width={W + 6} height={H + 6} rx={2}
              fill="#1a1a1a" stroke={selStroke || '#27ae60'} strokeWidth={isSelected ? 3 : 1.5} />
            {Array.from({ length: N }, (_, i) => {
              let v;
              if (br) {
                // Path A: per-LED continuous brightness
                v = ledDisplayLevel(br[i] ?? 0);
              } else {
                // Path B: on/off from leds array
                v = leds ? leds[i] : 0;
              }
              const color = v > 0.05
                ? `rgba(255,${Math.round(40 + 140 * v)},${Math.round(30 * v)},${Math.min(1, 0.25 + 0.75 * v)})`
                : '#1a0000';
              return <circle key={i}
                cx={-W / 2 + i * G + G / 2} cy={0} r={3}
                fill={color} />;
            })}
            <text x={0} y={H / 2 + 10} textAnchor="middle" fill="#7f8c8d" fontSize={7}
              fontFamily="monospace">{part.declName || id}</text>
          </g>
        );
      }

      // ── SimpleVGA / TMS9918 video thumbnail ───────────────────────
      // Machine-class video peripherals expose a videoFn callback (via
      // debugState.video). If available, render a compact live thumbnail
      // on the chip body so the display content is visible on the board.
      case 'simplevga_card':
      case 'tms9918': {
        // Fall through to default DIP body when no video available
        if (typeof videoFn !== 'function') break;
        const chipLabel = kind === 'tms9918' ? 'TMS9918' : 'SimpleVGA';
        const vW = 48, vH = 36;
        return (
          <g key={id} transform={xform} onClick={handleClick} style={{ cursor: 'pointer' }}>
            {/* DIP body */}
            <rect x={-30} y={-25} width={60} height={50} rx={3}
              fill="#1a1a2e" stroke={selStroke || '#6a5acd'} strokeWidth={isSelected ? 3 : 1.5} />
            {/* Notch */}
            <circle cx={-30} cy={-15} r={3} fill="#1a1a2e" stroke="#555" strokeWidth={0.5} />
            {/* Video thumbnail */}
            <foreignObject x={-vW / 2} y={-vH / 2 + 2} width={vW} height={vH}>
              <canvas
                ref={el => {
                  if (!el) return;
                  try {
                    const f = videoFn();
                    if (!f || !f.rgba) return;
                    const W = f.width || 256, H = f.height || 192;
                    if (el.width !== W) el.width = W;
                    if (el.height !== H) el.height = H;
                    el.style.width = `${vW}px`;
                    el.style.height = `${vH}px`;
                    el.style.imageRendering = 'pixelated';
                    const ctx = el.getContext('2d');
                    ctx.putImageData(new ImageData(new Uint8ClampedArray(f.rgba.buffer, f.rgba.byteOffset, f.rgba.byteLength), W, H), 0, 0);
                  } catch { /* video not ready */ }
                }}
                style={{ width: vW, height: vH, imageRendering: 'pixelated' }}
              />
            </foreignObject>
            {/* Chip label */}
            <text x={0} y={-20} textAnchor="middle" fill="#888" fontSize={5}
              fontFamily="monospace">{chipLabel}</text>
            <text x={0} y={32} textAnchor="middle" fill="#7f8c8d" fontSize={7}
              fontFamily="monospace">{part.declName || id}</text>
          </g>
        );
      }

      // ── Logic gates ────────────────────────────────────────────────
      case 'gate_and':
      case 'gate_nand':
        return (
          <g key={id} transform={xform} onClick={handleClick} style={{ cursor: 'pointer' }}>
            <path d="M -10 -14 L -10 14 L 0 14 A 14 14 0 0 0 0 -14 Z"
              fill="#1a1a2e" stroke={selStroke || '#3498db'} strokeWidth={1.5} />
            {kind === 'gate_nand' && <circle cx={16} cy={0} r={3} fill="#1a1a2e" stroke={selStroke || '#3498db'} strokeWidth={1.5} />}
            <text x={0} y={22} textAnchor="middle" fill="#7f8c8d" fontSize={7}
              fontFamily="monospace">{part.declName || id}</text>
          </g>
        );
      case 'gate_or':
      case 'gate_nor':
        return (
          <g key={id} transform={xform} onClick={handleClick} style={{ cursor: 'pointer' }}>
            <path d="M -12 -14 Q -4 0 -12 14 Q 4 14 14 0 Q 4 -14 -12 -14 Z"
              fill="#1a1a2e" stroke={selStroke || '#2ecc71'} strokeWidth={1.5} />
            {kind === 'gate_nor' && <circle cx={16} cy={0} r={3} fill="#1a1a2e" stroke={selStroke || '#2ecc71'} strokeWidth={1.5} />}
            <text x={0} y={22} textAnchor="middle" fill="#7f8c8d" fontSize={7}
              fontFamily="monospace">{part.declName || id}</text>
          </g>
        );
      case 'gate_xor':
        return (
          <g key={id} transform={xform} onClick={handleClick} style={{ cursor: 'pointer' }}>
            <path d="M -14 -14 Q -6 0 -14 14" fill="none" stroke={selStroke || '#9b59b6'} strokeWidth={1.5} />
            <path d="M -12 -14 Q -4 0 -12 14 Q 4 14 14 0 Q 4 -14 -12 -14 Z"
              fill="#1a1a2e" stroke={selStroke || '#9b59b6'} strokeWidth={1.5} />
            <text x={0} y={22} textAnchor="middle" fill="#7f8c8d" fontSize={7}
              fontFamily="monospace">{part.declName || id}</text>
          </g>
        );
      case 'gate_not':
        return (
          <g key={id} transform={xform} onClick={handleClick} style={{ cursor: 'pointer' }}>
            <path d="M -12 -12 L -12 12 L 10 0 Z"
              fill="#1a1a2e" stroke={selStroke || '#e74c3c'} strokeWidth={1.5} />
            <circle cx={14} cy={0} r={3} fill="#1a1a2e" stroke={selStroke || '#e74c3c'} strokeWidth={1.5} />
            <text x={0} y={22} textAnchor="middle" fill="#7f8c8d" fontSize={7}
              fontFamily="monospace">{part.declName || id}</text>
          </g>
        );

      case 'ps2': {
        // PS/2 keyboard connector — 2 terminals (data + clock), not a DIP.
        const bw = 40, bh = 25;
        return (
          <g key={id} transform={xform} onClick={handleClick} style={{ cursor: 'pointer' }}>
            <rect x={-bw / 2} y={-bh / 2} width={bw} height={bh} rx={4}
              fill="#2c2c3e" stroke={selStroke || '#6a5acd'} strokeWidth={isSelected ? 3 : 1.5} />
            <text x={0} y={-2} textAnchor="middle" fill="#b0b8ff" fontSize={7}
              fontFamily="monospace" fontWeight="bold">PS/2</text>
            <text x={0} y={8} textAnchor="middle" fill="#666" fontSize={5}
              fontFamily="monospace">KBD</text>
            <text x={0} y={bh / 2 + 10} textAnchor="middle" fill="#7f8c8d" fontSize={7}
              fontFamily="monospace">{part.declName || id}</text>
          </g>
        );
      }
      default: {
        // Generic DIP body for retro/logic ICs that have sidecars.
        // Pin-1-bottom convention: left column (pin 1 side) at bottom row,
        // right column at top row. Notch at left end, pin-1 dot bottom-left.
        const dipLabel = DIP_CHIP_LABELS[kind];
        if (dipLabel) {
          // Friendly-name kinds may share a sidecar with the real IC name
          // (e.g. shift_register → 74hc595).
          const SIDECAR_ALIAS = { shift_register: '74hc595' };
          const scKey = SIDECAR_ALIAS[kind] || kind;
          const sc = typeof getSidecar === 'function' ? (getSidecar(scKey) || getSidecar(kind)) : null;
          if (sc && sc.terminals && sc.terminals.length > 2) {
            const pinCount = sc.terminals.length;
            const positions = dipTerminalPositions(sc);
            const { w: bodyW, h: bodyH } = dipPackageGeometry(sc);
            return (
              <g key={id} transform={xform} onClick={handleClick} style={{ cursor: 'pointer' }}
                data-dip-body={kind} data-dip-label={dipLabel}>
                {/* DIP package body */}
                <rect x={-bodyW / 2} y={-bodyH / 2} width={bodyW} height={bodyH} rx={3}
                  fill="#1a1a1a" stroke={selStroke || '#555'} strokeWidth={isSelected ? 3 : 1.5} />
                {/* Notch at left end — pin-1-bottom: the wrap-around is at the left */}
                <path d={`M ${-bodyW / 2} -5 A 5 5 0 0 1 ${-bodyW / 2} 5`}
                  fill="#2c3e50" stroke={selStroke || '#666'} strokeWidth={0.8} />
                {/* Pin 1 dot — bottom-left, near first pin of left column */}
                <circle cx={-bodyW / 2 + 8} cy={bodyH / 2 - 7} r={2} fill="#666" />
                {/* Label */}
                <text x={0} y={-2} textAnchor="middle" fill="#ccc" fontSize={8}
                  fontFamily="monospace" fontWeight="bold">{dipLabel}</text>
                <text x={0} y={9} textAnchor="middle" fill="#777" fontSize={6}
                  fontFamily="monospace">DIP-{pinCount}</text>
                {/* Pin legs + sidecar labels */}
                {sc.terminals.map(t => {
                  const pos = positions[t.name];
                  if (!pos) return null;
                  const isVCC = /^(VCC|AVCC|VDD)$/i.test(t.name);
                  const isGND = /^(GND|VSS)$/i.test(t.name);
                  const legCol = isVCC ? '#c0392b' : isGND ? '#2c2c2c' : '#b0b8c0';
                  const padCol = isVCC ? '#e74c3c' : isGND ? '#444' : '#d8dee4';
                  return (
                    <g key={t.name}>
                      {(isVCC || isGND) && <title>{isVCC ? 'VCC — connect to +5 V rail' : 'GND — connect to ground rail'}</title>}
                      <line x1={pos.dx} y1={pos.dy < 0 ? -bodyH / 2 : bodyH / 2}
                        x2={pos.dx} y2={pos.dy}
                        stroke={legCol} strokeWidth={2} />
                      <rect x={pos.dx - 3} y={pos.dy - 1.5} width={6} height={3}
                        fill={padCol} stroke={isVCC ? '#c0392b' : isGND ? '#333' : '#8090a0'} strokeWidth={0.3} />
                      <text x={pos.dx} y={pos.dy + (pos.dy < 0 ? -6 : 10)}
                        textAnchor="middle" fill={isVCC ? '#e74c3c' : isGND ? '#777' : '#94a3b8'} fontSize={3.0}
                        fontFamily="monospace" fontWeight={isVCC || isGND ? 'bold' : 'normal'}>{t.name}</text>
                    </g>
                  );
                })}
                {/* Part name below */}
                <text x={0} y={bodyH / 2 + 12} textAnchor="middle" fill="#7f8c8d" fontSize={7}
                  fontFamily="monospace">{part.declName || id}</text>
              </g>
            );
          }
        }
        return null;
      }
    }
  });
}

// ── Terminal dots (clickable for wiring) ─────────────────────────

/**
 * What each STC12C5A60S2 pin supports — shown in the pin chooser so the
 * choice is informed, not guessed. Datasheet-grounded: P1 is the ADC (P1.3/
 * P1.4 double as PCA/PWM), P3 carries UART/interrupts/timers, P3.0/P3.1 are
 * also the ISP bootloader pins, P0/P2 are the external bus, reset is ACTIVE
 * HIGH, and the chip runs from its internal RC when no crystal is fitted.
 */
const STC12_PIN_INFO = {
  'P1.0': 'ADC0 — analog in', 'P1.1': 'ADC1 — analog in',
  'P1.2': 'ADC2 · ECI (PCA clock in)', 'P1.3': 'ADC3 · CCP0 (PCA/PWM)',
  'P1.4': 'ADC4 · CCP1 (PCA/PWM)', 'P1.5': 'ADC5', 'P1.6': 'ADC6', 'P1.7': 'ADC7',
  'P3.0': 'RxD — serial in (also ISP; avoid if flashing)',
  'P3.1': 'TxD — serial out (also ISP; avoid if flashing)',
  'P3.2': 'INT0 — external interrupt', 'P3.3': 'INT1 — external interrupt',
  'P3.4': 'T0 — timer 0 input', 'P3.5': 'T1 — timer 1 input',
  'P3.6': 'WR — ext. bus write', 'P3.7': 'RD — ext. bus read',
  'P0.0': 'AD0 — bus / I/O', 'P0.1': 'AD1', 'P0.2': 'AD2', 'P0.3': 'AD3',
  'P0.4': 'AD4', 'P0.5': 'AD5', 'P0.6': 'AD6', 'P0.7': 'AD7 — bus / I/O',
  'P2.0': 'A8 — bus / I/O', 'P2.1': 'A9', 'P2.2': 'A10', 'P2.3': 'A11',
  'P2.4': 'A12', 'P2.5': 'A13', 'P2.6': 'A14', 'P2.7': 'A15 — bus / I/O',
  'P4.4': 'plain I/O', 'P4.5': 'plain I/O', 'P4.6': 'EX_LVD/RST2', 'P4.7': 'plain I/O',
  RST: 'reset — ACTIVE HIGH', VCC: '+5 V supply (pin 40)', GND: 'ground (pin 20)',
  XTAL1: 'crystal in (internal RC works without one)', XTAL2: 'crystal out',
};

/**
 * Board pin descriptions preserve the sidecar's audit state. A null function
 * list is explicitly shown as unaudited; an empty list is an audited pin with
 * no alternates.
 */
function pinInfoForPart(part, pin) {
  const normalized = String(pin).toUpperCase();
  if (part.kind === 'mcu') return STC12_PIN_INFO[normalized] || '';
  if (/GND|VCC|5V|3V3|VIN|AREF|RESET|VBUS|VSYS|RUN|AGND|SWD/.test(normalized)) {
    return 'power/control';
  }
  const functions = getPinFunctionsForPart(part.kind).find(item => item.name === pin)?.functions || [];
  if (functions === null) return 'GPIO (?) — alternates not audited';
  if (Array.isArray(functions)) {
    if (functions.includes('analog_only')) return 'analog input only';
    const alternates = functions.filter(name => name !== 'gpio');
    return alternates.length ? `GPIO · ${alternates.join(' · ').toUpperCase()}` : 'GPIO only';
  }
  return '';
}

function terminalSupplyRole(part, terminal) {
  const term = String(terminal || '').toLowerCase();
  if (part?.kind === 'vcc') return 'positive';
  if (part?.kind === 'gnd') return 'ground';
  if (part?.kind === 'vsource') return term === 'pos' ? 'positive' : term === 'neg' ? 'ground' : null;
  if (/^(gnd\d*|agnd|swd_gnd|vss)$/.test(term)) return 'ground';
  if (/^(vcc|avcc|vdd|5v|3v3|vin|vbus|vsys)$/.test(term)) return 'positive';
  return null;
}

function TerminalDots({ parts, wires, wiringFrom, onTerminalClick, onTerminalDown, onTerminalUp, placingProbe, selectedParts, hoveredPart }) {
  const connected = new Set();
  for (const w of wires) {
    connected.add(`${w.from.part}:${w.from.terminal}`);
    connected.add(`${w.to.part}:${w.to.terminal}`);
  }

  // When wiring, all potential targets should glow
  const isWiring = !!wiringFrom;
  const sourcePart = wiringFrom ? parts.find(part => part.id === wiringFrom.part) : null;
  const sourceSupplyRole = sourcePart ? terminalSupplyRole(sourcePart, wiringFrom.terminal) : null;

  const dots = [];
  for (const part of parts) {
    const isPartActive = selectedParts?.has(part.id) || hoveredPart === part.id;
    for (const term of part.terminals) {
      const pos = terminalPos(part, term);
      const isSource = wiringFrom &&
        wiringFrom.part === part.id && wiringFrom.terminal === term;
      const isConnected = connected.has(`${part.id}:${term}`);
      const isSamePart = wiringFrom && wiringFrom.part === part.id;
      const isValidTarget = isWiring && !isSource && !isSamePart;
      const targetSupplyRole = terminalSupplyRole(part, term);
      const isSupplyConflict = isValidTarget && sourceSupplyRole && targetSupplyRole && sourceSupplyRole !== targetSupplyRole;

      // A SEATED terminal IS a breadboard hole. The hole is already visible;
      // a permanent ring + name label on every leg is what buried the first
      // example under chrome (owner screenshot, 2026-08-10). Seated legs
      // surface only while they are live wiring/probe targets.
      const isSeated = !!(part._seatTerminals && part._seatTerminals[term]);
      if (isSeated && !isWiring && !placingProbe && !isSource && !isPartActive) continue;
      // A DIP chip labels its own pins on the body; forty 8px rings at a
      // ~15px pitch drew as an unreadable red chain down both sides (owner
      // screenshot). Many-pin parts surface terminals only while wiring.
      const manyPins = part.terminals.length > 12;
      if (manyPins && !isWiring && !placingProbe && !isSource && !isConnected && !isPartActive) continue;

      // Sizes: large enough to tap on a tablet (minimum 10px radius)
      let fill, stroke, r, opacity;
      if (isSource) {
        fill = '#f1c40f'; stroke = '#f39c12'; r = 12; opacity = 1;
      } else if (isSupplyConflict) {
        fill = '#ef4444'; stroke = '#991b1b'; r = 11; opacity = 1;
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
      if (isSeated) r = Math.min(r, 6);
      if (manyPins) r = Math.min(r, 5);

      dots.push(
        <g key={`${part.id}:${term}`}>
          {isSupplyConflict && <title>Danger: this directly connects a positive supply to ground</title>}
          {/* Invisible large hit area for touch */}
          <circle
            cx={pos.x} cy={pos.y} r={Math.max(r, 16)}
            fill="transparent"
            style={{ pointerEvents: 'none' }}
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
              fill="none" stroke={isSupplyConflict ? '#ef4444' : '#2ecc71'} strokeWidth={1.5}
              opacity={0.5} strokeDasharray="3,3"
              style={{ pointerEvents: 'none' }}
            />
          )}
          {/* Terminal label — free parts only; a seated leg's name would
              stamp itself over the board art */}
          {!isConnected && !isSeated && !manyPins && (
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

/** Endpoint position for part-terminal OR breadboard-hole endpoints. */
function endpointWorld(parts, e) {
  if (!e) return null;
  if (e.board) {
    const bb = parts.find(q => q.id === e.board);
    return bb ? holeWorldPos(bb, e.hole) : null;
  }
  const pp = parts.find(q => q.id === e.part);
  return pp ? terminalPos(pp, e.terminal) : null;
}

/** A wire's net id, resolving breadboard endpoints through the strip map. */
function wireNetId(circuit, wire) {
  if (wire.netId) return wire.netId;
  if (!circuit || !circuit.boardStripNets || !circuit.breadboards) return null;
  for (const e of [wire.from, wire.to]) {
    if (!e || !e.board) continue;
    const strips = circuit.breadboards.get(e.board);
    const map = circuit.boardStripNets.get(e.board);
    if (strips && map) {
      const id = map.get(strips.stripOf(e.hole));
      if (id) return id;
    }
  }
  return null;
}

function quadraticPoints(a, control, b, steps = 16) {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps, u = 1 - t;
    return {
      x: u * u * a.x + 2 * u * t * control.x + t * t * b.x,
      y: u * u * a.y + 2 * u * t * control.y + t * t * b.y,
    };
  });
}

/** Shared visible/hit geometry for an ordinary free wire. */
function freeWireCurve(wire, a, b) {
  let hash = 0;
  for (const ch of wire.id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const lift = Math.min(30, Math.max(10, dist * 0.14)) * (hash % 2 ? 1 : -1) * (1 + (hash % 3) * 0.35);
  const nx = -(b.y - a.y) / (dist || 1), ny = (b.x - a.x) / (dist || 1);
  const control = { x: (a.x + b.x) / 2 + nx * lift, y: (a.y + b.y) / 2 + ny * lift };
  return {
    path: `M ${a.x} ${a.y} Q ${control.x} ${control.y} ${b.x} ${b.y}`,
    points: quadraticPoints(a, control, b),
  };
}

/** Approximate the tap renderer's column-gap staple for pointer hits. */
function tapWireHitPoints(a, b) {
  const sx = b.x >= a.x ? 1 : -1;
  const gapX = a.x + sx * (BB_PITCH / 2);
  return [a, { x: gapX, y: a.y }, { x: gapX, y: b.y }, b];
}

/** Shared centre-line points for a rendered breadboard jumper. */
function jumperHitPoints(bb, a, b, index) {
  if (Math.abs(b.x - a.x) <= 4 * BB_PITCH) {
    const lift = Math.max(12, Math.hypot(b.x - a.x, b.y - a.y) * 0.2);
    const control = { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - lift };
    return quadraticPoints(a, control, b);
  }
  const o = bbHoleOrigin(bb);
  const topBlock = (y) => y < (o.topRowsY + o.bottomRowsY) / 2;
  const offset = (index % 4) * 4;
  let laneY;
  if (topBlock(a.y) && topBlock(b.y)) laneY = o.topRowsY - 12 - offset;
  else if (!topBlock(a.y) && !topBlock(b.y)) laneY = o.bottomRowsY + 4 * BB_PITCH + 12 + offset;
  else laneY = (o.topRowsY + 4 * BB_PITCH + o.bottomRowsY) / 2 + (offset - 6);
  return [a, { x: a.x, y: laneY }, { x: b.x, y: laneY }, b];
}

function Wires({ wires, parts, circuit, selectedWire, onSelectWire, hoveredNet, onHoverNet, nodeVoltages, voltageMode, onUpdateWire, screenToCanvas, setDraggingWaypoint }) {
  // Group wires by net to find all terminals in each net
  const netTerminals = new Map();
  for (const w of wires) {
    if (!netTerminals.has(w.netId)) netTerminals.set(w.netId, new Set());
    const set = netTerminals.get(w.netId);
    set.add(`${w.from.part}:${w.from.terminal}`);
    set.add(`${w.to.part}:${w.to.terminal}`);
  }

  // ── Cross-board wire bundling ──────────────────────────────────
  // Group wires that span two different boards into corridor bundles.
  // Each bundle routes as parallel straight paths through the gap
  // between the two boards, like a real bus harness.
  const bundleOffsets = new Map(); // wireId → offset within its corridor
  {
    const corridors = new Map(); // "boardA:boardB" → [wireId, ...]
    for (const w of wires) {
      if (isBoardEndpoint(w.from) || isBoardEndpoint(w.to)) continue;
      const fp = parts.find(p => p.id === w.from.part);
      const tp = parts.find(p => p.id === w.to.part);
      if (!fp || !tp) continue;
      if (!fp.seat?.boardId || !tp.seat?.boardId) continue;
      if (fp.seat.boardId === tp.seat.boardId) continue;
      // Canonical key: sorted board IDs so A→B and B→A share a corridor
      const key = [fp.seat.boardId, tp.seat.boardId].sort().join(':');
      if (!corridors.has(key)) corridors.set(key, []);
      corridors.get(key).push(w.id);
    }
    for (const group of corridors.values()) {
      if (group.length < 2) continue; // single wires keep default arc
      // Lanes ordered by GEOMETRY, not by wire id: id-sorted lanes gave
      // a wire at x=100 lane -8 and its neighbor at x=105 lane +8, so
      // every pair CROSSED inside the corridor — the owner's green comb
      // on the 6502 bench. Sorting by midpoint x makes the harness lie
      // parallel, like real hookup wire combed into a bundle.
      const mid = (id) => {
        const w = wires.find(q => q.id === id);
        const fp = parts.find(p => p.id === w.from.part);
        const tp = parts.find(p => p.id === w.to.part);
        const a = fp ? terminalPos(fp, w.from.terminal) : null;
        const b = tp ? terminalPos(tp, w.to.terminal) : null;
        return a && b ? (a.x + b.x) / 2 : 0;
      };
      group.sort((p, q) => mid(p) - mid(q));
      const spacing = 4; // pixels between parallel wires
      const half = (group.length - 1) / 2;
      for (let i = 0; i < group.length; i++) {
        bundleOffsets.set(group[i], (i - half) * spacing);
      }
    }
  }

  return wires.map(wire => {
    // Board-connected tap wires are drawn by the dedicated tap-wire layer.
    // A board hole is not a part terminal; rendering it here as well creates
    // a second bogus straight path alongside the real curved tap wire.
    if (isBoardEndpoint(wire.from) || isBoardEndpoint(wire.to)) return null;

    const fromPart = parts.find(p => p.id === wire.from.part);
    const toPart = parts.find(p => p.id === wire.to.part);
    if (!fromPart || !toPart) return null;

    // Between two parts seated on the SAME board, the strips and the
    // generated hole jumpers ARE the visible connection — drawing the
    // logical wire too painted a 40-wire bus as an arc hairball over the
    // board (owner screenshots, 2026-08-16). Likewise a power symbol
    // feeding a seated pin: the rail jumper tells that story. The wire
    // stays in the model (electrical truth); only its rendering yields.
    const seatedSameBoard = fromPart.seat && toPart.seat &&
      fromPart.seat.boardId === toPart.seat.boardId;
    const powerToSeated =
      ((fromPart.kind === 'vcc' || fromPart.kind === 'gnd') && toPart.seat) ||
      ((toPart.kind === 'vcc' || toPart.kind === 'gnd') && fromPart.seat);
    if ((seatedSameBoard || powerToSeated) && selectedWire !== wire.id) return null;

    const a = terminalPos(fromPart, wire.from.terminal);
    const b = terminalPos(toPart, wire.to.terminal);
    let pathD;
    if (wire.waypoints && wire.waypoints.length > 0) {
      pathD = routeWireWithWaypoints(a, b, wire.waypoints);
    } else if (bundleOffsets.has(wire.id)) {
      // ── Corridor bundle path ─────────────────────────────────
      // Route as a tidy parallel path through the gap between boards,
      // like a real bus harness. Detects whether boards are separated
      // vertically or horizontally and routes through the appropriate gap.
      const offset = bundleOffsets.get(wire.id);
      const boardA = parts.find(p => p.id === fromPart.seat?.boardId);
      const boardB = parts.find(p => p.id === toPart.seat?.boardId);
      if (boardA && boardB) {
        const dx = Math.abs(boardB.x - boardA.x);
        const dy = Math.abs(boardB.y - boardA.y);
        const r = 6; // corner radius — hard 90° corners read as PCB traces,
        //              rounded ones as hookup wire (same as the staples)
        if (dy >= dx) {
          // Boards stacked vertically: route through the Y gap
          const corridorY = (boardA.y + boardB.y) / 2 + offset;
          const sy = corridorY > a.y ? 1 : -1;      // corridor below or above a
          const sx = b.x > a.x ? 1 : -1;
          if (Math.abs(b.x - a.x) < 2 * r) {
            pathD = `M ${a.x} ${a.y} L ${a.x} ${corridorY} L ${b.x} ${corridorY} L ${b.x} ${b.y}`;
          } else {
            pathD = `M ${a.x} ${a.y} L ${a.x} ${corridorY - sy * r}` +
              ` Q ${a.x} ${corridorY} ${a.x + sx * r} ${corridorY}` +
              ` L ${b.x - sx * r} ${corridorY}` +
              ` Q ${b.x} ${corridorY} ${b.x} ${corridorY + (b.y > corridorY ? r : -r)}` +
              ` L ${b.x} ${b.y}`;
          }
        } else {
          // Boards side by side: route through the X gap
          const corridorX = (boardA.x + boardB.x) / 2 + offset;
          const sx = corridorX > a.x ? 1 : -1;
          const sy = b.y > a.y ? 1 : -1;
          if (Math.abs(b.y - a.y) < 2 * r) {
            pathD = `M ${a.x} ${a.y} L ${corridorX} ${a.y} L ${corridorX} ${b.y} L ${b.x} ${b.y}`;
          } else {
            pathD = `M ${a.x} ${a.y} L ${corridorX - sx * r} ${a.y}` +
              ` Q ${corridorX} ${a.y} ${corridorX} ${a.y + sy * r}` +
              ` L ${corridorX} ${b.y - sy * r}` +
              ` Q ${corridorX} ${b.y} ${corridorX + (b.x > corridorX ? r : -r)} ${b.y}` +
              ` L ${b.x} ${b.y}`;
          }
        }
      } else {
        // Fallback: straight line with offset
        const dist = Math.hypot(b.x - a.x, b.y - a.y);
        const nx = -(b.y - a.y) / (dist || 1), ny = (b.x - a.x) / (dist || 1);
        pathD = `M ${a.x} ${a.y} Q ${(a.x + b.x) / 2 + nx * offset} ${(a.y + b.y) / 2 + ny * offset} ${b.x} ${b.y}`;
      }
    } else {
      // Single wires: jumper-style arcs with hash-derived curvature
      pathD = freeWireCurve(wire, a, b).path;
    }
    const isSelected = selectedWire === wire.id;
    const isHovered = hoveredNet && hoveredNet === wire.netId;

    // Wire color by voltage: red at VCC, blue near GND, green/yellow in between
    let voltageColor = '#2ecc71'; // default green
    const v = nodeVoltages?.[wire.netId ?? wireNetId(circuit, wire)];
    if (v != null && typeof v === 'number') {
      const vcc = 5.0;
      const ratio = Math.max(0, Math.min(1, v / vcc));
      if (ratio > 0.8) voltageColor = '#e74c3c';      // red: near VCC
      else if (ratio > 0.4) voltageColor = '#f39c12';  // orange: mid-high
      else if (ratio > 0.15) voltageColor = '#2ecc71'; // green: mid
      else voltageColor = '#3498db';                    // blue: near GND
    }

    // Voltage view: voltage-keyed color wins over author colors (the
    // whole point of the mode). Otherwise the author's color, with a
    // neutral fallback while simulating (green stays the build-mode
    // default so unpowered canvases look unchanged).
    const baseColor = voltageMode ? voltageColor
      : (wire.color || (nodeVoltages ? '#8b98a9' : voltageColor));
    const wireColor = isSelected ? '#f1c40f' : isHovered ? '#9b59b6' : baseColor;
    const wireWidth = isSelected ? 3 : isHovered ? 2.5 : 2;

    return (
      <g key={wire.id} data-wire={wire.id}>
        {/* Invisible wider hit area */}
        <path
          d={pathD}
          stroke="transparent"
          strokeWidth={10}
          fill="none"
          style={{ cursor: 'pointer' }}
          pointerEvents="none"
          onDoubleClick={(e) => {
            // Add a waypoint at the click position
            e.stopPropagation();
            if (onUpdateWire) {
              const container = e.currentTarget.closest('[data-canvas]');
              if (container) {
                const pos = screenToCanvas(e.clientX, e.clientY, container);
                const wps = [...(wire.waypoints || [])];
                // Insert at nearest segment position
                const pts = [a, ...wps, b];
                let bestIdx = wps.length; // default: append before end
                let bestDist = Infinity;
                for (let i = 0; i < pts.length - 1; i++) {
                  const mx = (pts[i].x + pts[i + 1].x) / 2;
                  const my = (pts[i].y + pts[i + 1].y) / 2;
                  const d = (pos.x - mx) ** 2 + (pos.y - my) ** 2;
                  if (d < bestDist) { bestDist = d; bestIdx = i; }
                }
                wps.splice(bestIdx, 0, { x: pos.x, y: pos.y });
                onUpdateWire(wire.id, { waypoints: wps });
              }
            }
          }}
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
        {/* Waypoint handles (visible when wire is selected) */}
        {isSelected && wire.waypoints && wire.waypoints.map((wp, wi) => (
          <circle
            key={`wp-${wi}`}
            cx={wp.x} cy={wp.y} r={5}
            fill="#f1c40f" stroke="#2c3e50" strokeWidth={1.5}
            style={{ cursor: 'move' }}
            onMouseDown={(e) => {
              e.stopPropagation();
              setDraggingWaypoint({ wireId: wire.id, index: wi });
            }}
            onDoubleClick={(e) => {
              // Double-click waypoint to remove it
              e.stopPropagation();
              if (onUpdateWire) {
                const wps = wire.waypoints.filter((_, i) => i !== wi);
                onUpdateWire(wire.id, { waypoints: wps.length > 0 ? wps : undefined });
              }
            }}
          />
        ))}
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

function VoltageLabels({ wires, parts, nodeVoltages, circuit }) {
  if (!nodeVoltages) return null;
  // One pill per net, anchored to the net's MOST VISIBLE conductor (its
  // longest wire or jumper), with a leader line touching the wire — the
  // first draft dropped pills at ambiguous midpoints and skipped every
  // net whose first wire had a breadboard endpoint (owner screenshot:
  // orphaned 5.0V pills in empty space, interesting nets unlabeled).
  const best = new Map(); // netId → {len, mx, my, ax, ay}
  const consider = (netId, a, b, lift) => {
    if (!netId) return;
    const v = nodeVoltages[netId];
    if (v == null) return;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const cur = best.get(netId);
    if (cur && cur.len >= len) return;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 - (lift || 0);
    best.set(netId, {len, mx, my, v});
  };
  for (const wire of wires) {
    const a = endpointWorld(parts, wire.from);
    const b = endpointWorld(parts, wire.to);
    if (!a || !b) continue;
    consider(wire.netId ?? wireNetId(circuit, wire), a, b, 0);
  }
  if (circuit && circuit.holeWires && circuit.boardStripNets && circuit.breadboards) {
    for (const jw of circuit.holeWires()) {
      const bb = parts.find(q => q.id === jw.boardId);
      const strips = circuit.breadboards.get(jw.boardId);
      const map = circuit.boardStripNets.get(jw.boardId);
      if (!bb || !strips || !map) continue;
      const netId = map.get(strips.stripOf(jw.a));
      const a = holeWorldPos(bb, jw.a), b = holeWorldPos(bb, jw.b);
      if (!a || !b) continue;
      consider(netId, a, b, Math.max(18, Math.hypot(b.x - a.x, b.y - a.y) * 0.25));
    }
  }
  const fmtV = (v) => Math.abs(v) < 1 ? `${(v * 1000).toFixed(0)}mV` : `${v.toFixed(1)}V`;
  return [...best.entries()].map(([netId, c]) => (
    <g key={`vl-${netId}`} pointerEvents="none">
      {/* leader: pill → wire midpoint, so the label is unambiguous */}
      <line x1={c.mx} y1={c.my - 16} x2={c.mx} y2={c.my} stroke="#f1c40f" strokeWidth={1} strokeDasharray="2 2" opacity={0.85} />
      <circle cx={c.mx} cy={c.my} r={2.2} fill="#f1c40f" />
      <g transform={`translate(${c.mx}, ${c.my - 24})`}>
        <rect x={-23} y={-9} width={46} height={16} rx={3} fill="#0a0a1a" fillOpacity={0.88} />
        <text textAnchor="middle" y={3.5} fill="#f1c40f" fontSize={10}
          fontFamily="monospace" fontWeight="bold">{fmtV(c.v)}</text>
      </g>
    </g>
  ));
}

// ── Wokwi element layer ─────────────────────────────────────────

function WokwiParts({ parts, ledBrightness, buzzerTones, meterReadings, cubeScans, onSelectPart, selectedParts, onControlChange, onButtonDown, onButtonUp, onKeypadKey, onDragStart, onHoverPart, onPartBodyClick, onDoubleClick, simulate, deviceStates, sevenSegments, sevenSeg3, controlValues }) {
  return parts.map(part => {
    const { id, kind, params, x, y } = part;
    const rot = part.rotation || 0;
    const flip = part.flipped;
    const isSelected = selectedParts?.has(id);
    const transforms = [];
    if (rot) transforms.push(`rotate(${rot}deg)`);
    if (flip) transforms.push('scaleX(-1)');
    const baseStyle = {
      position: 'absolute',
      outline: isSelected ? '2px solid #f1c40f' : 'none',
      borderRadius: '4px',
      transform: transforms.length > 0 ? transforms.join(' ') : undefined,
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
      case 'resistor': {
        // For seated resistors, span the Wokwi element across the actual
        // seat hole positions so the body aligns with the breadboard grid
        // instead of rendering at a fixed offset that looks ghostly/tiny.
        const rSeated = part.seat && part._seatTerminals;
        const rLeft = rSeated ? Math.min(part._seatTerminals.a?.x ?? x, part._seatTerminals.b?.x ?? x) : x - 30;
        const rWidth = rSeated ? Math.abs((part._seatTerminals.b?.x ?? x) - (part._seatTerminals.a?.x ?? x)) + 10 : undefined;
        return (
          <div key={id}
            style={{ ...baseStyle, left: rSeated ? rLeft - 5 : x - 30, top: y - 6, cursor: 'move',
              ...(rSeated && rWidth ? { width: rWidth } : {}) }}
            onClick={(e) => { e.stopPropagation(); onSelectPart(id, e.shiftKey); }}
            {...dragProps()}>
            <WokwiResistor value={String(params.ohms)} />
            <div style={{ textAlign: 'center', color: '#667', fontSize: 9, fontFamily: 'monospace', opacity: 0.8 }}>
              {partLabel(part)}
            </div>
          </div>
        );
      }
      case 'led': {
        const b = ledBrightness?.(id) ?? 0;
        const isOn = b > 0.01;
        const seated = !!part.seat;
        // The wokwi element's anode PIN is on the RIGHT (x=25 of 40); a bench
        // seat usually puts the anode in the LEFT hole. Unflipped, the bulb
        // graphic reads as mirrored/shifted against its own holes and the
        // owner read it as "LED not connected to the resistor". Flip to match
        // the seat, and anchor the PIN ROW (y=42 in the element) to the hole
        // row rather than centering the box.
        const st = part._seatTerminals;
        const flip = !!(seated && st && st.anode && st.cathode && st.anode.x < st.cathode.x);
        return (
          <div key={id}
            style={{ ...baseStyle, left: x - 20, top: y - 25, cursor: 'move' }}
            onClick={(e) => { e.stopPropagation(); onSelectPart(id, e.shiftKey); }}
            {...dragProps()}>
            <div style={seated ? { transform: 'scale(0.78)', transformOrigin: '50% 50%' } : undefined}>
            <WokwiLed color={(params && params.color) || 'red'} brightness={b} value={isOn} flip={flip || undefined} />
            </div>
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
      case 'keypad_4x4': {
        // Interactive 4x4 keypad: each key is a real press — mouse-down sets
        // the device's `pressed` param (the engine stamps a 0.1 ohm
        // row-to-column bridge, the same physics the A2 bench measured),
        // mouse-up releases it. Outside simulate mode the pad drags.
        // HTML overlay layer: this renderer's cases are absolutely
        // positioned divs, not SVG (an SVG <g> here renders nothing — found
        // by the Playwright acceptance, 2026-08-18).
        const KP_LABELS = ['1','2','3','A','4','5','6','B','7','8','9','C','*','0','#','D'];
        const kpPressed = part.params?.pressed ?? -1;
        const KS = 15, KG = 3;
        const KW = 4 * KS + 3 * KG;
        return (
          <div key={id}
            data-keypad={id}
            style={{ ...baseStyle, left: x - KW / 2 - 5, top: y - KW / 2 - 5,
              width: KW + 10, padding: 5, background: '#1b2733',
              border: '1.5px solid #345', borderRadius: 4,
              cursor: simulate ? 'default' : 'move',
              pointerEvents: 'auto',
              display: 'grid', gridTemplateColumns: `repeat(4, ${KS}px)`, gap: KG }}
            onClick={simulate ? (e) => e.stopPropagation() : (e) => { e.stopPropagation(); onSelectPart(id, e.shiftKey); }}
            onMouseDown={simulate ? undefined : (e) => { e.stopPropagation(); onDragStart(id); }}>
            {KP_LABELS.map((lbl, k) => {
              const down = kpPressed === k;
              return (
                <div key={k}
                  // Pointer capture: the press survives the re-render the
                  // engine bump triggers (a mouseleave-based release fired on
                  // React's redraw and released the key instantly — found by
                  // the Playwright acceptance, 2026-08-18).
                  onPointerDown={(e) => { e.stopPropagation(); if (simulate && onKeypadKey) { e.currentTarget.setPointerCapture(e.pointerId); onKeypadKey(id, k); } }}
                  onPointerUp={(e) => { e.stopPropagation(); if (simulate && onKeypadKey) onKeypadKey(id, -1); }}
                  onPointerCancel={() => { if (simulate && onKeypadKey) onKeypadKey(id, -1); }}
                  style={{ width: KS, height: KS, borderRadius: 2, userSelect: 'none',
                    background: down ? '#e74c3c' : '#37475a',
                    border: '1px solid #0d1520',
                    color: down ? '#fff' : '#ccdddd',
                    font: '9px monospace', display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                    cursor: simulate ? 'pointer' : 'grab' }}>
                  {lbl}
                </div>
              );
            })}
          </div>
        );
      }
      case 'potentiometer': {
        // When seated, scale and position the Wokwi element so its three
        // drawn pin graphics land exactly on the seat's three holes.
        // The Wokwi pot element is ~60px wide with pins at ~10/30/50px.
        // Seat holes are at BB_PITCH intervals (14px): cols 0/2/4 = 0/28/56px.
        const potSeated = part.seat && part._seatTerminals;
        let potLeft = x - 30, potTop = y - 30, potScale;
        if (potSeated) {
          const aPos = part._seatTerminals.a;
          const bPos = part._seatTerminals.b;
          if (aPos && bPos) {
            const seatSpan = Math.abs(bPos.x - aPos.x);
            // The Wokwi element's internal pin span is ~40px (10px to 50px in a 60px body)
            potScale = seatSpan / 40;
            const cx = (aPos.x + bPos.x) / 2;
            const cy = aPos.y;
            potLeft = cx - 30 * potScale;
            potTop = cy - 50 * potScale; // pins are near the bottom of the 60px body
          }
        }
        return (
          <div key={id}
            style={{ ...baseStyle, left: potLeft, top: potTop,
              ...(potScale ? { transform: `scale(${potScale})`, transformOrigin: 'top left' } : {}),
              cursor: simulate ? 'pointer' : 'move',
              pointerEvents: simulate ? 'auto' : 'none' }}
            onClick={simulate ? (e) => e.stopPropagation() : (e) => { e.stopPropagation(); onSelectPart(id, e.shiftKey); }}
            onContextMenu={simulate ? (e) => e.preventDefault() : undefined}>
            <WokwiPotentiometer
              min={0} max={1} step={0.01} value={controlValues?.get(id) ?? 0.5}
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
      }
      case 'buzzer': {
        const tone = buzzerTones?.(id);
        return (
          <div key={id}
            style={{ ...baseStyle, left: x - 20, top: y - 20, cursor: 'move' }}
            onClick={(e) => { e.stopPropagation(); onSelectPart(id, e.shiftKey); }}
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
        // Sim mode: pointer events ON so press/release fires the engine
        // pin edge. Build mode: pointer events OFF so the breadboard
        // drag-select layer handles interaction.
        return (
          <div key={id}
            style={{ ...baseStyle, left: x - 18, top: y - 18,
              cursor: simulate ? 'pointer' : 'move',
              pointerEvents: simulate ? 'auto' : 'none' }}
            onClick={simulate ? (e) => { e.stopPropagation(); } : (e) => { e.stopPropagation(); onSelectPart(id, e.shiftKey); }}
            onMouseDown={(e) => { e.stopPropagation(); if (simulate) onButtonDown(id); else onDragStart(id); }}
            onMouseUp={() => { if (simulate) onButtonUp(id); }}
            onMouseLeave={() => { if (simulate) onButtonUp(id); }}
            onContextMenu={simulate ? (e) => e.preventDefault() : undefined}>
            <WokwiPushbutton color={(params && params.color) || 'red'} />
            <div style={{ textAlign: 'center', color: '#667', fontSize: 9, fontFamily: 'monospace', opacity: 0.8 }}>
              {partLabel(part)}
            </div>
          </div>
        );
      case 'diode':
      case 'zener': {
        // Diode symbol: triangle (anode→cathode) + bar at cathode.
        // Zener adds angled ticks on the bar.
        const dsel = selectedParts?.has(id);
        const isZener = kind === 'zener';
        return (
          <div key={id} style={{ ...baseStyle, left: x - 22, top: y - 12 }}>
            <svg width={44} height={24} viewBox="-22 -12 44 24">
              {/* Anode lead */}
              <line x1={-20} y1={0} x2={-6} y2={0} stroke="#95a5a6" strokeWidth={2} />
              {/* Diode triangle (pointing right → current flow direction) */}
              <polygon points="-6,-8 -6,8 6,0" fill="#2c3e50"
                stroke={dsel ? '#f1c40f' : '#555'} strokeWidth={1.5} strokeLinejoin="round" />
              {/* Cathode bar */}
              <line x1={6} y1={-8} x2={6} y2={8}
                stroke={dsel ? '#f1c40f' : '#95a5a6'} strokeWidth={2} />
              {isZener && <>
                {/* Zener ticks on bar ends */}
                <line x1={6} y1={-8} x2={3} y2={-10} stroke="#95a5a6" strokeWidth={1.5} />
                <line x1={6} y1={8} x2={9} y2={10} stroke="#95a5a6" strokeWidth={1.5} />
              </>}
              {/* Cathode lead */}
              <line x1={6} y1={0} x2={20} y2={0} stroke="#95a5a6" strokeWidth={2} />
              {/* Cathode band marker (like a real diode package) */}
              <rect x={14} y={-5} width={3} height={10} rx={0.5} fill="#95a5a6" opacity={0.6} />
            </svg>
          </div>
        );
      }
      case 'capacitor': {
        const csel = selectedParts?.has(id);
        return (
          <div key={id} style={{ ...baseStyle, left: x - 18, top: y - 16 }}>
            <svg width={36} height={32} viewBox="-18 -16 36 32">
              <line x1={-17} y1={0} x2={-9} y2={0} stroke="#95a5a6" strokeWidth={2} />
              <line x1={9} y1={0} x2={17} y2={0} stroke="#95a5a6" strokeWidth={2} />
              <rect x={-9} y={-14} width={18} height={28} rx={3}
                fill="#1a5276" stroke={csel ? '#f1c40f' : '#154360'} strokeWidth={2} />
              <rect x={3} y={-14} width={5} height={28} fill="#d5d8dc" opacity={0.85} />
              <line x1={-9} y1={-9} x2={9} y2={-9} stroke="#154360" strokeWidth={1.5} />
            </svg>
          </div>
        );
      }
      case 'seven_segment': {
        const segDigits = part.params?.digits || 1;
        // Wokwi element dimensions (mm → px via mmToPix=3.78):
        // width = 12.55 * digits mm, height = 22mm (pins='none')
        const segElW = 12.55 * segDigits * 3.78;
        const segElH = 22 * 3.78;
        // Seated scaling: the part straddles the gutter (pins a on row e,
        // b on row f). Scale the element so it spans the actual pin gap.
        const segSeated = part.seat && part._seatTerminals;
        // Non-seated: centre horizontally, keep the old tuned y offset
        let segLeft = x - segElW / 2, segTop = y - 35, segScale;
        if (segSeated) {
          const aPos = part._seatTerminals.a;
          const bPos = part._seatTerminals.b;
          if (aPos && bPos) {
            const pinSpanY = Math.abs(bPos.y - aPos.y);
            segScale = pinSpanY / segElH;
            const cx = (aPos.x + bPos.x) / 2;
            const cy = (aPos.y + bPos.y) / 2;
            segLeft = cx - (segElW / 2) * segScale;
            segTop = cy - (segElH / 2) * segScale;
          }
        }
        return (
          <div key={id}
            style={{ ...baseStyle, left: segLeft, top: segTop, cursor: 'move',
              ...(segScale ? { transform: `scale(${segScale})`, transformOrigin: 'top left' } : {}) }}
            onClick={(e) => { e.stopPropagation(); onSelectPart(id, e.shiftKey); }}
            {...dragProps()}>
            <WokwiSevenSegment digits={segDigits} values={(() => {
              // REAL segments from the engine — the face reads
              // sevenSegmentBrightness per digit. Multi-digit parts
              // would need per-digit engine support (${id}_d0 etc.);
              // until then, digit 0 shows the engine's answer and
              // remaining digits stay blank.
              const segKeys = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'];
              const vals = new Array(8 * segDigits).fill(0);
              const seg = sevenSegments?.(id);
              if (seg) {
                for (let k = 0; k < segKeys.length; k++) {
                  vals[k] = seg[segKeys[k]] > 0.2 ? 1 : 0;
                }
              }
              return vals;
            })()} color="#e74c3c" pins="none" />
            <div style={{ textAlign: 'center', color: '#667', fontSize: 9, fontFamily: 'monospace', opacity: 0.8 }}>
              {partLabel(part)}
            </div>
          </div>
        );
      }
      case 'seven_seg_3': case 'seven_seg_4': {
        // Multiplexed display, 3 digits (056SMG-3) or 4 (the A2's tube).
        // Uses the engine's sevenSeg3Brightness(id, n) → n×{a..dp}.
        const segN = kind === 'seven_seg_4' ? 4 : 3;
        const seg3ElW = 12.55 * segN * 3.78;
        const seg3ElH = 22 * 3.78;
        const seg3Seated = part.seat && part._seatTerminals;
        let seg3Left = x - seg3ElW / 2, seg3Top = y - 35, seg3Scale;
        if (seg3Seated) {
          const aPos = part._seatTerminals.a;
          const bPos = part._seatTerminals.com0 || part._seatTerminals.b;
          if (aPos && bPos) {
            const pinSpanY = Math.abs(bPos.y - aPos.y);
            seg3Scale = pinSpanY / seg3ElH;
            const cx = (aPos.x + bPos.x) / 2;
            const cy = (aPos.y + bPos.y) / 2;
            seg3Left = cx - (seg3ElW / 2) * seg3Scale;
            seg3Top = cy - (seg3ElH / 2) * seg3Scale;
          }
        }
        return (
          <div key={id}
            style={{ ...baseStyle, left: seg3Left, top: seg3Top, cursor: 'move',
              ...(seg3Scale ? { transform: `scale(${seg3Scale})`, transformOrigin: 'top left' } : {}) }}
            onClick={(e) => { e.stopPropagation(); onSelectPart(id, e.shiftKey); }}
            {...dragProps()}>
            <WokwiSevenSegment digits={segN} values={(() => {
              const segKeys = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'];
              const vals = new Array(8 * segN).fill(0);
              const digits = sevenSeg3?.(id, segN);
              if (digits && Array.isArray(digits)) {
                for (let d = 0; d < segN; d++) {
                  const seg = digits[d];
                  if (!seg) continue;
                  for (let k = 0; k < segKeys.length; k++) {
                    vals[d * 8 + k] = seg[segKeys[k]] > 0.2 ? 1 : 0;
                  }
                }
              }
              return vals;
            })()} color="#e74c3c" pins="none" />
            <div style={{ textAlign: 'center', color: '#667', fontSize: 9, fontFamily: 'monospace', opacity: 0.8 }}>
              {partLabel(part)}
            </div>
          </div>
        );
      }
      case 'char_lcd':
      case 'hd44780':
      case 'char_lcd_i2c': {
        // Wokwi LCD1602 screenOnly dimensions (mm → px):
        // panelWidth = 16 cols × 3.5125 mm ≈ 56.2mm ≈ 212px
        // panelHeight = 2 rows × 5.75mm ≈ 11.5mm ≈ 43px
        const lcdElW = 16 * 3.5125 * 3.78;
        const lcdElH = 2 * 5.75 * 3.78;
        const lcdSeated = part.seat && part._seatTerminals;
        let lcdLeft = x - 60, lcdTop = y - 25, lcdScale;
        if (lcdSeated) {
          // The 4-bit footprint has 6 leads (rs, e, d4-d7) spanning
          // 5 column gaps. Scale the screen panel so its width matches
          // the pin span, and position it centred above the pin row.
          const st = part._seatTerminals;
          const xs = Object.values(st).map(p => p.x);
          const ys = Object.values(st).map(p => p.y);
          const pinSpanX = Math.max(...xs) - Math.min(...xs);
          const pinCx = (Math.min(...xs) + Math.max(...xs)) / 2;
          const pinY = Math.min(...ys); // pin row
          // Scale-to-pin-span suits the PARALLEL module (6 leads span
          // wide); the I2C backpack has 4 pins over 3 gaps and shrank
          // the whole 16x2 panel to an unreadable ~50px bar (owner:
          // 'we see NOTHING on the LCD' — the text was there, at 2px).
          // A real LCD1602 is 80x36 mm — it DWARFS its connector. Full
          // panel scale reads as one column per character (~16 columns
          // wide); 0.55 was still 'very tiny, not a real face, two pin
          // rows tall' (owner, build 7a4feb0). The PCB face below makes
          // it a module, not a floating text strip.
          lcdScale = part.kind === 'char_lcd_i2c'
            ? 1.0
            : Math.max(0.25, pinSpanX / lcdElW);
          lcdLeft = pinCx - (lcdElW / 2) * lcdScale;
          // Sit the screen just above the pin row
          lcdTop = pinY - lcdElH * lcdScale - 2;
        }
        return (
          <div key={id}
            style={{ ...baseStyle, left: lcdLeft, top: lcdTop, cursor: 'move',
              ...(lcdScale ? { transform: `scale(${lcdScale})`, transformOrigin: 'top left' } : {}) }}
            onClick={(e) => { e.stopPropagation(); onSelectPart(id, e.shiftKey); }}
            {...dragProps()}>
            {(() => {
              const ds = deviceStates?.get(id);
              // Parallel LCD models expose .text, the I2C backpack model
              // exposes .display — same rows-of-chars idea, two spellings.
              const rows = ds && (ds.text || ds.display);
              // V0 is physical now: the model reports contrast 0..1 from
              // VDD−V0, and only the CHARACTERS fade — the backlight and
              // glass stay, exactly like turning the real trimmer.
              const c = ds && typeof ds.contrast === 'number' ? ds.contrast : 1;
              // Backlight: parallel LCD gives 0..1 float from A-K current,
              // I2C gives boolean.  Wokwi element takes boolean.
              const bl = !ds || ds.backlight === undefined ? true
                : typeof ds.backlight === 'number' ? ds.backlight > 0.1
                : !!ds.backlight;
              const screen = <WokwiLcd1602 text={rows ? rows.join('\n') : ''}
                color={`rgba(16,24,16,${c.toFixed(3)})`}
                backlight={bl}
                pins="none" screenOnly={true} />;
              // The I2C module gets its PCB: green board, mounting holes,
              // the backpack silk — a display MODULE, not a bare glass
              // strip hovering over the bench (owner, build 7a4feb0).
              if (part.kind !== 'char_lcd_i2c') return screen;
              return (
                <div style={{ background: '#1a6a2a', border: '1px solid #0e4a1a',
                  borderRadius: 4, padding: '7px 10px 5px', position: 'relative',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>
                  {[[2, 2], [2, null], [null, 2], [null, null]].map(([t, l], i) => (
                    <div key={i} style={{ position: 'absolute', width: 5, height: 5,
                      borderRadius: '50%', background: '#0b3d17',
                      border: '1px solid #d4af37',
                      top: t != null ? t : undefined, bottom: t == null ? 2 : undefined,
                      left: l != null ? l : undefined, right: l == null ? 2 : undefined }} />
                  ))}
                  {screen}
                  <div style={{ textAlign: 'center', color: '#a7f3d0', fontSize: 7,
                    fontFamily: 'monospace', opacity: 0.85, marginTop: 1 }}>
                    LCD1602 · I²C {(part.params && part.params.address) ? `0x${Number(part.params.address).toString(16)}` : '0x27'}
                  </div>
                </div>
              );
            })()}
            <div style={{ textAlign: 'center', color: '#667', fontSize: 9, fontFamily: 'monospace', opacity: 0.8 }}>
              {partLabel(part)}
            </div>
          </div>
        );
      }
      case 'ir_receiver':
        return (
          <div key={id}
            style={{ ...baseStyle, left: x - 15, top: y - 15, cursor: 'move' }}
            onClick={(e) => { e.stopPropagation(); onSelectPart(id, e.shiftKey); }}
            {...dragProps()}>
            <WokwiIrReceiver />
            <div style={{ textAlign: 'center', color: '#667', fontSize: 9, fontFamily: 'monospace', opacity: 0.8 }}>
              {partLabel(part)}
            </div>
          </div>
        );
      case 'led_matrix':
      case 'temp_sensor':
      case 'eeprom':
        // Generic IC rendering for parts without wokwi elements
        // (shift_register now renders as DIP-16 body via SvgParts)
        return (
          <div key={id}
            style={{ ...baseStyle, left: x - 25, top: y - 15, cursor: 'move' }}
            onClick={(e) => { e.stopPropagation(); onSelectPart(id, e.shiftKey); }}
            {...dragProps()}>
            <svg width={50} height={30} viewBox="0 0 50 30">
              <rect x={2} y={2} width={46} height={26} rx={3} fill="#2c3e50" stroke="#7f8c8d" strokeWidth={1} />
              <text x={25} y={18} textAnchor="middle" fill="#ecf0f1" fontSize={8} fontFamily="monospace">
                {kind === 'led_matrix' ? '8×8' : kind === 'temp_sensor' ? '18B20' : 'IC'}
              </text>
            </svg>
            <div style={{ textAlign: 'center', color: '#667', fontSize: 9, fontFamily: 'monospace', opacity: 0.8 }}>
              {partLabel(part)}
            </div>
          </div>
        );
      case 'led_cube': {
        // 4x4x4 bi-colour LED cube — voxel map unknown until measured
        // Use scan history from cubeScans prop if available, otherwise test pattern
        const scanData = cubeScans?.[id] || testPattern();
        const voxels = computeCubeVoxels(scanData);
        return (
          <div key={id}
            style={{ ...baseStyle, left: x - 50, top: y - 50, cursor: 'move' }}
            onClick={(e) => { e.stopPropagation(); onSelectPart(id, e.shiftKey); }}
            {...dragProps()}>
            <svg width={100} height={100} viewBox="0 0 100 100">
              <rect x={0} y={0} width={100} height={100} rx={4}
                fill="#0a0a1a" stroke="#7f8c8d" strokeWidth={1} />
              <text x={50} y={10} textAnchor="middle" fill="#7f8c8d"
                fontSize={6} fontFamily="monospace">4×4×4 CUBE</text>
              {/* 8x8 grid of voxels — (select, bit) pairs */}
              {voxels.map((v, i) => {
                const gx = 8 + (v.bit % 8) * 11;
                const gy = 15 + v.select * 10;
                const mapped = VOXEL_MAP[v.select]?.[v.bit];
                return (
                  <g key={i}>
                    <rect x={gx} y={gy} width={9} height={8} rx={1}
                      fill={v.brightness > 0.01
                        ? `rgba(46, 204, 113, ${Math.min(1, v.brightness * 8)})`
                        : '#1a1a2e'}
                      stroke="#2c3e50" strokeWidth={0.5}
                    />
                    <text x={gx + 4.5} y={gy + 6} textAnchor="middle"
                      fill={v.brightness > 0.01 ? '#fff' : '#333'}
                      fontSize={mapped ? 4 : 3.5} fontFamily="monospace">
                      {v.label}
                    </text>
                  </g>
                );
              })}
              <text x={50} y={98} textAnchor="middle" fill="#556"
                fontSize={4} fontFamily="monospace">
                positions unknown — needs probe.c
              </text>
            </svg>
          </div>
        );
      }
      case 'vsource': {
        const vsel = selectedParts?.has(id);
        const stroke = vsel ? '#f1c40f' : null;
        const variant = String(part.params?.variant ?? (part.params?.wave && part.params.wave !== 'dc' ? 'fg' : '9v'));
        let inner;
        if (variant === '9v') {
          inner = (
            <svg width={48} height={84} viewBox="-24 -46 48 84">
              <rect x={-20} y={-30} width={40} height={60} rx={4}
                fill="#2c3e50" stroke={stroke || '#1b2631'} strokeWidth={2} />
              <rect x={-20} y={-8} width={40} height={30} fill="#f4d03f" />
              <text x={0} y={12} textAnchor="middle" fill="#1b2631" fontSize={12}
                fontFamily="monospace" fontWeight="bold">{part.params?.volts ?? 9}V</text>
              <circle cx={-9} cy={-36} r={4.5} fill="#d5d8dc" stroke="#95a5a6" strokeWidth={1.5} />
              <circle cx={9} cy={-36} r={3.2} fill="#d5d8dc" stroke="#95a5a6" strokeWidth={1.5} />
              <text x={-9} y={-42} textAnchor="middle" fill="#e74c3c" fontSize={8} fontFamily="monospace">+</text>
              <text x={9} y={-42} textAnchor="middle" fill="#7f8c8d" fontSize={8} fontFamily="monospace">-</text>
            </svg>
          );
        } else if (variant === 'aa') {
          inner = (
            <svg width={64} height={26} viewBox="-32 -13 64 26">
              <rect x={-27} y={-9} width={50} height={18} rx={7}
                fill="#b03a2e" stroke={stroke || '#7b241c'} strokeWidth={2} />
              <rect x={-27} y={-9} width={16} height={18} rx={7} fill="#d5d8dc" />
              <rect x={23} y={-4} width={5} height={8} rx={2} fill="#d5d8dc" stroke="#95a5a6" />
              <text x={0} y={4} textAnchor="middle" fill="#fdfefe" fontSize={8}
                fontFamily="monospace" fontWeight="bold">AA {part.params?.volts ?? 1.5}V</text>
            </svg>
          );
        } else if (variant === 'coin') {
          inner = (
            <svg width={40} height={40} viewBox="-20 -20 40 40">
              <circle cx={0} cy={0} r={18} fill="#d5d8dc" stroke={stroke || '#95a5a6'} strokeWidth={2.5} />
              <circle cx={0} cy={0} r={13} fill="#e8eaed" />
              <text x={0} y={3} textAnchor="middle" fill="#5d6d7e" fontSize={7}
                fontFamily="monospace" fontWeight="bold">CR {part.params?.volts ?? 3}V</text>
            </svg>
          );
        } else {
          const wave = String(part.params?.wave ?? 'sine');
          const glyph = wave === 'square' ? 'M -12 3 L -12 -3 L -4 -3 L -4 3 L 4 3 L 4 -3 L 12 -3'
            : wave === 'triangle' ? 'M -12 3 L -6 -3 L 0 3 L 6 -3 L 12 3'
            : wave === 'pulse' ? 'M -12 3 L -12 -3 L -7 -3 L -7 3 L 12 3'
            : 'M -12 0 Q -9 -6 -6 0 T 0 0 T 6 0 T 12 0';
          inner = (
            <svg width={52} height={56} viewBox="-26 -26 52 56">
              <rect x={-24} y={-24} width={48} height={48} rx={5}
                fill="#34495e" stroke={stroke || '#2c3e50'} strokeWidth={2} />
              <rect x={-24} y={24} width={10} height={4} rx={2} fill="#2c3e50" />
              <rect x={14} y={24} width={10} height={4} rx={2} fill="#2c3e50" />
              <rect x={-18} y={-18} width={36} height={16} rx={2} fill="#0d1420" />
              <path d={glyph} fill="none" stroke="#2ecc71" strokeWidth={1.6}
                strokeLinecap="round" transform="translate(0,-10) scale(1.1,0.9)" />
              <circle cx={-10} cy={10} r={5} fill="#22313f" stroke="#5d6d7e" strokeWidth={1.5} />
              <line x1={-10} y1={10} x2={-7} y2={6} stroke="#aeb6bf" strokeWidth={1.5} />
              <circle cx={10} cy={10} r={5} fill="#22313f" stroke="#5d6d7e" strokeWidth={1.5} />
              <line x1={10} y1={10} x2={13} y2={7} stroke="#aeb6bf" strokeWidth={1.5} />
              <text x={0} y={22} textAnchor="middle" fill="#7f8c8d" fontSize={6} fontFamily="monospace">
                {`${part.params?.freq ?? 1000} Hz`}
              </text>
            </svg>
          );
        }
        const box = variant === '9v' ? { w: 48, h: 84, dy: 46 }
          : variant === 'aa' ? { w: 64, h: 26, dy: 13 }
          : variant === 'coin' ? { w: 40, h: 40, dy: 20 }
          : { w: 52, h: 56, dy: 26 };
        return (
          <div key={id} style={{ ...baseStyle, left: x - box.w / 2, top: y - box.dy }}>
            {inner}
          </div>
        );
      }
      case 'meter': {
        const mode = params.mode || 'voltage';
        const mr = meterReadings?.[id] || { value: '---', unit: mode === 'voltage' ? 'V' : mode === 'current' ? 'mA' : 'Ω', note: null };
        const displayColor = mr.value === '---' ? '#556' : mr.note ? '#f39c12' : '#2ecc71';
        return (
          <div key={id}
            style={{ ...baseStyle, left: x - 35, top: y - 25, cursor: 'move' }}
            onClick={(e) => { e.stopPropagation(); onSelectPart(id, e.shiftKey); }}
            {...dragProps()}>
            <svg width={70} height={55} viewBox="0 0 70 55">
              <rect x={2} y={2} width={66} height={38} rx={4}
                fill="#1a1a0e" stroke="#f1c40f" strokeWidth={1.5} />
              <rect x={6} y={6} width={58} height={18} rx={2} fill="#0a0a0a" />
              <text x={35} y={19} textAnchor="middle" fill={displayColor}
                fontSize={11} fontFamily="monospace" fontWeight="bold">
                {mr.note || `${mr.value} ${mr.unit}`}
              </text>
              <text x={35} y={34} textAnchor="middle" fill="#f1c40f"
                fontSize={8} fontFamily="monospace">
                {mode === 'voltage' ? 'V' : mode === 'current' ? 'A' : 'Ω'}
              </text>
              <circle cx={20} cy={49} r={3} fill="#e74c3c" stroke="#c0392b" strokeWidth={1} />
              <text x={20} y={53} textAnchor="middle" fill="#e74c3c" fontSize={5}>A</text>
              <circle cx={50} cy={49} r={3} fill="#2c3e50" stroke="#7f8c8d" strokeWidth={1} />
              <text x={50} y={53} textAnchor="middle" fill="#7f8c8d" fontSize={5}>B</text>
            </svg>
          </div>
        );
      }
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

// ── Breadboard substrate: hole grid drawn from the same lattice the
//    snapper uses, so what snaps is what you see ───────────────────
function BreadboardSubstrate({ part }) {
  const origin = bbHoleOrigin(part);
  const cols = 63;
  const rows = [];
  // Rails (2 top, 2 bottom) and the 2×5 terminal rows.
  for (const r of [0, 1]) rows.push({ y: origin.railTopY + r * BB_PITCH, rail: true });
  for (let r = 0; r < 5; r++) rows.push({ y: origin.topRowsY + r * BB_PITCH });
  for (let r = 0; r < 5; r++) rows.push({ y: origin.bottomRowsY + r * BB_PITCH });
  for (const r of [0, 1]) rows.push({ y: origin.railBottomY + r * BB_PITCH, rail: true });
  const fp = FOOTPRINTS.breadboard;
  return (
    <g style={{ pointerEvents: 'none' }}>
      <rect x={part.x - fp.w / 2} y={part.y - fp.h / 2} width={fp.w} height={fp.h}
        rx={10} fill="#e8e4d8" stroke="#b8b4a8" strokeWidth={2} />
      {/* rail stripes */}
      <line x1={part.x - fp.w / 2 + 12} y1={origin.railTopY - 8} x2={part.x + fp.w / 2 - 12} y2={origin.railTopY - 8} stroke="#e74c3c" strokeWidth={2} />
      <line x1={part.x - fp.w / 2 + 12} y1={origin.railTopY + BB_PITCH + 8} x2={part.x + fp.w / 2 - 12} y2={origin.railTopY + BB_PITCH + 8} stroke="#3498db" strokeWidth={2} />
      <line x1={part.x - fp.w / 2 + 12} y1={origin.railBottomY - 8} x2={part.x + fp.w / 2 - 12} y2={origin.railBottomY - 8} stroke="#e74c3c" strokeWidth={2} />
      <line x1={part.x - fp.w / 2 + 12} y1={origin.railBottomY + BB_PITCH + 8} x2={part.x + fp.w / 2 - 12} y2={origin.railBottomY + BB_PITCH + 8} stroke="#3498db" strokeWidth={2} />
      {rows.map((row, ri) => (
        <g key={ri}>
          {Array.from({ length: cols }, (_, c) => (
            (!row.rail || (c % 6 !== 5)) && (
              <circle key={c} cx={origin.x + c * BB_PITCH} cy={row.y} r={2.2}
                fill="#2c3e50" opacity={0.75} />
            )
          ))}
        </g>
      ))}
    </g>
  );
}

// ── File menu (inside the ⋯ overflow) ─────────────────────────────
// Four top-level actions: Load, Save, Import ▸, Export ▸.
// Format variants live on 2nd-level submenus, never top level.
// Clear is a destructive op, kept separate at the bottom.

function FileMenu({ circuit, lang, onLoad, onSave, onImport, onClear, onDone, fileAction, onFileActionDone }) {
  const [sub, setSub] = useState(null); // 'import' | 'export' | null

  // Respond to main-menu File/ events: open the right submenu
  React.useEffect(() => {
    if (fileAction === 'import' || fileAction === 'export') {
      setSub(fileAction);
      if (onFileActionDone) onFileActionDone();
    }
  }, [fileAction, onFileActionDone]);
  const de = /^de/i.test(lang);
  const itemStyle = { display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 10px', background: 'none', border: 'none', color: '#e2e8f0', fontSize: 12, fontFamily: 'system-ui, sans-serif', cursor: 'pointer', borderRadius: 3, textAlign: 'left' };
  const itemHover = (e) => { e.currentTarget.style.background = '#1e293b'; };
  const itemLeave = (e) => { e.currentTarget.style.background = 'none'; };
  const subStyle = { ...itemStyle, paddingLeft: 24, fontSize: 11, color: '#94a3b8' };

  // Import needs a file picker — driven by a hidden <input>.
  const fileRef = useRef(null);
  const pendingFormat = useRef(null);

  const handleImportFile = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file || !onImport) return;
    let text;
    try { text = await file.text(); } catch { return; }
    // Auto-detect or use the forced format
    const { detectFormat } = await import('../importers/detect.js');
    const { importCircuit } = await import('../importers/index.js');
    const format = pendingFormat.current || detectFormat(text, file.name);
    if (!format) return;
    const r = importCircuit(format, text);
    if (r.parts.length) onImport({ parts: r.parts, wires: r.wires });
    if (onDone) onDone();
    e.target.value = '';
  }, [onImport, onDone]);

  const pickImport = (formatId) => {
    pendingFormat.current = formatId || null;
    if (fileRef.current) {
      fileRef.current.accept = formatId
        ? { eagle: '.sch', kicad: '.net,.xml', json: '.json' }[formatId] || '*'
        : '.sch,.net,.xml,.json';
      fileRef.current.click();
    }
  };

  // Export uses the existing logic from ExportNetlistMenu.
  const handleExport = useCallback(async (formatId) => {
    if (!circuit) return;
    const { extractNetlist } = await import('../model/netlist.js');
    const { downloadText } = await import('../model/exporters/download.js');
    const netlist = extractNetlist(circuit);
    switch (formatId) {
      case 'spice': {
        const { toSpice } = await import('../model/exporters/spice.js');
        const { text } = toSpice(netlist);
        downloadText(text, 'circuit.cir');
        break;
      }
      case 'kicad': {
        const { toKicadNet } = await import('../model/exporters/kicad.js');
        downloadText(toKicadNet(netlist), 'circuit.net');
        break;
      }
      case 'easyeda': {
        const { toEasyEDA } = await import('../model/exporters/easyeda.js');
        const { text } = toEasyEDA(netlist);
        downloadText(text, 'circuit-for-easyeda.net');
        break;
      }
    }
    if (onDone) onDone();
  }, [circuit, onDone]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={handleImportFile} />
      {/* Load / Open */}
      {onLoad && (
        <button onClick={() => { onLoad(); if (onDone) onDone(); }} onMouseEnter={itemHover} onMouseLeave={itemLeave} style={itemStyle}>
          <span style={{ width: 16, textAlign: 'center' }}>📂</span> {de ? 'Öffnen' : 'Open'}
        </button>
      )}
      {/* Save */}
      {onSave && (
        <button onClick={() => { onSave(); if (onDone) onDone(); }} onMouseEnter={itemHover} onMouseLeave={itemLeave} style={itemStyle}>
          <span style={{ width: 16, textAlign: 'center' }}>💾</span> {de ? 'Speichern' : 'Save'}
        </button>
      )}
      {/* Import ▸ (submenu) */}
      {onImport && (
        <>
          <button onClick={() => setSub(sub === 'import' ? null : 'import')} onMouseEnter={itemHover} onMouseLeave={itemLeave}
            style={{ ...itemStyle, justifyContent: 'space-between' }}>
            <span><span style={{ width: 16, display: 'inline-block', textAlign: 'center' }}>📥</span> Import</span>
            <span style={{ fontSize: 10, color: '#64748b' }}>{sub === 'import' ? '▾' : '▸'}</span>
          </button>
          {sub === 'import' && (
            <div>
              <button onClick={() => pickImport(null)} onMouseEnter={itemHover} onMouseLeave={itemLeave} style={subStyle}>
                {de ? 'Datei (automatisch)' : 'File (auto-detect)'}
              </button>
              <button onClick={() => pickImport('eagle')} onMouseEnter={itemHover} onMouseLeave={itemLeave} style={subStyle}>
                EAGLE schematic (.sch)
              </button>
              <button onClick={() => pickImport('kicad')} onMouseEnter={itemHover} onMouseLeave={itemLeave} style={subStyle}>
                KiCad netlist (.net/.xml)
              </button>
              <button onClick={() => pickImport('json')} onMouseEnter={itemHover} onMouseLeave={itemLeave} style={subStyle}>
                Diagram (.json)
              </button>
            </div>
          )}
        </>
      )}
      {/* Export ▸ (submenu) */}
      {circuit && (
        <>
          <button onClick={() => setSub(sub === 'export' ? null : 'export')} onMouseEnter={itemHover} onMouseLeave={itemLeave}
            style={{ ...itemStyle, justifyContent: 'space-between' }}>
            <span><span style={{ width: 16, display: 'inline-block', textAlign: 'center' }}>📤</span> Export</span>
            <span style={{ fontSize: 10, color: '#64748b' }}>{sub === 'export' ? '▾' : '▸'}</span>
          </button>
          {sub === 'export' && (
            <div>
              <button onClick={() => handleExport('spice')} onMouseEnter={itemHover} onMouseLeave={itemLeave} style={subStyle}>
                SPICE (.cir)
              </button>
              <button onClick={() => handleExport('kicad')} onMouseEnter={itemHover} onMouseLeave={itemLeave} style={subStyle}>
                KiCad Netlist (.net)
              </button>
              <button onClick={() => handleExport('easyeda')} onMouseEnter={itemHover} onMouseLeave={itemLeave} style={subStyle}>
                EasyEDA (via KiCad)
              </button>
            </div>
          )}
        </>
      )}
      {/* Separator + Clear */}
      {onClear && (
        <>
          <span style={{ display: 'block', height: 1, background: '#334155', margin: '4px 0' }} />
          <button onClick={() => { onClear(); if (onDone) onDone(); }} onMouseEnter={(e) => { e.currentTarget.style.background = '#2a1010'; }} onMouseLeave={itemLeave}
            style={{ ...itemStyle, color: '#f87171' }}>
            <span style={{ width: 16, textAlign: 'center' }}>🗑</span> {de ? 'Alles löschen' : 'Clear all'}
          </button>
        </>
      )}
    </div>
  );
}

// ── Main BoardCanvas ─────────────────────────────────────────────

export function BoardCanvas({
  parts, wires, ledBrightness, buzzerTones, nodeVoltages,
  onAddWire, onRemoveWire, onRemovePart, onMovePart,
  onSelectPart, selectedPart, selectedParts,
  onSelectWire, selectedWire,
  onControlChange, onButtonDown, onButtonUp, onKeypadKey, onSetPartParam,
  mode, onModeChange, powered, onPowerToggle,
  statusText,
  placingProbe, onTerminalClickForProbe,
  onDuplicatePart, onRotatePart, onFlipPart, onDropPart, onUpdateParams, onSaveHistory, onCopy, onPaste, onUpdateWire, onNudgePart, onNudgeSeated, onUndo, onRedo, onSelectAll, warnings, annotations, cubeScans, activePartIds,
  circuit, engineBoard, videoFn, fitToken, sevenSegments, sevenSeg3,
  placing, onPlacingDone, onSeatPart, onUnseatPart, onAddHoleWire, onAddTapWire, simulate,
  onSaveCircuit, onLoadCircuit, onClearCircuit, onRewire, onImport,
  fileAction, onFileActionDone,
  drcWarnings, panelNav, viewNav, rightOpen, theme = 'light', lang = 'en',
}) {
  // Seated parts render, hit-test and wire at their HOLES — resolved once,
  // consumed by everything below (partsRef included, so what you see is
  // what you hit stays true for seated parts too).
  parts = resolveSeatedParts(parts);
  const circuitRef = useRef(null); circuitRef.current = circuit;
  const [placeGhost, setPlaceGhost] = useState(null);
  const [dragLegs, setDragLegs] = useState(null); // hole highlights while dragging an existing part
  const [pinChooser, setPinChooser] = useState(null); // {from, partId, x, y} — wire released on a chip body
  const [wiringFrom, setWiringFrom] = useState(null);
  const [mousePos, setMousePos] = useState(null);
  const [dragging, setDragging] = useState(null); // partId that initiated the drag
  const dragStartPos = React.useRef(null); // {x, y} at drag start for offset calc
  const [hoveredNet, setHoveredNet] = useState(null);
  const [hoveredPart, setHoveredPart] = useState(null);
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });
  const [snapTarget, setSnapTarget] = useState(null);
  const [contextMenu, setContextMenu] = useState(null); // { x, y, type }
  const [rubberBand, setRubberBand] = useState(null);
  const [inlineEdit, setInlineEdit] = useState(null); // { partId, x, y }
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [warningsOpen, setWarningsOpen] = useState(false);
  const [toolbarMoreOpen, setToolbarMoreOpen] = useState(false);
  // Auto-open the ⋯ menu when a File/ action arrives from the main menu
  React.useEffect(() => {
    if (fileAction) setToolbarMoreOpen(true);
  }, [fileAction]);
  // Responsive toolbar: below a width threshold the secondary nav groups
  // (Designer/Warnings/Parts/Examples + the Realistic/Schematic view toggles)
  // collapse INTO the ⋯ menu rather than wrapping the toolbar onto a second row
  // (the owner asked for hide-behind-⋯, not a 2nd row). The essential controls
  // (Build/Sim, Power, status, Undo/Redo, ⋯) always stay on the one row.
  const toolbarRef = React.useRef(null);
  const [toolbarCramped, setToolbarCramped] = useState(false);
  React.useEffect(() => {
    const el = toolbarRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setToolbarCramped((el.clientWidth || 999) < 560));
    };
    const ro = new ResizeObserver(update);
    ro.observe(el); update();
    return () => { ro.disconnect(); cancelAnimationFrame(frame); };
  }, []);
  const [draggingWaypoint, setDraggingWaypoint] = useState(null); // { wireId, index }

  // Zoom/pan state: viewBox = (panX, panY, CANVAS_W/zoom, CANVAS_H/zoom)
  const [zoom, setZoom] = useState(1);
  // Voltage view: ONE toggle owns the whole overlay — voltage-keyed wire
  // colors, one label pill per net (breadboard jumpers included), and the
  // legend. OFF = wires keep their author colors and the canvas stays
  // clean (owner design, 2026-08-17). SIM-only; build mode never shows it.
  const [voltageView, setVoltageView] = useState(() => {
    try { return localStorage.getItem('bw-voltage-view') !== '0'; } catch { return true; }
  });
  const toggleVoltageView = () => setVoltageView(v => {
    try { localStorage.setItem('bw-voltage-view', v ? '0' : '1'); } catch { /* private mode */ }
    return !v;
  });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const selectedPartId = selectedPart || (selectedParts && selectedParts.size === 1 ? [...selectedParts][0] : null);
  const selectedPartModel = selectedPartId ? parts.find(part => part.id === selectedPartId) : null;

  // Auto-fit: on every LOAD (fitToken bumps), plus when the part count
  // changes. Keying on count alone skipped the fit whenever a loaded
  // example happened to have the same number of parts as the previous
  // project — SOS opened half off-screen because the last bench's pan
  // survived (self-taken deployed screenshot, 2026-08-16).
  const prevPartCount = React.useRef(0);
  const prevFitToken = React.useRef(fitToken);
  const prevFitSize = React.useRef({ w: CANVAS_W, h: CANVAS_H });
  // The fit must measure the REAL container, not the 700×500 legacy
  // constants: the svg viewBox already sizes from the container, so a
  // fit computed against the constants was wrong on every other window
  // size — small-in-a-corner on large windows, clipped on tall ones
  // (owner: "does not properly scale to larger windows").
  const fitSizeRef = React.useRef({ w: CANVAS_W, h: CANVAS_H });
  const [fitSize, setFitSize] = useState({ w: CANVAS_W, h: CANVAS_H });
  React.useEffect(() => {
    const el = canvasContainerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const w = el.clientWidth || CANVAS_W, h = el.clientHeight || CANVAS_H;
      fitSizeRef.current = { w, h };
      setFitSize(prev => (prev.w === w && prev.h === h) ? prev : { w, h });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);
  // The single fit routine — frames all parts, centered, at the current
  // MEASURED container size. Shared by auto-fit-on-load, the F shortcut and
  // the Fit button, via the pure computeFitView helper, so a circuit always
  // frames identically however the fit was triggered.
  const applyFit = React.useCallback((arr) => {
    if (!arr || arr.length === 0) return;
    const boundsList = arr.map(p => {
      const b = partBounds(p);
      // VCC/GND rails want a little headroom above their glyph.
      return {
        minX: b.minX, maxX: b.maxX,
        minY: b.minY - (p.kind === 'vcc' || p.kind === 'gnd' ? 20 : 0), maxY: b.maxY,
      };
    });
    const v = computeFitView(boundsList, fitSizeRef.current);
    if (!v) return;
    setZoom(v.zoom);
    setPan(v.pan);
  }, []);
  React.useEffect(() => {
    if (parts.length === 0) return;
    // Re-fit on any of the three signals: a file load (fitToken), a
    // structural change (part count), or the container being resized.
    const changed = fitToken !== prevFitToken.current ||
      parts.length !== prevPartCount.current ||
      fitSize.w !== prevFitSize.current.w || fitSize.h !== prevFitSize.current.h;
    if (!changed) return;
    const tokenChanged = fitToken !== prevFitToken.current;
    prevFitToken.current = fitToken;
    prevPartCount.current = parts.length;
    prevFitSize.current = fitSize;
    // Bounding box from REAL part bounds. The old center±80 guess
    // undershot a full breadboard by ~385px per side (the body is 930
    // wide), so multi-board benches auto-fit with their left edges
    // CLIPPED off-screen (owner's 6502 screenshots; confirmed in a
    // self-taken screenshot the same day).
    applyFit(parts);
    // A LOAD's fit can race the loaded parts through React's commit
    // ordering — one session fit the stale 4-part starter and left SOS
    // half off-screen while an identical session fit fine. One more fit
    // on the next frame reads the refs, so the LAST fit always sees the
    // settled parts and the measured container. Idempotent when the
    // first fit was already right.
    if (tokenChanged && typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => applyFit(partsRef.current));
    }
  }, [parts.length, fitToken, fitSize.w, fitSize.h]);
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

  // ── Interaction v2: one state machine, container-level pointer events ──
  // The old plumbing attached handlers to child DOM nodes and the wokwi
  // layer swallowed them: a click on the LED deselected, a 200 px drag moved
  // nothing. Now the container captures every pointer, hits are pure math on
  // model data (src/interaction/), and the visual layers are inert.
  const partsRef = useRef(parts); partsRef.current = parts;
  const wiresRef = useRef(wires); wiresRef.current = wires;
  const selectedPartsRef = useRef(null); selectedPartsRef.current = selectedParts || new Set();
  const zoomRef = useRef(zoom); zoomRef.current = zoom;
  const panRef = useRef(pan); panRef.current = pan;
  const apiRef = useRef({});
  apiRef.current = { onMovePart, onAddWire, onSelectPart, onSelectWire, onSaveHistory,
    onTerminalClickForProbe, onButtonDown, onButtonUp, onUpdateWire, onDropPart, onPlacingDone, onSeatPart, onUnseatPart, onAddHoleWire, onAddTapWire, onRewire };
  const placingProbeRef = useRef(false); placingProbeRef.current = !!placingProbe;
  const selectedWireRef = useRef(null); selectedWireRef.current = selectedWire;
  const pressedButtonRef = useRef(null);
  const draggingWaypointRef = useRef(null); draggingWaypointRef.current = draggingWaypoint;
  const [holeWirePreview, setHoleWirePreview] = useState(null);
  const [rewirePreview, setRewirePreview] = useState(null);
  const machineRef = useRef(null);
  if (!machineRef.current) {
    const hit = createHitTest(
      () => partsRef.current,
      () => wiresRef.current.map(w => {
        const endPos = (e) => {
          if (e.board) {
            const bb = partsRef.current.find(pp => pp.id === e.board);
            return bb ? holeWorldPos(bb, e.hole) : null;
          }
          const pp = partsRef.current.find(q => q.id === e.part);
          return pp ? terminalPos(pp, e.terminal) : null;
        };
        const a = endPos(w.from);
        const b = endPos(w.to);
        if (!a || !b) return { id: w.id, points: [] };
        if (w.waypoints?.length) return { id: w.id, points: [a, ...w.waypoints, b] };
        if (isBoardEndpoint(w.from) || isBoardEndpoint(w.to)) {
          return { id: w.id, points: tapWireHitPoints(a, b) };
        }
        return { id: w.id, points: freeWireCurve(w, a, b).points };
      }),
      (part) => part.terminals.map(t => ({ terminal: t, ...terminalPos(part, t) }))
    );
    // Jumper wires participate in wireAt via their arc endpoints.
    const baseWireAt = hit.wireAt;
    hit.wireAt = (wx, wy, radius) => {
      const c = circuitRef.current;
      if (c && c.holeWires) {
        const jumpers = c.holeWires();
        for (let jwIdx = jumpers.length - 1; jwIdx >= 0; jwIdx--) {
          const jw = jumpers[jwIdx];
          const bb = partsRef.current.find(q => q.id === jw.boardId);
          if (!bb) continue;
          const a = holeWorldPos(bb, jw.a), b = holeWorldPos(bb, jw.b);
          if (!a || !b) continue;
          const points = jumperHitPoints(bb, a, b, jwIdx);
          for (let i = 0; i + 1 < points.length; i++) {
            const p1 = points[i], p2 = points[i + 1];
            const d = distToSeg(wx, wy, p1.x, p1.y, p2.x, p2.y);
            if (d <= radius + 3) return jw.ref;
          }
        }
      }
      return baseWireAt(wx, wy, radius);
    };
    // A selected wire's endpoints are grab handles for re-routing.
    hit.wireEndpointAt = (wx, wy, radius) => {
      const sel = selectedWireRef.current;
      if (!sel || typeof sel !== 'string' || sel.startsWith('bbw:')) return null;
      const w = wiresRef.current.find(q => q.id === sel);
      if (!w) return null;
      const endPos = (e) => {
        if (e.board) {
          const bb = partsRef.current.find(pp => pp.id === e.board);
          return bb ? holeWorldPos(bb, e.hole) : null;
        }
        const pp = partsRef.current.find(q => q.id === e.part);
        return pp ? terminalPos(pp, e.terminal) : null;
      };
      const a = endPos(w.from);
      const b = endPos(w.to);
      if (!a || !b) return null;
      if (Math.hypot(wx - a.x, wy - a.y) <= radius) {
        return { wireId: w.id, grabbed: 'from', fixedEnd: w.to, fixedPos: b };
      }
      if (Math.hypot(wx - b.x, wy - b.y) <= radius) {
        return { wireId: w.id, grabbed: 'to', fixedEnd: w.from, fixedPos: a };
      }
      return null;
    };

    // Free holes are jumper start/end points.
    hit.holeAt = (wx, wy, radius) => {
      const c = circuitRef.current;
      if (!c) return null;
      // BODY BEATS HOLE. A seated part's body covers free holes; without
      // this, pressing the body of a selected potentiometer started a
      // jumper wire instead of a drag most of the time (owner report,
      // 2026-08-10) — the same contract terminals already honour.
      for (const q of partsRef.current) {
        if (q.kind === 'breadboard' || q.kind === 'meter') continue;
        const b = partBounds(q);
        if (wx >= b.minX && wx <= b.maxX && wy >= b.minY && wy <= b.maxY) return null;
      }
      for (const q of partsRef.current) {
        if (q.kind !== 'breadboard') continue;
        const h = nearestHole(q, wx, wy);
        if (!h || Math.hypot(h.x - wx, h.y - wy) > Math.max(radius, BB_PITCH / 2 - 1)) continue;
        const bb = c.breadboards && c.breadboards.get(q.id);
        if (bb && bb.occupantOf(h.hole)) return null; // occupied: the leg/terminal owns it
        return { boardId: q.id, hole: h.hole, x: h.x, y: h.y };
      }
      return null;
    };
    hit.partTerminalCount = (partId) => {
      const q = partsRef.current.find(x => x.id === partId);
      return q ? (q.terminals || []).length : 0;
    };
    const cb = {
      choosePin: (from, partId, pos) => setPinChooser({ from, partId, x: pos.x, y: pos.y }),
      select: (ids, mode) => {
        const api = apiRef.current;
        if (mode === 'replace') {
          api.onSelectPart(null);
          for (const id of ids) api.onSelectPart(id, true);
        } else if (mode === 'add') {
          for (const id of ids) if (!selectedPartsRef.current.has(id)) api.onSelectPart(id, true);
        } else {
          for (const id of ids) api.onSelectPart(id, true);
        }
      },
      selectWire: (id) => { apiRef.current.onSelectWire(id); },
      clearSelection: () => { apiRef.current.onSelectPart(null); apiRef.current.onSelectWire(null); },
      moveSelection: (dx, dy) => {
        const api = apiRef.current;
        const ids = [...selectedPartsRef.current];
        for (const id of ids) {
          const pp = partsRef.current.find(q => q.id === id);
          if (!pp) continue;
          // A seated part leaves its holes the moment a real drag starts —
          // the body follows the pointer, and the drop decides where it
          // lives next (endMove re-seats or keeps it free).
          if (pp.seat && api.onUnseatPart) api.onUnseatPart(id);
          api.onMovePart(id, pp.x + dx, pp.y + dy);
        }
        if (ids.length === 1) {
          const pp = partsRef.current.find(q => q.id === ids[0]);
          if (pp) {
            const snap = findSnapTarget(pp, partsRef.current, wiresRef.current);
            setSnapTarget(snap && snap.autoWire ? snap : null);
            // The holes this part's legs would take, live under the finger —
            // green free / red taken — BEFORE release commits anything.
            // Uses the SAME two-pass logic as endMove: tight snap first,
            // then seatSnapHole loose fallback — what you see is what the
            // drop does.
            if (pp.kind !== 'breadboard') {
              const fp = BB_FOOTPRINTS[pp.kind];
              const anchor = fp && terminalOffsetsForPart(pp)[fp.refTerminal];
              const sg = snapGhost({ kind: pp.kind, x: pp.x, y: pp.y, anchorDx: anchor?.dx || 0, anchorDy: anchor?.dy || 0 }, partsRef.current);
              let g = sg.snapped ? ghostWithLegs(sg) : null;
              // Loose fallback: seatSnapHole finds the nearest valid seat
              // even when the ref pin isn't directly over a hole.
              if (!g && fp) {
                const ax = pp.x + (anchor?.dx || 0);
                const ay = pp.y + (anchor?.dy || 0);
                for (const bb of partsRef.current) {
                  if (bb.kind !== 'breadboard') continue;
                  const hole = seatSnapHole(bb, fp, ax, ay, (h) => {
                    try { computeLeadMap(fp, h); return true; } catch { return false; }
                  });
                  if (hole) {
                    g = ghostWithLegs({ ...sg, snapped: true, boardId: bb.id, hole, kind: pp.kind });
                    break;
                  }
                }
              }
              setDragLegs(g && g.legs ? g.legs : null);
            }
          }
        }
      },
      endMove: () => {
        const api = apiRef.current;
        // The DROP decides where a part lives: over a board lattice it seats
        // (legs into holes, strips conduct); anywhere else it unseats and
        // takes the 20 px grid. Live drag stays free-moving.
        for (const id of selectedPartsRef.current) {
          const pp = partsRef.current.find(q => q.id === id);
          if (!pp) continue;
          const fp = BB_FOOTPRINTS[pp.kind];
          const anchor = fp && terminalOffsetsForPart(pp)[fp.refTerminal];
          const s = snapGhost({ kind: pp.kind, x: pp.x, y: pp.y, anchorDx: anchor?.dx || 0, anchorDy: anchor?.dy || 0 }, partsRef.current);
          if (s.snapped && api.onSeatPart && api.onSeatPart(id, s.boardId, s.hole)) {
            api.onMovePart(id, s.x, s.y);
            continue;
          }
          // Loose fallback: nearestHole demands the REF PIN within half a
          // pitch of a hole, but the user drags the chip body, not pin 1 —
          // any drop over the board's outline should seat. seatSnapHole
          // clamps the footprint onto the lattice; onSeatPart's own retry
          // walks the neighbourhood if those exact holes are taken.
          if (fp && api.onSeatPart) {
            const ax = pp.x + (anchor?.dx || 0);
            const ay = pp.y + (anchor?.dy || 0);
            let seated = false;
            for (const bb of partsRef.current) {
              if (bb.kind !== 'breadboard') continue;
              const hole = seatSnapHole(bb, fp, ax, ay, (h) => {
                try { computeLeadMap(fp, h); return true; } catch { return false; }
              });
              if (hole && api.onSeatPart(id, bb.id, hole)) { seated = true; break; }
            }
            if (seated) continue;
          }
          if (api.onUnseatPart) api.onUnseatPart(id);
          api.onMovePart(id, Math.round(pp.x / 20) * 20, Math.round(pp.y / 20) * 20);
        }
        setSnapTarget(st => {
          if (st && st.autoWire) {
            api.onMovePart(st.autoWire.fromPart, st.snapX, st.snapY);
            api.onAddWire(st.autoWire.fromPart, st.autoWire.fromTerm, st.autoWire.toPart, st.autoWire.toTerm);
          }
          return null;
        });
        setDragLegs(null);
        if (api.onSaveHistory) api.onSaveHistory();
      },
      createWire: (from, to) => { apiRef.current.onAddWire(from.partId, from.terminal, to.partId, to.terminal); },
      wirePreview: (from, toPos) => { setWiringFrom({ part: from.partId, terminal: from.terminal }); setMousePos(toPos); },
      clearWirePreview: () => { setWiringFrom(null); setMousePos(null); },
      marqueeRect: (r) => setRubberBand(r ? { startX: r.x1, startY: r.y1, endX: r.x2, endY: r.y2 } : null),
      placeGhost: (g) => {
        if (!g) { setPlaceGhost(null); return; }
        const sg = snapGhost(g, partsRef.current);
        let result = ghostWithLegs(sg);
        // Loose fallback for palette drags too
        if (!result.snapped) {
          const fp = BB_FOOTPRINTS[g.kind];
          if (fp) {
            for (const bb of partsRef.current) {
              if (bb.kind !== 'breadboard') continue;
              const hole = seatSnapHole(bb, fp, g.x, g.y, (h) => {
                try { computeLeadMap(fp, h); return true; } catch { return false; }
              });
              if (hole) { result = ghostWithLegs({ ...sg, snapped: true, boardId: bb.id, hole, kind: g.kind }); break; }
            }
          }
        }
        setPlaceGhost(result);
      },
      placePart: (kind, params, x, y) => {
        const s = ghostWithLegs(snapGhost({ kind, x, y }, partsRef.current));
        if (s.snapped && s.legs && !s.ok) {
          // Occupied holes: refuse the commit, keep the ghost armed. The red
          // legs already say why — never place a part the board cannot take.
          return;
        }
        apiRef.current.onDropPart(kind, params, s.x, s.y,
          s.snapped ? { boardId: s.boardId, hole: s.hole } : null);
      },
      placingDone: () => { if (apiRef.current.onPlacingDone) apiRef.current.onPlacingDone(); },
      holeWirePreview: (from, toPos, snap) => {
        setHoleWirePreview(from ? { from, to: toPos, snapped: !!snap } : null);
      },
      createHoleWire: (boardId, a, b) => {
        if (apiRef.current.onAddHoleWire) apiRef.current.onAddHoleWire(boardId, a, b);
      },
      createTapWire: (term, hole) => {
        if (apiRef.current.onAddTapWire) apiRef.current.onAddTapWire(term.partId, term.terminal, hole.boardId, hole.hole);
      },
      rewirePreview: (fixedPos, toPos, snapped) => {
        setRewirePreview(fixedPos ? { from: fixedPos, to: toPos, snapped } : null);
      },
      rewire: (wireId, fixedEnd, newEnd) => {
        if (apiRef.current.onRewire) apiRef.current.onRewire(wireId, fixedEnd, newEnd);
      },
    };
    machineRef.current = new InteractionMachine(hit, cb, () => selectedPartsRef.current, (px) => px / zoomRef.current);
  }

  // The SVG viewBox must span the container's REAL size: with a fixed
  // 700×500 viewBox and preserveAspectRatio, the SVG letterboxed whenever the
  // container had any other aspect — every dot, wire and grid line drew
  // offset from the wokwi parts, and hit positions missed by the same margin.
  const [containerSize, setContainerSize] = useState({ w: CANVAS_W, h: CANVAS_H });
  React.useEffect(() => {
    const el = canvasContainerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      setContainerSize({ w: el.clientWidth || CANVAS_W, h: el.clientHeight || CANVAS_H });
    });
    ro.observe(el);
    setContainerSize({ w: el.clientWidth || CANVAS_W, h: el.clientHeight || CANVAS_H });
    return () => ro.disconnect();
  }, []);

  React.useEffect(() => {
    const m = machineRef.current;
    if (placing) m.startPlacing(placing.kind, placing.params || {});
    else if (m.state === 'placing') m.cancel();
  }, [placing]);

  // Decorate a snapped ghost with per-leg hole positions and availability.
  const ghostWithLegs = (s) => {
    if (!s.snapped || !BB_FOOTPRINTS[s.kind]) return s;
    const bb = partsRef.current.find(q => q.id === s.boardId);
    const c = circuitRef.current;
    if (!bb || !c) return s;
    let leadMap;
    try { leadMap = computeLeadMap(BB_FOOTPRINTS[s.kind], s.hole); }
    catch { return { ...s, legs: [], ok: false }; }
    const legs = [];
    let ok = true;
    for (const [terminal, holeId] of Object.entries(leadMap)) {
      const pos = holeWorldPos(bb, holeId);
      if (!pos) { ok = false; continue; }
      const free = c.canSeat(s.boardId, '__ghost__', { [terminal]: holeId });
      if (!free) ok = false;
      legs.push({ ...pos, free });
    }
    return { ...s, legs, ok };
  };

  const eventToWorld = useCallback((e) => {
    const r = canvasContainerRef.current.getBoundingClientRect();
    return { x: (e.clientX - r.left) / zoomRef.current + panRef.current.x,
             y: (e.clientY - r.top) / zoomRef.current + panRef.current.y };
  }, []);

  const handlePointerDown = useCallback((e) => {
    if (e.button === 1) { e.preventDefault(); setPanning(true); panStart.current = { x: e.clientX, y: e.clientY }; return; }
    if (e.button !== 0) return;
    if (draggingWaypointRef.current) return;
    const { x, y } = eventToWorld(e);
    const m = machineRef.current;
    if (placingProbeRef.current && apiRef.current.onTerminalClickForProbe) {
      const t = m.hit.terminalAt(x, y, 14 / zoomRef.current);
      if (t) apiRef.current.onTerminalClickForProbe(t.partId, t.terminal);
      return;
    }
    const pid = m.hit.partAt(x, y);
    const pressedPart = pid && partsRef.current.find(pp => pp.id === pid);
    if (pressedPart && pressedPart.kind === 'button' && apiRef.current.onButtonDown) {
      pressedButtonRef.current = pid;
      apiRef.current.onButtonDown(pid);
      // While the SIMULATION runs, a click on a button IS the button
      // press — full stop. Falling through to the interaction machine
      // selected the part and opened the rotate/context UI mid-run
      // (owner: "single click shows the context menu even in sim
      // mode"), and you cannot play a game like that. Edit mode keeps
      // the old behavior: press AND select/drag.
      if (simulate) {
        try { canvasContainerRef.current.setPointerCapture(e.pointerId); } catch { /* non-browser env */ }
        return;
      }
    }
    try { canvasContainerRef.current.setPointerCapture(e.pointerId); } catch { /* non-browser env */ }
    m.down(x, y, { shiftKey: e.shiftKey });
  }, [eventToWorld, simulate]);

  const handlePointerMove = useCallback((e) => {
    if (panning && panStart.current) {
      const dx = (e.clientX - panStart.current.x) / zoomRef.current;
      const dy = (e.clientY - panStart.current.y) / zoomRef.current;
      setPan(pp => ({ x: pp.x - dx, y: pp.y - dy }));
      panStart.current = { x: e.clientX, y: e.clientY };
      return;
    }
    const { x, y } = eventToWorld(e);
    if (draggingWaypointRef.current && apiRef.current.onUpdateWire) {
      const dw = draggingWaypointRef.current;
      const wire = wiresRef.current.find(w => w.id === dw.wireId);
      if (wire && wire.waypoints) {
        apiRef.current.onUpdateWire(wire.id, { waypoints: wire.waypoints.map((wp, i) => (i === dw.index ? { x, y } : wp)) });
      }
      return;
    }
    const m = machineRef.current;
    if (pressedButtonRef.current && m.state === 'draggingParts') {
      if (apiRef.current.onButtonUp) apiRef.current.onButtonUp(pressedButtonRef.current);
      pressedButtonRef.current = null;
    }
    m.move(x, y);
    const wid = m.hit.wireAt(x, y, 8 / zoomRef.current);
    const hoverWire = wid ? wiresRef.current.find(w => w.id === wid) : null;
    setHoveredNet(hoverWire ? hoverWire.netId : null);
  }, [panning, eventToWorld, simulate]);

  const handlePointerUp = useCallback((e) => {
    if (panning) { setPanning(false); panStart.current = null; return; }
    if (pressedButtonRef.current) {
      if (apiRef.current.onButtonUp) apiRef.current.onButtonUp(pressedButtonRef.current);
      pressedButtonRef.current = null;
      // Sim-mode presses never entered the interaction machine on the
      // way down — an up() on an idle machine reads as a click and
      // re-opens the selection UI the early-return just avoided.
      if (simulate) return;
    }
    if (draggingWaypointRef.current) {
      setDraggingWaypoint(null);
      if (apiRef.current.onSaveHistory) apiRef.current.onSaveHistory();
      return;
    }
    const { x, y } = eventToWorld(e);
    machineRef.current.up(x, y, { shiftKey: e.shiftKey });
  }, [panning, eventToWorld]);

  const handlePointerCancel = useCallback(() => {
    machineRef.current.cancel();
    setPanning(false); panStart.current = null; pressedButtonRef.current = null;
  }, []);

  // Wheel must be a native non-passive listener: trackpad two-finger scroll
  // PANS, pinch / ctrl+wheel zooms at the cursor. The old canvas zoomed on
  // every wheel — trackpad users could never pan at all.
  React.useEffect(() => {
    const el = canvasContainerRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const g = classifyWheel(e);
      if (g.kind === 'pan') {
        setPan(pp => ({ x: pp.x - g.dx / zoomRef.current, y: pp.y - g.dy / zoomRef.current }));
      } else {
        const r = el.getBoundingClientRect();
        const sx = e.clientX - r.left, sy = e.clientY - r.top;
        setZoom(z => {
          const nz = Math.max(0.3, Math.min(3, z * g.factor));
          const wx = sx / z + panRef.current.x, wy = sy / z + panRef.current.y;
          setPan({ x: wx - sx / nz, y: wy - sy / nz });
          return nz;
        });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Terminal interaction: drag to wire (terminal-to-terminal).
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

  const handleSvgClick = useCallback((e) => {
    // Cancel wiring if clicking empty space
    if (wiringFrom) {
      setWiringFrom(null);
      setMousePos(null);
    }
    // Complete rubber-band select
    if (rubberBand) {
      const rx1 = Math.min(rubberBand.startX, rubberBand.endX);
      const ry1 = Math.min(rubberBand.startY, rubberBand.endY);
      const rx2 = Math.max(rubberBand.startX, rubberBand.endX);
      const ry2 = Math.max(rubberBand.startY, rubberBand.endY);
      if (rx2 - rx1 > 10 && ry2 - ry1 > 10) {
        // Hit-test bounding boxes, not centres
        const inside = parts.filter(p => {
          const bb = getPartBBox(p);
          const bounds = partBounds(p);
          return bounds.maxX >= rx1 && bounds.minX <= rx2 && bounds.maxY >= ry1 && bounds.minY <= ry2;
        });
        if (inside.length > 0) {
          // Shift = additive (toggle into existing selection); default = replace
          if (!e?.shiftKey) onSelectPart(null);
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

    // Waypoint drag
    if (draggingWaypoint && onUpdateWire) {
      const wire = wires.find(w => w.id === draggingWaypoint.wireId);
      if (wire && wire.waypoints) {
        const wps = wire.waypoints.map((wp, i) =>
          i === draggingWaypoint.index ? { x, y } : wp
        );
        onUpdateWire(wire.id, { waypoints: wps });
      }
    }

    if (wiringFrom) {
      setMousePos({ x, y });
    }
    if (dragging) {
      // Group drag: move all selected parts together
      if (dragStartPos.current) {
        const dx = x - dragStartPos.current.x;
        const dy = y - dragStartPos.current.y;
        dragStartPos.current = { x, y };

        const idsToMove = (selectedParts && selectedParts.size > 0 && selectedParts.has(dragging))
          ? [...selectedParts]
          : [dragging];

        for (const id of idsToMove) {
          const p = parts.find(pp => pp.id === id);
          if (p) onMovePart(id, p.x + dx, p.y + dy);
        }
      } else {
        dragStartPos.current = { x, y };
      }

      // Snap-to-connector (only for single-part drag)
      if (!selectedParts || selectedParts.size <= 1) {
        const draggedPart = parts.find(p => p.id === dragging);
        if (draggedPart) {
          const snap = findSnapTarget({ ...draggedPart, x, y }, parts, wires);
          setSnapTarget(snap.autoWire ? snap : null);
        }
      }
    }
  }, [wiringFrom, dragging, onMovePart, screenToCanvas, panning, zoom, parts, wires, draggingWaypoint, onUpdateWire]);

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
    if (dragging && onSaveHistory) onSaveHistory();
    dragStartPos.current = null;
    setDragging(null);
    setSnapTarget(null);
    setDraggingWaypoint(null);
    setPanning(false);
    panStart.current = null;
  }, [dragging, snapTarget, onMovePart, onAddWire, onSaveHistory]);

  const handleKeyDown = useCallback((e) => {
    // Undo/redo
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      if (onUndo) onUndo();
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'Z' || e.key === 'y')) {
      e.preventDefault();
      if (onRedo) onRedo();
    }
    // Select all
    if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
      e.preventDefault();
      if (onSelectAll) onSelectAll();
    }
    // R → rotate selected parts
    if (e.key === 'r' && !e.ctrlKey && !e.metaKey && selectedParts && selectedParts.size > 0 && onRotatePart) {
      for (const id of selectedParts) onRotatePart(id);
    }
    // Ctrl+D → duplicate selected part
    if ((e.ctrlKey || e.metaKey) && e.key === 'd' && selectedParts && selectedParts.size > 0 && onDuplicatePart) {
      e.preventDefault();
      for (const id of selectedParts) onDuplicatePart(id);
    }
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
      if (machineRef.current) machineRef.current.cancel();
      setWiringFrom(null);
      setMousePos(null);
      onSelectPart(null);
      onSelectWire(null);
    }
    if (e.key === '0') {
      setZoom(1);
      setPan({ x: 0, y: 0 });
    }
    // F → fit all parts in view (same framing as auto-fit and the Fit button)
    if (e.key === 'f' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      applyFit(partsRef.current);
    }
    // Copy/paste
    if ((e.ctrlKey || e.metaKey) && e.key === 'c' && selectedParts && selectedParts.size > 0) {
      e.preventDefault();
      if (onCopy) onCopy(selectedParts);
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
      e.preventDefault();
      if (onPaste) onPaste();
    }
    // H → flip selected part horizontally
    if (e.key === 'h' && !e.ctrlKey && !e.metaKey && selectedParts && selectedParts.size > 0 && onFlipPart) {
      for (const id of selectedParts) onFlipPart(id);
    }
    // Arrow keys nudge all selected parts (Shift = fine 5px bypass snap)
    if (selectedParts && selectedParts.size > 0 && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      const fine = e.shiftKey;
      const step = fine ? 5 : 20;
      const mover = fine && onNudgePart ? onNudgePart : onMovePart;
      const dx = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
      const dy = e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0;
      for (const id of selectedParts) {
        const part = parts.find(p => p.id === id);
        if (!part) continue;
        // A seated part moves in HOLES, not pixels: one per press, five with
        // Shift. It re-seats atomically or stays put (occupied/edge).
        if (part.seat && onNudgeSeated) {
          const holes = e.shiftKey ? 5 : 1;
          onNudgeSeated(id, Math.sign(dx) * holes, Math.sign(dy) * holes);
          continue;
        }
        // A FREE footprint part arrow-keyed over a board seats right there:
        // pixel steps (20 px) can never align with the 14 px hole pitch, so
        // arrows alone could walk a chip across the lattice forever without
        // it ever snapping in (owner report, 2026-08-15). Seat first; from
        // then on the same keys nudge hole-by-hole.
        if (!e.shiftKey && !part.seat && BB_FOOTPRINTS[part.kind] && onSeatPart) {
          const fp = BB_FOOTPRINTS[part.kind];
          const anchor = terminalOffsetsForPart(part)[fp.refTerminal];
          const ax = part.x + dx + (anchor?.dx || 0);
          const ay = part.y + dy + (anchor?.dy || 0);
          let seated = false;
          for (const bb of parts) {
            if (bb.kind !== 'breadboard') continue;
            const hole = seatSnapHole(bb, fp, ax, ay, (h) => {
              try { computeLeadMap(fp, h); return true; } catch { return false; }
            });
            if (hole && onSeatPart(id, bb.id, hole)) { seated = true; break; }
          }
          if (seated) continue;
        }
        mover(id, part.x + dx, part.y + dy);
      }
    }
  }, [selectedParts, selectedWire, onRemovePart, onRemoveWire, onSelectPart, onSelectWire, parts, onMovePart, onNudgePart, onNudgeSeated, onSeatPart, onCopy, onPaste, onFlipPart, onUndo, onRedo, onSelectAll, onRotatePart, onDuplicatePart]);

  // ── Touch support ────────────────────────────────────────────────
  const canvasContainerRef = useRef(null);
  const touchHandlers = useTouch({
    onDrag: useCallback((clientX, clientY) => {
      const container = canvasContainerRef.current;
      if (!container) return;
      if (dragging) {
        handleSvgMouseMove({ clientX, clientY, currentTarget: container });
      }
    }, [dragging, handleSvgMouseMove]),
    onDragEnd: useCallback(() => {
      if (dragging) handleDragEnd();
      if (wiringFrom) { setWiringFrom(null); setMousePos(null); }
    }, [dragging, wiringFrom, handleDragEnd]),
    onTap: useCallback((clientX, clientY) => {
      // Tap on empty space deselects
      onSelectPart(null);
      onSelectWire(null);
    }, [onSelectPart, onSelectWire]),
    onLongPress: useCallback((clientX, clientY) => {
      if (simulate) return; // SIM: long-press is not an edit gesture
      if ((selectedParts && selectedParts.size > 0) || selectedWire) {
        setContextMenu({
          x: clientX, y: clientY,
          type: (selectedParts && selectedParts.size === 1) ? 'part' : selectedWire ? 'wire' : 'part',
        });
      }
    }, [selectedParts, selectedWire, simulate]),
    onPinch: useCallback((scale) => {
      setZoom(z => Math.max(0.3, Math.min(3, z * scale)));
    }, []),
    onPan: useCallback((dx, dy) => {
      setPan(p => ({ x: p.x - dx / zoom, y: p.y - dy / zoom }));
    }, [zoom]),
  });

  return (
    <div
      // stretch + a real height chain: alignItems 'center' pinned the
      // canvas child at its 700px minimum, centered in whatever space the
      // row offered — the owner's tenth 'the grid does not use the screen'
      // report was THIS line. The canvas is flex 1 1 auto; give it a
      // column that lets it grow both ways.
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', position: 'relative', width: '100%', height: '100%', flex: '1 1 auto', minWidth: 0, minHeight: 0 }}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {/* Status/action bar */}
      {/* Toolbar */}
      <div ref={toolbarRef} data-circuit-toolbar style={{
        display: 'flex', alignItems: 'center', gap: '6px',
        fontFamily: 'monospace', fontSize: '10px',
        marginBottom: '8px', minHeight: '44px',
        padding: '4px 6px',
        background: theme === 'light' ? '#f8fafc' : '#16213e',
        border: theme === 'light' ? '1px solid #cbd5e1' : '1px solid transparent', borderRadius: '4px',
        flexWrap: 'wrap', alignContent: 'flex-start', rowGap: '8px',
        overflow: 'visible', width: '100%', boxSizing: 'border-box',
      }}>
        <div role="radiogroup" aria-label="Build or Sim mode" data-build-sim-toggle data-circuit-control-group style={{display: 'inline-flex', width: 70, height: 34, boxSizing: 'border-box', border: '1px solid #64748b', borderRadius: 5, overflow: 'hidden', background: '#0f172a'}}>
          <button data-circuit-toggle-state={mode === 'build' ? 'selected' : 'unselected'} role="radio" aria-checked={mode === 'build'} onClick={() => onModeChange?.('build')} title="Build mode" aria-label="Build mode"
            style={{width: 34, minWidth: 34, height: 34, padding: 0, background: mode === 'build' ? '#2563eb' : '#475569', border: 'none', borderRight: '1px solid #cbd5e1', color: '#fff', fontSize: '16px', fontWeight: 700, cursor: 'pointer'}}>▦</button>
          <button data-circuit-toggle-state={mode === 'simulate' ? 'selected' : 'unselected'} role="radio" aria-checked={mode === 'simulate'} onClick={() => onModeChange?.('simulate')} title="Simulation mode" aria-label="Sim mode"
            style={{width: 34, minWidth: 34, height: 34, padding: 0, background: mode === 'simulate' ? '#16a34a' : '#475569', border: 'none', color: '#fff', fontSize: '16px', fontWeight: 700, cursor: 'pointer'}}>▶</button>
        </div>
        <div role="radiogroup" aria-label="Power state" data-power-toggle data-circuit-control-group style={{display: 'inline-flex', width: 70, height: 34, boxSizing: 'border-box', border: '1px solid #64748b', borderRadius: 5, overflow: 'hidden', background: '#0f172a'}}>
          <button data-circuit-toggle-state={powered ? 'selected' : 'unselected'} role="radio" aria-checked={powered} onClick={() => onPowerToggle?.(true)}
            title={lang === 'de' ? 'Strom ein — VCC- und GND-Schienen versorgen die Bauteile. LEDs leuchten, Chips arbeiten, die Simulation löst den Stromkreis.' : 'Power on — VCC and GND rails energise the circuit. LEDs light, chips run, the simulation solves voltages and currents.'}
            aria-label={lang === 'de' ? 'Strom ein' : 'Power on'}
            style={{width: 34, minWidth: 34, height: 34, padding: 0, background: powered ? '#16a34a' : '#475569', border: 'none', borderRight: '1px solid #cbd5e1', color: '#fff', fontSize: '16px', fontWeight: 700, cursor: 'pointer'}}>⏻</button>
          <button data-circuit-toggle-state={!powered ? 'selected' : 'unselected'} role="radio" aria-checked={!powered} onClick={() => onPowerToggle?.(false)}
            title={lang === 'de' ? 'Strom aus — alle Schienen spannungslos. Bauteile behalten ihre Position, aber nichts leuchtet oder rechnet. Im Baumodus ist Strom immer aus.' : 'Power off — all rails de-energised. Parts keep their positions but nothing lights or computes. In Build mode power is always off.'}
            aria-label={lang === 'de' ? 'Strom aus' : 'Power off'}
            style={{width: 34, minWidth: 34, height: 34, padding: 0, background: !powered ? '#dc2626' : '#475569', border: 'none', color: '#fff', fontSize: '16px', fontWeight: 700, cursor: 'pointer'}}>◯</button>
        </div>

        {!toolbarCramped && panelNav ? <div data-circuit-control-group style={{flex: '0 0 auto', width: 150, height: 34, minHeight: 34, display: 'flex', alignItems: 'center'}}>{panelNav}</div> : null}
        {!toolbarCramped && viewNav ? <div data-circuit-control-group style={{flex: '0 0 auto', width: 70, height: 34, minHeight: 34, display: 'flex', alignItems: 'center'}}>{viewNav}</div> : null}
        {/* Mode indicator */}
        <span style={{
          padding: '2px 8px', borderRadius: '3px',
          background: wiringFrom ? '#f39c12' : '#2c3e50',
          color: wiringFrom ? '#000' : '#7f8c8d',
          fontWeight: 'bold', fontSize: '9px',
        }}>
          {wiringFrom ? t('modeWiring', lang) : t('modeSelect', lang)}
        </span>

        {/* Warning chip: count-badged, red for danger, amber for advisory */}
        {drcWarnings && drcWarnings.length > 0 && (() => {
          const dangerCount = drcWarnings.filter(w => w.severity === 'danger' || w.severity === 'error').length;
          const chipColor = dangerCount > 0 ? '#dc2626' : '#d97706';
          const chipBg = dangerCount > 0 ? '#451a1a' : '#451f0a';
          return (
            <div style={{position: 'relative', flex: '0 0 auto'}}>
              <button data-warnings-chip onClick={() => setWarningsOpen(v => !v)}
                title={`${drcWarnings.length} circuit finding${drcWarnings.length !== 1 ? 's' : ''}`}
                aria-label={`${drcWarnings.length} circuit findings`} aria-expanded={warningsOpen}
                style={{
                  // Same control height as every toolbar button (the UX
                  // gate asserts it); width is content-driven — a count-
                  // badged chip is a chip, not a square icon button.
                  height: 34, boxSizing: 'border-box', padding: '4px 10px',
                  fontSize: 11, fontWeight: 700, fontFamily: 'monospace',
                  color: chipColor, background: chipBg,
                  border: `1px solid ${chipColor}`, borderRadius: 4, cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                }}>
                {dangerCount > 0 ? '\u26A0' : '!'}{' '}{drcWarnings.length}
              </button>
              {warningsOpen && (
                <div data-warnings-popover style={{
                  position: 'absolute', zIndex: 90, top: 38, left: 0,
                  width: 340, maxHeight: 320, overflowY: 'auto',
                  background: '#0f172a', border: `1px solid ${chipColor}`,
                  borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,.5)',
                  padding: '8px', fontFamily: 'monospace', fontSize: '10px',
                }}>
                  <div style={{color: '#ecf0f1', fontSize: '11px', fontWeight: 'bold', marginBottom: '6px', display: 'flex', justifyContent: 'space-between'}}>
                    <span>Circuit Check ({drcWarnings.length})</span>
                    <button onClick={() => setWarningsOpen(false)} aria-label="Close"
                      style={{background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 14, padding: '0 2px'}}>{'\u00D7'}</button>
                  </div>
                  {drcWarnings.map((w, i) => {
                    const c = w.severity === 'danger' || w.severity === 'error' ? '#e74c3c' : w.severity === 'warning' ? '#f39c12' : '#3498db';
                    return (
                      <div key={i} style={{
                        marginBottom: 3, padding: '4px 6px',
                        background: '#1e293b', border: `1px solid ${c}33`,
                        borderRadius: 3, color: c, lineHeight: 1.4,
                        cursor: w.partId ? 'pointer' : 'default',
                      }} onClick={() => { if (w.partId) onSelectPart(w.partId, false); }}>
                        <span style={{fontWeight: 700}}>{w.severity === 'danger' || w.severity === 'error' ? '\u26A0' : w.severity === 'info' ? 'i' : '!'}</span>
                        {' '}{w.partKind ? `${w.partKind}: ` : ''}{w.explanation}
                        {w.fix && <div style={{color: '#2ecc71', fontSize: 9, marginTop: 2}}>Fix: {w.fix}</div>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}

        {/* Compact status warning; click the triangle to reveal the full explanation. */}
        {statusText && /WIRING ONLY|HARDWARE|SNAPSHOT/.test(statusText) ? (
          <button onClick={() => setNoticeOpen(v => !v)} title={statusText} aria-label={statusText} aria-expanded={noticeOpen}
            style={{border: 'none', background: 'transparent', color: /WIRING ONLY/.test(statusText) ? '#f59e0b' : '#ef4444', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '0 3px'}}>▲</button>
        ) : null}
        <span style={{ color: theme === 'light' ? '#334155' : '#cbd5e1', flex: 1, minWidth: 40, fontSize: '10px', fontWeight: 600, display: 'flex', alignItems: 'center' }}>
          {wiringFrom
            ? `${wiringFrom.part}:${wiringFrom.terminal} → ?`
            : (noticeOpen || !statusText || !/WIRING ONLY|HARDWARE|SNAPSHOT/.test(statusText))
              ? (statusText || (selectedParts?.size > 0 ? `${selectedParts.size} selected` : ''))
              : ''}
        </span>

        {/* Always-visible history controls. Persistence and zoom live under one
            overflow button so the toolbar keeps a usable footprint on narrow panes. */}
        <button onClick={() => onUndo && onUndo()} title={t('undoTitle', lang)} aria-label={t('undo', lang)}
          style={{ width: 34, minWidth: 34, height: 34, padding: 0, background: '#2c3e50', border: '1px solid #7f8c8d', borderRadius: '3px', color: '#bdc3c7', fontSize: '15px', cursor: 'pointer' }}>↶</button>
        <button onClick={() => onRedo && onRedo()} title={t('redoTitle', lang)} aria-label={t('redo', lang)}
          style={{ width: 34, minWidth: 34, height: 34, padding: 0, background: '#2c3e50', border: '1px solid #7f8c8d', borderRadius: '3px', color: '#bdc3c7', fontSize: '15px', cursor: 'pointer' }}>↷</button>
        {simulate ? (
          <button type="button" data-voltage-view-toggle
            aria-pressed={voltageView} onClick={toggleVoltageView}
            title={voltageView ? 'Hide voltages (wire colors, labels, legend)' : 'Show voltages on wires'}
            aria-label={voltageView ? 'Hide voltages' : 'Show voltages'}
            style={{height: 30, boxSizing: 'border-box', padding: '4px 8px',
              fontSize: 12, fontWeight: 700, fontFamily: 'monospace',
              color: voltageView ? '#0f172a' : '#e2e8f0',
              background: voltageView ? '#f1c40f' : '#334155',
              border: '1px solid #64748b', borderRadius: 4, cursor: 'pointer'}}>
            {'V\u26a1'}
          </button>
        ) : null}
        <div data-toolbar-more style={{position: 'relative', flex: '0 0 auto'}}>
          <button onClick={() => setToolbarMoreOpen(v => !v)} title="More circuit controls: Save, Load, Zoom" aria-label="More circuit controls" aria-expanded={toolbarMoreOpen}
            style={{width: 34, minWidth: 34, height: 34, padding: 0, background: toolbarMoreOpen ? '#1e3a5f' : '#2c3e50', border: '1px solid #64748b', borderRadius: 4, color: '#e2e8f0', fontSize: '17px', cursor: 'pointer'}}>⋯</button>
          {toolbarMoreOpen && <div data-toolbar-more-menu style={{position: 'absolute', zIndex: 80, top: 40, right: 0, minWidth: 180, maxWidth: '92vw', padding: 4, background: '#0f172a', border: '1px solid #64748b', borderRadius: 5, boxShadow: '0 3px 10px rgba(0,0,0,.35)'}}>
            {/* When the toolbar is cramped, the secondary nav groups live here instead of on a 2nd row. */}
            {toolbarCramped && panelNav ? <div data-circuit-control-group style={{display: 'flex', alignItems: 'center', padding: '2px 0'}}>{panelNav}</div> : null}
            {toolbarCramped && viewNav ? <div data-circuit-control-group style={{display: 'flex', alignItems: 'center', padding: '2px 0'}}>{viewNav}</div> : null}
            {toolbarCramped && (panelNav || viewNav) ? <span style={{display: 'block', height: 1, background: '#334155', margin: '4px 0'}} /> : null}
            <FileMenu
              circuit={circuit} lang={lang}
              onLoad={onLoadCircuit} onSave={onSaveCircuit}
              onImport={onImport} onClear={onClearCircuit}
              fileAction={fileAction} onFileActionDone={onFileActionDone}
              onDone={() => setToolbarMoreOpen(false)}
            />
            <span style={{display: 'block', height: 1, background: '#334155', margin: '4px 0'}} />
            <div style={{display: 'flex', justifyContent: 'flex-end', padding: '2px 0'}}>
              <span data-zoom-indicator title="Canvas zoom" style={{height: 28, boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center', color: '#e2e8f0', background: '#334155', border: '1px solid #64748b', borderRadius: 4, padding: '4px 7px', fontSize: 11, fontWeight: 700}}>{(zoom * 100).toFixed(0)}%</span>
            </div>
          </div>}
        </div>
      </div>

      {/* Canvas — fills container, minimum 700×500 */}
      <div
        ref={canvasContainerRef}
        data-canvas
        style={{
          position: 'relative',
          // A true flex child. The old 'max(100%, 900px)' floor demanded
          // more width than the row could give beside the 190px rail, so
          // the container slid UNDER the rail (87px of every bench hidden
          // behind an opaque panel — measured with elementsFromPoint) and
          // grew scrollbars on small windows. The viewBox + measured-fit
          // pipeline adapts to ANY container size now; the floors were
          // pre-responsive crutches.
          // flex 1 1 auto: fill what the row offers (large windows fill,
          // mid windows fit beside the 190px rail with no underlap). The
          // floor is the LOGICAL canvas (700x500), not the old 900 —
          // 900 exceeded the ~810 available beside the rail and slid the
          // container UNDER it; with no floor at all the browser gate
          // proved the canvas collapses to 2px on narrow panes, killing
          // the narrow-window scroll story. 700 fits the mid case and
          // still forces a scrollbar (not a crush) below it.
          flex: '1 1 auto',
          width: 'auto',
          minWidth: CANVAS_W,
          height: '100%',
          minHeight: CANVAS_H,
          background: '#16213e',
          borderRadius: '8px',
          border: '1px solid #2c3e50',
          overflow: 'hidden',
          touchAction: 'none',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onDoubleClick={(e) => {
          const { x, y } = eventToWorld(e);
          const pid = machineRef.current.hit.partAt(x, y);
          if (pid) setInlineEdit({ partId: pid, x: e.clientX, y: e.clientY });
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
          // Right-click selects what is under the cursor, then opens the menu.
          // In SIM mode there is nothing to edit: a pot click must TURN the
          // pot, never surface Rotate/Remove (owner report, repeatedly).
          if (simulate) return;
          const { x, y } = eventToWorld(e);
          const pid = machineRef.current.hit.partAt(x, y);
          if (pid && !(selectedParts && selectedParts.has(pid))) {
            onSelectPart(null); onSelectPart(pid, true);
          }
          const wid = !pid ? machineRef.current.hit.wireAt(x, y, 8 / zoomRef.current) : null;
          if (wid) onSelectWire(wid);
          if (pid || wid || (selectedParts && selectedParts.size > 0) || selectedWire) {
            setContextMenu({ x: e.clientX, y: e.clientY, type: (pid || selectedPart) ? 'part' : 'wire' });
          }
        }}
      >
        {/* Fit-to-parts: zoom+pan so the whole circuit frames on screen.
            Same framing as auto-fit-on-load and the F shortcut (applyFit).
            Floating bottom-right; only meaningful once parts exist. */}
        {parts.length > 0 && (
          <button
            data-testid="bw-circuit-fit"
            onClick={() => applyFit(partsRef.current)}
            title={/^de/i.test(lang) ? 'Alle Bauteile einpassen (F)' : 'Fit all parts (F)'}
            aria-label={/^de/i.test(lang) ? 'Alle Bauteile einpassen' : 'Fit all parts'}
            style={{
              position: 'absolute', right: 12, bottom: 12, zIndex: 70,
              width: 36, height: 36, padding: 0, display: 'inline-flex',
              alignItems: 'center', justifyContent: 'center',
              background: 'rgba(22,33,62,.92)', border: '1px solid #64748b',
              borderRadius: 6, color: '#e2e8f0', cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(0,0,0,.35)',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round"
              strokeLinejoin="round" aria-hidden="true">
              <path d="M4 9 V4 H9" />
              <path d="M15 4 H20 V9" />
              <path d="M20 15 V20 H15" />
              <path d="M9 20 H4 V15" />
            </svg>
          </button>
        )}
        {selectedPartModel && !simulate && (
          <div data-selection-actions style={{position: 'absolute', left: `${((selectedPartModel.x - pan.x) / (containerSize.w / zoom)) * 100}%`, top: `${((selectedPartModel.y - pan.y) / (containerSize.h / zoom)) * 100}%`, transform: 'translate(18px, -50%)', zIndex: 60, display: 'flex', gap: 4,
            padding: 4, borderRadius: 6, background: 'rgba(22,33,62,.92)', boxShadow: '0 2px 8px rgba(0,0,0,.35)'}}
            onPointerDown={e => e.stopPropagation()}>
            {onRotatePart && <button onClick={() => onRotatePart(selectedPartId)} title="Rotate (R)" aria-label="Rotate selected part"
              style={{width: 30, height: 30, cursor: 'pointer'}}>↻</button>}
            {onDuplicatePart && <button onClick={() => onDuplicatePart(selectedPartId)} title="Duplicate (Ctrl+D)" aria-label="Duplicate selected part"
              style={{width: 30, height: 30, cursor: 'pointer'}}>⧉</button>}
            <button onClick={() => { onRemovePart(selectedPartId); onSelectPart(null); }} title="Remove (Del)" aria-label="Remove selected part"
              style={{width: 30, height: 30, cursor: 'pointer', color: '#b91c1c'}}>✕</button>
          </div>
        )}
        <svg
          width="100%"
          height="100%"
          viewBox={`${pan.x} ${pan.y} ${containerSize.w / zoom} ${containerSize.h / zoom}`}
          preserveAspectRatio="none"
          style={{ position: 'absolute', top: 0, left: 0 }}
        >
          <defs>
            <pattern id="grid" width={20} height={20} patternUnits="userSpaceOnUse">
              <circle cx={10} cy={10} r={1} fill="#243447" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />

          {/* Voltage color legend — part of voltage view, anchored to the
              visible top-right corner (pan/zoom aware). */}
          {simulate && voltageView && nodeVoltages && Object.keys(nodeVoltages).length > 0 && (
            <g transform={`translate(${pan.x + containerSize.w / zoom - 105}, ${pan.y + 10}) scale(${1 / zoom})`}>
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
                {t('circuitDesigner', lang)}
              </text>
              <text x={CANVAS_W / 2} y={CANVAS_H / 2} textAnchor="middle"
                fill="#7f8c8d" fontSize={12} fontFamily="monospace">
                {t('addPartsHint', lang)}
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

          {/* Click-to-adjust: one selected part with params gets an inline
              chip that opens the editor — the single-click flow users expect */}
          {(() => {
            if (!selectedParts || selectedParts.size !== 1 || inlineEdit) return null;
            const only = parts.find(q => selectedParts.has(q.id));
            if (!only || !only.params || Object.keys(only.params).length === 0) return null;
            const b = partBounds(only);
            return (
              <g style={{ cursor: 'pointer' }}
                onClick={() => {
                  const el = canvasContainerRef.current;
                  const r = el.getBoundingClientRect();
                  const sx = (b.minX + (b.maxX - b.minX) / 2 - panRef.current.x) * zoomRef.current + r.left;
                  const sy = (b.minY - 14 - panRef.current.y) * zoomRef.current + r.top;
                  setInlineEdit({ partId: only.id, x: sx, y: sy });
                }}>
                <rect x={b.minX + (b.maxX - b.minX) / 2 - 24} y={b.minY - 24}
                  width={48} height={15} rx={7}
                  fill="#f1c40f" stroke="#b7950b" strokeWidth={1} />
                <text x={b.minX + (b.maxX - b.minX) / 2} y={b.minY - 13}
                  textAnchor="middle" fill="#1b2631" fontSize={9}
                  fontFamily="monospace" fontWeight="bold">adjust</text>
              </g>
            );
          })()}

          {/* Seated parts whose body floats off the hole row show LEGS
              dropping into their holes — the answer to "where are the
              poti's connectors?" is drawn, not guessed. */}
          {/* Breadboard substrates render FIRST — SVG paints in document
              order, and these two seated-part layers used to sit above
              this block in the file, which painted them UNDER the board
              (invisible leg dots; owner: "breadboard must be lowest"). */}
          {parts.filter(p => p.kind === 'breadboard').map(bb => (
            <BreadboardView key={bb.id} part={bb}
              model={circuit?.breadboards?.get(bb.id)}
              footprint={bbFootprint(bb)}
              selectedPartId={selectedParts?.size === 1 ? [...selectedParts][0] : null} />
          ))}

          {parts.filter(q => ['led', 'potentiometer', 'button'].includes(q.kind) && q.seat && q._seatTerminals).map(q => (
            <g key={`ledlegs-${q.id}`} style={{ pointerEvents: 'none' }}>
              {Object.values(q._seatTerminals).map((pos, i) => (
                <g key={i}>
                  <line x1={pos.x} y1={q.y - 4} x2={pos.x} y2={pos.y}
                    stroke="#95a5a6" strokeWidth={1.6} />
                  <circle cx={pos.x} cy={pos.y} r={2.2} fill="#95a5a6" />
                </g>
              ))}
            </g>
          ))}

          {dragLegs && (
            <g style={{ pointerEvents: 'none' }} opacity={0.9}>
              {dragLegs.map((leg, i) => (
                <circle key={i} cx={leg.x} cy={leg.y} r={5}
                  fill={leg.free ? '#2ecc71' : '#e74c3c'} fillOpacity={0.55}
                  stroke={leg.free ? '#27ae60' : '#c0392b'} strokeWidth={2} />
              ))}
            </g>
          )}

          {parts.filter(q => q.seat && ['mcu', 'arduino_uno', 'arduino_nano', 'arduino_mega', 'pi_pico'].includes(q.kind)).map(q => {
            // Small checkmark badge at the MCU body's top-right corner.
            // The old 84×16 pill covered pins on crowded benches; this is
            // 14px and stays inside the body outline.
            const sc = typeof getSidecar === 'function'
              ? (getSidecar((q.params?.device || '').toLowerCase().replace(/[^a-z0-9]/g, '')) || getSidecar(q.kind))
              : null;
            const pps = sc?.terminals ? Math.ceil(sc.terminals.length / 2) : 10;
            const bw = (pps - 1) * DIP_PIN_PITCH + 20;
            const bh = q.kind === 'mcu' ? 52 : DIP_ROW_OFFSET * 2 + 10;
            const cx = q.x + bw / 2 - 10;
            const cy = q.y - bh / 2 + 10;
            return (
              <g key={`seat-badge-${q.id}`} style={{pointerEvents: 'auto', cursor: 'default'}}>
                <title>SEATED • PIN RASTER</title>
                <circle cx={cx} cy={cy} r={7} fill="#166534" stroke="#86efac" strokeWidth={1} />
                <text x={cx} y={cy + 3.5} textAnchor="middle" fill="#dcfce7" fontSize={10}
                  fontFamily="system-ui, sans-serif" fontWeight="bold">✓</text>
              </g>
            );
          })}


          {/* Live jumper preview while dragging hole-to-hole */}
          {holeWirePreview && (
            <path d={`M ${holeWirePreview.from.x} ${holeWirePreview.from.y} Q ${(holeWirePreview.from.x + holeWirePreview.to.x) / 2} ${Math.min(holeWirePreview.from.y, holeWirePreview.to.y) - 20} ${holeWirePreview.to.x} ${holeWirePreview.to.y}`}
              fill="none" stroke={holeWirePreview.snapped ? '#2ecc71' : '#e67e22'}
              strokeWidth={2.5} strokeDasharray="6,4" strokeLinecap="round"
              style={{ pointerEvents: 'none' }} />
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
            if (part.seat) return null; // seated legs go INTO holes; stubs toward the centroid are noise
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
          <SvgParts parts={parts} selectedParts={selectedParts} onSelectPart={onSelectPart} onPartBodyClick={handlePartBodyClick}
            deviceStates={(() => {
              // Device faces follow the ACTIVE board — during a debug run
              // that is the runner's board, and reading circuit.board here
              // meant the emulator lit a matrix on a board the canvas never
              // asked (the pendant: engine brightness 0.65, face dark).
              // Same rule the instrument reads already obey.
              const eb = (engineBoard && engineBoard.getDeviceState) ? engineBoard
                : (circuit && circuit.board && circuit.board.getDeviceState) ? circuit.board : null;
              if (!eb) return null;
              const m = new Map();
              for (const p of parts) {
                if (p.kind === 'servo' || p.kind === 'ili9341' || p.kind === 'ili9341_par' || p.kind === 'ili9341_parallel' || p.kind === 'char_lcd' || p.kind === 'hd44780' || p.kind === 'char_lcd_i2c' || p.kind === 'matrix8x8' || p.kind === 'matrix16x8' || p.kind === 'matrix9x9' || p.kind === 'ssd1306' || p.kind === 'max7219' || p.kind === 'bargraph' || p.kind === 'keypad' || p.kind === 'sevenseg8' || p.kind === 'ledbank8' || p.kind === 'joystick' || p.kind === 'slider' || p.kind === 'gauge' || p.kind === 'mono_lcd' || p.kind === 'rgb_light') {
                  let ds = eb.getDeviceState(p.id);
                  // Bargraph: passive device exports no brightness — compute
                  // from branch current across each anode/cathode pair.
                  if (p.kind === 'bargraph' && eb.branchCurrent) {
                    const brightness = new Float64Array(10);
                    for (let i = 0; i < 10; i++) {
                      try {
                        const mA = Math.abs(eb.branchCurrent(p.id, `a${i}`)) * 1000;
                        brightness[i] = Math.min(1, mA / 15); // 15 mA ≈ full brightness
                      } catch { /* net missing */ }
                    }
                    ds = { ...(ds || {}), brightness };
                  }
                  if (ds) m.set(p.id, ds);
                }
              }
              return m.size > 0 ? m : null;
            })()}
            simulate={!!simulate}
            onKeypadKey={onKeypadKey}
            onSetPartParam={onSetPartParam}
            videoFn={videoFn} />

          {/* Placement preview is an interaction overlay: paint it after
              every substrate and part so a board can never cover a Pico,
              Nano, or DIP while it is being positioned. */}
          {placeGhost && (() => {
            const bounds = partBounds(placeGhost);
            // Only faces that really shrink when seated may shrink here.
            // Nano and Pico keep their physical header pitch on a board.
            const seatScale = placeGhost.snapped ? (SEATED_PREVIEW_SCALE[placeGhost.kind] ?? 1) : 1;
            const gw = (bounds.maxX - bounds.minX) * seatScale;
            const gh = (bounds.maxY - bounds.minY) * seatScale;
            return (
              <g data-placement-ghost={placeGhost.kind} style={{ pointerEvents: 'none' }} opacity={0.72}>
                <rect x={placeGhost.x - gw / 2} y={placeGhost.y - gh / 2}
                  width={gw} height={gh} rx={6}
                  fill="#3498db" fillOpacity={0.18}
                  stroke="#60a5fa" strokeWidth={2} strokeDasharray="6,3" />
                <text x={placeGhost.x} y={placeGhost.y + 4} textAnchor="middle"
                  fill="#93c5fd" fontSize={11} fontFamily="monospace">{placeGhost.kind}</text>
                {placeGhost.legs && placeGhost.legs.map((leg, i) => (
                  <circle key={i} cx={leg.x} cy={leg.y} r={4.5}
                    fill={leg.free ? '#2ecc71' : '#e74c3c'} fillOpacity={0.8}
                    stroke={leg.free ? '#27ae60' : '#c0392b'} strokeWidth={1.5} />
                ))}
                {placeGhost.snapped && !placeGhost.legs && (
                  <circle cx={placeGhost.x} cy={placeGhost.y} r={5} fill="none"
                    stroke="#f1c40f" strokeWidth={2} />
                )}
              </g>
            );
          })()}

          {/* ── WIRE LAYERS ── INSIDE the svg, painted after the substrate and
              the SvgParts chip bodies:
              the z contract is boards → parts → wires (owner spec,
              stated twice — the first enforcement of this order died
              UNCOMMITTED in a working tree and never shipped, which is
              why test/z-contract-order.test.js now pins the mount
              order at source level). Selection handles and the rewire
              preview stay last: overlays above everything. NOTE the
              WokwiParts layer is an HTML OVERLAY mounted after this
              svg closes — svg wire elements placed after it are inert
              DOM and render NOTHING (that exact mistake shipped once:
              every jumper vanished from the deployed Blink). Wires
              live here, inside the svg, above the chip bodies; the
              HTML part bodies overlay them, which is bench-real. */}
          <Wires wires={wires} parts={parts} circuit={circuit}
            selectedWire={selectedWire} onSelectWire={onSelectWire}
            hoveredNet={hoveredNet} onHoverNet={setHoveredNet}
            nodeVoltages={nodeVoltages}
            voltageMode={!!(simulate && voltageView && nodeVoltages)}
            onUpdateWire={onUpdateWire} screenToCanvas={screenToCanvas}
            setDraggingWaypoint={setDraggingWaypoint} />
          {simulate && voltageView ?
            <VoltageLabels wires={wires} parts={parts} nodeVoltages={nodeVoltages} circuit={circuit} /> : null}
          {/* Jumper wires. Short hops keep a small arc; LONG jumpers
              route as STAPLES — down into a lane, flat across, up to the
              far hole — the way real hookup wire lies on a board. The
              old 25%-of-distance arc lift turned a seated build's 24
              jumpers into a second hairball (owner screenshot: "double
              wirings, straight and bent"). Lanes: above row a for
              top-block runs, below row j for bottom-block, the center
              gutter for mixed; a per-jumper offset separates parallel
              runs in the same lane. */}
          {circuit && circuit.holeWires && circuit.holeWires().map((jw, jwIdx) => {
            const bb = parts.find(q => q.id === jw.boardId);
            if (!bb) return null;
            const a = holeWorldPos(bb, jw.a), b = holeWorldPos(bb, jw.b);
            if (!a || !b) return null;
            const isSel = selectedWire === jw.ref;
            let jwVColor = null;
            if (simulate && voltageView && nodeVoltages && circuit && circuit.boardStripNets && circuit.breadboards) {
              const strips = circuit.breadboards.get(jw.boardId);
              const map = circuit.boardStripNets.get(jw.boardId);
              const nid = strips && map ? map.get(strips.stripOf(jw.a)) : null;
              const v = nid != null ? nodeVoltages[nid] : null;
              if (v != null) {
                const r = Math.max(0, Math.min(1, v / 5));
                jwVColor = r > 0.8 ? '#e74c3c' : r > 0.4 ? '#f39c12' : r > 0.15 ? '#2ecc71' : '#3498db';
              }
            }
            const color = isSel ? '#f1c40f' : (jwVColor || jw.color || '#e67e22');
            const width = isSel ? 4 : 3;
            let path;
            if (Math.abs(b.x - a.x) <= 4 * BB_PITCH) {
              const lift = Math.max(12, Math.hypot(b.x - a.x, b.y - a.y) * 0.2);
              const midY = Math.min(a.y, b.y) - lift;
              path = `M ${a.x} ${a.y} Q ${(a.x + b.x) / 2} ${midY} ${b.x} ${b.y}`;
            } else {
              const o = bbHoleOrigin(bb);
              const topBlock = (y) => y < (o.topRowsY + o.bottomRowsY) / 2;
              const offset = (jwIdx % 4) * 4;
              let laneY;
              if (topBlock(a.y) && topBlock(b.y)) laneY = o.topRowsY - 12 - offset;
              else if (!topBlock(a.y) && !topBlock(b.y)) laneY = o.bottomRowsY + 4 * BB_PITCH + 12 + offset;
              else laneY = (o.topRowsY + 4 * BB_PITCH + o.bottomRowsY) / 2 + (offset - 6);
              const r = 6; // corner radius
              const dirA = laneY < a.y ? -1 : 1;
              const dirB = laneY < b.y ? 1 : -1;
              const sx = a.x < b.x ? 1 : -1;
              path = `M ${a.x} ${a.y} L ${a.x} ${laneY + r * -dirA}`
                + ` Q ${a.x} ${laneY} ${a.x + r * sx} ${laneY}`
                + ` L ${b.x - r * sx} ${laneY}`
                + ` Q ${b.x} ${laneY} ${b.x} ${laneY + r * dirB}`
                + ` L ${b.x} ${b.y}`;
            }
            return (
              <g key={jw.ref} data-jumper={jw.ref} style={{ pointerEvents: 'none' }}>
                <path d={path} fill="none" stroke={color}
                  strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
                <circle cx={a.x} cy={a.y} r={3} fill={jw.color || '#e67e22'} />
                <circle cx={b.x} cy={b.y} r={3} fill={jw.color || '#e67e22'} />
              </g>
            );
          })}

          {/* Tap wires: part terminal → board hole. A rail tap used to
              draw as a lazy bezier straight across the board FACE — on
              the 6502 LED board, eight of them crossed every row and
              every part (owner screenshot). Real hookup wire hugs the
              COLUMN GAP: jog half a pitch into the gap beside the hole,
              run vertically there, jog back at the far end. Taps that
              share a gap get a small per-index offset like the staple
              lanes, so parallel rail drops comb instead of overprint. */}
          {(() => {
            const taps = wires.filter(w => isBoardEndpoint(w.from) || isBoardEndpoint(w.to));
            const gapUse = new Map(); // rounded gapX → count so far
            return taps.map((w) => {
              const endPos = (e) => {
                if (isBoardEndpoint(e)) {
                  const bb = parts.find(q => q.id === (e.board || e.boardId));
                  return bb ? holeWorldPos(bb, e.hole) : null;
                }
                const pp = parts.find(q => q.id === e.part);
                return pp ? terminalPos(pp, e.terminal) : null;
              };
              const a = endPos(w.from), b = endPos(w.to);
              if (!a || !b) return null;
              const isSel = selectedWire === w.id;
              const color = isSel ? '#f1c40f' : (w.color || '#c0392b');
              let d;
              const r = 5;
              if (Math.abs(b.x - a.x) <= BB_PITCH && Math.abs(b.y - a.y) > 3 * r) {
                // Same-column rail drop: run in the gap beside the holes.
                const gapKey = Math.round((a.x + BB_PITCH / 2) / 4);
                const n = gapUse.get(gapKey) || 0;
                gapUse.set(gapKey, n + 1);
                const gapX = a.x + BB_PITCH / 2 + (n % 3) * 3;
                const sy = b.y > a.y ? 1 : -1;
                d = `M ${a.x} ${a.y} Q ${gapX} ${a.y} ${gapX} ${a.y + sy * r}` +
                  ` L ${gapX} ${b.y - sy * r}` +
                  ` Q ${gapX} ${b.y} ${b.x} ${b.y}`;
              } else {
                // Different-column tap: vertical in the source gap, then
                // horizontal at the target row — a staple lying on its side.
                const sx0 = b.x > a.x ? 1 : -1;
                const gapX = a.x + sx0 * (BB_PITCH / 2);
                const sy = b.y > a.y ? 1 : -1;
                d = `M ${a.x} ${a.y} Q ${gapX} ${a.y} ${gapX} ${a.y + sy * r}` +
                  ` L ${gapX} ${b.y - sy * r}` +
                  ` Q ${gapX} ${b.y} ${gapX + sx0 * r} ${b.y}` +
                  ` L ${b.x} ${b.y}`;
              }
              return (
                <g key={w.id} data-wire={w.id} style={{ pointerEvents: 'none' }}>
                  <path d={d} fill="none" stroke={color}
                    strokeWidth={isSel ? 4 : 3} strokeLinecap="round" />
                  <circle cx={a.x} cy={a.y} r={3} fill={w.color || '#c0392b'} />
                  <circle cx={b.x} cy={b.y} r={3} fill={w.color || '#c0392b'} />
                </g>
              );
            });
          })()}

          {/* Selected wire: endpoint grab handles for re-routing */}
          {(() => {
            if (!selectedWire || typeof selectedWire !== 'string' || selectedWire.startsWith('bbw:')) return null;
            const w = wires.find(q => q.id === selectedWire);
            if (!w) return null;
            const endPos = (e) => {
              if (e.board) {
                const bb = parts.find(q => q.id === e.board);
                return bb ? holeWorldPos(bb, e.hole) : null;
              }
              const pp = parts.find(q => q.id === e.part);
              return pp ? terminalPos(pp, e.terminal) : null;
            };
            const a = endPos(w.from), b = endPos(w.to);
            if (!a || !b) return null;
            return (
              <g style={{ pointerEvents: 'none' }}>
                {[a, b].map((pt, i) => (
                  <circle key={i} cx={pt.x} cy={pt.y} r={7} fill="none"
                    stroke="#f1c40f" strokeWidth={2.5} strokeDasharray="3,2" />
                ))}
              </g>
            );
          })()}

          {/* Re-routing preview: fixed end to cursor, green when snapped */}
          {rewirePreview && (
            <line x1={rewirePreview.from.x} y1={rewirePreview.from.y}
              x2={rewirePreview.to.x} y2={rewirePreview.to.y}
              stroke={rewirePreview.snapped ? '#2ecc71' : '#f1c40f'}
              strokeWidth={2.5} strokeDasharray="6,4" strokeLinecap="round"
              style={{ pointerEvents: 'none' }} />
          )}

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

          {/* Active-block part highlights (debugger shows which part the halted block controls) */}
          {activePartIds && activePartIds.map(partId => {
            const part = parts.find(p => p.id === partId || p.declName === partId);
            if (!part) return null;
            return (
              <g key={`active-${partId}`}>
                <circle cx={part.x} cy={part.y} r={30}
                  fill="none" stroke="#3498db" strokeWidth={2}
                  strokeDasharray="4,3" opacity={0.8}>
                  <animate attributeName="stroke-dashoffset"
                    from="0" to="14" dur="1s" repeatCount="indefinite" />
                </circle>
              </g>
            );
          })}

          <TerminalDots parts={parts} wires={wires} wiringFrom={wiringFrom}
                onTerminalClick={handleTerminalClick}
                onTerminalDown={handleTerminalDown}
                onTerminalUp={handleTerminalUp}
                placingProbe={placingProbe}
                selectedParts={selectedParts}
                hoveredPart={hoveredPart} />

          {/* DRC warning badges on parts */}
          {drcWarnings && drcWarnings.length > 0 && (
            <DrcOverlay warnings={drcWarnings} parts={parts} />
          )}
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
            sevenSegments={sevenSegments}
            sevenSeg3={sevenSeg3}
            buzzerTones={buzzerTones}
            meterReadings={(() => {
              const readings = {};
              for (const p of parts) {
                if (p.kind === 'meter' && circuit) {
                  readings[p.id] = getMeterReading(p, wires, circuit);
                }
              }
              return readings;
            })()}
            cubeScans={cubeScans}
            onSelectPart={onSelectPart}
            selectedParts={selectedParts}
            simulate={!!simulate}
            onControlChange={onControlChange}
            onKeypadKey={onKeypadKey}
            onButtonDown={onButtonDown}
            onButtonUp={onButtonUp}
            onDragStart={(partId) => setDragging(partId)}
            onHoverPart={(partId, cx, cy) => {
              setHoveredPart(partId);
              if (partId) setHoverPos({ x: cx, y: cy });
            }}
            onPartBodyClick={handlePartBodyClick}
            onDoubleClick={(partId, cx, cy) => setInlineEdit({ partId, x: cx, y: cy })}
            deviceStates={(() => {
              // Active-board rule, same as the SvgParts faces above.
              const eb = (engineBoard && engineBoard.getDeviceState) ? engineBoard
                : (circuit && circuit.board && circuit.board.getDeviceState) ? circuit.board : null;
              if (!eb) return null;
              const m = new Map();
              for (const p of parts) {
                if (p.kind === 'char_lcd' || p.kind === 'hd44780' || p.kind === 'char_lcd_i2c') {
                  const ds = eb.getDeviceState(p.id);
                  if (ds) m.set(p.id, ds);
                }
              }
              return m.size > 0 ? m : null;
            })()}
            controlValues={(() => {
              // Read pot/control positions from the active board so the
              // knob graphic tracks the actual engine state.
              const eb = (engineBoard && engineBoard.getControl) ? engineBoard
                : (circuit && circuit.board && circuit.board.getControl) ? circuit.board : null;
              if (!eb) return null;
              const m = new Map();
              for (const p of parts) {
                if (p.kind === 'potentiometer') {
                  const v = eb.getControl(p.id);
                  if (v != null) m.set(p.id, v);
                }
              }
              return m.size > 0 ? m : null;
            })()}
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
        {pinChooser && (() => {
          const chip = parts.find(q => q.id === pinChooser.partId);
          if (!chip) { return null; }
          const done = (pin) => {
            const f = pinChooser.from;
            if (f.partId) onAddWire && onAddWire(f.partId, f.terminal, chip.id, pin);
            else if (f.boardId && onAddTapWire) onAddTapWire(chip.id, pin, f.boardId, f.hole);
            setPinChooser(null);
          };
          return (
            <div style={{ position: 'absolute', inset: 0, zIndex: 40, background: 'rgba(10,14,26,0.55)' }}
              /* The canvas container's pointer machine captures pointerdown
                 before any child click can fire — the dialog must stop the
                 POINTER events, or its buttons are dead (found live: the
                 chooser opened, every click fell through to the canvas). */
              onPointerDown={e => e.stopPropagation()}
              onPointerUp={e => e.stopPropagation()}
              onClick={() => setPinChooser(null)}>
              <div onClick={e => e.stopPropagation()} style={{
                position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
                background: '#16213e', border: '1px solid #2c3e50', borderRadius: 8,
                padding: 12, width: 460, maxHeight: '75%', overflowY: 'auto',
                fontFamily: 'monospace', color: '#dfe6ee', boxShadow: '0 12px 40px rgba(0,0,0,.5)',
              }}>
                <div style={{ fontSize: 12, marginBottom: 8, color: '#9ab0c4' }}>
                  {t('pinChooserPrompt', lang, { chip: chip.declName || chip.id })}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3 }}>
                  {(chip.terminals || []).map(pin => (
                    <button key={pin} onClick={() => done(pin)} style={{
                      display: 'flex', gap: 8, alignItems: 'baseline', textAlign: 'left',
                      background: '#1a2540', color: '#dfe6ee', border: '1px solid #2c3e50',
                      borderRadius: 4, padding: '4px 8px', cursor: 'pointer', fontFamily: 'monospace',
                    }}>
                      <span style={{ fontSize: 11, minWidth: 46 }}>{pin}</span>
                      <span style={{ fontSize: 9, color: '#9ab0c4' }}>{pinInfoForPart(chip, pin)}</span>
                    </button>
                  ))}
                </div>
                <div style={{ marginTop: 8, fontSize: 9, color: '#556' }}>{t('pinChooserCancel', lang)}</div>
              </div>
            </div>
          );
        })()}

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
          onFlip={() => {
            if (selectedPart && onFlipPart) onFlipPart(selectedPart);
            setContextMenu(null);
          }}
          onSetWireColor={(color) => {
            if (selectedWire && onUpdateWire) {
              onUpdateWire(selectedWire, { color: color || undefined });
            }
            setContextMenu(null);
          }}
        />
      </div>
    </div>
  );
}

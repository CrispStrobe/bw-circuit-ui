/**
 * PartPalette — categorized sidebar with search, drag-to-add.
 *
 * Every part kind that BoardCanvas can render should be here.
 * Parts with minimal electrical models are labeled "(drawable)".
 */

import React, { useState } from 'react';
import { PartThumbnail } from './PartThumbnail.jsx';

const LED_COLORS = ['red', 'green', 'yellow', 'blue', 'white', 'orange'];

const CATEGORIES = [
  {
    name: 'Boards',
    parts: [
      { kind: 'breadboard', label: 'Breadboard', params: {}, color: '#e8e4d8',
        tooltip: 'Full-size breadboard (63 columns) - legs snap into holes, rows and rails conduct' },
      { kind: 'breadboard', label: 'Breadboard ½', params: { size: 'half' }, color: '#e8e4d8',
        tooltip: 'Half-size breadboard (30 columns) with power rails' },
      { kind: 'breadboard', label: 'Breadboard mini', params: { size: 'mini' }, color: '#e8e4d8',
        tooltip: 'Mini 170-point breadboard (17 columns) - no power rails, like the real one' },
      { kind: 'arduino_uno', label: 'Arduino Uno', params: {}, color: '#168aad',
        capability: 'AVR simulation',
        tooltip: 'ATmega328P board — 5 V logic, digital and analog headers' },
      { kind: 'arduino_nano', label: 'Arduino Nano', params: {}, color: '#168aad',
        capability: 'AVR simulation',
        tooltip: 'ATmega328P Nano board — 5 V logic, compact headers' },
      { kind: 'pi_pico', label: 'Raspberry Pi Pico', params: {}, color: '#7b2cbf',
        capability: 'wiring only',
        tooltip: 'RP2040 board — 3.3 V logic; do not connect 5 V signals' },
      { kind: 'attiny2313', label: 'ATtiny2313', params: {}, color: '#168aad',
        capability: 'AVR simulation',
        tooltip: 'DIP-20 MCU — 2 KB flash, UART (PD0/PD1), no ADC' },
      { kind: 'attiny13', label: 'ATtiny13', params: {}, color: '#168aad',
        capability: 'AVR simulation',
        tooltip: 'DIP-8 MCU — 1 KB flash, 4-ch ADC, Timer0' },
    ],
  },
  {
    name: 'Power',
    parts: [
      { kind: 'vsource', label: '9V Battery', color: '#f4d03f',
        params: { variant: '9v', volts: 9 }, tooltip: 'Real battery - click to adjust voltage' },
      { kind: 'vsource', label: 'AA Battery', color: '#b03a2e',
        params: { variant: 'aa', volts: 1.5 }, tooltip: '1.5 V cell' },
      { kind: 'vsource', label: 'Coin Cell', color: '#d5d8dc',
        params: { variant: 'coin', volts: 3 }, tooltip: '3 V lithium coin cell' },
      { kind: 'vsource', label: 'Bench Supply', color: '#e74c3c',
        params: { variant: 'bench', volts: 5, iLimit: 0.5 },
        tooltip: 'Adjustable DC supply — CV/CC mode, turn up voltage and watch current clamp' },
      { kind: 'vcc', label: '+5V post', params: { volts: 5 }, color: '#e74c3c',
        tooltip: 'Bench supply binding post — editable voltage (default 5 V)' },
      { kind: 'gnd', label: 'GND post', params: {}, color: '#3498db',
        tooltip: 'Bench supply binding post (ground)' },
    ],
  },
  {
    name: 'Passive',
    parts: [
      { kind: 'resistor', label: 'Resistor 1kΩ', params: { ohms: 1000 }, color: '#e67e22' },
      { kind: 'capacitor', label: 'Capacitor 100µF', params: { farads: 0.0001 }, color: '#34495e' },
      { kind: 'inductor', label: 'Inductor 10mH', params: { henrys: 0.01 }, color: '#9b59b6', tooltip: 'Coil' },
      { kind: 'diode', label: 'Diode', params: { vf: 0.7 }, color: '#95a5a6' },
      { kind: 'zener', label: 'Zener Diode', params: { vf: 0.7, vz: 5.1 }, color: '#e67e22', tooltip: 'Voltage regulator diode' },
      { kind: 'switch', label: 'Switch', params: {}, color: '#bdc3c7' },
      { kind: 'slide_switch', label: 'Slide Switch', params: {}, color: '#bdc3c7', tooltip: 'SPDT' },
      { kind: 'photodiode', label: 'Photodiode', params: { vf: 0.7 }, color: '#f39c12' },
      { kind: 'solar_cell', label: 'Solar Cell', params: {}, color: '#f1c40f' },
      { kind: 'light_bulb', label: 'Light Bulb', params: {}, color: '#f39c12', tooltip: 'Resistive' },
    ],
  },
  {
    name: 'Active',
    parts: [
      { kind: 'led', label: 'LED', params: { vf: 2.0, color: 'red' }, color: '#2ecc71', hasColorPicker: true },
      { kind: 'rgb_led', label: 'RGB LED', params: { vf_r: 2.0, vf_g: 2.2, vf_b: 3.0 }, color: '#e74c3c', tooltip: 'Common cathode' },
      { kind: 'neopixel', label: 'NeoPixel', params: {}, color: '#2ecc71', tooltip: 'WS2812B addressable LED' },
      { kind: 'buzzer', label: 'Buzzer', params: {}, color: '#1abc9c' },
    ],
  },
  {
    name: 'Transistors',
    parts: [
      { kind: 'npn', label: 'NPN', params: { beta: 100, vbe: 0.7 }, color: '#8e44ad', tooltip: '2N2222 type' },
      { kind: 'pnp', label: 'PNP', params: { beta: 100, vbe: 0.7 }, color: '#8e44ad', tooltip: '2N2907 type' },
      { kind: 'nmos', label: 'N-MOSFET', params: { vth: 2.0 }, color: '#27ae60' },
      { kind: 'pmos', label: 'P-MOSFET', params: { vth: 2.0 }, color: '#27ae60' },
      { kind: 'tip120', label: 'TIP120', params: { beta: 1000 }, color: '#8e44ad', tooltip: 'Darlington — high beta, 2× Vbe' },
    ],
  },
  {
    name: 'I/O',
    parts: [
      { kind: 'potentiometer', label: 'Pot 10kΩ', params: { ohms: 10000 }, color: '#9b59b6' },
      { kind: 'button', label: 'Button', params: {}, color: '#f39c12' },
      { kind: 'dip_switch', label: 'DIP Switch', params: { switches: 4 }, color: '#bdc3c7', tooltip: '4-position SPST' },
      { kind: 'keypad', label: '4×4 Keypad', params: {}, color: '#7f8c8d' },
      { kind: 'ir_remote', label: 'IR Remote', params: {}, color: '#c0392b', tooltip: 'Transmitter' },
      { kind: 'mcu', label: 'MCU (STC12)', params: { pins: ['P1.0', 'P1.3', 'P1.5', 'P3.2'] }, color: '#7f8c8d' },
    ],
  },
  {
    name: 'Power Control',
    parts: [
      { kind: 'relay', label: 'Relay SPDT', params: {}, color: '#e67e22' },
      { kind: 'relay_dpdt', label: 'Relay DPDT', params: {}, color: '#e67e22' },
      { kind: 'l293d', label: 'L293D', params: {}, color: '#e74c3c', tooltip: 'H-bridge motor driver — built-in flyback' },
    ],
  },
  {
    name: 'Connectors',
    parts: [
      { kind: 'header', label: '8-Pin Header', params: { pins: 8 }, color: '#7f8c8d' },
      { kind: 'usb_a', label: 'USB-A', params: {}, color: '#bdc3c7', tooltip: 'Connector — drawable' },
    ],
  },
  {
    name: 'Sensors',
    parts: [
      { kind: 'ldr', label: 'LDR', params: { rDark: 200000, rLight: 500 }, color: '#e67e22', tooltip: 'Light-dependent resistor' },
      { kind: 'ntc', label: 'NTC Thermistor', params: { rCold: 10000, rHot: 1000 }, color: '#16a085', tooltip: 'Temperature sensor' },
      { kind: 'tmp36', label: 'TMP36', params: {}, color: '#16a085', tooltip: 'Analog temp — 10 mV/°C' },
      { kind: 'pir_sensor', label: 'PIR Sensor', params: {}, color: '#27ae60', tooltip: 'Motion detector' },
      { kind: 'ultrasonic', label: 'Ultrasonic', params: {}, color: '#3498db', tooltip: 'HC-SR04 distance sensor' },
      { kind: 'soil_moisture', label: 'Soil Moisture', params: {}, color: '#8B4513' },
      { kind: 'gas_sensor', label: 'Gas Sensor', params: {}, color: '#7f8c8d', tooltip: 'MQ series' },
      { kind: 'tilt_sensor', label: 'Tilt Sensor', params: {}, color: '#95a5a6' },
    ],
  },
  {
    name: 'Motors',
    parts: [
      { kind: 'dc_motor', label: 'DC Motor', params: {}, color: '#3498db' },
      { kind: 'gearmotor', label: 'Gearmotor', params: {}, color: '#3498db' },
      { kind: 'motor_encoder', label: 'Motor + Encoder', params: {}, color: '#3498db', tooltip: 'Quadrature output' },
      { kind: 'servo', label: 'Micro Servo', params: {}, color: '#f39c12' },
      { kind: 'vibration_motor', label: 'Vibration Motor', params: {}, color: '#e67e22' },
    ],
  },
  {
    name: 'Display',
    parts: [
      { kind: 'seven_segment', label: '7-Segment', params: {}, color: '#e74c3c', tooltip: 'Digit display' },
      { kind: 'char_lcd', label: 'LCD 16×2', params: {}, color: '#2980b9', tooltip: 'HD44780 parallel' },
      { kind: 'char_lcd_i2c', label: 'LCD I²C', params: {}, color: '#2980b9', tooltip: 'PCF8574 backpack' },
      { kind: 'clock_display', label: 'Clock Display', params: {}, color: '#e74c3c', tooltip: 'TM1637 4-digit' },
      { kind: 'led_matrix', label: 'LED Matrix', params: {}, color: '#27ae60', tooltip: 'drawable — 8×8' },
      { kind: 'led_cube', label: 'LED Cube 4³', params: {}, color: '#2ecc71' },
    ],
  },
  {
    name: 'Logic',
    parts: [
      { kind: '74hc00', label: '74HC00 NAND', params: {}, color: '#9b59b6', tooltip: 'Quad 2-input NAND — DIP-14' },
      { kind: '74hc02', label: '74HC02 NOR', params: {}, color: '#9b59b6', tooltip: 'Quad 2-input NOR — DIP-14' },
      { kind: '74hc04', label: '74HC04 NOT', params: {}, color: '#9b59b6', tooltip: 'Hex inverter — DIP-14' },
      { kind: '74hc08', label: '74HC08 AND', params: {}, color: '#9b59b6', tooltip: 'Quad 2-input AND — DIP-14' },
      { kind: '74hc32', label: '74HC32 OR', params: {}, color: '#9b59b6', tooltip: 'Quad 2-input OR — DIP-14' },
      { kind: '74hc86', label: '74HC86 XOR', params: {}, color: '#9b59b6', tooltip: 'Quad 2-input XOR — DIP-14' },
    ],
  },
  {
    name: 'ICs',
    parts: [
      { kind: 'opamp', label: 'Op-Amp', params: { gain: 100000 }, color: '#e67e22', tooltip: 'LM741 type' },
      { kind: '555', label: '555 Timer', params: {}, color: '#e74c3c' },
      { kind: 'shift_register', label: '74HC595', params: {}, color: '#8e44ad', tooltip: 'Shift register — 8 outputs' },
      { kind: 'ir_receiver', label: 'IR Receiver', params: {}, color: '#c0392b', tooltip: 'drawable — IrDA' },
      { kind: 'temp_sensor', label: 'Temp Sensor', params: {}, color: '#16a085', tooltip: 'drawable — DS18B20' },
      { kind: 'pcf8574', label: 'PCF8574', params: {}, color: '#8e44ad', tooltip: 'I²C 8-bit I/O expander' },
      { kind: 'eeprom', label: 'EEPROM', params: {}, color: '#2c3e50', tooltip: 'drawable — I²C' },
      { kind: 'at24c64', label: '24C64 EEPROM', params: {}, color: '#2c3e50', tooltip: 'I²C 8 KB EEPROM — DIP-8, address straps A0-A2, WP write-protect (blinkenrocket: SOIC-8 EIAJ)' },
    ],
  },
  {
    name: 'Instruments',
    parts: [
      { kind: 'meter', label: 'Multimeter', params: { mode: 'voltage' }, color: '#f1c40f' },
      { kind: 'vsource', label: 'Function Gen', color: '#2ecc71',
        params: { wave: 'sine', freq: 1000, amplitude: 2, offset: 2.5 },
        tooltip: 'Waveform source - sine, square, triangle, pulse, dc; edit params after placing' },
    ],
  },
];

const ALL_PARTS = CATEGORIES.flatMap(c => c.parts);

export function PartPalette({ onAddPart, onDragPart, onStartPlace, theme = 'dark' }) {
  const [filter, setFilter] = useState('');
  const [ledColor, setLedColor] = useState('red');
  const light = theme === 'light';
  const palette = light ? {
    background: '#f8fafc', border: '#cbd5e1', text: '#1e293b', input: '#fff',
    inputText: '#334155', category: '#475569', card: '#fff', hover: '#e0f2fe',
    cardBorder: '#94a3b8', muted: '#64748b'
  } : {
    background: '#172033', border: '#2c3e50', text: '#f8fafc', input: '#0b1220',
    inputText: '#f8fafc', category: '#b8c7d9', card: '#20324d', hover: '#29466a',
    cardBorder: '#6383a8', muted: '#cbd5e1'
  };

  const matchingParts = filter
    ? ALL_PARTS.filter(p =>
        p.label.toLowerCase().includes(filter.toLowerCase()) ||
        p.kind.includes(filter.toLowerCase()) ||
        (p.tooltip || '').toLowerCase().includes(filter.toLowerCase()))
    : null;

  return (
    <div data-parts-palette="true" style={{
      background: palette.background,
      border: `1px solid ${palette.border}`,
      borderRadius: '8px',
      padding: '8px',
      width: '100%',
      boxSizing: 'border-box',
      minWidth: 0,
      minHeight: 0,
      fontFamily: 'inherit',
      flex: '1 1 0',
      flexShrink: 1,
      overflowY: 'auto',
      overscrollBehavior: 'contain',
    }}>
      <div style={{ color: palette.text, fontSize: '11px', marginBottom: '4px', fontWeight: 'bold' }}>
        Parts
      </div>

      <input
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="search..."
        style={{
          width: '100%', padding: '4px 6px', marginBottom: '6px',
          background: palette.input, border: `1px solid ${palette.cardBorder}`,
          borderRadius: '4px', color: palette.inputText,
          fontFamily: 'inherit', fontSize: '10px',
          boxSizing: 'border-box',
        }}
      />

      {matchingParts ? (
        matchingParts.length === 0 ? (
          <div style={{ color: palette.muted, fontSize: '9px', padding: '4px' }}>No matches</div>
        ) : (
          matchingParts.map((p, i) => <PartButton key={`${p.kind}-${p.label}-${i}`} palette={palette} part={p} onAddPart={onAddPart} onDragPart={onDragPart} onStartPlace={onStartPlace} ledColor={ledColor} onLedColorChange={setLedColor} />)
        )
      ) : (
        CATEGORIES.map(cat => (
          <div key={cat.name}>
            <div style={{ color: palette.category, fontSize: '8px', marginTop: '4px', marginBottom: '2px', textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 700 }}>
              {cat.name}
            </div>
            {cat.parts.map((p, i) => <PartButton key={`${p.kind}-${p.label}-${i}`} palette={palette} part={p} onAddPart={onAddPart} onDragPart={onDragPart} onStartPlace={onStartPlace} ledColor={ledColor} onLedColorChange={setLedColor} />)}
          </div>
        ))
      )}
    </div>
  );
}

function PartButton({ part, palette, onAddPart, onDragPart, onStartPlace, ledColor, onLedColorChange }) {
  const { kind, label, params, color, tooltip, capability, hasColorPicker } = part;
  const [hovered, setHovered] = useState(false);

  // For LEDs, use the selected color
  const effectiveParams = kind === 'led' ? { ...params, color: ledColor } : params;

  return (
    <div style={{ position: 'relative' }}>
      <div
        onPointerDown={() => {
          // Arm ghost placement: press-drag-release onto the canvas, or
          // click here and click the canvas — both commit at the cursor.
          if (onStartPlace) onStartPlace(kind, effectiveParams);
          else onAddPart(kind, effectiveParams);
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        title={tooltip || label}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          width: '100%',
          padding: '4px',
          marginBottom: '3px',
          background: hovered ? palette.hover : palette.card,
          border: `1px solid ${hovered ? color : palette.cardBorder}`,
          borderRadius: '6px',
          cursor: 'grab',
          userSelect: 'none',
          touchAction: 'manipulation',
          boxSizing: 'border-box',
          transition: 'border-color 80ms, background 80ms',
        }}
      >
        <PartThumbnail kind={kind} color={color} params={effectiveParams} />
        <div style={{
          color: palette.text,
          fontFamily: 'inherit',
          fontSize: '9px',
          textAlign: 'center',
          lineHeight: '1.2',
          marginTop: '2px',
        }}>
          {kind === 'led' ? `LED (${ledColor})` : label}
        </div>
        {capability && (
          <div style={{
            color: capability === 'wiring only' ? '#a16207' : '#047857',
            fontSize: '7px', textAlign: 'center', marginTop: '2px',
            letterSpacing: '.02em',
          }}>
            {capability}
          </div>
        )}
        {tooltip && (
          <div style={{ color: '#a9bdd2', fontSize: '7px', textAlign: 'center' }}>{tooltip}</div>
        )}
      </div>

      {/* LED color swatch picker */}
      {hasColorPicker && (
        <div style={{ display: 'flex', gap: '2px', padding: '2px 4px', marginBottom: '2px', justifyContent: 'center' }}>
          {LED_COLORS.map(c => (
            <div
              key={c}
              onClick={() => onLedColorChange(c)}
              style={{
                width: '12px', height: '12px', borderRadius: '50%',
                background: c === 'white' ? '#eee' : c,
                border: c === ledColor ? '2px solid #fff' : '1px solid #444',
                cursor: 'pointer',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

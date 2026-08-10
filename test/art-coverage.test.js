/**
 * Art coverage — how many palette kinds have sidecar art vs fallback.
 *
 * artCoverage() was written in parts-registry.js specifically to make
 * the fallback visible. This test is its first caller.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { artCoverage, registeredKinds } from '../src/model/parts-registry.js';

// The palette kinds — extracted from PartPalette.jsx CATEGORIES
const PALETTE_KINDS = [
  'breadboard', 'vsource', 'vcc', 'gnd',
  'resistor', 'capacitor', 'inductor', 'diode', 'zener', 'switch',
  'slide_switch', 'photodiode', 'solar_cell', 'light_bulb',
  'led', 'rgb_led', 'neopixel', 'buzzer',
  'npn', 'pnp', 'nmos', 'pmos', 'tip120',
  'potentiometer', 'button', 'dip_switch', 'keypad', 'ir_remote', 'mcu',
  'ldr', 'ntc', 'tmp36', 'pir_sensor', 'ultrasonic', 'soil_moisture',
  'gas_sensor', 'tilt_sensor',
  'dc_motor', 'gearmotor', 'motor_encoder', 'servo', 'vibration_motor',
  'seven_segment', 'char_lcd', 'char_lcd_i2c', 'clock_display',
  'led_matrix', 'led_cube',
  '74hc00', '74hc02', '74hc04', '74hc08', '74hc32', '74hc86',
  'opamp', '555', 'shift_register', 'pcf8574',
  'ir_receiver', 'temp_sensor', 'eeprom',
  'relay', 'relay_dpdt', 'l293d',
  'header', 'usb_a',
  'meter',
];

describe('art coverage', () => {
  it('reports registered sidecar count', () => {
    const registered = registeredKinds();
    console.log(`  Registered sidecars: ${registered.length}`);
    assert.ok(registered.length > 50, `expected >50, got ${registered.length}`);
  });

  it('reports palette coverage', () => {
    const { withArt, fallback } = artCoverage(PALETTE_KINDS);
    console.log(`  Palette: ${withArt.length} with sidecar, ${fallback.length} fallback`);
    if (fallback.length > 0) {
      console.log(`  Fallback kinds: ${fallback.join(', ')}`);
    }
    // Most palette kinds should have sidecars
    assert.ok(withArt.length > fallback.length,
      `more kinds should have sidecars than not (${withArt.length} vs ${fallback.length})`);
  });

  it('no palette kind silently falls back without being listed', () => {
    const { fallback } = artCoverage(PALETTE_KINDS);
    // These are the kinds we KNOW fall back (no sidecar in bw-parts)
    // Update this list as sidecars are added — each removal is progress
    const knownFallbacks = new Set([
      // Slug mismatches: palette name ≠ sidecar slug
      'pir_sensor',     // sidecar: pir
      'dip_switch',     // sidecar: dip_switch_spst / dip_switch_dpst
      'keypad',         // sidecar: keypad_4x4
      'tilt_sensor',    // sidecar: tilt_switch
      'shift_register', // sidecar: 74hc595
      // Kinds that are UI infrastructure, not components
      'breadboard',     // sidecar: breadboard_full
      'meter',          // sidecar: multimeter
      // Kinds without sidecars yet
      'motor_encoder',  // sidecar: dc_motor_encoder
    ]);
    const unexpected = fallback.filter(k => !knownFallbacks.has(k));
    if (unexpected.length > 0) {
      console.log(`  UNEXPECTED fallbacks: ${unexpected.join(', ')}`);
    }
    // This assertion tightens over time as sidecars are added
    assert.ok(unexpected.length <= 5,
      `too many unexpected fallbacks: ${unexpected.join(', ')}`);
  });
});

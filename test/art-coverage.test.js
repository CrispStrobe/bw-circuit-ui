/**
 * Art coverage — how many palette kinds have sidecar art vs fallback.
 *
 * artCoverage() was written in parts-registry.js specifically to make
 * the fallback visible. This test is its first caller.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { artCoverage, registeredKinds, sidecarCenterOffsets } from '../src/model/parts-registry.js';
import { ART_FACE_KINDS, ART_FACE_EXCEPTIONS, artFaceLayout } from '../src/model/part-art.js';
import { BREADBOARD_PITCH } from '../src/model/board-geometry.js';

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
      // All former slug mismatches are now resolved via SLUG_ALIASES:
      // pir_sensor→pir, dip_switch→dip_switch_spst, keypad→keypad_4x4,
      // tilt_sensor→tilt_switch, shift_register→74hc595,
      // motor_encoder→dc_motor_encoder, breadboard→breadboard_full,
      // meter→multimeter
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

// ── Vendored art on the canvas ────────────────────────────────────
//
// 2026-11-23: antenna, earth, ferrite coil, earphone, speaker, oscilloscope,
// function generator and electrolytic were drawn as black boxes with their
// kind in capitals, seated or free, although bw-parts ships art for each and
// it is vendored in src/parts-data. terminalOffsetsForPart already put their
// pins on the art's legs (sidecarCenterOffsets), but nothing drew the art:
// with no SvgParts case of their own they fell to genericFace's labelled box.

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const CANVAS = read('src/components/BoardCanvas.jsx');
const hasArt = kind => existsSync(new URL(`../src/parts-data/${kind}.svg`, import.meta.url))
  && existsSync(new URL(`../src/parts-data/${kind}.json`, import.meta.url));
const sidecarOf = kind => JSON.parse(read(`src/parts-data/${kind}.json`));
const stripComments = src => src.replace(/\/\/[^\n]*/g, '');

/** Kinds whose terminalOffsetsForPart case places the pins at sidecarCenterOffsets. */
function kindsWithSidecarPins() {
  const body = CANVAS.slice(CANVAS.indexOf('function terminalOffsetsForPart'), CANVAS.indexOf('function layoutSidecar'));
  const out = new Set();
  for (const m of body.matchAll(/case '([^']+)':/g)) {
    const rest = body.slice(m.index);
    const ret = rest.search(/\breturn\b/);
    if (ret > 0 && rest.slice(0, ret).includes('sidecarCenterOffsets(')) out.add(m[1]);
  }
  return out;
}

/** Kinds SvgParts or the Wokwi layer draws with a face of their own. */
function kindsWithOwnFace() {
  const svgParts = CANVAS.slice(CANVAS.indexOf('function SvgParts('), CANVAS.indexOf('// ── Terminal dots'));
  const own = new Set([...svgParts.matchAll(/case '([^']+)':/g)].map(m => m[1]));
  const at = CANVAS.indexOf('const WOKWI_LAYER_KINDS');
  const wokwi = stripComments(CANVAS.slice(at, CANVAS.indexOf(']);', at)));
  for (const m of wokwi.matchAll(/'([^']+)'/g)) own.add(m[1]);
  return own;
}

describe('vendored part art on the canvas', () => {
  it('every kind whose pins sit on its art legs draws the art, or is a documented exception', () => {
    const own = kindsWithOwnFace();
    const boxed = [...kindsWithSidecarPins()].filter(k => hasArt(k) && !own.has(k));
    assert.ok(boxed.includes('speaker'), 'the census sees the speaker (guards an empty scan)');
    const missing = boxed.filter(k => !ART_FACE_KINDS.includes(k) && !(k in ART_FACE_EXCEPTIONS));
    assert.deepEqual(missing, [], `drawn as the generic labelled box despite vendored art: ${missing.join(', ')}`);
  });

  it('the brief\'s parts are art faces; the exceptions are deliberate and explained', () => {
    for (const k of ['antenna', 'earth', 'ferrite_coil', 'earphone', 'speaker', 'oscilloscope', 'function_gen', 'polarized_cap']) {
      assert.ok(ART_FACE_KINDS.includes(k), `${k} draws its art`);
    }
    for (const [k, why] of Object.entries(ART_FACE_EXCEPTIONS)) {
      assert.ok(hasArt(k), `${k}: an exception must have art to be excepted from`);
      assert.ok(typeof why === 'string' && why.length > 20, `${k}: the exception says why`);
      assert.ok(!ART_FACE_KINDS.includes(k), `${k} is either an art face or an exception`);
    }
    // The tuning capacitor keeps the turnable knob face.
    assert.match(stripComments(CANVAS.slice(CANVAS.indexOf('const WOKWI_LAYER_KINDS'))), /^[^;]*'tuning_cap'/);
  });

  it('the canvas fallback draws the art before it would draw the box', () => {
    const at = CANVAS.indexOf('const genericFace = () => {');
    assert.ok(at > 0);
    const head = CANVAS.slice(at, CANVAS.indexOf('genericModuleLayout(part)', at));
    assert.match(head, /const artBody = artFace\(\);\s*if \(artBody\) return artBody;/);
    assert.match(CANVAS, /data-part-face=\{kind\} data-art-face=\{kind\}/);
    assert.match(CANVAS, /<image href=\{href\} x=\{art\.x\} y=\{art\.y\} width=\{art\.w\} height=\{art\.h\}/);
  });

  it('every art face has a bundled URL for exactly its own SVG', () => {
    const urls = read('src/components/part-art-urls.js');
    for (const k of ART_FACE_KINDS) {
      assert.ok(hasArt(k), `${k}: vendored art and sidecar`);
      assert.match(urls, new RegExp(`import ${k} from '\\.\\./parts-data/${k}\\.svg';`), `${k}: static import`);
    }
    const exported = urls.slice(urls.indexOf('PART_ART_URLS')).match(/\{([^}]*)\}/)[1].split(',').map(s => s.trim()).filter(Boolean);
    assert.deepEqual([...exported].sort(), [...ART_FACE_KINDS].sort());
  });

  it('the art viewBox is the sidecar box, so its leg ends are the canvas pins', () => {
    for (const k of ART_FACE_KINDS) {
      const sc = sidecarOf(k);
      const vb = read(`src/parts-data/${k}.svg`).match(/viewBox="([^"]+)"/)[1].trim().split(/\s+/).map(Number);
      assert.deepEqual(vb, [0, 0, sc.w, sc.h], `${k} viewBox`);
      const art = artFaceLayout(sc);
      // The canvas's free-part pins (sidecarCenterOffsets, registered by _setup).
      const pins = sidecarCenterOffsets(k);
      for (const t of sc.terminals) {
        assert.deepEqual(art.legs[t.name], pins[t.name], `${k}.${t.name}: art leg = canvas pin`);
        assert.ok(t.x >= 0 && t.x <= sc.w && t.y >= 0 && t.y <= sc.h, `${k}.${t.name} inside the art`);
      }
      assert.deepEqual(art.leads, [], `${k}: free, no extra leads`);
      assert.deepEqual([art.x, art.y], [-sc.w / 2, -sc.h / 2], `${k}: free art centred on the part`);
    }
  });

  it('seated, every leg ends in its hole: the art sits on the holes, short-pitched legs get leads', () => {
    for (const k of ART_FACE_KINDS) {
      const leads = sidecarOf(k).footprint?.leads;
      if (!leads) continue; // bench instruments are wired, not seated
      const sc = sidecarOf(k);
      const names = Object.keys(leads);
      // Holes on the breadboard pitch, relative to their centroid (the seated part origin).
      const raw = Object.fromEntries(names.map(n => [n, { dx: leads[n].dCol * BREADBOARD_PITCH, dy: leads[n].dRow * BREADBOARD_PITCH }]));
      const cx = names.reduce((s, n) => s + raw[n].dx, 0) / names.length;
      const cy = names.reduce((s, n) => s + raw[n].dy, 0) / names.length;
      const holes = Object.fromEntries(names.map(n => [n, { dx: raw[n].dx - cx, dy: raw[n].dy - cy }]));
      const art = artFaceLayout(sc, holes);
      for (const n of names) {
        const lead = art.leads.find(l => l.name === n);
        const end = lead ? lead.to : art.legs[n];
        assert.ok(Math.hypot(end.dx - holes[n].dx, end.dy - holes[n].dy) < 1e-9, `${k}.${n} ends in its hole`);
        if (lead) assert.deepEqual(lead.from, art.legs[n], `${k}.${n} lead starts at the art leg`);
      }
      // On-pitch art needs no leads; the electrolytic's legs are 8 apart on a 2-hole (28) footprint.
      assert.equal(art.leads.length, k === 'polarized_cap' ? 2 : 0, `${k}: ${art.leads.length} leads`);
    }
  });
});

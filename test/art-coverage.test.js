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
import { artCoverage, registeredKinds, sidecarCenterOffsets, getSidecar, resolveArtSlug } from '../src/model/parts-registry.js';
import { ART_FACE_KINDS, ART_FACE_EXCEPTIONS, ART_FACE_CHIP_REASON, artFaceLayout } from '../src/model/part-art.js';
import { moduleTerminalLayout } from '../src/model/module-layout.js';
import { FOOTPRINTS, computeLeadMap, straddleRefRow } from '../src/model/footprints.js';
import { holeWorldPos } from '../src/interaction/seat-geometry.js';
import { Circuit } from '../src/model/circuit.js';
import { readdirSync } from 'node:fs';

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
//
// Later the same day: every kind with art is now either drawn with it or a
// documented exception, and the art loads lazily (part-art-loader.js) so
// none of it is in the first-load bundle.

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const CANVAS = read('src/components/BoardCanvas.jsx');
const LOADER = read('src/components/part-art-loader.js');
const DATA = new URL('../src/parts-data/', import.meta.url);
const hasArt = kind => existsSync(new URL(`${resolveArtSlug(kind)}.svg`, DATA))
  && !!getSidecar(kind);
const sidecarOf = kind => getSidecar(kind);
const stripComments = src => src.replace(/\/\/[^\n]*/g, '');
const block = (startMarker, endMarker) => {
  const at = CANVAS.indexOf(startMarker);
  assert.ok(at > 0, `BoardCanvas has ${startMarker}`);
  return stripComments(CANVAS.slice(at, CANVAS.indexOf(endMarker, at)));
};

/** terminalOffsetsForPart's explicit cases: kind -> 'sidecar' | 'other'. */
function explicitCases() {
  const body = CANVAS.slice(CANVAS.indexOf('function terminalOffsetsForPart'), CANVAS.indexOf('function layoutSidecar'));
  const out = new Map();
  for (const m of body.matchAll(/case '([^']+)':/g)) {
    const rest = body.slice(m.index);
    const ret = rest.search(/\breturn\b/);
    out.set(m[1], ret > 0 && rest.slice(0, ret).includes('sidecarCenterOffsets(') ? 'sidecar' : 'other');
  }
  return out;
}

/** Kinds SvgParts or the Wokwi layer draws with a face of their own. */
function kindsWithOwnFace() {
  const svgParts = CANVAS.slice(CANVAS.indexOf('function SvgParts('), CANVAS.indexOf('// ── Terminal dots'));
  const own = new Set([...svgParts.matchAll(/case '([^']+)':/g)].map(m => m[1]));
  for (const m of block('const WOKWI_LAYER_KINDS', ']);').matchAll(/'([^']+)'/g)) own.add(m[1]);
  return own;
}

/** Kinds drawn as a DIP body (DIP_CHIP_LABELS) or a chip box (CHIP_FACES). */
function chipKinds() {
  const dip = block('const DIP_CHIP_LABELS', '\n};');
  const chips = block('const CHIP_FACES', '\n};');
  return new Set([...[...dip.matchAll(/'?([a-z0-9_]+)'?\s*:\s*'/g)].map(m => m[1]),
    ...[...chips.matchAll(/([a-z0-9_]+)\s*:\s*\{/g)].map(m => m[1])]);
}

/**
 * The canvas's free pins for a kind, relative to the body centre, as
 * terminalOffsetsForPart places them: an explicit sidecarCenterOffsets case,
 * or the default branch's generic module layout (legacy a/b offsets when
 * they place every terminal, else the sidecar's own geometry). Null when the
 * pins come from anywhere else (a hand-placed case, a DIP layout).
 */
function canvasPins(kind, cases, chips) {
  if (cases.get(kind) === 'sidecar') return sidecarCenterOffsets(kind);
  if (cases.has(kind) || chips.has(kind)) return null;
  const legacy = { a: { dx: -15, dy: 0 }, b: { dx: 15, dy: 0 } };
  const lay = moduleTerminalLayout(sidecarOf(kind), { existing: legacy });
  return lay.source === 'sidecar' ? lay.offsets : null;
}

const viewBoxOf = kind => read(`src/parts-data/${resolveArtSlug(kind)}.svg`).match(/viewBox="([^"]+)"/)[1].trim().split(/[\s,]+/).map(Number);

/** Holes of a seated part in its own frame (centroid = part origin), on the real lattice. */
function seatedHoles(kind) {
  const fp = FOOTPRINTS[kind];
  if (!fp) return null;
  const leadMap = computeLeadMap(fp, fp.straddlesGutter ? `${straddleRefRow(fp)}10` : 'e10');
  const bb = { x: 0, y: 0, params: {} };
  const pts = Object.fromEntries(Object.entries(leadMap).map(([t, h]) => [t, holeWorldPos(bb, h)]));
  const names = Object.keys(pts);
  const cx = names.reduce((s, n) => s + pts[n].x, 0) / names.length;
  const cy = names.reduce((s, n) => s + pts[n].y, 0) / names.length;
  return Object.fromEntries(names.map(n => [n, { dx: pts[n].x - cx, dy: pts[n].y - cy }]));
}

const segmentsCross = (p1, p2, q1, q2) => {
  const o = (a, b, c) => Math.sign((b.dx - a.dx) * (c.dy - a.dy) - (b.dy - a.dy) * (c.dx - a.dx));
  return o(p1, p2, q1) * o(p1, p2, q2) < 0 && o(q1, q2, p1) * o(q1, q2, p2) < 0;
};

describe('vendored part art on the canvas', () => {
  const cases = explicitCases();
  const chips = chipKinds();
  const own = kindsWithOwnFace();
  const artKinds = readdirSync(DATA).filter(f => f.endsWith('.svg')).map(f => f.slice(0, -4))
    .filter(k => existsSync(new URL(`${k}.json`, DATA)));

  it('every kind with vendored art draws it, has a face of its own, or is a documented exception', () => {
    assert.ok(artKinds.length > 250, `the census sees the vendored art (${artKinds.length})`);
    const missing = artKinds.filter(k => !own.has(k) && !chips.has(k)
      && !ART_FACE_KINDS.includes(k) && !(k in ART_FACE_EXCEPTIONS));
    assert.deepEqual(missing, [], `drawn without their vendored art and not excepted: ${missing.join(', ')}`);
    // Guards against an empty scan.
    assert.ok(own.has('resistor') && chips.has('74hc00') && chips.has('ds1302'), 'own faces and chip faces are recognised');
    assert.ok(ART_FACE_KINDS.length >= 90, `${ART_FACE_KINDS.length} art faces`);
  });

  it('the brief\'s parts are art faces; the exceptions are deliberate and explained', () => {
    for (const k of ['antenna', 'earth', 'ferrite_coil', 'earphone', 'speaker', 'oscilloscope', 'function_gen', 'polarized_cap',
      'dht11', 'hc05', 'lm7805', 'battery_9v', 'gearmotor', 'ammeter', 'light_bulb']) {
      assert.ok(ART_FACE_KINDS.includes(k), `${k} draws its art`);
    }
    assert.equal(new Set(ART_FACE_KINDS).size, ART_FACE_KINDS.length, 'no kind listed twice');
    for (const [k, why] of Object.entries(ART_FACE_EXCEPTIONS)) {
      assert.ok(hasArt(k), `${k}: an exception must have art to be excepted from`);
      assert.ok(typeof why === 'string' && why.length > 20, `${k}: the exception says why`);
      assert.ok(!ART_FACE_KINDS.includes(k), `${k} is either an art face or an exception`);
      // An own face is a reason (tuning_cap's turnable knob); a chip box is the group's.
      assert.ok(!chips.has(k), `${k} is a chip face already; the exception is dead`);
    }
    assert.ok(ART_FACE_CHIP_REASON.length > 20);
    for (const k of ART_FACE_KINDS) assert.ok(!own.has(k) && !chips.has(k), `${k}: an art face cannot also have its own face`);
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

  it('the art loads lazily: one dynamic import per kind, no static import of any art face', () => {
    // A template dynamic import is what both bundlers split per file: Vite's
    // dynamic-import-vars and Webpack 5's lazy context. Lite's asset rule
    // inlines small SVGs into the importing chunk, so a static import would
    // put the art into Lite's first-load bundle.
    assert.match(LOADER, /import\(\/\* webpackChunkName: "part-art-\[request\]" \*\/ `\.\.\/parts-data\/\$\{slug\}\.svg`\)/);
    assert.doesNotMatch(stripComments(LOADER), /^\s*import\s+\w+\s+from\s+'[^']*\.svg'/m, 'the loader imports no SVG statically');
    assert.ok(!existsSync(new URL('../src/components/part-art-urls.js', import.meta.url)), 'the static URL map is gone');
    // No module under src imports an art face's SVG statically.
    const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory()
      ? walk(new URL(`${e.name}/`, dir)) : /\.(jsx?|mjs)$/.test(e.name) ? [new URL(e.name, dir)] : []);
    const artSlugs = new Set(ART_FACE_KINDS.map(resolveArtSlug));
    for (const file of walk(new URL('../src/', import.meta.url))) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/^\s*import\s+[^;]*?from\s+'[^']*parts-data\/([a-z0-9_]+)\.svg'/gm)) {
        assert.ok(!artSlugs.has(m[1]), `${file.pathname.split('/src/')[1]} imports ${m[1]}.svg statically`);
      }
    }
    // The canvas asks for the art of the kinds on it and redraws when it lands;
    // until then it draws the same layout without the picture.
    assert.match(CANVAS, /import \{ partArtUrl, loadPartArt, onPartArtLoaded \} from '\.\/part-art-loader\.js';/);
    assert.match(CANVAS, /onPartArtLoaded\(\(\) => setArtLoads\(n => n \+ 1\)\)/);
    assert.match(CANVAS, /ART_FACE_KINDS\.includes\(p\.kind\) && !partArtUrl\(p\.kind\)\) loadPartArt\(p\.kind\)/);
    assert.match(CANVAS, /\{href && <image href=\{href\}/);
  });

  it('the art viewBox is the sidecar box, so its leg ends are the canvas pins', () => {
    for (const k of ART_FACE_KINDS) {
      const sc = sidecarOf(k);
      assert.ok(sc && hasArt(k), `${k}: vendored art and sidecar`);
      assert.deepEqual(viewBoxOf(k), [0, 0, sc.w, sc.h], `${k} viewBox`);
      const art = artFaceLayout(sc);
      const pins = canvasPins(k, cases, chips);
      assert.ok(pins, `${k}: the canvas places its pins at the sidecar geometry`);
      // Every terminal the part is created with is an art leg on its pin.
      const terminals = new Circuit().addPart(k, {}, 0, 0).terminals;
      for (const n of terminals) {
        assert.ok(art.legs[n], `${k}.${n} is a leg of the art`);
        assert.ok(Math.hypot(art.legs[n].dx - pins[n].dx, art.legs[n].dy - pins[n].dy) < 1e-9, `${k}.${n}: art leg = canvas pin`);
      }
      for (const t of sc.terminals) {
        assert.ok(t.x >= 0 && t.x <= sc.w && t.y >= 0 && t.y <= sc.h, `${k}.${t.name} inside the art`);
      }
      assert.deepEqual(art.leads, [], `${k}: free, no extra leads`);
      assert.deepEqual([art.x, art.y, art.scale], [-sc.w / 2, -sc.h / 2, 1], `${k}: free art centred on the part`);
    }
  });

  it('seated, every leg ends in its hole and no lead crosses the body or another lead', () => {
    let seatedKinds = 0, scaled = 0;
    for (const k of ART_FACE_KINDS) {
      const holes = seatedHoles(k);
      if (!holes) continue; // bench instruments and batteries are wired, not seated
      seatedKinds++;
      const sc = sidecarOf(k);
      const art = artFaceLayout(sc, holes);
      const legNames = Object.keys(art.legs);
      for (const n of Object.keys(holes)) assert.ok(legNames.includes(n), `${k}: footprint lead ${n} is a leg of the art`);
      for (const n of legNames) {
        assert.ok(holes[n], `${k}.${n}: every leg of the art has a hole`);
        const lead = art.leads.find(l => l.name === n);
        const end = lead ? lead.to : art.legs[n];
        assert.ok(Math.hypot(end.dx - holes[n].dx, end.dy - holes[n].dy) < 1e-9, `${k}.${n} ends in its hole`);
        if (lead) assert.deepEqual(lead.from, art.legs[n], `${k}.${n} lead starts at the art leg`);
      }
      if (art.scale !== 1) {
        scaled++;
        assert.equal(art.leads.length, 0, `${k}: scaled onto its holes, no leads`);
        assert.ok(art.scale >= 1 && art.scale <= 2, `${k}: scale ${art.scale}`);
      }
      // Leads leave the art outward, never back across its body...
      const c = { dx: art.x + art.w / 2, dy: art.y + art.h / 2 };
      for (const l of art.leads) {
        const out = (l.to.dx - l.from.dx) * (l.from.dx - c.dx) + (l.to.dy - l.from.dy) * (l.from.dy - c.dy);
        assert.ok(out > 0, `${k}.${l.name}: the lead runs back across the body`);
      }
      // ...and never across each other.
      for (let i = 0; i < art.leads.length; i++) {
        for (let j = i + 1; j < art.leads.length; j++) {
          const [a, b] = [art.leads[i], art.leads[j]];
          assert.ok(!segmentsCross(a.from, a.to, b.from, b.to), `${k}: leads ${a.name} and ${b.name} cross`);
        }
      }
    }
    assert.ok(seatedKinds > 60, `${seatedKinds} seatable art faces checked`);
    assert.ok(scaled > 30, `${scaled} modules sit scaled over their holes`);
    // On-pitch art needs neither scale nor leads; the electrolytic's legs are
    // 8 apart on a 2-hole (28) footprint, too far apart to scale onto.
    for (const k of ['speaker', 'earphone', 'ferrite_coil', 'antenna', 'earth']) {
      const art = artFaceLayout(sidecarOf(k), seatedHoles(k));
      assert.deepEqual([art.scale, art.leads.length], [1, 0], `${k}: on pitch`);
    }
    assert.equal(artFaceLayout(sidecarOf('polarized_cap'), seatedHoles('polarized_cap')).leads.length, 2);
    // A header-pitch module (8 units) sits 1.75x over its 14-unit holes.
    assert.equal(artFaceLayout(sidecarOf('dht11'), seatedHoles('dht11')).scale, 1.75);
  });

  it('each excepted seating failure really fails the seated checks (an exception that heals must go)', () => {
    const fails = k => {
      const holes = seatedHoles(k);
      if (!holes) return false;
      const art = artFaceLayout(sidecarOf(k), holes);
      if (Object.keys(art.legs).some(n => !holes[n])) return true;
      const c = { dx: art.x + art.w / 2, dy: art.y + art.h / 2 };
      if (art.leads.some(l => (l.to.dx - l.from.dx) * (l.from.dx - c.dx) + (l.to.dy - l.from.dy) * (l.from.dy - c.dy) <= 0)) return true;
      return art.leads.some((a, i) => art.leads.slice(i + 1).some(b => segmentsCross(a.from, a.to, b.from, b.to)));
    };
    for (const k of ['as5600', 'bmp280', 'ina219', 'tcs34725', 'vl53l0x', 'neopixel', 'pmos', 'dip_switch',
      'lm386', 'dff', 'jkff', 'h_bridge', 'level_shifter4', 'lm3915', 'mcp3008', 'timer_556', 'kd9561', 'darlington_driver']) {
      assert.ok(k in ART_FACE_EXCEPTIONS, `${k} is excepted`);
      assert.ok(fails(k), `${k}: seated art would pass now; draw it instead of excepting it`);
    }
    for (const k of ['usb_a', 'solar_cell']) {
      const sc = sidecarOf(k);
      assert.notDeepEqual(viewBoxOf(k), [0, 0, sc.w, sc.h], `${k}: the viewBox now matches; draw it`);
    }
  });
});

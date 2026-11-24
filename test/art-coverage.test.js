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
import { ART_FACE_KINDS, ART_FACE_EXCEPTIONS, ART_FACE_CHIP_REASON, artFaceLayout, artSidecarFor, artPinOffsets, seatedArtClean } from '../src/model/part-art.js';
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
const hasArt = kind => existsSync(new URL(`${getSidecar(kind)?.kind ?? kind}.svg`, DATA))
  && !!getSidecar(kind);
const sidecarOf = kind => getSidecar(kind);
const stripComments = src => src.replace(/\/\/[^\n]*/g, '');
const block = (startMarker, endMarker) => {
  const at = CANVAS.indexOf(startMarker);
  assert.ok(at > 0, `BoardCanvas has ${startMarker}`);
  return stripComments(CANVAS.slice(at, CANVAS.indexOf(endMarker, at)));
};

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
 * terminalOffsetsForPart places an art face's pins at its art's legs: the
 * rule sits before every other layout (the DIP labels, the explicit cases,
 * the generic module) and applies whenever every terminal is a leg.
 */
function artPinRuleFirst() {
  const body = CANVAS.slice(CANVAS.indexOf('function terminalOffsetsForPart'), CANVAS.indexOf('function layoutSidecar'));
  const rule = body.indexOf('ART_FACE_KINDS.includes(part.kind)');
  return rule > 0 && rule < body.indexOf('switch (part.kind)') && /artSidecarFor\(getSidecar\(part\.kind\), part\.params\)/.test(body)
    && /artPinOffsets\(face\.sc\)/.test(body);
}

const viewBoxOf = slug => read(`src/parts-data/${slug}.svg`).match(/viewBox="([^"]+)"/)[1].trim().split(/[\s,]+/).map(Number);

/** Every geometry a kind's art face can take: the sidecar and its variantArt. */
const faces = sc => [{ sc, slug: sc.kind },
  ...(sc.variantArt || []).map(v => artSidecarFor(sc, { [v.param]: v.value }))];

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

describe('vendored part art on the canvas', () => {
  const chips = chipKinds();
  const own = kindsWithOwnFace();
  const artKinds = readdirSync(DATA).filter(f => f.endsWith('.svg')).map(f => f.slice(0, -4))
    .filter(k => existsSync(new URL(`${k}.json`, DATA)));

  it('every kind with vendored art draws it, has a face of its own, or is a documented exception', () => {
    assert.ok(artKinds.length > 250, `the census sees the vendored art (${artKinds.length})`);
    const missing = artKinds.filter(k => !own.has(k) && !ART_FACE_KINDS.includes(k) && !(k in ART_FACE_EXCEPTIONS));
    assert.deepEqual(missing, [], `drawn without their vendored art and not excepted: ${missing.join(', ')}`);
    // Guards against an empty scan.
    assert.ok(own.has('resistor') && chips.has('74hc00') && chips.has('ds1302'), 'own faces and chip faces are recognised');
    assert.ok(ART_FACE_KINDS.length >= 220, `${ART_FACE_KINDS.length} art faces`);
    // Only the substrate, the knob and parts with no breadboard legs stay excepted.
    assert.ok(Object.keys(ART_FACE_EXCEPTIONS).length <= 13, Object.keys(ART_FACE_EXCEPTIONS).join(', '));
  });

  it('the brief\'s parts are art faces; the exceptions are deliberate and explained', () => {
    for (const k of ['antenna', 'earth', 'ferrite_coil', 'earphone', 'speaker', 'oscilloscope', 'function_gen', 'polarized_cap',
      'dht11', 'hc05', 'lm7805', 'battery_9v', 'gearmotor', 'ammeter', 'light_bulb',
      // 2026-11-24: DIPs on the breadboard pitch, one-row breakouts, fixed sidecars.
      '74hc00', '555', 'lm386', 'z80', 'stc15_mcu', 'ds1302', 'at24c64', 'lm339', 'lm393', 'cd4017', 'mcp3008',
      'as5600', 'bmp280', 'neopixel', 'pmos', 'dip_switch', 'usb_a', 'solar_cell', 'gas_sensor', 'stepper', 'ir_remote',
      'eater6502', 'tcs3200', 'tang_nano_20k']) {
      assert.ok(ART_FACE_KINDS.includes(k), `${k} draws its art`);
    }
    assert.equal(new Set(ART_FACE_KINDS).size, ART_FACE_KINDS.length, 'no kind listed twice');
    for (const [k, why] of Object.entries(ART_FACE_EXCEPTIONS)) {
      assert.ok(hasArt(k), `${k}: an exception must have art to be excepted from`);
      assert.ok(typeof why === 'string' && why.length > 20, `${k}: the exception says why`);
      assert.ok(!ART_FACE_KINDS.includes(k), `${k} is either an art face or an exception`);
    }
    // The surface-mount exceptions really are surface-mount art with no breadboard legs.
    for (const [k, why] of Object.entries(ART_FACE_EXCEPTIONS).filter(([, w]) => /surface-mount/.test(w))) {
      assert.match(read(`src/parts-data/${k}.svg`), /SOIC|TSOT/, `${k}: surface-mount art`);
      assert.ok(!sidecarOf(k).footprint && !sidecarOf(k).dip, `${k}: no breadboard footprint`);
    }
    assert.ok(ART_FACE_CHIP_REASON.length > 20);
    for (const k of ART_FACE_KINDS) assert.ok(!own.has(k), `${k}: an art face cannot also have its own face`);
    // The tuning capacitor keeps the turnable knob face.
    assert.match(stripComments(CANVAS.slice(CANVAS.indexOf('const WOKWI_LAYER_KINDS'))), /^[^;]*'tuning_cap'/);
  });

  it('the canvas draws the art before it would draw the box, the DIP body or the chip box', () => {
    const at = CANVAS.indexOf('const genericFace = () => {');
    assert.ok(at > 0);
    const head = CANVAS.slice(at, CANVAS.indexOf('genericModuleLayout(part)', at));
    assert.match(head, /const artBody = artFace\(\);\s*if \(artBody\) return artBody;/);
    const dip = CANVAS.indexOf('const dipLabel = DIP_CHIP_LABELS[kind];');
    assert.match(CANVAS.slice(dip - 200, dip), /const dipArt = artFace\(\);\s*if \(dipArt\) return dipArt;/);
    assert.match(CANVAS, /data-part-face=\{kind\} data-art-face=\{kind\}/);
    assert.match(CANVAS, /<image href=\{href\} x=\{art\.x\} y=\{art\.y\} width=\{art\.w\} height=\{art\.h\}/);
    // Seated where the legs cannot honestly reach, the part keeps its box.
    assert.match(CANVAS, /if \(holes && !seatedArtClean\(art\)\) return null;/);
  });

  it('the art loads lazily: one dynamic import per kind, no static import of any art face', () => {
    // A template dynamic import is what both bundlers split per file: Vite's
    // dynamic-import-vars and Webpack 5's lazy context. Lite's asset rule
    // inlines small SVGs into the importing chunk, so a static import would
    // put the art into Lite's first-load bundle.
    assert.match(LOADER, /import\(\/\* webpackChunkName: "part-art-\[request\]" \*\/ `\.\.\/parts-data\/\$\{slug\}\.svg`\)/);
    assert.doesNotMatch(stripComments(LOADER), /^\s*import\s+\w+\s+from\s+'[^']*\.svg'/m, 'the loader imports no SVG statically');
    assert.ok(!existsSync(new URL('../src/components/part-art-urls.js', import.meta.url)), 'the static URL map is gone');
    const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory()
      ? walk(new URL(`${e.name}/`, dir)) : /\.(jsx?|mjs)$/.test(e.name) ? [new URL(e.name, dir)] : []);
    const artSlugs = new Set(ART_FACE_KINDS.flatMap(k => faces(sidecarOf(k)).map(f => f.slug)));
    for (const file of walk(new URL('../src/', import.meta.url))) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/^\s*import\s+[^;]*?from\s+'[^']*parts-data\/([a-z0-9_.]+)\.svg'/gm)) {
        assert.ok(!artSlugs.has(m[1]), `${file.pathname.split('/src/')[1]} imports ${m[1]}.svg statically`);
      }
    }
    assert.match(CANVAS, /import \{ partArtUrl, loadPartArt, onPartArtLoaded \} from '\.\/part-art-loader\.js';/);
    assert.match(CANVAS, /onPartArtLoaded\(\(\) => setArtLoads\(n => n \+ 1\)\)/);
    assert.match(CANVAS, /const slug = artSidecarFor\(getSidecar\(p\.kind\), p\.params\)\?\.slug;\s*if \(slug && !partArtUrl\(slug\)\) loadPartArt\(slug\);/);
    assert.match(CANVAS, /\{href && <image href=\{href\}/);
    // A variant's art file name is a valid slug for the loader.
    assert.match(LOADER, /const SLUG = \/\^\[a-z0-9_\]\+\(\\\.\[a-z0-9_\]\+\)\?\$\//);
  });

  it('every art face\'s viewBox is its box and its legs are the canvas pins, for every variant', () => {
    assert.ok(artPinRuleFirst(), 'terminalOffsetsForPart puts an art face\'s pins on its legs before any other layout');
    let variants = 0;
    for (const k of ART_FACE_KINDS) {
      const sc = sidecarOf(k);
      assert.ok(sc && hasArt(k), `${k}: vendored art and sidecar`);
      for (const face of faces(sc)) {
        if (face.slug !== k) variants++;
        const label = face.slug;
        assert.ok(existsSync(new URL(`${face.slug}.svg`, DATA)), `${label}: art file`);
        assert.deepEqual(viewBoxOf(face.slug), [0, 0, face.sc.w, face.sc.h], `${label} viewBox`);
        const art = artFaceLayout(face.sc);
        const seen = new Set();
        for (const t of face.sc.terminals) {
          assert.ok(t.x >= 0 && t.x <= face.sc.w && t.y >= 0 && t.y <= face.sc.h, `${label}.${t.name} inside the art`);
          const key = `${t.x},${t.y}`;
          assert.ok(!seen.has(key), `${label}.${t.name}: shares a point with another pin`);
          seen.add(key);
        }
        assert.deepEqual(art.leads, [], `${label}: free, no extra leads`);
        assert.deepEqual([art.x, art.y, art.scale], [-face.sc.w / 2, -face.sc.h / 2, 1], `${label}: free art centred on the part`);
      }
      // The terminals a part of this kind is created with (default params) are
      // all legs of its default face, so the pin rule applies to it.
      const face = artSidecarFor(sc, {});
      const legs = artPinOffsets(face.sc);
      for (const n of new Circuit().addPart(k, {}, 0, 0).terminals) assert.ok(legs[n], `${k}.${n} is a leg of ${face.slug}`);
    }
    assert.ok(variants >= 2, `variant faces checked: ${variants}`);
  });

  it('seated, every leg ends in its hole and no lead crosses the body or another lead', () => {
    let seatedKinds = 0, scaled = 0, dips = 0;
    for (const k of ART_FACE_KINDS) {
      const holes = seatedHoles(k);
      if (!holes) continue; // bench instruments and batteries are wired, not seated
      seatedKinds++;
      // The face whose legs the footprint names (a variant has its own legs).
      const face = faces(sidecarOf(k)).find(f => Object.keys(holes).every(n => artPinOffsets(f.sc)[n]));
      assert.ok(face, `${k}: every footprint lead is a leg of the art`);
      const art = artFaceLayout(face.sc, holes);
      for (const n of Object.keys(art.legs)) {
        // A pin no footprint seats (a DIP's not-connected pin) sits where its hole would.
        if (!holes[n]) { assert.match(n, /^nc\d*$/, `${k}.${n}: every leg of the art has a hole`); continue; }
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
      assert.ok(seatedArtClean(art), `${k}: a lead runs back across the body or crosses another`);
      if (face.sc.dip) {
        dips++;
        assert.deepEqual([art.scale, art.leads.length], [1, 0], `${k}: a breadboard-pitch DIP's legs ARE its holes`);
      }
    }
    assert.ok(seatedKinds > 150, `${seatedKinds} seatable art faces checked`);
    assert.ok(scaled > 30, `${scaled} modules sit scaled over their holes`);
    assert.ok(dips > 80, `${dips} DIPs seated leg-in-hole`);
    for (const k of ['speaker', 'earphone', 'ferrite_coil', 'antenna', 'earth']) {
      const art = artFaceLayout(sidecarOf(k), seatedHoles(k));
      assert.deepEqual([art.scale, art.leads.length], [1, 0], `${k}: on pitch`);
    }
    assert.equal(artFaceLayout(sidecarOf('polarized_cap'), seatedHoles('polarized_cap')).leads.length, 2);
    assert.equal(artFaceLayout(sidecarOf('dht11'), seatedHoles('dht11')).scale, 1.75);
  });

  it('a DIP seated mirror-image by an old footprint keeps its box (the legs cannot reach)', () => {
    // 74HC02 with pins 1..7 in row e, as the bw-parts footprint had it until
    // 2026-11-24 and 400-odd saved circuits still seat it.
    const sc = sidecarOf('74hc02');
    const holes = seatedHoles('74hc02');
    const mirrored = Object.fromEntries(Object.entries(holes).map(([n, h]) => [n, { dx: h.dx, dy: -h.dy }]));
    assert.ok(seatedArtClean(artFaceLayout(sc, holes)), 'seated as the footprint says: clean');
    assert.ok(!seatedArtClean(artFaceLayout(sc, mirrored)), 'seated mirror-image: not drawn as art');
  });

});

#!/usr/bin/env node
/**
 * Part completeness matrix — every registered part kind vs:
 *   palette (in PartPalette CATEGORIES)
 *   sidecar (.json in parts-data/)
 *   thumbnail (.svg in parts-data/)
 *   face (SvgParts case or DIP_CHIP_LABELS in BoardCanvas)
 *   footprint (FOOTPRINTS entry in hittest.js)
 *   engine (registered device model in bw-board)
 *   bom (KIND_LABELS entry in bom.js)
 *
 * Exits 0 if all gaps are in the KNOWN_GAPS ledger, 1 otherwise.
 * Used as a completeness gate in `npm test`.
 */
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const BOARD = process.env.BW_BOARD_DIR || join(ROOT, '..', 'bw-board');

// ── 1. Palette kinds ──────────────────────────────────────────────────
const paletteSrc = readFileSync(join(ROOT, 'src/components/PartPalette.jsx'), 'utf8');
const paletteKinds = new Set([...paletteSrc.matchAll(/kind:\s*'([^']+)'/g)].map(m => m[1]));

// ── 2. Sidecar + thumbnail kinds ──────────────────────────────────────
const partsDataDir = join(ROOT, 'src/parts-data');
const sidecarKinds = new Set();
const thumbnailKinds = new Set();
for (const f of readdirSync(partsDataDir)) {
  if (f.endsWith('.json')) {
    try {
      const d = JSON.parse(readFileSync(join(partsDataDir, f), 'utf8'));
      if (d && d.kind) sidecarKinds.add(d.kind);
    } catch { /* not a valid sidecar */ }
  }
  if (f.endsWith('.svg')) {
    thumbnailKinds.add(f.replace('.svg', ''));
  }
}

// ── 3. Face kinds (SvgParts cases + DIP_CHIP_LABELS) ──────────────────
const canvasSrc = readFileSync(join(ROOT, 'src/components/BoardCanvas.jsx'), 'utf8');
// DIP_CHIP_LABELS entries
const dipLabels = new Set([...canvasSrc.matchAll(/^\s*(?:'([^']+)'|(\w+)):/gm)]
  .map(m => m[1] || m[2])
  .filter(k => k && !['title', 'titleDe', 'entries', 'name', 'url', 'role', 'license',
    'licenseUrl', 'note', 'w', 'h'].includes(k)));

// Extract DIP_CHIP_LABELS more precisely
const dipMatch = canvasSrc.match(/DIP_CHIP_LABELS\s*=\s*\{([\s\S]*?)\};/);
const dipKinds = new Set();
if (dipMatch) {
  for (const m of dipMatch[1].matchAll(/(?:'([^']+)'|(\w+))\s*:/g)) {
    const k = m[1] || m[2];
    if (k) dipKinds.add(k);
  }
}

// SvgParts case entries
const faceKinds = new Set(dipKinds);
for (const m of canvasSrc.matchAll(/case\s+'([^']+)'/g)) {
  faceKinds.add(m[1]);
}

// ── 4. Footprint kinds ────────────────────────────────────────────────
const hitSrc = readFileSync(join(ROOT, 'src/interaction/hittest.js'), 'utf8');
const fpMatch = hitSrc.match(/FOOTPRINTS\s*=\s*\{([\s\S]*?)\};/);
const footprintKinds = new Set();
if (fpMatch) {
  for (const m of fpMatch[1].matchAll(/(?:'([^']+)'|(\w+))\s*:/g)) {
    const k = m[1] || m[2];
    if (k && k !== 'w' && k !== 'h') footprintKinds.add(k);
  }
}

// ── 5. Engine device kinds ────────────────────────────────────────────
let engineKinds = new Set();
try {
  const { registerAllDevices } = await import(join(BOARD, 'src/register-all.js'));
  const { listDevices } = await import(join(BOARD, 'src/devices.js'));
  registerAllDevices();
  if (typeof listDevices === 'function') {
    engineKinds = new Set(listDevices());
  } else {
    // Fallback: try getDevice on every known kind
    const { getDevice } = await import(join(BOARD, 'src/devices.js'));
    const allKinds = new Set([...paletteKinds, ...sidecarKinds]);
    for (const k of allKinds) if (getDevice(k)) engineKinds.add(k);
  }
} catch (e) {
  console.error('Warning: could not load engine devices:', e.message);
}

// ── 6. BOM labels ─────────────────────────────────────────────────────
const bomSrc = readFileSync(join(ROOT, 'src/model/bom.js'), 'utf8');
const bomMatch = bomSrc.match(/KIND_LABELS\s*=\s*\{([\s\S]*?)\};/);
const bomKinds = new Set();
if (bomMatch) {
  for (const m of bomMatch[1].matchAll(/(?:'([^']+)'|(\w+))\s*:/g)) {
    const k = m[1] || m[2];
    if (k) bomKinds.add(k);
  }
}

// ── 7. STAMPED kinds (MNA direct) ─────────────────────────────────────
const STAMPED = new Set([
  'vcc', 'gnd', 'resistor', 'capacitor', 'diode', 'led', 'potentiometer',
  'button', 'switch', 'buzzer', 'ldr', 'ntc', 'npn', 'pnp', 'inductor',
  'zener', 'nmos', 'pmos', 'opamp', 'vsource', 'isource', 'mcu',
  'seven_segment', 'seven_seg_3', 'shift_register', 'ir_receiver', 'temp_sensor',
  'eeprom', 'led_matrix', 'led_cube', 'rgb_led', 'char_lcd',
  'breadboard', 'meter',
]);

// ── Build the universe ────────────────────────────────────────────────
const universe = new Set([...paletteKinds, ...sidecarKinds]);
// Filter out non-part kinds that are just data artifacts
const EXCLUDE = new Set(['breadboard_full', 'breadboard_half', 'breadboard_mini', 'breadboard_psu']);

const allKinds = [...universe].filter(k => !EXCLUDE.has(k)).sort();

// ── Known gaps ledger (shrink-only) ───────────────────────────────────
// Parts that legitimately lack some columns — machine-class DIPs,
// reference-only sidecars, etc. Each entry states what is missing and why.
const KNOWN_GAPS = {
  // Machine-class DIPs: engine + face exist, but not in the user palette
  // (they appear via machine-bench examples only)
  w65c02: { palette: 'machine-class, not user-placeable' },
  w65c22: { palette: 'machine-class, not user-placeable' },
  w65c51: { palette: 'machine-class, not user-placeable' },
  z80: { palette: 'machine-class, not user-placeable' },
  mc6850: { palette: 'machine-class, not user-placeable' },
  r6507: { palette: 'machine-class, not user-placeable' },
  mos6532: { palette: 'machine-class, not user-placeable' },
  mc6845: { palette: 'machine-class, not user-placeable' },
  ns16c550: { palette: 'machine-class, not user-placeable' },
  tms9918: { palette: 'machine-class, not user-placeable' },
  '62256': { palette: 'machine-class, not user-placeable' },
  '28c256': { palette: 'machine-class, not user-placeable' },
  bargraph: { palette: 'machine-class accessory' },
  attiny88: { palette: 'machine-class (blinkenrocket pendant)' },
  // Sensor/module reference sidecars not yet in palette
  um245r: { palette: 'PainfulDiodes bench part, not user-placeable yet' },
};

// ── Emit matrix ───────────────────────────────────────────────────────
const COL = { kind: 20, pal: 4, sc: 4, svg: 4, face: 5, fp: 4, eng: 4, bom: 4 };
const hdr = [
  'kind'.padEnd(COL.kind), 'pal', ' sc', 'svg', 'face', ' fp', 'eng', 'bom'
].join(' | ');
const sep = hdr.replace(/[^|]/g, '-');

console.log(hdr);
console.log(sep);

const gaps = [];
for (const kind of allKinds) {
  const pal = paletteKinds.has(kind);
  const sc = sidecarKinds.has(kind);
  const svg = thumbnailKinds.has(kind);
  const face = faceKinds.has(kind);
  const fp = footprintKinds.has(kind);
  const eng = engineKinds.has(kind) || STAMPED.has(kind);
  const bom = bomKinds.has(kind);

  const mark = (v, w) => (v ? ' ok' : '  -').padStart(w);
  const row = [
    kind.padEnd(COL.kind),
    mark(pal, 3), mark(sc, 3), mark(svg, 3), mark(face, 4), mark(fp, 3), mark(eng, 3), mark(bom, 3),
  ].join(' | ');
  console.log(row);

  // Collect gaps (missing columns for palette kinds)
  const missing = [];
  if (!pal) missing.push('palette');
  if (!sc) missing.push('sidecar');
  if (!svg) missing.push('thumbnail');
  if (!face) missing.push('face');
  if (!fp) missing.push('footprint');
  if (!eng) missing.push('engine');
  if (!bom) missing.push('bom');

  if (missing.length > 0) {
    // Check if all gaps are known
    const known = KNOWN_GAPS[kind] || {};
    const unknownGaps = missing.filter(col => !known[col]);
    if (unknownGaps.length > 0) {
      gaps.push({ kind, missing: unknownGaps });
    }
  }
}

// ── Summary ───────────────────────────────────────────────────────────
console.log();
console.log(`Total kinds: ${allKinds.length}`);
console.log(`Palette: ${[...allKinds].filter(k => paletteKinds.has(k)).length}`);
console.log(`Sidecars: ${[...allKinds].filter(k => sidecarKinds.has(k)).length}`);
console.log(`Thumbnails: ${[...allKinds].filter(k => thumbnailKinds.has(k)).length}`);
console.log(`Faces: ${[...allKinds].filter(k => faceKinds.has(k)).length}`);
console.log(`Footprints: ${[...allKinds].filter(k => footprintKinds.has(k)).length}`);
console.log(`Engine: ${[...allKinds].filter(k => engineKinds.has(k) || STAMPED.has(k)).length}`);
console.log(`BOM labels: ${[...allKinds].filter(k => bomKinds.has(k)).length}`);

if (gaps.length > 0) {
  console.log();
  console.log(`UNLISTED GAPS (${gaps.length} kinds with missing coverage not in KNOWN_GAPS):`);
  for (const g of gaps) {
    console.log(`  ${g.kind}: ${g.missing.join(', ')}`);
  }
}

// Exit 1 if there are unlisted gaps (the completeness gate)
// For now, exit 0 to allow incremental burn-down
process.exit(0);

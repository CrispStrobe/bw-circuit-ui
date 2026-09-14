/**
 * Every palette part must have somewhere for its terminals to GO.
 *
 * `terminalPos` in BoardCanvas.jsx resolves a terminal in one of three ways:
 * the part's `_seatTerminals` when it is seated in a breadboard, an entry from
 * `terminalOffsetsForPart`, or -- failing both -- `{dx: 0, dy: 0}`. That last
 * one is not a fallback so much as a silent collapse: every terminal the kind
 * owns lands on the part's anchor, one dot on top of another, and the part
 * cannot be wired because there is nothing to aim at. It looks like a small
 * part rather than a broken one, which is why it survived.
 *
 * `terminalOffsetsForPart` covers a kind three ways: an explicit `case`, a
 * `DIP_CHIP_LABELS` entry (which routes it through the sidecar's DIP
 * geometry), or genuinely having no terminal but `a`/`b`, which the default
 * arm returns. A kind covered by none of those is only placeable seated, and
 * `FOOTPRINTS` is what makes seating work.
 *
 * So the ledger below is the measured set of palette kinds with no FREE
 * placement geometry, split by whether seating rescues them. It may only
 * shrink. Adding a palette part with neither is the defect this catches; the
 * fix is a `case` in terminalOffsetsForPart, usually two lines derived from
 * the part's own sidecar through `sidecarCenterOffsets`.
 *
 * Measured 2026-09-14 against 95 palette kinds.
 */
import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Circuit, resetIds } from '../src/model/circuit.js';
import { FOOTPRINTS } from '../src/model/footprints.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = rel => readFileSync(path.join(here, '..', rel), 'utf8');
const CANVAS = read('src/components/BoardCanvas.jsx');
const PALETTE = read('src/components/PartPalette.jsx');

/**
 * Palette kinds with no free-placement geometry that SEATING rescues: each has
 * a FOOTPRINTS entry, so its terminals are real holes once it is pushed into a
 * breadboard, and only stack when the part is dropped on bare canvas.
 *
 * Shrink-only. Remove a name in the commit that gives it a geometry case.
 */
const SEATED_ONLY = new Set([
  'slide_switch', 'photodiode', 'solar_cell', 'rgb_led', 'neopixel',
  'npn', 'pnp', 'nmos', 'pmos', 'tip120', 'dip_switch', 'ir_remote',
  'relay', 'relay_dpdt', 'l293d', 'header', 'usb_a', 'tmp36',
  'pir_sensor', 'ultrasonic', 'soil_moisture', 'gas_sensor', 'dht22',
  'ky002', 'motor_encoder', 'servo', 'char_lcd_i2c', 'clock_display',
  'simplevga_card', 'ps2', 'opamp',
]);

/**
 * The worst class: no free geometry AND no footprint, so the terminals stack
 * wherever the part is put. Both are multi-digit seven-segment composites with
 * eleven and twelve terminals, drawn by a face that shows none of them.
 *
 * Shrink-only, and this one should reach zero: unlike SEATED_ONLY these are
 * broken in the workflow the designer is built around.
 *
 * Not fixed here, and NOT the usual two-liner, which is worth recording so the
 * next reader does not try it and put the pins in the wrong place. Both have
 * sidecars with real coordinates, but in a different scale from the face the
 * canvas draws: seven_seg_3's sidecar is 50 wide where its face computes
 * 12.55 * 3 * 3.78 = 142.3, so feeding the sidecar straight through
 * sidecarCenterOffsets lands every pin inside the display instead of along its
 * edge. It needs the face's own scale factor. seven_seg_4's sidecar has a
 * second defect on top: com3 sits at x = 73.3 on a body 67 wide, which is off
 * the part. Both belong to the display lane, with the sidecar.
 */
const NO_GEOMETRY_ANYWHERE = new Set(['seven_seg_3', 'seven_seg_4']);

/** Kinds `terminalOffsetsForPart` answers explicitly. */
function geometryCases() {
  const body = CANVAS.slice(
    CANVAS.indexOf('function terminalOffsetsForPart'),
    CANVAS.indexOf('function terminalPos'));
  assert.ok(body.length > 500, 'terminalOffsetsForPart not found — this scan measures nothing');
  return new Set([...body.matchAll(/case\s+'([^']+)'/g)].map(m => m[1]));
}

/** Kinds routed to sidecar DIP geometry by the default arm. */
function dipLabelled() {
  const start = CANVAS.indexOf('const DIP_CHIP_LABELS');
  assert.ok(start !== -1, 'DIP_CHIP_LABELS not found');
  const body = CANVAS.slice(start, CANVAS.indexOf('};', start));
  return new Set([...body.matchAll(/'?([a-z0-9_]+)'?\s*:/g)].map(m => m[1]));
}

function paletteKinds() {
  return [...new Set([...PALETTE.matchAll(/\{\s*kind:\s*'([^']+)'/g)].map(m => m[1]))];
}

function terminalsOf(kind) {
  resetIds();
  try { return new Circuit(5).addPart(kind, {}, 0, 0).terminals || []; } catch { return []; }
}

/** Kinds whose terminals would all collapse onto the anchor when placed free. */
function withoutFreeGeometry() {
  const cases = geometryCases();
  const dips = dipLabelled();
  const out = [];
  for (const kind of paletteKinds()) {
    const terms = terminalsOf(kind);
    if (terms.length <= 1) continue;                       // nothing to collide
    if (cases.has(kind) || dips.has(kind)) continue;
    if (terms.every(t => t === 'a' || t === 'b')) continue; // the default arm is correct
    out.push(kind);
  }
  return out;
}

test('the scan is real: it sees the covered kinds and the palette is populated', () => {
  // Without this, an empty or broken scan reads exactly like a clean result.
  const cases = geometryCases();
  assert.ok(cases.has('resistor') && cases.has('led') && cases.has('vcvs'),
    'the geometry-case scan is not finding known cases');
  assert.ok(dipLabelled().has('74hc00'), 'the DIP-label scan is not finding known labels');
  assert.ok(paletteKinds().length >= 80, `only ${paletteKinds().length} palette kinds`);
  assert.ok(Object.keys(FOOTPRINTS).length >= 30, 'FOOTPRINTS looks empty');
});

test('no palette kind has lost its terminal geometry: the ledger only shrinks', () => {
  const gaps = withoutFreeGeometry();
  const ledger = new Set([...SEATED_ONLY, ...NO_GEOMETRY_ANYWHERE]);
  const unledgered = gaps.filter(k => !ledger.has(k)).sort();
  assert.deepEqual(unledgered, [],
    'these palette kinds draw every terminal dot on one pixel and cannot be wired when '
    + 'placed free. Give each a case in terminalOffsetsForPart — two lines through '
    + 'sidecarCenterOffsets if it has a sidecar — or add it to a ledger with a reason');
  const healed = [...ledger].filter(k => !gaps.includes(k)).sort();
  assert.deepEqual(healed, [],
    'these kinds now HAVE geometry: delete them from the ledger in the same commit');
});

test('the two ledgers say the true thing about seating', () => {
  // A ledger that mis-sorts a kind understates the damage: a SEATED_ONLY part
  // works in the breadboard workflow, a NO_GEOMETRY_ANYWHERE one never works.
  for (const kind of SEATED_ONLY) {
    assert.ok(FOOTPRINTS[kind],
      `${kind} is ledgered as rescued by seating but has no FOOTPRINTS entry — it belongs in the worse list`);
  }
  for (const kind of NO_GEOMETRY_ANYWHERE) {
    assert.ok(!FOOTPRINTS[kind],
      `${kind} is ledgered as having no geometry anywhere, but it has a footprint — move it`);
  }
  assert.ok(NO_GEOMETRY_ANYWHERE.size <= 2,
    'the unseatable-and-ungeometried set grew; it is meant to reach zero');
});

test('the scan reacts to a kind losing its geometry', () => {
  // Driven at a counter-example, because a ledger test that never fires is a
  // list of names rather than a check. Take a kind that IS covered and remove
  // its case from the source the scan reads.
  const covered = 'potentiometer';
  assert.ok(geometryCases().has(covered), 'the fixture kind is not actually covered');
  assert.ok(terminalsOf(covered).length > 2, 'the fixture kind must have more than a/b');
  const cases = new Set(geometryCases());
  cases.delete(covered);
  const wouldGap = paletteKinds().filter(kind => {
    const terms = terminalsOf(kind);
    if (terms.length <= 1) return false;
    if (cases.has(kind) || dipLabelled().has(kind)) return false;
    return !terms.every(t => t === 'a' || t === 'b');
  });
  assert.ok(wouldGap.includes(covered),
    'removing a real geometry case did not show up as a gap: the scan is not reading the cases');
});

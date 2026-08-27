import { getSidecar } from '../model/parts-registry.js';
import { boardVisualGeometry } from '../model/board-geometry.js';
import { dipPackageGeometry } from '../model/dip-geometry.js';

/**
 * Model-space hit testing — parts, terminals, wires — as pure math.
 *
 * The old canvas relied on DOM hit targets, and the wokwi web-component
 * overlay swallowed the events: every wokwi part was a dead zone that could
 * be neither selected nor dragged. This module removes DOM from the equation
 * entirely: the presentation layers render with pointer-events: none, the
 * container captures all pointers, and hits are computed here from the same
 * model data the renderer draws from. What you see is what you hit.
 *
 * @module
 */

/**
 * Part footprint in world units, by kind. Width/height BEFORE rotation,
 * centred on the part's (x, y)... matching how the renderer places visuals.
 * Kinds not listed fall back to DEFAULT_FOOTPRINT.
 */
export const FOOTPRINTS = {
  resistor: { w: 64, h: 20 },
  capacitor: { w: 28, h: 36 },
  diode: { w: 52, h: 20 },
  led: { w: 40, h: 50 },
  buzzer: { w: 48, h: 48 },
  potentiometer: { w: 60, h: 60 },
  button: { w: 44, h: 44 },
  switch: { w: 48, h: 28 },
  vcc: { w: 36, h: 40 },
  gnd: { w: 36, h: 40 },
  mcu: { w: 120, h: 160 },
  meter: { w: 70, h: 55 },
  led_cube: { w: 90, h: 90 },
  seven_segment: { w: 50, h: 70 },
  char_lcd: { w: 140, h: 56 },
  led_matrix: { w: 80, h: 80 },
  shift_register: { w: 90, h: 44 },
  ir_receiver: { w: 36, h: 44 },
  temp_sensor: { w: 32, h: 44 },
  eeprom: { w: 70, h: 36 },
  ldr: { w: 40, h: 28 },
  ntc: { w: 40, h: 28 },
  npn: { w: 44, h: 44 }, pnp: { w: 44, h: 44 },
  nmos: { w: 44, h: 44 }, pmos: { w: 44, h: 44 },
  opamp: { w: 60, h: 50 },
  zener: { w: 52, h: 20 },
  vsource: { w: 48, h: 56 },
  isource: { w: 48, h: 56 },
  relay: { w: 70, h: 50 },
  breadboard: { w: 930, h: 310 }, // full size; half/mini computed in partBounds
  dc_motor: { w: 70, h: 70 },
  servo: { w: 70, h: 60 },
  // Retro/logic DIP ICs — body sizes matching the SvgParts renderer
  w65c02: { w: 300, h: 90 }, w65c22: { w: 300, h: 90 }, ns16c550: { w: 300, h: 90 },
  m6532: { w: 300, h: 90 }, ay8912: { w: 220, h: 90 }, transformer: { w: 130, h: 100 },
  w65c51: { w: 220, h: 90 }, z80: { w: 300, h: 90 },
  '62256': { w: 220, h: 90 }, '28c256': { w: 220, h: 90 },
  mc6850: { w: 200, h: 90 }, r6507: { w: 220, h: 90 }, mos6532: { w: 300, h: 90 },
  '74hc00': { w: 120, h: 80 }, '74hc04': { w: 120, h: 80 },
  '74hc08': { w: 120, h: 80 }, '74hc32': { w: 120, h: 80 },
  '74hc74': { w: 120, h: 80 }, '74hc138': { w: 140, h: 80 },
  '74hc245': { w: 160, h: 90 }, '74hc373': { w: 160, h: 90 }, '74hc374': { w: 160, h: 90 },
  '74ls373': { w: 160, h: 90 }, 'osc_can': { w: 120, h: 80 },
  'max232': { w: 140, h: 90 }, 'rnet_sip': { w: 170, h: 55 },
  '74hc595': { w: 130, h: 80 }, '74c922': { w: 150, h: 90 },
  matrix8x8: { w: 60, h: 60 },
  matrix16x8: { w: 110, h: 60 }, matrix9x9: { w: 70, h: 70 },
  at24c64: { w: 80, h: 80 },
  // Part-matrix burn-down: palette parts that used DEFAULT_FOOTPRINT
  rgb_led: { w: 40, h: 50 }, neopixel: { w: 30, h: 30 },
  inductor: { w: 52, h: 20 }, photodiode: { w: 36, h: 36 },
  slide_switch: { w: 48, h: 28 }, dip_switch: { w: 60, h: 30 },
  tip120: { w: 44, h: 52 }, relay_dpdt: { w: 70, h: 60 },
  gearmotor: { w: 70, h: 70 }, vibration_motor: { w: 36, h: 36 },
  '555': { w: 80, h: 60 }, '556': { w: 120, h: 80 },
  cd4093: { w: 120, h: 80 },
  ssd1306: { w: 100, h: 50 }, seven_seg_3: { w: 80, h: 50 },
  clock_display: { w: 80, h: 40 }, max7219: { w: 60, h: 60 },
  ultrasonic: { w: 70, h: 40 }, dht22: { w: 40, h: 50 },
  pir_sensor: { w: 50, h: 50 }, soil_moisture: { w: 40, h: 60 },
  gas_sensor: { w: 50, h: 50 }, tilt_sensor: { w: 36, h: 36 },
  tmp36: { w: 32, h: 44 }, ky002: { w: 36, h: 36 },
  header: { w: 80, h: 20 }, usb_a: { w: 50, h: 30 },
  ir_remote: { w: 36, h: 44 }, solar_cell: { w: 60, h: 50 },
  light_bulb: { w: 36, h: 50 },
  // DIP ICs from the matrix burn-down
  '74hc02': { w: 120, h: 80 }, '74hc86': { w: 120, h: 80 },
  '74hc132': { w: 120, h: 80 }, '74hc165': { w: 130, h: 80 },
  '74hc244': { w: 160, h: 90 }, '74hc688': { w: 160, h: 90 },
  '74hc73': { w: 120, h: 80 }, '74hc93': { w: 120, h: 80 },
  '74hc95': { w: 120, h: 80 },
  pcf8574: { w: 130, h: 80 }, mcp4725: { w: 80, h: 50 },
  char_lcd_i2c: { w: 140, h: 56 },
  l293d: { w: 130, h: 80 },
  // Board values are fallback-only; footprintOf resolves the shared visual
  // geometry first so drawing, auto-fit and pointer hits remain identical.
  arduino_uno: { w: 400, h: 294 }, arduino_nano: { w: 248, h: 98 },
  arduino_mega: { w: 566, h: 280 }, pi_pico: { w: 281, h: 116 }, pybadge: {w: 472, h: 298},
};

export const DEFAULT_FOOTPRINT = { w: 48, h: 48 };

/** @param {{kind: string}} part */
export function footprintOf(part) {
  if (['arduino_uno', 'arduino_nano', 'arduino_mega', 'pi_pico', 'pybadge'].includes(part.kind)) {
    const geometry = boardVisualGeometry(part.kind, getSidecar(part.kind));
    if (geometry) return { w: geometry.w, h: geometry.h };
  }
  const sidecar = getSidecar(part.kind);
  if (sidecar?.footprint?.straddlesGutter) {
    const dip = dipPackageGeometry(sidecar);
    if (dip) return { w: dip.w, h: dip.h };
  }
  return FOOTPRINTS[part.kind] ?? DEFAULT_FOOTPRINT;
}

/**
 * Axis-aligned world bounds of a part, rotation-aware (90° steps swap w/h;
 * arbitrary angles take the rotated AABB).
 * @param {{x: number, y: number, kind: string, rotation?: number}} part
 */
export function partBounds(part) {
  if (part.kind === 'breadboard' && part.params && (part.params.size === 'half' || part.params.size === 'mini')) {
    const cols = part.params.size === 'half' ? 30 : 17;
    const w = (cols - 1) * 14 + 54;
    const h = part.params.size === 'mini' ? 310 - 2 * (2 * 14 + 18) : 310;
    return { minX: part.x - w / 2, minY: part.y - h / 2, maxX: part.x + w / 2, maxY: part.y + h / 2 };
  }
  const { w, h } = footprintOf(part);
  const rot = ((part.rotation ?? 0) % 360 + 360) % 360;
  let bw = w, bh = h;
  if (rot % 180 === 90) { bw = h; bh = w; }
  else if (rot % 90 !== 0) {
    const r = (rot * Math.PI) / 180;
    bw = Math.abs(w * Math.cos(r)) + Math.abs(h * Math.sin(r));
    bh = Math.abs(w * Math.sin(r)) + Math.abs(h * Math.cos(r));
  }
  return { minX: part.x - bw / 2, minY: part.y - bh / 2, maxX: part.x + bw / 2, maxY: part.y + bh / 2 };
}

/** Distance from point P to segment AB. */
export function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Build the HitTest interface the InteractionMachine consumes.
 *
 * @param {() => Array<object>} getParts - parts with x/y/kind/rotation
 * @param {() => Array<{id: string, points: Array<{x: number, y: number}>}>} getWirePaths
 *   Wire polylines in world coords — the SAME points the renderer draws.
 * @param {(part: object) => Array<{terminal: string, x: number, y: number}>} getTerminals
 *   World-coord terminal positions per part — again, the renderer's own.
 */
export function createHitTest(getParts, getWirePaths, getTerminals) {
  return {
    partAt(wx, wy) {
      // Two-pass: non-breadboard parts first (they render on top),
      // breadboards only if nothing else was hit (they render as the
      // bottom substrate layer in BoardCanvas). Without this, a
      // breadboard late in the array swallows clicks on seated parts.
      const parts = getParts();
      for (let i = parts.length - 1; i >= 0; i--) {
        if (parts[i].kind === 'breadboard') continue;
        const b = partBounds(parts[i]);
        if (wx >= b.minX && wx <= b.maxX && wy >= b.minY && wy <= b.maxY) {
          return parts[i].id;
        }
      }
      // Near-miss pass: a seated part's VISIBLE pixels sit offset from its
      // model bounds (a pot's knob is drawn above its seat row), so exact
      // bounds miss clicks that land squarely on the drawn body — and the
      // breadboard underneath swallowed them ("click a part, select the
      // breadboard", owner report, ~ten times over 48h). Before any
      // breadboard may win, the nearest non-breadboard part within one
      // breadboard pitch of its bounds takes the click.
      const SLOP = 16;
      let near = null, nearD = Infinity;
      for (let i = parts.length - 1; i >= 0; i--) {
        if (parts[i].kind === 'breadboard') continue;
        const b = partBounds(parts[i]);
        if (wx >= b.minX - SLOP && wx <= b.maxX + SLOP &&
            wy >= b.minY - SLOP && wy <= b.maxY + SLOP) {
          const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
          const d = Math.hypot(wx - cx, wy - cy);
          if (d < nearD) { nearD = d; near = parts[i].id; }
        }
      }
      if (near) return near;
      // Last pass: breadboards (bottom layer)
      for (let i = parts.length - 1; i >= 0; i--) {
        if (parts[i].kind !== 'breadboard') continue;
        const b = partBounds(parts[i]);
        if (wx >= b.minX && wx <= b.maxX && wy >= b.minY && wy <= b.maxY) {
          return parts[i].id;
        }
      }
      return null;
    },

    terminalAt(wx, wy, radius) {
      let best = null;
      let bestD = radius;
      for (const part of getParts()) {
        for (const t of getTerminals(part)) {
          const d = Math.hypot(wx - t.x, wy - t.y);
          if (d <= bestD) {
            bestD = d;
            best = { partId: part.id, terminal: t.terminal, x: t.x, y: t.y };
          }
        }
      }
      // A seated part's terminals sit ON its body (hole pitch is small), so
      // a generous radius would swallow every body click and turn selection
      // into accidental wiring. Rule: inside the owning part's own bounds,
      // only a PRECISE hit (the dot itself) counts as a terminal; the body
      // keeps its click. From outside the body, the full radius applies.
      if (best && bestD > 6) {
        const parts = getParts();
        for (let i = parts.length - 1; i >= 0; i--) {
          const b = partBounds(parts[i]);
          if (wx >= b.minX && wx <= b.maxX && wy >= b.minY && wy <= b.maxY) {
            if (parts[i].id === best.partId) return null; // body wins
            break; // a different part's body is on top: terminal still valid
          }
        }
      }
      return best;
    },

    wireAt(wx, wy, radius) {
      for (const wire of getWirePaths()) {
        const pts = wire.points;
        for (let i = 0; i + 1 < pts.length; i++) {
          if (distToSegment(wx, wy, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y) <= radius) {
            return wire.id;
          }
        }
      }
      return null;
    },

    partsInRect(rect) {
      const minX = Math.min(rect.x1, rect.x2), maxX = Math.max(rect.x1, rect.x2);
      const minY = Math.min(rect.y1, rect.y2), maxY = Math.max(rect.y1, rect.y2);
      const out = [];
      for (const part of getParts()) {
        const b = partBounds(part);
        // Bounding-box INTERSECTION, not centre containment: brushing a part
        // with the marquee selects it, as every drawing tool users know does.
        if (b.maxX >= minX && b.minX <= maxX && b.maxY >= minY && b.minY <= maxY) {
          out.push(part.id);
        }
      }
      return out;
    },
  };
}

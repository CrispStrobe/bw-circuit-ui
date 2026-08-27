// Dropping a part from the palette must not put it off the canvas, and must
// not put it on top of something else.
//
// The placement search compared CENTRE POINTS with a fixed 60x50 clearance
// and clamped the CENTRE to the working area. Both are size-blind. For the
// small parts that clearance was invented for it is roughly right; for a
// controller board it is not close. An Arduino Uno is 400x294 world units,
// so a centre at the (40, 40) corner spans x -160..240 — most of the board
// outside the canvas — and "no other centre within 60px" called a spot free
// that the board then completely covered, the buried part's wires still
// running to it underneath (owner screenshot).
//
// The sizer is the canvas's own, footprintOf — the one hit-testing and the
// placement ghost already use, so the spot the search calls free is measured
// the same way the board is drawn and clicked. The placement callback lives
// in a React component, so what is asserted here is the rule it applies:
// body-vs-body, and the body inside the area.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import './_setup.js';
import { footprintOf } from '../src/interaction/hittest.js';
import { getSidecar } from '../src/model/parts-registry.js';

const AREA = { left: 40, top: 40, right: 660, bottom: 460 };
const GAP = 20;

const sizeOf = kind => footprintOf({ kind });

/** The clamp the designer applies, extracted so the rule can be asserted. */
function span(lo, hi, extent) {
  const a = lo + extent / 2;
  const b = hi - extent / 2;
  return a <= b ? [a, b] : [(lo + hi) / 2, (lo + hi) / 2];
}

function bodyFits(kind, cx, cy) {
  const s = sizeOf(kind);
  return cx - s.w / 2 >= AREA.left && cx + s.w / 2 <= AREA.right
    && cy - s.h / 2 >= AREA.top && cy + s.h / 2 <= AREA.bottom;
}

function bodiesOverlap(kindA, a, kindB, b) {
  const sa = sizeOf(kindA), sb = sizeOf(kindB);
  return Math.abs(a.x - b.x) < (sa.w + sb.w) / 2 + GAP
    && Math.abs(a.y - b.y) < (sa.h + sb.h) / 2 + GAP;
}

describe('part sizes are known before placing', () => {
  it('a dev board is measured from its drawn geometry, not its sidecar', () => {
    // The sidecar says 180x120 for an Uno; WOKWI_BOARD_SPECS overrides it for
    // exactly these kinds, so reading the sidecar gives a number that is not
    // what the canvas draws. This is why the sizing helper is shared.
    const uno = sizeOf('arduino_uno');
    assert.ok(uno.w > 350 && uno.w < 450, `an Uno is ~400 wide, got ${uno.w.toFixed(0)}`);
    assert.ok(uno.h > 250 && uno.h < 340, `and ~294 tall, got ${uno.h.toFixed(0)}`);
    const sidecar = getSidecar('arduino_uno');
    assert.equal(sidecar.w, 180, 'the sidecar still says 180 — and must not be believed here');
  });

  it('a small part is much smaller than a board', () => {
    const led = sizeOf('led');
    const uno = sizeOf('arduino_uno');
    assert.ok(led.w * 3 < uno.w, `an LED (${led.w}) is far smaller than an Uno (${uno.w.toFixed(0)})`);
  });

  it('an unknown kind still gets a size rather than undefined', () => {
    const s = sizeOf('no_such_part_kind');
    assert.ok(s.w > 0 && s.h > 0, 'the fallback is a real box');
  });
});

describe('placement keeps the body on the canvas', () => {
  it('an Uno can never be clamped to the corner the old code allowed', () => {
    // The exact failure: the old clamp permitted a centre of (40, 40).
    assert.equal(bodyFits('arduino_uno', 40, 40), false,
      'the old corner really does hang the board off the canvas');
    const [minX, maxX] = span(AREA.left, AREA.right, sizeOf('arduino_uno').w);
    const [minY, maxY] = span(AREA.top, AREA.bottom, sizeOf('arduino_uno').h);
    for (const [cx, cy] of [[minX, minY], [maxX, maxY], [minX, maxY], [maxX, minY]]) {
      assert.ok(bodyFits('arduino_uno', cx, cy),
        `every corner of the clamped range must fit: (${cx.toFixed(0)}, ${cy.toFixed(0)})`);
    }
  });

  it('the clamped range is real, not empty, for every dev board', () => {
    for (const kind of ['arduino_uno', 'arduino_nano', 'arduino_mega', 'pi_pico']) {
      const s = sizeOf(kind);
      const [minX, maxX] = span(AREA.left, AREA.right, s.w);
      const [minY, maxY] = span(AREA.top, AREA.bottom, s.h);
      assert.ok(minX <= maxX && minY <= maxY, `${kind} has a usable range`);
    }
  });

  it('a part wider than the area centres instead of hanging off one edge', () => {
    // An Arduino Mega is 566 wide against a 620-wide area, so it fits; the
    // degenerate case still has to produce a number rather than minX > maxX.
    const [lo, hi] = span(AREA.left, AREA.right, 5000);
    assert.equal(lo, hi, 'a single position');
    assert.equal(lo, (AREA.left + AREA.right) / 2, 'and it is the middle');
  });
});

describe('placement does not bury an existing part', () => {
  it('an Uno 60px from an MCU overlaps it — the old rule called that clear', () => {
    // 60x50 was the whole clearance. This is the screenshot: the board is
    // "clear" of the MCU and covers it completely.
    const mcu = { x: 300, y: 300 };
    const uno = { x: 360, y: 300 };
    assert.ok(Math.abs(uno.x - mcu.x) >= 60, 'the old point rule would accept this');
    assert.ok(bodiesOverlap('arduino_uno', uno, 'mcu', mcu),
      'but the bodies plainly overlap');
  });

  it('the body rule needs real separation for a board', () => {
    const mcu = { x: 300, y: 300 };
    const need = (sizeOf('arduino_uno').w + sizeOf('mcu').w) / 2 + GAP;
    assert.ok(bodiesOverlap('arduino_uno', { x: 300 + need - 5, y: 300 }, 'mcu', mcu),
      'just inside is still an overlap');
    assert.ok(!bodiesOverlap('arduino_uno', { x: 300 + need + 5, y: 300 }, 'mcu', mcu),
      'just outside is clear');
  });

  it('two small parts are still allowed to sit close together', () => {
    // The rule must not become so conservative that a bench of LEDs spreads
    // across the whole canvas. Two LEDs a spacing step apart stay clear.
    const a = { x: 200, y: 200 };
    const b = { x: 280, y: 200 };
    assert.ok(!bodiesOverlap('led', a, 'led', b),
      'an 80px spacing step still separates two small parts');
  });
});

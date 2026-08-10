// The schematic is a PROJECTION: every part becomes a symbol, every engine
// net becomes a routed wire touching exactly its pins, deterministically.
import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, resetIds } from '../src/model/circuit.js';
import { projectSchematic } from '../src/model/schematic-projection.js';
import { FOOTPRINTS, computeLeadMap } from '../src/model/footprints.js';

const buildSeated = () => {
  resetIds();
  const c = new Circuit(5.0);
  const bb = c.addPart('breadboard', {}, 500, 300);
  const bat = c.addPart('vsource', { volts: 5 }, 100, 100);
  const r1 = c.addPart('resistor', { ohms: 1000 }, 0, 0);
  const led = c.addPart('led', { color: 'red' }, 0, 0);
  c.seatPart(r1.id, bb.id, computeLeadMap(FOOTPRINTS.resistor, 'b5'));
  c.seatPart(led.id, bb.id, computeLeadMap(FOOTPRINTS.led, 'c9'));
  c.addTapWire(bat.id, 'pos', bb.id, 'a5');
  c.addTapWire(bat.id, 'neg', bb.id, 'a10');
  return c;
};

test('projection: symbols for electrical parts, breadboard excluded', () => {
  const c = buildSeated();
  const proj = projectSchematic(c.parts, c.board.getNets());
  const kinds = proj.symbols.map(s => s.kind).sort();
  assert.deepEqual(kinds, ['led', 'resistor', 'vsource']);
  assert.ok(!proj.symbols.some(s => s.kind === 'breadboard'));
  // The source anchors the left.
  const src = proj.symbols.find(s => s.kind === 'vsource');
  for (const s of proj.symbols) assert.ok(src.col <= s.col, `${s.kind} right of source`);
});

test('projection: every multi-pin net routes and touches its pins', () => {
  const c = buildSeated();
  const nets = c.board.getNets();
  const proj = projectSchematic(c.parts, nets);
  // The seated chain: bat.pos—R.a and R.b—LED.anode and LED.cathode—bat.neg
  // = 3 electrical nets, all with 2+ pins → 3 routed wires.
  assert.equal(proj.wires.length, 3, JSON.stringify(proj.wires.map(w => w.netId)));
  for (const w of proj.wires) {
    const pinPts = proj.symbols.flatMap(s => s.pins).filter(p => p.netId === w.netId);
    assert.ok(pinPts.length >= 2);
    for (const p of pinPts) {
      const touched = w.stubs.some(seg => seg[0].x === p.x && seg[0].y === p.y);
      assert.ok(touched, `wire ${w.netId} touches pin at ${p.x},${p.y}`);
    }
  }
});

test('projection is deterministic and pure', () => {
  const c = buildSeated();
  const nets = c.board.getNets();
  const a = JSON.stringify(projectSchematic(c.parts, nets));
  const b = JSON.stringify(projectSchematic(c.parts, nets));
  assert.equal(a, b);
  // And calling it twice mutated nothing: the circuit still solves the same.
  c.board.advanceTo(25_000_000n);
  const led = c.parts.find(p => p.kind === 'led');
  assert.ok(c.board.ledBrightness(led.id) > 0.1, 'projection did not disturb the model');
});

test('many-pin parts split pins across both sides', () => {
  resetIds();
  const c = new Circuit(5.0);
  c.addPart('shift_register', {}, 200, 200);
  const proj = projectSchematic(c.parts, c.board.getNets());
  const sr = proj.symbols[0];
  const left = sr.pins.filter(p => p.side === 'left').length;
  const right = sr.pins.filter(p => p.side === 'right').length;
  assert.ok(left >= 1 && right >= 1);
  assert.equal(left + right, sr.pins.length);
});

test('projection produces non-zero width and height', () => {
  // The SVG was height="100%" with no definite parent → zero pixels.
  // This test asserts the property that would have caught it: the
  // projection dimensions are positive, so an SVG with viewBox set
  // to them has intrinsic aspect ratio and renders at non-zero size.
  const c = buildSeated();
  const proj = projectSchematic(c.parts, c.board.getNets());
  assert.ok(proj.width > 0, `projection width must be > 0, got ${proj.width}`);
  assert.ok(proj.height > 0, `projection height must be > 0, got ${proj.height}`);
  // A two-part circuit should not be absurdly small
  assert.ok(proj.width >= 100, `width ${proj.width} too small for a real schematic`);
  assert.ok(proj.height >= 50, `height ${proj.height} too small for a real schematic`);
});

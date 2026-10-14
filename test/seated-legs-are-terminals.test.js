// A seated part's legs are its terminals (B17).
//
// The gallery's A2 benches store a seated 8051 as `"terminals": []` with all
// 40 legs in seat.leadMap. bw-board drives and reads ONLY a part's declared
// terminals, so after load every port leg stood in its strip as a net member
// nothing could drive: the program ran and the LED row / 7-segment display on
// the bench never saw it (measured 2026-10-14, 16 gallery files, 160 wired
// GPIO legs, 0 swung). Circuit.fromJSON now adds every seated leg to the
// part's terminal list.
//
// One case per MCU family the gallery seats. Each builds the bench the way
// the designer does (addPart + the kind's breadboard footprint), taps an LED
// from a free hole in ONE leg's column — the strip is the only connection —
// then saves, rewrites the MCU's stored terminals to the gallery's shapes
// (empty, and a one-pin subset naming a DIFFERENT leg), loads, and drives the
// leg both ways: the LED must follow.
import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, resetIds } from '../src/model/circuit.js';
import { FOOTPRINTS, computeLeadMap } from '../src/model/footprints.js';
import { breadboardFootprintForPart } from '../src/model/carriers.js';

// [kind, the leg driven, a different leg for the subset case]
const FAMILIES = [
  ['mcu', 'P1.0', 'P3.7'],            // STC89C52RC / STC12C5A60S2 DIP-40 benches
  ['stc15_mcu', 'P2.0', 'P3.7'],      // STC15F2K60S2 benches
  ['attiny85', 'pb0', 'pb3'],
  ['attiny88', 'pb0', 'pd4'],
  ['arduino_nano', 'd13', 'd2'],
  ['pi_pico', 'gp15', 'gp2'],
  ['stm32f030', 'pa4', 'pa9'],
];

/** The hole in `hole`'s column on the same half of the board, `rows` away from the leg. */
function sameStripHole (hole, otherRows) {
  const m = /^([a-j])(\d+)$/.exec(hole);
  assert.ok(m, `leg hole ${hole} is a terminal-strip hole`);
  const half = m[1] <= 'e' ? 'abcde' : 'fghij';
  const row = [...half].find(r => r !== m[1] && !otherRows.has(`${r}${m[2]}`));
  return `${row}${m[2]}`;
}

function buildBench (kind, leg) {
  resetIds();
  const c = new Circuit(5.0);
  const bb = c.addPart('breadboard', {}, 400, 300);
  const mcu = c.addPart(kind, {}, 0, 0);
  const fp = breadboardFootprintForPart(mcu, FOOTPRINTS);
  assert.ok(fp, `${kind}: has a breadboard footprint`);
  assert.ok(c.seatPart(mcu.id, bb.id, computeLeadMap(fp, 'e3')), `${kind}: seats`);
  const legHole = mcu.seat.leadMap[leg];
  assert.ok(legHole, `${kind}: ${leg} is a seated leg`);
  const vcc = c.addPart('vcc', {}, 0, 0);
  const gnd = c.addPart('gnd', {}, 0, 0);
  const led = c.addPart('led', { color: 'red' }, 0, 0);
  const r = c.addPart('resistor', { ohms: 220 }, 0, 0);
  // The supply pins stay unwired: this is about one port leg and its strip.
  void vcc;
  assert.ok(c.addTapWire(led.id, 'anode', bb.id, sameStripHole(legHole, new Set(Object.values(mcu.seat.leadMap)))),
    `${kind}: the LED taps ${leg}'s strip`);
  c.addWire(led.id, 'cathode', r.id, 'a');
  c.addWire(r.id, 'b', gnd.id, 'gnd');
  return { json: c.toJSON(), mcuId: mcu.id, ledId: led.id };
}

/** Load the way the designer does and drive `leg` high then low. */
function drive (json, mcuId, ledId, leg) {
  const c = Circuit.fromJSON(json);
  assert.equal(c.netlistError, null, `loads: ${c.netlistError}`);
  const m = c.parts.find(p => p.id === mcuId);
  const b = c.board;
  b.setPin(leg.toLowerCase(), 'pushpull', true);
  b.advanceTo(25_000_000n);
  const high = b.ledBrightness(ledId);
  b.setPin(leg.toLowerCase(), 'pushpull', false);
  b.advanceTo(50_000_000n);
  const low = b.ledBrightness(ledId);
  return { high, low, terminals: m.terminals };
}

for (const [kind, leg, other] of FAMILIES) {
  test(`${kind}: a seated leg drives its strip whatever terminal list the file stored`, () => {
    const { json, mcuId, ledId } = buildBench(kind, leg);
    const control = drive(json, mcuId, ledId, leg);
    assert.ok(control.high > 0.05 && control.low < 0.01,
      `${kind}: the bench as built drives the LED (high ${control.high}, low ${control.low})`);
    for (const [shape, stored] of [['"terminals": []', []], [`"terminals": ["${other}"]`, [other]]]) {
      const file = JSON.parse(JSON.stringify(json));
      const part = file.parts.find(p => p.id === mcuId);
      part.terminals = stored;
      const legs = Object.keys(part.seat.leadMap);
      const got = drive(file, mcuId, ledId, leg);
      const have = new Set(got.terminals.map(t => String(t).toLowerCase()));
      const undeclared = legs.filter(l => !have.has(l.toLowerCase()));
      assert.deepEqual(undeclared, [], `${kind} ${shape}: every seated leg is a terminal after load`);
      assert.ok(stored.every(t => got.terminals.includes(t)), `${kind} ${shape}: stored entries are kept`);
      assert.ok(got.high > 0.05, `${kind} ${shape}: driving ${leg} high lights the LED on its strip (${got.high})`);
      assert.ok(got.low < 0.01, `${kind} ${shape}: driving ${leg} low darkens it (${got.low})`);
    }
  });
}

test('an unseated part keeps its stored terminal list exactly', () => {
  resetIds();
  const c = new Circuit(5.0);
  const mcu = c.addPart('mcu', {}, 0, 0);
  const json = c.toJSON();
  json.parts.find(p => p.id === mcu.id).terminals = ['P1.0'];
  const loaded = Circuit.fromJSON(json);
  assert.deepEqual(loaded.parts.find(p => p.id === mcu.id).terminals, ['P1.0']);
});

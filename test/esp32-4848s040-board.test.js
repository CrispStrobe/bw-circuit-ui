import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, terminalsForKind } from '../src/model/circuit.js';
import { getSidecar } from '../src/model/parts-registry.js';
import { FOOTPRINTS } from '../src/model/footprints.js';
import { boardTerminalOffsets, boardVisualGeometry, BOARD_FACE_KINDS } from '../src/model/board-geometry.js';
import { footprintOf, partBounds } from '../src/interaction/hittest.js';
import { buildSeatedFromDeclarations } from '../src/model/infer-seated.js';
import { circuitToDeclarations } from '../src/model/declarations.js';
import { demoPinScriptApplies, armBoardForRun } from '../src/model/simulation.js';
import { runDrc } from '../src/model/drc.js';

const kind = 'esp32_4848s040';
const h1 = ['gnd', 'gnd2', 'gpio40', 'gpio44', 'gpio2', 'gpio43', 'gpio1', '5v'];
const netAt = (c, id, terminal) => c.board.nets.find(n => n.terminals.some(t => t.part === id && t.terminal === terminal));

test('S040 exposes only physical H1, shares face geometry with hits and refuses invented seating', () => {
  const sc = getSidecar(kind);
  assert.deepEqual(terminalsForKind(kind), h1);
  assert.deepEqual(sc.terminals.map(t => t.name), h1);
  assert.equal(sc.footprint, null);
  assert.equal(FOOTPRINTS[kind], undefined);
  assert.ok(BOARD_FACE_KINDS.includes(kind));
  const geometry = boardVisualGeometry(kind, sc);
  assert.deepEqual([geometry.w, geometry.h], [420, 280]);
  assert.deepEqual(footprintOf({ kind }), { w: 420, h: 280 });
  assert.deepEqual(boardTerminalOffsets(kind, sc).gnd, { dx: 105, dy: -56 });
  assert.deepEqual(boardTerminalOffsets(kind, sc)['5v'], { dx: 168, dy: 70 });
  assert.deepEqual(partBounds({ kind, x: 300, y: 200, rotation: 90 }), { minX: 160, minY: -10, maxX: 440, maxY: 410 });
  const c = new Circuit();
  const part = c.addPart(kind, {}, 400, 240);
  const bb = c.addPart('breadboard', {}, 400, 600);
  assert.equal(c.seatPart(part.id, bb.id, { gpio1: 'a1' }), false);
  assert.equal(part.seat, undefined);
});

test('S040 saves and reloads its board identity, pose and exact connector; internal pins cannot be wired', () => {
  const c = new Circuit();
  const panel = c.addPart(kind, {}, 400, 240);
  panel.rotation = 90; panel.flipped = true;
  const resistor = c.addPart('resistor', { ohms: 1000 }, 100, 100);
  assert.ok(c.addWire(panel.id, 'gpio40', resistor.id, 'a'));
  for (const pin of ['gpio0', 'gpio19', 'gpio20', 'gpio22', 'gpio35', 'gpio38', 'gpio45', '3v3']) {
    assert.equal(c.addWire(panel.id, pin, resistor.id, 'b'), null, pin);
  }
  const saved = c.toJSON();
  const restored = Circuit.fromJSON(saved);
  const live = restored.getPart(panel.id);
  assert.deepEqual([live.kind, live.rotation, live.flipped], [kind, 90, true]);
  assert.deepEqual(live.terminals, h1);
  assert.equal(restored.wires.length, 1);
  saved.parts.find(p => p.id === panel.id).terminals.push('gpio19');
  assert.deepEqual(Circuit.fromJSON(saved).getPart(panel.id).terminals, h1, 'stored SoC pin lists cannot add connectors');
});

test('S040 programs without external PIN rows place the panel alone and never arm synthetic GPIO', () => {
  const c = new Circuit();
  buildSeatedFromDeclarations(c, { device: 'esp32-4848s040', pins: [] });
  assert.deepEqual(c.parts.map(p => p.kind), [kind]);
  const writes = [];
  armBoardForRun({ board: { reset() {} }, parts: c.parts, wires: c.wires, setPin: (...args) => writes.push(args) });
  assert.deepEqual(writes, []);
  assert.equal(demoPinScriptApplies({ hasMcu: true, stc: { device: 'esp32-4848s040', pins: [] } }), false);
});

test('inference separates 5 V board power from 3.3 V GPIO rails and refuses reserved pins', () => {
  const c = new Circuit();
  const { notes } = buildSeatedFromDeclarations(c, { device: 'esp32-4848s040', pins: [
    { name: 'pot', where: 'GPIO1', direction: 'analog' },
    { name: 'button', where: 'GPIO44', direction: 'input' },
    { name: 'internal', where: 'GPIO19', direction: 'output' },
    { name: 'missing', where: 'GPIO22', direction: 'output' },
    { name: 'noAdc', where: 'GPIO40', direction: 'analog' },
  ] }, { realism: 'simple' });
  const panel = c.parts.find(p => p.kind === kind);
  const pot = c.parts.find(p => p.kind === 'potentiometer');
  const supplies = c.parts.filter(p => p.kind === 'vsource');
  assert.deepEqual(supplies.map(p => p.params.volts).sort((a, b) => a - b), [3.3, 5]);
  assert.equal(panel.seat, undefined);
  const supply5 = supplies.find(p => p.params.volts === 5);
  const supply3 = supplies.find(p => p.params.volts === 3.3);
  assert.equal(netAt(c, panel.id, '5v').id, netAt(c, supply5.id, 'pos').id);
  assert.equal(netAt(c, pot.id, 'a').id, netAt(c, supply3.id, 'pos').id);
  assert.notEqual(netAt(c, panel.id, '5v').id, netAt(c, pot.id, 'a').id);
  assert.equal(netAt(c, panel.id, 'gpio1').id, netAt(c, pot.id, 'wiper').id);
  assert.equal(netAt(c, supply5.id, 'neg').id, netAt(c, supply3.id, 'neg').id);
  assert.ok(notes.some(n => /internal: GPIO19.*not wired/.test(n)));
  assert.ok(notes.some(n => /missing: GPIO22.*not wired/.test(n)));
  assert.ok(notes.some(n => /noAdc: gpio40 has no ADC/.test(n)));
  const declarations = circuitToDeclarations(c.parts, c.wires, c.board.nets);
  assert.equal(declarations.device, 'esp32-4848s040');
  assert.equal(declarations.pins.find(p => p.name === 'pot').direction, 'analog');
});

test('DRC distinguishes 5 V supply from 3.3 V GPIO and reports stale internal-pin wires', () => {
  function warnings(pin, volts, sourceKind = 'vcc') {
    const c = new Circuit();
    const panel = c.addPart(kind, {}, 0, 0);
    const supply = c.addPart(sourceKind, { volts }, 100, 0);
    c.addWire(panel.id, pin, supply.id, sourceKind === 'vcc' ? 'vcc' : 'pos');
    return runDrc(c, { powered: true });
  }
  assert.ok(warnings('gpio1', 5).some(w => w.rule === 'esp32-s040-voltage'));
  assert.ok(warnings('gpio44', 5, 'vsource').some(w => w.rule === 'esp32-s040-voltage'));
  assert.equal(warnings('gpio1', 3.3).some(w => w.rule === 'esp32-s040-voltage'), false);
  assert.equal(warnings('5v', 5).some(w => w.rule === 'esp32-s040-voltage'), false);
  const c = new Circuit();
  const panel = c.addPart(kind, {}, 0, 0);
  c.wires.push({ id: 'stale', from: { part: panel.id, terminal: 'gpio19' }, to: { part: panel.id, terminal: 'gnd' }, netId: 'stale-net' });
  assert.ok(runDrc(c, { powered: true }).some(w => w.rule === 'esp32-s040-reserved-pin' && w.pinId === 'gpio19'));
});

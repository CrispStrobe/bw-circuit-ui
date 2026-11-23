/**
 * Part definitions the lab builders tripped over (fix brief 2026-11-23):
 *
 *  - an unknown kind used to get a silent `['a','b']` terminal list, so a
 *    part the catalogue does not know looked like a two-lead part and its real
 *    pins dropped their wires. Now `terminalsForKind` answers null, warns, and
 *    `addPart` refuses the kind;
 *  - `function_gen` and `oscilloscope` are engine devices in bw-board; a saved
 *    file naming them keeps its kind (and its out/gnd, ch1/ch2/gnd leads)
 *    when the injected engine models them, and still collapses onto the old
 *    alias target against an engine that does not;
 *  - the palette offers the initial-state params the engine now reads
 *    (switch `closed`, button `pressed`, slide_switch `position`) and the two
 *    instruments.
 */
import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setEngine, getEngine } from '../src/engine.js';
import { Circuit, terminalsForKind } from '../src/model/circuit.js';
import { ENGINE_MODEL_WINS, KIND_ALIASES, resolveKind } from '../src/model/terminal-aliases.js';

test('an unknown kind has no invented a/b terminals and addPart refuses it', () => {
  const warn = console.warn; const said = [];
  console.warn = (...a) => said.push(a.join(' '));
  try {
    assert.equal(terminalsForKind('no_such_widget_kind', {}), null);
    assert.ok(said.some(s => /no terminal list for part kind "no_such_widget_kind"/.test(s)));
    const c = new Circuit(5);
    assert.throws(() => c.addPart('no_such_widget_kind', {}, 0, 0), /unknown part kind "no_such_widget_kind"/);
    assert.equal(c.parts.length, 0);
  } finally { console.warn = warn; }
});

test('a saved part of an unknown kind without a terminal list loads with none, not a/b', () => {
  const warn = console.warn; console.warn = () => {};
  try {
    const c = Circuit.fromJSON({ vcc: 5, parts: [{ id: 'x1', kind: 'no_such_widget_kind', params: {}, x: 0, y: 0 }], wires: [] });
    assert.deepEqual(c.parts[0].terminals, []);
  } finally { console.warn = warn; }
});

test('known kinds are untouched: sidecar and engine kinds keep their lists', () => {
  assert.deepEqual(terminalsForKind('resistor', {}), ['a', 'b']);
  assert.deepEqual(terminalsForKind('function_gen', {}), ['out', 'gnd']);
  assert.deepEqual(terminalsForKind('oscilloscope', {}), ['ch1', 'ch2', 'gnd']);
});

test('function_gen / oscilloscope: the engine model wins over the legacy alias', () => {
  assert.ok(ENGINE_MODEL_WINS.has('function_gen') && ENGINE_MODEL_WINS.has('oscilloscope'));
  assert.equal(resolveKind('function_gen', () => true), 'function_gen');
  assert.equal(resolveKind('oscilloscope', () => true), 'oscilloscope');
  // An engine without the models keeps the old collapse.
  assert.equal(resolveKind('function_gen', () => false), KIND_ALIASES.function_gen);
  assert.equal(resolveKind('oscilloscope'), KIND_ALIASES.oscilloscope);
});

test('a saved function_gen keeps its kind and out/gnd wires when the engine models it', () => {
  const prev = getEngine();
  const models = { function_gen: { terminals: ['out', 'gnd'] } };
  setEngine({ ...prev, getDevice: k => models[k] ?? prev.getDevice(k) });
  try {
    const c = Circuit.fromJSON({ vcc: 5, parts: [
      { id: 'fg', kind: 'function_gen', params: { wave: 'square', freq: 500 }, x: 0, y: 0 },
      { id: 'r1', kind: 'resistor', params: { ohms: 1000 }, x: 0, y: 0 }],
    wires: [{ id: 'w1', from: { part: 'fg', terminal: 'out' }, to: { part: 'r1', terminal: 'a' } }] });
    const fg = c.parts.find(p => p.id === 'fg');
    assert.equal(fg.kind, 'function_gen');
    assert.deepEqual(fg.terminals, ['out', 'gnd']);
    assert.deepEqual(c.wires[0].from, { part: 'fg', terminal: 'out' });
  } finally { setEngine(prev); }
});

test('the palette offers initial contact state and the two bench instruments', () => {
  const src = readFileSync(new URL('../src/components/PartPalette.jsx', import.meta.url), 'utf8');
  assert.match(src, /kind: 'switch', label: 'Switch', params: \{ closed: 0 \}/);
  assert.match(src, /kind: 'button', label: 'Button', params: \{ pressed: 0 \}/);
  assert.match(src, /kind: 'slide_switch', label: 'Slide Switch', params: \{ position: 0 \}/);
  assert.match(src, /kind: 'function_gen', label: 'Function Generator'/);
  assert.match(src, /kind: 'oscilloscope', label: 'Oscilloscope', params: \{ inputOhms: 1e6 \}/);
});

test('the designer plays a piezo through the same tone surface as a buzzer', () => {
  const src = readFileSync(new URL('../src/components/CircuitDesigner.jsx', import.meta.url), 'utf8');
  assert.match(src, /p\.kind === 'buzzer' \|\| p\.kind === 'piezo'/);
});

test('against an engine WITHOUT the models, collapsed instruments keep their wires and cells their EMF', () => {
  const prev = getEngine();
  setEngine({ ...prev, getDevice: k => (['function_gen', 'oscilloscope', 'potato_battery', 'lemon_battery'].includes(k) ? null : prev.getDevice(k)) });
  try {
    const c = Circuit.fromJSON({ vcc: 5, parts: [
      { id: 'fg', kind: 'function_gen', params: { wave: 'sine' }, terminals: ['out', 'gnd'], x: 0, y: 0 },
      { id: 'sc', kind: 'oscilloscope', params: {}, terminals: ['ch1', 'ch2', 'gnd'], x: 0, y: 0 },
      { id: 'pb', kind: 'potato_battery', params: {}, x: 0, y: 0 },
      { id: 'r1', kind: 'resistor', params: { ohms: 1000 }, x: 0, y: 0 }],
    wires: [
      { id: 'w1', from: { part: 'fg', terminal: 'out' }, to: { part: 'r1', terminal: 'a' } },
      { id: 'w2', from: { part: 'fg', terminal: 'gnd' }, to: { part: 'r1', terminal: 'b' } },
      { id: 'w3', from: { part: 'sc', terminal: 'ch1' }, to: { part: 'r1', terminal: 'a' } }] });
    const fg = c.parts.find(p => p.id === 'fg');
    assert.equal(fg.kind, 'vsource');
    assert.deepEqual(fg.terminals, ['pos', 'neg']);
    const ends = c.wires.flatMap(w => [w.from, w.to]).filter(e => e.part === 'fg').map(e => e.terminal).sort();
    assert.deepEqual(ends, ['neg', 'pos']);
    assert.ok(c.wires.some(w => w.from.part === 'sc' && w.from.terminal === 'probe_a'));
    const pb = c.parts.find(p => p.id === 'pb');
    assert.equal(pb.kind, 'vsource');
    assert.equal(pb.params.volts, 0.85, 'a potato is not the board 5 V');
    assert.equal(pb.params.rInternal, 5000);
  } finally { setEngine(prev); }
});

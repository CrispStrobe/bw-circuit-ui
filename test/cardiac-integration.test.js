// SPDX-License-Identifier: MIT
import './_setup.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Circuit} from '../src/model/circuit.js';
import {CARDIAC_TERMINALS} from 'bw-board/devices/cardiac.js';
import {createCardiacConnectorAssets} from '../scripts/generate-cardiac-connector.mjs';
import {getSidecar} from '../src/model/parts-registry.js';
import {ART_FACE_KINDS, artPinOffsets} from '../src/model/part-art.js';
import {createHitTest, footprintOf, partBounds} from '../src/interaction/hittest.js';
import {computeFitView} from '../src/interaction/transform.js';
import {cardiacControl, saveCardiacProgram, parseCardiacInputCards, cardiacKeyboardCommand,
  formatCardiacWord, openCardiacLab, isCardiacExample, acceptedCardiacProgram,
  sameCardiacProgram} from '../src/model/cardiac-controls.js';
import {CARDIAC_EXAMPLES, cardiacDemoCircuit} from '../src/model/cardiac-demo.js';
import {classifyRunPins, designerClockPlan} from '../src/model/simulation.js';

const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');
const make = (program = CARDIAC_EXAMPLES[0].program) => {
  const circuit = new Circuit(5);
  const part = circuit.addPart('cardiac', {program, instructionHz: 20}, 350, 250);
  return {circuit, part};
};
const control = (circuit, part, verb, value) => cardiacControl({board: circuit.board, part, verb, value,
  onProgramChange: (id, program) => saveCardiacProgram(circuit, id, program)});
const advance = (circuit, ms) => circuit.advanceTo(BigInt(ms) * 1_000_000n);

test('CARDIAC connector art, geometry and engine expose the same four modern adapter terminals', () => {
  const {sidecar, svg} = createCardiacConnectorAssets();
  assert.deepEqual(JSON.parse(read('../src/parts-data/cardiac.json')), sidecar);
  assert.equal(read('../src/parts-data/cardiac.svg'), svg);
  assert.deepEqual(getSidecar('cardiac'), sidecar);
  assert.ok(ART_FACE_KINDS.includes('cardiac'));
  assert.deepEqual(sidecar.terminals.map(pin => pin.name), CARDIAC_TERMINALS);
  assert.deepEqual(CARDIAC_TERMINALS, ['IN', 'OUT', '5v', 'gnd']);
  assert.match(sidecar._note, /historical cardboard machine has no electrical pins/);
  const offsets = artPinOffsets(sidecar);
  for (const pin of sidecar.terminals) {
    assert.match(svg, new RegExp(`data-terminal="${pin.name}"[^]*?<circle cx="${pin.x}" cy="${pin.y}"`));
    assert.deepEqual(offsets[pin.name], {dx: pin.x - sidecar.w / 2, dy: pin.y - sidecar.h / 2});
  }
});

test('all of the CARDIAC face is selectable and fits a narrow canvas after rotation and reflection', () => {
  for (const rotation of [0, 45, 90, 180, 270]) for (const flipped of [false, true]) {
    const part = {id: 'cardiac-fit', kind: 'cardiac', x: 750, y: 430, rotation, flipped};
    assert.deepEqual(footprintOf(part), {w: 280, h: 260});
    const bounds = partBounds(part);
    const hit = createHitTest(() => [part], () => [], () => []);
    const angle = rotation * Math.PI / 180;
    const corners = [-139, 139].flatMap(x => [-129, 129].map(y => {
      const dx = x * (flipped ? -1 : 1);
      return {x: part.x + dx * Math.cos(angle) - y * Math.sin(angle),
        y: part.y + dx * Math.sin(angle) + y * Math.cos(angle)};
    }));
    for (const point of corners) assert.equal(hit.partAt(point.x, point.y), part.id);
    const viewport = {w: 354, h: 568};
    const view = computeFitView([bounds], viewport);
    for (const point of corners) {
      const x = (point.x - view.pan.x) * view.zoom, y = (point.y - view.pan.y) * view.zoom;
      assert.ok(x >= 0 && x <= viewport.w && y >= 0 && y <= viewport.h);
    }
  }
});

test('waiting does not consume fabricated cards and a manual card records its provenance', () => {
  const {circuit, part} = make();
  control(circuit, part, 'run'); advance(circuit, 300);
  const state = circuit.board.getDeviceState(part.id);
  assert.equal(state.waiting, true); assert.equal(state.pc, 1); assert.equal(state.steps, 0);
  advance(circuit, 900);
  assert.equal(state.steps, 0); assert.deepEqual(state.output, []);
  control(circuit, part, 'enqueueInput', [42]);
  assert.deepEqual(state.inputSources, ['manual']);
  advance(circuit, 1300);
  assert.deepEqual(state.output, [42]); assert.equal(state.halted, true);
  assert.equal(state.memory[80], 42); assert.equal(state.steps, 3);
});

test('accepted program save is idempotent and keeps live machine writes out of portable circuit data', () => {
  const {circuit, part} = make();
  const board = circuit.board;
  control(circuit, part, 'loadProgram', CARDIAC_EXAMPLES[2].program);
  const accepted = JSON.parse(JSON.stringify(part.params.program));
  control(circuit, part, 'enqueueInput', [17, 25]);
  control(circuit, part, 'run'); advance(circuit, 600);
  const state = board.getDeviceState(part.id);
  assert.deepEqual(state.output, [42]); assert.equal(state.memory[82], 42);
  assert.equal(saveCardiacProgram(circuit, part.id, state.program), false);
  assert.equal(circuit.board, board);
  assert.deepEqual(part.params.program, accepted);
  const restored = Circuit.fromJSON(JSON.parse(JSON.stringify(circuit.toJSON())));
  assert.deepEqual(restored.getPart(part.id).params.program, accepted);
  const initial = restored.board.getDeviceState(part.id);
  assert.equal(initial.memory[82], 0); assert.equal(initial.running, false);
  assert.deepEqual(initial.inputQueue, []); assert.deepEqual(initial.output, []);
  assert.equal(designerClockPlan({armedByFlag: {board, armed: classifyRunPins(circuit)}, board, released: false}), 'reuse');
  assert.deepEqual(classifyRunPins(circuit).outputPins, []);
});

test('invalid load is atomic, distinct computers are independent, and restart restores the authored image', () => {
  const {circuit, part} = make();
  const other = circuit.addPart('cardiac', {program: CARDIAC_EXAMPLES[2].program, instructionHz: 20}, 650, 250);
  const authored = JSON.parse(JSON.stringify(part.params.program));
  assert.throws(() => control(circuit, part, 'loadProgram', {entry: 1, words: [{address: 100, value: 900}]}));
  assert.deepEqual(part.params.program, authored);
  control(circuit, part, 'enqueueInput', [7]); control(circuit, part, 'run'); advance(circuit, 500);
  assert.deepEqual(circuit.board.getDeviceState(part.id).output, [7]);
  assert.deepEqual(circuit.board.getDeviceState(other.id).inputQueue, []);
  assert.equal(circuit.board.getDeviceState(other.id).steps, 0);
  control(circuit, part, 'reset');
  const state = circuit.board.getDeviceState(part.id);
  assert.equal(state.pc, 1); assert.equal(state.memory[80], 0); assert.equal(state.running, false);
  assert.deepEqual(state.output, []);
});

test('host save notifications accept only the current engine image and preserve runtime on equivalent saves', () => {
  const {circuit, part} = make();
  const program = CARDIAC_EXAMPLES[2].program;
  assert.equal(circuit.board.setDeviceControl(part.id, 'loadProgram', program), true);
  assert.equal(sameCardiacProgram(part.params.program, program), false, 'the external host has not yet saved its load');
  assert.equal(acceptedCardiacProgram(circuit.board, part, CARDIAC_EXAMPLES[0].program), null);
  const accepted = acceptedCardiacProgram(circuit.board, part, {words: [...program.words].reverse(), entry: program.entry});
  assert.ok(accepted);
  assert.equal(saveCardiacProgram(circuit, part.id, accepted), true);
  control(circuit, part, 'enqueueInput', [17, 25]);
  control(circuit, part, 'run'); advance(circuit, 600);
  const state = circuit.board.getDeviceState(part.id), pc = state.pc, steps = state.steps;
  assert.equal(saveCardiacProgram(circuit, part.id, acceptedCardiacProgram(circuit.board, part, program)), false);
  advance(circuit, 800);
  assert.deepEqual([state.pc, state.steps, state.memory[82], state.output], [pc, steps, 42, [42]]);
  assert.equal(acceptedCardiacProgram(circuit.board, {id: part.id, kind: 'resistor'}, program), null);
  assert.equal(acceptedCardiacProgram(circuit.board, part, {entry: 1, words: [null]}), null);
});

test('compact clock intent reaches the attached host before a step and after an accepted run', () => {
  const {circuit, part} = make();
  const target = new EventTarget(), events = [];
  target.addEventListener('bw-cardiac-run', event => {
    const state = circuit.board.getDeviceState(event.detail.partId);
    events.push(['run', state.running, state.steps]);
  });
  target.addEventListener('bw-cardiac-pause', event => {
    const state = circuit.board.getDeviceState(event.detail.partId);
    events.push(['pause', state.running, state.steps]);
    circuit.board.setDeviceControl(event.detail.partId, 'pause');
  });
  const command = (verb, value) => cardiacControl({board: circuit.board, part, verb, value, eventTarget: target});
  command('enqueueInput', [42]); command('run'); command('step');
  assert.deepEqual(events, [['run', true, 0], ['pause', true, 0]]);
  const state = circuit.board.getDeviceState(part.id);
  assert.deepEqual([state.steps, state.memory[80], state.running], [1, 42, false]);
});

test('the wired night light samples once and drives its physical resistor and LED from OUT', () => {
  const fixture = cardiacDemoCircuit();
  const circuit = Circuit.fromJSON(fixture), part = circuit.getPart('cardiac');
  assert.equal(circuit.wires.length, fixture.wires.length);
  circuit.setControl('light-level', 0.2); advance(circuit, 5);
  control(circuit, part, 'sampleInput');
  let state = circuit.board.getDeviceState(part.id);
  assert.equal(state.inputQueue.length, 1);
  assert.ok(state.inputQueue[0] > 150 && state.inputQueue[0] < 250, String(state.inputQueue));
  assert.deepEqual(state.inputSources, ['circuit']);
  advance(circuit, 20); assert.equal(state.inputQueue.length, 1, 'settling voltage never manufactures another card');
  control(circuit, part, 'run'); advance(circuit, 800);
  assert.deepEqual(state.output, [1]); assert.equal(state.waiting, true);
  assert.ok(circuit.ledBrightness('lamp') > 0.01, 'the actual electrical LED branch lights');
  const steps = state.steps;
  circuit.setControl('light-level', 0.8); advance(circuit, 900);
  assert.deepEqual(state.output, [1]); assert.equal(state.steps, steps, 'voltage change alone executes no new sample');
  control(circuit, part, 'sampleInput'); advance(circuit, 1700);
  state = circuit.board.getDeviceState(part.id);
  assert.deepEqual(state.output, [1, 0]);
  assert.equal(circuit.ledBrightness('lamp'), 0);
  control(circuit, part, 'pause');
  control(circuit, part, 'enqueueInput', [200]);
  const pausedPc = state.pc; advance(circuit, 2000);
  assert.equal(state.pc, pausedPc); assert.equal(state.inputQueue.length, 1);
  control(circuit, part, 'step');
  assert.equal(state.memory[80], 200); assert.equal(state.running, false);
});

test('manual card parsing, decimal rendering, keyboard scope and host handoff are bounded', () => {
  assert.deepEqual(parseCardiacInputCards('001, -009 +234 000'), [1, -9, 234, 0]);
  for (const invalid of ['', '1.5', '0x10', '1000', '-1000', 'NaN', '1e2']) {
    assert.throws(() => parseCardiacInputCards(invalid));
  }
  assert.throws(() => parseCardiacInputCards(Array(101).fill('001').join(' ')));
  assert.equal(formatCardiacWord(-8), '−008'); assert.equal(formatCardiacWord(12, 4), '0012');
  const key = (key, extra = {}) => cardiacKeyboardCommand({key, target: {tagName: 'SECTION'}, ...extra}, false);
  assert.equal(key(' '), 'run'); assert.equal(key('Escape'), 'pause'); assert.equal(key('ArrowRight'), 'step');
  assert.equal(key(' ', {repeat: true}), null); assert.equal(key(' ', {ctrlKey: true}), null);
  assert.equal(key('ArrowRight', {target: {tagName: 'INPUT'}}), null);
  assert.equal(key(' ', {target: {tagName: 'BUTTON'}}), null);
  const target = new EventTarget(); let detail;
  target.addEventListener('bw-cardiac-open', event => { detail = event.detail; });
  assert.equal(openCardiacLab('cardiac-example', target), true);
  assert.deepEqual(detail, {partId: 'cardiac-example'});
  assert.equal(isCardiacExample({kind: 'program', target: 'cardiac', files: {cardiac: 'echo/program.cardiac'}}), true);
  assert.equal(isCardiacExample({kind: 'program', files: {cardiac: 'echo/program.cardiac'}}), true);
  assert.equal(isCardiacExample({kind: 'program', device: 'stc12', files: {program: 'blink/program.bw'}}), false);
});

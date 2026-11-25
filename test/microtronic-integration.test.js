// SPDX-License-Identifier: MIT
import './_setup.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Circuit} from '../src/model/circuit.js';
import {MICROTRONIC_TERMINALS} from 'bw-board/devices/microtronic.js';
import {createMicrotronicConnectorAssets} from '../scripts/generate-microtronic-connector.mjs';
import {getSidecar} from '../src/model/parts-registry.js';
import {ART_FACE_KINDS, artPinOffsets} from '../src/model/part-art.js';
import {createHitTest, footprintOf, partBounds} from '../src/interaction/hittest.js';
import {computeFitView} from '../src/interaction/transform.js';
import {microtronicControl, saveMicrotronicProgram, microtronicKeyboardKey, MICROTRONIC_KEY_ROWS} from '../src/model/microtronic-controls.js';
import {microtronicDemoCircuit, MICROTRONIC_EXAMPLES} from '../src/model/microtronic-demo.js';
import {classifyRunPins, designerClockPlan} from '../src/model/simulation.js';

const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');
const make = (source = MICROTRONIC_EXAMPLES[0].source) => {
  const c = new Circuit(5);
  const part = c.addPart('busch-microtronic', {program: source, instructionHz: 20}, 350, 250);
  return {c, part};
};
const control = (c, part, verb, value) => microtronicControl({board: c.board, part, verb, value,
  onProgramChange: (id, source) => saveMicrotronicProgram(c, id, source)});

test('Microtronic authored art, sidecar, registry and engine share eleven contacts', () => {
  const {sidecar, svg} = createMicrotronicConnectorAssets();
  assert.deepEqual(JSON.parse(read('../src/parts-data/busch-microtronic.json')), sidecar);
  assert.equal(read('../src/parts-data/busch-microtronic.svg'), svg);
  assert.deepEqual(getSidecar(sidecar.kind), sidecar);
  assert.ok(ART_FACE_KINDS.includes(sidecar.kind));
  assert.deepEqual(sidecar.terminals.map(t => t.name), MICROTRONIC_TERMINALS);
  assert.equal(sidecar.footprint, null);
  const offsets = artPinOffsets(sidecar);
  for (const pin of sidecar.terminals) {
    assert.match(svg, new RegExp(`data-terminal="${pin.name}"[^]*?<circle cx="${pin.x}" cy="${pin.y}"`));
    assert.deepEqual(offsets[pin.name], {dx: pin.x - sidecar.w/2, dy: pin.y - sidecar.h/2});
  }
  assert.deepEqual(MICROTRONIC_KEY_ROWS, [
    ['C','D','E','F','NEXT','REG'], ['8','9','A','B','BKP','STEP'],
    ['4','5','6','7','RUN','HALT'], ['0','1','2','3','C/CE','PGM'],
  ]);
});

test('Microtronic whole face stays selectable and fits narrow viewports when rotated and flipped', () => {
  for (const rotation of [0,45,90,180,270]) for (const flipped of [false,true]) {
    const part = {kind:'busch-microtronic', id:'micro', x:800,y:450,rotation,flipped};
    assert.deepEqual(footprintOf(part), {w:260,h:300});
    const bounds = partBounds(part);
    const hit = createHitTest(() => [part], () => [], () => []);
    const angle = rotation * Math.PI/180;
    const corners = [-129,129].flatMap(x => [-149,149].map(y => {
      const dx = x * (flipped ? -1 : 1);
      return {x:part.x + dx*Math.cos(angle)-y*Math.sin(angle), y:part.y+dx*Math.sin(angle)+y*Math.cos(angle)};
    }));
    for (const p of corners) assert.equal(hit.partAt(p.x,p.y), part.id);
    for (const viewport of [{w:354,h:568},{w:920,h:620}]) {
      const view = computeFitView([bounds],viewport);
      for (const p of corners) {
        const x=(p.x-view.pan.x)*view.zoom,y=(p.y-view.pan.y)*view.zoom;
        assert.ok(x>=0 && x<=viewport.w && y>=0 && y<=viewport.h);
      }
    }
  }
});

test('accepted program controls persist canonical source without replacing the active Board or resetting a run', () => {
  const {c,part}=make(); const board=c.board;
  control(c,part,'run'); c.advanceTo(400_000_000n);
  const before=board.getDeviceState(part.id), pc=before.pc, out=before.output;
  assert.equal(before.running,true); assert.ok(out>0);
  assert.equal(saveMicrotronicProgram(c,part.id,before.programSource),false);
  assert.equal(c.board,board); assert.equal(before.pc,pc); assert.equal(before.output,out);
  assert.equal(designerClockPlan({armedByFlag:{board,armed:classifyRunPins(c)},board,released:false}),'reuse');
  assert.deepEqual(classifyRunPins(c).outputPins, [], 'trainer is never an 8051 demo output');
  const restored=Circuit.fromJSON(JSON.parse(JSON.stringify(c.toJSON())));
  assert.deepEqual(restored.parts[0].terminals,MICROTRONIC_TERMINALS);
  assert.equal(restored.parts[0].params.program,before.programSource);
  assert.deepEqual(restored.board.getDeviceState(part.id).program,before.program);
});

test('keypad NEXT edits persist, undo restores the prior program, and invalid loads leave it intact', () => {
  const {c,part}=make('F00');
  for(const key of ['HALT','NEXT','0','5','1','A','2','NEXT']) control(c,part,'key',key);
  assert.equal(c.board.getDeviceState(part.id).program[5],0x1A2);
  assert.match(part.params.program,/05: 1A2/);
  const saved=JSON.parse(JSON.stringify(c.toJSON()));
  assert.equal(Circuit.fromJSON(saved).board.getDeviceState(part.id).program[5],0x1A2);
  const source=part.params.program;
  assert.throws(()=>control(c,part,'loadProgram','00: XYZ'));
  assert.equal(part.params.program,source);
  assert.equal(c.board.getDeviceState(part.id).program[5],0x1A2);
  assert.equal(c.undo(),true);
  assert.equal(c.board.getDeviceState(part.id).program[5],0xF00);
});

test('wired echo example conducts real switches and CLOCK into four physical LED circuits', () => {
  const fixture=microtronicDemoCircuit();
  const c=Circuit.fromJSON(fixture), part=c.getPart('microtronic');
  assert.equal(c.wires.length,fixture.wires.length,'no invalid terminals are discarded on load');
  c.setControl('input1',1); c.setControl('input3',1);
  control(c,part,'run'); c.advanceTo(400_000_000n);
  assert.equal(c.board.getDeviceState(part.id).input,5);
  assert.equal(c.board.getDeviceState(part.id).output,5);
  assert.ok(c.ledBrightness('lamp1')>0.01);
  assert.equal(c.ledBrightness('lamp2'),0);
  c.advanceTo(800_000_000n);
  assert.equal(c.board.getDeviceState(part.id).output,13);
  assert.ok(c.ledBrightness('lamp4')>0.01);
  control(c,part,'halt');
  const pc=c.board.getDeviceState(part.id).pc;
  c.advanceTo(1_400_000_000n);
  assert.equal(c.board.getDeviceState(part.id).pc,pc);
  assert.equal(c.board.getDeviceState(part.id).output,13,'HALT retains output while clock and input change');
  assert.equal(c.board.getDeviceState(part.id).input,5);
});

test('two trainers have independent program storage and controls', () => {
  const {c,part}=make();
  const other=c.addPart('busch-microtronic',{program:'1F0\nFE0\nF00',instructionHz:20},700,250);
  control(c,part,'run'); control(c,other,'step');
  c.advanceTo(400_000_000n);
  assert.equal(c.board.getDeviceState(other.id).pc,1);
  assert.equal(c.board.getDeviceState(other.id).running,false);
  assert.equal(c.board.getDeviceState(other.id).registers[0],15);
  assert.ok(c.board.getDeviceState(part.id).output>0);
  control(c,part,'loadProgram','1A0\nFE0');
  assert.equal(c.board.getDeviceState(other.id).registers[0],15);
  assert.equal(c.board.getDeviceState(other.id).pc,1);
  const duplicate=c.duplicatePart(part.id);
  assert.equal(duplicate.params.program,part.params.program);
  assert.equal(c.board.getDeviceState(duplicate.id).running,false);
});

test('front-panel keyboard commands are scoped and do not steal editing or held keys', () => {
  const key=(key,extra={})=>microtronicKeyboardKey({key,target:{tagName:'SECTION'},...extra},false);
  assert.equal(key('a'),'A'); assert.equal(key('Enter'),'NEXT'); assert.equal(key('Escape'),'HALT');
  assert.equal(key(' '),'RUN');
  assert.equal(key('A',{repeat:true}),null);
  assert.equal(key('A',{ctrlKey:true}),null);
  assert.equal(key('A',{target:{tagName:'TEXTAREA'}}),null);
  assert.equal(key('Enter',{target:{tagName:'BUTTON'}}),null);
});

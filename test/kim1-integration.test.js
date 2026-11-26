// SPDX-License-Identifier: MIT
import './_setup.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Circuit} from '../src/model/circuit.js';
import {KIM1_TERMINALS} from 'bw-board/devices/kim1.js';
import {peekKim1Byte} from 'bw-board/kim1-machine.js';
import {createKim1ConnectorAssets} from '../scripts/generate-kim1-connector.mjs';
import {getSidecar} from '../src/model/parts-registry.js';
import {ART_FACE_KINDS,artPinOffsets} from '../src/model/part-art.js';
import {createHitTest,footprintOf,partBounds} from '../src/interaction/hittest.js';
import {computeFitView} from '../src/interaction/transform.js';
import {classifyRunPins,designerClockPlan} from '../src/model/simulation.js';
import {KIM1_KEY_ROWS,kim1Control,saveKim1Program,kim1KeyboardKey} from '../src/model/kim1-controls.js';
import {KIM1_EXAMPLES,kim1DemoCircuit} from '../src/model/kim1-demo.js';

const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
const make=(program=KIM1_EXAMPLES[0].source)=>{
  const circuit=new Circuit(5);
  const part=circuit.addPart('kim-1',{program,clockHz:1000},350,250);
  return {circuit,part};
};
const command=(circuit,part,verb,value)=>kim1Control({board:circuit.board,part,verb,value,
  onProgramChange:(id,source)=>saveKim1Program(circuit,id,source)});

test('original KIM-1 art, sidecar, palette geometry and engine share all 17 terminals',()=>{
  const {sidecar,svg}=createKim1ConnectorAssets();
  assert.deepEqual(JSON.parse(read('../src/parts-data/kim-1.json')),sidecar);
  assert.equal(read('../src/parts-data/kim-1.svg'),svg);
  assert.deepEqual(getSidecar('kim-1'),sidecar);
  assert.ok(ART_FACE_KINDS.includes('kim-1'));
  assert.deepEqual(sidecar.terminals.map(t=>t.name),KIM1_TERMINALS);
  assert.equal(sidecar.terminals.length,17);
  assert.ok(!KIM1_TERMINALS.includes('PB6'));
  assert.equal(sidecar.footprint,null);
  const offsets=artPinOffsets(sidecar);
  for(const terminal of sidecar.terminals) {
    assert.ok(svg.includes('data-terminal="'+terminal.name+'"><circle cx="'+terminal.x+'" cy="'+terminal.y+'"'));
    assert.deepEqual(offsets[terminal.name],{dx:terminal.x-sidecar.w/2,dy:terminal.y-sidecar.h/2});
  }
  assert.deepEqual(KIM1_KEY_ROWS,[['AD','DA','PC','+'],['C','D','E','F'],['8','9','A','B'],['4','5','6','7'],['0','1','2','3']]);
});

test('whole KIM-1 face remains selectable and framed at rotated and narrow-view positions',()=>{
  for(const rotation of [0,45,90,180,270]) for(const flipped of [false,true]) {
    const part={id:'kim',kind:'kim-1',x:800,y:450,rotation,flipped};
    assert.deepEqual(footprintOf(part),{w:300,h:330});
    const bounds=partBounds(part),radians=rotation*Math.PI/180;
    const hit=createHitTest(()=>[part],()=>[],()=>[]);
    const corners=[-149,149].flatMap(x=>[-164,164].map(y=>{
      const dx=x*(flipped?-1:1);
      return {x:part.x+dx*Math.cos(radians)-y*Math.sin(radians),y:part.y+dx*Math.sin(radians)+y*Math.cos(radians)};
    }));
    for(const p of corners) assert.equal(hit.partAt(p.x,p.y),part.id);
    for(const viewport of [{w:354,h:568},{w:920,h:620}]) {
      const view=computeFitView([bounds],viewport);
      for(const p of corners) {
        const x=(p.x-view.pan.x)*view.zoom,y=(p.y-view.pan.y)*view.zoom;
        assert.ok(x>=0&&x<=viewport.w&&y>=0&&y<=viewport.h);
      }
    }
  }
});

test('GO uses the active Board and an authored NMOS program stores the expected value',()=>{
  const {circuit,part}=make('0200: A9 2A 8D 00 03 00');
  const board=circuit.board;
  command(circuit,part,'key','GO');
  circuit.advanceTo(100_000_000n);
  const state=board.getDeviceState(part.id);
  assert.equal(peekKim1Byte(state,0x0300),0x2a);
  assert.equal(state.running,false,'BRK returns to the independently written monitor');
  assert.equal(state.cpu.a,0x2a);
  assert.equal(circuit.board,board);
  assert.equal(designerClockPlan({armedByFlag:{board,armed:classifyRunPins(circuit)},board,released:false}),'reuse');
  assert.deepEqual(classifyRunPins(circuit).outputPins,[],'KIM-1 is not an illustrative 8051 MCU');
});

test('keypad memory edits persist; + preserves data mode and RS retains RAM',()=>{
  const {circuit,part}=make();
  for(const key of ['ST','AD','0','3','0','0','DA','4','2','+']) command(circuit,part,'key',key);
  let state=circuit.board.getDeviceState(part.id);
  assert.equal(peekKim1Byte(state,0x0300),0x42);
  assert.equal(state.address,0x0301);
  assert.equal(state.mode,'data');
  assert.match(part.params.program,/0300: 42/);
  command(circuit,part,'key','RS');
  state=circuit.board.getDeviceState(part.id);
  assert.equal(peekKim1Byte(state,0x0300),0x42);
  const saved=JSON.parse(JSON.stringify(circuit.toJSON()));
  const restored=Circuit.fromJSON(saved);
  assert.equal(peekKim1Byte(restored.board.getDeviceState(part.id),0x0300),0x42);
  assert.deepEqual(restored.parts[0].terminals,KIM1_TERMINALS);
  assert.equal(restored.parts[0].params.program,part.params.program);
});

test('keypad access reaches real I/O registers without adding them to the saved RAM image',()=>{
  const {circuit,part}=make('0200: EA');
  command(circuit,part,'loadProgram','0200: EA');
  const image=part.params.program;
  for(const key of ['AD','1','7','0','1','DA','F','F','AD','1','7','0','0','DA','A','5']) {
    command(circuit,part,'key',key);
  }
  const state=circuit.board.getDeviceState(part.id);
  assert.equal(state.ddrA,0xff);
  assert.equal(state.portA,0xa5);
  assert.equal(state.running,false);
  assert.equal(part.params.program,image);
  assert.equal(state.programSource,image);
});

test('single-step GO executes one instruction and PC returns to the stopped execution address',()=>{
  const {circuit,part}=make('0200: A9 2A A2 17 00');
  command(circuit,part,'setSst',true);
  let state=command(circuit,part,'key','GO');
  assert.equal(state.cpu.a,0x2a);
  assert.equal(state.pc,0x0202);
  assert.equal(state.running,false);
  for(const key of ['AD','0','3','0','0','PC']) state=command(circuit,part,'key',key);
  assert.equal(state.address,0x0202);
  state=command(circuit,part,'key','GO');
  assert.equal(state.cpu.x,0x17);
  assert.equal(state.pc,0x0204);
  state=command(circuit,part,'key','RS');
  assert.equal(state.singleStep,true,'reset retains the physical SST switch');
  state=command(circuit,part,'key','GO');
  assert.equal(state.pc,0x0202);
  assert.equal(state.running,false);
});

test('invalid program replacement is atomic and undo restores an accepted keypad edit',()=>{
  const {circuit,part}=make('0200: EA 4C 00 02');
  command(circuit,part,'loadProgram','0200: A9 42 00');
  const accepted=part.params.program;
  assert.throws(()=>command(circuit,part,'loadProgram','0200: GG'));
  assert.equal(part.params.program,accepted);
  assert.equal(peekKim1Byte(circuit.board.getDeviceState(part.id),0x0200),0xa9);
  for(const key of ['AD','0','3','0','0','DA','4','2']) command(circuit,part,'key',key);
  assert.equal(peekKim1Byte(circuit.board.getDeviceState(part.id),0x0300),0x42);
  assert.equal(circuit.undo(),true);
  assert.notEqual(peekKim1Byte(circuit.board.getDeviceState(part.id),0x0300),0x42);
});

test('wired switches reach port B and the running program drives external LEDs through port A',()=>{
  const data=kim1DemoCircuit(),circuit=Circuit.fromJSON(data),part=circuit.getPart('kim1');
  assert.equal(circuit.wires.length,data.wires.length);
  circuit.setControl('input0',1);circuit.setControl('input2',1);
  command(circuit,part,'key','GO');
  circuit.advanceTo(250_000_000n);
  let state=circuit.board.getDeviceState(part.id);
  assert.equal(state.portB&15,5);
  assert.equal(state.portA&15,5);
  assert.equal(state.ddrA,255);assert.equal(state.ddrB,0);
  assert.ok(circuit.ledBrightness('lamp0')>0.01);
  assert.equal(circuit.ledBrightness('lamp1'),0);
  assert.ok(circuit.ledBrightness('lamp2')>0.01);
  command(circuit,part,'key','ST');
  const pc=state.pc;
  circuit.setControl('input0',0);
  circuit.advanceTo(500_000_000n);
  state=circuit.board.getDeviceState(part.id);
  assert.equal(state.pc,pc);
  assert.equal(state.portA&15,5,'ST retains the output latch while external inputs change');
  assert.equal(state.portB&15,4);
});

test('two computers preserve independent memory, registers and accepted sources',()=>{
  const {circuit,part}=make('0200: A9 2A 00');
  const other=circuit.addPart('kim-1',{program:'0200: A9 17 00',clockHz:1000},700,250);
  command(circuit,part,'step');
  assert.equal(circuit.board.getDeviceState(part.id).cpu.a,0x2a);
  assert.equal(circuit.board.getDeviceState(other.id).cpu.a,0);
  command(circuit,other,'step');
  assert.equal(circuit.board.getDeviceState(other.id).cpu.a,0x17);
  command(circuit,part,'loadProgram','0200: A9 7F 00');
  assert.equal(circuit.board.getDeviceState(other.id).cpu.a,0x17);
  const duplicate=circuit.duplicatePart(part.id);
  assert.equal(duplicate.params.program,part.params.program);
  assert.equal(circuit.board.getDeviceState(duplicate.id).running,false);
});

test('keyboard commands do not steal editor input, held keys or native button activation',()=>{
  const key=(key,extra={})=>kim1KeyboardKey({key,target:{tagName:'SECTION'},...extra},false);
  assert.equal(key('a'),'A');assert.equal(key('Enter'),'+');assert.equal(key('Escape'),'ST');assert.equal(key(' '),'GO');
  assert.equal(key('A',{repeat:true}),null);assert.equal(key('A',{ctrlKey:true}),null);
  assert.equal(key('A',{target:{tagName:'TEXTAREA'}}),null);
  assert.equal(key('Enter',{target:{tagName:'BUTTON'}}),null);
  assert.equal(key('A',{target:{isContentEditable:true}}),null);
});

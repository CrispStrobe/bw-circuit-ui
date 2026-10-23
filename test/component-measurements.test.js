import './_setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Circuit} from '../src/model/circuit.js';
import {componentMeasurements,normalizeComponentLimits} from '../src/model/component-measurements.js';
function bench(open=false){
 const c=new Circuit(5),plus=c.addPart('vcc',{},0,0),minus=c.addPart('gnd',{},0,100),r=c.addPart('resistor',{ohms:100},100,0);
 c.addWire(plus.id,'vcc',r.id,'a');if(!open)c.addWire(minus.id,'gnd',r.id,'b');
 return {c,r};
}

test('actual resistor V/I/absorbed-power readings convert public OUT current explicitly',()=>{
 const {c,r}=bench();r.limits={powerWatts:.1,currentAmps:.02};
 const row=componentMeasurements(c.board,c.parts)[0];
 assert.equal(row.status,'measured');assert.ok(Math.abs(row.volts-5)<1e-8);
 assert.ok(Math.abs(row.currentAmps-.05)<1e-8);assert.ok(Math.abs(row.powerWatts-.25)<1e-8);
 assert.deepEqual(row.warnings,['power','current']);
 const reversed=componentMeasurements(c.board,[{...r,terminals:['b','a']}])[0];
 assert.ok(Math.abs(reversed.volts+5)<1e-8);assert.ok(Math.abs(reversed.currentAmps+.05)<1e-8);
 assert.ok(Math.abs(reversed.powerWatts-.25)<1e-8);
});

test('an open lead retains the actual zero current without inventing a voltage to ground',()=>{
 const {c}=bench(true);const row=componentMeasurements(c.board,c.parts)[0];
 assert.equal(row.status,'open');assert.ok(Math.abs(row.currentAmps)<1e-12);
 assert.equal(row.volts,null);assert.equal(row.powerWatts,null);
});

test('unrated parts do not inherit guessed LED or resistor ratings',()=>{
 const {c}=bench();const row=componentMeasurements(c.board,c.parts)[0];
 assert.equal(row.status,'measured');assert.deepEqual(row.warnings,[]);assert.deepEqual(row.limits,{});
});

test('ratings survive actual Circuit Save/Open and undo without altering electrical parameters or resetting the solver',()=>{
 const {c,r}=bench();const board=c.board;c.advanceTo(2_000_000n);const time=board.timeNs;
 c.setPartLimits(r.id,{powerWatts:.25,currentAmps:.1});
 assert.equal(c.board,board);assert.equal(board.timeNs,time);assert.deepEqual(r.params,{ohms:100});
 assert.deepEqual(Circuit.fromJSON(c.toJSON()).getPart(r.id).limits,{powerWatts:.25,currentAmps:.1});
 c.setPartLimits(r.id,{powerWatts:.5});c.undo();assert.equal(c.getPart(r.id).limits.powerWatts,.25);
 c.redo();assert.equal(c.getPart(r.id).limits.powerWatts,.5);
});

test('invalid limits are refused before changing the part, and blank clears a rating',()=>{
 const {c,r}=bench();
 for(const value of [0,-1,NaN,Infinity,'0.25'])assert.throws(()=>c.setPartLimits(r.id,{powerWatts:value}),/Invalid component limit/);
 assert.equal(r.limits,undefined);assert.deepEqual(normalizeComponentLimits({powerWatts:'',currentAmps:null}),{});
});

test('solver refusal and absent active-board identities cannot become plausible zero readings',()=>{
 const {c,r}=bench();
 let reads=0;
 const refused={transientAnalysisStatus:()=>({failure:'solver refused'}),getNets:()=>[],branchCurrent(){reads++;return 0;}};
 const row=componentMeasurements(refused,[r])[0];assert.equal(row.status,'unavailable');assert.equal(row.currentAmps,null);assert.equal(reads,0);
 const absent={getParts:()=>[],getNets:()=>[],branchCurrent(){reads++;return 0;}};
 assert.equal(componentMeasurements(absent,[r])[0].status,'unavailable');assert.equal(reads,0);
 assert.deepEqual(componentMeasurements(c.board,[{...r,kind:'unknown'}]),[]);
});

test('a supplying two-terminal voltage source reports delivered power with the opposite sign to its load',()=>{
 const c=new Circuit(5),g=c.addPart('gnd',{},0,0),s=c.addPart('vsource',{wave:'sine',freq:1000,amplitude:0,offset:5},0,0),r=c.addPart('resistor',{ohms:100},0,0);
 c.addWire(s.id,'pos',r.id,'a');c.addWire(r.id,'b',g.id,'gnd');c.addWire(s.id,'neg',g.id,'gnd');
 const rows=componentMeasurements(c.board,c.parts),source=rows.find(row=>row.id===s.id),load=rows.find(row=>row.id===r.id);
 assert.equal(source.status,'measured');assert.ok(source.powerWatts<0);assert.ok(load.powerWatts>0);
 assert.ok(Math.abs(source.powerWatts+load.powerWatts)<1e-9);
});

test('diagram annotations use the real readings and preserve unavailable values instead of drawing zero volts',async()=>{
 const {componentMeasurementAnnotations}=await import('../src/model/component-measurements.js');
 const {c,r}=bench(true);const rows=componentMeasurements(c.board,c.parts),text=componentMeasurementAnnotations(rows,c.parts).map(a=>a.text).join('\n');
 assert.match(text,/— V/);assert.match(text,/0 mA/);assert.match(text,/— mW/);
 const moved={...r,x:123,y:456};const annotations=componentMeasurementAnnotations(rows,[moved]);
 assert.equal(annotations[0].x,123);assert.equal(annotations[0].y,490);
 assert.deepEqual(normalizeComponentLimits(null),{});
});

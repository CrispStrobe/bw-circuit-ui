import './_setup.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {importCircuit} from '../src/importers/index.js';
import {Circuit} from '../src/model/circuit.js';
import {resolveEndpointNet} from '../src/model/instrument-report.js';
import {createMeterState,readMeter} from '../src/model/multimeter.js';
import {getMeterReading} from '../src/model/meter-reading.js';
import {verifyBoardProvenance} from '../scripts/board-provenance.mjs';

const CLI=join(import.meta.dirname,'../bin/bwc.mjs');
const duration=.007;

test('installed live exception invalidates shared panel, placeable UI meter and scope history without fabricating recovery', () => {
  const input = importCircuit('spice', '* live control fault\nV1 n 0 1\nVBAD 0 0 0\nR1 n 0 1k\n.end\n');
  assert.deepEqual(input.unmapped || [], []);
  const c = Circuit.fromJSON({ parts: input.parts, wires: input.wires });
  const placed = c.addPart('meter', { mode: 'voltage' }, 0, 0);
  c.addWire(placed.id, 'probe_a', 'V1', 'pos');
  c.addWire(placed.id, 'probe_b', 'V1', 'neg');
  assert.equal(c.netlistError, null); c.setPower(true);
  const voltage = voltageMeter(c), current = currentMeter();
  assert.equal(readMeter(voltage, c).siValue, 1);
  close(readMeter(current, c).siValue, -.001, 1e-12, 'load current');
  assert.equal(getMeterReading(placed, c.wires, c).value, '1.000');
  const h = c.board.addScopeChannel({ type: 'voltage', netId: voltage.probeA.netId, capture: 'sample', sampleRateHz: 1000, depth: 8 });
  c.advanceTo(1_000_000n);
  assert.throws(() => c.setControl('VBAD', 5), /inconsistent ideal voltage constraint VBAD/);
  for (const meter of [voltage, current]) {
    const reading = readMeter(meter, c);
    assert.equal(reading.value, '---'); assert.equal(reading.siValue, null);
    assert.match(reading.note, /^Cannot read (voltage|current)$/);
  }
  assert.equal(getMeterReading(placed, c.wires, c).value, '---');
  // No scope read while invalid: recovery cannot erase an unnoticed bad interval.
  c.setControl('VBAD', 0);
  assert.equal(readMeter(voltage, c).siValue, null, 'old DC mean is still unavailable');
  assert.throws(() => c.board.getScopeData(h), /scope capture refused:.*solve failed/);
  const fresh = createMeterState();
  fresh.probeA.netId = voltage.probeB.netId; fresh.probeB.netId = voltage.probeA.netId;
  assert.equal(readMeter(fresh, c).siValue, -1, 'new pair observes the recovered physical circuit');
});

test('installed Circuit exposes explicit unavailable native bench-meter state, not numeric zero or needle', () => {
  for (const kind of ['voltmeter', 'analog_meter', 'ammeter']) {
    const c = new Circuit(5);
    const a = c.addPart('vsource', { volts: 1 }, 0, 0);
    const b = c.addPart('vsource', { volts: 1 }, 0, 0);
    const g = c.addPart('gnd', {}, 0, 0), r = c.addPart('resistor', { ohms: 1000 }, 0, 0);
    const m = c.addPart(kind, {}, 0, 0);
    c.addWire(a.id, 'pos', b.id, 'pos'); c.addWire(a.id, 'pos', r.id, 'a');
    c.addWire(a.id, 'neg', b.id, 'neg'); c.addWire(a.id, 'neg', g.id, 'gnd');
    c.addWire(r.id, 'b', g.id, 'gnd');
    c.addWire(m.id, 'a', a.id, 'pos'); c.addWire(m.id, 'b', g.id, 'gnd');
    assert.equal(c.netlistError, null); c.setPower(true);
    const state = c.board.getDeviceState(m.id);
    assert.ok(state, `${kind} stays a native engine device`);
    assert.equal(state.available, false); assert.equal(state.reading, null);
    assert.match(state.measurementError, /solve failed/);
    if (kind === 'analog_meter') assert.equal(state.deflection, null);
    c.removePart(b.id);
    const recovered = c.board.getDeviceState(m.id);
    assert.equal(recovered.available, true, `${kind} recovers after removing the invalid source cycle`);
    assert.equal(recovered.measurementError, null);
    assert.ok(Number.isFinite(recovered.reading) && recovered.reading !== 0);
    c.setControl(a.id, 0);
    assert.equal(c.board.getDeviceState(m.id).available, true);
    assert.equal(c.board.getDeviceState(m.id).reading, 0, 'real zero is not unavailable');
    c.setControl(a.id, 1); c.setPower(false);
    assert.equal(c.board.getDeviceState(m.id).available, true);
    assert.equal(c.board.getDeviceState(m.id).reading, 0, 'power-off zero remains available');
  }
});

test('shared GUI meter model reports failed live solve unavailable, never fabricated voltage or load current zero', () => {
  for (const otherVolts of [1, 2]) {
    const imported = importCircuit('spice', `* failed live solve\nV1 n 0 1\nV2 n 0 ${otherVolts}\nR1 n 0 1k\n.end\n`);
    assert.deepEqual(imported.unmapped || [], []);
    const circuit = Circuit.fromJSON({ parts: imported.parts, wires: imported.wires });
    assert.equal(circuit.netlistError, null);
    circuit.setPower(true);
    for (const meter of [voltageMeter(circuit), currentMeter()]) {
      const reading = readMeter(meter, circuit);
      assert.equal(reading.value, '---');
      assert.equal(reading.siValue, null);
      assert.match(reading.note, /^Cannot read (voltage|current)$/);
    }
    assert.equal(circuit.board._meterWatches.size, 0, 'failed GUI primes install no numeric history');
  }
});
const ngspiceProbe=spawnSync('ngspice',['--version'],{encoding:'utf8'});
const cases=[
  {name:'sine',source:'SINE(2 1 250)',mean:2+(1-Math.cos(2*Math.PI*250*duration))/(2*Math.PI*250*duration)},
  {name:'pulse',source:'PULSE(0 5 1m 1m 1m 2m 10m)',mean:.015/duration},
];
const deck=c=>`* Independently authored meter integral ${c.name}\nV1 signal 0 ${c.source}\nR1 signal 0 1k\n.tran 1u 7m\n.end\n`;
function circuitFor(source) {
  const input=importCircuit('spice',source);
  for (const key of ['unmapped','losses','analysisBlockers']) assert.deepEqual(input[key]||[],[],key);
  const circuit=Circuit.fromJSON({parts:input.parts,wires:input.wires});
  assert.equal(circuit.netlistError,null);
  circuit.configureTransientAnalysis('precision-v1');
  circuit.setPower(true);
  return circuit;
}
function voltageMeter(circuit) {
  const meter=createMeterState();
  meter.probeA.netId=resolveEndpointNet(circuit.resolvedNets,'V1.pos');
  meter.probeB.netId=resolveEndpointNet(circuit.resolvedNets,'V1.neg');
  return meter;
}
function currentMeter() {
  const meter=createMeterState(); meter.mode='current';
  meter.probeA.partId='R1'; meter.probeA.terminal='a';
  return meter;
}
function close(actual,expected,tolerance,label) {
  assert.ok(Number.isFinite(actual),`${label}: finite observation required`);
  assert.ok(Math.abs(actual-expected)<=tolerance,`${label}: ${actual} vs ${expected}`);
}

test('meter integration uses the exact installed package, not a sibling checkout',()=>{
  const proof=verifyBoardProvenance({throwOnFailure:true});
  assert.equal(proof.qualified,true);
  assert.equal(proof.loaded.logicalIsSymlink,false);
  assert.equal(proof.declared.packageCommit,'944d1357e093fdb4c65bed65de378e1128dfc1ac');
});

test('installed Circuit shared meter model reports indeterminate source current unavailable without breaking valid meters',()=>{
  for(const live of [false,true]) for(const resistance of [0,10]) {
    const node=live?'n':'0';
    const imported=importCircuit('spice',`* current availability control\nVGOOD n 0 1\nRLOAD n 0 1k\nVZERO ${node} ${node} 0\n.end\n`);
    assert.deepEqual(imported.unmapped||[],[]);
    if(resistance) imported.parts.find(part=>part.id==='VZERO').params.rInternal=resistance;
    const circuit=Circuit.fromJSON({parts:imported.parts,wires:imported.wires});
    assert.equal(circuit.netlistError,null); circuit.setPower(true);
    const source=createMeterState(); source.mode='current'; source.probeA.partId='VZERO';
    const load=createMeterState(); load.mode='current'; load.probeA.partId='VGOOD'; load.probeA.terminal='pos';
    const voltage=createMeterState();
    voltage.probeA.netId=resolveEndpointNet(circuit.resolvedNets,'VGOOD.pos');
    voltage.probeB.netId=resolveEndpointNet(circuit.resolvedNets,'VGOOD.neg');
    for(const at of [0n,100_000n,1_000_000n]) {
      if(at) circuit.advanceTo(at);
      for(const terminal of ['pos','neg']) {
        source.probeA.terminal=terminal;
        const reading=readMeter(source,circuit);
        if(resistance){
          assert.equal(reading.note,null); assert.equal(Math.abs(reading.siValue),0,'determinate resistive zero is physical');
        }else{
          assert.equal(reading.value,'---'); assert.equal(reading.siValue,null);
          assert.equal(reading.note,'Cannot read current','indeterminate current must not become fabricated zero');
        }
      }
      const v=readMeter(voltage,circuit),i=readMeter(load,circuit);
      assert.equal(v.note,null); assert.equal(v.siValue,1);
      assert.equal(i.note,null); close(i.siValue,.001,1e-12,'unrelated load current');
    }
    circuit.setPower(false);
    for(const terminal of ['pos','neg']) {
      source.probeA.terminal=terminal;
      const reading=readMeter(source,circuit);
      assert.equal(reading.note,null); assert.equal(reading.siValue,0,'known powered-off zero remains available');
    }
  }
});

for(const c of cases) for(const stride of [7000000n,700000n,10000n]) {
  test(`actual Circuit and Instruments ${c.name} integral with ${stride} ns caller stride`,()=>{
    const circuit=circuitFor(deck(c));
    const voltage=voltageMeter(circuit),current=currentMeter();
    const first=readMeter(voltage,circuit);
    assert.equal(first.note,null);
    assert.equal(first.siValue,circuit.nodeVoltage(voltage.probeA.netId)-circuit.nodeVoltage(voltage.probeB.netId),
      'first API read remains instantaneous and starts the watch');
    assert.equal(readMeter(current,circuit).note,null);
    for(let t=stride;t<=7000000n;t+=stride) circuit.advanceTo(t);
    assert.equal(circuit.transientAnalysisStatus().accuracyMet,true);
    const v=readMeter(voltage,circuit),i=readMeter(current,circuit);
    assert.equal(v.note,null); assert.equal(i.note,null);
    close(v.siValue,c.mean,50e-6,'analytical voltage integral');
    close(i.siValue,-c.mean/1000,50e-9,'analytical signed OUT current integral');
  });
}

for(const c of cases) test(`CLI ${c.name} means agree with live ngspice and independent area`,{
  skip:ngspiceProbe.error || ngspiceProbe.status!==0
    ? `ngspice cannot execute (${ngspiceProbe.error?.code || ngspiceProbe.status}): no independent integral comparison ran` : false,
},()=>{
  const dir=mkdtempSync(join(tmpdir(),'cui-meter-integral-'));
  try {
    const file=join(dir,'capture.cir'); writeFileSync(file,deck(c));
    const result=spawnSync(process.execPath,[CLI,'measure',file,'--scope','V1.pos,V1.neg',
      '--meter','voltage:V1.pos,V1.neg','--meter','current:R1.a',
      '--profile','precision-v1','--initial','zero-state','--duration','7ms','--rate','100kHz','--json'],
      {encoding:'utf8',timeout:60000});
    assert.ifError(result.error);
    assert.equal(result.status,0,result.stderr);
    const report=JSON.parse(result.stdout);
    assert.equal(report.scope[0].summary.samples,700);
    assert.equal(report.transient.accuracyMet,true);
    assert.equal(report.transient.work.advances,1);
    assert.deepEqual(report.poweredMeterAcquisition,{quantity:'observed-dc-mean',
      startTimeSeconds:0,maximumWindowSeconds:.1,independentIntegralCertificate:false});
    writeFileSync(join(dir,'reference.cir'),`* Independent ngspice source reference\n`
      +`V1 signal 0 ${c.source}\nR1 signal 0 1k\n`
      +'.options reltol=1e-10 abstol=1e-14 vntol=1e-10 trtol=1\n'
      +'.control\nset wr_vecnames\nset wr_singlescale\ntran 1u 7m 0 100n\n'
      +'linearize v(signal)\nwrdata reference.csv v(signal)\n.endc\n.end\n');
    const oracle=spawnSync('ngspice',['-b','reference.cir'],{cwd:dir,encoding:'utf8',timeout:60000});
    assert.ifError(oracle.error);
    assert.equal(oracle.status,0,oracle.stderr||oracle.stdout);
    const points=readFileSync(join(dir,'reference.csv'),'utf8').trim().split('\n').slice(1)
      .map(line=>line.trim().split(/\s+/).map(Number));
    assert.equal(points.length,7001);
    close(points[0][0],0,1e-15,'oracle starts at zero');
    close(points.at(-1)[0],duration,1e-12,'oracle ends at capture end');
    let area=0;
    for(let n=1;n<points.length;n++) {
      const [ta,va]=points[n-1],[tb,vb]=points[n];
      assert.ok(tb>ta && Number.isFinite(va) && Number.isFinite(vb));
      area+=(tb-ta)*(va+vb)/2;
    }
    const referenceMean=area/duration;
    close(referenceMean,c.mean,1e-6,'ngspice area analytical control');
    close(report.meters[0].reading.siValue,referenceMean,50e-6,'CLI voltage vs oracle integral');
    close(report.meters[1].reading.siValue,-referenceMean/1000,50e-9,'CLI current vs independent resistor law');
    assert.ok(Math.abs(report.scope[0].summary.lastVolts-report.meters[0].reading.siValue)>.1,
      'endpoint-only read cannot pass as a mean');
    assert.throws(()=>close(report.meters[0].reading.siValue,referenceMean+.1,50e-6,'changed oracle'),
      /changed oracle/,'reference mutation is load-bearing');
  } finally {rmSync(dir,{recursive:true,force:true});}
});

const inductorDeck='* Independently authored ideal inductor\nI1 0 signal SINE(0 1m 250)\nL1 signal 0 1m\n.tran 1u 7m\n.end\n';
const inductorCurrentMean=(from,to)=>(Math.cos(2*Math.PI*250*from)-Math.cos(2*Math.PI*250*to))*.001/(2*Math.PI*250*(to-from));
const inductorVoltageMean=(from,to)=>1e-6*(Math.sin(2*Math.PI*250*to)-Math.sin(2*Math.PI*250*from))/(to-from);
function inductorMeters(circuit) {
  const voltage=createMeterState();
  voltage.probeA.netId=resolveEndpointNet(circuit.resolvedNets,'L1.a');
  voltage.probeB.netId=resolveEndpointNet(circuit.resolvedNets,'L1.b');
  const current=createMeterState(); current.mode='current';
  current.probeA.partId='L1'; current.probeA.terminal='a';
  return {voltage,current};
}
for(const stride of [7000000n,700000n,10000n]) {
  test(`imported analytic inductor Circuit/Instruments exact means at ${stride} ns stride`,()=>{
    const circuit=circuitFor(inductorDeck),{voltage,current}=inductorMeters(circuit);
    assert.equal(readMeter(voltage,circuit).siValue,circuit.nodeVoltage(voltage.probeA.netId)-circuit.nodeVoltage(voltage.probeB.netId));
    readMeter(current,circuit);
    for(let t=stride;t<=7000000n;t+=stride) circuit.advanceTo(t);
    assert.equal(circuit.transientAnalysisStatus().integrationMode,'source-constrained-inductor-direct');
    assert.equal(circuit.transientAnalysisStatus().work.solves,0);
    const v=readMeter(voltage,circuit),i=readMeter(current,circuit);
    assert.equal(v.note,null); assert.equal(i.note,null);
    close(v.siValue,inductorVoltageMean(0,.007),1e-12,'analytic inductor voltage mean');
    close(i.siValue,-inductorCurrentMean(0,.007),1e-12,'analytic inductor signed OUT mean');
  });
}
test('imported analytic inductor clips dense compacted history and refuses a parameter jump',()=>{
  const circuit=circuitFor(inductorDeck),{voltage,current}=inductorMeters(circuit);
  readMeter(voltage,circuit); readMeter(current,circuit);
  for(let k=1;k<=1350;k++) {
    circuit.advanceTo(BigInt(k)*100000n); readMeter(current,circuit);
    assert.ok([...circuit.board._meterWatches.values()].every(w=>w.hist.length===2));
  }
  close(readMeter(voltage,circuit).siValue,inductorVoltageMean(.035,.135),1e-12,'clipped voltage');
  close(readMeter(current,circuit).siValue,-inductorCurrentMean(.035,.135),1e-12,'clipped signed current');
  circuit.board.setPartParam('I1','amplitude',.002);
  assert.throws(()=>circuit.meterVoltage(voltage.probeA.netId,voltage.probeB.netId),/parameter-edit-unqualified/);
  assert.throws(()=>circuit.meterCurrent('L1','a'),/parameter-edit-unqualified/);
});
test('imported Circuit and Instruments bound actual analytic history reads at 700 watch ticks',()=>{
  const circuit=circuitFor(inductorDeck),{voltage,current}=inductorMeters(circuit);
  readMeter(voltage,circuit); readMeter(current,circuit);
  let indexedReads=0;
  for(let k=1;k<=700;k++) {
    circuit.advanceTo(BigInt(k)*10000n);
    for(const w of circuit.board._meterWatches.values()) {
      assert.equal(w.hist.length,2,'retain only support and current analytic endpoints');
      const original=w.hist;
      w.hist=new Proxy(original,{get(target,key,receiver){
        if(typeof key==='string' && /^\d+$/.test(key)) indexedReads++;
        return Reflect.get(target,key,receiver);
      }});
      try {
        const reading=readMeter(w.kind==='v'?voltage:current,circuit);
        assert.equal(reading.note,null);
        close(reading.siValue,w.kind==='v'?inductorVoltageMean(0,k*1e-5):-inductorCurrentMean(0,k*1e-5),
          1e-12,'actual compacted Instruments mean');
      } finally {w.hist=original;}
    }
  }
  assert.ok(indexedReads<=700*2*8,`${indexedReads} indexed reads exceed bounded per-tick work`);
});
test('imported power-on at zero preserves the past off interval despite equal endpoint values',()=>{
  const circuit=circuitFor(inductorDeck.replace('SINE(0 1m 250)','SINE(1m 1m 250 0 0 270)'));
  const {current}=inductorMeters(circuit); readMeter(current,circuit);
  circuit.setPower(false); circuit.advanceTo(4000000n); circuit.setPower(true);
  const w=[...circuit.board._meterWatches.values()][0];
  assert.ok(w.hist.at(-1).before===0 && w.hist.at(-1).v===0,'zero-valued power boundary');
  circuit.advanceTo(5000000n);
  const omega=2*Math.PI*250;
  const area=.001*.001-.001*(Math.sin(omega*.005)-Math.sin(omega*.004))/omega;
  close(readMeter(current,circuit).siValue,-area/.005,1e-12,'retain off area, not phantom powered area');
  assert.equal(w.hist.length,3);
});
test('meter-only CLI uses the exact analytic inductor route and preserves signed polarity',()=>{
  const dir=mkdtempSync(join(tmpdir(),'cui-inductor-cli-'));
  try {
    const file=join(dir,'capture.cir'); writeFileSync(file,inductorDeck);
    const result=spawnSync(process.execPath,[CLI,'measure',file,'--meter','voltage:L1.a,L1.b',
      '--meter','voltage:L1.b,L1.a','--meter','current:L1.a','--meter','current:L1.b',
      '--profile','interactive-v1','--duration','7ms','--rate','1kHz','--json'],
      {encoding:'utf8',timeout:30000});
    assert.ifError(result.error); assert.equal(result.status,0,result.stderr);
    const report=JSON.parse(result.stdout);
    assert.deepEqual(report.scope,[]);
    assert.equal(report.transient.integrationMode,'source-constrained-inductor-direct');
    assert.equal(report.transient.profile.id,'interactive-v1');
    assert.equal(report.transient.accuracyMet,true); assert.equal(report.transient.work.solves,0);
    assert.equal(report.transient.work.advances,1);
    assert.equal(report.poweredMeterAcquisition.independentIntegralCertificate,false);
    const expected=[inductorVoltageMean(0,.007),-inductorVoltageMean(0,.007),
      -inductorCurrentMean(0,.007),inductorCurrentMean(0,.007)];
    assert.equal(report.meters.length,4);
    for(let k=0;k<4;k++) {
      assert.equal(report.meters[k].reading.note,null);
      close(report.meters[k].reading.siValue,expected[k],1e-12,`CLI meter ${k}`);
    }
    const watch=spawnSync(process.execPath,[CLI,'measure',file,'--meter','voltage:L1.a,L1.b',
      '--meter','current:L1.a','--duration','7ms','--rate','100kHz','--watch'],
      {encoding:'utf8',timeout:30000});
    assert.ifError(watch.error); assert.equal(watch.status,0,watch.stderr);
    const records=watch.stdout.trim().split('\n').map(line=>JSON.parse(line));
    assert.equal(records.length,701); assert.equal(records.at(-1).recordType,'summary');
    const rows=records.filter(row=>row.recordType==='sample');
    assert.equal(rows.length,700);
    for(let k=0;k<rows.length;k++) {
      const time=(k+1)/100000;
      close(rows[k].meters[0].reading.siValue,inductorVoltageMean(0,time),1e-12,'watched voltage mean');
      close(rows[k].meters[1].reading.siValue,-inductorCurrentMean(0,time),1e-12,'watched signed mean');
    }
    const refused=spawnSync(process.execPath,[CLI,'measure',file,'--meter','current:L1.a',
      '--profile','precision-v1','--initial','zero-state','--duration','7ms','--rate','1kHz','--json'],
      {encoding:'utf8',timeout:30000});
    assert.ifError(refused.error); assert.equal(refused.status,2); assert.equal(refused.stdout,'');
    assert.match(refused.stderr,/precision batch requires 1 to 4 scope channels/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('meter-only CLI inductor means match a separate live ngspice deck',{
  skip:ngspiceProbe.error || ngspiceProbe.status!==0 ? 'ngspice unavailable: no independent inductor comparison ran' : false,
},()=>{
  const dir=mkdtempSync(join(tmpdir(),'cui-inductor-oracle-'));
  try {
    const file=join(dir,'capture.cir'); writeFileSync(file,inductorDeck);
    const result=spawnSync(process.execPath,[CLI,'measure',file,'--meter','voltage:L1.a,L1.b',
      '--meter','current:L1.a','--duration','7ms','--rate','1kHz','--json'],{encoding:'utf8',timeout:30000});
    assert.ifError(result.error); assert.equal(result.status,0,result.stderr);
    const report=JSON.parse(result.stdout);
    writeFileSync(join(dir,'reference.cir'),`Independent ideal inductor reference
I1 0 a SIN(0 0.001 250)
L1 a 0 0.001
.control
set numdgt=15
set wr_singlescale
set wr_vecnames
tran 1u 7m 0 100n
linearize v(a) i(L1)
wrdata reference.csv v(a) i(L1)
quit
.endc
.end
`);
    const oracle=spawnSync('ngspice',['-b','reference.cir'],{cwd:dir,encoding:'utf8',timeout:30000});
    assert.ifError(oracle.error); assert.equal(oracle.status,0,oracle.stderr);
    const rows=readFileSync(join(dir,'reference.csv'),'utf8').trim().split('\n').slice(1)
      .map(line=>line.trim().split(/\s+/).map(Number));
    assert.equal(rows.length,7001); close(rows[0][0],0,1e-15,'oracle start');
    close(rows.at(-1)[0],.007,1e-12,'oracle end');
    let volts=0,amps=0;
    for(let k=1;k<rows.length;k++) {
      assert.ok(rows[k].every(Number.isFinite) && rows[k][0]>rows[k-1][0]);
      const d=rows[k][0]-rows[k-1][0];
      volts+=d*(rows[k][1]+rows[k-1][1])/2;
      amps+=d*(rows[k][2]+rows[k-1][2])/2;
    }
    volts/=.007; amps/=.007;
    // The oracle's DC initialization makes v(L) at t=0 zero, not the right
    // sine derivative: explicitly budget its first 1 us quadrature segment.
    const voltageTolerance=.5*1e-6*(.001*.001*2*Math.PI*250)/.007+2e-9;
    close(volts,inductorVoltageMean(0,.007),voltageTolerance,'oracle voltage area control');
    close(amps,inductorCurrentMean(0,.007),1e-9,'oracle current area control');
    close(report.meters[0].reading.siValue,volts,voltageTolerance,'CLI voltage vs independent oracle');
    close(report.meters[1].reading.siValue,-amps,1e-9,'CLI signed current vs independent oracle');
    assert.throws(()=>close(report.meters[1].reading.siValue,-amps+.0001,1e-9,'changed oracle'),/changed oracle/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('powered batch cannot silently outlive the meter watch',()=>{
  const result=spawnSync(process.execPath,[CLI,'measure',join(import.meta.dirname,'fixtures/cli-measure-sine.cir'),
    '--scope','V1.pos,V1.neg','--meter','voltage:V1.pos,V1.neg','--duration','3s','--rate','1Hz','--json'],
    {encoding:'utf8',timeout:10000});
  assert.ifError(result.error);
  assert.equal(result.status,2); assert.equal(result.stdout,'');
  assert.match(result.stderr,/2 s watch lifetime; use --watch/);
});

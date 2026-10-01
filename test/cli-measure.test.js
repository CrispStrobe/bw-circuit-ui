import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  compareExpectedWaveforms, parseExpectedWaveforms, parseMeterSpec, parseScaledNumber,
  parseExpectedMeters, createExpectedMeterComparison,
  parseScopeSpec, resolveEndpointNet, summarizeScope, timedScopeSeries, latestTimedScopeSample,
  measurementSampleClock,
  validatePrecisionCaptureInput, precisionCaptureBudget, validatePrecisionCaptureWork,
  validatePrecisionVoltageTopology,
} from '../src/model/instrument-report.js';

const ROOT = join(import.meta.dirname, '..');
const CLI = join(ROOT, 'bin', 'bwc.mjs');
const FIXTURE = join(import.meta.dirname, 'fixtures', 'cli-measure-divider.json');
const SINE_FIXTURE = join(import.meta.dirname, 'fixtures', 'cli-measure-sine.cir');
const PROBE_FIXTURE = join(import.meta.dirname,'fixtures','cli-measure-probe.cir');

test('precision capture input and cumulative work policies refuse unsupported authority', () => {
  const profile = {id:'precision-v1',maxAttempts:20000,maxStepSec:1e-5};
  const clock = measurementSampleClock(.0002,2e6);
  const budget = precisionCaptureBudget(clock,profile,3);
  assert.equal(budget.maxAttempts,20000);
  assert.equal(budget.maxSolves,60001);
  assert.equal(budget.maxAdvances,1);
  assert.equal(budget.minimumAdaptiveAttempts,400);
  validatePrecisionCaptureInput([{id:'C1',kind:'capacitor',params:{farads:1e-9}}],1,[]);
  for (const kind of ['555','mcu','opamp','led','unknown']) {
    assert.throws(() => validatePrecisionCaptureInput([{id:'unsupported',kind}],1,[]),
      /refuses part unsupported/);
  }
  assert.throws(() => validatePrecisionCaptureInput(Array(33).fill({kind:'resistor'}),1,[]),/32 parts/);
  for (const count of [0,5]) assert.throws(() => validatePrecisionCaptureInput([],count,[]),/1 to 4 scope/);
  assert.throws(() => validatePrecisionCaptureInput([],1,['resistance']),/second advance/);
  assert.throws(() => validatePrecisionCaptureInput([],1,Array(9).fill('voltage')),/at most 8/);
  assert.throws(() => validatePrecisionCaptureInput([{id:'V1',kind:'vsource',params:{wave:'spice-pwl'}}],1,[]),/waveform spice-pwl/);
  assert.throws(() => validatePrecisionCaptureInput([{id:'C1',kind:'capacitor',params:{initialVoltage:0}}],1,[]),/initial conditions/);
  assert.throws(() => validatePrecisionCaptureInput([{id:'R1',kind:'resistor',analysisBlockers:[{}]}],1,[]),/analysis blockers/);
  assert.throws(() => precisionCaptureBudget(clock,profile,33),/32 nets/);
  assert.throws(() => precisionCaptureBudget(clock,{...profile,id:'interactive-v1'},3),/bounded precision/);
  assert.throws(() => precisionCaptureBudget(clock,{...profile,maxAttempts:20001},3),/bounded precision/);
  assert.throws(() => precisionCaptureBudget(measurementSampleClock(.201,1000),profile,3),/preflight needs 20100/);
  assert.throws(() => precisionCaptureBudget(measurementSampleClock(.0100005,2e6),profile,3),/preflight needs 20001/);
  const good = {profile,work:{attempts:2440,solves:7310,advances:1},accuracyMet:true,failure:null};
  validatePrecisionCaptureWork(good,budget);
  for (const [key,value] of [['attempts',20001],['solves',60002],['advances',2]]) {
    assert.throws(() => validatePrecisionCaptureWork({...good,work:{...good.work,[key]:value}},budget),/whole-capture work/);
  }
  for (const value of [-1,NaN,Infinity,.5]) {
    assert.throws(() => validatePrecisionCaptureWork({...good,work:{...good.work,attempts:value}},budget),/invalid work/);
  }
  for (const accuracyMet of [false,null]) assert.throws(() => validatePrecisionCaptureWork({...good,accuracyMet},budget),/did not qualify/);
  assert.throws(() => validatePrecisionCaptureWork({...good,failure:{code:'minimum-step-accuracy-unmet'}},budget),/minimum-step/);
  assert.throws(() => validatePrecisionCaptureWork({...good,profile:{id:'interactive-v1'}},budget),/profile changed/);
});

test('precision CLI refuses absent initialization, streaming and budget/domain escapes', () => {
  const base = [CLI,'measure',PROBE_FIXTURE,'--scope','R2.a,V1.neg','--profile','precision-v1','--json'];
  for (const [extra,reason] of [
    [[],/requires --initial zero-state/],
    [['--initial','dc-operating-point'],/requires --initial zero-state/],
    [['--initial','zero-state','--watch'],/refuses --watch/],
    [['--initial','zero-state','--meter','resistance:R1.a,R1.b'],/second advance/],
    [['--initial','zero-state','--duration','201ms','--rate','1kHz'],/preflight needs 20100/],
  ]) {
    const result = spawnSync(process.execPath,[...base,...extra],{encoding:'utf8',timeout:15000});
    assert.equal(result.status,2,result.stderr);
    assert.equal(result.stdout,'');
    assert.match(result.stderr,reason);
  }
  const dir = mkdtempSync(join(tmpdir(),'bwc-precision-refusal-'));
  try {
    const file = join(dir,'unsupported.json');
    writeFileSync(file,JSON.stringify({parts:[{id:'timer',kind:'555',params:{}}],wires:[]}));
    const result = spawnSync(process.execPath,[CLI,'measure',file,'--scope','timer.out',
      '--profile','precision-v1','--initial','zero-state','--json'],{encoding:'utf8',timeout:15000});
    assert.equal(result.status,2);
    assert.equal(result.stdout,'');
    assert.match(result.stderr,/refuses part timer \(555\)/);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('precision CLI refuses a real attempt-cap hit before writing JSON or CSV', () => {
  const dir = mkdtempSync(join(tmpdir(),'bwc-precision-cap-'));
  try {
    const file = join(dir,'budget.cir'), csv = join(dir,'capture.csv');
    writeFileSync(file,'Self-authored bounded attempt-cap fixture\n'
      + 'V1 in 0 PULSE(0 1 0 20p 20p 400p 1n)\nR1 in 0 1k\n.tran 1n 10u UIC\n.end\n');
    const result = spawnSync(process.execPath,[CLI,'measure',file,'--scope','V1.pos,V1.neg',
      '--profile','precision-v1','--initial','zero-state','--duration','10us','--rate','1MHz',
      '--json','--csv',csv],{encoding:'utf8',timeout:30000});
    assert.equal(result.status,2,result.stderr || result.stdout);
    assert.equal(result.stdout,'');
    assert.match(result.stderr,/did not qualify: step-attempt-budget-exceeded/);
    assert.throws(() => readFileSync(csv),/ENOENT/,'no apparently qualified partial CSV');
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('precision CLI refuses a source constraint omitted by legacy convergence', () => {
  const dir = mkdtempSync(join(tmpdir(),'bwc-precision-source-'));
  try {
    const file = join(dir,'conflict.cir');
    writeFileSync(file,'Contradictory grounded source\nV1 0 0 1\nV2 n 0 1\nR1 n 0 1k\n.end\n');
    const result = spawnSync(process.execPath,[CLI,'measure',file,'--scope','V2.pos,V2.neg',
      '--profile','precision-v1','--initial','zero-state','--json'],{encoding:'utf8',timeout:15000});
    assert.equal(result.status,2,result.stderr || result.stdout);
    assert.equal(result.stdout,'');
    assert.match(result.stderr,/ideal voltage constraint cycle at V1/);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('precision CLI refuses a delayed grounded waveform before time-zero admission can miss it', () => {
  const dir = mkdtempSync(join(tmpdir(),'bwc-precision-delayed-source-'));
  try {
    const file = join(dir,'delayed.cir');
    writeFileSync(file,'Delayed contradictory grounded source\n'
      + 'V1 0 0 PULSE(0 1 1u 1u 1u 2u 10u)\nV2 n 0 1\nR1 n 0 1k\n.end\n');
    const result = spawnSync(process.execPath,[CLI,'measure',file,'--scope','V2.pos,V2.neg',
      '--profile','precision-v1','--initial','zero-state','--duration','10us','--rate','1MHz',
      '--json'],{encoding:'utf8',timeout:15000});
    assert.equal(result.status,2,result.stderr || result.stdout);
    assert.equal(result.stdout,'');
    assert.match(result.stderr,/ideal voltage constraint cycle at V1/);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('precision voltage topology rejects delayed contradictions but preserves explicit DC zero shorts', () => {
  const nets = [
    {id:'zero',terminals:[{part:'G1',terminal:'gnd'},{part:'V1',terminal:'neg'},{part:'V1',terminal:'pos'}]},
  ];
  const ground = {id:'G1',kind:'gnd'};
  validatePrecisionVoltageTopology([ground,{id:'V1',kind:'vsource',params:{volts:0}}],nets);
  for (const params of [{volts:1},{wave:'spice-pulse',v1:0,v2:1}]) {
    assert.throws(() => validatePrecisionVoltageTopology([ground,{id:'V1',kind:'vsource',params}],nets),/cycle at V1/);
  }
  const separateGroundNets = [
    {id:'a',terminals:[{part:'G1',terminal:'gnd'},{part:'V1',terminal:'pos'}]},
    {id:'b',terminals:[{part:'G2',terminal:'gnd'},{part:'V1',terminal:'neg'}]},
  ];
  assert.throws(() => validatePrecisionVoltageTopology([ground,{id:'G2',kind:'gnd'},
    {id:'V1',kind:'vsource',params:{volts:1}}],separateGroundNets),/cycle at V1/);
  assert.throws(() => validatePrecisionVoltageTopology([ground,
    {id:'E1',kind:'vcvs',params:{gain:1}}],
    [{id:'zero',terminals:[{part:'G1',terminal:'gnd'},{part:'E1',terminal:'outp'},{part:'E1',terminal:'outn'}]}]),/cycle at E1/);
  const parallel = [
    {id:'positive',terminals:[{part:'V1',terminal:'pos'},{part:'V2',terminal:'pos'}]},
    {id:'negative',terminals:[{part:'V1',terminal:'neg'},{part:'V2',terminal:'neg'}]},
  ];
  assert.throws(() => validatePrecisionVoltageTopology([
    {id:'V1',kind:'vsource',params:{volts:1}},{id:'V2',kind:'vsource',params:{volts:1}}],parallel),/cycle at V2/);
});

test('precision CLI preserves the real redundant DC zero short control', () => {
  const dir = mkdtempSync(join(tmpdir(),'bwc-precision-zero-short-'));
  try {
    const file = join(dir,'zero.cir');
    writeFileSync(file,'Valid redundant DC zero short\nV1 0 0 0\nV2 n 0 1\nR1 n 0 1k\n.end\n');
    const result = spawnSync(process.execPath,[CLI,'measure',file,'--scope','V2.pos,V2.neg',
      '--profile','precision-v1','--initial','zero-state','--json'],{encoding:'utf8',timeout:15000});
    assert.equal(result.status,0,result.stderr);
    assert.equal(JSON.parse(result.stdout).scope[0].summary.lastVolts,1);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('precision native admission refuses current-limited source state outside its domain', () => {
  const dir = mkdtempSync(join(tmpdir(),'bwc-precision-current-limit-'));
  try {
    const file = join(dir,'limited.json');
    writeFileSync(file,JSON.stringify({parts:[
      {id:'V1',kind:'vsource',params:{volts:1,iLimit:.001}},
      {id:'R1',kind:'resistor',params:{ohms:1}}, {id:'G',kind:'gnd',params:{}},
    ],wires:[
      {from:'V1',fromTerminal:'pos',to:'R1',toTerminal:'a'},
      {from:'V1',fromTerminal:'neg',to:'R1',toTerminal:'b'},
      {from:'V1',fromTerminal:'neg',to:'G',toTerminal:'gnd'},
    ]}));
    const result = spawnSync(process.execPath,[CLI,'measure',file,'--scope','V1.pos,V1.neg',
      '--profile','precision-v1','--initial','zero-state','--json'],{encoding:'utf8',timeout:15000});
    assert.equal(result.status,2,result.stderr || result.stdout);
    assert.equal(result.stdout,'');
    assert.match(result.stderr,/unsupported current-limited source V1/);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('precision native admission does not apply its DC bias to zero-state storage', () => {
  const dir = mkdtempSync(join(tmpdir(),'bwc-zero-state-'));
  try {
    const file = join(dir,'step.cir'), csv = join(dir,'capture.csv');
    writeFileSync(file,'Explicit zero-state RC step\nV1 in 0 1\nR1 in out 1k\nC1 out 0 1n\n.tran 500n 3u UIC\n.end\n');
    const result = spawnSync(process.execPath,[CLI,'measure',file,'--scope','C1.a,V1.neg',
      '--profile','precision-v1','--initial','zero-state','--duration','3us','--rate','2MHz',
      '--json','--csv',csv],{encoding:'utf8',timeout:30000});
    assert.equal(result.status,0,result.stderr);
    const report = JSON.parse(result.stdout);
    assert.match(report.precisionCapture.admission,/bias-not-adopted/);
    const rows = readFileSync(csv,'utf8').trim().split('\n').slice(2).map(row => row.split(',').map(Number));
    assert.equal(rows.length,6);
    rows.forEach(row => {
      const time = row[0]+report.scope[0].startTimeSeconds;
      assert.ok(Math.abs(row[1]-(1-Math.exp(-time/1e-6)))<=1e-6,
        `zero-state step at ${time}s, not the 1 V DC bias`);
    });
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

const ngspicePresent = spawnSync('ngspice',['--version'],{encoding:'utf8'}).status===0;
for (const [probe,ohms,farads] of [['10x',1e7,15e-12],['1x',1e6,100e-12]]) {
  test(`precision CLI ${probe} compares all 400 samples to live ngspice and analytical RC response`, {
    skip:ngspicePresent?false:'ngspice unavailable: no independent precision CLI comparison ran',
  }, () => {
    const dir = mkdtempSync(join(tmpdir(),'bwc-precision-probe-'));
    try {
      writeFileSync(join(dir,'reference.cir'),'* Independent explicit probe load\n'
        + 'V1 signal 0 PULSE(0 1 10u 20u 20u 50u 200u)\nR1 signal sense 100k\nR2 sense 0 1meg\n'
        + `RP sense 0 ${ohms}\nCP sense 0 ${farads}\n`
        + '.options reltol=1e-10 abstol=1e-14 vntol=1e-10 trtol=1\n.control\n'
        + 'set wr_vecnames\nset wr_singlescale\ntran 500n 200u 0 1n\nlinearize v(sense)\n'
        + 'wrdata reference.csv time v(sense)\n.endc\n.end\n');
      const oracle = spawnSync('ngspice',['-b','reference.cir'],{cwd:dir,encoding:'utf8',timeout:60000});
      assert.equal(oracle.status,0,oracle.stderr || oracle.stdout);
      const rows = readFileSync(join(dir,'reference.csv'),'utf8').trim().split('\n').slice(1)
        .map(line => line.trim().split(/\s+/).map(Number));
      assert.ok(rows.every(row => row.length>=2 && row.every(Number.isFinite)));
      const samples = rows.filter(row => row[0]>0).map(row => ({timeSeconds:row[0],volts:row.at(-1)}));
      assert.equal(samples.length,400);
      const parallel = 1/(1/1e6+1/ohms), gain = parallel/(1e5+parallel), tau = gain*1e5*farads;
      for (const point of samples) {
        const closed = gain * [[10e-6,50000],[30e-6,-50000],[80e-6,-50000],[100e-6,50000]]
          .reduce((sum,[start,slope]) => {
            const dt = Math.max(0,point.timeSeconds-start);
            return sum+slope*(dt+tau*Math.expm1(-dt/tau));
          },0);
        assert.ok(Math.abs(point.volts-closed)<=1e-6,'independent oracle analytical control');
      }
      const expect = join(dir,'expected.json'), csv = join(dir,'capture.csv');
      const reference = {schemaVersion:1,provenance:{kind:'live-ngspice-explicit-probe'},
        traces:[{tip:'R2.a',reference:'V1.neg',samples}]};
      writeFileSync(expect,JSON.stringify(reference));
      const args = [CLI,'measure',PROBE_FIXTURE,'--scope','R2.a,V1.neg','--probe',probe,
        '--duration','200us','--rate','2MHz','--profile','precision-v1','--initial','zero-state',
        '--expect',expect,'--csv',csv,'--json'];
      const result = spawnSync(process.execPath,args,{encoding:'utf8',timeout:30000});
      assert.equal(result.status,0,result.stderr || result.stdout);
      const report = JSON.parse(result.stdout);
      assert.equal(report.transient.profile.id,'precision-v1');
      assert.equal(report.transient.accuracyMet,true);
      assert.equal(report.transient.work.advances,1);
      assert.equal(report.precisionCapture.initialization,'zero-state-no-dc-operating-point');
      assert.equal(report.precisionCapture.maxSolves,60001);
      assert.equal(report.scope[0].summary.samples,400);
      assert.equal(report.comparison.status,'pass');
      assert.equal(report.comparison.counts.compared,400);
      assert.equal(report.claims.independentOracle,false,'reference agreement is not a blanket simulator certificate');
      const csvText = readFileSync(csv,'utf8');
      assert.match(csvText,/startTimeNs=500 sampleIntervalNs=500 points=400/);
      const captured = csvText.trim().split('\n').slice(2)
        .map(line => line.split(',').map(Number));
      assert.equal(captured.length,400);
      captured.forEach((row,index) => {
        assert.ok(Math.abs(row[0]+report.scope[0].startTimeSeconds-samples[index].timeSeconds)<=1e-12);
        assert.ok(Math.abs(row[1]-samples[index].volts)<=1e-6+1e-6*Math.abs(samples[index].volts));
      });
      reference.traces[0].samples[123].volts+=.01;
      writeFileSync(expect,JSON.stringify(reference));
      const mutant = spawnSync(process.execPath,args,{encoding:'utf8',timeout:30000});
      assert.equal(mutant.status,1,mutant.stderr);
      assert.equal(JSON.parse(mutant.stdout).comparison.status,'fail');
    } finally { rmSync(dir,{recursive:true,force:true}); }
  });
}

test('capture bounds use the actual rounded clock, including the exact ceiling', () => {
  assert.deepEqual(measurementSampleClock(.002,1998003),{
    durationNs:2000000n,intervalNs:500n,captureSamples:4000,effectiveRateHz:2000000 });
  assert.equal(measurementSampleClock(.1,2000000).captureSamples,200000);
  assert.throws(() => measurementSampleClock(.1000005,2000000),/produces 200001 samples/);
  assert.throws(() => measurementSampleClock(200000 / 1998003,1998003),/produces 200199 samples/);
  assert.throws(() => measurementSampleClock(.1e-9,100000),/rounds to zero/);
});

test('CLI refuses clock-derived overflow and zero duration before simulation', () => {
  for (const [duration,rate,reason] of [
    [String(200000 / 1998003),'1998003',/rounded sample clock produces 200199 samples/],
    ['0.1ns','100kHz',/duration rounds to zero/],
  ]) {
    const result = spawnSync(process.execPath,[CLI,'measure',FIXTURE,'--scope','RT.b,GND.gnd',
      '--duration',duration,'--rate',rate,'--json'],{encoding:'utf8'});
    assert.equal(result.status,2);
    assert.equal(result.stdout,'');
    assert.match(result.stderr,reason);
  }
});

test('non-divisor-rate captures retain every point and disclose the actual clock', () => {
  const dir = mkdtempSync(join(tmpdir(),'bwc-rounded-clock-'));
  const csv = join(dir,'capture.csv');
  const args = [CLI,'measure',FIXTURE,'--scope','RT.b,GND.gnd',
    '--duration','2ms','--rate','1.998003MHz'];
  const report = JSON.parse(execFileSync(process.execPath,[...args,'--json','--csv',csv],{encoding:'utf8'}));
  assert.equal(report.requestedSamples,3997);
  assert.equal(report.plannedSamples,4000);
  assert.equal(report.rateHz,1998003);
  assert.equal(report.effectiveRateHz,2000000);
  assert.equal(report.scope[0].effectiveRateHz,2000000);
  assert.equal(report.scope[0].summary.samples,4000);
  assert.equal(report.scope[0].startTimeSeconds,.5e-6);
  assert.equal(report.scope[0].sampleIntervalSeconds,.5e-6);
  assert.match(readFileSync(csv,'utf8').split('\n')[0],/startTimeNs=500 sampleIntervalNs=500 points=4000/);
  const watched = execFileSync(process.execPath,[...args,'--watch'],{encoding:'utf8',maxBuffer:8*1024*1024})
    .trim().split('\n').map(JSON.parse);
  assert.equal(watched.length,4001);
  assert.equal(watched[0].timeSeconds,.5e-6);
  assert.equal(watched.at(-2).timeSeconds,.002);
  assert.equal(watched.at(-1).watchSamples,4000);
  assert.equal(watched.at(-1).report.scope[0].summary.samples,4000);
  assert.deepEqual(watched.at(-1).report.scope,report.scope);
});

test('resistance tick cannot append a powered-off point at the next scope boundary', () => {
  const args = [CLI,'measure',FIXTURE,'--scope','RT.b,GND.gnd',
    '--duration','999ns','--rate','2MHz','--json'];
  const powered = JSON.parse(execFileSync(process.execPath,args,{encoding:'utf8'}));
  const resistance = JSON.parse(execFileSync(process.execPath,[...args,
    '--meter','resistance:RT.a,RT.b'],{encoding:'utf8'}));
  assert.equal(resistance.plannedSamples,1);
  assert.equal(resistance.scope[0].summary.samples,1);
  assert.equal(resistance.scope[0].summary.lastVolts,2.5);
  assert.deepEqual(resistance.scope,powered.scope);
});

test('newest scope point agrees with chronological series before and after ring wrap', () => {
  for (const [count,writeIndex,startTNs] of [[1,1,10n],[3,0,10n],[8,2,60n]]) {
    const data = { samples:new Float64Array([1,1,2,2,3,3]), count,writeIndex,
      startTNs,sampleIntervalNs:10n };
    assert.deepEqual(latestTimedScopeSample(data),timedScopeSeries(data).at(-1));
  }
  assert.equal(latestTimedScopeSample(null),null);
  assert.equal(latestTimedScopeSample({samples:new Float64Array(6),count:0}),null);
  for (const bad of [NaN,Infinity,-Infinity]) {
    assert.throws(() => latestTimedScopeSample({ samples:new Float64Array([1,1,bad,bad]),
      count:2,writeIndex:0,startTNs:10n,sampleIntervalNs:10n }),/nonfinite sample.*index 1/);
  }
  assert.throws(() => latestTimedScopeSample({ samples:new Float64Array([1,1]),
    count:1,writeIndex:0,sampleIntervalNs:0n }),/positive sample interval/);
});

test('streaming newest sample reads only one pair even at the 200000-point capture limit', () => {
  const reads = [];
  const samples = new Proxy({length:400000},{get(target,key) {
    if (key === 'length') return target.length;
    reads.push(key);
    assert.ok(key === '399998' || key === '399999','historical buffer point was revisited');
    return 2.5;
  }});
  const sample = latestTimedScopeSample({samples,count:200000,writeIndex:0,
    startTNs:500n,sampleIntervalNs:500n});
  assert.deepEqual(reads,['399998','399999']);
  assert.equal(sample.volts,2.5);
  assert.equal(sample.timeSeconds,0.1);
});

test('1000 streamed observations preserve analytical sine values and absolute timestamps', () => {
  const rows = execFileSync(process.execPath,[CLI,'measure',SINE_FIXTURE,
    '--scope','V1.pos,V1.neg','--duration','10ms','--rate','100kHz','--watch'],
  {encoding:'utf8'}).trim().split('\n').map(JSON.parse);
  const samples = rows.filter(row => row.recordType === 'sample');
  assert.equal(samples.length,1000);
  for (let index = 0; index < samples.length; index++) {
    const timeSeconds = (index + 1) * 10000 / 1e9;
    assert.equal(samples[index].timeSeconds,timeSeconds);
    assert.ok(Math.abs(samples[index].scope[0].volts
      - (1.25 - 2 * Math.sin(2 * Math.PI * 2000 * timeSeconds))) < 1e-12,
    `analytical sine observation ${index}`);
  }
  assert.equal(rows.at(-1).report.scope[0].summary.samples,1000);
});

test('measure refuses ignored profile promises before executing a circuit', () => {
  for (const profile of ['','made-up']) {
    const refused = spawnSync(process.execPath, [CLI,'measure',FIXTURE,
      '--scope','RT.b','--profile',profile,'--json'],{encoding:'utf8'});
    assert.equal(refused.status,2);
    assert.equal(refused.stdout,'');
    assert.match(refused.stderr,/supports --profile interactive-v1 or bounded precision-v1/);
    assert.match(refused.stderr,/analyze --profile precision-v1/);
  }
});

test('explicit interactive profile and default acquisition have identical scope values and disclose actual status', () => {
  const args = [CLI,'measure',SINE_FIXTURE,'--scope','V1.pos,V1.neg',
    '--duration','50us','--rate','100kHz','--json'];
  const implicit = JSON.parse(execFileSync(process.execPath,args,{encoding:'utf8'}));
  const explicit = JSON.parse(execFileSync(process.execPath,[...args,'--profile','interactive-v1'],{encoding:'utf8'}));
  assert.equal(implicit.requestedTransientProfile,null);
  assert.equal(explicit.requestedTransientProfile,'interactive-v1');
  for (const report of [implicit,explicit]) {
    assert.equal(report.transient.profile.id,'interactive-v1');
    assert.equal(typeof report.transient.work.advances,'number');
    assert.ok([null,true,false].includes(report.transient.accuracyMet));
    assert.equal(report.claims.independentOracle,false);
  }
  assert.deepEqual(explicit.scope,implicit.scope);
  assert.deepEqual(explicit.transient,implicit.transient);
});

test('resistance power-off does not replace powered acquisition status', () => {
  const fixture = join(import.meta.dirname,'fixtures','spice-precision-analysis.cir');
  const args = [CLI,'measure',fixture,'--scope','C1.a,V1.neg',
    '--duration','3us','--rate','2MHz','--json'];
  const powered = JSON.parse(execFileSync(process.execPath,args,{encoding:'utf8'}));
  const resistance = JSON.parse(execFileSync(process.execPath,[...args,
    '--meter','resistance:R1.a,R1.b'],{encoding:'utf8'}));
  assert.ok(powered.transient.work.advances > 0,'reactive capture actually integrates');
  assert.deepEqual(resistance.transient,powered.transient);
  assert.deepEqual(resistance.scope,powered.scope);
});

test('scope refuses nonfinite ring points instead of moving later timestamps', () => {
  for (const bad of [NaN, Infinity, -Infinity]) {
    const data = { samples: new Float64Array([1,1,bad,bad,3,3]), count:3, writeIndex:0,
      startTNs:100n, sampleIntervalNs:10 };
    assert.throws(() => timedScopeSeries(data), /nonfinite sample at chronological index 1/);
    assert.throws(() => summarizeScope(data), /nonfinite sample/);
  }
  const valid = { samples: new Float64Array([1,1,2,2,3,3]), count:3, writeIndex:0,
    startTNs:100n, sampleIntervalNs:10 };
  assert.deepEqual(timedScopeSeries(valid).map(s => s.timeSeconds), [100e-9,110e-9,120e-9]);
  assert.deepEqual(timedScopeSeries(valid).map(s => s.volts), [1,2,3]);
  const large = { ...valid, samples: new Float64Array([1e308,1e308]), count:1, writeIndex:0 };
  assert.equal(timedScopeSeries(large)[0].volts, 1e308, 'finite operands must not overflow the midpoint');
});

test('waveform comparison cannot accept nonfinite observations through infinite tolerance', () => {
  const trace = sample => ({ tip:'n', reference:'', samples:[sample] });
  const normal = {timeSeconds:0,volts:1};
  for (const field of ['timeSeconds','volts']) for (const bad of [NaN,Infinity,-Infinity]) {
    for (const side of ['actual','expected']) {
      const invalid = {...normal,[field]:bad};
      const actual = [trace(side === 'actual' ? invalid : normal)];
      const expected = { traces:[trace(side === 'expected' ? invalid : normal)] };
      const report = compareExpectedWaveforms(actual, expected);
      assert.equal(report.status,'fail',`${side} ${field}=${bad}`);
      assert.equal(report.counts.failed,1);
      assert.equal(report.mismatches[0].code,'sample-nonfinite');
    }
  }
  assert.equal(compareExpectedWaveforms([trace(normal)],{traces:[trace(normal)]}).status,'pass');
});

test('zero observations cannot qualify as a passing waveform comparison', () => {
  for (const [actual,expected] of [[[],{traces:[]}],
    [[{tip:'n',samples:[]}],{traces:[{tip:'n',samples:[]}]}]]) {
    const report = compareExpectedWaveforms(actual,expected);
    assert.equal(report.status,'fail');
    assert.equal(report.counts.compared,0);
    assert.equal(report.counts.structuralFailures,1);
    assert.equal(report.mismatches[0].code,'no-compared-samples');
  }
});

test('measurement arguments are bounded and unambiguous', () => {
  assert.equal(parseScaledNumber('2.5ms', 'duration'), 0.0025);
  assert.equal(parseScaledNumber('20kHz', 'rate'), 20_000);
  assert.deepEqual(parseScopeSpec('RT.b,GND.gnd'), { tip: 'RT.b', reference: 'GND.gnd' });
  assert.deepEqual(parseMeterSpec('voltage:RT.b,GND.gnd'), { mode: 'voltage', probes: ['RT.b', 'GND.gnd'] });
  assert.throws(() => parseMeterSpec('current:RT.a,RT.b'), /needs 1 endpoint/);
  assert.throws(() => parseScaledNumber('-1ms', 'duration'), /invalid duration/);
});

test('endpoint resolution accepts explicit nets and part terminals but refuses guesses', () => {
  const nets = [
    { id: 'rail', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'RT', terminal: 'a' }] },
    { id: 'mid', terminals: [{ part: 'RT', terminal: 'b' }, { part: 'RB', terminal: 'a' }] },
  ];
  assert.equal(resolveEndpointNet(nets, 'RT.b'), 'mid');
  assert.equal(resolveEndpointNet(nets, 'net:rail'), 'rail');
  assert.throws(() => resolveEndpointNet(nets, 'RB.b'), /resolves to 0 nets/);
});

test('scope summary reads the chronological ring rather than backing storage order', () => {
  const data = { samples: new Float64Array([3, 3, 4, 4, 1, 1, 2, 2]), count: 4, writeIndex: 2 };
  assert.deepEqual(summarizeScope(data), {
    samples: 4, minVolts: 1, maxVolts: 4, meanVolts: 2.5,
    rmsVolts: Math.sqrt(7.5), lastVolts: 4,
  });
});

test('bwc measure returns real scope and multimeter readings as JSON', () => {
  const text = execFileSync(process.execPath, [CLI, 'measure', FIXTURE,
    '--scope', 'RT.b,GND.gnd', '--probe', '10x', '--duration', '1ms', '--rate', '10kHz',
    '--meter', 'voltage:RT.b,GND.gnd', '--meter', 'current:RT.a', '--json'],
  { encoding: 'utf8', env: { ...process.env } });
  const report = JSON.parse(text);
  assert.equal(report.scope.length, 1);
  assert.equal(report.scope[0].probe, '10x');
  assert.equal(report.scope[0].summary.samples, 10);
  assert.ok(Math.abs(report.scope[0].summary.lastVolts - (5 / 3)) < 1e-4);
  assert.equal(report.meters[0].mode, 'voltage');
  // A 10 MOhm || 15 pF probe loads the two 10 MOhm divider resistors:
  // final voltage=5/3, tau=(10 MOhm/3)*15 pF=50 us. The meter observes
  // the startup integral, not the final scope voltage.
  const tau = 50e-6, duration = .001;
  const mean = (5/3)*(1-tau/duration*(1-Math.exp(-duration/tau)));
  assert.equal(report.meters[0].reading.value, mean.toFixed(3));
  assert.equal(report.meters[0].reading.unit, 'V');
  assert.ok(Math.abs(report.meters[0].reading.siValue - mean) < 1e-4);
  assert.equal(report.meters[0].reading.siUnit, 'V');
  assert.equal(report.meters[1].mode, 'current');
  assert.equal(report.meters[1].reading.unit, 'nA');
  assert.ok(Math.abs(report.meters[1].reading.siValue + (5-mean)/1e7) < 1e-10);
  assert.equal(report.meters[1].reading.siUnit, 'A');
  assert.deepEqual(report.poweredMeterAcquisition,{quantity:'observed-dc-mean',
    startTimeSeconds:0,maximumWindowSeconds:.1,independentIntegralCertificate:false});
});

test('finite probes require a reference and CSV is an explicit file', () => {
  const refused = spawnSync(process.execPath, [CLI, 'measure', FIXTURE,
    '--scope', 'RT.b', '--probe', '10x'], { encoding: 'utf8' });
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /requires an explicit reference net/);

  const dir = mkdtempSync(join(tmpdir(), 'bwc-measure-'));
  const csv = join(dir, 'trace.csv');
  const output = execFileSync(process.execPath, [CLI, 'measure', FIXTURE,
    '--scope', 'RT.b', '--duration', '1ms', '--rate', '10kHz',
    '--meter', 'resistance:RT.a,RT.b', '--csv', csv],
  { encoding: 'utf8', env: { ...process.env } });
  assert.match(output, /meter resistance/);
  assert.doesNotMatch(output, /Turn power OFF/);
  assert.match(readFileSync(csv, 'utf8'), /capture=sample startTimeNs=100000 sampleIntervalNs=100000 points=10/);
  assert.match(readFileSync(csv, 'utf8'), /elapsed_seconds,volts/);
});

test('imported SINE is measured on its real simulation clock with analytical values', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bwc-measure-sine-'));
  const csv = join(dir, 'trace.csv');
  const text = execFileSync(process.execPath, [CLI, 'measure', SINE_FIXTURE,
    '--scope', 'V1.pos,V1.neg', '--meter', 'voltage:V1.pos,V1.neg',
    '--meter', 'current:R1.a', '--duration', '500us', '--rate', '100kHz',
    '--csv', csv, '--json'], { encoding: 'utf8', env: { ...process.env } });
  const report = JSON.parse(text);
  const scope = report.scope[0];
  assert.equal(scope.summary.samples, 50);
  assert.equal(scope.startTimeSeconds, 10e-6);
  assert.equal(scope.sampleIntervalSeconds, 10e-6);
  assert.ok(Math.abs(scope.summary.meanVolts - 1.25) < 1e-12);
  assert.ok(Math.abs(scope.summary.rmsVolts - Math.sqrt(1.25 ** 2 + (2 ** 2) / 2)) < 1e-12);
  assert.ok(Math.abs(report.meters[0].reading.siValue - 1.25) < 50e-6);
  assert.ok(Math.abs(report.meters[1].reading.siValue + 0.00125) < 50e-9,
    'current is signed positive out of the selected resistor terminal');
  const rows = readFileSync(csv, 'utf8').trim().split('\n');
  assert.match(rows[0], /startTimeNs=10000 sampleIntervalNs=10000 points=50/);
  const [elapsed, firstVolts] = rows[2].split(',').map(Number);
  assert.equal(elapsed, 0);
  assert.ok(Math.abs(firstVolts - (1.25 - 2 * Math.sin(2 * Math.PI * 2000 * 10e-6))) < 1e-12);
});

test('invalid requested meter endpoints fail instead of printing a placeholder', () => {
  const refused = spawnSync(process.execPath, [CLI, 'measure', FIXTURE,
    '--meter', 'current:NO_SUCH_PART.a'], { encoding: 'utf8' });
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /resolves to 0 nets/);
});

test('watch streams monotonic true samples and agrees exactly with batch capture', () => {
  const args = ['measure', SINE_FIXTURE, '--scope', 'V1.pos,V1.neg',
    '--meter', 'voltage:V1.pos,V1.neg', '--meter', 'current:R1.a',
    '--duration', '50us', '--rate', '100kHz'];
  const watched = execFileSync(process.execPath, [CLI, ...args, '--watch'], { encoding: 'utf8' })
    .trim().split('\n').map(JSON.parse);
  const samples = watched.filter(row => row.recordType === 'sample');
  const summary = watched.at(-1);
  assert.equal(samples.length, 5);
  assert.equal(summary.recordType, 'summary');
  assert.equal(summary.watchSamples, 5);
  assert.equal(summary.report.transient.profile.id,'interactive-v1');
  for (let index = 0; index < samples.length; index++) {
    const row = samples[index];
    const time = (index + 1) * 10e-6;
    const expected = 1.25 - 2 * Math.sin(2 * Math.PI * 2000 * time);
    assert.equal(row.index, index);
    assert.ok(Math.abs(row.timeSeconds - time) < 1e-15);
    assert.ok(Math.abs(row.scope[0].volts - expected) < 1e-12);
    // CLI primes at t=0; independently integrate the sine from that instant.
    const omega=2*Math.PI*2000;
    const mean=1.25-2*(1-Math.cos(omega*time))/(omega*time);
    // Each accepted adaptive interval publishes its two half-step solves.
    // For this fixed source and 10 us sample grid, composite trapezoid mean
    // error is bounded by max|V''| * (5 us)^2 / 12. Scope endpoint tolerance
    // remains unchanged; this is a quadrature bound, not exact analog truth.
    const meanErrorBound=2*omega**2*(5e-6)**2/12;
    assert.ok(Math.abs(row.meters[0].reading.siValue-mean)<meanErrorBound,
      `waveform-integral voltage mean at observation ${index}`);
    assert.ok(Math.abs(row.meters[1].reading.siValue + mean / 1000) < meanErrorBound/1000,
      `signed waveform-integral current mean at observation ${index}`);
  }

  const dir = mkdtempSync(join(tmpdir(), 'bwc-measure-watch-'));
  const csv = join(dir, 'batch.csv');
  execFileSync(process.execPath, [CLI, ...args, '--csv', csv], { encoding: 'utf8' });
  const batch = readFileSync(csv, 'utf8').trim().split('\n').slice(2)
    .map(line => Number(line.split(',')[1]));
  batch.forEach((value, index) => assert.ok(
    Math.abs(value - samples[index].scope[0].volts) <= Number.EPSILON,
    `observing between advances changed sample ${index} beyond one binary64 ulp`,
  ));
});

test('expected waveform comparison checks every timestamp/value and makes a mutation red', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bwc-measure-expect-'));
  const expectedPath = join(dir, 'expected.json');
  const samples = Array.from({ length: 5 }, (_, index) => {
    const timeSeconds = (index + 1) * 10e-6;
    return { timeSeconds, volts: 1.25 - 2 * Math.sin(2 * Math.PI * 2000 * timeSeconds) };
  });
  const expected = { schemaVersion: 1, provenance: { kind: 'analytical-sine', model: 'V(t)=1.25-2*sin(2*pi*2000*t)' },
    traces: [{ tip: 'V1.pos', reference: 'V1.neg', samples }] };
  assert.equal(compareExpectedWaveforms(expected.traces, parseExpectedWaveforms(JSON.stringify(expected))).status, 'pass');
  writeFileSync(expectedPath, JSON.stringify(expected));
  const good = JSON.parse(execFileSync(process.execPath, [CLI, 'measure', SINE_FIXTURE,
    '--scope', 'V1.pos,V1.neg', '--duration', '50us', '--rate', '100kHz',
    '--expect', expectedPath, '--json'], { encoding: 'utf8' }));
  assert.equal(good.comparison.status, 'pass');
  assert.deepEqual(good.comparison.counts, { traces: 1, compared: 5, passed: 5, failed: 0, structuralFailures: 0 });
  assert.equal(good.claims.independentOracle, false, 'caller provenance is reported, not trusted as an oracle claim');

  expected.traces[0].samples[2].volts += 0.1;
  writeFileSync(expectedPath, JSON.stringify(expected));
  const bad = spawnSync(process.execPath, [CLI, 'measure', SINE_FIXTURE,
    '--scope', 'V1.pos,V1.neg', '--duration', '50us', '--rate', '100kHz',
    '--expect', expectedPath, '--json'], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  const report = JSON.parse(bad.stdout);
  assert.equal(report.comparison.status, 'fail');
  assert.equal(report.comparison.counts.failed, 1);
  assert.equal(report.comparison.mismatches[0].code, 'sample-voltage');

  const short = structuredClone(expected);
  short.traces[0].samples.pop();
  const missing = compareExpectedWaveforms([{ tip: 'V1.pos', reference: 'V1.neg', samples }], short);
  assert.equal(missing.status, 'fail');
  assert.equal(missing.counts.structuralFailures, 1);
  assert.equal(missing.mismatches[0].code, 'sample-count');
});

test('watch exposes PULSE edges on their actual simulation timestamps', () => {
  const fixture = join(import.meta.dirname, 'fixtures', 'spice-precision-analysis.cir');
  const rows = execFileSync(process.execPath, [CLI, 'measure', fixture,
    '--scope', 'V1.pos,V1.neg', '--meter', 'voltage:V1.pos,V1.neg',
    '--duration', '3us', '--rate', '2MHz', '--watch'], { encoding: 'utf8' })
    .trim().split('\n').map(JSON.parse).filter(row => row.recordType === 'sample');
  assert.deepEqual(rows.map(row => row.timeSeconds), [0.5e-6, 1e-6, 1.5e-6, 2e-6, 2.5e-6, 3e-6]);
  assert.deepEqual(rows.map(row => row.scope[0].volts), [0, 0, 5, 5, 5, 5]);
  // CLI primes at zero, retaining the 1 ns ramp's area, not held scope samples.
  rows.forEach(row => {
    const expected=row.timeSeconds<=1e-6 ? 0
      : 5*(row.timeSeconds-1e-6-.5e-9)/row.timeSeconds;
    assert.ok(Math.abs(row.meters[0].reading.siValue-expected)<50e-6);
  });
});

test('watch refuses modes that cannot represent a powered time series', () => {
  const resistance = spawnSync(process.execPath, [CLI, 'measure', FIXTURE,
    '--meter', 'resistance:RT.a,RT.b', '--watch'], { encoding: 'utf8' });
  assert.equal(resistance.status, 2);
  assert.match(resistance.stderr, /resistance powers the circuit off/);
});

const meterReference=(samples=[{timeSeconds:.001,siValue:2}],acquisition='batch')=>({
  schemaVersion:1,acquisition,provenance:{kind:'analytical-control'},
  meters:[{mode:'voltage',probes:['V1.pos','V1.neg'],siUnit:'V',quantity:'observed-dc-mean',
    absoluteTolerance:1e-9,relativeTolerance:0,samples}],
});
const meterObservation=(siValue=2,timeSeconds=.001)=>({mode:'voltage',probes:['V1.pos','V1.neg'],
  quantity:'observed-dc-mean',timeSeconds,reading:{siValue,siUnit:'V',note:null}});
test('typed meter references refuse missing authority, invalid values and unbounded grids',()=>{
  const good=meterReference();
  for(const mutate of [r=>r.schemaVersion=2,r=>r.acquisition='instant',r=>r.meters=[],
    r=>r.meters=[null],r=>r.meters[0].quantity='instantaneous',r=>r.meters[0].siUnit='mV',
    r=>delete r.meters[0].absoluteTolerance,r=>r.meters[0].absoluteTolerance=-1,
    r=>r.meters[0].samples[0].siValue=null,r=>r.meters[0].samples[0].timeSeconds=-1,
    r=>r.meters[0].samples.push({timeSeconds:.002,siValue:2}),r=>r.timeToleranceSeconds=-1]) {
    const changed=structuredClone(good);mutate(changed);
    assert.throws(()=>parseExpectedMeters(JSON.stringify(changed)),/meter reference|meter time tolerance/);
  }
  const repeated=meterReference([{timeSeconds:0,siValue:2},{timeSeconds:0,siValue:2}],'watch');
  assert.throws(()=>parseExpectedMeters(JSON.stringify(repeated)),/strictly increasing/);
  const huge=meterReference(Array(200001).fill({timeSeconds:0,siValue:0}),'watch');
  assert.throws(()=>parseExpectedMeters(JSON.stringify(huge)),/200000/);
});
test('streaming meter comparison exposes identity/time/value/count/nonfinite errors without unbounded diagnostics',()=>{
  const run=(rows,reference=meterReference())=>{
    const c=createExpectedMeterComparison(parseExpectedMeters(JSON.stringify(reference)));
    rows.forEach(row=>c.observe(row));return c.finish();
  };
  assert.equal(run([[meterObservation()]]).status,'pass');
  const relative=meterReference();relative.meters[0].absoluteTolerance=0;relative.meters[0].relativeTolerance=.9;
  assert.equal(run([[meterObservation(6)]],relative).status,'fail','relative allowance uses expected value, never wrong actual magnitude');
  for(const [row,code] of [
    [{...meterObservation(),probes:['V1.neg','V1.pos']},'meter-identity'],
    [{...meterObservation(),reading:{siValue:2,siUnit:'A'}},'meter-identity'],
    [meterObservation(-2),'meter-value'],[meterObservation(2,.002),'meter-time'],
    [meterObservation(NaN),'meter-nonfinite'],[{...meterObservation(),reading:{siValue:2,siUnit:'V',note:'refused'}},'meter-nonfinite']]) {
    const result=run([[row]]);assert.equal(result.status,'fail');
    assert.ok(result.mismatches.some(m=>m.code===code),code);
  }
  assert.equal(run([]).status,'fail');
  assert.equal(run([[]]).status,'fail');
  assert.equal(run([[meterObservation(),meterObservation()]]).status,'fail');
  const reference=meterReference(Array.from({length:50},(_,k)=>({timeSeconds:(k+1)*.001,siValue:2})),'watch');
  const result=run(reference.meters[0].samples.map(s=>[meterObservation(-2,s.timeSeconds)]),reference);
  assert.equal(result.counts.failed,50);assert.equal(result.mismatches.length,20);
  assert.equal(result.channels[0].worstAbsoluteError,4);
  const missing=run(reference.meters[0].samples.slice(1).map(s=>[meterObservation(2,s.timeSeconds)]),reference);
  assert.equal(missing.status,'fail');assert.ok(missing.mismatches.some(m=>m.code==='sample-count'));
});
test('actual CLI meter references pass and fail batch/watch with diagnostic exit statuses',()=>{
  const dir=mkdtempSync(join(tmpdir(),'bwc-meter-reference-'));
  try {
    const file=join(dir,'constant.cir'),path=join(dir,'expected.json');
    writeFileSync(file,'* Self-authored constant oracle\nV1 signal 0 2\nR1 signal 0 1k\n.op\n.end\n');
    const base=[CLI,'measure',file,'--meter','voltage:V1.pos,V1.neg','--duration','1ms','--rate','1kHz','--expect-meters',path];
    const invoke=extra=>spawnSync(process.execPath,[...base,...extra],{encoding:'utf8',timeout:30000});
    writeFileSync(path,JSON.stringify(meterReference()));
    const good=invoke(['--json']);assert.equal(good.status,0,good.stderr);
    const report=JSON.parse(good.stdout);
    assert.equal(report.meterComparison.status,'pass');assert.equal(report.meterComparison.counts.compared,1);
    assert.equal(report.claims.independentOracle,false);assert.equal(report.claims.referenceProvided,true);
    for(const mutate of [r=>r.meters[0].samples[0].siValue=-2,r=>r.meters[0].samples[0].timeSeconds=.002,
      r=>r.meters[0].probes.reverse()]) {
      const bad=meterReference();mutate(bad);writeFileSync(path,JSON.stringify(bad));
      const result=invoke(['--json']);assert.equal(result.status,1,result.stderr);
      assert.equal(JSON.parse(result.stdout).meterComparison.status,'fail');
    }
    const invalid=meterReference();invalid.meters[0].quantity='instantaneous';writeFileSync(path,JSON.stringify(invalid));
    const refused=invoke(['--json']);assert.equal(refused.status,2);assert.equal(refused.stdout,'');
    writeFileSync(path,JSON.stringify(meterReference([{timeSeconds:.001,siValue:2}],'watch')));
    const watched=invoke(['--watch']);assert.equal(watched.status,0,watched.stderr);
    const records=watched.stdout.trim().split('\n').map(JSON.parse);
    assert.equal(records.length,2);assert.equal(records.at(-1).report.meterComparison.status,'pass');
    assert.equal(invoke(['--json']).status,2,'acquisition mismatch refuses before simulation');
    writeFileSync(path,JSON.stringify(meterReference([{timeSeconds:.001,siValue:-2}],'watch')));
    const wrong=invoke(['--watch']);assert.equal(wrong.status,1);
    assert.equal(JSON.parse(wrong.stdout.trim().split('\n').at(-1)).report.meterComparison.status,'fail');
    const resistance={schemaVersion:1,acquisition:'batch',meters:[{mode:'resistance',
      probes:['R1.a','R1.b'],siUnit:'Ω',quantity:'power-off-resistance',absoluteTolerance:1e-5,
      samples:[{timeSeconds:.001000001,siValue:1000}]}]};
    writeFileSync(path,JSON.stringify(resistance));
    const ohms=spawnSync(process.execPath,[CLI,'measure',file,'--meter','resistance:R1.a,R1.b',
      '--duration','1ms','--expect-meters',path,'--json'],{encoding:'utf8',timeout:30000});
    assert.equal(ohms.status,0,ohms.stderr);const ohmsReport=JSON.parse(ohms.stdout);
    assert.equal(ohmsReport.meterComparison.status,'pass');
    assert.equal(ohmsReport.meters[0].timeSeconds,.001000001);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('actual CLI compares all 700 signed meter means to live ngspice, with an independent integral control',{
  skip:ngspicePresent?false:'ngspice unavailable: no independent meter reference comparison ran',
},()=>{
  const dir=mkdtempSync(join(tmpdir(),'bwc-meter-ngspice-'));
  try {
    const circuit='* Independent signed ideal inductor\nI1 0 signal SINE(0 1m 250)\nL1 signal 0 1m\n';
    const file=join(dir,'input.cir'),path=join(dir,'expected.json');
    writeFileSync(file,circuit+'.tran 1u 7m\n.end\n');
    writeFileSync(join(dir,'oracle.cir'),circuit+'.options reltol=1e-10 abstol=1e-14 trtol=1\n.control\n'
      +'set wr_vecnames\nset wr_singlescale\ntran 1u 7m 0 100n\nlinearize i(L1)\nwrdata current.csv i(L1)\n.endc\n.end\n');
    const oracle=spawnSync('ngspice',['-b','oracle.cir'],{cwd:dir,encoding:'utf8',timeout:30000});
    assert.equal(oracle.status,0,oracle.stderr);
    const points=readFileSync(join(dir,'current.csv'),'utf8').trim().split('\n').slice(1)
      .map(line=>line.trim().split(/\s+/).map(Number));
    assert.equal(points.length,7001);assert.ok(points.every(p=>p.length===2 && p.every(Number.isFinite)));
    let area=0;const samples=[];
    for(let k=1;k<points.length;k++) {
      const [time,current]=points[k],[previousTime,previousCurrent]=points[k-1];
      assert.ok(time>previousTime);
      area+=(time-previousTime)*(current+previousCurrent)/2;
      if(k%10===0) {
        const siValue=-area/time;
        const closed=-.001*(1-Math.cos(2*Math.PI*250*time))/(2*Math.PI*250*time);
        assert.ok(Math.abs(siValue-closed)<1e-9,'ngspice prefix mean agrees with independent closed form');
        samples.push({timeSeconds:time,siValue});
      }
    }
    assert.equal(samples.length,700);
    const reference={schemaVersion:1,acquisition:'watch',provenance:{kind:'live-ngspice-trapezoidal-current-area'},
      meters:[{mode:'current',probes:['L1.a'],siUnit:'A',quantity:'observed-dc-mean',absoluteTolerance:1e-9,samples}]};
    const base=[CLI,'measure',file,'--meter','current:L1.a','--duration','7ms','--rate','100kHz','--expect-meters',path];
    writeFileSync(path,JSON.stringify(reference));
    const good=spawnSync(process.execPath,[...base,'--watch'],{encoding:'utf8',timeout:30000});
    assert.equal(good.status,0,good.stderr);
    const summary=JSON.parse(good.stdout.trim().split('\n').at(-1)).report;
    assert.equal(summary.meterComparison.counts.compared,700);assert.equal(summary.meterComparison.counts.failed,0);
    assert.equal(summary.claims.independentOracle,false,'caller provenance must never self-certify independence');
    reference.meters[0].samples[333].siValue+=.0001;writeFileSync(path,JSON.stringify(reference));
    const bad=spawnSync(process.execPath,[...base,'--watch'],{encoding:'utf8',timeout:30000});
    assert.equal(bad.status,1);const result=JSON.parse(bad.stdout.trim().split('\n').at(-1)).report.meterComparison;
    assert.equal(result.counts.failed,1);assert.equal(result.mismatches[0].sampleIndex,333);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

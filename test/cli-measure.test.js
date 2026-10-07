import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { fileReceipt, runtimeReceipt, importedCircuitSha256,
  parseMeasurementReceipt, compareMeasurementReceiptIdentity } from '../src/model/measurement-receipt.js';
import {dcSweepGrid,validateDcSweepInput,parseExpectedDcSweep,compareExpectedDcSweep} from '../src/model/dc-sweep-report.js';
import {parseExpectedAc,compareExpectedAc} from '../src/model/ac-reference-report.js';
import {
  compareExpectedWaveforms, parseExpectedWaveforms, parseMeterSpec, parseScaledNumber,
  parseExpectedMeters, createExpectedMeterComparison,
  parseScopeSpec, resolveEndpointNet, summarizeScope, timedScopeSeries, latestTimedScopeSample,
  measurementSampleClock,
  validatePrecisionCaptureInput, precisionCaptureBudget, validatePrecisionCaptureWork,
  precisionStreamBudget, validatePrecisionStreamWork,
  validatePrecisionVoltageTopology,
} from '../src/model/instrument-report.js';

const ROOT = join(import.meta.dirname, '..');
const CLI = join(ROOT, 'bin', 'bwc.mjs');
const FIXTURE = join(import.meta.dirname, 'fixtures', 'cli-measure-divider.json');
const SINE_FIXTURE = join(import.meta.dirname, 'fixtures', 'cli-measure-sine.cir');
const PROBE_FIXTURE = join(import.meta.dirname,'fixtures','cli-measure-probe.cir');

test('measure max-step preserves defaults and the requested observation clock',()=>{
  const base=[CLI,'measure',SINE_FIXTURE,'--scope','V1.pos,V1.neg',
    '--duration','100us','--rate','100kHz','--json'];
  const invoke=extra=>{const r=spawnSync(process.execPath,[...base,...extra],{encoding:'utf8'});
    assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);};
  const legacy=invoke([]),explicit=invoke(['--profile','interactive-v1']);
  assert.equal(legacy.requestedTransientProfile,null);
  assert.equal(explicit.requestedTransientProfile,'interactive-v1');
  assert.deepEqual({...explicit,requestedTransientProfile:null},legacy,
    'explicit profile differs only in its existing requested-profile metadata');
  const bounded=invoke(['--max-step','2us']);
  const {summary:boundedSummary,...boundedMetadata}=bounded.scope[0];
  const {summary:legacySummary,...legacyMetadata}=legacy.scope[0];
  assert.deepEqual(boundedMetadata,legacyMetadata,'same requested clock and probe identity');
  for(const key of Object.keys(legacySummary)) {
    assert.ok(Math.abs(boundedSummary[key]-legacySummary[key])<1e-12,
      `ideal source summary ${key}; smaller integration steps can change binary64 rounding`);
  }
  assert.equal(bounded.transient.profile.authoredMaxStepSec,2e-6);
  assert.equal(bounded.transient.stepBound.maxStepSec,2e-6);
  assert.equal(bounded.transient.profile.maxAttempts,legacy.transient.profile.maxAttempts);
  assert.equal(legacy.transient.profile.authoredMaxStepSec,undefined);
  const precision=invoke(['--profile','precision-v1','--initial','zero-state','--max-step','2us']);
  assert.equal(precision.transient.profile.authoredMaxStepSec,2e-6);
  assert.equal(precision.transient.profile.id,'precision-v1');
});

test('measure max-step refuses invalid units, bounds and other commands',()=>{
  const base=[CLI,'measure',SINE_FIXTURE,'--scope','V1.pos,V1.neg','--duration','10us','--json'];
  for(const value of ['0','-1us','NaN','Infinity','1kHz','0.001ns','101us']) {
    const r=spawnSync(process.execPath,[...base,'--max-step',value],{encoding:'utf8'});
    assert.equal(r.status,2,`${value}: ${r.stderr}`);assert.match(r.stderr,/max-step|maxStepSec/);
  }
  const missing=spawnSync(process.execPath,[...base,'--max-step'],{encoding:'utf8'});
  assert.equal(missing.status,2);assert.match(missing.stderr,/needs a value/);
  const wrong=spawnSync(process.execPath,[CLI,'info',SINE_FIXTURE,'--max-step','2us'],{encoding:'utf8'});
  assert.equal(wrong.status,2);assert.match(wrong.stderr,/supported only by measure/);
  const precision=spawnSync(process.execPath,[...base,'--profile','precision-v1','--initial','zero-state',
    '--max-step','11us'],{encoding:'utf8'});
  assert.equal(precision.status,2);assert.match(precision.stderr,/cannot exceed the selected profile maximum/);
});

test('measure max-step refines actual RC pulse differential voltage without changing samples or tolerances',()=>{
  const dir=mkdtempSync(join(tmpdir(),'bwc-pulse-max-step-'));
  try {
    const file=join(dir,'pulse.cir');
    writeFileSync(file,'* Authored RC\nV1 input 0 PULSE(0 2 200u 50u 100u 200u 1m)\n'
      +'R1 input output 1k\nC1 output 0 100n\n.tran 100n 2m\n.end\n');
    const base=[CLI,'measure',file,'--scope','R1.a,R1.b','--duration','2ms','--rate','100kHz','--watch'];
    const invoke=extra=>{const r=spawnSync(process.execPath,[...base,...extra],{encoding:'utf8',timeout:15000});
      assert.equal(r.status,0,r.stderr);return r.stdout.trim().split('\n').map(JSON.parse);};
    const ordinary=invoke([]),refined=invoke(['--max-step','2us']);
    const ramp=t=>{const u=Math.max(0,t);return u+1e-4*Math.expm1(-u/1e-4);};
    const forcing=t=>{const p=t%1e-3;
      if(p<200e-6||p>=550e-6)return 0;if(p<250e-6)return 2*(p-200e-6)/50e-6;
      if(p<450e-6)return 2;return 2*(550e-6-p)/100e-6;};
    const expected=t=>{let out=0;for(let n=0;n<2;n++) {
      const u=t-200e-6-n*1e-3;out+=2/50e-6*(ramp(u)-ramp(u-50e-6))
        -2/100e-6*(ramp(u-250e-6)-ramp(u-350e-6));}
      return forcing(t)-out;};
    let ordinaryWorst=0,refinedWorst=0,ordinaryFailures=0;
    assert.equal(ordinary.length,201);assert.equal(refined.length,201);
    for(let i=0;i<200;i++) {
      const t=(i+1)*1e-5;assert.ok(Math.abs(refined[i].timeSeconds-t)<1e-15);
      assert.equal(refined[i].timeSeconds,ordinary[i].timeSeconds);
      const want=expected(t),limit=1e-4+1e-4*Math.abs(want);
      const before=Math.abs(ordinary[i].scope[0].volts-want),after=Math.abs(refined[i].scope[0].volts-want);
      ordinaryWorst=Math.max(ordinaryWorst,before);refinedWorst=Math.max(refinedWorst,after);
      if(before>limit)ordinaryFailures++;assert.ok(after<=limit,`refined sample ${i}: ${after} > ${limit}`);
    }
    assert.ok(ordinaryFailures>0,'preserve the observed default-envelope limitation, not a universal default pass');
    assert.ok(refinedWorst<ordinaryWorst/4,`${refinedWorst} vs ${ordinaryWorst}`);
    assert.equal(refined.at(-1).report.transient.profile.authoredMaxStepSec,2e-6);
    assert.equal(refined.at(-1).report.transient.profile.maxAttempts,20000);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('actual static OP KCL CLI reports full signed coverage, genuine zero and unchanged legacy output', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bwc-op-kcl-'));
  const env = {...process.env}; delete env.BW_BOARD;
  try {
    const file = join(dir, 'control.cir');
    for (const volts of [6, -6, 0]) {
      writeFileSync(file, `authored divider\nV1 in 0 ${volts}\nR1 in out 1k\nR2 out 0 2k\n.op\n.end\n`);
      const child = spawnSync(process.execPath, [CLI, 'op', file, '--kcl', '--json'], {encoding: 'utf8', env});
      assert.equal(child.status, 0, child.stderr);
      const {kcl} = JSON.parse(child.stdout);
      assert.equal(kcl.status, 'pass');
      assert.equal(kcl.counts.nets, 3);
      assert.equal(kcl.counts.parts, 3);
      assert.equal(kcl.counts.terminals, 6);
      assert.equal(kcl.observations.length, 6);
      assert.equal(kcl.observations.find(row => row.part === 'V1' && row.terminal === 'pos').currentAmps,
        volts === 0 ? 0 : -volts / 3000, 'JSON preserves a numeric zero, not the sign bit of -0');
      assert.equal(kcl.claims.independentOracle, false);
      const text = spawnSync(process.execPath, [CLI, 'op', file, '--kcl'], {encoding: 'utf8', env});
      assert.equal(text.status, 0, text.stderr);
      assert.match(text.stdout, /static OP KCL PASS/);
      assert.match(text.stdout, /V1\.pos on .* A into part/);
      assert.match(text.stdout, /not an independent oracle/);
    }
    const legacy = spawnSync(process.execPath, [CLI, 'op', file], {encoding: 'utf8', env});
    assert.equal(legacy.status, 0, legacy.stderr);
    assert.match(legacy.stdout, /DC operating point/);
    assert.doesNotMatch(legacy.stdout, /static OP KCL|"kcl"/);
    const unsupported = spawnSync(process.execPath, [CLI, 'measure', file, '--kcl'], {encoding: 'utf8', env});
    assert.equal(unsupported.status, 2);
    assert.match(unsupported.stderr, /supported only by static op/);
    writeFileSync(file, 'waveform is not a static audit\nV1 in 0 SINE(0 1 1k)\nR1 in 0 1k\n.end\n');
    const waveform = spawnSync(process.execPath, [CLI, 'op', file, '--kcl', '--json'], {encoding: 'utf8', env});
    assert.equal(waveform.status, 2);
    assert.equal(waveform.stdout, '');
    assert.match(waveform.stderr, /time-varying source/);
  } finally {rmSync(dir, {recursive: true, force: true});}
});

test('actual CLI three native-current mutations expose reversed, omitted and indeterminate authority', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bwc-op-kcl-mutants-'));
  const env = {...process.env}; delete env.BW_BOARD;
  try {
    const file = join(dir, 'control.cir');
    writeFileSync(file, 'signed mutation control\nV1 in 0 6\nR1 in out 1k\nR2 out 0 2k\n.op\n.end\n');
    const engine = import.meta.resolve('bw-board/board.js');
    for (const [name, mutation, exit, status] of [
      ['reversed-source', "for(const [t,i] of p.branchCurrents.get('V1')) p.branchCurrents.get('V1').set(t,-i);", 1, 'fail'],
      ['missing-source-terminal', "p.branchCurrents.get('V1').delete('pos');", 2, 'refused'],
      ['indeterminate-source', "p.indeterminateBranchCurrents.add('V1');", 2, 'refused'],
    ]) {
      const preload = `import {BoardImpl} from ${JSON.stringify(engine)}; const original=BoardImpl.prototype.operatingPoint;
        BoardImpl.prototype.operatingPoint=function(...args){const p=original.apply(this,args);${mutation}return p;};`;
      const child = spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(preload)}`,
        CLI, 'op', file, '--kcl', '--json'], {encoding: 'utf8', env});
      assert.equal(child.status, exit, `${name}: ${child.stderr}`);
      const {kcl} = JSON.parse(child.stdout);
      assert.equal(kcl.status, status, name);
      if (status === 'fail') assert.equal(kcl.counts.failed, 2, 'whole-part cancellation must not hide two failed nets');
      else assert.equal(kcl.counts.passed, 0, 'unavailable authority cannot retain partial passes');
    }
    const restored = spawnSync(process.execPath, [CLI, 'op', file, '--kcl', '--json'], {encoding: 'utf8', env});
    assert.equal(restored.status, 0, restored.stderr);
    assert.equal(JSON.parse(restored.stdout).kcl.status, 'pass');
  } finally {rmSync(dir, {recursive: true, force: true});}
});

test('static KCL CLI signed terminal observations agree with live ngspice and authored controls', {
  skip: spawnSync('ngspice', ['--version'], {encoding: 'utf8'}).status !== 0,
}, () => {
  const dir = mkdtempSync(join(tmpdir(), 'bwc-op-kcl-oracle-'));
  const env = {...process.env}; delete env.BW_BOARD;
  try {
    for (const [name, cards, sourceAmps, resistorAmps] of [
      ['positive-divider', 'V1 in 0 6\nR1 in out 1k\nR2 out 0 2k', -.002, .002],
      ['negative-divider', 'V1 in 0 -6\nR1 in out 1k\nR2 out 0 2k', .002, -.002],
      ['zero-divider', 'V1 in 0 0\nR1 in out 1k\nR2 out 0 2k', 0, 0],
      ['controlled-sink', 'V1 ctl 0 1\nG1 out 0 ctl 0 2m\nR1 out 0 1k', 0, -.002],
    ]) {
      const file = join(dir, 'control.cir');
      const oracleOutput = `oracle-${name}.txt`;
      writeFileSync(file, `${name}\n${cards}\n.op\n.end\n`);
      writeFileSync(join(dir, 'oracle.cir'), `${name}\n${cards}\n.control\nset wr_vecnames\nset wr_singlescale\nop\nwrdata ${oracleOutput} i(v1) @r1[i]\n.endc\n.end\n`);
      const oracle = spawnSync('ngspice', ['-b', 'oracle.cir'], {cwd: dir, encoding: 'utf8', timeout: 60000});
      assert.equal(oracle.status, 0, oracle.stderr || oracle.stdout);
      assert.ok(existsSync(join(dir, oracleOutput)), oracle.stderr || oracle.stdout);
      const reference = readFileSync(join(dir, oracleOutput), 'utf8').trim().split('\n').slice(1)
        .flatMap(line => line.trim().split(/\s+/).map(Number)).slice(-2);
      assert.equal(reference.length, 2);
      assert.ok(reference.every(Number.isFinite));
      const child = spawnSync(process.execPath, [CLI, 'op', file, '--kcl', '--json'], {encoding: 'utf8', env});
      assert.equal(child.status, 0, child.stderr);
      const {kcl} = JSON.parse(child.stdout);
      const actual = [['V1', 'pos'], ['R1', 'a']].map(([part, terminal]) =>
        kcl.observations.find(row => row.part === part && row.terminal === terminal)?.currentAmps);
      for (let index = 0; index < actual.length; index++) {
        assert.ok(Number.isFinite(actual[index]));
        assert.ok(Math.abs(actual[index] - reference[index]) <= 1e-9, `${name}: native vs ngspice`);
        assert.ok(Math.abs(actual[index] - [sourceAmps, resistorAmps][index]) <= 1e-9, `${name}: authored control`);
      }
      assert.equal(kcl.status, 'pass');
      assert.equal(kcl.claims.independentOracle, false, 'the CLI itself did not execute the external oracle');
    }
  } finally {rmSync(dir, {recursive: true, force: true});}
});

function adp7118StartupCliFixture({ohms = 500, farads = 2.2e-6,
  startupModel = 'datasheet-envelope'} = {}) {
  const wire = (from, fromTerminal, to, toTerminal) =>
    ({from, fromTerminal, to, toTerminal});
  return {
    vcc: 5,
    parts: [
      {id:'VIN',kind:'vsource',params:{volts:8}},
      {id:'EN',kind:'vsource',params:{volts:3.3}},
      {id:'G',kind:'gnd',params:{}},
      {id:'U',kind:'adp7118',params:{vOut:5,startupModel,
        ...(startupModel==='current-limited-envelope'?{rOut:.05,currentLimit:.36}:{})}},
      {id:'RL',kind:'resistor',params:{ohms}},
      {id:'C',kind:'capacitor',params:{farads}},
    ],
    // SS is intentionally absent: an authored singleton SS net is NOT open
    // according to this model's qualified admission contract.
    wires: [
      wire('VIN','pos','U','vin_7'), wire('VIN','pos','U','vin_8'),
      wire('EN','pos','U','en'),
      wire('U','vout_1','U','vout_2'),
      wire('U','vout_1','U','sense_adj'),
      wire('U','vout_1','RL','a'), wire('U','vout_1','C','a'),
      wire('G','gnd','VIN','neg'), wire('G','gnd','EN','neg'),
      wire('G','gnd','U','gnd'), wire('G','gnd','RL','b'),
      wire('G','gnd','C','b'),
    ],
  };
}

// Continuous RC equation with analytically bracketed clamp entry/release.
// This is an independent authored-envelope reference, not a vendor macromodel.
function limitedStartupReference(R,C,duration=.0012) {
  const A=5,r=.05,I=.36,tau=300e-6/Math.log(9);
  const delay=Math.round((80e-6+tau*Math.log(.9))*1e9)/1e9;
  const k=R/(R+r),rho=C*R*r/(R+r);
  const target=x=>A*(1-Math.exp(-x/tau));
  const initial=x=>A*k*(1-(tau*Math.exp(-x/tau)-rho*Math.exp(-x/rho))/(tau-rho));
  const root=(f,a,b)=>{for(let i=0;i<70;i++){const m=(a+b)/2;if(f(m)>0)b=m;else a=m;}return(a+b)/2;};
  let entry=null,release=null;
  const f=x=>target(x)-initial(x)-r*I;
  for(let x=1e-6;x<=duration;x+=1e-6)if(f(x)>0){entry=root(f,x-1e-6,x);break;}
  const limited=x=>I*R+(initial(entry)-I*R)*Math.exp(-(x-entry)/(R*C));
  if(entry!==null){const g=x=>-(target(x)-limited(x)-r*I);
    for(let x=entry+1e-6;x<=duration;x+=1e-6)if(g(x)>0){release=root(g,x-1e-6,x);break;}}
  const P=x=>A*k*(1-tau*Math.exp(-x/tau)/(tau-rho));
  const voltage=t=>{const x=t-delay;if(x<=0)return 0;if(entry===null||x<=entry)return initial(x);
    if(release===null||x<=release)return limited(x);
    return P(x)+(limited(release)-P(release))*Math.exp(-(x-release)/rho);};
  const F0=x=>A*k*(x+(tau*tau*Math.exp(-x/tau)-rho*rho*Math.exp(-x/rho))/(tau-rho));
  const F1=x=>I*R*x-(initial(entry)-I*R)*R*C*Math.exp(-(x-entry)/(R*C));
  const F2=x=>A*k*(x+tau*tau*Math.exp(-x/tau)/(tau-rho))
    -(limited(release)-P(release))*rho*Math.exp(-(x-release)/rho);
  const integrate=(F,a,b)=>F(b)-F(a),x=duration-delay;
  const e=entry===null?x:Math.min(x,entry),l=release===null?x:Math.min(x,release);
  const integral=integrate(F0,0,e)+(entry===null||x<=entry?0:integrate(F1,entry,l))
    +(release===null||x<=release?0:integrate(F2,release,x));
  return {voltage,mean:integral/duration,entry:entry===null?null:entry+delay,
    release:release===null?null:release+delay};
}

test('bounded ADP7118 precision installed CLI qualifies actual work, RC waveform and signed meter means', () => {
  const dir=mkdtempSync(join(tmpdir(),'bwc-adp-precision-'));
  const env={...process.env};delete env.BW_BOARD;
  try {
    for(const [name,ohms,farads] of [['overload',10,2.2e-6],['inrush',500,22e-6]]) {
      const source=join(dir,`${name}.json`),csv=join(dir,`${name}.csv`);
      writeFileSync(source,JSON.stringify(adp7118StartupCliFixture({ohms,farads,startupModel:'current-limited-envelope'})));
      const currents=['vout_1','vout_2','vin_7','vin_8','gnd'];
      const result=spawnSync(process.execPath,[CLI,'measure',source,
        '--scope','U.vout_1,G.gnd','--meter','voltage:U.vout_1,G.gnd',
        ...currents.flatMap(terminal=>['--meter',`current:U.${terminal}`]),
        '--duration','1200us','--rate','100kHz','--profile','precision-v1',
        '--initial','zero-state','--csv',csv,'--json'],{encoding:'utf8',env,timeout:30000});
      assert.equal(result.status,0,result.stderr);
      const report=JSON.parse(result.stdout),reference=limitedStartupReference(ohms,farads);
      assert.equal(report.scope[0].summary.samples,120);
      assert.equal(report.transient.accuracyMet,true);
      const budget=report.precisionCapture,receipt=report.transient.boundedAdvance;
      assert.equal(budget.basis,'engine-whole-advance-adp7118-current-limited');
      assert.equal(receipt.completed,true);assert.equal(receipt.failure,null);
      assert.equal(receipt.requestedTimeNs,'1200000');
      assert.deepEqual(receipt.limits,{maxAttempts:20000,maxSolves:60001,maxAdvances:200});
      assert.ok(receipt.work.advances>100,'timed device genuinely subdivides the capture');
      validatePrecisionCaptureWork(report.transient,budget);
      const lines=readFileSync(csv,'utf8').trim().split('\n');assert.equal(lines.length,122);
      const startNs=BigInt(lines[0].match(/startTimeNs=(\d+)/)[1]);assert.equal(startNs,10000n);
      for(const [i,line] of lines.slice(2).entries()) {
        const [elapsed,volts]=line.split(',').map(Number);
        assert.equal(elapsed,i*10000/1e9);
        assert.ok(Math.abs(volts-reference.voltage(Number(startNs)/1e9+elapsed))<=5e-7,
          `${name} independent RC waveform sample ${i}: ${volts}`);
      }
      const values=report.meters.map(row=>{assert.equal(row.reading.note,null);
        assert.equal(row.quantity,'observed-dc-mean');return row.reading.siValue;});
      assert.ok(Math.abs(values[0]-reference.mean)<=1e-6,`${name} independent window integral`);
      const output=values[1]+values[2],input=values[3]+values[4],ground=values[5];
      assert.ok(output>0 && output<=.36 && input<0 && ground>0,'physical signed currents');
      assert.ok(Math.abs(output+input+ground)<1e-10,'capture-mean eight-terminal KCL');
      // Integral of C*dV/dt + V/R; independent of terminal current implementation.
      const expectedOutput=farads*reference.voltage(.0012)/.0012+reference.mean/ohms;
      assert.ok(Math.abs(output-expectedOutput)<1e-6,'independent load/storage mean current');
      assert.ok(reference.entry>0);assert.equal(reference.release!==null,name==='inrush');
    }
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('bounded ADP7118 precision refuses escaped domains and publishes no partial artifacts', () => {
  const dir=mkdtempSync(join(tmpdir(),'bwc-adp-precision-refuse-'));
  const env={...process.env};delete env.BW_BOARD;
  try {
    const cases=[
      ['duration',()=>{},['--duration','1201us'],/limits capture to 1.2 ms/],
      ['watch-json',()=>{},['--watch'],/NDJSON/],
      ['legacy',c=>{c.parts.find(p=>p.id==='U').params.startupModel='datasheet-envelope';},[],/refuses part U/],
      ['second',c=>c.parts.push({id:'U2',kind:'adp7118',params:{startupModel:'current-limited-envelope'}}),[],/multiple ADP7118/],
      ['timed',c=>c.parts.push({id:'timer',kind:'555'}),[],/refuses part timer/],
      ['inductor',c=>c.parts.push({id:'L',kind:'inductor'}),[],/refuses part L/],
      ['waveform',c=>{c.parts[0].params.wave='sine';},[],/static DC source VIN/],
      ['ic',c=>{c.parts.find(p=>p.id==='C').params.initialVoltage=0;},[],/initial conditions/],
      ['unbonded',c=>{c.wires=c.wires.filter(w=>w.toTerminal!=='vin_8');},[],/ADP7118/],
      ['headroom',c=>{c.parts[0].params.volts=5;},[],/ADP7118/],
    ];
    for(const [name,edit,extra,reason] of cases) {
      const fixture=adp7118StartupCliFixture({farads:22e-6,startupModel:'current-limited-envelope'});edit(fixture);
      const source=join(dir,`${name}.json`),csv=join(dir,`${name}.csv`);
      writeFileSync(source,JSON.stringify(fixture));
      const result=spawnSync(process.execPath,[CLI,'measure',source,'--scope','U.vout_1,G.gnd',
        '--duration','1200us','--rate','100kHz','--profile','precision-v1','--initial','zero-state',
        '--json','--csv',csv,...extra],{encoding:'utf8',env,timeout:30000});
      assert.equal(result.status,2,`${name}: ${result.stderr}`);assert.match(result.stderr,reason);
      assert.equal(result.stdout,'');assert.equal(existsSync(csv),false);
    }
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('bounded ADP7118 precision receipt judge rejects missing, forged and incomplete actual-work receipts', () => {
  const profile={id:'precision-v1',maxAttempts:20000,maxStepSec:1e-5};
  const budget=precisionCaptureBudget(measurementSampleClock(.0012,1e5),profile,5,'adp7118-current-limited');
  const limits={maxAttempts:20000,maxSolves:60001,maxAdvances:200};
  const status={profile,work:{attempts:400,solves:1200,advances:120},accuracyMet:true,failure:null,
    boundedAdvance:{limits,work:{attempts:400,solves:1400,advances:120},completed:true,failure:null,requestedTimeNs:'1200000'}};
  validatePrecisionCaptureWork(status,budget);
  for(const bad of [undefined,{...status.boundedAdvance,completed:false},
    {...status.boundedAdvance,failure:'whole-advance-budget-exceeded'},
    {...status.boundedAdvance,requestedTimeNs:'1200001'},
    {...status.boundedAdvance,limits:{...limits,maxSolves:60002}},
    {...status.boundedAdvance,work:{...status.boundedAdvance.work,solves:60002}},
    {...status.boundedAdvance,work:{...status.boundedAdvance.work,solves:1199}},
    {...status.boundedAdvance,work:{...status.boundedAdvance.work,advances:NaN}}]) {
    assert.throws(()=>validatePrecisionCaptureWork({...status,boundedAdvance:bad},budget),/whole-advance receipt/);
  }
});

test('bounded ADP7118 precision actual CLI requires native API, enforcement and completion receipt', () => {
  const dir=mkdtempSync(join(tmpdir(),'bwc-adp-budget-mutations-'));
  const env={...process.env};delete env.BW_BOARD;
  try {
    const source=join(dir,'fixture.json');
    writeFileSync(source,JSON.stringify(adp7118StartupCliFixture({farads:22e-6,startupModel:'current-limited-envelope'})));
    const circuitUrl=new URL('../src/model/circuit.js',import.meta.url).href;
    const boardUrl=new URL('../node_modules/bw-board/src/board.js',import.meta.url).href;
    for(const [name,preload,reason] of [
      ['missing-api',`import {BoardImpl} from ${JSON.stringify(boardUrl)}; delete BoardImpl.prototype.advanceToBounded;`,/does not provide whole-advance budgets/],
      ['budget-exhaustion',`import {Circuit} from ${JSON.stringify(circuitUrl)};
        const original=Circuit.prototype.advanceToBounded;
        Circuit.prototype.advanceToBounded=function(t,limits){return original.call(this,t,{...limits,maxSolves:1});};`,/whole-advance.*budget/i],
      ['ordinary-advance-bypass',`import {Circuit} from ${JSON.stringify(circuitUrl)};
        Circuit.prototype.advanceToBounded=function(t){this.advanceTo(t);};`,/unqualified whole-advance receipt/],
    ]) {
      const module=join(dir,`${name}.mjs`),csv=join(dir,`${name}.csv`);
      writeFileSync(module,preload);
      const result=spawnSync(process.execPath,['--import',module,CLI,'measure',source,
        '--scope','U.vout_1,G.gnd','--duration','1200us','--rate','100kHz',
        '--profile','precision-v1','--initial','zero-state','--json','--csv',csv],
      {encoding:'utf8',env,timeout:30000});
      assert.equal(result.status,2,`${name}: ${result.stderr}`);assert.match(result.stderr,reason);
      assert.equal(result.stdout,'');assert.equal(existsSync(csv),false);
    }
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('bounded Circuit proxy preserves actual clock on failure and cannot fall back to ordinary advance', async () => {
  const {Circuit}=await import('../src/model/circuit.js');
  const circ=Object.create(Circuit.prototype),failure=new Error('real budget failure');
  circ.timeNs=0n;
  circ.board={timeNs:0n,advanceTo(){assert.fail('ordinary advance is not authorized');}};
  assert.throws(()=>circ.advanceToBounded(1200000n,{}),/does not provide whole-advance budgets/);
  circ.board.advanceToBounded=function(){this.timeNs=5000n;throw failure;};
  assert.throws(()=>circ.advanceToBounded(1200000n,{}),error=>error===failure);
  assert.equal(circ.timeNs,5000n,'failed capture must not claim requested endpoint');
});

test('finite ADP precision watch publishes provisional actual-time readings and qualified independent RC means', () => {
  const dir=mkdtempSync(join(tmpdir(),'bwc-adp-stream-'));
  const env={...process.env};delete env.BW_BOARD;
  try {
    for(const [name,ohms,farads] of [['overload',10,2.2e-6],['inrush',500,22e-6]]) {
      const source=join(dir,`${name}.json`);
      writeFileSync(source,JSON.stringify(adp7118StartupCliFixture({ohms,farads,startupModel:'current-limited-envelope'})));
      for(const rate of ['100kHz','45kHz']) {
        const result=spawnSync(process.execPath,[CLI,'measure',source,'--watch',
          '--scope','U.vout_1,G.gnd','--meter','voltage:U.vout_1,G.gnd',
          ...['vout_1','vout_2','vin_7','vin_8','gnd'].flatMap(t=>['--meter',`current:U.${t}`]),
          '--duration','1200us','--rate',rate,'--profile','precision-v1','--initial','zero-state'],
        {encoding:'utf8',env,timeout:30000});
        assert.equal(result.status,0,result.stderr);
        const rows=result.stdout.trim().split('\n').map(line=>JSON.parse(line));
        const summary=rows.pop(),reference=limitedStartupReference(ohms,farads);
        const step=rate==='100kHz'?10000n:22222n;
        assert.equal(summary.recordType,'summary');assert.equal(summary.qualified,true);
        assert.equal(rows.length,Number((1200000n+step-1n)/step));
        for(const [index,row] of rows.entries()) {
          assert.equal(row.recordType,'sample');assert.equal(row.qualified,false);assert.equal(row.index,index);
          const endpoint=(BigInt(index+1)*step)>1200000n?1200000n:BigInt(index+1)*step;
          assert.equal(row.timeSeconds,Number(endpoint)/1e9);
          // A short final chunk may report the latest real scope point, not a fabricated endpoint sample.
          const scopeTime=Number(endpoint/step*step)/1e9;
          assert.equal(row.scope[0].timeSeconds,scopeTime);
          assert.ok(Math.abs(row.scope[0].volts-reference.voltage(scopeTime))<.5e-6,`${name}/${rate}/${index}`);
        }
        const report=summary.report;
        validatePrecisionStreamWork(report.transient,report.precisionCapture,rows.length,1200000n);
        assert.ok(Math.abs(report.meters[0].reading.siValue-reference.mean)<1e-6);
        const current=Object.fromEntries(report.meters.slice(1).map(r=>[r.probes[0].split('.')[1],r.reading.siValue]));
        const output=current.vout_1+current.vout_2;
        assert.ok(Math.abs(output-(reference.mean/ohms+farads*reference.voltage(.0012)/.0012))<2e-6);
        assert.ok(Math.abs(Object.values(current).reduce((sum,value)=>sum+value,0))<1e-9);
      }
    }
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('finite stream receipt and admission reject wrong count, step, endpoint and missing authority with a guard mutant', async () => {
  const profile={id:'precision-v1',maxAttempts:20000,maxStepSec:1e-5};
  const clock=measurementSampleClock(.0012,1e5);
  const budget=precisionStreamBudget(clock,precisionCaptureBudget(clock,profile,5,'adp7118-current-limited'),'adp7118-current-limited');
  assert.throws(()=>precisionStreamBudget(clock,budget,'passive-source'),/bounded ADP7118/);
  assert.throws(()=>precisionStreamBudget(measurementSampleClock(.0012,2e5),budget,'adp7118-current-limited'),/200 observations/);
  const status={profile,work:{attempts:400,solves:1200,advances:120},accuracyMet:true,failure:null,
    boundedAdvance:{limits:{maxAttempts:20000,maxSolves:60001,maxAdvances:200},
      work:{attempts:400,solves:1400,advances:120},completed:true,failure:null,
      requestedTimeNs:'1200000',stream:{stepNs:'10000',observerCalls:120}}};
  validatePrecisionStreamWork(status,budget,120,1200000n);
  for(const stream of [undefined,{stepNs:'10001',observerCalls:120},{stepNs:'10000',observerCalls:119}]) {
    assert.throws(()=>validatePrecisionStreamWork({...status,boundedAdvance:{...status.boundedAdvance,stream}},budget,120,1200000n),/finite stream receipt/);
  }
  assert.throws(()=>validatePrecisionStreamWork(status,budget,119,1200000n),/finite stream receipt/);
  assert.throws(()=>validatePrecisionStreamWork(status,budget,120,1199999n),/finite stream receipt/);
  const source=readFileSync(join(ROOT,'src/model/instrument-report.js'),'utf8');
  const anchor='if (!budget.stream || !stream || stream.stepNs !== budget.stream.stepNs';
  assert.equal(source.split(anchor).length-1,1);
  const mutant=await import(`data:text/javascript;base64,${Buffer.from(source.replace(anchor,'if (false && (!budget.stream || !stream || stream.stepNs !== budget.stream.stepNs')
    .replace('String(timeNs) !== budget.requestedTimeNs) {','String(timeNs) !== budget.requestedTimeNs)) {')).toString('base64')}`);
  const oracle=judge=>assert.throws(()=>judge(status,budget,119,1200000n),/finite stream receipt/);
  oracle(validatePrecisionStreamWork);
  assert.throws(()=>oracle(mutant.validatePrecisionStreamWork),{name:'AssertionError'});
});

test('finite precision actual CLI fails late with a terminal receipt, and reset/bypass mutants fail real caller oracles', () => {
  const dir=mkdtempSync(join(tmpdir(),'bwc-adp-stream-refuse-'));
  const env={...process.env};delete env.BW_BOARD;
  try {
    const source=join(dir,'fixture.json');
    writeFileSync(source,JSON.stringify(adp7118StartupCliFixture({ohms:500,farads:22e-6,startupModel:'current-limited-envelope'})));
    const circuitUrl=new URL('../src/model/circuit.js',import.meta.url).href;
    const boardUrl=new URL('../node_modules/bw-board/src/board.js',import.meta.url).href;
    const limited=`import {Circuit} from ${JSON.stringify(circuitUrl)};
      const original=Circuit.prototype.advanceToBoundedStream;
      Circuit.prototype.advanceToBoundedStream=function(t,limits,options){return original.call(this,t,{...limits,maxAdvances:2},options);};`;
    const run=(name,preload,rate='100kHz')=>{
      const module=join(dir,`${name}.mjs`),csv=join(dir,`${name}.csv`),receipt=join(dir,`${name}.json`);
      writeFileSync(module,preload);
      const result=spawnSync(process.execPath,['--import',module,CLI,'measure',source,
        '--scope','U.vout_1,G.gnd','--watch','--duration','1200us','--rate',rate,
        '--profile','precision-v1','--initial','zero-state','--csv',csv,'--receipt',receipt],
      {encoding:'utf8',env,timeout:30000});
      const rows=result.stdout.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
      return {result,rows,csv,receipt};
    };
    const lateOracle=({result,rows,csv,receipt})=>{
      assert.equal(result.status,2,result.stderr);
      const failure=rows.at(-1);
      assert.equal(failure.recordType,'failure');assert.equal(failure.qualified,false);
      assert.ok(rows.length>1,'real observations precede late failure');
      assert.ok(failure.timeSeconds>0&&failure.timeSeconds<.0012);
      assert.equal(failure.transient.boundedAdvance.completed,false);
      assert.match(failure.error,/budget/i);
      assert.equal(existsSync(csv),false);assert.equal(existsSync(receipt),false);
      assert.ok(rows.every(row=>row.recordType!=='summary'&&row.qualified===false));
    };
    lateOracle(run('late',limited));
    // Misaligned chunks add native integrator entries; <=200 callbacks is not a work certificate.
    lateOracle(run('unaligned-real-budget','', '90kHz'));
    const reset=`import {BoardImpl} from ${JSON.stringify(boardUrl)};
      const advance=BoardImpl.prototype.advanceTo;
      BoardImpl.prototype.advanceTo=function(t){const c=this._boundedAdvanceContext;
        if(c?.stream&&!c.observing)c.work={attempts:0,solves:0,advances:0};return advance.call(this,t);};`;
    assert.throws(()=>lateOracle(run('reset-mutant',limited+reset)),{name:'AssertionError'});
    const bypass=`import {Circuit} from ${JSON.stringify(circuitUrl)};
      Circuit.prototype.advanceToBoundedStream=function(t,limits,options){
        for(let time=options.stepNs;time<=t;time+=options.stepNs){this.advanceTo(time);options.onStep({timeNs:time});}};`;
    const bypassOracle=value=>{assert.equal(value.result.status,2);assert.equal(value.rows.at(-1).recordType,'failure');
      assert.match(value.rows.at(-1).error,/whole-advance receipt/);};
    bypassOracle(run('bypass-negative',bypass));
    const missing=run('missing',`import {BoardImpl} from ${JSON.stringify(boardUrl)};delete BoardImpl.prototype.advanceToBoundedStream;`);
    assert.equal(missing.result.status,2);assert.equal(missing.rows.length,1);
    assert.match(missing.rows[0].error,/does not provide bounded streams/);
    const observerFailure=run('observer-failure',`import {BoardImpl} from ${JSON.stringify(boardUrl)};
      const read=BoardImpl.prototype.getScopeData;let reads=0;
      BoardImpl.prototype.getScopeData=function(...args){if(++reads===2)throw new Error('forced observer capture refusal');return read.apply(this,args);};`);
    assert.equal(observerFailure.result.status,2);assert.equal(observerFailure.rows[0].recordType,'sample');
    assert.equal(observerFailure.rows.at(-1).recordType,'failure');
    assert.match(observerFailure.rows.at(-1).error,/forced observer capture refusal/);
    assert.equal(observerFailure.rows.at(-1).transient.boundedAdvance.completed,false);
    assert.equal(existsSync(observerFailure.csv),false);assert.equal(existsSync(observerFailure.receipt),false);
    const badReceipt=run('bad-stream-receipt',`import {BoardImpl} from ${JSON.stringify(boardUrl)};
      const capture=BoardImpl.prototype.advanceToBoundedStream;
      BoardImpl.prototype.advanceToBoundedStream=function(...args){const result=capture.apply(this,args);
        this._lastBoundedAdvance={...result,stream:{stepNs:'1',observerCalls:120}};return result;};`);
    assert.equal(badReceipt.result.status,2);assert.equal(badReceipt.rows.length,121);
    assert.equal(badReceipt.rows.at(-1).recordType,'failure');
    assert.match(badReceipt.rows.at(-1).error,/finite stream receipt/);
    assert.equal(existsSync(badReceipt.csv),false);assert.equal(existsSync(badReceipt.receipt),false);
    const tooMany=run('too-many','', '200kHz');
    assert.equal(tooMany.result.status,2);assert.equal(tooMany.rows.length,0);
    assert.match(tooMany.result.stderr,/200 observations/);
    assert.equal(existsSync(tooMany.csv),false);assert.equal(existsSync(tooMany.receipt),false);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('stream Circuit proxy exposes actual observer and failed partial clocks without ordinary fallback', async () => {
  const {Circuit}=await import('../src/model/circuit.js');
  const c=Object.create(Circuit.prototype),failure=new Error('observer cancellation');
  c.timeNs=0n;c.board={timeNs:0n,advanceTo(){assert.fail('no fallback');}};
  assert.throws(()=>c.advanceToBoundedStream(20n,{},{}),/does not provide bounded streams/);
  c.board.advanceToBoundedStream=function(t,limits,options){this.timeNs=10n;options.onStep({timeNs:10n});};
  assert.throws(()=>c.advanceToBoundedStream(20n,{}, {stepNs:10n,onStep:()=>{assert.equal(c.timeNs,10n);throw failure;}}),e=>e===failure);
  assert.equal(c.timeNs,10n);
});

test('bounded receipt guard mutation makes the missing-receipt refusal assertion red', async () => {
  const source=readFileSync(join(ROOT,'src/model/instrument-report.js'),'utf8');
  const anchor="if (budget.basis==='engine-whole-advance-adp7118-current-limited') {";
  assert.equal(source.split(anchor).length-1,1);
  const mutated=await import(`data:text/javascript;base64,${Buffer.from(source.replace(anchor,'if (false) {')).toString('base64')}`);
  const profile={id:'precision-v1',maxAttempts:20000,maxStepSec:1e-5};
  const budget=precisionCaptureBudget(measurementSampleClock(.0012,1e5),profile,5,'adp7118-current-limited');
  const status={profile,work:{attempts:1,solves:3,advances:1},accuracyMet:true,failure:null};
  const oracle=judge=>assert.throws(()=>judge(status,budget),/whole-advance receipt/);
  oracle(validatePrecisionCaptureWork);
  assert.throws(()=>oracle(mutated.validatePrecisionCaptureWork),{name:'AssertionError'},
    'removing receipt admission must fail its executable refusal oracle');
});

test('ADP7118 startup uses the installed pinned package for real CLI scope and meter mean', () => {
  const dir = mkdtempSync(join(tmpdir(),'bwc-adp7118-installed-'));
  const env = {...process.env}; delete env.BW_BOARD;
  try {
    const source = join(dir,'startup.json');
    const csv = join(dir,'startup.csv');
    const saved = join(dir,'receipt.json');
    writeFileSync(source,JSON.stringify(adp7118StartupCliFixture()));
    const result = spawnSync(process.execPath,[CLI,'measure',source,
      '--scope','U.vout_1,G.gnd','--meter','voltage:U.vout_1,G.gnd',
      '--duration','1200us','--rate','100kHz','--csv',csv,
      '--receipt',saved,'--json'],{encoding:'utf8',env,timeout:30000});
    assert.equal(result.status,0,result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.transient.accuracyMet,true,JSON.stringify(report.transient));
    assert.equal(report.transient.failure,null);
    assert.equal(report.plannedSamples,120);
    assert.equal(report.scope.length,1);
    assert.equal(report.scope[0].summary.samples,120);
    assert.equal(report.scope[0].capture,'sample');
    assert.equal(report.scope[0].sampleIntervalSeconds,10e-6);

    // Independent closed-form solution of the authored envelope driving
    // actual 0.05 ohm / 500 ohm / 2.2 uF; not a vendor macromodel oracle.
    const tau = (380e-6-80e-6)/Math.log(9);
    const delay = Math.round((80e-6+tau*Math.log(.9))*1e9)/1e9;
    const gain = 500/(500+.05);
    const rc = (.05*500/(500+.05))*2.2e-6;
    const expectedVoltage = time => {
      const x = time-delay;
      return x <= 0 ? 0 : 5*gain*(1-
        (tau*Math.exp(-x/tau)-rc*Math.exp(-x/rc))/(tau-rc));
    };
    const lines = readFileSync(csv,'utf8').trim().split('\n');
    assert.equal(lines.length,122,'one header, one column row, 120 observations');
    assert.match(lines[0],/capture=sample/);
    assert.match(lines[0],/sampleIntervalNs=10000 points=120$/);
    const match = lines[0].match(/startTimeNs=(\d+)/);
    assert.ok(match,'CSV must carry actual acquisition origin');
    const startNs = BigInt(match[1]);
    assert.equal(startNs,10000n,'first engine-clock sample is at 10 us');
    assert.equal(report.scope[0].startTimeSeconds,Number(startNs)/1e9);
    assert.equal(lines[1],'elapsed_seconds,volts');
    for (const [index,line] of lines.slice(2).entries()) {
      const values = line.split(',').map(Number);
      assert.equal(values.length,2);
      const [elapsed,volts] = values;
      assert.ok(Number.isFinite(elapsed) && Number.isFinite(volts));
      assert.equal(elapsed,index*10000/1e9,'all CSV observation timestamps checked');
      const time = Number(startNs)/1e9+elapsed;
      assert.ok(Math.abs(volts-expectedVoltage(time))<.001,
        `sample ${index} at ${time}: ${volts} versus closed-form ${expectedVoltage(time)}`);
    }
    const duration = .0012;
    const x = duration-delay;
    const expectedMean = 5*gain*(x-
      (tau*tau*(1-Math.exp(-x/tau))-rc*rc*(1-Math.exp(-x/rc)))/(tau-rc))/duration;
    assert.equal(report.meters.length,1);
    assert.equal(report.meters[0].quantity,'observed-dc-mean');
    assert.equal(report.meters[0].reading.siUnit,'V');
    assert.ok(Number.isFinite(report.meters[0].reading.siValue));
    assert.ok(Math.abs(report.meters[0].reading.siValue-expectedMean)<.0001,
      'meter must judge capture-window mean, not final output voltage');
    assert.ok(Math.abs(report.meters[0].reading.siValue-
      report.scope[0].summary.lastVolts)>.5,'mean and endpoint are distinct');

    const receipt = JSON.parse(readFileSync(saved,'utf8'));
    const provenance = JSON.parse(readFileSync(join(ROOT,'scripts','board-provenance.json'),'utf8'));
    const pkg = JSON.parse(readFileSync(join(ROOT,'package.json'),'utf8'));
    assert.match(provenance.commit,/^[a-f0-9]{40}$/);
    assert.equal(pkg.devDependencies['bw-board'],
      `github:CrispStrobe/bw-board#${provenance.commit}`);
    assert.equal(receipt.engine.selection,'installed package');
    assert.equal(receipt.engine.declaredPackageSpec,pkg.devDependencies['bw-board']);
    assert.equal(receipt.engine.observed.jsJsonTreeSha256,provenance.runtimeTreeSha256);
    assert.equal(receipt.invocation.BW_BOARD,null);
    assert.equal(receipt.clock.startNs,'0');
    assert.equal(receipt.clock.durationNs,'1200000');
    assert.equal(receipt.clock.intervalNs,'10000');
    assert.deepEqual(receipt.report,report);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('ADP7118 startup installed CLI refuses reactive overload, inrush and precision admission honestly', () => {
  const dir = mkdtempSync(join(tmpdir(),'bwc-adp7118-refusal-'));
  const env = {...process.env}; delete env.BW_BOARD;
  const run = argv => spawnSync(process.execPath,[CLI,'measure',...argv],
    {encoding:'utf8',env,timeout:30000});
  try {
    for (const [name,options] of [
      ['overload',{ohms:10}], ['high-inrush',{farads:22e-6}],
    ]) {
      const source = join(dir,`${name}.json`);
      const csv = join(dir,`${name}.csv`);
      writeFileSync(source,JSON.stringify(adp7118StartupCliFixture(options)));
      const result = run([source,'--scope','U.vout_1,G.gnd',
        '--meter','voltage:U.vout_1,G.gnd','--duration','1200us',
        '--rate','100kHz','--csv',csv,'--json']);
      assert.equal(result.status,2,`${name}: ${result.stderr}`);
      assert.match(result.stderr,/ADP7118.*current-limited startup transient is unqualified/);
      assert.equal(result.stdout,'',`${name}: no plausible successful numeric JSON`);
      assert.equal(existsSync(csv),false,`${name}: no numeric CSV published after refusal`);
    }
    const normal = join(dir,'precision.json');
    writeFileSync(normal,JSON.stringify(adp7118StartupCliFixture()));
    const precision = run([normal,'--scope','U.vout_1,G.gnd',
      '--duration','1200us','--rate','100kHz','--profile','precision-v1',
      '--initial','zero-state','--json']);
    assert.equal(precision.status,2,precision.stderr);
    assert.match(precision.stderr,/precision batch refuses part U \(adp7118\)/);
    assert.equal(precision.stdout,'','timed model must not sneak into passive-only precision admission');
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('live transient solver exception refuses batch/watch without a false successful final report', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bwc-live-fault-'));
  try {
    const fixture = join(dir, 'fault.cir');
    writeFileSync(fixture, '* source becomes inconsistent after 10 us\nV1 n 0 1\nVBAD 0 0 PULSE(0 1 10u 1u 1u 10u 100u)\nR1 n 0 1k\n.end\n');
    for (const watch of [false, true]) {
      const run = spawnSync(process.execPath, [CLI, 'measure', fixture, '--scope', 'V1.pos,V1.neg',
        '--meter', 'voltage:V1.pos,V1.neg', '--duration', '20us', '--rate', '1MHz', watch ? '--watch' : '--json'],
      { encoding: 'utf8', timeout: 15000 });
      assert.equal(run.status, 2, run.stderr);
      assert.match(run.stderr, /^bwc: measure simulation failed:.*inconsistent ideal voltage constraint VBAD/);
      if (!watch) assert.equal(run.stdout, '', 'batch must not serialize an invalid final capture');
      else {
        const records = run.stdout.trim() ? run.stdout.trim().split('\n').map(line => JSON.parse(line)) : [];
        assert.ok(records.length > 0, 'valid early watch observations are exercised');
        for (const row of records) {
          assert.equal(row.recordType, 'sample', 'no successful final report after a live fault');
          assert.ok(row.elapsedSeconds <= 10e-6);
          assert.equal(row.scope[0].volts, 1);
          assert.equal(row.meters[0].reading.siValue, 1);
        }
      }
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('failed live measurement refuses scope-only and meter captures cleanly in batch/watch; valid zero stays numeric', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bwc-failed-solve-'));
  try {
    for (const otherVolts of [1, 2]) {
      const fixture = join(dir, `parallel-${otherVolts}.cir`);
      writeFileSync(fixture, `* singular or inconsistent independent sources\nVA n 0 1\nVB n 0 ${otherVolts}\nRLOAD n 0 1k\n.end\n`);
      for (const watch of [false, true]) for (const request of [
        ['--scope', 'VA.pos,VA.neg'],
        ['--meter', 'voltage:VA.pos,VA.neg'],
        ['--meter', 'current:RLOAD.a'],
      ]) {
        const result = spawnSync(process.execPath, [CLI, 'measure', fixture, ...request,
          '--duration', '1ms', '--rate', '1kHz', watch ? '--watch' : '--json'], { encoding: 'utf8', timeout: 15000 });
        assert.equal(result.error, undefined);
        assert.equal(result.status, 2, `${otherVolts} V ${request[0]} ${watch}: ${result.stderr}`);
        assert.equal(result.stdout, '', 'failed capture cannot emit fabricated numeric observations');
        assert.match(result.stderr, /^bwc: .*?(?:capture unavailable:.*solve failed|Cannot read (?:voltage|current))/);
        assert.doesNotMatch(result.stderr, /at BoardImpl|file:\/\/|Node\.js/, 'normal CLI diagnostic, not uncaught stack trace');
      }
    }
    const zero = join(dir, 'valid-zero.cir');
    writeFileSync(zero, '* valid determinate zero\nVA n 0 0\nRLOAD n 0 1k\n.end\n');
    for (const watch of [false, true]) {
      const result = spawnSync(process.execPath, [CLI, 'measure', zero, '--scope', 'VA.pos,VA.neg',
        '--meter', 'voltage:VA.pos,VA.neg', '--meter', 'current:RLOAD.a',
        '--duration', '1ms', '--rate', '1kHz', watch ? '--watch' : '--json'], { encoding: 'utf8', timeout: 15000 });
      assert.equal(result.status, 0, result.stderr);
      const records = watch ? result.stdout.trim().split('\n').map(line => JSON.parse(line)) : [JSON.parse(result.stdout)];
      const report = watch ? records.at(-1).report : records[0];
      assert.equal(report.scope[0].summary.minVolts, 0);
      for (const row of report.meters) { assert.equal(Math.abs(row.reading.siValue), 0); assert.equal(row.reading.note, null); }
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const acReference = () => ({schemaVersion:1,analyses:[{analysisId:'0:ac',frequenciesHz:[10,100],
  nodes:[{id:'n0',unit:'V',absoluteTolerance:1e-12,relativeTolerance:0,real:[-1,0],imaginary:[0,0]}]}]});
const acActual = () => [{analysisId:'0:ac',kind:'ac',status:'pass',observables:{
  axis:{quantity:'frequency',unit:'Hz',values:[10,100]},
  nodes:[{id:'n0',magnitude:[1,0],phaseDeg:[180,123]}]}}];

test('AC reference validates bounded complete typed grids and finite tolerances',()=>{
  assert.equal(parseExpectedAc(JSON.stringify(acReference())).analyses.length,1);
  const reject=edit=>{const value=acReference();edit(value);assert.throws(()=>parseExpectedAc(JSON.stringify(value)),/AC reference/);};
  reject(v=>v.schemaVersion=2);reject(v=>v.analyses=[]);reject(v=>v.analyses=Array(9).fill(v.analyses[0]));
  reject(v=>v.analyses.push(structuredClone(v.analyses[0])));
  reject(v=>v.analyses[0].analysisId='');reject(v=>v.analyses[0].frequencyToleranceHz=-1);
  reject(v=>v.analyses[0].frequenciesHz=[100,10]);reject(v=>v.analyses[0].frequenciesHz=[10,10]);
  reject(v=>v.analyses[0].frequenciesHz=[0,100]);reject(v=>v.analyses[0].frequenciesHz=Array(4097).fill(10));
  reject(v=>v.analyses[0].nodes=[]);reject(v=>v.analyses[0].nodes[0].unit='A');
  reject(v=>v.analyses[0].nodes.push(structuredClone(v.analyses[0].nodes[0])));
  reject(v=>v.analyses[0].nodes[0].real=[0]);reject(v=>v.analyses[0].nodes[0].imaginary=[0,null]);
  reject(v=>delete v.analyses[0].nodes[0].absoluteTolerance);
  reject(v=>v.analyses[0].nodes[0].absoluteTolerance=-1);reject(v=>v.analyses[0].nodes[0].relativeTolerance='1');
  assert.throws(()=>parseExpectedAc(' '.repeat(4*1024*1024)+JSON.stringify(acReference())),/4 MiB/);
  const large=acReference();large.analyses[0].frequenciesHz=Array.from({length:4096},(_,i)=>i+1);
  large.analyses[0].nodes=Array.from({length:49},(_,i)=>({id:`n${i}`,unit:'V',absoluteTolerance:0,
    real:Array(4096).fill(0),imaginary:Array(4096).fill(0)}));
  assert.throws(()=>parseExpectedAc(JSON.stringify(large)),/200000/);
});

test('AC comparison checks all complex observations, identities, statuses and axes without phase-wrap false failures',()=>{
  const expected=parseExpectedAc(JSON.stringify(acReference()));
  const run=edit=>{const value=acActual();edit?.(value);return compareExpectedAc(value,expected);};
  assert.equal(run().status,'pass');
  assert.equal(run(v=>v[0].observables.nodes[0].phaseDeg[0]=-180).status,'pass');
  for(const edit of [v=>v.pop(),v=>v.push(structuredClone(v[0])),v=>v[0].status='refused',
    v=>v[0].analysisId='1:ac',v=>v[0].observables.axis.unit='s',v=>v[0].observables.axis.quantity='time',
    v=>v[0].observables.axis.values.pop(),v=>v[0].observables.axis.values.push(101),
    v=>v[0].observables.axis.values[1]=10,v=>v[0].observables.axis.values[1]+=1,
    v=>v[0].observables.nodes[0].id='n1',v=>v[0].observables.nodes=[],
    v=>v[0].observables.nodes.push(structuredClone(v[0].observables.nodes[0])),
    v=>v[0].observables.nodes[0].magnitude.pop(),v=>v[0].observables.nodes[0].phaseDeg.push(0)]) {
    const result=run(edit);assert.equal(result.status,'fail');assert.ok(result.structuralFailures>0);
  }
  for(const edit of [v=>v[0].observables.nodes[0].magnitude[0]=-1,
    v=>v[0].observables.nodes[0].magnitude[0]=Infinity,
    v=>v[0].observables.nodes[0].phaseDeg[0]=NaN,
    v=>v[0].observables.nodes[0].phaseDeg[0]=0]) {
    const result=run(edit);assert.equal(result.status,'fail');assert.equal(result.failed,1);
  }
  const relative=acReference();relative.analyses[0].nodes[0].relativeTolerance=.6;
  const doubled=acActual();doubled[0].observables.nodes[0].magnitude[0]=2;
  assert.equal(compareExpectedAc(doubled,parseExpectedAc(JSON.stringify(relative))).failed,1,
    'relative allowance scales from the reference, not a wrong large actual voltage');
  const overflow=acReference();overflow.analyses[0].nodes[0].relativeTolerance=1e308;
  overflow.analyses[0].nodes[0].real[0]=1e308;
  assert.equal(compareExpectedAc(acActual(),parseExpectedAc(JSON.stringify(overflow))).status,'fail');
  const bounded=acReference();bounded.analyses[0].frequenciesHz=Array.from({length:50},(_,i)=>i+1);
  bounded.analyses[0].nodes[0].real=Array(50).fill(1);bounded.analyses[0].nodes[0].imaginary=Array(50).fill(0);
  const many=acActual();many[0].observables.axis.values=bounded.analyses[0].frequenciesHz;
  many[0].observables.nodes[0].magnitude=Array(50).fill(2);many[0].observables.nodes[0].phaseDeg=Array(50).fill(0);
  const result=compareExpectedAc(many,parseExpectedAc(JSON.stringify(bounded)));
  assert.equal(result.failed,50);assert.equal(result.mismatches.length,20);
  const multi=acReference();multi.analyses.push({...structuredClone(multi.analyses[0]),analysisId:'2:ac'});
  assert.equal(compareExpectedAc([...acActual(),{...acActual()[0],analysisId:'2:ac'}],
    parseExpectedAc(JSON.stringify(multi))).compared,4);
});

test('actual CLI AC comparisons preserve execution, report numerical/structural failures and refuse malformed references',()=>{
  const dir=mkdtempSync(join(tmpdir(),'bwc-ac-reference-'));
  try {
    const deck=join(dir,'input.cir'),path=join(dir,'reference.json');
    const unitBody='AC unit voltage\nV1 signal 0 DC 0 AC 1 180\nR1 signal 0 1000\n.ac lin 3 10 100\n';
    writeFileSync(deck,unitBody+'.end\n');
    const reference=acReference();reference.analyses[0].frequenciesHz=[10,55,100];
    reference.analyses[0].nodes[0].real=[-1,-1,-1];reference.analyses[0].nodes[0].imaginary=[0,0,0];
    writeFileSync(path,JSON.stringify(reference));
    const run=(args=[])=>spawnSync(process.execPath,[CLI,'analyze',deck,'--profile','precision-v1',
      '--expect-ac',path,...args],{encoding:'utf8'});
    const plain=spawnSync(process.execPath,[CLI,'analyze',deck,'--profile','precision-v1','--json'],{encoding:'utf8'});
    const baseline=run(['--json']);assert.equal(baseline.status,0,baseline.stderr);
    const report=JSON.parse(baseline.stdout);assert.deepEqual(report.results,JSON.parse(plain.stdout).results);
    assert.equal(report.acComparison.status,'pass');assert.equal(report.acComparison.compared,3);
    assert.equal(report.acComparison.claims.independentOracle,false);
    assert.equal(report.acComparison.claims.terminalCurrents,false);
    assert.match(run().stdout,/AC reference PASS: 3\/3/);
    const empty=spawnSync(process.execPath,[CLI,'analyze',deck,'--profile','precision-v1','--expect-ac',''],{encoding:'utf8'});
    assert.equal(empty.status,2);assert.match(empty.stderr,/invalid AC reference/);
    writeFileSync(deck,unitBody+'.op\n.ac lin 3 10 100\n.end\n');
    const missing=run(['--json']);assert.equal(missing.status,1);
    assert.ok(JSON.parse(missing.stdout).acComparison.structuralFailures>0);
    const multiple=structuredClone(reference);
    multiple.analyses.push({...structuredClone(multiple.analyses[0]),analysisId:'2:ac'});
    writeFileSync(path,JSON.stringify(multiple));
    const complete=run(['--json']);assert.equal(complete.status,0,complete.stderr+complete.stdout);
    assert.equal(JSON.parse(complete.stdout).acComparison.compared,6);
    writeFileSync(path,JSON.stringify(reference));
    writeFileSync(deck,unitBody+'.noise V(signal) V1 dec 3 10 100\n.end\n');
    const otherRefusal=run(['--json']);assert.equal(otherRefusal.status,1);
    assert.equal(JSON.parse(otherRefusal.stdout).acComparison.status,'pass',
      'an unrelated native refusal must still fail the command after a successful AC comparison');
    writeFileSync(deck,unitBody+'.end\n');
    reference.analyses[0].nodes[0].imaginary[1]=.01;writeFileSync(path,JSON.stringify(reference));
    const wrong=run(['--json']);assert.equal(wrong.status,1);assert.equal(JSON.parse(wrong.stdout).acComparison.failed,1);
    reference.analyses[0].nodes[0].imaginary[1]=0;reference.analyses[0].frequenciesHz[2]=101;
    writeFileSync(path,JSON.stringify(reference));assert.equal(run(['--json']).status,1);
    delete reference.analyses[0].nodes[0].absoluteTolerance;writeFileSync(path,JSON.stringify(reference));
    const invalid=run(['--json']);assert.equal(invalid.status,2);assert.equal(invalid.stdout,'');
    assert.match(invalid.stderr,/invalid AC reference/);
    writeFileSync(path,' '.repeat(4*1024*1024)+JSON.stringify(acReference()));
    assert.match(run().stderr,/4 MiB/);
    writeFileSync(path,JSON.stringify(acReference()));
    writeFileSync(deck,'DC only\nV1 signal 0 1\nR1 signal 0 1000\n.op\n.end\n');
    assert.equal(run(['--json']).status,1,'compared-zero cannot pass');
    writeFileSync(deck,'Unsupported AC\nV1 signal 0 DC 0 AC 1\nD1 signal 0 DM\n.model DM D\n.ac lin 2 10 100\n.end\n');
    const refused=run(['--json']);assert.equal(refused.status,1);
    assert.equal(JSON.parse(refused.stdout).acComparison.status,'fail');
    const other=spawnSync(process.execPath,[CLI,'info',FIXTURE,'--expect-ac',path],{encoding:'utf8'});
    assert.equal(other.status,2);assert.match(other.stderr,/supported only by analyze/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('actual CLI AC RC and resonant RLC full curves agree with live ngspice and independent complex controls',{
  skip:spawnSync(process.env.NGSPICE||'ngspice',['--version'],{encoding:'utf8'}).status===0?false:
    'ngspice unavailable: no independent AC full-curve comparison ran',
},()=>{
  const dir=mkdtempSync(join(tmpdir(),'bwc-ac-ngspice-'));
  const mul=(a,b)=>[a[0]*b[0]-a[1]*b[1],a[0]*b[1]+a[1]*b[0]];
  const div=(a,b)=>{const d=b[0]**2+b[1]**2;return[(a[0]*b[0]+a[1]*b[1])/d,(a[1]*b[0]-a[0]*b[1])/d];};
  try {
    for(const kind of ['rc','rlc']) {
      const rlc=kind==='rlc',names=rlc?['in','mid','out']:['in','out'];
      const deck=join(dir,`${kind}.cir`),oracle=join(dir,'oracle.cir'),referencePath=join(dir,'reference.json');
      const body=`Independent ${kind} curve\nV1 in 0 DC 0 AC 2 37\nR1 in ${rlc?'mid':'out'} ${rlc?100:1000}\n`
        +(rlc?'L1 mid out 10m\n':'')+'C1 out 0 1u\n.ac lin 201 10 10000\n';
      writeFileSync(deck,body+'.end\n');
      writeFileSync(oracle,body+'.control\nset wr_singlescale\nset wr_vecnames\nset numdgt=17\nrun\n'
        +`wrdata curve.csv ${names.map(n=>`real(v(${n})) imag(v(${n}))`).join(' ')}\n.endc\n.end\n`);
      const ng=spawnSync(process.env.NGSPICE||'ngspice',['-b','oracle.cir'],{cwd:dir,encoding:'utf8',timeout:30000});
      assert.equal(ng.status,0,ng.stderr);
      const rows=readFileSync(join(dir,'curve.csv'),'utf8').trim().split('\n').slice(1)
        .map(line=>line.trim().split(/\s+/).map(Number));
      assert.equal(rows.length,201);assert.ok(rows.every(row=>row.length===1+2*names.length&&row.every(Number.isFinite)));
      const source=[2*Math.cos(37*Math.PI/180),2*Math.sin(37*Math.PI/180)];
      for(const row of rows) {
        const w=2*Math.PI*row[0];
        const zc=[0,-1/(w*1e-6)],zl=[0,w*.01],total=rlc?[100,zl[1]+zc[1]]:[1000,zc[1]];
        const outputs=[source,...(rlc?[mul(source,div([0,zl[1]+zc[1]],total))]:[]),mul(source,div(zc,total))];
        outputs.forEach((value,i)=>assert.ok(Math.hypot(value[0]-row[1+2*i],value[1]-row[2+2*i])<1e-10,
          `${kind} independent complex control ${names[i]} at ${row[0]} Hz`));
      }
      const reference={schemaVersion:1,provenance:{kind:'live-ngspice-plus-independent-impedance'},analyses:[{
        analysisId:'0:ac',frequenciesHz:rows.map(row=>row[0]),frequencyToleranceHz:1e-8,
        nodes:names.map((name,index)=>({id:`n${index}`,unit:'V',absoluteTolerance:1e-9,relativeTolerance:1e-9,
          real:rows.map(row=>row[1+2*index]),imaginary:rows.map(row=>row[2+2*index])}))}]};
      writeFileSync(referencePath,JSON.stringify(reference));
      const run=()=>spawnSync(process.execPath,[CLI,'analyze',deck,'--profile','precision-v1',
        '--expect-ac',referencePath,'--json'],{encoding:'utf8'});
      const measured=run();assert.equal(measured.status,0,measured.stderr+measured.stdout);
      const comparison=JSON.parse(measured.stdout).acComparison;
      assert.equal(comparison.compared,201*names.length);assert.equal(comparison.failed,0);
      reference.analyses[0].nodes.at(-1).imaginary[137]+=.01;
      writeFileSync(referencePath,JSON.stringify(reference));
      const changed=run();assert.equal(changed.status,1);
      const failures=JSON.parse(changed.stdout).acComparison;
      assert.equal(failures.failed,1);assert.equal(failures.mismatches[0].point,137);
    }
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('strict DC sweep grids, admission and typed full-curve comparison refuse false success', () => {
  assert.deepEqual(dcSweepGrid(-1,1,3),[-1,0,1]);
  assert.deepEqual(dcSweepGrid(1,-1,3),[1,0,-1]);
  assert.equal(dcSweepGrid(0,1,501).length,501);
  assert.throws(()=>dcSweepGrid(1,1+Number.EPSILON,3),/floating-point/);
  for (const args of [[0,0,3],[NaN,1,3],[0,Infinity,3],[-1001,1,3],[0,1,1],[0,1,502],[0,1,3.5]]) {
    assert.throws(()=>dcSweepGrid(...args),/DC sweep/);
  }
  const source={id:'V1',kind:'vsource',params:{volts:0}};
  const observation={kind:'voltage',selector:'R1.b',reference:'GND1.gnd',unit:'V'};
  validateDcSweepInput({parts:[source]},'V1',[observation]);
  for (const c of [{parts:[]},{parts:Array(33).fill(source)},{parts:[source],losses:[{}]},
    {parts:[source],analysisBlockers:[{}]},{parts:[source],unmapped:[{}]},
    {parts:[{...source,params:{dcBias:0}}]},{parts:[{...source,params:{wave:'spice-sine'}}]}]) {
    assert.throws(()=>validateDcSweepInput(c,'V1',[observation]),/DC sweep/);
  }
  assert.throws(()=>validateDcSweepInput({parts:[source]},'missing',[observation]),/voltage source/);
  assert.throws(()=>validateDcSweepInput({parts:[source]},'V1',[]),/observations/);
  const raw={schemaVersion:1,sourceId:'V1',observations:[{...observation,absoluteTolerance:0,relativeTolerance:.6}],
    samples:[{sourceVolts:0,values:[1]},{sourceVolts:1,values:[1]}]};
  const expected=parseExpectedDcSweep(JSON.stringify(raw));
  const actual={sourceId:'V1',observations:[observation],samples:structuredClone(raw.samples)};
  assert.equal(compareExpectedDcSweep(actual,expected).status,'pass');
  actual.samples[1].values[0]=2;
  assert.equal(compareExpectedDcSweep(actual,expected).counts.failed,1,'relative tolerance scales expected, not actual');
  for (const bad of [{...raw,schemaVersion:2},{...raw,samples:[]},
    {...raw,observations:[{...raw.observations[0],unit:'A'}]},
    {...raw,observations:[{...raw.observations[0],absoluteTolerance:null}]},
    {...raw,samples:[{sourceVolts:0,values:[]},raw.samples[1]]},
    {...raw,samples:[raw.samples[0],raw.samples[0]]}]) {
    assert.throws(()=>parseExpectedDcSweep(JSON.stringify(bad)),/DC reference/);
  }
  for (const changed of [{...actual,sourceId:'V2'},
    {...actual,observations:[{...observation,reference:'other'}]},
    {...actual,samples:[]},{...actual,samples:actual.samples.slice(0,1)}]) {
    assert.equal(compareExpectedDcSweep(changed,expected).status,'fail');
    assert.ok(compareExpectedDcSweep(changed,expected).counts.structuralFailures>0);
  }
});

test('actual CLI strict DC sweep refuses unsupported setup and a later conflicting source point without partial output', () => {
  const dir=mkdtempSync(join(tmpdir(),'bwc-dc-refusal-'));
  const file=join(dir,'input.cir');
  const run=extra=>spawnSync(process.execPath,[CLI,'dc-sweep',file,...extra],{encoding:'utf8',timeout:30000});
  try {
    writeFileSync(file,'self-authored\nV1 in 0 0\nR1 in 0 1k\n.op\n.end\n');
    const args=['--source','V1','--from','-1','--to','1','--points','3','--observe','V1.pos,V1.neg','--current','V1.pos','--json'];
    const good=run(args); assert.equal(good.status,0,good.stderr);
    const got=JSON.parse(good.stdout);
    assert.deepEqual(got.samples.map(row=>row.sourceVolts),[-1,0,1]);
    assert.ok(Math.abs(got.samples[0].values[0]+1)<1e-12);
    assert.ok(Math.abs(got.samples[0].values[1]-.001)<1e-9,'delivering-source sign remains signed');
    const descending=args.slice(); descending[descending.indexOf('--from')+1]='1'; descending[descending.indexOf('--to')+1]='-1';
    const reversed=run(descending); assert.equal(reversed.status,0,reversed.stderr);
    const descendingRows=JSON.parse(reversed.stdout).samples;
    assert.deepEqual(descendingRows.map(row=>row.sourceVolts),[1,0,-1]);
    assert.ok(Math.abs(descendingRows[0].values[1]+.001)<1e-9);
    for (const extra of [['--source','missing','--observe','V1.pos'],
      ['--source','V1','--observe','missing.pin'],['--source','V1','--current','V1.missing'],
      ['--source','V1','--observe','V1.pos','--points','502'],['--source','V1','--observe','V1.pos','--watch']]) {
      const refused=run(extra); assert.equal(refused.status,2,refused.stderr); assert.equal(refused.stdout,'');
    }
    writeFileSync(file,'self-authored initially redundant short\nV1 0 0 0\nV2 in 0 1\nR1 in 0 1k\n.op\n.end\n');
    const conflict=run(['--source','V1','--from','0','--to','1','--points','3','--observe','V2.pos','--json']);
    assert.equal(conflict.status,2); assert.match(conflict.stderr,/DC point 1 \(0.5 V\)/);
    assert.equal(conflict.stdout,'','point zero success must not hide later failure');
    writeFileSync(file,'self-authored timed source\nV1 in 0 SINE(0 1 1k)\nR1 in 0 1k\n.end\n');
    const timed=run(args); assert.equal(timed.status,2); assert.match(timed.stderr,/non-DC waveform/);
    // A solver may return finite diagnostics despite an explicit failure flag.
    // Do not treat those values as successful points or publish a partial curve.
    writeFileSync(file,'self-authored\nV1 in 0 0\nR1 in 0 1k\n.op\n.end\n');
    const engineRoot=dirname(fileURLToPath(import.meta.resolve('bw-board/package.json')));
    const override=join(dir,'flagged-engine'); mkdirSync(join(override,'src'),{recursive:true});
    writeFileSync(join(override,'package.json'),'{"name":"flagged-engine","version":"0"}');
    writeFileSync(join(override,'src','index.js'),
      `import * as base from ${JSON.stringify(join(engineRoot,'src','index.js'))};\n`
      +`export * from ${JSON.stringify(join(engineRoot,'src','index.js'))};\n`
      +`export class BoardImpl extends base.BoardImpl { operatingPoint(options) { const result=super.operatingPoint(options); return this.parts.find(p=>p.id==='V1').params.volts>0 ? {...result,converged:false}:result; } }\n`);
    writeFileSync(join(override,'src','register-all.js'),`export * from ${JSON.stringify(join(engineRoot,'src','register-all.js'))};\n`);
    const flagged=spawnSync(process.execPath,[CLI,'dc-sweep',file,'--source','V1','--from','0','--to','1',
      '--points','3','--observe','V1.pos','--json'],{encoding:'utf8',env:{...process.env,BW_BOARD:override},timeout:30000});
    assert.equal(flagged.status,2,flagged.stderr); assert.match(flagged.stderr,/DC point 1/);
    assert.equal(flagged.stdout,'');
  } finally {rmSync(dir,{recursive:true,force:true});}
});

for (const kind of ['linear','diode']) test(`actual CLI compares 201 ${kind} strict DC points with live ngspice and independent analytical controls`, {
  skip:spawnSync('ngspice',['--version'],{encoding:'utf8'}).status!==0?'ngspice unavailable; no DC oracle comparison':false,
},()=>{
  const dir=mkdtempSync(join(tmpdir(),`bwc-dc-${kind}-`));
  try {
    const file=join(dir,'input.cir'),reference=join(dir,'reference.json');
    const deck=kind==='linear'?'self-authored linear\nV1 in 0 0\nR1 in out 1k\nR2 out 0 1k\n'
      :'self-authored diode\nV1 in 0 0\nR1 in out 1k\nD1 out 0 SELF\n.model SELF D(IS=2e-12 N=1.3 RS=4)\n.temp 26.826793442075882\n.options tnom=26.826793442075882\n';
    writeFileSync(file,deck+'.op\n.end\n');
    const from=kind==='linear'?-1:0,to=kind==='linear'?1:5,step=(to-from)/200;
    writeFileSync(join(dir,'oracle.cir'),deck+'.options reltol=1e-10 abstol=1e-14 vntol=1e-12\n.control\n'
      +`set numdgt=17\ndc V1 ${from} ${to} ${step}\nwrdata oracle.dat v(out) i(V1)\nquit\n.endc\n.end\n`);
    const oracle=spawnSync('ngspice',['-b','oracle.cir'],{cwd:dir,encoding:'utf8',timeout:30000});
    assert.equal(oracle.status,0,oracle.stderr);
    const rows=readFileSync(join(dir,'oracle.dat'),'utf8').trim().split('\n').map(line=>line.trim().split(/\s+/).map(Number));
    assert.equal(rows.length,201); assert.ok(rows.every(row=>row.length===4&&row.every(Number.isFinite)));
    const observations=[{kind:'voltage',selector:'R1.b',reference:'GND1.gnd',unit:'V',absoluteTolerance:1e-6},
      {kind:'current',selector:'V1.pos',reference:'',unit:'A',absoluteTolerance:1e-9}];
    const expected={schemaVersion:1,sourceId:'V1',observations,provenance:{tool:'live ngspice',deck:'self-authored',analysis:'DC'},
      samples:rows.map(row=>({sourceVolts:row[0],values:[row[1],row[3]]}))};
    for (const row of rows) {
      const voltage=row[1],current=-row[3];
      if (kind==='linear') {
        assert.ok(Math.abs(voltage-row[0]/2)<1e-8);
        assert.ok(Math.abs(current-row[0]/2000)<1e-10);
      } else {
        assert.ok(Math.abs(current-(row[0]-voltage)/1000)<1e-10,'independent resistor KCL');
        // Solve the independent implicit Shockley/series-R equation by
        // bisection. Comparing voltage avoids magnifying the known ngspice
        // thermal-constant residue through an exponential current residual.
        let lo=0,hi=Math.max(0,row[0]/1000);
        for (let iteration=0;iteration<100;iteration++) {
          const mid=(lo+hi)/2;
          if (mid*1004+.02585*1.3*Math.log1p(mid/2e-12)>row[0]) hi=mid;
          else lo=mid;
        }
        const closedVoltage=row[0]-1000*(lo+hi)/2;
        assert.ok(Math.abs(voltage-closedVoltage)<3e-7,'independent implicit Shockley voltage control');
      }
    }
    writeFileSync(reference,JSON.stringify(expected));
    const argv=[CLI,'dc-sweep',file,'--source','V1','--from',String(from),'--to',String(to),'--points','201',
      '--observe','R1.b,GND1.gnd','--current','V1.pos','--expect',reference,'--json'];
    const run=()=>spawnSync(process.execPath,argv,{encoding:'utf8',timeout:30000});
    const result=run(); assert.equal(result.status,0,result.stderr);
    const report=JSON.parse(result.stdout);
    assert.equal(report.samples.length,201);
    assert.equal(report.comparison.status,'pass'); assert.equal(report.comparison.counts.compared,402);
    assert.equal(report.comparison.counts.failed,0); assert.equal(report.claims.transient,false);
    assert.equal(report.claims.independentOracle,false,'CLI does not authenticate caller provenance');
    expected.samples[137].values[0]+=.01; writeFileSync(reference,JSON.stringify(expected));
    const changed=run(); assert.equal(changed.status,1,changed.stderr);
    const mismatch=JSON.parse(changed.stdout).comparison;
    assert.equal(mismatch.counts.failed,1); assert.equal(mismatch.mismatches[0].index,137);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('receipt identity verification validates authority and cannot empty-pass missing fingerprints', () => {
  const artifact={name:'input',bytes:3,sha256:'a'.repeat(64)};
  const receipt={schemaVersion:1,kind:'bwc-measurement-receipt',input:artifact,
    references:{waveform:null,meters:null},csv:null,
    cli:{jsJsonTreeSha256:'b'.repeat(64)},
    engine:{selection:'installed package',declaredPackageSpec:'declared',observed:{jsJsonTreeSha256:'c'.repeat(64)}},
    importedCircuitSha256:'d'.repeat(64),invocation:{nodeVersion:process.version},
    acquisition:'batch',exitCode:1,report:{}};
  const parsed=parseMeasurementReceipt(JSON.stringify(receipt));
  const observed={...parsed,nodeVersion:process.version};
  const good=compareMeasurementReceiptIdentity(parsed,observed);
  assert.equal(good.status,'match'); assert.equal(good.checks.length,14);
  assert.equal(good.recordedMeasurementExitCode,1,'identity match does not turn failed measurements into passing ones');
  assert.equal(good.limits.numericalAgreement,false);
  for (const [field,value] of [['schemaVersion',2],['kind','unknown'],['input',null],
    ['references',{}],['csv',{}],['cli',{}],['engine',{}],['importedCircuitSha256',''],
    ['invocation',{}],['exitCode',2],['acquisition','unknown'],['report',null]]) {
    assert.throws(()=>parseMeasurementReceipt(JSON.stringify({...receipt,[field]:value})),/invalid measurement receipt/,field);
  }
  for (const bad of [{...artifact,bytes:-1},{...artifact,bytes:1.5},{...artifact,sha256:'A'.repeat(64)}]) {
    assert.throws(()=>parseMeasurementReceipt(JSON.stringify({...receipt,input:bad})),/invalid/);
  }
  for (const [field,mutate] of [
    ['input',value=>({...value,input:{...artifact,sha256:'0'.repeat(64)}})],
    ['references',value=>({...value,references:{waveform:artifact,meters:null}})],
    ['csv',value=>({...value,csv:artifact})],
    ['imported',value=>({...value,importedCircuitSha256:'e'.repeat(64)})],
    ['engine',value=>({...value,engine:{...value.engine,observed:{jsJsonTreeSha256:'e'.repeat(64)}}})],
    ['selection',value=>({...value,engine:{...value.engine,selection:'BW_BOARD override'}})],
    ['declaration',value=>({...value,engine:{...value.engine,declaredPackageSpec:'other'}})],
    ['cli',value=>({...value,cli:{jsJsonTreeSha256:'e'.repeat(64)}})],
    ['node',value=>({...value,nodeVersion:'v0.0.0'})],
  ]) assert.equal(compareMeasurementReceiptIdentity(parsed,mutate(observed)).status,'mismatch',field);
});

test('actual CLI verifies explicit receipt artifacts without simulation or embedded path execution', () => {
  const dir=mkdtempSync(join(tmpdir(),'bwc-verify-receipt-'));
  const env={...process.env}; delete env.BW_BOARD;
  const run=(argv,extraEnv={})=>spawnSync(process.execPath,[CLI,...argv],{env:{...env,...extraEnv},encoding:'utf8',timeout:30000});
  try {
    const source=join(dir,'input.json'),wave=join(dir,'wave.json'),meter=join(dir,'meter.json');
    const csv=join(dir,'trace.csv'),saved=join(dir,'receipt.json');
    const inputBytes=readFileSync(FIXTURE); writeFileSync(source,inputBytes);
    const waveBytes=JSON.stringify({schemaVersion:1,traces:[{tip:'RT.b',reference:'GND.gnd',
      samples:[{timeSeconds:.0001,volts:2.5},{timeSeconds:.0002,volts:2.5}]}]});
    const meterBytes=JSON.stringify({schemaVersion:1,acquisition:'batch',meters:[{mode:'voltage',
      probes:['RT.b','GND.gnd'],siUnit:'V',quantity:'observed-dc-mean',absoluteTolerance:1e-9,
      samples:[{timeSeconds:.0002,siValue:2.5}]}]});
    writeFileSync(wave,waveBytes); writeFileSync(meter,meterBytes);
    const capture=run(['measure',source,'--scope','RT.b,GND.gnd','--meter','voltage:RT.b,GND.gnd',
      '--duration','200us','--csv',csv,'--expect',wave,'--expect-meters',meter,'--receipt',saved,'--json']);
    assert.equal(capture.status,0,capture.stderr);
    const receipt=JSON.parse(readFileSync(saved,'utf8'));
    const verify=['verify-receipt',saved,'--input',source,'--expect',wave,'--expect-meters',meter,'--csv',csv,'--json'];
    const good=run(verify); assert.equal(good.status,0,good.stderr);
    assert.equal(JSON.parse(good.stdout).status,'match');
    assert.equal(JSON.parse(good.stdout).checks.filter(row=>!row.match).length,0);
    const missing=run(['verify-receipt',saved,'--input',source,'--json']);
    assert.equal(missing.status,1);
    assert.deepEqual(JSON.parse(missing.stdout).checks.filter(row=>!row.match).map(row=>row.field),
      ['references.waveform.sha256','references.waveform.bytes','references.meters.sha256',
        'references.meters.bytes','csv.sha256','csv.bytes']);
    for (const [path,bytes,field] of [[wave,waveBytes,'references.waveform'],[meter,meterBytes,'references.meters'],
      [csv,readFileSync(csv),'csv']]) {
      writeFileSync(path,Buffer.concat([Buffer.from(bytes),Buffer.from('\n')]));
      const changed=run(verify); assert.equal(changed.status,1,changed.stderr);
      assert.ok(JSON.parse(changed.stdout).checks.some(row=>row.field===`${field}.sha256`&&!row.match));
      writeFileSync(path,bytes);
    }
    const changedInput=JSON.parse(inputBytes); changedInput.vcc=4;
    writeFileSync(source,JSON.stringify(changedInput));
    const changed=run(verify); assert.equal(changed.status,1,changed.stderr);
    const fields=JSON.parse(changed.stdout).checks.filter(row=>!row.match).map(row=>row.field);
    assert.ok(fields.includes('input.sha256')); assert.ok(fields.includes('importedCircuitSha256'));
    writeFileSync(source,inputBytes);
    for (const [path,value,field] of [['engine','0'.repeat(64),'engine.jsJsonTreeSha256'],
      ['cli','0'.repeat(64),'cli.jsJsonTreeSha256'],['node','v0.0.0','nodeVersion']]) {
      const mutated=structuredClone(receipt);
      if (path==='engine') mutated.engine.observed.jsJsonTreeSha256=value;
      if (path==='cli') mutated.cli.jsJsonTreeSha256=value;
      if (path==='node') mutated.invocation.nodeVersion=value;
      writeFileSync(saved,JSON.stringify(mutated));
      const result=run(verify); assert.equal(result.status,1,result.stderr);
      assert.deepEqual(JSON.parse(result.stdout).checks.filter(row=>!row.match).map(row=>row.field),[field]);
    }
    const marker=join(dir,'must-not-execute');
    const inert=structuredClone(receipt);
    inert.invocation={...inert.invocation,cwd:'/missing/untrusted/path',argv:['-e',`require('fs').writeFileSync(${JSON.stringify(marker)},'bad')`]};
    inert.engine.observed.root='/missing/untrusted/engine';
    inert.cli.root='/missing/untrusted/cli';
    writeFileSync(saved,JSON.stringify(inert));
    const ignored=run(verify); assert.equal(ignored.status,0,ignored.stderr);
    assert.equal(existsSync(marker),false);
    assert.equal(JSON.parse(ignored.stdout).limits.recordedInvocationExecuted,false);
    const relocated=join(dir,'relocated.json'); writeFileSync(relocated,inputBytes);
    const relocatedArgs=verify.slice(); relocatedArgs[3]=relocated;
    assert.equal(run(relocatedArgs).status,0,'artifact names/locations are not content identity');
    const override=join(dir,'no-execution'); mkdirSync(join(override,'src'),{recursive:true});
    writeFileSync(join(override,'package.json'),'{"name":"must-not-run","version":"0"}');
    writeFileSync(join(override,'src','index.js'),'throw new Error("engine must not execute");');
    writeFileSync(join(override,'src','register-all.js'),'throw new Error("register must not execute");');
    const noExecution=structuredClone(receipt);
    noExecution.engine.selection='BW_BOARD override';
    noExecution.engine.observed=runtimeReceipt(override);
    writeFileSync(saved,JSON.stringify(noExecution));
    const inspected=run(verify,{BW_BOARD:override});
    assert.equal(inspected.status,0,inspected.stderr);
    assert.equal(JSON.parse(inspected.stdout).status,'match','runtime inspected as bytes, never imported/executed');
    writeFileSync(saved,JSON.stringify({...receipt,padding:' '.repeat(4*1024*1024)}));
    const oversized=run(verify); assert.equal(oversized.status,2); assert.match(oversized.stderr,/4 MiB/);
    writeFileSync(saved,'{}'); assert.equal(run(verify).status,2);
    writeFileSync(saved,JSON.stringify(receipt));
    assert.equal(run(['verify-receipt',saved]).status,2);
    assert.equal(run([...verify,'--watch']).status,2);
    assert.equal(readFileSync(source,'utf8'),inputBytes.toString());
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('measurement receipt fingerprints bind actual bytes, runtime paths and importer output', () => {
  const dir=mkdtempSync(join(tmpdir(),'bwc-receipt-tree-'));
  try {
    mkdirSync(join(dir,'src'));
    writeFileSync(join(dir,'package.json'),'{"name":"test-engine","version":"1"}');
    writeFileSync(join(dir,'src','a.js'),'export const a=1;');
    writeFileSync(join(dir,'src','ignored.md'),'not runtime');
    const expected=createHash('sha256');
    for (const path of ['package.json','src/a.js']) {
      const bytes=readFileSync(join(dir,path));
      expected.update(`${path}\0${bytes.length}\0`).update(bytes).update('\0');
    }
    const first=runtimeReceipt(dir);
    assert.equal(first.jsJsonTreeSha256,expected.digest('hex'));
    assert.equal(first.files,2);
    writeFileSync(join(dir,'src','a.js'),'export const a=2;');
    assert.notEqual(runtimeReceipt(dir).jsJsonTreeSha256,first.jsJsonTreeSha256);
    assert.deepEqual(fileReceipt('same-name.cir',Buffer.from('V1 a 0 2')),
      {name:'same-name.cir',bytes:8,sha256:createHash('sha256').update('V1 a 0 2').digest('hex')});
    const input={parts:[{id:'R',params:{ohms:1}}],wires:[],vcc:5};
    assert.notEqual(importedCircuitSha256(input),importedCircuitSha256({...input,vcc:3}));
    assert.notEqual(importedCircuitSha256(input),importedCircuitSha256({...input,wires:[{from:'R'}]}));
    assert.throws(()=>runtimeReceipt(join(dir,'missing')),/ENOENT/);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('actual CLI receipts bind batch/watch, overrides, rounded clock and failed references', () => {
  const dir=mkdtempSync(join(tmpdir(),'bwc-receipt-cli-'));
  const env={...process.env}; delete env.BW_BOARD;
  const run=(argv,extraEnv={})=>spawnSync(process.execPath,[CLI,'measure',...argv],
    {encoding:'utf8',env:{...env,...extraEnv},timeout:30000});
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  try {
    const source=join(dir,'divider.json'),receiptPath=join(dir,'batch.json'),csv=join(dir,'scope.csv');
    const bytes=readFileSync(FIXTURE); writeFileSync(source,bytes);
    const argv=[source,'--scope','RT.b,GND.gnd','--meter','voltage:RT.b,GND.gnd',
      '--duration','999us','--rate','3kHz','--json','--csv',csv,'--receipt',receiptPath];
    const result=run(argv);
    assert.equal(result.status,0,result.stderr);
    const receipt=JSON.parse(readFileSync(receiptPath,'utf8'));
    assert.deepEqual(receipt.report,JSON.parse(result.stdout));
    const plain=run(argv.slice(0,-2));
    assert.equal(plain.status,0,plain.stderr);
    assert.deepEqual(JSON.parse(plain.stdout),receipt.report,'opt-in receipt does not change acquisition');
    assert.equal(receipt.input.sha256,hash(bytes));
    assert.equal(receipt.input.bytes,bytes.length);
    assert.deepEqual(receipt.invocation.argv,['measure',...argv]);
    assert.equal(receipt.invocation.nodeVersion,process.version);
    assert.equal(receipt.clock.durationNs,'999000');
    assert.equal(receipt.clock.intervalNs,'333333');
    assert.equal(receipt.report.plannedSamples,2);
    assert.equal(receipt.csv.sha256,hash(readFileSync(csv)));
    assert.equal(receipt.acquisition,'batch');
    assert.equal(receipt.exitCode,0);
    assert.equal(receipt.engine.selection,'installed package');
    const provenance=JSON.parse(readFileSync(join(ROOT,'scripts','board-provenance.json'),'utf8'));
    assert.equal(receipt.engine.observed.jsJsonTreeSha256,provenance.runtimeTreeSha256);
    assert.match(receipt.cli.jsJsonTreeSha256,/^[a-f0-9]{64}$/);
    assert.equal(receipt.limits.hermeticExecution,false);
    assert.equal(receipt.limits.importedDependencyClosure,false);
    assert.equal(receipt.report.claims.independentOracle,false);
    const changed=JSON.parse(bytes); changed.vcc=4;
    writeFileSync(source,JSON.stringify(changed));
    const changedPath=join(dir,'changed.json');
    const changedRun=run([source,'--meter','voltage:RT.b,GND.gnd','--duration','1ms','--json','--receipt',changedPath]);
    assert.equal(changedRun.status,0,changedRun.stderr);
    const changedReceipt=JSON.parse(readFileSync(changedPath,'utf8'));
    assert.notEqual(changedReceipt.input.sha256,receipt.input.sha256);
    assert.notEqual(changedReceipt.importedCircuitSha256,receipt.importedCircuitSha256);
    assert.equal(changedReceipt.report.meters[0].reading.siValue,2);
    const reference=join(dir,'expected.json');
    writeFileSync(reference,JSON.stringify({schemaVersion:1,acquisition:'watch',meters:[{
      mode:'voltage',probes:['RT.b','GND.gnd'],siUnit:'V',quantity:'observed-dc-mean',
      absoluteTolerance:1e-9,samples:[{timeSeconds:.0001,siValue:2},{timeSeconds:.0002,siValue:-2}],
    }]}));
    const watchPath=join(dir,'watch.json');
    const engineRoot=dirname(fileURLToPath(import.meta.resolve('bw-board/package.json')));
    const watched=run([source,'--meter','voltage:RT.b,GND.gnd','--duration','200us','--watch',
      '--expect-meters',reference,'--receipt',watchPath],{BW_BOARD:engineRoot});
    assert.equal(watched.status,1,watched.stderr);
    const watchReceipt=JSON.parse(readFileSync(watchPath,'utf8'));
    const records=watched.stdout.trim().split('\n').map(line=>JSON.parse(line));
    assert.deepEqual(watchReceipt.report,records.at(-1).report);
    assert.equal(watchReceipt.watchSamples,2);
    assert.equal(watchReceipt.acquisition,'watch');
    assert.equal(watchReceipt.exitCode,1);
    assert.equal(watchReceipt.report.meterComparison.counts.failed,1);
    assert.equal(watchReceipt.references.meters.sha256,hash(readFileSync(reference)));
    assert.equal(watchReceipt.engine.selection,'BW_BOARD override');
    assert.equal(watchReceipt.engine.observed.root,engineRoot);
    assert.equal(watchReceipt.engine.observed.jsJsonTreeSha256,receipt.engine.observed.jsJsonTreeSha256);
    assert.equal(watchReceipt.engine.declaredPackageSpec,receipt.engine.declaredPackageSpec);
    // Deterministic filesystem race: immediately after the first source read,
    // replace its disk bytes. A second unbound read would simulate 4 V, not 5 V.
    writeFileSync(source,bytes);
    const earlyPath=join(dir,'early.json');
    const preload=`import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
      const read=fs.readFileSync; let changed=false;
      fs.readFileSync=function(path,...rest){ const result=read.call(this,path,...rest);
        if(path===${JSON.stringify(source)}&&!changed){changed=true;fs.writeFileSync(path,${JSON.stringify(JSON.stringify(changed))});}
        return result; }; syncBuiltinESMExports();`;
    const early=spawnSync(process.execPath,['--import',`data:text/javascript,${encodeURIComponent(preload)}`,
      CLI,'measure',source,'--meter','voltage:RT.b,GND.gnd','--duration','1ms',
      '--json','--receipt',earlyPath],{encoding:'utf8',env,timeout:30000});
    assert.equal(early.status,0,early.stderr);
    const earlyReceipt=JSON.parse(readFileSync(earlyPath,'utf8'));
    assert.equal(earlyReceipt.input.sha256,hash(bytes));
    assert.equal(earlyReceipt.report.meters[0].reading.siValue,2.5,'source snapshot, not changed disk bytes');
    assert.equal(readFileSync(source,'utf8'),JSON.stringify(changed));
    // A genuine override changes identity without borrowing the package pin;
    // its loader changes both reference files before the final comparisons.
    const override=join(dir,'override'); mkdirSync(join(override,'src'),{recursive:true});
    writeFileSync(join(override,'package.json'),'{"name":"test-override","version":"0"}');
    writeFileSync(source,bytes);
    const replacement=JSON.stringify(changed);
    const wavePath=join(dir,'wave.json');
    const waveBytes=Buffer.from(JSON.stringify({schemaVersion:1,traces:[{
      tip:'RT.b',reference:'GND.gnd',samples:Array.from({length:10},(_,i)=>({timeSeconds:(i+1)*.0001,volts:2.5})),
    }]}));
    writeFileSync(wavePath,waveBytes);
    const meterBytes=Buffer.from(JSON.stringify({schemaVersion:1,acquisition:'batch',meters:[{
      mode:'voltage',probes:['RT.b','GND.gnd'],siUnit:'V',quantity:'observed-dc-mean',
      absoluteTolerance:1e-9,samples:[{timeSeconds:.001,siValue:2.5}],
    }]}));
    writeFileSync(reference,meterBytes);
    writeFileSync(join(override,'src','index.js'),
      `export * from ${JSON.stringify(join(engineRoot,'src','index.js'))};\n`
      +`import {writeFileSync} from 'node:fs';\nwriteFileSync(${JSON.stringify(source)},${JSON.stringify(replacement)});\n`
      +`writeFileSync(${JSON.stringify(wavePath)},'{}');\nwriteFileSync(${JSON.stringify(reference)},'{}');\n`);
    writeFileSync(join(override,'src','register-all.js'),
      `export * from ${JSON.stringify(join(engineRoot,'src','register-all.js'))};\n`);
    const snapshotPath=join(dir,'snapshot.json');
    const snapshot=run([source,'--meter','voltage:RT.b,GND.gnd','--duration','1ms',
      '--scope','RT.b,GND.gnd','--expect',wavePath,'--expect-meters',reference,
      '--json','--receipt',snapshotPath],{BW_BOARD:override});
    assert.equal(snapshot.status,0,snapshot.stderr);
    const snapshotReceipt=JSON.parse(readFileSync(snapshotPath,'utf8'));
    assert.equal(snapshotReceipt.engine.observed.root,override);
    assert.notEqual(snapshotReceipt.engine.observed.jsJsonTreeSha256,receipt.engine.observed.jsJsonTreeSha256);
    assert.equal(snapshotReceipt.engine.observed.jsJsonTreeSha256,runtimeReceipt(override).jsJsonTreeSha256);
    assert.equal(snapshotReceipt.engine.declaredPackageSpec,receipt.engine.declaredPackageSpec);
    assert.equal(snapshotReceipt.input.sha256,hash(bytes));
    assert.equal(snapshotReceipt.report.meters[0].reading.siValue,2.5);
    assert.equal(snapshotReceipt.report.comparison.status,'pass');
    assert.equal(snapshotReceipt.report.meterComparison.status,'pass');
    assert.equal(snapshotReceipt.references.waveform.sha256,hash(waveBytes));
    assert.equal(snapshotReceipt.references.meters.sha256,hash(meterBytes));
    assert.equal(readFileSync(wavePath,'utf8'),'{}');
    assert.equal(readFileSync(reference,'utf8'),'{}');
    const racedPath=join(dir,'raced.json');
    writeFileSync(join(override,'src','index.js'),
      `export * from ${JSON.stringify(join(engineRoot,'src','index.js'))};\n`
      +`import {writeFileSync} from 'node:fs';\nwriteFileSync(${JSON.stringify(racedPath)},'concurrent-writer');\n`);
    const raced=run([source,'--meter','voltage:RT.b,GND.gnd','--duration','1ms',
      '--json','--receipt',racedPath],{BW_BOARD:override});
    assert.equal(raced.status,2,'exclusive final write must reject a destination created during capture');
    assert.match(raced.stderr,/receipt write failed/);
    assert.equal(readFileSync(racedPath,'utf8'),'concurrent-writer');
    assert.equal(readFileSync(source,'utf8'),replacement);
    assert.equal(run(argv).status,2,'existing receipt refuses before rewriting CSV');
    assert.equal(readFileSync(receiptPath,'utf8'),JSON.stringify(receipt,null,2)+'\n');
    const same=run([source,'--meter','voltage:RT.b,GND.gnd','--receipt',source]);
    assert.equal(same.status,2); assert.match(same.stderr,/already exists/);
    assert.equal(readFileSync(source,'utf8'),JSON.stringify(changed));
    const alias=join(dir,'alias.json');
    const sameOutput=run([source,'--scope','RT.b','--csv',alias,'--receipt',alias]);
    assert.equal(sameOutput.status,2); assert.match(sameOutput.stderr,/destinations must differ/);
    assert.equal(existsSync(alias),false);
    const refusedPath=join(dir,'refused.json');
    assert.equal(run([source,'--scope','missing','--receipt',refusedPath]).status,2);
    assert.equal(existsSync(refusedPath),false,'refused acquisition has no completed receipt');
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

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

test('precision CLI refuses absent initialization, unsupported streaming and budget/domain escapes', () => {
  const base = [CLI,'measure',PROBE_FIXTURE,'--scope','R2.a,V1.neg','--profile','precision-v1','--json'];
  for (const [extra,reason] of [
    [[],/requires --initial zero-state/],
    [['--initial','dc-operating-point'],/requires --initial zero-state/],
    [['--initial','zero-state','--watch'],/precision watch requires the bounded ADP7118 current-limited domain/],
    [['--initial','zero-state','--meter','resistance:R1.a,R1.b'],/second advance/],
    [['--initial','zero-state','--duration','201ms','--rate','1kHz'],/preflight needs 20100/],
  ]) {
    // Do not let --watch + --json's format conflict conceal domain admission.
    const requestBase = extra.includes('--watch') ? base.filter(arg=>arg!=='--json') : base;
    const result = spawnSync(process.execPath,[...requestBase,...extra],{encoding:'utf8',timeout:15000});
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
    assert.match(result.stderr,/inconsistent ideal voltage constraint V1; 1 V/);
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

test('precision voltage topology excludes only finite resistive source edges and still validates endpoints', () => {
  const ground = {id:'G',kind:'gnd'};
  const source = resistance => ({id:'V',kind:'vsource',params:{volts:5,rInternal:resistance}});
  const short = [{id:'g',terminals:[{part:'G',terminal:'gnd'},{part:'V',terminal:'pos'},{part:'V',terminal:'neg'}]}];
  for (const r of [1e-9,10,1e9]) validatePrecisionVoltageTopology([ground,source(r)],short);
  for (const r of [undefined,0,-1,NaN,Infinity,'unknown']) {
    assert.throws(() => validatePrecisionVoltageTopology([ground,source(r)],short),/cycle at V/);
  }
  assert.throws(() => validatePrecisionVoltageTopology([ground,source(10)],
    [{id:'g',terminals:[{part:'G',terminal:'gnd'},{part:'V',terminal:'pos'}]}]),/one net for V.neg/);
  assert.throws(() => validatePrecisionVoltageTopology([ground,
    {id:'E',kind:'vcvs',params:{gain:1,rInternal:10}}],
    [{id:'g',terminals:[{part:'G',terminal:'gnd'},{part:'E',terminal:'outp'},{part:'E',terminal:'outn'}]}]),/cycle at E/);
  const parallel=[
    {id:'p',terminals:[{part:'R',terminal:'pos'},{part:'I',terminal:'pos'}]},
    {id:'n',terminals:[{part:'G',terminal:'gnd'},{part:'R',terminal:'neg'},{part:'I',terminal:'neg'}]},
  ];
  validatePrecisionVoltageTopology([ground,
    {id:'R',kind:'vsource',params:{volts:5,rInternal:10}},
    {id:'I',kind:'vsource',params:{volts:1}}],parallel);
});

test('actual installed-engine CLI preserves same-node source scope and signed meter readings in batch/watch/precision', () => {
  const dir=mkdtempSync(join(tmpdir(),'bwc-source-self-constraint-'));
  const file=join(dir,'input.json');
  const modes=[['--json'],['--watch'],['--profile','precision-v1','--initial','zero-state','--json']];
  const fixture=(volts,resistance,live)=>({parts:[
    {id:'G',kind:'gnd',params:{}}, {id:'GOOD',kind:'vsource',params:{volts:1}},
    {id:'SHORT',kind:'vsource',params:{volts,rInternal:resistance}},
    {id:'LOAD',kind:'resistor',params:{ohms:1000}},
  ],wires:[
    {from:'GOOD',fromTerminal:'pos',to:'LOAD',toTerminal:'a'},
    {from:'GOOD',fromTerminal:'neg',to:'G',toTerminal:'gnd'},
    {from:'LOAD',fromTerminal:'b',to:'G',toTerminal:'gnd'},
    ...['pos','neg'].map(terminal=>({from:'SHORT',fromTerminal:terminal,
      to:live?'LOAD':'G',toTerminal:live?'a':'gnd'})),
  ]});
  const run=(mode,includeShort=true)=>spawnSync(process.execPath,[CLI,'measure',file,
    '--scope','GOOD.pos,GOOD.neg',
    ...(includeShort?['--meter','current:SHORT.pos','--meter','current:SHORT.neg']:[]),
    '--meter','current:GOOD.pos',
    '--duration','1ms','--rate','10kHz',...mode],{encoding:'utf8',timeout:15000});
  try{
    for(const [volts,resistance] of [[5,10],[-5,10],[0,0]]) for(const live of [false,true]) {
      writeFileSync(file,JSON.stringify(fixture(volts,resistance,live)));
      for(const mode of modes){
        const result=run(mode,resistance>0); assert.equal(result.status,0,result.stderr);
        const records=mode.includes('--watch')?result.stdout.trim().split('\n').map(line=>JSON.parse(line)):[];
        const report=records.length?records.at(-1).report:JSON.parse(result.stdout);
        assert.equal(report.scope[0].summary.samples,10);
        for(const key of ['minVolts','maxVolts','meanVolts','rmsVolts','lastVolts']) assert.equal(report.scope[0].summary[key],1);
        const expected=resistance?volts/resistance:0;
        const checkMeters=meters=>{
          if(resistance>0){
            assert.ok(Math.abs(meters[0].reading.siValue-expected)<1e-12);
            assert.ok(Math.abs(meters[1].reading.siValue+expected)<1e-12);
          }
          assert.ok(Math.abs(meters[resistance>0?2:0].reading.siValue-.001)<1e-12,
            'unrelated supply must not report phantom short-circuit load');
        };
        checkMeters(report.meters);
        if(records.length){
          assert.equal(records.length,11);
          for(const record of records.slice(0,-1)){assert.equal(record.scope[0].volts,1);checkMeters(record.meters);}
        }
      }
    }
    for(const volts of [5,-5]) for(const live of [false,true]){
      writeFileSync(file,JSON.stringify(fixture(volts,0,live)));
      for(const mode of modes){
        const result=run(mode); assert.equal(result.status,2,result.stderr);
        assert.equal(result.stdout,''); assert.match(result.stderr,/inconsistent ideal voltage constraint SHORT/);
      }
    }
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('indeterminate current CLI refuses fabricated zero in batch/watch/precision while voltage capture remains valid',()=>{
  const dir=mkdtempSync(join(tmpdir(),'bwc-indeterminate-current-'));
  const file=join(dir,'source.cir');
  const modes=[['--json'],['--watch'],['--profile','precision-v1','--initial','zero-state','--json']];
  try{
    for(const live of [false,true]){
      const node=live?'n':'0';
      writeFileSync(file,`* current availability control\nVGOOD n 0 1\nRLOAD n 0 1k\nVZERO ${node} ${node} 0\n.end\n`);
      for(const mode of modes){
        for(const terminal of ['pos','neg']){
          const result=spawnSync(process.execPath,[CLI,'measure',file,'--scope','VGOOD.pos,VGOOD.neg',
            '--meter',`current:VZERO.${terminal}`,'--duration','1ms','--rate','10kHz',...mode],
            {encoding:'utf8',timeout:15000});
          assert.ifError(result.error); assert.equal(result.status,2,result.stderr||result.stdout);
          assert.equal(result.stdout,'','no JSON/NDJSON may claim an indeterminate current');
          assert.match(result.stderr,new RegExp(`current meter VZERO\\.${terminal} could not start capture: Cannot read current`));
        }
        const valid=spawnSync(process.execPath,[CLI,'measure',file,'--scope','VGOOD.pos,VGOOD.neg',
          '--meter','current:VGOOD.pos','--duration','1ms','--rate','10kHz',...mode],
          {encoding:'utf8',timeout:15000});
        assert.ifError(valid.error); assert.equal(valid.status,0,valid.stderr);
        const records=mode.includes('--watch')?valid.stdout.trim().split('\n').map(line=>JSON.parse(line)):[];
        const report=records.length?records.at(-1).report:JSON.parse(valid.stdout);
        assert.equal(report.scope[0].summary.samples,10);
        assert.equal(report.scope[0].summary.meanVolts,1);
        assert.ok(Math.abs(report.meters[0].reading.siValue-.001)<1e-12);
        if(records.length){
          assert.equal(records.length,11);
          for(const record of records.slice(0,-1)){
            assert.equal(record.scope[0].volts,1);
            assert.ok(Math.abs(record.meters[0].reading.siValue-.001)<1e-12);
          }
        }
      }
    }
  }finally{rmSync(dir,{recursive:true,force:true});}
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
for (const [kind, slewVPerUs, gbwHz] of [['lm741', .5, 1e6], ['lt1001', .25, .8e6]]) {
  for (const amplitude of [.01, 10]) for (const sign of [1, -1]) {
    test(`physical ${kind} CLI ${sign * amplitude} V step preserves model dynamics and watch/CSV samples`, async () => {
      await import('./_setup.js');
      const {Circuit} = await import('../src/model/circuit.js');
      const {importCircuit} = await import('../src/importers/index.js');
      const dir = mkdtempSync(join(tmpdir(), 'bwc-physical-opamp-'));
      try {
        const input = importCircuit('spice', '* behavioural part step, not vendor transistor macromodel\n'
          + `VI in 0 PULSE(0 ${sign * amplitude} 10u 1n 1n 100u 200u)\n`
          + 'VP positive 0 15\nVN negative 0 -15\nRL out 0 10k\n.end\n');
        assert.equal(input.unmapped.length, 0);
        const c = Circuit.fromJSON({parts: input.parts, wires: input.wires});
        const amp = c.addPart(kind, {inputOffsetV: 0}, 0, 0);
        for (const [part, terminal, pin] of [
          ['VI', 'pos', 'inp'], ['VP', 'pos', 'vpos'], ['VN', 'pos', 'vneg'],
          ['RL', 'a', 'out'], ['RL', 'a', 'inn'],
        ]) c.addWire(part, terminal, amp.id, pin);
        assert.equal(c.netlistError, null);
        const fixture = join(dir, 'step.json'), csv = join(dir, 'step.csv');
        writeFileSync(fixture, JSON.stringify(c.toJSON()));
        const args = [CLI, 'measure', fixture, '--scope', `${amp.id}.out,VI.neg`,
          '--scope', 'VI.pos,VI.neg', '--duration', '80us', '--rate', '2MHz'];
        const batch = spawnSync(process.execPath, [...args, '--csv', csv, '--json'],
          {encoding: 'utf8', timeout: 30000});
        assert.equal(batch.status, 0, batch.stderr || batch.stdout);
        const report = JSON.parse(batch.stdout);
        assert.equal(report.claims.independentOracle, false);
        assert.equal(report.plannedSamples, 160);
        const sections = readFileSync(csv, 'utf8').trim().split('\n\n');
        assert.equal(sections.length, 2);
        const traces = sections.map((section, channel) => {
          assert.match(section.split('\n')[0], /capture=sample .*sampleIntervalNs=500 points=160/);
          const rows = section.split('\n').slice(2).map(line => line.split(',').map(Number));
          assert.equal(rows.length, 160);
          return rows.map(([elapsed, volts], index) => {
            const timeSeconds = elapsed + report.scope[channel].startTimeSeconds;
            assert.ok(Number.isFinite(volts));
            assert.ok(Math.abs(timeSeconds - (index + 1) * .5e-6) < 1e-12);
            return {timeSeconds, volts};
          });
        });
        const [output, source] = traces;
        for (const point of source) {
          const expected = point.timeSeconds <= 10e-6 ? 0 : sign * amplitude;
          assert.ok(Math.abs(point.volts - expected) < 1e-7, 'independent authored PULSE control');
        }
        assert.ok(output.filter(p => p.timeSeconds < 10e-6).every(p => Math.abs(p.volts) < 1e-6));
        for (let i = 1; i < output.length; i++) {
          const dtUs = (output[i].timeSeconds - output[i - 1].timeSeconds) * 1e6;
          // This behavioural card publishes every 300 ns, holding output
          // between updates. Adjacent 500 ns samples may contain two ticks.
          // Bound that explicit quantization; do not assert continuous slew.
          assert.ok(Math.abs(output[i].volts - output[i - 1].volts) <= slewVPerUs * (dtUs + .3) + 1e-5,
            `${kind} slew at sample ${i}: ${output[i - 1].volts} -> ${output[i].volts} V over ${dtUs} us`);
        }
        const early = output.find(p => Math.abs(p.timeSeconds - 10.5e-6) < 1e-12).volts * sign;
        if (amplitude === 10) {
          assert.ok(early > 0 && early <= slewVPerUs * .5 + 1e-5,
            'large-signal transition must be in flight, not an ideal instant step');
        } else {
          // Independent dominant-pole envelope permits the declared 300 ns
          // device update cadence; it is not a fitted per-sample golden.
          const lower = amplitude * (1 - Math.exp(-2 * Math.PI * gbwHz * .2e-6));
          assert.ok(early >= lower * .9 && early < amplitude,
            `small-signal pole is observable: ${early} V`);
        }
        const settled = output.at(-1).volts;
        assert.ok(Math.abs(settled - sign * amplitude) < (amplitude === 10 ? .002 : .0002),
          'feedback settles with correct polarity, rather than merely staying below slew');

        const watched = spawnSync(process.execPath, [...args, '--watch'],
          {encoding: 'utf8', timeout: 30000});
        assert.equal(watched.status, 0, watched.stderr || watched.stdout);
        const records = watched.stdout.trim().split('\n').map(line => JSON.parse(line));
        const observations = records.filter(row => row.recordType === 'sample');
        assert.equal(observations.length, 160);
        observations.forEach((row, i) => {
          assert.equal(row.index, i);
          assert.ok(Math.abs(row.timeSeconds - output[i].timeSeconds) < 1e-12);
          row.scope.forEach((channel, j) => assert.ok(Math.abs(channel.volts - traces[j][i].volts) < 1e-6,
            `watch and CSV observe the same channel ${j} sample ${i}`));
        });
        assert.equal(records.at(-1).recordType, 'summary');

        // This is a capture-repeatability reference, deliberately not an
        // independent physical oracle. Prove comparison/export plumbing too.
        const reference = {schemaVersion: 1, provenance: {kind: 'same-model-capture-repeatability'},
          traces: [amp.id + '.out', 'VI.pos'].map((tip, i) => ({tip, reference: 'VI.neg', samples: traces[i]}))};
        const expectedPath = join(dir, 'expected.json');
        writeFileSync(expectedPath, JSON.stringify(reference));
        const compareArgs = [...args, '--expect', expectedPath, '--json'];
        const repeated = spawnSync(process.execPath, compareArgs, {encoding: 'utf8', timeout: 30000});
        assert.equal(repeated.status, 0, repeated.stderr || repeated.stdout);
        assert.deepEqual(JSON.parse(repeated.stdout).comparison.counts,
          {traces: 2, compared: 320, passed: 320, failed: 0, structuralFailures: 0});
        reference.traces[0].samples[73].volts += .1;
        writeFileSync(expectedPath, JSON.stringify(reference));
        const corrupted = spawnSync(process.execPath, compareArgs, {encoding: 'utf8', timeout: 30000});
        assert.equal(corrupted.status, 1, corrupted.stderr);
        assert.equal(JSON.parse(corrupted.stdout).comparison.counts.failed, 1,
          'a corrupted physical-part reference cannot silently pass');
      } finally {rmSync(dir, {recursive: true, force: true});}
    });
  }
}

test('interactive CLI static opamp clipping matches independently stated gain/rails/output-resistance model', {
  skip: ngspicePresent ? false : 'ngspice unavailable: static clipping model oracle did not run',
}, async () => {
  await import('./_setup.js');
  const {Circuit} = await import('../src/model/circuit.js');
  const {importCircuit} = await import('../src/importers/index.js');
  const dir = mkdtempSync(join(tmpdir(), 'bwc-static-clip-'));
  try {
    const input = importCircuit('spice', '* static clipping input\nV1 in 0 SINE(0 .02 1k)\nR1 out 0 10k\n.end\n');
    assert.equal(input.unmapped.length, 0);
    const c = Circuit.fromJSON({parts: input.parts, wires: input.wires});
    const amp = c.addPart('opamp', {gain: 100, railLow: -1, railHigh: 1, rout: 100}, 0, 0);
    c.addWire('V1', 'pos', amp.id, 'inp');
    c.addWire('V1', 'neg', amp.id, 'inn');
    c.addWire(amp.id, 'out', 'R1', 'a');
    assert.equal(c.netlistError, null);
    const fixture = join(dir, 'clip.json'), expectedPath = join(dir, 'expected.json');
    writeFileSync(fixture, JSON.stringify(c.toJSON()));
    writeFileSync(join(dir, 'reference.cir'), 'Independent static clipping model, not a physical opamp macromodel\n'
      + 'V1 in 0 SIN(0 .02 1k)\nBAMP internal 0 V=min(1,max(-1,100*v(in)))\n'
      + 'ROUT internal out 100\nRLOAD out 0 10k\n'
      + '.options reltol=1e-10 abstol=1e-14 vntol=1e-10 trtol=1\n.control\n'
      + 'set wr_vecnames\nset wr_singlescale\ntran 10u 2m 0 5n\nlinearize v(out)\n'
      + 'wrdata reference.csv v(out)\n.endc\n.end\n');
    const oracle = spawnSync('ngspice', ['-b', 'reference.cir'], {cwd: dir, encoding: 'utf8', timeout: 60000});
    assert.equal(oracle.status, 0, oracle.stderr || oracle.stdout);
    const samples = readFileSync(join(dir, 'reference.csv'), 'utf8').trim().split('\n').slice(1)
      .map(line => line.trim().split(/\s+/).map(Number)).filter(row => row[0] > 0)
      .map(row => ({timeSeconds: row[0], volts: row[1]}));
    assert.equal(samples.length, 200);
    for (const point of samples) {
      const closed = Math.max(-1, Math.min(1, 2 * Math.sin(2 * Math.PI * 1000 * point.timeSeconds))) * 10000 / 10100;
      assert.ok(Math.abs(point.volts - closed) <= 1e-7, 'oracle matches independently stated static clipping equation');
    }
    const expected = {schemaVersion: 1, provenance: {kind: 'live-ngspice-declared-static-clipping-model'},
      traces: [{tip: `${amp.id}.out`, reference: 'V1.neg', samples}]};
    writeFileSync(expectedPath, JSON.stringify(expected));
    const args = [CLI, 'measure', fixture, '--scope', `${amp.id}.out,V1.neg`,
      '--duration', '2ms', '--rate', '100kHz', '--expect', expectedPath, '--json'];
    const run = spawnSync(process.execPath, args, {encoding: 'utf8', timeout: 30000});
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const report = JSON.parse(run.stdout);
    assert.equal(report.comparison.counts.passed, 200);
    assert.equal(report.comparison.counts.compared, 200);
    assert.equal(report.claims.independentOracle, false);
    expected.traces[0].samples[73].volts += .01;
    writeFileSync(expectedPath, JSON.stringify(expected));
    const mutant = spawnSync(process.execPath, args, {encoding: 'utf8', timeout: 30000});
    assert.equal(mutant.status, 1, mutant.stderr);
    assert.equal(JSON.parse(mutant.stdout).comparison.counts.failed, 1);
  } finally {rmSync(dir, {recursive: true, force: true});}
});

for (const kind of ['RC', 'RL']) for (const sign of [1, -1]) {
  test(`precision CLI ${kind} signed ${sign} step compares both scope insertion points to live ngspice`, {
    skip: ngspicePresent ? false : 'ngspice unavailable: storage waveform oracle did not run',
  }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'bwc-storage-waveform-'));
    try {
      const storage = kind === 'RC' ? 'C1 out 0 100n' : 'L1 out 0 1m';
      const tip = kind === 'RC' ? 'C1.a' : 'L1.a';
      const cards = `V1 in 0 ${sign}\nR1 in out 100\n${storage}\n`;
      const fixture = join(dir, 'capture.cir'), expectedPath = join(dir, 'expected.json'), csv = join(dir, 'capture.csv');
      writeFileSync(fixture, `Zero-state signed ${kind} scope\n${cards}.tran 1u 200u UIC\n.end\n`);
      writeFileSync(join(dir, 'reference.cir'), `Independent signed ${kind} reference\n${cards}`
        + '.options reltol=1e-10 abstol=1e-14 vntol=1e-10 trtol=1\n.control\n'
        + 'set wr_vecnames\nset wr_singlescale\ntran 1u 200u 0 5n uic\n'
        + 'linearize v(out) v(in)\nwrdata reference.csv v(out) v(in)\n.endc\n.end\n');
      const oracle = spawnSync('ngspice', ['-b', 'reference.cir'], {cwd: dir, encoding: 'utf8', timeout: 60000});
      assert.equal(oracle.status, 0, oracle.stderr || oracle.stdout);
      const rows = readFileSync(join(dir, 'reference.csv'), 'utf8').trim().split('\n').slice(1)
        .map(line => line.trim().split(/\s+/).map(Number)).filter(row => row[0] > 0);
      assert.equal(rows.length, 200);
      rows.forEach((row, index) => {
        assert.equal(row.length, 3);
        assert.ok(row.every(Number.isFinite));
        assert.ok(Math.abs(row[0] - (index + 1) * 1e-6) <= 1e-12, 'oracle exact time grid');
        const exponential = Math.exp(-row[0] / 1e-5);
        const closed = sign * (kind === 'RC' ? 1 - exponential : exponential);
        assert.ok(Math.abs(row[1] - closed) <= 1e-7, 'ngspice independent closed-form control');
        assert.equal(row[2], sign, 'source polarity independently preserved');
      });
      const reference = {schemaVersion: 1, provenance: {kind: 'live-ngspice-zero-state-storage'},
        traces: [tip, 'V1.pos'].map((endpoint, index) => ({tip: endpoint, reference: 'V1.neg',
          samples: rows.map(row => ({timeSeconds: row[0], volts: row[index + 1]}))}))};
      writeFileSync(expectedPath, JSON.stringify(reference));
      const args = [CLI, 'measure', fixture, '--scope', `${tip},V1.neg`, '--scope', 'V1.pos,V1.neg',
        '--duration', '200us', '--rate', '1MHz', '--profile', 'precision-v1', '--initial', 'zero-state',
        '--expect', expectedPath, '--csv', csv, '--json'];
      const run = spawnSync(process.execPath, args, {encoding: 'utf8', timeout: 30000});
      assert.equal(run.status, 0, run.stderr || run.stdout);
      const report = JSON.parse(run.stdout);
      assert.equal(report.transient.accuracyMet, true);
      assert.equal(report.comparison.status, 'pass');
      assert.equal(report.comparison.counts.compared, 400);
      assert.equal(report.comparison.counts.passed, 400);
      assert.equal(report.claims.independentOracle, false);
      const sections = readFileSync(csv, 'utf8').trim().split('\n\n');
      assert.equal(sections.length, 2, 'CSV labels each independent channel, not one merged ring');
      sections.forEach((section, channel) => {
        assert.match(section.split('\n')[0], /capture=sample .*sampleIntervalNs=1000 points=200/);
        const captured = section.split('\n').slice(2).map(line => line.split(',').map(Number));
        assert.equal(captured.length, 200);
        captured.forEach((row, index) => {
          assert.ok(Math.abs(row[0] + report.scope[channel].startTimeSeconds - rows[index][0]) <= 1e-12);
          assert.ok(Math.abs(row[1] - rows[index][channel + 1]) <= 1e-6 + 1e-6 * Math.abs(rows[index][channel + 1]));
        });
      });
      reference.traces[0].samples[123].volts += .01;
      writeFileSync(expectedPath, JSON.stringify(reference));
      const mutant = spawnSync(process.execPath, args, {encoding: 'utf8', timeout: 30000});
      assert.equal(mutant.status, 1, mutant.stderr);
      assert.equal(JSON.parse(mutant.stdout).comparison.counts.failed, 1);
    } finally {rmSync(dir, {recursive: true, force: true});}
  });
}

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

test('scope summary preserves representable high/low range RMS and overflowed means', () => {
  const summarize = values => summarizeScope({samples:new Float64Array(values.flatMap(value=>[value,value])),
    count:values.length,writeIndex:0});
  const max=Number.MAX_VALUE,tiny=Number.MIN_VALUE;
  for (const value of [0,-0,1,-1,1e200,-1e200,1e-200,-1e-200,max,-max,tiny,-tiny]) {
    const result=summarize(Array(10).fill(value));
    assert.equal(result.samples,10);assert.equal(result.lastVolts,value);
    assert.equal(result.minVolts,value);assert.equal(result.maxVolts,value);
    assert.equal(result.rmsVolts,Math.abs(value),`constant ${value} RMS must remain representable`);
    assert.ok(Number.isFinite(result.meanVolts));
    if(value!==0)assert.ok(Math.abs(result.meanVolts/value-1)<1e-14);
  }
  const balanced=summarize([max,max,-max,-max]);
  assert.equal(balanced.meanVolts,0);assert.equal(balanced.rmsVolts,max);
  const unequal=summarize([1e308,1e308,-1e308]);
  assert.ok(Math.abs(unequal.meanVolts/(1e308/3)-1)<1e-14);
  assert.equal(unequal.rmsVolts,1e308);
  assert.equal(summarize([1e308,-1e308,1e-200]).meanVolts,1e-200/3,
    'preserve the finite ordinary sum; scaling every mean would lose this small residual');
  const mixed=summarize([3e200,-4e200,0]);
  assert.ok(Math.abs(mixed.rmsVolts/(5e200/Math.sqrt(3))-1)<1e-14,
    'independent 3-4-5 identity, not squared overflow, determines the mixed RMS');
  const wrapped={samples:new Float64Array([3e200,3e200,4e200,4e200,1e200,1e200,2e200,2e200]),
    count:4,writeIndex:2};
  assert.equal(summarizeScope(wrapped).lastVolts,4e200);
  assert.ok(Math.abs(summarizeScope(wrapped).rmsVolts/(Math.sqrt(7.5)*1e200)-1)<1e-14);
  assert.deepEqual(summarize([]),{samples:0,minVolts:null,maxVolts:null,meanVolts:null,rmsVolts:null,lastVolts:null});
});

test('actual CLI batch/watch scope summaries retain extreme finite ideal-source RMS',()=>{
  const dir=mkdtempSync(join(tmpdir(),'bwc-scope-range-'));
  try {
    const path=join(dir,'input.cir');
    for(const value of [1e200,-1e200,1e-200,-1e-200,1e308,-1e308]) {
      writeFileSync(path,`Extreme numeric boundary, not a realistic-voltage fixture\nV1 signal 0 DC ${value}\nR1 signal 0 1000\n.end\n`);
      for(const watch of [false,true]) {
        const run=spawnSync(process.execPath,[CLI,'measure',path,'--scope','V1.pos,V1.neg',
          '--duration','1ms','--rate','10kHz',...(watch?['--watch']:['--json'])],{encoding:'utf8'});
        assert.equal(run.status,0,run.stderr);
        const rows=watch?run.stdout.trim().split('\n').map(JSON.parse):[];
        const report=watch?rows.at(-1).report:JSON.parse(run.stdout);
        if(watch) {
          assert.equal(rows.filter(row=>row.recordType==='sample').length,10);
          for(const row of rows.filter(row=>row.recordType==='sample'))assert.equal(row.scope[0].volts,value);
        }
        const summary=report.scope[0].summary;
        assert.equal(summary.samples,10);assert.equal(summary.minVolts,value);assert.equal(summary.maxVolts,value);
        assert.ok(Number.isFinite(summary.meanVolts));assert.ok(Number.isFinite(summary.rmsVolts));
        assert.ok(Math.abs(summary.meanVolts/value-1)<1e-14);
        assert.equal(summary.rmsVolts,Math.abs(value),'ideal constant source RMS is independently |V|');
      }
    }
  } finally {rmSync(dir,{recursive:true,force:true});}
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

/** The engine-owned non-mutating DC operating point is reachable from CUI and bwc. */
import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Circuit } from '../src/model/circuit.js';

const root = join(import.meta.dirname, '..');
const cli = join(root, 'bin', 'bwc.mjs');

/**
 * The `scope` line is a hyphen-joined CAPABILITY LIST, and it grows.
 *
 * These cases used to pin it by equality — `grounded-static-native-r-c-v-i` —
 * which is a gate that reds every time bw-board GAINS a capability, and says
 * nothing about the one thing each case actually needs. When inductors and
 * explicit Shockley diodes landed upstream the line became
 * `grounded-static-native-r-c-l-d-v-i-e-g-exact-ideal-l-explicit-shockley-d`
 * and both cases failed for a reason that is not a defect. (Measured at
 * bw-board 7515f3e, before this repo's pin moved, so the two masters were
 * already incompatible and only the stale pin hid it.)
 *
 * Asserting MEMBERSHIP fires on a capability that disappears — which is the
 * regression worth catching — and not on one that appears.
 */
function assertScopeCovers(stdout, tokens) {
  const line = /scope\s+:\s*(\S+)/.exec(stdout);
  assert.ok(line, `no scope line in:\n${stdout}`);
  const have = new Set(line[1].split('-'));
  for (const t of tokens) {
    assert.ok(have.has(t),
      `the operating-point scope '${line[1]}' does not cover '${t}', which this case needs`);
  }
}

const terminal = (part, name) => ({ part, terminal: name });

function circuitFile(parts, nets) {
  let wireNumber = 0;
  return {
    vcc: 5,
    parts,
    wires: nets.flatMap(net => net.terminals.slice(1).map(to => ({
      id: `junction-wire-${++wireNumber}`,
      netId: net.id,
      from: { ...net.terminals[0] },
      to: { ...to },
    }))),
  };
}

const explicitDiode = id => ({
  id, kind: 'diode', params: { model: 'shockley', is: 1e-12, n: 1, rs: 0 },
});

function junctionBridge(volts) {
  const t = terminal;
  const nets = [
    { id: 'in', terminals: [t('V1', 'pos'), t('E1', 'inp'), t('D1', 'anode'), t('D3', 'cathode')] },
    { id: 'acn', terminals: [t('E1', 'outp'), t('D2', 'anode'), t('D4', 'cathode')] },
    { id: 'out', terminals: [t('D1', 'cathode'), t('D2', 'cathode'), t('RL', 'a')] },
    { id: 'ret', terminals: [t('D3', 'anode'), t('D4', 'anode'), t('RL', 'b')] },
    { id: 'gnd', terminals: [t('V1', 'neg'), t('E1', 'outn'), t('E1', 'inn'), t('G1', 'gnd')] },
  ];
  return { nets, file: circuitFile([
    { id: 'V1', kind: 'vsource', params: { volts } },
    { id: 'E1', kind: 'vcvs', params: { gain: -1 } },
    ...['D1', 'D2', 'D3', 'D4'].map(explicitDiode),
    { id: 'RL', kind: 'resistor', params: { ohms: 2000 } },
    { id: 'G1', kind: 'gnd', params: {} },
  ], nets) };
}

const npnParams = Object.freeze({
  model: 'shockley', is: 1e-15, beta: 100, br: 1, n: 1, rb: 0, rc: 0,
});

function symmetricTailPair() {
  const t = terminal;
  const nets = [
    { id: 'gnd', terminals: [t('VCC', 'neg'), t('VB', 'neg'), t('VS', 'neg'), t('IT', 'neg'), t('G1', 'gnd')] },
    { id: 'vcc', terminals: [t('VCC', 'pos'), t('RC1', 'a'), t('RC2', 'a')] },
    { id: 'in', terminals: [t('VS', 'pos'), t('Q1', 'base')] },
    { id: 'bref', terminals: [t('VB', 'pos'), t('Q2', 'base')] },
    { id: 'out', terminals: [t('RC1', 'b'), t('Q1', 'collector')] },
    { id: 'other', terminals: [t('RC2', 'b'), t('Q2', 'collector')] },
    { id: 'tail', terminals: [t('IT', 'pos'), t('Q1', 'emitter'), t('Q2', 'emitter')] },
  ];
  return { nets, file: circuitFile([
    { id: 'VCC', kind: 'vsource', params: { volts: 5 } },
    { id: 'VB', kind: 'vsource', params: { volts: .7 } },
    { id: 'VS', kind: 'vsource', params: { volts: .7 } },
    { id: 'RC1', kind: 'resistor', params: { ohms: 10000 } },
    { id: 'RC2', kind: 'resistor', params: { ohms: 10000 } },
    { id: 'IT', kind: 'isource', params: { amps: -1e-4 } },
    ...['Q1', 'Q2'].map(id => ({ id, kind: 'npn', params: { ...npnParams } })),
    { id: 'G1', kind: 'gnd', params: {} },
  ], nets) };
}

function boardWitness(board) {
  return {
    timeNs: board.timeNs,
    nodeVoltages: board.nodeVoltages,
    capVoltages: board.capVoltages,
    capCurrents: board.capCurrents,
    deviceStates: board._deviceStates,
    controls: board.controls,
    cache: board._mnaCache,
    solveParts: JSON.stringify(board._solveParts),
    values: structuredClone({
      nodes: board.nodeVoltages, capV: board.capVoltages, capI: board.capCurrents,
      devices: board._deviceStates, controls: board.controls,
    }),
  };
}

function assertBoardUnchanged(board, before) {
  assert.equal(board.timeNs, before.timeNs);
  assert.equal(board.nodeVoltages, before.nodeVoltages);
  assert.equal(board.capVoltages, before.capVoltages);
  assert.equal(board.capCurrents, before.capCurrents);
  assert.equal(board._deviceStates, before.deviceStates);
  assert.equal(board.controls, before.controls);
  assert.equal(board._mnaCache, before.cache);
  assert.equal(JSON.stringify(board._solveParts), before.solveParts);
  assert.deepEqual({
    nodes: board.nodeVoltages, capV: board.capVoltages, capI: board.capCurrents,
    devices: board._deviceStates, controls: board.controls,
  }, before.values);
}

function resultCurrent(result, part, name) {
  const value = result.branchCurrents.get(part)?.get(name);
  assert.ok(Number.isFinite(value), `finite current ${part}.${name}`);
  return value;
}

function assertResultKcl(result, nets) {
  for (const net of nets) {
    const total = net.terminals.reduce((sum, pin) => pin.part === 'G1'
      ? sum : sum + resultCurrent(result, pin.part, pin.terminal), 0);
    assert.ok(Math.abs(total) < 1e-10, `${net.id} signed terminal KCL ${total} A`);
  }
}

function outputValue(stdout, id, unit) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^\\s*${escaped}\\s+([-+0-9.eE]+) ${unit}\\s*$`, 'm').exec(stdout);
  assert.ok(match, `${id} absent from:\n${stdout}`);
  const value = Number(match[1]);
  assert.ok(Number.isFinite(value), `finite ${id}`);
  return value;
}

function assertOutputKcl(stdout, nets) {
  for (const net of nets) {
    const total = net.terminals.reduce((sum, pin) => pin.part === 'G1'
      ? sum : sum + outputValue(stdout, `${pin.part}.${pin.terminal}`, 'A'), 0);
    assert.ok(Math.abs(total) < 1e-10, `${net.id} CLI signed terminal KCL ${total} A`);
  }
}

function bisect(fn, low, high) {
  let fLow = fn(low);
  const fHigh = fn(high);
  assert.ok(Number.isFinite(fLow) && Number.isFinite(fHigh) && fLow * fHigh <= 0,
    `scalar reference bracket [${low}, ${high}]`);
  for (let step = 0; step < 160; step++) {
    const mid = (low + high) / 2, fMid = fn(mid);
    if (fLow * fMid <= 0) high = mid;
    else { low = mid; fLow = fMid; }
  }
  return (low + high) / 2;
}

// Independent scalar Ebers-Moll reduction for the exactly symmetric pair.
// It imports no engine function and solves only the two scalar conservation
// equations: one collector load line and one half of the 100 uA tail current.
function symmetricTailReference() {
  const vt = .02585, is = 1e-15, bf = 100, gmin = 1e-12, load = 10000;
  const forward = vbe => is * Math.expm1(vbe / vt);
  // In this fixture Vbc is nearly -4 V, so the reverse exponential is zero
  // to far below the asserted current bound and its junction current is -IS.
  const vbe = bisect(y => forward(y) * (1 + 1 / bf) + is + gmin * y - 50e-6, 0, .7);
  const collector = (forward(vbe) + 2 * is + gmin * (5 - .7)) / (1 + gmin * load);
  return {
    collectorV: 5 - load * collector,
    tailV: .7 - vbe,
    base: 50e-6 - collector,
    collector,
    emitter: -50e-6,
  };
}

describe('static operating-point reachability', () => {
  it('bwc op names aliased supply currents instead of presenting an arbitrary individual current', () => {
    const directory=mkdtempSync(join(tmpdir(),'bw-op-current-'));
    try{
      const fixture=join(directory,'aliases.json');
      for(const reverse of [false,true]){
        const supplies=[{id:'A',kind:'vcc',params:{volts:5}},{id:'B',kind:'vcc',params:{volts:5}}];
        if(reverse) supplies.reverse();
        writeFileSync(fixture,JSON.stringify({parts:[...supplies,
          {id:'R',kind:'resistor',params:{ohms:1000}},{id:'G',kind:'gnd',params:{}}],wires:[
          {from:'A',fromTerminal:'vcc',to:'B',toTerminal:'vcc'},
          {from:'A',fromTerminal:'vcc',to:'R',toTerminal:'a'},
          {from:'R',fromTerminal:'b',to:'G',toTerminal:'gnd'},
        ]}));
        const run=spawnSync(process.execPath,[cli,'op',fixture],{encoding:'utf8'});
        assert.equal(run.status,0,run.stderr||run.stdout);
        for(const id of ['A','B']) assert.match(run.stdout,new RegExp(`${id}: current indeterminate \\(no individual measurement\\)`));
        assert.doesNotMatch(run.stdout,/[AB]\.vcc\s+[-+0-9.e]+ A/);
        const load=/R\.a\s+([-+0-9.e]+) A/.exec(run.stdout);
        assert.ok(load,run.stdout);assert.ok(Math.abs(Number(load[1])-.005)<1e-12);
      }
      const zero=join(directory,'zero.cir');
      writeFileSync(zero,'zero source control\nV1 rail 0 5\nR1 rail 0 1k\nVZERO rail rail 0\n.end\n');
      const run=spawnSync(process.execPath,[cli,'op',zero],{encoding:'utf8'});
      assert.equal(run.status,0,run.stderr||run.stdout);
      assert.match(run.stdout,/VZERO: current indeterminate/);
      assert.doesNotMatch(run.stdout,/VZERO\.(pos|neg)\s+[-+0-9.e]+ A/);
      const sweepArgs=['--source','V1','--from','4','--to','5','--points','2','--json'];
      const refused=spawnSync(process.execPath,[cli,'dc-sweep',zero,...sweepArgs,'--current','VZERO.pos'],{encoding:'utf8'});
      assert.equal(refused.status,2,refused.stdout+refused.stderr);
      assert.match(refused.stderr,/DC point 0 .*indeterminate OP terminal current for VZERO\.pos/);
      assert.equal(refused.stdout,'','no partial numeric sweep on unavailable current');
      const valid=spawnSync(process.execPath,[cli,'dc-sweep',zero,...sweepArgs,'--current','R1.a'],{encoding:'utf8'});
      assert.equal(valid.status,0,valid.stderr);
      assert.deepEqual(JSON.parse(valid.stdout).samples.map(row=>row.values[0]),[.004,.005]);
    }finally{rmSync(directory,{recursive:true,force:true});}
  });

  it('Circuit delegates to the engine result without adopting it', () => {
    const c = Circuit.fromJSON({
      vcc: 5,
      parts: [
        { id: 'V1', kind: 'vsource', params: { volts: 6 } },
        { id: 'R1', kind: 'resistor', params: { ohms: 2000 } },
        { id: 'R2', kind: 'resistor', params: { ohms: 1000 } },
        { id: 'C1', kind: 'capacitor', params: { farads: 10e-6 } },
        { id: 'GND1', kind: 'gnd', params: {} },
      ],
      wires: [
        { from: 'V1', fromTerminal: 'pos', to: 'R1', toTerminal: 'a' },
        { from: 'R1', fromTerminal: 'b', to: 'R2', toTerminal: 'a' },
        { from: 'R1', fromTerminal: 'b', to: 'C1', toTerminal: 'a' },
        { from: 'V1', fromTerminal: 'neg', to: 'R2', toTerminal: 'b' },
        { from: 'R2', fromTerminal: 'b', to: 'C1', toTerminal: 'b' },
        { from: 'C1', fromTerminal: 'b', to: 'GND1', toTerminal: 'gnd' },
      ],
    });
    c.setPower(true);
    const before = c.board.snapshot();
    const result = c.operatingPoint();
    assert.equal(result.converged, true);
    assert.equal(result.analysis.kind, 'dc-operating-point');
    assert.deepEqual(c.board.snapshot(), before, 'the proxy must not adopt the offline result');
  });

  it('Circuit and bwc op solve the explicit Shockley bridge at zero and both polarities', () => {
    const directory = mkdtempSync(join(tmpdir(), 'bw-op-junction-bridge-'));
    const expectedByMagnitude = new Map([
      [0, { out: 0, ret: -0, load: 0 }],
      [2, { out: 1.4546164899579863, ret: -1.4546164899579863,
        load: 0.0014546164899579862 }],
    ]);
    try {
      for (const volts of [-2, 0, 2]) {
        const { file, nets } = junctionBridge(volts);
        const c = Circuit.fromJSON(file);
        assert.equal(c.netlistError, null);
        c.setPower(true);
        const before = boardWitness(c.board);
        const op = c.operatingPoint();
        assert.equal(op.converged, true, `${volts} V Circuit bridge`);
        const expected = expectedByMagnitude.get(Math.abs(volts));
        assert.ok(Math.abs(op.nodeVoltages.get('out') - expected.out) < 1e-8);
        assert.ok(Math.abs(op.nodeVoltages.get('ret') - expected.ret) < 1e-8);
        assert.ok(Math.abs(resultCurrent(op, 'RL', 'a') - expected.load) < 1e-10);
        if (volts) assert.equal(Math.sign(resultCurrent(op, 'V1', 'pos')), -Math.sign(volts));
        assertResultKcl(op, nets);
        assertBoardUnchanged(c.board, before);

        const fixture = join(directory, `bridge-${volts}.json`);
        writeFileSync(fixture, JSON.stringify(file));
        const run = spawnSync(process.execPath, [cli, 'op', fixture], { encoding: 'utf8' });
        assert.equal(run.status, 0, run.stderr || run.stdout);
        assertScopeCovers(run.stdout, ['d', 'explicit', 'shockley']);
        assert.ok(Math.abs(outputValue(run.stdout, 'out', 'V') - expected.out) < 1e-8);
        assert.ok(Math.abs(outputValue(run.stdout, 'ret', 'V') - expected.ret) < 1e-8);
        assert.ok(Math.abs(outputValue(run.stdout, 'RL.a', 'A') - expected.load) < 1e-10);
        if (volts) assert.equal(Math.sign(outputValue(run.stdout, 'V1.pos', 'A')), -Math.sign(volts));
        assertOutputKcl(run.stdout, nets);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('Circuit and bwc op solve the symmetric explicit NPN constant-current tail', () => {
    const { file, nets } = symmetricTailPair();
    const expected = symmetricTailReference();
    const c = Circuit.fromJSON(file);
    assert.equal(c.netlistError, null);
    c.setPower(true);
    const before = boardWitness(c.board);
    const op = c.operatingPoint();
    assert.equal(op.converged, true);
    assert.ok(Math.abs(op.nodeVoltages.get('out') - expected.collectorV) < 1e-8);
    assert.ok(Math.abs(op.nodeVoltages.get('other') - expected.collectorV) < 1e-8);
    assert.ok(Math.abs(op.nodeVoltages.get('tail') - expected.tailV) < 1e-8);
    for (const id of ['Q1', 'Q2']) {
      for (const name of ['base', 'collector', 'emitter']) {
        assert.ok(Math.abs(resultCurrent(op, id, name) - expected[name]) < 1e-10,
          `${id}.${name} independent scalar current`);
      }
    }
    assert.ok(Math.abs(resultCurrent(op, 'IT', 'pos') - 1e-4) < 1e-12,
      'negative native injection is positive into the tail-source terminal');
    assertResultKcl(op, nets);
    assertBoardUnchanged(c.board, before);

    const directory = mkdtempSync(join(tmpdir(), 'bw-op-junction-tail-'));
    try {
      const fixture = join(directory, 'symmetric-tail.json');
      writeFileSync(fixture, JSON.stringify(file));
      const run = spawnSync(process.execPath, [cli, 'op', fixture], { encoding: 'utf8' });
      assert.equal(run.status, 0, run.stderr || run.stdout);
      assertScopeCovers(run.stdout, ['npn', 'level1', 'explicit']);
      for (const net of ['out', 'other']) {
        assert.ok(Math.abs(outputValue(run.stdout, net, 'V') - expected.collectorV) < 1e-8);
      }
      assert.ok(Math.abs(outputValue(run.stdout, 'tail', 'V') - expected.tailV) < 1e-8);
      for (const id of ['Q1', 'Q2']) for (const name of ['base', 'collector', 'emitter']) {
        assert.ok(Math.abs(outputValue(run.stdout, `${id}.${name}`, 'A') - expected[name]) < 1e-10);
      }
      assert.ok(Math.abs(outputValue(run.stdout, 'IT.pos', 'A') - 1e-4) < 1e-12);
      assertOutputKcl(run.stdout, nets);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('bwc op imports and numerically solves the self-authored RC deck', () => {
    const fixture = join(root, 'test', 'fixtures', 'spice-static-rc-op.cir');
    const r = spawnSync(process.execPath, [cli, 'op', fixture], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    assert.match(r.stdout, /\[spice\]\s+DC operating point/);
    assert.match(r.stdout, /converged: yes/);
    assertScopeCovers(r.stdout, ['grounded', 'static', 'native', 'r', 'c', 'v', 'i']);
    // Not vacuous: a capability the scope does NOT name must fail.
    assert.throws(() => assertScopeCovers(r.stdout, ['bsim']), /does not cover 'bsim'/);
    assert.match(r.stdout, /sources\s+: fixed-dc-only/);
    assert.match(r.stdout, /capacitors: open/);
    assert.match(r.stdout, /positive-into-part-terminal/);
    const current = /R1\.a\s+([\d.eE+-]+) A/.exec(r.stdout);
    assert.ok(current, r.stdout);
    assert.ok(Math.abs(Number(current[1]) - 0.002) < 1e-12, current[1]);
    assert.match(r.stdout, /C1\.a\s+0\.00000000000 A/);
  });

  it('bwc op refuses a lossy external waveform before simulation', () => {
    const fixture = join(root, 'test', 'fixtures', 'spice-wavefile-source.net');
    const r = spawnSync(process.execPath, [cli, 'op', fixture], { encoding: 'utf8' });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /refuses 1 semantic import loss/);
    assert.doesNotMatch(r.stdout, /DC operating point/);
  });

  it('bwc op solves imported ideal E/G and reports the supported controlled domain', () => {
    const fixture = join(root, 'test', 'fixtures', 'spice-controlled-op.cir');
    const r = spawnSync(process.execPath, [cli, 'op', fixture], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    assertScopeCovers(r.stdout, ['grounded', 'static', 'native', 'r', 'c', 'v', 'i', 'e', 'g']);
    assert.match(r.stdout, /controlled: ideal-explicit-finite-parameters-only/);
    assert.match(r.stdout, /kinds\s+: .*vcvs, vccs/);
    const current = terminal => {
      const match = new RegExp(`${terminal}\\s+([-+0-9.e]+) A`).exec(r.stdout);
      assert.ok(match, r.stdout);
      return Number(match[1]);
    };
    assert.ok(Math.abs(current('E1\\.outp') + 2e-3) < 5e-12);
    assert.ok(Math.abs(current('G1\\.outn') - 1e-3) < 1e-12);
  });
});

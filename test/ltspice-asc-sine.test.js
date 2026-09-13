import './_setup.js';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { importCircuit } from '../src/importers/index.js';
import { Circuit } from '../src/model/circuit.js';
import { extractNetlist } from '../src/model/netlist.js';
import { toSpice } from '../src/model/exporters/spice.js';

const SINE_BENCH = `Version 4
SHEET 1 160 160
WIRE 0 16 96 16
WIRE 0 96 96 96
FLAG 0 96 0
SYMBOL voltage 0 0 R0
SYMATTR InstName V1
SYMATTR Value SINE(1.25 -2 2k)
SYMBOL res 80 0 R0
SYMATTR InstName R1
SYMATTR Value 1k
`;

function netAt(circuit, part, terminal) {
  const matches = circuit.board.getNets().filter(net => net.terminals.some(item =>
    item.part === part && item.terminal === terminal));
  assert.equal(matches.length, 1, `${part}.${terminal} must resolve once`);
  return matches[0].id;
}

function activeSourceCards(text) {
  return text.split('\n').filter(line => /^[VI]\S*\s/.test(line));
}

function measure(output, name) {
  const match = new RegExp(`^${name}\\s*=\\s*([-+.0-9eE]+)`, 'm').exec(output);
  assert.ok(match, `missing ${name} in ngspice output:\n${output}`);
  return Number(match[1]);
}

describe('LTspice ASC strict three-argument voltage SINE', () => {
  it('preserves the waveform through ASC, Circuit, SPICE export, and SPICE re-import', () => {
    const imported = importCircuit('ltspice-asc', SINE_BENCH);
    assert.deepEqual(imported.unmapped, []);
    assert.deepEqual(imported.losses, []);
    assert.deepEqual(imported.parts.find(part => part.id === 'V1').params, {
      volts: 1.25, wave: 'sine', offset: 1.25, amplitude: -2, freq: 2000, phase: 0,
    });

    const circuit = Circuit.fromJSON({ vcc: 5, parts: imported.parts, wires: imported.wires });
    circuit.setPower(true);
    assert.throws(() => circuit.operatingPoint(), /time-varying source V1 \(sine\)/);
    const signal = netAt(circuit, 'V1', 'pos');
    circuit.advanceTo(125_000n);
    assert.ok(Math.abs(circuit.nodeVoltage(signal) - (-0.75)) < 1e-9);
    assert.ok(Math.abs(circuit.branchCurrent('R1', 'a') - 0.00075) < 1e-10);
    circuit.advanceTo(375_000n);
    assert.ok(Math.abs(circuit.nodeVoltage(signal) - 3.25) < 1e-9);
    assert.ok(Math.abs(circuit.branchCurrent('R1', 'a') - (-0.00325)) < 1e-10);

    const exported = toSpice(extractNetlist(circuit), 'strict sine round trip');
    assert.deepEqual(exported.skipped, []);
    assert.match(exported.text, /^V1\s+\S+\s+0\s+SINE\(1\.25 -2 2k\)$/m);
    assert.doesNotMatch(exported.text, /^V1\s+.*\sDC\s/m);
    const back = importCircuit('spice', exported.text);
    assert.deepEqual(back.losses, []);
    assert.deepEqual(back.parts.find(part => part.id === 'V1').params,
      imported.parts.find(part => part.id === 'V1').params);
  });

  it('matches signed voltage and resistor-current samples from ngspice', () => {
    const imported = importCircuit('ltspice-asc', SINE_BENCH);
    const circuit = Circuit.fromJSON({ vcc: 5, parts: imported.parts, wires: imported.wires });
    circuit.setPower(true);
    const signal = netAt(circuit, 'V1', 'pos');
    const actual = [];
    for (const t of [125_000n, 375_000n]) {
      circuit.advanceTo(t);
      actual.push(circuit.nodeVoltage(signal), circuit.branchCurrent('R1', 'a'));
    }

    const oracle = spawnSync('ngspice', ['-b'], { input: `* strict three-argument sine oracle
V1 n 0 SINE(1.25 -2 2k)
R1 n 0 1k
.tran 10n 375u 0 10n
.meas tran vq FIND v(n) AT=125u
.meas tran iq FIND i(V1) AT=125u
.meas tran vt FIND v(n) AT=375u
.meas tran it FIND i(V1) AT=375u
.end
`, encoding: 'utf8', timeout: 10_000 });
    assert.equal(oracle.status, 0, oracle.stderr || oracle.stdout);
    const output = `${oracle.stdout}\n${oracle.stderr}`;
    const expected = ['vq', 'iq', 'vt', 'it'].map(name => measure(output, name));
    expected.forEach((value, index) => {
      assert.ok(Number.isFinite(value));
      assert.ok(Math.abs(actual[index] - value) < 1e-7,
        `${['vq', 'iq', 'vt', 'it'][index]} engine=${actual[index]} ngspice=${value}`);
    });
    assert.ok(expected.some(value => value < 0) && expected.some(value => value > 0),
      'the independent observations must exercise both signs');
  });

  it('refuses defaults, extra arguments, invalid numbers, non-positive frequency, and current waves', () => {
    const values = [
      'SINE(0 1)', 'SINE(0 1 0)', 'SINE(0 1 -1k)', 'SINE(0 nope 1k)',
      'SINE(0 1 1k 0)', 'DC 2 SINE(0 1 1k)',
    ];
    for (const value of values) {
      const result = importCircuit('ltspice-asc', SINE_BENCH.replace('SINE(1.25 -2 2k)', value));
      assert.equal(result.losses.length, 1, value);
      assert.ok(!Object.hasOwn(result.parts.find(part => part.id === 'V1').params, 'wave'), value);
    }
    const current = importCircuit('ltspice-asc', SINE_BENCH
      .replace('SYMBOL voltage 0 0 R0', 'SYMBOL current 0 16 R0')
      .replace('SINE(1.25 -2 2k)', 'SINE(0 1m 2k)'));
    assert.equal(current.losses.length, 1);
    assert.ok(!Object.hasOwn(current.parts.find(part => part.id === 'V1').params, 'wave'));
  });

  it('does not export unsupported or non-ideal waveform sources as plausible DC cards', () => {
    const imported = importCircuit('ltspice-asc', SINE_BENCH);
    const cases = [
      { wave: 'square', volts: 1, offset: 0, amplitude: 1, freq: 1000, phase: 0 },
      { wave: 'sine', volts: 0, offset: 0, amplitude: 1, freq: 1000, phase: 90 },
      { wave: 'sine', volts: 0, offset: 0, amplitude: 1, freq: 1000, phase: 0, rInternal: 50 },
      { wave: 'sine', volts: 0, offset: 0, amplitude: 1, freq: 1000, phase: 0, iLimit: 0.1 },
    ];
    for (const params of cases) {
      const parts = structuredClone(imported.parts);
      parts.find(part => part.id === 'V1').params = params;
      const circuit = Circuit.fromJSON({ vcc: 5, parts, wires: imported.wires });
      const exported = toSpice(extractNetlist(circuit));
      assert.equal(exported.skipped.length, 1, JSON.stringify(params));
      assert.deepEqual(activeSourceCards(exported.text), [], JSON.stringify(params));
      assert.match(exported.text, /time-varying source not losslessly exportable/);
    }
  });

  it('SPICE re-import keeps strict SIN/SINE but records semantic loss for unsupported variants', () => {
    for (const spelling of ['SIN(-1 2 3k)', 'SINE(-1 2 3k)']) {
      const imported = importCircuit('spice', `sine\nV1 n 0 ${spelling}\nR1 n 0 1k\n.end\n`);
      assert.deepEqual(imported.losses, []);
      assert.deepEqual(imported.parts.find(part => part.id === 'V1').params,
        { volts: -1, wave: 'sine', offset: -1, amplitude: 2, freq: 3000, phase: 0 });
    }
    for (const value of ['SINE(0 1 1k 0)', 'DC 2 SINE(0 1 1k)', 'SINE(0 1 0)']) {
      const imported = importCircuit('spice', `sine loss\nV1 n 0 ${value}\nR1 n 0 1k\n.end\n`);
      assert.equal(imported.losses.length, 1, value);
      assert.equal(imported.losses[0].kind, 'unsupported-inline-waveform');
      assert.ok(!Object.hasOwn(imported.parts.find(part => part.id === 'V1').params, 'wave'), value);
    }
  });
});

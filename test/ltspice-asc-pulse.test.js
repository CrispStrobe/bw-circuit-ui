import './_setup.js';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { importCircuit } from '../src/importers/index.js';
import { Circuit } from '../src/model/circuit.js';
import { extractNetlist } from '../src/model/netlist.js';
import { toSpice } from '../src/model/exporters/spice.js';

const PULSE_VALUE = 'PULSE(0 5 1u 2n 3n 18u 20u)';
const PARAMS = {
  volts: 0, wave: 'spice-pulse', v1: 0, v2: 5,
  td: 1e-6, tr: 2e-9, tf: 3e-9, pw: 18e-6, per: 20e-6,
};

const ASC_BENCH = `Version 4
SHEET 1 160 160
WIRE 0 16 96 16
WIRE 0 96 96 96
FLAG 0 96 0
SYMBOL voltage 0 0 R0
SYMATTR InstName V1
SYMATTR Value ${PULSE_VALUE}
SYMBOL res 80 0 R0
SYMATTR InstName R1
SYMATTR Value 1k
`;

const SPICE_RC = `* self-authored nanosecond-edge PULSE RC
V1 src 0 ${PULSE_VALUE}
R1 src out 1k
C1 out 0 1n
.tran 1n 22u
.end
`;

function netAt(circuit, part, terminal) {
  const matches = circuit.board.getNets().filter(net => net.terminals.some(item =>
    item.part === part && item.terminal === terminal));
  assert.equal(matches.length, 1, `${part}.${terminal} must resolve once`);
  return matches[0].id;
}

function measure(output, name) {
  const match = new RegExp(`^${name}\\s*=\\s*([-+.0-9eE]+)`, 'm').exec(output);
  assert.ok(match, `missing ${name} in ngspice output:\n${output}`);
  return Number(match[1]);
}

describe('strict seven-argument voltage PULSE import and export', () => {
  it('preserves ASC through Circuit, SPICE export, and SPICE re-import', () => {
    const imported = importCircuit('ltspice-asc', ASC_BENCH);
    assert.deepEqual(imported.unmapped, []);
    assert.deepEqual(imported.losses, []);
    assert.deepEqual(imported.parts.find(part => part.id === 'V1').params, PARAMS);

    const circuit = Circuit.fromJSON({ vcc: 5, parts: imported.parts, wires: imported.wires });
    circuit.setPower(true);
    assert.throws(() => circuit.operatingPoint(), /time-varying source V1 \(spice-pulse\)/);
    const signal = netAt(circuit, 'V1', 'pos');
    circuit.advanceTo(1_002n);
    assert.ok(Math.abs(circuit.nodeVoltage(signal) - 5) < 1e-9);

    const exported = toSpice(extractNetlist(circuit), 'strict pulse round trip');
    assert.deepEqual(exported.skipped, []);
    assert.match(exported.text, /^V1\s+\S+\s+0\s+PULSE\(0 5 1u 2n 3n 18u 20u\)$/m);
    assert.doesNotMatch(exported.text, /^V1\s+.*\sDC\s/m);
    const back = importCircuit('spice', exported.text);
    assert.deepEqual(back.losses, []);
    assert.deepEqual(back.parts.find(part => part.id === 'V1').params, PARAMS);
  });

  it('matches ngspice for an imported RC at and around one-nanosecond edges', {
    skip: spawnSync('ngspice', ['--version'], { encoding: 'utf8' }).status !== 0,
  }, () => {
    const imported = importCircuit('spice', SPICE_RC);
    assert.deepEqual(imported.losses, []);
    const circuit = Circuit.fromJSON({ vcc: 5, parts: imported.parts, wires: imported.wires });
    circuit.setPower(true);
    const src = netAt(circuit, 'V1', 'pos');
    const out = netAt(circuit, 'C1', 'a');
    const timesNs = [500n, 1_000n, 1_001n, 2_000n, 20_001n, 20_002n, 21_000n, 21_001n];
    const actual = [];
    for (const t of timesNs) {
      circuit.advanceTo(t);
      actual.push([circuit.nodeVoltage(src), circuit.nodeVoltage(out)]);
    }

    const measures = timesNs.flatMap((t, index) => {
      const seconds = Number(t) / 1e9;
      return [`.meas tran src${index} FIND v(src) AT=${seconds}`,
        `.meas tran out${index} FIND v(out) AT=${seconds}`];
    }).join('\n');
    const oracle = spawnSync('ngspice', ['-b'], { input: SPICE_RC.replace('.end', `${measures}\n.end`),
      encoding: 'utf8', timeout: 10_000 });
    assert.equal(oracle.status, 0, oracle.stderr || oracle.stdout);
    const output = `${oracle.stdout}\n${oracle.stderr}`;
    for (let i = 0; i < timesNs.length; i++) {
      const wantSrc = measure(output, `src${i}`);
      const wantOut = measure(output, `out${i}`);
      assert.ok(Math.abs(actual[i][0] - wantSrc) < 1e-7,
        `source at ${timesNs[i]} ns: engine=${actual[i][0]} ngspice=${wantSrc}`);
      assert.ok(Math.abs(actual[i][1] - wantOut) < 0.001,
        `RC at ${timesNs[i]} ns: engine=${actual[i][1]} ngspice=${wantOut}`);
    }
  });

  it('retains invalid/defaulted/extra/expression/overlap forms as losses', () => {
    const values = [
      'PULSE(0 5 1u 1n 1n 19u)',
      'PULSE(0 5 1u 1n 1n 19u 20u 3)',
      'PULSE(0 5 1u 0 1n 19u 20u)',
      'PULSE(0 5 1u 1n 0 19u 20u)',
      'PULSE(0 {rail} 1u 1n 1n 19u 20u)',
      'PULSE(0 5 1u 2u 2u 8u 10u)',
      'DC 2 PULSE(0 5 1u 1n 1n 19u 20u)',
    ];
    for (const value of values) {
      const result = importCircuit('ltspice-asc', ASC_BENCH.replace(PULSE_VALUE, value));
      assert.equal(result.losses.length, 1, value);
      assert.ok(!Object.hasOwn(result.parts.find(part => part.id === 'V1').params, 'wave'), value);
    }
  });

  it('keeps current-source PULSE explicit and never emits non-ideal pulse cards', () => {
    const currentAsc = ASC_BENCH
      .replace('SYMBOL voltage 0 0 R0', 'SYMBOL current 0 16 R0');
    const current = importCircuit('ltspice-asc', currentAsc);
    assert.equal(current.losses.length, 1);
    assert.match(current.losses[0].reason, /current PULSE/);

    const currentSpice = importCircuit('spice', `* current pulse\nI1 n 0 ${PULSE_VALUE}\nR1 n 0 1k\n.end\n`);
    assert.equal(currentSpice.losses.length, 1);
    assert.match(currentSpice.losses[0].reason, /current PULSE/);

    const valid = importCircuit('ltspice-asc', ASC_BENCH);
    for (const change of [
      { rInternal: 50 },
      { iLimit: 0.1 },
      { tr: 0 },
      { pw: 21e-6 },
    ]) {
      const parts = structuredClone(valid.parts);
      Object.assign(parts.find(part => part.id === 'V1').params, change);
      const circuit = Circuit.fromJSON({ vcc: 5, parts, wires: valid.wires });
      const exported = toSpice(extractNetlist(circuit));
      assert.equal(exported.skipped.length, 1, JSON.stringify(change));
      assert.doesNotMatch(exported.text, /^V1\s/m, JSON.stringify(change));
    }
  });
});

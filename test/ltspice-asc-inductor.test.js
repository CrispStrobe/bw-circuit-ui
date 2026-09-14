import './_setup.js';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { importCircuit } from '../src/importers/index.js';
import { Circuit } from '../src/model/circuit.js';
import { extractNetlist } from '../src/model/netlist.js';
import { toSpice } from '../src/model/exporters/spice.js';

const asc = (value = '2m', extra = '') => `Version 4
SHEET 1 240 240
WIRE 0 16 96 16
WIRE 96 96 96 112
WIRE 0 96 0 192
WIRE 0 192 96 192
SYMBOL voltage 0 0 R0
SYMATTR InstName V1
SYMATTR Value 5
SYMBOL ind 80 0 R0
SYMATTR InstName L1
SYMATTR Value ${value}
${extra}SYMBOL res 80 96 R0
SYMATTR InstName R1
SYMATTR Value 1k
FLAG 0 96 0
TEXT 200 220 Left 2 !.op
`;

describe('standard LTspice ASC inductor', () => {
  it('preserves A/B connectivity, value, JSON and ideal-L DC current', (t) => {
    const imported = importCircuit('ltspice-asc', asc());
    assert.deepEqual(imported.unmapped, []);
    assert.deepEqual(imported.losses, []);
    assert.deepEqual(imported.parts.find(p => p.id === 'L1').params, { henrys: 0.002 });
    const circuit = Circuit.fromJSON({ parts: imported.parts, wires: imported.wires });
    const loaded = Circuit.fromJSON(circuit.toJSON());
    const op = loaded.operatingPoint();
    assert.equal(op.converged, true);
    assert.ok(Math.abs(op.branchCurrents.get('L1').get('a') - 0.005) < 1e-10);
    assert.ok(Math.abs(op.branchCurrents.get('L1').get('a') + op.branchCurrents.get('L1').get('b')) < 1e-12);
    loaded.setPower(true);
    loaded.board.advanceTo(10_000n);
    const transientCurrent = loaded.board.branchCurrent('L1', 'a');
    assert.ok(Math.abs(transientCurrent) > 0.0048 && Math.abs(transientCurrent) < 0.0051,
      `10 us RL current must approach 5 mA, got ${transientCurrent}`);
    const exported = toSpice(extractNetlist(loaded));
    assert.deepEqual(exported.skipped, []);
    assert.match(exported.text, /^L1\s+\S+\s+\S+\s+2m$/m);
    const again = importCircuit('spice', exported.text);
    assert.equal(again.parts.find(p => p.id === 'L1').params.henrys, 0.002);

    const oracle = spawnSync('ngspice', ['-b'], { input: '* RL oracle\nV1 in 0 5\nL1 in out 2m\nR1 out 0 1k\n.op\n.print op @l1[i]\n.end\n', encoding: 'utf8' });
    if (oracle.error?.code === 'ENOENT') return t.skip('ngspice is not installed');
    assert.ifError(oracle.error); assert.equal(oracle.status, 0, oracle.stderr);
    assert.match(oracle.stdout, /5\.000000e-03/);
  });

  it('retains invalid values and extra model attributes as analysis losses', () => {
    for (const source of [asc('0'), asc('-1m'), asc('2m', 'SYMATTR Value2 Rser=3\n')]) {
      const imported = importCircuit('ltspice-asc', source);
      assert.ok(imported.losses.length >= 1);
    }
  });
});

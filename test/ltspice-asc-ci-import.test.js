import './_setup.js';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { importCircuit } from '../src/importers/index.js';
import { Circuit } from '../src/model/circuit.js';

function netAt(circuit, part, terminal) {
  const matches = circuit.board.getNets().filter(net => net.terminals.some(item =>
    item.part === part && item.terminal === terminal));
  assert.equal(matches.length, 1, `${part}.${terminal} must resolve once`);
  return matches[0].id;
}

describe('LTspice ASC capacitor/current-source extension', () => {
  it('maps rotated current SpiceOrder 1→2 to native neg→pos with signed KCL', () => {
    const text = `Version 4
SHEET 1 200 120
FLAG 0 0 0
SYMBOL current 80 0 R90
SYMATTR InstName I1
SYMATTR Value 2m
SYMBOL res 96 -16 R90
SYMATTR InstName R1
SYMATTR Value 1k
`;
    const imported = importCircuit('ltspice-asc', text);
    assert.deepEqual(imported.unmapped, []);
    assert.deepEqual(imported.losses, []);
    assert.equal(imported.parts.find(part => part.id === 'I1').params.amps, 0.002);
    assert.ok(imported.wires.some(wire => wire.from === 'I1' && wire.fromTerminal === 'neg'
      && wire.to === 'R1' && wire.toTerminal === 'a'), 'SpiceOrder 1 must map to native neg');
    assert.ok(imported.wires.some(wire => wire.from === 'I1' && wire.fromTerminal === 'pos'
      && wire.to === 'R1' && wire.toTerminal === 'b'), 'SpiceOrder 2 must map to native pos');

    const circuit = Circuit.fromJSON({ vcc: 5, parts: imported.parts, wires: imported.wires });
    const point = circuit.operatingPoint();
    assert.equal(point.converged, true);
    assert.ok(Math.abs(point.nodeVoltages.get(netAt(circuit, 'R1', 'a')) + 2) < 1e-8);
    assert.equal(point.branchCurrents.get('I1').get('neg'), 0.002);
    assert.ok(Math.abs(point.branchCurrents.get('R1').get('a') + 0.002) < 1e-8);
    assert.ok(Math.abs(point.branchCurrents.get('I1').get('neg')
      + point.branchCurrents.get('R1').get('a')) < 1e-8);

    const oracle = spawnSync('ngspice', ['-b'], { input: `* signed current-source oracle
I1 n 0 2m
R1 n 0 1k
.op
.control
set numdgt=17
op
echo __V__
print v(n)
echo __R__
print @r1[i]
quit
.endc
.end
`, encoding: 'utf8', timeout: 10_000 });
    assert.equal(oracle.status, 0, oracle.stderr || oracle.stdout);
    const output = `${oracle.stdout}\n${oracle.stderr}`;
    assert.match(output, /v\(n\)\s*=\s*-2\.0000000000000000e\+00/);
    assert.match(output, /@r1\[i\]\s*=\s*-2\.0000000000000000e-03/);
  });

  it('imports an ideal capacitor and preserves DC-open operating-point behavior', () => {
    const text = `Version 4
SHEET 1 240 220
WIRE 0 16 96 16
WIRE 0 96 0 176
WIRE 0 176 96 176
WIRE 96 96 160 96
WIRE 160 160 160 176
WIRE 96 176 160 176
FLAG 96 176 0
SYMBOL voltage 0 0 R0
SYMATTR InstName V1
SYMATTR Value 6
SYMBOL res 80 0 R0
SYMATTR InstName R1
SYMATTR Value 1k
SYMBOL res 80 80 R0
SYMATTR InstName R2
SYMATTR Value 2k
SYMBOL cap 144 96 R0
SYMATTR InstName C1
SYMATTR Value 10u
TEXT 200 200 Left 2 !.op
`;
    const imported = importCircuit('ltspice-asc', text);
    assert.deepEqual(imported.unmapped, []);
    assert.deepEqual(imported.losses, []);
    assert.equal(imported.parts.find(part => part.id === 'C1').params.farads, 10e-6);
    const circuit = Circuit.fromJSON({ vcc: 5, parts: imported.parts, wires: imported.wires });
    const point = circuit.operatingPoint();
    assert.equal(point.converged, true);
    assert.ok(Math.abs(point.nodeVoltages.get(netAt(circuit, 'C1', 'a')) - 4) < 1e-8);
    assert.equal(Math.abs(point.branchCurrents.get('C1').get('a')), 0);
    assert.equal(Math.abs(point.branchCurrents.get('C1').get('b')), 0);
    assert.ok(Math.abs(point.branchCurrents.get('R1').get('a') - 0.002) < 1e-8);
  });
});

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { importSpice } from '../src/importers/spice.js';
import { Circuit } from '../src/model/circuit.js';
import { extractNetlist } from '../src/model/netlist.js';
import { toSpice } from '../src/model/exporters/spice.js';
import { blockersFromImport } from '../src/model/operating-point-view.js';

const TEMP = '26.826793442075882';
const deck = (model = 'D(IS=2e-12 N=1.3 RS=4)', thermal = `.temp ${TEMP}\n.options tnom=${TEMP}`) => `self-authored diode\nV1 in 0 5\nR1 in out 1k\nD1 out 0 SELF\n.model SELF ${model}\n${thermal}\n.op\n.end\n`;

describe('strict SPICE diode DC contract', () => {
  it('retains exact IS/N/RS and the matched fixed thermal pair', (t) => {
    const got = importSpice(deck());
    assert.deepEqual(got.losses, []);
    assert.deepEqual(got.parts.find(p => p.id === 'D1').params,
      { model: 'shockley', is: 2e-12, n: 1.3, rs: 4 });
    const c = Circuit.fromJSON({ parts: got.parts, wires: got.wires });
    c.setPower(true);
    const op = c.operatingPoint();
    assert.equal(op.converged, true);
    assert.equal(op.analysis.diodes.thermalVoltage, 0.02585);
    const out = [...op.nodeVoltages.values()].find(v => v > 0.7 && v < 0.8);
    assert.ok(Math.abs(out - 0.7388682808410284) < 1e-10);
    const diode = op.branchCurrents.get('D1');
    assert.ok(Math.abs(diode.get('anode') + diode.get('cathode')) < 1e-12);
    const oracle = spawnSync('ngspice', ['-b'], { input: deck().replace('\n.op\n', '\n.op\n.print op v(out) @d1[id]\n'), encoding: 'utf8' });
    if (oracle.error?.code === 'ENOENT') return t.skip('ngspice is not installed');
    else assert.ifError(oracle.error);
    assert.equal(oracle.status, 0, oracle.stderr);
    const row = oracle.stdout.match(/\n0\s+([\deE+.-]+)\s+([\deE+.-]+)\s*\n/);
    assert.ok(row, oracle.stdout);
    assert.ok(Math.abs(Number(row[1]) - out) < 3e-7);
    assert.ok(Math.abs(Number(row[2]) - diode.get('anode')) < 3e-8);
  });

  it('keeps unsupported physics as a serialized OP blocker and native-rejected params', () => {
    for (const source of [deck('D(IS=2e-12 N=1.3 RS=4 CJO=2p)'), deck('D(IS=2e-12 N=1.3 RS=4 garbage)'), deck('D(IS=2e-12 N=1.3 RS=4 RS=5)'), deck('D(IS=2e-12 N=1.3 RS=4)', '.temp 27'), deck('D(IS=2e-12 N=1.3 RS=4)', '.temp 25 50'), deck('D(IS=2e-12 N=1.3)')]) {
      const got = importSpice(source);
      assert.equal(got.losses.length, 1);
      assert.ok(got.parts.find(p => p.id === 'D1').params._spiceBlocked);
      const c = Circuit.fromJSON({ parts: got.parts, wires: got.wires,
        analysisBlockers: blockersFromImport(got, 'spice', 'self.cir') });
      const loaded = Circuit.fromJSON(c.toJSON());
      assert.throws(() => loaded.operatingPoint(), /persisted import finding/);
    }
    const tailed = importSpice(deck().replace('D1 out 0 SELF', 'D1 out 0 SELF 2'));
    assert.equal(tailed.losses.length, 1);
    const duplicate = importSpice(deck().replace('.model SELF', '.model SELF D(IS=3e-12 N=1.3 RS=4)\n.model SELF'));
    assert.equal(duplicate.losses.length, 1);
  });

  it('exports exact Shockley with explicit fixed thermal cards and reimports losslessly', () => {
    const got = importSpice(deck());
    const c = Circuit.fromJSON({ parts: got.parts, wires: got.wires });
    const out = toSpice(extractNetlist(c));
    assert.deepEqual(out.skipped, []);
    assert.match(out.text, /\.options temp=26\.826793 tnom=26\.826793/);
    const again = importSpice(out.text);
    assert.deepEqual(again.losses, []);
    assert.deepEqual(again.parts.find(p => p.kind === 'diode').params,
      { model: 'shockley', is: 2e-12, n: 1.3, rs: 4 });
  });

  it('keeps established native LED and Vf-derived diode exports intact', () => {
    const parts = [
      { refdes: 'LED1', kind: 'led', pins: ['anode', 'cathode'], params: { color: 'red', model: 'shockley' } },
      { refdes: 'D1', kind: 'diode', pins: ['anode', 'cathode'], params: { vf: 0.7, model: 'shockley' } },
    ];
    const out = toSpice({ parts, nets: [
      { name: 'N1', nodes: parts.map(p => ({ refdes: p.refdes, pin: 'anode' })) },
      { name: 'GND', nodes: parts.map(p => ({ refdes: p.refdes, pin: 'cathode' })) },
    ] });
    assert.deepEqual(out.skipped, []);
    assert.equal((out.text.match(/^D\S*\s/gm) || []).length, 2);
    assert.equal((out.text.match(/^\.model D_/gm) || []).length, 2);
  });

  it('never reinterprets a blocked imported BV model as a native zener', () => {
    const imported = importSpice(deck('D(IS=2e-12 N=1.3 RS=4 BV=12)'));
    const circuit = Circuit.fromJSON({ parts: imported.parts, wires: imported.wires });
    const out = toSpice(extractNetlist(circuit));
    assert.equal(out.skipped.length, 1);
    assert.match(out.skipped[0], /blocked imported SPICE model/);
    assert.doesNotMatch(out.text, /^D1\s/m);
  });
});

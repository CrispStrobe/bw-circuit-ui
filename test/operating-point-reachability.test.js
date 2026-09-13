/** The engine-owned non-mutating DC operating point is reachable from CUI and bwc. */
import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { Circuit } from '../src/model/circuit.js';

const root = join(import.meta.dirname, '..');
const cli = join(root, 'bin', 'bwc.mjs');

describe('static operating-point reachability', () => {
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

  it('bwc op imports and numerically solves the self-authored RC deck', () => {
    const fixture = join(root, 'test', 'fixtures', 'spice-static-rc-op.cir');
    const r = spawnSync(process.execPath, [cli, 'op', fixture], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    assert.match(r.stdout, /\[spice\]\s+DC operating point/);
    assert.match(r.stdout, /converged: yes/);
    assert.match(r.stdout, /scope\s+: grounded-static-native-r-c-v-i/);
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
});

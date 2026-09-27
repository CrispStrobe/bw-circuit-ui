import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BoardImpl } from 'bw-board';
import {
  SCOPE_PROBE_PRESETS, scopeProbeLabel, scopeProbeOptions,
} from '../src/model/scope-probes.js';

const near = (actual, expected, tolerance = 1e-9) => assert.ok(
  Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`,
);

function divider() {
  const board = new BoardImpl(5);
  board.setNetlist([
    { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'RT', kind: 'resistor', params: { ohms: 10e6 }, terminals: ['a', 'b'] },
    { id: 'RB', kind: 'resistor', params: { ohms: 10e6 }, terminals: ['a', 'b'] },
  ], [
    { id: 'vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'RT', terminal: 'a' }] },
    { id: 'mid', terminals: [{ part: 'RT', terminal: 'b' }, { part: 'RB', terminal: 'a' }] },
    { id: 'gnd', terminals: [{ part: 'RB', terminal: 'b' }, { part: 'GND', terminal: 'gnd' }] },
  ]);
  return board;
}

test('probe presets are named electrical contracts and ideal stays historical', () => {
  assert.deepEqual(scopeProbeOptions('ideal'), {});
  assert.deepEqual(scopeProbeOptions('ideal', 'sense'), { referenceNetId: 'sense' });
  assert.deepEqual(scopeProbeOptions('10x', 'gnd'), {
    referenceNetId: 'gnd', inputOhms: 10e6, inputFarads: 15e-12,
  });
  assert.deepEqual(scopeProbeOptions('1x', 'gnd'), {
    referenceNetId: 'gnd', inputOhms: 1e6, inputFarads: 100e-12,
  });
  assert.throws(() => scopeProbeOptions('10x'), /requires an explicit reference/);
  assert.throws(() => scopeProbeOptions('invented', 'gnd'), /Unknown scope probe preset/);
  assert.match(scopeProbeLabel('10x', 'gnd'), /10 MΩ.*15 pF.*ref gnd/);
});

test('10x and 1x presets load a real high-impedance divider while ideal does not', () => {
  for (const [preset, expected] of [['ideal', 2.5], ['10x', 5 / 3]]) {
    const board = divider();
    board.addScopeChannel({ type: 'voltage', netId: 'mid', sampleRateHz: 10_000, depth: 8,
      ...scopeProbeOptions(preset, preset === 'ideal' ? '' : 'gnd') });
    if (preset !== 'ideal') board.advanceTo(1_000_000n);
    near(board.nodeVoltage('mid'), expected, 1e-5);
  }
  const board = divider();
  board.addScopeChannel({ type: 'voltage', netId: 'mid', sampleRateHz: 10_000, depth: 8,
    ...scopeProbeOptions('1x', 'gnd') });
  board.advanceTo(1_000_000n);
  const bottom = 1 / (1 / 10e6 + 1 / 1e6);
  near(board.nodeVoltage('mid'), 5 * bottom / (10e6 + bottom), 1e-5);
});

test('the spectrum tap shares the reference but cannot double-load the circuit', () => {
  const board = divider();
  board.addScopeChannel({ type: 'voltage', netId: 'mid', ...scopeProbeOptions('10x', 'gnd') });
  const once = board.nodeVoltage('mid');
  const spectrumOptions = scopeProbeOptions('10x', 'gnd', { load: false });
  assert.deepEqual(spectrumOptions, { referenceNetId: 'gnd' });
  board.addScopeChannel({ type: 'voltage', netId: 'mid', capture: 'sample', ...spectrumOptions });
  near(board.nodeVoltage('mid'), once);
});

test('ScopePanel wires one shared reference and exposes the three presets', () => {
  const src = readFileSync(join(import.meta.dirname, '..', 'src/components/ScopePanel.jsx'), 'utf8');
  assert.match(src, /data-testid="bw-scope-probe-preset"/);
  assert.match(src, /data-testid="bw-scope-reference-net"/);
  assert.match(src, /scopeProbeOptions\(probePreset, referenceNetId\)/,
    'time channels do not receive the selected electrical probe');
  assert.match(src, /scopeProbeOptions\(probePreset, referenceNetId, \{ load: false \}\)/,
    'spectrum tap must share the reference without duplicating R||C');
  assert.equal(Object.keys(SCOPE_PROBE_PRESETS).length, 3);
});

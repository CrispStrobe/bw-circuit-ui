import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

import {boardVisualGeometry} from '../src/model/board-geometry.js';

const sidecar = JSON.parse(readFileSync(new URL('../src/parts-data/pybadge.json', import.meta.url), 'utf8'));

test('PyBadge has the physical credit-card envelope and connectable 3.3 V headers', () => {
  const geometry = boardVisualGeometry('pybadge', sidecar);
  assert.ok(Math.abs((geometry.w / geometry.h) - (85.6 / 54)) < 0.01);
  const names = new Set(sidecar.terminals.map(pin => pin.name));
  for (const name of ['3v3', 'gnd', 'd2', 'd3', 'd13', 'sda', 'scl', 'stemma_sda', 'stemma_scl']) {
    assert.ok(names.has(name), `missing ${name}`);
  }
});

test('PyBadge LC is not given the full board\'s absent expansion headers', () => {
  const palette = readFileSync(new URL('../src/components/PartPalette.jsx', import.meta.url), 'utf8');
  assert.match(palette, /kind: 'pybadge'/);
  assert.doesNotMatch(palette, /kind: 'pybadge-lc'/);
});

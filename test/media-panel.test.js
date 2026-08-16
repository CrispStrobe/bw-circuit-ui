/**
 * MediaPanel — structural tests for the ROM/software loader.
 *
 * Validates component existence, expected API shape, and bundle
 * unpacking contract against the bw-board media API.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const componentPath = path.join(here, '../src/components/MediaPanel.jsx');

describe('MediaPanel', () => {
  test('component file exists', () => {
    assert.ok(existsSync(componentPath), 'MediaPanel.jsx should exist');
  });

  test('exports MediaPanel as a named function', () => {
    const src = readFileSync(componentPath, 'utf8');
    assert.ok(/export function MediaPanel/.test(src));
  });

  test('accepts describeMedia and applyMedia props', () => {
    const src = readFileSync(componentPath, 'utf8');
    assert.ok(/describeMedia/.test(src), 'should accept describeMedia');
    assert.ok(/applyMedia/.test(src), 'should accept applyMedia');
  });

  test('accepts target and machineKind props', () => {
    const src = readFileSync(componentPath, 'utf8');
    assert.ok(/target/.test(src), 'should accept target');
    assert.ok(/machineKind/.test(src), 'should accept machineKind');
  });

  test('renders per-slot drop targets from describeMedia shape', () => {
    const src = readFileSync(componentPath, 'utf8');
    // The component maps over slots from describeMedia
    assert.ok(/slot\.id/.test(src), 'should use slot.id');
    assert.ok(/slot\.label/.test(src), 'should display slot.label');
    assert.ok(/slot\.accept/.test(src), 'should show accepted extensions');
    assert.ok(/slot\.hint/.test(src), 'should display hint text');
    assert.ok(/slot\.at/.test(src), 'should show memory address');
  });

  test('handles applyMedia return shape: applied + errors', () => {
    const src = readFileSync(componentPath, 'utf8');
    assert.ok(/result\.applied/.test(src), 'should read result.applied');
    assert.ok(/result\.errors/.test(src), 'should read result.errors');
  });

  test('supports bundle .zip drop with brickwright-media.json manifest', () => {
    const src = readFileSync(componentPath, 'utf8');
    assert.ok(/brickwright-media\.json/.test(src), 'should reference manifest filename');
    assert.ok(/\.zip/.test(src), 'should accept .zip files');
  });

  test('dynamically imports JSZip for bundle unpacking', () => {
    const src = readFileSync(componentPath, 'utf8');
    assert.ok(/import\('jszip'\)/.test(src), 'should dynamically import jszip');
  });

  test('unpackBundle validates manifest structure', () => {
    const src = readFileSync(componentPath, 'utf8');
    assert.ok(/manifest\.slots/.test(src), 'should check for slots object in manifest');
    assert.ok(/Unknown slot/.test(src), 'should reject unknown slot IDs');
  });

  test('returns null for MCU kinds (empty slots)', () => {
    const src = readFileSync(componentPath, 'utf8');
    assert.ok(/slots\.length === 0.*return null/s.test(src) || /!slots.*return null/.test(src),
      'should return null when no slots');
  });

  test('bundle drop only shows when 2+ slots', () => {
    const src = readFileSync(componentPath, 'utf8');
    assert.ok(/slots\.length >= 2/.test(src), 'bundle drop gated on 2+ slots');
  });

  test('per-slot error display from applyMedia', () => {
    const src = readFileSync(componentPath, 'utf8');
    assert.ok(/slotErrors/.test(src), 'should track per-slot errors');
  });

  test('is exported from index.js', () => {
    const idx = readFileSync(path.join(here, '../src/index.js'), 'utf8');
    assert.ok(/MediaPanel/.test(idx), 'index.js should export MediaPanel');
  });

  test('has data-testid for integration testing', () => {
    const src = readFileSync(componentPath, 'utf8');
    assert.ok(/data-testid.*media-panel/.test(src));
  });
});

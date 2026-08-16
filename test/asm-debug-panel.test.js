/**
 * AsmDebugPanel — structural test for the glass-box assembler view.
 *
 * Validates that the component file exists and the expected data shape
 * is documented. The component itself uses JSX and requires a bundler;
 * Playwright tests cover rendering.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const componentPath = path.join(here, '../src/components/AsmDebugPanel.jsx');

describe('AsmDebugPanel', () => {
  test('component file exists', () => {
    assert.ok(existsSync(componentPath), 'AsmDebugPanel.jsx should exist');
  });

  test('exports AsmDebugPanel', () => {
    const src = readFileSync(componentPath, 'utf8');
    assert.ok(/export function AsmDebugPanel/.test(src),
      'should export AsmDebugPanel as a named function');
  });

  test('handles the expected data shape: tokens, passes, listing', () => {
    const src = readFileSync(componentPath, 'utf8');
    // The component destructures {tokens, passes, listing} from asmDebug
    assert.ok(/tokens/.test(src), 'should reference tokens');
    assert.ok(/passes/.test(src), 'should reference passes');
    assert.ok(/listing/.test(src), 'should reference listing');
  });

  test('renders three tabs: tokens, symbols, listing', () => {
    const src = readFileSync(componentPath, 'utf8');
    assert.ok(/tab === 'tokens'/.test(src), 'should have tokens tab');
    assert.ok(/tab === 'symbols'/.test(src), 'should have symbols tab');
    assert.ok(/tab === 'listing'/.test(src), 'should have listing tab');
  });

  test('token colours cover the expected types', () => {
    const src = readFileSync(componentPath, 'utf8');
    for (const type of ['instruction', 'register', 'number', 'label', 'directive', 'comment']) {
      assert.ok(src.includes(type), `TOKEN_COLORS should cover '${type}'`);
    }
  });

  test('symbol table shows pass-1 and pass-2 columns', () => {
    const src = readFileSync(componentPath, 'utf8');
    assert.ok(/Pass 1/.test(src), 'should render Pass 1 column');
    assert.ok(/Pass 2/.test(src), 'should render Pass 2 column');
  });

  test('listing renders addr, bytes, and source', () => {
    const src = readFileSync(componentPath, 'utf8');
    assert.ok(/entry\.addr/.test(src), 'should render address');
    assert.ok(/entry\.bytes/.test(src), 'should render bytes');
    assert.ok(/entry\.source/.test(src), 'should render source');
  });

  test('onHighlightLine callback wired for hover cross-reference', () => {
    const src = readFileSync(componentPath, 'utf8');
    assert.ok(/onHighlightLine/.test(src), 'should support onHighlightLine callback');
  });

  test('is exported from index.js', () => {
    const idx = readFileSync(path.join(here, '../src/index.js'), 'utf8');
    assert.ok(/AsmDebugPanel/.test(idx), 'index.js should export AsmDebugPanel');
  });
});

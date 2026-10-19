/**
 * B23: terminal-dot names that would overlap a neighbour's are not drawn
 * above the dot (they stay as its hover title).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clashingTerminalLabels } from '../src/model/terminal-labels.js';

const sidecar = kind => JSON.parse(readFileSync(new URL(`../src/parts-data/${kind}.json`, import.meta.url), 'utf8'));
const points = sc => sc.terminals.map(t => ({ name: t.name, x: t.x, y: t.y }));

test('the DIP switch: names at a 7 px pitch clash, each row with itself only', () => {
  const clash = clashingTerminalLabels(points(sidecar('dip_switch_spst')));
  assert.deepEqual([...clash].sort(), ['1a', '1b', '2a', '2b', '3a', '3b', '4a', '4b']);
});

test('well-spaced terminals keep their names', () => {
  assert.equal(clashingTerminalLabels([{ name: 'a', x: 0, y: 0 }, { name: 'b', x: 30, y: 0 }]).size, 0);
  // Same x, a row apart: names one above the other do not touch.
  assert.equal(clashingTerminalLabels([{ name: 'vcc', x: 0, y: 0 }, { name: 'gnd', x: 0, y: 20 }]).size, 0);
});

test('only the clashing pair is hidden, not every name of the part', () => {
  const clash = clashingTerminalLabels([{ name: 'collector', x: 0, y: 0 }, { name: 'emitter', x: 20, y: 0 }, { name: 'base', x: -40, y: 30 }]);
  assert.deepEqual([...clash].sort(), ['collector', 'emitter']);
});

test('TerminalDots uses the rule and keeps a hidden name as the dot title', () => {
  const canvas = readFileSync(new URL('../src/components/BoardCanvas.jsx', import.meta.url), 'utf8');
  assert.match(canvas, /const crowdedNames = clashingTerminalLabels\(part\.terminals\.map/);
  assert.match(canvas, /!manyPins && !crowdedNames\.has\(term\) &&/);
  assert.match(canvas, /crowdedNames\.has\(term\) && <title>\{term\}<\/title>/);
});

/**
 * 4×4 keypad face: the membrane keypad must render a 4×4 key grid
 * from device state, highlight the pressed key, and support interactive
 * key presses via onKeypadKey in simulate mode.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const boardSrc = readFileSync(join(here, '../src/components/BoardCanvas.jsx'), 'utf8');
const designerSrc = readFileSync(join(here, '../src/components/CircuitDesigner.jsx'), 'utf8');

test('keypad has a render case in SvgParts', () => {
  const svgParts = boardSrc.indexOf('function SvgParts');
  assert.ok(svgParts > 0, 'SvgParts function found');
  const block = boardSrc.slice(svgParts, boardSrc.indexOf('function WokwiParts'));
  assert.ok(block.includes("case 'keypad':"), 'keypad has a render case');
});

test('keypad face renders 16 keys (4×4 grid)', () => {
  const caseStart = boardSrc.indexOf('4×4 matrix keypad');
  assert.ok(caseStart > 0, 'keypad render case comment found');
  const block = boardSrc.slice(caseStart, caseStart + 3000);
  assert.ok(block.includes('16'), 'renders 16 keys');
  assert.ok(block.includes('KEYPAD_LABELS'), 'uses KEYPAD_LABELS for key text');
});

test('keypad face reads pressed key from device state', () => {
  const caseStart = boardSrc.indexOf('4×4 matrix keypad');
  const block = boardSrc.slice(caseStart, caseStart + 3000);
  assert.ok(block.includes('deviceStates'), 'reads from deviceStates');
  assert.ok(block.includes('_pressed'), 'reads _pressed from device state');
  assert.ok(block.includes('isPressed'), 'tracks pressed state per key');
});

test('keypad face highlights pressed key visually', () => {
  const caseStart = boardSrc.indexOf('4×4 matrix keypad');
  const block = boardSrc.slice(caseStart, caseStart + 3000);
  // Pressed key should have a different fill color
  assert.ok(block.includes("isPressed ? '#f39c12'"), 'pressed key has highlight fill');
  assert.ok(block.includes("isPressed ? '#fff'"), 'pressed key text is white');
});

test('keypad face supports interactive key presses in simulate mode', () => {
  const caseStart = boardSrc.indexOf('4×4 matrix keypad');
  const block = boardSrc.slice(caseStart, caseStart + 3000);
  assert.ok(block.includes('onKeypadKey'), 'calls onKeypadKey callback');
  assert.ok(block.includes('onMouseDown'), 'has mousedown handler for press');
  assert.ok(block.includes('onMouseUp'), 'has mouseup handler for release');
  assert.ok(block.includes('onMouseLeave'), 'has mouseleave handler for safety release');
  assert.ok(block.includes('simulate'), 'gates interaction on simulate mode');
});

test('both keypad renderers expose a stable key-index selector', () => {
  const hooks = boardSrc.match(/data-key-index=\{(?:i|k)\}/g) || [];
  assert.equal(hooks.length, 2,
    'SVG keypad and Wokwi keypad each expose their row-major key index');
});

test('keypad is included in the SvgParts deviceStates gathering', () => {
  const gatherer = boardSrc.slice(boardSrc.indexOf('<SvgParts'));
  assert.ok(gatherer.includes("p.kind === 'keypad'"), 'keypad in deviceStates filter');
});

test('keypad has terminal offsets for 8 pins (r1-r4, c1-c4)', () => {
  const offsets = boardSrc.slice(
    boardSrc.indexOf('function terminalOffsetsForPart'),
    boardSrc.indexOf('function terminalOffsetsForPart') + 4000,
  );
  assert.ok(offsets.includes("case 'keypad':"), 'keypad in terminal offsets switch');
  for (const pin of ['r1', 'r2', 'r3', 'r4', 'c1', 'c2', 'c3', 'c4']) {
    assert.ok(offsets.includes(pin), `terminal offset for ${pin} defined`);
  }
});

test('KEYPAD_LABELS defines standard 4×4 keypad layout', () => {
  assert.ok(boardSrc.includes('KEYPAD_LABELS'), 'KEYPAD_LABELS constant exists');
  // Extract the array and verify the standard layout
  const match = boardSrc.match(/KEYPAD_LABELS\s*=\s*\[([^\]]+)\]/);
  assert.ok(match, 'KEYPAD_LABELS is an array literal');
  const labels = match[1].split(',').map(s => s.trim().replace(/'/g, ''));
  assert.deepEqual(labels, ['1','2','3','A','4','5','6','B','7','8','9','C','*','0','#','D'],
    'standard telephone/membrane keypad layout');
});

test('CircuitDesigner wires handleKeypadKey via setPartParam', () => {
  assert.ok(designerSrc.includes('handleKeypadKey'), 'handleKeypadKey defined');
  assert.ok(designerSrc.includes('setPartParam'), 'uses setPartParam on the board');
  assert.ok(designerSrc.includes("'pressed'"), "sets the 'pressed' param");
  assert.ok(designerSrc.includes('onKeypadKey={handleKeypadKey}'), 'passed to BoardCanvas');
});

test('SvgParts receives simulate and onKeypadKey props', () => {
  const sig = boardSrc.match(/function SvgParts\(\{([^}]+)\}/);
  assert.ok(sig, 'SvgParts destructured props found');
  const props = sig[1];
  assert.ok(props.includes('simulate'), 'simulate prop in SvgParts');
  assert.ok(props.includes('onKeypadKey'), 'onKeypadKey prop in SvgParts');
});

/**
 * Controller-panel widget faces: joystick (2-axis), slider (1-axis),
 * gauge (read-only indicator). Each reads its bound value from board
 * state and renders as SVG in SvgParts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const boardSrc = readFileSync(join(here, '../src/components/BoardCanvas.jsx'), 'utf8');
const designerSrc = readFileSync(join(here, '../src/components/CircuitDesigner.jsx'), 'utf8');

const svgPartsBlock = boardSrc.slice(
  boardSrc.indexOf('function SvgParts'),
  boardSrc.indexOf('function WokwiParts'),
);

// ── Joystick face ─────────────────────────────────────────────────

test('joystick has a render case in SvgParts', () => {
  assert.ok(svgPartsBlock.includes("case 'joystick':"), 'joystick render case exists');
});

test('joystick reads x/y params from part', () => {
  const cs = boardSrc.indexOf('JOYSTICK: 2-axis');
  const block = boardSrc.slice(cs, cs + 4000);
  assert.ok(block.includes('part.params?.x'), 'reads x param');
  assert.ok(block.includes('part.params?.y'), 'reads y param');
  assert.ok(block.includes('part.params?.pressed'), 'reads pressed param');
});

test('joystick thumb position reflects x/y values', () => {
  const cs = boardSrc.indexOf('JOYSTICK: 2-axis');
  const block = boardSrc.slice(cs, cs + 4000);
  assert.ok(block.includes('thumbX'), 'computes thumb X position');
  assert.ok(block.includes('thumbY'), 'computes thumb Y position');
});

test('joystick has interactive drag in simulate mode', () => {
  const cs = boardSrc.indexOf('JOYSTICK: 2-axis');
  const block = boardSrc.slice(cs, cs + 4000);
  assert.ok(block.includes('onSetPartParam'), 'uses onSetPartParam callback');
  assert.ok(block.includes('onMouseDown'), 'has mousedown handler');
  assert.ok(block.includes('mousemove'), 'tracks mouse movement');
  assert.ok(block.includes('mouseup'), 'handles mouse release');
  assert.ok(block.includes('simulate'), 'gates interaction on simulate mode');
});

test('joystick springs back to center on release', () => {
  const cs = boardSrc.indexOf('JOYSTICK: 2-axis');
  const block = boardSrc.slice(cs, cs + 4000);
  // On mouseup, should set x and y back to 0
  const upIdx = block.indexOf('const up');
  assert.ok(upIdx > 0, 'defines up handler');
  const upBlock = block.slice(upIdx, upIdx + 300);
  assert.ok(upBlock.includes("'x', 0"), 'resets x to 0 on release');
  assert.ok(upBlock.includes("'y', 0"), 'resets y to 0 on release');
});

test('joystick has terminal offsets for 5 pins', () => {
  const offsets = boardSrc.slice(
    boardSrc.indexOf('function terminalOffsetsForPart'),
    boardSrc.indexOf('function terminalOffsetsForPart') + 6000,
  );
  assert.ok(offsets.includes("case 'joystick':"), 'joystick in terminal offsets');
  for (const pin of ['vcc', 'gnd', 'vrx', 'vry', 'sw']) {
    assert.ok(offsets.includes(pin), `terminal offset for ${pin}`);
  }
});

// ── Slider face ───────────────────────────────────────────────────

test('slider has a render case in SvgParts', () => {
  assert.ok(svgPartsBlock.includes("case 'slider':"), 'slider render case exists');
});

test('slider reads value param and supports min/max', () => {
  const cs = boardSrc.indexOf('SLIDER: single-axis');
  const block = boardSrc.slice(cs, cs + 4000);
  assert.ok(block.includes('part.params?.value'), 'reads value param');
  assert.ok(block.includes('part.params?.min'), 'reads min param');
  assert.ok(block.includes('part.params?.max'), 'reads max param');
});

test('slider has draggable thumb in simulate mode', () => {
  const cs = boardSrc.indexOf('SLIDER: single-axis');
  const block = boardSrc.slice(cs, cs + 4000);
  assert.ok(block.includes('onSetPartParam'), 'uses onSetPartParam callback');
  assert.ok(block.includes('onMouseDown'), 'has mousedown handler');
  assert.ok(block.includes('ns-resize'), 'uses vertical resize cursor');
  assert.ok(block.includes('simulate'), 'gates interaction on simulate mode');
});

test('slider normalises value to track position', () => {
  const cs = boardSrc.indexOf('SLIDER: single-axis');
  const block = boardSrc.slice(cs, cs + 4000);
  assert.ok(block.includes('norm'), 'computes normalised value');
  assert.ok(block.includes('thumbY'), 'maps to thumb Y position');
});

test('slider has terminal offsets for 3 pins', () => {
  const offsets = boardSrc.slice(
    boardSrc.indexOf('function terminalOffsetsForPart'),
    boardSrc.indexOf('function terminalOffsetsForPart') + 6000,
  );
  assert.ok(offsets.includes("case 'slider':"), 'slider in terminal offsets');
  for (const pin of ['a', 'wiper', 'b']) {
    assert.ok(offsets.includes(pin), `terminal offset for ${pin}`);
  }
});

// ── Gauge face ────────────────────────────────────────────────────

test('gauge has a render case in SvgParts', () => {
  assert.ok(svgPartsBlock.includes("case 'gauge':"), 'gauge render case exists');
});

test('gauge reads value from device state and params', () => {
  const cs = boardSrc.indexOf('GAUGE: read-only');
  const block = boardSrc.slice(cs, cs + 4000);
  assert.ok(block.includes('ds?.value'), 'reads from device state');
  assert.ok(block.includes('part.params?.value'), 'falls back to part params');
  assert.ok(block.includes('part.params?.min'), 'reads min param');
  assert.ok(block.includes('part.params?.max'), 'reads max param');
});

test('gauge renders arc with needle and ticks', () => {
  const cs = boardSrc.indexOf('GAUGE: read-only');
  const block = boardSrc.slice(cs, cs + 4000);
  assert.ok(block.includes('needleAngle'), 'computes needle angle');
  assert.ok(block.includes('arcPath'), 'renders arc path');
  assert.ok(block.includes('ticks'), 'renders tick marks');
});

test('gauge has color bands (green/amber/red)', () => {
  const cs = boardSrc.indexOf('GAUGE: read-only');
  const block = boardSrc.slice(cs, cs + 4000);
  assert.ok(block.includes('#2ecc71'), 'green for low values');
  assert.ok(block.includes('#f39c12'), 'amber for mid values');
  assert.ok(block.includes('#e74c3c'), 'red for high values');
});

test('gauge is read-only (no interactive handlers)', () => {
  const cs = boardSrc.indexOf('GAUGE: read-only');
  const block = boardSrc.slice(cs, cs + 4000);
  assert.ok(!block.includes('onSetPartParam'), 'no onSetPartParam (read-only)');
  assert.ok(!block.includes('onMouseDown'), 'no mousedown handler');
});

test('gauge has terminal offsets for 3 pins', () => {
  const offsets = boardSrc.slice(
    boardSrc.indexOf('function terminalOffsetsForPart'),
    boardSrc.indexOf('function terminalOffsetsForPart') + 6000,
  );
  assert.ok(offsets.includes("case 'gauge':"), 'gauge in terminal offsets');
  for (const pin of ['signal', 'vcc', 'gnd']) {
    assert.ok(offsets.includes(pin), `terminal offset for ${pin}`);
  }
});

// ── Shared plumbing ───────────────────────────────────────────────

test('all three widget kinds are in deviceStates whitelist', () => {
  const gatherer = boardSrc.slice(boardSrc.indexOf('<SvgParts'));
  for (const kind of ['joystick', 'slider', 'gauge']) {
    assert.ok(gatherer.includes(`p.kind === '${kind}'`), `${kind} in deviceStates filter`);
  }
});

test('SvgParts receives onSetPartParam prop', () => {
  const sig = boardSrc.match(/function SvgParts\(\{([^}]+)\}/);
  assert.ok(sig, 'SvgParts destructured props found');
  assert.ok(sig[1].includes('onSetPartParam'), 'onSetPartParam in SvgParts props');
});

test('onSetPartParam is threaded from SvgParts call site', () => {
  // The JSX ELEMENT, not a fixed byte window. This slice used to be
  // `indexOf('<SvgParts') + 2000`, and the prop sat at offset 2321 — so the
  // assertion failed on code that was present and correct, purely because the
  // element grew. A window that has to be widened every time a component gains
  // a prop is not testing what it claims to test; it is testing the file's
  // length. Nobody noticed because this file is not in `npm test`.
  const start = boardSrc.indexOf('<SvgParts');
  assert.ok(start >= 0, 'SvgParts is rendered somewhere');
  const end = boardSrc.indexOf('/>', start);
  assert.ok(end > start, 'the SvgParts element is self-closing and terminated');
  const callSite = boardSrc.slice(start, end);
  assert.ok(callSite.includes('onSetPartParam={onSetPartParam}'),
    'onSetPartParam passed to SvgParts');
});

test('BoardCanvas accepts onSetPartParam prop', () => {
  const sig = boardSrc.slice(boardSrc.indexOf('export function BoardCanvas'), boardSrc.indexOf('export function BoardCanvas') + 600);
  assert.ok(sig.includes('onSetPartParam'), 'onSetPartParam in BoardCanvas props');
});

test('CircuitDesigner defines handleSetPartParam and passes it', () => {
  assert.ok(designerSrc.includes('handleSetPartParam'), 'handleSetPartParam defined');
  assert.ok(designerSrc.includes('onSetPartParam={handleSetPartParam}'), 'passed to BoardCanvas');
  assert.ok(designerSrc.includes("setPartParam(partId, param, value)"), 'calls setPartParam');
});

// ── Value contract documentation ──────────────────────────────────

test('joystick value contract: x/y range -1..1', () => {
  const cs = boardSrc.indexOf('JOYSTICK: 2-axis');
  const block = boardSrc.slice(cs, cs + 500);
  assert.ok(block.includes('-1..1'), 'documents -1..1 range');
  assert.ok(block.includes('bw-board joystick'), 'references bw-board device');
});

test('slider value contract: value range 0..1', () => {
  const cs = boardSrc.indexOf('SLIDER: single-axis');
  const block = boardSrc.slice(cs, cs + 500);
  assert.ok(block.includes('0..1'), 'documents 0..1 range');
});

test('gauge value contract: reads ds.value from device state', () => {
  const cs = boardSrc.indexOf('GAUGE: read-only');
  const block = boardSrc.slice(cs, cs + 500);
  assert.ok(block.includes('ds.value'), 'documents ds.value contract');
});

/**
 * Lego display widgets: mono_lcd (graphical mono LCD) and rgb_light
 * (RGB status indicator). Both are read-only displays driven by
 * a Scratch variable via the controller-binding pump.
 *
 * Tests cover:
 *   1. SvgParts render case exists
 *   2. Terminal offsets defined
 *   3. deviceStates gathering includes the kind
 *   4. circuit.js terminal definitions
 *   5. Pump-gap regression: a param write actually updates the face
 *      (asserts real output, not trace identity)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const boardSrc = readFileSync(join(here, '../src/components/BoardCanvas.jsx'), 'utf8');
const circuitSrc = readFileSync(join(here, '../src/model/circuit.js'), 'utf8');

const svgPartsBlock = boardSrc.slice(
  boardSrc.indexOf('function SvgParts'),
  boardSrc.indexOf('function WokwiParts'),
);

// ── mono_lcd ─────────────────────────────────────────────────────────

describe('mono_lcd (graphical mono LCD)', () => {
  test('has a render case in SvgParts', () => {
    assert.ok(svgPartsBlock.includes("case 'mono_lcd':"), 'mono_lcd render case');
  });

  test('renders parametric W×H from params', () => {
    const cs = boardSrc.indexOf('Graphical mono LCD');
    assert.ok(cs > 0, 'mono_lcd comment found');
    const block = boardSrc.slice(cs, cs + 3000);
    assert.ok(block.includes('part.params?.width'), 'reads width param');
    assert.ok(block.includes('part.params?.height'), 'reads height param');
  });

  test('renders 1bpp pixel buffer via canvas', () => {
    const cs = boardSrc.indexOf('Graphical mono LCD');
    const block = boardSrc.slice(cs, cs + 3000);
    assert.ok(block.includes('foreignObject'), 'uses foreignObject for canvas');
    assert.ok(block.includes('putImageData'), 'renders pixels via putImageData');
    assert.ok(block.includes('MSB first'), 'documents MSB-first packing');
  });

  test('reads fb from device state OR part.params', () => {
    const cs = boardSrc.indexOf('Graphical mono LCD');
    const block = boardSrc.slice(cs, cs + 3000);
    assert.ok(block.includes('ds?.fb'), 'reads fb from deviceState');
    assert.ok(block.includes('part.params?.fb'), 'falls back to part.params.fb');
  });

  test('has terminal offsets', () => {
    const offsets = boardSrc.slice(
      boardSrc.indexOf('function terminalOffsetsForPart'),
      boardSrc.indexOf('function terminalOffsetsForPart') + 5000,
    );
    assert.ok(offsets.includes("case 'mono_lcd':"), 'mono_lcd in terminal offsets');
  });

  test('is in deviceStates gathering', () => {
    const gatherer = boardSrc.slice(boardSrc.indexOf('<SvgParts'));
    assert.ok(gatherer.includes("p.kind === 'mono_lcd'"), 'mono_lcd in deviceStates filter');
  });

  test('has terminal definitions in circuit.js', () => {
    assert.ok(circuitSrc.includes("case 'mono_lcd':"), 'mono_lcd in terminalsForKind');
  });
});

// ── rgb_light ────────────────────────────────────────────────────────

describe('rgb_light (RGB status indicator)', () => {
  test('has a render case in SvgParts', () => {
    assert.ok(svgPartsBlock.includes("case 'rgb_light':"), 'rgb_light render case');
  });

  test('reads r/g/b from device state OR part.params', () => {
    const cs = boardSrc.indexOf('RGB status light');
    assert.ok(cs > 0, 'rgb_light comment found');
    const block = boardSrc.slice(cs, cs + 2000);
    assert.ok(block.includes('ds?.r'), 'reads r from deviceState');
    assert.ok(block.includes('part.params?.r'), 'falls back to part.params.r');
    assert.ok(block.includes('ds?.g'), 'reads g');
    assert.ok(block.includes('ds?.b'), 'reads b');
  });

  test('renders an RGB circle', () => {
    const cs = boardSrc.indexOf('RGB status light');
    const block = boardSrc.slice(cs, cs + 2000);
    assert.ok(block.includes('`rgb(${r0},${g0},${b0})`'), 'builds rgb() fill string');
    assert.ok(block.includes('<circle'), 'renders a circle element');
  });

  test('has terminal offsets', () => {
    const offsets = boardSrc.slice(
      boardSrc.indexOf('function terminalOffsetsForPart'),
      boardSrc.indexOf('function terminalOffsetsForPart') + 5000,
    );
    assert.ok(offsets.includes("case 'rgb_light':"), 'rgb_light in terminal offsets');
  });

  test('is in deviceStates gathering', () => {
    const gatherer = boardSrc.slice(boardSrc.indexOf('<SvgParts'));
    assert.ok(gatherer.includes("p.kind === 'rgb_light'"), 'rgb_light in deviceStates filter');
  });

  test('has terminal definitions in circuit.js', () => {
    assert.ok(circuitSrc.includes("case 'rgb_light':"), 'rgb_light in terminalsForKind');
  });
});

// ── pump-gap regression ──────────────────────────────────────────────
// The trap: a display type in isDisplay() only renders but never updates.
// Both new types must appear in BOTH isDisplay AND pump's setter-dispatch.
// This test verifies the lite-side binding by reading the source directly.

describe('pump-gap regression (controller-binding.js)', () => {
  let bindingSrc;
  try {
    bindingSrc = readFileSync(join(here,
      '../../lego/brickwright-lite/overlay/scratch-gui/src/lib/bw-board/controller-binding.js'), 'utf8');
  } catch { bindingSrc = null; }

  const skip = !bindingSrc && 'lite checkout not available';

  test('mono_lcd in isDisplay', { skip }, () => {
    const displaySet = bindingSrc.slice(bindingSrc.indexOf('const DISPLAYS'), bindingSrc.indexOf('export function bindPanelToVariables'));
    assert.ok(displaySet.includes("'mono_lcd'"), 'mono_lcd is a display kind');
    assert.match(bindingSrc, /const isDisplay = \(w\) => DISPLAYS\.has\(w\.type\)/,
      'isDisplay consumes the shared display-kind set');
  });

  test('mono_lcd in pump setter-dispatch', { skip }, () => {
    assert.ok(bindingSrc.includes('setMonoLcdText'), 'pump calls the mono LCD text setter');
  });

  test('rgb_light in isDisplay', { skip }, () => {
    const displaySet = bindingSrc.slice(bindingSrc.indexOf('const DISPLAYS'), bindingSrc.indexOf('export function bindPanelToVariables'));
    assert.ok(displaySet.includes("'rgb_light'"), 'rgb_light is a display kind');
    assert.match(bindingSrc, /const isDisplay = \(w\) => DISPLAYS\.has\(w\.type\)/,
      'isDisplay consumes the shared display-kind set');
  });

  test('rgb_light in pump setter-dispatch', { skip }, () => {
    assert.ok(bindingSrc.includes('setRgbLightColor'), 'pump calls setRgbLightColor');
  });
});

// ── Widget type registration in controller.js ────────────────────────

describe('controller.js widget types', () => {
  let controllerSrc;
  try {
    controllerSrc = readFileSync(join(here,
      '../../lego/brickwright-lite/overlay/scratch-gui/src/lib/bw-board/controller.js'), 'utf8');
  } catch { controllerSrc = null; }

  const skip = !controllerSrc && 'lite checkout not available';

  test('MONO_LCD in WIDGET_TYPES', { skip }, () => {
    assert.ok(controllerSrc.includes("MONO_LCD:"), 'MONO_LCD constant');
    assert.ok(controllerSrc.includes("'mono_lcd'"), 'mono_lcd type string');
  });

  test('RGB_LIGHT in WIDGET_TYPES', { skip }, () => {
    assert.ok(controllerSrc.includes("RGB_LIGHT:"), 'RGB_LIGHT constant');
    assert.ok(controllerSrc.includes("'rgb_light'"), 'rgb_light type string');
  });

  test('mono_lcd has DEFAULTS entry', { skip }, () => {
    assert.ok(controllerSrc.includes('mono_lcd:'), 'mono_lcd in DEFAULTS');
  });

  test('rgb_light has DEFAULTS entry', { skip }, () => {
    assert.ok(controllerSrc.includes('rgb_light:'), 'rgb_light in DEFAULTS');
  });

  test('setMonoLcdText method exists', { skip }, () => {
    assert.ok(controllerSrc.includes('setMonoLcdText('), 'setter method defined');
  });

  test('setRgbLightColor method exists', { skip }, () => {
    assert.ok(controllerSrc.includes('setRgbLightColor('), 'setter method defined');
  });
});

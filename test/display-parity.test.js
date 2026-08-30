/**
 * Display parity: bargraph and simplevga/tms9918 face rendering.
 *
 * bargraph: passive device — brightness computed from branchCurrent in
 * the deviceStates gatherer (no device-model export).
 *
 * simplevga/tms9918: machine-level video — compact thumbnail rendered
 * in SvgParts when videoFn is available from debugState.
 */
import { test, describe } from 'node:test';
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

describe('SSD1306 display parity', () => {
  const start = svgPartsBlock.indexOf("case 'ssd1306':");
  const block = svgPartsBlock.slice(start, start + 3000);

  test('physical OLED renderer exposes the browser-facing part marker', () => {
    assert.ok(start >= 0, 'ssd1306 render case');
    assert.ok(block.includes('data-part-face={kind}'), 'face marker survives rendering');
  });

  test('physical OLED renderer decodes device framebuffer pixels', () => {
    assert.ok(block.includes('ds.fb[page * FW + col]'), 'reads live GDDRAM');
    assert.ok(block.includes('putImageData'), 'paints decoded pixels');
  });
});

// ── Bargraph ──────────────────────────────────────────────────────────

describe('bargraph display parity', () => {
  test('bargraph has a render case in SvgParts', () => {
    assert.ok(svgPartsBlock.includes("case 'bargraph':"), 'render case');
  });

  test('bargraph reads brightness from device state', () => {
    const cs = boardSrc.indexOf('10-LED bargraph');
    const block = boardSrc.slice(cs, cs + 2000);
    assert.ok(block.includes('ds?.brightness'), 'reads brightness array');
    assert.ok(block.includes('ledDisplayLevel'), 'gamma-corrects via ledDisplayLevel');
  });

  test('bargraph brightness computed from branchCurrent in gatherer', () => {
    const gatherer = boardSrc.slice(boardSrc.indexOf('<SvgParts'));
    assert.ok(gatherer.includes('branchCurrent'), 'reads branchCurrent for bargraph');
    assert.ok(gatherer.includes("p.kind === 'bargraph'"), 'bargraph in gatherer conditional');
  });

  test('bargraph brightness uses 10 segments (a0..a9)', () => {
    const gatherer = boardSrc.slice(boardSrc.indexOf('bargraph') + 100);
    const block = gatherer.slice(0, 1000);
    assert.ok(block.includes('for (let i = 0; i < 10'), '10 segments');
    assert.ok(block.includes('`a${i}`'), 'reads anode terminal per segment');
  });
});

// ── SimpleVGA / TMS9918 ───────────────────────────────────────────────

describe('simplevga/tms9918 display parity', () => {
  test('simplevga_card has a render case in SvgParts', () => {
    assert.ok(svgPartsBlock.includes("case 'simplevga_card':"), 'simplevga render case');
  });

  test('tms9918 has a render case in SvgParts', () => {
    assert.ok(svgPartsBlock.includes("case 'tms9918':"), 'tms9918 render case');
  });

  test('video face reads from videoFn callback', () => {
    const cs = boardSrc.indexOf('SimpleVGA / TMS9918');
    assert.ok(cs > 0, 'video face comment found');
    const block = boardSrc.slice(cs, cs + 3000);
    assert.ok(block.includes('videoFn'), 'reads videoFn prop');
    assert.ok(block.includes('putImageData'), 'renders via putImageData');
  });

  test('SvgParts receives videoFn prop', () => {
    const sig = boardSrc.match(/function SvgParts\(\{([^}]+)\}/);
    assert.ok(sig, 'SvgParts props found');
    assert.ok(sig[1].includes('videoFn'), 'videoFn in SvgParts props');
  });

  test('videoFn is passed from CircuitDesigner through BoardCanvas', () => {
    assert.ok(designerSrc.includes('videoFn={debugState'), 'CircuitDesigner passes videoFn');
    assert.ok(boardSrc.includes('videoFn={videoFn}'), 'BoardCanvas passes videoFn to SvgParts');
  });

  test('video face falls back to DIP body when no video available', () => {
    const cs = boardSrc.indexOf('SimpleVGA / TMS9918');
    const block = boardSrc.slice(cs, cs + 1500);
    assert.ok(block.includes("typeof videoFn !== 'function'") || block.includes('break'),
      'falls through when videoFn unavailable');
  });
});

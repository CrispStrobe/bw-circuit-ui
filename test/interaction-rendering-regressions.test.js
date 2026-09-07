import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Circuit, resetIds } from '../src/model/circuit.js';
import { createHitTest, partBounds } from '../src/interaction/hittest.js';
import { runDrc } from '../src/model/drc.js';

const canvasSource = readFileSync(new URL('../src/components/BoardCanvas.jsx', import.meta.url), 'utf8');
const breadboardSource = readFileSync(new URL('../src/components/BreadboardView.jsx', import.meta.url), 'utf8');
const designerSource = readFileSync(new URL('../src/components/CircuitDesigner.jsx', import.meta.url), 'utf8');
const boardHookSource = readFileSync(new URL('../src/hooks/useBoard.js', import.meta.url), 'utf8');
const paletteSource = readFileSync(new URL('../src/components/PartPalette.jsx', import.meta.url), 'utf8');
const seatGeneratorSource = readFileSync(new URL('../scripts/seat-examples.mjs', import.meta.url), 'utf8');

test('placement bounds preserve full, half, and mini breadboard dimensions', () => {
  const bounds = size => partBounds({ kind: 'breadboard', x: 0, y: 0, params: { size } });
  const full = bounds('full'), half = bounds('half'), mini = bounds('mini');
  assert.equal(full.maxX - full.minX, 930);
  assert.equal(half.maxX - half.minX, 460);
  assert.equal(mini.maxX - mini.minX, 278);
  assert.ok((mini.maxY - mini.minY) < (half.maxY - half.minY));
  assert.match(canvasSource, /const bounds = partBounds\(placeGhost\)/,
    'the placement ghost consumes the same bounds as the dropped part');
  assert.match(canvasSource, /SEATED_PREVIEW_SCALE\[placeGhost\.kind\] \?\? 1/,
    'breadboard-mountable Nano/Pico previews retain physical header pitch');
});

test('DIP hit bounds follow physical pins and win over the breadboard below', () => {
  const chip = { id: 'tiny', kind: 'attiny13', x: 100, y: 100 };
  const board = { id: 'board', kind: 'breadboard', x: 100, y: 100, params: {} };
  const hit = createHitTest(() => [chip, board], () => [], () => []);
  assert.equal(hit.partAt(130, 100), 'tiny', 'right edge of DIP-8 body remains selectable');
  assert.equal(hit.partAt(300, 100), 'board', 'substrate still owns uncovered space');
});

test('wire hit paths use the same curves as their renderers', () => {
  assert.ok(canvasSource.match(/freeWireCurve\(w, a, b\)\.points/));
  assert.ok(canvasSource.match(/freeWireCurve\(wire, a, b\)\.path/));
  assert.ok(canvasSource.includes('jumperHitPoints(bb, a, b, jwIdx)'));
  assert.ok(canvasSource.includes('tapWireHitPoints(a, b)'));
});

test('full breadboard renders every logical hole without visual-only gaps', () => {
  assert.doesNotMatch(breadboardSource, /c % 6/);
  assert.match(breadboardSource, /for \(let c = 0; c < origin\.cols; c\+\+\)/);
});

test('Arduino face uses absolute world coordinates, not a foreignObject parent transform', () => {
  assert.match(canvasSource, /<foreignObject x=\{x - W \/ 2\} y=\{y - H \/ 2\}/);
  assert.match(canvasSource, /data-board-face-license="MIT"/);
});

test('palette placement controls are keyboard-accessible buttons', () => {
  assert.match(paletteSource, /role="button"/);
  assert.match(paletteSource, /aria-label=\{label\}/);
  assert.match(paletteSource, /data-palette-kind=\{kind\}/);
  assert.match(paletteSource, /event\.key !== 'Enter' && event\.key !== ' '/);
});

test('74C922 is placeable and its generic DIP face is browser-addressable', () => {
  assert.match(paletteSource,
    /kind: '74c922', label: '74C922 Keypad Encoder'/,
    'the existing engine-backed sidecar is available from the Logic palette');
  assert.match(canvasSource,
    /data-part-face=\{kind\} data-dip-body=\{kind\}/,
    'generic sidecar-backed DIP faces expose the same stable marker as dedicated faces');
});

test('owner default keeps instruments collapsed unless debugger or bench needs them', () => {
  assert.match(designerSource, /useState\(!!debuggerOn \|\| !!benchOpen\)/);
  assert.match(designerSource, /if \(debuggerOn \|\| benchOpen\) setRightOpen\(true\)/);
  assert.match(designerSource, /if \(hasRetroCpu\) setRightOpen\(true\)/);
});

test('performance attribution stays optional and labels canvas update sources', () => {
  assert.match(designerSource, /performanceProbe = null/);
  assert.match(designerSource,
    /profilePerformanceSubtree\(performanceProbe, React, 'BoardCanvas'/);
  assert.match(designerSource, /performanceProbe\.mark\('designer:declaration'\)/);
  assert.match(designerSource, /performanceProbe\.mark\('designer:board-ready'\)/);
  assert.match(canvasSource, /performanceProbe\.mark\(`fit:\$\{reason\}`/);
  for (const source of ["'auto'", "'settled-retry'", "'keyboard'", "'button'",
    'resize:fit', 'resize:viewport-initial', 'resize:viewport-observer']) {
    assert.ok(canvasSource.includes(source), `BoardCanvas lost ${source}`);
  }
  assert.match(canvasSource, /if \(!cameraChanged\) return;/,
    'idempotent fits must not emit a false update-source mark');
  assert.match(boardHookSource, /performanceProbe\.mark\(`board-state:\$\{source\}`\)/);
  assert.match(boardHookSource, /doRefresh\('initial'\)/);
  assert.match(boardHookSource, /doRefresh\('change'\)/);
});

test('battery positive directly wired to negative is a supply-short warning', () => {
  resetIds();
  const circuit = new Circuit(5);
  const battery = circuit.addPart('vsource', { variant: '9v', volts: 9 }, 0, 0);
  circuit.addWire(battery.id, 'pos', battery.id, 'neg');
  assert.ok(runDrc(circuit, circuit.board).some(w => w.rule === 'supply-short'));
});

test('generated Nano and Pico benches use one canonical supply and ground feed', () => {
  assert.match(seatGeneratorSource, /arduino_nano: \{ vcc: '5v', gnd: 'gnd' \}/);
  assert.match(seatGeneratorSource, /pi_pico: \{ vcc: 'vbus', gnd: 'gnd_1' \}/);
  assert.match(seatGeneratorSource, /if \(devPower && t !== \(isTop \? devPower\.vcc : devPower\.gnd\)\) continue/);
  assert.match(seatGeneratorSource, /if \(ep\.part !== dev\.id \|\| !physical\.has\(ep\.terminal\)/,
    'floating development boards advertise every wired signal endpoint');
  assert.match(seatGeneratorSource, /Math\.max\(leadWidthOf\(fp\), Math\.ceil\(footprintOf\(part\)\.w \/ 14\)\)/,
    'generated benches reserve the rendered body width, not only lead span');
  assert.match(seatGeneratorSource, /invalidControllersOnly && !c\.parts\.some/,
    'the migration can target physically unseatable Uno/Mega authored benches safely');
  assert.match(seatGeneratorSource, /Controller-only lessons do not need a decorative empty breadboard/);
});

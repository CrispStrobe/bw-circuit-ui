// SPDX-License-Identifier: MIT
// Original connector and UI contract tests. No vendor firmware is needed.
import './_setup.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {CP1_TERMINALS} from 'bw-board/devices/cp1.js';
import {extractCp1Machine} from 'bw-board/cp1-extract.js';
import {createCp1ConnectorAssets} from '../scripts/generate-cp1-connector.mjs';
import {ART_FACE_KINDS, artPinOffsets, artFaceLayout} from '../src/model/part-art.js';
import {getSidecar} from '../src/model/parts-registry.js';
import {Circuit} from '../src/model/circuit.js';
import {findSnapTarget} from '../src/model/snap.js';
import {extractMachine, machineBootDetail} from '../src/model/machine-extract.js';
import {classifyRunPins, armBoardForRun, demoPinScriptApplies, greenFlagArmsOwnBoard} from '../src/model/simulation.js';
import {createHitTest, footprintOf, partBounds} from '../src/interaction/hittest.js';
import {computeFitView} from '../src/interaction/transform.js';

const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');
const extractors = {extractCp1Machine};
const cp1Part = (expansion = false) => ({id: 'computer', kind: 'kosmos-cp1', params: {expansion, clockHz: 6000000}});

test('the authored CP1 art and its 40 wire anchors share exact coordinates', () => {
  const {sidecar, svg} = createCp1ConnectorAssets();
  assert.deepEqual(JSON.parse(read('../src/parts-data/kosmos-cp1.json')), sidecar);
  assert.equal(read('../src/parts-data/kosmos-cp1.svg'), svg);
  assert.match(svg, new RegExp(`viewBox="0 0 ${sidecar.w} ${sidecar.h}"`));
  assert.deepEqual(sidecar.terminals.map(t => t.name), CP1_TERMINALS);
  assert.equal(new Set(sidecar.terminals.map(t => `${t.x},${t.y}`)).size, 40);
  assert.equal(sidecar.footprint, null, 'the whole system is not a breadboard DIP');
  assert.ok(ART_FACE_KINDS.includes(sidecar.kind));
  assert.deepEqual(getSidecar(sidecar.kind), sidecar, 'the browser index must register this same sidecar');
  const offsets = artPinOffsets(sidecar);
  const layout = artFaceLayout(sidecar);
  assert.deepEqual([layout.x, layout.y, layout.w, layout.h], [-150, -200, 300, 400]);
  for (const t of sidecar.terminals) {
    const escaped = t.name.replace('.', '\\.');
    assert.match(svg, new RegExp(`data-terminal="${escaped}"[^]*?<circle cx="${t.x}" cy="${t.y}"`));
    assert.ok(t.x >= 3 && t.x <= sidecar.w - 3 && t.y >= 3 && t.y <= sidecar.h - 3, t.name);
    assert.deepEqual(offsets[t.name], {dx: t.x - 150, dy: t.y - 200});
  }
});

const cp1ArtCorners = (part, inset = 1) => {
  const art = artFaceLayout(getSidecar(part.kind));
  const radians = (part.rotation || 0) * Math.PI / 180;
  return [art.x, art.x + art.w].flatMap(x => [art.y, art.y + art.h].map(y => {
    const dx = x * inset * (part.flipped ? -1 : 1), dy = y * inset;
    return {x: part.x + dx * Math.cos(radians) - dy * Math.sin(radians),
      y: part.y + dx * Math.sin(radians) + dy * Math.cos(radians)};
  }));
};

test('CP1 hit bounds cover its whole authored face after rotation and mirroring', () => {
  const sidecar = getSidecar('kosmos-cp1');
  assert.deepEqual(footprintOf(cp1Part()), {w: sidecar.w, h: sidecar.h});
  for (const rotation of [0, 45, 90, 180, 270, 315]) for (const flipped of [false, true]) {
    const part = {...cp1Part(), x: 850, y: 330, rotation, flipped};
    const bounds = partBounds(part), corners = cp1ArtCorners(part);
    for (const [field, expected] of Object.entries({
      minX: Math.min(...corners.map(p => p.x)), maxX: Math.max(...corners.map(p => p.x)),
      minY: Math.min(...corners.map(p => p.y)), maxY: Math.max(...corners.map(p => p.y)),
    })) assert.ok(Math.abs(bounds[field] - expected) < 1e-9, `${rotation}/${flipped}: ${field}`);
    const hits = createHitTest(() => [part], () => [], () => []);
    for (const p of cp1ArtCorners(part, 0.98)) {
      assert.equal(hits.partAt(p.x, p.y), part.id, `${rotation}/${flipped}: visible face corner remains selectable`);
    }
  }
});

test('Fit all parts frames the full CP1 art beside a CP5-style bench on desktop and narrow viewports', () => {
  for (const rotation of [0, 90, 180, 270]) for (const flipped of [false, true]) {
    const part = {...cp1Part(), x: 850, y: 330, rotation, flipped};
    const parts = [part, {kind: 'switch', x: 110, y: 80}, {kind: 'gnd', x: 650, y: 610}];
    for (const viewport of [{w: 918, h: 566}, {w: 354, h: 568}]) {
      const view = computeFitView(parts.map(partBounds), viewport);
      for (const p of cp1ArtCorners(part)) {
        const x = (p.x - view.pan.x) * view.zoom, y = (p.y - view.pan.y) * view.zoom;
        assert.ok(x >= 0 && x <= viewport.w && y >= 0 && y <= viewport.h,
          `${viewport.w}px/${rotation}/${flipped}: full art corner (${x}, ${y}) is inside the viewport`);
      }
    }
  }
});

test('a CP1 circuit serializes its identity, CP3 setting, and external port wires', () => {
  const circuit = new Circuit(5);
  const computer = circuit.addPart('kosmos-cp1', {expansion: true, clockHz: 6000000}, 250, 250);
  const resistor = circuit.addPart('resistor', {r: 330}, 500, 250);
  assert.deepEqual(computer.terminals, CP1_TERMINALS);
  assert.ok(circuit.addWire(computer.id, 'P2.0', resistor.id, 'a'));
  assert.ok(circuit.addWire(computer.id, 'P5.5', resistor.id, 'b'));
  assert.equal(circuit.addWire(computer.id, 'P5.6', resistor.id, 'a'), null);
  const restored = Circuit.fromJSON(JSON.parse(JSON.stringify(circuit.toJSON())));
  assert.equal(restored.vcc, 5);
  assert.equal(restored.parts[0].kind, 'kosmos-cp1');
  assert.deepEqual(restored.parts[0].params, computer.params);
  assert.deepEqual(restored.wires, circuit.wires);
  const detail = machineBootDetail(extractMachine(restored, extractors));
  assert.deepEqual(detail, {kind: 'cp1', config: {expansion: true, clockHz: 6000000, partId: computer.id}});
});

test('snap wiring reaches every CP1 contact after rotation and mirroring, never its empty center', () => {
  const {sidecar} = createCp1ConnectorAssets();
  const probe = {id: 'probe', kind: 'vcc', terminals: ['vcc'], x: 250, y: 230};
  for (const rotation of [0, 90, 180, 270]) {
    for (const flipped of [false, true]) {
      const computer = {...cp1Part(true), x: 250, y: 250, rotation, flipped, terminals: [...CP1_TERMINALS]};
      assert.equal(findSnapTarget(probe, [probe, computer], []).autoWire, null,
        'the empty center must not become a phantom CP1 terminal');
      for (const contact of sidecar.terminals) {
        const dx = (contact.x - 150) * (flipped ? -1 : 1), dy = contact.y - 200;
        const theta = rotation * Math.PI / 180;
        const x = 250 + dx * Math.cos(theta) - dy * Math.sin(theta);
        const y = 250 + dx * Math.sin(theta) + dy * Math.cos(theta);
        const dragged = {...probe, x: x + 3, y: y - 20};
        const snap = findSnapTarget(dragged, [dragged, computer], []);
        assert.equal(snap.autoWire?.toTerm, contact.name, `${contact.name}, ${rotation}, flipped ${flipped}`);
        assert.ok(Math.abs(snap.snapX - x) < 1e-6 && Math.abs(snap.snapY - (y - 20)) < 1e-6);
      }
    }
  }
});

test('CP1 extraction preserves its config through the boot event boundary', () => {
  const result = extractMachine({parts: [cp1Part()], wires: []}, extractors);
  assert.equal(result.ok, true);
  const detail = machineBootDetail(result);
  assert.deepEqual(detail, {kind: 'cp1', config: {expansion: false, clockHz: 6000000, partId: 'computer'}});
  assert.notEqual(detail.config, result.config);
  detail.config.partId = 'changed-copy';
  assert.equal(result.config.partId, 'computer');
});

test('CP3-only wiring is refused without expansion and accepted with it', () => {
  for (const wire of [
    {from: {part: 'computer', terminal: 'P3.0'}, to: {part: 'r1', terminal: 'a'}},
    {from: 'computer', fromTerminal: 'P4.7', to: 'r1', toTerminal: 'a'},
    {from: {part: 'r1', terminal: 'a'}, to: 'computer', toTerminal: 'P5.5'},
  ]) {
    const circuit = {parts: [cp1Part(), {id: 'r1', kind: 'resistor'}], wires: [wire]};
    const refusal = extractMachine(circuit, extractors);
    assert.equal(refusal.ok, false);
    assert.ok(refusal.reasons.some(reason => reason.includes('CP3')));
    assert.equal(machineBootDetail(refusal), null);
    circuit.parts[0].params.expansion = true;
    assert.equal(extractMachine(circuit, extractors).ok, true);
  }
});

test('CP1 delegates normalized wires and netlist inputs without losing topology', () => {
  const nets = [{id: 'wire', terminals: ['computer.P1.0', 'button.a']}];
  let observed;
  const result = extractMachine({parts: [cp1Part()], nets,
    wires: [{from: {part: 'computer', terminal: 'P1.0'}, to: 'button', toTerminal: 'a'}]},
  {extractCp1Machine: circuit => { observed = circuit; return {ok: true, config: {partId: 'computer'}}; }});
  assert.equal(result.kind, 'cp1');
  assert.equal(observed.nets, nets);
  assert.deepEqual(observed.wires[0], {from: 'computer', fromTerminal: 'P1.0', to: 'button', toTerminal: 'a'});
  const unavailable = extractMachine({parts: [cp1Part()], wires: []});
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.kind, 'cp1');
  assert.match(unavailable.reasons[0], /no CP1 extractor/);
});

test('the boot boundary still carries decoded-bus fields for existing machines', () => {
  const regions = [{start: 0, size: 65536}], chips = [{id: 'via'}], ports = [{address: 1}];
  assert.deepEqual(machineBootDetail({ok: true, kind: 'eater6502', regions, chips, ports}),
    {kind: 'eater6502', config: {regions, chips, ports}});
  assert.equal(machineBootDetail(null), null);
});

test('only a 6502 build can request that the host run retained firmware', () => {
  const options = {runLoadedMedia: true};
  assert.deepEqual(machineBootDetail({ok: true, kind: 'eater6502'}, options),
    {kind: 'eater6502', config: {}, runLoadedMedia: true});
  for (const kind of ['cp1', 'z80', 'i8086']) {
    assert.deepEqual(machineBootDetail({ok: true, kind}, options), {kind, config: {}});
  }
  assert.deepEqual(machineBootDetail({ok: true, kind: 'cp1'}, {clearLoadedMedia: true}),
    {kind: 'cp1', config: {}, clearLoadedMedia: true});
});

test('CP1 pins are never armed or driven by the illustrative MCU demo', () => {
  const computer = {...cp1Part(), terminals: [...CP1_TERMINALS]};
  const pins = classifyRunPins({parts: [computer], wires: []});
  assert.deepEqual(pins, {mcu: null, outputPins: [], inputPins: [], analogPins: []});
  const writes = [];
  armBoardForRun({board: {reset() {}}, parts: [computer], wires: [], setPin: (...args) => writes.push(args)});
  assert.deepEqual(writes, []);
  assert.equal(demoPinScriptApplies({hasMcu: !!pins.mcu, stc: {pins: []}}), false);
  const board = {};
  assert.equal(greenFlagArmsOwnBoard({ownBoard: board, externalBoard: board}), false,
    'the designer must not reset a board already clocked by the CP1 adapter');
});

test('a full upstream parts sync retains the locally authored CP1 assets', () => {
  const temp = mkdtempSync(join(tmpdir(), 'cui-cp1-sync-'));
  try {
    mkdirSync(join(temp, 'scripts'));
    mkdirSync(join(temp, 'src', 'parts-data'), {recursive: true});
    mkdirSync(join(temp, 'upstream', 'parts'), {recursive: true});
    copyFileSync(new URL('../scripts/sync-parts-data.mjs', import.meta.url), join(temp, 'scripts', 'sync-parts-data.mjs'));
    for (const suffix of ['json', 'svg']) {
      writeFileSync(join(temp, 'src', 'parts-data', `kosmos-cp1.${suffix}`), read(`../src/parts-data/kosmos-cp1.${suffix}`));
    }
    writeFileSync(join(temp, 'upstream', 'parts', 'example.json'), JSON.stringify({kind: 'example', terminals: []}));
    execFileSync(process.execPath, ['scripts/sync-parts-data.mjs', '--dir', 'upstream'], {cwd: temp, stdio: 'pipe'});
    assert.match(readFileSync(join(temp, 'src', 'parts-data', 'index.js'), 'utf8'), /kosmos-cp1\.json/);
    for (const suffix of ['json', 'svg']) {
      assert.equal(readFileSync(join(temp, 'src', 'parts-data', `kosmos-cp1.${suffix}`), 'utf8'), read(`../src/parts-data/kosmos-cp1.${suffix}`));
    }
  } finally {
    rmSync(temp, {recursive: true, force: true});
  }
});

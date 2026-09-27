import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, resetIds } from '../src/model/circuit.js';
import { FOOTPRINTS, computeLeadMap } from '../src/model/footprints.js';
import {
  CARRIERS, carrierOptionsForPart, carrierFootprintForPart, breadboardFootprintForPart,
} from '../src/model/carriers.js';
import { carrierAssemblySvg } from '../src/model/carrier-assembly-svg.js';
import { generateBom, bomToCsv } from '../src/model/bom.js';
import { projectBoard } from '../src/model/board-projection.js';
import { getLandPattern } from '../src/model/land-patterns.js';
import { runPcbDrc } from '../src/model/pcb-drc.js';
import { exportEasyEdaPcb } from '../src/model/exporters/easyeda-pcb.js';
import { importEasyEdaPcb } from '../src/importers/easyeda-pcb.js';

test('bare SMD packages remain non-seatable and package-neutral channels cannot acquire a carrier', () => {
  assert.equal(FOOTPRINTS.lt1006, undefined);
  assert.equal(breadboardFootprintForPart({ kind: 'lt1006' }, FOOTPRINTS), null);
  assert.deepEqual(carrierOptionsForPart({ kind: 'lt1006', sourcePackage: 'unspecified' }), []);
  assert.deepEqual(carrierOptionsForPart({ kind: 'lt1007_channel' }), []);
});

test('SOIC-8 carrier preserves physical pin order onto DIP-8 header legs', () => {
  const part = { kind: 'lt1006', carrier: 'soic8-dip8' };
  const fp = carrierFootprintForPart(part);
  assert.equal(fp.straddlesGutter, true);
  assert.equal(fp.refTerminal, 'offset_1');
  assert.deepEqual(fp.leads, {
    offset_1: { dRow: 0, dCol: 0 }, inn: { dRow: 0, dCol: 1 },
    inp: { dRow: 0, dCol: 2 }, vneg: { dRow: 0, dCol: 3 },
    offset_5: { dRow: 5, dCol: 3 }, out: { dRow: 5, dCol: 2 },
    vpos: { dRow: 5, dCol: 1 }, iset: { dRow: 5, dCol: 0 },
  });
  assert.deepEqual(computeLeadMap(fp, 'e7'), {
    offset_1: 'e7', inn: 'e8', inp: 'e9', vneg: 'e10',
    offset_5: 'f10', out: 'f9', vpos: 'f8', iset: 'f7',
  });
});

test('SOIC-14 and TSOT-5 carriers are explicit families, not fake device footprints', () => {
  const soic14 = carrierFootprintForPart({ kind: 'op747', carrier: 'soic14-dip14' });
  assert.equal(Object.keys(soic14.leads).length, 14);
  assert.deepEqual(soic14.leads['1_out'], { dRow: 5, dCol: 0 });
  const tsot = carrierFootprintForPart({ kind: 'adp151', carrier: 'tsot5-header5' });
  assert.equal(tsot.straddlesGutter, undefined);
  assert.deepEqual(tsot.leads, {
    vin: { dRow: 0, dCol: 0 }, gnd: { dRow: 0, dCol: 1 },
    en: { dRow: 0, dCol: 2 }, nc: { dRow: 0, dCol: 3 }, vout: { dRow: 0, dCol: 4 },
  });
});

test('carrier persists, contributes a BOM row, seats, and conducts through a strip', () => {
  resetIds();
  const circuit = new Circuit(5);
  const bb = circuit.addPart('breadboard', {}, 0, 0);
  const chip = circuit.addPart('lt1006', {}, 0, 0);
  const tap = circuit.addPart('vcc', {}, 0, 0);
  assert.equal(circuit.setCarrier(chip.id, 'soic8-dip8'), true);
  const fp = breadboardFootprintForPart(chip, FOOTPRINTS);
  assert.ok(circuit.seatPart(chip.id, bb.id, computeLeadMap(fp, 'e7')));
  assert.ok(circuit.seatPart(tap.id, bb.id, computeLeadMap(FOOTPRINTS.vcc, 'a7')));
  const shared = circuit.resolvedNets.find(net => {
    const names = net.terminals.map(t => `${t.partId || t.part}:${t.terminal}`);
    return names.includes(`${chip.id}:offset_1`) && names.includes(`${tap.id}:vcc`);
  });
  assert.ok(shared, 'carrier header pin conducts through the breadboard strip');

  const bom = generateBom(circuit.parts);
  assert.equal(bom.find(line => line.kind === 'soic8-dip8')?.qty, 1);
  assert.match(bom.find(line => line.kind === 'soic8-dip8')?.label || '', /SOIC-8 to DIP-8/);

  const restored = Circuit.fromJSON(JSON.parse(JSON.stringify(circuit.toJSON())));
  const restoredChip = restored.parts.find(part => part.id === chip.id);
  assert.equal(restoredChip.carrier, 'soic8-dip8');
  assert.equal(restoredChip.seat.leadMap.offset_1, 'e7');
  assert.equal(restored.breadboards.get(bb.id).occupantOf('e7').partId, chip.id);

  const duplicate = circuit.duplicatePart(chip.id);
  assert.equal(duplicate.carrier, 'soic8-dip8');
  assert.equal(duplicate.seat, undefined, 'duplicating a mounted device does not clone occupied holes');
  assert.equal(circuit.setCarrier(chip.id, null), true);
  assert.equal(chip.carrier, undefined);
  assert.equal(chip.seat, undefined, 'removing a carrier unseats the bare SMD package');
  assert.equal(circuit.breadboards.get(bb.id).occupantOf('e7'), undefined);
});

test('invalid or cross-package carrier choices fail closed', () => {
  resetIds();
  const circuit = new Circuit(5);
  const chip = circuit.addPart('adp151', {}, 0, 0);
  assert.equal(circuit.setCarrier(chip.id, 'soic8-dip8'), false);
  assert.equal(chip.carrier, undefined);
  const loaded = Circuit.fromJSON({ parts: [{ ...chip, carrier: 'soic8-dip8' }], wires: [] });
  assert.equal(loaded.parts[0].carrier, undefined);
  const neutral = Circuit.fromJSON({
    parts: [{ id: 'neutral', kind: 'lt1006', params: {}, terminals: [],
      sourcePackage: 'unspecified', carrier: 'soic8-dip8' }],
    wires: [],
  });
  assert.equal(neutral.parts[0].carrier, undefined,
    'a package-neutral source channel cannot recover a physical carrier from JSON');

  const stale = Circuit.fromJSON({
    parts: [
      { id: 'bb', kind: 'breadboard', params: {}, terminals: [], x: 0, y: 0 },
      {
        id: 'u1', kind: 'lt1006', params: {}, terminals: [], x: 0, y: 0,
        carrier: 'soic8-dip8', seat: { boardId: 'bb', leadMap: { offset_1: 'e7' } },
      },
    ],
    wires: [],
  });
  assert.equal(stale.parts.find(part => part.id === 'u1').seat, undefined,
    'partial carrier lead maps cannot occupy a board after load');
});

test('bare SMD packages project onto truthful PCB land patterns', () => {
  const result = projectBoard({
    parts: [{ id: 'U1', kind: 'lt1006', params: {}, terminals: [] }], wires: [],
  });
  assert.deepEqual(result.unplaced, []);
  assert.equal(result.board.parts[0].package, 'lt1006:soic-8');
  assert.equal(result.board.parts[0].pads.length, 8);
  assert.equal(getLandPattern('lt1006', 'soic-8').pads.find(pad => pad.num === '8').terminal, 'iset');
});

test('a connected SOIC-8 design routes, passes DRC, and survives board export/import', () => {
  const result = projectBoard({
    parts: [
      { id: 'U1', kind: 'lt1006', params: {} },
      { id: 'J1', kind: 'header', params: { pins: 4 } },
    ],
    wires: [
      { from: 'J1', fromTerminal: 'p1', to: 'U1', toTerminal: 'vpos' },
      { from: 'J1', fromTerminal: 'p2', to: 'U1', toTerminal: 'vneg' },
      { from: 'J1', fromTerminal: 'p3', to: 'U1', toTerminal: 'inp' },
      { from: 'J1', fromTerminal: 'p4', to: 'U1', toTerminal: 'out' },
      { from: 'U1', fromTerminal: 'inn', to: 'U1', toTerminal: 'out' },
    ],
  });
  assert.deepEqual(result.unplaced, []);
  assert.deepEqual(result.unrouted, []);
  assert.deepEqual(runPcbDrc(result.board), []);
  const restored = importEasyEdaPcb(exportEasyEdaPcb(result.board));
  assert.deepEqual(runPcbDrc(restored), []);
  assert.equal(restored.parts.find(part => part.ref === 'U1').pads.length, 8);
});

const ASSEMBLY_CASES = [
  { kind: 'lt1006', carrier: 'soic8-dip8', count: 8, first: 'offset_1', last: 'iset' },
  { kind: 'op747', carrier: 'soic14-dip14', count: 14, first: '1_neg', last: '1_out' },
  { kind: 'adp151', carrier: 'tsot5-header5', count: 5, first: 'vin', last: 'vout' },
];

test('carrier procurement metadata states only package and generic header facts', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(CARRIERS).map(([id, carrier]) => [id, {
    package: carrier.package,
    inputPitchMm: carrier.inputPitchMm,
    headerPitchMm: carrier.headerPitchMm,
    sourcing: carrier.sourcing,
  }])), {
    'soic8-dip8': { package: 'SOIC-8', inputPitchMm: 1.27, headerPitchMm: 2.54, sourcing: 'vendor-neutral' },
    'soic14-dip14': { package: 'SOIC-14', inputPitchMm: 1.27, headerPitchMm: 2.54, sourcing: 'vendor-neutral' },
    'tsot5-header5': { package: 'TSOT-5', inputPitchMm: 0.95, headerPitchMm: 2.54, sourcing: 'vendor-neutral' },
  });
});

test('each physical carrier family produces a complete deterministic top-view legend', () => {
  for (const item of ASSEMBLY_CASES) {
    const svg = carrierAssemblySvg(item);
    assert.equal(svg, carrierAssemblySvg(item), `${item.carrier} output must be deterministic`);
    assert.equal([...svg.matchAll(/data-pin="/g)].length, item.count);
    assert.match(svg, new RegExp(`data-pin="1" data-terminal="${item.first}"`));
    assert.match(svg, new RegExp(`data-pin="${item.count}" data-terminal="${item.last}"`));
    assert.match(svg, /data-pin-one-marker="true"/);
    assert.match(svg, /TOP VIEW/);
    assert.match(svg, /No manufacturer, board outline, or pad dimensions are prescribed/);
  }
});

test('carrier BOM rows and CSV retain pitch, sourcing and per-device legend authority', () => {
  const bom = generateBom(ASSEMBLY_CASES.map((item, index) => ({
    id: `u${index + 1}`, kind: item.kind, carrier: item.carrier, params: {},
  })));
  const soic8 = bom.find(line => line.kind === 'soic8-dip8');
  assert.deepEqual(soic8.carrier, {
    id: 'soic8-dip8', inputPackage: 'SOIC-8', inputPitchMm: 1.27,
    headerPitchMm: 2.54, layout: 'dip', sourcing: 'vendor-neutral',
  });
  assert.deepEqual(soic8.assemblyKinds, ['lt1006']);
  const csv = bomToCsv(bom);
  assert.match(csv, /^Qty,Part,Value,Input package,Input pitch \(mm\),Header pitch \(mm\),Sourcing/m);
  assert.match(csv, /"SOIC-8","1\.27","2\.54","vendor-neutral"/);
  assert.match(csv, /"TSOT-5","0\.95","2\.54","vendor-neutral"/);
});

test('incompatible or package-neutral devices cannot produce an assembly legend', () => {
  assert.throws(() => carrierAssemblySvg({ kind: 'adp151', carrier: 'soic8-dip8' }), /compatible physical part/);
  assert.throws(() => carrierAssemblySvg({ kind: 'lt1006', carrier: 'soic8-dip8', sourcePackage: 'unspecified' }), /compatible physical part/);
});

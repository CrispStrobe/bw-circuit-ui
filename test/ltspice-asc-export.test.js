import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { importLtspiceAsc } from '../src/importers/ltspice-asc.js';
import { toLtspiceAsc } from '../src/model/exporters/ltspice-asc.js';
import { CIRCUIT_EXPORTS, runExport } from '../src/model/exporters/registry.js';
import { wireEndpoint } from '../src/model/wire-endpoints.js';
import { importKicadSch } from '../src/importers/kicad-sch.js';
import { toKicadSch } from '../src/model/exporters/kicad-sch.js';
import { importSpice } from '../src/importers/spice.js';
import { Circuit } from '../src/model/circuit.js';
import './_setup.js';

const terminalPartitions = wires => {
  const parent = new Map();
  const find = x => { if (!parent.has(x)) parent.set(x, x); if (parent.get(x) !== x) parent.set(x, find(parent.get(x))); return parent.get(x); };
  for (const wire of wires) { const from = wireEndpoint(wire, 'from'); const to = wireEndpoint(wire, 'to'); const a = `${from.part}.${from.terminal}`; const b = `${to.part}.${to.terminal}`; const ra = find(a); const rb = find(b); if (ra !== rb) parent.set(ra, rb); }
  const groups = new Map();
  for (const key of parent.keys()) { const root = find(key); if (!groups.has(root)) groups.set(root, []); groups.get(root).push(key); }
  return [...groups.values()].map(group => group.sort()).sort((a, b) => a.join().localeCompare(b.join()));
};

const circuit = { parts: [
  { id: 'V1', kind: 'vsource', params: { volts: 6 } }, { id: 'I1', kind: 'isource', params: { amps: 0.002 } },
  { id: 'R1', kind: 'resistor', params: { ohms: 1000 } }, { id: 'C1', kind: 'capacitor', params: { farads: 1e-6 } },
  { id: 'GND1', kind: 'gnd', params: {} },
], wires: [
  { from: { part: 'V1', terminal: 'pos' }, to: { part: 'R1', terminal: 'a' } },
  { from: { part: 'I1', terminal: 'neg' }, to: { part: 'R1', terminal: 'a' } },
  { from: { part: 'R1', terminal: 'b' }, to: { part: 'C1', terminal: 'a' } },
  { from: { part: 'C1', terminal: 'b' }, to: { part: 'V1', terminal: 'neg' } },
  { from: { part: 'I1', terminal: 'pos' }, to: { part: 'V1', terminal: 'neg' } },
  { from: { part: 'GND1', terminal: 'gnd' }, to: { part: 'V1', terminal: 'neg' } },
] };

describe('bounded LTspice ASC exporter', () => {
  it('round-trips supported values and independent terminal partitions', () => {
    const out = toLtspiceAsc(circuit); assert.deepEqual(out.skipped, []);
    const imported = importLtspiceAsc(out.text);
    assert.equal(imported.losses.length, 0); assert.equal(imported.unmapped.length, 0);
    assert.deepEqual(imported.parts.filter(p => p.kind !== 'gnd').map(p => [p.id, p.kind, p.params]), [
      ['V1', 'vsource', { volts: 6 }], ['I1', 'isource', { amps: 0.002 }],
      ['R1', 'resistor', { ohms: 1000 }], ['C1', 'capacitor', { farads: 1e-6 }],
    ]);
    assert.deepEqual(terminalPartitions(imported.wires), terminalPartitions(circuit.wires));
  });

  it('reports unsupported semantics instead of silently flattening them', () => {
    const out = toLtspiceAsc({ parts: [
      { id: 'V1', kind: 'vsource', params: { volts: 2, sineAmplitude: 1 } }, { id: 'D1', kind: 'diode', params: {} },
    ] });
    assert.deepEqual(out.skipped.map(s => [s.id, s.reason]), [['V1', 'unrepresented parameters: sineAmplitude'],
      ['D1', 'diode needs explicit finite Shockley IS/N/RS parameters']]);
    assert.doesNotMatch(out.text, /SYMBOL/);
  });

  it('is reachable headlessly through the shared export registry', async () => {
    const entry = CIRCUIT_EXPORTS.find(candidate => candidate.id === 'ltspice-asc'); assert.ok(entry);
    const out = await runExport(entry, { circuit });
    assert.equal(out.files[0].name, 'circuit.asc'); assert.match(out.files[0].text, /^Version 4/m); assert.deepEqual(out.report.skipped, []);
  });

  it('replays an unchanged retained ASC document but refuses to hide later edits', () => {
    const source = `Version 4.1
SHEET 1 880 680
SYMBOL res 100 100 R0
SYMATTR InstName R1
SYMATTR Value 2k
FLAG 116 116 A
FLAG 116 196 B
FUTURE_RECORD preserved exactly
`;
    const imported = importLtspiceAsc(source);
    const exact = toLtspiceAsc(imported);
    assert.equal(exact.text, source);
    assert.equal(exact.preservedSourceDocument, true);
    imported.parts[0].params.ohms = 3000;
    const edited = toLtspiceAsc(imported);
    assert.equal(edited.preservedSourceDocument, undefined);
    assert.doesNotMatch(edited.text, /FUTURE_RECORD/);
    assert.match(edited.text, /SYMATTR Value 3000/);
    assert.ok(edited.warnings.some(warning => /changed after ASC import/.test(warning)));
  });

  it('replays retained ASC after a real Circuit JSON load but detects a later edit', () => {
    const source = `Version 4.1
SHEET 1 880 680
SYMBOL res 100 100 R0
SYMATTR InstName R1
SYMATTR Value 2k
FLAG 116 116 A
FLAG 116 196 B
FUTURE_RECORD preserved through GUI load
`;
    const imported = importLtspiceAsc(source);
    const loaded = Circuit.fromJSON({ vcc: 5, parts: imported.parts, wires: imported.wires,
      sourceDocuments: [imported.sourceDocument] });
    const exact = toLtspiceAsc(loaded);
    assert.equal(exact.text, source);
    assert.equal(exact.preservedSourceDocument, true);
    loaded.parts[0].x += 16;
    const edited = toLtspiceAsc(loaded);
    assert.equal(edited.preservedSourceDocument, undefined);
    assert.ok(edited.warnings.some(warning => /changed after ASC import/.test(warning)));
  });

  it('round-trips R/C/L/V/I values and terminal partitions through generated KiCad', () => {
    const interchange = { parts: [
      { id: 'R1', kind: 'resistor', params: { ohms: 2000 } },
      { id: 'C1', kind: 'capacitor', params: { farads: 2e-6 } },
      { id: 'L1', kind: 'inductor', params: { henrys: 3e-3 } },
      { id: 'V1', kind: 'vsource', params: { volts: 5 } },
      { id: 'I1', kind: 'isource', params: { amps: 4e-3 } },
      { id: 'GND1', kind: 'gnd', params: {} },
    ], wires: [
      { from: { part: 'R1', terminal: 'a' }, to: { part: 'V1', terminal: 'pos' } },
      { from: { part: 'R1', terminal: 'b' }, to: { part: 'C1', terminal: 'a' } },
      { from: { part: 'C1', terminal: 'b' }, to: { part: 'L1', terminal: 'a' } },
      { from: { part: 'L1', terminal: 'b' }, to: { part: 'V1', terminal: 'neg' } },
      { from: { part: 'I1', terminal: 'neg' }, to: { part: 'V1', terminal: 'pos' } },
      { from: { part: 'I1', terminal: 'pos' }, to: { part: 'V1', terminal: 'neg' } },
      { from: { part: 'GND1', terminal: 'gnd' }, to: { part: 'V1', terminal: 'neg' } },
    ] };
    const kicad = toKicadSch(interchange);
    assert.deepEqual(kicad.skipped, []);
    const fromKicad = importKicadSch(kicad.text);
    assert.equal(fromKicad.unmapped.length, 0);
    const asc = toLtspiceAsc(fromKicad);
    assert.deepEqual(asc.skipped, []);
    const back = importLtspiceAsc(asc.text);
    assert.deepEqual(back.parts.filter(part => part.kind !== 'gnd').map(part =>
      [part.id, part.kind, part.params]), [
      ['R1', 'resistor', { ohms: 2000 }], ['C1', 'capacitor', { farads: 2e-6 }],
      ['L1', 'inductor', { henrys: 3e-3 }], ['V1', 'vsource', { volts: 5 }],
      ['I1', 'isource', { amps: 4e-3 }],
    ]);
    assert.deepEqual(terminalPartitions(back.wires), terminalPartitions(interchange.wires));
  });

  it('round-trips supported SPICE R/C/L/D/Q/M/E/G through ASC plus generated ASYs', () => {
    const spice = `supported device interchange
V1 supply 0 5
R1 supply nr 2k
C1 nr 0 2u
L1 nr nl 3m
D1 nl 0 DMOD
Q1 nq nb 0 QMOD
M1 nd ng 0 0 MMOD W=20u L=1u
E1 ne 0 nr 0 2.5
G1 0 ng nr 0 1m
.model DMOD D (IS=1e-14 N=1 RS=0.1)
.model QMOD NPN (IS=2e-14 BF=150 BR=2 NF=1.1)
.model MMOD NMOS (LEVEL=1 VTO=1 KP=1m LAMBDA=0.01)
.op
.end
`;
    const original = importSpice(spice);
    assert.equal(original.unmapped.length, 0);
    assert.equal(original.losses.length, 0);
    const asc = toLtspiceAsc(original);
    assert.deepEqual(asc.skipped, []);
    assert.deepEqual(asc.symbolFiles.map(file => file.name).sort(),
      ['bw_nmos.asy', 'bw_npn.asy', 'bw_vccs.asy', 'bw_vcvs.asy']);
    const symbols = new Map(asc.symbolFiles.map(file => [file.name.replace(/\.asy$/, ''), file.text]));
    const back = importLtspiceAsc(asc.text, { symbols });
    assert.equal(back.unmapped.length, 0);
    assert.deepEqual(back.parts.filter(part => part.kind !== 'gnd').map(part => [part.id, part.kind]),
      original.parts.filter(part => part.kind !== 'gnd').map(part => [part.id, part.kind]));
    assert.deepEqual(terminalPartitions(back.wires), terminalPartitions(original.wires));
    assert.equal(back.parts.find(part => part.id === 'Q1').params.is, 2e-14);
    assert.equal(back.parts.find(part => part.id === 'Q1').params.beta, 150);
    assert.equal(back.parts.find(part => part.id === 'M1').params.vth, 1);
    assert.equal(back.parts.find(part => part.id === 'M1').params.w, 20e-6);
  });
});

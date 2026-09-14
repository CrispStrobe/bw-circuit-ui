import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { importLtspiceAsc } from '../src/importers/ltspice-asc.js';
import { toLtspiceAsc } from '../src/model/exporters/ltspice-asc.js';
import { CIRCUIT_EXPORTS, runExport } from '../src/model/exporters/registry.js';
import { wireEndpoint } from '../src/model/wire-endpoints.js';

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
    assert.deepEqual(out.skipped.map(s => [s.id, s.reason]), [['V1', 'unrepresented parameters: sineAmplitude'], ['D1', 'unsupported kind']]);
    assert.doesNotMatch(out.text, /SYMBOL/);
  });

  it('is reachable headlessly through the shared export registry', async () => {
    const entry = CIRCUIT_EXPORTS.find(candidate => candidate.id === 'ltspice-asc'); assert.ok(entry);
    const out = await runExport(entry, { circuit });
    assert.equal(out.files[0].name, 'circuit.asc'); assert.match(out.files[0].text, /^Version 4/m); assert.deepEqual(out.report.skipped, []);
  });
});

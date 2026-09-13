import './_setup.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { importLtspiceAsc } from '../src/importers/ltspice-asc.js';
import { importSpice } from '../src/importers/spice.js';
import { Circuit } from '../src/model/circuit.js';
import { extractNetlist } from '../src/model/netlist.js';
import { toSpice } from '../src/model/exporters/spice.js';
import {
  annotateImportedSingletonTerminals,
  withImportedSingletonNets,
} from '../src/model/import-singleton-nets.js';

const netFor = (circuit, part, terminal) => circuit.resolvedNets.find(net =>
  net.terminals.some(item => item.part === part && item.terminal === terminal));

const SPICE_SINGLETONS = `singleton membership
V1 driven 0 DC 5
V2 unloaded 0 DC -2
R1 driven dangling 1k
.op
.end
`;

describe('imported singleton electrical nets', () => {
  it('annotates only unique memberships, once', () => {
    const parts = [{ id: 'R1' }, { id: 'V1', singletonTerminals: ['pos'] }];
    annotateImportedSingletonTerminals(parts, [
      [{ part: 'R1', terminal: 'b' }],
      [{ partId: 'R1', terminal: 'b' }, { partId: 'R1', terminal: 'b' }],
      [{ partId: 'V1', terminal: 'pos' }],
      [{ partId: 'R1', terminal: 'a' }, { partId: 'V1', terminal: 'neg' }],
    ]);
    assert.deepEqual(parts, [
      { id: 'R1', singletonTerminals: ['b'] },
      { id: 'V1', singletonTerminals: ['pos'] },
    ]);
  });

  it('materializes independent stable nets without mutating input nets', () => {
    const parts = [
      { id: 'R1', terminals: ['a', 'b'], singletonTerminals: ['b', 'b', 'missing'] },
      { id: 'V1', terminals: ['pos', 'neg'], singletonTerminals: ['pos'] },
    ];
    const collision = 'net-imported-singleton-52-31-62';
    const input = [{ id: collision, terminals: [{ part: 'R1', terminal: 'a' }] }];
    const before = structuredClone(input);
    const output = withImportedSingletonNets(parts, input);

    assert.deepEqual(input, before, 'materialization must not mutate caller-owned nets');
    assert.deepEqual(output.map(net => net.id), [
      collision,
      'net-imported-singleton-52-31-62-2',
      'net-imported-singleton-56-31-70-6f-73',
    ]);
    assert.deepEqual(output.slice(1).map(net => net.terminals), [
      [{ part: 'R1', terminal: 'b' }],
      [{ part: 'V1', terminal: 'pos' }],
    ]);
  });

  it('preserves unloaded sources and dangling passive terminals through solve and JSON', () => {
    const imported = importSpice(SPICE_SINGLETONS);
    assert.deepEqual(imported.unmapped, []);
    assert.deepEqual(imported.losses, []);
    assert.deepEqual(imported.parts.find(part => part.id === 'V2').singletonTerminals, ['pos']);
    assert.deepEqual(imported.parts.find(part => part.id === 'R1').singletonTerminals, ['b']);

    const circuit = Circuit.fromJSON({ vcc: 5, parts: imported.parts, wires: imported.wires });
    assert.equal(circuit.netlistError, null);
    const op = circuit.operatingPoint();
    assert.equal(op.converged, true);
    assert.ok(Math.abs(op.nodeVoltages.get(netFor(circuit, 'V2', 'pos').id) + 2) < 1e-12);
    assert.ok(Math.abs(op.branchCurrents.get('R1').get('a')) < 1e-11,
      'a resistor ending on an otherwise empty node has only the engine gmin leakage');
    assert.notEqual(netFor(circuit, 'V2', 'pos').id, netFor(circuit, 'R1', 'b').id,
      'distinct source nets must not be hidden-bound together');
    assert.equal(circuit.wires.some(wire => wire.from.part === wire.to.part
      && wire.from.terminal === wire.to.terminal), false, 'no self-loop wire is synthesized');

    const restored = Circuit.fromJSON(structuredClone(circuit.toJSON()));
    assert.deepEqual(restored.getPart('V2').singletonTerminals, ['pos']);
    assert.ok(netFor(restored, 'V2', 'pos'));
    assert.ok(netFor(restored, 'R1', 'b'));
  });

  it('lets a real wire win, then restores the annotated nodes after disconnect', () => {
    const imported = importSpice(SPICE_SINGLETONS);
    const circuit = Circuit.fromJSON({ vcc: 5, parts: imported.parts, wires: imported.wires });
    const wire = circuit.addWire('V2', 'pos', 'R1', 'b');
    assert.ok(wire);
    assert.equal(netFor(circuit, 'V2', 'pos').id, netFor(circuit, 'R1', 'b').id);
    assert.equal(circuit.resolvedNets.filter(net => net.terminals.some(item =>
      (item.part === 'V2' && item.terminal === 'pos')
      || (item.part === 'R1' && item.terminal === 'b'))).length, 1,
    'annotations must not duplicate a terminal already resolved by a wire');

    assert.equal(circuit.removeWire(wire.id), true);
    assert.notEqual(netFor(circuit, 'V2', 'pos').id, netFor(circuit, 'R1', 'b').id);
  });

  it('applies the same rule to external nets and ignores stale metadata', () => {
    const imported = importSpice(SPICE_SINGLETONS);
    imported.parts.find(part => part.id === 'R1').singletonTerminals.push('not-a-terminal');
    const circuit = Circuit.fromJSON({ vcc: 5, parts: imported.parts, wires: imported.wires });
    const external = [{ id: 'external-driven', terminals: [
      { part: 'V1', terminal: 'pos' }, { part: 'R1', terminal: 'a' },
    ] }];
    const before = structuredClone(external);
    circuit.syncWithExternalNets(external);
    assert.deepEqual(external, before);
    assert.ok(netFor(circuit, 'V2', 'pos'));
    assert.ok(netFor(circuit, 'R1', 'b'));
    assert.equal(netFor(circuit, 'R1', 'not-a-terminal'), undefined);
  });

  it('exports resolved singleton memberships and recreates them on re-import', () => {
    const imported = importSpice(SPICE_SINGLETONS);
    const circuit = Circuit.fromJSON({ vcc: 5, parts: imported.parts, wires: imported.wires });
    const exported = toSpice(extractNetlist(circuit), 'singleton round trip');
    assert.deepEqual(exported.skipped, []);
    assert.match(exported.text, /^V2\s+\S+\s+0\s+-2$/m);
    assert.match(exported.text, /^R1\s+\S+\s+\S+\s+1k$/m);

    const back = importSpice(exported.text);
    const restored = Circuit.fromJSON({ vcc: 5, parts: back.parts, wires: back.wires });
    const unloaded = back.parts.find(part => part.kind === 'vsource'
      && part.params.volts === -2);
    assert.ok(unloaded);
    assert.ok(netFor(restored, unloaded.id, 'pos'),
      'the exporter must consume resolvedNets, not only drawn wires');
  });

  it('preserves singleton ASC flags through the same Circuit path', () => {
    const imported = importLtspiceAsc(`Version 4
SHEET 1 160 160
FLAG 0 16 output
FLAG 0 96 0
SYMBOL voltage 0 0 R0
SYMATTR InstName V1
SYMATTR Value 3
TEXT 120 120 Left 2 !.op
`);
    assert.deepEqual(imported.losses, []);
    assert.deepEqual(imported.unmapped, []);
    assert.deepEqual(imported.parts.find(part => part.id === 'V1').singletonTerminals, ['pos']);
    const circuit = Circuit.fromJSON({ vcc: 5, parts: imported.parts, wires: imported.wires });
    assert.equal(circuit.netlistError, null);
    const op = circuit.operatingPoint();
    assert.ok(Math.abs(op.nodeVoltages.get(netFor(circuit, 'V1', 'pos').id) - 3) < 1e-12);
  });
});

import './_setup.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { importLtspiceAsc } from '../src/importers/ltspice-asc.js';
import { Circuit } from '../src/model/circuit.js';

const sourceSha = 'de4401d01225e1dba4b5658784625614ba706b89c871afbefb28a0a22d459d85';
const terminals = ['inp', 'inn', 'vpos', 'vneg', 'out'];

function asc(...attributes) {
  return `Version 4
SHEET 1 800 600
SYMBOL OpAmps\\UniversalOpAmp2 200 200 R0
SYMATTR InstName U1
${attributes.join('\n')}
`;
}

function importedPart(...attributes) {
  const result = importLtspiceAsc(asc(...attributes));
  assert.deepEqual(result.unmapped, []);
  assert.equal(result.parts.length, 1);
  return { result, part: result.parts[0] };
}

test('the current official built-in symbol maps its exact five-pin Level-2 defaults', () => {
  const { result, part } = importedPart();
  assert.deepEqual(result.losses, []);
  assert.equal(part.kind, 'ltspice_universal_opamp2');
  assert.equal(part.sourcePackage, 'unspecified');
  assert.deepEqual(part.terminals, terminals);
  assert.equal(part.sourceLibrary, 'opamps/universalopamp2');
  assert.equal(part.verifiedBuiltinSymbolSha256, sourceSha);
  assert.equal(part.sourceModelFile, 'UniversalOpAmp2.lib');
  assert.equal(part.sourceSubcircuit, 'level2');
  assert.deepEqual(part.params, {
    a0: 1e6,
    gbwHz: 10e6,
    slewVPerUs: 10,
    outputCurrentLimitA: 0.025,
    railHeadroomV: 0,
    inputOffsetV: 0,
    inputR: 1e9,
  });
  assert.deepEqual(result.sourceDocument.instances[0].pins.map(pin => [
    pin.spiceOrder, pin.pinName, pin.x, pin.y,
  ]), [
    [1, 'inp', -32, 16], [2, 'inn', -32, -16], [3, 'vpos', 0, -32],
    [4, 'vneg', 0, 32], [5, 'out', 32, 0],
  ]);
});

test('authored deterministic parameters become normalized engine parameters', () => {
  const { result, part } = importedPart(
    'SYMATTR Value2 Avol=125 GBW=1Meg Slew=500k Vos=2m',
    'SYMATTR SpiceLine Ilimit=10m Rail=.5',
    'SYMATTR SpiceLine2 En=0 Enk=0 In=0 Ink=0 Rin=2Meg',
  );
  assert.deepEqual(result.losses, []);
  assert.deepEqual(part.params, {
    a0: 125,
    gbwHz: 1e6,
    slewVPerUs: 0.5,
    outputCurrentLimitA: 0.01,
    railHeadroomV: 0.5,
    inputOffsetV: 0.002,
    inputR: 4e6,
  });
});

test('explicit empty parameter lines expose the subcircuit defaults', () => {
  const { result, part } = importedPart(
    'SYMATTR Value2 ""', 'SYMATTR SpiceLine ""', 'SYMATTR SpiceLine2 ""',
  );
  assert.deepEqual(result.losses, []);
  assert.equal(part.params.a0, 1e6);
  assert.equal(part.params.inputR, 2e9,
    'library Rin=1G becomes 2G differential when the ASY Rin=500Meg override is erased');
});

test('bounded top-level constants may author a deterministic parameter', () => {
  const text = `${asc('SYMATTR SpiceLine Ilimit=25m Rail={headroom} Vos=0')}
TEXT 400 400 Left 2 !.param headroom=750m
`;
  const result = importLtspiceAsc(text);
  assert.deepEqual(result.losses, []);
  assert.equal(result.parts[0].params.railHeadroomV, 0.75);
});

test('noise, unknown, repeated, unresolved and identity-changing fields refuse by name', () => {
  for (const [line, named] of [
    ['SYMATTR SpiceLine2 En=10n Enk=0 In=0 Ink=0 Rin=500Meg', /nonzero noise parameter en/],
    ['SYMATTR SpiceLine Ilimit=25m Rail=0 Vos=0 phimargin=45', /parameter phimargin is unsupported/],
    ['SYMATTR Value2 Avol=1Meg Avol=2Meg', /parameter Avol is repeated/],
    ['SYMATTR SpiceLine Ilimit=25m Rail={missing} Vos=0', /parameter Rail is not a resolved finite scalar/],
    ['SYMATTR SpiceModel level3', /SpiceModel must be exactly level2/],
    ['SYMATTR Value LM2901', /Value must be absent/],
  ]) {
    const result = importLtspiceAsc(asc(line));
    assert.equal(result.parts.length, 1, line);
    assert.equal(result.losses.length, 1, line);
    assert.match(result.losses[0].reason, named, line);
    assert.equal(result.sourceDocument.instances[0].electricalStatus,
      'mapped-with-analysis-blockers', line);
    const restored = Circuit.fromJSON({ parts: result.parts, wires: result.wires });
    assert.throws(() => restored.operatingPoint(), /blocked by 1 persisted import finding/, line);
  }
});

test('an imported slow-slew follower writes the physical ramp into true scope samples', () => {
  const { result, part } = importedPart(
    'SYMATTR Value2 Avol=1Meg GBW=10Meg Slew=100k',
  );
  assert.deepEqual(result.losses, []);
  const circuit = Circuit.fromJSON({
    vcc: 5,
    parts: [
      part,
      { id: 'VS', kind: 'vsource', params: { volts: 5 }, terminals: ['pos', 'neg'] },
      { id: 'VIN', kind: 'vsource', params: { volts: 0 }, terminals: ['pos', 'neg'] },
      { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'RL', kind: 'resistor', params: { ohms: 10_000 }, terminals: ['a', 'b'] },
    ],
    wires: [
      { from: 'G', fromTerminal: 'gnd', to: 'VS', toTerminal: 'neg' },
      { from: 'G', fromTerminal: 'gnd', to: 'VIN', toTerminal: 'neg' },
      { from: 'G', fromTerminal: 'gnd', to: 'U1', toTerminal: 'vneg' },
      { from: 'G', fromTerminal: 'gnd', to: 'RL', toTerminal: 'b' },
      { from: 'VS', fromTerminal: 'pos', to: 'U1', toTerminal: 'vpos' },
      { from: 'VIN', fromTerminal: 'pos', to: 'U1', toTerminal: 'inp' },
      { from: 'U1', fromTerminal: 'out', to: 'U1', toTerminal: 'inn' },
      { from: 'U1', fromTerminal: 'out', to: 'RL', toTerminal: 'a' },
    ],
  });
  circuit.board.advanceTo(2_000n);
  const outputNet = circuit.board.getNets().find(net => net.terminals.some(item =>
    item.part === 'U1' && item.terminal === 'out')).id;
  const channel = circuit.board.addScopeChannel({
    type: 'voltage', netId: outputNet, sampleRateHz: 10_000_000, depth: 512, capture: 'sample',
  });
  circuit.board.setControl('VIN', 4);
  // The app advances simulation in bounded animation slices. Reproduce that
  // public path instead of asking one call to consume more internal device
  // wakes than Board's per-advance work budget permits.
  for (let slice = 0; slice < 10; slice++) {
    circuit.board.advanceTo(circuit.board.timeNs + 2_000n);
  }
  const data = circuit.board.getScopeData(channel);
  const written = Math.min(data.count, data.samples.length / 2);
  const values = Array.from({ length: written }, (_, index) => data.samples[index * 2])
    .filter(Number.isFinite);
  assert.ok(values.length >= 100, `expected a real high-rate record, got ${values.length}`);
  assert.ok(values.at(20) > 0.15 && values.at(20) < 0.3,
    `0.1 V/us source ramp at 2 us was ${values.at(20)} V`);
  assert.ok(values.at(-1) > 1.9 && values.at(-1) < 2.1,
    `20 us source ramp ended at ${values.at(-1)} V`);
  assert.ok(values.every((value, index) => index === 0 || value + 1e-8 >= values[index - 1]),
    'captured follower ramp must not be invented or reordered by the scope');
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { importLtspiceAsc } from '../src/importers/ltspice-asc.js';
import { parseLtspiceAsy } from '../src/importers/ltspice-asy.js';

const pinRows = (library, ref, x, y = 100, orientation = 'R0') => [
  `SYMBOL ${library} ${x} ${y} ${orientation}`,
  `SYMATTR InstName ${ref}`,
];

describe('broad common LTspice symbol pin contracts', () => {
  it('recovers exact-name native aliases and pin-only families without an ASY bundle', () => {
    const cases = [
      ['polcap', 'C1', [[16, 0], [16, 64]], 'native-alias'],
      ['ind2', 'L1', [[16, 16], [16, 96]], 'native-alias'],
      ['schottky', 'D1', [[16, 0], [16, 64]], 'native-alias'],
      ['zener', 'D2', [[16, 0], [16, 64]], 'native-alias'],
      ['LED', 'D3', [[16, 0], [16, 64]], 'native-alias'],
      ['varactor', 'D4', [[16, 0], [16, 64]], 'native-alias'],
      ['TVSdiode', 'D5', [[16, 0], [16, 64]], 'native-alias'],
      ['Misc\\EuropeanResistor', 'R2', [[16, 16], [16, 96]], 'native-alias'],
      ['Misc\\battery', 'V2', [[0, 16], [0, 96]], 'native-alias'],
      ['Misc\\signal', 'V3', [[0, 16], [0, 96]], 'native-alias'],
      ['Misc\\cell', 'V4', [[0, 0], [0, 64]], 'native-alias'],
      ['nmos', 'M1', [[48, 0], [0, 80], [48, 96]], 'pin-only'],
      ['nmos4', 'M2', [[48, 0], [0, 80], [48, 96], [48, 48]], 'pin-only'],
      ['pmos', 'M3', [[48, 0], [0, 80], [48, 96]], 'pin-only'],
      ['pmos4', 'M4', [[48, 0], [0, 80], [48, 96], [48, 48]], 'pin-only'],
      ['npn', 'Q1', [[64, 0], [0, 48], [64, 96]], 'pin-only'],
      ['pnp', 'Q2', [[64, 0], [0, 48], [64, 96]], 'pin-only'],
      ['e', 'E1', [[0, 16], [0, 96], [-48, 32], [-48, 80]], 'pin-only'],
      ['e2', 'E2', [[0, 16], [0, 96], [-48, 80], [-48, 32]], 'pin-only'],
      ['g', 'G1', [[0, 96], [0, 16], [-48, 32], [-48, 80]], 'pin-only'],
      ['g2', 'G2', [[0, 96], [0, 16], [-48, 80], [-48, 32]], 'pin-only'],
      ['Misc\\xtal', 'Y1', [[16, 0], [16, 64]], 'pin-only'],
      ['Misc\\jumper', 'J1', [[-32, 64], [32, 64]], 'pin-only'],
    ];
    const lines = ['Version 4.1', 'SHEET 1 5000 1000'];
    cases.forEach(([library, ref], index) => lines.push(...pinRows(library, ref, 200 * index + 100)));
    lines.push(...pinRows('sw', 'S1', 4800));
    const result = importLtspiceAsc(`${lines.join('\n')}\n`);

    assert.equal(result.sourceDocument.instances.length, cases.length + 1);
    cases.forEach(([,, expected, contract], index) => {
      const instance = result.sourceDocument.instances[index];
      assert.equal(instance.definitionStatus, 'builtin');
      assert.equal(instance.pinContract, contract);
      assert.deepEqual(instance.pins.map(pin => [pin.x, pin.y]), expected);
      assert.deepEqual(instance.pins.map(pin => pin.spiceOrder),
        expected.map((unused, pinIndex) => pinIndex + 1));
    });
    const unsupported = result.sourceDocument.instances.at(-1);
    assert.equal(unsupported.definitionStatus, 'missing');
    assert.deepEqual(unsupported.pins, []);
    assert.ok(result.sourceDocument.findings.some(finding =>
      finding.kind === 'missing-symbol-pin-definition' && finding.ref === 'S1'));
  });

  it('maps passive/source/diode aliases but keeps nonlinear model fields strict', () => {
    const source = `Version 4
SHEET 1 1200 800
SYMBOL polcap 100 100 R0
SYMATTR InstName C1
SYMATTR Value 2u
FLAG 116 100 C_A
FLAG 116 164 C_B
SYMBOL ind2 220 100 R0
SYMATTR InstName L1
SYMATTR Value 3m
FLAG 236 116 L_A
FLAG 236 196 L_B
SYMBOL Misc\\EuropeanResistor 340 100 R0
SYMATTR InstName R1
SYMATTR Value 4k
FLAG 356 116 R_A
FLAG 356 196 R_B
SYMBOL Misc\\battery 460 100 R0
SYMATTR InstName V1
SYMATTR Value 5
FLAG 460 116 V_P
FLAG 460 196 V_N
SYMBOL schottky 580 100 R0
SYMATTR InstName D1
SYMATTR Value DS
FLAG 596 100 D_A
FLAG 596 164 D_K
TEXT 8 500 Left 2 !.model DS D (IS=2e-9 N=1.1 RS=.2)
`;
    const result = importLtspiceAsc(source);
    assert.deepEqual(result.parts.map(part => [part.id, part.kind]), [
      ['C1', 'capacitor'], ['L1', 'inductor'], ['R1', 'resistor'],
      ['V1', 'vsource'], ['D1', 'diode'],
    ]);
    assert.equal(result.unmapped.length, 0);
    assert.equal(result.losses.length, 0);
    assert.equal(result.parts.find(part => part.id === 'D1').params.is, 2e-9);
    assert.ok(result.sourceDocument.electricalProjection.mappedInstances.every(item =>
      item.mapping.startsWith('native-alias:')));

    const nonlinear = importLtspiceAsc(source.replace('RS=.2)', 'RS=.2 BV=5)'));
    assert.ok(nonlinear.losses.some(loss => loss.kind === 'unsupported-diode-model'));
    assert.ok(nonlinear.parts.find(part => part.id === 'D1').analysisBlockers.length);
  });

  it('projects common three/four-terminal MOS, BJT and controlled-source symbols', () => {
    const lines = ['Version 4', 'SHEET 1 1600 900'];
    const add = (library, ref, value, x, pins, aliases) => {
      lines.push(...pinRows(library, ref, x), `SYMATTR Value ${value}`);
      pins.forEach(([px, py], index) => lines.push(`FLAG ${x + px} ${100 + py} ${aliases[index]}`));
    };
    add('nmos', 'M1', 'MN', 100, [[48, 0], [0, 80], [48, 96]], ['M1D', 'M1G', 'M1S']);
    add('nmos4', 'M2', 'MN', 300, [[48, 0], [0, 80], [48, 96], [48, 48]],
      ['M2D', 'M2G', 'M2S', 'M2S']);
    add('npn', 'Q1', 'QN', 500, [[64, 0], [0, 48], [64, 96]], ['Q1C', 'Q1B', 'Q1E']);
    add('pnp', 'Q2', 'QP', 700, [[64, 0], [0, 48], [64, 96]], ['Q2C', 'Q2B', 'Q2E']);
    add('e2', 'E1', '2.5', 900, [[0, 16], [0, 96], [-48, 80], [-48, 32]],
      ['EOP', 'EON', 'EIP', 'EIN']);
    add('g2', 'G1', '1m', 1100, [[0, 96], [0, 16], [-48, 80], [-48, 32]],
      ['GON', 'GOP', 'GIP', 'GIN']);
    lines.push('TEXT 8 600 Left 2 !.model MN NMOS (LEVEL=1 VTO=1 KP=1m LAMBDA=.01)',
      'TEXT 8 620 Left 2 !.model QN NPN (IS=1e-14 BF=120)',
      'TEXT 8 640 Left 2 !.model QP PNP (IS=2e-14 BF=80)');
    const result = importLtspiceAsc(`${lines.join('\n')}\n`);

    assert.deepEqual(result.parts.map(part => [part.id, part.kind]), [
      ['M1', 'nmos'], ['M2', 'nmos'], ['Q1', 'npn'], ['Q2', 'pnp'],
      ['E1', 'vcvs'], ['G1', 'vccs'],
    ]);
    assert.equal(result.unmapped.length, 0);
    assert.equal(result.losses.some(loss => loss.kind === 'unsupported-mosfet-bulk-terminal'), false);
    assert.match(result.sourceDocument.electricalProjection.mappedInstances[0].card,
      /^M1 __asc_pin_1 __asc_pin_2 __asc_pin_3 __asc_pin_3 MN$/);

    const splitBulk = importLtspiceAsc(`${lines.join('\n').replace(
      'FLAG 348 148 M2S', 'FLAG 348 148 M2B')}\n`);
    assert.ok(splitBulk.losses.some(loss => loss.kind === 'unsupported-mosfet-bulk-terminal'));
  });
});

describe('general caller-supplied ASY electrical projection', () => {
  const customR = `Version 4
SymbolType CELL
SYMATTR Prefix R
SYMATTR Value 4.7k
SYMATTR SpiceModel never-opened.lib
PIN 64 0 RIGHT 8
PINATTR PinName B
PINATTR SpiceOrder 2
PIN 0 0 LEFT 8
PINATTR PinName A
PINATTR SpiceOrder 1
`;

  it('uses explicit Prefix and contiguous SpiceOrder rather than inferring from shape', () => {
    const source = `Version 4
SHEET 1 500 300
SYMBOL lib/oddres 100 100 R0
SYMATTR InstName Rcustom
FLAG 100 100 LEFT
FLAG 164 100 RIGHT
`;
    const result = importLtspiceAsc(source, { symbols: { 'lib/oddres': customR } });
    assert.deepEqual(result.parts.map(part => [part.id, part.kind, part.params.ohms]),
      [['Rcustom', 'resistor', 4700]]);
    assert.equal(result.unmapped.length, 0);
    assert.equal(result.sourceSymbols[0].electricalStatus, 'mapped-with-analysis-blockers');
    assert.ok(result.losses.some(loss => loss.kind === 'unresolved-symbol-model-file'));
    assert.ok(result.sourceDocument.dependencies.some(dependency =>
      dependency.kind === 'spice-library' && dependency.name === 'never-opened.lib'
      && dependency.status === 'not-resolved'));

    const gapped = customR.replace('PINATTR SpiceOrder 2', 'PINATTR SpiceOrder 3');
    const refused = importLtspiceAsc(source, { symbols: { 'lib/oddres': gapped } });
    assert.deepEqual(refused.parts, []);
    assert.equal(refused.sourceDocument.instances[0].pins.length, 2,
      'document geometry remains useful even when card projection is refused');
    assert.match(refused.unmapped[0].libsource, /contiguous SpiceOrder 1\.\.2/);
  });

  it('keeps coupled-inductor directives explicit instead of simplifying their physics', () => {
    const source = `Version 4
SHEET 1 600 400
SYMBOL ind2 100 100 R0
SYMATTR InstName L1
SYMATTR Value 1m
FLAG 116 116 A
FLAG 116 196 B
SYMBOL ind2 300 100 R0
SYMATTR InstName L2
SYMATTR Value 2m
FLAG 316 116 C
FLAG 316 196 D
TEXT 8 300 Left 2 !K1 L1 L2 .98
`;
    const result = importLtspiceAsc(source);
    assert.deepEqual(result.parts.map(part => part.id), ['L1', 'L2']);
    assert.ok(result.losses.some(loss =>
      loss.kind === 'unsupported-asc-directive' && loss.source === 'K1 L1 L2 .98'));
    assert.equal(result.sourceDocument.electricalProjection.status,
      'complete-projection-with-analysis-blockers');
    assert.equal(result.sourceDocument.electricalProjection.numericStatus, 'blocked-import-semantics');
  });

  it('decodes BOM-less UTF-16 and applies repeated ASY attributes last-wins', () => {
    const repeated = customR.replace('SYMATTR Prefix R', 'SYMATTR Prefix X\nSYMATTR Prefix R')
      .replace('PINATTR SpiceOrder 2', 'PINATTR SpiceOrder 9\nPINATTR SpiceOrder 2');
    const bytes = new Uint8Array(Buffer.from(repeated, 'utf16le'));
    const document = parseLtspiceAsy(bytes);
    assert.equal(document.ok, true);
    assert.equal(document.encoding, 'utf-16le');
    assert.equal(document.attrs.prefix, 'R');
    assert.equal(document.attributeRecords.filter(record => record.name === 'Prefix').length, 2);
    assert.deepEqual(document.pins.map(pin => pin.spiceOrder), [2, 1]);
    assert.equal(document.findings.filter(finding => finding.kind === 'duplicate-asy-attribute').length, 2);
  });

  it('refuses non-CELL supplied definitions without falling back to built-in geometry', () => {
    const source = `Version 4
SHEET 1 500 300
SYMBOL res 100 100 R0
SYMATTR InstName R1
SYMATTR Value 1k
`;
    const block = customR.replace('SymbolType CELL', 'SymbolType BLOCK');
    const result = importLtspiceAsc(source, { symbols: { res: block } });
    assert.deepEqual(result.parts, []);
    assert.equal(result.sourceDocument.instances[0].definitionStatus, 'refused');
    assert.deepEqual(result.sourceDocument.instances[0].pins, []);
    assert.ok(result.sourceDocument.findings.some(finding =>
      finding.kind === 'refused-symbol-pin-definition'));
  });

  it('does not basename-map a path-qualified custom symbol as a standard primitive', () => {
    const result = importLtspiceAsc(`Version 4
SHEET 1 500 300
SYMBOL vendor/res 100 100 R0
SYMATTR InstName R1
SYMATTR Value 1k
`);
    assert.deepEqual(result.parts, []);
    assert.equal(result.sourceDocument.instances[0].definitionStatus, 'missing');
    assert.ok(result.sourceDocument.findings.some(finding =>
      finding.kind === 'missing-symbol-pin-definition'));
  });
});

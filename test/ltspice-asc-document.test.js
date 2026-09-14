import './_setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { importCircuit } from '../src/importers/index.js';
import { looksLikeLtspiceAsc } from '../src/importers/ltspice-asc.js';

const CUSTOM_ASY = `Version 4.1
SymbolType CELL
LINE Normal 0 0 16 0
PIN 0 0 LEFT 8
PINATTR PinName IN
PINATTR SpiceOrder 1
PIN 16 0 RIGHT 8
PINATTR PinName OUT
PINATTR SpiceOrder 2
PIN 0 16 BOTTOM 8
PINATTR PinName CTRL
PINATTR SpiceOrder 3
SYMATTR Prefix X
SYMATTR Value CUSTOM_BLOCK
FUTUREGRAPHIC retained verbatim
`;

const DOCUMENT = `Version 4.1
SHEET 1 400 300
SYMBOL Custom\\threepin 100 100 R0
WIRE 50 100 150 100
TEXT 8 8 Left 2 ; a visible comment
FLAG 50 100 HORIZONTAL
SYMATTR InstName X1
SYMATTR Value FIRST
SYMATTR Value SECOND
WIRE 80 80 80 120
FLAG 80 80 VERTICAL
WIRE 100 116 100 140
FLAG 100 140 CTRL_NET
SYMBOL Custom\\threepin 240 100 M90
WINDOW 0 0 0 Left 2
WIRE 240 100 240 160
SYMATTR InstName X1
SYMATTR Value CUSTOM_BLOCK
SYMBOL missing_symbol 320 100 R0
SYMATTR InstName U_MISSING
TEXT 8 240 Left 2 !.include ../must-not-open.lib
TEXT 8 260 Left 2 !.op
BOGUS future record retained
`;

const symbolOptions = {
  resolveSymbol: ({ normalizedName }) => normalizedName === 'custom/threepin'
    ? { text: CUSTOM_ASY, sha256: 'self-authored-custom-three-pin' } : null,
};

test('source document keeps Version 4.1, ordered records, ASY pins and honest gaps', () => {
  assert.equal(looksLikeLtspiceAsc(DOCUMENT), true);
  const result = importCircuit('ltspice-asc', DOCUMENT, symbolOptions);
  const document = result.sourceDocument;

  assert.equal(document.ok, true);
  assert.equal(document.version, '4.1');
  assert.equal(document.records.length, DOCUMENT.trim().split('\n').length);
  assert.equal(document.records.at(-1).source, 'BOGUS future record retained');
  assert.equal(document.stats.unknownRecords, 1);
  assert.equal(document.stats.symbols, 3);
  assert.equal(document.stats.symbolsWithPins, 2);
  assert.equal(document.stats.pinsRecovered, 6);
  assert.equal(document.instances[0].ref, 'X1', 'WIRE/TEXT/FLAG do not end the active SYMBOL');
  assert.deepEqual(document.instances[0].attributeRecords.map(record => record.value),
    ['X1', 'FIRST', 'SECOND'], 'duplicate attributes remain ordered');
  assert.equal(document.instances[0].attrs.value, 'SECOND', 'effective attribute is last-wins');
  assert.deepEqual(document.instances[0].pins.map(pin => pin.spiceOrder), [1, 2, 3]);
  assert.deepEqual(document.instances[1].pins.map(pin => pin.absolute),
    [[240, 100], [240, 116], [256, 100]], 'M90 uses the LTspice instance matrix');
  assert.equal(document.instances[2].definitionStatus, 'missing');
  assert.ok(document.findings.some(item => item.kind === 'missing-symbol-pin-definition'));
  assert.ok(document.findings.some(item => item.kind === 'duplicate-instance-name'));
  assert.ok(document.findings.some(item => item.kind === 'duplicate-symbol-attribute'));
  assert.ok(document.dependencies.some(item => item.kind === 'spice-library'
    && item.status === 'not-resolved'));
  assert.equal(document.dependencies.find(item => item.name === 'custom/threepin')
    .document.findings[0].kind, 'unsupported-asy-record',
  'an unknown drawing record is retained but does not erase valid pins');
});

test('source graph joins pins on segments but not a bare wire crossing', () => {
  const { sourceDocument: document } = importCircuit('ltspice-asc', DOCUMENT, symbolOptions);
  const first = document.instances[0];
  const horizontal = document.nets.find(net => net.aliases.includes('HORIZONTAL'));
  const vertical = document.nets.find(net => net.aliases.includes('VERTICAL'));
  const control = document.nets.find(net => net.aliases.includes('CTRL_NET'));

  assert.deepEqual(horizontal.terminals.map(pin => pin.spiceOrder).sort(), [1, 2]);
  assert.equal(vertical.terminals.length, 0, 'crossing interiors do not imply a junction');
  assert.deepEqual(control.terminals.map(pin => pin.spiceOrder), [3]);
  assert.equal(first.pins[0].netId, first.pins[1].netId);
  assert.notEqual(vertical.id, horizontal.id);
});

test('byte input detects and decodes UTF-16LE ASC documents', () => {
  const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(DOCUMENT, 'utf16le')]);
  assert.equal(looksLikeLtspiceAsc(bytes), true);
  const { sourceDocument } = importCircuit('ltspice-asc', bytes, symbolOptions);
  assert.equal(sourceDocument.encoding, 'utf-16le');
  assert.equal(sourceDocument.version, '4.1');
  assert.equal(sourceDocument.stats.pinsRecovered, 6);
});

test('legacy absolute symbol libraries with escaped spaces remain document instances only', () => {
  const source = `Version 4
SHEET 1 880 680
SYMBOL C:\\PROGRAM\\ FILES\\LTC\\SWCADIII\\lib\\sym\\Digital\\and 100 200 R0
SYMATTR InstName A1
`;
  const { sourceDocument, parts, unmapped } = importCircuit('ltspice-asc', source);
  assert.equal(sourceDocument.records.length, 4);
  assert.equal(sourceDocument.instances.length, 1);
  assert.equal(sourceDocument.instances[0].library,
    'C:\\PROGRAM\\ FILES\\LTC\\SWCADIII\\lib\\sym\\Digital\\and');
  assert.equal(sourceDocument.instances[0].definitionStatus, 'refused');
  assert.equal(parts.length, 0);
  assert.equal(unmapped.length, 1);
});

const asy = (prefix, count) => `Version 4
SymbolType CELL
${Array.from({ length: count }, (_, index) => `PIN 0 ${index * 16} LEFT 8
PINATTR PinName P${index + 1}
PINATTR SpiceOrder ${index + 1}`).join('\n')}
SYMATTR Prefix ${prefix}
`;

test('projects one R/C/L/D/Q/M/E/G/X document through shared native/SPICE semantics', () => {
  const symbols = new Map([
    ['q_device', asy('Q', 3)], ['m_device', asy('M', 4)],
    ['e_device', asy('E', 4)], ['g_device', asy('G', 4)], ['x_device', asy('X', 2)],
  ]);
  const records = ['Version 4', 'SHEET 1 1000 700'];
  const add = (library, ref, value, x, count, aliases = []) => {
    records.push(`SYMBOL ${library} ${x} 100 R0`, `SYMATTR InstName ${ref}`, `SYMATTR Value ${value}`);
    for (let index = 0; index < count; index++) {
      records.push(`FLAG ${x} ${100 + index * 16} ${aliases[index] || `${ref}_P${index + 1}`}`);
    }
  };
  add('q_device', 'Q1', 'QMOD', 100, 3);
  add('m_device', 'M1', 'MMOD', 200, 4, ['MD', 'MG', 'MS', 'MS']);
  add('e_device', 'E1', '2.5', 300, 4);
  add('g_device', 'G1', '1m', 400, 4);
  add('x_device', 'X1', 'CHILD', 500, 2);
  records.push(
    'SYMBOL res 600 100 R0', 'SYMATTR InstName R1', 'SYMATTR Value 2k',
    'FLAG 616 116 R_A', 'FLAG 616 196 R_B',
    'SYMBOL cap 700 100 R0', 'SYMATTR InstName C1', 'SYMATTR Value 2u',
    'FLAG 716 100 C_A', 'FLAG 716 164 C_B',
    'SYMBOL ind 800 100 R0', 'SYMATTR InstName L1', 'SYMATTR Value 3m',
    'FLAG 816 116 L_A', 'FLAG 816 196 L_B',
    'SYMBOL diode 900 100 R0', 'SYMATTR InstName D1', 'SYMATTR Value DMOD',
    'FLAG 916 100 D_A', 'FLAG 916 164 D_K',
  );
  records.push(
    'TEXT 8 480 Left 2 !.model DMOD D (IS=1e-14 N=1 RS=0.1)',
    'TEXT 8 500 Left 2 !.model QMOD NPN (IS=1e-14 BF=150)',
    'TEXT 8 520 Left 2 !.model MMOD NMOS (LEVEL=1 VTO=1 KP=1m LAMBDA=0.01)',
    'TEXT 8 540 Left 2 !.subckt CHILD P N',
    'TEXT 8 560 Left 2 !RIN P N 1k',
    'TEXT 8 580 Left 2 !.ends CHILD',
  );

  const result = importCircuit('ltspice-asc', `${records.join('\n')}\n`, { symbols });
  const kinds = result.parts.map(part => part.kind);
  assert.deepEqual(kinds.sort(),
    ['resistor', 'capacitor', 'inductor', 'diode', 'nmos', 'npn', 'resistor', 'vccs', 'vcvs'].sort());
  assert.equal(result.unmapped.length, 0);
  assert.equal(result.sourceDocument.electricalProjection.mappedInstances.length, 5);
  assert.deepEqual(result.sourceDocument.electricalProjection.mappedInstances
    .map(item => item.prefix), ['Q', 'M', 'E', 'G', 'X']);
  assert.equal(result.sourceDocument.stats.pinsRecovered, 25);
  assert.ok(result.parts.find(part => part.id === 'Q1').params.is > 0);
  assert.equal(result.parts.find(part => part.id === 'M1').params.vth, 1);
  assert.equal(result.losses.some(loss => loss.kind === 'unsupported-mosfet-bulk-terminal'), false,
    'a source/bulk named-net tie is representable by the native three-terminal MOSFET');
  assert.ok(result.parts.some(part => part.id === 'X1.RIN'));
});

test('native projection keeps unsupported Q/M physics as blockers instead of defaults', () => {
  const symbols = new Map([['q_device', asy('Q', 3)], ['m_device', asy('M', 4)]]);
  const source = `Version 4
SHEET 1 500 300
SYMBOL q_device 100 100 R0
SYMATTR InstName Q1
SYMATTR Value UNDECLARED
SYMBOL m_device 200 100 R0
SYMATTR InstName M1
SYMATTR Value MMOD
FLAG 200 132 SOURCE
FLAG 200 148 BULK
TEXT 8 250 Left 2 !.model MMOD NMOS (LEVEL=3 VTO=1 KP=1m CGSO=2p)
`;
  const result = importCircuit('ltspice-asc', source, { symbols });
  assert.ok(result.parts.some(part => part.id === 'Q1'));
  assert.ok(result.parts.some(part => part.id === 'M1'));
  assert.ok(result.losses.some(loss => loss.kind === 'unsupported-or-missing-device-model'));
  assert.ok(result.losses.some(loss => loss.kind === 'unsupported-device-model-fields'));
  assert.ok(result.losses.some(loss => loss.kind === 'unsupported-mosfet-bulk-terminal'));
  assert.ok(result.parts.find(part => part.id === 'Q1').analysisBlockers.length);
  assert.ok(result.parts.find(part => part.id === 'M1').analysisBlockers.length);
});

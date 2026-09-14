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


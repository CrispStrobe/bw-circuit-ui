import './_setup.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectFormat } from '../src/importers/detect.js';
import { getSupportedFormats, importCircuit } from '../src/importers/index.js';
import { placeLtspicePin } from '../src/importers/ltspice-asc.js';
import { Circuit } from '../src/model/circuit.js';

const DIVIDER = `Version 4
SHEET 1 160 160
WIRE 0 16 96 16
WIRE 0 96 96 96
FLAG 0 96 0
SYMBOL voltage 0 0 R0
SYMATTR InstName V1
SYMATTR Value 6V
SYMBOL res 80 0 R0
SYMATTR InstName R1
SYMATTR Value 1k
TEXT 120 120 Left 2 !.op
`;

describe('LTspice ASC bounded importer', () => {
  it('uses the verified standard-symbol pin coordinates in all rotations', () => {
    const at = orientation => ({ x: 10, y: 20, orientation });
    assert.deepEqual(placeLtspicePin(16, 96, at('R0')), [26, 116]);
    assert.deepEqual(placeLtspicePin(16, 96, at('R90')), [-86, 36]);
    assert.deepEqual(placeLtspicePin(16, 96, at('R180')), [-6, -76]);
    assert.deepEqual(placeLtspicePin(16, 96, at('R270')), [106, 4]);
    assert.equal(placeLtspicePin(16, 96, at('M0')), null);
  });

  it('detects and imports a non-vacuous static R/V schematic', () => {
    assert.equal(detectFormat(DIVIDER, 'wrong.txt'), 'ltspice-asc');
    assert.ok(getSupportedFormats().includes('ltspice-asc'));
    const result = importCircuit('ltspice-asc', DIVIDER);
    assert.equal(result.parts.length, 3);
    assert.equal(result.wires.length, 3);
    assert.deepEqual(result.unmapped, []);
    assert.deepEqual(result.losses, []);
    assert.deepEqual(result.analyses, ['.op']);
    assert.equal(result.parts.find(part => part.id === 'V1').params.volts, 6);
    assert.equal(result.parts.find(part => part.id === 'R1').params.ohms, 1000);
    assert.ok(result.wires.some(wire => wire.from === 'V1' && wire.fromTerminal === 'pos'
      && wire.to === 'R1' && wire.toTerminal === 'a'), 'positive source pin must reach resistor a');
    const circuit = Circuit.fromJSON({ vcc: 5, parts: result.parts, wires: result.wires });
    assert.equal(circuit.netlistError, null);
    circuit.setPower(true);
    assert.ok(Math.abs(Math.abs(circuit.branchCurrent('R1', 'a')) - 6e-3) < 1e-10,
      `6 V across 1 kOhm must be 6 mA, got ${circuit.branchCurrent('R1', 'a')}`);
    assert.match(result.warnings.at(-1), /^geometry: 4\/4/);
  });

  it('retains Value2/model semantics as explicit losses instead of trusting Value alone', () => {
    const text = `Version 4
SHEET 1 160 160
SYMBOL voltage 0 0 R0
SYMATTR InstName V1
SYMATTR Value 2.5
SYMATTR Value2 AC 1
SYMATTR ModelFile external.lib
`;
    const result = importCircuit('ltspice-asc', text);
    assert.equal(result.parts[0].params.volts, 2.5);
    assert.deepEqual(result.losses.map(loss => loss.kind),
      ['unsupported-symbol-attribute', 'unsupported-symbol-attribute']);
    assert.ok(result.losses.some(loss => /value2/.test(loss.reason)));
    assert.ok(result.losses.some(loss => /modelfile/.test(loss.reason)));
  });

  it('keeps SYMATTR records attached across consecutive WINDOW display records', () => {
    const text = `Version 4
SHEET 1 200 200
WIRE 16 96 16 120
FLAG 16 120 0
SYMBOL res 0 0 R0
WINDOW 0 32 56 VTop 2
WINDOW 3 32 96 VBottom 2
SYMATTR InstName R1
WINDOW 123 0 0 Left 0
SYMATTR Value 2.2k
SYMATTR VendorNote retained
SYMBOL res 80 0 R0
SYMATTR InstName R2
SYMATTR Value 1k
TEXT 0 160 Left 2 !.op
`;
    const result = importCircuit('ltspice-asc', text);
    assert.deepEqual(result.unmapped, []);
    assert.equal(result.parts.find(part => part.id === 'R1').params.ohms, 2200);
    assert.equal(result.parts.find(part => part.id === 'R2').params.ohms, 1000,
      'the following SYMBOL still starts a fresh attribute record');
    assert.equal(result.ignored.filter(item => /^WINDOW\b/.test(item.source)).length, 3);
    assert.deepEqual(result.losses.map(loss => loss.source), ['SYMATTR vendornote retained']);
  });

  it('merges separated coordinates carrying the same named net flag', () => {
    const text = `Version 4
SHEET 1 240 160
FLAG 0 16 rail
FLAG 160 16 RAIL
SYMBOL voltage 0 0 R0
SYMATTR InstName V1
SYMATTR Value -3.25
SYMBOL res 144 0 R0
SYMATTR InstName R1
SYMATTR Value 2.2k
`;
    const result = importCircuit('ltspice-asc', text);
    assert.deepEqual(result.unmapped, []);
    assert.deepEqual(result.losses, []);
    assert.ok(result.wires.some(wire => wire.from === 'V1' && wire.fromTerminal === 'pos'
      && wire.to === 'R1' && wire.toTerminal === 'a'));
    assert.equal(result.parts.find(part => part.id === 'V1').params.volts, -3.25);
    assert.equal(result.parts.find(part => part.id === 'R1').params.ohms, 2200);
  });

  it('does not hide unknown symbols, dynamic directives, or unsupported mirrors', () => {
    const text = `Version 4
SHEET 1 160 160
SYMBOL Opamps\\UniversalOpAmp 0 0 R0
SYMATTR InstName U1
SYMATTR Value level1
SYMBOL res 80 0 M0
SYMATTR InstName R1
SYMATTR Value 1k
TEXT 0 120 Left 2 !.tran 1m
`;
    const result = importCircuit('ltspice-asc', text);
    assert.equal(result.unmapped.length, 2);
    assert.equal(result.losses.length, 1);
    assert.equal(result.losses[0].kind, 'unsupported-asc-directive');
    assert.equal(result.parts.length, 0);
  });

  it('refuses an extension-only non-ASC file without manufacturing parts', () => {
    assert.equal(detectFormat('not a schematic', 'bad.asc'), 'ltspice-asc');
    const result = importCircuit('ltspice-asc', 'not a schematic');
    assert.equal(result.parts.length, 0);
    assert.match(result.warnings[0], /Not an LTspice/);
  });
});

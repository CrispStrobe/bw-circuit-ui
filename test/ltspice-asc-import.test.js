import './_setup.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectFormat } from '../src/importers/detect.js';
import { getSupportedFormats, importCircuit, parseLtspiceAsy } from '../src/importers/index.js';
import { placeLtspicePin } from '../src/importers/ltspice-asc.js';
import { Circuit } from '../src/model/circuit.js';
import { runSourceAnalyses } from '../src/model/source-analysis.js';

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
  it('resolves only parameter definitions authored inside the ASC', () => {
    const withDefinition = importCircuit('ltspice-asc', `Version 4
SHEET 1 160 160
WIRE 16 16 96 16
FLAG 96 16 0
SYMBOL res 0 0 R0
SYMATTR InstName R1
SYMATTR Value {base/2}
TEXT 0 120 Left 2 !.param base=2k
TEXT 0 140 Left 2 !.op
`);
    assert.equal(withDefinition.parts.find(p => p.id === 'R1').params.ohms, 1000);
    assert.deepEqual(withDefinition.losses, []);

    const absent = importCircuit('ltspice-asc', `Version 4
SHEET 1 160 160
WIRE 16 16 96 16
FLAG 96 16 0
SYMBOL res 0 0 R0
SYMATTR InstName R1
SYMATTR Value {paired_netlist_only}
TEXT 0 140 Left 2 !.op
`);
    const part = absent.parts.find(p => p.id === 'R1');
    assert.equal('ohms' in part.params, false);
    assert.equal(part.analysisBlockers.length, 1);
    assert.ok(absent.losses.some(loss => loss.kind === 'unsupported-or-missing-static-value'));
    assert.equal(Circuit.fromJSON({ parts: absent.parts, wires: absent.wires }).analysisBlockers.length, 1);
  });

  it('retains unsafe parameter definitions and functions as semantic losses', () => {
    const result = importCircuit('ltspice-asc', `Version 4
SHEET 1 160 160
WIRE 16 16 96 16
FLAG 96 16 0
SYMBOL res 0 0 R0
SYMATTR InstName R1
SYMATTR Value {a}
TEXT 0 100 Left 2 !.param a=b b=a
TEXT 0 120 Left 2 !.func f(x) {x}
`);
    assert.ok(result.losses.some(loss => loss.kind === 'unsupported-constant-parameter'));
    assert.ok(result.losses.some(loss => loss.kind === 'unsupported-constant-function'));
  });

  it('uses the verified standard-symbol pin coordinates in rotations and mirrors', () => {
    const at = orientation => ({ x: 10, y: 20, orientation });
    assert.deepEqual(placeLtspicePin(16, 96, at('R0')), [26, 116]);
    assert.deepEqual(placeLtspicePin(16, 96, at('R90')), [-86, 36]);
    assert.deepEqual(placeLtspicePin(16, 96, at('R180')), [-6, -76]);
    assert.deepEqual(placeLtspicePin(16, 96, at('R270')), [106, 4]);
    assert.deepEqual(placeLtspicePin(16, 96, at('M0')), [-6, 116]);
    assert.deepEqual(placeLtspicePin(16, 96, at('M90')), [106, 36]);
    assert.deepEqual(placeLtspicePin(16, 96, at('M180')), [26, -76]);
    assert.deepEqual(placeLtspicePin(16, 96, at('M270')), [-86, 4]);
    assert.equal(placeLtspicePin(16, 96, at('M45')), null);
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

  it('does not hide unknown symbols, source analyses, or unsupported orientations', () => {
    const text = `Version 4
SHEET 1 160 160
SYMBOL Opamps\\UniversalOpAmp 0 0 R0
SYMATTR InstName U1
SYMATTR Value level1
SYMBOL res 80 0 M45
SYMATTR InstName R1
SYMATTR Value 1k
TEXT 0 120 Left 2 !.tran 1m
`;
    const result = importCircuit('ltspice-asc', text);
    assert.equal(result.unmapped.length, 2);
    assert.deepEqual(result.losses, []);
    assert.deepEqual(result.analyses, ['.tran 1m']);
    assert.deepEqual(result.sourceDirectives, [
      { source: '.tran 1m', kind: 'analysis', handling: 'source-analysis' },
    ]);
    assert.equal(result.parts.length, 0);
  });

  it('refuses an extension-only non-ASC file without manufacturing parts', () => {
    assert.equal(detectFormat('not a schematic', 'bad.asc'), 'ltspice-asc');
    const result = importCircuit('ltspice-asc', 'not a schematic');
    assert.equal(result.parts.length, 0);
    assert.match(result.warnings[0], /Not an LTspice/);
  });
});

const RES_ASY = `Version 4
SymbolType CELL
LINE Normal 0 0 80 0
WINDOW 0 40 -16 Bottom 2
SYMATTR Prefix R
SYMATTR Value 1k
PIN 80 0 RIGHT 8
PINATTR PinName B
PINATTR SpiceOrder 2
PIN 0 0 LEFT 8
PINATTR PinName A
PINATTR SpiceOrder 1
`;

const ASC_WITH_INSTANCE_VALUE = `Version 4
SHEET 1 880 680
SYMBOL res 100 100 R0
SYMATTR InstName R1
SYMATTR Value 2k
FLAG 100 100 IN
FLAG 180 100 0
TEXT 0 0 Left 2 !.op
`;

describe('caller-supplied LTspice ASY documents', () => {
  it('parses attributes, geometry, and explicit SpiceOrder without reordering source records', () => {
    const parsed = parseLtspiceAsy(RES_ASY);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.version, 4);
    assert.equal(parsed.symbolType, 'CELL');
    assert.deepEqual(parsed.attrs, { prefix: 'R', value: '1k' });
    assert.deepEqual(parsed.pins.map(pin => [pin.pinName, pin.spiceOrder, pin.x, pin.y]), [
      ['B', 2, 80, 0],
      ['A', 1, 0, 0],
    ]);
    assert.deepEqual(parsed.geometry.map(record => record.type), ['LINE', 'WINDOW']);
  });

  it('uses caller text for verified standard pins and lets instance attributes override ASY defaults', () => {
    const imported = importCircuit('ltspice-asc', ASC_WITH_INSTANCE_VALUE, {
      symbols: new Map([['res', { text: RES_ASY, sha256: 'self-authored-res-v1' }]]),
    });
    assert.deepEqual(imported.unmapped, []);
    assert.deepEqual(imported.losses, []);
    const resistor = imported.parts.find(part => part.id === 'R1');
    assert.equal(resistor.kind, 'resistor');
    assert.equal(resistor.params.ohms, 2000, 'instance Value wins over the ASY default 1k');
    assert.equal(imported.wires.length, 1,
      'SpiceOrder 1 at (0,0) and order 2 at (80,0) drive the supplied pin placement');
    assert.deepEqual(imported.netNames.map(net => [net.name,
      net.terminals.map(terminal => `${terminal.partId}.${terminal.terminal}`).sort()]), [
      ['IN', ['R1.a']],
      ['0', ['GND1.gnd', 'R1.b']],
    ]);
    assert.equal(imported.sourceSymbols.length, 1);
    assert.deepEqual({
      library: imported.sourceSymbols[0].library,
      status: imported.sourceSymbols[0].status,
      declaredSha256: imported.sourceSymbols[0].declaredSha256,
    }, { library: 'res', status: 'parsed', declaredSha256: 'self-authored-res-v1' });
    assert.equal(imported.sourceSymbols[0].document.geometry.length, 2);

    const withDefault = importCircuit('ltspice-asc',
      ASC_WITH_INSTANCE_VALUE.replace('SYMATTR Value 2k\n', ''),
      { symbols: { res: RES_ASY } });
    assert.equal(withDefault.parts.find(part => part.id === 'R1').params.ohms, 1000,
      'the ASY Value is used only when the instance does not author one');
  });

  it('persists inherited ASY semantic losses on the mapped part so numeric refusal cannot wash out', () => {
    const withSpiceLine = RES_ASY.replace(
      'SYMATTR Value 1k',
      'SYMATTR Value 1k\nSYMATTR SpiceLine Rser=2');
    const imported = importCircuit('ltspice-asc', ASC_WITH_INSTANCE_VALUE, {
      symbols: { res: withSpiceLine },
    });
    const resistor = imported.parts.find(part => part.id === 'R1');
    assert.equal(resistor.kind, 'resistor');
    assert.ok(imported.losses.some(loss =>
      loss.kind === 'unsupported-symbol-attribute' && /ASY SYMATTR spiceline Rser=2/.test(loss.source)));
    assert.ok(resistor.analysisBlockers.some(blocker =>
      blocker.kind === 'unsupported-symbol-attribute' && /spiceline/.test(blocker.source)));

    // A consumer is allowed to retain only electrical parts and wires. The
    // per-part blocker must still make that saved circuit ineligible.
    const circuit = Circuit.fromJSON({ parts: imported.parts, wires: imported.wires });
    assert.ok(circuit.analysisBlockers.some(blocker =>
      blocker.kind === 'unsupported-symbol-attribute'));
    assert.throws(() => circuit.operatingPoint(), /persisted import finding/);

    const reloaded = Circuit.fromJSON(JSON.parse(JSON.stringify(circuit.toJSON())));
    assert.ok(reloaded.analysisBlockers.some(blocker =>
      blocker.kind === 'unsupported-symbol-attribute'));
    assert.throws(() => reloaded.operatingPoint(), /persisted import finding/);
  });

  it('uses a synchronous caller resolver once and preserves unknown document metadata without a fake part', () => {
    const customAsy = `Version 4
SymbolType CELL
RECTANGLE Normal 0 0 64 64
SYMATTR Prefix X
SYMATTR Value CUSTOM
SYMATTR Description Self-authored three pin symbol
PIN 0 0 LEFT 8
PINATTR PinName IN
PINATTR SpiceOrder 1
PIN 64 0 RIGHT 8
PINATTR PinName OUT
PINATTR SpiceOrder 2
PIN 32 64 BOTTOM 8
PINATTR PinName COM
PINATTR SpiceOrder 3
`;
    const asc = `Version 4
SHEET 1 880 680
SYMBOL lib/custom 10 20 R0
SYMATTR InstName U1
SYMBOL lib/custom 100 20 M90
SYMATTR InstName U2
SYMATTR Value INSTANCE
`;
    const requests = [];
    const imported = importCircuit('ltspice-asc', asc, {
      resolveSymbol(request) {
        requests.push(request);
        return { text: customAsy, sha256: 'self-authored-custom-v1' };
      },
    });
    assert.deepEqual(requests, [{ name: 'lib/custom', normalizedName: 'lib/custom' }]);
    assert.deepEqual(imported.parts, [], 'document support must not invent a native solver kind');
    assert.equal(imported.unmapped.length, 2);
    assert.equal(imported.unmapped[0].sourceSymbol, 'lib/custom');
    assert.equal(imported.unmapped[0].value, 'CUSTOM');
    assert.equal(imported.unmapped[1].value, 'INSTANCE');
    assert.equal(imported.sourceSymbols[0].document.pins.length, 3);
    assert.equal(imported.sourceSymbols[0].electricalStatus, 'unmapped-no-native-kind');
    assert.equal(imported.sourceSymbols[0].document.attrs.description,
      'Self-authored three pin symbol');
    assert.deepEqual(imported.sourceSymbols[0].instances, [
      { ref: 'U1', x: 10, y: 20, orientation: 'R0', attrs: { instname: 'U1' }, line: 3 },
      { ref: 'U2', x: 100, y: 20, orientation: 'M90',
        attrs: { instname: 'U2', value: 'INSTANCE' }, line: 5 },
    ]);
  });

  it('refuses unsafe names, malformed electrical pin order, and bounded-parser overflow', () => {
    let resolverCalls = 0;
    const unsafe = importCircuit('ltspice-asc', `Version 4
SHEET 1 880 680
SYMBOL ../res 0 0 R0
SYMATTR InstName R1
SYMATTR Value 1k
`, { resolveSymbol() { resolverCalls++; return RES_ASY; } });
    assert.equal(resolverCalls, 0, 'an unsafe name is never handed to caller code');
    assert.equal(unsafe.parts.length, 0);
    assert.match(unsafe.unmapped[0].libsource, /unsafe symbol library name/);

    const duplicateOrder = RES_ASY.replace('PINATTR SpiceOrder 2', 'PINATTR SpiceOrder 1');
    const malformed = importCircuit('ltspice-asc', ASC_WITH_INSTANCE_VALUE, {
      symbols: { res: duplicateOrder },
    });
    assert.equal(malformed.parts.filter(part => part.kind !== 'gnd').length, 0);
    assert.match(malformed.unmapped[0].libsource, /not structurally valid/);
    assert.equal(malformed.sourceSymbols[0].status, 'refused');
    assert.ok(malformed.sourceSymbols[0].document.findings.some(
      item => item.kind === 'duplicate-asy-spice-order'));

    const wrongInstancePrefix = importCircuit('ltspice-asc',
      ASC_WITH_INSTANCE_VALUE.replace('SYMATTR Value 2k', 'SYMATTR Value 2k\nSYMATTR Prefix X'),
      { symbols: { res: RES_ASY } });
    assert.equal(wrongInstancePrefix.parts.filter(part => part.kind !== 'gnd').length, 0);
    assert.match(wrongInstancePrefix.unmapped[0].libsource, /effective Prefix must be R/);

    const bounded = parseLtspiceAsy(RES_ASY, { limits: { maxPins: 1 } });
    assert.equal(bounded.ok, false);
    assert.ok(bounded.findings.some(item => item.kind === 'asy-limit-exceeded'));

    const unsafeNumber = parseLtspiceAsy(
      RES_ASY.replace('PINATTR SpiceOrder 2', 'PINATTR SpiceOrder 999999999999999999999'));
    assert.equal(unsafeNumber.ok, false);
    assert.ok(unsafeNumber.findings.some(item => item.kind === 'invalid-asy-spice-order'));
  });
});

const PAIRED_ASC = `Version 4
SHEET 1 240 180
FLAG 96 100 0
FLAG 0 0 0
FLAG 16 100 VP
FLAG 80 0 OUT
SYMBOL voltage 0 100 M90
SYMATTR InstName V1
SYMATTR Value 7
SYMBOL res 112 84 R90
SYMATTR InstName R2
SYMATTR Value {load}
SYMBOL current 80 0 M270
SYMATTR InstName I1
SYMATTR Value 2m
SYMBOL res 96 16 M270
SYMATTR InstName R1
SYMATTR Value 1k
TEXT 160 120 Left 2 !.param load=2k
TEXT 160 140 Left 2 !.backanno
TEXT 160 160 Left 2 !.op
`;

const REORDERED_ASC = `Version 4
SHEET 1 240 180
FLAG 80 0 out
FLAG 0 0 0
FLAG 16 100 vp
FLAG 96 100 0
SYMBOL current 80 0 M270
SYMATTR InstName I1
SYMATTR Value 2m
SYMBOL res 96 16 M270
SYMATTR InstName R1
SYMATTR Value 1k
SYMBOL voltage 0 100 M90
SYMATTR InstName V1
SYMATTR Value 7
SYMBOL res 112 84 R90
SYMATTR InstName R2
SYMATTR Value 2k
TEXT 160 160 Left 2 !.op
`;

const PAIRED_SPICE = `paired ASC source-analysis contract
V1 VP 0 7
R2 0 VP 2k
I1 OUT 0 2m
R1 OUT 0 1k
.op
.end
`;

function namedPartitions(imported) {
  return (imported.netNames || []).map(net => ({
    name: String(net.name).toLowerCase(),
    terminals: net.terminals.map(item => `${item.partId}.${item.terminal}`).sort(),
  })).sort((a, b) => a.name.localeCompare(b.name));
}

describe('LTspice ASC source-analysis contract', () => {
  it('matches a paired SPICE graph and signed OP through rotated/mirrored standard symbols', () => {
    const asc = importCircuit('ltspice-asc', PAIRED_ASC);
    const spice = importCircuit('spice', PAIRED_SPICE);
    assert.deepEqual(asc.unmapped, []);
    assert.deepEqual(asc.losses, []);
    assert.deepEqual(asc.analyses, ['.op']);
    assert.deepEqual(asc.sourceDirectives, [
      { source: '.param load=2k', kind: 'parameter-definition', handling: 'constant-expression' },
      { source: '.backanno', kind: 'metadata', handling: 'retained-ignored' },
      { source: '.op', kind: 'analysis', handling: 'source-analysis' },
    ]);
    assert.deepEqual(namedPartitions(asc), namedPartitions(spice));

    const ascOp = runSourceAnalyses(asc, { format: 'ltspice-asc' })[0];
    const spiceOp = runSourceAnalyses(spice, { format: 'spice' })[0];
    assert.equal(ascOp.status, 'pass');
    assert.equal(spiceOp.status, 'pass');
    assert.deepEqual(ascOp.topology, spiceOp.topology);
    assert.deepEqual(ascOp.topology, [
      { kind: 'V', nodes: ['n0', 'gnd'], sourceId: 's0' },
      { kind: 'R', nodes: ['gnd', 'n0'] },
      { kind: 'I', nodes: ['n1', 'gnd'], sourceId: 's1' },
      { kind: 'R', nodes: ['n1', 'gnd'] },
    ]);
    for (let index = 0; index < ascOp.observables.nodes.length; index++) {
      assert.ok(Math.abs(ascOp.observables.nodes[index].voltage
        - spiceOp.observables.nodes[index].voltage) < 1e-12);
    }
    assert.ok(Math.abs(ascOp.observables.nodes.find(node => node.id === 'n1').voltage + 2) < 1e-8);
    assert.deepEqual(ascOp.observables.unavailableSourceCurrents, ['s1']);
    assert.ok(Math.abs(ascOp.observables.sourceCurrents[0].current + 3.5e-3) < 1e-8);
  });

  it('preserves named terminal partitions independently of record order and label case', () => {
    const first = importCircuit('ltspice-asc', PAIRED_ASC);
    const reordered = importCircuit('ltspice-asc', REORDERED_ASC);
    assert.deepEqual(namedPartitions(reordered), namedPartitions(first));
    const firstTopology = runSourceAnalyses(first, { format: 'ltspice-asc' })[0].topology;
    const reorderedTopology = runSourceAnalyses(reordered, { format: 'ltspice-asc' })[0].topology;
    assert.notDeepEqual(reorderedTopology, firstTopology,
      'source-order topology ids are not a substitute for order-independent structural comparison');
  });

  it('never assigns an anonymous net a case-folded authored label', () => {
    const imported = importCircuit('ltspice-asc', `Version 4
SHEET 1 400 160
WIRE 0 16 96 16
WIRE 0 96 96 96
WIRE 200 16 296 16
WIRE 200 96 296 96
FLAG 0 16 $asc$0
FLAG 0 96 0
FLAG 200 96 0
SYMBOL voltage 0 0 R0
SYMATTR InstName V1
SYMATTR Value 3
SYMBOL res 80 0 R0
SYMATTR InstName R1
SYMATTR Value 1k
SYMBOL voltage 200 0 R0
SYMATTR InstName V2
SYMATTR Value 4
SYMBOL res 280 0 R0
SYMATTR InstName R2
SYMATTR Value 2k
TEXT 320 120 Left 2 !.op
`);
    const names = imported.netNames.map(net => net.name.toLowerCase());
    assert.equal(new Set(names).size, names.length);
    assert.ok(names.includes('$asc$0'));
    assert.ok(names.includes('$asc$1'));
    const run = runSourceAnalyses(imported, { format: 'ltspice-asc' })[0];
    assert.equal(run.status, 'pass');
    assert.equal(run.observables.nodes.length, 2);
  });

  it('separates true analyses while retaining unsupported directive semantics as losses', () => {
    const imported = importCircuit('ltspice-asc', `${PAIRED_ASC}
TEXT 0 200 Left 2 !.ac dec 10 1 1k
TEXT 0 220 Left 2 !.tran 1u 10u UIC
TEXT 0 240 Left 2 !.dc V1 0 7 1
TEXT 0 260 Left 2 !.model DSELF D(IS=1e-12)
TEXT 0 280 Left 2 !.temp 50
`);
    assert.deepEqual(imported.analyses, ['.op', '.ac dec 10 1 1k', '.tran 1u 10u UIC', '.dc V1 0 7 1']);
    assert.equal(imported.sourceDirectives.filter(item => item.kind === 'analysis').length, 4);
    assert.deepEqual(imported.losses.map(loss => loss.source), [
      '.model DSELF D(IS=1e-12)', '.temp 50',
    ]);
    const runs = runSourceAnalyses(imported, { format: 'ltspice-asc' });
    assert.equal(runs.length, 4);
    assert.ok(runs.every(run => run.classification === 'import-fidelity' && run.status === 'refused'));
  });
});

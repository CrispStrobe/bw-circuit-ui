import './_setup.js';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { detectFormat } from '../src/importers/detect.js';
import { getSupportedFormats, importCircuit, parseLtspiceAsy } from '../src/importers/index.js';
import { placeLtspicePin } from '../src/importers/ltspice-asc.js';
import { Circuit } from '../src/model/circuit.js';
import { extractNetlist } from '../src/model/netlist.js';
import { toSpice } from '../src/model/exporters/spice.js';
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
    assert.equal(imported.sourceSymbols[0].electricalStatus, 'refused-electrical-projection');
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

const IND_ASY = `Version 4
SymbolType CELL
SYMATTR Prefix L
PIN 16 96 BOTTOM 8
PINATTR PinName B
PINATTR SpiceOrder 2
PIN 16 16 TOP 8
PINATTR PinName A
PINATTR SpiceOrder 1
`;

const RL_ASC = volts => `Version 4
SHEET 1 240 240
WIRE 0 16 96 16
WIRE 96 96 96 112
WIRE 0 96 0 192
WIRE 0 192 96 192
SYMBOL voltage 0 0 R0
SYMATTR InstName V1
SYMATTR Value ${volts}
SYMBOL ind 80 0 R0
SYMATTR InstName L1
SYMATTR Value 2m
SYMBOL res 80 96 R0
SYMATTR InstName R1
SYMATTR Value 1k
FLAG 0 96 0
TEXT 200 220 Left 2 !.op
`;

describe('standard LTspice ASC inductor', () => {
  const partitions = imported => imported.netNames
    .map(net => net.terminals.map(terminal => `${terminal.partId}.${terminal.terminal}`).sort().join('|'))
    .sort();

  it('preserves verified A/B connectivity and signed ideal-L DC through JSON and SPICE', (t) => {
    for (const volts of [5, -5]) {
      const imported = importCircuit('ltspice-asc', RL_ASC(volts), {
        symbols: { ind: { text: IND_ASY, sha256: 'self-authored-ind-pin-contract' } },
      });
      assert.deepEqual(imported.unmapped, []);
      assert.deepEqual(imported.losses, []);
      assert.deepEqual(imported.parts.find(part => part.id === 'L1').params, { henrys: 0.002 });
      assert.deepEqual(imported.netNames.find(net => net.name === '$asc$0').terminals
        .map(terminal => `${terminal.partId}.${terminal.terminal}`).sort(), ['L1.a', 'V1.pos']);
      assert.equal(imported.sourceSymbols[0].declaredSha256, 'self-authored-ind-pin-contract');
      const builtIn = importCircuit('ltspice-asc', RL_ASC(volts));
      assert.deepEqual(partitions(builtIn), partitions(imported),
        'the built-in factual coordinates agree with the supplied self-authored pin contract');

      const circuit = Circuit.fromJSON({ parts: imported.parts, wires: imported.wires });
      const loaded = Circuit.fromJSON(circuit.toJSON());
      const op = loaded.operatingPoint();
      assert.equal(op.converged, true);
      const expected = volts / 1000;
      assert.ok(Math.abs(op.branchCurrents.get('L1').get('a') - expected) < 1e-10);
      assert.ok(Math.abs(op.branchCurrents.get('L1').get('a')
        + op.branchCurrents.get('L1').get('b')) < 1e-12);

      const exported = toSpice(extractNetlist(loaded));
      assert.deepEqual(exported.skipped, []);
      assert.match(exported.text, /^L1\s+\S+\s+\S+\s+2m$/m);
      const again = importCircuit('spice', exported.text);
      assert.equal(again.parts.find(part => part.id === 'L1').params.henrys, 0.002);
      assert.deepEqual(partitions(again), partitions(imported),
        'ASC and exported SPICE retain the same terminal partition');

      const oracle = spawnSync('ngspice', ['-b'], {
        input: `* self-authored RL oracle\nV1 in 0 ${volts}\nL1 in out 2m\nR1 out 0 1k\n.op\n.print op @l1[i]\n.end\n`,
        encoding: 'utf8',
      });
      if (oracle.error?.code === 'ENOENT') return t.skip('ngspice is not installed');
      assert.ifError(oracle.error);
      assert.equal(oracle.status, 0, oracle.stderr);
      const match = /@l1\[i\]\s+(?:=\s*)?([-+\deE.]+)/i.exec(oracle.stdout);
      assert.ok(match, oracle.stdout);
      assert.ok(Math.abs(Number(match[1]) - expected) < 1e-10, oracle.stdout);
    }
  });

  it('starts a fresh RL transient and retains invalid/extended values as blockers', () => {
    const imported = importCircuit('ltspice-asc', RL_ASC(5));
    const circuit = Circuit.fromJSON({ parts: imported.parts, wires: imported.wires });
    circuit.setPower(true);
    circuit.board.advanceTo(10_000n);
    const current = circuit.board.branchCurrent('L1', 'a');
    assert.ok(Math.abs(current) > 0.0048 && Math.abs(current) < 0.0051,
      `10 us RL current magnitude: ${current}`);

    for (const source of [
      RL_ASC(5).replace('SYMATTR Value 2m', 'SYMATTR Value 0'),
      RL_ASC(5).replace('SYMATTR Value 2m', 'SYMATTR Value -1m'),
      RL_ASC(5).replace('SYMATTR Value 2m', 'SYMATTR Value 2m\nSYMATTR Value2 Rser=3'),
    ]) {
      const refused = importCircuit('ltspice-asc', source);
      const inductor = refused.parts.find(part => part.id === 'L1');
      assert.ok(refused.losses.length >= 1);
      assert.ok(inductor.analysisBlockers.length >= 1);
      assert.throws(() => Circuit.fromJSON({ parts: refused.parts, wires: refused.wires })
        .operatingPoint(), /persisted import finding/);
    }
  });
});

const DIODE_TEMP = '26.826793442075882';
const DIODE_ASC = `Version 4
SHEET 1 320 180
FLAG 0 16 rail
FLAG 0 96 0
FLAG 200 16 rail
FLAG 120 16 out
FLAG 200 64 out
FLAG 136 64 0
SYMBOL voltage 0 0 R0
SYMATTR InstName V1
SYMATTR Value 5
SYMBOL res 216 0 R90
SYMATTR InstName R1
SYMATTR Value 1k
SYMBOL diode 200 80 M270
SYMATTR InstName D1
SYMATTR Value SELF
TEXT 0 120 Left 2 !.model SELF D(IS=2e-12 N=1.3 RS=4)
TEXT 0 140 Left 2 !.temp ${DIODE_TEMP}
TEXT 160 140 Left 2 !.options tnom=${DIODE_TEMP}
TEXT 0 160 Left 2 !.op
`;

const DIODE_SPICE = `paired ASC diode
V1 rail 0 5
R1 rail out 1k
D1 out 0 SELF
.model SELF D(IS=2e-12 N=1.3 RS=4)
.temp ${DIODE_TEMP}
.options tnom=${DIODE_TEMP}
.op
.end
`;

describe('standard LTspice ASC Shockley diode', () => {
  it('preserves verified anode/cathode polarity, exact model parameters and signed OP', (t) => {
    const asc = importCircuit('ltspice-asc', DIODE_ASC);
    const spice = importCircuit('spice', DIODE_SPICE);
    assert.deepEqual(asc.unmapped, []);
    assert.deepEqual(asc.losses, []);
    assert.deepEqual(asc.parts.find(part => part.id === 'D1').params,
      { model: 'shockley', is: 2e-12, n: 1.3, rs: 4 });
    assert.deepEqual(namedPartitions(asc), namedPartitions(spice));
    assert.deepEqual(asc.netNames.find(net => net.name === 'out').terminals
      .map(terminal => `${terminal.partId}.${terminal.terminal}`).sort(),
    ['D1.anode', 'R1.b']);
    assert.deepEqual(asc.netNames.find(net => net.name === '0').terminals
      .map(terminal => `${terminal.partId}.${terminal.terminal}`).sort(),
    ['D1.cathode', 'GND1.gnd', 'V1.neg']);
    assert.ok(asc.sourceDirectives.some(item => item.source.startsWith('.model SELF')
      && item.handling === 'strict-diode-model'));
    assert.equal(asc.sourceDirectives.filter(item => item.kind === 'temperature-profile').length, 2);

    const ascRun = runSourceAnalyses(asc, { format: 'ltspice-asc' })[0];
    const spiceRun = runSourceAnalyses(spice, { format: 'spice' })[0];
    assert.equal(ascRun.status, 'pass');
    assert.equal(spiceRun.status, 'pass');
    assert.deepEqual(ascRun.topology, spiceRun.topology);
    const ascOut = ascRun.observables.nodes.find(node => node.id === 'n1').voltage;
    const spiceOut = spiceRun.observables.nodes.find(node => node.id === 'n1').voltage;
    assert.ok(Math.abs(ascOut - spiceOut) < 1e-12);

    const circuit = Circuit.fromJSON({ parts: asc.parts, wires: asc.wires });
    const loaded = Circuit.fromJSON(circuit.toJSON());
    const op = loaded.operatingPoint();
    const diode = op.branchCurrents.get('D1');
    assert.ok(diode.get('anode') > 0);
    assert.ok(Math.abs(diode.get('anode') + diode.get('cathode')) < 1e-12);
    const exported = toSpice(extractNetlist(loaded));
    assert.deepEqual(exported.skipped, []);
    const again = importCircuit('spice', exported.text);
    assert.deepEqual(again.losses, []);
    assert.deepEqual(again.parts.find(part => part.id === 'D1').params,
      { model: 'shockley', is: 2e-12, n: 1.3, rs: 4 });

    const oracle = spawnSync('ngspice', ['-b'], {
      input: DIODE_SPICE.replace('\n.op\n', '\n.op\n.print op v(out) @d1[id]\n'),
      encoding: 'utf8',
    });
    if (oracle.error?.code === 'ENOENT') return t.skip('ngspice is not installed');
    assert.ifError(oracle.error);
    assert.equal(oracle.status, 0, oracle.stderr);
    const row = oracle.stdout.match(/\n0\s+([\deE+.-]+)\s+([\deE+.-]+)\s*\n/);
    assert.ok(row, oracle.stdout);
    assert.ok(Math.abs(Number(row[1]) - ascOut) < 3e-7);
    assert.ok(Math.abs(Number(row[2]) - diode.get('anode')) < 3e-8);
  });

  it('persists missing, ambiguous, non-exact and extra instance semantics as refusals', () => {
    const refusedSources = [
      DIODE_ASC.replace(/^TEXT .*?!\.model.*\n/m, ''),
      DIODE_ASC.replace('RS=4)', 'RS=4 BV=12)'),
      DIODE_ASC.replace('TEXT 0 140', 'TEXT 0 130 Left 2 !.model SELF D(IS=3e-12 N=1.3 RS=4)\nTEXT 0 140'),
      DIODE_ASC.replace('TEXT 0 140', 'TEXT 0 130 Left 2 !.model SELF\nTEXT 0 140'),
      DIODE_ASC.replace(`.temp ${DIODE_TEMP}`, '.temp 27'),
      DIODE_ASC.replace(`.options tnom=${DIODE_TEMP}`, `.options tnom=${DIODE_TEMP} reltol=1e-4`),
      DIODE_ASC.replace('RS=4)', 'RS=4 garbage)'),
      DIODE_ASC.replace('SYMATTR Value SELF', 'SYMATTR Value SELF\nSYMATTR Value2 AREA=2'),
    ];
    for (const source of refusedSources) {
      const imported = importCircuit('ltspice-asc', source);
      const diode = imported.parts.find(part => part.id === 'D1');
      assert.ok(diode, JSON.stringify(imported.unmapped));
      assert.ok(imported.losses.length >= 1);
      assert.ok(diode.analysisBlockers.length >= 1);
      const loaded = Circuit.fromJSON(Circuit.fromJSON({
        parts: imported.parts, wires: imported.wires,
      }).toJSON());
      assert.ok(loaded.analysisBlockers.length >= 1);
      assert.throws(() => loaded.operatingPoint(), /persisted import finding/);
      const exported = toSpice(extractNetlist(loaded));
      assert.ok(exported.skipped.length >= 1, 'a refused diode must not regain a SPICE card');
    }
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

  it('preserves output-only directives without making them analyses or semantic losses', () => {
    const imported = importCircuit('ltspice-asc', `${PAIRED_ASC}
TEXT 0 200 Left 2 !.four 1k v(vp)
TEXT 0 220 Left 2 !.meas tran peak MAX v(vp)
TEXT 0 240 Left 2 !.options plotwinsize=0
TEXT 0 260 Left 2 !.options reltol=1e-5
TEXT 0 280 Left 2 !.ic v(vp)=0
`);
    assert.deepEqual(imported.analyses, ['.op']);
    assert.deepEqual(imported.retainedDirectives.map(item => item.source), [
      '.four 1k v(vp)', '.meas tran peak MAX v(vp)', '.options plotwinsize=0',
    ]);
    assert.ok(imported.retainedDirectives.every(item =>
      item.kind === 'output-request' && item.handling === 'preserved-not-executed'));
    assert.ok(imported.retainedDirectives.every(item => !imported.ignored.includes(item.source)),
      'preserved-but-unrequested must not be folded into ignored drawing records');
    assert.deepEqual(imported.losses.map(item => item.source), [
      '.options reltol=1e-5', '.ic v(vp)=0',
    ]);
  });
});

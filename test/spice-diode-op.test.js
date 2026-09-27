import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { importSpice } from '../src/importers/spice.js';
import { Circuit } from '../src/model/circuit.js';
import { extractNetlist } from '../src/model/netlist.js';
import { toSpice } from '../src/model/exporters/spice.js';
import { blockersFromImport } from '../src/model/operating-point-view.js';
import { optionsCard, ORACLE_TEMP_C } from 'bw-board/ngspice.js';

const TEMP = '26.826793442075882';
const deck = (model = 'D(IS=2e-12 N=1.3 RS=4)', thermal = `.temp ${TEMP}\n.options tnom=${TEMP}`) => `self-authored diode\nV1 in 0 5\nR1 in out 1k\nD1 out 0 SELF\n.model SELF ${model}\n${thermal}\n.op\n.end\n`;

describe('strict SPICE diode DC contract', () => {
  it('retains exact IS/N/RS and the matched fixed thermal pair', (t) => {
    const got = importSpice(deck());
    assert.deepEqual(got.losses, []);
    assert.deepEqual(got.parts.find(p => p.id === 'D1').params,
      { model: 'shockley', is: 2e-12, n: 1.3, rs: 4 });
    const c = Circuit.fromJSON({ parts: got.parts, wires: got.wires });
    c.setPower(true);
    const op = c.operatingPoint();
    assert.equal(op.converged, true);
    assert.equal(op.analysis.diodes.thermalVoltage, 0.02585);
    const out = [...op.nodeVoltages.values()].find(v => v > 0.7 && v < 0.8);
    assert.ok(Math.abs(out - 0.7388682808410284) < 1e-10);
    const diode = op.branchCurrents.get('D1');
    assert.ok(Math.abs(diode.get('anode') + diode.get('cathode')) < 1e-12);
    const oracle = spawnSync('ngspice', ['-b'], { input: deck().replace('\n.op\n', '\n.op\n.print op v(out) @d1[id]\n'), encoding: 'utf8' });
    if (oracle.error?.code === 'ENOENT') return t.skip('ngspice is not installed');
    else assert.ifError(oracle.error);
    assert.equal(oracle.status, 0, oracle.stderr);
    const row = oracle.stdout.match(/\n0\s+([\deE+.-]+)\s+([\deE+.-]+)\s*\n/);
    assert.ok(row, oracle.stdout);
    assert.ok(Math.abs(Number(row[1]) - out) < 3e-7);
    assert.ok(Math.abs(Number(row[2]) - diode.get('anode')) < 3e-8);
  });

  it('keeps DC-inert model provenance on the circuit but outside the engine parameter set', () => {
    const imported = importSpice(deck('D(IS=2e-12 N=1.3 RS=4 CJO=2p)'));
    assert.deepEqual(imported.losses, []);
    const importedDiode = imported.parts.find(p => p.id === 'D1');
    assert.equal(importedDiode.params._spiceNonDcFields, 'cjo');
    assert.match(importedDiode.params._spiceModel, /CJO=2p/);

    const circuit = Circuit.fromJSON({ parts: imported.parts, wires: imported.wires });
    circuit.setPower(true);
    assert.equal(circuit.operatingPoint().converged, true,
      'classified CJO provenance must not become an electrical Board parameter');
    circuit.syncWithExternalNets(circuit.resolvedNets);
    circuit.setPower(true);
    assert.equal(circuit.operatingPoint().converged, true,
      'the externally resolved-net route must apply the same engine boundary');

    const saved = circuit.toJSON();
    const persisted = saved.parts.find(p => p.id === 'D1');
    assert.equal(persisted.params._spiceNonDcFields, 'cjo');
    assert.match(persisted.params._spiceModel, /CJO=2p/,
      'engine-boundary filtering must not erase persisted source provenance');

    persisted.params._unclassifiedElectricalField = 1;
    const unsafe = Circuit.fromJSON(saved);
    unsafe.setPower(true);
    assert.throws(() => unsafe.operatingPoint(), /_unclassifiedElectricalField.*outside the explicit Shockley DC domain/,
      'the boundary must not become a generic underscore-field filter');
  });

  // `CJO=2p` AND `BV=12` MOVED OUT OF THIS LIST, ON EVIDENCE.
  //
  // The rule was "IS, N, RS and nothing else". Measured against the acquired
  // LTspice `cmp/standard.dio`: 0 of 926 manufacturer models passed, because
  // every real part carries junction capacitance, a breakdown voltage and
  // vendor metadata — MFG 925, CJO 892, BV 839, and MFG/TYPE are not model
  // parameters at all. So the rule was not strict about a rare case; it
  // admitted no model any vendor ships, and no library acquisition could
  // deliver anything while it stood. On Si7li's 7,866 LTspice netlists, 1,560
  // name a diode the library defines and all 1,560 were refused.
  //
  // The rule is now analysis-scoped: a field that cannot move a bias point is a
  // NOTE at OP, the raw model text is preserved for an analysis that reads it,
  // and 916 of 926 library models are admitted. `BV` is not "inert" — a diode
  // reverse-biased past it conducts — so it is MAPPED to the engine's `zener`
  // kind, which is what the importer's own non-strict path already did.
  //
  // Everything below still refuses, and each one is a different reason:
  // malformed syntax, a duplicate field, a thermal profile that is not ours,
  // and an incomplete curve.
  it('keeps unsupported physics as a serialized OP blocker and native-rejected params', () => {
    for (const source of [deck('D(IS=2e-12 N=1.3 RS=4 garbage)'), deck('D(IS=2e-12 N=1.3 RS=4 RS=5)'), deck('D(IS=2e-12 N=1.3 RS=4)', '.temp 27'), deck('D(IS=2e-12 N=1.3 RS=4)', '.temp 25 50'), deck('D'), deck('D(IS=2e-12 N=1.3 RS=4 WOBBLE=3)')]) {
      const got = importSpice(source);
      assert.equal(got.losses.length, 1);
      assert.ok(got.parts.find(p => p.id === 'D1').params._spiceBlocked);
      const c = Circuit.fromJSON({ parts: got.parts, wires: got.wires,
        analysisBlockers: blockersFromImport(got, 'spice', 'self.cir') });
      const loaded = Circuit.fromJSON(c.toJSON());
      assert.throws(() => loaded.operatingPoint(), /persisted import finding/);
    }
    const tailed = importSpice(deck().replace('D1 out 0 SELF', 'D1 out 0 SELF 2'));
    assert.equal(tailed.losses.length, 1);
    const duplicate = importSpice(deck().replace('.model SELF', '.model SELF D(IS=3e-12 N=1.3 RS=4)\n.model SELF'));
    assert.equal(duplicate.losses.length, 1);
  });

  it('exports exact Shockley with explicit fixed thermal cards and reimports losslessly', () => {
    const got = importSpice(deck());
    const c = Circuit.fromJSON({ parts: got.parts, wires: got.wires });
    const out = toSpice(extractNetlist(c));
    assert.deepEqual(out.skipped, []);
    // DERIVED, NOT COPIED. This pinned the string `.options temp=26.826793
    // tnom=26.826793` — a hard-coded copy of a number the exporter derives, and
    // it pinned the ROUNDED form. `toFixed(6)` moved the thermal voltage by
    // 1.47e-9 relative, which is not small next to the 2e-7 V agreement the
    // card exists to produce, so `optionsCard` now emits 12 significant digits
    // and this assertion asks it what it wrote.
    //
    // The claim worth holding is not the digits, it is that BOTH KEYS name the
    // SAME temperature and that it round-trips to the engine's own constant —
    // `temp` alone leaves a flat +0.686 mV because Is is rescaled from the
    // TNOM default through the bandgap law.
    assert.ok(out.text.includes(optionsCard()),
      `the deck does not carry the exporter's own options card (${optionsCard()}):\n${out.text}`);
    const emitted = /\.options temp=(\S+) tnom=(\S+)/.exec(out.text);
    assert.ok(emitted, `no .options temp/tnom pair in:\n${out.text}`);
    assert.equal(emitted[1], emitted[2], 'temp and tnom name different temperatures');
    const K = 273.15, Q = 1.602176634e-19, KB = 1.380649e-23;
    const vt = (tC) => (tC + K) * KB / Q;
    const relative = Math.abs(vt(Number(emitted[1])) - vt(ORACLE_TEMP_C)) / vt(ORACLE_TEMP_C);
    assert.ok(relative < 1e-11,
      `the emitted temperature does not round-trip the engine's thermal voltage: `
      + `relative error ${relative.toExponential(3)} from "${emitted[1]}"`);
    const again = importSpice(out.text);
    assert.deepEqual(again.losses, []);
    assert.deepEqual(again.parts.find(p => p.kind === 'diode').params,
      { model: 'shockley', is: 2e-12, n: 1.3, rs: 4 });
  });

  it('keeps established native LED and Vf-derived diode exports intact', () => {
    const parts = [
      { refdes: 'LED1', kind: 'led', pins: ['anode', 'cathode'], params: { color: 'red', model: 'shockley' } },
      { refdes: 'D1', kind: 'diode', pins: ['anode', 'cathode'], params: { vf: 0.7, model: 'shockley' } },
    ];
    const out = toSpice({ parts, nets: [
      { name: 'N1', nodes: parts.map(p => ({ refdes: p.refdes, pin: 'anode' })) },
      { name: 'GND', nodes: parts.map(p => ({ refdes: p.refdes, pin: 'cathode' })) },
    ] });
    assert.deepEqual(out.skipped, []);
    assert.equal((out.text.match(/^D\S*\s/gm) || []).length, 2);
    assert.equal((out.text.match(/^\.model D_/gm) || []).length, 2);
  });

  // THE INVARIANT THIS TEST HOLDS IS ABOUT A **BLOCKED** MODEL, and it stands.
  // What changed is that `BV=12` alone no longer blocks: a D model with a
  // breakdown voltage is what the engine's `zener` kind IS, and 839 of the 926
  // library models carry one. So the case is split — a clean BV model becomes a
  // zener with that vz, and a model blocked for ANOTHER reason still must not
  // slip out as a zener.
  it('an omitted field takes ngspice\'s documented default, not a refusal', () => {
    // `D(IS=2e-12 N=1.3)` used to be refused for stating no RS. ngspice fills
    // RS = 0 and solves, so refusing made us unable to judge a deck the
    // REFERENCE handles without complaint — which is not strictness, it is a
    // different circuit.
    //
    // Verified against ngspice rather than read from a manual: 0.65 V across
    // 1 Ohm into `.model DEF D` with no parameters at all puts the junction at
    // 0.6492044 V, and 1e-14 * exp(0.6492/0.02585) = 8.06e-4 A is exactly the
    // 0.8 mA that drop implies. So IS = 1e-14, N = 1, RS = 0.
    //
    // Measured on the first 2,000 ADI2005 decks: 41 refusals, every one a zener
    // written `BV=5.1 IBV=5m RS=5` — a breakdown voltage and a bulk resistance
    // with the forward curve left to the defaults.
    const noRs = importSpice(deck('D(IS=2e-12 N=1.3)'));
    assert.deepEqual(noRs.losses, []);
    assert.equal(noRs.parts.find(p => p.id === 'D1').params.rs, 0);
    assert.ok(noRs.warnings.some(w => /documented default/.test(w)),
      `the default was applied silently: ${JSON.stringify(noRs.warnings)}`);

    // The ADI zener shape: no forward curve stated at all.
    const zener = importSpice(deck('D(BV=5.1 IBV=5m RS=5)'));
    assert.deepEqual(zener.losses, []);
    const z = zener.parts.find(p => p.id === 'D1');
    assert.equal(z.kind, 'zener');
    assert.deepEqual({ is: z.params.is, n: z.params.n, rs: z.params.rs, vz: z.params.vz },
      { is: 1e-14, n: 1, rs: 5, vz: 5.1 });

    // A BARE `.model X D` is still refused, and that is the line between a
    // considered model and a name: taking the WHOLE curve from defaults would
    // make an empty declaration indistinguishable from a deliberate one.
    const bare = importSpice(deck('D'));
    assert.equal(bare.losses.length, 1);
    assert.match(bare.losses[0].reason, /no parameters at all/);
  });

  it('maps a clean BV model to a zener with that breakdown voltage', () => {
    const imported = importSpice(deck('D(IS=2e-12 N=1.3 RS=4 BV=12)'));
    assert.deepEqual(imported.losses, []);
    const d = imported.parts.find(p => p.id === 'D1');
    assert.equal(d.kind, 'zener');
    assert.equal(d.params.vz, 12);
    // A negative BV states the same device.
    const neg = importSpice(deck('D(IS=2e-12 N=1.3 RS=4 BV=-12)'));
    assert.equal(neg.parts.find(p => p.id === 'D1').params.vz, 12);
  });

  it('never reinterprets a blocked imported BV model as a native zener', () => {
    // Blocked for a DIFFERENT reason — a duplicate field — while also carrying
    // BV. The block must win, or a malformed model reaches the engine wearing a
    // kind it was never validated for.
    const imported = importSpice(deck('D(IS=2e-12 N=1.3 RS=4 RS=5 BV=12)'));
    assert.equal(imported.losses.length, 1);
    const d = imported.parts.find(p => p.id === 'D1');
    assert.ok(d.params._spiceBlocked, 'a blocked model lost its blocker');
    assert.notEqual(d.kind, 'zener', 'a blocked model became a zener anyway');
    const circuit = Circuit.fromJSON({ parts: imported.parts, wires: imported.wires });
    const out = toSpice(extractNetlist(circuit));
    assert.equal(out.skipped.length, 1);
    assert.match(out.skipped[0], /blocked imported SPICE model/);
    assert.doesNotMatch(out.text, /^D1\s/m);
  });
});

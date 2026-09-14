import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { importLtspiceAsc } from '../src/importers/ltspice-asc.js';
import { toLtspiceAsc } from '../src/model/exporters/ltspice-asc.js';
import { CIRCUIT_EXPORTS, runExport } from '../src/model/exporters/registry.js';
import { wireEndpoint } from '../src/model/wire-endpoints.js';
import { importKicadSch } from '../src/importers/kicad-sch.js';
import { toKicadSch } from '../src/model/exporters/kicad-sch.js';
import { importSpice } from '../src/importers/spice.js';
import { Circuit } from '../src/model/circuit.js';
import './_setup.js';

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
    assert.deepEqual(out.skipped.map(s => [s.id, s.reason]), [['V1', 'unrepresented parameters: sineAmplitude'],
      ['D1', 'diode needs explicit finite Shockley IS/N/RS parameters']]);
    assert.doesNotMatch(out.text, /SYMBOL/);
  });

  it('is reachable headlessly through the shared export registry', async () => {
    const entry = CIRCUIT_EXPORTS.find(candidate => candidate.id === 'ltspice-asc'); assert.ok(entry);
    const out = await runExport(entry, { circuit });
    assert.equal(out.files[0].name, 'circuit.asc'); assert.match(out.files[0].text, /^Version 4/m); assert.deepEqual(out.report.skipped, []);
  });

  it('replays an unchanged retained ASC document but refuses to hide later edits', () => {
    const source = `Version 4.1
SHEET 1 880 680
SYMBOL res 100 100 R0
SYMATTR InstName R1
SYMATTR Value 2k
FLAG 116 116 A
FLAG 116 196 B
FUTURE_RECORD preserved exactly
`;
    const imported = importLtspiceAsc(source);
    const exact = toLtspiceAsc(imported);
    assert.equal(exact.text, source);
    assert.equal(exact.preservedSourceDocument, true);
    imported.parts[0].params.ohms = 3000;
    const edited = toLtspiceAsc(imported);
    assert.equal(edited.preservedSourceDocument, undefined);
    assert.doesNotMatch(edited.text, /FUTURE_RECORD/);
    assert.match(edited.text, /SYMATTR Value 3000/);
    assert.ok(edited.warnings.some(warning => /changed after ASC import/.test(warning)));
  });

  it('replays retained ASC after a real Circuit JSON load but detects a later edit', () => {
    const source = `Version 4.1
SHEET 1 880 680
SYMBOL res 100 100 R0
SYMATTR InstName R1
SYMATTR Value 2k
FLAG 116 116 A
FLAG 116 196 B
FUTURE_RECORD preserved through GUI load
`;
    const imported = importLtspiceAsc(source);
    const loaded = Circuit.fromJSON({ vcc: 5, parts: imported.parts, wires: imported.wires,
      sourceDocuments: [imported.sourceDocument] });
    const exact = toLtspiceAsc(loaded);
    assert.equal(exact.text, source);
    assert.equal(exact.preservedSourceDocument, true);
    loaded.parts[0].x += 16;
    const edited = toLtspiceAsc(loaded);
    assert.equal(edited.preservedSourceDocument, undefined);
    assert.ok(edited.warnings.some(warning => /changed after ASC import/.test(warning)));
  });

  it('round-trips R/C/L/V/I values and terminal partitions through generated KiCad', () => {
    const interchange = { parts: [
      { id: 'R1', kind: 'resistor', params: { ohms: 2000 } },
      { id: 'C1', kind: 'capacitor', params: { farads: 2e-6 } },
      { id: 'L1', kind: 'inductor', params: { henrys: 3e-3 } },
      { id: 'V1', kind: 'vsource', params: { volts: 5 } },
      { id: 'I1', kind: 'isource', params: { amps: 4e-3 } },
      { id: 'GND1', kind: 'gnd', params: {} },
    ], wires: [
      { from: { part: 'R1', terminal: 'a' }, to: { part: 'V1', terminal: 'pos' } },
      { from: { part: 'R1', terminal: 'b' }, to: { part: 'C1', terminal: 'a' } },
      { from: { part: 'C1', terminal: 'b' }, to: { part: 'L1', terminal: 'a' } },
      { from: { part: 'L1', terminal: 'b' }, to: { part: 'V1', terminal: 'neg' } },
      { from: { part: 'I1', terminal: 'neg' }, to: { part: 'V1', terminal: 'pos' } },
      { from: { part: 'I1', terminal: 'pos' }, to: { part: 'V1', terminal: 'neg' } },
      { from: { part: 'GND1', terminal: 'gnd' }, to: { part: 'V1', terminal: 'neg' } },
    ] };
    const kicad = toKicadSch(interchange);
    assert.deepEqual(kicad.skipped, []);
    const fromKicad = importKicadSch(kicad.text);
    assert.equal(fromKicad.unmapped.length, 0);
    const asc = toLtspiceAsc(fromKicad);
    assert.deepEqual(asc.skipped, []);
    const back = importLtspiceAsc(asc.text);
    assert.deepEqual(back.parts.filter(part => part.kind !== 'gnd').map(part =>
      [part.id, part.kind, part.params]), [
      ['R1', 'resistor', { ohms: 2000 }], ['C1', 'capacitor', { farads: 2e-6 }],
      ['L1', 'inductor', { henrys: 3e-3 }], ['V1', 'vsource', { volts: 5 }],
      ['I1', 'isource', { amps: 4e-3 }],
    ]);
    assert.deepEqual(terminalPartitions(back.wires), terminalPartitions(interchange.wires));
  });

  it('round-trips supported SPICE R/C/L/D/Q/M/E/G through standard LTspice symbols', () => {
    const spice = `supported device interchange
V1 supply 0 5
R1 supply nr 2k
C1 nr 0 2u
L1 nr nl 3m
D1 nl 0 DMOD
Q1 nq nb 0 QMOD
M1 nd ng ns ns MMOD W=20u L=1u
Rs ns 0 1k
E1 ne 0 nr 0 2.5
G1 0 ng nr 0 1m
.model DMOD D (IS=1e-14 N=1 RS=0.1)
.model QMOD NPN (IS=2e-14 BF=150 BR=2 NF=1.1)
.model MMOD NMOS (LEVEL=1 VTO=1 KP=1m LAMBDA=0.01)
.op
.end
`;
    const original = importSpice(spice);
    assert.equal(original.unmapped.length, 0);
    assert.equal(original.losses.length, 0);
    const asc = toLtspiceAsc(original);
    assert.deepEqual(asc.skipped, []);
    assert.deepEqual(asc.symbolFiles, []);
    assert.match(asc.text, /SYMBOL npn /);
    assert.match(asc.text, /SYMBOL nmos /);
    assert.match(asc.text, /SYMBOL e /);
    assert.match(asc.text, /SYMBOL g /);
    const back = importLtspiceAsc(asc.text);
    assert.equal(back.unmapped.length, 0);
    assert.deepEqual(back.parts.filter(part => part.kind !== 'gnd').map(part => [part.id, part.kind]),
      original.parts.filter(part => part.kind !== 'gnd').map(part => [part.id, part.kind]));
    assert.deepEqual(terminalPartitions(back.wires), terminalPartitions(original.wires));
    assert.equal(back.parts.find(part => part.id === 'Q1').params.is, 2e-14);
    assert.equal(back.parts.find(part => part.id === 'Q1').params.beta, 150);
    assert.equal(back.parts.find(part => part.id === 'M1').params.vth, 1);
    assert.equal(back.parts.find(part => part.id === 'M1').params.w, 20e-6);
  });

  /**
   * THE MOSFET IN THE ROUND-TRIP DECK ABOVE HAS ITS BULK ON ITS SOURCE, AND
   * THAT IS NOT INCIDENTAL.
   *
   * The generated `bw_nmos`/`bw_pmos` symbols tie their fourth pin to SOURCE --
   * `pinList` lists `source` twice -- so a deck that ties the bulk to the
   * REFERENCE instead cannot be drawn by them. It used to round-trip anyway,
   * silently, as the bulk-on-source device: no body-effect threshold shift and
   * no bulk-drain junction, the second of which is worth volts on a drain
   * driven below the reference (4.37 V on a 10k pull-down, measured against
   * ngspice).
   *
   * Once the importer started recording `bulkAtGround`, the exporter could see
   * it and refuse. That is the honest outcome, so it is asserted rather than
   * worked around -- and the reason has to name the CONSEQUENCE, because
   * "unrepresented parameters: bulkAtGround" sends a reader looking for a
   * missing field instead of a missing pin.
   */
  it('REFUSES a MOSFET whose deck ties the bulk to the reference, and says why', () => {
    const spice = `bulk at the reference
V1 supply 0 5
R1 supply nd 2k
Rs ns 0 1k
M1 nd ng ns 0 MMOD W=20u L=1u
V2 ng 0 2
.model MMOD NMOS (LEVEL=1 VTO=1 KP=1m)
.op
.end
`;
    const imported = importSpice(spice);
    assert.equal(imported.unmapped.length, 0, JSON.stringify(imported.unmapped));
    const m1 = imported.parts.find(part => part.id === 'M1');
    assert.equal(m1.params.bulkAtGround, true,
      'the importer must record the bulk wiring, or this test proves nothing');

    const asc = toLtspiceAsc(imported);
    const refusal = asc.skipped.find(entry => entry.id === 'M1');
    assert.ok(refusal, `M1 must be refused: ${JSON.stringify(asc.skipped)}`);
    assert.match(refusal.reason, /ties the bulk to the reference/);
    assert.match(refusal.reason, /bulk-drain junction/,
      `the reason must name what exporting anyway would drop: ${refusal.reason}`);
    assert.ok(!/unrepresented parameters/.test(refusal.reason),
      'a missing PIN must not be reported as a missing FIELD');

    // And it is refused rather than emitted: no MOSFET symbol in the output.
    assert.ok(!/SYMATTR InstName M1/.test(asc.text), asc.text);

    // The CONTROL: the same deck with the bulk on the source is accepted, so
    // the refusal is keyed to the bulk wiring and not to MOSFETs in general.
    const onSource = importSpice(spice.replace('M1 nd ng ns 0 MMOD', 'M1 nd ng ns ns MMOD'));
    assert.equal(onSource.parts.find(part => part.id === 'M1').params.bulkAtGround, undefined);
    const ascOk = toLtspiceAsc(onSource);
    assert.deepEqual(ascOk.skipped, [], JSON.stringify(ascOk.skipped));
    assert.match(ascOk.text, /SYMATTR InstName M1/);
  });

  /**
   * THE BODY-EFFECT PARAMETERS RIDE IN THE MODEL CARD, WHICH IS WHERE SPICE
   * PUTS THEM.
   *
   * 1,296 of the 12,471 ADI v3 decks declare GAMMA and PHI on a level-1 MOS
   * model. The exporter used to emit LEVEL/VTO/KP/LAMBDA only, so every one of
   * those MOSFETs was REFUSED -- not for a pin it could not draw, but for a
   * number the card it was already writing can hold.
   *
   * Each field is asserted INDEPENDENTLY of the others, because that is the
   * claim the emitter makes: `GAMMA=` without `PHI=` is faithful, since SPICE
   * defaults PHI to 0.6 and so does `mosVth`. A card that omitted GAMMA when
   * PHI was absent would silently lose the body effect for the one-sided deck.
   */
  it('carries GAMMA, PHI and the bulk IS through the model card, each on its own', () => {
    const deck = (modelFields) => `body effect through the card
V1 supply 0 5
R1 supply nd 2k
Rs ns 0 1k
M1 nd ng ns ns MMOD W=20u L=1u
V2 ng 0 2
.model MMOD NMOS (${modelFields})
.op
.end
`;
    const roundTrip = (modelFields) => {
      const imported = importSpice(deck(modelFields));
      assert.equal(imported.unmapped.length, 0, JSON.stringify(imported.unmapped));
      const asc = toLtspiceAsc(imported);
      assert.deepEqual(asc.skipped, [],
        `a parameter the model card can hold must not refuse the part: ${JSON.stringify(asc.skipped)}`);
      const back = importLtspiceAsc(asc.text);
      return { asc, before: imported.parts.find(part => part.id === 'M1').params,
        after: back.parts.find(part => part.id === 'M1').params };
    };

    // All three, and the bulk wiring the symbol does represent.
    const all = roundTrip('LEVEL=1 VTO=1 KP=1m GAMMA=0.5 PHI=0.7 IS=3e-15');
    assert.equal(all.before.gamma, 0.5, 'the importer must read GAMMA, or this proves nothing');
    assert.equal(all.before.phi, 0.7);
    assert.equal(all.before.bulkIs, 3e-15);
    assert.equal(all.before.bulkOnSource, true);
    assert.match(all.asc.text, /GAMMA=0\.5/);
    assert.match(all.asc.text, /PHI=0\.7/);
    assert.match(all.asc.text, /IS=3e-15/);
    assert.equal(all.after.gamma, 0.5, 'GAMMA must survive the round trip');
    assert.equal(all.after.phi, 0.7);
    assert.equal(all.after.bulkIs, 3e-15);
    assert.equal(all.after.bulkOnSource, true,
      'the three-pin symbol ties its bulk to the source, so the read-back must say so');

    // GAMMA alone: emitted, and PHI is NOT invented on either side.
    const gammaOnly = roundTrip('LEVEL=1 VTO=1 KP=1m GAMMA=0.5');
    assert.match(gammaOnly.asc.text, /GAMMA=0\.5/);
    assert.ok(!/PHI=/.test(gammaOnly.asc.text), gammaOnly.asc.text);
    assert.equal(gammaOnly.after.gamma, 0.5);
    assert.equal(gammaOnly.after.phi, undefined);

    // PHI alone: same, the other way round.
    const phiOnly = roundTrip('LEVEL=1 VTO=1 KP=1m PHI=0.7');
    assert.match(phiOnly.asc.text, /PHI=0\.7/);
    assert.ok(!/GAMMA=/.test(phiOnly.asc.text), phiOnly.asc.text);
    assert.equal(phiOnly.after.phi, 0.7);
    assert.equal(phiOnly.after.gamma, undefined);

    // The CONTROL: a card with none of the three is unchanged by all of this.
    const plain = roundTrip('LEVEL=1 VTO=1 KP=1m');
    assert.ok(!/GAMMA=|PHI=|IS=/.test(plain.asc.text), plain.asc.text);
    assert.equal(plain.after.vth, 1);
  });
});

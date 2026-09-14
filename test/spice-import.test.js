/**
 * SPICE netlist importer (ROADMAP X1.1).
 *
 * The load-bearing test is the ROUND TRIP: a circuit exported by our own
 * X0.1 serializer and read back by this importer must produce the same NET
 * PARTITION. That property is what an interchange format is for, and it is
 * the precedent the XML-schematic importer's symmetry test set.
 *
 * The partition is compared as a partition, not as a wire list: a netlist
 * states membership and says nothing about which member is wired to which,
 * so the exported star wiring and the original's chain wiring are the same
 * circuit and must compare equal.
 *
 * scripts/spice-oracle.mjs carries the other half — that the exported deck is
 * something a real simulator runs. Both halves are needed: a round trip
 * through two of our own modules can agree perfectly on a deck ngspice would
 * refuse.
 *
 * @module
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Circuit } from '../src/model/circuit.js';
import { extractNetlist } from '../src/model/netlist.js';
import { toSpice } from '../src/model/exporters/spice.js';
import { importSpice, looksLikeSpice } from '../src/importers/spice.js';
import { detectFormat } from '../src/importers/detect.js';
import { importCircuit } from '../src/importers/index.js';
import { parseSpiceValue, formatSpiceValue } from '../src/model/si.js';
import { evaluateConstantExpression, resolveConstantParameters } from '../src/model/spice-constant.js';
import { blockersFromImport } from '../src/model/operating-point-view.js';

describe('strict SPICE constant expressions', () => {
  it('evaluates measured literals, grouping, precedence and unary signs', () => {
    assert.equal(evaluateConstantExpression('{1/5Meg}'), 2e-7);
    assert.equal(evaluateConstantExpression('-(2 + 3) * .1p'), -5e-13);
    assert.equal(evaluateConstantExpression('2--3'), 5);
    assert.equal(evaluateConstantExpression('1.4072e-08'), 1.4072e-8);
  });

  it('resolves forward references and refuses unsafe definitions', () => {
    const good = resolveConstantParameters([
      '.param OUT={base / DIV} base=40', '.params div=3 tail=OUT+2',
    ]);
    assert.deepEqual(good.losses, []);
    assert.equal(good.values.get('tail'), 40 / 3 + 2);
    for (const cards of [
      ['.param a=1', '.param A=2'], ['.param a=b b=a'], ['.param a=missing+1'],
      ['.param a=1/0'], ['.param a=V(out)'], ['.param a=time'], ['.param a=2^3'],
      ['.param a=1XYZ'],
      ['.param JUNK a=1'],
    ]) {
      const result = resolveConstantParameters(cards);
      assert.ok(result.losses.length, cards.join('; '));
      assert.equal(result.values.has('a'), false);
    }
    assert.throws(() => evaluateConstantExpression(`${'('.repeat(40)}1${')'.repeat(40)}`), /depth/);
    assert.throws(() => evaluateConstantExpression('1e308*1e308'), /finite/);
    const chain = Array.from({ length: 34 }, (_, i) =>
      `.param p${i}=${i === 33 ? '1' : `p${i + 1}`}`);
    assert.ok(resolveConstantParameters(chain).losses.some(loss => /dependency exceeds depth/.test(loss.reason)));
  });
});

describe('SPICE top-level constant parameters', () => {
  it('resolves measured division and forward-reference forms without loss', () => {
    const imported = importSpice(`* parameter divider
.param gm=1 go=1/5Meg
V1 in 0 {gm}
R1 in 0 {1/go}
.op
.end`);
    assert.equal(imported.parts.find(p => p.id === 'V1').params.volts, 1);
    assert.equal(imported.parts.find(p => p.id === 'R1').params.ohms, 5e6);
    assert.deepEqual(imported.losses, []);
  });

  it('keeps AC magnitude/phase separate from the zero or authored DC bias', () => {
    const imported = importSpice(`* AC metadata
.param mag=2 phase=-30 bias=250m
V1 in 0 DC {bias} AC {mag} {phase}
I1 0 in AC 80n
R1 in 0 1k
.ac dec 10 1 1k
.end`);
    const voltage = imported.parts.find(p => p.id === 'V1');
    const current = imported.parts.find(p => p.id === 'I1');
    assert.deepEqual(voltage.params,
      { volts: 0.25, acMagnitude: 2, acPhase: -30 });
    assert.deepEqual(current.params,
      { amps: 0, acMagnitude: 80e-9, acPhase: 0 });
    assert.deepEqual(imported.losses, []);

    const circuit = Circuit.fromJSON({ parts: imported.parts, wires: imported.wires });
    const exported = toSpice(extractNetlist(circuit), 'AC metadata');
    assert.deepEqual(exported.skipped, []);
    assert.match(exported.text, /V1\s+\S+\s+\S+\s+DC 250m AC 2 -30/);
    assert.match(exported.text, /I1\s+\S+\s+\S+\s+DC 0 AC 80n 0/);
    const back = importSpice(exported.text);
    assert.deepEqual(back.parts.find(p => p.id === 'V1').params, voltage.params);
    assert.deepEqual(back.parts.find(p => p.id === 'I1').params, current.params);
  });

  it('matches ngspice on AC-only zero DC and mixed explicit DC bias', (t) => {
    const deck = `* independent AC/DC semantics
V1 a 0 AC 2 -30
R1 a 0 1k
V2 b 0 DC 250m AC 3 10
R2 b 0 1k
.op
.print op v(a) v(b) i(V1) i(V2)
.end
`;
    const foreign = spawnSync('ngspice', ['-b'], { input: deck, encoding: 'utf8' });
    if (foreign.error?.code === 'ENOENT') return t.skip('ngspice not installed locally');
    assert.equal(foreign.status, 0, foreign.stderr);
    assert.match(foreign.stdout,
      /^0\s+0\.000000e\+00\s+2\.500000e-01\s+0\.000000e\+00\s+-2\.50000e-04\s*$/m);
    const imported = importSpice(deck);
    assert.equal(imported.parts.find(p => p.id === 'V1').params.volts, 0);
    assert.equal(imported.parts.find(p => p.id === 'V2').params.volts, 0.25);
  });

  it('refuses malformed AC descriptors instead of reusing magnitude as DC', () => {
    // `AC -1` USED TO BE IN THIS LIST AND IS NOT MALFORMED. A negative
    // magnitude is legal SPICE and means the magnitude at phase + 180;
    // ngspice reads it and simulates it. Refusing it discarded the whole card,
    // DC BIAS INCLUDED, on every deck that writes a differential pair as
    // `AC 0.5` / `AC -0.5` — 31 of the first 400 ADI2005 decks, which is the
    // shape half the small-signal benches in that corpus use. It has its own
    // case below; what this one guards, reusing the magnitude as a DC value,
    // is unchanged.
    for (const card of ['V1 in 0 AC nope', 'V1 in 0 AC 1 0 extra']) {
      const imported = importSpice(`* invalid AC\n${card}\nR1 in 0 1k\n.op\n.end`);
      const source = imported.parts.find(p => p.id === 'V1');
      assert.equal('volts' in source.params, false, card);
      assert.equal(source.analysisBlockers.length, 1, card);
      assert.ok(imported.losses.some(loss => loss.ref === 'V1'), card);
    }
  });

  it('reads a negative AC magnitude as phase + 180, keeping the DC bias', () => {
    const imported = importSpice('* negative AC\nV1 in 0 DC 1.5 AC -0.5\nR1 in 0 1k\n.op\n.end');
    const source = imported.parts.find(p => p.id === 'V1');
    assert.deepEqual(source.params, { volts: 1.5, acMagnitude: 0.5, acPhase: 180 });
    assert.deepEqual(imported.losses, []);
    // A phase already stated adds to it rather than being replaced.
    const withPhase = importSpice('* negative AC\nV1 in 0 AC -2 45\nR1 in 0 1k\n.op\n.end');
    assert.equal(withPhase.parts.find(p => p.id === 'V1').params.acPhase, 225);
  });

  it('persists unresolved scalar blockers on the part and through Circuit JSON', () => {
    const imported = importSpice(`* unresolved
V1 in 0 1
R1 in 0 {missing/2}
.op
.end`);
    const resistor = imported.parts.find(p => p.id === 'R1');
    assert.equal('ohms' in resistor.params, false);
    assert.equal(imported.losses.filter(loss => loss.ref === 'R1').length, 1);
    assert.equal(resistor.analysisBlockers.length, 1);
    const circuit = Circuit.fromJSON({ parts: imported.parts, wires: imported.wires });
    assert.equal(circuit.analysisBlockers.length, 1,
      'parts-only persistence must not turn an engine default into valid analysis');
    assert.deepEqual(Circuit.fromJSON(circuit.toJSON()).analysisBlockers, circuit.analysisBlockers);
  });

  it('refuses top-level functions and subcircuit-local parameters', () => {
    const imported = importSpice(`* scoped parameters
.func unsafe(x) {x+1}
.subckt cell a b
.param local=2
R1 a b {local}
.ends
X1 in 0 cell
V1 in 0 1
.op
.end`);
    assert.ok(imported.losses.some(loss => loss.kind === 'unsupported-constant-function'));
    assert.ok(imported.losses.some(loss => loss.kind === 'unsupported-subcircuit-parameter'));
  });

  it('keeps an invalid directive blocking when another valid definition resolves', () => {
    const imported = importSpice(`* invalid directive stays loud
.param JUNK good=2k
.param usable=3k
V1 in 0 1
R1 in 0 {usable}
.op
.end`);
    assert.equal(imported.parts.find(p => p.id === 'R1').params.ohms, 3000);
    assert.ok(imported.losses.some(loss => loss.kind === 'unsupported-constant-parameter'));
    const blockers = blockersFromImport(imported, 'spice', 'invalid-param.net');
    const circuit = Circuit.fromJSON({ parts: imported.parts, wires: imported.wires,
      analysisBlockers: blockers });
    assert.ok(circuit.analysisBlockers.some(blocker => /before first/.test(blocker.reason)));
    assert.deepEqual(Circuit.fromJSON(circuit.toJSON()).analysisBlockers, circuit.analysisBlockers);
  });
});

/**
 * The net partition of a {parts, wires} description, as a canonical string.
 *
 * Union-find over terminal endpoints, then each set sorted and the sets
 * sorted. Part IDS are deliberately included: the importer keeps the refdes
 * the exporter wrote, so a partition that matches by shape but attaches to
 * different parts is not a round trip.
 *
 * Two canonicalisations, both stated rather than hidden, because without them
 * this compares two different SPELLINGS of one circuit:
 *
 *   RAILS ARE NETS.  `vcc`/`gnd` parts are net labels, not nodes. A circuit
 *   may carry three GND symbols where the deck has one node 0, so every rail
 *   part collapses to a single canonical name.
 *
 *   THE SYNTHESIZED SUPPLY IS A RAIL.  SPICE has no rail concept, so the
 *   exporter writes `V…_SUPPLY <rail> 0 DC <vcc>` — a real element. Reading
 *   that back gives a vsource where the circuit had a `vcc` part, which is
 *   the same circuit said two ways. The `_SUPPLY` suffix is OUR OWN
 *   convention (model/exporters/spice.js), so recognising it here is reading
 *   our own handwriting, not guessing at someone else's. A vsource by any
 *   other name stays a vsource.
 */
function partition(parts, wires, { renameGround = true } = {}) {
  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); }
    return x;
  };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };

  const railName = (p) => (p.kind === 'gnd' ? '#GND' : p.kind === 'vcc' ? '#VCC' : null);
  const rails = new Map(parts.map(p => [p.id, railName(p)]).filter(([, v]) => v));
  const supplies = new Set(parts
    .filter(p => p.kind === 'vsource' && /_SUPPLY$/i.test(p.id))
    .map(p => p.id));

  const key = (partId, terminal) => {
    if (renameGround) {
      const rail = rails.get(partId);
      if (rail) return rail;
      if (supplies.has(partId)) return terminal === 'pos' ? '#VCC' : '#GND';
    }
    return `${partId}:${terminal}`;
  };

  // Wires arrive in EITHER dialect: Circuit.fromJSON normalizes to the NESTED
  // one, so reading `w.from` raw keys on "[object Object]" and collapses every
  // endpoint into one root — the exact trap model/exporters/eagle.js records.
  const end = (w, side) => {
    const e = w[side];
    if (e && typeof e === 'object') return [e.part ?? e.partId, e.terminal];
    return [e, w[side === 'from' ? 'fromTerminal' : 'toTerminal']];
  };

  for (const p of parts) if (!rails.has(p.id)) find(`${p.id}:*`);
  for (const w of wires) {
    const [fp, ft] = end(w, 'from');
    const [tp, tt] = end(w, 'to');
    if (fp === undefined || tp === undefined) continue;
    union(key(fp, ft), key(tp, tt));
  }

  const sets = new Map();
  for (const node of parent.keys()) {
    if (node.endsWith(':*')) continue;
    const r = find(node);
    if (!sets.has(r)) sets.set(r, []);
    sets.get(r).push(node);
  }
  return [...sets.values()]
    .map(s => [...new Set(s)].sort().join(' '))
    .filter(s => s.includes(' '))     // a one-terminal net is not a net
    .sort()
    .join('\n');
}

/**
 * The same canonical form, built from a Netlist rather than from wires.
 *
 * The round trip is netlist -> deck -> netlist, NOT circuit -> deck ->
 * circuit, because `extractNetlist` deliberately REASSIGNS reference
 * designators: a part the designer calls `LED1` becomes `D1`, since SPICE
 * wants canonical refdes and the engine's part ids are not that. Comparing
 * against the circuit's own ids would fail on a rename that is the exporter
 * doing its job. (Measured: `led-bench` was the case that caught this — the
 * divider passed only because its parts were already called R1 and R2.)
 */
function netlistPartition(netlist) {
  return netlist.nets
    .map((net) => {
      const name = net.rail === 'gnd' ? '#GND' : net.rail === 'vcc' ? '#VCC' : null;
      const members = net.nodes.map((n) => `${n.refdes}:${n.pin}`);
      if (name) members.push(name);
      return [...new Set(members)].sort().join(' ');
    })
    .filter((s) => s.includes(' '))
    .sort()
    .join('\n');
}

const CASES = {
  'divider': {
    parts: [
      { id: 'VCC1', kind: 'vcc', params: {}, x: 0, y: 0 },
      { id: 'GND1', kind: 'gnd', params: {}, x: 0, y: 200 },
      { id: 'R1', kind: 'resistor', params: { ohms: 10000 }, x: 60, y: 0 },
      { id: 'R2', kind: 'resistor', params: { ohms: 4700 }, x: 120, y: 0 },
    ],
    wires: [
      { from: 'VCC1', fromTerminal: 'vcc', to: 'R1', toTerminal: 'a' },
      { from: 'R1', fromTerminal: 'b', to: 'R2', toTerminal: 'a' },
      { from: 'R2', fromTerminal: 'b', to: 'GND1', toTerminal: 'gnd' },
    ],
  },
  'led-bench': {
    parts: [
      { id: 'VCC1', kind: 'vcc', params: {}, x: 0, y: 0 },
      { id: 'GND1', kind: 'gnd', params: {}, x: 0, y: 200 },
      { id: 'R1', kind: 'resistor', params: { ohms: 220 }, x: 60, y: 0 },
      { id: 'LED1', kind: 'led', params: { vf: 2.0 }, x: 120, y: 0 },
    ],
    wires: [
      { from: 'VCC1', fromTerminal: 'vcc', to: 'R1', toTerminal: 'a' },
      { from: 'R1', fromTerminal: 'b', to: 'LED1', toTerminal: 'anode' },
      { from: 'LED1', fromTerminal: 'cathode', to: 'GND1', toTerminal: 'gnd' },
    ],
  },
  'megohm-and-cap': {
    parts: [
      { id: 'VCC1', kind: 'vcc', params: {}, x: 0, y: 0 },
      { id: 'GND1', kind: 'gnd', params: {}, x: 0, y: 200 },
      { id: 'R1', kind: 'resistor', params: { ohms: 2.2e6 }, x: 60, y: 0 },
      { id: 'R2', kind: 'resistor', params: { ohms: 1e6 }, x: 120, y: 0 },
      { id: 'C1', kind: 'capacitor', params: { farads: 100e-9 }, x: 180, y: 0 },
    ],
    wires: [
      { from: 'VCC1', fromTerminal: 'vcc', to: 'R1', toTerminal: 'a' },
      { from: 'R1', fromTerminal: 'b', to: 'R2', toTerminal: 'a' },
      { from: 'R1', fromTerminal: 'b', to: 'C1', toTerminal: 'a' },
      { from: 'C1', fromTerminal: 'b', to: 'GND1', toTerminal: 'gnd' },
      { from: 'R2', fromTerminal: 'b', to: 'GND1', toTerminal: 'gnd' },
    ],
  },
  'transistor-switch': {
    parts: [
      { id: 'VCC1', kind: 'vcc', params: {}, x: 0, y: 0 },
      { id: 'GND1', kind: 'gnd', params: {}, x: 0, y: 200 },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, x: 60, y: 0 },
      { id: 'R2', kind: 'resistor', params: { ohms: 470 }, x: 60, y: 80 },
      { id: 'Q1', kind: 'npn', params: { beta: 200 }, x: 120, y: 40 },
    ],
    wires: [
      { from: 'VCC1', fromTerminal: 'vcc', to: 'R1', toTerminal: 'a' },
      { from: 'R1', fromTerminal: 'b', to: 'Q1', toTerminal: 'base' },
      { from: 'VCC1', fromTerminal: 'vcc', to: 'R2', toTerminal: 'a' },
      { from: 'R2', fromTerminal: 'b', to: 'Q1', toTerminal: 'collector' },
      { from: 'Q1', fromTerminal: 'emitter', to: 'GND1', toTerminal: 'gnd' },
    ],
  },
};

describe('round trip: our deck re-imports with the same net partition', () => {
  for (const [name, json] of Object.entries(CASES)) {
    it(name, () => {
      const circuit = Circuit.fromJSON(json);
      circuit.setPower(true);
      const netlist = extractNetlist(circuit);
      const { text } = toSpice(netlist, name);

      const back = importSpice(text);
      assert.deepEqual(back.unmapped, [], `unmapped on re-import:\n${text}`);

      const before = netlistPartition(netlist);
      const after = partition(back.parts, back.wires);
      assert.equal(after, before,
        `partition changed.\n--- deck ---\n${text}\n--- before ---\n${before}\n--- after ---\n${after}`);
    });
  }

  it('the refdes the exporter wrote is the refdes that comes back', () => {
    // Not the designer's ids — the NETLIST's. extractNetlist renames LED1 to
    // D1 on the way out and the importer must keep whatever it was handed.
    const circuit = Circuit.fromJSON(CASES['led-bench']);
    circuit.setPower(true);
    const netlist = extractNetlist(circuit);
    const { text } = toSpice(netlist);
    const back = importSpice(text);
    const exported = netlist.parts.map(p => p.refdes).sort();
    const returned = back.parts
      .filter(p => p.kind !== 'gnd' && !/_SUPPLY$/.test(p.id))
      .map(p => p.id).sort();
    assert.deepEqual(returned, exported, 'every refdes the deck named came back');
    assert.ok(exported.includes('D1'), 'and LED1 really was renamed to D1');
  });

  it('values survive the trip, megohms included', () => {
    const circuit = Circuit.fromJSON(CASES['megohm-and-cap']);
    circuit.setPower(true);
    const { text } = toSpice(extractNetlist(circuit));
    const back = importSpice(text);
    const byId = Object.fromEntries(back.parts.map(p => [p.id, p]));
    // R1/R2 are assigned by the exporter in sorted-id order; both are 1e6-class.
    const ohms = back.parts.filter(p => p.kind === 'resistor').map(p => p.params.ohms).sort((a, b) => a - b);
    assert.deepEqual(ohms, [1e6, 2.2e6], 'a bare M would have made these 0.001 and 0.0022');
    assert.equal(byId.C1.params.farads, 100e-9);
  });

  it('a diode\'s explicit Shockley fields are retained without derived fields', () => {
    const circuit = Circuit.fromJSON(CASES['led-bench']);
    circuit.setPower(true);
    const { text } = toSpice(extractNetlist(circuit));
    const back = importSpice(text);
    const d = back.parts.find(p => p.kind === 'diode' || p.kind === 'led');
    assert.ok(d, `no junction came back:\n${text}`);
    assert.equal(d.params.model, 'shockley');
    assert.ok(Number.isFinite(d.params.is) && d.params.is > 0);
    assert.equal(d.params.vf, undefined, 'derived Vf would exceed the exact native DC model envelope');
    assert.equal(d.params.n, 1.8);
  });
});

describe('the M / MEG trap has an explicit test', () => {
  it('ngspice\'s own semantics, measured against ngspice 42', () => {
    // Measured by running a six-resistor deck and reading the values back out
    // of ngspice's device table — not assumed from a manual.
    assert.equal(parseSpiceValue('1M'), 1e-3);
    assert.equal(parseSpiceValue('1MEG'), 1e6);
    assert.ok(Math.abs(parseSpiceValue('1MIL') - 25.4e-6) < 1e-12);
    assert.equal(parseSpiceValue('1F'), 1e-15);
  });

  it('case does not change the meaning, and units after a factor are ignored', () => {
    assert.equal(parseSpiceValue('1meg'), 1e6);
    assert.equal(parseSpiceValue('1Meg'), 1e6);
    assert.equal(parseSpiceValue('4.7kOhm'), 4700);
    assert.equal(parseSpiceValue('100nF'), 100e-9);
    assert.equal(parseSpiceValue('1uF'), 1e-6);
    assert.equal(parseSpiceValue('5V'), 5);
  });

  it('scientific notation works and is not re-scaled', () => {
    assert.equal(parseSpiceValue('1e6'), 1e6);
    assert.equal(parseSpiceValue('2.2e-9'), 2.2e-9);
    assert.equal(parseSpiceValue('-4.7e3'), -4700);
  });

  it('parse and format are inverse across the whole scale', () => {
    for (const v of [1e12, 1e9, 2.2e6, 4.7e3, 470, 1, 2.2e-3, 4.7e-6, 100e-9, 10e-12]) {
      assert.equal(parseSpiceValue(formatSpiceValue(v)), v,
        `${v} -> ${formatSpiceValue(v)} -> ${parseSpiceValue(formatSpiceValue(v))}`);
    }
  });

  it('a non-number is NaN, not a silent zero', () => {
    assert.ok(Number.isNaN(parseSpiceValue('D_D1')));
    assert.ok(Number.isNaN(parseSpiceValue('')));
    assert.ok(Number.isNaN(parseSpiceValue('PULSE(0')));
  });
});

describe('the reader states what it will not do', () => {
  const deck = (body) => `probe deck\n${body}\n.op\n.end\n`;

  it('F and H are refused by name, never substituted', () => {
    const r = importSpice(deck('V1 1 0 DC 5\nR1 1 2 1k\nF1 2 0 V1 2\nH1 2 0 V1 100'));
    const refs = r.unmapped.map(u => u.ref).sort();
    assert.deepEqual(refs, ['F1', 'H1']);
    for (const u of r.unmapped) assert.match(u.libsource, /E3\.5b is deferred/);
    // And the parts that DO map still come through.
    assert.ok(r.parts.some(p => p.id === 'R1'));
  });

  it('E and G map through Circuit.fromJSON into the engine terminal contract', () => {
    const r = importSpice(deck('V1 1 0 DC 1\nE1 3 0 1 0 10\nG1 4 0 1 0 1m\nR1 3 0 1k\nR2 4 0 1k'));
    assert.deepEqual(r.unmapped, []);
    const e = r.parts.find(p => p.id === 'E1');
    const g = r.parts.find(p => p.id === 'G1');
    assert.equal(e.kind, 'vcvs');
    assert.equal(e.params.gain, 10);
    assert.equal(g.kind, 'vccs');
    assert.equal(g.params.gm, 1e-3);

    const circuit = Circuit.fromJSON({ vcc: 5, parts: r.parts, wires: r.wires });
    assert.deepEqual(circuit.getPart('E1').terminals, ['outp', 'outn', 'inp', 'inn']);
    assert.deepEqual(circuit.getPart('G1').terminals, ['outp', 'outn', 'inp', 'inn']);
    assert.equal(circuit.netlistError, null,
      `controlled sources must reach bw-board validation: ${circuit.netlistError}`);
    assert.deepEqual(
      circuit.board.getParts().filter(p => p.kind === 'vcvs' || p.kind === 'vccs')
        .map(p => [p.kind, p.terminals]),
      [
        ['vcvs', ['outp', 'outn', 'inp', 'inn']],
        ['vccs', ['outp', 'outn', 'inp', 'inn']],
      ]);
  });

  it('preserves E/G card polarity through import, solve, and export round trip', {
    skip: spawnSync('ngspice', ['--version'], { encoding: 'utf8' }).status !== 0,
  }, () => {
    const source = readFileSync(join(import.meta.dirname, 'fixtures', 'spice-controlled-op.cir'), 'utf8');
    const imported = importSpice(source);
    assert.deepEqual(imported.unmapped, []);
    assert.deepEqual(imported.losses, []);

    const circuit = Circuit.fromJSON({ vcc: 5, parts: imported.parts, wires: imported.wires });
    circuit.setPower(true);
    const before = circuit.board.snapshot();
    const op = circuit.operatingPoint();
    assert.equal(op.converged, true);
    assert.equal(op.analysis.controlledSources, 'ideal-explicit-finite-parameters-only');
    assert.ok(op.analysis.supportedKinds.includes('vcvs'));
    assert.ok(op.analysis.supportedKinds.includes('vccs'));
    const netFor = (part, terminal) => circuit.resolvedNets.find(net =>
      net.terminals.some(item => item.part === part && item.terminal === terminal)).id;
    assert.ok(Math.abs(op.nodeVoltages.get(netFor('E1', 'outp')) - 2) < 1e-10);
    assert.ok(Math.abs(op.nodeVoltages.get(netFor('G1', 'outn')) + 1) < 2e-9,
      'SPICE G1 gout->0 must draw 1 mA from gout, not inject it');
    assert.ok(Math.abs(op.branchCurrents.get('G1').get('outn') - 1e-3) < 1e-12);
    assert.ok(Math.abs(op.branchCurrents.get('R2').get('a') + 1e-3) < 2e-12);
    assert.ok(Math.abs(op.branchCurrents.get('G1').get('outn')
      + op.branchCurrents.get('R2').get('a')) < 2e-12, 'imported G-card output KCL');
    assert.deepEqual(circuit.board.snapshot(), before, 'operatingPoint must not adopt the result');

    const oracleDeck = source.replace('.op\n.end',
      '.control\nset numdgt=15\nop\nprint v(eout) v(gout) @e1[i] @g1[i] @r2[i]\n.endc\n.end');
    const ng = spawnSync('ngspice', ['-b'], { input: oracleDeck, encoding: 'utf8' });
    assert.equal(ng.status, 0, ng.stderr || ng.stdout);
    const read = (expr) => {
      const match = ng.stdout.match(new RegExp(`${expr}\\s*=\\s*([-+0-9.e]+)`, 'i'));
      assert.ok(match, ng.stdout);
      return Number(match[1]);
    };
    assert.ok(Math.abs(op.nodeVoltages.get(netFor('E1', 'outp')) - read('v\\(eout\\)')) < 1e-10);
    assert.ok(Math.abs(op.nodeVoltages.get(netFor('G1', 'outn')) - read('v\\(gout\\)')) < 2e-9);
    assert.ok(Math.abs(op.branchCurrents.get('E1').get('outp') - read('@e1\\[i\\]')) < 1e-10);
    assert.ok(Math.abs(op.branchCurrents.get('G1').get('outn') - read('@g1\\[i\\]')) < 1e-10);
    assert.ok(Math.abs(op.branchCurrents.get('R2').get('a') - read('@r2\\[i\\]')) < 1e-10);

    const exported = toSpice(extractNetlist(circuit), 'controlled round trip');
    assert.deepEqual(exported.skipped, []);
    assert.match(exported.text, /^E1\s+\S+\s+0\s+\S+\s+0\s+2$/m);
    assert.match(exported.text, /^G1\s+\S+\s+0\s+\S+\s+0\s+1m$/m);
    const back = importSpice(exported.text);
    assert.deepEqual(back.unmapped, []);
    assert.equal(back.parts.find(part => part.id === 'E1').params.gain, 2);
    assert.equal(back.parts.find(part => part.id === 'G1').params.gm, 1e-3);
    assert.equal(partition(back.parts, back.wires), partition(imported.parts, imported.wires));
  });

  it('refuses non-ideal or indeterminate E/G export instead of guessing', () => {
    const source = readFileSync(join(import.meta.dirname, 'fixtures', 'spice-controlled-op.cir'), 'utf8');
    const imported = importSpice(source);
    imported.parts.find(part => part.id === 'E1').params.rout = 0;
    delete imported.parts.find(part => part.id === 'G1').params.gm;
    const circuit = Circuit.fromJSON({ vcc: 5, parts: imported.parts, wires: imported.wires });
    const exported = toSpice(extractNetlist(circuit));
    assert.ok(exported.skipped.some(item => /E1.*rout/.test(item)));
    assert.ok(exported.skipped.some(item => /G1.*finite gm/.test(item)));
    assert.doesNotMatch(exported.text, /^E1\s/m);
    assert.doesNotMatch(exported.text, /^G1\s/m);
  });

  it('does not silently accept stale two-terminal controlled sources', () => {
    const r = importSpice(deck('V1 1 0 DC 1\nE1 3 0 1 0 10\nR1 3 0 1k'));
    const parts = r.parts.map(p => p.id === 'E1' ? { ...p, terminals: ['a', 'b'] } : p);
    const originalWarn = console.warn;
    console.warn = () => {};
    let circuit;
    try {
      circuit = Circuit.fromJSON({ vcc: 5, parts, wires: r.wires });
    } finally {
      console.warn = originalWarn;
    }
    assert.match(circuit.netlistError, /E1.*vcvs.*unknown terminal "a"/i);
    assert.equal(circuit.board.getParts().length, 0,
      'a rejected netlist must not leave a plausible partial board');
  });

  it('a MOSFET\'s bulk node is dropped and said out loud', () => {
    const r = importSpice(deck(
      'V1 1 0 DC 5\nM1 2 1 0 0 NMOD\n.model NMOD NMOS (Vto=2.0)\nR1 1 2 1k'));
    const m = r.parts.find(p => p.id === 'M1');
    assert.equal(m.kind, 'nmos');
    assert.ok(r.warnings.some(w => /M1.*bulk/.test(w)), `no bulk warning: ${r.warnings}`);
  });

  it('a PNP model card picks the pnp kind', () => {
    const r = importSpice(deck(
      'V1 1 0 DC 5\nQ1 2 3 1 PMOD\n.model PMOD PNP (Bf=150)\nR1 2 0 1k\nR2 3 0 10k'));
    const q = r.parts.find(p => p.id === 'Q1');
    assert.equal(q.kind, 'pnp');
    assert.equal(q.params.beta, 150);
  });

  it('an undeclared model is a warning, not a silent default', () => {
    const r = importSpice(deck('V1 1 0 DC 5\nD1 1 0 MYSTERY\nR1 1 0 1k'));
    assert.ok(r.warnings.some(w => /D1.*MYSTERY.*not declared/.test(w)),
      `no warning: ${JSON.stringify(r.warnings)}`);
  });

  it('a strict seven-argument voltage PULSE retains its waveform', () => {
    const r = importSpice(deck('V1 1 0 PULSE(0 5 0 1n 1n 1m 2m)\nR1 1 0 1k'));
    const v = r.parts.find(p => p.id === 'V1');
    assert.deepEqual(v.params, {
      volts: 0, wave: 'spice-pulse', v1: 0, v2: 5, td: 0,
      tr: 1e-9, tf: 1e-9, pw: 1e-3, per: 2e-3,
      dcValue: 0, dcBiasOrigin: 'waveform-initial-default',
    });
    assert.ok(!r.warnings.some(w => /V1.*PULSE.*not modelled/.test(w)));
    assert.deepEqual(r.losses, []);
  });

  it('an external WAVEFILE remains importable but records oracle-blocking semantic loss', () => {
    const path = join(import.meta.dirname, 'fixtures', 'spice-wavefile-source.net');
    const r = importSpice(readFileSync(path, 'utf8'));
    const v = r.parts.find(p => p.id === 'Vstim');
    assert.equal(v.params.volts, 0);
    assert.deepEqual(r.unmapped, []);
    assert.ok(r.warnings.some(w => /Vstim.*WAVEFILE.*not read or modelled.*oracle.*unsafe/i.test(w)),
      `no external-waveform warning: ${JSON.stringify(r.warnings)}`);
    assert.deepEqual(r.losses, [{
      ref: 'Vstim',
      kind: 'unsupported-external-waveform',
      source: 'Vstim signal 0 wavefile=definitely-not-present.wav chan=0',
      reason: 'external WAVEFILE waveform is not read or modelled',
      fallback: { parameter: 'volts', value: 0 },
    }]);
  });

  it('numeric DC, SINE, and PULSE sources do not acquire external-waveform loss', () => {
    for (const value of ['DC 5', 'SINE(1 2 1k)', 'PULSE(0 5 0 1n 1n 1m 2m)']) {
      const r = importSpice(deck(`V1 1 0 ${value}\nR1 1 0 1k`));
      assert.deepEqual(r.losses, [], value);
      assert.ok(!r.warnings.some(w => /WAVEFILE|oracle comparison is unsafe/i.test(w)), value);
    }
  });

  it('analyses are reported, not executed', () => {
    const r = importSpice('t\nV1 1 0 DC 5\nR1 1 0 1k\n.op\n.tran 1u 1m\n.ac dec 10 1 1meg\n.end\n');
    assert.equal(r.analyses.length, 3);
    assert.ok(r.analyses.some(a => a.startsWith('.tran')));
    assert.ok(r.analyses.some(a => a.startsWith('.ac')));
  });

  it('every card is accounted for — nothing is silently dropped', () => {
    const text = 'title\n'
      + 'V1 1 0 DC 5\n'
      + 'R1 1 2 1k\n'
      + 'F1 2 0 V1 2\n'
      + '.model D1M D (Is=1e-14)\n'
      + '.options reltol=1e-4\n'
      + '.tran 1u 1m\n'
      + '.end\n';
    const r = importSpice(text);
    const cards = text.trim().split('\n').slice(1).length;
    const accounted = r.parts.filter(p => p.kind !== 'gnd').length
      + r.unmapped.length + r.ignored.length + r.analyses.length;
    assert.equal(accounted, cards,
      `${cards} cards in, ${accounted} accounted for: parts=${r.parts.length} `
      + `unmapped=${r.unmapped.length} ignored=${r.ignored.length} analyses=${r.analyses.length}`);
  });
});

describe('comments, continuations, subcircuits and the title line', () => {
  it('line one is the title even when it looks like an element', () => {
    const r = importSpice('R1 1 0 1k\nV1 1 0 DC 5\nR2 1 0 2k\n.end\n');
    assert.equal(r.title, 'R1 1 0 1k');
    assert.ok(!r.parts.some(p => p.id === 'R1'), 'the title line is not a component');
  });

  it('continuation lines join, and inline comments are stripped', () => {
    const r = importSpice([
      'continuation probe',
      'V1 1 0 DC 5 $ the supply',
      'R1 1 2',
      '+ 4.7k ; split across two lines',
      '* a whole-line comment',
      'R2 2 0 1k',
      '.end',
    ].join('\n'));
    assert.deepEqual(r.unmapped, []);
    assert.equal(r.parts.find(p => p.id === 'R1').params.ohms, 4700);
    assert.equal(r.parts.find(p => p.id === 'V1').params.volts, 5);
  });

  it('a subcircuit call flattens one level with dotted refdes', () => {
    const r = importSpice([
      'subckt probe',
      '.subckt divider in out gnd',
      'RA in out 10k',
      'RB out gnd 10k',
      '.ends',
      'V1 1 0 DC 5',
      'X1 1 2 0 divider',
      'RL 2 0 100k',
      '.end',
    ].join('\n'));
    assert.deepEqual(r.unmapped, []);
    const ids = r.parts.map(p => p.id).sort();
    assert.ok(ids.includes('X1.RA') && ids.includes('X1.RB'),
      `dotted refdes missing: ${ids.join(', ')}`);
  });

  it('two instances of one subcircuit do not share internal nets', () => {
    const r = importSpice([
      'two instances',
      '.subckt pair a b',
      'RA a mid 1k',
      'RB mid b 1k',
      '.ends',
      'V1 1 0 DC 5',
      'X1 1 0 pair',
      'X2 1 0 pair',
      '.end',
    ].join('\n'));
    // Each instance's `mid` is its own net: RA/RB of X1 must not touch X2's.
    const p = partition(r.parts, r.wires, { renameGround: true });
    assert.ok(!/X1\.RA:b.*X2\.RA:b/.test(p),
      `internal nets merged across instances:\n${p}`);
    assert.ok(/X1\.RA:b X1\.RB:a/.test(p), `X1's own mid net missing:\n${p}`);
  });

  it('an undefined subcircuit is unmapped, not invented', () => {
    const r = importSpice('t\nV1 1 0 DC 5\nX1 1 0 nosuch\nR1 1 0 1k\n.end\n');
    assert.equal(r.unmapped.length, 1);
    assert.match(r.unmapped[0].libsource, /undefined subcircuit/);
  });

  it('nesting stops at one level and says so', () => {
    const r = importSpice([
      'nested',
      '.subckt inner a b',
      'RI a b 1k',
      '.ends',
      '.subckt outer a b',
      'X9 a b inner',
      'RO a b 2k',
      '.ends',
      'V1 1 0 DC 5',
      'X1 1 0 outer',
      '.end',
    ].join('\n'));
    assert.ok(r.unmapped.some(u => /flattening stops at one level/.test(u.libsource)),
      `no depth refusal: ${JSON.stringify(r.unmapped)}`);
    assert.ok(r.parts.some(p => p.id === 'X1.RO'), 'the one level that DID flatten is there');
  });

  it('node 0, gnd and GND all become the one ground part', () => {
    const r = importSpice('t\nV1 1 0 DC 5\nR1 1 gnd 1k\nR2 1 GND 2k\n.end\n');
    assert.equal(r.parts.filter(p => p.kind === 'gnd').length, 1);
    const p = partition(r.parts, r.wires);
    assert.ok(/#GND/.test(p), `ground net missing:\n${p}`);
  });
});

describe('SPICE independent-current polarity contract', () => {
  const deck = (card) => `current-source polarity\n${card}\nR1 n 0 1k\n.op\n.end\n`;

  function solve(card) {
    const imported = importSpice(deck(card));
    assert.deepEqual(imported.unmapped, []);
    const source = imported.parts.find(p => p.id === 'I1');
    assert.equal(source.params.amps, 2e-3, 'direction must not be hidden in a negated value');
    const circuit = Circuit.fromJSON({ vcc: 5, parts: imported.parts, wires: imported.wires });
    assert.equal(circuit.netlistError, null);
    circuit.setPower(true);
    const nodeWire = circuit.wires.find(w =>
      (w.from.part === 'R1' && w.from.terminal === 'a')
      || (w.to.part === 'R1' && w.to.terminal === 'a'));
    assert.ok(nodeWire, 'resistor node must survive import');
    return { imported, circuit, nodeId: nodeWire.netId };
  }

  it('preserves positive SPICE current from the first node to the second', () => {
    const { imported, circuit, nodeId } = solve('I1 n 0 DC 2m');
    assert.ok(imported.wires.some(w => w.from === 'I1' && w.fromTerminal === 'neg'
      && w.to === 'R1' && w.toTerminal === 'a'),
    'the first SPICE node must map to the engine current origin (neg)');
    assert.ok(Math.abs(circuit.nodeVoltage(nodeId) - (-2)) < 1e-8,
      `2 mA from n to ground through 1 kOhm must make n=-2 V, got ${circuit.nodeVoltage(nodeId)}`);
    assert.ok(Math.abs(circuit.branchCurrent('I1', 'neg')
      + circuit.branchCurrent('R1', 'a')) < 1e-11, 'KCL must hold at the first card node');
  });

  it('reversing the source card reverses the solved voltage and still satisfies KCL', () => {
    const { imported, circuit, nodeId } = solve('I1 0 n DC 2m');
    assert.ok(imported.wires.some(w => w.from === 'I1' && w.fromTerminal === 'pos'
      && w.to === 'R1' && w.toTerminal === 'a'),
    'the second SPICE node must map to the engine current destination (pos)');
    assert.ok(Math.abs(circuit.nodeVoltage(nodeId) - 2) < 1e-8,
      `2 mA from ground to n through 1 kOhm must make n=+2 V, got ${circuit.nodeVoltage(nodeId)}`);
    assert.ok(Math.abs(circuit.branchCurrent('I1', 'pos')
      + circuit.branchCurrent('R1', 'a')) < 1e-11, 'KCL must hold at the second card node');
  });

  it('exports the engine current origin first and round-trips the same direction', () => {
    const { circuit } = solve('I1 n 0 DC 2m');
    const { text } = toSpice(extractNetlist(circuit), 'current direction');
    const sourceCard = text.split('\n').find(line => /^I\d+\s/.test(line));
    const resistorCard = text.split('\n').find(line => /^R\d+\s/.test(line));
    assert.ok(sourceCard && resistorCard, `missing source or resistor card:\n${text}`);
    const [, sourceFrom, sourceTo, sourceValue] = sourceCard.trim().split(/\s+/);
    const [, resistorA, resistorB] = resistorCard.trim().split(/\s+/);
    assert.equal(sourceFrom, resistorA, 'engine neg/current-origin node must be first');
    assert.equal(sourceTo, resistorB, 'engine pos/current-destination node must be second');
    assert.equal(parseSpiceValue(sourceValue), 2e-3);

    const back = importSpice(text);
    assert.equal(back.parts.find(p => p.kind === 'isource').params.amps, 2e-3);
    assert.equal(partition(back.parts, back.wires), netlistPartition(extractNetlist(circuit)));
  });
});

describe('detection', () => {
  it('a deck is detected by its body, since it has no magic first line', () => {
    const deck = 'my circuit\nV1 1 0 DC 5\nR1 1 0 1k\n.op\n.end\n';
    assert.ok(looksLikeSpice(deck));
    assert.equal(detectFormat(deck, 'whatever.txt'), 'spice');
  });

  it('our own exported deck detects as spice', () => {
    const circuit = Circuit.fromJSON(CASES['divider']);
    circuit.setPower(true);
    const { text } = toSpice(extractNetlist(circuit));
    assert.equal(detectFormat(text, 'circuit.cir'), 'spice');
  });

  it('a complete one-element stimulus deck wins over the .net extension', () => {
    const path = join(import.meta.dirname, 'fixtures', 'spice-single-source.net');
    const text = readFileSync(path, 'utf8');
    assert.ok(looksLikeSpice(text));
    assert.equal(detectFormat(text, path), 'spice');
    const r = importCircuit('spice', text);
    assert.equal(r.parts.filter((p) => p.kind === 'vsource').length, 1);
    assert.deepEqual(r.unmapped, []);
  });

  it('a lone element needs both an analysis/model card and an exact terminator', () => {
    assert.equal(looksLikeSpice('* fragment\nV1 signal 0 DC 5\n.end\n'), false,
      'a terminator alone is too weak to claim an otherwise ambiguous file');
    assert.equal(looksLikeSpice('* fragment\nV1 signal 0 DC 5\n.tran 1n 5u\n'), false,
      'an unterminated analysis fragment is not a complete one-element deck');
  });

  it('the shipping bwc CLI dispatches the self-authored .net fixture to SPICE', () => {
    const path = join(import.meta.dirname, 'fixtures', 'spice-single-source.net');
    const cli = spawnSync(process.execPath,
      [join(import.meta.dirname, '..', 'bin', 'bwc.mjs'), 'info', path], { encoding: 'utf8' });
    assert.equal(cli.status, 0, cli.stderr || cli.stdout);
    assert.match(cli.stdout, /\[spice\]/);
    assert.match(cli.stdout, /parts\s+: 2\b/);
    assert.match(cli.stdout, /wires\s+: 1\b/);
    assert.doesNotMatch(cli.stdout, /UNMAPPED/);
  });

  it('the shipping bwc CLI reports external-waveform semantic loss', () => {
    const path = join(import.meta.dirname, 'fixtures', 'spice-wavefile-source.net');
    const cli = spawnSync(process.execPath,
      [join(import.meta.dirname, '..', 'bin', 'bwc.mjs'), 'info', path], { encoding: 'utf8' });
    assert.equal(cli.status, 0, cli.stderr || cli.stdout);
    assert.match(cli.stdout, /\[spice\]/);
    assert.match(cli.stdout, /LOSSES\s+: 1\b/);
    assert.match(cli.stdout, /Vstim\s+external WAVEFILE waveform is not read or modelled/);
  });

  it('it does not steal the formats it shares an extension with', () => {
    // `.net` is KiCad's too, and its `(export` root is checked far above.
    assert.equal(detectFormat('(export (version "E")\n (components))', 'x.net'), 'kicad-netlist');
    assert.equal(detectFormat('{"parts":[],"connections":[]}', 'x.json'), 'wokwi');
    assert.equal(detectFormat('<eagle version="6"/>', 'x.sch'), 'eagle');
    assert.ok(!looksLikeSpice('{"parts": []}'));
    assert.ok(!looksLikeSpice('just some prose about circuits\nand a second line\n'));
  });

  it('it is reachable through the registry the menu renders from', () => {
    const deck = 'reg probe\nV1 1 0 DC 5\nR1 1 0 1k\n.end\n';
    const r = importCircuit('spice', deck);
    assert.equal(r.parts.filter(p => p.kind !== 'gnd').length, 2);
  });
});

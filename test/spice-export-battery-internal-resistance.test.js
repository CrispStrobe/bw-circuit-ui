/**
 * A BATTERY'S INTERNAL RESISTANCE IS WHY A BATTERY IS NOT AN IDEAL SOURCE, AND
 * THE DECK WAS DELETING IT.
 *
 * The engine puts `rInternal` in series between the EMF and `pos`. The exporter
 * wrote a bare `V` card, so ngspice returned the EMF to six decimals every time
 * and the oracle scored the difference as an engine error.
 *
 * Measured, 9 V with rInternal = 1 into a 10 Ohm load:
 *
 *   engine                           8.181818 V
 *   9 * 10/(10+1)                    8.181818 V
 *   bare V card, ngspice             9.000000 V
 *   EMF + series R card, ngspice     8.181818 V
 *
 * Where it bit is the part worth remembering: `pc77-klemmenspannung` and
 * `pc80-quellen-vergleich` are the gallery examples that EXIST to teach
 * terminal voltage versus EMF, and the deck removed the lesson. Four rows of
 * the 47 remaining gallery disagreements, including
 * `75-battery-tester` (battery_aa, 1.45 V, 10 Ohm load: engine 1.429559 vs
 * ngspice 1.450000).
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/model/circuit.js';
import { extractNetlist } from '../src/model/netlist.js';
import { toSpice } from '../src/model/exporters/spice.js';

/** A `companionsFor` wired the way the oracle wires it: refdes -> part id. */
const companionsOf = (circuit, solved) => {
  const partIdOf = new Map(solved.parts.map((p) => [p.refdes, p.partId]));
  return (refdes) => {
    const id = partIdOf.get(refdes);
    if (!id) return null;
    const snap = circuit.board.deviceCompanions(id);
    return (!snap || snap.converged === false) ? null : snap.records;
  };
};

const deckFor = (params, kind = 'vsource') => {
  const c = Circuit.fromJSON({
    parts: [
      { id: 'V1', kind, params, x: 0, y: 0 },
      { id: 'RL', kind: 'resistor', params: { ohms: 10 }, x: 0, y: 0 },
      { id: 'G1', kind: 'gnd', params: {}, x: 0, y: 0 },
    ],
    wires: [
      { from: 'V1', fromTerminal: 'pos', to: 'RL', toTerminal: 'a' },
      { from: 'RL', fromTerminal: 'b', to: 'G1', toTerminal: 'gnd' },
      { from: 'V1', fromTerminal: 'neg', to: 'G1', toTerminal: 'gnd' },
    ],
  });
  c.setPower(true);
  const out = toSpice(extractNetlist(c), 'rint', {});
  return { text: typeof out === 'string' ? out : out.text, out, circuit: c };
};

describe('battery internal resistance reaches the deck', () => {
  it('emits the EMF on an internal node and the resistance as a series R', () => {
    const { text } = deckFor({ volts: 9, rInternal: 1 });
    assert.match(text, /^V1 V1_EMF \S+ DC 9$/m, `no EMF card:\n${text}`);
    assert.match(text, /^RV1_INT V1_EMF \S+ 1$/m, `no series resistance:\n${text}`);
    // The EMF must NOT be written straight onto the terminal node any more.
    assert.ok(!/^V1 net-\S+ \S+ DC 9$/m.test(text),
      `the bare ideal-source card is still there:\n${text}`);
  });

  it('the two cards are in SERIES, sharing exactly the internal node', () => {
    // A resistor that is not in series would be a different circuit that also
    // mentions both numbers.
    const { text } = deckFor({ volts: 9, rInternal: 1 });
    const v = /^V1 (\S+) (\S+) DC 9$/m.exec(text);
    const r = /^RV1_INT (\S+) (\S+) 1$/m.exec(text);
    assert.ok(v && r, text);
    assert.equal(v[1], r[1], 'the EMF and the resistor must share the internal node');
    assert.notEqual(r[2], v[1], 'and the resistor\'s other end must be the terminal node');
    assert.notEqual(r[2], v[2], 'which is not the source\'s own return node');
  });

  it('an ideal source with no rInternal is untouched', () => {
    const { text } = deckFor({ volts: 9 });
    assert.match(text, /^V1 \S+ \S+ DC 9$|^V1 \S+ \S+ 9$/m, text);
    assert.ok(!/_EMF/.test(text), `no internal node should appear:\n${text}`);
    assert.ok(!/RV1_INT/.test(text), text);
  });

  it('rInternal of zero is an ideal source, not a 0 Ohm resistor', () => {
    for (const rInternal of [0, -1, NaN, undefined]) {
      const { text } = deckFor({ volts: 9, rInternal });
      assert.ok(!/RV1_INT/.test(text),
        `rInternal ${String(rInternal)} must not emit a series resistor:\n${text}`);
    }
  });

  it('works for a battery kind too, not just a bare vsource', () => {
    // Guard every reach: the gallery cases are `battery`, `battery_aa` and
    // `battery_9v`, which share the V card. Their REFDES is BT-prefixed, so
    // the element names are derived rather than hard-coded -- an earlier
    // version of this test looked for `RV1_INT` and reported the feature
    // missing when it was present under the right name.
    for (const kind of ['battery_9v', 'battery_aa']) {
      const { text } = deckFor({ volts: 1.45, rInternal: 0.14 }, kind);
      const v = /^V(\S+) (\S+_EMF) (\S+) DC 1\.45$/m.exec(text);
      assert.ok(v, `${kind}: no EMF card:\n${text}`);
      const r = new RegExp(`^R${v[1]}_INT ${v[2]} (\\S+) (140m|0\\.14)$`, 'm');
      assert.match(text, r, `${kind}: no series resistance:\n${text}`);
    }
  });

  it('the engine and the deck now answer the same question', () => {
    // The whole point: 9 V, 1 Ohm internal, 10 Ohm load.
    const { circuit } = deckFor({ volts: 9, rInternal: 1 });
    const nets = extractNetlist(circuit).nets;
    // The netlist's net shape is {id, name, nodes:[{partId, refdes, pin}]} --
    // not {terminals:[{part, terminal}]}, which is the BOARD's shape. Reading
    // the wrong one returns undefined and looks like a missing net.
    const posNet = nets.find((n) => (n.nodes || []).some(
      (nd) => nd.partId === 'RL' && nd.pin === 'a'));
    assert.ok(posNet, `the load net must exist: ${JSON.stringify(nets)}`);
    const v = circuit.nodeVoltage(posNet.id);
    assert.ok(Math.abs(v - 9 * 10 / 11) < 1e-6,
      `engine reads ${v} V; 9*10/(10+1) = ${9 * 10 / 11}, and ngspice reads `
      + '8.181818 V from the two cards above');
  });
});

/**
 * THE RESISTANCE THE ENGINE SOLVES WITH IS NOT ALWAYS ON THE CARD.
 *
 * A gallery `battery_aa` declares `{volts: 1.45}` and nothing else, and
 * `bw-board/src/devices/named-parts.js` stamps it with
 * `part.params?.rInternal ?? 0.3`. So 0.3 Ohm is the value that SOLVED and it is
 * invisible to anything reading `part.params` — which is why the first version
 * of this export left `75-battery-tester` still disagreeing at
 * engine 1.429559 V against ngspice's 1.450000 V, the EMF again.
 *
 * So the exporter ASKS THE ENGINE, via the `companionsFor` hook `toSpice`
 * already takes. A two-terminal source appears as one `between` companion:
 *
 *   battery_aa {volts: 1.45}
 *     -> [{kind:'between', tP:'pos', tN:'neg', g:3.3333333, vth:1.45}]
 *     -> 1/g = 0.3 Ohm, EMF = 1.45 V
 *
 * 1.45 * 21/21.3 = 1.429577 V, which is what the engine reads on a 21 Ohm load.
 */
describe('internal resistance read from the engine when the card omits it', () => {
  const battery = (params) => {
    const c = Circuit.fromJSON({
      parts: [
        { id: 'cell1', kind: 'battery_aa', params, x: 0, y: 0 },
        { id: 'RL', kind: 'resistor', params: { ohms: 21 }, x: 0, y: 0 },
        { id: 'G1', kind: 'gnd', params: {}, x: 0, y: 0 },
      ],
      wires: [
        { from: 'cell1', fromTerminal: 'pos', to: 'RL', toTerminal: 'a' },
        { from: 'RL', fromTerminal: 'b', to: 'G1', toTerminal: 'gnd' },
        { from: 'cell1', fromTerminal: 'neg', to: 'G1', toTerminal: 'gnd' },
      ],
    });
    c.setPower(true);
    const solved = extractNetlist(c);
    const out = toSpice(solved, 'batt', { companionsFor: companionsOf(c, solved) });
    return { text: typeof out === 'string' ? out : out.text, out, circuit: c, solved };
  };

  it('emits the 0.3 Ohm the engine stamped, for a card that declares none', () => {
    const { text } = battery({ volts: 1.45 });
    assert.match(text, /^VBT1 BT1_EMF \S+ DC 1\.45$/m, `no EMF card:\n${text}`);
    assert.match(text, /^RBT1_INT BT1_EMF \S+ 300m$/m, `no derived resistance:\n${text}`);
  });

  it('the DC value is the EMF, not a node name', () => {
    // A local `const emf` holding the NODE NAME once shadowed the destructured
    // EMF, so the card read `VBT1 BT1_EMF 0 DC` with no value at all — a deck
    // that parses and means something else. Asserted directly.
    const { text } = battery({ volts: 1.45 });
    const card = /^VBT1 \S+ \S+ DC (.*)$/m.exec(text);
    assert.ok(card, text);
    assert.equal(card[1], '1.45', `the DC field must carry the EMF, got "${card[1]}"`);
    assert.ok(!/_EMF/.test(card[1]), 'and not a node name');
  });

  it('says so, because a derived value is an adaptation and not a translation', () => {
    const { out } = battery({ volts: 1.45 });
    assert.ok((out.warnings || []).some((w) => /internal resistance/.test(w)
      && /engine's stamp/.test(w)),
    `the derivation must be reported: ${JSON.stringify(out.warnings)}`);
  });

  it('an AUTHORED rInternal wins over the engine default', () => {
    // A number a person wrote is the one they meant.
    const { text, out } = battery({ volts: 1.45, rInternal: 1 });
    assert.match(text, /^RBT1_INT BT1_EMF \S+ 1$/m, text);
    assert.ok(!(out.warnings || []).some((w) => /engine's stamp/.test(w)),
      'an authored value needs no such warning');
  });

  it('and the deck now answers the engine\'s question', () => {
    const { circuit, solved } = battery({ volts: 1.45 });
    const posNet = solved.nets.find((n) => (n.nodes || []).some(
      (nd) => nd.partId === 'RL' && nd.pin === 'a'));
    const v = circuit.nodeVoltage(posNet.id);
    const expected = 1.45 * 21 / 21.3;
    assert.ok(Math.abs(v - expected) < 1e-5,
      `engine ${v} V, EMF*21/21.3 = ${expected} V — and the deck now states both cards`);
  });

  it('no companions hook, or a non-converged one, leaves an ideal source', () => {
    // The refusal side: a derived value is only trustworthy if the solve that
    // produced it converged, and `null` must not become a 0 Ohm resistor.
    const c = Circuit.fromJSON({
      parts: [
        { id: 'cell1', kind: 'battery_aa', params: { volts: 1.45 }, x: 0, y: 0 },
        { id: 'RL', kind: 'resistor', params: { ohms: 21 }, x: 0, y: 0 },
        { id: 'G1', kind: 'gnd', params: {}, x: 0, y: 0 },
      ],
      wires: [
        { from: 'cell1', fromTerminal: 'pos', to: 'RL', toTerminal: 'a' },
        { from: 'RL', fromTerminal: 'b', to: 'G1', toTerminal: 'gnd' },
        { from: 'cell1', fromTerminal: 'neg', to: 'G1', toTerminal: 'gnd' },
      ],
    });
    c.setPower(true);
    for (const hook of [null, () => null, () => []]) {
      const out = toSpice(extractNetlist(c), 'batt', { companionsFor: hook });
      const text = typeof out === 'string' ? out : out.text;
      assert.ok(!/_EMF/.test(text), `hook ${String(hook)} must leave an ideal source:\n${text}`);
      assert.ok(!/RBT1_INT/.test(text), text);
    }
  });
});

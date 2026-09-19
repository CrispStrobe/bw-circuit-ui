/**
 * TWO IDEAL SOURCES ACROSS ONE NODE PAIR IS A SINGULAR MATRIX, AND THE DECK
 * WAS WRITING SEVEN.
 *
 * With `capacitorVoltage`, a capacitor is exported as a source at the voltage
 * the engine holds it at -- deliberately, so the deck answers the same question
 * the engine did rather than `.op`'s open-capacitor one. But a decoupling
 * capacitor sits across the SUPPLY, and the rail is already an ideal source
 * there.
 *
 * `eater6502-full-build` has six of them across VCC and ground. The deck
 * carried `V1_SUPPLY VCC 0 DC 5` plus `VC1..VC6 VCC 0 DC 5`, and ngspice
 * answered `singular matrix: check node vc1#branch`, then "Dynamic gmin
 * stepping failed", then "True gmin stepping failed", and printed NO NODE TABLE
 * AT ALL. The row read `ngspice refused` for as long as the example has
 * existed.
 *
 * The second source carries no information -- the pair's potential difference
 * is already determined -- so it is dropped and NAMED in the deck. With the six
 * gone, ngspice solves: 43 nodes compared, every voltage agreeing to 16 uV.
 *
 * AND THE ENGINE STILL HAS ALL SIX, which is the second half. Its rail-current
 * reader summed an indeterminate split into 5.000007e+4 A against ngspice's
 * 6.515200e-2 A -- 50 kA. No tolerance makes those the same reading, and
 * neither is wrong: a current split between parallel ideal sources is
 * undefined. So the harness DECLINES that one branch comparison where the
 * exporter has reported dropping a redundant source on the pair, and says so.
 * The node voltages remain the comparison.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/model/circuit.js';
import { extractNetlist } from '../src/model/netlist.js';
import { toSpice } from '../src/model/exporters/spice.js';

/** n capacitors across the rail, each held at `volts` by the caller's stub. */
const deckFor = (n, volts = 5) => {
  const parts = [
    { id: 'v1', kind: 'vcc', params: {} },
    { id: 'g1', kind: 'gnd', params: {} },
    { id: 'r1', kind: 'resistor', params: { ohms: 1000 } },
  ];
  const wires = [
    { id: 'wr1', from: { part: 'v1', terminal: 'vcc' }, to: { part: 'r1', terminal: 'a' } },
    { id: 'wr2', from: { part: 'r1', terminal: 'b' }, to: { part: 'g1', terminal: 'gnd' } },
  ];
  for (let i = 1; i <= n; i++) {
    parts.push({ id: `c${i}`, kind: 'capacitor', params: { farads: 1e-7 } });
    wires.push({ id: `wa${i}`, from: { part: 'v1', terminal: 'vcc' }, to: { part: `c${i}`, terminal: 'a' } });
    wires.push({ id: `wb${i}`, from: { part: `c${i}`, terminal: 'b' }, to: { part: 'g1', terminal: 'gnd' } });
  }
  const c = Circuit.fromJSON({ parts, wires });
  return toSpice(extractNetlist(c), 'parallel ideal sources',
    { capacitorVoltage: () => volts });
};

const vCards = (text) => text.split('\n').filter((l) => /^V\S+\s/.test(l));

describe('the deck never puts two ideal sources across one pair', () => {
  it('writes the rail and drops every capacitor that would duplicate it', () => {
    const out = deckFor(6);
    const rails = vCards(out.text).filter((l) => /_SUPPLY/.test(l));
    const caps = vCards(out.text).filter((l) => /^VC\d/i.test(l));
    assert.equal(rails.length, 1, out.text);
    assert.deepEqual(caps, [], `no capacitor source may join the rail's pair: ${out.text}`);
    assert.equal((out.redundantSources || []).length, 6,
      JSON.stringify(out.redundantSources));
    // And the deck SAYS so, once per capacitor, with the number it was holding
    // and what already fixes the pair -- a silent drop would be a deck that
    // quietly models a different circuit.
    assert.equal((out.text.match(/is not written/g) || []).length, 6, out.text);
    assert.match(out.text, /already fixed at 5 V by V1_SUPPLY/, out.text);
  });

  it('reports a stored voltage that CONTRADICTS the rail rather than hiding it', () => {
    // If the engine holds a rail capacitor at something other than the rail,
    // that is a fact about the engine's state, and dropping the source would
    // otherwise conceal it.
    const out = deckFor(1, 3.3);
    assert.equal((out.redundantSources || []).length, 1);
    assert.ok((out.warnings || []).some((w) => /holds it at 3\.3 V while V1_SUPPLY/.test(w)),
      JSON.stringify(out.warnings));
  });

  it('still writes a capacitor whose pair nothing else fixes', () => {
    // THE CONTROL. A coupling capacitor between two ordinary nodes is exactly
    // what `capacitorVoltage` exists for, and must keep its source -- otherwise
    // this rule would delete the feature it is protecting.
    const c = Circuit.fromJSON({
      parts: [
        { id: 'v1', kind: 'vcc', params: {} },
        { id: 'g1', kind: 'gnd', params: {} },
        { id: 'r1', kind: 'resistor', params: { ohms: 1000 } },
        { id: 'r2', kind: 'resistor', params: { ohms: 2000 } },
        { id: 'c1', kind: 'capacitor', params: { farads: 1e-6 } },
      ],
      wires: [
        { id: 'w1', from: { part: 'v1', terminal: 'vcc' }, to: { part: 'r1', terminal: 'a' } },
        { id: 'w2', from: { part: 'r1', terminal: 'b' }, to: { part: 'c1', terminal: 'a' } },
        { id: 'w3', from: { part: 'c1', terminal: 'b' }, to: { part: 'r2', terminal: 'a' } },
        { id: 'w4', from: { part: 'r2', terminal: 'b' }, to: { part: 'g1', terminal: 'gnd' } },
      ],
    });
    const out = toSpice(extractNetlist(c), 'coupling cap', { capacitorVoltage: () => 1.25 });
    assert.equal((out.redundantSources || []).length, 0, JSON.stringify(out.redundantSources));
    assert.ok(vCards(out.text).some((l) => /^VC1\s/i.test(l)),
      `a capacitor between two ordinary nodes keeps its source: ${out.text}`);
  });
});

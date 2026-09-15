/**
 * A CARD THAT RUNS IS NOT A CARD THAT DESCRIBES THE DEVICE.
 *
 * `tip120` is not an `npn` with a large beta. bw-board registers its own stamp
 * for the kind (`devices/analog-ics.js`): a THRESHOLD SWITCH that conducts when
 * Vbe exceeds `vbe` (1.4 V, the Darlington's two drops), clamps Vce through
 * `rceSat`, and draws NO BASE CURRENT. An Ebers-Moll `.model ... NPN` card
 * expresses none of that — no threshold, no saturation resistance, and its base
 * does draw current.
 *
 * The deck still simulates, and that is the whole problem: nothing downstream
 * notices, so the difference is scored against the solver. Measured on
 * `33-inductive-no-flyback`, the largest disagreement in the 2,131-circuit
 * gallery:
 *
 *   V(base)   engine 4.949270 V   ngspice 0.696071 V   delta 4.25 V
 *   V(coll)   engine 0.833194 V   ngspice 0.126525 V
 *
 * The engine's base sits near the drive rail because the switch draws nothing;
 * ngspice's sits at a conducting junction. Both conduct ~0.45 A, because the
 * 10 Ohm motor dominates — which is why this looked like a solver error for as
 * long as it did. It sent me to the GMIN work, to the node shunt, and to a
 * stale deck in /tmp before the two devices were compared.
 *
 * So the exporter DECLARES it. The oracle folds `approximated` into the same
 * set as `skipped`, and the per-node rule then refuses at the transistor's own
 * nodes with a reason that names the cause. Measured cost: zero — the only two
 * gallery circuits carrying a `tip120` already disagreed, and the gallery total
 * is unchanged at 2,112 of 2,131.
 *
 * WHAT THIS IS NOT. It is not a claim that the export is useless: the card runs
 * and a reader asking "roughly, a power transistor here" gets that. The deeper
 * fix is either a Darlington pair in the deck or a real Darlington in the
 * engine, and neither is this change.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/model/circuit.js';
import { extractNetlist } from '../src/model/netlist.js';
import { toSpice } from '../src/model/exporters/spice.js';

/** A driven transistor of the given kind, wired collector-load to a rail. */
const deckFor = (kind) => {
  const c = Circuit.fromJSON({
    parts: [
      { id: 'v1', kind: 'vcc', params: {} },
      { id: 'g1', kind: 'gnd', params: {} },
      { id: 'rc1', kind: 'resistor', params: { ohms: 100 } },
      { id: 'rb1', kind: 'resistor', params: { ohms: 1000 } },
      { id: 'q1', kind, params: {} },
    ],
    wires: [
      { id: 'w1', from: { part: 'v1', terminal: 'vcc' }, to: { part: 'rc1', terminal: 'a' } },
      { id: 'w2', from: { part: 'rc1', terminal: 'b' }, to: { part: 'q1', terminal: 'collector' } },
      { id: 'w3', from: { part: 'v1', terminal: 'vcc' }, to: { part: 'rb1', terminal: 'a' } },
      { id: 'w4', from: { part: 'rb1', terminal: 'b' }, to: { part: 'q1', terminal: 'base' } },
      { id: 'w5', from: { part: 'q1', terminal: 'emitter' }, to: { part: 'g1', terminal: 'gnd' } },
    ],
  });
  return toSpice(extractNetlist(c), `tip120 approximation (${kind})`);
};

describe('the exporter declares a card that is not the device', () => {
  it('names the tip120 card an approximation, and names what it cannot express', () => {
    const out = deckFor('tip120');
    // The card IS written -- this is not a refusal to export.
    assert.match(out.text, /^Q\S*\s+\S+\s+\S+\s+\S+\s+TIP120/m, out.text);
    assert.match(out.text, /\.model TIP120 NPN/, out.text);
    assert.deepEqual(out.skipped, [], 'the part is exported, not skipped');

    const declared = (out.approximated || []).filter((a) => /tip120/.test(String(a)));
    assert.equal(declared.length, 1, JSON.stringify(out.approximated));
    // The reason must name the two parameters the engine's stamp reads and the
    // card cannot hold. Naming only "approximate" would be a warning nobody
    // could act on.
    assert.match(declared[0], /\bvbe\b/, declared[0]);
    assert.match(declared[0], /\brceSat\b/, declared[0]);
    assert.match(declared[0], /^Q1 \(tip120\)/, declared[0]);
  });

  it('leaves an ordinary npn undeclared, so the flag means something', () => {
    // THE CONTROL. Without it, `approximated` could be a list every transistor
    // joins, which refuses every BJT circuit in the corpus and would have cost
    // hundreds of agreeing decks rather than the measured zero.
    const out = deckFor('npn');
    assert.match(out.text, /\.model \S+ NPN/, out.text);
    assert.deepEqual(out.approximated || [], [],
      'an npn IS an Ebers-Moll device; its card describes it');
  });

  it('is a field the oracle can read, not prose in a warning', () => {
    // The oracle folds these refdeses into the same set as `skipped`, so the
    // entry has to START with the refdes the way `skipped` entries do --
    // `String(entry).split(' ')[0]` is how both are read.
    const out = deckFor('tip120');
    assert.equal(String((out.approximated || [])[0]).split(' ')[0], 'Q1');
    assert.ok(Array.isArray(out.approximated), 'always an array, even when empty');
    assert.ok(Array.isArray(deckFor('npn').approximated));
  });
});

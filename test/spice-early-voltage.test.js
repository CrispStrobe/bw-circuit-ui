/**
 * VAF CROSSES BOTH BOUNDARIES OR IT IS WORSE THAN ABSENT.
 *
 * bw-board's Ebers-Moll stamp now carries a forward Early voltage, and that
 * makes VAF a value with two crossings to get right:
 *
 *   IMPORT   a foreign deck's `.MODEL Q NPN (... VAF=100 ...)` must land on the
 *            part, or the engine solves a transistor the deck did not describe.
 *   EXPORT   a part carrying `vaf` must put `Vaf=` in the deck, or the deck
 *            describes a transistor the engine does not solve.
 *
 * The second is not hypothetical symmetry -- it is the authored-beta defect
 * with a different field name, and that one cost 59 mV on a real gallery
 * circuit before `spice-export-authored-beta` caught it.
 *
 * WHAT THE PARAMETER IS WORTH, measured over all 7,410 ADI2005 v2 decks: 700
 * declare VAF on a BJT, and with the engine term forced off 82 of those 700
 * disagree with ngspice numerically while with it none do -- 82 converted, 0
 * regressed. The family that led me to it is "BJT Emitter Follower", whose card
 * declares VAF=100 against a 22 MOhm base feed: ngspice reads V(BASE) 1.022540,
 * we read 1.006830, a 15.7 mV gap that is 30x the comparator's tolerance.
 * Removal test: with VAF deleted from the card the two engines agree, with IKF
 * or RC deleted instead the gap is unchanged. So one term was the whole of it.
 *
 * (The first count I quoted was 59, which was the BASE-node disagreements in
 * the first 2,000 decks only. Measuring the whole release found 82.)
 *
 * THE CONTROL IS THE IMPORTANT TEST HERE. A deck with no VAF must import to a
 * part with no `vaf`, and a part with no `vaf` must export the shared card --
 * because the engine's default is Infinity, and any value that reaches the part
 * by accident changes every answer that was already right.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { importSpice } from '../src/importers/spice.js';
import { Circuit } from '../src/model/circuit.js';
import { extractNetlist } from '../src/model/netlist.js';
import { toSpice } from '../src/model/exporters/spice.js';
import { runSourceAnalyses } from '../src/model/source-analysis.js';

/** The corpus family, as a deck, with the model body the caller wants. */
const followerDeck = (body) => [
  '* BJT Emitter Follower',
  `.MODEL Q2N2222 NPN (${body})`,
  'V1 VCC 0 DC 5.0',
  'RB1 VCC BASE 22Meg',
  'RE1 EMIT 0 12k',
  'Q1 VCC BASE EMIT Q2N2222',
  '.op',
].join('\n');

const bjtOf = (out) => out.parts.find(p => /^Q/i.test(String(p.id || '')));

describe('the strict public NPN operating-point route', () => {
  it('runs a complete imported card with signed source current and explicit model metadata', () => {
    const imported = importSpice(followerDeck('IS=1e-14 BF=100 VAF=100'));
    const [run] = runSourceAnalyses(imported, { format: 'spice' });
    assert.equal(run.status, 'pass', JSON.stringify(run));
    assert.equal(run.evidence, 'original-direct');
    assert.ok(run.metadata.supportedKinds.includes('npn'));
    assert.deepEqual(run.metadata.npn, {
      model: 'explicit-ebers-moll-with-forward-early-effect',
      requiredParameters: ['is', 'beta'], optionalParameters: ['br', 'n', 'vaf'],
      defaults: { br: 1, n: 1, vaf: 'infinite' }, thermalVoltage: 0.02585,
      temperatureModel: 'fixed',
    });
    assert.ok(Math.abs(run.observables.nodes.find(node => node.id === 'n2').voltage
      - 0.24137665774331285) < 1e-10);
    assert.deepEqual(run.observables.sourceCurrents.map(row => row.id), ['s0']);
    assert.ok(Math.abs(run.observables.sourceCurrents[0].current
      + 2.0114721478609492e-5) < 1e-12);
  });

  it('keeps incomplete and retained-extra NPN semantics as named refusals', () => {
    const incomplete = importSpice(followerDeck('BF=100 VAF=100'));
    const [missingRun] = runSourceAnalyses(incomplete, { format: 'spice' });
    assert.equal(missingRun.status, 'refused');
    assert.match(missingRun.detail, /model must be explicitly 'shockley'/);

    const extra = importSpice(followerDeck('IS=1e-14 BF=100 VAF=100'));
    bjtOf(extra).params.ikf = 0.3;
    const [extraRun] = runSourceAnalyses(extra, { format: 'spice' });
    assert.equal(extraRun.status, 'refused');
    assert.match(extraRun.detail, /parameter ikf is outside the explicit Ebers-Moll DC domain/);
  });
});

describe('importing a forward Early voltage', () => {
  it('lands VAF on the part, beside the Is that put it on the exponential path', () => {
    const out = importSpice(followerDeck('IS=1e-14 BF=200 VAF=100 IKF=0.3 RC=0.3 CJC=8p'));
    const q = bjtOf(out);
    assert.equal(q.params.vaf, 100);
    assert.equal(q.params.model, 'shockley', 'VAF is only meaningful on the Ebers-Moll path');
    assert.equal(q.params.beta, 200);
    assert.equal(q.params.is, 1e-14);
  });

  it('leaves `vaf` ABSENT when the card does not state it', () => {
    // The control, and the whole safety property: the engine reads Infinity
    // when the key is missing, so a key appearing by accident -- a default, a
    // stale object, a `?? 100` -- would move every BJT answer in the corpus.
    const out = importSpice(followerDeck('IS=1e-14 BF=200 IKF=0.3'));
    const q = bjtOf(out);
    assert.equal('vaf' in q.params, false, `no vaf key may appear: ${JSON.stringify(q.params)}`);
  });

  it('does not invent VAF for a piecewise card that states no Is', () => {
    // No Is means no Ebers-Moll, and VAF on a piecewise knee is a parameter
    // with nothing to multiply. It must not be carried into a model that
    // cannot express it.
    const out = importSpice(followerDeck('BF=200 VAF=100'));
    const q = bjtOf(out);
    assert.equal('vaf' in q.params, false, `${JSON.stringify(q.params)}`);
    assert.notEqual(q.params.model, 'shockley');
  });
});

describe('exporting a part that carries one', () => {
  const deckFor = (params) => {
    const c = Circuit.fromJSON({
      parts: [
        { id: 'v1', kind: 'vcc', params: {} },
        { id: 'g1', kind: 'gnd', params: {} },
        { id: 'rc1', kind: 'resistor', params: { ohms: 100 } },
        { id: 'rb1', kind: 'resistor', params: { ohms: 10000 } },
        { id: 'q1', kind: 'npn', params },
      ],
      wires: [
        { id: 'w1', from: { part: 'v1', terminal: 'vcc' }, to: { part: 'rc1', terminal: 'a' } },
        { id: 'w2', from: { part: 'rc1', terminal: 'b' }, to: { part: 'q1', terminal: 'collector' } },
        { id: 'w3', from: { part: 'v1', terminal: 'vcc' }, to: { part: 'rb1', terminal: 'a' } },
        { id: 'w4', from: { part: 'rb1', terminal: 'b' }, to: { part: 'q1', terminal: 'base' } },
        { id: 'w5', from: { part: 'q1', terminal: 'emitter' }, to: { part: 'g1', terminal: 'gnd' } },
      ],
    });
    return toSpice(extractNetlist(c), 'early voltage').text;
  };

  it('states Vaf in a per-part card, and says why', () => {
    const text = deckFor({ beta: 100, is: 1e-14, vaf: 75 });
    assert.match(text, /^\.model Q_Q1 NPN \([^)]*\bVaf=75\b[^)]*\)/m, text);
    assert.match(text, /^Q1\s+\S+\s+\S+\s+\S+\s+Q_Q1\b/m, text);
    assert.match(text, /authored Early voltage 75/, text);
  });

  it('carries an authored beta AND an authored VAF in the same card', () => {
    // Two substitutions into one body: the earlier code path replaced Bf and
    // returned, so a part with both would have exported only one of them.
    const text = deckFor({ beta: 200, is: 1e-14, vaf: 100 });
    const card = /^\.model Q_Q1 NPN \(([^)]*)\)/m.exec(text);
    assert.ok(card, text);
    assert.match(card[1], /Bf=200/);
    assert.match(card[1], /Vaf=100/);
  });

  it('leaves a part with no VAF on the shared card, with no Vaf field', () => {
    // THE CONTROL. Every shipped circuit is this case, so this assertion is
    // what says the feature costs nothing: no per-part model, no Vaf, and the
    // library card still governs.
    const text = deckFor({ beta: 100, is: 1e-14 });
    assert.ok(!/\bVaf\s*=/i.test(text), `no Vaf may appear: ${text}`);
    assert.ok(!/\.model Q_Q1\b/.test(text), `no per-part card is needed: ${text}`);
    assert.match(text, /^\.model Q_DEFAULT NPN \(/m, text);
  });

  it('ignores a zero or negative authored VAF, as SPICE and the engine do', () => {
    for (const vaf of [0, -12]) {
      const text = deckFor({ beta: 100, is: 1e-14, vaf });
      assert.ok(!/\bVaf\s*=/i.test(text), `VAF=${vaf} means no Early effect: ${text}`);
    }
  });
});

describe('the round trip', () => {
  it('import then export puts the deck\'s own VAF back in the deck', () => {
    // End to end over both crossings: a foreign deck's VAF must survive into
    // the deck we hand the oracle, or the comparison is between two different
    // devices no matter how good either engine is.
    const out = importSpice(followerDeck('IS=1e-14 BF=200 VAF=100'));
    const c = Circuit.fromJSON({ parts: out.parts, wires: out.wires });
    const text = toSpice(extractNetlist(c), 'round trip').text;
    const card = /^\.model \S+ NPN \(([^)]*)\)/m.exec(text);
    assert.ok(card, text);
    assert.match(card[1], /Vaf=100\b/, `the deck must state the VAF it came in with: ${text}`);
  });
});

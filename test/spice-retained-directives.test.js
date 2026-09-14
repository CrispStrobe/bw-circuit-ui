/**
 * DIRECTIVES KEPT VERBATIM AND DELIBERATELY NOT EXECUTED.
 *
 * `.four`, `.meas`, `.print`, `.plot`, `.save` and `.probe` used to fall into
 * `BENIGN_CARDS` and land in `ignored` — where nothing can tell "deliberately
 * retained" from "fell through". That is the same complaint this importer's
 * refusal reasons exist to avoid, present in its own output.
 *
 * They now appear in `retainedDirectives`, a shape agreed with the
 * source-analysis lane so one reader serves both:
 *
 *   { source, kind: 'output-request' | 'metadata',
 *     handling: 'preserved-not-executed', consequence }
 *
 * `ignored` keeps only what genuinely had no consequence.
 *
 * TWO SUBSTANTIVE DECISIONS, both measured over the corpora first.
 *
 * `.four` IS NOT AN ANALYSIS. It is a Fourier decomposition OF a transient
 * result and needs a `.tran` to have run, so a deck carrying only `.four` had
 * been counted as having declared an analysis. Removed from `ANALYSIS_CARDS`.
 *
 * `.options` SPLITS BY KEY. A presentation key changes the report; anything
 * else changes the answer. `gshunt` is the one to keep in mind — it adds a
 * conductance from every node to the reference, which this programme measured
 * as worth volts on a floating node — and `reltol`, `abstol`, `vntol`,
 * `gminsteps`, `srcsteps` and `maxstep` all move the solver.
 *
 * Corpus reach, measured before the change rather than after:
 *
 *   ADI2005 v3   12,471 decks:  1 carries .options (gminsteps, srcsteps),
 *                               0 .four, 0 .meas, 0 print/plot/save/probe
 *   Si7li        7,866 decks:  143 carry .options, 639 .meas, 28 .four,
 *                               15 print/plot/save/probe
 *   .options keys in Si7li:     plotwinsize 92, numdgt 22, gminsteps 13,
 *                               maxstep 8, measdgt 7, gshunt 7, reltol 7
 *
 * **`temp` appears in neither corpus**, which is why treating the rest as a
 * loss is affordable: a deck declaring its own temperature is the case that
 * would have made this expensive, and it does not occur.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { importSpice } from '../src/importers/spice.js';

const base = '*t\nV1 a 0 5\nR1 a 0 1k\n';
const deck = (...extra) => importSpice(base + extra.join('\n') + '\n.end\n');
const kinds = (r) => (r.retainedDirectives || []).map((d) => d.kind);

describe('output requests are retained, named, and not executed', () => {
  for (const card of ['.four 1k v(a)', '.meas tran x FIND v(a) AT=1u',
    '.print tran v(a)', '.plot v(a)', '.save v(a)', '.probe v(a)']) {
    it(`${card.split(' ')[0]} is an output-request`, () => {
      const r = deck('.op', card);
      assert.deepEqual(kinds(r), ['output-request'], JSON.stringify(r.retainedDirectives));
      const d = r.retainedDirectives[0];
      assert.equal(d.source, card);
      assert.equal(d.handling, 'preserved-not-executed');
      assert.match(d.consequence, /not executed by source-analysis/);
      assert.deepEqual(r.losses, [], 'an output request is not a semantic loss');
      // And it must NOT also be sitting in `ignored`, or the split is cosmetic.
      assert.ok(!(r.ignored || []).some((l) => l === card),
        `${card} must not be in both buckets: ${JSON.stringify(r.ignored)}`);
    });
  }

  it('.four is NOT counted as a declared analysis', () => {
    const only = deck('.four 1k v(a)');
    assert.deepEqual(only.analyses, [],
      '.four alone declares no analysis — it decomposes a transient result');
    const withTran = deck('.tran 1u 1m', '.four 1k v(a)');
    assert.deepEqual(withTran.analyses, ['.tran 1u 1m']);
    assert.deepEqual(kinds(withTran), ['output-request']);
  });
});

describe('.options splits by key: presentation is retained, numerics are a loss', () => {
  for (const key of ['plotwinsize=0', 'numdgt=7', 'measdgt=3']) {
    it(`${key} is metadata`, () => {
      const r = deck('.op', `.options ${key}`);
      assert.deepEqual(kinds(r), ['metadata'], JSON.stringify(r.retainedDirectives));
      assert.match(r.retainedDirectives[0].consequence, /presentation only/);
      assert.deepEqual(r.losses, []);
    });
  }

  for (const key of ['gshunt=1e-12', 'reltol=1e-6', 'abstol=1e-15',
    'gminsteps=10', 'srcsteps=10', 'maxstep=1n']) {
    it(`${key} is a LOSS, because it changes the answer`, () => {
      const r = deck('.op', `.options ${key}`);
      assert.equal(r.losses.length, 1, JSON.stringify(r.losses));
      assert.equal(r.losses[0].kind, 'unsupported-solver-option');
      assert.match(r.losses[0].reason, /changes the solve, not the report/);
      assert.deepEqual(kinds(r), [], 'a numerical option is not retained metadata');
    });
  }

  it('a MIXED .options line is a loss, naming only the numerical keys', () => {
    // The dangerous case: one presentation key must not launder the rest.
    const r = deck('.op', '.options plotwinsize=0 reltol=1e-6');
    assert.equal(r.losses.length, 1, JSON.stringify(r.losses));
    assert.match(r.losses[0].reason, /reltol=1e-6/);
    assert.ok(!/plotwinsize/.test(r.losses[0].reason),
      `the reason should name what is unsupported, not what is fine: ${r.losses[0].reason}`);
  });

  it('a bare .options with no keys is a loss, not silently fine', () => {
    const r = deck('.op', '.options');
    assert.equal(r.losses.length, 1, JSON.stringify(r.losses));
    assert.match(r.losses[0].reason, /carries no keys/);
  });

  it('gshunt is called out, because it is the one that moves a floating node', () => {
    // Not a behaviour assertion — a documentation one. If someone later moves
    // gshunt into the presentation set, this fires.
    const r = deck('.op', '.options gshunt=1e-9');
    assert.equal(r.losses.length, 1,
      'gshunt adds a conductance from every node to the reference and can never '
      + 'be presentation-only');
  });
});

describe('a deck with none of these is unchanged', () => {
  it('reports an empty retainedDirectives and no new losses', () => {
    const r = deck('.op');
    assert.deepEqual(r.retainedDirectives, []);
    assert.deepEqual(r.losses, []);
    assert.deepEqual(r.analyses, ['.op']);
  });
});

/**
 * `;` and `$` end-of-line comments — two characters, two DIFFERENT rules.
 *
 * Every expectation here was measured with ngspice 44 and is quoted with the
 * deck that produced it, because the two rules are asymmetric in a way no
 * amount of reading the manual settles:
 *
 *   R1 a b 1k;nospace   -> b = 3.750000e+00
 *        ';' ends the line with no preceding whitespace.
 *
 *   R1 a b;x 1k         -> "Warning: 'r1 a b' is not a valid resistor
 *                           instance line, ignored!"
 *        ';' ends the line MID-TOKEN too -- the card is then too short and
 *        ngspice drops it entirely.
 *
 *   R1 a b$x 1k         -> node 'b$x' = 3.750000e+00
 *        '$' inside a token is an ORDINARY CHARACTER. It opens a comment only
 *        at the start of a token.
 *
 * A single rule for both is wrong whichever way it is written. The importer
 * once required whitespace before either, which refused the first deck and
 * silently mis-wired the second; a blanket rule with no whitespace requirement
 * would instead truncate `U$1 MOUNTINGHOLE2.5` and node names like
 * `Net-_J202-PadP$3_`, both of which occur in the KiCad and Eagle exports in
 * the corpus.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { importSpice } from '../src/importers/spice.js';

const netNames = (r) => (r.netNames || []).map((n) => n.name);

describe('inline comments: the semicolon', () => {
  it('ends the line with NO preceding whitespace, and the deck still imports', () => {
    const r = importSpice('*t\nV1 a 0 5\nR1 a b 1k;nospace\nR2 b 0 3k\n.op\n.end\n');
    assert.deepEqual(r.losses, [], 'ngspice solves this deck; so must we');
    assert.deepEqual(r.unmapped, []);
    assert.equal(r.parts.find((p) => p.id === 'R1').params.ohms, 1000,
      'the comment must not become part of the value');
    assert.deepEqual(netNames(r).sort(), ['0', 'a', 'b']);
  });

  it('ends the line MID-TOKEN, leaving a card too short — which must be REFUSED', () => {
    // The failure this replaced was not a refusal, it was a SILENT WRONG
    // TOPOLOGY: a node called `b;x` appeared alongside `b`, so the divider was
    // split into two disconnected halves and nothing was reported.
    const r = importSpice('*t\nV1 a 0 5\nR1 a b;x 1k\nR2 b 0 3k\n.op\n.end\n');
    assert.ok(r.losses.length > 0,
      'a two-field R card is not a resistor; ngspice drops the line');
    assert.ok(!netNames(r).some((n) => n.includes(';')),
      `no net name may contain a comment character: ${netNames(r).join(', ')}`);
  });

  it('ends the line when spaced, as it always did', () => {
    const r = importSpice('*t\nV1 a 0 5\nR1 a b 1k ; spaced 999\nR2 b 0 3k\n.op\n.end\n');
    assert.deepEqual(r.losses, []);
    assert.equal(r.parts.find((p) => p.id === 'R1').params.ohms, 1000);
  });

  it("strips LTspice's exported pin annotation, the corpus's commonest case", () => {
    // 6,390 lines across the Si7li corpus carry one of these.
    const r = importSpice(
      '*t\nV1 a 0 5\nR1 a b 1k ;pnba In+)In-)V+)V-)OUT\nR2 b 0 3k\n.op\n.end\n');
    assert.deepEqual(r.losses, []);
    assert.deepEqual(netNames(r).sort(), ['0', 'a', 'b']);
  });
});

describe('inline comments: the dollar', () => {
  it('is an ORDINARY CHARACTER inside a token — a node name survives it', () => {
    const r = importSpice('*t\nV1 a 0 5\nR1 a b$x 1k\nR2 b$x 0 3k\n.op\n.end\n');
    assert.deepEqual(r.losses, []);
    assert.deepEqual(r.unmapped, []);
    assert.ok(netNames(r).includes('b$x'),
      `node 'b$x' must survive: ${netNames(r).join(', ')}`);
    assert.equal(netNames(r).length, 3, 'and the divider must stay in one piece');
  });

  it('is an ordinary character inside a REFDES too', () => {
    // KiCad and Eagle write these: `U$1 MOUNTINGHOLE2.5`, `R$7`, `C$12`.
    const r = importSpice('*t\nV1 a 0 5\nR$7 a b 1k\nR2 b 0 3k\n.op\n.end\n');
    assert.deepEqual(r.unmapped, []);
    assert.ok(r.parts.some((p) => p.id === 'R$7'),
      `refdes R$7 must survive: ${r.parts.map((p) => p.id).join(', ')}`);
  });

  it('opens a comment at the start of a token', () => {
    const r = importSpice('*t\nV1 a 0 5\nR1 a b 1k $ tail 999\nR2 b 0 3k\n.op\n.end\n');
    assert.deepEqual(r.losses, []);
    assert.equal(r.parts.find((p) => p.id === 'R1').params.ohms, 1000);
  });

  it('opens a comment at the start of a LINE', () => {
    const r = importSpice('*t\nV1 a 0 5\n$ a whole comment line\nR1 a b 1k\nR2 b 0 3k\n.op\n.end\n');
    assert.deepEqual(r.losses, []);
    assert.equal(r.parts.length, 4);
  });
});

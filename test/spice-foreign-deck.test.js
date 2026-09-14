/**
 * A FOREIGN SPICE DECK, IMPORTED, SOLVED, AND JUDGED BY NGSPICE.
 *
 * The corpus lane acquired tens of thousands of valued decks and almost none
 * of them were reachable: `judgeCase` starts from a bw-circuit-ui circuit JSON
 * and `judgeRoundTrip` starts from one too, so both judge OUR decks. A foreign
 * `.cir` had no path in at all, and "how many can we run" was a question about
 * the harness rather than about the engine.
 *
 * Measured on ADI2005 v3 (12,471 valued decks, all with analysis cards) as each
 * blocker fell:
 *
 *     nothing compared, no path                      0.0 %
 *     + the deck's own node names kept              43.5 %
 *     + `AC 1` is not a DC bias                     ...
 *     + sweeps commented out so `.op` is the table  79.0 %
 *
 * The three tests below are one per blocker, on self-authored decks, because a
 * corpus row is neither redistributable nor a stable fixture.
 */
import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importSpice } from '../src/importers/spice.js';
import { judgeForeignDeck, haveNgspice } from '../scripts/spice-oracle.mjs';

const NG = haveNgspice();

test('the importer keeps the deck\'s own node names', () => {
  // Without this the engine calls the net `net-lgc-1`, ngspice calls it `vdd`,
  // and a comparison by name finds zero shared nodes — which reads as a
  // harness failure and is really a dropped fact. 195 of 200 ADI decks.
  const r = importSpice('*t\nV1 VDD 0 DC 5\nR1 VDD OUT 1k\nR2 OUT 0 1k\n.op\n.end');
  assert.ok(Array.isArray(r.netNames), 'importSpice returned no netNames');
  const names = r.netNames.map(n => n.name).sort();
  assert.deepEqual(names, ['0', 'OUT', 'VDD']);
  // Each carries the terminals on it, so a consumer can join to the engine's
  // netlist through any one of them without a shared naming convention.
  const vdd = r.netNames.find(n => n.name === 'VDD');
  assert.ok(vdd.terminals.some(t => t.partId === 'R1'),
    `VDD names no R1 terminal: ${JSON.stringify(vdd)}`);
});

test('`AC 1` is a small-signal magnitude, not a bias', () => {
  // `V1 IN 0 AC 1` has NO DC term, and SPICE solves its operating point at
  // zero. The bare-number fallback took the first numeric field it saw and
  // imported a 1 V source, so every AC-only filter deck disagreed by exactly
  // the magnitude at every node.
  const ac = importSpice('*t\nV1 IN 0 AC 1\nR1 IN 0 1k\n.op\n.end');
  const v1 = ac.parts.find(p => p.id === 'V1');
  assert.equal(v1.params.volts, 0,
    'an AC-only source must bias at 0 V — its number is a magnitude');
  assert.equal(v1.params.acMag, 1, 'the magnitude is kept, not dropped');

  // The counter-examples, so the rule cannot have eaten the DC case.
  const both = importSpice('*t\nV1 IN 0 DC 5 AC 1\nR1 IN 0 1k\n.op\n.end');
  assert.equal(both.parts.find(p => p.id === 'V1').params.volts, 5);
  const bare = importSpice('*t\nV1 IN 0 5\nR1 IN 0 1k\n.op\n.end');
  assert.equal(bare.parts.find(p => p.id === 'V1').params.volts, 5);
});

test('a level-1 MOSFET keeps KP, W, L and LAMBDA', () => {
  // The engine's `mosK` reads `kp` with per-instance `w`/`l` and has since
  // before this; the importer simply never passed them, so a deck stating
  // KP=1e-4 with W=20u L=1u was solved at the fallback k = 0.5 — five hundred
  // times too big.
  const r = importSpice('*t\nVD D 0 DC 5\nM1 D G 0 0 NM W=20u L=1u\n'
    + '.MODEL NM NMOS (LEVEL=1 VTO=1 KP=1.0e-4 LAMBDA=0.005)\n.op\n.end');
  const m = r.parts.find(p => p.id === 'M1');
  assert.equal(m.kind, 'nmos');
  assert.equal(m.params.vth, 1);
  assert.equal(m.params.kp, 1.0e-4);
  assert.equal(m.params.w, 20e-6);
  assert.equal(m.params.l, 1e-6);
  assert.equal(m.params.lambda, 0.005);
});

test('a foreign cascode deck agrees with ngspice', { skip: NG ? false : 'ngspice not installed' }, () => {
  // The bench every MOSFET fix above was measured on. ngspice, on these exact
  // bytes: V(out) 11.40361, V(casc) 4.803472, Id 655 uA. The engine read
  // V(out) 0.0188 before the importer carried KP/W/L, 7.85 before `mosGds`
  // stopped putting a 1 kOhm across the channel, and 11.4161 before LAMBDA.
  const dir = mkdtempSync(join(tmpdir(), 'bw-foreign-'));
  try {
    const deck = [
      '*NMOS Cascode Amplifier',
      'VDD VDD 0 DC 12',
      'VIN IN 0 AC 1m DC 1.8',
      'VBIAS BIAS 0 DC 6.6',
      'RD VDD OUT 910',
      'M1 CASC IN 0 0 NMOS W=20u L=1u',
      'M2 OUT BIAS CASC 0 NMOS W=20u L=1u',
      '.MODEL NMOS NMOS (LEVEL=1 VTO=1 KP=1.0e-4 LAMBDA=0.005)',
      '.OP',
      '.AC DEC 50 1 1Meg',
      '.END',
    ].join('\n');
    const r = judgeForeignDeck('cascode', deck, dir);
    assert.ok(r.compared >= 4, `only ${r.compared} node(s) compared: ${r.lines.join(' | ')}`);
    assert.ok(r.ok, r.lines.join('\n'));
    // The edit is recorded, because a deck we changed is a deck we have to say
    // we changed: the `.ac` sweep would otherwise overwrite the `.op` table.
    assert.ok(r.lines.some(l => /deck edited/.test(l)),
      'the .ac card was commented out and the judge did not say so');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an import loss refuses the case instead of comparing it', { skip: NG ? false : 'ngspice not installed' }, () => {
  // A deck we only partly understood is a DIFFERENT circuit, and agreeing with
  // it would be worse than failing. The judge must refuse by name.
  const dir = mkdtempSync(join(tmpdir(), 'bw-foreign-'));
  try {
    const deck = '*t\nV1 IN 0 PULSE(0 5 0 0 1n 10n 20n)\nR1 IN 0 1k\n.op\n.end';
    const r = judgeForeignDeck('lossy', deck, dir);
    assert.equal(r.ok, false);
    assert.match(r.reason, /loss|unmapped/,
      `expected a refusal naming the loss, got "${r.reason}"`);
    assert.equal(r.compared, 0, 'a refused case must compare nothing');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

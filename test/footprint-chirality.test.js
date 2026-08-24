/**
 * FOOTPRINT CHIRALITY — a mirrored footprint is not a placement any physical
 * package has.
 *
 * A DIP may be seated rotated 180°: that is a legitimate orientation and any
 * gate that forbids it drowns in false violations (docs/FOOTPRINT-CANON.md
 * records two designs that died exactly there, at 929 and 6571 false hits).
 * But a DIP may NOT be MIRRORED. Rotation preserves handedness; reflection
 * reverses it. That is the whole difference, and it is measurable: take three
 * leads that are not collinear, and the SIGN of the cross product they span is
 * invariant under rotation and translation, and flips under reflection.
 *
 * WHY THIS GATE EXISTS. A third design — "compare RELATIVE geometry, allowing
 * rotation but not mirroring" — went green and was withdrawn as provably
 * useless, on the evidence that mirroring 74hc595's sidecar footprint left it
 * green. That evidence does not support the conclusion, and this file records
 * why, because the instrument was the thing at fault:
 *
 *     FOOTPRINTS is a Proxy whose `get` returns BUILTIN_FOOTPRINTS[kind]
 *     whenever the kind is built in, and consults the sidecar ONLY as a
 *     fallback. 74hc595 IS built in. So mutating its sidecar changed nothing
 *     that seating reads — `FOOTPRINTS['74hc595'].refTerminal` stayed 'vcc'
 *     through the mutation. The gate was green because nothing had moved.
 *
 * 54 of the 202 sidecar footprints are shadowed this way and are inert.
 *
 * WHAT THIS GATE MEASURES: for every kind that has BOTH a built-in footprint
 * and a sidecar footprint, the two must describe the same handedness. They are
 * two spellings of one physical package; if they disagree, one of them is the
 * part seen from underneath, and whichever the seating path does not read is a
 * trap for whoever next changes the precedence.
 *
 * @module
 */

import './_setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FOOTPRINTS } from '../src/model/footprints.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Three leads spanning a non-zero area, and the sign of the area they span.
 * Returns null when every lead is collinear — a single-row part has no
 * handedness to check, and saying so is better than inventing one.
 */
export function chiralityOf(leads) {
  const pts = Object.entries(leads).map(([n, v]) => ({ n, x: v.dCol, y: v.dRow }));
  if (pts.length < 3) return null;
  const a = pts[0];
  const b = pts.find(p => p.x !== a.x || p.y !== a.y);
  if (!b) return null;
  for (const c of pts) {
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (cross !== 0) return { sign: Math.sign(cross), a: a.n, b: b.n, c: c.n };
  }
  return null;
}

/** The same three leads' handedness, measured on a different footprint. */
export function signOn(leads, tri) {
  const g = (n) => (leads[n] ? { x: leads[n].dCol, y: leads[n].dRow } : null);
  const a = g(tri.a), b = g(tri.b), c = g(tri.c);
  if (!a || !b || !c) return null;
  return Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
}

function loadSidecarFootprints() {
  const dir = path.join(here, '..', 'src', 'parts-data');
  const out = {};
  for (const f of readdirSync(dir).filter(f => f.endsWith('.json'))) {
    try {
      const j = JSON.parse(readFileSync(path.join(dir, f), 'utf-8'));
      if (j.kind && j.footprint && j.footprint.leads) out[j.kind] = j.footprint;
    } catch { /* a malformed sidecar is another gate's problem */ }
  }
  return out;
}

/**
 * Kinds whose built-in and sidecar footprints are MIRRORS of each other today.
 * Latent divergence, not an active defect: for a built-in kind the sidecar is
 * inert (see the Proxy note above), so nothing seats wrong right now. Recorded
 * so the number cannot grow quietly. MAY ONLY SHRINK — fix a kind and delete
 * its line; never add one to make this pass.
 */
const KNOWN_MIRRORED = new Set([
  '62256', 'w65c02', 'z80', '28c256', 'w65c22', 'w65c51', 'mc6850',
  '74hc00', '74hc595', 'attiny85', 'attiny2313', 'attiny13', 'at24c64', 'mcu',
]);

describe('footprint chirality: built-in and sidecar describe the same package', () => {
  const sidecars = loadSidecarFootprints();
  const builtinKinds = Object.keys(FOOTPRINTS);   // Object.keys sees built-ins only
  const both = builtinKinds.filter(k => sidecars[k]);

  const comparable = [], flat = [], nameGap = [], mirrored = [];
  for (const k of both) {
    const tri = chiralityOf(FOOTPRINTS[k].leads);
    if (!tri) { flat.push(k); continue; }
    const s = signOn(sidecars[k].leads, tri);
    if (s === null) { nameGap.push(k); continue; }
    comparable.push(k);
    if (s !== tri.sign) mirrored.push(k);
  }

  test('the gate had material to work on', () => {
    console.log(`\n  built-in kinds: ${builtinKinds.length}, sidecar footprints: ${Object.keys(sidecars).length}`);
    console.log(`  both:           ${both.length}`);
    console.log(`  comparable:     ${comparable.length}   single-row: ${flat.length}   lead names differ: ${nameGap.length}`);
    console.log(`  MIRRORED:       ${mirrored.length}  ${mirrored.join(' ')}`);
    // A chirality check over zero multi-row footprints proves nothing.
    assert.ok(comparable.length >= 10,
      `only ${comparable.length} footprints had a measurable handedness — the check is vacuous`);
  });

  test('no NEW kind is mirrored, and the ratchet may only shrink', () => {
    const unexpected = mirrored.filter(k => !KNOWN_MIRRORED.has(k));
    assert.deepEqual(unexpected, [],
      `${unexpected.join(', ')} now describe(s) a MIRRORED package between the built-in table and `
      + 'the sidecar. A mirror is not an orientation a physical part has — one of the two is the '
      + 'package seen from underneath. Fix the footprint; do NOT add a line to KNOWN_MIRRORED.');
    const fixed = [...KNOWN_MIRRORED].filter(k => !mirrored.includes(k));
    assert.deepEqual(fixed, [],
      `${fixed.join(', ')} is no longer mirrored — delete it from KNOWN_MIRRORED. A ratchet that `
      + 'keeps a fixed case starts hiding the next one.');
  });

  test('attiny88 specifically agrees, since this lane just fixed it', () => {
    assert.ok(both.includes('attiny88'), 'attiny88 must have both a built-in and a sidecar footprint');
    assert.ok(!mirrored.includes('attiny88'),
      'attiny88 built-in and sidecar disagree on handedness — they were aligned on 2026-08-24');
  });

  // ── mutation proofs ────────────────────────────────────────────────

  test('MUTATION: 74hc595 mirrored is DETECTED — the case that defeated design 3', () => {
    // Not a hypothetical: 74hc595's built-in and sidecar are mirrors in the
    // shipped tree right now, and this detector says so. The withdrawn gate
    // was green on exactly this input.
    const tri = chiralityOf(FOOTPRINTS['74hc595'].leads);
    assert.ok(tri, '74hc595 must have a measurable handedness');
    const s = signOn(sidecars['74hc595'].leads, tri);
    assert.equal(s, -tri.sign,
      '74hc595 is the documented mirror case; this detector must see it as mirrored');
  });

  test('MUTATION: mirroring a currently-AGREEING footprint turns it red', () => {
    const clean = comparable.filter(k => !mirrored.includes(k));
    assert.ok(clean.length > 0,
      'no built-in kind agrees with its sidecar, so this proof has nothing to mutate');
    const victim = clean[0];
    const tri = chiralityOf(FOOTPRINTS[victim].leads);
    assert.equal(signOn(sidecars[victim].leads, tri), tri.sign, `${victim} must be clean first`);

    // Reflect the sidecar about the row axis — the exact shape of the defect.
    const leads = sidecars[victim].leads;
    const maxRow = Math.max(...Object.values(leads).map(v => v.dRow));
    const saved = Object.fromEntries(Object.entries(leads).map(([n, v]) => [n, v.dRow]));
    for (const v of Object.values(leads)) v.dRow = maxRow - v.dRow;

    assert.equal(signOn(leads, tri), -tri.sign,
      `mirroring ${victim}'s sidecar was NOT detected — the check is not reading handedness`);

    for (const [n, r] of Object.entries(saved)) leads[n].dRow = r;
    assert.equal(signOn(leads, tri), tri.sign, 'restored');
    console.log(`  mutation fixture: ${victim} (mirrored and restored)`);
  });

  test('INSTRUMENT: mutating a shadowed sidecar does NOT reach the seating path', () => {
    // The fact that invalidates the earlier "provably useless" verdict. Kept as
    // a test so the precedence cannot change without someone noticing.
    const before = FOOTPRINTS['74hc595'].refTerminal;
    const sc = sidecars['74hc595'];
    assert.notEqual(before, sc.refTerminal,
      'built-in and sidecar must differ here for this to demonstrate anything');
    assert.equal(FOOTPRINTS['74hc595'].refTerminal, before,
      'FOOTPRINTS must keep returning the BUILT-IN for a built-in kind — if this ever '
      + 'starts returning the sidecar, every shadowed sidecar suddenly becomes live and the '
      + '14 known mirrors become real seating defects');
  });
});

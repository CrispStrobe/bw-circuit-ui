/**
 * The two dependent sources are GUI parts now, not importer-only primitives.
 *
 * What this holds, and why each clause exists rather than being obvious:
 *
 *   1. The sidecar's terminal names ARE the engine's. bw-board's stampVCVS and
 *      stampVCCS look up `outp`/`outn`/`inp`/`inn` by name; a sidecar that
 *      spells one of them differently gives the part a pin the solver never
 *      reads, and nothing else in the app would notice.
 *   2. Four terminals resolve to four DISTINCT canvas positions. This is the
 *      defect that made the work worth doing: `terminalPos` falls back to
 *      {dx:0,dy:0} for a terminal whose kind has no geometry, so before the
 *      sidecars every imported controlled source drew all four dots on one
 *      pixel and could not be wired. Driven at a counter-example, because a
 *      distinctness check over a part with one terminal passes for free.
 *   3. The canvas geometry is DERIVED from the sidecar, not retyped. Proved by
 *      perturbing the sidecar and asserting the offsets move — a golden set of
 *      coordinates here would be right today and wrong the day the art moves.
 *   4. No electrical default is restated on the palette. bw-board defaults the
 *      gain and the transconductance inside the stamp; the palette carries
 *      empty params so an untouched part solves at the engine's own number.
 *      Asserted against the ENGINE SOURCE, so it cannot drift into agreement
 *      with a copy of itself.
 *   5. The whole path works end to end: a SPICE deck with an E and a G card
 *      imports, and both parts come out placeable and wireable.
 */
import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Circuit, resetIds } from '../src/model/circuit.js';
import { getSidecar, sidecarCenterOffsets, registerSidecar } from '../src/model/parts-registry.js';
import { importSpice } from '../src/importers/spice.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = rel => readFileSync(path.join(here, '..', rel), 'utf8');
const PALETTE = read('src/components/PartPalette.jsx');
const CANVAS = read('src/components/BoardCanvas.jsx');
const ENGINE_MNA = readFileSync(
  path.join(here, '..', 'node_modules', 'bw-board', 'src', 'mna.js'), 'utf8');

const KINDS = ['vcvs', 'vccs'];
/** The contract both stamps read, in the order the importer emits it. */
const CONTRACT = ['outp', 'outn', 'inp', 'inn'];

test('the fixture is real: both kinds are stamped by the engine and placeable here', () => {
  // Anti-vacuity for everything below. If the engine stopped stamping these,
  // or Circuit stopped accepting them, the rest of this file would still pass
  // while describing a part that does nothing.
  assert.match(ENGINE_MNA, /case 'vcvs':/, 'mna.js no longer stamps vcvs');
  assert.match(ENGINE_MNA, /case 'vccs':/, 'mna.js no longer stamps vccs');
  for (const kind of KINDS) {
    resetIds();
    const p = new Circuit(5).addPart(kind, {}, 0, 0);
    assert.deepEqual(p.terminals, CONTRACT,
      `${kind} does not carry the engine's terminal contract, in its order`);
  }
});

test('1. each sidecar names exactly the four terminals the engine stamp looks up', () => {
  for (const kind of KINDS) {
    const sc = getSidecar(kind);
    assert.ok(sc, `${kind} has no sidecar — the loader did not pick it up`);
    const names = sc.terminals.map(t => t.name);
    // ORDER, not just membership. The sidecar is consulted before circuit.js's
    // own case, so its order becomes the part's terminal order -- and there is
    // a landed contract test asserting exactly outp/outn/inp/inn through
    // Circuit.fromJSON. Authoring this sidecar with the terminals in reading
    // order (inputs first) broke that test, which is how the coupling was
    // found. A set comparison here would not have caught it.
    assert.deepEqual(names, CONTRACT,
      `${kind} sidecar pins ${names.join('/')} do not match the stamp's contract order`);
    // The engine really does address them by these names, rather than by
    // position: assert the stamp's own source mentions each one.
    for (const n of CONTRACT) {
      assert.ok(ENGINE_MNA.includes(`idx('${n}')`),
        `the stamp does not look up '${n}' by name, so the sidecar cannot be checked against it`);
    }
    // ...and the part the designer builds agrees with the sidecar.
    resetIds();
    const placed = new Circuit(5).addPart(kind, {}, 0, 0);
    assert.deepEqual(placed.terminals, names,
      `${kind}: circuit.js and the sidecar disagree about the pins or their order`);
  }
});

test('2. four terminals land on four distinct canvas positions', () => {
  for (const kind of KINDS) {
    const offsets = sidecarCenterOffsets(kind);
    assert.ok(offsets, `${kind} has no derivable geometry`);
    const seen = new Set(CONTRACT.map(n => {
      const o = offsets[n];
      assert.ok(o, `${kind} has no position for ${n}`);
      return `${o.dx},${o.dy}`;
    }));
    assert.equal(seen.size, 4,
      `${kind}: ${4 - seen.size + 1} terminals share a position — this is the stacked-dot defect`);
    // Both sides of the body are used, so the part reads as a four-terminal
    // element and not as a row of pins.
    assert.ok(CONTRACT.some(n => offsets[n].dx < 0) && CONTRACT.some(n => offsets[n].dx > 0),
      `${kind} puts every terminal on one side`);
  }
  // Driven at a counter-example: a sidecar whose pins all sit at one point is
  // exactly the state this catches, and the check must fail on it.
  registerSidecar({ kind: '__stacked_probe', w: 40, h: 40, terminals:
    CONTRACT.map(name => ({ name, x: 20, y: 20 })) });
  const bad = sidecarCenterOffsets('__stacked_probe');
  assert.equal(new Set(CONTRACT.map(n => `${bad[n].dx},${bad[n].dy}`)).size, 1,
    'the distinctness measure does not react to collapsed geometry');
});

test('3. the canvas derives its geometry from the sidecar rather than keeping a copy', () => {
  // The proof a fixed set of coordinates cannot give. Move the art, and the
  // offsets must move with it.
  const before = sidecarCenterOffsets('vcvs');
  const original = getSidecar('vcvs');
  try {
    registerSidecar({ ...original, terminals: original.terminals.map(t =>
      t.name === 'outp' ? { ...t, y: t.y + 7 } : t) });
    const after = sidecarCenterOffsets('vcvs');
    assert.notEqual(after.outp.dy, before.outp.dy,
      'a moved sidecar pin left the derived offset unchanged: the geometry is copied, not read');
    assert.equal(after.inp.dy, before.inp.dy, 'an unrelated pin moved too');
  } finally {
    registerSidecar(original);
  }
  assert.deepEqual(sidecarCenterOffsets('vcvs'), before, 'the probe did not restore the sidecar');
  // And the renderer consumes that helper rather than its own arithmetic.
  assert.match(CANVAS, /sidecarCenterOffsets\(part\.kind\)/,
    'BoardCanvas no longer reads the shared derivation');
});

test('4. the palette restates no electrical default; the engine keeps both', () => {
  // The engine's defaults, read from its source so this test cannot agree
  // with a copy of them.
  assert.match(ENGINE_MNA, /params\.gain \?\? \(part\.kind === 'vcvs' \? 1 : 1e6\)/,
    'the vcvs gain default moved; this test no longer describes the engine');
  assert.match(ENGINE_MNA, /params\.gm \?\? 1e-3/,
    'the vccs gm default moved; this test no longer describes the engine');
  // The palette entries exist and carry no number.
  for (const kind of KINDS) {
    const m = PALETTE.match(new RegExp(`\\{ kind: '${kind}',[\\s\\S]*?\\},\\n`));
    assert.ok(m, `${kind} is not on the palette`);
    const entry = m[0];
    assert.match(entry, /params: \{\}/, `${kind}'s palette entry carries params`);
    for (const field of ['gain', 'gm']) {
      assert.ok(!new RegExp(`${field}\\s*:`).test(entry),
        `${kind}'s palette entry restates ${field} — the stamp is the only home`);
    }
  }
  // Driven: the scan does see a restated default where one exists. The opamp
  // entry carries gain: 100000 beside an engine default of 1e6, which is the
  // very drift this clause refuses to repeat. Reported, not fixed here — the
  // opamp is not this lane's part.
  const opamp = PALETTE.match(/\{ kind: 'opamp',[\s\S]*?\},\n/)[0];
  assert.match(opamp, /gain: \d/, 'the restated-default scan has stopped seeing a known example');
});

test('5. a deck with an E and a G card imports as two placeable parts', () => {
  const deck = [
    'controlled source bench',
    'V1 in 0 DC 2',
    'R1 in 0 1k',
    'E1 outv 0 in 0 2',
    'G1 outi 0 in 0 1m',
    'R2 outv 0 1k',
    'R3 outi 0 1k',
    '.op',
    '.end',
  ].join('\n');
  const res = importSpice(deck);
  const byKind = k => (res.parts || []).filter(p => p.kind === k);
  assert.equal(byKind('vcvs').length, 1, `no vcvs imported: ${JSON.stringify(res.unmapped || [])}`);
  assert.equal(byKind('vccs').length, 1, `no vccs imported: ${JSON.stringify(res.unmapped || [])}`);
  for (const kind of KINDS) {
    const part = byKind(kind)[0];
    const offsets = sidecarCenterOffsets(kind);
    // Every terminal the importer produced can be drawn somewhere of its own,
    // which is what "placeable" means for a part you have to wire up.
    for (const t of part.terminals || CONTRACT) {
      assert.ok(offsets[t], `imported ${kind} carries terminal ${t} with no position`);
    }
  }
});

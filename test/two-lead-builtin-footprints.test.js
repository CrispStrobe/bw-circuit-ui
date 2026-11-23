/**
 * Seated two-lead parts stay on their breadboard strips in a HEADLESS load.
 *
 * Gap (2026-11-23, round 2): sb3's lab-charge-pump with `cres` changed to a
 * `polarized_cap` (leadMap pos:a38, neg:a39) put both leads on no net. The
 * FOOTPRINTS proxy only finds a SIDECAR footprint once the sidecars are
 * registered, and a loader that injects just the engine (the gallery gates)
 * registers none: Circuit.fromJSON saw "no footprint", deleted the seat, and
 * the part fell off the board. Every two-lead kind whose only footprint was
 * its sidecar's had the same gap; a seated battery had it even WITH sidecars,
 * because it is aliased to `vsource`, which has no footprint at all.
 *
 * This file deliberately does NOT import ./_setup.js: it injects the engine
 * the way a headless gate does, with no sidecars registered. The sidecars are
 * read only to hold the built-in copies equal to them.
 */
import { setEngine } from '../src/engine.js';
import { BoardImpl } from 'bw-board/board.js';
import { inferNetlist, checkWiring } from 'bw-board/infer-netlist.js';
import { getDevice } from 'bw-board/devices.js';
import { registerAllDevices } from 'bw-board/register-all.js';
import { getMaxCurrent, PORT_LIMITS } from 'bw-board/current-ratings.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Circuit } from '../src/model/circuit.js';
import { FOOTPRINTS } from '../src/model/footprints.js';
import { registeredKinds } from '../src/model/parts-registry.js';

registerAllDevices();
setEngine({ BoardImpl, inferNetlist, checkWiring, getMaxCurrent, PORT_LIMITS, getDevice });

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, '../src/parts-data');
const sidecar = (kind) => JSON.parse(readFileSync(path.join(dataDir, `${kind}.json`), 'utf8'));

const TWO_LEAD = ['polarized_cap', 'battery', 'piezo', 'phototransistor', 'ir_transmitter', 'led_7color',
  'flex_sensor', 'force_sensor', 'fuse', 'reed_switch', 'ammeter', 'voltmeter', 'analog_meter', 'spectrum_display'];

test('this file really runs headless: no sidecars are registered', () => {
  assert.equal(registeredKinds().length, 0);
});

test('every two-lead sidecar with a footprint has a built-in twin equal to it', () => {
  const missing = [];
  for (const f of readdirSync(dataDir).filter((n) => n.endsWith('.json'))) {
    const sc = JSON.parse(readFileSync(path.join(dataDir, f), 'utf8'));
    if (!sc.footprint || (sc.terminals || []).length !== 2) continue;
    if (!Object.keys(FOOTPRINTS).includes(sc.kind)) missing.push(sc.kind);
  }
  // tilt_switch / tilt_switch_v2 load as tilt_sensor (KIND_ALIASES), which
  // has its own built-in footprint with the same a/b leads.
  assert.deepEqual(missing.filter((k) => !/^tilt_switch/.test(k)), []);
  for (const kind of TWO_LEAD) {
    const sc = sidecar(kind);
    assert.deepEqual(FOOTPRINTS[kind].leads, sc.footprint.leads, `${kind} leads`);
    assert.equal(FOOTPRINTS[kind].refTerminal, sc.footprint.refTerminal, `${kind} refTerminal`);
  }
});

const bench = (part) => ({
  vcc: 9,
  parts: [
    { id: 'bb1', kind: 'breadboard', params: {}, terminals: [], x: 0, y: 0, rotation: 0 },
    { ...part, x: 0, y: 0, rotation: 0 },
  ],
  wires: [],
});
const netOf = (circuit, partId, terminal) => circuit.board.getNets()
  .find((n) => (n.terminals || []).some((t) => t.part === partId && t.terminal === terminal))?.id;

test('a seated polarized_cap keeps its seat and both leads land on their strips', () => {
  const c = Circuit.fromJSON(bench({ id: 'cres', kind: 'polarized_cap', params: { farads: 220e-6 },
    seat: { boardId: 'bb1', leadMap: { pos: 'a38', neg: 'a39' } } }));
  assert.ok(c.parts.find((p) => p.id === 'cres').seat, 'seat kept');
  const pos = netOf(c, 'cres', 'pos');
  const neg = netOf(c, 'cres', 'neg');
  assert.ok(pos && neg && pos !== neg, `pos on ${pos}, neg on ${neg}`);
});

test('a seated battery (aliased to vsource) keeps its seat', () => {
  const c = Circuit.fromJSON(bench({ id: 'bat1', kind: 'battery', params: { volts: 3 },
    seat: { boardId: 'bb1', leadMap: { pos: 'a9', neg: 'a10' } } }));
  const p = c.parts.find((q) => q.id === 'bat1');
  assert.equal(p.kind, 'vsource');
  assert.ok(p.seat, 'seat kept');
  assert.ok(netOf(c, 'bat1', 'pos') && netOf(c, 'bat1', 'neg'));
});

// The first load seats the battery by the footprint of the kind the FILE names,
// then aliases the part to vsource. A save writes `vsource`, and vsource has no
// footprint, so before 2026-11-23 the RELOAD dropped the seat: load -> save ->
// load was not a fixed point (sb3 examples 47, 48, 52 had to give up their
// seats). The part now carries the kind its seat was taken from.
test('a seated battery survives load -> save -> load, and the save is a fixed point', () => {
  const first = Circuit.fromJSON(bench({ id: 'bat1', kind: 'battery', params: { volts: 3 },
    seat: { boardId: 'bb1', leadMap: { pos: 'a9', neg: 'a10' } } }));
  const saved = JSON.parse(JSON.stringify(first.toJSON()));
  const second = Circuit.fromJSON(saved);
  const p = second.parts.find((q) => q.id === 'bat1');
  assert.equal(p.kind, 'vsource');
  assert.deepEqual(p.seat, { boardId: 'bb1', leadMap: { pos: 'a9', neg: 'a10' } }, 'seat kept on reload');
  assert.ok(netOf(second, 'bat1', 'pos') && netOf(second, 'bat1', 'neg'));
  assert.notEqual(netOf(second, 'bat1', 'pos'), netOf(second, 'bat1', 'neg'));
  assert.deepEqual(second.board.getNets().map((n) => n.terminals.map((t) => `${t.part}.${t.terminal}`).sort()).sort(),
    first.board.getNets().map((n) => n.terminals.map((t) => `${t.part}.${t.terminal}`).sort()).sort(),
    'same nets after the round trip');
  assert.deepEqual(JSON.parse(JSON.stringify(second.toJSON())), saved, 'the second save equals the first');
  // The seat stays a real seat after the reload: the board knows its holes.
  assert.deepEqual(second.breadboards.get('bb1').occupantOf('a9'), { kind: 'lead', partId: 'bat1', terminal: 'pos' });
});

test('an unseated battery gains no footprint field and still loads as a vsource', () => {
  const c = Circuit.fromJSON(bench({ id: 'bat1', kind: 'battery', params: { volts: 3 } }));
  const saved = c.toJSON().parts.find((q) => q.id === 'bat1');
  assert.equal(saved.kind, 'vsource');
  assert.equal('footprintKind' in saved, false);
});

test('a seated piezo and phototransistor keep their seats', () => {
  for (const [kind, leadMap] of [['piezo', { a: 'a15', b: 'a16' }], ['phototransistor', { collector: 'c3', emitter: 'c6' }]]) {
    const c = Circuit.fromJSON(bench({ id: 'p', kind, params: {}, seat: { boardId: 'bb1', leadMap } }));
    assert.ok(c.parts.find((q) => q.id === 'p').seat, `${kind} seat kept`);
    for (const t of Object.keys(leadMap)) assert.ok(netOf(c, 'p', t), `${kind}.${t} on a net`);
  }
});

test('lm386 seats as a gutter-straddling DIP-8 with pin 1 bottom-left', () => {
  const fp = FOOTPRINTS.lm386;
  assert.ok(fp && fp.straddlesGutter);
  assert.deepEqual(fp.leads, sidecar('lm386').footprint.leads);
  const c = Circuit.fromJSON(bench({ id: 'u1', kind: 'lm386', params: {},
    seat: { boardId: 'bb1', leadMap: { gain8: 'e10', bypass: 'e11', vs: 'e12', vout: 'e13',
      gain1: 'f10', inn: 'f11', inp: 'f12', gnd: 'f13' } } }));
  assert.ok(c.parts.find((q) => q.id === 'u1').seat, 'seat kept');
  const nets = new Set(['gain1', 'inn', 'inp', 'gnd', 'vout', 'vs', 'bypass', 'gain8'].map((t) => netOf(c, 'u1', t)));
  assert.equal(nets.size, 8, 'eight pins on eight strips');
});

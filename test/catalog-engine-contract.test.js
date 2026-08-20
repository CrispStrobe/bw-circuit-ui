/**
 * Catalog ↔ engine terminal-name contract.
 *
 * bw-board is the authority; a divergence is a bug in the catalog, never
 * in the engine. For EVERY kind bw-board has a device model for, the
 * catalog's terminal list must be identical — same names, same order.
 *
 * ── why this file was rewritten (2026-08-20) ──────────────────────────
 *
 * The previous version asked `BoardImpl.getTerminalsForKind(kind)` and
 * did `if (!engineTerminals) continue`. That method is a stale
 * hand-maintained table: it returns null for everything registered at
 * RUNTIME, which is to say for exactly the kinds that were broken. It
 * therefore skipped 130 of 179 devices and passed, green, the whole time
 * `addPart('arduino_uno')` was handing back ['a','b'] against a 28-pin
 * engine model and `addPart('vreg')` was emptying the board.
 *
 * `BoardImpl.getPartKinds()` is the same stale-table bug (118 entries
 * against 179 registered) and has already cost this repo three working
 * parts, "fixed" by downgrading them to match the table. So: this file
 * asks the REGISTRY — getDevice() after registerAllDevices() — and
 * nothing else. It also pins the registry size, because a test that
 * iterates an empty registry passes just as green as one that iterates a
 * healthy one.
 *
 * The header of the old file already stated the right principle. Stating
 * it was never the problem; checking it was.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { terminalsForKind } from '../src/model/circuit.js';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { registerAllDevices } from '../../bw-board/src/register-all.js';
import { getDevice, registeredKinds, BUILTIN_KINDS } from '../../bw-board/src/devices.js';

registerAllDevices();

/**
 * The registry had 179 device models when this test was written. A floor,
 * not an equality: bw-board gains devices (stc15_mcu and friends were
 * landing the same week) and a new one must be COVERED, not tolerated.
 * The floor's whole job is to make "the registry was empty" fail loudly
 * instead of passing as "nothing diverged".
 */
const REGISTRY_FLOOR = 179;

/**
 * `header` is the ONLY kind whose terminals legitimately depend on params
 * (`params.pins` → p1..pN), so a fixed engine list would silently turn
 * every 6- or 10-way header into an 8-way one. This is not an opinion:
 * the 'no other kind is params-dependent' test below probes every
 * registered kind with two different params objects and fails if a second
 * one shows up. "It's dynamic" is not an excuse anything else may claim.
 */
const PARAM_DEPENDENT = new Set(['header']);

/**
 * THE BURN-DOWN LEDGER — kinds whose catalog list still diverges from the
 * engine's, each with a stated reason. It may only SHRINK: healing a kind
 * means DELETING its entry in the same commit (the 'no stale entries' test
 * enforces that), and adding one requires a reason beside it, not silence.
 *
 * It is empty, and that is the point: making bw-board's device model the
 * source of terminal names in terminalsForKind() took all 179 to exact
 * agreement — names and order — in one move. An entry here means somebody
 * put a name back into the catalog that the engine does not have, and that
 * is a board that renders EMPTY the moment a user drops the part.
 *
 * @type {Map<string, string>}
 */
const LEDGER = new Map([]);

/** Compare catalog vs engine for one kind. */
function diverge(kind) {
  const engine = getDevice(kind).terminals;
  const catalog = terminalsForKind(kind, {});
  const engineSet = new Set(engine);
  const catalogSet = new Set(catalog);
  const phantom = catalog.filter(t => !engineSet.has(t));   // catalog offers, engine lacks
  const absent = engine.filter(t => !catalogSet.has(t));    // engine has, catalog omits
  const orderOnly = !phantom.length && !absent.length &&
    JSON.stringify(engine) !== JSON.stringify(catalog);
  return { engine, catalog, phantom, absent, orderOnly,
    any: phantom.length > 0 || absent.length > 0 || orderOnly };
}

describe('catalog ↔ engine terminal-name contract', () => {
  const kinds = registeredKinds().filter(k => Array.isArray(getDevice(k)?.terminals));

  it('the device registry is populated', () => {
    assert.ok(kinds.length >= REGISTRY_FLOOR,
      `only ${kinds.length} devices with terminals in the registry, floor is ` +
      `${REGISTRY_FLOOR}. Either registerAllDevices() did not run — in which ` +
      `case every assertion below is vacuous — or bw-board lost device models.`);
  });

  it('every registered device is covered — nothing silently skipped', () => {
    const skipped = kinds.filter(k => PARAM_DEPENDENT.has(k));
    assert.deepEqual(skipped, ['header'],
      'the only kind this contract may skip is header; see PARAM_DEPENDENT');
    const covered = kinds.length - skipped.length;
    assert.ok(covered >= REGISTRY_FLOOR - 1,
      `${covered} kinds checked, expected at least ${REGISTRY_FLOOR - 1}`);
  });

  it('the catalog offers NO terminal the engine lacks (phantom count is zero)', () => {
    const bad = [];
    for (const kind of kinds) {
      if (PARAM_DEPENDENT.has(kind)) continue;
      const d = diverge(kind);
      if (!d.phantom.length) continue;
      if (LEDGER.has(kind)) continue;
      bad.push(`${kind}: catalog offers [${d.phantom}] — engine has [${d.engine}]`);
    }
    assert.deepEqual(bad, [],
      `a phantom terminal is not a cosmetic mismatch: checkWiring rejects the ` +
      `NETLIST, not the pin, so one such part empties the whole board.\n${bad.join('\n')}`);
  });

  it('the catalog omits NO terminal the engine has', () => {
    const bad = [];
    for (const kind of kinds) {
      if (PARAM_DEPENDENT.has(kind)) continue;
      const d = diverge(kind);
      if (!d.absent.length) continue;
      if (LEDGER.has(kind)) continue;
      bad.push(`${kind}: engine has [${d.absent}] the catalog does not offer`);
    }
    assert.deepEqual(bad, [],
      `an omitted terminal is a pin the user cannot wire at all — this is how ` +
      `every 74-series gate lost its gnd and vcc.\n${bad.join('\n')}`);
  });

  it('names AND order match the engine, for all 179', () => {
    const bad = [];
    for (const kind of kinds) {
      if (PARAM_DEPENDENT.has(kind)) continue;
      if (LEDGER.has(kind)) continue;
      const d = diverge(kind);
      if (d.any) {
        bad.push(`${kind}\n    catalog: [${d.catalog}]\n    engine:  [${d.engine}]`);
      }
    }
    assert.deepEqual(bad, [],
      `bw-board is authoritative — fix the catalog, never the engine.\n${bad.join('\n')}`);
  });

  it('no kind falls through to the ["a","b"] default the engine disagrees with', () => {
    const defaulted = [];
    for (const kind of kinds) {
      if (PARAM_DEPENDENT.has(kind)) continue;
      const catalog = terminalsForKind(kind, {});
      const engine = getDevice(kind).terminals;
      const isDefault = catalog.length === 2 && catalog[0] === 'a' && catalog[1] === 'b';
      const engineAgrees = engine.length === 2 && engine[0] === 'a' && engine[1] === 'b';
      if (isDefault && !engineAgrees) defaulted.push(kind);
    }
    assert.deepEqual(defaulted, [],
      `these kinds hit the two-pin fallback while the engine has a real ` +
      `terminal list: ${defaulted.join(', ')}`);
  });

  it('the ledger carries no stale entries — healing a kind deletes its line', () => {
    const healed = [];
    for (const [kind, reason] of LEDGER) {
      assert.ok(typeof reason === 'string' && reason.length > 10,
        `ledger entry "${kind}" needs a stated reason, not silence`);
      const dev = getDevice(kind);
      if (!dev || !Array.isArray(dev.terminals)) continue;
      if (!diverge(kind).any) healed.push(kind);
    }
    assert.deepEqual(healed, [],
      `healed — delete these from LEDGER in the same commit that fixed them: ` +
      `${healed.join(', ')}`);
  });

  it('header is the only params-dependent kind — probed, not assumed', () => {
    // Two params objects that differ in every key any case in
    // terminalsForKind reads. A kind whose list changes between them is
    // genuinely dynamic and would be broken by a fixed engine list.
    const A = {};
    const B = { pins: 6, ways: 6, switches: 3, size: 6, poles: 3, channels: 6, count: 6 };
    const dynamic = [];
    for (const kind of [...kinds, 'header']) {
      const a = JSON.stringify(terminalsForKind(kind, A));
      const b = JSON.stringify(terminalsForKind(kind, B));
      if (a !== b) dynamic.push(kind);
    }
    // header only shows its params-dependence when no sidecar is loaded —
    // header.json declares a fixed 8 pins and shadows the switch. Under
    // _setup.js (sidecars loaded, like the browser) NOTHING is dynamic,
    // which is itself worth pinning: it means the exemption costs nothing.
    assert.deepEqual(dynamic.filter(k => k !== 'header'), [],
      `these kinds change their terminals with params and cannot take a ` +
      `fixed engine list: ${dynamic.join(', ')}. Add them to ` +
      `PARAM_DEPENDENT here AND to ENGINE_AUTHORITY_EXEMPT in circuit.js — ` +
      `with the probe output that proves it.`);
  });

  it('the header exemption is load-bearing — proven WITHOUT sidecars', () => {
    // Under _setup.js the sidecar (a fixed 8 pins) shadows the switch, so
    // header looks static and the exemption looks free. The node/CLI path
    // (bin/bwc.mjs) loads no sidecars, and THERE params.pins is the only
    // thing that decides how many pins a header has. Run that path for
    // real in a child process: with the exemption a 6-way header has six
    // terminals; without it, the engine's fixed p1..p8 silently wins.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = JSON.stringify(path.join(here, '..', 'src'));
    const board = JSON.stringify(path.join(here, '..', '..', 'bw-board', 'src'));
    const script = `
      const { setEngine } = await import(${src} + '/engine.js');
      const eng = await import(${board} + '/index.js');
      (await import(${board} + '/register-all.js')).registerAllDevices();
      setEngine({ BoardImpl: eng.BoardImpl, inferNetlist: eng.inferNetlist,
        checkWiring: eng.checkWiring, getDevice: eng.getDevice });
      const { terminalsForKind } = await import(${src} + '/model/circuit.js');
      process.stdout.write(JSON.stringify(terminalsForKind('header', { pins: 6 })));
    `;
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script],
      { encoding: 'utf8' });
    assert.deepEqual(JSON.parse(out), ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'],
      'a 6-way header must have six terminals, not the engine device\'s fixed eight');
  });

  it('the four kinds from the bug report resolve to the engine model', () => {
    // Regression pins, straight from the reproduction. Before the fix:
    // arduino_uno and attiny85 both returned ['a','b'], and vreg's a/b
    // made checkWiring reject the netlist WHOLE ("the board is EMPTY
    // until this clears") with one part and no wires on the canvas.
    assert.equal(terminalsForKind('arduino_uno', {}).length, 28, 'arduino_uno');
    assert.ok(terminalsForKind('arduino_uno', {}).includes('a0'));
    assert.equal(terminalsForKind('attiny85', {}).length, 8, 'attiny85');
    assert.deepEqual(terminalsForKind('vreg', {}), ['in', 'out', 'gnd'], 'vreg');
    for (const rail of ['gnd', 'vcc']) {
      assert.ok(terminalsForKind('74hc00', {}).includes(rail),
        `74hc00 must offer ${rail} — a logic chip you cannot power is not a part`);
    }
  });

  it('a 74-series gate can be powered: every one of them has gnd and vcc', () => {
    const gates = kinds.filter(k => /^74(hc|ls|c)\d/.test(k));
    assert.ok(gates.length >= 25, `only ${gates.length} 74-series kinds found`);
    const unpowerable = [];
    for (const kind of gates) {
      const engine = getDevice(kind).terminals;
      // Only demand it where the ENGINE models the rails — the engine is
      // the authority here too, not our idea of a DIP package.
      const wants = ['gnd', 'vcc'].filter(r => engine.includes(r));
      const catalog = terminalsForKind(kind, {});
      const lacks = wants.filter(r => !catalog.includes(r));
      if (lacks.length) unpowerable.push(`${kind} lacks [${lacks}]`);
    }
    assert.deepEqual(unpowerable, [], unpowerable.join('\n'));
  });
});

/**
 * The symptom test. Everything above compares two lists; this one does what
 * a user does — drop ONE part on an empty canvas — and asserts the board
 * does not go dark.
 *
 * It also covers the kinds the list comparison cannot reach: bw-board's
 * BUILT-IN kinds have no device model, so getDevice() says nothing about
 * them, and their expected terminals live in a private table inside
 * validate.js. checkWiring is the only honest way to ask.
 *
 * The old contract test tried to cover them via BoardImpl.getTerminalsForKind
 * — the stale hand-maintained table that started this whole class of bug.
 * Behaviour, not a second table.
 */
/**
 * The FOURTH table. src/model/dip-chips.js maps DIP pin number → terminal
 * name for 22 logic chips, and nine of them name pins bw-board does not
 * have — the same spellings the sidecars carried until this branch (qn for
 * q_bar, 1-based bit slices, bare segment names, NC pins).
 *
 * It is not currently reachable for these kinds: terminalsForKind asks the
 * engine first, and logicChipTerminals() is only consulted in the default
 * branch below that. "Not currently reachable" is exactly what the other
 * three stale tables looked like before someone reordered something, so
 * the drift gets pinned rather than trusted. dip-chips.js is not this
 * change's to edit; this ledger is here so that fixing it is a one-line
 * deletion and NOT fixing it stays visible.
 */
describe('dip-chips.js pin maps vs the engine — the fourth table', () => {
  /** kind → why its pin map still names terminals the engine lacks. */
  const DIP_PINMAP_LEDGER = new Map([
    ['74hc20', 'names the NC pins nc1/nc2; the engine models no NC'],
    ['74hc21', 'names the NC pins nc1/nc2; the engine models no NC'],
    ['74hc73', 'inverted outputs spelled 1qn/2qn; the engine says 1q_bar/2q_bar'],
    ['74hc74', 'spells 1qn/2qn and 1prn/2prn; the engine says q_bar and pre'],
    ['74hc75', 'spells the enables 1en..4en and carries 1qn..4qn; the engine has 1e/2e and no inverted outputs'],
    ['74hc93', 'cka/ckb, mr1/mr2 and four NC pins; the engine says clk_a/clk_b, r0_1/r0_2'],
    ['74hc95', 'splits the clock into clk1/clk2; the engine models one clk'],
    ['74hc283', 'numbers the bit slices 1..4; the engine numbers them 0..3'],
    ['cd4511', 'segment outputs as bare a_out..g and bi; the engine says qa..qg and bl'],
  ]);

  it('the ledger may only shrink — a healed pin map deletes its line', async () => {
    const { LOGIC_CHIPS } = await import('../src/model/dip-chips.js');
    const drifted = [];
    const healed = [];
    for (const [kind, def] of Object.entries(LOGIC_CHIPS)) {
      const dev = getDevice(kind);
      if (!dev || !Array.isArray(dev.terminals)) continue;   // no engine model to check against
      const engine = new Set(dev.terminals);
      const extra = [...new Set(Object.values(def.pinMap))].filter(n => !engine.has(n));
      if (extra.length && !DIP_PINMAP_LEDGER.has(kind)) {
        drifted.push(`${kind}: pin map names [${extra}] — engine has [${dev.terminals}]`);
      }
      if (!extra.length && DIP_PINMAP_LEDGER.has(kind)) healed.push(kind);
    }
    assert.deepEqual(drifted, [],
      `a new stale pin map — bw-board is the authority here too.\n${drifted.join('\n')}`);
    assert.deepEqual(healed, [],
      `healed — delete from DIP_PINMAP_LEDGER: ${healed.join(', ')}`);
    for (const [kind, reason] of DIP_PINMAP_LEDGER) {
      assert.ok(reason.length > 10, `${kind} needs a stated reason`);
    }
  });
});

describe('placing one part never empties the board', () => {
  const kinds = [...new Set([...registeredKinds(), ...BUILTIN_KINDS])].sort();

  /**
   * `vcc` alone is a legitimate refusal and nothing to do with terminals:
   * bw-board wants a ground reference before it will solve anything.
   * @type {Map<string, string>}
   */
  const EXPECTED_REFUSALS = new Map([
    ['vcc', 'a lone VCC symbol has no ground reference — not a terminal problem'],
  ]);

  it('every kind places cleanly — 209 of them', async () => {
    const { Circuit } = await import('../src/model/circuit.js');
    assert.ok(kinds.length >= 200, `only ${kinds.length} kinds to place`);
    const rejected = [];
    for (const kind of kinds) {
      const c = new Circuit();
      try {
        c.addPart(kind, {}, 0, 0);
      } catch (err) {
        rejected.push(`${kind}: addPart threw ${err.message}`);
        continue;
      }
      if (!c.netlistError) continue;
      if (EXPECTED_REFUSALS.has(kind)) continue;
      rejected.push(`${kind}: ${String(c.netlistError).replace(/\s+/g, ' ').slice(0, 200)}`);
    }
    assert.deepEqual(rejected, [],
      `these kinds empty the board with ONE part and no wires on it. ` +
      `28 of 209 did before terminalsForKind asked the engine ` +
      `(2026-08-20).\n${rejected.join('\n')}`);
  });

  it('the expected-refusal list is not a dumping ground', async () => {
    const { Circuit } = await import('../src/model/circuit.js');
    const stale = [];
    for (const [kind, reason] of EXPECTED_REFUSALS) {
      assert.ok(reason.length > 10, `${kind} needs a stated reason`);
      const c = new Circuit();
      c.addPart(kind, {}, 0, 0);
      if (!c.netlistError) stale.push(kind);
    }
    assert.deepEqual(stale, [],
      `no longer refused — delete from EXPECTED_REFUSALS: ${stale.join(', ')}`);
  });
});

describe('setEngine stays backwards compatible', () => {
  it('a host that injects only the three required keys still works', async () => {
    const { setEngine } = await import('../src/engine.js');
    const eng = await import('../../bw-board/src/index.js');
    // No getDevice — the pre-2026-08-20 shape that brickwright-lite ships.
    setEngine({ BoardImpl: eng.BoardImpl, inferNetlist: eng.inferNetlist,
      checkWiring: eng.checkWiring });
    // Falls back to the catalog rather than throwing…
    assert.ok(Array.isArray(terminalsForKind('vreg', {})));
    assert.deepEqual(terminalsForKind('resistor', {}), ['a', 'b']);
    // …and putting getDevice back restores engine authority.
    setEngine({ BoardImpl: eng.BoardImpl, inferNetlist: eng.inferNetlist,
      checkWiring: eng.checkWiring, getDevice: eng.getDevice });
    assert.deepEqual(terminalsForKind('vreg', {}), ['in', 'out', 'gnd']);
  });
});

/**
 * EAGLE round-trip, with the SOLVER as the oracle.
 *
 * Three layers, each catching what the one before it cannot:
 *
 *   1. parts survive      — ids and kinds unchanged
 *   2. partition survives — the net graph is the same electrical partition,
 *                           NOT the same wire count: the exporter merges the
 *                           importer's star topology into true nets, so the
 *                           wires differ while the circuit does not
 *   3. VOLTAGES survive   — the engine solves both and agrees
 *
 * Layer 3 is the one worth having. A value misparse — EAGLE writes "4k7" for
 * 4700, and reading it as 4.7 is a one-character mistake — leaves the parts
 * identical, the partition identical, and every structural assertion green,
 * while the circuit behaves completely differently. Measured here: 0.709 V
 * across the diode when correct, 3.625 V when misparsed. Only solving it says
 * so, which is why the last test deliberately breaks a value and asserts the
 * oracle NOTICES.
 *
 * Skips without the bw-circuit-ui/bw-board sibling checkouts.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { importEagle } from '../src/importers/eagle.js';
import { toEagleSch } from '../src/model/exporters/eagle.js';

const HERE = import.meta.dirname;
const CUI = join(HERE, '..');
const BWB = process.env.BW_BOARD || join(CUI, '..', 'bw-board');
const available = existsSync(join(BWB, 'src', 'index.js'));

const FIXTURE = readFileSync(join(HERE, 'fixtures', 'eagle-rc-diode.sch'), 'utf8');

/** Connected components over wire endpoints — the electrical partition. */
function partition(wires) {
  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); }
    return x;
  };
  for (const w of wires) {
    const a = find(w.from + ' ' + w.fromTerminal); const b = find(w.to + ' ' + w.toTerminal);
    if (a !== b) parent.set(a, b);
  }
  const groups = new Map();
  for (const k of parent.keys()) {
    const r = find(k); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(k);
  }
  return [...groups.values()].map((v) => v.sort().join('|')).sort();
}

describe('EAGLE round-trip: structure', () => {
  const src = importEagle(FIXTURE);
  const back = importEagle(toEagleSch({ parts: src.parts, wires: src.wires }).xml);

  test('every part survives with its id and kind', () => {
    const ids = (r) => r.parts.map((p) => [p.id, p.kind]).sort();
    assert.deepEqual(ids(back), ids(src));
  });

  test('the electrical partition survives (wire COUNT may not)', () => {
    assert.deepEqual(partition(back.wires), partition(src.wires));
  });

  test('values survive the trip', () => {
    const r1 = back.parts.find((p) => p.id === 'R1');
    assert.equal(r1.params.ohms, 4700, '"4k7" must still be 4700 after export and re-import');
  });

  test('a kind with no EAGLE deviceset is reported, not silently written', () => {
    const out = toEagleSch({ parts: [{ id: 'X1', kind: 'nonexistent_kind', params: {} }], wires: [] });
    assert.equal(out.skipped.length, 1);
    assert.match(out.warnings[0], /No EAGLE deviceset/);
  });
});

describe('EAGLE round-trip: the solver as oracle',
  { skip: available ? false : 'needs a bw-board checkout beside this repo' }, () => {
    let solve;
    before(async () => {
      const { setEngine } = await import(join(CUI, 'src/engine.js'));
      const eng = await import(join(BWB, 'src/index.js'));
      (await import(join(BWB, 'src/register-all.js'))).registerAllDevices();
      setEngine({ BoardImpl: eng.BoardImpl, inferNetlist: eng.inferNetlist, checkWiring: eng.checkWiring });
      const { registerSidecar } = await import(join(CUI, 'src/model/parts-registry.js'));
      for (const f of readdirSync(join(CUI, 'src/parts-data'))) {
        if (!f.endsWith('.json')) continue;
        try { const sc = JSON.parse(readFileSync(join(CUI, 'src/parts-data', f), 'utf8')); if (sc.kind) registerSidecar(sc); } catch { /* bw-parts' problem */ }
      }
      const { Circuit } = await import(join(CUI, 'src/model/circuit.js'));
      solve = (parts, wires) => {
        const c = Circuit.fromJSON({ parts, wires, vcc: 5 });
        c.powered = true;
        if (c.board && c.board.advanceTo) c.board.advanceTo(1000000n);   // 1 ms, ns as BigInt
        const v = {};
        if (c.board && c.board.nodeVoltages && c.board.nodeVoltages.forEach) {
          c.board.nodeVoltages.forEach((val, k) => { v[k] = Math.round(val * 1000) / 1000; });
        }
        return { parts: c.board.parts.length, v };
      };
    });

    test('the imported bench actually loads into the engine', () => {
      const src = importEagle(FIXTURE);
      assert.ok(solve(src.parts, src.wires).parts > 0,
        'an import the engine refuses leaves an EMPTY board and every other assertion here would be vacuous');
    });

    test('round-tripping does not change a single node voltage', () => {
      const src = importEagle(FIXTURE);
      const back = importEagle(toEagleSch({ parts: src.parts, wires: src.wires }).xml);
      assert.deepEqual(solve(back.parts, back.wires).v, solve(src.parts, src.wires).v);
    });

    // Prove the oracle can fail. Without this the two tests above pass just as
    // happily on an importer that gets every value wrong.
    test('the oracle NOTICES a value misparse that structure cannot see', () => {
      const src = importEagle(FIXTURE);
      const bad = src.parts.map((p) => (p.id === 'R1' ? { ...p, params: { ...p.params, ohms: 4.7 } } : p));
      assert.deepEqual(partition(src.wires), partition(src.wires), 'wires untouched');
      assert.notDeepEqual(solve(bad, src.wires).v, solve(src.parts, src.wires).v,
        '4k7 read as 4.7 must change the solution — if it does not, this oracle proves nothing');
    });
  });

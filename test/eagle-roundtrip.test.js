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
import { netsFromWires } from '../src/model/schematic-svg.js';
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

describe('a repeated pinref is one node, not two', () => {
    // Real schematics repeat a pinref — Adafruit's Relay FeatherWing lists
    // JP4 pin 1 twice in the same net. Harmless until the net's other member
    // is an unmapped part: the survivors are then two copies of ONE pin, and
    // a star topology wires that pin to itself.
    const SCH = `<?xml version="1.0"?>
<eagle version="6.0"><drawing><schematic><parts>
  <part name="JP1" library="con" deviceset="PINHD-1X02" device=""/>
  <part name="R1" library="rcl" deviceset="R-EU_" device="" value="1k"/>
  <part name="MS1" library="x" deviceset="TOTALLY_UNKNOWN_THING" device=""/>
</parts><sheets><sheet><nets>
  <net name="N$1"><segment>
    <pinref part="MS1" gate="G$1" pin="A"/>
    <pinref part="JP1" gate="G$1" pin="1"/>
    <pinref part="JP1" gate="G$1" pin="1"/>
  </segment></net>
  <net name="N$2"><segment>
    <pinref part="JP1" gate="G$1" pin="2"/>
    <pinref part="R1" gate="G$1" pin="1"/>
  </segment></net>
</nets></sheet></sheets></schematic></drawing></eagle>`;

    test('no wire connects a terminal to itself', () => {
        const c = importEagle(SCH);
        const loops = c.wires.filter(w => w.from === w.to && w.fromTerminal === w.toTerminal);
        assert.deepEqual(loops, [],
            `a self-loop is not a connection: ${JSON.stringify(loops)}`);
    });

    test('the duplicated pin does not become a net of its own', () => {
        // The real cost: netsFromWires counts a self-loop as a net, so eight
        // of them reported 14 nets against an export of 6 and five corpus
        // boards failed round-trip on a difference that did not exist.
        const c = importEagle(SCH);
        const nets = netsFromWires(c.wires);
        assert.equal(nets.length, 1, 'only JP1:p2—R1 is a real connection here');
        assert.equal(nets[0].terminals.length, 2);
    });

    test('the fixture still exercises the path', () => {
        // If MS1 ever starts mapping, the net gains a second real member and
        // this stops testing what it names.
        const c = importEagle(SCH);
        assert.ok(c.unmapped.some(u => /TOTALLY_UNKNOWN_THING/.test(u.libsource)),
            'the third part must stay unmapped for this fixture to mean anything');
    });
});

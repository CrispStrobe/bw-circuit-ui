/**
 * Catalog ↔ engine terminal-name contract test.
 *
 * For every kind that BOTH the UI catalog (terminalsForKind) and the
 * engine (BoardImpl.getTerminalsForKind) know, the terminal name lists
 * must be IDENTICAL — same names, same order.  Order matters because
 * it drives rendering and wire attachment positions.
 *
 * bw-board is the authority; a divergence is a bug in the catalog,
 * never in the engine.
 *
 * Also logs which kinds fall through to the default ['a','b'] fallback,
 * so a silently-defaulted kind is visible in the test output.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { terminalsForKind } from '../src/model/circuit.js';
import { BoardImpl } from '../../bw-board/src/board.js';

describe('catalog ↔ engine terminal-name contract', () => {
  // Get the full list of kinds the engine knows about.
  const engineKinds = BoardImpl.getPartKinds();

  // Kinds where terminalsForKind needs params or returns dynamic lists;
  // the engine's static getTerminalsForKind returns null for these.
  const PARAM_DEPENDENT = new Set([
    'mcu', 'breadboard', 'led_cube', 'dip_switch', 'header',
  ]);

  // Collect defaulted kinds for final report.
  const defaultedKinds = [];

  for (const kind of engineKinds) {
    if (PARAM_DEPENDENT.has(kind)) continue;

    const engineTerminals = BoardImpl.getTerminalsForKind(kind);
    if (!engineTerminals) continue; // engine doesn't have a static list for this kind

    it(`${kind}: catalog terminals match engine`, () => {
      const catalogTerminals = terminalsForKind(kind, {});

      // Check if the catalog fell through to the default ['a','b']
      if (catalogTerminals.length === 2 &&
          catalogTerminals[0] === 'a' && catalogTerminals[1] === 'b' &&
          !(engineTerminals.length === 2 && engineTerminals[0] === 'a' && engineTerminals[1] === 'b')) {
        defaultedKinds.push(kind);
        assert.fail(
          `kind "${kind}" fell through to default ['a','b'] in the catalog, ` +
          `but the engine has [${engineTerminals.join(', ')}]`
        );
      }

      assert.deepStrictEqual(catalogTerminals, engineTerminals,
        `catalog terminals for "${kind}" diverge from engine.\n` +
        `  catalog: [${catalogTerminals.join(', ')}]\n` +
        `  engine:  [${engineTerminals.join(', ')}]\n` +
        `The engine (bw-board) is authoritative — fix the catalog.`
      );
    });
  }

  it('report: kinds that hit default fallback', () => {
    // Walk ALL engine kinds (not just ones with static terminal lists)
    // and log any that the catalog defaults.
    const allDefaulted = [];
    for (const kind of engineKinds) {
      if (PARAM_DEPENDENT.has(kind)) continue;
      const ct = terminalsForKind(kind, {});
      const et = BoardImpl.getTerminalsForKind(kind);
      if (!et) continue;
      if (ct.length === 2 && ct[0] === 'a' && ct[1] === 'b' &&
          !(et.length === 2 && et[0] === 'a' && et[1] === 'b')) {
        allDefaulted.push(kind);
      }
    }
    if (allDefaulted.length) {
      console.log(`⚠ kinds silently defaulted to ['a','b']: ${allDefaulted.join(', ')}`);
    }
    // This test always passes — the per-kind tests catch the actual failures.
    // This is just a summary log.
    assert.ok(true, `${allDefaulted.length} kinds defaulted`);
  });
});

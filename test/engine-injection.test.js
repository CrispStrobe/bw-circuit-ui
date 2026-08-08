/**
 * Tests for engine injection (setEngine / getEngine).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// DO NOT import _setup.js here — we test the error case first.

describe('engine injection', () => {
  it('setEngine then getEngine returns the engine', async () => {
    const { setEngine, getEngine } = await import('../src/engine.js');

    // Set a real engine
    const { BoardImpl } = await import('../../bw-board/src/board.js');
    const { inferNetlist, checkWiring } = await import('../../bw-board/src/infer-netlist.js');
    setEngine({ BoardImpl, inferNetlist, checkWiring });

    const engine = getEngine();
    assert.ok(engine.BoardImpl, 'engine should have BoardImpl');
    assert.ok(engine.inferNetlist, 'engine should have inferNetlist');
    assert.ok(engine.checkWiring, 'engine should have checkWiring');
  });

  it('setEngine rejects missing BoardImpl', async () => {
    const { setEngine } = await import('../src/engine.js');
    assert.throws(
      () => setEngine({ inferNetlist: () => {}, checkWiring: () => {} }),
      /BoardImpl is required/
    );
  });

  it('setEngine rejects missing inferNetlist', async () => {
    const { setEngine } = await import('../src/engine.js');
    assert.throws(
      () => setEngine({ BoardImpl: function() {}, checkWiring: () => {} }),
      /inferNetlist is required/
    );
  });

  it('setEngine rejects missing checkWiring', async () => {
    const { setEngine } = await import('../src/engine.js');
    assert.throws(
      () => setEngine({ BoardImpl: function() {}, inferNetlist: () => {} }),
      /checkWiring is required/
    );
  });
});

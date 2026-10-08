import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { verifyBoardProvenance } from '../scripts/board-provenance.mjs';
import { BoardImpl } from 'bw-board';
import { armBoardForRun } from '../src/model/simulation.js';

describe('loaded Board package provenance', () => {
  it('shared Sim arming resets an attached late scope without losing its first intervals', () => {
    const board = new BoardImpl(5);
    board.setNetlist([
      {id: 'V', kind: 'vsource', params: {volts: 1}, terminals: ['pos', 'neg']},
      {id: 'R', kind: 'resistor', params: {ohms: 1000}, terminals: ['a', 'b']},
      {id: 'G', kind: 'gnd', params: {}, terminals: ['gnd']},
    ], [
      {id: 'signal', terminals: [{part: 'V', terminal: 'pos'}, {part: 'R', terminal: 'a'}]},
      {id: 'ground', terminals: [{part: 'V', terminal: 'neg'}, {part: 'R', terminal: 'b'}, {part: 'G', terminal: 'gnd'}]},
    ]);
    board.setPower(true); board.advanceTo(20000n);
    const handle = board.addScopeChannel({type: 'voltage', netId: 'signal', sampleRateHz: 100000, depth: 8});
    board.advanceTo(55000n);
    assert.ok(board.getScopeData(handle).count > 0, 'nonempty old epoch');
    armBoardForRun({board, parts: [], wires: [], setPin: () => {throw new Error('no MCU pins');}});
    assert.equal(board.getTime(), 0n);
    assert.deepEqual(board.getScopeChannels(), [handle]);
    assert.equal(board.getScopeData(handle).count, 0);
    assert.ok([...board.getScopeData(handle).samples].every(Number.isNaN));
    board.advanceTo(10000n);
    const data = board.getScopeData(handle);
    assert.equal(data.count, 1); assert.equal(data.startTNs, 0n);
    assert.equal(data.samples[0], 1); assert.equal(data.samples[1], 1);
  });
  it('binds the declaration, lock resolution, loaded content and checkout identity', () => {
    const result = verifyBoardProvenance();
    assert.equal(result.qualified, true, result.failures.join('; '));
    assert.equal(result.declared.packageCommit, result.declared.lockCommit);
    assert.equal(result.loaded.runtimeTreeSha256, result.loaded.expectedRuntimeTreeSha256);
    if (result.loaded.logicalIsSymlink) {
      assert.equal(result.checkout.head, result.declared.packageCommit);
      assert.equal(result.checkout.dirty, false);
    } else {
      assert.equal(result.checkout, null,
        'an installed copy must not inherit the enclosing CUI repository identity');
    }
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { verifyBoardProvenance } from '../scripts/board-provenance.mjs';

describe('loaded Board package provenance', () => {
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

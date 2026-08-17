// The eye integrates a multiplex scan; the renderer must too. A 1/16-duty
// row is LIT, not a rounding error above black.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ledDisplayLevel } from '../src/components/led-perception.js';

test('scan duties render visibly, off stays off', () => {
  assert.equal(ledDisplayLevel(0), 0);
  assert.equal(ledDisplayLevel(0.002), 0, 'sub-duty leakage is off');
  const sixteenth = ledDisplayLevel(1 / 16);
  assert.ok(sixteenth > 0.25, `1/16 duty clearly visible, got ${sixteenth}`);
  const eighth = ledDisplayLevel(1 / 8);
  assert.ok(eighth > sixteenth, 'monotonic');
  assert.equal(ledDisplayLevel(1), 1, 'full on is full on');
});

/**
 * Tests for part duplication.
 */

import './_setup.js';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, resetIds } from '../src/model/circuit.js';

beforeEach(() => resetIds());

describe('duplicatePart', () => {
  it('creates a copy with same kind and params', () => {
    const c = new Circuit(5.0);
    const r = c.addPart('resistor', { ohms: 4700 }, 100, 200);
    const dup = c.duplicatePart(r.id);

    assert.ok(dup);
    assert.notEqual(dup.id, r.id);
    assert.equal(dup.kind, 'resistor');
    assert.equal(dup.params.ohms, 4700);
  });

  it('places duplicate at offset position', () => {
    const c = new Circuit(5.0);
    const r = c.addPart('resistor', { ohms: 1000 }, 100, 200);
    const dup = c.duplicatePart(r.id);

    assert.equal(dup.x, 140);
    assert.equal(dup.y, 240);
  });

  it('duplicate is independent (changing original does not affect copy)', () => {
    const c = new Circuit(5.0);
    const r = c.addPart('resistor', { ohms: 1000 }, 100, 200);
    const dup = c.duplicatePart(r.id);

    c.updateParams(r.id, { ohms: 9999 });
    assert.equal(dup.params.ohms, 1000); // unchanged
  });

  it('returns null for nonexistent part', () => {
    const c = new Circuit(5.0);
    assert.equal(c.duplicatePart('nope'), null);
  });

  it('duplicate is undoable', () => {
    const c = new Circuit(5.0);
    c.addPart('resistor', { ohms: 1000 }, 100, 200);
    assert.equal(c.parts.length, 1);

    c.duplicatePart(c.parts[0].id);
    assert.equal(c.parts.length, 2);

    c.undo();
    assert.equal(c.parts.length, 1);
  });

  it('duplicating an LED preserves color', () => {
    const c = new Circuit(5.0);
    const led = c.addPart('led', { vf: 2.0, color: 'green' }, 100, 100);
    const dup = c.duplicatePart(led.id);

    assert.equal(dup.params.color, 'green');
    assert.equal(dup.params.vf, 2.0);
  });
});

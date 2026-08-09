/**
 * Tests for declaration generation — parts become project.stc declarations.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generatePartName, partToDeclaration, circuitToDeclarations } from '../src/model/declarations.js';

describe('generatePartName', () => {
  it('generates led1 for first LED', () => {
    assert.equal(generatePartName('led', []), 'led1');
  });

  it('generates led2 when led1 exists', () => {
    assert.equal(generatePartName('led', ['led1']), 'led2');
  });

  it('generates btn1 for first button', () => {
    assert.equal(generatePartName('button', []), 'btn1');
  });

  it('skips existing names', () => {
    assert.equal(generatePartName('led', ['led1', 'led2', 'led3']), 'led4');
  });
});

describe('partToDeclaration', () => {
  it('LED → output declaration', () => {
    const decl = partToDeclaration(
      { kind: 'led', params: {}, declName: 'led1' },
      'P1.0'
    );
    assert.deepEqual(decl, {
      name: 'led1', port: 1, bit: 0, pin: 'P1.0',
      direction: 'output', activeLow: true,
    });
  });

  it('buzzer → tone declaration', () => {
    const decl = partToDeclaration(
      { kind: 'buzzer', params: {}, declName: 'buzzer1' },
      'P3.5'
    );
    assert.equal(decl.direction, 'tone');
  });

  it('button → input declaration', () => {
    const decl = partToDeclaration(
      { kind: 'button', params: {}, declName: 'btn1' },
      'P3.2'
    );
    assert.equal(decl.direction, 'input');
  });

  it('potentiometer → analog declaration', () => {
    const decl = partToDeclaration(
      { kind: 'potentiometer', params: {}, declName: 'pot1' },
      'P1.3'
    );
    assert.equal(decl.direction, 'analog');
  });

  it('resistor → null (no declaration)', () => {
    const decl = partToDeclaration(
      { kind: 'resistor', params: {}, declName: 'r1' },
      'P1.0'
    );
    assert.equal(decl, null);
  });

  it('no declName → null', () => {
    const decl = partToDeclaration(
      { kind: 'led', params: {} },
      'P1.0'
    );
    assert.equal(decl, null);
  });
});

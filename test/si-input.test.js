/**
 * Tests for SI suffix parsing.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSi, formatSi } from '../src/model/si.js';

describe('parseSi', () => {
  it('parses plain numbers', () => {
    assert.equal(parseSi('100'), 100);
    assert.equal(parseSi('4.7'), 4.7);
  });
  it('parses k suffix', () => {
    assert.equal(parseSi('10k'), 10000);
    assert.equal(parseSi('4.7k'), 4700);
    assert.equal(parseSi('1K'), 1000);
  });
  it('parses M suffix', () => {
    assert.equal(parseSi('1M'), 1000000);
    assert.equal(parseSi('2.2M'), 2200000);
  });
  it('parses u/n/p suffixes', () => {
    assert.ok(Math.abs(parseSi('100u') - 1e-4) < 1e-15);
    assert.ok(Math.abs(parseSi('10n') - 1e-8) < 1e-20);
    assert.ok(Math.abs(parseSi('47p') - 4.7e-11) < 1e-22);
  });
  it('returns NaN for empty', () => {
    assert.ok(isNaN(parseSi('')));
  });
});

describe('formatSi', () => {
  it('formats with k', () => {
    assert.equal(formatSi(10000), '10k');
    assert.equal(formatSi(4700), '4.7k');
  });
  it('formats with M', () => {
    assert.equal(formatSi(1000000), '1M');
  });
  it('formats small values', () => {
    assert.equal(formatSi(0.0001), '100u');
  });
  it('formats plain numbers', () => {
    assert.equal(formatSi(100), '100');
    assert.equal(formatSi(47), '47');
  });
});

/**
 * DRC phantom guard — verifies that DRC warnings never reference parts
 * absent from the current circuit, even when inference races with file
 * loading on remount.
 *
 * The scenario: a remount with pins from a previous project triggers the
 * inference effect BEFORE circuitData loads the example. The inference
 * builds an "mcu1" bench; the example has "cpu", "rom", etc. DRC runs
 * on the inferred bench and produces warnings for "mcu1" — a phantom
 * part that doesn't exist in the example the user sees.
 *
 * The fix has two layers:
 *   1. fileLoadedRef persists across remounts (localStorage flag)
 *   2. DRC output is filtered to strip warnings for parts not in
 *      circuit.parts (the phantom guard)
 *
 * This test exercises layer 2 directly.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Phantom guard logic (extracted from CircuitDesigner) ────────────

/**
 * Filter DRC warnings to only include those referencing parts that
 * actually exist in the current circuit. Warnings with no partId pass.
 */
function phantomGuard(drcWarnings, parts) {
  const partIds = new Set(parts.map(p => p.id));
  return drcWarnings.filter(w => !w.partId || partIds.has(w.partId));
}

// ── partKind stamp (from drc.js post-processing) ────────────────────

function stampKind(warnings, parts) {
  const kindMap = new Map(parts.map(p => [p.id, p.kind]));
  for (const w of warnings) {
    if (w.partId) w.partKind = kindMap.get(w.partId) || undefined;
  }
  return warnings;
}

// ── Fixtures ────────────────────────────────────────────────────────

const EXAMPLE_PARTS = [
  { id: 'cpu', kind: 'w65c02' },
  { id: 'rom', kind: '28c256' },
  { id: 'ram', kind: '62256' },
  { id: 'r1', kind: 'resistor' },
  { id: 'led1', kind: 'led' },
];

const PHANTOM_WARNINGS = [
  // Phantom: mcu1 doesn't exist in the example
  { severity: 'info', rule: 'mcu-power-pins', partId: 'mcu1',
    explanation: "The chip's VCC and GND pins are not wired." },
  // Phantom: r_mcu1 doesn't exist either
  { severity: 'warning', rule: 'source-current', partId: 'r_mcu1',
    explanation: 'Quasi-bidir pin sources only 230 µA.' },
  // Valid: led1 is in the example
  { severity: 'warning', rule: 'missing-resistor', partId: 'led1',
    explanation: 'LED connected directly to supply.' },
  // No partId: should pass through
  { severity: 'info', rule: 'engine', partId: undefined,
    explanation: 'Engine note.' },
];

// ── Tests ───────────────────────────────────────────────────────────

describe('DRC phantom guard', () => {
  it('strips warnings referencing parts not in the circuit', () => {
    const filtered = phantomGuard(PHANTOM_WARNINGS, EXAMPLE_PARTS);
    // mcu1 and r_mcu1 are phantom — stripped
    assert.equal(filtered.length, 2);
    assert.equal(filtered[0].partId, 'led1');
    assert.equal(filtered[1].partId, undefined);
  });

  it('keeps all warnings when no phantoms exist', () => {
    const realWarnings = [
      { severity: 'warning', rule: 'missing-resistor', partId: 'led1' },
      { severity: 'info', rule: 'mcu-power-pins', partId: 'cpu' },
    ];
    const filtered = phantomGuard(realWarnings, EXAMPLE_PARTS);
    assert.equal(filtered.length, 2);
  });

  it('returns empty array when all warnings are phantom', () => {
    const phantomOnly = [
      { severity: 'info', rule: 'mcu-power-pins', partId: 'mcu1' },
      { severity: 'warning', rule: 'source-current', partId: 'inferred_r1' },
    ];
    const filtered = phantomGuard(phantomOnly, EXAMPLE_PARTS);
    assert.equal(filtered.length, 0);
  });

  it('handles empty parts array', () => {
    const filtered = phantomGuard(PHANTOM_WARNINGS, []);
    // Only the no-partId warning survives
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].rule, 'engine');
  });

  it('handles empty warnings array', () => {
    const filtered = phantomGuard([], EXAMPLE_PARTS);
    assert.equal(filtered.length, 0);
  });
});

describe('DRC partKind stamp', () => {
  it('stamps partKind from the circuit parts', () => {
    const warnings = [
      { severity: 'warning', rule: 'missing-resistor', partId: 'led1' },
      { severity: 'info', rule: 'mcu-power-pins', partId: 'cpu' },
    ];
    stampKind(warnings, EXAMPLE_PARTS);
    assert.equal(warnings[0].partKind, 'led');
    assert.equal(warnings[1].partKind, 'w65c02');
  });

  it('sets undefined partKind for unknown partIds', () => {
    const warnings = [
      { severity: 'info', rule: 'mcu-power-pins', partId: 'mcu1' },
    ];
    stampKind(warnings, EXAMPLE_PARTS);
    assert.equal(warnings[0].partKind, undefined);
  });

  it('skips warnings without partId', () => {
    const warnings = [
      { severity: 'info', rule: 'engine' },
    ];
    stampKind(warnings, EXAMPLE_PARTS);
    assert.equal(warnings[0].partKind, undefined);
  });
});

describe('remount storm: DRC part-id set equals example part-id set', () => {
  it('after phantom guard, every warned partId is in the example', () => {
    // Simulate the worst case: inference warnings + example warnings mixed
    const mixedWarnings = [
      // From inference (phantom)
      { severity: 'info', rule: 'mcu-power-pins', partId: 'mcu1' },
      { severity: 'warning', rule: 'source-current', partId: 'mcu1' },
      // From example (real)
      { severity: 'warning', rule: 'missing-resistor', partId: 'led1' },
      { severity: 'warning', rule: 'polarity', partId: 'cpu' },
      // Global
      { severity: 'info', rule: 'engine' },
    ];

    const filtered = phantomGuard(mixedWarnings, EXAMPLE_PARTS);
    const warnedIds = new Set(filtered.map(w => w.partId).filter(Boolean));
    const exampleIds = new Set(EXAMPLE_PARTS.map(p => p.id));

    // Every warned partId must be a subset of the example's part IDs
    for (const id of warnedIds) {
      assert.ok(exampleIds.has(id), `DRC warned about "${id}" which is not in the example`);
    }
  });

  it('permuted load orders all yield the same guard result', () => {
    const inferenceWarnings = [
      { severity: 'info', rule: 'mcu-power-pins', partId: 'mcu1' },
    ];
    const exampleWarnings = [
      { severity: 'warning', rule: 'missing-resistor', partId: 'led1' },
    ];

    // Order 1: inference first, then example
    const order1 = phantomGuard([...inferenceWarnings, ...exampleWarnings], EXAMPLE_PARTS);
    // Order 2: example first, then inference
    const order2 = phantomGuard([...exampleWarnings, ...inferenceWarnings], EXAMPLE_PARTS);

    assert.equal(order1.length, order2.length);
    assert.deepEqual(
      order1.map(w => w.partId),
      order2.map(w => w.partId),
    );
  });
});

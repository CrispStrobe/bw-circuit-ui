/**
 * Terminal-drift regression: the five part kinds that fell through
 * terminalsForKind to the default ['a','b'], silently breaking 180/819
 * benches (22%). Each has a parts-data sidecar with the FULL correct
 * terminal list; the sidecar-first lookup order must find them before
 * any hardcoded fallback shadows them.
 *
 * If this test fails, a sidecar was deleted or the sidecar-first
 * guard was bypassed — both produce the same silent 0-part board.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const partsDir = join(here, '../src/parts-data');
const circuitSrc = readFileSync(join(here, '../src/model/circuit.js'), 'utf8');

/**
 * Read a sidecar JSON and return its terminal names.
 */
function sidecarTerminals(kind) {
  try {
    const data = JSON.parse(readFileSync(join(partsDir, `${kind}.json`), 'utf8'));
    return (data.terminals || []).map(t => t.name);
  } catch { return null; }
}

// ── The five drifted kinds (stc-5d audit, 180/819 benches) ───────────

const DRIFTED = [
  { kind: 'attiny88',     minTerminals: 20, sample: ['pc6', 'pd0', 'vcc', 'gnd'] },
  { kind: 'ssd1306',      minTerminals: 4,  sample: ['vcc', 'gnd', 'sda', 'scl'] },
  { kind: 'matrix8x8',    minTerminals: 16, sample: ['col0', 'row0', 'col7', 'row7'] },
  { kind: 'slide_switch', minTerminals: 3,  sample: ['a', 'com', 'b'] },
  { kind: 'ili9341',      minTerminals: 9,  sample: ['vcc', 'gnd', 'cs', 'mosi', 'sck'] },
  { kind: 'lm358',        minTerminals: 8,  sample: ['vcc', 'gnd', '1_pos', '1_neg', '1_out', '2_out'] },
];

describe('terminal-drift regression: 5 drifted kinds resolve via sidecar', () => {
  for (const { kind, minTerminals, sample } of DRIFTED) {
    test(`${kind} sidecar has ≥${minTerminals} terminals`, () => {
      const terms = sidecarTerminals(kind);
      assert.ok(terms, `${kind}.json sidecar must exist`);
      assert.ok(terms.length >= minTerminals,
        `${kind} has ${terms.length} terminals (need ≥${minTerminals})`);
      for (const s of sample) {
        assert.ok(terms.includes(s), `${kind} sidecar must include '${s}'`);
      }
    });
  }
});

// ── Sidecar-first guard is in place ──────────────────────────────────

describe('sidecar-first lookup order', () => {
  test('terminalsForKind checks sidecar BEFORE the switch', () => {
    // The sidecar lookup must appear before the `switch (kind) {` line
    const fnStart = circuitSrc.indexOf('function terminalsForKind');
    const switchStart = circuitSrc.indexOf('switch (kind)', fnStart);
    const sidecarCheck = circuitSrc.indexOf('sidecarTerminals(kind)', fnStart);
    assert.ok(sidecarCheck > 0, 'sidecarTerminals call exists');
    assert.ok(sidecarCheck < switchStart,
      'sidecar lookup must come BEFORE the hardcoded switch');
  });

  test('DYNAMIC_SWITCH_KINDS does NOT include the 5 drifted kinds', () => {
    const dynStart = circuitSrc.indexOf('DYNAMIC_SWITCH_KINDS');
    const dynEnd = circuitSrc.indexOf(']);', dynStart);
    const dynBlock = circuitSrc.slice(dynStart, dynEnd);
    for (const { kind } of DRIFTED) {
      assert.ok(!dynBlock.includes(`'${kind}'`),
        `${kind} must NOT be in DYNAMIC_SWITCH_KINDS (it has a sidecar)`);
    }
  });
});

// ── Catch-swallowing guard ───────────────────────────────────────────

describe('_syncNetlist catch records the error', () => {
  test('setNetlist catch stores netlistError', () => {
    // Find the _syncNetlist definition (the one after the jsdoc "Build the
    // boundary-B netlist"), not a call site.
    const defIdx = circuitSrc.indexOf('_syncNetlist() {');
    assert.ok(defIdx > 0, '_syncNetlist definition found');
    // Slice to the NEXT method definition rather than a fixed byte count.
    // A fixed window silently stops covering the method as it grows: at
    // 6000 bytes this guard began passing over a truncated body and then
    // failed outright when netlistError slid past the cut, reporting "catch
    // does not record the error" about a catch that still did.
    const rest = circuitSrc.slice(defIdx + '_syncNetlist() {'.length);
    const nextDef = rest.search(/\n  [A-Za-z_]\w*\([^)]*\) \{/);
    assert.ok(nextDef > 0, 'found the end of _syncNetlist');
    const method = rest.slice(0, nextDef);
    assert.ok(method.includes('this.netlistError'), 'catch records the error');
    assert.ok(method.includes('console.warn'), 'catch warns to console');
  });
});

// ── Broad sidecar coverage: every gallery circuit part must resolve ───

describe('gallery coverage: no part kind falls to default [a,b]', () => {
  // Passives and power symbols genuinely have ≤ 2 terminals
  const TWO_TERMINAL_OK = new Set([
    'resistor', 'capacitor', 'inductor', 'led', 'diode', 'zener',
    'button', 'switch', 'buzzer', 'ldr', 'ntc', 'vcc', 'gnd',
    'vsource', 'battery', 'isource', 'breadboard', 'meter',
    'led_matrix', // legacy 2-pin shorthand
  ]);

  const galleryDir = join(here, '../gallery');
  let galleryKinds;
  try {
    const files = readdirSync(galleryDir).filter(f => f.endsWith('.json'));
    galleryKinds = new Set();
    for (const f of files) {
      const data = JSON.parse(readFileSync(join(galleryDir, f), 'utf8'));
      for (const p of data.parts || []) {
        if (p.kind) galleryKinds.add(p.kind);
      }
    }
  } catch { galleryKinds = null; }

  const skip = !galleryKinds && 'gallery dir not available';

  test('every gallery part kind has a sidecar with >2 terminals (or is a known passive)', { skip }, () => {
    const missing = [];
    for (const kind of galleryKinds) {
      if (TWO_TERMINAL_OK.has(kind)) continue;
      const terms = sidecarTerminals(kind);
      if (!terms || terms.length <= 2) {
        missing.push(kind);
      }
    }
    assert.equal(missing.length, 0,
      `gallery kinds falling to default [a,b]: ${missing.join(', ')}`);
  });
});

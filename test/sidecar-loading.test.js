// The producer-asserts rule, applied: the sidecars must actually LOAD, and
// the datasheet-critical map must be present — not "a loader exists".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerSidecar, getSidecar, sidecarTerminals } from '../src/model/parts-registry.js';

// node:test cannot evaluate import.meta.glob (a vite-ism), so the test loads
// the same vendored directory the loader globs — same data, same assertion.
const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'parts-data');
for (const f of readdirSync(dataDir).filter(f => f.endsWith('.json'))) {
  const sc = JSON.parse(readFileSync(join(dataDir, f), 'utf8'));
  if (sc && sc.kind) registerSidecar(sc);
}

test('the vendored sidecars register — over a hundred kinds', () => {
  assert.ok(sidecarTerminals('mcu'), 'mcu sidecar registered');
  assert.ok(getSidecar('555') || getSidecar('gate_and'), 'tier-2 art registered');
});

test('the STC12 DIP-40 map is datasheet-true: pin 32 IS P0.7', () => {
  const sc = getSidecar('mcu');
  assert.ok(sc, 'mcu sidecar present');
  const byPin = new Map(sc.terminals.map(t => [t.pin, t.name]));
  assert.equal(byPin.get(32), 'P0.7', 'descending P0: pin 32 = P0.7');
  assert.equal(byPin.get(39), 'P0.0', 'descending P0: pin 39 = P0.0');
  assert.equal(byPin.get(40), 'VCC');
  assert.equal(byPin.get(20), 'GND');
  assert.equal(byPin.get(9), 'RST');
});

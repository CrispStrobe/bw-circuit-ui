/**
 * Board preset circuits — structural validation.
 *
 * Each board-*.json in the gallery must:
 *   1. Parse as valid JSON with parts[] and wires[]
 *   2. Reference only known part kinds (from the sidecar registry)
 *   3. Reference only valid terminal names for each part kind
 *   4. Have no duplicate part IDs
 *   5. Have no wires referencing non-existent parts
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { registeredKinds, getSidecar } from '../src/model/parts-registry.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const galleryDir = path.join(here, '..', 'gallery');

const boardFiles = readdirSync(galleryDir)
  .filter(f => f.startsWith('board-') && f.endsWith('.json'));

/** Get valid terminal names for a part kind from sidecar data. */
function terminalsForKind(kind) {
  // Supply nodes
  if (kind === 'vcc') return ['vcc'];
  if (kind === 'gnd') return ['gnd'];
  const sc = getSidecar(kind);
  if (!sc) return null; // unknown kind
  return sc.terminals.map(t => t.name);
}

describe('Board preset circuits', () => {
  for (const file of boardFiles) {
    const label = file.replace('.json', '');

    it(`${label}: valid structure`, () => {
      const raw = readFileSync(path.join(galleryDir, file), 'utf-8');
      const circuit = JSON.parse(raw);

      assert.ok(Array.isArray(circuit.parts), 'has parts array');
      assert.ok(Array.isArray(circuit.wires), 'has wires array');
      assert.ok(circuit.parts.length > 0, 'has at least one part');
      assert.ok(circuit.wires.length > 0, 'has at least one wire');
    });

    it(`${label}: all part kinds are registered`, () => {
      const circuit = JSON.parse(readFileSync(path.join(galleryDir, file), 'utf-8'));
      const known = new Set(registeredKinds());
      for (const p of circuit.parts) {
        assert.ok(known.has(p.kind),
          `unknown part kind "${p.kind}" (id: ${p.id})`);
      }
    });

    it(`${label}: no duplicate part IDs`, () => {
      const circuit = JSON.parse(readFileSync(path.join(galleryDir, file), 'utf-8'));
      const ids = circuit.parts.map(p => p.id);
      const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
      assert.deepEqual(dupes, [], `duplicate IDs: ${dupes.join(', ')}`);
    });

    it(`${label}: all wires reference existing parts`, () => {
      const circuit = JSON.parse(readFileSync(path.join(galleryDir, file), 'utf-8'));
      const partIds = new Set(circuit.parts.map(p => p.id));
      for (const w of circuit.wires) {
        assert.ok(partIds.has(w.from),
          `wire from unknown part "${w.from}"`);
        assert.ok(partIds.has(w.to),
          `wire to unknown part "${w.to}"`);
      }
    });

    it(`${label}: all wire terminals are valid for their part kind`, () => {
      const circuit = JSON.parse(readFileSync(path.join(galleryDir, file), 'utf-8'));
      const kindById = Object.fromEntries(circuit.parts.map(p => [p.id, p.kind]));

      for (const w of circuit.wires) {
        const fromKind = kindById[w.from];
        const toKind = kindById[w.to];
        const fromTerminals = terminalsForKind(fromKind);
        const toTerminals = terminalsForKind(toKind);

        if (fromTerminals) {
          assert.ok(fromTerminals.includes(w.fromTerminal),
            `${w.from} (${fromKind}) has no terminal "${w.fromTerminal}" ` +
            `(valid: ${fromTerminals.join(', ')})`);
        }
        if (toTerminals) {
          assert.ok(toTerminals.includes(w.toTerminal),
            `${w.to} (${toKind}) has no terminal "${w.toTerminal}" ` +
            `(valid: ${toTerminals.join(', ')})`);
        }
      }
    });
  }
});

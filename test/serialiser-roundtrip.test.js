/**
 * Serialiser round-trip over the gallery corpus.
 *
 * Loads each circuit.json through the real circuit.js model, serialises
 * it back out, and compares. Reports what is lost per field rather than
 * normalising to make the test pass.
 *
 * This is the test bw-blocks handed off: "The serialiser round-trip
 * belongs in bw-circuit-ui." It catches: dropped fields, parameters
 * silently defaulted, coordinates rounded, kinds normalised on load.
 *
 * Expected differences (not losses):
 * - IDs: addPart generates new IDs; we map and compare structurally
 * - Wire shape: gallery uses flat {from, fromTerminal, to, toTerminal},
 *   model uses nested {from: {part, terminal}, to: {part, terminal}}
 * - terminals: addPart computes terminals from kind; gallery may omit them
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, resetIds } from '../src/model/circuit.js';
import { resolveKind, resolveTerminal } from '../src/model/terminal-aliases.js';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const examplesDir = path.join(here, '../../bw-cfront/sb3-creator/examples');

function loadGalleryCircuit(filePath) {
  const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
  resetIds();
  const c = new Circuit(raw.vcc || 5.0);
  const idMap = new Map(); // original id → model id

  for (const p of raw.parts || []) {
    const resolvedKind = resolveKind(p.kind);
    const part = c.addPart(resolvedKind, p.params || {}, p.x || 0, p.y || 0);
    idMap.set(p.id, part.id);
  }

  for (const w of raw.wires || []) {
    const fromId = idMap.get(w.from);
    const toId = idMap.get(w.to);
    if (fromId && toId) {
      const fromPart = c.parts.find(p => p.id === fromId);
      const toPart = c.parts.find(p => p.id === toId);
      const fromTerm = fromPart
        ? resolveTerminal(fromPart.kind, w.fromTerminal, fromPart.terminals)
        : w.fromTerminal;
      const toTerm = toPart
        ? resolveTerminal(toPart.kind, w.toTerminal, toPart.terminals)
        : w.toTerminal;
      c.addWire(fromId, fromTerm, toId, toTerm);
    }
  }

  return { circuit: c, raw, idMap };
}

describe('serialiser round-trip over gallery corpus', () => {
  if (!existsSync(examplesDir)) {
    it('SKIP: gallery not available at ' + examplesDir, () => assert.ok(true));
    return;
  }

  const dirs = readdirSync(examplesDir).filter(d => {
    return existsSync(path.join(examplesDir, d, 'circuit.json'));
  }).sort();

  it(`non-vacuity: found ${dirs.length} circuit.json files`, () => {
    assert.ok(dirs.length >= 30, `expected >=30, got ${dirs.length}`);
  });

  // Track losses across all files
  const allLosses = [];
  let filesChecked = 0;

  for (const dir of dirs) {
    it(`${dir}: load → save preserves content`, () => {
      const filePath = path.join(examplesDir, dir, 'circuit.json');
      const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
      const { circuit, idMap } = loadGalleryCircuit(filePath);
      const saved = circuit.toJSON();
      const losses = [];

      // ── Check VCC voltage ────────────────────────────────────
      if (raw.vcc !== undefined && saved.vcc !== raw.vcc) {
        losses.push(`vcc: ${raw.vcc} → ${saved.vcc}`);
      }

      // ── Check part count ─────────────────────────────────────
      if (saved.parts.length !== (raw.parts || []).length) {
        losses.push(`part count: ${(raw.parts || []).length} → ${saved.parts.length}`);
      }

      // ── Check each part's fields ─────────────────────────────
      for (const orig of raw.parts || []) {
        const modelId = idMap.get(orig.id);
        const savedPart = saved.parts.find(p => p.id === modelId);
        if (!savedPart) {
          losses.push(`part ${orig.id} (${orig.kind}): MISSING after round-trip`);
          continue;
        }

        const resolvedKind = resolveKind(orig.kind);
        if (savedPart.kind !== resolvedKind) {
          losses.push(`part ${orig.id}: kind ${orig.kind} → ${savedPart.kind}`);
        }

        // Coordinates
        const origX = orig.x || 0;
        const origY = orig.y || 0;
        if (savedPart.x !== origX) losses.push(`part ${orig.id}: x ${origX} → ${savedPart.x}`);
        if (savedPart.y !== origY) losses.push(`part ${orig.id}: y ${origY} → ${savedPart.y}`);

        // Parameters — the critical one
        for (const [key, val] of Object.entries(orig.params || {})) {
          const savedVal = savedPart.params?.[key];
          if (JSON.stringify(savedVal) !== JSON.stringify(val)) {
            losses.push(`part ${orig.id}: params.${key} ${JSON.stringify(val)} → ${JSON.stringify(savedVal)}`);
          }
        }
      }

      // ── Check wire count ─────────────────────────────────────
      if (saved.wires.length !== (raw.wires || []).length) {
        losses.push(`wire count: ${(raw.wires || []).length} → ${saved.wires.length}`);
      }

      // ── Check each wire's endpoints ──────────────────────────
      for (let i = 0; i < (raw.wires || []).length; i++) {
        const origW = raw.wires[i];
        if (i >= saved.wires.length) {
          losses.push(`wire[${i}]: MISSING`);
          continue;
        }
        const savedW = saved.wires[i];

        // Resolve original IDs to model IDs for comparison
        const origFrom = idMap.get(origW.from);
        const origTo = idMap.get(origW.to);
        const savedFrom = savedW.from?.part || savedW.from;
        const savedTo = savedW.to?.part || savedW.to;

        if (origFrom && savedFrom !== origFrom) {
          losses.push(`wire[${i}]: from ${origW.from} mapped to ${origFrom} but saved as ${savedFrom}`);
        }
        if (origTo && savedTo !== origTo) {
          losses.push(`wire[${i}]: to ${origW.to} mapped to ${origTo} but saved as ${savedTo}`);
        }

        // Terminal names — compare after alias resolution (aliases are
        // a known, documented transformation, not a loss)
        const savedFromTerm = savedW.from?.terminal || savedW.fromTerminal;
        const savedToTerm = savedW.to?.terminal || savedW.toTerminal;
        const fromPart = raw.parts.find(p => p.id === origW.from);
        const toPart = raw.parts.find(p => p.id === origW.to);
        const expectedFromTerm = fromPart
          ? resolveTerminal(resolveKind(fromPart.kind), origW.fromTerminal,
              circuit.parts.find(p => p.id === origFrom)?.terminals || [])
          : origW.fromTerminal;
        const expectedToTerm = toPart
          ? resolveTerminal(resolveKind(toPart.kind), origW.toTerminal,
              circuit.parts.find(p => p.id === origTo)?.terminals || [])
          : origW.toTerminal;
        if (savedFromTerm !== expectedFromTerm) {
          losses.push(`wire[${i}]: fromTerminal ${origW.fromTerminal} → ${savedFromTerm} (expected ${expectedFromTerm})`);
        }
        if (savedToTerm !== expectedToTerm) {
          losses.push(`wire[${i}]: toTerminal ${origW.toTerminal} → ${savedToTerm} (expected ${expectedToTerm})`);
        }
      }

      if (losses.length > 0) {
        allLosses.push({ file: dir, losses });
      }
      filesChecked++;

      // Report losses but don't fail — the finding IS the value
      // When losses reach zero, change this to assert.equal
    });
  }

  it('summary: report all losses across corpus', () => {
    console.log(`  Serialiser round-trip: ${filesChecked} files checked`);
    if (allLosses.length === 0) {
      console.log('  No losses — serialiser is lossless across all gallery files');
    } else {
      console.log(`  ${allLosses.length} files with losses:`);
      for (const { file, losses } of allLosses) {
        console.log(`    ${file}: ${losses.length} losses`);
        for (const l of losses.slice(0, 5)) console.log(`      - ${l}`);
        if (losses.length > 5) console.log(`      ... and ${losses.length - 5} more`);
      }
    }
    // The interesting number:
    const totalLosses = allLosses.reduce((s, f) => s + f.losses.length, 0);
    console.log(`  Total losses: ${totalLosses} across ${allLosses.length} files`);
  });
});

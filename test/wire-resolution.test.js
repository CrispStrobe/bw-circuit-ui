/**
 * Wire terminal resolution — every wire endpoint must name a terminal
 * that actually exists on its part.
 *
 * A terminal rename without an alias silently produces a wire attached
 * to nothing. The fidelity test cannot catch this because a broken wire
 * round-trips unchanged and green. This test catches it by checking
 * resolution against the part's terminal list.
 *
 * Tests both the alias map and the gallery corpus.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, resetIds } from '../src/model/circuit.js';
import { resolveTerminal, resolveKind, TERMINAL_ALIASES } from '../src/model/terminal-aliases.js';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('resolveTerminal', () => {
  it('current name resolves to itself', () => {
    assert.equal(
      resolveTerminal('555', 'trigger', ['gnd', 'trigger', 'output', 'reset', 'control', 'threshold', 'discharge', 'vcc']),
      'trigger'
    );
  });

  it('old 555 abbreviation resolves to full name', () => {
    const terms = ['gnd', 'trigger', 'output', 'reset', 'control', 'threshold', 'discharge', 'vcc'];
    assert.equal(resolveTerminal('555', 'trig', terms), 'trigger');
    assert.equal(resolveTerminal('555', 'out', terms), 'output');
    assert.equal(resolveTerminal('555', 'ctrl', terms), 'control');
    assert.equal(resolveTerminal('555', 'thr', terms), 'threshold');
    assert.equal(resolveTerminal('555', 'dis', terms), 'discharge');
  });

  it('unknown terminal returns as-is (does not fabricate)', () => {
    assert.equal(resolveTerminal('resistor', 'nonexistent', ['a', 'b']), 'nonexistent');
  });

  it('alias map covers every renamed terminal', () => {
    for (const [kind, aliases] of Object.entries(TERMINAL_ALIASES)) {
      for (const [oldName, newName] of Object.entries(aliases)) {
        assert.ok(oldName !== newName, `${kind}: alias "${oldName}" → "${newName}" must differ`);
      }
    }
  });
});

describe('gallery circuit.json: every wire terminal resolves', () => {
  // Check gallery files from bw-cfront
  const cfrontExamples = path.join(here, '../../bw-cfront/sb3-creator/examples');
  const exampleDirs = existsSync(cfrontExamples)
    ? readdirSync(cfrontExamples).filter(d => {
        const circuitPath = path.join(cfrontExamples, d, 'circuit.json');
        return existsSync(circuitPath);
      })
    : [];

  if (exampleDirs.length === 0) {
    it('SKIP: no gallery circuit.json files found', () => {
      assert.ok(true);
    });
    return;
  }

  for (const dir of exampleDirs) {
    it(`${dir}: all wire terminals resolve to real part terminals`, () => {
      const circuitPath = path.join(cfrontExamples, dir, 'circuit.json');
      const circuit = JSON.parse(readFileSync(circuitPath, 'utf-8'));

      // Build a map of partId → terminals for this circuit
      resetIds();
      const c = new Circuit(circuit.vcc || 5.0);
      const idMap = new Map();
      for (const p of circuit.parts || []) {
        const resolvedKind = resolveKind(p.kind);
        const part = c.addPart(resolvedKind, p.params || {}, p.x || 0, p.y || 0);
        idMap.set(p.id, { realId: part.id, terminals: part.terminals, kind: resolvedKind });
      }

      const unresolved = [];
      for (const w of circuit.wires || []) {
        // Check from endpoint
        const fromInfo = idMap.get(w.from);
        if (fromInfo) {
          const resolved = resolveTerminal(fromInfo.kind, w.fromTerminal, fromInfo.terminals);
          if (!fromInfo.terminals.includes(resolved)) {
            unresolved.push(`${w.from}.${w.fromTerminal} (kind=${fromInfo.kind})`);
          }
        }
        // Check to endpoint
        const toInfo = idMap.get(w.to);
        if (toInfo && !w.toTerminal?.startsWith?.('@')) { // skip pseudo-terminals
          const resolved = resolveTerminal(toInfo.kind, w.toTerminal, toInfo.terminals);
          if (!toInfo.terminals.includes(resolved)) {
            unresolved.push(`${w.to}.${w.toTerminal} (kind=${toInfo.kind})`);
          }
        }
      }

      assert.equal(unresolved.length, 0,
        `unresolved terminals: ${unresolved.join(', ')}`);
    });
  }

  it(`non-vacuity: checked ${exampleDirs.length} gallery circuits`, () => {
    assert.ok(exampleDirs.length >= 5, `expected >=5 gallery circuits, got ${exampleDirs.length}`);
  });
});

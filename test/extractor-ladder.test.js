/**
 * Extractor verification for the 6502 and Z80 pedagogy ladders.
 *
 * E6 must produce a config identical to the EATER6502 machine preset.
 * Z5 must produce a config identical to the SEARLE machine preset.
 * Earlier stages must refuse with specific, pedagogically useful reasons
 * (or accept with the coarse decode that stage uses).
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const galleryDir = path.join(here, '..', 'gallery');

// Import extractors and machine presets from bw-board (read-only sibling)
const { extract6502Machine } = await import('/mnt/volume1/code/bw-board/src/m6502-extract.js');
const { EATER6502 } = await import('/mnt/volume1/code/bw-board/src/m6502-machine.js');
const { extractZ80Machine } = await import('/mnt/volume1/code/bw-board/src/z80-extract.js');
const { SEARLE } = await import('/mnt/volume1/code/bw-board/src/z80-machine.js');

function loadStage(prefix) {
  const files = readdirSync(galleryDir).filter(f => f.startsWith(prefix) && f.endsWith('.json'));
  if (!files.length) return null;
  return JSON.parse(readFileSync(path.join(galleryDir, files[0]), 'utf-8'));
}

describe('6502 pedagogy ladder — extractor verification', () => {
  it('E1 free-run: refused — no memory or I/O on the board', () => {
    const circuit = loadStage('e1');
    assert.ok(circuit, 'E1 circuit exists');
    const result = extract6502Machine(circuit);
    assert.equal(result.ok, false);
    assert.ok(result.reasons.some(r => r.includes('no RAM, ROM, VIA or ACIA')),
      'refuses because there are no addressable chips');
  });

  it('E2 ROM blink: accepted — ROM covers the full address space', () => {
    const circuit = loadStage('e2');
    assert.ok(circuit, 'E2 circuit exists');
    const result = extract6502Machine(circuit);
    assert.equal(result.ok, true, `refused: ${result.reasons.join('; ')}`);
    assert.ok(result.regions.some(r => r.kind === 'rom'), 'has ROM region');
  });

  it('E3 VIA blink: accepted — coarse decode, VIA mirrors to $0000', () => {
    const circuit = loadStage('e3');
    assert.ok(circuit, 'E3 circuit exists');
    const result = extract6502Machine(circuit);
    assert.equal(result.ok, true, `refused: ${result.reasons.join('; ')}`);
    assert.ok(result.chips.some(c => c.kind === 'via'), 'has VIA chip');
  });

  it('E5 serial: refused — coarse decode causes VIA/ACIA contention', () => {
    const circuit = loadStage('e5');
    assert.ok(circuit, 'E5 circuit exists');
    const result = extract6502Machine(circuit);
    assert.equal(result.ok, false);
    assert.ok(result.reasons.some(r => r.includes('bus contention')),
      'teaches: coarse decode causes bus contention when adding a second I/O chip');
  });

  it('E6 full EATER6502: accepted, config matches the machine preset', () => {
    const circuit = loadStage('e6');
    assert.ok(circuit, 'E6 circuit exists');
    const result = extract6502Machine(circuit);
    assert.equal(result.ok, true, `refused: ${result.reasons.join('; ')}`);

    // Compare regions (sorted by start address)
    const extractedRegions = result.regions.sort((a, b) => a.start - b.start);
    const presetRegions = EATER6502.regions.sort((a, b) => a.start - b.start);
    assert.deepEqual(extractedRegions, presetRegions,
      'extracted memory map equals EATER6502 preset');

    // Compare chips (sorted by base address)
    const extractedChips = result.chips.sort((a, b) => a.at - b.at);
    const presetChips = EATER6502.chips.sort((a, b) => a.at - b.at);
    assert.deepEqual(extractedChips, presetChips,
      'extracted chip map equals EATER6502 preset');
  });
});

describe('Z80 pedagogy ladder — extractor verification', () => {
  it('Z1 free-run: refused — no memory or I/O on the board', () => {
    const circuit = loadStage('z1');
    assert.ok(circuit, 'Z1 circuit exists');
    const result = extractZ80Machine(circuit);
    assert.equal(result.ok, false);
    assert.ok(result.reasons.some(r => r.includes('no RAM, ROM or ACIA')),
      'refuses because there are no addressable chips');
  });

  it('Z4 ROM+RAM: accepted — simple decode with 74HC00', () => {
    const circuit = loadStage('z4');
    assert.ok(circuit, 'Z4 circuit exists');
    const result = extractZ80Machine(circuit);
    assert.equal(result.ok, true, `refused: ${result.reasons.join('; ')}`);
    assert.ok(result.regions.some(r => r.kind === 'rom'), 'has ROM region');
    assert.ok(result.regions.some(r => r.kind === 'ram'), 'has RAM region');
  });

  it('Z5 Searle serial: accepted, config matches the SEARLE preset', () => {
    const circuit = loadStage('z5');
    assert.ok(circuit, 'Z5 circuit exists');
    const result = extractZ80Machine(circuit);
    assert.equal(result.ok, true, `refused: ${result.reasons.join('; ')}`);

    // Compare regions
    const extractedRegions = result.regions.sort((a, b) => a.start - b.start);
    const presetRegions = SEARLE.regions.sort((a, b) => a.start - b.start);
    assert.deepEqual(extractedRegions, presetRegions,
      'extracted memory map equals SEARLE preset');

    // Compare ports
    const extractedPorts = result.ports.sort((a, b) => a.at - b.at);
    const presetPorts = SEARLE.ports.sort((a, b) => a.at - b.at);
    assert.deepEqual(extractedPorts, presetPorts,
      'extracted port map equals SEARLE preset');
  });
});

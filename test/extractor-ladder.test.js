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

// Import extractors and machine presets from bw-board (read-only sibling).
//
// These four were ABSOLUTE paths into /mnt/volume1/code/bw-board -- a VPS
// checkout. Off that one machine the imports throw ERR_MODULE_NOT_FOUND and
// the whole file dies before a single test registers, which is invisible
// because the file is not in `npm test` either. The same defect was found the
// same day in bw-board's stc15-bench-load, where a hardcoded VPS path made it
// report "found 0 benches" everywhere else. Sibling-relative is how every
// other test in this directory reaches the engine.
const { extract6502Machine } = await import('../../bw-board/src/m6502-extract.js');
const { EATER6502 } = await import('../../bw-board/src/m6502-machine.js');
const { extractZ80Machine } = await import('../../bw-board/src/z80-extract.js');
const { SEARLE } = await import('../../bw-board/src/z80-machine.js');

function loadStage(prefix) {
  const files = readdirSync(galleryDir).filter(f => f.startsWith(prefix) && f.endsWith('.json'));
  if (!files.length) return null;
  return JSON.parse(readFileSync(path.join(galleryDir, files[0]), 'utf-8'));
}

describe('6502 pedagogy ladder — extractor verification', () => {
  it('E0 clock module: refused — no CPU on the board', () => {
    const circuit = loadStage('e0');
    assert.ok(circuit, 'E0 circuit exists');
    const result = extract6502Machine(circuit);
    assert.equal(result.ok, false);
    assert.ok(result.reasons.some(r => r.includes('no W65C02')),
      'refuses because there is no CPU');
  });

  it('E1 CPU-alive: refused — no memory or I/O chips', () => {
    const circuit = loadStage('e1');
    assert.ok(circuit, 'E1 circuit exists');
    const result = extract6502Machine(circuit);
    assert.equal(result.ok, false);
    assert.ok(result.reasons.some(r => r.includes('no RAM, ROM, VIA or ACIA')),
      'refuses because there are no addressable chips');
  });

  it('E2 ROM only: accepted — ROM covers the full address space', () => {
    const circuit = loadStage('e2');
    assert.ok(circuit, 'E2 circuit exists');
    const result = extract6502Machine(circuit);
    assert.equal(result.ok, true, `refused: ${result.reasons.join('; ')}`);
    assert.ok(result.regions.some(r => r.kind === 'rom'), 'has ROM region');
  });

  it('E2.5 6507SBC: refused — no W65C02 (R6507 is a different CPU)', () => {
    const circuit = loadStage('e2.5');
    assert.ok(circuit, 'E2.5 circuit exists');
    const result = extract6502Machine(circuit);
    assert.equal(result.ok, false);
    assert.ok(result.reasons.some(r => r.includes('no W65C02')),
      'refuses because the CPU is an R6507, not a W65C02');
  });

  it('E3 74HC374 latch: accepted — ROM at $8000-$FFFF, latch is bus peripheral', () => {
    const circuit = loadStage('e3');
    assert.ok(circuit, 'E3 circuit exists');
    const result = extract6502Machine(circuit);
    assert.equal(result.ok, true, `refused: ${result.reasons.join('; ')}`);
    assert.ok(result.regions.some(r => r.kind === 'rom'), 'has ROM region');
  });

  it('E4 VIA blink: accepted — coarse decode, VIA in $4000-$7FFF', () => {
    const circuit = loadStage('e4');
    assert.ok(circuit, 'E4 circuit exists');
    const result = extract6502Machine(circuit);
    assert.equal(result.ok, true, `refused: ${result.reasons.join('; ')}`);
    assert.ok(result.chips.some(c => c.kind === 'via'), 'has VIA chip');
  });

  it('E6 full EATER6502: accepted, config matches the machine preset', () => {
    const circuit = loadStage('e6');
    assert.ok(circuit, 'E6 circuit exists');
    const result = extract6502Machine(circuit);
    assert.equal(result.ok, true, `refused: ${result.reasons.join('; ')}`);

    const extractedRegions = result.regions.sort((a, b) => a.start - b.start);
    const presetRegions = EATER6502.regions.sort((a, b) => a.start - b.start);
    assert.deepEqual(extractedRegions, presetRegions,
      'extracted memory map equals EATER6502 preset');

    const extractedChips = result.chips.sort((a, b) => a.at - b.at);
    const presetChips = EATER6502.chips.sort((a, b) => a.at - b.at);
    // Compare the fields the preset actually DEFINES. `span` is compared
    // separately by the sentinel below, because the two sides disagree about
    // it in a way that is not this repo's to settle -- and folding it into a
    // deepEqual here would either hide the disagreement or fail forever.
    const contractual = (c) => ({ kind: c.kind, name: c.name, at: c.at });
    assert.deepEqual(extractedChips.map(contractual), presetChips.map(contractual),
      'extracted chip map equals EATER6502 preset');
  });

  /**
   * OPEN DEFECT (bw-board): the extractor and the preset disagree about how
   * wide a chip's decode window is, and they are the same repo's two answers
   * to one question.
   *
   *   m6502-extract.js  gives via1 span 8192 and acia1 span 4096, read off the
   *                     board's actual address decoding
   *   EATER6502 preset  omits span, and m6502-machine.js:184 then defaults it
   *                     to `regs` -- the chip's register count, 16
   *
   * That is not a missing field, it is different EMULATED BEHAVIOUR. On Ben
   * Eater's board the decode uses the high address lines, so the VIA is
   * selected across $6000-$7FFF and mirrors every 16 bytes; a program reading
   * $6010 finds the VIA on real hardware and on the extracted config, and
   * finds nothing on the preset config. The extractor is the faithful one.
   *
   * Recorded rather than reconciled: bw-board owns both sides and this repo
   * may not edit a sibling. WHEN THIS TEST GOES RED, bw-board has settled it
   * -- delete this sentinel and fold `span` back into the deepEqual above.
   */
  it('OPEN DEFECT: extractor reports a decode span the preset does not carry', () => {
    const circuit = loadStage('e6');
    const result = extract6502Machine(circuit);
    const spans = Object.fromEntries(result.chips.map(c => [c.name, c.span]));
    assert.deepEqual(spans, { via1: 8192, acia1: 4096 },
      'the extractor still reads these decode windows off the board');
    assert.ok(EATER6502.chips.every(c => c.span === undefined),
      'the EATER6502 preset still omits span, so bw-board still has two answers');
  });
});

describe('Z80 pedagogy ladder — extractor verification', () => {
  it('Z1 free-run: refused — no memory or I/O on the board', () => {
    const circuit = loadStage('z1');
    assert.ok(circuit, 'Z1 circuit exists');
    const result = extractZ80Machine(circuit);
    assert.equal(result.ok, false);
    // Matched loosely on purpose. The extractor's wording drifted to
    // "no RAM, ROM, ACIA or OUT latch on the board" when OUT-latch support
    // landed, and this assertion did not notice for the same reason the
    // wording was free to drift: the file was in nobody's `npm test`. Pin the
    // stable core of the sentence rather than a prose snapshot that any
    // future capability will break again.
    assert.ok(result.reasons.some(r => /no RAM, ROM[ ,]/.test(r)),
      `refuses because there are no addressable chips; got: ${result.reasons.join('; ')}`);
  });

  it('Z1.5 ROM only: accepted — ROM at $0000-$7FFF', () => {
    const circuit = loadStage('z1.5');
    assert.ok(circuit, 'Z1.5 circuit exists');
    const result = extractZ80Machine(circuit);
    assert.equal(result.ok, true, `refused: ${result.reasons.join('; ')}`);
    assert.ok(result.regions.some(r => r.kind === 'rom'), 'has ROM region');
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

    const extractedRegions = result.regions.sort((a, b) => a.start - b.start);
    const presetRegions = SEARLE.regions.sort((a, b) => a.start - b.start);
    assert.deepEqual(extractedRegions, presetRegions,
      'extracted memory map equals SEARLE preset');

    const extractedPorts = result.ports.sort((a, b) => a.at - b.at);
    const presetPorts = SEARLE.ports.sort((a, b) => a.at - b.at);
    assert.deepEqual(extractedPorts, presetPorts,
      'extracted port map equals SEARLE preset');
  });
});

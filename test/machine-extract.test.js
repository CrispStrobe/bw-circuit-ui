/**
 * Machine extraction — verifies that hand-wired circuits produce
 * bootable machine configs via the bw-board extractors.
 *
 * Uses the canonical Eater6502 decode as fixture (same as
 * bw-board/test/m6502-extract.test.mjs eaterCircuit()).
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractMachine } from '../src/model/machine-extract.js';

// Import extractors from sibling bw-board checkout
const { extract6502Machine } = await import('../../bw-board/src/m6502-extract.js');
const { extractZ80Machine } = await import('../../bw-board/src/z80-extract.js');

const extractors = { extract6502Machine, extractZ80Machine };

/** The canonical Eater6502 decode (from bw-board test fixture). */
function eaterCircuit() {
  const parts = [
    { id: 'cpu1', kind: 'w65c02' },
    { id: 'ram1', kind: '62256' },
    { id: 'rom1', kind: '28c256' },
    { id: 'via1', kind: 'w65c22' },
    { id: 'acia1', kind: 'w65c51' },
    { id: 'glue1', kind: '74hc00' },
    { id: 'glue2', kind: '74hc00' },
  ];
  const wires = [];
  const w = (from, ft, to, tt) => wires.push({ from, fromTerminal: ft, to, toTerminal: tt });
  for (let i = 0; i <= 14; i++) {
    w('cpu1', `a${i}`, 'ram1', `a${i}`);
    w('cpu1', `a${i}`, 'rom1', `a${i}`);
  }
  for (let i = 0; i <= 3; i++) w('cpu1', `a${i}`, 'via1', `rs${i}`);
  for (let i = 0; i <= 1; i++) w('cpu1', `a${i}`, 'acia1', `rs${i}`);
  w('cpu1', 'a15', 'glue1', '1a'); w('cpu1', 'a15', 'glue1', '1b');
  w('cpu1', 'a14', 'glue1', '2a'); w('cpu1', 'a14', 'glue1', '2b');
  w('glue1', '1y', 'glue1', '3a'); w('glue1', '2y', 'glue1', '3b');
  w('glue1', '3y', 'ram1', 'csb');
  w('glue1', '1y', 'rom1', 'ceb');
  w('glue1', '1y', 'glue1', '4a'); w('cpu1', 'a14', 'glue1', '4b');
  w('glue1', '4y', 'via1', 'cs2b');
  w('cpu1', 'a13', 'via1', 'cs1');
  w('glue1', '4y', 'glue2', '1a'); w('glue1', '4y', 'glue2', '1b');
  w('cpu1', 'a13', 'glue2', '2a'); w('cpu1', 'a13', 'glue2', '2b');
  w('glue2', '1y', 'glue2', '3a'); w('glue2', '2y', 'glue2', '3b');
  w('glue2', '3y', 'acia1', 'cs1b');
  w('cpu1', 'a12', 'acia1', 'cs0');
  return { parts, wires };
}

describe('extractMachine', () => {
  it('canonical Eater decode extracts to a bootable config', () => {
    const result = extractMachine(eaterCircuit(), extractors);
    assert.ok(result.ok, `extraction failed: ${result.reasons?.join('; ')}`);
    assert.equal(result.kind, 'eater6502');
    assert.ok(result.regions.length >= 2, 'has RAM and ROM regions');
    assert.ok(result.chips.length >= 1, 'has at least one chip (VIA)');
    assert.ok(result.regions.some(r => r.kind === 'ram'), 'has RAM');
    assert.ok(result.regions.some(r => r.kind === 'rom'), 'has ROM');
    assert.ok(result.chips.some(c => c.kind === 'via'), 'has VIA');
    assert.ok(result.lines.length > 0, 'has MAP/CHIP lines');
  });

  it('missing CPU refused with a clear reason', () => {
    const result = extractMachine({ parts: [{ id: 'r1', kind: 'resistor' }], wires: [] }, extractors);
    assert.equal(result.ok, false);
    assert.ok(result.reasons.length > 0);
  });

  it('bus contention (two chips at one address) is refused', () => {
    // Wire both RAM and ROM CSB to GND (always selected → contention)
    const circuit = eaterCircuit();
    // Remove the glue wires to RAM CSB and ROM CEB, connect both to GND
    circuit.wires = circuit.wires.filter(w =>
      !(w.to === 'ram1' && w.toTerminal === 'csb') &&
      !(w.to === 'rom1' && w.toTerminal === 'ceb'));
    // Add a GND part and wire both chip selects low
    circuit.parts.push({ id: 'gnd1', kind: 'gnd' });
    circuit.wires.push(
      { from: 'gnd1', fromTerminal: 'gnd', to: 'ram1', toTerminal: 'csb' },
      { from: 'gnd1', fromTerminal: 'gnd', to: 'rom1', toTerminal: 'ceb' },
    );
    const result = extractMachine(circuit, extractors);
    assert.equal(result.ok, false, 'contention must be refused');
    assert.ok(result.reasons.some(r => /contention/i.test(r) || /two chips/i.test(r)),
      `expected contention reason, got: ${result.reasons.join('; ')}`);
  });

  it('refusal reasons include address ranges (named)', () => {
    // ROM CSB floating (not wired) → vector region is undriven
    const parts = [
      { id: 'cpu1', kind: 'w65c02' },
      { id: 'rom1', kind: '28c256' },
    ];
    const wires = [];
    for (let i = 0; i <= 14; i++) wires.push({ from: 'cpu1', fromTerminal: `a${i}`, to: 'rom1', toTerminal: `a${i}` });
    // Note: CSB/CEB not wired — ROM chip select is floating
    const result = extractMachine({ parts, wires }, extractors);
    assert.equal(result.ok, false);
    assert.ok(result.reasons.length > 0, 'has reasons');
  });

  it('empty circuit returns no-retro-cpu reason', () => {
    const result = extractMachine({ parts: [], wires: [] }, extractors);
    assert.equal(result.ok, false);
    assert.ok(result.reasons[0].includes('no retro CPU'));
  });

  it('a seated CPU with no injected extractor blames the host, not the circuit', () => {
    // Regression: with extractors missing, a board carrying a W65C02 used
    // to answer "no retro CPU found" — a lie that sent a debugging session
    // hunting a chip that was seated in plain sight.
    const result = extractMachine({ parts: [{ id: 'cpu1', kind: 'w65c02' }], wires: [] }, {});
    assert.equal(result.ok, false);
    assert.ok(result.reasons[0].includes('no machine extractor wired'), result.reasons[0]);
    assert.ok(!result.reasons[0].includes('no retro CPU'), 'must not blame the circuit');
  });
});

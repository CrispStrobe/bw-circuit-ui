/**
 * Tests for netlist extraction and export serializers.
 *
 * Uses a synthetic circuit (555 timer with R, C, LED) rather than
 * loading gallery JSON, because resolvedNets requires a live engine.
 * We mock the minimal Circuit shape that extractNetlist needs.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractNetlist } from '../src/model/netlist.js';
import { toSpice } from '../src/model/exporters/spice.js';
import { toKicadNet } from '../src/model/exporters/kicad.js';
import { toEasyEDA } from '../src/model/exporters/easyeda.js';
import { PART_SYMBOLS } from '../src/data/easyeda-symbols.js';

// ── Mock circuit: 555 timer with 2 resistors, 1 cap, 1 LED ──────
const MOCK_CIRCUIT = {
  parts: [
    { id: 'vcc1', kind: 'vcc', params: {} },
    { id: 'gnd1', kind: 'gnd', params: {} },
    { id: 'r1', kind: 'resistor', params: { ohms: 1000 } },
    { id: 'r2', kind: 'resistor', params: { ohms: 470000 } },
    { id: 'c1', kind: 'capacitor', params: { farads: 1e-6 } },
    { id: 'timer', kind: '555', params: {} },
    { id: 'led1', kind: 'led', params: { color: 'green', vf: 2.0 } },
    { id: 'bb1', kind: 'breadboard_full', params: {} },
  ],
  resolvedNets: [
    { id: 'net-vcc', terminals: [
      { part: 'r1', terminal: 'a' },
      { part: 'timer', terminal: 'vcc' },
    ]},
    { id: 'net-1', terminals: [
      { part: 'r1', terminal: 'b' },
      { part: 'r2', terminal: 'a' },
      { part: 'timer', terminal: 'discharge' },
    ]},
    { id: 'net-2', terminals: [
      { part: 'r2', terminal: 'b' },
      { part: 'c1', terminal: 'a' },
      { part: 'timer', terminal: 'threshold' },
      { part: 'timer', terminal: 'trigger' },
    ]},
    { id: 'net-out', terminals: [
      { part: 'timer', terminal: 'output' },
      { part: 'led1', terminal: 'anode' },
    ]},
    { id: 'net-gnd', terminals: [
      { part: 'c1', terminal: 'b' },
      { part: 'led1', terminal: 'cathode' },
      { part: 'timer', terminal: 'gnd' },
    ]},
  ],
};

// ── extractNetlist ───────────────────────────────────────────────

describe('extractNetlist', () => {
  it('assigns stable refdes by kind', () => {
    const nl = extractNetlist(MOCK_CIRCUIT);
    const r1 = nl.parts.find(p => p.partId === 'r1');
    const r2 = nl.parts.find(p => p.partId === 'r2');
    assert.ok(r1 && r1.refdes.startsWith('R'), `R1 got ${r1?.refdes}`);
    assert.ok(r2 && r2.refdes.startsWith('R'), `R2 got ${r2?.refdes}`);
    assert.notEqual(r1.refdes, r2.refdes, 'distinct refdes');
  });

  it('excludes breadboard and power rails', () => {
    const nl = extractNetlist(MOCK_CIRCUIT);
    const kinds = nl.parts.map(p => p.kind);
    assert.ok(!kinds.includes('breadboard_full'), 'no breadboard');
    assert.ok(!kinds.includes('vcc'), 'no vcc');
    assert.ok(!kinds.includes('gnd'), 'no gnd');
  });

  it('derives values from params', () => {
    const nl = extractNetlist(MOCK_CIRCUIT);
    const r1 = nl.parts.find(p => p.partId === 'r1');
    assert.equal(r1.value, '1k');
    const c1 = nl.parts.find(p => p.partId === 'c1');
    assert.equal(c1.value, '1u');
  });

  it('builds nets with correct node references', () => {
    const nl = extractNetlist(MOCK_CIRCUIT);
    assert.ok(nl.nets.length >= 4, `got ${nl.nets.length} nets`);
    // Every node in every net should reference a valid part
    for (const net of nl.nets) {
      for (const node of net.nodes) {
        const found = nl.parts.find(p => p.refdes === node.refdes);
        assert.ok(found, `node ${node.refdes} in net ${net.name} has a matching part`);
      }
    }
  });
});

// ── SPICE exporter ──────────────────────────────────────────────

describe('toSpice', () => {
  it('produces valid SPICE deck with .end', () => {
    const nl = extractNetlist(MOCK_CIRCUIT);
    const { text, skipped } = toSpice(nl);
    assert.ok(text.includes('.end'), 'has .end');
    assert.ok(text.includes('R'), 'has resistor card');
    assert.ok(text.includes('C'), 'has capacitor card');
  });

  it('skips complex parts with a note', () => {
    const nl = extractNetlist(MOCK_CIRCUIT);
    const { text, skipped } = toSpice(nl);
    // 555 timer should be skipped (SPICE card = 'X')
    assert.ok(skipped.some(s => s.includes('555')), '555 skipped');
    assert.ok(text.includes('* U'), 'skip comment in output');
  });

  it('emits model statements', () => {
    const nl = extractNetlist(MOCK_CIRCUIT);
    const { text } = toSpice(nl);
    assert.ok(text.includes('.model'), 'has .model');
    assert.ok(text.includes('LED'), 'has LED model');
  });
});

// ── KiCad exporter ──────────────────────────────────────────────

describe('toKicadNet', () => {
  it('produces valid S-expression with (export ...)', () => {
    const nl = extractNetlist(MOCK_CIRCUIT);
    const text = toKicadNet(nl);
    assert.ok(text.startsWith('(export'), 'starts with (export');
    assert.ok(text.includes('(components'), 'has components block');
    assert.ok(text.includes('(nets'), 'has nets block');
  });

  it('includes all non-infrastructure parts as components', () => {
    const nl = extractNetlist(MOCK_CIRCUIT);
    const text = toKicadNet(nl);
    for (const part of nl.parts) {
      assert.ok(text.includes(`(ref ${part.refdes}`) || text.includes(`(ref "${part.refdes}"`),
        `component ${part.refdes} present`);
    }
  });

  it('includes net nodes referencing parts', () => {
    const nl = extractNetlist(MOCK_CIRCUIT);
    const text = toKicadNet(nl);
    assert.ok(text.includes('(net (code'), 'has net entries');
    assert.ok(text.includes('(node (ref'), 'has node entries');
  });
});

// ── EasyEDA exporter ────────────────────────────────────────────

describe('toEasyEDA', () => {
  it('returns KiCad net text plus import instructions', () => {
    const nl = extractNetlist(MOCK_CIRCUIT);
    const { text, instructions } = toEasyEDA(nl);
    assert.ok(text.includes('(export'), 'KiCad format');
    assert.ok(instructions.includes('EasyEDA'), 'has EasyEDA instructions');
    assert.ok(instructions.includes('Import'), 'has import steps');
  });
});

// ── Symbol map coverage ─────────────────────────────────────────

describe('PART_SYMBOLS', () => {
  it('covers common passive kinds', () => {
    for (const kind of ['resistor', 'capacitor', 'inductor', 'diode', 'led']) {
      assert.ok(PART_SYMBOLS[kind], `${kind} has symbol entry`);
      assert.ok(PART_SYMBOLS[kind].spiceCard, `${kind} has spiceCard`);
      assert.ok(PART_SYMBOLS[kind].kicadSymbol, `${kind} has kicadSymbol`);
    }
  });

  it('covers transistors', () => {
    for (const kind of ['npn', 'pnp', 'nmos', 'pmos']) {
      assert.ok(PART_SYMBOLS[kind], `${kind} has symbol entry`);
    }
  });

  it('covers ICs', () => {
    for (const kind of ['555', 'opamp', '74hc00', '74hc595']) {
      assert.ok(PART_SYMBOLS[kind], `${kind} has symbol entry`);
    }
  });
});

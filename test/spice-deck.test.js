/**
 * The SPICE deck, as a structure.
 *
 * scripts/spice-oracle.mjs judges the same exporter against a real simulator
 * and is the stronger check, but it needs ngspice on the machine. These tests
 * pin the four structural properties a deck must have to be RUNNABLE at all,
 * plus the value-suffix rule, so `npm test` fails the moment any of them is
 * reintroduced — with or without a simulator installed.
 *
 * What was measured before the fix (2026-08-30, at 77ab613):
 *   - every deck we had ever exported: no node 0, no source, no analysis
 *     directive. The VCC/GND rename tested `net.id` for the substrings
 *     "vcc"/"gnd"; real engine ids are `net-lgc-2`, `n-bb1-row-12`, `net-7`
 *     and can contain neither, so the rename fired on zero circuits.
 *   - `formatSi` writes 1 MOhm as `1M`; SPICE reads a bare `M` as milli.
 *     19 values in the shipped example corpus were at or above 1e6 and would
 *     have been exported 10^9 times too small.
 *
 * @module
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Circuit } from '../src/model/circuit.js';
import { extractNetlist } from '../src/model/netlist.js';
import { toSpice, junctionModel } from '../src/model/exporters/spice.js';
import { formatSi, formatSpiceValue } from '../src/model/si.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The bench X0.1's acceptance names: 5 V, 1 kOhm, one LED. */
function bench(extra = {}) {
  return Circuit.fromJSON({
    parts: [
      { id: 'VCC1', kind: 'vcc', params: {}, x: 0, y: 0 },
      { id: 'GND1', kind: 'gnd', params: {}, x: 0, y: 200 },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, x: 60, y: 0 },
      { id: 'LED1', kind: 'led', params: { color: 'red' }, x: 120, y: 0 },
      ...(extra.parts || []),
    ],
    wires: [
      { from: 'VCC1', fromTerminal: 'vcc', to: 'R1', toTerminal: 'a' },
      { from: 'R1', fromTerminal: 'b', to: 'LED1', toTerminal: 'anode' },
      { from: 'LED1', fromTerminal: 'cathode', to: 'GND1', toTerminal: 'gnd' },
      ...(extra.wires || []),
    ],
  });
}

/** Node fields of every element card (the first field is the refdes). */
function elementNodeTokens(text) {
  return new Set(text.split('\n')
    .filter(l => l.trim() && !l.trim().startsWith('*') && !l.trim().startsWith('.'))
    .flatMap(l => l.trim().split(/\s+/).slice(1)));
}

// ── X0.2: the value suffix ───────────────────────────────────────────

describe('SPICE value suffixes (X0.2)', () => {
  it('writes mega as MEG, because a bare M is milli to every SPICE', () => {
    assert.equal(formatSpiceValue(1e6), '1MEG');
    assert.equal(formatSpiceValue(2.2e6), '2.2MEG');
    assert.equal(formatSpiceValue(4.7e6), '4.7MEG');
  });

  it('writes milli as m, and the two are not the same string', () => {
    assert.equal(formatSpiceValue(1e-3), '1m');
    assert.equal(formatSpiceValue(2.2e-3), '2.2m');
    assert.notEqual(formatSpiceValue(2.2e6), formatSpiceValue(2.2e-3));
  });

  it('the display formatter still says M — and that is the bug, in one line', () => {
    // formatSi is right for a schematic and wrong for a deck. Both spellings
    // of 2.2e6 exist on purpose; only one may reach a .cir.
    assert.equal(formatSi(2.2e6), '2.2M');
    assert.equal(formatSpiceValue(2.2e6), '2.2MEG');
  });

  it('covers the rest of the scale without an ambiguous letter', () => {
    assert.equal(formatSpiceValue(1e9), '1G');
    assert.equal(formatSpiceValue(4.7e3), '4.7k');
    assert.equal(formatSpiceValue(470), '470');
    assert.equal(formatSpiceValue(1e-6), '1u');
    assert.equal(formatSpiceValue(100e-9), '100n');
    assert.equal(formatSpiceValue(10e-12), '10p');
    assert.equal(formatSpiceValue(0), '0');
    assert.equal(formatSpiceValue(-4700), '-4.7k');
  });

  it('does not print a float artefact for round values', () => {
    // (1e-6 * 1e6) is 1.0000000000000002 in IEEE754; `1.0000000000000002u`
    // is a legal but absurd deck value.
    assert.equal(formatSpiceValue(1e-6), '1u');
    assert.equal(formatSpiceValue(4.7e-6), '4.7u');
  });

  it('a 1 MOhm resistor leaves the exporter as 1MEG, not 1M', () => {
    const c = bench({
      parts: [{ id: 'R9', kind: 'resistor', params: { ohms: 1e6 }, x: 200, y: 0 }],
      wires: [
        { from: 'VCC1', fromTerminal: 'vcc', to: 'R9', toTerminal: 'a' },
        { from: 'R9', fromTerminal: 'b', to: 'GND1', toTerminal: 'gnd' },
      ],
    });
    c.setPower(true);
    const { text } = toSpice(extractNetlist(c));
    const card = text.split('\n').find(l => /^R\d+\s/.test(l) && /MEG|M\b/.test(l));
    assert.ok(card, `no megohm card in:\n${text}`);
    assert.match(card, /1MEG\s*$/, `megohm card must say MEG: ${card}`);
    assert.ok(!/\s1M\s*$/.test(card), `card says milli-ohm: ${card}`);
  });

  it('no value in the shipped corpus can be written with a bare M', () => {
    // The measured blast radius of the bug, kept as a property so a new
    // example carrying a megohm part cannot re-open it.
    const roots = [
      path.resolve(here, '../gallery'),
      path.resolve(here, 'fixtures'),
      path.resolve(here, '../../sb3-creator/examples'),
    ].filter(existsSync);
    let scanned = 0;
    const offenders = [];
    const walk = (o, file) => {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) { o.forEach(x => walk(x, file)); return; }
      for (const k of ['ohms', 'farads', 'henrys', 'voltage', 'vz']) {
        const v = o[k];
        if (typeof v === 'number' && isFinite(v) && v > 0) {
          scanned++;
          if (/^[\d.]+M$/.test(formatSpiceValue(v))) offenders.push(`${file} ${k}=${v}`);
        }
      }
      for (const v of Object.values(o)) walk(v, file);
    };
    const scan = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) scan(p);
        else if (e.name.endsWith('.json')) {
          try { walk(JSON.parse(readFileSync(p, 'utf-8')), e.name); } catch { /* not a circuit */ }
        }
      }
    };
    roots.forEach(scan);
    assert.ok(scanned > 100, `corpus sweep found only ${scanned} values — did the corpus move?`);
    assert.deepEqual(offenders, [], 'values that would export as milli');
  });
});

// ── X0.1: the deck is runnable ───────────────────────────────────────

describe('the exported deck is structurally simulatable (X0.1)', () => {
  it('maps the ground net to node 0 and never emits it by name', () => {
    const c = bench(); c.setPower(true);
    const netlist = extractNetlist(c);
    const gnd = netlist.nets.find(n => n.rail === 'gnd');
    assert.ok(gnd, 'the netlist knows which net the gnd part sits on');
    const { text } = toSpice(netlist);
    const tokens = elementNodeTokens(text);
    assert.ok(tokens.has('0'), `no element references node 0:\n${text}`);
    assert.ok(!tokens.has(gnd.name),
      `ground is spelled '${gnd.name}' instead of 0 — ngspice aliases that name `
      + `to 0 as a courtesy, other readers do not:\n${text}`);
  });

  it('synthesizes a DC source for the supply rail', () => {
    const c = bench(); c.setPower(true);
    const { text } = toSpice(extractNetlist(c));
    assert.match(text, /^V\S*\s+VCC\s+0\s+DC\s+5\s*$/m,
      `no synthesized supply card:\n${text}`);
  });

  it('emits an analysis directive — without one SPICE computes nothing', () => {
    const c = bench(); c.setPower(true);
    const { text } = toSpice(extractNetlist(c));
    assert.match(text, /^\.op\s*$/m);
    assert.match(text, /^\*\.tran\s+\S+\s+\S+\s*$/m, 'a commented .tran template');
    assert.match(text, /^\.end\s*$/m);
  });

  it('names rails by the rail PART on the net, not by a substring of the id', () => {
    const c = bench(); c.setPower(true);
    const netlist = extractNetlist(c);
    const names = netlist.nets.map(n => n.name);
    assert.ok(names.includes('GND'), `no GND among ${names.join(', ')}`);
    assert.ok(names.includes('VCC'), `no VCC among ${names.join(', ')}`);
    // The engine's ids are what the old substring test was reading. If one of
    // them ever DID contain "gnd" this test would pass for the wrong reason,
    // so assert the premise.
    for (const net of netlist.nets) {
      assert.ok(!/vcc|gnd/i.test(net.id || ''),
        `engine id ${net.id} contains a rail substring — the old test could `
        + 'have worked and this test proves nothing');
    }
  });

  it('gives each junction its own model derived from that part\'s Vf', () => {
    const c = Circuit.fromJSON({
      parts: [
        { id: 'VCC1', kind: 'vcc', params: {}, x: 0, y: 0 },
        { id: 'GND1', kind: 'gnd', params: {}, x: 0, y: 200 },
        { id: 'R1', kind: 'resistor', params: { ohms: 470 }, x: 60, y: 0 },
        { id: 'LED1', kind: 'led', params: { vf: 3.2 }, x: 120, y: 0 },
        { id: 'D1', kind: 'diode', params: { vf: 0.7 }, x: 180, y: 0 },
      ],
      wires: [
        { from: 'VCC1', fromTerminal: 'vcc', to: 'R1', toTerminal: 'a' },
        { from: 'R1', fromTerminal: 'b', to: 'LED1', toTerminal: 'anode' },
        { from: 'LED1', fromTerminal: 'cathode', to: 'D1', toTerminal: 'anode' },
        { from: 'D1', fromTerminal: 'cathode', to: 'GND1', toTerminal: 'gnd' },
      ],
    });
    c.setPower(true);
    const { text } = toSpice(extractNetlist(c));
    const models = text.split('\n').filter(l => l.startsWith('.model') && / D \(/.test(l));
    assert.equal(models.length, 2,
      `a blue LED and a signal diode need two models, got ${models.length}:\n${text}`);
    assert.ok(models.some(m => /N=1\.8/.test(m)), 'the LED keeps its 1.8 ideality');
    assert.ok(models.some(m => /N=1(\s|\))/.test(m)), 'the silicon diode keeps 1.0');
    // Every referenced model must be declared: a card naming a model that is
    // not in the deck is exactly the "loads and cannot run" failure.
    for (const line of text.split('\n')) {
      const m = line.match(/^D\d+\s+\S+\s+\S+\s+(\S+)\s*$/);
      if (m) assert.ok(text.includes(`.model ${m[1]} `), `undeclared model ${m[1]}`);
    }
  });

  it('calibrates Is the way the engine does: Vf at the rated 20 mA', () => {
    // Hand-computable: nVt = 1.8 * 0.02585 = 0.04653, Vj(20 mA) = 2.0 - 0.04,
    // Is = 0.020 / (exp(1.96/0.04653) - 1).
    const j = junctionModel({ kind: 'led', params: { vf: 2.0 } });
    assert.equal(j.n, 1.8);
    assert.equal(j.rs, 2);
    const nVt = 1.8 * 0.02585;
    const expected = 0.020 / (Math.exp((2.0 - 0.020 * 2) / nVt) - 1);
    assert.ok(Math.abs(j.is - expected) / expected < 1e-12,
      `Is ${j.is} vs hand-computed ${expected}`);
    // And the model reproduces its own premise: at Is/N/Rs, 20 mA drops 2.0 V.
    const vAt20mA = nVt * Math.log(0.020 / j.is + 1) + 0.020 * j.rs;
    assert.ok(Math.abs(vAt20mA - 2.0) < 1e-9, `Vf at 20 mA came back as ${vAt20mA}`);
  });

  it('splits a potentiometer into the two resistors the engine stamps', () => {
    const c = Circuit.fromJSON({
      parts: [
        { id: 'VCC1', kind: 'vcc', params: {}, x: 0, y: 0 },
        { id: 'GND1', kind: 'gnd', params: {}, x: 0, y: 200 },
        { id: 'RV1', kind: 'potentiometer', params: { ohms: 10000, position: 0.3 }, x: 60, y: 0 },
        { id: 'R1', kind: 'resistor', params: { ohms: 2200 }, x: 140, y: 0 },
      ],
      wires: [
        { from: 'VCC1', fromTerminal: 'vcc', to: 'RV1', toTerminal: 'a' },
        { from: 'RV1', fromTerminal: 'b', to: 'GND1', toTerminal: 'gnd' },
        { from: 'RV1', fromTerminal: 'wiper', to: 'R1', toTerminal: 'a' },
        { from: 'R1', fromTerminal: 'b', to: 'GND1', toTerminal: 'gnd' },
      ],
    });
    c.setPower(true);
    const { text } = toSpice(extractNetlist(c));
    const legs = text.split('\n').filter(l => /^RRV1[AB]\s/.test(l));
    assert.equal(legs.length, 2, `pot must be two resistors:\n${text}`);
    // position 0.3 -> a..wiper is 70 % of travel, wiper..b is 30 %.
    assert.match(legs[0], /\s7k\s*$/, `a-wiper leg: ${legs[0]}`);
    assert.match(legs[1], /\s3k\s*$/, `wiper-b leg: ${legs[1]}`);
    // The wiper node must actually appear, shared by both legs and the load.
    const wiperNode = legs[0].trim().split(/\s+/)[2];
    assert.equal(legs[1].trim().split(/\s+/)[1], wiperNode, 'legs share the wiper node');
    assert.ok(text.split('\n').some(l => /^R1\s/.test(l) && l.includes(wiperNode)),
      `the load is not on the wiper node ${wiperNode}:\n${text}`);
  });

  it('uses the engine\'s own default for a valueless part, and says so', () => {
    const c = Circuit.fromJSON({
      parts: [
        { id: 'VCC1', kind: 'vcc', params: {}, x: 0, y: 0 },
        { id: 'GND1', kind: 'gnd', params: {}, x: 0, y: 200 },
        { id: 'R1', kind: 'resistor', params: {}, x: 60, y: 0 },
      ],
      wires: [
        { from: 'VCC1', fromTerminal: 'vcc', to: 'R1', toTerminal: 'a' },
        { from: 'R1', fromTerminal: 'b', to: 'GND1', toTerminal: 'gnd' },
      ],
    });
    c.setPower(true);
    const { text, warnings } = toSpice(extractNetlist(c));
    // The old serializer wrote `1`, turning the engine's 1 kOhm into 1 Ohm.
    assert.match(text, /^R1\s+VCC\s+0\s+1k\s*$/m, `valueless resistor:\n${text}`);
    assert.ok(warnings.some(w => /R1.*default/.test(w)),
      `the substitution must be stated: ${JSON.stringify(warnings)}`);
  });

  it('refuses quietly to pretend: a circuit with no rails warns by name', () => {
    const c = Circuit.fromJSON({
      parts: [
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, x: 0, y: 0 },
        { id: 'R2', kind: 'resistor', params: { ohms: 1000 }, x: 60, y: 0 },
      ],
      wires: [{ from: 'R1', fromTerminal: 'b', to: 'R2', toTerminal: 'a' }],
    });
    c.setPower(true);
    const { text, warnings } = toSpice(extractNetlist(c));
    assert.ok(warnings.some(w => /ground/i.test(w)), `no ground warning: ${warnings}`);
    assert.ok(warnings.some(w => /vcc|suppl/i.test(w)), `no supply warning: ${warnings}`);
    // The warnings must be IN the file, not only in the return value: the
    // person who receives this deck is not the person who pressed export.
    for (const w of warnings) assert.ok(text.includes(w), `warning missing from deck: ${w}`);
  });

  it('follows the engine\'s ground fallback when there is no gnd part', () => {
    // bw-setup: with no gnd part the first vsource's neg net is the reference.
    // A deck referenced differently from the solve is a deck that disagrees.
    const c = Circuit.fromJSON({
      parts: [
        { id: 'V1', kind: 'vsource', params: { v: 9 }, x: 0, y: 0 },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, x: 60, y: 0 },
      ],
      wires: [
        { from: 'V1', fromTerminal: 'pos', to: 'R1', toTerminal: 'a' },
        { from: 'R1', fromTerminal: 'b', to: 'V1', toTerminal: 'neg' },
      ],
    });
    c.setPower(true);
    const { text, warnings } = toSpice(extractNetlist(c));
    assert.ok(elementNodeTokens(text).has('0'), `no node 0:\n${text}`);
    assert.ok(warnings.some(w => /negative net/.test(w)),
      `the fallback must be stated: ${JSON.stringify(warnings)}`);
  });
});

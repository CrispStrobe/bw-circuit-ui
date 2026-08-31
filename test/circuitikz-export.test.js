import './_setup.js';
import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {Circuit} from '../src/model/circuit.js';
import {escapeTex, toCircuitikz} from '../src/model/exporters/circuitikz.js';
import {CIRCUIT_EXPORTS, runExport} from '../src/model/exporters/registry.js';

function bench() {
  return Circuit.fromJSON({
    parts: [
      {id: 'VCC1', kind: 'vcc', params: {}, x: 0, y: 0},
      {id: 'GND1', kind: 'gnd', params: {}, x: 0, y: 200},
      {id: 'R_1%&#${}\\^~Ωµ', declName: 'load_1%&#${}\\^~Ωµ', kind: 'resistor', params: {ohms: 220}, x: 60, y: 0},
      {id: 'D1', kind: 'led', params: {}, x: 120, y: 0},
      {id: 'U1', kind: '74hc595', params: {}, terminals: ['data', 'vcc', 'gnd'], x: 180, y: 0},
      {id: 'bb1', kind: 'breadboard', params: {}, x: 0, y: 300},
    ],
    wires: [
      {from: 'VCC1', fromTerminal: 'vcc', to: 'R_1%&#${}\\^~Ωµ', toTerminal: 'a'},
      {from: 'R_1%&#${}\\^~Ωµ', fromTerminal: 'b', to: 'D1', toTerminal: 'anode'},
      {from: 'D1', fromTerminal: 'cathode', to: 'GND1', toTerminal: 'gnd'},
      {from: 'R_1%&#${}\\^~Ωµ', fromTerminal: 'b', to: 'U1', toTerminal: 'data'},
      {from: 'U1', fromTerminal: 'vcc', to: 'VCC1', toTerminal: 'vcc'},
      {from: 'U1', fromTerminal: 'gnd', to: 'GND1', toTerminal: 'gnd'},
    ],
  });
}

describe('X1.4 circuitikz export', () => {
  it('escapes every TeX metacharacter without re-escaping inserted macros', () => {
    assert.equal(escapeTex('a_b%&$#{}\\^~Ωµ'),
      'a\\_b\\%\\&\\$\\#\\{\\}\\textbackslash{}\\textasciicircum{}'
      + '\\textasciitilde{}\\ensuremath{\\Omega}\\ensuremath{\\mu}');
  });

  it('emits a complete deterministic document with native and total fallback parts', () => {
    const a = toCircuitikz(bench());
    const b = toCircuitikz(bench());
    assert.equal(a.text, b.text);
    assert.match(a.text, /^\\documentclass\{article\}/);
    assert.match(a.text, /\\usepackage\{circuitikz\}/);
    assert.ok(a.text.endsWith('\\end{document}\n'));
    assert.match(a.text, /to\[R,l=\{/);
    assert.match(a.text, /to\[leD,l=\{/);
    assert.match(a.text, /% Substituted: U1 \(74hc595\): labelled box/);
    assert.match(a.text, /% Omitted infrastructure: bb1 \(breadboard\)/);
    assert.equal(a.unsupported.length, 0);
    assert.equal(a.substituted.length,
      a.projection.symbols.filter(s => !(new Set(['resistor', 'led']).has(s.kind)
        && s.pins.length === 2 && !s.generic)).length);
    for (const pin of a.projection.symbols.find(s => s.id === 'U1').pins) {
      assert.ok(a.text.includes(`{${escapeTex(pin.name)}};`), `missing pin ${pin.name}`);
    }
    assert.doesNotMatch(a.text, /load_1%/);
    assert.match(a.text, /load\\_1\\%\\&\\#\\\$\\\{\\\}\\textbackslash/);
  });

  it('uses the Circuit resolved nets rather than the lossy wire fallback', () => {
    const circuit = bench();
    let reads = 0;
    const plain = {
      parts: circuit.parts,
      wires: [],
      get resolvedNets() { reads++; return circuit.resolvedNets; },
    };
    const out = toCircuitikz(plain);
    assert.equal(reads, 1);
    assert.ok(out.projection.wires.length + out.projection.netLabels.length >= 2,
      'resolved nets must preserve connectivity even when raw wires are unavailable');
  });

  it('is registered, reachable, bilingual, and reports substitutions', async () => {
    const entry = CIRCUIT_EXPORTS.find(e => e.id === 'circuitikz');
    assert.ok(entry);
    assert.ok(entry.label && entry.labelDe);
    assert.equal(entry.needs, 'circuit');
    const {files, report} = await runExport(entry, {circuit: bench()});
    assert.deepEqual(files.map(f => [f.name, f.mime]), [['schematic.tex', 'text/x-tex']]);
    assert.ok(files[0].text.length > 500);
    assert.ok(report.substituted.some(s => s.startsWith('U1 ')));
    assert.deepEqual(report.skipped, []);
  });

  it('accounts independently for projection routes, labels, junctions and symbols', () => {
    // Keep this fixture sparse enough to use drawn copper rather than the
    // projection's equally-valid repeated-label routing.  A route deletion
    // must therefore exercise the segment denominator below.
    const out = toCircuitikz(Circuit.fromJSON({
      parts: [
        {id: 'VCC1', kind: 'vcc', params: {}},
        {id: 'R1', kind: 'resistor', params: {ohms: 1000}},
        {id: 'GND1', kind: 'gnd', params: {}},
      ],
      wires: [
        {from: 'VCC1', fromTerminal: 'vcc', to: 'R1', toTerminal: 'a'},
        {from: 'R1', fromTerminal: 'b', to: 'GND1', toTerminal: 'gnd'},
      ],
    }));
    assert.ok(out.projection.wires.length > 0, 'mutation fixture must exercise drawn routes');
    const segmentCount = out.projection.wires.reduce((n, route) => n
      + (route.segments ? route.segments.length : 1 + route.stubs.length), 0);
    const draws = (out.text.match(/^\\draw /gm) || []).length;
    const boxAndPinDraws = out.substituted.reduce((n, item) => {
      const id = item.slice(0, item.indexOf(' ('));
      const symbol = out.projection.symbols.find(s => s.id === id);
      return n + 1 + symbol.pins.length;
    }, 0);
    const native = out.projection.symbols.length - out.substituted.length;
    assert.equal(draws, segmentCount + out.projection.netLabels.length + boxAndPinDraws + native,
      'dropping a projected conductor or symbol must change the accounting');
    assert.equal((out.text.match(/^\\fill /gm) || []).length, out.projection.junctions.length);
    assert.equal((out.text.match(/^\\node\[font=\\tiny,anchor=/gm) || []).length,
      out.projection.netLabels.length
      + out.substituted.reduce((n, item) => {
        const id = item.slice(0, item.indexOf(' ('));
        return n + out.projection.symbols.find(s => s.id === id).pins.length;
      }, 0));
  });
});

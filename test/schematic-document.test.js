/**
 * X0.4 — the schematic as a DOCUMENT.
 *
 * `renderSchematicSvg` has drawn a complete schematic headlessly since the
 * projection existed; the panel offered no way to keep one, so the drawing was
 * a thing you could look at and never a thing you could hand to anybody.
 *
 * The acceptance the ROADMAP asks for is "opens standalone with all
 * symbols/labels intact (no CSS-dependent invisibility)", and that is a
 * property of the FILE, not of the app that wrote it. So this file reads the
 * bytes and asserts them:
 *
 *   - the root carries the SVG namespace, so a file manager and an <img> both
 *     render it (an SVG without xmlns is XML, and XML draws nothing);
 *   - nothing in it references a stylesheet, a class, an external font, or an
 *     external image — a viewer with no CSS at all draws the same picture;
 *   - every text and every stroke names its own paint, because the default
 *     for an unstyled SVG shape is `fill:black; stroke:none`, which on this
 *     drawing's background is either an invisible label or a filled blob;
 *   - the symbol count matches the projection's, so "the file opened" cannot
 *     stand in for "the file has the circuit in it";
 *   - the geometry is byte-identical to what the projection laid out, so the
 *     document path cannot become a second, drifting renderer.
 *
 * @module
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/model/circuit.js';
import { projectSchematic } from '../src/model/schematic-projection.js';
import { renderSchematicSvg } from '../src/model/schematic-svg.js';
import { CIRCUIT_EXPORTS, runExport } from '../src/model/exporters/registry.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(import.meta.dirname, '../src');

/** A bench with a standard-symbol part, a generic-box part and a rail each. */
function bench() {
  return Circuit.fromJSON({
    parts: [
      { id: 'VCC1', kind: 'vcc', params: {}, x: 0, y: 0 },
      { id: 'GND1', kind: 'gnd', params: {}, x: 0, y: 240 },
      { id: 'R1', kind: 'resistor', params: { ohms: 10000 }, x: 60, y: 0 },
      { id: 'C1', kind: 'capacitor', params: { farads: 1e-7 }, x: 120, y: 0 },
      { id: 'LED1', kind: 'led', params: { color: 'red' }, x: 180, y: 0 },
      { id: 'U1', kind: '74hc595', params: {}, x: 240, y: 0 },
    ],
    wires: [
      { from: 'VCC1', fromTerminal: 'vcc', to: 'R1', toTerminal: 'a' },
      { from: 'R1', fromTerminal: 'b', to: 'C1', toTerminal: 'a' },
      { from: 'C1', fromTerminal: 'b', to: 'GND1', toTerminal: 'gnd' },
      { from: 'R1', fromTerminal: 'b', to: 'LED1', toTerminal: 'anode' },
      { from: 'LED1', fromTerminal: 'cathode', to: 'GND1', toTerminal: 'gnd' },
      { from: 'R1', fromTerminal: 'b', to: 'U1', toTerminal: 'DS' },
      { from: 'U1', fromTerminal: 'GND', to: 'GND1', toTerminal: 'gnd' },
      { from: 'U1', fromTerminal: 'VCC', to: 'VCC1', toTerminal: 'vcc' },
    ],
  });
}

const documentFor = (c) => renderSchematicSvg({ parts: c.parts, wires: c.wires });

describe('X0.4: the saved schematic stands on its own', () => {
  it('is a complete SVG document, namespace and all', () => {
    const { svg } = documentFor(bench());
    assert.match(svg, /^<svg [^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/,
      'without xmlns the file is XML, and XML draws nothing');
    assert.match(svg, /viewBox="0 0 \d+ \d+"/);
    assert.match(svg, /\bwidth="\d+"/);
    assert.match(svg, /\bheight="\d+"/);
    assert.ok(svg.endsWith('</svg>'), 'the document is closed');
    // Well-formedness, not a regex opinion of it: every tag opened is closed.
    const opens = (svg.match(/<(?!\/)[a-zA-Z]/g) || []).length;
    const closes = (svg.match(/<\/[a-zA-Z]/g) || []).length + (svg.match(/\/>/g) || []).length;
    assert.equal(opens, closes, 'every element is closed exactly once');
  });

  it('references nothing outside itself', () => {
    const { svg } = documentFor(bench());
    for (const [what, re] of [
      ['a stylesheet link', /<\?xml-stylesheet|<link\b/],
      ['a style block', /<style\b/],
      ['a CSS class', /\bclass="/],
      ['an external href', /href="(?!#)/],
      ['a url() reference', /url\(/],
      ['an <image>', /<image\b/],
      ['a script', /<script\b/],
    ]) {
      assert.doesNotMatch(svg, re, `a standalone drawing must not carry ${what}`);
    }
  });

  it('every label names its own paint and its own font', () => {
    // The failure this forbids: an unstyled <text> defaults to `fill:black`,
    // and on the light background that is a label you can read but on the dark
    // one it is a label that is simply not there. Same for a <path> with no
    // stroke — it renders as a black fill of its own outline, which for a
    // resistor zig-zag is a smear.
    for (const dark of [false, true]) {
      const { svg } = renderSchematicSvg(
        { parts: bench().parts, wires: bench().wires }, { dark });
      for (const tag of svg.match(/<text\b[^>]*>/g) || []) {
        assert.match(tag, /\bfill="#/, `a <text> with no fill: ${tag}`);
        assert.match(tag, /font-family="/, `a <text> with no font-family: ${tag}`);
        assert.match(tag, /font-size="/, `a <text> with no font-size: ${tag}`);
      }
      // Fonts must be GENERIC families: a drawing that names a font the reader
      // does not have is a drawing whose labels reflow.
      for (const m of svg.matchAll(/font-family="([^"]+)"/g)) {
        assert.equal(m[1], 'monospace',
          'only the generic families are safe in a file that travels');
      }
      // Every drawn group carries an explicit stroke; the shapes inherit it.
      for (const g of svg.match(/<g transform="translate\([^)]*\)"[^>]*>/g) || []) {
        assert.match(g, /stroke="#/, `a symbol group with no stroke: ${g}`);
      }
    }
  });

  it('contains the projection\'s symbols, counted', () => {
    const c = bench();
    const r = documentFor(c);
    const proj = projectSchematic(c.parts, c.board.getNets());
    // Six parts; the projection decides which of them it draws (a rail may be
    // folded into a net label). Whatever it decided, the file says the same.
    assert.ok(proj.symbols.length >= 4, `only ${proj.symbols.length} symbols projected`);
    assert.equal(r.symbols, proj.symbols.length);
    const groups = (r.svg.match(/<g transform="translate\(/g) || []).length;
    assert.equal(groups, r.symbols,
      'one translated group per symbol — the count in the file IS the count in the projection');
    // Every symbol's label appears as text in the file.
    for (const s of proj.symbols) {
      assert.ok(r.svg.includes(`>${s.label}<`), `symbol ${s.id}'s label "${s.label}" is missing`);
    }
    // And a standard symbol is a standard symbol, not a box for everything:
    // the 74hc595 is a labelled box (generic), the resistor is not.
    assert.ok(r.generic >= 1 && r.generic < r.symbols,
      `generic=${r.generic} of ${r.symbols} — either everything or nothing is a box`);
  });

  it('draws at the projection\'s own coordinates, not a second layout', () => {
    const c = bench();
    const r = documentFor(c);
    const proj = projectSchematic(c.parts, c.board.getNets());
    for (const s of proj.symbols) {
      assert.ok(r.svg.includes(`<g transform="translate(${s.x} ${s.y})"`),
        `symbol ${s.id} is drawn at (${s.x}, ${s.y}) in the projection but not in the file`);
    }
    assert.equal(r.width, Math.max(1, Math.ceil(proj.width)));
    assert.equal(r.height, Math.max(1, Math.ceil(proj.height)));
  });

  it('an empty circuit produces a valid, empty drawing rather than a broken file', () => {
    const r = renderSchematicSvg({ parts: [], wires: [] });
    assert.equal(r.symbols, 0);
    assert.match(r.svg, /^<svg [^>]*xmlns=/);
    assert.ok(r.svg.endsWith('</svg>'));
    assert.ok(r.width >= 1 && r.height >= 1, 'never a zero-sized viewBox');
  });
});

describe('X0.4: the save is reachable and says what it could not draw', () => {
  const entry = (id) => CIRCUIT_EXPORTS.find(e => e.id === id);

  it('the SVG save is a registry entry that produces a non-empty file', async () => {
    const e = entry('schematic-svg');
    assert.ok(e, 'schematic-svg is not registered — no menu can reach it');
    const { files, report } = await runExport(e, { circuit: bench() });
    assert.equal(files.length, 1);
    assert.equal(files[0].name, 'schematic.svg');
    assert.equal(files[0].mime, 'image/svg+xml');
    assert.ok(files[0].text.length > 500, `only ${files[0].text.length} bytes`);
    assert.ok(report.warnings.some(w => /74hc595/.test(w)),
      `the report must name the parts it could only box: ${JSON.stringify(report.warnings)}`);
  });

  it('a schematic with no compromises reports none', async () => {
    const plain = Circuit.fromJSON({
      parts: [
        { id: 'VCC1', kind: 'vcc', params: {}, x: 0, y: 0 },
        { id: 'GND1', kind: 'gnd', params: {}, x: 0, y: 200 },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, x: 60, y: 0 },
      ],
      wires: [
        { from: 'VCC1', fromTerminal: 'vcc', to: 'R1', toTerminal: 'a' },
        { from: 'R1', fromTerminal: 'b', to: 'GND1', toTerminal: 'gnd' },
      ],
    });
    const { report } = await runExport(entry('schematic-svg'), { circuit: plain });
    assert.deepEqual(report.warnings, [],
      'a clean drawing must not carry a warning, or the warning means nothing');
  });

  it('the PNG save is registered, browser-only, and honest about it', () => {
    const e = entry('schematic-png');
    assert.ok(e, 'schematic-png is not registered');
    assert.equal(e.browserOnly, true, 'rasterising needs Canvas 2D — say so');
    assert.equal(e.needs, 'circuit');
  });

  it('the panel offers both, and saves the DOCUMENT rather than its camera', () => {
    const panel = readFileSync(path.join(SRC, 'components/SchematicPanel.jsx'), 'utf-8');
    assert.ok(panel.includes('bw-schematic-save-svg'), 'no SVG save control in the panel');
    assert.ok(panel.includes('bw-schematic-save-png'), 'no PNG save control in the panel');
    assert.ok(panel.includes('renderSchematicSvg'),
      'the panel must save through the headless renderer');
    // The trap this forbids: serializing the panel\'s own <svg>, whose viewBox
    // is the CAMERA. That would save whatever happened to be on screen.
    assert.ok(!/XMLSerializer|serializeSvgStandalone/.test(panel),
      'the panel must not serialize its own camera-carrying element');
  });
});

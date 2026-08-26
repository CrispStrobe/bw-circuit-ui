/**
 * Fritzing import — the format the maker web is drawn in.
 *
 * The fixture is a hand-authored three-part loop (battery → resistor →
 * LED → battery) with one drawn wire and one custom part, because those
 * are the four cases that decide whether an import is trustworthy:
 * values parse, wires dissolve, nets form, and an unknown chip is
 * REPORTED rather than guessed.
 *
 * The one subtlety worth a test of its own is the VIEW. A Fritzing
 * document states its connections three times — breadboard, schematic,
 * pcb — and they are not the same graph: the breadboard view routes
 * through the board's own strips, so reading it would import
 * connections the circuit does not have. The fixture's breadboard view
 * deliberately contains a connection to a model index that exists in no
 * other view; if the reader ever drifts to the wrong view, that stray
 * edge shows up.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { importFritzing, importFzz, looksLikeFritzing, parseFritzingValue } from '../src/importers/fritzing.js';
import { detectFormat } from '../src/importers/detect.js';
import { readZipEntriesSync } from '../src/importers/zip.js';

const FIX = join(import.meta.dirname, 'fixtures');
const mini = readFileSync(join(FIX, 'fritzing-mini.fz'), 'utf8');

describe('Fritzing values', () => {
  it('reads the human strings Fritzing stores', () => {
    assert.equal(parseFritzingValue('220'), 220);
    assert.equal(parseFritzingValue('2.2k'), 2200);
    assert.equal(parseFritzingValue('220Ω'), 220);
    // 100 * 1e-9 is not exactly 1e-7 in binary floating point, so this is
    // a tolerance check — the parser is right and an exact compare is not.
    assert.ok(Math.abs(parseFritzingValue('100nF') - 1e-7) < 1e-18);
    assert.equal(parseFritzingValue('1M'), 1e6);
    assert.equal(parseFritzingValue(''), null);
    assert.equal(parseFritzingValue('whatever'), null);
  });
});

describe('Fritzing document', () => {
  const r = importFritzing(mini);

  it('is detected as fritzing, and only fritzing', () => {
    assert.equal(looksLikeFritzing(mini), true);
    assert.equal(looksLikeFritzing('<kicad_pcb/>'), false);
    assert.equal(detectFormat(mini), 'fritzing');
  });

  it('maps the parts it knows, with their values', () => {
    const byId = Object.fromEntries(r.parts.map((p) => [p.id, p]));
    assert.deepEqual(Object.keys(byId).sort(), ['BAT1', 'LED1', 'R1']);
    assert.equal(byId.R1.kind, 'resistor');
    assert.equal(byId.R1.params.ohms, 220);
    assert.equal(byId.LED1.kind, 'led');
    assert.equal(byId.LED1.params.color, 'red');
    assert.equal(byId.BAT1.kind, 'vsource');
  });

  it('REPORTS the custom chip instead of guessing at it', () => {
    assert.equal(r.unmapped.length, 1);
    assert.equal(r.unmapped[0].ref, 'U1');
    assert.equal(r.unmapped[0].pins, 2);
    assert.match(r.unmapped[0].reason, /custom part/);
    assert.ok(r.warnings.some((w) => /could not be mapped/.test(w)),
      'an unmapped part must be said out loud, not left to be noticed');
  });

  it('builds the loop: battery → resistor → LED → battery', () => {
    // Three nets, each joining exactly two mapped terminals, so the star
    // expansion is one wire per net.
    const edge = (a, b) => r.wires.some((w) => (
      (`${w.from}.${w.fromTerminal}` === a && `${w.to}.${w.toTerminal}` === b)
      || (`${w.from}.${w.fromTerminal}` === b && `${w.to}.${w.toTerminal}` === a)));
    assert.equal(r.wires.length, 3, `expected 3 wires, got ${JSON.stringify(r.wires)}`);
    assert.ok(edge('R1.a', 'BAT1.pos'), 'resistor to battery +');
    assert.ok(edge('R1.b', 'LED1.anode'), 'resistor to LED anode');
    assert.ok(edge('LED1.cathode', 'BAT1.neg'), 'LED cathode back to battery −');
  });

  it('dissolves drawn wires rather than importing them as parts', () => {
    assert.ok(!r.parts.some((p) => /Wire/i.test(p.id)), 'a drawn wire is not a component');
    assert.ok(r.warnings.some((w) => /dissolved into nets/.test(w)));
  });

  it('reads the SCHEMATIC view, not the breadboard one', () => {
    // The fixture's breadboard view links R1 to model index 99, which
    // exists nowhere else. Reading that view would either throw the edge
    // away silently or attach it to nothing; either way it must not be
    // the graph we imported from.
    const viaBreadboard = importFritzing(mini, { view: 'breadboardView' });
    assert.equal(viaBreadboard.wires.length, 0,
      'the breadboard view of this fixture has no mapped-to-mapped edge');
    assert.equal(r.wires.length, 3, 'the schematic view is the one that carries the circuit');
  });
});

// ── the real archive, if the owner's download is present ───────────
//
// GPL-3.0 Hackster project, not redistributable, so it is never
// committed — the test simply skips when it is not on this machine.

const FZZ = join(homedir(), 'Downloads', 'schematic_N5CPUEXiA3.fzz');

describe('a real .fzz archive (skips when absent)', { skip: !existsSync(FZZ) }, () => {
  it('opens the zip and reads the document inside', async () => {
    const buf = readFileSync(FZZ);
    const { entries } = readZipEntriesSync(buf);
    assert.ok(entries.some((e) => /\.fz$/.test(e.name)), 'archive carries a .fz document');
    const r = await importFzz(buf);
    // Six 2.2k resistors and four LEDs are what the published BOM lists.
    const res = r.parts.filter((p) => p.kind === 'resistor');
    assert.equal(res.length, 6);
    assert.ok(res.every((p) => p.params.ohms === 2200), 'all six are 2.2k');
    assert.equal(r.parts.filter((p) => p.kind === 'led').length, 4);
    // Its five logic ICs are custom parts: reported, never invented.
    const ics = r.unmapped.filter((u) => u.pins === 14);
    assert.equal(ics.length, 5, 'the five 14-pin chips are reported as unmapped');
    assert.ok(r.warnings.some((w) => /dissolved into nets/.test(w)));
  });
});

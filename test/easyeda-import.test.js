/**
 * EasyEDA import: the NET PARTITION, not "it parsed".
 *
 * EasyEDA states connectivity as geometry, so the only failure worth guarding
 * is the quiet one: every part present, every symbol accounted for, and
 * connections missing or invented. A test that checks `parts.length > 0`
 * passes just as happily on an importer that wires nothing.
 *
 * So the fixtures are HAND-AUTHORED and their expected partitions are worked
 * out on paper before the code is run:
 *
 *   easyeda-rc-divider.json   VCC - R1 - (R2 || C1 || P1) - GND, with the
 *                             mid-node reached by a T-connection off a wire
 *                             span, a junction dot, a rail joined only by its
 *                             flag, a pinless sheet frame and one part no
 *                             rule maps. R2/C1/P1 are placed at 90/180/270
 *                             degrees and their pins are still written in
 *                             sheet space -- applying the rotation moves them
 *                             off the wires and the partition collapses.
 *
 *   easyeda-bus.json          two bus signals, D0 and D1, whose four labels
 *                             all sit ON the bus line. If the bus body
 *                             conducted, D0 and D1 would be one net; if bus
 *                             entries did not, neither would exist at all.
 *                             Both mutations are asserted, in both directions.
 *
 * Neither fixture is a vendor file. The 8085 devkit board that the format was
 * decoded from is read at ~/code/kicad-refs and is NOT copied into this repo,
 * so the tests that use it skip when it is absent.
 */

import './_setup.js';
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { netsFromWires } from '../src/model/schematic-svg.js';
import { terminalsForKind } from '../src/model/circuit.js';
import { detectFormat } from '../src/importers/detect.js';
import { importCircuit } from '../src/importers/index.js';
import {
  importEasyEda, easyEdaPartition, easyEdaSheets, readComponents,
  parseLibAttrs, mapEasyEdaPart, logicKind, looksLikeEasyEda, EASYEDA_RULES,
} from '../src/importers/easyeda.js';

const HERE = import.meta.dirname;
const CUI = join(HERE, '..');
const BWB = process.env.BW_BOARD || join(CUI, '..', 'bw-board');
const FIX = join(HERE, 'fixtures');

const RC = readFileSync(join(FIX, 'easyeda-rc-divider.json'), 'utf8');
const BUS = readFileSync(join(FIX, 'easyeda-bus.json'), 'utf8');

/** Connected components over wire endpoints -- the electrical partition. */
function partition(wires) {
  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); }
    return x;
  };
  for (const w of wires) {
    const a = find(w.from + ' ' + w.fromTerminal); const b = find(w.to + ' ' + w.toTerminal);
    if (a !== b) parent.set(a, b);
  }
  const groups = new Map();
  for (const k of parent.keys()) {
    const r = find(k); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(k);
  }
  return [...groups.values()].map((v) => v.sort().join('|')).sort();
}

/** Rewrite one fixture's shape array; returns fresh JSON text. */
function remap(text, fn) {
  const doc = JSON.parse(text);
  doc.schematics[0].dataStr.shape = fn(doc.schematics[0].dataStr.shape);
  return JSON.stringify(doc);
}

// ── detection ──────────────────────────────────────────────────────

describe('detectFormat recognises EasyEDA without stealing anyone else\'s files', () => {
  test('an EasyEDA document is detected by content, not extension', () => {
    assert.equal(detectFormat(RC, 'anything.json'), 'easyeda');
    assert.equal(detectFormat(BUS, 'no-extension'), 'easyeda');
  });

  test('our OWN circuit JSON is not mistaken for EasyEDA', () => {
    // The dangerous collision: both are `.json`. Ours has a parts ARRAY and no
    // editorVersion; bin/bwc.mjs checks for that array before it ever calls
    // detectFormat, and detectFormat must not claim it either.
    const ours = JSON.stringify({
      vcc: 5,
      parts: [{ id: 'R1', kind: 'resistor', params: { ohms: 1000 }, x: 0, y: 0 }],
      wires: [{ from: 'R1', fromTerminal: 'a', to: 'R1', toTerminal: 'b' }],
    });
    assert.equal(detectFormat(ours, 'circuit.json'), null);
  });

  test('a Wokwi diagram is still Wokwi', () => {
    const wokwi = JSON.stringify({
      version: 1, author: 'x', editor: 'wokwi',
      parts: [{ type: 'wokwi-resistor', id: 'r1' }],
      connections: [['r1:1', 'r2:2', 'green', []]],
    });
    assert.equal(detectFormat(wokwi, 'diagram.json'), 'wokwi');
  });

  test('EAGLE and KiCad are untouched', () => {
    assert.equal(detectFormat('<?xml version="1.0"?><eagle version="6.0"></eagle>', 'a.sch'), 'eagle');
    assert.equal(detectFormat('(kicad_sch (version 20211123))', 'a.kicad_sch'), 'kicad-sch');
    assert.equal(detectFormat('EESchema Schematic File Version 4', 'a.sch'), 'kicad-legacy');
  });

  test('looksLikeEasyEda needs BOTH the version and a payload key', () => {
    // Or every JSON file in the corpus becomes an EasyEDA schematic.
    assert.equal(looksLikeEasyEda('{"editorVersion":"6.5.50"}'), false);
    assert.equal(looksLikeEasyEda('{"shape":["W~1 2 3 4"]}'), false);
    assert.equal(looksLikeEasyEda('not json at all'), false);
    assert.equal(looksLikeEasyEda('{"editorVersion":"6.5.50","shape":[]}'), true);
  });

  test('the registry routes the format', () => {
    const r = importCircuit('easyeda', RC);
    assert.ok(r.parts.length > 0, 'importCircuit("easyeda", ...) reached the importer');
  });
});

// ── the DSL ────────────────────────────────────────────────────────

describe('the tilde DSL', () => {
  test('attributes with an EMPTY value do not shift the pairs', () => {
    // `Manufacturer Part``spicePre`R` writes two backticks in a row. Taking
    // the pairs by position is the only reading that survives it; filtering
    // blanks slides every key onto the next key's value and the part becomes
    // whatever the following attribute said.
    const a = parseLibAttrs('package`AXIAL-0.3`Manufacturer Part``spicePre`R`');
    assert.equal(a.package, 'AXIAL-0.3');
    assert.equal(a['Manufacturer Part'], '');
    assert.equal(a.spicePre, 'R', 'the empty value must not have eaten spicePre');
  });

  test('a sheet reads whether dataStr is an object or a JSON STRING', () => {
    // 6.5.x writes an object; 6.2.x writes the same payload as a string.
    const doc = JSON.parse(RC);
    const asObject = easyEdaSheets(doc);
    doc.schematics[0].dataStr = JSON.stringify(doc.schematics[0].dataStr);
    const asString = easyEdaSheets(doc);
    assert.equal(asObject.length, 1);
    assert.deepEqual(asString[0].shape, asObject[0].shape);
  });

  test('a bare sheet and a bare payload are both accepted', () => {
    const doc = JSON.parse(RC);
    const sheet = doc.schematics[0];
    assert.equal(easyEdaSheets(sheet).length, 1, 'a single exported sheet');
    assert.equal(easyEdaSheets(sheet.dataStr).length, 1, 'the bare payload');
    assert.equal(easyEdaSheets({ nothing: true }).length, 0);
  });

  test('designator, value and pins come off the right fields', () => {
    const comps = readComponents(easyEdaSheets(JSON.parse(RC))[0].shape);
    const r2 = comps.find((c) => c.ref === 'R2');
    assert.ok(r2, 'R2 was found by its T~P~ designator text');
    assert.equal(r2.value, '4k7', 'the T~N~ text is the value');
    assert.equal(r2.spicePre, 'R');
    assert.deepEqual(r2.pins.map((p) => [p.num, p.x, p.y]).sort(),
      [['1', 100, -180], ['2', 100, -220]]);
  });
});

// ── the partition, hand-derived ────────────────────────────────────

describe('easyeda-rc-divider: the partition is the one drawn', () => {
  const r = importEasyEda(RC);

  test('the fixture yields parts at all', () => {
    // Vacuity guard. Every assertion below is about a partition, and an empty
    // import has an empty partition that matches nothing and fails nothing.
    assert.ok(r.parts.length >= 6, `only ${r.parts.length} parts imported`);
    assert.ok(r.wires.length >= 6, `only ${r.wires.length} wires imported`);
  });

  test('the parts are the ones drawn, with the kinds and ids drawn', () => {
    assert.deepEqual(r.parts.map((p) => [p.id, p.kind]).sort(), [
      ['C1', 'capacitor'], ['GND', 'gnd'], ['P1', 'header'],
      ['R1', 'resistor'], ['R2', 'resistor'], ['VCC', 'vcc'],
    ]);
  });

  test('"4k7" is 4700, not 4.7', () => {
    // One character, and the structure is identical either way -- which is
    // why the solver oracle at the bottom of this file exists.
    assert.equal(r.parts.find((p) => p.id === 'R2').params.ohms, 4700);
    assert.equal(r.parts.find((p) => p.id === 'R1').params.ohms, 1000);
    assert.ok(Math.abs(r.parts.find((p) => p.id === 'C1').params.farads - 1e-7) < 1e-12);
  });

  test('the electrical partition matches the sheet, node for node', () => {
    // Worked out on paper from the fixture's coordinates:
    //   VCC flag -> R1.1
    //   R1.2 -> R2.1, and off that wire's SPAN to C1.1 and P1.1
    //   R2.2 -> C1.2 -> P1.2 -> GND flag
    assert.deepEqual(partition(r.wires), [
      'C1 a|P1 p1|R1 b|R2 a',
      'C1 b|GND gnd|P1 p2|R2 b',
      'R1 a|VCC vcc',
    ]);
  });

  test('netsFromWires agrees: three nets, no self-loops', () => {
    assert.equal(netsFromWires(r.wires).length, 3);
    assert.deepEqual(r.wires.filter((w) => w.from === w.to && w.fromTerminal === w.toTerminal), []);
  });

  test('the RAW partition -- refs and pin numbers, no kind mapping -- agrees', () => {
    // Independent of the rule table: an unmapped part still contributes its
    // pins here, so this is the geometry answering for itself.
    assert.deepEqual(easyEdaPartition(RC), [
      'C1/1|P1/1|R1/2|R2/1',
      'C1/2|P1/2|R2/2',
    ]);
  });

  test('a rail joined only by its flag still reaches the circuit', () => {
    // No wire says "this is VCC". The flag does, by name. A solver without
    // by-name merging finds a circuit with no supply and every rail floating.
    const vccNet = partition(r.wires).find((n) => n.includes('VCC vcc'));
    assert.ok(vccNet && vccNet.includes('R1 a'), 'VCC flag did not reach R1');
  });

  test('one gnd part and one vcc part, however many flags there are', () => {
    assert.equal(r.parts.filter((p) => p.kind === 'gnd').length, 1);
    assert.equal(r.parts.filter((p) => p.kind === 'vcc').length, 1);
  });

  test('the pinless sheet frame is IGNORED, not counted as unmapped', () => {
    assert.equal(r.ignored.length, 1);
    assert.equal(r.ignored[0].ref, 'FRAME');
    assert.ok(!r.unmapped.some((u) => u.ref === 'FRAME'));
  });

  test('the part no rule maps is REPORTED, never silently dropped', () => {
    assert.deepEqual(r.unmapped.map((u) => u.ref), ['U9']);
    assert.ok(r.warnings.some((w) => /MYSTERY-PART-9000/.test(w)));
    assert.ok(!r.parts.some((p) => p.id === 'U9'));
  });

  test('the geometry rate is reported, and it is total', () => {
    const g = r.warnings.find((w) => w.startsWith('geometry:'));
    assert.ok(g, 'no geometry line -- a silent import cannot be audited');
    assert.match(g, /^geometry: 8\/8 mapped pins/);
  });
});

// ── absolute pin coordinates ───────────────────────────────────────

describe('pin coordinates are ABSOLUTE, and the fixture proves it can fail', () => {
  test('the fixture really does place symbols at 90/180/270', () => {
    // Without this the test below is about three symbols at 0 degrees and
    // proves nothing at all.
    const comps = readComponents(easyEdaSheets(JSON.parse(RC))[0].shape);
    const rots = comps.filter((c) => c.ref && c.pins.length).map((c) => String(c.rot));
    assert.deepEqual(rots.filter((x) => x === '90' || x === '180' || x === '270').sort(),
      ['180', '270', '90'], `placement rotations were ${rots.join(',')}`);
  });

  test('a rotated symbol\'s pins land on the wires with NO transform applied', () => {
    // R2 is at 90 degrees, C1 at 180, P1 at 270. All three appear in the
    // partition on the nets their absolute pin coordinates put them on. Apply
    // placePin() here and every one of them moves off its wire.
    const p = partition(importEasyEda(RC).wires);
    assert.ok(p.some((n) => n.includes('R2 a') && n.includes('C1 a') && n.includes('P1 p1')),
      'the rotated symbols did not reach the mid-node');
  });

  test('moving a rotated symbol\'s pins DOES break the partition', () => {
    // Proof that the assertion above can fail: shift R2's pins by the amount
    // a 90-degree rotation about its own origin would.
    const moved = remap(RC, (shape) => shape.map((s) => (
      /comment~R2~/.test(s) ? s.replace(/~100~-180~/g, '~140~-180~') : s)));
    assert.notDeepEqual(partition(importEasyEda(moved).wires), partition(importEasyEda(RC).wires));
  });
});

// ── buses ──────────────────────────────────────────────────────────

describe('easyeda-bus: a bus names its signals, it does not conduct them', () => {
  const r = importEasyEda(BUS);

  test('the fixture has a bus, entries and labels to check', () => {
    const shape = easyEdaSheets(JSON.parse(BUS))[0].shape;
    assert.equal(shape.filter((s) => s.startsWith('B~')).length, 1);
    assert.equal(shape.filter((s) => s.startsWith('BE~')).length, 4);
    assert.equal(shape.filter((s) => s.startsWith('N~')).length, 4);
    assert.ok(r.parts.length === 2, `${r.parts.length} parts -- the fixture stopped yielding`);
  });

  test('D0 and D1 stay two nets', () => {
    assert.deepEqual(easyEdaPartition(BUS), ['P1/1|P2/1', 'P1/2|P2/2']);
    assert.deepEqual(partition(r.wires), ['P1 p1|P2 p1', 'P1 p2|P2 p2']);
  });

  test('conducting the bus body WOULD short them -- so the check can fail', () => {
    const asWire = remap(BUS, (shape) => shape.map((s) => (s.startsWith('B~') ? `W${s.slice(1)}` : s)));
    assert.deepEqual(easyEdaPartition(asWire), ['P1/1|P1/2|P2/1|P2/2'],
      'renaming B to W must merge D0 and D1, or the B rule is untested');
  });

  test('a bus entry IS wire: dropping them loses both nets', () => {
    // In this fixture the label sits at the BUS end of each entry, so the
    // entry is the only path from a pin to the name that connects it. (On the
    // 8085 board it is not: every bus signal there also carries a label at its
    // wire end, and dropping all 59 entries changes nothing. Measured.)
    const noBE = remap(BUS, (shape) => shape.filter((s) => !s.startsWith('BE~')));
    assert.deepEqual(easyEdaPartition(noBE), []);
  });

  test('the bus is reported, not silently skipped', () => {
    assert.ok(r.warnings.some((w) => /bus polyline\(s\) ignored/.test(w)));
  });
});

// ── multi-sheet and scoping ────────────────────────────────────────

describe('sheets', () => {
  const twoSheet = (() => {
    const doc = JSON.parse(RC);
    doc.schematics.push(JSON.parse(JSON.stringify(doc.schematics[0])));
    doc.schematics[1].title = 'Sheet_2';
    return JSON.stringify(doc);
  })();

  test('every sheet\'s parts are imported, with unique ids', () => {
    const r = importEasyEda(twoSheet);
    assert.equal(r.parts.length, 12, 'six parts per sheet, both sheets read');
    assert.equal(new Set(r.parts.map((p) => p.id)).size, 12, 'ids collided');
  });

  test('net names are NOT merged across sheets', () => {
    // Two sheets that each call a node VCC are not thereby connected. Losing
    // a cross-sheet rail is the smaller error; inventing one joins two boards.
    const r = importEasyEda(twoSheet);
    const p = partition(r.wires);
    assert.equal(p.filter((n) => /\bVCC\w* vcc/.test(n)).length, 2,
      'the two sheets\' VCC rails collapsed into one net');
    assert.ok(r.warnings.some((w) => /NOT merged across sheets/.test(w)));
  });
});

// ── refusals ───────────────────────────────────────────────────────

describe('what it refuses, and how loudly', () => {
  test('a PCB document is refused with the reason, not half-imported', () => {
    const pcb = JSON.stringify({ editorVersion: '6.5.50', docType: 3, dataStr: { shape: [] } });
    const r = importEasyEda(pcb);
    assert.deepEqual(r.parts, []);
    assert.match(r.warnings[0], /PCB\/footprint document/);
  });

  test('a bare PCB payload is refused too -- its type is inside `head`', () => {
    // A PCB exported on its own has no top-level docType. Its LIB shapes hold
    // PADs rather than pins, so without this it imports as "no components
    // found" -- true, and no help at all in working out why.
    const pcb = JSON.stringify({ head: { docType: '3', x: '0', y: '0' },
      shape: ['LIB~100~100~package`RELAY-PKG`spicePre`K~0~~g1~1~pkg~0~~yes~~'] });
    const r = importEasyEda(pcb);
    assert.deepEqual(r.parts, []);
    assert.match(r.warnings[0], /PCB\/footprint document/);
  });

  test('unparseable JSON says so', () => {
    const r = importEasyEda('{ this is not json');
    assert.deepEqual(r.parts, []);
    assert.match(r.warnings[0], /did not parse/);
  });

  test('valid JSON with no sheet says so', () => {
    const r = importEasyEda('{"editorVersion":"6.5.50","docType":5}');
    assert.deepEqual(r.parts, []);
    assert.match(r.warnings[0], /No EasyEDA sheet found/);
  });
});

// ── the kind vocabulary ────────────────────────────────────────────

describe('kinds: spicePre first, part number ahead of it', () => {
  const map = (o) => mapEasyEdaPart({ descriptor: '', value: '', spicePre: '',
    pinCount: 2, package: '', ...o });

  test('spicePre decides the passives', () => {
    assert.equal(map({ spicePre: 'R', value: '10k' }).kind, 'resistor');
    assert.equal(map({ spicePre: 'R', value: '10k' }).params.ohms, 10000);
    assert.equal(map({ spicePre: 'C', value: '100nF' }).kind, 'capacitor');
    assert.equal(map({ spicePre: 'L', value: '10uH' }).kind, 'inductor');
    assert.equal(map({ spicePre: 'D', value: '1N4148' }).kind, 'diode');
    assert.equal(map({ spicePre: 'D', value: 'LED-RED' }).kind, 'led');
    assert.equal(map({ spicePre: 'Q', value: '2N3904' }).kind, 'npn');
    assert.equal(map({ spicePre: 'Q', value: '2N3906' }).kind, 'pnp');
  });

  test('a part number beats the prefix', () => {
    // spicePre U says only "an IC". LM7805 says which one, and the engine has
    // a model for it -- falling through to a generic would lose that.
    assert.equal(map({ spicePre: 'U', descriptor: 'LM7805AL-TA3-T' }).kind, 'lm7805');
    assert.equal(map({ spicePre: 'U', descriptor: 'SN74LS138N', pinCount: 16 }).kind, '74hc138');
  });

  test('spicePre X is split by the VALUE, because it means both things', () => {
    // SPICE's subcircuit prefix. The 8085 board uses it for a 3.579545 MHz
    // crystal AND for a 40-pin CPU.
    assert.equal(map({ spicePre: 'X', value: '3.579545MHz' }).kind, 'crystal');
    assert.equal(map({ spicePre: 'X', value: '16MHz' }).kind, 'crystal');
    assert.equal(map({ spicePre: 'X', value: '8085_ASP', pinCount: 40 }), null,
      'a 40-pin CPU must not become a crystal');
  });

  test('a connector\'s width comes from its PIN COUNT', () => {
    assert.deepEqual(map({ spicePre: 'P', pinCount: 2 }).params, { pins: 2 });
    assert.deepEqual(map({ spicePre: 'P', pinCount: 20 }).params, { pins: 20 });
    // ...and the pin MAP stops where the engine's header model does.
    assert.equal(Object.keys(map({ spicePre: 'P', pinCount: 20 }).pins).length, 8 * 2,
      'both the "1" and "P1" spellings of the first eight pins, and no more');
    assert.equal(map({ spicePre: 'P', pinCount: 20 }).pins['9'], undefined,
      'p9 would be a wire the board accepts and ignores');
  });

  test('a header numbered P1/P2/P3 wires as well as one numbered 1/2/3', () => {
    // The 8085 board's barrel jack does exactly this.
    assert.equal(map({ spicePre: 'J', pinCount: 3 }).pins.P2, 'p2');
    assert.equal(map({ spicePre: 'J', pinCount: 3 }).pins['2'], 'p2');
  });

  test('74-series numbers are only emitted when the engine HAS them', () => {
    // eagle.js emits 74hc${n} for any n. Here a number with no engine model
    // stays unmapped. The '373 sat on the refusal side of this rule until
    // the engine grew a real transparent latch (bw-board ea81407) — mapping
    // it to the '374 D flip-flop was never an option, and now no longer a
    // temptation: both families map to their own kinds.
    assert.equal(logicKind('138'), '74hc138');
    assert.equal(logicKind('595'), '74hc595');
    assert.equal(logicKind('161'), '74ls161');
    assert.equal(logicKind('373'), '74hc373', 'the engine has a real latch now');
    assert.equal(logicKind('9999'), null);
    const ls373 = map({ spicePre: 'U', descriptor: '74LS373_ASP', pinCount: 20 });
    assert.ok(ls373, 'the reference board keeps its 74LS373');
    assert.equal(ls373.kind, '74ls373');
  });

  test('the 74HC138 pin map speaks the ENGINE\'s spelling, not the datasheet\'s', () => {
    // EasyEDA writes Y0 and G2A; the engine marks active-low pins with a
    // trailing b. `byName` here would hand the board eight terminals it does
    // not have -- wires that draw and do not conduct.
    //
    // engine-contract.test.js CANNOT catch this: its terminal-name check reads
    // r.pins, and a `byName` rule has none to read -- that limitation is
    // stated in its own comments. So the check lives here, and it checks the
    // WHOLE map against the engine rather than four spellings, or the next
    // typo in it goes the same way.
    const p = map({ spicePre: 'U', descriptor: 'SN74LS138N', pinCount: 16 }).pins;
    assert.equal(p.Y0, 'y0b');
    assert.equal(p.G2A, 'g2ab');
    assert.equal(p.A, 'a');
    assert.equal(p.VCC, 'vcc');
    const have = new Set(terminalsForKind('74hc138', {}));
    assert.ok(have.size > 4, 'the engine did not answer for 74hc138 -- check is vacuous');
    assert.deepEqual([...new Set(Object.values(p))].filter((n) => !have.has(n)), [],
      'the rule names terminals the engine\'s 74hc138 does not have');
  });

  test('nothing at all maps to nothing at all', () => {
    assert.equal(map({ spicePre: '', descriptor: 'WHAT-IS-THIS' }), null);
    assert.equal(map({ spicePre: 'Z', descriptor: 'WHAT-IS-THIS' }), null);
  });

  test('the rule table is not empty', () => {
    assert.ok(EASYEDA_RULES.length >= 20, `only ${EASYEDA_RULES.length} rules`);
  });
});

// ── the reference board, when it is on this machine ────────────────

const BOARD = join(process.env.HOME || '', 'code', 'kicad-refs',
  '8085-microprocessor-devkit', 'schematic', 'SCH_microprocessor-8085_2025-05-18.json');
const haveBoard = existsSync(BOARD);

describe('the 8085 devkit board (read in place, never copied here)',
  { skip: haveBoard ? false : 'needs ~/code/kicad-refs/8085-microprocessor-devkit' }, () => {
    const text = haveBoard ? readFileSync(BOARD, 'utf8') : '';

    test('it is detected and it imports', () => {
      assert.equal(detectFormat(text, BOARD), 'easyeda');
      const r = importEasyEda(text);
      assert.equal(r.parts.length, 28, 'twenty-six components plus a vcc and a gnd rail');
      assert.equal(r.unmapped.length, 4);
      assert.equal(r.ignored.length, 1, 'the sheet frame');
    });

    test('coverage: 26 of its 30 electrical components map', () => {
      // 26 since the engine grew a real 74LS373 (it was the named loss
      // in logicKind's own doc until then).
      const r = importEasyEda(text);
      const mapped = r.parts.filter((p) => p.kind !== 'vcc' && p.kind !== 'gnd').length;
      assert.equal(mapped, 26);
      assert.equal(mapped + r.unmapped.length, 30, 'thirty-one LIB shapes less the sheet frame');
    });

    test('the raw partition is 43 nets, the biggest of them 25 nodes', () => {
      // Ground: every decoupling cap, both regulator returns, the reset
      // switch and four IC grounds. A number to notice changing.
      const p = easyEdaPartition(text);
      assert.equal(p.length, 43);
      assert.equal(Math.max(...p.map((n) => n.split('|').length)), 25);
    });

    test('conducting its buses would collapse 43 nets into 25', () => {
      // The measurement the B rule exists for, on a real board rather than a
      // fixture: a single 63-node net swallowing the whole address bus.
      const doc = JSON.parse(text);
      doc.schematics[0].dataStr.shape = doc.schematics[0].dataStr.shape
        .map((s) => (s.startsWith('B~') ? `W${s.slice(1)}` : s));
      const p = easyEdaPartition(JSON.stringify(doc));
      assert.equal(p.length, 25);
      assert.equal(Math.max(...p.map((n) => n.split('|').length)), 63);
    });

    test('pins are absolute across 21 rotated placements', () => {
      // The claim this importer rests on, measured on the file it was decoded
      // from: no transform is applied and the pins still land.
      const comps = readComponents(easyEdaSheets(JSON.parse(text))[0].shape);
      const rotated = comps.filter((c) => ['90', '180', '270'].includes(String(c.rot)));
      assert.equal(rotated.length, 21, 'the board stopped having rotated symbols');
      const g = importEasyEda(text).warnings.find((w) => w.startsWith('geometry:'));
      assert.match(g, /^geometry: 87\/93 mapped pins/);
    });
  });

// ── the engine as oracle ───────────────────────────────────────────

describe('the imported bench solves, and a misparse changes the answer',
  { skip: existsSync(join(BWB, 'src', 'index.js')) ? false : 'needs a bw-board checkout beside this repo' },
  () => {
    let solve;
    before(async () => {
      const { registerSidecar } = await import(join(CUI, 'src/model/parts-registry.js'));
      for (const f of readdirSync(join(CUI, 'src/parts-data'))) {
        if (!f.endsWith('.json')) continue;
        try {
          const sc = JSON.parse(readFileSync(join(CUI, 'src/parts-data', f), 'utf8'));
          if (sc.kind) registerSidecar(sc);
        } catch { /* bw-parts' problem */ }
      }
      const { Circuit } = await import(join(CUI, 'src/model/circuit.js'));
      solve = (parts, wires) => {
        const c = Circuit.fromJSON({ parts, wires, vcc: 5 });
        c.powered = true;
        if (c.board && c.board.advanceTo) c.board.advanceTo(1000000n);
        const v = {};
        if (c.board && c.board.nodeVoltages && c.board.nodeVoltages.forEach) {
          c.board.nodeVoltages.forEach((val, k) => { v[k] = Math.round(val * 1000) / 1000; });
        }
        return { parts: c.board.parts.length, v };
      };
    });

    test('every imported part seats on the board', () => {
      const r = importEasyEda(RC);
      const s = solve(r.parts, r.wires);
      assert.equal(s.parts, r.parts.length,
        'a part the engine refuses leaves a smaller board and every voltage below is about a different circuit');
      assert.ok(Object.keys(s.v).length > 0, 'nothing solved');
    });

    test('the oracle NOTICES a value misparse that the partition cannot see', () => {
      // "4k7" read as 4.7 leaves the parts identical, the partition identical
      // and every structural assertion green. Only solving it says so.
      const r = importEasyEda(RC);
      const bad = r.parts.map((p) => (p.id === 'R2' ? { ...p, params: { ...p.params, ohms: 4.7 } } : p));
      assert.notDeepEqual(solve(bad, r.wires).v, solve(r.parts, r.wires).v);
    });

    test('the 8085 board loads too', { skip: haveBoard ? false : 'no corpus' }, () => {
      const r = importEasyEda(readFileSync(BOARD, 'utf8'));
      assert.equal(solve(r.parts, r.wires).parts, 28);
    });
  });

describe('switch pin count decides button vs changeover', () => {
    /**
     * `easyeda-switch-pincount.json` holds one FOUR-pin tactile key and one
     * THREE-pin slide switch, and nothing else.
     *
     * The rule used to read `n >= 3 ? slide_switch : button`, while its own
     * comment said "a 3-pin one is a changeover". Four pins is the commonest
     * tactile key there is — a through-hole button bonds its pins in two pairs,
     * so it draws as four — and every one of them imported as a slide switch.
     * Measured on a real EasyEDA calculator sheet: seventeen keys, seventeen
     * slide switches, zero buttons.
     *
     * The giveaway that it was a typo rather than a decision is the pin map on
     * the button branch, `{1:'a', 2:'b', 3:'a', 4:'b'}`, which describes the
     * four-pin part exactly and was unreachable.
     */
    test('a four-pin tactile key is a button, a three-pin switch is a changeover', () => {
        const raw = readFileSync(join(FIX, 'easyeda-switch-pincount.json'), 'utf8');
        const res = importEasyEda(raw);
        assert.equal(res.unmapped.length, 0, 'both switches should map');
        const kinds = {};
        for (const p of res.parts) kinds[p.kind] = (kinds[p.kind] || 0) + 1;
        assert.deepEqual(kinds, { button: 1, slide_switch: 1 },
            'four pins must be a button and three a slide switch');
    });

    test('the rule keys on pin count, and four pins collapse onto two terminals', () => {
        const sw = (pinCount, value) => mapEasyEdaPart(
            {descriptor: 'SW1', value, spicePre: 'S', pinCount, package: 'X'});

        assert.equal(sw(2, 'TACT_2P').kind, 'button', 'two pins is a momentary button');
        assert.equal(sw(4, 'TACT_4P').kind, 'button', 'FOUR pins is also a momentary button');
        assert.equal(sw(3, 'SS-12D10L9').kind, 'slide_switch', 'three pins is a changeover');

        // A four-pin key is electrically TWO nodes: its pins are bonded in pairs
        // inside the package. Treating them as four would split the net the key
        // is there to close.
        const pins = sw(4, 'TACT_4P').pins;
        assert.deepEqual(pins, {1: 'a', 2: 'b', 3: 'a', 4: 'b'},
            'pins 1/3 and 2/4 must land on the same two terminals');
        assert.deepEqual([...new Set(Object.values(pins))].sort(), ['a', 'b']);
    });
});

describe('Pico and the 4-pin OLED module map to parts we already have', () => {
    /**
     * Both parts existed all along — `pi_pico` (44 terminals) and `ssd1306`
     * (4) have sidecars AND engine devices. What was missing was the two
     * RECOGNITION rules, so a real EasyEDA calculator sheet imported them as
     * "unmapped" and their pins never reached a net: 36 of 71 mapped pins
     * landed on a net, over 2 nets, from a sheet with 43 wires.
     */
    test('the Pico maps BY NAME, because its symbols renumber', () => {
        const r = mapEasyEdaPart({descriptor: 'PICO 2 3D MODEL', value: 'PICO 2 3D MODEL',
            spicePre: 'U', pinCount: 40, package: 'X'});
        assert.equal(r.kind, 'pi_pico');

        // The reason a numeric map would be WRONG, and `terminalFor` tries
        // pins[number] BEFORE pins[name]: the symbol on a real sheet numbers
        // 1..20 and 23..42, skipping 21 and 22. ITS pin 23 is GPIO 16, where
        // the PHYSICAL pin 23 is a ground.
        assert.equal(r.pins['GPIO 16'], 'gp16', 'names must decide, not positions');
        assert.equal(r.pins[23], undefined, 'no numeric key may exist to win over the name');

        assert.equal(r.pins['GPIO 0'], 'gp0');
        assert.equal(r.pins['GP0'], 'gp0', 'the short spelling too');
        assert.equal(r.pins['3v3 (OUT)'], '3v3', 'the parenthesised 3V3 output');
        assert.equal(r.pins.VSYS, 'vsys');
        assert.equal(r.pins.RUN, 'run');
        // Every ground is one node on this board — board-kinds.js gives gnd_1..7,
        // agnd and swd_gnd the same `gnd` role — so one terminal is enough and
        // spreading them would be a positional guess again.
        assert.equal(r.pins.GND, 'gnd_1');
    });

    test('the 0.96" OLED module carries a derived pin order, not a guessed one', () => {
        const r = mapEasyEdaPart({descriptor: '0.96OLED_4P', value: '0.96OLED_4P',
            spicePre: 'O', pinCount: 4, package: 'X'});
        assert.equal(r.kind, 'ssd1306');
        // DERIVED from a real sheet: pin 1 wires to the Pico's GPIO 0, pin 2 to
        // GPIO 1, pin 3 to GND, pin 4 to 3v3 (OUT). That is SDA/SCL/GND/VCC —
        // NOT the GND/VCC/SCL/SDA order most 4-pin modules use, so taking the
        // usual convention would have swapped power and ground.
        assert.deepEqual(r.pins, {1: 'sda', 2: 'scl', 3: 'gnd', 4: 'vcc'});
        assert.match(r._note, /derived from wiring/,
            'the note must say the order was derived, since the symbol names no pins');
    });

    test('a part actually called SSD1306 still maps by name, unchanged', () => {
        const r = mapEasyEdaPart({descriptor: 'SSD1306', value: 'SSD1306',
            spicePre: 'U', pinCount: 4, package: 'X'});
        assert.equal(r.kind, 'ssd1306');
        assert.equal(r.byName, true, 'a named symbol must keep using its names');
    });
});

/**
 * KiCad schematic import, with the NET PARTITION as the thing under test.
 *
 * EAGLE writes its netlist down; KiCad does not. A .kicad_sch and a legacy
 * .sch carry line segments and symbol placements, and the reader has to work
 * out which pin touches which wire. The failure mode that follows is specific
 * and nasty: every part is present, every symbol draws, the file "imports",
 * and connections are silently missing. Nothing about the parts list shows it.
 *
 * So the assertions here are about WHICH NODES SHARE A NET, computed by hand
 * from fixtures whose coordinates were chosen so the answer is checkable with
 * a pencil. `test/fixtures/kicad-divider.kicad_sch` and its legacy twin were
 * written for this file, not harvested: a third-party schematic can be
 * measured but not published, and an expected answer nobody derived is not an
 * expected answer.
 *
 * The importers were separately checked against KiCad ITSELF -- every project
 * on the author's disk that ships both a schematic and a KiCad-exported .net
 * agrees node for node, 7 .kicad_sch and 2 legacy .sch -- but that corpus is
 * third-party and local-only, so it cannot live in this repo. These fixtures
 * are the part that travels.
 */

import './_setup.js';
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { detectFormat } from '../src/importers/detect.js';
import { importKicadSch, kicadSchPartition, resolveKicadSch } from '../src/importers/kicad-sch.js';
import { importKicadLegacy, parseLegacyLib } from '../src/importers/kicad-legacy.js';
import { NetSolver, placePin, mapKicadSymbol } from '../src/importers/kicad-common.js';
import { importEagle } from '../src/importers/eagle.js';
import { toEagleSch } from '../src/model/exporters/eagle.js';
import { shapeFor } from '../src/model/schematic-symbols.js';

const HERE = import.meta.dirname;
const CUI = join(HERE, '..');
const BWB = process.env.BW_BOARD || join(CUI, '..', 'bw-board');
const engineAvailable = existsSync(join(BWB, 'src', 'index.js'));

const SCH = readFileSync(join(HERE, 'fixtures', 'kicad-divider.kicad_sch'), 'utf8');
const LEGACY = readFileSync(join(HERE, 'fixtures', 'kicad-legacy-divider.sch'), 'utf8');
const LEGACY_LIB = readFileSync(join(HERE, 'fixtures', 'kicad-legacy-divider.lib'), 'utf8');

/** Connected components over wire endpoints -- the electrical partition. */
function partition(wires) {
  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); }
    return x;
  };
  for (const w of wires) {
    const a = find(`${w.from} ${w.fromTerminal}`); const b = find(`${w.to} ${w.toTerminal}`);
    if (a !== b) parent.set(a, b);
  }
  const groups = new Map();
  for (const k of parent.keys()) {
    const r = find(k); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(k);
  }
  return [...groups.values()].map((v) => v.sort().join('|')).sort();
}

// ---------------------------------------------------------------------
describe('detectFormat tells three .sch dialects apart', () => {
  test('a KiCad 6+ schematic is recognised by its root element', () => {
    assert.equal(detectFormat(SCH, 'anything.txt'), 'kicad-sch');
  });

  test('a KiCad 4/5 schematic is recognised by its magic line', () => {
    assert.equal(detectFormat(LEGACY, 'anything.txt'), 'kicad-legacy');
  });

  test('EAGLE and KiCad legacy both claim .sch, and CONTENT decides', () => {
    // This is the whole reason detect.js exists. Given only the extension,
    // one of these two must be guessed wrong.
    assert.equal(detectFormat(LEGACY, 'board.sch'), 'kicad-legacy');
    assert.equal(detectFormat('<?xml version="1.0"?><eagle version="6.4"/>', 'board.sch'), 'eagle');
  });

  test('a KiCad NETLIST is not mistaken for a schematic', () => {
    // Both are s-expressions; only the root tag separates them, and the
    // schematic rule runs first.
    assert.equal(detectFormat('(export (version "E"))', 'x.net'), 'kicad-netlist');
  });
});

// ---------------------------------------------------------------------
describe('placePin: library coordinates to sheet coordinates', () => {
  const at = (x, y, rot, mirror = null) => ({ x, y, rot, mirror });

  test('unrotated placement flips Y, because the library draws Y up', () => {
    // A resistor pin at library (0, 3.81) is the TOP pin, and top on a sheet
    // is a SMALLER y. Miss this and every symbol is upside down, which for a
    // two-pin passive silently swaps its terminals.
    assert.deepEqual(placePin(0, 3.81, at(100, 50, 0)), [100, 46.19]);
    assert.deepEqual(placePin(0, -3.81, at(100, 50, 0)), [100, 53.81]);
  });

  test('90 degrees is counter-clockwise on screen', () => {
    const [x, y] = placePin(0, 3.81, at(110, 60, 90));
    assert.equal(Math.round(x * 100) / 100, 106.19);
    assert.equal(Math.round(y * 100) / 100, 60);
  });

  test('180 and 270 land where 90 twice and 90 thrice do', () => {
    const r180 = placePin(0, 3.81, at(0, 0, 180)).map((v) => Math.round(v * 100) / 100);
    const r270 = placePin(0, 3.81, at(0, 0, 270)).map((v) => Math.round(v * 100) / 100);

    // `+ 0` normalises the negative zero a rotation matrix produces.
    assert.deepEqual(r180.map((v) => v + 0), [0, 3.81]);
    assert.deepEqual(r270.map((v) => v + 0), [3.81, 0]);
  });

  test('(mirror y) flips X and (mirror x) flips Y, not the other way round', () => {
    assert.deepEqual(placePin(3.81, 0, at(0, 0, 0, 'y')).map(Math.round), [-4, 0]);
    assert.deepEqual(placePin(0, 3.81, at(0, 0, 0, 'x')).map(Math.round), [0, 4]);
  });
});

// ---------------------------------------------------------------------
describe('NetSolver implements KiCad connectivity, not "lines that touch"', () => {
  test('wires sharing an endpoint are one net', () => {
    const s = new NetSolver();
    s.addSegment(0, 0, 10, 0);
    s.addSegment(10, 0, 10, 10);
    s.solve();
    assert.equal(s.netAt(0, 0), s.netAt(10, 10));
  });

  test('an endpoint landing mid-span of another wire is a T and connects', () => {
    const s = new NetSolver();
    s.addSegment(0, 0, 20, 0);
    s.addSegment(10, 0, 10, 10);        // ends ON the first wire, halfway along
    s.solve();
    assert.equal(s.netAt(0, 0), s.netAt(10, 10));
  });

  test('two wires merely CROSSING are two nets', () => {
    // The one rule a naive "do the lines intersect" solver gets wrong, and it
    // fabricates connections rather than losing them -- the worse direction.
    const s = new NetSolver();
    s.addSegment(0, 5, 20, 5);
    s.addSegment(10, 0, 10, 10);
    s.solve();
    assert.notEqual(s.netAt(0, 5), s.netAt(10, 0));
  });

  test('...unless a junction dot says they cross AND connect', () => {
    const s = new NetSolver();
    s.addSegment(0, 5, 20, 5);
    s.addSegment(10, 0, 10, 10);
    s.addPoint(10, 5);                  // the junction
    s.solve();
    assert.equal(s.netAt(0, 5), s.netAt(10, 0));
  });

  test('a shared NAME joins wires that never touch', () => {
    const s = new NetSolver();
    s.addSegment(0, 0, 10, 0);
    s.addSegment(100, 100, 110, 100);
    s.addName(0, 0, 'SDA');
    s.addName(110, 100, 'SDA');
    s.solve();
    assert.equal(s.netAt(10, 0), s.netAt(100, 100));
  });

  test('different names stay apart', () => {
    const s = new NetSolver();
    s.addSegment(0, 0, 10, 0);
    s.addSegment(100, 100, 110, 100);
    s.addName(0, 0, 'SDA');
    s.addName(110, 100, 'SCL');
    s.solve();
    assert.notEqual(s.netAt(10, 0), s.netAt(100, 100));
  });
});

// ---------------------------------------------------------------------
describe('KiCad 6+ schematic: the partition is the hand-computed one', () => {
  // Derived with a pencil from the fixture's coordinates:
  //   R1 (100,50) and R2 (100,70) are vertical, joined by the wire
  //   (100,53.81)-(100,66.19). A label "MID" sits MID-SPAN on that wire at
  //   (100,60) -- a T, not an endpoint.
  //   R3 is rotated 90 at (110,60): pins land at 106.19 and 113.81 on y=60.
  //   R4 is rotated 90 AND mirrored at (120,60): pin 1 lands at 123.81 and
  //   pin 2 at 116.19 -- the mirror swaps which pin is where, so a wrong
  //   mirror axis changes this answer.
  //   D1's cathode reaches MID through the second "MID" label at (130,60) --
  //   two wires that never touch, joined only by a shared label.
  //   The two +5V symbols carry the rail by NAME and by nothing else: one
  //   sits on R1's top pin, the other on the R3/R4 wire, and the only thing
  //   that joins those two is the rail's name.
  const EXPECTED = [
    'D1/1|R1/2|R2/1|R3/1|R4/1',
    'R1/1|R3/2|R4/2',
  ];

  test('every node lands in the right net', () => {
    assert.deepEqual(kicadSchPartition(SCH), EXPECTED);
  });

  test('the fixture is not vacuous: it has rotated, mirrored and named parts', () => {
    // If the fixture degenerated to a pile of unconnected symbols the
    // assertion above would still pass, on an empty partition.
    const r = resolveKicadSch(SCH);
    assert.equal(r.ok, true);
    assert.equal(r.placements.length, 8);
    assert.equal(r.labels, 2);
    assert.ok(EXPECTED.join('').length > 30);
  });

  test('parts and values survive', () => {
    const r = importKicadSch(SCH);
    assert.deepEqual(r.parts.map((p) => `${p.id}:${p.kind}`).sort(), [
      'D1:led', 'PWR01:vcc', 'PWR02:vcc', 'PWR03:gnd',
      'R1:resistor', 'R2:resistor', 'R3:resistor', 'R4:resistor',
    ]);
    assert.equal(r.parts.find((p) => p.id === 'R2').params.ohms, 4700, '"4k7" is 4700, not 4.7');
    assert.equal(r.unmapped.length, 0);
  });

  test('a rail whose power pin has no name still connects', () => {
    // The stock KiCad libraries name the power-input pin ("GND", "+3V3"), but
    // circuit-synth writes (name "~") and leaves the rail name in the Value
    // field instead. Reading ONLY the pin name turned one 100-node ground net
    // into a hundred two-node nets in a real corpus file, every one of which
    // still drew perfectly. The fallback chain is pin name, then Value, then
    // the symbol's own name -- the last two agree in practice, so what this
    // pins down is that the chain exists at all.
    const stripped = SCH.replace(/\(name "\+5V"\)/g, '(name "~")');
    assert.notEqual(stripped, SCH, 'the mutation must actually change the fixture');
    assert.deepEqual(kicadSchPartition(stripped), EXPECTED);
  });

  test('a symbol UNIT does not borrow the other units\' pins', () => {
    // A dual opamp draws both halves at the SAME local coordinates, so a
    // reader that ignores (unit N) puts unit 2's output on exactly the wire
    // unit 1's output sits on. That does not lose a connection, it INVENTS
    // one, and the sheet looks right either way.
    //
    // Inline rather than in the shared fixture: this needs a symbol whose
    // units overlap, and adding one to kicad-divider would change the
    // round-trip and solver fixtures for an unrelated reason.
    const dual = `(kicad_sch (version 20231120)
      (lib_symbols
        (symbol "Device:R"
          (symbol "R_1_1"
            (pin passive line (at 0 3.81 270) (name "~") (number "1"))
            (pin passive line (at 0 -3.81 90) (name "~") (number "2"))))
        (symbol "Amplifier_Operational:TL072"
          (symbol "TL072_1_1"
            (pin output line (at 5.08 0 180) (name "~") (number "1"))
            (pin input line (at -5.08 2.54 0) (name "-") (number "2")))
          (symbol "TL072_2_1"
            (pin output line (at 5.08 0 180) (name "~") (number "7"))
            (pin input line (at -5.08 2.54 0) (name "-") (number "6")))
          (symbol "TL072_3_1"
            (pin power_in line (at 0 7.62 270) (name "V+") (number "8")))))
      (symbol (lib_id "Amplifier_Operational:TL072") (at 160 60 0) (unit 1)
        (property "Reference" "U1" (at 160 55 0)) (property "Value" "TL072" (at 160 65 0)))
      (symbol (lib_id "Device:R") (at 170 60 90) (unit 1)
        (property "Reference" "RX" (at 170 55 0)) (property "Value" "1k" (at 170 65 0)))
      (wire (pts (xy 165.08 60) (xy 170 60))))`;
    // U1 is placed as unit 1, so only pin 1 is its output. Unit 2's output
    // (pin 7) is drawn at the same local (5.08, 0) and would land on the very
    // same wire; the power unit's pin 8 is not this placement's either.
    assert.deepEqual(kicadSchPartition(dual), ['RX/1|U1/1']);
  });

  test('every placement gets each pin number once', () => {
    const r = resolveKicadSch(SCH);
    for (const pl of r.placements) {
      const nums = pl.pins.map((p) => p.num);
      assert.equal(new Set(nums).size, nums.length,
        `${pl.ref} got the same pin twice -- unit filtering is off`);
    }
  });

  test('an empty sheet is reported, not silently accepted', () => {
    const r = importKicadSch('(kicad_sch (version 20231120))');
    assert.equal(r.parts.length, 0);
    assert.match(r.warnings.join(' '), /No mappable components/);
  });

  test('a file that is not a KiCad schematic is refused', () => {
    const r = importKicadSch('(export (version "E"))');
    assert.equal(r.parts.length, 0);
    assert.match(r.warnings[0], /not \(kicad_sch/);
  });
});

// ---------------------------------------------------------------------
describe('KiCad 4/5 legacy schematic', () => {
  // By hand from the fixture: R1/R2 joined by the wire (2000,1650)-(2000,1850)
  // with a "MID" label mid-span; R3 is laid horizontally by the orientation
  // matrix `0 1 1 0` so its pin 2 lands exactly on the second "MID" label;
  // R5 carries the ASYMMETRIC matrix `0 -1 1 0`, which puts pin 1 on the left
  // and pin 2 on the right, and only pin 1 has a label under it; SW1's common
  // (pin 2) reaches MID through the third label. Both +5V symbols carry the
  // rail by name.
  const EXPECTED = ['R1/1|R3/1', 'R1/2|R2/1|R3/2|R5/1|SW1/2'];
  const imported = () => importKicadLegacy(LEGACY, { lib: LEGACY_LIB });

  test('every node lands in the right net', () => {
    assert.deepEqual(imported().nodePartition, EXPECTED);
  });

  test('the orientation matrix is applied as a*px + b*py, not transposed', () => {
    // R3's matrix `0 1 1 0` is SYMMETRIC, so it survives a transpose unharmed
    // and proves nothing on its own -- which is why R5 is in the fixture with
    // `0 -1 1 0`. Transposing that one swaps which end of the resistor lands
    // on the "MID" label at (4850,1150), and nothing about the drawing shows
    // it: the symbol still looks horizontal and still touches a label.
    const all = imported().nodePartition.join('|');
    assert.ok(all.includes('R5/1'), 'R5 pin 1 must be the end that sits on the label');
    assert.ok(!all.includes('R5/2'), 'R5 pin 2 sits on nothing and must stay unconnected');
  });

  test('unit 2 of a multi-unit symbol stays out of a unit-1 placement', () => {
    // SW_DPDT draws both poles at the SAME coordinates. Read the .lib X
    // record's field 10 (body style) as the unit and pins 4-6 land on exactly
    // the wires pins 1-3 sit on, shorting the two poles with nothing visible
    // to show for it.
    const all = imported().nodePartition.join('|');
    assert.ok(all.includes('SW1/2'), 'the fixture must actually wire a switch pin');
    for (const p of ['SW1/4', 'SW1/5', 'SW1/6']) {
      assert.ok(!all.includes(p), `${p} belongs to unit 2 and this placement is unit 1`);
    }
  });

  test('parts, kinds and values survive', () => {
    const r = imported();
    assert.deepEqual(r.parts.map((p) => `${p.id}:${p.kind}`).sort(), [
      'PWR01:vcc', 'PWR02:vcc', 'PWR03:gnd',
      'R1:resistor', 'R2:resistor', 'R3:resistor', 'R5:resistor', 'SW1:slide_switch',
    ]);
    assert.equal(r.parts.find((p) => p.id === 'R2').params.ohms, 4700);
  });

  test('WITHOUT the library it says so instead of returning a wireless circuit', () => {
    // The pin geometry is in the project's .lib and nowhere else. An importer
    // that quietly returns parts-and-no-wires here is the exact failure this
    // whole file exists to catch.
    const r = importKicadLegacy(LEGACY);
    assert.ok(r.parts.length > 0, 'the parts are still readable');
    assert.equal(r.wires.length, 0);
    assert.equal(r.needsLibrary, true);
    assert.match(r.warnings.join(' '), /NO SYMBOL LIBRARY SUPPLIED/);
  });

  test('the .lib parser reads the X record, units included', () => {
    const lib = parseLegacyLib(LEGACY_LIB);
    const sw = lib.get('Switch_SW_DPDT');
    assert.equal(sw.length, 6);
    assert.deepEqual(sw.filter((p) => p.unit === 1).map((p) => p.num), ['1', '2', '3']);
    assert.deepEqual(sw.filter((p) => p.unit === 2).map((p) => p.num), ['4', '5', '6']);
    assert.deepEqual(lib.get('Device_R').map((p) => [p.num, p.x, p.y]), [['1', 0, 150], ['2', 0, -150]]);
  });

  test('a file that is not a legacy schematic is refused', () => {
    const r = importKicadLegacy('<eagle/>');
    assert.equal(r.parts.length, 0);
    assert.match(r.warnings[0], /Not a KiCad legacy schematic/);
  });
});

// ---------------------------------------------------------------------
describe('the symbol vocabulary maps by name, and knows what it does not know', () => {
  test('the library half of a lib_id is ignored, the symbol half decides', () => {
    // The same resistor is Device:R, pic_programmer:R and New_Library:R
    // across one corpus, because every project copies the symbol locally.
    for (const id of ['Device:R', 'pic_programmer:R', 'New_Library:R', 'R']) {
      assert.equal(mapKicadSymbol(id, '10k').kind, 'resistor', id);
    }
  });

  test('anchored patterns: RP2040 is not a resistor and DB9 is not a diode', () => {
    // Both were live bugs from reusing eagle.js's RULES, whose patterns are
    // tuned to EAGLE deviceset names.
    assert.equal(mapKicadSymbol('MCU_RaspberryPi:RP2040', ''), null);
    assert.notEqual(mapKicadSymbol('video_schlib:DB9', '')?.kind, 'diode');
    assert.equal(mapKicadSymbol('Regulator_Linear:LM7805_TO220', '').kind, 'lm7805');
  });

  test('an unknown logic family is reported, not turned into an invented chip', () => {
    // 74CBTLV3257 once became "74hc325": a kind no engine models and no
    // datasheet describes, which draws a plausible box and simulates nothing.
    assert.equal(mapKicadSymbol('TinyTapeout:74CBTLV3257', ''), null);
    assert.equal(mapKicadSymbol('Logic:74HC595', '').kind, '74hc595');
  });

  test('an unflagged power symbol still becomes a rail', () => {
    assert.equal(mapKicadSymbol('power:+3V3', '').kind, 'vcc');
    assert.equal(mapKicadSymbol('power:GNDREF', '').kind, 'gnd');
    // ...and one with no rule at all falls back on the (power) flag.
    assert.equal(mapKicadSymbol('local:VDD_FPGA_CORE', '', true).kind, 'vcc');
    assert.equal(mapKicadSymbol('local:CHASSIS_GND', '', true).kind, 'gnd');
    assert.equal(mapKicadSymbol('local:VDD_FPGA_CORE', '', false), null);
  });
});

// ---------------------------------------------------------------------
describe('the kinds these importers newly produce can be drawn', () => {
  // Re-ranking the fallback-to-a-box list over the KiCad corpus moved almost
  // nothing: the kinds still falling back are ICs, modules and connectors,
  // which schematic-symbols.js draws as pin-labelled boxes ON PURPOSE. One
  // was not -- a fuse is a two-terminal discrete with a symbol every reader
  // knows, and it appears only in the KiCad corpus, which is why it surfaced
  // now and not during the EAGLE work.
  test('a fuse has a symbol, not a generic box', () => {
    assert.ok(shapeFor('fuse'), 'fuse falls back to a labelled rectangle');
  });

  test('the discretes these importers emit all have symbols', () => {
    const discretes = ['resistor', 'capacitor', 'polarized_cap', 'inductor', 'fuse',
      'crystal', 'led', 'diode', 'zener', 'npn', 'pnp', 'nmos', 'pmos', 'tip120',
      'button', 'slide_switch', 'dip_switch', 'potentiometer', 'dc_motor', 'buzzer',
      'battery', 'vcc', 'gnd', 'header', 'opamp'];
    const missing = discretes.filter((k) => !shapeFor(k, { pins: 4 }));
    assert.deepEqual(missing, []);
  });
});

// ---------------------------------------------------------------------
describe('round trip: KiCad in, EAGLE out, EAGLE back in', () => {
  // Same contract as eagle-roundtrip.test.js: the PARTITION must survive, the
  // wire count need not -- the exporter merges the importer's star topology
  // into true nets.
  const src = importKicadSch(SCH);

  test('the fixture is worth round-tripping', () => {
    assert.ok(src.parts.length >= 8 && src.wires.length >= 5);
  });

  test('every part survives with its id and kind', () => {
    const back = importEagle(toEagleSch({ parts: src.parts, wires: src.wires }).xml);
    const ids = (r) => r.parts.map((p) => [p.id, p.kind]).sort();
    assert.deepEqual(ids(back), ids(src));
  });

  test('the electrical partition survives (wire COUNT may not)', () => {
    const back = importEagle(toEagleSch({ parts: src.parts, wires: src.wires }).xml);
    assert.deepEqual(partition(back.wires), partition(src.wires));
  });
});

// ---------------------------------------------------------------------
describe('the solver as oracle',
  { skip: engineAvailable ? false : 'needs a bw-board checkout beside this repo' }, () => {
    let solve;
    before(async () => {
      const { setEngine } = await import(join(CUI, 'src/engine.js'));
      const eng = await import(join(BWB, 'src/index.js'));
      (await import(join(BWB, 'src/register-all.js'))).registerAllDevices();
      setEngine({ BoardImpl: eng.BoardImpl, inferNetlist: eng.inferNetlist, checkWiring: eng.checkWiring });
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

    test('the imported bench actually loads into the engine', () => {
      const r = importKicadSch(SCH);
      assert.ok(solve(r.parts, r.wires).parts > 0,
        'an import the engine refuses leaves an EMPTY board and every other assertion here '
        + 'would be vacuous');
    });

    test('the oracle NOTICES a value misparse that the partition cannot see', () => {
      // Prove the oracle can fail. Without this, the test above passes just as
      // happily on an importer that reads every value wrong.
      const r = importKicadSch(SCH);
      const bad = r.parts.map((p) => (p.id === 'R2' ? { ...p, params: { ...p.params, ohms: 4.7 } } : p));
      assert.notDeepEqual(solve(bad, r.wires).v, solve(r.parts, r.wires).v,
        '"4k7" read as 4.7 must change the solution -- if it does not, this oracle proves nothing');
    });

    test('a MISSING connection changes the solution too', () => {
      // The failure this whole file is about: parts identical, symbols
      // identical, one wire quietly absent.
      const r = importKicadSch(SCH);
      const fewer = r.wires.filter((w) => !(w.from === 'R2' || w.to === 'R2'));
      assert.ok(fewer.length < r.wires.length, 'the mutation must remove something');
      assert.notDeepEqual(solve(r.parts, fewer).v, solve(r.parts, r.wires).v);
    });
  });

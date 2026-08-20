/**
 * EAGLE 6+ schematic import.
 *
 * Two layers: a self-contained fixture that pins the mapping rules, and — when
 * the checkout happens to sit beside a real EAGLE project — the actual
 * blinkenrocket schematic, because a format importer validated only against
 * its own fixture is validated against its author's assumptions.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { importEagle, parseEagleValue, normalizeEaglePin } from '../src/importers/eagle.js';
import { importCircuit } from '../src/importers/index.js';
import { detectFormat } from '../src/importers/detect.js';

const FIXTURE = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE eagle SYSTEM "eagle.dtd">
<eagle version="6.4"><drawing><schematic>
 <parts>
  <part name="R1" library="resistor" deviceset="R-EU_" device="0207/10" value="4k7"/>
  <part name="C1" library="resistor" deviceset="C-EU" device="050-024X044" value="100n"/>
  <part name="D1" library="ipc-7351-diode" deviceset="DIODE_" device="" value="1N4148"/>
  <part name="GND1" library="SparkFun-Aesthetics" deviceset="GND" device=""/>
  <part name="P1" library="SparkFun-Aesthetics" deviceset="VCC" device=""/>
  <part name="J1" library="SparkFun-Connectors" deviceset="AUDIO-JACK" device=""/>
 </parts>
 <sheets><sheet><nets>
  <net name="VCC"><segment>
    <pinref part="P1" gate="G$1" pin="VCC"/>
    <pinref part="R1" gate="G$1" pin="1"/>
  </segment></net>
  <net name="N$1"><segment>
    <pinref part="R1" gate="G$1" pin="2"/>
    <pinref part="D1" gate="G$1" pin="A"/>
    <pinref part="C1" gate="G$1" pin="1"/>
  </segment></net>
  <net name="GND"><segment>
    <pinref part="D1" gate="G$1" pin="K"/>
    <pinref part="C1" gate="G$1" pin="2"/>
    <pinref part="GND1" gate="1" pin="GND"/>
  </segment></net>
 </nets></sheet></sheets>
</schematic></drawing></eagle>`;

describe('EAGLE value parsing', () => {
    test('the letter is a decimal point when it sits between digits', () => {
        assert.equal(parseEagleValue('4k7'), 4700);      // NOT 4.7
        assert.equal(parseEagleValue('1u5'), 1.5e-6);
    });
    test('plain SI suffixes', () => {
        assert.equal(parseEagleValue('10k'), 10000);
        assert.equal(parseEagleValue('470'), 470);
        assert.equal(Math.round(parseEagleValue('100n') * 1e12), 100000);
        assert.equal(parseEagleValue('470R'), 470);
    });
    test('unparseable values are null, not silently zero', () => {
        assert.equal(parseEagleValue('1N4148'), null);
        assert.equal(parseEagleValue(''), null);
    });
});

describe('EAGLE pin-name normalisation', () => {
    test('strips alternate-function annotations and duplicate markers', () => {
        assert.equal(normalizeEaglePin('PB0(ICP1/CLKO/PCINT0)'), 'pb0');
        assert.equal(normalizeEaglePin('GND@2'), 'gnd');
    });
    test('supply aliases resolve to our terminal names', () => {
        assert.equal(normalizeEaglePin('VSS'), 'gnd');
        assert.equal(normalizeEaglePin('AVCC'), 'vcc');
    });
});

describe('EAGLE schematic import', () => {
    const r = importEagle(FIXTURE);

    test('maps passives with their values', () => {
        const byId = Object.fromEntries(r.parts.map((p) => [p.id, p]));
        assert.equal(byId.R1.kind, 'resistor');
        assert.equal(byId.R1.params.ohms, 4700);
        assert.equal(byId.C1.kind, 'capacitor');
        assert.equal(byId.GND1.kind, 'gnd');
        assert.equal(byId.P1.kind, 'vcc');
    });

    test('an unmappable component is REPORTED, never dropped', () => {
        assert.equal(r.unmapped.length, 1);
        assert.match(r.unmapped[0].libsource, /AUDIO-JACK/);
        assert.ok(r.warnings.some((w) => w.includes('Unmapped component: J1')));
        assert.ok(!r.parts.some((p) => p.id === 'J1'), 'and it is not invented as some default kind');
    });

    test('nets become wires, cathode spelled K resolves', () => {
        // 2 + 3 + 3 pins over three nets, star from the first -> 1 + 2 + 2
        assert.equal(r.wires.length, 5);
        assert.ok(r.wires.some((w) => (w.from === 'D1' && w.fromTerminal === 'cathode')
            || (w.to === 'D1' && w.toTerminal === 'cathode')), 'pin "K" is the cathode');
    });

    test('a .brd is refused with a reason instead of half-importing', () => {
        const b = importEagle('<eagle><drawing><board><elements/></board></drawing></eagle>');
        assert.equal(b.parts.length, 0);
        assert.match(b.warnings[0], /board layout/i);
    });

    test('registered in the importer registry', () => {
        const viaRegistry = importCircuit('eagle', FIXTURE);
        assert.equal(viaRegistry.parts.length, r.parts.length);
    });
});

// Ground truth: a real EAGLE project, if one happens to be checked out nearby.
const REAL = join(homedir(), 'code', 'blinkenrocket-firmware-with-minigame',
    'hardware', 'blinkenrocket_cr2032.sch');
describe('EAGLE import against a real schematic',
    { skip: existsSync(REAL) ? false : 'no EAGLE project checked out beside this repo' }, () => {
        const r = importEagle(readFileSync(REAL, 'utf8'));

        test('imports the board without a single unresolved pin', () => {
            const unknown = r.warnings.filter((w) => w.startsWith('Unknown pin'));
            assert.deepEqual(unknown, [], 'every pin of every mapped part resolved');
            assert.ok(r.parts.length > 30, `expected the whole board, got ${r.parts.length} parts`);
            assert.ok(r.wires.length > 60, `expected a full netlist, got ${r.wires.length} wires`);
        });

        test('the MCU and the 8x8 matrix are recognised, not just the passives', () => {
            const kinds = new Set(r.parts.map((p) => p.kind));
            for (const k of ['attiny88', 'matrix8x8', 'at24c02', 'resistor', 'capacitor', 'gnd', 'vcc']) {
                assert.ok(kinds.has(k), `expected a ${k}`);
            }
        });

        test('what is left unmapped is genuinely outside the engine vocabulary', () => {
            const libs = r.unmapped.map((u) => u.libsource).join(' ');
            assert.match(libs, /AUDIO-JACK/);
            assert.ok(r.unmapped.length <= 4, `unmapped grew to ${r.unmapped.length}: ${libs}`);
        });

        test('the matrix axis assumption is recorded, not silently taken', () => {
            assert.ok(r.warnings.some((w) => /transposed/.test(w)),
                'the row/col orientation is an assumption and must say so');
        });
    });

describe('import format detection', () => {
    test('recognises EAGLE, KiCad and Wokwi from content, not the extension', () => {
        assert.equal(detectFormat(FIXTURE, 'anything.txt'), 'eagle');
        assert.equal(detectFormat('(export (version D) (components ...', 'x'), 'kicad-netlist');
        assert.equal(detectFormat('{"parts": [], "connections": []}', 'diagram.json'), 'wokwi');
    });
    test('falls back to the extension, then admits defeat', () => {
        assert.equal(detectFormat('nothing recognisable', 'board.sch'), 'eagle');
        assert.equal(detectFormat('nothing recognisable', 'notes.txt'), null);
    });
});

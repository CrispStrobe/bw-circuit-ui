import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { parseSexpr, findOne, findAll, getVal } from '../src/importers/sexpr.js';
import { importKicadNetlist } from '../src/importers/kicad-netlist.js';
import { importWokwi, exportWokwi } from '../src/importers/wokwi.js';
import { importCircuit, getSupportedFormats } from '../src/importers/index.js';

// ── S-expression parser ──────────────────────────────────────────

describe('sexpr parser', () => {
  it('parses a simple list', () => {
    const r = parseSexpr('(hello world)');
    assert.deepEqual(r, ['hello', 'world']);
  });

  it('parses nested lists', () => {
    const r = parseSexpr('(a (b c) (d (e f)))');
    assert.deepEqual(r, ['a', ['b', 'c'], ['d', ['e', 'f']]]);
  });

  it('handles quoted strings', () => {
    const r = parseSexpr('(ref "U 1")');
    assert.deepEqual(r, ['ref', 'U 1']);
  });

  it('handles escaped quotes in strings', () => {
    const r = parseSexpr('(note "say \\"hello\\"")');
    assert.deepEqual(r, ['note', 'say "hello"']);
  });

  it('findOne / findAll / getVal', () => {
    const tree = parseSexpr('(root (a 1) (b 2) (a 3))');
    assert.deepEqual(getVal(tree, 'a'), '1');
    assert.deepEqual(getVal(tree, 'b'), '2');
    assert.equal(findAll(tree, 'a').length, 2);
    assert.equal(findOne(tree, 'c'), undefined);
  });
});

// ── KiCad netlist importer ───────────────────────────────────────

const SAMPLE_NETLIST = `(export (version D)
  (components
    (comp (ref R1) (value 1K)
      (libsource (lib Device) (part R)))
    (comp (ref R2) (value 4.7K)
      (libsource (lib Device) (part R)))
    (comp (ref U1) (value 74LS173)
      (libsource (lib 74xx) (part 74LS173)))
    (comp (ref U2) (value 74LS161)
      (libsource (lib 74xx) (part 74LS161)))
    (comp (ref U3) (value MYSTERY_CHIP)
      (libsource (lib custom) (part MYSTERY_CHIP)))
    (comp (ref FL1) (value PWR_FLAG)
      (libsource (lib power) (part PWR_FLAG)))
  )
  (nets
    (net (code 1) (name VCC)
      (node (ref U1) (pin 16))
      (node (ref R1) (pin 1))
    )
    (net (code 2) (name DATA0)
      (node (ref U1) (pin 14))
      (node (ref U2) (pin 14))
    )
    (net (code 3) (name CLK)
      (node (ref U1) (pin 7))
      (node (ref U2) (pin 2))
    )
  )
)`;

describe('KiCad netlist importer', () => {
  it('parses components and maps to engine kinds', () => {
    const result = importKicadNetlist(SAMPLE_NETLIST);
    assert.ok(result.parts.length >= 4); // R1, R2, U1, U2

    const r1 = result.parts.find(p => p.id === 'r1');
    assert.equal(r1.kind, 'resistor');
    assert.equal(r1.params.ohms, 1000);

    const r2 = result.parts.find(p => p.id === 'r2');
    assert.equal(r2.kind, 'resistor');
    assert.equal(r2.params.ohms, 4700);

    const u1 = result.parts.find(p => p.id === 'u1');
    assert.equal(u1.kind, '74ls173');

    const u2 = result.parts.find(p => p.id === 'u2');
    assert.equal(u2.kind, '74ls161');
  });

  it('surfaces unmapped components', () => {
    const result = importKicadNetlist(SAMPLE_NETLIST);
    assert.ok(result.unmapped.length >= 1);
    assert.equal(result.unmapped[0].ref, 'U3');
    assert.ok(result.warnings.some(w => w.includes('MYSTERY_CHIP')));
  });

  it('skips explicitly null-mapped parts (PWR_FLAG)', () => {
    const result = importKicadNetlist(SAMPLE_NETLIST);
    assert.ok(!result.parts.find(p => p.id === 'fl1'));
    assert.ok(!result.unmapped.find(u => u.ref === 'FL1'));
  });

  it('maps nets to wires with correct terminal names', () => {
    const result = importKicadNetlist(SAMPLE_NETLIST);

    // VCC net: U1 pin 16 (vcc) → R1 pin 1 (a)
    const vccWire = result.wires.find(w =>
      w.from === 'u1' && w.fromTerminal === 'vcc' && w.to === 'r1');
    assert.ok(vccWire, 'VCC wire should connect U1:vcc to R1:a');
    assert.equal(vccWire.toTerminal, 'a');

    // DATA0 net: U1 pin 14 (d0) → U2 pin 14 (q0)
    const dataWire = result.wires.find(w =>
      w.fromTerminal === 'd0' && w.toTerminal === 'q0');
    assert.ok(dataWire, 'DATA0 wire should connect d0 to q0');

    // CLK net: U1 pin 7 (clk) → U2 pin 2 (clk)
    const clkWire = result.wires.find(w =>
      w.fromTerminal === 'clk' && w.toTerminal === 'clk');
    assert.ok(clkWire, 'CLK wire should connect clk to clk');
  });

  it('rejects non-netlist input', () => {
    const result = importKicadNetlist('not a netlist');
    assert.equal(result.parts.length, 0);
    assert.ok(result.warnings.length > 0);
  });
});

// ── Wokwi importer ──────────────────────────────────────────────

const SAMPLE_WOKWI = JSON.stringify({
  version: 1,
  parts: [
    { type: 'wokwi-arduino-uno', id: 'uno1', top: 0, left: 0, attrs: {} },
    { type: 'wokwi-led', id: 'led1', top: 100, left: 200, attrs: { color: 'red' } },
    { type: 'wokwi-resistor', id: 'r1', top: 50, left: 150, attrs: { value: '220' } },
    { type: 'wokwi-unknown-thing', id: 'x1', top: 0, left: 0, attrs: {} },
  ],
  connections: [
    ['uno1:13', 'r1:1', 'green', []],
    ['r1:2', 'led1:A', 'green', []],
    ['led1:K', 'uno1:GND', 'black', []],
  ],
});

describe('Wokwi importer', () => {
  it('maps wokwi part types to engine kinds', () => {
    const result = importWokwi(SAMPLE_WOKWI);
    assert.equal(result.parts.find(p => p.id === 'uno1').kind, 'arduino_uno');
    assert.equal(result.parts.find(p => p.id === 'led1').kind, 'led');
    assert.equal(result.parts.find(p => p.id === 'r1').kind, 'resistor');
  });

  it('surfaces unmapped wokwi types', () => {
    const result = importWokwi(SAMPLE_WOKWI);
    assert.equal(result.unmapped.length, 1);
    assert.equal(result.unmapped[0].ref, 'x1');
  });

  it('maps wokwi pin names to engine terminals', () => {
    const result = importWokwi(SAMPLE_WOKWI);
    const gndWire = result.wires.find(w => w.toTerminal === 'gnd');
    assert.ok(gndWire);
    const anodeWire = result.wires.find(w => w.toTerminal === 'anode');
    assert.ok(anodeWire);
  });

  it('preserves positions', () => {
    const result = importWokwi(SAMPLE_WOKWI);
    const led = result.parts.find(p => p.id === 'led1');
    assert.equal(led.x, 200);
    assert.equal(led.y, 100);
  });
});

// ── Wokwi exporter ──────────────────────────────────────────────

describe('Wokwi exporter', () => {
  it('round-trips a simple circuit', () => {
    const circuit = {
      parts: [
        { id: 'led1', kind: 'led', params: { color: 'red' }, x: 10, y: 20 },
        { id: 'r1', kind: 'resistor', params: { ohms: 220 }, x: 30, y: 40 },
      ],
      wires: [
        { from: 'r1', fromTerminal: 'b', to: 'led1', toTerminal: 'anode' },
      ],
    };
    const { text: json, skipped } = exportWokwi(circuit);
    assert.deepEqual(skipped, [], 'both kinds map');
    const parsed = JSON.parse(json);
    assert.equal(parsed.version, 1);
    assert.equal(parsed.parts.length, 2);
    assert.equal(parsed.parts[0].type, 'wokwi-led');
    assert.equal(parsed.connections.length, 1);
    assert.equal(parsed.connections[0][0], 'r1:b');
    assert.equal(parsed.connections[0][1], 'led1:anode');
  });
});

// ── Wokwi acceptance: multi-part circuit with round-trip ────────

describe('Acceptance: Wokwi multi-part circuit', () => {
  const WOKWI_FULL = JSON.stringify({
    version: 1,
    parts: [
      { type: 'wokwi-arduino-uno', id: 'uno', top: 0, left: 0, attrs: {} },
      { type: 'wokwi-led', id: 'led1', top: -50, left: 200, attrs: { color: 'red' } },
      { type: 'wokwi-resistor', id: 'r1', top: 10, left: 200, attrs: { value: '220' } },
      { type: 'wokwi-pushbutton', id: 'btn1', top: 100, left: 300, attrs: {} },
      { type: 'wokwi-potentiometer', id: 'pot1', top: 150, left: 100, attrs: {} },
      { type: 'wokwi-lcd1602', id: 'lcd1', top: -150, left: 50, attrs: {} },
      { type: 'wokwi-servo', id: 'servo1', top: 200, left: 0, attrs: {} },
      { type: 'wokwi-hc-sr04', id: 'sr04', top: 300, left: 300, attrs: {} },
      { type: 'wokwi-7segment', id: 'seg1', top: -100, left: 350, attrs: {} },
      { type: 'wokwi-neopixel', id: 'neo1', top: 400, left: 0, attrs: {} },
      { type: 'wokwi-pir-motion-sensor', id: 'pir1', top: 400, left: 100, attrs: {} },
      { type: 'wokwi-dht22', id: 'dht1', top: 300, left: 200, attrs: {} },
      { type: 'wokwi-photoresistor', id: 'ldr1', top: 300, left: 100, attrs: {} },
      { type: 'wokwi-74hc595', id: 'sr595', top: 0, left: 400, attrs: {} },
      { type: 'wokwi-ssd1306', id: 'oled1', top: -200, left: 300, attrs: {} },
    ],
    connections: [
      ['uno:13', 'r1:1', 'green', []],
      ['r1:2', 'led1:A', 'green', []],
      ['led1:K', 'uno:GND', 'black', []],
      ['sr04:TRIG', 'uno:7', 'purple', []],
      ['sr04:ECHO', 'uno:8', 'cyan', []],
      ['sr04:VCC', 'uno:5V', 'red', []],
    ],
  });

  it('maps all 15 part types to engine kinds', () => {
    const result = importWokwi(WOKWI_FULL);
    assert.equal(result.parts.length, 15);
    assert.equal(result.unmapped.length, 0);
  });

  it('maps all expected kinds', () => {
    const result = importWokwi(WOKWI_FULL);
    const kinds = new Set(result.parts.map(p => p.kind));
    for (const expected of [
      'arduino_uno', 'led', 'resistor', 'button', 'potentiometer',
      'char_lcd', 'servo', 'ultrasonic', 'seven_segment', 'neopixel',
      'pir', 'dht11', 'ldr', '74hc595', 'ssd1306',
    ]) {
      assert.ok(kinds.has(expected), `Missing kind: ${expected}`);
    }
  });

  it('round-trips through export and re-import', () => {
    const first = importWokwi(WOKWI_FULL);
    const exported = exportWokwi(first);
    assert.deepEqual(exported.skipped, [], 'every imported kind maps back');
    const second = importWokwi(exported.text);
    assert.equal(second.parts.length, first.parts.length);
    assert.equal(second.wires.length, first.wires.length);
    assert.equal(second.unmapped.length, 0);
  });

  it('maps wokwi pin aliases correctly', () => {
    const result = importWokwi(WOKWI_FULL);
    // 'sr04:VCC' → 'vcc', 'led1:A' → 'anode'
    const vccWire = result.wires.find(w => w.toTerminal === 'vcc');
    assert.ok(vccWire, '5V alias should map to vcc');
    const anodeWire = result.wires.find(w => w.toTerminal === 'anode');
    assert.ok(anodeWire, 'A alias should map to anode');
  });
});

// ── Registry ─────────────────────────────────────────────────────

describe('importCircuit registry', () => {
  it('lists supported formats', () => {
    const formats = getSupportedFormats();
    for (const f of ['eagle', 'kicad-sch', 'kicad-legacy', 'kicad-netlist', 'wokwi']) {
      assert.ok(formats.includes(f), `${f} is missing from the registry`);
    }
  });

  it('returns error for unknown format', () => {
    // This asked for 'eagle' until the EAGLE importer was written, at which
    // point it started asserting that a REGISTERED format is unknown. The
    // file is not in `npm test`, so nothing noticed for as long as that took.
    const result = importCircuit('altium', '');
    assert.ok(result.warnings[0].includes('Unknown'));
  });

  it('dispatches to kicad importer', () => {
    const result = importCircuit('kicad-netlist', SAMPLE_NETLIST);
    assert.ok(result.parts.length >= 4);
  });

  it('dispatches to wokwi importer', () => {
    const result = importCircuit('wokwi', SAMPLE_WOKWI);
    assert.ok(result.parts.length >= 3);
  });
});

// ── Acceptance: Eater 8-bit corpus components ────────────────────

const EATER_NETLIST = `(export (version D)
  (components
    (comp (ref U1) (value LM555)
      (libsource (lib 8bit-computer-rescue) (part LM555-8bit-computer-rescue)))
    (comp (ref U31) (value 74LS00)
      (libsource (lib 8bit-computer-rescue) (part 74LS00-8bit-computer-rescue)))
    (comp (ref U22) (value 74LS02)
      (libsource (lib 8bit-computer-rescue) (part 74LS02-8bit-computer-rescue)))
    (comp (ref U28) (value 74LS04)
      (libsource (lib 8bit-computer-rescue) (part 74LS04-8bit-computer-rescue)))
    (comp (ref U10) (value 74LS08)
      (libsource (lib 8bit-computer-rescue) (part 74LS08-8bit-computer-rescue)))
    (comp (ref U11) (value 74LS32)
      (libsource (lib 8bit-computer-rescue) (part 74LS32-8bit-computer-rescue)))
    (comp (ref U12) (value 74LS86)
      (libsource (lib 8bit-computer-rescue) (part 74LS86-8bit-computer-rescue)))
    (comp (ref U13) (value 74LS173)
      (libsource (lib 8bit-computer-rescue) (part 74LS173-8bit-computer-rescue)))
    (comp (ref U14) (value 74LS161)
      (libsource (lib 8bit-computer-rescue) (part 74LS161-8bit-computer-rescue)))
    (comp (ref U24) (value 74189)
      (libsource (lib 8bit-computer-rescue) (part 74189-8bit-computer-rescue)))
    (comp (ref U15) (value 74LS157)
      (libsource (lib 8bit-computer-rescue) (part 74LS157-8bit-computer-rescue)))
    (comp (ref U30) (value 74LS107-ALT)
      (libsource (lib 8bit-computer-rescue) (part 74LS107-ALT-8bit-computer-rescue)))
    (comp (ref U16) (value 74LS245)
      (libsource (lib 8bit-computer-rescue) (part 74LS245-8bit-computer-rescue)))
    (comp (ref U17) (value 74LS138)
      (libsource (lib 8bit-computer-rescue) (part 74LS138-8bit-computer-rescue)))
    (comp (ref U18) (value 74LS283)
      (libsource (lib 8bit-computer-rescue) (part 74LS283-8bit-computer-rescue)))
    (comp (ref U45) (value 28C16)
      (libsource (lib 8bit-computer-rescue) (part 28C16-8bit-computer-rescue)))
    (comp (ref R1) (value 1K) (libsource (lib Device) (part R)))
    (comp (ref R4) (value 1M) (libsource (lib Device) (part R)))
    (comp (ref C1) (value "0.1µF") (libsource (lib Device) (part C)))
    (comp (ref D1) (value BLUE) (libsource (lib Device) (part LED)))
  )
  (nets
    (net (code 1) (name VCC)
      (node (ref U13) (pin 16))
      (node (ref U14) (pin 16))
    )
  )
)`;

describe('Acceptance: Eater 8-bit corpus', () => {
  it('maps all SAP-1 chip types from rescue-suffixed libsources', () => {
    const result = importKicadNetlist(EATER_NETLIST);
    const kinds = new Set(result.parts.map(p => p.kind));

    assert.ok(kinds.has('555'),       'LM555 → 555');
    assert.ok(kinds.has('74hc00'),    '74LS00 → 74hc00');
    assert.ok(kinds.has('74hc02'),    '74LS02 → 74hc02');
    assert.ok(kinds.has('74hc04'),    '74LS04 → 74hc04');
    assert.ok(kinds.has('74hc08'),    '74LS08 → 74hc08');
    assert.ok(kinds.has('74hc32'),    '74LS32 → 74hc32');
    assert.ok(kinds.has('74hc86'),    '74LS86 → 74hc86');
    assert.ok(kinds.has('74ls173'),   '74LS173 → 74ls173');
    assert.ok(kinds.has('74ls161'),   '74LS161 → 74ls161');
    assert.ok(kinds.has('74ls189'),   '74189 → 74ls189');
    assert.ok(kinds.has('74ls157'),   '74LS157 → 74ls157');
    assert.ok(kinds.has('74ls107'),   '74LS107 → 74ls107');
    assert.ok(kinds.has('74hc245'),   '74LS245 → 74hc245');
    assert.ok(kinds.has('74hc138'),   '74LS138 → 74hc138');
    assert.ok(kinds.has('74hc283'),   '74LS283 → 74hc283');
    assert.ok(kinds.has('28c256'),    '28C16 → 28c256');
    assert.ok(kinds.has('resistor'),  'R → resistor');
    assert.ok(kinds.has('capacitor'), 'C → capacitor');
    assert.ok(kinds.has('led'),       'LED → led');
  });

  it('has zero unmapped components for the Eater corpus', () => {
    const result = importKicadNetlist(EATER_NETLIST);
    assert.equal(result.unmapped.length, 0,
      'All Eater 8-bit components should map: ' +
      result.unmapped.map(u => u.ref + '=' + u.libsource).join(', '));
  });

  it('parses resistor values correctly', () => {
    const result = importKicadNetlist(EATER_NETLIST);
    const r1 = result.parts.find(p => p.id === 'r1');
    assert.equal(r1.params.ohms, 1000);
    const r4 = result.parts.find(p => p.id === 'r4');
    assert.equal(r4.params.ohms, 1000000);
  });
});

// ── Acceptance: KiCad XML netlist (real Eater 8-bit repo) ───────

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures');

const REAL_XML_PATH = '/tmp/8-Bit-Breadboard-Computer/KiCAD/8bit-computer.xml';
const hasRealXml = fs.existsSync(REAL_XML_PATH);

describe('Acceptance: Eater 8-bit XML netlist', { skip: !hasRealXml && 'real XML netlist not available' }, () => {
  let result;
  before(() => {
    const xml = fs.readFileSync(REAL_XML_PATH, 'utf8');
    result = importKicadNetlist(xml);
  });

  it('maps all 274 components (275 minus USB_B)', () => {
    assert.equal(result.parts.length, 274);
  });

  it('has zero unmapped components', () => {
    assert.equal(result.unmapped.length, 0,
      'All components should map: ' +
      result.unmapped.map(u => `${u.ref}=${u.libsource}`).join(', '));
  });

  it('generates 900+ wires from the net list', () => {
    assert.ok(result.wires.length >= 900,
      `Expected 900+ wires, got ${result.wires.length}`);
  });

  it('has zero warnings (all pins mapped)', () => {
    assert.equal(result.warnings.length, 0,
      'Unexpected warnings: ' + result.warnings.join('; '));
  });

  it('maps all expected IC kinds', () => {
    const kinds = new Set(result.parts.map(p => p.kind));
    for (const expected of [
      '555', '74hc00', '74hc02', '74hc04', '74hc08', '74hc32',
      '74hc86', '74hc138', '74hc245', '74hc283',
      '74ls173', '74ls161', '74ls189', '74ls157', '74ls107',
      '28c256', 'resistor', 'capacitor', 'led',
      'seven_segment', 'button', 'slide_switch', 'dip_switch',
      'polarized_cap', 'potentiometer',
    ]) {
      assert.ok(kinds.has(expected), `Missing kind: ${expected}`);
    }
  });

  it('auto-detects XML format without explicit format hint', () => {
    const xml = fs.readFileSync(REAL_XML_PATH, 'utf8');
    const r = importCircuit('kicad-netlist', xml);
    assert.equal(r.parts.length, 274);
  });
});

// ── Acceptance: Real Wokwi diagram.json fixtures ────────────────
//
// Three public third-party projects:
//   1. wokwi/arduino-simon-game — Uno + LEDs + buttons + 74HC595 + 7-segment
//   2. arcostasi/avr8js-electron-playground blink-led — Uno + resistor + LED (v2 format)
//   3. Aruack/7LED — Uno + breadboard + 8 LEDs + 8 resistors

function loadFixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

describe('Acceptance: Wokwi Simon Game (wokwi/arduino-simon-game)', () => {
  let result;
  before(() => { result = importWokwi(loadFixture('wokwi-simon-game.json')); });

  it('maps all 14 parts with zero unmapped', () => {
    assert.equal(result.parts.length, 14);
    assert.equal(result.unmapped.length, 0,
      'Unmapped: ' + result.unmapped.map(u => `${u.ref}=${u.value}`).join(', '));
  });

  it('maps all expected kind types', () => {
    const kinds = new Set(result.parts.map(p => p.kind));
    for (const k of ['arduino_uno', 'buzzer', 'led', 'button', '74hc595', 'seven_segment']) {
      assert.ok(kinds.has(k), `Missing kind: ${k}`);
    }
  });

  it('generates 48 wires', () => {
    assert.equal(result.wires.length, 48);
  });

  it('translates 74HC595 pin aliases correctly', () => {
    // DS→ser, SHCP→srclk, STCP→rclk, MR→srclr, OE→oe, Q7S→qh_s
    const sr1Wires = result.wires.filter(w => w.from === 'sr1' || w.to === 'sr1');
    const terminals = new Set([
      ...sr1Wires.map(w => w.from === 'sr1' ? w.fromTerminal : w.toTerminal),
    ]);
    assert.ok(terminals.has('ser'),   'DS should map to ser');
    assert.ok(terminals.has('srclk'), 'SHCP should map to srclk');
    assert.ok(terminals.has('rclk'),  'STCP should map to rclk');
    assert.ok(terminals.has('srclr'), 'MR should map to srclr');
    assert.ok(terminals.has('qh_s'),  'Q7S should map to qh_s');
    assert.ok(terminals.has('qa'),    'Q0 should map to qa');
  });

  it('strips GND.N instance suffixes', () => {
    const gndWires = result.wires.filter(w => w.fromTerminal === 'gnd' || w.toTerminal === 'gnd');
    assert.ok(gndWires.length > 0, 'Should have GND wires');
    // Verify no "gnd.1" etc leaked through
    for (const w of gndWires) {
      const t = w.fromTerminal === 'gnd' ? w.fromTerminal : w.toTerminal;
      assert.equal(t, 'gnd', 'GND instance suffix should be stripped');
    }
  });

  it('has zero warnings', () => {
    assert.equal(result.warnings.length, 0,
      'Warnings: ' + result.warnings.join('; '));
  });
});

describe('Acceptance: Wokwi Blink LED v2 format (avr8js-electron-playground)', () => {
  let result;
  before(() => { result = importWokwi(loadFixture('wokwi-blink-led.json')); });

  it('parses version 2 object-style connections', () => {
    assert.equal(result.parts.length, 3);
    assert.equal(result.wires.length, 3);
    assert.equal(result.unmapped.length, 0);
  });

  it('maps Uno + resistor + LED', () => {
    const kinds = new Set(result.parts.map(p => p.kind));
    assert.ok(kinds.has('arduino_uno'));
    assert.ok(kinds.has('resistor'));
    assert.ok(kinds.has('led'));
  });

  it('translates C pin to cathode', () => {
    const cathodeWire = result.wires.find(w =>
      w.fromTerminal === 'cathode' || w.toTerminal === 'cathode');
    assert.ok(cathodeWire, 'C should map to cathode');
  });

  it('translates A pin to anode', () => {
    const anodeWire = result.wires.find(w =>
      w.fromTerminal === 'anode' || w.toTerminal === 'anode');
    assert.ok(anodeWire, 'A should map to anode');
  });

  it('preserves part positions', () => {
    const uno = result.parts.find(p => p.kind === 'arduino_uno');
    assert.equal(uno.x, 170);
    assert.equal(uno.y, 332);
  });
});

describe('Acceptance: Wokwi 7LED + breadboard (Aruack/7LED)', () => {
  let result;
  before(() => { result = importWokwi(loadFixture('wokwi-7led-breadboard.json')); });

  it('maps all 18 parts (1 breadboard + 1 Uno + 8 resistors + 8 LEDs)', () => {
    assert.equal(result.parts.length, 18);
    assert.equal(result.unmapped.length, 0,
      'Unmapped: ' + result.unmapped.map(u => `${u.ref}=${u.value}`).join(', '));
  });

  it('maps wokwi-breadboard to breadboard kind', () => {
    const bb = result.parts.find(p => p.kind === 'breadboard');
    assert.ok(bb, 'breadboard kind should exist');
    assert.equal(bb.id, 'bb1');
  });

  it('generates 42 wires', () => {
    assert.equal(result.wires.length, 42);
  });

  it('preserves breadboard hole coordinates as terminal names', () => {
    const bbWires = result.wires.filter(w => w.from === 'bb1' || w.to === 'bb1');
    assert.ok(bbWires.length > 0, 'Should have breadboard wires');
    // Check that hole coordinates like "50b.j" pass through
    const holeWire = bbWires.find(w => {
      const t = w.from === 'bb1' ? w.fromTerminal : w.toTerminal;
      return /^\d+[tb]\.[a-j]$/.test(t);
    });
    assert.ok(holeWire, 'Breadboard hole coords (e.g. 50b.j) should pass through');
  });

  it('preserves breadboard rail references', () => {
    const bbWires = result.wires.filter(w => w.from === 'bb1' || w.to === 'bb1');
    // Check for power rail refs like "bn.30", "tn.1"
    const railWire = bbWires.find(w => {
      const t = w.from === 'bb1' ? w.fromTerminal : w.toTerminal;
      return /^[bt]n(\.\d+)?$/.test(t) || t === 'bn' || t === 'tn';
    });
    assert.ok(railWire, 'Breadboard rail refs (e.g. bn.30, tn.1) should pass through');
  });

  it('has zero warnings', () => {
    assert.equal(result.warnings.length, 0,
      'Warnings: ' + result.warnings.join('; '));
  });
});

describe('Acceptance: Wokwi via registry dispatcher', () => {
  it('dispatches all three fixtures through importCircuit', () => {
    for (const fixture of ['wokwi-simon-game.json', 'wokwi-blink-led.json', 'wokwi-7led-breadboard.json']) {
      const text = loadFixture(fixture);
      const r = importCircuit('wokwi', text);
      assert.ok(r.parts.length > 0, `${fixture} should produce parts`);
      assert.equal(r.unmapped.length, 0, `${fixture} should have no unmapped: ` +
        r.unmapped.map(u => `${u.ref}=${u.value}`).join(', '));
    }
  });
});

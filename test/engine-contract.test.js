/**
 * The four-layer contract for an imported part.
 *
 * A part is not "supported" because it draws. To be usable in the Circuit
 * Designer it needs all of:
 *
 *   1. a SYMBOL, or a deliberate fall back to the pin-labelled IC box;
 *   2. TERMINALS in the catalog, so it can be placed and wired;
 *   3. an ENGINE kind, so it seats on a board and takes part in MNA;
 *   4. for active parts (actuators, sensors, displays), DIALECT verbs, so a
 *      .bw program can drive or read it.
 *
 * Layers 2-4 are invisible to the eye: a part with a beautiful symbol and no
 * engine kind looks finished on screen and is inert. That is exactly how a
 * `regulator` kind got invented here while the engine had `vreg` all along --
 * it rendered perfectly and could not be simulated, wired to an MCU, or used
 * from the dialect. This file is the check that failed to exist then.
 */

import './_setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BoardImpl } from '../../bw-board/src/board.js';
import { registeredKinds } from '../../bw-board/src/devices.js';
import { registerAllDevices } from '../../bw-board/src/register-all.js';
import { terminalsForKind } from '../src/model/circuit.js';
import { RULES } from '../src/importers/eagle.js';
import { EASYEDA_RULES, mapEasyEdaPart } from '../src/importers/easyeda.js';
import { eagleFor, toEagleSch } from '../src/model/exporters/eagle.js';
import { importEagle } from '../src/importers/eagle.js';
import { KICAD_RULES } from '../src/importers/kicad-common.js';

// The AUTHORITY is the runtime device registry, not BoardImpl.getPartKinds().
// That method returns a HAND-MAINTAINED array, and it is stale: attiny88,
// at24c02, slide_switch, ssd1306 and matrix8x8 all have registered device
// models and none of them appear in it. Testing against the hardcoded list
// declared three working parts broken and "fixed" them by downgrading each to
// a generic model -- a regression invented by trusting the wrong oracle.
// registerAllDevices() must be called first: the registry is empty until it
// is, which is its own documented history in register-all.js.
registerAllDevices();
const ENGINE_KINDS = new Set([...registeredKinds(), ...BoardImpl.getPartKinds()]);

/**
 * Deviceset names to fire the rule table with -- drawn from the corpus, one
 * per rule family. Kept explicit so a rule that stops matching real EAGLE
 * names shows up as a shrinking `emitted` set rather than as silence.
 */
const PROBES = [
    'GND', 'VCC', '+3V3', '100NF', '10KOHM', 'R-EU_0207/10', 'C-EU025-025X050',
    'L-EU', 'LED5MM', 'DIODE-SOD123', 'ZENER-DIODE', 'BATTERY', 'CR2032',
    'ATTINY88', '24LC256', 'PINHD-1X6', 'HEADER-2X5', '74HC595N', '74HC4050D',
    'FERRITE', 'INDUCTOR', 'MOSFET-N', 'MOSFET-P', 'MOSFET-N_DUAL',
    'TRANSISTOR_NPN', 'PNP-SOT23', 'XTAL', 'SWITCH_DPDT', 'SWITCH_TACT_SMT',
    'WS2812B', 'LM7805', 'LD1117', 'VREG_SOT23-5', 'USB_TYPEA', 'MICROSD',
    'TERMBLOCK_1X2', 'JST_2PIN', '1X4', '3-STRIP', 'STEMMA_I2C',
    'FEATHERWING', 'TP', 'PERFHOLE', 'SEWTAP',
];


/**
 * The same list for the KiCad importers, whose vocabulary is SYMBOL names
 * (the half after the colon in `Device:R`), not EAGLE devicesets. Two rule
 * tables, one contract: a kind emitted from either side has to be a kind the
 * engine can build, or the part draws and is inert.
 */
const KICAD_PROBES = [
    'GND', 'GNDREF', 'Earth_Protective', 'VCC', 'VDD', '+3V3', '+5V', '+1V8', 'AC',
    'R', 'R_Small', 'R_Potentiometer', 'R_Network08', 'R1206_10K_1%_0.25W_100PPM',
    'C', 'C_Small', 'C_Polarized', 'CTEB2200_2.2UF_35V',
    'L', 'L_Small', 'INDUCTOR', 'Ferrite_Bead', 'Fuse', 'Polyfuse', 'Crystal', 'ECS-2520MV',
    'LED', 'LED_Small', 'D', 'D_Schottky', 'D_Zener', '1N4007', 'ESD5Zxx',
    'Q_NPN_BEC', 'BC337', '2N3904', 'Q_PNP_BEC', 'BC557', 'Q_NMOS_GDS', 'BSS138',
    'Q_PMOS_GDS', 'TIP120',
    'SW_Push', 'SW_SPST', 'SW_DIP_x08', 'SW_SPDT', 'SW_DPDT_x2', 'SW_Rotary', 'Jumper_2',
    'JUMPER_TRIPLE',
    'LM7805_TO220', '7809', 'LM7812', 'AMS1117-3.3', 'AZ1117-3.3', 'AMS1117', 'LM7915',
    'AP2112K-3.3',
    'TL072', 'LM358', 'NE555', '74HC595', '74LS138', 'SN74AHC1G14', 'L298N', 'PCF8574',
    '24LC256',
    'Motor_DC', 'Fan', 'Buzzer', 'Speaker', 'Relay_SPDT', 'NSL-32', 'WS2812B',
    'Battery_Cell', 'Lamp',
    'USB_B_Micro', 'USB_C_Receptacle_USB2.0_16P', 'Conn_01x04', 'Conn_02x03_Odd_Even',
    'CONN_13X2', 'Conn_2', 'TestPoint', 'BNC', 'DB9', 'AudioJack2', 'IEC_60320_C13_Plug',
    'PMOD_HOST_2x6',
];


/**
 * The same list again for the EasyEDA importer, whose vocabulary is a PART
 * NUMBER (`Manufacturer Part`, or the value text when the library left it
 * blank). Three rule tables now, one contract.
 */
const EASYEDA_PROBES = [
    'LM7805AL-TA3-T', '7809', 'MC7812', 'AMS1117-3.3', 'AMS1117-5.0', 'LD1117V33',
    'SN74LS138N', '74HC595', '74HC4050', '74LS161', '74HC00', '74HC373',
    'CD4093BE', 'CD4511BE', 'NE555', 'NE556', 'LM358', 'LM339', 'LM393',
    'MAX7219', 'PCF8574', '24LC256', 'WS2812B', 'DS18B20', 'DHT11', 'DHT22',
    'DS1302', 'DS3231', 'TIP120', 'HD44780', 'SSD1306',
];

/**
 * EasyEDA's OTHER half. A schematic that says only `spicePre` and `1k` never
 * reaches the rule table above, and the generic mapper is what decides those
 * -- which is most of a real board. Firing it here keeps the two halves under
 * the same contract instead of only the half with part numbers in it.
 */
const SPICE_PRE_PROBES = [
    { spicePre: 'R', value: '10k', pinCount: 2 },
    { spicePre: 'R', value: '10k', pinCount: 3 },
    { spicePre: 'C', value: '100nF', pinCount: 2 },
    { spicePre: 'L', value: '10uH', pinCount: 2 },
    { spicePre: 'D', value: '1N4148', pinCount: 2 },
    { spicePre: 'D', value: 'LED-RED', pinCount: 2 },
    { spicePre: 'D', value: 'BZX55C5V1', pinCount: 2 },
    { spicePre: 'Q', value: '2N3904', pinCount: 3 },
    { spicePre: 'Q', value: '2N3906', pinCount: 3 },
    { spicePre: 'Q', value: 'IRF540N', pinCount: 3 },
    { spicePre: 'K', value: 'SRD-05VDC', pinCount: 5 },
    { spicePre: 'S', value: 'reset', pinCount: 2 },
    { spicePre: 'S', value: 'mode', pinCount: 3 },
    { spicePre: 'X', value: '16MHz', pinCount: 2 },
    { spicePre: 'P', value: 'Header', pinCount: 2 },
    { spicePre: 'P', value: 'Ports', pinCount: 20 },
    { spicePre: 'J', value: 'DC_M', pinCount: 3 },
    { spicePre: 'H', value: 'Header', pinCount: 3 },
    { spicePre: 'V', value: '9V', pinCount: 2 },
    { spicePre: 'BT', value: 'AA', pinCount: 2 },
];

/**
 * Kinds the importer may emit that the engine deliberately does NOT model.
 *
 * Every entry needs a reason. This list is a debt register, not an escape
 * hatch: a part here imports for the schematic and is inert on the board, so
 * it should either gain an engine model or stop being imported.
 */
// 2026-08-20: EMPTIED. `crystal` was the only entry and bw-board db2c5e2
// gave it a real device (terminals a/b), so the excuse went with it. The
// map stays as the place a future gap declares itself — it may only grow
// with a stated reason, and every entry has to be gone the moment the
// engine models the kind.
const SCHEMATIC_ONLY = {};

describe('imported kinds are usable, not just drawable', () => {
    // Every kind any rule can produce. Rules are functions, so this calls each
    // with a representative deviceset name rather than reading the source.
    const emitted = new Set();
    const fire = (rules, probes) => {
        const hit = new Set();
        for (const [re, fn] of rules) {
            for (const probe of probes) {
                if (!re.test(probe)) continue;
                try {
                    const r = fn('10k', probe);
                    if (r && r.kind) { emitted.add(r.kind); hit.add(r.kind); }
                } catch { /* rule needs a shape this probe does not have */ }
            }
        }
        return hit;
    };
    const fromEagle = fire(RULES, PROBES);
    const fromKicad = fire(KICAD_RULES, KICAD_PROBES);
    const fromEasyEda = fire(EASYEDA_RULES, EASYEDA_PROBES);
    const fromSpicePre = new Set();
    for (const probe of SPICE_PRE_PROBES) {
        const r = mapEasyEdaPart({ descriptor: '', package: '', ...probe });
        if (r && r.kind) { emitted.add(r.kind); fromSpicePre.add(r.kind); }
    }

    test('the registry is populated, so the check has something to check', () => {
        // Without registerAllDevices() the registry is EMPTY and every kind
        // looks like an orphan -- or, if the assertion were inverted, none
        // would. Pin the size so an empty registry cannot pass quietly.
        assert.ok(ENGINE_KINDS.size > 150,
            `engine knows only ${ENGINE_KINDS.size} kinds — registerAllDevices did not run`);
    });

    test('the probe lists actually exercise BOTH rule tables', () => {
        // If the probes stop matching, every assertion below passes vacuously.
        assert.ok(fromEagle.size >= 20, `EAGLE: only ${fromEagle.size} kinds emitted — probes have gone stale`);
        assert.ok(fromKicad.size >= 25, `KiCad: only ${fromKicad.size} kinds emitted — probes have gone stale`);
        assert.ok(fromEasyEda.size >= 15, `EasyEDA: only ${fromEasyEda.size} kinds emitted — probes have gone stale`);
        assert.ok(fromSpicePre.size >= 12, `EasyEDA spicePre: only ${fromSpicePre.size} kinds emitted`);
    });

    test('every emitted kind is one the engine knows', () => {
        const orphans = [...emitted]
            .filter((k) => !ENGINE_KINDS.has(k))
            .filter((k) => !SCHEMATIC_ONLY[k])
            .filter((k) => !/^74hc\d+$/.test(k));   // generated per-number, checked below
        assert.deepEqual(orphans, [],
            `these import as parts the engine cannot build, so they draw but do not `
            + `simulate or wire: ${orphans.join(', ')}. Map them to an existing engine `
            + `kind, add an engine model, or list them in SCHEMATIC_ONLY with a reason.`);
    });

    test('every emitted kind can be placed and wired', () => {
        for (const k of emitted) {
            const t = terminalsForKind(k, { pins: 4 });
            assert.ok(Array.isArray(t) && t.length > 0,
                `${k} has no terminals, so it cannot be wired in the Designer`);
        }
    });

    test('SCHEMATIC_ONLY carries a reason for each entry', () => {
        for (const [k, why] of Object.entries(SCHEMATIC_ONLY)) {
            assert.ok(why && why.length > 20, `${k} is excused without a real reason`);
            assert.ok(!ENGINE_KINDS.has(k),
                `${k} is listed as schematic-only but the engine models it — drop the excuse`);
        }
    });
});

describe('importer and exporter stay symmetric', () => {
    // A kind the importer can produce but the exporter cannot write is not a
    // cosmetic gap: toEagleSch SKIPS such a part, and a skipped part takes its
    // nets with it. When the importer gained rules for MOSFETs, connectors and
    // regulators without matching exporter entries, corpus round-trips fell
    // from 282/287 to 203/287 and the only visible symptom was a net count
    // that had quietly shrunk. Nothing failed; the numbers just got worse.
    const emitted = new Set();
    for (const [re, fn] of RULES) {
        for (const probe of PROBES) {
            if (!re.test(probe)) continue;
            try {
                const r = fn('10k', probe);
                if (r && r.kind) emitted.add(r.kind);
            } catch { /* rule needs a shape this probe does not have */ }
        }
    }

    test('every importable kind can also be exported', () => {
        // header is built per-instance by headerFor(), not looked up in the
        // table, so it is exportable without a KIND_TO_EAGLE entry.
        const orphans = [...emitted].filter((k) => k !== 'header' && !eagleFor(k));
        assert.deepEqual(orphans, [],
            `these import but cannot be exported, so a round-trip silently drops them `
            + `and their nets: ${orphans.join(', ')}`);
    });

    test('the check is not vacuous', () => {
        assert.ok(emitted.size >= 20, `only ${emitted.size} kinds emitted — probes are stale`);
        assert.equal(eagleFor('definitely_not_a_part'), null,
            'eagleFor must return null for an unknown kind, or the check above cannot fail');
    });
});

describe('the TERMINAL names a rule emits are terminals the engine has', () => {
    // Layer 3 has a second half that nothing was checking. A rule can name a
    // real engine kind and still hand it terminals that kind does not have,
    // and the result is a wire the board accepts and ignores -- no warning, no
    // rejection, just a connection that is drawn and does not conduct.
    //
    // Writing this found five: the KiCad rules gave opamp `in_p`/`in_n` where
    // the engine says `inp`/`inn`, dc_motor `pos`/`neg` where it says `a`/`b`,
    // and a DIP switch its PIN NUMBERS where it wants `s0_a`; and BOTH rule
    // tables emitted p9/p10 for a ten-pin connector, when the engine's header
    // model stops at eight.
    //
    // Only explicit pin maps and `terminals` allowlists can be checked this
    // way. A `byName` rule computes its terminal from whatever the library
    // called the pin, which is not enumerable from here -- those are covered
    // by the corpus runs and by the allowlists the risky ones carry.
    const cases = [];
    const collect = (rules, probes, label) => {
        for (const [re, fn] of rules) {
            for (const probe of probes) {
                if (!re.test(probe)) continue;
                let r;
                try { r = fn('10k', probe); } catch { continue; }
                if (!r || !r.kind) continue;
                const names = new Set([
                    ...Object.values(r.pins || {}),
                    ...(r.anyPin ? [r.anyPin] : []),
                    ...(r.terminals || []),
                ]);
                if (names.size) cases.push({ label, probe, kind: r.kind, params: r.params || {}, names });
            }
        }
    };
    collect(RULES, PROBES, 'EAGLE');
    collect(KICAD_RULES, KICAD_PROBES, 'KiCad');
    collect(EASYEDA_RULES, EASYEDA_PROBES, 'EasyEDA');
    for (const probe of SPICE_PRE_PROBES) {
        const r = mapEasyEdaPart({ descriptor: '', package: '', ...probe });
        if (!r || !r.kind) continue;
        const names = new Set([
            ...Object.values(r.pins || {}),
            ...(r.anyPin ? [r.anyPin] : []),
            ...(r.terminals || []),
        ]);
        if (names.size) {
            cases.push({ label: 'EasyEDA spicePre', probe: `${probe.spicePre}/${probe.value}`,
                kind: r.kind, params: r.params || {}, names });
        }
    }

    test('there is something to check', () => {
        assert.ok(cases.length >= 40, `only ${cases.length} rule/probe pairs name terminals`);
    });

    test('no rule names a terminal its kind does not have', () => {
        const bad = [];
        for (const c of cases) {
            let have;
            try { have = terminalsForKind(c.kind, { pins: 4, ...c.params }); } catch { continue; }
            if (!have || !have.length) continue;          // dynamic-terminal kind
            const set = new Set(have);
            for (const n of c.names) {
                if (!set.has(n)) bad.push(`${c.label} ${c.probe} -> ${c.kind}: "${n}" not in [${have.join(',')}]`);
            }
        }
        assert.deepEqual([...new Set(bad)], [],
            'these rules emit wires the engine accepts and then ignores');
    });
});

describe('active parts reach the dialect', () => {
    // An actuator or sensor that cannot be driven from a .bw program is only
    // half-integrated, however well it simulates.
    const gen = readFileSync(
        '/Users/christianstrobele/code/sb3-creator/src/utils/sb3Creator.js', 'utf8');

    /** kind -> a dialect opcode (or pin verb) that drives or reads it. */
    const ACTIVE = {
        relay: 'devices_setrelay',
        dc_motor: 'devices_setmotor',
        neopixel: 'devices_setneopixel',
        matrix8x8: 'devices_setpixel',
        ssd1306: 'devices_oledprint',
        ili9341: 'devices_tftprint',
        char_lcd_i2c: 'devices_lcdprint',
        seven_segment: 'devices_showdigit',
        ultrasonic: 'devices_distance',
        pir_sensor: 'devices_motion',
        tilt_sensor: 'devices_tilted',
        temp_sensor: 'devices_temperature',
        ldr: 'devices_light',
        ir_receiver: 'devices_ircode',
        button: 'devices_pressed',
        servo: 'devices_setservo',
    };

    test('each active kind has a verb that survives in the generator', () => {
        const missing = Object.entries(ACTIVE)
            .filter(([, op]) => !gen.includes(op))
            .map(([k, op]) => `${k} (${op})`);
        assert.deepEqual(missing, [],
            `the dialect lost the verbs for: ${missing.join(', ')}`);
    });
});

describe('what EasyEDA can import, and what survives being written back out', () => {
    // Same failure as the EAGLE block above, one importer further on: a kind
    // toEagleSch has no entry for is SKIPPED, and a skipped part takes its
    // nets with it. So this does not ask whether eagleFor() answers -- it
    // EXPORTS a two-part circuit and re-imports it, which is the property the
    // corpus round-trips actually depend on.
    const emitted = new Map();
    const note = (r) => { if (r && r.kind && !emitted.has(r.kind)) emitted.set(r.kind, r.params || {}); };
    for (const [re, fn] of EASYEDA_RULES) {
        for (const probe of EASYEDA_PROBES) {
            if (!re.test(probe)) continue;
            try { note(fn('10k', probe)); } catch { /* probe lacks a shape this rule wants */ }
        }
    }
    for (const probe of SPICE_PRE_PROBES) note(mapEasyEdaPart({ descriptor: '', package: '', ...probe }));
    // Power symbols are parts too, and they carry the rails.
    note({ kind: 'vcc' }); note({ kind: 'gnd' });

    /**
     * Kinds with NO inverse in the EAGLE vocabulary.
     *
     * Not an exporter gap that a table entry would close: eagle.js's RULES
     * have no rule that reads these devicesets BACK, so writing one would
     * round-trip the part to a different kind -- an AMS1117 returns as
     * `ld1117v33`, an LM7809 as a generic `vreg`, a 74LS161 as `74hc161` --
     * which is quieter and worse than a visible skip. Closing them means
     * adding importer rules to eagle.js, whose table also serves the KiCad
     * side and which already emits most of these same kinds with the same
     * exposure. That is a job for the EAGLE lane, not this one.
     *
     * The list is asserted EXACTLY, both ways: a new EasyEDA rule for an
     * unexportable kind fails here, and so does fixing one of these without
     * striking it off.
     */
    const NO_EAGLE_INVERSE = new Set([
        '74ls161', 'ams1117_33', 'ams1117_50', 'cd4093', 'cd4511', 'dht11', 'dht22',
        'ds1302', 'ds18b20', 'ds3231', 'hd44780', 'lm339', 'lm358', 'lm393',
        'lm7809', 'lm7812', 'max7219', 'pcf8574', 'potentiometer', 'relay',
        'ssd1306', 'timer_555', 'timer_556', 'tip120', 'vsource',
    ]);

    /** Export two of a kind, wire them, read it back. Returns the kinds seen. */
    const roundTrip = (kind, params) => {
        const terms = terminalsForKind(kind, { pins: 4, ...params }) || [];
        const parts = [{ id: 'X1', kind, params, x: 0, y: 0 }, { id: 'X2', kind, params, x: 0, y: 0 }];
        const wires = terms.length
            ? [{ from: 'X1', fromTerminal: terms[0], to: 'X2', toTerminal: terms[0] }] : [];
        return importEagle(toEagleSch({ parts, wires }).xml).parts.map((p) => p.kind);
    };

    test('there is something to check', () => {
        assert.ok(emitted.size >= 40, `only ${emitted.size} EasyEDA kinds emitted — probes are stale`);
        assert.deepEqual(roundTrip('definitely_not_a_part', {}), [],
            'an unknown kind must round-trip to nothing, or the check below cannot fail');
    });

    test('every kind not on the gap list survives export and re-import', () => {
        const lost = [];
        for (const [kind, params] of emitted) {
            if (NO_EAGLE_INVERSE.has(kind)) continue;
            const back = roundTrip(kind, params);
            if (back.length !== 2 || back[0] !== kind) lost.push(`${kind} -> ${back.join(',') || 'DROPPED'}`);
        }
        assert.deepEqual(lost, [],
            `these import from EasyEDA and are silently dropped on the way out, taking `
            + `their nets with them: ${lost.join('; ')}`);
    });

    test('the gap list is exactly the kinds that really cannot make the trip', () => {
        // Both directions. A stale entry here is a fix nobody noticed landing;
        // a missing one is a net quietly disappearing.
        const actuallyLost = new Set();
        for (const [kind, params] of emitted) {
            const back = roundTrip(kind, params);
            if (back.length !== 2 || back[0] !== kind) actuallyLost.add(kind);
        }
        assert.deepEqual([...actuallyLost].sort(), [...NO_EAGLE_INVERSE].sort());
    });
});

/**
 * EasyEDA import: PIN IDENTITY, and wires that stop just short of a label.
 *
 * Two quiet failures the rc-divider and bus fixtures do not reach.
 *
 *   easyeda-pin-numbering.json  U1's P-record SLOT indices are 1,2,3,7,8,9
 *                               while its DISPLAYED pin numbers are 1..6.
 *                               The displayed number is what a footprint pad
 *                               is keyed on; the slot is an internal index.
 *                               R1 and BT1 have slot == number and are the
 *                               control: a reader that is right about them
 *                               and wrong about U1 is reading the slot.
 *
 *                               VBAT is the near-miss. BT1/2 reaches the
 *                               flag's pin; U1/5's wire corners SIX units
 *                               past it, on the flag's graphic. It looks
 *                               joined at every zoom level and conducts
 *                               nothing.
 *
 * Partition written down before the importer was run:
 *   VCC   U1/4 R1/1          (U1/4 is slot 7)
 *   GND   U1/6 R1/2 BT1/1    (U1/6 is slot 9)
 *   VBAT  BT1/2              (one pin: U1/5 missed it)
 *   floating U1/5 (slot 8); no-connect U1/1 U1/2 U1/3
 */
import './_setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  easyEdaPartition, easyEdaNearMisses, easyEdaOrphanNets, importEasyEda,
} from '../src/importers/easyeda.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = readFileSync(join(HERE, 'fixtures', 'easyeda-pin-numbering.json'), 'utf8');
const RC = readFileSync(join(HERE, 'fixtures', 'easyeda-rc-divider.json'), 'utf8');
const setOf = (p) => new Set(p.split('|'));
const find = (parts, member) => parts.find((n) => setOf(n).has(member));

describe('EasyEDA pin identity', () => {
  test('pins are named by DISPLAYED number, not P-record slot', () => {
    const parts = easyEdaPartition(FIX);
    // control: R1's slot and number agree, so it reads right either way
    assert.ok(find(parts, 'R1/1'), 'R1/1 should be on a net');
    assert.ok(find(parts, 'R1/2'), 'R1/2 should be on a net');
    // subject: U1's VDD is slot 7 but pin 4; VSS is slot 9 but pin 6
    assert.ok(find(parts, 'U1/4'), 'U1 VDD is displayed pin 4 (slot 7)');
    assert.ok(find(parts, 'U1/6'), 'U1 VSS is displayed pin 6 (slot 9)');
    assert.equal(find(parts, 'U1/7'), undefined, 'slot 7 is not a pin number');
    assert.equal(find(parts, 'U1/9'), undefined, 'slot 9 is not a pin number');
  });

  test('both labelled nets have exactly their expected members', () => {
    const parts = easyEdaPartition(FIX);
    assert.deepEqual(setOf(find(parts, 'R1/1')), new Set(['U1/4', 'R1/1']));
    assert.deepEqual(setOf(find(parts, 'R1/2')), new Set(['U1/6', 'R1/2', 'BT1/1']));
  });
});

describe('EasyEDA near-miss detection', () => {
  test('a wire that stops on a flag graphic is found and located', () => {
    const m = easyEdaNearMisses(FIX);
    assert.equal(m.length, 1);
    assert.equal(m[0].label, 'VBAT');
    assert.equal(m[0].dist, 6);
    assert.deepEqual([m[0].x, m[0].y], [400, -94]);
  });

  test('it does NOT fire on a rail that legitimately feeds one pin', () => {
    // rc-divider's VCC reaches only R1/1, and that is correct. A detector
    // keyed on the pin COUNT alone flags it; this one must not, or it gets
    // tuned out and stops being read.
    assert.deepEqual(easyEdaOrphanNets(RC).map((o) => o.name), ['VCC']);
    assert.deepEqual(easyEdaNearMisses(RC), []);
  });

  test('the importer warns about the miss, and only about the miss', () => {
    const bad = importEasyEda(FIX).warnings.join('\n');
    assert.match(bad, /stop just short of a net label/);
    assert.match(bad, /VBAT/);
    const good = importEasyEda(RC).warnings.join('\n');
    assert.doesNotMatch(good, /stop just short of a net label/);
  });
});

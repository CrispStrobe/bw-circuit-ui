/**
 * attiny88 pin 22 is a second GND, and saved circuits that call it `pa0`
 * still seat correctly.
 *
 * The PDIP-28 does not bond out port A — PA0-PA3 reach a pad only on the
 * 32-pin QFN — so pin 22 is a SECOND GND that somebody needed a name for
 * (Microchip ATtiny88 datasheet DS40002178). Renamed `pa0` -> `gnd2` in
 * bw-board `e1bda3f`, which owns terminal NAMES, then here and in bw-parts,
 * because the canvas looks terminal POSITIONS up BY NAME.
 *
 * 135 shipped circuits carry an attiny88; 70 seat one, and every one of those
 * names pin 22 in `seat.leadMap`. A leadMap key is a terminal name, so a
 * rename is a data migration there exactly as it is for a wire endpoint —
 * and that path had none.
 *
 * @module
 */
import './_setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, resetIds, terminalsForKind } from '../src/model/circuit.js';
import { TERMINAL_ALIASES } from '../src/model/terminal-aliases.js';
import { FOOTPRINTS } from '../src/model/footprints.js';

describe('attiny88 pin 22 is gnd2, not pa0', () => {
  test('the package terminal list has gnd2 and no pa0', () => {
    const terms = terminalsForKind('attiny88', {});
    assert.ok(terms.includes('gnd2'),
      'pin 22 must be named gnd2 — it is a second GND. bw-board owns this name; if it is '
      + 'missing, the engine and the sidecar have drifted apart and the canvas will draw the '
      + 'lead at the part origin.');
    assert.ok(!terms.includes('pa0'),
      'the PDIP-28 bonds out no port A, so a `pa0` terminal here is a package that does not '
      + 'exist. PA0-PA3 stay in bw-board ATTINY88_PINS: those are the DIE registers.');
    assert.equal(terms.length, 28, 'DIP-28 has 28 terminals');
  });

  test('the footprint places gnd2, and attiny2313 keeps its real pa0', () => {
    const fp = FOOTPRINTS.attiny88;
    assert.ok(fp.leads.gnd2, 'the footprint must give gnd2 a hole, or seating puts it nowhere');
    assert.ok(!fp.leads.pa0, 'no pa0 lead on a package that has no PA0');
    // The rename must not have swept a part that legitimately HAS a pa0.
    assert.ok(FOOTPRINTS.attiny2313.leads.pa0,
      'attiny2313 really does bond out PA0 — a rename that caught it would be a wrong fix '
      + 'that happened to make this file pass');
  });

  test('MIGRATION: a saved circuit naming pa0 seats as gnd2, in the same hole', () => {
    resetIds();
    const c = Circuit.fromJSON({
      parts: [
        { id: 'bb1', kind: 'breadboard', x: 0, y: 0 },
        { id: 'u1', kind: 'attiny88', x: 0, y: 0,
          // As the shipped circuits are written: a DECLARED list of just the
          // wired pin, and a leadMap that drops every leg into a hole.
          terminals: ['pb0'],
          seat: { boardId: 'bb1', leadMap: { pa0: 'e9', pb0: 'e3' } } },
      ],
      wires: [],
    });
    const u1 = c.parts.find(p => p.id === 'u1');
    assert.ok(!('pa0' in u1.seat.leadMap),
      'the old name must not survive the load: the hole stays occupied and the strip conducts, '
      + 'but the leg belongs to a terminal the part no longer declares — silent, and invisible '
      + 'to the wire-side alias resolution');
    assert.equal(u1.seat.leadMap.gnd2, 'e9',
      'and it must land in the SAME hole — a migration that moves a leg is a re-seat, not a '
      + 'rename');
    assert.equal(u1.seat.leadMap.pb0, 'e3', 'every other leg is untouched');
  });

  test('the alias resolves against the PACKAGE list, not the declared one', () => {
    // The declared list is commonly one entry (`01-blink/circuit.attiny88.json`
    // declares ["pb0"] and seats 28 legs), and resolveTerminal only accepts an
    // alias whose target is in the list it is given. Passing the declared list
    // left 20 of the 70 seated attiny88 circuits still holding `pa0`.
    assert.equal(TERMINAL_ALIASES.attiny88?.pa0, 'gnd2', 'the alias must exist');
    const pkg = terminalsForKind('attiny88', {});
    assert.ok(pkg.includes('gnd2') && pkg.length > 1,
      'the package list is what makes the alias resolvable; a one-entry declared list cannot');
  });
});

// An Uno cannot be seated on a breadboard, and a saved file that says it is
// must be healed on load rather than believed.
//
// Uno and Mega have female headers and standoff feet: nothing plugs into a
// breadboard. Their builtin footprint stubs were deleted for that reason
// (footprints.js), but 61 shipped circuit-flat.json files kept the seats
// those stubs had already stamped — leadMaps keyed D0..D13, uppercase, on a
// part whose terminals are lowercase d0..d13.
//
// The seat was not harmless. bb.occupy() succeeds on free holes, so the
// legs took a3..a16 and the strips conducted through terminals that do not
// exist; and the renderer skips pin rects for a Wokwi-faced board (the art
// draws its own headers) AND skips lead stubs for a seated part (legs go
// into holes), so a stale seat hit both and left wire ends floating in
// space over the board art.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import './_setup.js';
import { Circuit, terminalsForKind } from '../src/model/circuit.js';
import { FOOTPRINTS } from '../src/model/footprints.js';

/** A bench with one board seated on a breadboard, as the legacy files wrote it. */
function savedFile(kind, leadMap) {
  return {
    vcc: 5,
    parts: [
      { id: 'bb1', kind: 'breadboard', x: 400, y: 300, params: { size: 'full' } },
      { id: 'board', kind, x: 64, y: 255, params: {},
        seat: { boardId: 'bb1', leadMap } },
    ],
    wires: [],
  };
}

const UNO_LEGACY_LEADMAP = Object.fromEntries(
  Array.from({ length: 14 }, (_, n) => [`D${n}`, `a${n + 3}`]));

describe('controller seat migration', () => {
  it('the premise: an Uno has no footprint, so it cannot be seated', () => {
    // If this ever gains a footprint the migration below becomes wrong, so
    // the test states its own premise rather than assuming it.
    assert.equal(FOOTPRINTS.arduino_uno, undefined, 'Uno must stay unseatable');
    assert.equal(FOOTPRINTS.arduino_mega, undefined, 'Mega too');
    assert.ok(FOOTPRINTS.arduino_nano, 'a Nano IS a breadboard module');
    assert.ok(FOOTPRINTS.pi_pico, 'so is a Pico');
  });

  it('loading a seated Uno drops the seat and floats the board', () => {
    const c = Circuit.fromJSON(savedFile('arduino_uno', UNO_LEGACY_LEADMAP));
    const board = c.parts.find(p => p.id === 'board');
    assert.ok(board, 'the board still loads');
    assert.equal(board.seat, undefined, 'the impossible seat is gone');
  });

  it('and it releases the holes it was wrongly holding', () => {
    // The half that is not cosmetic: an unmigrated seat occupies a3..a16,
    // so a real part could not use them and the strips conducted through
    // legs belonging to no terminal.
    const c = Circuit.fromJSON(savedFile('arduino_uno', UNO_LEGACY_LEADMAP));
    const bb = c.breadboards.get('bb1');
    for (const hole of ['a3', 'a10', 'a16']) {
      assert.equal(bb.occupantOf(hole), undefined,
        `${hole} must be free once the Uno floats`);
    }
    const held = [...bb.occupants.values()].filter(o => o.partId === 'board');
    assert.deepEqual(held, [], 'no hole is still assigned to the board');
  });

  it('a genuinely seatable board keeps its seat — the guard is not a blanket', () => {
    // The mutation that proves this test can fail: if the migration dropped
    // every seat instead of only footprint-less ones, a Nano would float too
    // and this assertion would catch it.
    const leads = FOOTPRINTS.arduino_nano.leads;
    const nanoTerms = terminalsForKind('arduino_nano') || [];
    const name = Object.keys(leads).find(t => nanoTerms.includes(t));
    const c = Circuit.fromJSON(savedFile('arduino_nano', { [name]: 'a5' }));
    const board = c.parts.find(p => p.id === 'board');
    assert.ok(board.seat, 'a Nano is a breadboard module and stays seated');
    assert.equal(board.seat.boardId, 'bb1');
  });

  it('the Uno keeps its terminals and its wires — only the seat goes', () => {
    // Dropping the seat must not cost the bench its connections: an Uno is
    // wired explicitly, which is exactly how it is meant to be used.
    const file = savedFile('arduino_uno', UNO_LEGACY_LEADMAP);
    file.parts.push({ id: 'led1', kind: 'led', x: 700, y: 300, params: {} });
    file.wires = [{ id: 'w1', from: { part: 'board', terminal: 'd13' },
      to: { part: 'led1', terminal: 'anode' } }];
    const c = Circuit.fromJSON(file);
    const board = c.parts.find(p => p.id === 'board');
    assert.equal(board.seat, undefined);
    assert.ok(board.terminals.includes('d13'), 'terminals survive');
    assert.equal(c.wires.length, 1, 'the explicit wire survives');
    assert.equal(c.wires[0].from.terminal, 'd13');
  });
});

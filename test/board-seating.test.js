/**
 * Board seating verification — MCU boards and generic DIP ICs sit
 * correctly on a breadboard and conduct through strips.
 *
 * Three checks per board:
 *   (a) Legs snap to holes with correct spacing (contiguous columns,
 *       correct row split across the gutter).
 *   (b) Connected-row visualization: rows in the same column share a
 *       strip, occupancy marks only the pin's row, free rows available.
 *   (c) Strip conduction: a component tapped into a free row of the
 *       same column as a chip pin shares a net with that pin.
 *       For MCU boards, this is driven end-to-end (setPin → LED → brightness).
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, resetIds } from '../src/model/circuit.js';
import { computeLeadMap } from '../src/model/footprints.js';
import { getSidecar } from '../src/model/parts-registry.js';

// ── Shared checks (a) and (b) ───────────────────────────────────────

function checkLegsSnap(kind, vcc, leadMap, sc) {
  // DIP straddles the gutter: top pin row is 'e', bottom is 'f' (directly
  // across the gutter), not 'j' (five rows down). The old mapping used
  // e/j; the corrected mapping uses e/f — matching how physical DIPs sit.
  const topLeads = Object.entries(leadMap).filter(([, h]) => h.startsWith('e'));
  const botLeads = Object.entries(leadMap).filter(([, h]) => h.startsWith('f'));

  it('(a) legs snap: contiguous columns, correct gutter split', () => {
    resetIds();
    const c = new Circuit(vcc);
    const bb = c.addPart('breadboard', {}, 0, 0);
    const board = c.addPart(kind, {}, 0, 0);
    c.seatPart(board.id, bb.id, leadMap);

    assert.ok(board.seat, 'part is seated');
    assert.equal(board.seat.boardId, bb.id);
    assert.ok(topLeads.length > 0, 'has top-block leads');
    assert.ok(botLeads.length > 0, 'has bottom-block leads');
    assert.equal(topLeads.length + botLeads.length, Object.keys(leadMap).length,
      'all leads in top or bottom block');

    const checkContiguous = (leads, label) => {
      const cols = leads.map(([, h]) => parseInt(h.slice(1))).sort((a, b) => a - b);
      for (let i = 1; i < cols.length; i++) {
        assert.equal(cols[i], cols[i - 1] + 1,
          `${label}: column gap at ${cols[i - 1]}→${cols[i]}`);
      }
      return cols;
    };
    const topCols = checkContiguous(topLeads, 'top');
    const botCols = checkContiguous(botLeads, 'bottom');
    assert.equal(topCols[0], botCols[0], 'top and bottom start at the same column');
    assert.equal(topCols[topCols.length - 1], botCols[botCols.length - 1],
      'top and bottom end at the same column');
    assert.equal(topCols.length, sc.footprint.minCols,
      `top columns match minCols (${sc.footprint.minCols})`);
  });
}

function checkStripVisualization(kind, vcc, leadMap, testPin) {
  it('(b) connected-row visualization: strip spans full block, only pin row occupied', () => {
    resetIds();
    const c = new Circuit(vcc);
    const bb = c.addPart('breadboard', {}, 0, 0);
    const board = c.addPart(kind, {}, 0, 0);
    c.seatPart(board.id, bb.id, leadMap);
    const bbModel = c.breadboards.get(bb.id);

    const hole = leadMap[testPin];
    assert.ok(hole, `pin ${testPin} exists in leadMap`);
    const col = parseInt(hole.slice(1));
    const pinRow = hole[0];
    const strip = bbModel.stripOf(hole);

    const blockRows = pinRow <= 'e' ? ['a', 'b', 'c', 'd', 'e'] : ['f', 'g', 'h', 'i', 'j'];
    const inStrip = blockRows.filter(r => bbModel.stripOf(r + col) === strip);
    assert.equal(inStrip.length, 5, `strip spans all 5 rows of the block (col ${col})`);

    const occupied = blockRows.filter(r => bbModel.occupantOf(r + col));
    const free = blockRows.filter(r => !bbModel.occupantOf(r + col));
    assert.equal(occupied.length, 1, `only one row occupied in col ${col}`);
    assert.equal(occupied[0], pinRow, `occupied row is the pin's row (${pinRow})`);
    assert.equal(free.length, 4, '4 free rows available for wiring');
  });
}

// ── MCU board: full solver conduction (setPin → LED → brightness) ───

function verifyBoard(kind, vcc, gpioPin, enginePinName) {
  describe(`${kind}: breadboard seating`, () => {
    const sc = getSidecar(kind);
    if (!sc || !sc.footprint || !sc.footprint.straddlesGutter) {
      it('needs a gutter-straddling footprint', { skip: 'sidecar has no straddling footprint' },
        () => {});
      return;
    }

    const leadMap = computeLeadMap(sc.footprint, 'e1');

    checkLegsSnap(kind, vcc, leadMap, sc);
    checkStripVisualization(kind, vcc, leadMap, gpioPin);

    it('(c) solver conduction: LED wired via shared strip lights from GPIO pin', () => {
      resetIds();
      const c = new Circuit(vcc);
      const bb = c.addPart('breadboard', {}, 0, 0);
      const bat = c.addPart('vsource', { volts: vcc }, 0, 0);
      c.addTapWire(bat.id, 'pos', bb.id, 't+2', '#f00');
      c.addTapWire(bat.id, 'neg', bb.id, 't-2', '#000');

      const board = c.addPart(kind, {}, 0, 0);
      c.seatPart(board.id, bb.id, leadMap);

      c.addHoleWire(bb.id, 't+1', 'b+1', '#f00');
      c.addHoleWire(bb.id, 't-1', 'b-1', '#000');

      const gndTerminals = Object.keys(leadMap).filter(t =>
        t === 'gnd' || t.startsWith('gnd_') || t === 'vss');
      assert.ok(gndTerminals.length > 0, 'board has a GND/VSS terminal');
      const gndHole = leadMap[gndTerminals[0]];
      const gndCol = parseInt(gndHole.slice(1));
      const gndRow = gndHole[0];
      c.addHoleWire(bb.id, (gndRow <= 'e' ? 'a' : 'f') + gndCol,
        (gndRow <= 'e' ? 't-' : 'b-') + gndCol, '#000');

      const gpioHole = leadMap[gpioPin];
      const gpioCol = parseInt(gpioHole.slice(1));
      const gpioRow = gpioHole[0];
      // The pin is on gpioRow; pick free rows in the same block that
      // are NOT the occupied row. For gutter-straddled DIPs the pin is
      // on 'e' (top) or 'f' (bottom), so pick 'a'/'b' or 'g'/'h'.
      const freeRow = gpioRow <= 'e' ? 'a' : 'g';
      const freeRow2 = gpioRow <= 'e' ? 'b' : 'h';
      const railPrefix = gpioRow <= 'e' ? 't' : 'b';

      const r = c.addPart('resistor', { ohms: 220 }, 0, 0);
      const led = c.addPart('led', {}, 0, 0);
      c.addTapWire(r.id, 'a', bb.id, freeRow + gpioCol, '#f00');
      c.addTapWire(r.id, 'b', bb.id, freeRow + '30', '#f00');
      c.addTapWire(led.id, 'anode', bb.id, freeRow2 + '30', '#f00');
      c.addTapWire(led.id, 'cathode', bb.id, freeRow2 + '32', '#000');
      c.addHoleWire(bb.id, freeRow + '32', railPrefix + '-32', '#000');

      c.board.setPin(enginePinName, 'pushpull', true);
      c.board.advanceTo(50_000_000n);

      const brightness = c.board.ledBrightness(led.id);
      assert.ok(brightness > 0.05,
        `LED brightness ${brightness.toFixed(4)} — GPIO ${enginePinName} conducts through strip`);

      const nets = c.board.getNets();
      const gpioNet = nets.find(n =>
        n.terminals.some(t => t.part === board.id && t.terminal === gpioPin));
      assert.ok(gpioNet, `GPIO pin ${gpioPin} is in a net`);
      assert.ok(gpioNet.terminals.some(t => t.part === r.id),
        `GPIO ${gpioPin} shares a net with the resistor (strip conducts)`);
    });
  });
}

// ── Generic DIP IC: net-topology conduction (no setPin needed) ──────

function verifyDIP(kind, vcc, testPin) {
  describe(`${kind}: breadboard seating`, () => {
    const sc = getSidecar(kind);
    if (!sc || !sc.footprint || !sc.footprint.straddlesGutter) {
      it('needs a gutter-straddling footprint', { skip: 'sidecar has no straddling footprint' },
        () => {});
      return;
    }

    const leadMap = computeLeadMap(sc.footprint, 'e1');

    checkLegsSnap(kind, vcc, leadMap, sc);
    checkStripVisualization(kind, vcc, leadMap, testPin);

    it('(c) strip conduction: tapped resistor shares net with chip pin', () => {
      resetIds();
      const c = new Circuit(vcc);
      const bb = c.addPart('breadboard', {}, 0, 0);
      const board = c.addPart(kind, {}, 0, 0);
      c.seatPart(board.id, bb.id, leadMap);

      // Tap a resistor into a free row of the test pin's column
      const pinHole = leadMap[testPin];
      const pinCol = parseInt(pinHole.slice(1));
      const pinRow = pinHole[0];
      const freeRow = pinRow <= 'e' ? 'a' : 'f';

      const r = c.addPart('resistor', { ohms: 1000 }, 0, 0);
      c.addTapWire(r.id, 'a', bb.id, freeRow + pinCol, '#f00');
      // Second terminal to a different column (just needs a connection)
      c.addTapWire(r.id, 'b', bb.id, freeRow + '40', '#f00');

      // The chip's pin and the resistor must share a net via the strip
      const nets = c.board.getNets();
      const pinNet = nets.find(n =>
        n.terminals.some(t => t.part === board.id && t.terminal === testPin));
      assert.ok(pinNet, `chip pin ${testPin} is in a net`);
      const hasResistor = pinNet.terminals.some(t => t.part === r.id);
      assert.ok(hasResistor,
        `pin ${testPin} shares a net with the resistor — strip conducts`);
    });
  });
}

// ── MCU boards ───────────────────────────────────────────────────────
verifyBoard('arduino_nano', 5.0, 'd2', 'D2');
verifyBoard('pi_pico', 3.3, 'gp0', 'GP0');
verifyBoard('attiny85', 5.0, 'pb0', 'PB0');

// ── Retro DIPs (6502 family) ────────────────────────────────────────
verifyDIP('w65c02', 5.0, 'a0');
verifyDIP('w65c22', 5.0, 'pa0');
verifyDIP('w65c51', 5.0, 'd0');
verifyDIP('28c256', 5.0, 'a0');
verifyDIP('62256', 5.0, 'a0');

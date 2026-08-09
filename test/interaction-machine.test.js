// The interaction core, tested as what it is: pure logic. Every scenario here
// is one of the owner's reported failures, encoded so it can never silently
// regress: selection must stick, drags must move, marquee must replace,
// wiring must commit terminal-to-terminal, trackpad wheel must PAN.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InteractionMachine } from '../src/interaction/machine.js';
import { createHitTest, partBounds } from '../src/interaction/hittest.js';
import { ViewTransform, classifyWheel } from '../src/interaction/transform.js';

// A tiny world: LED at (100,100) [40×50], resistor at (300,100) [64×20].
const makeWorld = () => {
  const parts = [
    { id: 'D1', kind: 'led', x: 100, y: 100, rotation: 0 },
    { id: 'R1', kind: 'resistor', x: 300, y: 100, rotation: 0 },
  ];
  const terminals = (part) => part.kind === 'led'
    ? [{ terminal: 'anode', x: part.x - 8, y: part.y + 25 }, { terminal: 'cathode', x: part.x + 8, y: part.y + 25 }]
    : [{ terminal: 'a', x: part.x - 32, y: part.y }, { terminal: 'b', x: part.x + 32, y: part.y }];
  const wires = [];
  const hit = createHitTest(() => parts, () => wires, terminals);

  const selection = new Set();
  const log = [];
  const cb = {
    select: (ids, mode) => {
      log.push(['select', ids, mode]);
      if (mode === 'replace') { selection.clear(); ids.forEach(i => selection.add(i)); }
      else if (mode === 'add') ids.forEach(i => selection.add(i));
      else ids.forEach(i => selection.has(i) ? selection.delete(i) : selection.add(i));
    },
    selectWire: (id, mode) => log.push(['selectWire', id, mode]),
    clearSelection: () => { log.push(['clear']); selection.clear(); },
    moveSelection: (dx, dy) => {
      log.push(['move', dx, dy]);
      for (const id of selection) { const part = parts.find(pp => pp.id === id); part.x += dx; part.y += dy; }
    },
    endMove: () => log.push(['endMove']),
    createWire: (from, to) => log.push(['wire', from, to]),
    wirePreview: () => {},
    clearWirePreview: () => log.push(['clearPreview']),
    marqueeRect: (r) => log.push(['marquee', r]),
  };
  const machine = new InteractionMachine(hit, cb, () => selection, (px) => px); // zoom 1
  return { parts, selection, log, machine };
};

test('a plain click on a part selects it — every time', () => {
  const { machine, selection } = makeWorld();
  for (let i = 0; i < 3; i++) {
    machine.down(100, 100, {});
    machine.up(100, 100, {});
    assert.deepEqual([...selection], ['D1'], `click ${i + 1} must select D1`);
  }
});

test('a jittery click (2px wobble) still selects, never drags', () => {
  const { machine, selection, log, parts } = makeWorld();
  machine.down(100, 100, {});
  machine.move(101, 101);
  machine.move(102, 100);
  machine.up(102, 100, {});
  assert.deepEqual([...selection], ['D1']);
  assert.ok(!log.some(e => e[0] === 'move'), 'no drag from sub-threshold wobble');
  assert.equal(parts[0].x, 100, 'part did not move');
});

test('press-and-drag moves the part by the pointer delta', () => {
  const { machine, parts, log } = makeWorld();
  machine.down(100, 100, {});
  for (let s = 1; s <= 10; s++) machine.move(100 + s * 20, 100 + s * 5);
  machine.up(300, 150, {});
  assert.equal(parts[0].x, 300, `x: ${parts[0].x}`);
  assert.equal(parts[0].y, 150, `y: ${parts[0].y}`);
  assert.ok(log.some(e => e[0] === 'endMove'), 'endMove fired for undo/snap');
});

test('dragging one selected part drags the whole selection', () => {
  const { machine, parts, selection } = makeWorld();
  selection.add('D1'); selection.add('R1');
  machine.down(100, 100, {});     // D1 is already selected: selection kept
  machine.move(150, 100);
  machine.up(150, 100, {});
  assert.equal(parts[0].x, 150, 'D1 moved');
  assert.equal(parts[1].x, 350, 'R1 moved WITH it');
});

test('shift-click toggles membership without dragging', () => {
  const { machine, selection } = makeWorld();
  machine.down(100, 100, { shiftKey: true }); machine.up(100, 100, { shiftKey: true });
  machine.down(300, 100, { shiftKey: true }); machine.up(300, 100, { shiftKey: true });
  assert.deepEqual([...selection].sort(), ['D1', 'R1']);
  machine.down(100, 100, { shiftKey: true }); machine.up(100, 100, { shiftKey: true });
  assert.deepEqual([...selection], ['R1'], 'second shift-click removed D1');
});

test('marquee REPLACES the selection and hits bounding boxes, not centres', () => {
  const { machine, selection } = makeWorld();
  selection.add('R1');
  // Sweep 60..130 × 60..130: covers D1's box, BRUSHES its left edge is enough;
  // R1 (at 300) is outside and must drop out because marquee replaces.
  machine.down(60, 60, {});
  machine.move(130, 130);
  machine.up(130, 130, {});
  assert.deepEqual([...selection], ['D1']);
  // Brush test: a marquee that only clips the LED's left edge (box 80..120)
  machine.down(60, 60, {});
  machine.move(85, 130);
  machine.up(85, 130, {});
  assert.deepEqual([...selection], ['D1'], 'edge brush selects via bbox intersection');
});

test('click on empty ground clears the selection', () => {
  const { machine, selection } = makeWorld();
  selection.add('D1');
  machine.down(500, 400, {});
  machine.up(500, 400, {});
  assert.equal(selection.size, 0);
});

test('wiring: terminal press → drag → terminal release commits exactly one wire', () => {
  const { machine, log } = makeWorld();
  machine.down(92, 125, {});            // D1 anode at (92,125)
  machine.move(200, 110);
  machine.up(268, 100, {});             // R1.a at (268,100)
  const wires = log.filter(e => e[0] === 'wire');
  assert.equal(wires.length, 1);
  assert.deepEqual(wires[0][1], { partId: 'D1', terminal: 'anode' });
  assert.deepEqual(wires[0][2], { partId: 'R1', terminal: 'a' });
});

test('wiring released on empty ground commits nothing', () => {
  const { machine, log } = makeWorld();
  machine.down(92, 125, {});
  machine.move(400, 300);
  machine.up(400, 300, {});
  assert.equal(log.filter(e => e[0] === 'wire').length, 0);
});

test('Esc mid-drag aborts cleanly and the next click still works', () => {
  const { machine, selection } = makeWorld();
  machine.down(100, 100, {});
  machine.move(150, 120);
  machine.cancel();
  machine.down(300, 100, {});
  machine.up(300, 100, {});
  assert.deepEqual([...selection], ['R1']);
});

test('transform: trackpad two-finger scroll PANS; pinch/ctrl-wheel zooms at cursor', () => {
  const t = new ViewTransform();
  const pan = classifyWheel({ deltaX: 30, deltaY: -20, ctrlKey: false, metaKey: false });
  assert.equal(pan.kind, 'pan');
  t.panByScreen(pan.dx, pan.dy);
  assert.equal(t.panX, -30);
  assert.equal(t.panY, 20);

  const zoom = classifyWheel({ deltaX: 0, deltaY: -100, ctrlKey: true, metaKey: false });
  assert.equal(zoom.kind, 'zoom');
  const anchorBefore = t.toWorld(700, 400);
  t.zoomAt(700, 400, zoom.factor);
  const anchorAfter = t.toWorld(700, 400);
  assert.ok(Math.abs(anchorBefore.x - anchorAfter.x) < 1e-9, 'cursor-anchored');
  assert.ok(t.zoom > 1, 'zoomed in');
});

test('transform round-trip and hit radii scale with zoom', () => {
  const t = new ViewTransform({ zoom: 2, panX: 50, panY: -20 });
  const w = t.toWorld(300, 200);
  const s = t.toScreen(w.x, w.y);
  assert.ok(Math.abs(s.x - 300) < 1e-9 && Math.abs(s.y - 200) < 1e-9);
  assert.equal(t.worldDistance(14), 7, 'a 14px target is 7 world units at 2x');
});

test('rotation-aware bounds: a rotated resistor swaps its box', () => {
  const b0 = partBounds({ kind: 'resistor', x: 0, y: 0, rotation: 0 });
  const b90 = partBounds({ kind: 'resistor', x: 0, y: 0, rotation: 90 });
  assert.equal(b0.maxX - b0.minX, 64);
  assert.equal(b90.maxX - b90.minX, 20);
  assert.equal(b90.maxY - b90.minY, 64);
});

test('placing: press-drag-release from the palette commits at the release point', () => {
  const { machine, log } = makeWorld();
  const placed = [];
  machine.cb.placeGhost = (g) => log.push(['ghost', g]);
  machine.cb.placePart = (kind, params, x, y) => placed.push({ kind, x, y });
  machine.cb.placingDone = () => log.push(['done']);
  machine.startPlacing('resistor', { ohms: 1000 });
  machine.move(400, 300);
  machine.up(420, 300, {});
  assert.equal(placed.length, 1);
  assert.equal(placed[0].kind, 'resistor');
  assert.equal(placed[0].x, 420);
  assert.equal(machine.state, 'idle');
});

test('placing: click-then-click flow — armed release does not commit, canvas click does', () => {
  const { machine } = makeWorld();
  const placed = [];
  machine.cb.placeGhost = () => {};
  machine.cb.placePart = (kind, params, x, y) => placed.push({ x, y });
  machine.cb.placingDone = () => {};
  machine.startPlacing('led', {});
  // The palette click's own release arrives with no movement: stays armed.
  machine.up(0, 0, {});
  assert.equal(placed.length, 0);
  assert.equal(machine.state, 'placing');
  machine.move(250, 250);
  machine.down(250, 250, {});
  assert.equal(placed.length, 1);
  assert.deepEqual([placed[0].x, placed[0].y], [250, 250]);
});

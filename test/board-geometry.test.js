import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  boardTerminalOffsets,
  boardVisualGeometry,
  layoutFloatingParts,
} from '../src/model/board-geometry.js';
import { partBounds } from '../src/interaction/hittest.js';

test('Arduino Uno face, terminals and hit bounds share physical geometry', () => {
  const geometry = boardVisualGeometry('arduino_uno');
  assert.ok(Math.abs(geometry.w - 400.05) < 0.1);
  assert.ok(Math.abs(geometry.h - 294) < 0.1);

  const pins = boardTerminalOffsets('arduino_uno');
  assert.ok(pins.aref.dx < pins.d13.dx, 'AREF is left of D13 on the real face');
  assert.ok(pins.d13.dx < pins.d0.dx, 'D13..D0 run left-to-right on the face');
  assert.ok(pins.d0.dy < 0 && pins.a0.dy > 0, 'digital and analog headers use opposite edges');

  const bounds = partBounds({ kind: 'arduino_uno', x: 300, y: 100 });
  assert.ok(Math.abs((bounds.maxX - bounds.minX) - geometry.w) < 0.01);
  assert.ok(Math.abs((bounds.maxY - bounds.minY) - geometry.h) < 0.01);
});

test('every declared controller terminal has a matching face endpoint', () => {
  for (const kind of ['arduino_uno', 'arduino_nano', 'arduino_mega', 'pi_pico']) {
    const sidecar = JSON.parse(readFileSync(new URL(`../src/parts-data/${kind}.json`, import.meta.url)));
    const offsets = boardTerminalOffsets(kind, sidecar);
    assert.deepEqual(sidecar.terminals.map(t => t.name).filter(name => !offsets[name]), [], kind);
  }
});

test('code-rendered Pico uses its physical envelope and breadboard header pitch', () => {
  const sidecar = { w: 60, h: 210, terminals: [{ name: 'gp0', x: 4, y: 16 }],
    footprint: {leads: {gp0: {dRow: 0, dCol: 0}, gp16: {dRow: 5, dCol: 19}}} };
  const geometry = boardVisualGeometry('pi_pico', sidecar);
  const pins = boardTerminalOffsets('pi_pico', sidecar);
  assert.ok(Math.abs(geometry.w - 281.1) < 0.1);
  assert.ok(Math.abs(geometry.h - 115.75) < 0.1);
  assert.equal(geometry.transpose, true);
  assert.deepEqual(pins.gp0, { dx: -133, dy: -35 });
});

test('floating layout uses centres and keeps a full Uno above the breadboard', () => {
  const parts = [
    { id: 'VCC', kind: 'vcc' },
    { id: 'GND', kind: 'gnd' },
    { id: 'MCU', kind: 'arduino_uno' },
  ];
  const positions = layoutFloatingParts(parts, kind =>
    kind === 'vcc' || kind === 'gnd' ? {w: 100, h: 100} : null,
  { boardTop: 175, gap: 40 });
  const bounds = parts.map(p => partBounds({ ...p, ...positions.get(p.id) }));
  for (let i = 1; i < bounds.length; i++) {
    assert.ok(bounds[i - 1].maxX + 39 < bounds[i].minX, 'adjacent bodies have a 40-unit gap');
  }
  assert.ok(bounds.every(b => b.maxY <= 135), 'every body clears the breadboard by 40 units');
});

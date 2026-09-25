/**
 * The MakeCode boards as circuit parts: Calliope mini, Circuit Playground
 * Express, PyBadge.
 *
 * A learner seats one of these in lite's circuit, wires a pad to an LED or a
 * button, and the MakeCode program running "on" the board drives it through
 * Boundary A — `board.setPin('p0', …)`, `board.readPin('a1')`. For that to be
 * true four things have to hold, and each is a section below:
 *
 *   1. the sidecar names the pads the way MakeCode does (p0, a1 …), with the
 *      functions MakeCode's own pin enums give them;
 *   2. the pads are where the face draws them — every terminal offset finite
 *      and on a pad ring of the copied art (PyBadge's were NaN until now);
 *   3. the kind reaches the engine: a passthrough, so it is never rejected,
 *      keeping its identity when bw-board registers it;
 *   4. through the whole designer model, setPin on the board's pad lights an
 *      LED at 3.3 V logic and readPin sees a button — measured, not mocked.
 *
 * Section 4 needs a bw-board that registers these kinds (bw-board PR #44).
 * Against an older pin it SKIPS by name, saying so; it never passes vacuously.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Circuit } from '../src/model/circuit.js';
import { getSidecar } from '../src/model/parts-registry.js';
import { boardTerminalOffsets, boardVisualGeometry, MAKECODE_FACE_KINDS } from '../src/model/board-geometry.js';
import { getEngine } from '../src/engine.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const pads = (kind) => getSidecar(kind).terminals.map(t => t.name);
const fn = (kind, pad) => getSidecar(kind).terminals.find(t => t.name === pad).functions;

// ─── 1. Names and functions ──────────────────────────────────────────────

describe('pad names are MakeCode pin names, lowercased', () => {
  it('calliopemini: the six ring pads', () => {
    assert.deepEqual(pads('calliopemini'), ['p0', 'p1', 'p2', 'p3', '3v', 'gnd']);
  });
  it('calliopemini: pxt-calliope AnalogPin is P1/P2 only; all four pads are touch', () => {
    for (const p of ['p1', 'p2']) assert.deepEqual(fn('calliopemini', p), ['gpio', 'adc', 'pwm', 'touch']);
    for (const p of ['p0', 'p3']) assert.deepEqual(fn('calliopemini', p), ['gpio', 'touch']);
    assert.deepEqual(fn('calliopemini', '3v'), []);
  });
  it('circuit_playground_express: the 14 alligator pads', () => {
    assert.deepEqual(pads('circuit_playground_express'), [
      'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7',
      '3v3', '3v3_2', 'gnd', 'gnd2', 'gnd3', 'vout',
    ]);
    assert.ok(fn('circuit_playground_express', 'a0').includes('dac'), 'A0 is the true analog out');
    assert.ok(!fn('circuit_playground_express', 'a0').includes('touch'), 'A0 is not a touch pad');
    for (const p of ['a1', 'a2']) assert.ok(fn('circuit_playground_express', p).includes('pwm'));
    for (let n = 1; n <= 7; n++) assert.ok(fn('circuit_playground_express', `a${n}`).includes('touch'));
  });
  it('pybadge keeps its Feather/STEMMA terminals', () => {
    for (const p of ['3v3', 'gnd', 'a0', 'd2', 'd13', 'sda', 'stemma_sda', 'usb']) {
      assert.ok(pads('pybadge').includes(p), `missing ${p}`);
    }
  });
  it('when the engine models a board, the sidecar and the engine name the same pads', (t) => {
    // circuit.js asks the ENGINE for terminals first, so a disagreement would
    // silently rename pads under every saved circuit.
    const { getDevice } = getEngine();
    let compared = 0;
    for (const kind of [...MAKECODE_FACE_KINDS, 'pybadge']) {
      const model = getDevice(kind);
      if (!model) continue;
      assert.deepEqual([...model.terminals], pads(kind), kind);
      compared++;
    }
    if (compared === 0) t.skip('the pinned bw-board registers none of these kinds yet (bw-board PR #44)');
  });
});

// ─── 2. Pads where the face draws them ───────────────────────────────────

describe('terminals land on the face', () => {
  for (const kind of [...MAKECODE_FACE_KINDS, 'pybadge', 'tang_nano_20k']) {
    it(`${kind}: every terminal offset is a finite point inside the board`, () => {
      const sc = getSidecar(kind);
      const g = boardVisualGeometry(kind, sc);
      const offsets = boardTerminalOffsets(kind, sc);
      assert.equal(Object.keys(offsets).length, sc.terminals.length);
      for (const [name, p] of Object.entries(offsets)) {
        assert.ok(Number.isFinite(p.dx) && Number.isFinite(p.dy), `${kind}.${name} at (${p.dx}, ${p.dy})`);
        assert.ok(Math.abs(p.dx) <= g.w / 2 + 1 && Math.abs(p.dy) <= g.h / 2 + 1,
          `${kind}.${name} (${p.dx.toFixed(1)}, ${p.dy.toFixed(1)}) is off a ${g.w.toFixed(0)}x${g.h.toFixed(0)} board`);
      }
    });
  }

  it('calliopemini: each terminal is the centre of its named pad ring in the art file', () => {
    // Derived from the SVG itself, not from the numbers the sidecar was made
    // with: each EDGE_* ring is drawn as `M cx,top c-18.5,0-33.5,15-33.5,33.5…`,
    // a 33.5-radius circle starting at its top, so its centre is (cx, top+33.5).
    const svg = read('../src/parts-data/calliopemini.svg');
    const ring = { p0: 'EDGE_P0', p1: 'EDGE_P1', p2: 'EDGE_P2', p3: 'EDGE_P3', '3v': 'EDGE_VCC', gnd: 'EDGE_GND' };
    const sc = getSidecar('calliopemini');
    for (const [pad, id] of Object.entries(ring)) {
      const m = svg.match(new RegExp(`id="${id}"[^>]*d="M([\\d.]+),([\\d.]+)c-18\\.5,0-33\\.5,15-33\\.5,33\\.5`));
      assert.ok(m, `no ring path ${id} in the art`);
      const cx = Number(m[1]), cy = Number(m[2]) + 33.5;
      const t = sc.terminals.find(x => x.name === pad);
      // Sidecar space is the art's, from the widened viewBox origin (-26, 9), x0.2.
      assert.ok(Math.abs(t.x - (cx + 26) * 0.2) < 0.06 && Math.abs(t.y - (cy - 9) * 0.2) < 0.06,
        `${pad}: sidecar (${t.x}, ${t.y}) vs ring centre (${((cx + 26) * 0.2).toFixed(2)}, ${((cy - 9) * 0.2).toFixed(2)})`);
    }
    assert.match(svg, /viewBox="-26 9 581 511"/, 'the transform above assumes this viewBox');
  });

  it('circuit_playground_express: every pad sits on the rim of the round board', () => {
    // The CPX is a disc and its pads ring the edge: in art units (180 wide,
    // centre ~(90, 89.6), rim ~90) every pad centre is 80..86 from the middle —
    // measured 81.7..84.7; the next ring inwards (the NeoPixels) is at ~60.
    const sc = getSidecar('circuit_playground_express');
    const s = 0.62;
    for (const t of sc.terminals) {
      const r = Math.hypot(t.x / s - 90.05, t.y / s - 89.6);
      assert.ok(r > 80 && r < 86, `${t.name} is ${r.toFixed(1)} art units from the centre`);
    }
    assert.match(read('../src/parts-data/circuit_playground_express.svg'), /viewBox="0 0 180\.094 179\.229"/);
  });
});

// ─── Faces, provenance, palette ──────────────────────────────────────────

describe('faces are the copied MIT art, with provenance', () => {
  const provenance = read('../src/parts-data/ART-PROVENANCE.md');
  const notices = read('../src/parts-data/THIRD-PARTY.md');
  const sync = read('../scripts/sync-parts-data.mjs');
  const files = { calliopemini: 'pxt-calliope 3.0.30', circuit_playground_express: 'pxt-adafruit 1.6.8' };
  for (const [kind, source] of Object.entries(files)) {
    it(`${kind}.svg names its source and licence, and the provenance files record it`, () => {
      const svg = read(`../src/parts-data/${kind}.svg`);
      assert.ok(svg.startsWith(`<!-- `) && svg.includes(source) && svg.includes('MIT'), `${kind}.svg header`);
      assert.ok(provenance.includes(`\`${kind}.svg\``) && provenance.includes(source.split(' ')[0]));
      assert.ok(notices.includes(`\`${kind}.svg\``) && notices.includes('Permission is hereby granted'));
      // The stale sweep must not delete a part bw-parts does not carry.
      assert.ok(sync.includes(`'${kind}.json'`) && sync.includes(`'${kind}.svg'`), `${kind} is LOCAL_ONLY`);
    });
  }
  it('the provenance survives a sync: the local tail is behind the marker the sync keeps', () => {
    const marker = sync.match(/LOCAL_PROVENANCE_MARKER = '([^']+)'/)[1];
    const at = provenance.indexOf(marker);
    assert.ok(at > 0 && provenance.indexOf('calliopemini.svg', at) > at, 'ART-PROVENANCE tail');
    assert.ok(notices.indexOf(marker) > 0, 'THIRD-PARTY tail');
  });
  it('the canvas and the palette draw them from those files', () => {
    const canvas = read('../src/components/BoardCanvas.jsx');
    const thumb = read('../src/components/PartThumbnail.jsx');
    const palette = read('../src/components/PartPalette.jsx');
    for (const kind of MAKECODE_FACE_KINDS) {
      assert.ok(canvas.includes(`'../parts-data/${kind}.svg'`) && thumb.includes(`'../parts-data/${kind}.svg'`));
      assert.ok(canvas.includes(`case '${kind}':`));
      assert.match(palette, new RegExp(`kind: '${kind}'`));
    }
  });
});

// ─── 3 + 4. Through the designer model to the engine ─────────────────────

/** calliope/CPX/pybadge pad → 220 R → LED → the board's own ground pad. */
function ledBench(kind, pad, gnd) {
  const c = new Circuit(5.0);   // the designer's default board voltage
  const u = c.addPart(kind, {}, 0, 0);
  const r = c.addPart('resistor', { ohms: 220 }, 200, 0);
  const d = c.addPart('led', { vf: 2.0, color: 'red' }, 300, 0);
  c.addWire(u.id, pad, r.id, 'a');
  c.addWire(r.id, 'b', d.id, 'anode');
  c.addWire(d.id, 'cathode', u.id, gnd);
  return { c, u, r, d };
}

const BENCHES = [
  ['calliopemini', 'p0', 'p1', '3v', 'gnd'],
  ['circuit_playground_express', 'a1', 'a2', '3v3', 'gnd'],
  ['pybadge', 'd13', 'a0', '3v3', 'gnd'],
];

describe('a seated MakeCode board reaches the engine', () => {
  for (const [kind] of BENCHES) {
    it(`${kind}: the netlist is accepted and the part keeps its terminals`, () => {
      const { c, u } = ledBench(kind, BENCHES.find(b => b[0] === kind)[1], 'gnd');
      assert.deepEqual(u.terminals, pads(kind));
      assert.ok(c.wires.length === 3, 'all three wires stuck');
      // The engine must see an MCU SURFACE: the registered board model, or —
      // on an engine without one — the generic 'mcu' passthrough. Anything else
      // is a kind the engine does not know, whose pins setPin never reaches.
      const enginePart = c.board.parts.find(p => p.id === u.id);
      assert.ok(enginePart, `${kind} never reached the engine: the netlist it was given has no such part`);
      const engineKind = enginePart.kind;
      if (getEngine().getDevice(kind)) assert.equal(engineKind, kind);
      else assert.equal(engineKind, 'mcu', `${kind} reached the engine as '${engineKind}'`);
    });
  }

  for (const [kind, out, inp, v3, gnd] of BENCHES) {
    it(`${kind}: setPin('${out}') lights an LED at 3.3 V; readPin('${inp}') sees a button`, (t) => {
      if (!getEngine().getDevice(kind)) {
        t.skip(`the pinned bw-board has no '${kind}' model, so it runs as the generic 'mcu' surface (bw-board PR #44)`);
        return;
      }
      const { c, r, d } = ledBench(kind, out, gnd);
      c.board.setPin(out.toUpperCase(), 'pushpull', true);
      const vPad = c.board.nodeVoltage(c.board.nets.find(n => n.terminals.some(x => x.part === r.id && x.terminal === 'a')).id);
      const vAnode = c.board.nodeVoltage(c.board.nets.find(n => n.terminals.some(x => x.part === d.id && x.terminal === 'anode')).id);
      const mA = (vPad - vAnode) / 220 * 1000;
      // A 3.3 V pin behind 25 R. On the 'mcu' fallback this pad would sit at
      // 5 V — or, wired to the board's own GND pad, carry nothing at all.
      assert.ok(Math.abs(vPad - (3.3 - 0.025 * mA)) < 0.01, `${kind}.${out} pad ${vPad.toFixed(3)} V at ${mA.toFixed(2)} mA`);
      assert.ok(mA > 4 && mA < 7, `${mA.toFixed(2)} mA through 220 R`);
      assert.ok(c.board.ledBrightness(d.id) > 0.1, 'the LED lights');
      c.board.setPin(out, 'pushpull', false);
      assert.equal(c.board.ledBrightness(d.id), 0);

      // Button from the board's 3V pad to `inp`, 10 k pull-down to its GND pad.
      const b = c.addPart('button', {}, 0, 200);
      const pd = c.addPart('resistor', { ohms: 10000 }, 100, 200);
      const u = c.parts.find(p => p.kind === kind);
      c.addWire(u.id, v3, b.id, 'a');
      c.addWire(b.id, 'b', u.id, inp);
      c.addWire(u.id, inp, pd.id, 'a');
      c.addWire(pd.id, 'b', u.id, gnd);
      c.board.setPin(inp, 'input', false);
      assert.equal(c.board.readPin(inp), 0, 'released: the pull-down holds it low');
      c.board.setControl(b.id, 1);
      assert.equal(c.board.readPin(inp.toUpperCase()), 1, 'pressed: the 3V pad pulls it high');
    });
  }
});

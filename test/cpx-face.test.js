import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CPX_FACE, cpxPixelFill} from '../src/model/cpx-face.js';
import {circuitToDeclarations} from '../src/model/declarations.js';

test('each indexed pixel lies on its own LED path in the original board art', () => {
  const art = readFileSync(new URL('../src/parts-data/circuit_playground_express.svg', import.meta.url), 'utf8');
  for (let i = 0; i < 10; i++) {
    // The source has a translated group per LED and two diametric arcs.
    // Derive its centre from the first arc's endpoint, independently of our
    // face table. An index swap must fail even with all pixels the same colour.
    const match = art.match(new RegExp(`<g[^>]*transform="translate\\((-?\\d+(?:\\.\\d+)?) (-?\\d+(?:\\.\\d+)?)\\)"><path d="M0 0a[^"]*? 0 1 0\\s*(-?\\d+(?:\\.\\d+)?)[ ,]*(-?\\d+(?:\\.\\d+)?)[^"]*" id="LED${i}"`));
    assert.ok(match, `Original LED${i} path`);
    const [, x, y, dx, dy] = match.map(Number);
    assert.ok(Math.abs(CPX_FACE.pixels[i].x - (x + dx / 2) * 1.25) < 0.002, `LED${i} x`);
    assert.ok(Math.abs(CPX_FACE.pixels[i].y - (179.229 - (y + dy / 2) * 1.25)) < 0.002, `LED${i} y`);
  }
});

test('display colours consume emitted channels without applying brightness twice', () => {
  assert.equal(cpxPixelFill(0xff0000), 'rgb(255, 0, 0)');
  assert.equal(cpxPixelFill(0x00ff00), 'rgb(0, 255, 0)');
  assert.equal(cpxPixelFill(0x0000ff), 'rgb(0, 0, 255)');
  assert.equal(cpxPixelFill(0x0f0000), 'rgb(70, 0, 0)');
  assert.equal(cpxPixelFill(), 'rgb(0, 0, 0)');
});

test('a CPX circuit identifies DEVICE CPX while preserving other board inference', () => {
  assert.equal(circuitToDeclarations([{id: 'cpx', kind: 'circuit_playground_express'}], []).device, 'cpx');
  assert.equal(circuitToDeclarations([{id: 'uno', kind: 'arduino_uno'}], []).device, 'arduino-uno');
  assert.equal(circuitToDeclarations([{id: 'pico', kind: 'pi_pico'}], []).device, 'pico');
  assert.deepEqual(circuitToDeclarations([], []), {pins: [], ports: [], parts: []});
});

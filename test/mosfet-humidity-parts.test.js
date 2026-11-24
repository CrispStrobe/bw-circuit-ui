/**
 * The depletion-mode dual-gate MOSFET and the salt-film humidity comb are
 * placeable, seatable, wireable and learner-controllable, on the same
 * surfaces as the sensing transducers (sidecar footprints, art, palette,
 * tooltip readouts, a stimulus slider for the humidity).
 *
 * Like sensing-transducer-parts.test.js this file does NOT import ./_setup.js:
 * it loads the way a headless gate does and reads the sidecars from disk to
 * hold the built-in copies equal to them.
 */
import { setEngine } from '../src/engine.js';
import { BoardImpl } from 'bw-board/board.js';
import { inferNetlist, checkWiring } from 'bw-board/infer-netlist.js';
import { getDevice } from 'bw-board/devices.js';
import { registerAllDevices } from 'bw-board/register-all.js';
import { getMaxCurrent, PORT_LIMITS } from 'bw-board/current-ratings.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Circuit, terminalsForKind } from '../src/model/circuit.js';
import { FOOTPRINTS } from '../src/model/footprints.js';
import { ART_FACE_KINDS } from '../src/model/part-art.js';
import { PALETTE_DE } from '../src/i18n/palette-de.js';
import { t } from '../src/i18n/strings.js';

registerAllDevices();
setEngine({ BoardImpl, inferNetlist, checkWiring, getMaxCurrent, PORT_LIMITS, getDevice });

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(here, '..', rel), 'utf8');
const sidecar = (kind) => JSON.parse(read(`src/parts-data/${kind}.json`));
const CANVAS = read('src/components/BoardCanvas.jsx');
const PALETTE = read('src/components/PartPalette.jsx');
const STIMULI = read('src/components/StimulusControls.jsx');
const TOOLTIP = read('src/components/PartTooltip.jsx');

const KINDS = {
  dual_gate_mosfet: ['drain', 'gate2', 'gate1', 'source'],
  humidity_comb: ['a', 'b'],
};

test('every new kind: built-in footprint equal to its sidecar, engine terminal names, an engine device', () => {
  for (const [kind, terms] of Object.entries(KINDS)) {
    const sc = sidecar(kind);
    assert.deepEqual(FOOTPRINTS[kind]?.leads, sc.footprint.leads, `${kind} leads`);
    assert.equal(FOOTPRINTS[kind].refTerminal, sc.footprint.refTerminal, `${kind} refTerminal`);
    assert.deepEqual(terminalsForKind(kind, {}), terms, kind);
    assert.deepEqual(sc.terminals.map((x) => x.name), terms, `${kind} sidecar`);
    assert.ok(getDevice(kind), `${kind}: bw-board models it`);
    assert.ok(ART_FACE_KINDS.includes(kind), `${kind}: drawn with its art`);
    assert.match(PALETTE, new RegExp(`kind: '${kind}'`), `${kind}: in the palette`);
    assert.match(TOOLTIP, new RegExp(`case '${kind}':`), `${kind}: tooltip readout`);
  }
  const body = CANVAS.slice(CANVAS.indexOf('function terminalOffsetsForPart'), CANVAS.indexOf('function terminalPos'));
  for (const kind of Object.keys(KINDS)) assert.match(body, new RegExp(`case '${kind}':`), `${kind}: canvas pins from the sidecar`);
  for (const label of ['Humidity comb', 'Dual-gate MOSFET']) assert.ok(PALETTE_DE[label], `${label}: German palette label`);
  assert.match(STIMULI, /param="humidity"/, 'humidity slider in the stimulus panel');
  assert.equal(t('stimHumidity', 'de'), 'Feuchte');
});

/** A seated bench: 9 V, comb from +9 V to the gate, 1 MΩ gate to ground, LED + 470 Ω in the drain. */
function breathBench() {
  const seat = (id, kind, params, leadMap) => ({ id, kind, params, x: 0, y: 0, rotation: 0, seat: { boardId: 'bb1', leadMap } });
  return Circuit.fromJSON({
    vcc: 9,
    parts: [
      { id: 'bb1', kind: 'breadboard', params: {}, terminals: [], x: 0, y: 0, rotation: 0 },
      seat('hc', 'humidity_comb', { humidity: 50 }, { a: 'a10', b: 'a12' }),
      seat('rg', 'resistor', { ohms: 1e6 }, { a: 'b12', b: 'b14' }),
      seat('q', 'dual_gate_mosfet', { vp: -1.2, k: 0.005 }, { drain: 'a20', gate2: 'a21', gate1: 'a22', source: 'a23' }),
      seat('rs', 'resistor', { ohms: 10000 }, { a: 'b23', b: 'b26' }),
      seat('rd', 'resistor', { ohms: 470 }, { a: 'b20', b: 'b17' }),
      { id: 'led', kind: 'led', params: { color: 'red' }, x: 0, y: 0, rotation: 0 },
      { id: 'v', kind: 'vsource', params: { volts: 9 }, x: 0, y: 0, rotation: 0 },
      { id: 'g', kind: 'gnd', params: {}, x: 0, y: 0, rotation: 0 },
    ],
    wires: [
      { from: { part: 'v', terminal: 'pos' }, to: { part: 'hc', terminal: 'a' } },
      { from: { part: 'v', terminal: 'pos' }, to: { part: 'led', terminal: 'anode' } },
      { from: { part: 'led', terminal: 'cathode' }, to: { part: 'rd', terminal: 'b' } },
      { from: { part: 'hc', terminal: 'b' }, to: { part: 'q', terminal: 'gate1' } },
      { from: { part: 'q', terminal: 'gate2' }, to: { part: 'v', terminal: 'pos' } },
      { from: { part: 'g', terminal: 'gnd' }, to: { part: 'rg', terminal: 'b' } },
      { from: { part: 'g', terminal: 'gnd' }, to: { part: 'rs', terminal: 'b' } },
      { from: { part: 'g', terminal: 'gnd' }, to: { part: 'v', terminal: 'neg' } },
    ],
  });
}

test('seated: breath on the comb raises the gate and the dual-gate MOSFET lights its LED', () => {
  const c = breathBench();
  c.board.setPower(true);
  const ledMa = () => Math.abs(c.board.branchCurrent('led', 'anode')) * 1000;
  // 50 % RH: 10 MΩ against 1 MΩ, the gate near 0.8 V; the 10 kΩ source
  // resistor lets the source rise until the channel is nearly pinched off
  // (about 0.18 mA). Breath (90 % RH, a few kΩ) puts the gate at the rail.
  const dry = ledMa();
  c.parts.find((p) => p.id === 'hc').params.humidity = 90;
  c.board.setControl('v', 9);
  const breath = ledMa();
  assert.ok(dry < 0.25 && breath > 0.6 && breath > 3.5 * dry, `breath lights the LED: ${dry.toFixed(3)} -> ${breath.toFixed(3)} mA`);
  const s = c.board.getDeviceState('hc');
  assert.equal(Math.round(s.humidityPct), 90);
});

import './_setup.js';
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {build} from 'vite';
import react from '@vitejs/plugin-react';
import {Circuit} from '../src/model/circuit.js';
import {switchClosed, toggleSwitch} from '../src/model/switch-controls.js';
import {createCp1Adapter} from 'bw-board/cp1-adapter.js';

const root = fileURLToPath(new URL('..', import.meta.url));
let temporary, SwitchControls, renderSwitchControls, renderStimulusControls;

before(async () => {
  const cache = join(root, 'node_modules/.cache');
  mkdirSync(cache, {recursive: true});
  temporary = mkdtempSync(join(cache, 'switch-controls-'));
  const entry = join(temporary, 'entry.mjs');
  writeFileSync(entry, `
    import React from 'react';
    import {renderToStaticMarkup} from 'react-dom/server';
    import {SwitchControls} from ${JSON.stringify(join(root, 'src/components/SwitchControls.jsx'))};
    import {StimulusControls} from ${JSON.stringify(join(root, 'src/components/StimulusControls.jsx'))};
    export {SwitchControls};
    export const renderSwitchControls = props => renderToStaticMarkup(React.createElement(SwitchControls, props));
    export const renderStimulusControls = props => renderToStaticMarkup(React.createElement(StimulusControls, props));
  `);
  const out = join(temporary, 'built');
  await build({root, configFile: false, logLevel: 'error', plugins: [react()],
    build: {ssr: entry, outDir: out, emptyOutDir: true,
      rolldownOptions: {output: {entryFileNames: 'controls.mjs'}}}});
  ({SwitchControls, renderSwitchControls, renderStimulusControls} = await import(pathToFileURL(join(out, 'controls.mjs')).href));
});
after(() => { if (temporary) rmSync(temporary, {recursive: true, force: true}); });

const part = (id = 'contact', closed = 1) => ({id, kind: 'switch', declName: id, params: {closed}});
const elements = node => {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object') return [];
  return [node, ...elements(node.props?.children)];
};
const buttonFor = (tree, id) => elements(tree).find(node => node.type === 'button' && node.props['data-switch-control'] === id);

function echoBench() {
  const circuit = Circuit.fromJSON({vcc: 5, parts: [
    {id: 'cp1', kind: 'kosmos-cp1', params: {expansion: false}, x: 0, y: 0},
    {...part(), x: 200, y: 0},
    {id: 'pullup', kind: 'resistor', params: {ohms: 10000}, x: 200, y: 100},
    {id: 'series', kind: 'resistor', params: {ohms: 1000}, x: 200, y: 200},
    {id: 'lamp', kind: 'led', params: {vf: 2}, x: 200, y: 300},
  ], wires: [
    ['cp1', '5v', 'pullup', 'a'], ['pullup', 'b', 'cp1', 'P1.0'],
    ['cp1', 'P1.0', 'contact', 'a'], ['contact', 'b', 'cp1', 'gnd'],
    ['cp1', 'P2.0', 'series', 'a'], ['series', 'b', 'lamp', 'anode'],
    ['lamp', 'cathode', 'cp1', 'gnd'],
  ].map(([from, fromTerminal, to, toTerminal], n) => ({id: `w${n}`, from: {part: from, terminal: fromTerminal}, to: {part: to, terminal: toTerminal}}))});
  // Original short electrical stimulus. The CPU reads P1 and writes base PB;
  // it does not interpret CP1 teaching commands or include a historical ROM.
  const rom = new Uint8Array(2048);
  rom.set([0x23, 0xaf, 0x3a, 0xb8, 0, 0x23, 0x0f, 0x90, 0xb8, 2, 0x09, 0x90, 0x04, 0x0a]);
  const adapter = createCp1Adapter({rom, partId: 'cp1'});
  adapter.attachBoard(circuit.board);
  adapter.advanceNs(100000);
  return {circuit, adapter};
}

test('switch readback uses the active board and authored numeric/boolean defaults without truthy strings', () => {
  assert.equal(switchClosed(part('sw', 1)), true);
  assert.equal(switchClosed(part('sw', true)), true);
  assert.equal(switchClosed(part('sw', 0)), false);
  assert.equal(switchClosed(part('sw', false)), false);
  assert.equal(switchClosed(part('sw', 'false')), false);
  assert.equal(switchClosed(part('sw', 1), {getControl: () => 0}), false);
  assert.equal(switchClosed(part('sw', 0), {getControl: () => 1}), true);
  assert.equal(switchClosed({id: 'sw', kind: 'switch', params: {pressed: 1}}), true);
});

test('actual control component click changes the solved input and waits for CPU execution before changing the LED', () => {
  const {circuit, adapter} = echoBench();
  const contact = circuit.parts.find(item => item.id === 'contact');
  const props = {parts: [contact], board: circuit.board, onControlChange: (id, value) => circuit.setControl(id, value)};
  const button = buttonFor(SwitchControls(props), 'contact');
  assert.equal(button.props.type, 'button', 'native button supports Enter and Space in the browser');
  assert.equal(button.props['aria-pressed'], true);
  assert.equal(adapter.machine.getPortState(2).latch, 254);
  assert.equal(circuit.board.ledBrightnessNow('lamp'), 0);
  const pausedCycles = adapter.machine.cycles;
  const pausedTime = adapter.timeNs();
  button.props.onClick();
  assert.equal(circuit.board.getControl('contact'), 0);
  assert.equal(circuit.board.readPin('cp1.P1.0'), 1);
  assert.equal(adapter.machine.cycles, pausedCycles);
  assert.equal(adapter.timeNs(), pausedTime);
  assert.equal(adapter.machine.getPortState(2).latch, 254);
  assert.equal(circuit.board.ledBrightnessNow('lamp'), 0);
  assert.equal(buttonFor(SwitchControls(props), 'contact').props['aria-pressed'], false);
  adapter.advanceNs(100000);
  assert.equal(adapter.machine.getPortState(2).latch, 255);
  assert.ok(-circuit.board.branchCurrent('lamp', 'anode') > 0.001);
  assert.ok(circuit.board.ledBrightnessNow('lamp') > 0.01);
  assert.equal(contact.params.closed, 1, 'runtime contact state does not overwrite the authored circuit default');
});

test('repeated activation reads the live switch again, even before a React rerender', () => {
  const {circuit} = echoBench();
  const contact = circuit.parts.find(item => item.id === 'contact');
  const writes = [];
  const button = buttonFor(SwitchControls({parts: [contact], board: circuit.board,
    onControlChange: (id, value) => { writes.push([id, value]); circuit.setControl(id, value); }}), 'contact');
  button.props.onClick();
  button.props.onClick();
  assert.deepEqual(writes, [['contact', 0], ['contact', 1]]);
  assert.equal(circuit.board.getControl('contact'), 1);
  assert.equal(toggleSwitch({...contact, kind: 'button'}, circuit.board, () => assert.fail('wrong kind')), undefined);
});

test('eight accessible live controls render in English and German and preserve their exact part identities', () => {
  const parts = Array.from({length: 8}, (_, i) => ({...part(`switch${i + 1}`), declName: `S${i + 1} (${1 << i})`}));
  const board = {getControl: id => id === 'switch1' ? 0 : 1};
  const en = renderSwitchControls({parts, board, onControlChange() {}});
  const de = renderSwitchControls({parts, board, onControlChange() {}, lang: 'de'});
  assert.equal((en.match(/data-switch-control=/g) || []).length, 8);
  assert.match(en, /aria-label="S1 \(1\): Open"/);
  assert.match(en, /aria-label="S8 \(128\): Closed"/);
  assert.match(de, /aria-label="S1 \(1\): Offen"/);
  assert.match(de, /aria-label="S8 \(128\): Geschlossen"/);
  assert.match(renderSwitchControls({parts: [part()]}), /disabled=""/);
});

test('the existing stimulus panel reaches switches alone and retains sensor controls beside them', () => {
  const props = {parts: [part()], onControlChange() {}, onSetParam() {}};
  assert.match(renderStimulusControls(props), /data-switch-control="contact"/);
  const mixed = renderStimulusControls({...props, parts: [...props.parts, {id: 'motion', kind: 'pir', params: {}}]});
  assert.match(mixed, /data-switch-control="contact"/);
  assert.match(mixed, /data-stim-motion="motion"/);
  assert.equal(renderStimulusControls({parts: [], onSetParam() {}}), '');
});

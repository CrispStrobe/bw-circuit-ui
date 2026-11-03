/**
 * German for the design-rule check, the engine warnings beside it, the canvas
 * notes and the debugger dock.
 *
 * The coverage gate: every rule and every message id that model/drc.js can
 * emit has a German entry in src/i18n/drc-de.js. A new rule without German
 * fails here instead of showing English to a German user. English is left
 * exactly as it was: localizeDrcWarning(w, 'en') returns the very object.
 */
import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Circuit, resetIds } from '../src/model/circuit.js';
import { runDrc } from '../src/model/drc.js';
import { buildSeatedFromDeclarations } from '../src/model/infer-seated.js';
import { inferCircuit } from '../src/model/inference.js';
import { DRC_DE, ENGINE_DE, DRC_BADGE_DE, localizeDrcWarning, engineMessageDe } from '../src/i18n/drc-de.js';
import { canvasNoteDe } from '../src/i18n/canvas-notes-de.js';
import { summariseSeverities } from '../src/components/drc-severity.js';
import { t } from '../src/i18n/strings.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = file => readFileSync(join(here, '..', file), 'utf8');
const drcSource = read('src/model/drc.js');
// \x27 is the quote: a bare one in a regex literal unbalances the vacuity scanner.
const literals = (re) => [...new Set([...drcSource.matchAll(re)].map(m => m[1]))];
const RULES = literals(/\brule:\s*\x27([a-z0-9-]+)\x27/g);
const MSGS = literals(/\bmsg:\s*\x27([a-z0-9/-]+)\x27/g);

// Any argument a template asks for comes back as a word; arrays and flags too.
const anyArgs = new Proxy({}, {
  get: (_, key) => (['missing', 'unrated', 'top'].includes(key) ? [] : key === 'driver' || key === 'atLeast' ? true : `‹${String(key)}›`),
});

test('every DRC rule in drc.js has German', () => {
  assert.ok(RULES.length >= 20, `found ${RULES.length} rules`);
  const keys = Object.keys(DRC_DE);
  const missing = RULES.filter(rule => !keys.some(k => k === rule || k.startsWith(`${rule}/`)));
  assert.deepEqual(missing, [], 'DRC rules without a German entry in src/i18n/drc-de.js');
});

test('every DRC message id in drc.js has German, and every push carries one', () => {
  assert.ok(MSGS.length >= 20, `found ${MSGS.length} message ids`);
  assert.deepEqual(MSGS.filter(m => !DRC_DE[m]), [], 'message ids without German');
  const pushes = drcSource.split('warnings.push(').length - 1;
  const ids = drcSource.split(/\bmsg:\s/).length - 1;
  assert.equal(ids, pushes, 'a warnings.push without a msg id cannot be worded in German');
});

test('every German DRC text renders without holes', () => {
  for (const [id, entry] of Object.entries(DRC_DE)) {
    for (const part of ['explanation', 'fix']) {
      if (entry[part] === undefined) continue;
      const text = typeof entry[part] === 'function' ? entry[part](anyArgs) : entry[part];
      assert.equal(typeof text, 'string', `${id}.${part}`);
      assert.doesNotMatch(text, /undefined|\[object|NaN/, `${id}.${part}: ${text}`);
    }
  }
});

function bench() {
  resetIds();
  return new Circuit(5.0);
}

test('real findings: German is worded from the same values, English is untouched', () => {
  const c = bench();
  const vcc = c.addPart('vcc', {}, 0, 0);
  const gnd = c.addPart('gnd', {}, 0, 0);
  const led = c.addPart('led', { color: 'red' }, 0, 0);
  c.addWire(vcc.id, 'vcc', led.id, 'anode');
  c.addWire(led.id, 'cathode', gnd.id, 'gnd');
  const batt = c.addPart('vsource', { volts: 9 }, 0, 0);
  c.addWire(batt.id, 'pos', batt.id, 'neg');
  c.advanceTo(25_000_000n);
  const found = runDrc(c, c.board);
  const rules = found.map(w => w.rule);
  assert.ok(rules.includes('missing-resistor'), rules.join());
  assert.ok(rules.includes('supply-short'), rules.join());
  for (const w of found) {
    assert.ok(DRC_DE[w.msg], `${w.rule} carries a known msg id (${w.msg})`);
    assert.equal(localizeDrcWarning(w, 'en'), w, 'English returns the warning itself');
    const de = localizeDrcWarning(w, 'de');
    assert.notEqual(de.explanation, w.explanation, `${w.rule}: German differs`);
    if (w.fix) assert.notEqual(de.fix, w.fix, `${w.rule}: German fix differs`);
    assert.equal(de.rule, w.rule, 'rule, part and severity are kept');
    assert.equal(de.partId, w.partId);
  }
  const resistor = localizeDrcWarning(found.find(w => w.rule === 'missing-resistor'), 'de');
  assert.match(resistor.explanation, /keinen Vorwiderstand.*300 mA/);
  assert.match(resistor.fix, /0,015/);
});

test('engine warnings are worded in German by their English shape', () => {
  const samples = [
    'led1: current 31.4 mA exceeds 20 mA rating. Add or increase the series resistor.',
    'led1: LED appears to be wired backward (cathode at 5.0V > anode at 0.0V). Swap anode and cathode.',
    'P1.0: output pin is driving but nothing is connected to it.',
    'P1.0: pin drives LOW but is wired directly to VCC. This is a short circuit.',
    'Total I/O current 140.2 mA exceeds chip limit of 120 mA.',
    'Circuit did not converge — voltages shown are approximate. This can happen with circuits that have no stable operating point.',
    'Total supply current 600.0 mA exceeds USB limit of 500 mA.',
  ];
  for (const text of samples) assert.notEqual(engineMessageDe(text), text, text);
  assert.equal(engineMessageDe('led1: current 31.4 mA exceeds 20 mA rating. Add or increase the series resistor.'),
    'led1: Strom 31,4 mA überschreitet die Belastbarkeit von 20 mA. Einen Vorwiderstand einsetzen oder vergrößern.');
  assert.equal(engineMessageDe('Something the engine says next year.'), 'Something the engine says next year.',
    'an unknown message stays English rather than vanishing');
  assert.ok(ENGINE_DE.length >= 15);
  const engine = { severity: 'danger', rule: 'engine', partId: 'led1', explanation: samples[0] };
  assert.match(localizeDrcWarning(engine, 'de').explanation, /^led1: Strom 31,4 mA/);
  assert.equal(localizeDrcWarning(engine, 'en'), engine);
});

test('the panel tally and the canvas badges speak German too', () => {
  const w = s => ({ severity: s });
  assert.equal(summariseSeverities([w('danger'), w('info'), w('info')], 'de'), '1 Problem, 2 Hinweise');
  assert.equal(summariseSeverities([w('danger'), w('info'), w('info')]), '1 problem, 2 notes');
  for (const rule of ['missing-resistor', 'supply-short', 'floating-input', 'polarity', 'missing-pullup']) {
    assert.ok(DRC_BADGE_DE[rule], `badge for ${rule}`);
  }
});

test('every canvas note of a declared bench has German', () => {
  const benches = [
    { pins: [
      { name: 'led1', port: 1, bit: 0, direction: 'output', activeLow: true },
      { name: 'led2', port: 1, bit: 1, direction: 'output' },
      { name: 'btn', port: 3, bit: 2, direction: 'input' },
      { name: 'pot', port: 1, bit: 3, direction: 'analog' },
      { name: 'buzzer', port: 1, bit: 4, direction: 'output', activeLow: true },
    ] },
    { device: 'arduino-uno', pins: [
      { name: 'led', where: 'd13', direction: 'output' },
      { name: 'button', where: 'd2', direction: 'input' },
      { name: 'buzzer', where: 'd8', direction: 'output' },
    ] },
    { device: 'pico', pins: [{ name: 'led', where: 'gp15', direction: 'output' }] },
    { device: 'esp32-4848s040', pins: [] },
    { pins: Array.from({ length: 9 }, (_, i) => ({ name: `led${i}`, port: 1, bit: i % 8, direction: 'output' })) },
  ];
  const notes = new Set();
  for (const stc of benches) {
    resetIds();
    for (const n of buildSeatedFromDeclarations(new Circuit(5.0), stc).notes) notes.add(n);
  }
  for (const a of inferCircuit({ device: 'STC12C5A60S2', clock: 11059200,
    pins: [{ name: 'led1', port: 1, bit: 0, direction: 'output', activeLow: true }] }).annotations) notes.add(a.text);
  assert.ok(notes.size >= 8, `collected ${notes.size} notes`);
  const english = [...notes].filter(n => canvasNoteDe(n) === n);
  assert.deepEqual(english, [], 'canvas notes without German in src/i18n/canvas-notes-de.js');
});

test('the starter note, the blocked-move note and the debugger dock tooltips have German', () => {
  for (const key of ['starterCircuitNote', 'moveBlockedNote', 'debuggerToRightTitle', 'debuggerToInstrumentsTitle']) {
    assert.notEqual(t(key, 'de'), t(key, 'en'), key);
    assert.notEqual(t(key, 'en'), key, `${key} exists`);
  }
  assert.equal(t('debuggerToRightTitle', 'en'), 'Move debugger to full-size right pane');
  assert.equal(t('debuggerToInstrumentsTitle', 'en'), 'Move debugger back to instruments');
  const designer = read('src/components/CircuitDesigner.jsx');
  assert.match(designer, /title=\{t\(\x27debuggerToRightTitle\x27, lang\)\}/);
  assert.match(designer, /title=\{t\(\x27debuggerToInstrumentsTitle\x27, lang\)\}/);
  const canvas = read('src/components/BoardCanvas.jsx');
  assert.match(canvas, /ann\.key \? t\(ann\.key, lang\) : canvasNote\(ann\.text, lang\)/);
  assert.match(canvas, /localizeDrcWarning\(found, lang\)/, 'the warnings popover words each finding');
});

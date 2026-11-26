#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Actual CircuitDesigner, its active Board, visible controls and solver nets.
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {createCardiacConnectorAssets} from './generate-cardiac-connector.mjs';
import {verifyBoardProvenance} from './board-provenance.mjs';
import {CARDIAC_EXAMPLES} from '../src/model/cardiac-demo.js';

const base = process.argv[2];
assert.ok(base, 'Pass the designer harness URL, or run npm run verify:cardiac:browser.');
const output = path.resolve(process.env.BW_CARDIAC_BROWSER_OUT || 'test-results/cardiac-browser');
await mkdir(output, {recursive: true});
const engine = verifyBoardProvenance();
await writeFile(path.join(output, 'engine.json'), JSON.stringify(engine, null, 2) + '\n');
const checks = [], pageErrors = [], {sidecar} = createCardiacConnectorAssets();
let browser, page;
try {
  browser = await chromium.launch({headless: true,
    ...(process.env.BW_CHROMIUM_EXECUTABLE ? {executablePath: process.env.BW_CHROMIUM_EXECUTABLE,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote']} : {})});
  page = await browser.newPage({viewport: {width: 1400, height: 960}});
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`${base}/?examples=none&nopins`, {waitUntil: 'networkidle'});
  await page.waitForFunction(() => typeof window.__setCircuitData === 'function');
  await page.getByRole('button', {name: 'CARDIAC + Brickwright I/O adapter', exact: true}).click();
  await page.locator('[data-canvas]').click({position: {x: 400, y: 150}});
  await page.waitForSelector('[data-cardiac-panel]');
  let panel = page.locator('[data-cardiac-panel]').first();
  const firstId = await panel.getAttribute('data-cardiac-panel');
  await page.waitForSelector(`[data-canvas] [data-part-id="${firstId}"][data-art-loaded="true"]`);
  await panel.locator('[data-cardiac-action="run"]').click();
  await page.waitForFunction(id => window.__board?.getDeviceState(id)?.waiting, firstId);
  assert.deepEqual(await page.evaluate(id => {
    const s = window.__board.getDeviceState(id); return [s.pc, s.steps, s.inputQueue];
  }, firstId), [1, 0, []]);
  await panel.getByRole('textbox', {name: 'CARDIAC input cards', exact: true}).fill('042');
  await panel.locator('[data-cardiac-enqueue]').click();
  await page.waitForFunction(id => window.__board?.getDeviceState(id)?.halted, firstId);
  assert.deepEqual(await page.evaluate(id => window.__board.getDeviceState(id).output, firstId), [42]);
  checks.push('palette places original connector art; shared clock waits without fabricated input and echoes a submitted card');

  await panel.locator('[data-cardiac-action="reset"]').click();
  await panel.getByRole('textbox', {name: 'CARDIAC input cards', exact: true}).fill('1000');
  await panel.locator('[data-cardiac-enqueue]').click();
  await panel.getByRole('alert').waitFor();
  assert.deepEqual(await page.evaluate(id => window.__board.getDeviceState(id).inputQueue, firstId), []);
  await panel.getByRole('textbox', {name: 'CARDIAC input cards', exact: true}).fill('-007');
  await panel.locator('[data-cardiac-enqueue]').click();
  assert.equal(await panel.getByRole('alert').count(), 0);
  await panel.locator('[data-cardiac-action="step"]').click();
  assert.deepEqual(await page.evaluate(id => {
    const s = window.__board.getDeviceState(id); return [s.memory[80], s.pc, s.running];
  }, firstId), [-7, 2, false]);
  checks.push('invalid manual cards are atomic; Step consumes one signed card without starting a second clock');

  await page.evaluate(() => window.addEventListener('bw-cardiac-open', event => {
    window.__cardiacOpenDetail = event.detail;
  }, {once: true}));
  await panel.locator('[data-cardiac-open]').click();
  assert.deepEqual(await page.evaluate(() => window.__cardiacOpenDetail), {partId: firstId});
  checks.push('the full-lab handoff identifies the existing active part');

  await panel.getByRole('button', {name: 'Open wired night-light example', exact: true}).click();
  await page.waitForSelector('[data-cardiac-panel="cardiac"]');
  panel = page.locator('[data-cardiac-panel="cardiac"]');
  assert.equal(await panel.getByRole('combobox', {name: 'CARDIAC input source', exact: true}).inputValue(), 'circuit');
  await panel.locator('[data-cardiac-sample]').click();
  assert.deepEqual(await page.evaluate(() => window.__board.getDeviceState('cardiac').inputSources), ['circuit']);
  await panel.locator('[data-cardiac-action="run"]').click();
  await page.waitForFunction(() => {
    const b = window.__board, s = b?.getDeviceState('cardiac');
    return s?.waiting && s.lastOutput === 1 && b.ledBrightness('lamp') > 0.01;
  });
  const completed = await page.evaluate(() => window.__board.getDeviceState('cardiac').steps);
  // Exercise the accessible native range inside the real Wokwi knob.
  const pot = page.locator('[data-pot-control="light-level"] input[type="range"]');
  await pot.press('End');
  await page.waitForFunction(() => window.__board.getDeviceState('cardiac').inputVoltage > 4);
  assert.deepEqual(await page.evaluate(() => {
    const s = window.__board.getDeviceState('cardiac'); return [s.steps, s.output, s.inputQueue];
  }), [completed, [1], []]);
  await panel.locator('[data-cardiac-sample]').click();
  await page.waitForFunction(() => {
    const b = window.__board, s = b?.getDeviceState('cardiac');
    return s?.waiting && s.output.length === 2 && s.lastOutput === 0 && b.ledBrightness('lamp') === 0;
  });
  checks.push('real potentiometer voltage is explicitly sampled once; low sample lights the wired LED and high sample turns it off');
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({path: path.join(output, 'cardiac-desktop.png'), fullPage: true});

  await panel.locator('[data-cardiac-action="pause"]').click();
  await pot.press('Home');
  await page.waitForFunction(() => window.__board.getDeviceState('cardiac').inputVoltage < 0.1);
  await panel.locator('[data-cardiac-sample]').click();
  const paused = await page.evaluate(() => {
    const b = window.__board, s = b.getDeviceState('cardiac'); return {pc: s.pc, steps: s.steps, t: String(b.getTime())};
  });
  await page.waitForFunction(t => window.__board.getTime() > BigInt(t) + 200_000_000n, paused.t);
  assert.deepEqual(await page.evaluate(() => {
    const s = window.__board.getDeviceState('cardiac'); return [s.pc, s.steps, s.inputQueue.length];
  }), [paused.pc, paused.steps, 1]);
  await panel.locator('[data-cardiac-action="step"]').click();
  assert.equal(await page.evaluate(() => window.__board.getDeviceState('cardiac').inputQueue.length), 0);
  await panel.locator('[data-cardiac-action="reset"]').click();
  assert.deepEqual(await page.evaluate(() => {
    const s = window.__board.getDeviceState('cardiac'); return [s.pc, s.memory[80], s.output, s.running];
  }), [1, 0, [], false]);
  checks.push('Pause retains queued input while circuit time advances; Step consumes one card; Restart restores the authored image');

  await panel.getByText('Load a program', {exact: true}).click();
  await panel.getByRole('combobox', {name: 'CARDIAC example', exact: true}).selectOption('addition');
  await panel.locator('[data-cardiac-load]').click();
  await panel.getByRole('combobox', {name: 'CARDIAC input source', exact: true}).selectOption('manual');
  await panel.getByRole('textbox', {name: 'CARDIAC input cards', exact: true}).fill('017 025');
  await panel.locator('[data-cardiac-enqueue]').click();
  await panel.locator('[data-cardiac-action="run"]').click();
  await page.waitForFunction(() => window.__board.getDeviceState('cardiac')?.halted);
  assert.deepEqual(await page.evaluate(() => window.__board.getDeviceState('cardiac').output), [42]);
  const beforeNotice = await page.evaluate(() => {
    const s = window.__board.getDeviceState('cardiac'); return [s.pc, s.steps, s.memory[82], s.output];
  });
  await page.evaluate(program => window.dispatchEvent(new CustomEvent('bw-cardiac-program-loaded',
    {detail: {partId: 'cardiac', program}})), CARDIAC_EXAMPLES[2].program);
  assert.deepEqual(await page.evaluate(() => {
    const s = window.__board.getDeviceState('cardiac'); return [s.pc, s.steps, s.memory[82], s.output];
  }), beforeNotice);
  const saved = await page.evaluate(() => window.__circuit.toJSON());
  assert.deepEqual(saved.parts.find(part => part.id === 'cardiac').params.program, CARDIAC_EXAMPLES[2].program);
  await page.evaluate(data => window.__setCircuitData(data), saved);
  await page.waitForFunction(() => window.__board.getDeviceState('cardiac')?.memory[82] === 0 &&
    window.__board.getDeviceState('cardiac')?.output.length === 0);
  checks.push('accepted numeric image survives circuit save/load; live STO writes and runtime cards are not serialized as code');
  await page.evaluate(program => window.dispatchEvent(new CustomEvent('bw-cardiac-program-loaded',
    {detail: {partId: 'cardiac', program}})), CARDIAC_EXAMPLES[0].program);
  assert.deepEqual(await page.evaluate(() => window.__circuit.getPart('cardiac').params.program), CARDIAC_EXAMPLES[2].program);
  await page.evaluate(program => {
    if (!window.__board.setDeviceControl('cardiac', 'loadProgram', program)) throw new Error('Host load was refused');
    window.dispatchEvent(new CustomEvent('bw-cardiac-program-loaded', {detail: {partId: 'cardiac', program}}));
  }, CARDIAC_EXAMPLES[0].program);
  assert.deepEqual(await page.evaluate(() => window.__circuit.getPart('cardiac').params.program), CARDIAC_EXAMPLES[0].program);
  checks.push('host load notifications save only the actual accepted image; duplicate notifications preserve runtime memory');

  for (const rotation of [0, 90, 180, 270]) for (const flipped of [false, true]) {
    const fixture = {vcc: 5, fileOnly: true, parts: [{id: 'geometry', kind: 'cardiac', x: 350, y: 250,
      rotation, flipped, params: {program: CARDIAC_EXAMPLES[0].program},
      terminals: sidecar.terminals.map(terminal => terminal.name)}], wires: [], holeWires: []};
    await page.evaluate(data => window.__setCircuitData(data), fixture);
    await page.waitForSelector('[data-canvas] [data-part-id="geometry"][data-art-loaded="true"]');
    await page.locator('[data-canvas] [data-part-id="geometry"]').click();
    await page.waitForSelector('[data-canvas] [data-terminal-dot="geometry:IN"]');
    const failures = await page.evaluate(async terminals => {
      const face = document.querySelector('[data-canvas] [data-part-id="geometry"]'), image = face.querySelector('image');
      const art = new DOMParser().parseFromString(await (await fetch(image.getAttribute('href'))).text(), 'image/svg+xml');
      return terminals.flatMap(terminal => {
        const contact = art.querySelector(`[data-terminal="${terminal.name}"] circle`);
        const dot = document.querySelector(`[data-canvas] [data-terminal-dot="geometry:${terminal.name}"] circle`);
        if (!contact || !dot) return [`Missing ${terminal.name}`];
        const drawn = new DOMPoint(+image.getAttribute('x') + +contact.getAttribute('cx'),
          +image.getAttribute('y') + +contact.getAttribute('cy')).matrixTransform(face.getCTM());
        const wired = new DOMPoint(+dot.getAttribute('cx'), +dot.getAttribute('cy')).matrixTransform(dot.getCTM());
        return Math.hypot(drawn.x - wired.x, drawn.y - wired.y) > 0.01 ? [`Displaced ${terminal.name}`] : [];
      });
    }, sidecar.terminals);
    assert.deepEqual(failures, [], `contacts at ${rotation}°, mirrored ${flipped}`);
  }
  checks.push('all four original SVG contacts agree with wire targets through every quarter turn and reflection');
  await page.evaluate(data => window.__setCircuitData(data), {vcc: 5, fileOnly: true,
    parts: ['one', 'two'].map((id, index) => ({id, kind: 'cardiac', x: 200 + index * 300, y: 250,
      params: {program: CARDIAC_EXAMPLES[0].program, instructionHz: 20}, terminals: ['IN', 'OUT', '5v', 'gnd']})), wires: []});
  panel = page.locator('[data-cardiac-panel="one"]');
  await panel.getByRole('textbox', {name: 'CARDIAC input cards', exact: true}).fill('123');
  await panel.locator('[data-cardiac-enqueue]').click();
  await panel.locator('[data-cardiac-action="run"]').click();
  await page.waitForFunction(() => window.__board.getDeviceState('one')?.halted);
  assert.deepEqual(await page.evaluate(() => {
    const s = window.__board.getDeviceState('two'); return [s.pc, s.steps, s.output, s.running];
  }), [1, 0, [], false]);
  checks.push('two compact panels control distinct machines on the same shared Board');

  await page.setViewportSize({width: 390, height: 844});
  await panel.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelector('[data-cardiac-panel="one"]')?.getBoundingClientRect().width >= 300);
  const overflow = await page.evaluate(() => ({viewport: innerWidth, width: document.documentElement.scrollWidth,
    panel: document.querySelector('[data-cardiac-panel="one"]').getBoundingClientRect().width}));
  assert.ok(overflow.width <= overflow.viewport + 1, JSON.stringify(overflow));
  assert.ok(overflow.panel >= 300 && overflow.panel <= 390, JSON.stringify(overflow));
  await page.screenshot({path: path.join(output, 'cardiac-mobile.png'), fullPage: true});
  assert.deepEqual(pageErrors, []);
  const result = {status: 'passed', browser: browser.version(), checks, engineQualified: engine.qualified,
    scope: 'Actual CircuitDesigner, engine-owned CARDIAC state, explicit modern I/O adapter, shared circuit clock',
    fullApplicationBuild: false};
  await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} catch (error) {
  if (page) await page.screenshot({path: path.join(output, 'failure.png'), fullPage: true}).catch(() => {});
  await writeFile(path.join(output, 'failure.json'), JSON.stringify({error: String(error.stack || error),
    pageErrors, checks, engineQualified: engine.qualified}, null, 2) + '\n');
  throw error;
} finally { await browser?.close(); }

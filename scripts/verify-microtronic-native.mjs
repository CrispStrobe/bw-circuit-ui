// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const base = process.argv[2];
assert.ok(base, 'Pass the CircuitDesigner harness URL.');
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.BW_CHROMIUM_EXECUTABLE
});
try {
  const page = await browser.newPage({viewport: {width: 1440, height: 960}});
  await page.goto(`${base}/?examples=none&nopins`);
  await page.getByRole('button', {name: 'Busch Microtronic 2090', exact: true}).click();
  await page.locator('[data-canvas]').click({position: {x: 400, y: 150}});
  const mode = page.getByRole('combobox', {name: 'Microtronic execution mode'});
  assert.equal(await mode.inputValue(), 'documented-behavior');
  await mode.selectOption('tms1600');
  await page.waitForFunction(() => document.querySelector('.microtronic-model')?.value === 'tms1600');
  await page.getByRole('button', {name: 'Open wired I/O example'}).click();

  const panel = page.locator('[data-microtronic-panel="microtronic"]');
  assert.equal(await panel.getByRole('combobox', {name: 'Microtronic execution mode'}).inputValue(), 'tms1600');
  await page.locator('[data-switch-control="input1"]').click();
  await panel.getByRole('button', {name: 'Run', exact: true}).click();
  await page.waitForFunction(() => {
    const board = window.__board;
    const state = board?.getDeviceState('microtronic');
    return state?.model === 'tms1600' && state.nativeInstructions > state.executed &&
      state.output === 1 && board.ledBrightnessNow('lamp1') > 0.05;
  });
  await page.waitForFunction(() => window.__board?.getDeviceState('microtronic')?.output === 9);

  await panel.getByRole('button', {name: 'Halt', exact: true}).click();
  const circuit = await page.evaluate(() => window.__circuit.toJSON());
  assert.equal(circuit.parts.find(part => part.id === 'microtronic').params.executionMode, 'tms1600');
  await page.evaluate(data => window.__setCircuitData(data), circuit);
  await page.waitForFunction(() => window.__board?.getDeviceState('microtronic')?.model === 'tms1600');

  await panel.getByRole('combobox', {name: 'Microtronic execution mode'}).selectOption('documented-behavior');
  await page.waitForFunction(() =>
    window.__board?.getDeviceState('microtronic')?.model === 'documented-behavior');
  console.log('PASS mode selection, native wired I/O and clock, saved circuit, and behavioral fallback');
} finally {
  await browser.close();
}

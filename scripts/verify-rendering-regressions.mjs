#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const port = 3150;
const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
const stop = () => { try { server.kill('SIGTERM'); } catch { /* already stopped */ } };
process.on('exit', stop);

for (let attempt = 0; attempt < 60; attempt++) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`);
    if (response.ok) break;
  } catch { /* server is starting */ }
  if (attempt === 59) throw new Error('Vite did not start');
  await new Promise(resolve => setTimeout(resolve, 250));
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => typeof window.__setCircuitData === 'function');

  const load = async parts => {
    await page.evaluate(value => window.__setCircuitData({ vcc: 5, parts: value, wires: [], holeWires: [], fileOnly: true }), parts);
    await page.waitForTimeout(150);
  };

  if (await page.locator('[data-instruments-column]').count()) {
    throw new Error('instruments column must start collapsed');
  }

  await load([{ id: 'uno', kind: 'arduino_uno', params: {}, x: 520, y: 260, rotation: 0 }]);
  await page.waitForSelector('foreignObject[data-board-face="arduino_uno"] wokwi-arduino-uno');
  const alignment = await page.evaluate(() => {
    const face = document.querySelector('foreignObject[data-board-face="arduino_uno"]');
    const outline = document.querySelector('g[data-board-face="arduino_uno"] > rect');
    const art = face?.querySelector('wokwi-arduino-uno')?.shadowRoot?.querySelector('svg');
    const box = element => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
    };
    return { face: box(face), outline: box(outline), art: box(art) };
  });
  for (const key of ['x', 'y', 'w', 'h']) {
    if (Math.abs(alignment.face[key] - alignment.outline[key]) > 1.5) {
      throw new Error(`Arduino face/outline ${key} drift: ${JSON.stringify(alignment)}`);
    }
  }
  if (alignment.art.w < alignment.face.w * 0.9 || alignment.art.h < alignment.face.h * 0.9) {
    throw new Error(`Arduino artwork does not fill its physical face: ${JSON.stringify(alignment)}`);
  }

  await load([{ id: 'bb', kind: 'breadboard', params: {}, x: 520, y: 330, rotation: 0 }]);
  const holes = await page.evaluate(() => {
    const xs = [...document.querySelectorAll('[data-breadboard="bb"] [data-hole^="a"]')]
      .map(circle => Number(circle.getAttribute('cx')));
    const rail = document.querySelectorAll('[data-breadboard="bb"] [data-hole^="t+"]').length;
    return { xs, rail };
  });
  if (holes.xs.length !== 63 || holes.rail !== 63) throw new Error(`breadboard holes missing: ${holes.xs.length}/${holes.rail}`);
  if (holes.xs.some((x, index) => index && Math.abs(x - holes.xs[index - 1] - 14) > 0.01)) {
    throw new Error('breadboard terminal-row pitch contains a gap');
  }

  await load([]);
  const canvas = await page.locator('[data-canvas]').boundingBox();
  await page.getByText('Breadboard ½', { exact: true }).click();
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  await page.waitForSelector('[data-placement-ghost="breadboard"]');
  const halfGhost = Number(await page.locator('[data-placement-ghost="breadboard"] > rect').getAttribute('width'));
  if (halfGhost !== 460) throw new Error(`half-board preview width is ${halfGhost}, expected 460`);
  await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  await page.waitForSelector('[data-breadboard-size="half"]');
  const halfBoard = Number(await page.locator('[data-breadboard-size="half"] rect').first().getAttribute('width'));
  if (halfBoard !== halfGhost) throw new Error(`half-board changed size on drop: ${halfGhost} -> ${halfBoard}`);

  await page.getByText('Breadboard mini', { exact: true }).click();
  await page.mouse.move(canvas.x + canvas.width * 0.7, canvas.y + canvas.height * 0.7);
  await page.waitForSelector('[data-placement-ghost="breadboard"]');
  const miniGhost = Number(await page.locator('[data-placement-ghost="breadboard"] > rect').getAttribute('width'));
  if (miniGhost !== 278) throw new Error(`mini-board preview width is ${miniGhost}, expected 278`);
  await page.keyboard.press('Escape');

  await load([
    { id: 'bb', kind: 'breadboard', params: {}, x: 520, y: 330, rotation: 0 },
    { id: 'tiny', kind: 'attiny13', params: {}, x: 520, y: 330, rotation: 0 },
  ]);
  const tiny = page.locator('[data-dip-body="attiny13"]');
  const tinyBox = await tiny.boundingBox();
  await page.mouse.click(tinyBox.x + tinyBox.width / 2, tinyBox.y + tinyBox.height / 2);
  await page.waitForTimeout(80);
  if (!await page.locator('[data-selection-actions]').count()) throw new Error('ATtiny13 body was not selectable over breadboard');

  console.log('✔ Arduino face aligns with its outline and hit geometry');
  console.log('✔ full breadboard renders 63 consecutive terminal and rail holes');
  console.log('✔ half/mini placement previews use their dropped dimensions');
  console.log('✔ ATtiny13 selects above a breadboard');
  console.log('✔ instruments start collapsed');
} finally {
  await browser.close();
  stop();
}

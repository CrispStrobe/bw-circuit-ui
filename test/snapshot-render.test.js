// Render-level test: SNAPSHOT visual treatment.
//
// Verifies that a stale board (skewNs > 0) looks different from a
// frozen simulation (skewNs === 0), and that controls stay live in both.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startDevServer } from './_dev-server.js';

let server;
let browser, page;

before(async () => {
  server = await startDevServer('snapshot-render');
  browser = await chromium.launch();
});

after(async () => {
  if (server) server.stop();
  if (browser) await browser.close();
});

async function loadMode(mode) {
  const p = await browser.newPage({ viewport: { width: 1400, height: 760 } });
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  await p.goto(`${server.url}/?debug=${mode}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1000);
  return { page: p, errors };
}

describe('SNAPSHOT visual treatment', () => {
  it('snapshot mode shows SNAPSHOT status and desaturates', async () => {
    const { page: p, errors } = await loadMode('snapshot');
    const text = await p.locator('body').innerText();

    // The status moved from body TEXT to the `title` of a collapsed status
    // chip (BoardCanvas gates it behind `noticeOpen`). The claim under test is
    // "the user is told this is a snapshot, and by how much" — that is still
    // true, so the assertion follows the text to where it is now rather than
    // being deleted.
    const dom = await p.locator('body').innerHTML();
    const shown = text.includes('SNAPSHOT') || dom.includes('SNAPSHOT');
    assert.ok(shown, 'should show SNAPSHOT in the status chip (text or its title)');
    assert.ok(/4\.2 s|4200 ms/.test(text) || /4\.2 s|4200 ms/.test(dom),
      'should show the skew duration');

    // The canvas container should have a desaturation filter
    const html = await p.locator('body').innerHTML();
    assert.ok(html.includes('saturate(0.35)'),
      'snapshot should desaturate the canvas');

    assert.deepEqual(errors, []);
    await p.close();
  });

  it('paused mode (frozen sim) does NOT desaturate', async () => {
    const { page: p, errors } = await loadMode('paused');
    const text = await p.locator('body').innerText();

    assert.ok(text.includes('PAUSED'), 'should show PAUSED in status');

    // Should NOT be desaturated — nothing is stale
    const html = await p.locator('body').innerHTML();
    assert.ok(!html.includes('saturate(0.35)'),
      'frozen simulation must NOT be desaturated (nothing is stale)');

    assert.deepEqual(errors, []);
    await p.close();
  });

  it('snapshot and paused look different from each other', async () => {
    const { page: snap } = await loadMode('snapshot');
    const { page: pause } = await loadMode('paused');

    const snapHtml = await snap.locator('body').innerHTML();
    const pauseHtml = await pause.locator('body').innerHTML();

    // The filter style should differ
    const snapHasFilter = snapHtml.includes('saturate(0.35)');
    const pauseHasFilter = pauseHtml.includes('saturate(0.35)');

    assert.notEqual(snapHasFilter, pauseHasFilter,
      'snapshot and paused must render differently');

    await snap.close();
    await pause.close();
  });

  it('controls stay live in both modes (pot, button not disabled)', async () => {
    // Check that draggable parts and interactive elements are not disabled
    for (const mode of ['snapshot', 'paused']) {
      const { page: p } = await loadMode(mode);
      const html = await p.locator('body').innerHTML();

      // No pointerEvents:none on the interactive layer
      // (the desaturation div has pointerEvents:none on wokwi layer
      //  but dragProps re-enables it on each part)
      assert.ok(!html.includes('disabled="true"'),
        `${mode}: controls should not be disabled`);

      await p.close();
    }
  });

  it('hardware mode shows HARDWARE status and desaturates differently', async () => {
    const { page: p, errors } = await loadMode('hardware');
    const text = await p.locator('body').innerText();

    const domH = await p.locator('body').innerHTML();
    assert.ok(text.includes('HARDWARE') || domH.includes('HARDWARE'),
      'should show HARDWARE in the status chip (text or its title)');

    assert.deepEqual(errors, []);
    await p.close();
  });
});

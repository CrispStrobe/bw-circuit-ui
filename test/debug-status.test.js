/**
 * DebugStatus — the debugger surface, per debug mode.
 *
 * ── What these tests used to be ─────────────────────────────────────
 * Three tests, one of which navigated, waited 500 ms and closed the page
 * WITHOUT ASSERTING ANYTHING, under a comment explaining what should happen:
 *
 *     // Note: debugState in main.jsx snapshot mode has halted:true but no
 *     // haltReason/tasks — The DebugStatus should still show HALTED
 *     await p.close();
 *
 * It passed for years because there was nothing in it to fail, and the comment
 * was wrong as well: `main.jsx` passes `haltReason: 'user'`, `bwMs` and tasks
 * for snapshot mode. A vacuous test is worse than a missing one — it occupies
 * the slot where the real check would go and reports green from it.
 *
 * ── What they assert now, and why it discriminates ──────────────────
 * The component's whole purpose is the difference between a frozen world and a
 * snapshot of one that kept moving (CircuitDesigner: "a non-zero skew turns
 * this from a frozen world into a SNAPSHOT"). So the assertions turn on
 * exactly that: `paused` and `snapshot` are both HALTED and differ only in the
 * WALL-TIME line, which must be present in one and absent in the other. A test
 * that only checked "says HALTED" would pass on either and could not tell them
 * apart — which is the bug this component exists to prevent.
 *
 * Everything is scoped to `[data-debug-status]`. Body text is not a usable
 * handle: the simulation-controls panel beside it renders the same ⏭/↩ glyphs,
 * so a text assertion passes even in `live` mode, where this component returns
 * null and renders nothing whatsoever.
 *
 * The surface lives in the instruments panel, which is collapsed by default —
 * hence `openInstruments`. That collapse is why the original tests saw nothing
 * to assert on in the first place.
 *
 * @module
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startDevServer } from './_dev-server.js';

let server;
let browser;

before(async () => {
  server = await startDevServer('debug-status');
  browser = await chromium.launch();
});
after(async () => {
  if (server) server.stop();
  if (browser) await browser.close();
});

/** Open the instruments panel, where the debugger surface is docked. */
async function openInstruments (p) {
  const expand = p.locator('[title="Expand instruments panel"]');
  if (await expand.count()) {
    await expand.first().click();
    await p.waitForTimeout(700);
  }
}

/** Load one `?debug=` mode and return the DebugStatus surface's own text. */
async function debugSurface (mode) {
  const p = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(`${server.url}/?debug=${mode}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  await openInstruments(p);
  const surface = p.locator('[data-debug-status]');
  const count = await surface.count();
  const text = count ? await surface.first().innerText() : null;
  return { p, count, text, errors };
}

describe('DebugStatus rendering', () => {
  it('snapshot mode: HALTED, its reason, program time, and the WALL-TIME skew', async () => {
    const { p, count, text, errors } = await debugSurface('snapshot');
    assert.equal(count, 1, 'the debugger surface should be mounted for a halted board');

    assert.match(text, /HALTED/, 'a halted board must say so');
    assert.match(text, /by user/i,
      "haltReason 'user' must be rendered — main.jsx passes it, whatever the old comment said");
    assert.match(text, /1250\.7 ms/, 'program time comes from bwMs and must be shown exactly');
    assert.match(text, /frozen/i, 'a halted program is frozen, not advancing');

    // THE discriminator: skewNs is 4.2 s, so the board kept running while the
    // program was stopped. This line is the difference between PAUSED and
    // SNAPSHOT, and it is the only reason this component is not a label.
    assert.match(text, /\+4\.2 s/,
      'a non-zero skew must be reported as wall time ahead — without it a snapshot is '
      + 'indistinguishable from a frozen world, which is the falsehood this surface exists '
      + 'to prevent');
    assert.match(text, /board kept running/i, 'and it must say what the skew MEANS');

    assert.deepEqual(errors, [], `no page errors: ${errors.join('; ')}`);
    await p.close();
  });

  it('paused mode: HALTED with its own reason, and NO wall-time line', async () => {
    const { p, count, text, errors } = await debugSurface('paused');
    assert.equal(count, 1, 'the debugger surface should be mounted for a halted board');

    assert.match(text, /HALTED/, 'a halted board must say so');
    assert.match(text, /breakpoint/i, "haltReason 'breakpoint' must be rendered");
    assert.match(text, /82\.3 ms/, 'program time comes from bwMs and must be shown exactly');

    // skewNs is 0n here: program and board are frozen TOGETHER. Claiming wall
    // time had advanced would be inventing a discrepancy that does not exist.
    assert.doesNotMatch(text, /Wall time/i,
      'skewNs is 0, so there is no wall-time skew to report. If this line appears the surface '
      + 'is showing a snapshot where there is only a pause.');
    assert.doesNotMatch(text, /board kept running/i, 'the board did not keep running');

    assert.deepEqual(errors, [], `no page errors: ${errors.join('; ')}`);
    await p.close();
  });

  it('live mode: no debugState, so the surface does not render at all', async () => {
    const { p, count, errors } = await debugSurface('live');

    // `if (!debugState) return null` — a running board with no debug session
    // has nothing to say about halt state, and must not imply otherwise.
    assert.equal(count, 0,
      'with no debugState the debugger surface must not mount. Asserting on body text instead '
      + 'would pass here regardless, because the simulation-controls panel renders the same '
      + 'glyphs — that is why this scopes to [data-debug-status].');

    const body = await p.locator('body').innerText();
    assert.match(body, /LIVE/, 'the status chip should still report LIVE');
    assert.doesNotMatch(body, /HALTED/, 'a live board is not halted');

    assert.deepEqual(errors, [], `no page errors: ${errors.join('; ')}`);
    await p.close();
  });
});

#!/usr/bin/env node
// A2 sim-parts acceptance: does the PRESSABLE KEYPAD really press (real
// mouse events on the rendered face → engine bridge → node voltage), and
// does SEVEN_SEG_4 really light all four digits from the engine? Run:
//   node scripts/verify-a2-sim.mjs
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 3147;
const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore', detached: false,
});
const kill = () => { try { server.kill('SIGTERM'); } catch { /* gone */ } };
process.on('exit', kill);

const waitForServer = async () => {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://localhost:${PORT}/`); if (r.ok) return; }
    catch { /* not up yet */ }
    await new Promise(res => setTimeout(res, 500));
  }
  throw new Error('dev server did not come up');
};

const fail = (msg) => { console.error(`✖ ${msg}`); process.exitCode = 1; };
const pass = (msg) => console.log(`✔ ${msg}`);

await waitForServer();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto(`http://localhost:${PORT}/?nopins=1`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__circuit && window.__circuit.parts.length > 0, { timeout: 20000 });

// ---- build the test rig programmatically -----------------------------------
// Keypad rig: vcc → r3; c2 → 10k → gnd. Pressing '#' (row3/col2) bridges
// r3↔c2 with 0.1 Ω, pulling the c2 node from ~0 V to ~5 V.
// Seven-seg rig: vcc → 1k → segment a; com0 → gnd (common cathode digit 0).
await page.evaluate(() => {
  const c = window.__circuit;
  const kp = c.addPart('keypad_4x4', {}, 950, 220);
  const vc = c.addPart('vcc', {}, 860, 120);
  const rr = c.addPart('resistor', { ohms: 10000 }, 1040, 320);
  const gn = c.addPart('gnd', {}, 1040, 420);
  c.addWire(vc.id, 'vcc', kp.id, 'r3');
  c.addWire(kp.id, 'c2', rr.id, 'a');
  c.addWire(rr.id, 'b', gn.id, 'gnd');

  const sg = c.addPart('seven_seg_4', {}, 950, 560);
  const v2 = c.addPart('vcc', {}, 860, 500);
  const r2 = c.addPart('resistor', { ohms: 220 }, 860, 560);
  const g2 = c.addPart('gnd', {}, 1040, 640);
  c.addWire(v2.id, 'vcc', r2.id, 'a');
  c.addWire(r2.id, 'b', sg.id, 'a');
  c.addWire(sg.id, 'com0', g2.id, 'gnd');
  // Common-cathode discipline: unselected digits park HIGH (as a real
  // scan driver holds them); floating commons produce leak artifacts.
  c.addWire(sg.id, 'com1', v2.id, 'vcc');
  c.addWire(sg.id, 'com2', v2.id, 'vcc');
  c.addWire(sg.id, 'com3', v2.id, 'vcc');

  window.__rig = { kp: kp.id, sg: sg.id };
});
await page.waitForTimeout(300);
{
  const diag = await page.evaluate(() => ({
    err: window.__circuit.netlistError,
    parts: window.__circuit.parts.length,
    nets: (window.__circuit.resolvedNets || []).length,
  }));
  console.log('diag:', JSON.stringify(diag));
}

const voltsAtC2 = () => page.evaluate(() => {
  const c = window.__circuit;
  const net = (c.resolvedNets || []).find(n =>
    n.terminals.some(t => t.part === window.__rig.kp && t.terminal === 'c2'));
  return net ? c.board.nodeVoltage(net.id) : null;
});

// ---- enter simulate mode (the real UI toggle) ------------------------------
await page.getByRole('radio', { name: /Sim/i }).first().click();
await page.waitForTimeout(600);

// ---- 1. keypad: idle state --------------------------------------------------
{
  const v = await voltsAtC2();
  (v !== null && Math.abs(v) < 0.5)
    ? pass(`keypad idle: c2 sits low (${v?.toFixed(3)} V)`)
    : fail(`keypad idle: c2 = ${v} (want ~0 V)`);
}

await page.evaluate(() => {
  window.__kpLog = [];
  const orig = window.__circuit.setPartParam.bind(window.__circuit);
  window.__circuit.setPartParam = (id, param, value) => { window.__kpLog.push([param, value]); return orig(id, param, value); };
});

// ---- 2. press '#' with a REAL mouse ----------------------------------------
{
  const key = page.locator(`[data-keypad] div`, { hasText: '#' }).first();
  await key.waitFor({ state: 'visible', timeout: 5000 });
  const bb = await key.boundingBox();
  if (!bb) { fail('the # key has no bounding box'); }
  else {
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(250);
    const pressed = await page.evaluate(() => {
      const p = window.__circuit.parts.find(pp => pp.id === window.__rig.kp);
      return p?.params?.pressed;
    });
    const kpLog = await page.evaluate(() => window.__kpLog);
    pressed === 14
      ? pass('mouse-down on # sets pressed=14 (row3/col2)')
      : fail(`mouse-down: pressed=${pressed} (want 14); handler log: ${JSON.stringify(kpLog)}`);
    const v = await voltsAtC2();
    (v !== null && v > 4.0)
      ? pass(`the bridge is electrically real: c2 jumped to ${v.toFixed(3)} V`)
      : fail(`c2 = ${v} V while pressed (want ~5 V)`);
    await page.mouse.up();
    await page.waitForTimeout(250);
    const released = await page.evaluate(() => {
      const p = window.__circuit.parts.find(pp => pp.id === window.__rig.kp);
      return p?.params?.pressed;
    });
    const v2 = await voltsAtC2();
    (released === -1 && v2 !== null && Math.abs(v2) < 0.5)
      ? pass(`mouse-up releases: pressed=-1, c2 back to ${v2.toFixed(3)} V`)
      : fail(`release: pressed=${released}, c2=${v2}`);
  }
}

// ---- 3. seven_seg_4: digit 0 lit, digits 1-3 dark, all four rendered -------
{
  await page.waitForTimeout(1500);   // let the brightness filter charge
  const b = await page.evaluate(() => {
    const digits = window.__circuit.board.sevenSeg3Brightness(window.__rig.sg, 4);
    return digits.map(d => d.a);
  });
  const segDiag = await page.evaluate(() => {
    const bd = window.__circuit.board;
    const id = window.__rig.sg;
    const net = (window.__circuit.resolvedNets || []).find(n =>
      n.terminals.some(t => t.part === id && t.terminal === 'a'));
    const com = (window.__circuit.resolvedNets || []).find(n =>
      n.terminals.some(t => t.part === id && t.terminal === 'com0'));
    return { segV: net ? bd.nodeVoltage(net.id) : null,
             comV: com ? bd.nodeVoltage(com.id) : null,
             d0a: bd.ledBrightness(`${id}_d0_a`) };
  });
  console.log('7seg diag:', JSON.stringify(segDiag));
  (b.length === 4 && b[0] > 0.3 && b[1] < 0.02 && b[2] < 0.02 && b[3] < 0.02)
    ? pass(`seven_seg_4 engine: digit0 a=${b[0].toFixed(2)}, others dark [${b.slice(1).map(x => x.toFixed(2))}]`)
    : fail(`seven_seg_4 brightness wrong: ${JSON.stringify(b)}`);
}

// ---- 4. the face really renders 4 digit groups -----------------------------
{
  const digitAttr = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('wokwi-7segment'));
    return els.map(e => e.digits ?? e.getAttribute('digits'));
  });
  digitAttr.some(d => Number(d) === 4)
    ? pass(`the DOM carries a 4-digit wokwi element (digits attrs: ${digitAttr})`)
    : fail(`no 4-digit element in the DOM (digits attrs: ${JSON.stringify(digitAttr)})`);
}

if (errors.length) fail(`page errors: ${errors.slice(0, 3).join(' | ')}`);
else pass('no page errors');

await browser.close();
kill();
process.exit(process.exitCode || 0);

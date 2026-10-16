import assert from 'node:assert/strict';
import {readFile, writeFile, unlink} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium} from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const original = await readFile(new URL('../src/components/CpxFace.jsx', import.meta.url), 'utf8');
const designerOriginal = await readFile(new URL('../src/components/CircuitDesigner.jsx', import.meta.url), 'utf8');
const mutants = new Map([
  ['callback', original.replace('held.current({button: name, down: true});', '/* omitted button callback */')],
  ['positions', original.replace('CPX_FACE.pixels.map((p, index)',
    '[CPX_FACE.pixels[1], CPX_FACE.pixels[0], ...CPX_FACE.pixels.slice(2)].map((p, index)')]
]);
mutants.set('onboard', designerOriginal.replace("const onboardCpx = makeCodeBoardFor(projectData?.device)?.kind === 'circuit_playground_express';", 'const onboardCpx = false;'));
const files = [];
let server, browser;
try {
  for (const [name, text] of mutants) {
    assert.notEqual(text, name === 'onboard' ? designerOriginal : original, `Mutation ${name} must change executable source`);
    const file = `src/components/.a13-${name}-${process.pid}.jsx`;
    await writeFile(new URL(`../${file}`, import.meta.url), text, {flag: 'wx'});
    files.push(file);
  }
  server = await createServer({root, server: {host: '127.0.0.1', port: 3196, strictPort: true},
    plugins: [{name: 'cpx-face-fixture', configureServer(s) {
      s.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/__cpx_face') || req.url.includes('html-proxy')) return next();
        try {
          const name = new URL(req.url, 'http://localhost').searchParams.get('mutant');
          const entry = mutants.has(name) && name !== 'onboard' ? `/src/components/.a13-${name}-${process.pid}.jsx` : '/src/components/CpxFace.jsx';
          const html = `<!doctype html><html><body><div id="root"></div><script type="module">
            import React from 'react';
            import {createRoot} from 'react-dom/client';
            import {CpxFace} from '${entry}';
            const designerMode = new URLSearchParams(location.search).get('designer');
            let Designer;
            if (designerMode) {
              const [{setEngine}, {BoardImpl}, {inferNetlist, checkWiring}, {getDevice}, {registerAllDevices}] = await Promise.all([
                import('/src/engine.js'), import('bw-board/board.js'), import('bw-board/infer-netlist.js'),
                import('bw-board/devices.js'), import('bw-board/register-all.js')]);
              registerAllDevices();
              setEngine({BoardImpl, inferNetlist, checkWiring, getDevice});
              await import('/src/model/sidecar-loader.js');
              Designer = (await import('${name === 'onboard' ? `/src/components/.a13-onboard-${process.pid}.jsx` : '/src/components/CircuitDesigner.jsx'}')).CircuitDesigner;
            }
            let state = {shown: [0xff0000, 0x00ff00, 0x0000ff, 0, 0, 0, 0, 0, 0, 0],
              brightness: 16, buttons: {A: false, B: false}, switchRight: false};
            const root = createRoot(document.getElementById('root'));
            window.events = []; window.parentInputs = 0;
            let active = true; let mounted = true;
            let project = {device: designerMode === 'transition' ? 'pico' : 'cpx', pins: []};
            window.pickCpx = () => {project = {...project, device: 'cpx'}; render();};
            const onInput = event => {
              window.events.push(event);
              if (event.button) state = {...state, buttons: {...state.buttons, [event.button]: event.down}};
              if ('switchRight' in event) state = {...state, switchRight: event.switchRight};
              if (mounted) render();
            };
            function render() {
              if (Designer) {
                root.render(React.createElement(Designer, {project, cpxState: state, onCpxInput: onInput,
                  onCircuitReady: circuit => { window.observedCircuit = circuit; },
                  ...(designerMode === 'file' ? {circuitData: {vcc: 3.3, fileOnly: true,
                    parts: [{id: 'kept', kind: 'resistor', x: 80, y: 80, params: {ohms: 470}, terminals: ['a', 'b']}],
                    wires: [], holeWires: []}} : {})}));
                return;
              }
              root.render(React.createElement('svg', {width: 600, height: 500, viewBox: '-150 -150 300 300',
                onPointerDown: () => window.parentInputs++},
                React.createElement('g', {transform: 'rotate(90)'},
                  React.createElement(CpxFace, {width: 250, height: 250, state,
                    onInput: active ? event => onInput(event) : null}))));
            }
            window.setFace = next => {state = next; render();};
            window.setActive = next => {active = next; render();};
            window.unmountFace = () => {mounted = false; root.unmount();};
            render();
          </script></body></html>`;
          res.setHeader('Content-Type', 'text/html');
          res.end(await s.transformIndexHtml(req.url, html));
        } catch (error) { next(error); }
      });
    }}]});
  await server.listen();
  browser = await chromium.launch();
  const page = await browser.newPage({viewport: {width: 900, height: 700}, hasTouch: true});
  page.setDefaultTimeout(15000);
  await page.addInitScript(() => localStorage.clear());
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
  const visit = async query => {
    await page.goto(`http://127.0.0.1:3196/__cpx_face${query}`);
    await page.locator('[data-cpx-pixel="0"]').waitFor();
  };
  const pixelProof = async () => {
    const pixels = await page.locator('[data-cpx-pixel]').evaluateAll(nodes => nodes.map(n => ({
      x: +n.getAttribute('cx'), y: +n.getAttribute('cy'), fill: n.getAttribute('fill')
    })));
    assert.equal(pixels.length, 10);
    assert.equal(pixels[0].fill, 'rgb(255, 0, 0)');
    assert.equal(pixels[1].fill, 'rgb(0, 255, 0)');
    assert.equal(pixels[2].fill, 'rgb(0, 0, 255)');
    // Indexed physical positions, independently fixed to the original art.
    assert.ok(Math.abs(pixels[0].x - 59.00125) < 0.002, 'pixel 0 physical x');
    assert.ok(Math.abs(pixels[0].y - 36.007125) < 0.002, 'pixel 0 physical y');
  };
  const buttonProof = async () => {
    await page.locator('[data-cpx-button="A"]').click();
    assert.deepEqual(await page.evaluate(() => window.events), [{button: 'A', down: true}, {button: 'A', down: false}]);
  };
  await visit('');
  await pixelProof();
  assert.equal(await page.locator('[data-cpx-red-led]').getAttribute('data-cpx-red-led'), 'unavailable');
  await buttonProof();
  assert.equal(await page.evaluate(() => window.parentInputs), 0, 'Face input must not start board dragging');
  await page.evaluate(() => { window.events = []; });
  const b = page.locator('[data-cpx-button="B"]');
  await b.focus();
  await page.keyboard.down('Space');
  assert.equal(await b.getAttribute('aria-pressed'), 'true');
  await page.keyboard.up('Space');
  assert.deepEqual(await page.evaluate(() => window.events), [{button: 'B', down: true}, {button: 'B', down: false}]);
  await page.locator('[data-cpx-switch]').tap();
  assert.equal(await page.locator('[data-cpx-switch]').getAttribute('aria-pressed'), 'true');
  await page.evaluate(() => { window.events = []; });
  const a = page.locator('[data-cpx-button="A"]');
  await a.dispatchEvent('pointerdown', {pointerId: 1});
  await a.dispatchEvent('pointercancel', {pointerId: 1});
  assert.deepEqual(await page.evaluate(() => window.events), [{button: 'A', down: true}, {button: 'A', down: false}]);
  await page.evaluate(() => { window.events = []; });
  const heldBox = await a.boundingBox();
  await page.mouse.move(heldBox.x + heldBox.width / 2, heldBox.y + heldBox.height / 2);
  await page.mouse.down();
  assert.equal(await a.getAttribute('aria-pressed'), 'true');
  await page.evaluate(() => window.setActive(false));
  await page.locator('[data-cpx-button="A"][aria-disabled="true"]').waitFor();
  assert.deepEqual(await page.evaluate(() => window.events), [{button: 'A', down: true}, {button: 'A', down: false}],
    'Callback removal releases through the callback which received the press');
  await page.mouse.up();
  await page.evaluate(() => { window.events = []; });
  const passive = await page.locator('[data-cpx-button="A"][aria-disabled="true"]').boundingBox();
  await page.mouse.click(passive.x + passive.width / 2, passive.y + passive.height / 2);
  assert.deepEqual(await page.evaluate(() => window.events), [], 'Passive face must not write');
  await page.evaluate(() => window.setFace({shown: Array(10).fill(0), buttons: {}, redLed: true}));
  assert.equal(await page.locator('[data-cpx-red-led="true"]').getAttribute('fill'), '#ff0000');
  await page.evaluate(() => { window.events = []; window.setActive(true); });
  await page.locator('[data-cpx-button="A"][aria-disabled="false"]').focus();
  await page.keyboard.down('Enter');
  await page.evaluate(() => window.unmountFace());
  assert.deepEqual(await page.evaluate(() => window.events), [{button: 'A', down: true}, {button: 'A', down: false}],
    'Unmount releases a held runtime button');
  await page.keyboard.up('Enter');
  await visit('?mutant=positions');
  await assert.rejects(pixelProof, /pixel 0 physical x/);
  await visit('?mutant=callback');
  await assert.rejects(buttonProof, /Expected values to be strictly deep-equal/);
  await page.goto('http://127.0.0.1:3196/__cpx_face?designer=onboard&mutant=onboard');
  await page.waitForFunction(() => window.observedCircuit?.parts.some(p => p.kind === 'vsource'));
  const onboardProof = async () => assert.equal(await page.locator('[data-board-face="circuit_playground_express"]').count(), 1,
    'Onboard-only CPX must place its board');
  await assert.rejects(onboardProof, /Onboard-only CPX must place its board/);
  await visit('?designer=onboard');
  await page.locator('[data-board-face="circuit_playground_express"] [data-cpx-live-face="live"]').waitFor();
  await onboardProof();
  assert.equal(await page.evaluate(() => window.observedCircuit.parts.filter(p => p.kind === 'circuit_playground_express').length), 1);
  await page.goto('http://127.0.0.1:3196/__cpx_face?designer=transition');
  await page.waitForFunction(() => window.observedCircuit?.parts.some(p => p.kind === 'led'));
  await page.evaluate(() => window.pickCpx());
  await page.locator('[data-board-face="circuit_playground_express"]').waitFor();
  assert.equal(await page.evaluate(() => window.observedCircuit.parts.some(p => p.kind === 'vsource')), false);
  await page.goto('http://127.0.0.1:3196/__cpx_face?designer=file');
  await page.waitForFunction(() => window.observedCircuit?.parts.some(p => p.id === 'kept'));
  assert.equal(await page.locator('[data-board-face="circuit_playground_express"]').count(), 0, 'Explicit circuit file wins');
  assert.deepEqual(errors, [], 'No page errors, including negative controls');
  console.log('CPX face: physical pixels, host state, rotated mouse/touch/keyboard inputs, cancellation, passive face, onboard-only placement, explicit-file precedence and three source mutations pass');
} finally {
  await browser?.close();
  await server?.close();
  for (const file of files) await unlink(new URL(`../${file}`, import.meta.url));
}

import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
let server, browser;
try {
  server = await createServer({ root, server: { host: '127.0.0.1', port: 0 },
    plugins: [{ name: 's040-face-fixture', configureServer(s) {
      s.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/__s040_face') || req.url.includes('html-proxy')) return next();
        try {
          const html = `<!doctype html><html><body style="margin:0"><div id="root"></div><script type="module">
            import React from 'react';
            import {createRoot} from 'react-dom/client';
            import {Esp32S040Face} from '/src/components/Esp32S040Face.jsx';
            const mode = new URLSearchParams(location.search).get('mode');
            let Designer;
            if (mode) {
              const [{setEngine}, {BoardImpl}, {inferNetlist, checkWiring}, {getDevice}, {registerAllDevices}] = await Promise.all([
                import('/src/engine.js'), import('bw-board/board.js'), import('bw-board/infer-netlist.js'),
                import('bw-board/devices.js'), import('bw-board/register-all.js')]);
              registerAllDevices(); setEngine({BoardImpl, inferNetlist, checkWiring, getDevice});
              await import('/src/model/sidecar-loader.js');
              Designer = (await import('/src/components/CircuitDesigner.jsx')).CircuitDesigner;
            }
            const root = createRoot(document.getElementById('root'));
            const rgba = new Uint8Array(480*480*4);
            for (let y=0; y<480; y++) for(let x=0; x<480; x++) {
              const k=(y*480+x)*4;
              const rgb=y<240 ? (x<240 ? [255,0,0]:[0,255,0]) : (x<240 ? [0,0,255]:[255,255,255]);
              rgba.set([...rgb,255],k);
            }
            let frame={width:480,height:480,rgba,frame:1,signal:true,
              panel:{displayOn:true,sleeping:false,backlightOn:true,powered:true,framesReceived:1}};
            const video=()=>frame;
            window.events=[];window.otherEvents=[];window.parentInputs=0;
            const input=changes=>window.events.push(changes);
            const otherInput=changes=>window.otherEvents.push(changes);
            let sink=input, active=true, mounted=true, rotation=0, flip=false, owner='panel-a';
            let project={device:mode==='transition'?'pico':'esp32-4848s040',pins:[]};
            const file={vcc:5,fileOnly:true,parts:mode==='explicit-file' ?
              [{id:'kept',kind:'resistor',params:{ohms:470},x:150,y:150,terminals:['a','b']}] :
              [{id:'panel-a',kind:'esp32_4848s040',params:{},x:300,y:240},
               {id:'panel-b',kind:'esp32_4848s040',params:{},x:770,y:240}],wires:[],holeWires:[]};
            const ready=circuit=>{window.observedCircuit=circuit;};
            function render() {
              if (!mounted) {root.unmount();return;}
              if (Designer) {
                root.render(React.createElement(Designer,{project,debugState:{video},esp32S040PartId:owner,
                  onEsp32S040Input:active?sink:null,onCircuitReady:ready,
                  ...(mode==='owners'||mode==='explicit-file'?{circuitData:file}:{})}));
              } else {
                root.render(React.createElement('svg',{width:900,height:650,viewBox:'0 0 900 650',onPointerDown:()=>window.parentInputs++},
                  React.createElement('g',{transform:'translate(450 325) rotate('+rotation+') scale('+(flip?-1:1)+' 1)'},
                    React.createElement(Esp32S040Face,{width:420,height:280,videoFn:video,onInput:active?sink:null}))));
              }
            }
            window.setFrame=next=>{frame=next===null?null:{...frame,...next};};
            window.setPanel=next=>{frame={...frame,panel:{...frame.panel,...next}};};
            window.setActive=value=>{active=value;render();};
            window.replaceOwner=()=>{sink=otherInput;render();};
            window.setPose=(r,f)=>{rotation=r;flip=f;render();};
            window.bindOwner=value=>{owner=value;render();};
            window.pickS040=()=>{project={...project,device:'esp32-4848s040'};render();};
            window.unmountFace=()=>{mounted=false;render();};
            render();
          </script></body></html>`;
          res.setHeader('Content-Type', 'text/html');
          res.end(await s.transformIndexHtml(req.url, html));
        } catch (error) { next(error); }
      });
    }}] });
  await server.listen();
  const port = server.httpServer.address().port;
  browser = await chromium.launch(process.env.BW_S040_CHROMIUM ? { executablePath: process.env.BW_S040_CHROMIUM } : {});
  const page = await browser.newPage({ viewport: { width: 1200, height: 850 }, hasTouch: true });
  page.setDefaultTimeout(15000);
  await page.addInitScript(() => localStorage.clear());
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const visit = async query => {
    await page.goto(`http://127.0.0.1:${port}/__s040_face${query || ''}`);
    await page.locator('[data-esp32-s040-live-face]').first().waitFor();
  };
  const live = () => page.locator('[data-esp32-s040-live-face="live"]').first();
  const screen = () => live().locator('[data-esp32-s040-touch]');
  const at = async (x, y) => screen().evaluate((el, p) => {
    const point = new DOMPoint(16+(p.x+0.5)*124/480,16+(p.y+0.5)*124/480).matrixTransform(el.getScreenCTM());
    return { x: point.x, y: point.y };
  }, { x, y });
  const down = async (x, y) => { const p = await at(x, y); await page.mouse.move(p.x, p.y); await page.mouse.down(); };
  const resetEvents = () => page.evaluate(() => { window.events=[];window.otherEvents=[];window.parentInputs=0; });
  const events = () => page.evaluate(() => window.events);
  const expectedDown = (x, y) => [
    {component:'touch',channel:'x',value:x}, {component:'touch',channel:'y',value:y}, {component:'touch',channel:'pressed',value:1},
  ];
  const up = [{component:'touch',channel:'pressed',value:0}];

  await visit(); await live().waitFor();
  const pixelProof = await live().locator('canvas').evaluate(el => [[20,20],[460,20],[20,460],[460,460]]
    .map(([x,y])=>Array.from(el.getContext('2d').getImageData(x,y,1,1).data)));
  assert.deepEqual(pixelProof, [[255,0,0,255],[0,255,0,255],[0,0,255,255],[255,255,255,255]], 'RGBA corners come from the host frame');
  for (const [rotation, flip] of [[0,false],[90,false],[180,false],[270,false],[90,true]]) {
    await page.evaluate(([r,f])=>window.setPose(r,f),[rotation,flip]);
    await page.waitForFunction(([r,f])=>document.querySelector('g[transform]').getAttribute('transform').includes('rotate('+r+') scale('+(f?-1:1)),[rotation,flip]);
    await resetEvents();
    await down(120,360); await page.mouse.up();
    assert.deepEqual(await events(), [expectedDown(120,360),up], `mouse coordinates at rotation ${rotation}, flip ${flip}`);
    assert.equal(await page.evaluate(()=>window.parentInputs),0,'screen input must not drag the board');
  }
  await page.evaluate(()=>window.setPose(0,false));
  await page.waitForFunction(()=>document.querySelector('g[transform]').getAttribute('transform')==='translate(450 325) rotate(0) scale(1 1)');
  await resetEvents(); await down(240,240);
  const outside=await at(-120,600); await page.mouse.move(outside.x,outside.y); await page.mouse.up();
  const drag=await events();
  assert.deepEqual(drag[0],expectedDown(240,240));
  assert.ok(drag.some(batch=>batch.length===2&&batch[0].value===0&&batch[1].value===479),'captured drag clamps to the last valid pixel');
  assert.deepEqual(drag.at(-1),up);

  // Real CDP touches produce browser pointer capture and ownership events.
  const cdp=await page.context().newCDPSession(page);
  const a=await at(80,160),b=await at(320,40);
  await resetEvents();
  const touch=(type,points)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points});
  await touch('touchStart',[{id:1,x:a.x,y:a.y}]);
  await touch('touchStart',[{id:1,x:a.x,y:a.y},{id:2,x:b.x,y:b.y}]);
  await touch('touchEnd',[{id:2,x:b.x,y:b.y}]);
  assert.deepEqual(await events(),[expectedDown(80,160)],'the second finger cannot release or replace the first contact');
  await touch('touchCancel',[]);
  assert.deepEqual(await events(),[expectedDown(80,160),up],'touch cancellation releases once');
  assert.equal(await page.evaluate(()=>window.parentInputs),0,'ignored secondary touch cannot start board movement');

  await resetEvents();await down(100,200);
  await screen().evaluate(el=>el.dispatchEvent(new PointerEvent('lostpointercapture',{pointerId:1,bubbles:true})));
  await page.mouse.up();
  assert.deepEqual(await events(),[expectedDown(100,200),up],'lost capture releases once');

  await resetEvents();await down(100,200);await page.evaluate(()=>window.replaceOwner());
  await page.waitForFunction(()=>window.events.length===2);await page.mouse.up();
  assert.deepEqual(await events(),[expectedDown(100,200),up],'replacement releases the old target');
  assert.deepEqual(await page.evaluate(()=>window.otherEvents),[],'the new target cannot inherit a held touch');

  await visit();await live().waitFor();await down(100,200);await page.evaluate(()=>window.setActive(false));
  await page.waitForFunction(()=>window.events.length===2);await page.mouse.up();
  assert.deepEqual(await events(),[expectedDown(100,200),up],'removing the input callback releases');
  await page.evaluate(()=>window.setActive(true));await resetEvents();await down(100,200);
  await page.evaluate(()=>window.setPanel({backlightOn:false}));
  await page.locator('[data-esp32-s040-live-face="backlight-off"]').waitFor();await page.mouse.up();
  assert.deepEqual(await events(),[expectedDown(100,200),up],'panel loss releases and removes stale pixels');
  assert.deepEqual(await page.locator('canvas').evaluate(el=>Array.from(el.getContext('2d').getImageData(20,20,1,1).data)),[8,13,21,255]);
  assert.equal(await page.locator('[data-esp32-s040-touch]').getAttribute('aria-disabled'),'true');
  await page.evaluate(()=>window.setFrame(null));await page.locator('[data-esp32-s040-live-face="unavailable"]').waitFor();

  await visit();await live().waitFor();await down(100,200);await page.evaluate(()=>window.unmountFace());await page.mouse.up();
  assert.deepEqual(await events(),[expectedDown(100,200),up],'unmount releases to the captured target');

  await visit('?mode=owners');await live().waitFor();
  assert.equal(await page.locator('[data-board-face="esp32_4848s040"]').count(),2);
  assert.equal(await page.locator('[data-esp32-s040-live-face="live"]').count(),1,'only the exact owning board gets target video');
  assert.equal(await page.locator('[data-esp32-s040-live-face="unavailable"]').count(),1);
  if (process.env.BW_S040_SCREENSHOT) await page.screenshot({ path: process.env.BW_S040_SCREENSHOT });
  assert.equal(await live().locator('..').getAttribute('data-esp32-s040-owner'),'panel-a');
  await resetEvents(); await down(40,50); await page.mouse.up();
  assert.deepEqual(await events(),[expectedDown(40,50),up],'the actual Designer/BoardCanvas forwards typed input for its owner');
  await resetEvents();
  await page.locator('[data-esp32-s040-live-face="unavailable"] canvas').click({force:true});
  assert.deepEqual(await events(),[],'an unbound placed board cannot write to the target');
  await page.evaluate(()=>window.bindOwner('panel-b'));
  await page.locator('[data-esp32-s040-owner="panel-b"] [data-esp32-s040-live-face="live"]').waitFor();
  assert.equal(await page.locator('[data-esp32-s040-owner=""] [data-esp32-s040-live-face="unavailable"]').count(),1);

  await visit('?mode=onboard');
  await page.waitForFunction(()=>window.observedCircuit?.parts.some(p=>p.kind==='esp32_4848s040'));
  assert.deepEqual(await page.evaluate(()=>window.observedCircuit.parts.map(p=>p.kind)),['esp32_4848s040'],'display-only program places its board without a canned blink bench');
  await page.goto(`http://127.0.0.1:${port}/__s040_face?mode=transition`);
  await page.waitForFunction(()=>window.observedCircuit?.parts.some(p=>p.kind==='led'));
  await page.evaluate(()=>window.pickS040());
  await page.locator('[data-board-face="esp32_4848s040"]').waitFor();
  assert.deepEqual(await page.evaluate(()=>window.observedCircuit.parts.map(p=>p.kind)),['esp32_4848s040']);
  await page.goto(`http://127.0.0.1:${port}/__s040_face?mode=explicit-file`);
  await page.waitForFunction(()=>window.observedCircuit?.parts.some(p=>p.id==='kept'));
  assert.equal(await page.locator('[data-board-face="esp32_4848s040"]').count(),0,'explicit circuit file takes precedence');
  assert.deepEqual(errors,[],'no browser runtime errors');
  console.log(`S040 face: host RGBA, rotated/mirrored mouse, captured drag, single-contact touch, cancel/lost capture, owner replacement, callback removal, blanking, unmount, explicit board ownership, onboard-only placement, target transition and explicit-file precedence pass; ${await browser.version()}`);
} finally {
  await browser?.close();
  await server?.close();
}

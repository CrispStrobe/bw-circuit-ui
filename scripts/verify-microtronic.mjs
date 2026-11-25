#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Full CircuitDesigner interaction gate. No vendor firmware or mock clock.
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {createMicrotronicConnectorAssets} from './generate-microtronic-connector.mjs';

const base = process.argv[2];
assert.ok(base, 'Pass the dev harness URL, or use npm run verify:microtronic:browser.');
const output=path.resolve(process.env.BW_MICROTRONIC_BROWSER_OUT || 'test-results/microtronic-browser');
await mkdir(output,{recursive:true});
const checks=[],pageErrors=[];
let browser,page;
const {sidecar}=createMicrotronicConnectorAssets();
try {
  browser=await chromium.launch({headless:true,
    ...(process.env.BW_CHROMIUM_EXECUTABLE ? {executablePath:process.env.BW_CHROMIUM_EXECUTABLE} : {})});
  page=await browser.newPage({viewport:{width:1400,height:960}});
  page.on('pageerror',error=>pageErrors.push(error.message));
  await page.goto(`${base}/?examples=none&nopins`,{waitUntil:'networkidle'});
  await page.waitForFunction(()=>typeof window.__setCircuitData==='function');
  await page.getByRole('button',{name:'Busch Microtronic 2090',exact:true}).click();
  await page.locator('[data-canvas]').click({position:{x:400,y:150}});
  await page.waitForSelector('[data-microtronic-panel]');
  let panel=page.locator('[data-microtronic-panel]').first();
  const firstId=await panel.getAttribute('data-microtronic-panel');
  await page.waitForSelector(`[data-canvas] [data-part-id="${firstId}"][data-art-loaded="true"]`);
  assert.equal(await panel.locator('[data-microtronic-key]').count(),24);
  checks.push('palette places a wired-capable part and opens its complete front panel');

  await panel.getByRole('textbox',{name:'Microtronic program',exact:true}).fill('00: 1A0\n01: FE0\n02: F00');
  await panel.locator('[data-microtronic-action="run"]').click();
  await page.waitForFunction(id=>{
    const s=window.__board?.getDeviceState(id); return s?.output===10 && !s.running && s.pc===2;
  },firstId);
  checks.push('Run applies dirty editor and starts the shared clock without resetting the accepted run');

  const beforeInvalid=await page.evaluate(id=>window.__circuit.getPart(id).params.program,firstId);
  await panel.getByRole('textbox',{name:'Microtronic program',exact:true}).fill('00: WRONG');
  await panel.locator('[data-microtronic-load]').click();
  await panel.getByRole('alert').waitFor();
  assert.equal(await page.evaluate(id=>window.__circuit.getPart(id).params.program,firstId),beforeInvalid);
  await panel.locator('input[type="file"]').setInputFiles({name:'authored-echo.mic',mimeType:'text/plain',buffer:Buffer.from('FD0\nFE0\nC00')});
  await page.waitForFunction(()=>document.querySelector('[data-microtronic-panel] textarea')?.value==='FD0\nFE0\nC00');
  await panel.locator('[data-microtronic-load]').click();
  assert.equal(await panel.getByRole('alert').count(),0);
  checks.push('invalid load is atomic; a local learner-program file loads through the visible editor');

  await panel.getByRole('button',{name:'Open wired I/O example',exact:true}).click();
  await page.waitForSelector('[data-microtronic-panel="microtronic"]');
  panel=page.locator('[data-microtronic-panel="microtronic"]');
  await page.locator('[data-switch-control="input1"]').click();
  await page.locator('[data-switch-control="input3"]').click();
  await panel.locator('[data-microtronic-action="run"]').click();
  await page.waitForFunction(()=>{
    const b=window.__board,s=b?.getDeviceState('microtronic');
    return s?.running && (s.output&7)===5 && b.ledBrightness('lamp1')>0.01 && b.ledBrightness('lamp3')>0.01;
  });
  await page.waitForFunction(()=>window.__board?.getDeviceState('microtronic')?.output===13);
  await page.waitForFunction(()=>window.__board?.getDeviceState('microtronic')?.output===5);
  checks.push('visible switches conduct through IN1/IN3 and light external LEDs; wired CLOCK makes OUT4 toggle');
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(output,'microtronic-desktop.png'),fullPage:true});

  await panel.locator('[data-microtronic-action="halt"]').click();
  const halted=await page.evaluate(()=>{const b=window.__board,s=b.getDeviceState('microtronic');return {pc:s.pc,output:s.output,t:String(b.getTime())};});
  await page.waitForFunction(t=>window.__board.getTime()>BigInt(t)+600_000_000n,halted.t);
  assert.deepEqual(await page.evaluate(()=>{const s=window.__board.getDeviceState('microtronic');return {pc:s.pc,output:s.output};}),{pc:halted.pc,output:halted.output});
  await panel.locator('[data-microtronic-action="step"]').click();
  assert.notEqual(await page.evaluate(()=>window.__board.getDeviceState('microtronic').pc),halted.pc);
  await panel.locator('[data-microtronic-action="reset"]').click();
  assert.equal(await page.evaluate(()=>window.__board.getDeviceState('microtronic').pc),0);
  for(const key of ['HALT','NEXT','0','5','1','A','2','NEXT']) await panel.locator(`[data-microtronic-key="${key}"]`).click();
  assert.equal(await page.evaluate(()=>window.__board.getDeviceState('microtronic').program[5]),0x1A2);
  assert.match(await page.evaluate(()=>window.__circuit.getPart('microtronic').params.program),/05: 1A2/);
  checks.push('Halt retains outputs while the circuit clock advances; Step, Reset and keypad NEXT are live and persistent');

  const draft='00: 1B0\n01: FE0\n02: F00';
  await panel.getByRole('textbox',{name:'Microtronic program',exact:true}).fill(draft);
  const tick=await page.evaluate(()=>String(window.__board.getTime()));
  await page.waitForFunction(t=>window.__board.getTime()>BigInt(t)+300_000_000n,tick);
  assert.equal(await panel.getByRole('textbox',{name:'Microtronic program',exact:true}).inputValue(),draft);
  await panel.locator('[data-microtronic-action="run"]').click();
  await page.waitForFunction(()=>window.__board.getDeviceState('microtronic')?.output===11);
  const saved=await page.evaluate(()=>window.__circuit.toJSON());
  await page.evaluate(data=>window.__setCircuitData(data),saved);
  await page.waitForFunction(()=>window.__board.getDeviceState('microtronic')?.program[0]===0x1B0 && window.__board.getDeviceState('microtronic')?.output===0);
  assert.equal(await page.evaluate(()=>window.__circuit.getPart('microtronic').params.program),saved.parts.find(p=>p.id==='microtronic').params.program);
  checks.push('unloaded editor draft survives live rerenders; saving and loading the circuit retains the accepted program');

  for(const rotation of [0,90,180,270]) for(const flipped of [false,true]) {
    const fixture={vcc:5,fileOnly:true,parts:[{id:'geometry',kind:'busch-microtronic',x:350,y:250,rotation,flipped,
      params:{program:'F00'},terminals:sidecar.terminals.map(t=>t.name)}],wires:[],holeWires:[]};
    await page.evaluate(data=>window.__setCircuitData(data),fixture);
    await page.waitForSelector('[data-canvas] [data-part-id="geometry"][data-art-loaded="true"]');
    await page.waitForFunction(({rotation,flipped})=>{const p=window.__circuit.getPart('geometry');return p.rotation===rotation && !!p.flipped===flipped;},{rotation,flipped});
    await page.locator('[data-canvas] [data-part-id="geometry"]').click();
    await page.waitForSelector('[data-canvas] [data-terminal-dot="geometry:IN1"]');
    const failures=await page.evaluate(async terminals=>{
      const face=document.querySelector('[data-canvas] [data-part-id="geometry"]'),image=face.querySelector('image');
      const art=new DOMParser().parseFromString(await (await fetch(image.getAttribute('href'))).text(),'image/svg+xml');
      return terminals.flatMap(t=>{
        const contact=art.querySelector(`[data-terminal="${t.name}"] circle`);
        const dot=document.querySelector(`[data-canvas] [data-terminal-dot="geometry:${t.name}"] circle`);
        if(!contact||!dot)return[`Missing ${t.name}`];
        const drawn=new DOMPoint(+image.getAttribute('x') + +contact.getAttribute('cx'),+image.getAttribute('y') + +contact.getAttribute('cy')).matrixTransform(face.getCTM());
        const wired=new DOMPoint(+dot.getAttribute('cx'),+dot.getAttribute('cy')).matrixTransform(dot.getCTM());
        return Math.hypot(drawn.x-wired.x,drawn.y-wired.y)>0.01?[`Displaced ${t.name}`]:[];
      });
    },sidecar.terminals);
    assert.deepEqual(failures,[],`contacts at ${rotation}°, mirrored ${flipped}`);
  }
  checks.push('all eleven SVG contacts agree with real wire targets through every quarter turn and mirror');
  const two={vcc:5,fileOnly:true,parts:['one','two'].map((id,i)=>({id,kind:'busch-microtronic',x:200+i*300,y:250,params:{program:'1F0\nFE0\nF00'},terminals:sidecar.terminals.map(t=>t.name)})),wires:[]};
  await page.evaluate(data=>window.__setCircuitData(data),two);
  await page.waitForSelector('[data-microtronic-panel="one"]');
  await page.locator('[data-microtronic-panel="one"] [data-microtronic-action="run"]').click();
  await page.waitForFunction(()=>window.__board.getDeviceState('one')?.output===15);
  assert.deepEqual(await page.evaluate(()=>{const s=window.__board.getDeviceState('two');return[s.pc,s.output,s.running];}),[0,0,false]);
  checks.push('two panels control distinct board instances on one circuit');

  await page.setViewportSize({width:390,height:844});
  await page.waitForFunction(()=>document.querySelector('[data-microtronic-panel="one"]')?.getBoundingClientRect().width >= 300);
  await page.locator('[data-microtronic-panel="one"]').scrollIntoViewIfNeeded();
  const overflow=await page.evaluate(()=>{
    const panel=document.querySelector('[data-microtronic-panel="one"]');
    return {viewport:innerWidth,width:document.documentElement.scrollWidth,panel:panel.getBoundingClientRect().width};
  });
  assert.ok(overflow.width<=overflow.viewport+1,JSON.stringify(overflow));
  assert.ok(overflow.panel>=300 && overflow.panel<=390, 'the six-column keypad retains a usable phone width');
  await page.screenshot({path:path.join(output,'microtronic-mobile.png'),fullPage:true});
  assert.deepEqual(pageErrors,[]);
  const result={status:'passed',browser:browser.version(),checks,
    scope:'Actual CircuitDesigner; engine-owned learner VM and shared circuit clock; no native firmware execution',fullApplicationBuild:false};
  await writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
} catch(error) {
  if(page) await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});
  await writeFile(path.join(output,'failure.json'),JSON.stringify({error:String(error.stack||error),pageErrors,checks},null,2)+'\n');
  throw error;
} finally { await browser?.close(); }

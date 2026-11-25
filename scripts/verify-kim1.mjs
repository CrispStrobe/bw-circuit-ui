#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Actual CircuitDesigner, installed engine, visible controls and real electrical nets.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {createKim1ConnectorAssets} from './generate-kim1-connector.mjs';

const base=process.argv[2];
assert.ok(base,'Pass the designer harness URL, or run npm run verify:kim1:browser.');
const output=path.resolve(process.env.BW_KIM1_BROWSER_OUT||'test-results/kim1-browser');
await mkdir(output,{recursive:true});
const checks=[],pageErrors=[],{sidecar}=createKim1ConnectorAssets();
let browser,page;
try {
  browser=await chromium.launch({headless:true,...(process.env.BW_CHROMIUM_EXECUTABLE?{executablePath:process.env.BW_CHROMIUM_EXECUTABLE}:{})});
  page=await browser.newPage({viewport:{width:1400,height:960}});
  page.on('pageerror',error=>pageErrors.push(error.message));
  await page.goto(base+'/?examples=none&nopins',{waitUntil:'networkidle'});
  await page.waitForFunction(()=>typeof window.__setCircuitData==='function');
  await page.getByRole('button',{name:'KIM-1',exact:true}).click();
  await page.locator('[data-canvas]').click({position:{x:400,y:150}});
  await page.waitForSelector('[data-kim1-panel]');
  let panel=page.locator('[data-kim1-panel]').first();
  const firstId=await panel.getAttribute('data-kim1-panel');
  await page.waitForSelector('[data-canvas] [data-part-id="'+firstId+'"][data-art-loaded="true"]');
  assert.equal(await panel.locator('[data-kim1-key]').count(),23);
  checks.push('palette places KIM-1 with all 23 keys, SST switch and original connector artwork');

  await panel.getByRole('textbox',{name:'KIM-1 program',exact:true}).fill('0200: A9 2A 8D 00 03 00');
  await panel.locator('[data-kim1-key="GO"]').click();
  await page.waitForFunction(id=>{
    const state=window.__board?.getDeviceState(id);
    return state?.ram[0x300]===42&&!state.running&&state.cpu.a===42;
  },firstId);
  checks.push('GO applies the dirty editor and the actual NMOS CPU stores 42 in RAM before BRK stops');
  const beforeIo=await page.evaluate(id=>window.__circuit.getPart(id).params.program,firstId);
  for(const key of ['AD','1','7','0','1','DA','F','F','AD','1','7','0','0','DA','A','5']) {
    await panel.locator('[data-kim1-key="'+key+'"]').click();
  }
  assert.deepEqual(await page.evaluate(id=>{const s=window.__board.getDeviceState(id);return[s.ddrA,s.portA,s.running];},firstId),[255,165,false]);
  assert.equal(await page.evaluate(id=>window.__circuit.getPart(id).params.program,firstId),beforeIo);
  checks.push('AD/DA writes actual DDR and port registers while preserving the saved RAM image');


  const accepted=await page.evaluate(id=>window.__circuit.getPart(id).params.program,firstId);
  await panel.getByRole('textbox',{name:'KIM-1 program',exact:true}).fill('0200: WRONG');
  await panel.locator('[data-kim1-load]').click();
  await panel.getByRole('alert').waitFor();
  assert.equal(await page.evaluate(id=>window.__circuit.getPart(id).params.program,firstId),accepted);
  await panel.locator('input[accept*=".ptp"]').setInputFiles({name:'authored-step.hex',mimeType:'text/plain',buffer:Buffer.from('0200: A9 17 A2 42 00')});
  await page.waitForFunction(()=>document.querySelector('[data-kim1-panel] textarea')?.value==='0200: A9 17 A2 42 00');
  await panel.locator('[data-kim1-load]').click();
  assert.equal(await panel.getByRole('alert').count(),0);
  await panel.locator('[data-kim1-sst]').check();
  await panel.locator('[data-kim1-key="GO"]').click();
  assert.deepEqual(await page.evaluate(id=>{const s=window.__board.getDeviceState(id);return[s.cpu.a,s.pc,s.running];},firstId),[23,0x0202,false]);
  for(const key of ['AD','0','3','0','0','PC']) await panel.locator('[data-kim1-key="'+key+'"]').click();
  assert.equal(await page.evaluate(id=>window.__board.getDeviceState(id).address,firstId),0x0202);
  await panel.locator('[data-kim1-key="GO"]').click();
  assert.equal(await page.evaluate(id=>window.__board.getDeviceState(id).cpu.x,firstId),0x42);
  await panel.locator('[data-kim1-key="RS"]').click();
  assert.equal(await panel.locator('[data-kim1-sst]').isChecked(),true,'RS retains the physical SST position');
  await panel.locator('[data-kim1-key="GO"]').click();
  assert.deepEqual(await page.evaluate(id=>{const s=window.__board.getDeviceState(id);return[s.pc,s.running];},firstId),[0x0202,false]);
  await panel.locator('[data-kim1-sst]').uncheck();
  checks.push('invalid load is atomic; an imported file, SST and PC work through the visible front panel');

  for(const key of ['AD','0','3','0','0','DA','A','5','+']) await panel.locator('[data-kim1-key="'+key+'"]').click();
  assert.equal(await page.evaluate(id=>window.__board.getDeviceState(id).ram[0x300],firstId),0xa5);
  assert.equal(await page.evaluate(id=>window.__board.getDeviceState(id).address,firstId),0x0301);
  await panel.locator('[data-kim1-key="RS"]').click();
  assert.equal(await page.evaluate(id=>window.__board.getDeviceState(id).ram[0x300],firstId),0xa5);
  const exportPromise=page.waitForEvent('download');
  await panel.getByRole('button',{name:'Save',exact:true}).click();
  const exported=await exportPromise;
  const exportedSource=await readFile(await exported.path(),'utf8');
  assert.equal(exportedSource,await page.evaluate(id=>window.__circuit.getPart(id).params.program,firstId));
  assert.match(exportedSource,/0300: A5/);
  checks.push('DA keypad entry persists, + advances and RS retains RAM; Save exports the accepted bytes');

  const saved=await page.evaluate(()=>window.__circuit.toJSON());
  await page.evaluate(data=>window.__setCircuitData(data),saved);
  await page.waitForFunction(id=>window.__board.getDeviceState(id)?.ram[0x300]===0xa5,firstId);
  assert.equal(await page.evaluate(id=>window.__circuit.getPart(id).params.program,firstId),exportedSource);
  checks.push('circuit save/load restores the exact accepted source and keypad-edited RAM');

  await panel.getByRole('button',{name:'Open wired I/O example',exact:true}).click();
  await page.waitForSelector('[data-kim1-panel="kim1"]');
  panel=page.locator('[data-kim1-panel="kim1"]');
  await page.locator('[data-switch-control="input0"]').click();
  await page.locator('[data-switch-control="input2"]').click();
  await panel.locator('[data-kim1-key="GO"]').click();
  await page.waitForFunction(()=>{
    const board=window.__board,state=board?.getDeviceState('kim1');
    return state?.running&&(state.portB&15)===5&&(state.portA&15)===5&&
      board.ledBrightness('lamp0')>0.01&&board.ledBrightness('lamp2')>0.01&&board.ledBrightness('lamp1')===0;
  });
  await panel.scrollIntoViewIfNeeded();
  const clippedWires=await page.evaluate(()=>{
    const canvas=document.querySelector('[data-canvas-svg]').getBoundingClientRect();
    return [...document.querySelectorAll('[data-canvas-svg] [data-wire] path')].flatMap(path=>{
      const bounds=path.getBoundingClientRect();
      return bounds.left<canvas.left-1||bounds.right>canvas.right+1||bounds.top<canvas.top-1||bounds.bottom>canvas.bottom+1
        ?[path.closest('[data-wire]').getAttribute('data-wire')]:[];
    });
  });
  assert.deepEqual(clippedWires,[],'the wired lesson fits without clipping its supply rails');
  await page.screenshot({path:path.join(output,'kim1-desktop.png'),fullPage:true});
  checks.push('visible switches drive PB0/PB2 and real PA0/PA2 LEDs; all lesson wires fit in the canvas');

  await panel.locator('[data-kim1-key="ST"]').click();
  const stopped=await page.evaluate(()=>{const b=window.__board,s=b.getDeviceState('kim1');return{pc:s.pc,portA:s.portA,t:String(b.getTime())};});
  await page.locator('[data-switch-control="input0"]').click();
  await page.waitForFunction(t=>window.__board.getTime()>BigInt(t)+300_000_000n,stopped.t);
  assert.deepEqual(await page.evaluate(()=>{const s=window.__board.getDeviceState('kim1');return{pc:s.pc,portA:s.portA};}),{pc:stopped.pc,portA:stopped.portA});
  assert.equal(await page.evaluate(()=>window.__board.getDeviceState('kim1').portB&15),4);
  const draft='0200: A9 33 00';
  await panel.getByRole('textbox',{name:'KIM-1 program',exact:true}).fill(draft);
  const tick=await page.evaluate(()=>String(window.__board.getTime()));
  await page.waitForFunction(t=>window.__board.getTime()>BigInt(t)+200_000_000n,tick);
  assert.equal(await panel.getByRole('textbox',{name:'KIM-1 program',exact:true}).inputValue(),draft);
  checks.push('ST freezes this CPU while the circuit clock and inputs continue; live rerenders preserve an unloaded draft');

  for(const rotation of [0,90,180,270]) for(const flipped of [false,true]) {
    const fixture={vcc:5,fileOnly:true,parts:[{id:'geometry',kind:'kim-1',x:350,y:250,rotation,flipped,
      params:{program:'0200: EA',clockHz:1000},terminals:sidecar.terminals.map(t=>t.name)}],wires:[],holeWires:[]};
    await page.evaluate(data=>window.__setCircuitData(data),fixture);
    await page.waitForSelector('[data-canvas] [data-part-id="geometry"][data-art-loaded="true"]');
    await page.waitForFunction(({rotation,flipped})=>{const p=window.__circuit.getPart('geometry');return p.rotation===rotation&&!!p.flipped===flipped;},{rotation,flipped});
    await page.locator('[data-canvas] [data-part-id="geometry"]').click();
    await page.waitForSelector('[data-canvas] [data-terminal-dot="geometry:PA0"]');
    const failures=await page.evaluate(async terminals=>{
      const face=document.querySelector('[data-canvas] [data-part-id="geometry"]'),image=face.querySelector('image');
      const art=new DOMParser().parseFromString(await(await fetch(image.getAttribute('href'))).text(),'image/svg+xml');
      return terminals.flatMap(t=>{
        const contact=art.querySelector('[data-terminal="'+t.name+'"] circle');
        const dot=document.querySelector('[data-canvas] [data-terminal-dot="geometry:'+t.name+'"] circle');
        if(!contact||!dot)return['Missing '+t.name];
        const drawn=new DOMPoint(+image.getAttribute('x') + +contact.getAttribute('cx'),+image.getAttribute('y') + +contact.getAttribute('cy')).matrixTransform(face.getCTM());
        const wired=new DOMPoint(+dot.getAttribute('cx'),+dot.getAttribute('cy')).matrixTransform(dot.getCTM());
        return Math.hypot(drawn.x-wired.x,drawn.y-wired.y)>0.01?['Displaced '+t.name]:[];
      });
    },sidecar.terminals);
    assert.deepEqual(failures,[],'connector coordinates at rotation '+rotation+', flipped '+flipped);
  }
  checks.push('all 17 connector contacts coincide with real wire targets at every quarter-turn and reflection');

  const two={vcc:5,fileOnly:true,parts:['one','two'].map((id,i)=>({id,kind:'kim-1',x:200+i*350,y:250,
    params:{program:'0200: A9 5A 00',clockHz:1000},terminals:sidecar.terminals.map(t=>t.name)})),wires:[]};
  await page.evaluate(data=>window.__setCircuitData(data),two);
  await page.waitForSelector('[data-kim1-panel="one"]');
  await page.locator('[data-kim1-panel="one"] [data-kim1-key="GO"]').click();
  await page.waitForFunction(()=>window.__board.getDeviceState('one')?.cpu.a===0x5a);
  assert.deepEqual(await page.evaluate(()=>{const s=window.__board.getDeviceState('two');return[s.cpu.a,s.pc,s.running];}),[0,0x0200,false]);
  checks.push('two KIM-1 panels control independent computers on one circuit');

  panel=page.locator('[data-kim1-panel="one"]');
  await panel.locator('input[accept*=".ptp"]').setInputFiles({
    name:'authored.ptp',mimeType:'text/plain',buffer:Buffer.from(';032000A94200010E\r\n;0000010001\r\n')
  });
  await page.waitForFunction(()=>document.querySelector('[data-kim1-panel="one"] textarea')?.value.startsWith(';03'));
  await panel.locator('[data-kim1-load]').click();
  await page.waitForFunction(()=>window.__board.getDeviceState('one')?.expansion?.[0x2000]===0xa9);
  assert.match(await panel.getByRole('textbox',{name:'KIM-1 program',exact:true}).inputValue(), /2000: A9 42 00/);
  checks.push('the file picker imports checked MOS paper tape into persistent expansion RAM');

  const roms=Buffer.alloc(2048);
  // Original test program: set the segment pattern and select digit 0, then loop.
  const rom=Buffer.from([0xa9,0x7f,0x8d,0x41,0x17,0xa9,0x1e,0x8d,0x43,0x17,
    0xa9,0x3f,0x8d,0x40,0x17,0xa9,8,0x8d,0x42,0x17,0x4c,0x14,0x1c]);
  rom.copy(roms,1024); roms[2045]=0x1c;
  await panel.getByText('Firmware and TTY',{exact:true}).click();
  await panel.locator('[data-kim1-rom-input]').setInputFiles({
    name:'authored.rom',mimeType:'application/octet-stream',buffer:roms
  });
  await page.waitForFunction(()=>window.__board.getDeviceState('one')?.segments?.[0]===0x3f,undefined,{timeout:12000});
  assert.equal(await panel.locator('[data-kim1-display]').getAttribute('data-kim1-display'),'0     ');
  assert.equal(await page.evaluate(()=>JSON.stringify(window.__circuit.toJSON()).includes('roms')), false);
  await panel.getByRole('button',{name:'Learning monitor',exact:true}).click();
  await page.waitForFunction(()=>window.__board.getDeviceState('one')?.roms===null);
  checks.push('session-only ROM upload drives the real 6530 display and can return to the learning monitor');

  await page.setViewportSize({width:390,height:844});
  await page.waitForFunction(()=>document.querySelector('[data-kim1-panel="one"]')?.getBoundingClientRect().width>=300);
  await page.locator('[data-kim1-panel="one"]').scrollIntoViewIfNeeded();
  const size=await page.evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth,
    panel:document.querySelector('[data-kim1-panel="one"]').getBoundingClientRect().width}));
  assert.ok(size.width<=size.viewport+1,JSON.stringify(size));
  assert.ok(size.panel>=300&&size.panel<=390);
  await page.screenshot({path:path.join(output,'kim1-mobile.png'),fullPage:true});
  assert.deepEqual(pageErrors,[]);
  checks.push('the front panel remains usable without horizontal overflow at 390px');
  const result={status:'passed',browser:browser.version(),checks,
    scope:'Actual CircuitDesigner, NMOS CPU and independently written front-panel monitor, shared circuit clock and external electrical nets',fullApplicationBuild:false};
  await writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
} catch(error) {
  if(page)await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});
  await writeFile(path.join(output,'failure.json'),JSON.stringify({error:String(error.stack||error),pageErrors,checks},null,2)+'\n');
  throw error;
} finally {await browser?.close();}

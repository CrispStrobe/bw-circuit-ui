#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Original functional drawing. No manufacturer artwork or historical PCB is reproduced.
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';

export function createKim1ConnectorAssets() {
  const w=300,h=330;
  const terminals=[...Array.from({length:8},(_,i)=>({name:`PA${i}`,x:10,y:62+i*26})),
    ...[0,1,2,3,4,5,7].map((bit,i)=>({name:`PB${bit}`,x:290,y:62+i*26})),
    {name:'5v',x:100,y:320},{name:'gnd',x:200,y:320}];
  const sidecar={kind:'kim-1',w,h,terminals,footprint:null,
    description:'KIM-1 system connector: 15 user GPIO lines, 5 V and ground. PB6 is reserved.'};
  const rows=[['GO','ST','RS','SST'],['AD','DA','PC','+'],['C','D','E','F'],['8','9','A','B'],['4','5','6','7'],['0','1','2','3']];
  const contacts=terminals.map(t=>`<g data-terminal="${t.name}"><circle cx="${t.x}" cy="${t.y}" r="4" fill="#c9ae6c" stroke="#f1daa0"/><text x="${t.x===10?20:t.x===290?280:t.x}" y="${t.y===320?309:t.y+3}" text-anchor="${t.x===10?'start':t.x===290?'end':'middle'}" fill="#e0e8d1" font-size="9">${t.name}</text></g>`).join('\n');
  const keys=rows.map((row,r)=>row.map((key,c)=>{
    const x=72+c*40,y=128+r*25;
    return `<g><rect x="${x}" y="${y}" width="34" height="20" rx="2" fill="${r===0?'#dfa24d':r===1?'#cebf94':'#e8e9d9'}" stroke="#8c967d"/><text x="${x+17}" y="${y+14}" text-anchor="middle" font-size="10" fill="#20362b">${key}</text></g>`;
  }).join('')).join('\n');
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
<!-- SPDX-License-Identifier: MIT. Original KIM-1 functional connector drawing. -->
<rect x="4" y="4" width="292" height="322" rx="9" fill="#284c3c" stroke="#97b293" stroke-width="2"/>
<g font-family="monospace"><text x="150" y="31" text-anchor="middle" font-size="19" font-weight="bold" fill="#f0ead0">KIM-1</text>
<rect x="64" y="47" width="172" height="37" rx="4" fill="#16131a" stroke="#698168"/>
<text x="150" y="73" text-anchor="middle" font-size="24" letter-spacing="3" fill="#fd7862">0200 00</text>
<text x="112" y="97" text-anchor="middle" font-size="8" fill="#c7d7bf">ADDRESS</text><text x="204" y="97" text-anchor="middle" font-size="8" fill="#c7d7bf">DATA</text>
${keys}
<text x="150" y="298" text-anchor="middle" font-size="10" fill="#d6e0c4">6502 · 2 × 6530</text>
${contacts}
</g></svg>\n`;
  return {sidecar,svg};
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const {sidecar,svg}=createKim1ConnectorAssets();
  const directory=new URL('../src/parts-data/',import.meta.url);
  const files=[['kim-1.json',JSON.stringify(sidecar,null,2)+'\n'],['kim-1.svg',svg]];
  if (process.argv.includes('--check')) {
    for(const [name,content] of files) if(readFileSync(new URL(name,directory),'utf8')!==content) throw new Error(`${name} is stale`);
  } else {
    mkdirSync(fileURLToPath(directory),{recursive:true});
    for(const [name,content] of files) writeFileSync(new URL(name,directory),content);
  }
}

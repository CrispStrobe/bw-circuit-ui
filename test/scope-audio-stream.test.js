import test from 'node:test';
import assert from 'node:assert/strict';
import {createScopeAudioStream,STREAM_MAX_SECONDS} from '../src/audio/scope-audio-stream.js';
function ring(depth=8192){
 const data={samples:new Float64Array(depth*2).fill(NaN),capture:'sample',channelType:'voltage',sampleIntervalNs:100_000n,startTNs:0n,count:0,writeIndex:0};
 return {data,add(values){for(const value of values){data.samples[data.writeIndex*2]=value;data.samples[data.writeIndex*2+1]=value;data.writeIndex=(data.writeIndex+1)%depth;data.count++;}data.startTNs=(1n+BigInt(Math.max(0,data.count-depth)))*data.sampleIntervalNs;},read:()=>data};
}
function context(){
 const sources=[];
 return {sources,state:'running',currentTime:0,destination:{},
  async resume(){this.state='running';},
  createBuffer(channels,length,sampleRate){assert.equal(channels,1);return{length,sampleRate,samples:null,copyToChannel(values){this.samples=values.slice();}};},
  createBufferSource(){const s={stops:0,disconnects:0,connect(){},disconnect(){this.disconnects++;},start(time){this.at=time;},stop(){this.stops++;}};sources.push(s);return s;}
 };
}
async function fixture(depth){const capture=ring(depth),ctx=context(),states=[];const stream=await createScopeAudioStream(capture.read,{context:ctx,autoPump:false,onStatus:s=>states.push(s)});return{capture,ctx,states,stream};}

test('contiguous captured samples schedule at their actual rate with no duplicate replay',async()=>{
 const f=await fixture();try{
  f.capture.add(Array.from({length:500},(_,i)=>2.5+Math.sin(2*Math.PI*i/10)));f.stream.pump();
  f.ctx.currentTime=.01;f.capture.add(Array.from({length:100},(_,i)=>2.5+Math.sin(2*Math.PI*(i+500)/10)));f.stream.pump();f.stream.pump();
  assert.equal(f.ctx.sources.length,2);const [a,b]=f.ctx.sources;
  assert.equal(a.buffer.sampleRate,10000);assert.equal(a.buffer.length,500);assert.equal(b.buffer.length,100);
  assert.ok(Math.abs(b.at-(a.at+a.buffer.length/10000))<1e-12);
  assert.ok(a.buffer.samples.every(v=>Number.isFinite(v)&&Math.abs(v)<=1));
  const samples=a.buffer.samples;let periodicError=0;
  for(let i=300;i<490;i++)periodicError=Math.max(periodicError,Math.abs(samples[i+10]-samples[i]));
  assert.ok(periodicError<.0001,'the captured 1kHz cadence remains 1kHz');
  assert.equal(f.states.at(-1).state,'playing');assert.ok(f.states.at(-1).queuedSeconds<=STREAM_MAX_SECONDS);
 }finally{f.stream.stop();}
});

test('live listening begins after existing history, buffers new samples, and never replays old data',async()=>{
 const capture=ring();capture.add(Array(500).fill(100));const ctx=context(),states=[];
 const stream=await createScopeAudioStream(capture.read,{context:ctx,autoPump:false,onStatus:s=>states.push(s)});
 try{stream.pump();assert.equal(ctx.sources.length,0);capture.add(Array(500).fill(7));stream.pump();assert.equal(ctx.sources.length,1);assert.ok(ctx.sources[0].buffer.samples.every(v=>v===0));}finally{stream.stop();}
});

test('DC is removed and large real signals are clipped with fixed voltage scaling',async()=>{
 const f=await fixture();try{f.capture.add(Array(500).fill(9));f.stream.pump();assert.ok(f.ctx.sources[0].buffer.samples.every(v=>v===0));f.ctx.currentTime=.05;f.capture.add(Array.from({length:500},(_,i)=>i%2?1000:-1000));f.stream.pump();const values=f.ctx.sources.at(-1).buffer.samples;assert.ok(values.every(v=>Math.abs(v)<=1));assert.ok(values.some(v=>v===1)&&values.some(v=>v===-1));}finally{f.stream.stop();}
});

test('a slow solver reports one underrun per starvation episode and waits for prefill without changing pitch',async()=>{
 const f=await fixture();try{
  f.capture.add(Array(500).fill(1));f.stream.pump();f.ctx.currentTime=.1;f.stream.pump();f.stream.pump();
  assert.equal(f.states.at(-1).state,'buffering');assert.equal(f.states.at(-1).underruns,1);assert.equal(f.ctx.sources.length,1);
  f.capture.add(Array(100).fill(1));f.stream.pump();assert.equal(f.ctx.sources.length,1);
  f.capture.add(Array(400).fill(1));f.stream.pump();assert.equal(f.ctx.sources.length,2);assert.equal(f.ctx.sources[1].buffer.sampleRate,10000);
  assert.equal(f.states.at(-1).state,'playing');assert.equal(f.states.at(-1).underruns,1);
 }finally{f.stream.stop();}
});

for(const fault of ['input-bound','scheduled-bound','overwritten','cadence','reset','nonfinite','envelope','refused','suspended'])test(`${fault} refuses visibly and releases scheduled audio`,async()=>{
 const f=await fixture(fault==='overwritten'?1024:8192);
 if(fault!=='input-bound'){f.capture.add(Array(500).fill(1));f.stream.pump();}
 if(fault==='input-bound')f.capture.add(Array(3000).fill(1));
 if(fault==='scheduled-bound')f.capture.add(Array(2000).fill(1));
 if(fault==='overwritten')f.capture.add(Array(2048).fill(1));
 if(fault==='cadence')f.capture.data.sampleIntervalNs=50_000n;
 if(fault==='reset')f.capture.data.count=0;
 if(fault==='nonfinite')f.capture.add([NaN]);
 if(fault==='envelope')f.capture.data.capture='envelope';
 if(fault==='suspended')f.ctx.state='suspended';
 if(fault==='refused'){
  // The reader itself must be the same live seam supplied to the stream.
  Object.defineProperty(f.capture.data,'samples',{get(){throw new Error('solver refused');}});
 }
 f.stream.pump();assert.equal(f.states.at(-1).state,'error');assert.ok(f.states.at(-1).reason);assert.equal(f.states.at(-1).queuedSeconds,0);
 assert.ok(f.ctx.sources.every(s=>s.stops===1&&s.disconnects===1));
 const count=f.ctx.sources.length;f.stream.pump();f.stream.stop();assert.equal(f.ctx.sources.length,count);
});

test('stop is idempotent, disconnects nodes, and preserves the shared context',async()=>{
 const f=await fixture();f.capture.add(Array(500).fill(1));f.stream.pump();f.stream.stop();f.stream.stop();
 assert.equal(f.states.at(-1).state,'stopped');assert.equal(f.states.at(-1).queuedSeconds,0);assert.equal(f.ctx.state,'running');
 assert.ok(f.ctx.sources.every(s=>s.stops===1&&s.disconnects===1));
});

test('failed resume and unsupported sample cadence cannot start audio',async()=>{
 const capture=ring(),ctx=context();ctx.state='suspended';ctx.resume=async()=>{throw new Error('resume refused');};
 await assert.rejects(createScopeAudioStream(capture.read,{context:ctx,autoPump:false}),/resume refused/);assert.equal(ctx.sources.length,0);
 capture.data.sampleIntervalNs=1_000_000n;
 await assert.rejects(createScopeAudioStream(capture.read,{context:context(),autoPump:false}),/sample rate/);
});

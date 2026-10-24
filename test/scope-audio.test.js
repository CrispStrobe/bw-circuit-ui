import test from 'node:test';
import assert from 'node:assert/strict';
import {scopeAudio, scopeAudioWav, playScopeCapture} from '../src/audio/scope-audio.js';
const capture = (values, capture = 'sample') => ({samples: Float64Array.from(values.flatMap(v => [v, v])),
  writeIndex: 0, count: values.length, sampleIntervalNs: 100_000n, capture});
const signal = () => capture(Array.from({length: 128}, (_,i)=>2.5+Math.sin(2*Math.PI*i/16)));

test('sample replay retains waveform amplitude and removes DC without auto gain', () => {
  const audio=scopeAudio(signal());
  assert.equal(audio.sampleRateHz,10000);
  assert.ok(Math.abs(audio.dcVolts-2.5)<1e-12);
  for(let i=0;i<128;i++)assert.ok(Math.abs(audio.samples[i]-.05*Math.sin(2*Math.PI*i/16))<1e-8);
  const silence=scopeAudio(capture(Array(128).fill(9)));
  assert.ok(silence.samples.every(v=>v===0));
});

test('audio refuses envelopes, missing samples, too few points and inaudible cadence', () => {
  assert.throws(()=>scopeAudio(capture(Array(128).fill(1),'envelope')),/envelope/);
  const missing=signal();missing.samples[16]=NaN;assert.throws(()=>scopeAudio(missing),/never written|nonfinite/);
  assert.throws(()=>scopeAudio(capture([1,2])),/samples|points/);
  const slow=signal();slow.sampleIntervalNs=100_000_000n;assert.throws(()=>scopeAudio(slow),/sample rate/);
});

test('large voltages clip to bounded audio units with no change to measurement', () => {
  const raw=capture(Array.from({length:128},(_,i)=>i%2?100:-100));
  const before=raw.samples.slice();const a=scopeAudio(raw);
  assert.deepEqual(a.samples,Float32Array.from({length:128},(_,i)=>i%2?1:-1));
  assert.deepEqual(raw.samples,before);
});

test('WAV carries PCM16 mono samples at the measured cadence', () => {
  const wav=scopeAudioWav(signal()),v=new DataView(wav);
  assert.equal(new TextDecoder().decode(wav.slice(0,4)),'RIFF');
  assert.equal(v.getUint32(4,true),wav.byteLength-8);
  assert.equal(v.getUint16(22,true),1);assert.equal(v.getUint32(24,true),10000);
  assert.equal(v.getUint16(34,true),16);assert.equal(v.getUint32(40,true),256);
  assert.ok(Math.abs(v.getInt16(44+4*2,true)-.05*32767)<1);
});

test('playback resumes the injected context, uses actual samples, and releases once', async () => {
  const events=[];let rendered;
  const source={connect:()=>events.push('connect'),disconnect:()=>events.push('disconnect'),
    start:()=>events.push('start'),stop:()=>events.push('stop')};
  const context={state:'suspended',resume:async()=>events.push('resume'),destination:{},
    createBuffer:(channels,length,rate)=>{assert.equal(channels,1);assert.equal(length,128);assert.equal(rate,10000);
      return {copyToChannel:data=>{rendered=data;}};},createBufferSource:()=>source};
  const stop=await playScopeCapture(signal(),context);
  assert.deepEqual(rendered,scopeAudio(signal()).samples);
  stop();stop();assert.deepEqual(events,['resume','connect','start','stop','disconnect']);
});

test('audio unavailability and resume failure reject rather than claim playback', async () => {
  await assert.rejects(playScopeCapture(signal(),null),/unavailable/);
  await assert.rejects(playScopeCapture(signal(),{state:'suspended',resume:async()=>{throw new Error('denied');}}),/denied/);
});

test('finite aperture replay and WAV use identical explicit filtering without changing raw measurements',()=>{
 const raw={...signal(),capture:'average',channelType:'voltage',apertureNs:100000n,startTNs:100000n};
 const before=raw.samples.slice(),options={bandwidthHz:4000};
 const audio=scopeAudio(raw,options),wav=new DataView(scopeAudioWav(raw,options));
 assert.equal(audio.capture,'average');assert.equal(audio.apertureNs,100000n);assert.equal(audio.bandwidthHz,4000);
 audio.samples.forEach((v,i)=>assert.equal(wav.getInt16(44+i*2,true),Math.round(v*(v<0?32768:32767))));
 assert.deepEqual(raw.samples,before);
 const twice={...raw,samples:Float64Array.from(raw.samples,v=>2.5+2*(v-2.5))};
 const louder=scopeAudio(twice,options);
 audio.samples.forEach((v,i)=>assert.ok(Math.abs(louder.samples[i]-2*v)<1e-8,'fixed voltage gain, no normalization'));
});

test('aperture metadata and invalid output bandwidth refuse before native node allocation',async()=>{
 const raw={...signal(),capture:'average',channelType:'voltage',apertureNs:50000n,startTNs:0n};
 const ctx={state:'running',createBuffer(){throw new Error('audio nodes must not be allocated');}};
 await assert.rejects(playScopeCapture(raw,ctx,{bandwidthHz:4000}),/Aperture duration/);
 raw.apertureNs=100000n;
 await assert.rejects(playScopeCapture(raw,ctx,{bandwidthHz:5000}),/bandwidth/);
});

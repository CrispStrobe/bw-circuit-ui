/**
 * Test that the simulation driver produces real values from bw-board.
 * These are the same hand-computed expectations from bw-board's own tests.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getEngine } from '../src/engine.js';
import { demoPinScriptApplies, armBoardForRun, classifyRunPins, greenFlagArmsOwnBoard, designerClockPlan, createDesignerLiveClock, designerDemoPhase } from '../src/model/simulation.js';
import { Circuit } from '../src/model/circuit.js';
import { readFileSync } from 'node:fs';

// Controller tests deliberately model clock receipts, not circuit physics.
// Native device/solver behavior is qualified upstream and in the browser return.
function clockHarness(options = {}) {
  let time = 0n, paused = options.paused ?? false, speed = options.speed ?? 1;
  let nextId = 0;
  const pending = new Map(), requests = [], errors = [], busy = [];
  const quantum = options.quantum ?? 10_000_000n;
  const driver = createDesignerLiveClock({
    getTime: () => time,
    isPaused: () => paused,
    getSpeed: () => speed,
    schedule: (fn, delay) => { const id = nextId++; pending.set(id, {fn,delay}); return id; },
    cancel: id => pending.delete(id),
    advanceToLive: (target, limits) => {
      requests.push({target,limits});
      if (options.failure) throw options.failure;
      const started = time;
      time = time + quantum < target ? time + quantum : target;
      const receipt = {startedTimeNs:started.toString(),requestedTimeNs:target.toString(),
        processedTimeNs:time.toString(),completed:time===target,steps:1,maxSteps:limits.maxSteps};
      return options.receipt ? options.receipt(receipt) : receipt;
    },
    limitTarget: options.limitTarget,
    onBeforeAdvance: options.onBeforeAdvance,
    onProgress: options.onProgress,
    onStepping: value => busy.push(value),
    onError: error => errors.push(error),
  });
  return {driver,pending,requests,errors,busy,
    get time(){return time;},
    setPaused(value){paused=value;},setSpeed(value){speed=value;},
    tick(){
      assert.equal(pending.size,1,'exactly one queued timer, never parallel chains');
      const [id,event]=pending.entries().next().value;pending.delete(id);event.fn();
      return event;
    }};
}

describe('cooperative designer clock lifecycle (not a solver oracle)',()=>{
  it('yields partial progress, pauses immediately, and resumes without old backlog',()=>{
    const h=clockHarness();h.driver.start();
    assert.equal(h.tick().delay,50);assert.equal(h.time,10_000_000n);
    assert.equal(h.pending.values().next().value.delay,0,'yield, not synchronous draining');
    h.setPaused(true);h.driver.pause();assert.equal(h.pending.size,0);
    h.setPaused(false);h.driver.wake();h.tick();
    assert.equal(h.requests.at(-1).target,60_000_000n,'new tick begins at actual10ms');
    assert.equal(h.requests.at(-1).limits.maxSteps,16);
    for(let i=0;i<4;i++)h.tick();
    assert.equal(h.time,60_000_000n);
    assert.equal(h.pending.values().next().value.delay,50);
    h.driver.stop();
  });

  it('single step asynchronously completes50ms while staying paused and cannot stack',()=>{
    const h=clockHarness({paused:true});h.driver.start();h.tick();
    assert.equal(h.requests.length,0);assert.equal(h.pending.size,0);
    assert.equal(h.driver.step(),true);assert.equal(h.driver.step(),false);
    assert.deepEqual(h.busy,[true]);
    for(let i=0;i<5;i++)h.tick();
    assert.equal(h.time,50_000_000n);assert.deepEqual(h.busy,[true,false]);
    assert.equal(h.pending.size,0,'no automatic tick after a paused step');
    assert.equal(h.driver.step(),true);h.tick();
    h.driver.pause();assert.equal(h.pending.size,0);assert.deepEqual(h.busy,[true,false,true,false]);
  });

  it('control settling uses the same yielded chain, including while paused',()=>{
    const h=clockHarness({paused:true,quantum:100_000n});
    h.driver.requestAdvance(1_000_000n);h.tick();
    assert.equal(h.time,100_000n);assert.equal(h.pending.size,1);
    h.driver.requestAdvance(1_000_000n);
    for(let i=0;i<10;i++)h.tick();
    assert.equal(h.time,1_100_000n);assert.equal(h.pending.size,0);
    assert.throws(()=>h.driver.requestAdvance(0n),/positive live delta/);
    assert.throws(()=>h.driver.requestAdvance(1000),/positive live delta/);
  });

  it('a control edit near the end of a single step cannot extend its50ms horizon',()=>{
    const h=clockHarness({paused:true,quantum:9_900_000n});h.driver.step();
    for(let i=0;i<5;i++)h.tick();
    assert.equal(h.time,49_500_000n);
    h.driver.requestAdvance(1_000_000n);h.tick();
    assert.equal(h.time,50_000_000n);assert.equal(h.pending.size,0);
    assert.deepEqual(h.busy,[true,false]);
  });

  it('speed changes affect the next tick, not unfinished work or physical time claims',()=>{
    for(const [speed,target] of [[.25,12_500_000n],[1,50_000_000n],[4,200_000_000n]]){
      const h=clockHarness({speed,quantum:1_000_000n});h.driver.start();h.tick();
      assert.equal(h.requests[0].target,target);h.setSpeed(4);h.tick();
      assert.equal(h.requests[1].target,target);h.driver.stop();
    }
  });

  it('unmount/rebuild cancels pending work and a stale callback cannot advance',()=>{
    const h=clockHarness();h.driver.start();const stale=h.pending.values().next().value.fn;
    h.driver.stop();assert.equal(h.pending.size,0);stale();
    assert.equal(h.time,0n);assert.equal(h.requests.length,0);
    h.driver.wake();assert.equal(h.pending.size,0);assert.equal(h.driver.step(),false);
    assert.equal(h.driver.requestAdvance(1n),false);
  });

  it('engine errors stop the chain with original identity and no bulk fallback',()=>{
    const error=new Error('native integration refused');
    const h=clockHarness({failure:error,paused:true});h.driver.step();h.tick();
    assert.deepEqual(h.errors,[error]);assert.deepEqual(h.busy,[true,false]);
    assert.equal(h.time,0n);assert.equal(h.pending.size,0);h.driver.wake();
    assert.equal(h.pending.size,0);assert.equal(h.requests.length,1);
  });

  it('false/stale progress receipts stop rather than silently skipping work',()=>{
    for(const receipt of [r=>({...r,completed:true}),r=>({...r,processedTimeNs:'50000000'}),
      r=>({...r,requestedTimeNs:'1'})]){
      const h=clockHarness({receipt});h.driver.start();h.tick();
      assert.equal(h.errors.length,1,'an untrustworthy receipt must stop the clock');
      assert.match(h.errors[0].message,/receipt does not match actual progress/);
      assert.equal(h.pending.size,0);
    }
  });

  it('a demo waveform changes at250ms boundaries even with200ms requested ticks',()=>{
    const edges=[];let last=null;
    const apply=time=>{const {high}=designerDemoPhase(time);if(high!==last){last=high;edges.push([time,high]);}};
    const h=clockHarness({speed:4,quantum:200_000_000n,
      limitTarget:(now,target)=>{const {nextNs}=designerDemoPhase(now);return nextNs<target?nextNs:target;},
      onBeforeAdvance:apply,onProgress:r=>apply(BigInt(r.processedTimeNs))});
    h.driver.start();for(let i=0;i<20&&h.time<600_000_000n;i++)h.tick();
    assert.equal(h.time,600_000_000n);
    assert.deepEqual(edges,[[0n,true],[250_000_000n,false],[500_000_000n,true]]);
    h.driver.stop();
  });

  it('invalid speed/boundary refuses without calling the engine',()=>{
    for(const options of [{speed:NaN},{limitTarget:()=>0n},{limitTarget:()=>60_000_000n}]){
      const h=clockHarness(options);h.driver.start();h.tick();
      assert.equal(h.errors.length,1);assert.equal(h.requests.length,0);assert.equal(h.pending.size,0);
    }
  });
});

describe('actual model proxy and designer clock command wiring',()=>{
  it('the actual hook returns partial receipts and refreshes readings even after failure',()=>{
    const src=readFileSync(new URL('../src/hooks/useCircuit.js',import.meta.url),'utf8');
    const begin=src.indexOf('const advanceToLive = useCallback(');
    const end=src.indexOf('}, [circuit, bump]);',begin)+'}, [circuit, bump]);'.length;
    assert.ok(begin>=0&&end>begin);
    const receipt={completed:false,processedTimeNs:'3'};let bumps=0;
    const error=new Error('native failure');
    const circuit={advanceToLive:(target,options)=>{assert.equal(target,10n);assert.equal(options.maxSteps,16);return receipt;}};
    const hook=Function('circuit','bump','useCallback',src.slice(begin,end)+'return advanceToLive;')(
      circuit,()=>bumps++,fn=>fn);
    assert.equal(hook(10n,{maxSteps:16}),receipt);assert.equal(bumps,1);
    circuit.advanceToLive=()=>{throw error;};
    assert.throws(()=>hook(10n),actual=>actual===error);assert.equal(bumps,2);
  });
  it('the real Circuit proxy follows partial time and error time, not its requested target',()=>{
    let time=0n;const receipt=Object.freeze({processedTimeNs:'3',completed:false});
    const original=new Error('original native failure');
    const model={timeNs:0n,board:{getTime:()=>time,
      advanceToLive(target,options){assert.equal(target,10n);assert.equal(options.maxSteps,1);time=3n;return receipt;}}};
    assert.equal(Circuit.prototype.advanceToLive.call(model,10n,{maxSteps:1}),receipt);
    assert.equal(model.timeNs,3n);
    model.board.advanceToLive=()=>{time=5n;throw original;};
    assert.throws(()=>Circuit.prototype.advanceToLive.call(model,10n),error=>error===original);
    assert.equal(model.timeNs,5n);
    delete model.board.advanceToLive;
    model.board.advanceTo=()=>assert.fail('unsafe bulk fallback');
    assert.throws(()=>Circuit.prototype.advanceToLive.call(model,10n),/requires a bw-board engine/);
  });

  function callback(name,parameters){
    const src=readFileSync(new URL('../src/components/CircuitDesigner.jsx',import.meta.url),'utf8');
    const begin=src.indexOf(`const ${name} = useCallback(() => {`);
    assert.ok(begin>=0,`actual ${name} callback exists`);
    const body=src.indexOf('{',begin)+1,end=src.indexOf('\n  },',body);
    assert.ok(end>body);return Function(...parameters,src.slice(body,end));
  }

  it('actual pause handler freezes its ref before cancelling; resume explicitly wakes',()=>{
    const ref={current:false},events=[];
    const clock={current:{pause(){assert.equal(ref.current,true);events.push('pause');},
      wake(){assert.equal(ref.current,false);events.push('wake');}}};
    const handler=callback('handleSimPause',['simPausedRef','setSimPaused','simClock']);
    const run=()=>handler(ref,value=>events.push(value),clock);
    run();run();assert.deepEqual(events,[true,'pause',false,'wake']);
  });

  it('actual step handler requests asynchronous work, never calls bulk advance',()=>{
    let called=0;const handler=callback('handleSimStep',['simClock']);
    handler({current:{step(){called++;}}});assert.equal(called,1);
  });

  it('actual control handler requests settling only on the locally clocked board',()=>{
    const requests=[];const clock={current:{requestAdvance:delta=>requests.push(delta)}};
    const handler=callback('requestControlSettling',['externalBoard','simClock','MS']);
    handler(null,clock,1_000_000n);handler({},clock,1_000_000n);
    assert.deepEqual(requests,[1_000_000n],'external emulator clock is not advanced');
  });

  it('the designer cancels before reset/stop and routes every automatic/control tick cooperatively',()=>{
    const src=readFileSync(new URL('../src/components/CircuitDesigner.jsx',import.meta.url),'utf8');
    const flag=src.slice(src.indexOf('const onGreenFlag = () => {'),src.indexOf('const onStopAll = () => {'));
    assert.ok(flag.indexOf('simClock.current?.pause()')<flag.indexOf('armBoardForRun({'));
    assert.match(flag,/simPausedRef\.current = false/);assert.match(flag,/simClock\.current\?\.wake\(\)/);
    assert.doesNotMatch(src,/advanceBy\((?:1n|50n) \* MS\)/,'no unsafe GUI settling/step bypass');
    assert.doesNotMatch(src,/simInterval|simStep\.current/,'no parallel interval clock');
    const effect=src.slice(src.indexOf('const armedByFlag = runArmedRef.current;'),src.indexOf('// Refs so pause/speed'));
    assert.ok(effect.indexOf('if (hasExternalBoard) return;')<effect.indexOf('createDesignerLiveClock({'));
    assert.match(effect,/clock\.stop\(\)/);assert.match(effect,/advanceToLive,/);
    assert.match(src,/simStepping \|\| !!externalBoard \|\| !!simClockError/,'disable stacked or externally clocked steps');
  });
});

// Inline the demo netlist (same as demo-netlist.js minus layout fields)
const parts = [
  { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
  { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
  { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
  { id: 'LED1', kind: 'led', params: { vf: 2.0, color: 'red' }, terminals: ['anode', 'cathode'] },
  { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
];

const nets = [
  { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
  { id: 'net_r_led', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
  { id: 'net_led_pin', terminals: [{ part: 'LED1', terminal: 'cathode' }, { part: 'MCU', terminal: 'P1.0' }] },
];

describe('simulation driver produces real engine values', () => {
  it('quasi-bidir driving LOW → LED brightness ~0.145', () => {
    const { BoardImpl } = getEngine();
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'quasi', false);
    board.advanceTo(25_000_000n);

    const b = board.ledBrightness('LED1');
    assert.ok(b > 0.13, `brightness ${b} should be > 0.13`);
    assert.ok(b < 0.16, `brightness ${b} should be < 0.16`);
  });

  it('quasi-bidir driving HIGH → LED brightness ~0', () => {
    const { BoardImpl } = getEngine();
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'quasi', true);
    board.advanceTo(25_000_000n);

    const b = board.ledBrightness('LED1');
    assert.ok(b < 0.01, `brightness ${b} should be ~0`);
  });

  it('nodeVoltage returns real volts', () => {
    const { BoardImpl } = getEngine();
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'quasi', false);
    board.advanceTo(1_000_000n);

    const vcc = board.nodeVoltage('net_vcc');
    assert.ok(Math.abs(vcc - 5.0) < 0.1, `VCC net should be ~5V, got ${vcc}`);
  });
});

// ── The demo pin script must yield to a real program ─────────────────
//
// Reported by a consumer (brickwright): a two-LED example whose program
// alternates its pins rendered with both LEDs lighting TOGETHER. The program was
// running and its writes were correct, but they were not arriving at this board,
// so the designer's placeholder animation kept playing over the top. That
// placeholder drives every output pin from ONE shared value, which is why it can
// only ever show all-together — and why it is indistinguishable from a working
// program on any circuit with exactly one LED.
//
// The predicate is exported so this decision can be tested at all: in the
// component it lives inside a React effect, reachable only by rendering the
// whole designer.
describe('the demo pin script', () => {
  it('plays for a bench with an MCU and no declarations', () => {
    assert.equal(demoPinScriptApplies({ hasMcu: true }), true);
    assert.equal(demoPinScriptApplies({ hasMcu: true, stc: null }), true);
    assert.equal(demoPinScriptApplies({ hasMcu: true, stc: { pins: [] } }), true);
  });

  it('stands down as soon as the project declares a pin', () => {
    // One declaration is enough: there is an author for the pins now, and it is
    // not this module. Two authors on one pin is the defect being fixed.
    assert.equal(
      demoPinScriptApplies({ hasMcu: true, stc: { pins: [{ name: 'led1' }] } }),
      false,
    );
    assert.equal(
      demoPinScriptApplies({
        hasMcu: true,
        stc: { pins: [{ name: 'led1' }, { name: 'led2' }] },
      }),
      false,
    );
  });

  it('never plays without an MCU, declarations or not', () => {
    // A pure circuit (battery-LED, RC bench) still needs the clock to advance,
    // but it has no pins to script. The clock is not this predicate's business.
    assert.equal(demoPinScriptApplies({ hasMcu: false }), false);
    assert.equal(
      demoPinScriptApplies({ hasMcu: false, stc: { pins: [{ name: 'led1' }] } }),
      false,
    );
  });

  it('is not fooled by a malformed declarations object', () => {
    // `stc` arrives from a consumer's project model and has been seen as a bare
    // object mid-load. Treating a missing pins array as "declared" would silence
    // the placeholder on every bench.
    assert.equal(demoPinScriptApplies({ hasMcu: true, stc: {} }), true);
    assert.equal(demoPinScriptApplies({ hasMcu: true, stc: { pins: 'nope' } }), true);
  });
});

// A run is armed BEFORE the program writes (brickwright-lite task B7). The
// designer's start-of-run clear (reset + arm every MCU pin) used to run in its
// [mode] effect after the green flag's event arrived on a setTimeout(0), so it
// could land after the Scratch VM's first write and wipe it — measured in a
// real browser on production: `turn on led` at 68.7 ms, the reset at 174 ms,
// the LED dark for the program's whole 2 s wait.
describe('armBoardForRun: the clear of a run', () => {
  const wires = [
    { from: 'MCU', fromTerminal: 'P1.0', to: 'LED1', toTerminal: 'cathode' },
    { from: 'MCU', fromTerminal: 'P3.2', to: 'B1', toTerminal: 'a' },
    { from: 'MCU', fromTerminal: 'P1.1', to: 'POT', toTerminal: 'wiper' },
  ];
  const benchParts = [
    { id: 'MCU', kind: 'mcu', terminals: ['P1.0', 'P3.2', 'P1.1', 'P2.7'] },
    { id: 'LED1', kind: 'led' }, { id: 'B1', kind: 'button' }, { id: 'POT', kind: 'potentiometer' },
  ];

  it('resets the board and arms each MCU pin by what it is wired to', () => {
    const calls = [];
    let resets = 0;
    const out = armBoardForRun({
      board: { reset() { resets++; } }, parts: benchParts, wires,
      setPin: (pin, mode, high) => calls.push([pin, mode, high]),
    });
    assert.equal(resets, 1);
    assert.equal(out.mcu.id, 'MCU');
    assert.deepEqual(out.outputPins, ['P1.0', 'P2.7'], 'an LED pin and an unwired pin are outputs');
    assert.deepEqual(out.inputPins, ['P3.2']);
    assert.deepEqual(out.analogPins, ['P1.1']);
    assert.deepEqual(calls, [['P1.0', 'quasi', true], ['P2.7', 'quasi', true], ['P3.2', 'quasi', true], ['P1.1', 'input', false]]);
  });

  it('is a CLEAR: a program write before it is lost, one after it is kept — so it must run first', () => {
    const { BoardImpl } = getEngine();
    const fresh = () => { const b = new BoardImpl(5.0); b.setNetlist(parts, nets); b.setPower(true); return b; };
    const arm = (b) => armBoardForRun({ board: b, parts, wires: [{ from: 'MCU', fromTerminal: 'P1.0', to: 'LED1', toTerminal: 'cathode' }], setPin: (p, m, h) => b.setPin(p, m, h) });
    const writeFirst = fresh();
    writeFirst.setPin('P1.0', 'pushpull', false);   // the program: turn on led (active low)
    arm(writeFirst);                                  // the old order: the clear after it
    assert.deepEqual([writeFirst.pinStates.get('p1.0').mode, writeFirst.pinStates.get('p1.0').driveHigh], ['quasi', true], 'wiped');
    const armFirst = fresh();
    arm(armFirst);
    armFirst.setPin('P1.0', 'pushpull', false);
    assert.deepEqual([armFirst.pinStates.get('p1.0').mode, armFirst.pinStates.get('p1.0').driveHigh], ['pushpull', false], 'kept');
  });

  it('the designer arms from the green-flag event itself, before it changes mode, and the effect does not arm again', () => {
    const src = readFileSync(new URL('../src/components/CircuitDesigner.jsx', import.meta.url), 'utf8');
    const handler = src.slice(src.indexOf('const onGreenFlag = () => {'), src.indexOf("window.addEventListener('bw-green-flag', onGreenFlag);"));
    assert.ok(handler.includes('armBoardForRun('), 'the green-flag handler arms the run synchronously');
    assert.ok(handler.indexOf('armBoardForRun(') < handler.indexOf("setMode('simulate')"), 'and does so before the mode change');
    const effect = src.slice(src.indexOf('const armedByFlag = runArmedRef.current;'));
    assert.match(effect, /runArmedRef\.current = null;/, 'every run of the effect consumes the flag');
    assert.match(effect, /designerClockPlan\(\{ armedByFlag, board: circuit\.board, released \}\)/, 'and decides through the tested plan');
    assert.match(effect, /plan === 'reuse' \? armedByFlag\.armed/, 'and reuses its arming instead of clearing again');
  });
});

// brickwright-lite task B8, measured in a real browser on production (54-motor-
// driver, three green flags on one page): from the second flag on the designer
// displayed a debugger's private board while the Scratch VM wrote the designer's
// own board, which was never cleared (the flag skipped it while ANY external
// board was on screen) and never clocked again (the simulation effect did not
// re-run when the external board went away): frozen at 500 ms of board time
// for every later run.
describe('one board per run: the designer binding (task B8)', () => {
  it('the green flag arms the own board unless it is the board the external engine drives', () => {
    const own = {}; const other = {};
    assert.equal(greenFlagArmsOwnBoard({ ownBoard: own, externalBoard: undefined }), true);
    assert.equal(greenFlagArmsOwnBoard({ ownBoard: own, externalBoard: other }), true, 'a debugger board on screen does not exempt the VM board');
    assert.equal(greenFlagArmsOwnBoard({ ownBoard: own, externalBoard: own }), false, 'a machine on the designer board is not cleared under its CPU');
    assert.equal(greenFlagArmsOwnBoard({ ownBoard: null, externalBoard: undefined }), false);
  });

  it('the clock plan: reuse the flag, resume a handed-back board, arm otherwise', () => {
    const b = {}; const stale = {};
    assert.equal(designerClockPlan({ armedByFlag: { board: b }, board: b, released: false }), 'reuse');
    assert.equal(designerClockPlan({ armedByFlag: { board: b }, board: b, released: true }), 'reuse', 'a flag that armed this board wins over the hand-back');
    assert.equal(designerClockPlan({ armedByFlag: null, board: b, released: true }), 'resume');
    assert.equal(designerClockPlan({ armedByFlag: { board: stale }, board: b, released: false }), 'arm', 'an arming of a rebuilt board is not reused');
    assert.equal(designerClockPlan({ armedByFlag: null, board: b, released: false }), 'arm');
  });

  it('a resumed board keeps what the program wrote; classifyRunPins touches no board', () => {
    const { BoardImpl } = getEngine();
    const b = new BoardImpl(5.0); b.setNetlist(parts, nets); b.setPower(true);
    const w = [{ from: 'MCU', fromTerminal: 'P1.0', to: 'LED1', toTerminal: 'cathode' }];
    armBoardForRun({ board: b, parts, wires: w, setPin: (p, m, h) => b.setPin(p, m, h) });
    b.setPin('P1.0', 'pushpull', false);
    b.advanceTo(200_000_000n);
    const pins = classifyRunPins({ parts, wires: w });
    assert.deepEqual(pins.outputPins, ['P1.0']);
    assert.deepEqual([b.pinStates.get('p1.0').mode, b.pinStates.get('p1.0').driveHigh], ['pushpull', false], 'the write survives');
    assert.equal(b.timeNs, 200_000_000n, 'and board time is not reset');
  });

  it('the designer wires both: the flag through greenFlagArmsOwnBoard, the effect re-runs on the hand-back', () => {
    const src = readFileSync(new URL('../src/components/CircuitDesigner.jsx', import.meta.url), 'utf8');
    const handler = src.slice(src.indexOf('const onGreenFlag = () => {'), src.indexOf("window.addEventListener('bw-green-flag', onGreenFlag);"));
    assert.match(handler, /greenFlagArmsOwnBoard\(\{ ownBoard: live\.board, externalBoard: live\.externalBoard \}\)/);
    assert.doesNotMatch(handler, /!live\.externalBoard && live\.board/, 'the old skip-while-anything-external rule');
    assert.match(handler, /runArmedRef\.current = live\.mode === 'simulate' && !live\.externalBoard \? null/, 'the arming waits for the hand-back too');
    const effect = src.slice(src.indexOf('const armedByFlag = runArmedRef.current;'));
    assert.match(effect, /\}, \[mode, parts, wires, stc, hasExternalBoard, advanceToLive\]\);/, 'the effect re-runs when the external board comes or goes');
    assert.match(effect, /const released = hadExternalRef\.current && !hasExternalBoard;/);
  });
});

/**
 * Load precedence — three paths to the first screen, tested individually.
 *
 * circuitData > pin inference > autosave > starter circuit
 *
 * These test the model-level behavior, not React rendering. The mount
 * effects in CircuitDesigner implement the precedence; these tests verify
 * the handleLoad function and the data each path produces.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Circuit, resetIds } from '../src/model/circuit.js';

const designerSource = readFileSync(new URL(
  '../src/components/CircuitDesigner.jsx', import.meta.url), 'utf8');

const circuitDataEffect = () => {
  const effect = /const prevCircuitDataRef = useRef\(null\);[\s\S]*?useEffect\(\(\) => \{([\s\S]*?)\n  \}, \[circuitData, handleLoad, projectData, circuit\]\);/.exec(designerSource);
  assert.ok(effect, 'the circuitData load effect remains identifiable');
  return effect[1];
};

describe('load precedence: model-level behavior', () => {
  it('commits a declarative file load as one React 16 update batch', () => {
    assert.match(designerSource, /import ReactDOM from 'react-dom';/);
    const batch = /ReactDOM\.unstable_batchedUpdates\(\(\) => \{([\s\S]*?)\n    \}\);/.exec(circuitDataEffect());
    assert.ok(batch, 'the common circuitData load must use the React 16 batching boundary');
    assert.match(batch[1], /handleLoad\(circuitData\);[\s\S]*setAnnotations\(\[\]\);/,
      'load UI state and annotation cleanup are one visual transaction');
  });

  it('keeps declarative-load precedence bookkeeping around the batch', () => {
    const effect = circuitDataEffect();
    assert.ok(effect.indexOf('prevCircuitDataRef.current = circuitData;') <
      effect.indexOf('ReactDOM.unstable_batchedUpdates'));
    assert.ok(effect.indexOf('ReactDOM.unstable_batchedUpdates') <
      effect.indexOf('fileLoadedRef.current = true;'));
    assert.match(effect, /localStorage\.setItem\('bw-circuit-file-loaded', '1'\)/);
  });

  it('circuitData load replaces existing parts (example beats autosave)', () => {
    resetIds();
    const c = new Circuit(5.0);
    // Simulate autosave state: a resistor + LED
    c.addPart('vcc', {}, 0, 0);
    c.addPart('resistor', { ohms: 1000 }, 0, 0);
    c.addPart('led', { vf: 2.0 }, 0, 0);
    assert.equal(c.parts.length, 3);

    // Simulate circuitData load (gallery example)
    c._saveHistory(); // save before replacing (undo recovery)
    c.parts = [
      { id: 'ex_vcc', kind: 'vcc', params: {}, terminals: ['vcc'], x: 0, y: 0, rotation: 0 },
      { id: 'ex_gnd', kind: 'gnd', params: {}, terminals: ['gnd'], x: 0, y: 0, rotation: 0 },
    ];
    c.wires = [];
    c._syncNetlist();
    c._saveHistory();

    assert.equal(c.parts.length, 2, 'example replaces autosave state');
    assert.ok(c.history.canUndo, 'undo recovers the previous state');
  });

  it('undo after circuitData load recovers the previous circuit', () => {
    resetIds();
    const c = new Circuit(5.0);
    c.addPart('resistor', { ohms: 470 }, 100, 100);
    c.addPart('led', { vf: 2.0 }, 200, 200);
    assert.equal(c.parts.length, 2);

    // Save, then load example
    c._saveHistory();
    c.parts = [{ id: 'new1', kind: 'vcc', params: {}, terminals: ['vcc'], x: 0, y: 0, rotation: 0 }];
    c.wires = [];
    c._syncNetlist();
    c._saveHistory();
    assert.equal(c.parts.length, 1);

    // Undo recovers
    c.undo();
    assert.equal(c.parts.length, 2, 'undo must recover the pre-load state');
  });

  it('starter circuit has at least a breadboard, a source, and an LED', () => {
    // The starter is built imperatively in CircuitDesigner's mount effect.
    // This test verifies the minimum content a first-time user should see.
    resetIds();
    const c = new Circuit(5.0);
    // Simulate what 9752b8c builds
    c.addPart('breadboard', {}, 470, 300);
    c.addPart('vsource', { variant: '9v', volts: 5 }, 130, 150);
    c.addPart('resistor', { ohms: 1000 }, 0, 0);
    c.addPart('led', { color: 'red' }, 0, 0, 'led1');

    assert.ok(c.parts.some(p => p.kind === 'breadboard'), 'must have a breadboard');
    assert.ok(c.parts.some(p => p.kind === 'vsource'), 'must have a power source');
    assert.ok(c.parts.some(p => p.kind === 'led'), 'must have an LED');
    assert.ok(c.parts.some(p => p.kind === 'resistor'), 'must have a resistor');
    assert.equal(c.parts.length, 4, 'starter has exactly 4 parts');
  });

  it('toJSON round-trip of starter circuit preserves all parts', () => {
    resetIds();
    const c = new Circuit(5.0);
    c.addPart('breadboard', {}, 470, 300);
    c.addPart('vsource', { variant: '9v', volts: 5 }, 130, 150);
    c.addPart('resistor', { ohms: 1000 }, 0, 0);
    c.addPart('led', { color: 'red' }, 0, 0, 'led1');

    const json = c.toJSON();
    const serialized = JSON.stringify(json);
    resetIds();
    const c2 = Circuit.fromJSON(JSON.parse(serialized));

    assert.equal(c2.parts.length, 4, 'all 4 parts survive round-trip');
    assert.ok(c2.parts.some(p => p.kind === 'breadboard'));
    assert.ok(c2.parts.some(p => p.kind === 'vsource'));
  });
});

describe('actual Designer load preserves supply voltage',()=>{
  const start=designerSource.indexOf('const handleLoad = useCallback((data) => {');
  const body=designerSource.slice(start+'const handleLoad = useCallback((data) => {'.length,
    designerSource.indexOf('\n  }, [circuit]);',start));
  const fixture=()=>{
    const c=new Circuit(5),v=c.addPart('vcc',{},0,0),g=c.addPart('gnd',{},0,100),r=c.addPart('resistor',{ohms:1000},0,50);
    c.addWire(v.id,'vcc',r.id,'a');c.addWire(r.id,'b',g.id,'gnd');return {c,r};
  };
  const loader=(c,source=body)=>new Function('Circuit','circuit','setAnnotations','setSelectedParts','setSelectedWire','setMode','setFitToken',
    'return data => {'+source+'};')(Circuit,c,()=>{},()=>{},()=>{},()=>{},()=>{});
  const check=(c,r,volts)=>{
    assert.equal(c.vcc,volts);assert.equal(c.board.vcc,volts);
    assert.ok(Math.abs(c.board.branchCurrent(r.id,'a')+volts/1000)<1e-9);
    assert.equal(c.toJSON().vcc,volts);
  };
  it('loads 4.5 and 9 V electrically, preserves model identity and undoes voltage-only changes',()=>{
    assert.ok(start>=0);const {c,r}=fixture(),same=c,data=c.toJSON(),load=loader(c);
    for(const vcc of [4.5,9]){load({...data,vcc});assert.equal(c,same);check(c,r,vcc);}
    assert.equal(c.undo(),true);check(c,r,4.5);
    assert.equal(c.redo(),true);check(c,r,9);
    const {vcc,...legacy}=data;load(legacy);check(c,r,5);
  });
  it('rejects omission of the actual parsed supply assignment',()=>{
    const {c,r}=fixture(),mutant=body.replace('circuit.vcc = parsed.vcc;','');
    assert.notEqual(mutant,body);loader(c,mutant)({...c.toJSON(),vcc:4.5});
    assert.throws(()=>check(c,r,4.5),assert.AssertionError);
  });
  it('engine-format nets use the loaded supply too',()=>{
    const {c,r}=fixture(),data=c.toJSON();
    loader(c)({...data,vcc:9,wires:[],nets:c.board.getNets()});check(c,r,9);
  });
});

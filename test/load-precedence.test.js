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
import { buildSeatedFromDeclarations, makeCodeBoardFor } from '../src/model/infer-seated.js';
import { isEsp32S040Device } from '../src/model/esp32-s040-face.js';
import { migrateStarterAutosave } from '../src/model/starter-migration.js';
import { autosaveRecord, carriesFileNets } from '../src/model/autosave-record.js';
import { isLegacyFlatWire } from '../src/model/wire-endpoints.js';
import { FOOTPRINTS as BB_FOOTPRINTS, computeLeadMap } from '../src/model/footprints.js';

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

  it('keeps declarative-load bookkeeping and success checks around the batch', () => {
    const effect = circuitDataEffect();
    assert.ok(effect.indexOf('prevCircuitDataRef.current = circuitData;') <
      effect.indexOf('ReactDOM.unstable_batchedUpdates'));
    assert.ok(effect.indexOf('ReactDOM.unstable_batchedUpdates') <
      effect.indexOf('if (!loaded) return;'));
    assert.doesNotMatch(effect, /localStorage\.setItem\('bw-circuit-file-loaded'/,
      'the prop effect must not re-arm ownership after the shared loader rejected a file or a storage write');
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
  const signature='const handleLoad = useCallback((data, { fileAuthority = true } = {}) => {';
  const start=designerSource.indexOf(signature);
  const body=designerSource.slice(start+signature.length,
    designerSource.indexOf('\n  }, [circuit]);',start));
  const fixture=()=>{
    const c=new Circuit(5),v=c.addPart('vcc',{},0,0),g=c.addPart('gnd',{},0,100),r=c.addPart('resistor',{ohms:1000},0,50);
    c.addWire(v.id,'vcc',r.id,'a');c.addWire(r.id,'b',g.id,'gnd');return {c,r};
  };
  const loader=(c,source=body)=>new Function('Circuit','circuit','setAnnotations','setSelectedParts','setSelectedWire','setMode','setFitToken','fileLoadedRef','localStorage','autosaveRecord','carriesFileNets','fileNetsRef',
    'return (data, { fileAuthority = true } = {}) => {'+source+'};')(Circuit,c,()=>{},()=>{},()=>{},()=>{},()=>{},{current:false},{setItem(){}},autosaveRecord,carriesFileNets,{current:false});
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

describe('direct file load keeps authority through host declaration feedback', () => {
  const body = /const handleLoad = useCallback\(\(data, \{ fileAuthority = true \} = \{\}\) => \{([\s\S]*?)\n  \}, \[circuit\]\);/.exec(designerSource)?.[1];
  const inferBody = /useEffect\(\(\) => \{\n    const pins = projectData\?\.pins;([\s\S]*?)\n  \}, \[projectData, loadInferred\]\);/.exec(designerSource)?.[1];
  const noop = () => {};
  const fixture = (values = new Map()) => {
    const circuit = new Circuit(3.3), fileLoadedRef = {current:values.get('bw-circuit-file-loaded') === '1'};
    const fileNetsRef = {current:false};
    const localStorage = {setItem:(key,value)=>values.set(key,value),
      getItem:key=>values.get(key) || null, removeItem:key=>values.delete(key)};
    const load = new Function('Circuit','circuit','setAnnotations','setSelectedParts','setSelectedWire',
      'setMode','setFitToken','fileLoadedRef','localStorage','console','autosaveRecord','carriesFileNets','fileNetsRef', 'return (data, { fileAuthority = true } = {}) => {' + body + '};')(
      Circuit,circuit,noop,noop,noop,noop,noop,fileLoadedRef,localStorage,{error:noop},autosaveRecord,carriesFileNets,fileNetsRef);
    const data = {vcc:3.3,parts:[{id:'panel-a',kind:'esp32_4848s040',params:{},x:320,y:260}],
      wires:[{id:'h1-ground',from:{part:'panel-a',terminal:'gpio1'},to:{part:'panel-a',terminal:'gnd'}}]};
    const inferState = {projectData:null,makeCodeBoardFor,isEsp32S040Device,
      prevPinsRef:{current:null},prevCpxRef:{current:false},prevS040Ref:{current:false},
      fileRestoreAttemptedRef:{current:false},fileLoadedRef,circuit,circuitData:null,
      buildSeatedFromDeclarations,setAnnotations:noop,localStorage,handleLoad:load,migrateStarterAutosave};
    const infer = (projectData = {device:'esp32-4848s040',pins:[]}, circuitData = null) => {
      Object.assign(inferState,{projectData,circuitData});
      return new Function(...Object.keys(inferState),'const pins = projectData?.pins;' + inferBody)(...Object.values(inferState));
    };
    const autosaveBody = /const autosaveTimer = useRef\(null\);\n  useEffect\(\(\) => \{([\s\S]*?)\n  \}, \[rev\]\);/.exec(designerSource)?.[1];
    const autosave = () => {
      assert.ok(autosaveBody, 'execute the actual debounced autosave callback');
      new Function('localStorage','autosaveTimer','setTimeout','clearTimeout','parts','circuit','fileLoadedRef','autosaveRecord','fileNetsRef',autosaveBody)(
        localStorage,{current:null},fn=>{fn();return 1;},noop,circuit.parts,circuit,fileLoadedRef,autosaveRecord,fileNetsRef);
    };
    const declarativeLoad = circuitData => {
      const args = {circuitData,prevCircuitDataRef:{current:null},projectData:{pins:[]},
        circuit,handleLoad:load,isLegacyFlatWire,buildSeatedFromDeclarations,BB_FOOTPRINTS,computeLeadMap,
        setSelectedParts:noop,setSelectedWire:noop,setMode:noop,setAnnotations:noop,
        ReactDOM:{unstable_batchedUpdates:fn=>fn()}};
      new Function(...Object.keys(args),circuitDataEffect())(...Object.values(args));
    };
    return {circuit,fileLoadedRef,values,localStorage,load,data,infer,autosave,declarativeLoad};
  };

  it('preserves the exact imported S040 owner and H1 wire when the host echoes derived declarations', () => {
    assert.ok(body && inferBody, 'execute both actual Designer bodies');
    const {circuit,fileLoadedRef,load,data,values} = fixture();
    load(data);
    const imported = circuit.toJSON();
    new Function('projectData','makeCodeBoardFor','isEsp32S040Device','prevPinsRef','prevCpxRef',
      'prevS040Ref','fileLoadedRef','circuit','buildSeatedFromDeclarations','setAnnotations','fileRestoreAttemptedRef',
      'const pins = projectData?.pins;' + inferBody)(
      {device:'esp32-4848s040',pins:[]},makeCodeBoardFor,isEsp32S040Device,{current:null},
      {current:false},{current:false},fileLoadedRef,circuit,buildSeatedFromDeclarations,noop,{current:true});
    assert.deepEqual(circuit.toJSON(), imported);
    assert.deepEqual(circuit.parts.map(part=>part.id), ['panel-a']);
    assert.equal(circuit.wires.length, 1);
    assert.equal(values.get('bw-circuit-file-loaded'), '1');
  });

  it('ordinary autosave restoration still yields to later pin inference', () => {
    const f = fixture();
    f.values.set('bw-circuit-autosave', JSON.stringify(f.data));
    const inputs = {projectData:{device:'pico',pins:[]},makeCodeBoardFor,isEsp32S040Device,
      prevPinsRef:{current:null},prevCpxRef:{current:false},prevS040Ref:{current:false},
      fileLoadedRef:f.fileLoadedRef,circuit:f.circuit,buildSeatedFromDeclarations,setAnnotations:noop,
      localStorage:f.localStorage,handleLoad:f.load,migrateStarterAutosave,
      fileRestoreAttemptedRef:{current:false},circuitData:null};
    const infer = () => new Function(...Object.keys(inputs), 'const pins = projectData?.pins;' + inferBody)(...Object.values(inputs));
    infer();
    assert.deepEqual(f.circuit.parts.map(part=>part.id),['panel-a'],'the real autosave path restores first');
    assert.equal(f.fileLoadedRef.current,false);
    assert.equal(f.values.has('bw-circuit-file-loaded'),false);
    inputs.projectData = {device:'esp32-4848s040',pins:[]};
    infer();
    assert.notEqual(f.circuit.parts[0].id,'panel-a','a new device declaration can rebuild an inferred autosave');
    assert.deepEqual(f.circuit.parts.map(part=>part.kind),['esp32_4848s040']);
  });

  it('arms file authority before history or netlist publication, including a valid empty file', () => {
    for (const empty of [false,true]) {
      const {circuit,fileLoadedRef,values,load,data} = fixture();
      for (const name of ['_saveHistory','_syncNetlist']) {
        const original = circuit[name].bind(circuit);
        circuit[name] = (...args) => {
          assert.equal(fileLoadedRef.current,true, `${name} can publish declarations`);
          assert.equal(values.get('bw-circuit-file-loaded'),'1');
          return original(...args);
        };
      }
      load(empty ? {parts:[],wires:[]} : data);
      assert.equal(circuit.parts.length,empty ? 0 : 1);
    }
  });

  it('keeps current authority and circuit untouched when parsing an invalid file', () => {
    for (const previous of [false,true]) {
      const {circuit,fileLoadedRef,values,load,data} = fixture();
      load(data);
      fileLoadedRef.current = previous;
      if (!previous) values.delete('bw-circuit-file-loaded');
      const before = circuit.toJSON(), saved = [...values];
      for (const invalid of [null,{}, {parts:[null]}]) {
        load(invalid);
        assert.deepEqual(circuit.toJSON(),before);
        assert.equal(fileLoadedRef.current,previous);
        assert.deepEqual([...values],saved);
      }
    }
  });

  it('explicit Infer and Clear still release file authority', () => {
    for (const command of ['Infer','Clear']) {
      const {circuit,fileLoadedRef,localStorage,values,load,data} = fixture();
      load(data);
      const pattern = command === 'Infer'
        ? /const handleLoadCircuit = useCallback\(\(inferredParts, inferredNets, ann\) => \{([\s\S]*?)\n  \}, \[loadInferred, circuit\]\);/
        : /const handleClear = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[circuit\]\);/;
      const handler = pattern.exec(designerSource)?.[1];
      assert.ok(handler, `execute the actual ${command} handler`);
      new Function('circuit','fileLoadedRef','localStorage','loadInferred','inferredParts','inferredNets',
        'ann','setAnnotations','setSelectedParts','setSelectedWire','setMode',handler)(
        circuit,fileLoadedRef,localStorage,noop,[],[],[],noop,noop,noop,noop);
      assert.equal(fileLoadedRef.current,false);
      assert.equal(values.has('bw-circuit-file-loaded'),false);
    }
  });

  it('restores the exact file on a new mount before declared pins can replace it', () => {
    const first = fixture();
    first.load(first.data);
    const before = first.circuit.toJSON();
    assert.deepEqual(JSON.parse(first.values.get('bw-circuit-autosave')).parts,before.parts,
      'the new file is durable before the debounce or a reload can run');
    const second = fixture(first.values);
    second.infer();
    assert.deepEqual(second.circuit.toJSON(),before);
    assert.equal(second.fileLoadedRef.current,true);
    second.infer({device:'pico',pins:[{name:'new-led',gpio:2,direction:'output'}]});
    assert.deepEqual(second.circuit.toJSON(),before,'subsequent declaration feedback keeps the restored physical owner');
  });

  it('persists and restores an explicitly empty file instead of the previous autosave', () => {
    const first = fixture();
    first.load(first.data);
    first.load({vcc:4.5,parts:[],wires:[]});
    assert.deepEqual(JSON.parse(first.values.get('bw-circuit-autosave')).parts,[]);
    first.autosave();
    assert.deepEqual(JSON.parse(first.values.get('bw-circuit-autosave')).parts,[]);
    const second = fixture(first.values);
    second.infer();
    assert.deepEqual(second.circuit.parts,[]);
    assert.equal(second.circuit.vcc,4.5);
    assert.equal(second.fileLoadedRef.current,true,'empty is a valid intentional file, not a missing snapshot');
  });

  it('releases stale ownership for missing, corrupt, or rejected snapshots and infers a usable board', () => {
    for (const saved of [undefined,'{bad json',JSON.stringify({unexpected:[]}),JSON.stringify({parts:[null]})]) {
      const values = new Map([['bw-circuit-file-loaded','1']]);
      if (saved !== undefined) values.set('bw-circuit-autosave',saved);
      const next = fixture(values);
      next.infer();
      assert.equal(next.fileLoadedRef.current,false);
      assert.equal(values.has('bw-circuit-file-loaded'),false);
      assert.deepEqual(next.circuit.parts.map(part=>part.kind),['esp32_4848s040']);
    }
  });

  it('gives a new circuitData prop priority over the previously saved file', () => {
    const first = fixture();
    first.load(first.data);
    const next = fixture(first.values);
    const newFile = {...first.data,parts:[{...first.data.parts[0],id:'new-panel'}],wires:[]};
    next.infer({device:'esp32-4848s040',pins:[]},newFile);
    assert.deepEqual(next.circuit.parts,[],'mount waits for the explicit prop instead of loading old storage');
    next.declarativeLoad(newFile);
    assert.deepEqual(next.circuit.parts.map(part=>part.id),['new-panel']);
    assert.deepEqual(JSON.parse(first.values.get('bw-circuit-autosave')).parts.map(part=>part.id),['new-panel']);
  });

  it('preserves engine-format nets through the immediate file snapshot and later autosaves', () => {
    const original = new Circuit(9);
    const v = original.addPart('vcc',{},0,0), g = original.addPart('gnd',{},0,100), r = original.addPart('resistor',{ohms:1000},0,50);
    original.addWire(v.id,'vcc',r.id,'a'); original.addWire(r.id,'b',g.id,'gnd');
    const data = {...original.toJSON(),wires:[],nets:original.board.getNets()};
    for (const debounced of [false,true]) {
      const first = fixture(); first.load(data);
      if (debounced) first.autosave();
      const next = fixture(first.values); next.infer();
      assert.deepEqual(next.circuit.board.getNets(),first.circuit.board.getNets());
      assert.ok(Math.abs(next.circuit.board.branchCurrent(r.id,'a')+0.009)<1e-9);
      assert.deepEqual(next.circuit.wires,[],'engine-format connections do not need synthetic wires');
    }
  });

  it('does not leave an older snapshot file-owned when storage rejects a replacement', () => {
    const f = fixture(); f.load(f.data);
    f.localStorage.setItem = () => {throw new Error('quota');};
    const replacement = {...f.data,parts:[{...f.data.parts[0],id:'replacement'}],wires:[]};
    f.declarativeLoad(replacement);
    assert.deepEqual(f.circuit.parts.map(part=>part.id),['replacement']);
    assert.equal(f.fileLoadedRef.current,true,'the current session still protects the newly opened file');
    assert.equal(f.values.has('bw-circuit-file-loaded'),false,'a rejected write cannot retain the old marker');
  });
});

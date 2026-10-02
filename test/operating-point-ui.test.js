/** Static DC analysis is visible in Instruments and stays honest about import loss. */
import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Circuit } from '../src/model/circuit.js';
import { importSpice } from '../src/importers/spice.js';
import {
  blockersFromImport, operatingPointRows, runOperatingPointAnalysis,
} from '../src/model/operating-point-view.js';

const root = join(import.meta.dirname, '..');

function rcCircuit() {
  const c = Circuit.fromJSON({
    parts: [
      { id: 'V1', kind: 'vsource', params: { volts: 6 } },
      { id: 'R1', kind: 'resistor', params: { ohms: 2000 } },
      { id: 'R2', kind: 'resistor', params: { ohms: 1000 } },
      { id: 'C1', kind: 'capacitor', params: { farads: 10e-6 } },
      { id: 'GND1', kind: 'gnd', params: {} },
    ],
    wires: [
      { from: 'V1', fromTerminal: 'pos', to: 'R1', toTerminal: 'a' },
      { from: 'R1', fromTerminal: 'b', to: 'R2', toTerminal: 'a' },
      { from: 'R1', fromTerminal: 'b', to: 'C1', toTerminal: 'a' },
      { from: 'V1', fromTerminal: 'neg', to: 'R2', toTerminal: 'b' },
      { from: 'R2', fromTerminal: 'b', to: 'C1', toTerminal: 'b' },
      { from: 'C1', fromTerminal: 'b', to: 'GND1', toTerminal: 'gnd' },
    ],
  });
  c.setPower(true);
  return c;
}

describe('operating-point Instruments action', () => {
  it('labels both aliased supply currents unavailable while retaining solved voltage and load current in either order', () => {
    for (const reverse of [false, true]) {
      const supplies = [{id:'A',kind:'vcc',params:{volts:5}}, {id:'B',kind:'vcc',params:{volts:5}}];
      if (reverse) supplies.reverse();
      const circuit = Circuit.fromJSON({parts:[...supplies,
        {id:'R',kind:'resistor',params:{ohms:1000}}, {id:'G',kind:'gnd',params:{}}], wires:[
        {from:'A',fromTerminal:'vcc',to:'B',toTerminal:'vcc'},
        {from:'A',fromTerminal:'vcc',to:'R',toTerminal:'a'},
        {from:'R',fromTerminal:'b',to:'G',toTerminal:'gnd'},
      ]});
      assert.equal(circuit.netlistError,null);
      circuit.setPower(true);
      const outcome=runOperatingPointAnalysis(circuit.board,[]);
      assert.equal(outcome.ok,true,outcome.reason);
      assert.deepEqual([...outcome.result.indeterminateBranchCurrents].sort(),['A','B']);
      const rows=operatingPointRows(outcome.result);
      assert.deepEqual(rows.unavailableCurrents,['A','B']);
      assert.ok(!rows.currents.some(row=>row.id==='A.vcc'||row.id==='B.vcc'),'never display the arbitrary owner aggregate as individual current');
      assert.ok(rows.nodes.some(row=>Math.abs(row.value-5)<1e-12));
      assert.ok(rows.currents.some(row=>row.id==='R.a'&&Math.abs(row.value-.005)<1e-12));
      const rail=[...outcome.result.railCurrents.keys()][0];
      assert.ok(Math.abs(circuit.board.railCurrent(rail)-.005)<1e-12);
    }
  });

  it('names an omitted ideal zero self-source but preserves genuine determinate zero currents', () => {
    for(const rInternal of [0,10]){
      const imported=importSpice('zero current control\nV1 rail 0 5\nR1 rail 0 1k\nVZERO rail rail 0\n.end\n');
      imported.parts.find(p=>p.id==='VZERO').params.rInternal=rInternal;
      const circuit=Circuit.fromJSON({parts:imported.parts,wires:imported.wires});
      circuit.setPower(true);
      const outcome=runOperatingPointAnalysis(circuit.board,[]);
      assert.equal(outcome.ok,true,outcome.reason);
      const rows=operatingPointRows(outcome.result);
      assert.deepEqual(rows.unavailableCurrents,rInternal===0?['VZERO']:[]);
      if(rInternal===0) assert.ok(!rows.currents.some(row=>row.id.startsWith('VZERO.')));
      else assert.ok(rows.currents.some(row=>row.id==='VZERO.pos'&&Math.abs(row.value)===0));
      assert.ok(rows.currents.some(row=>row.id==='R1.a'&&Math.abs(row.value-.005)<1e-12));
    }
    assert.deepEqual(operatingPointRows(null),{nodes:[],currents:[],unavailableCurrents:[]});
    // Legacy engines without availability metadata keep determinate output.
    assert.deepEqual(operatingPointRows({branchCurrents:new Map([['R',new Map([['a',0]])]])}).currents,[{id:'R.a',value:0}]);
  });

  it('invokes the engine-owned analysis and leaves live state unchanged', () => {
    const circuit = rcCircuit();
    const before = circuit.board.snapshot();
    const outcome = runOperatingPointAnalysis(circuit.board, []);
    assert.equal(outcome.ok, true);
    assert.equal(outcome.result.analysis.kind, 'dc-operating-point');
    assert.deepEqual(circuit.board.snapshot(), before);
    const rows = operatingPointRows(outcome.result);
    assert.ok(rows.nodes.some(row => Math.abs(row.value - 2) < 1e-8));
    assert.ok(rows.currents.some(row => row.id === 'C1.a' && row.value === 0));
    assert.ok(rows.currents.some(row => row.id === 'R1.a' && Math.abs(row.value - 0.002) < 1e-12));
  });

  it('preserves a lossy import finding and refuses before calling the engine', () => {
    const path = join(root, 'test', 'fixtures', 'spice-wavefile-source.net');
    const imported = importSpice(readFileSync(path, 'utf8'));
    const blockers = blockersFromImport(imported, 'spice', 'wavefile-source.net');
    assert.deepEqual(blockers, [{
      type: 'semantic-import-loss', format: 'spice', sourceName: 'wavefile-source.net',
      ref: 'Vstim', reason: 'external WAVEFILE waveform is not read or modelled',
      source: 'Vstim signal 0 wavefile=definitely-not-present.wav chan=0',
      fallback: { parameter: 'volts', value: 0 },
    }]);
    let calls = 0;
    const outcome = runOperatingPointAnalysis({ operatingPoint() { calls++; } }, blockers);
    assert.equal(outcome.ok, false);
    assert.equal(calls, 0, 'lossy import must be rejected before numeric analysis');
    assert.match(outcome.reason, /blocked by 1 import finding.*Vstim.*WAVEFILE/i);
  });

  it('unmapped components are blockers too, not a partial-circuit result', () => {
    const blockers = blockersFromImport({ unmapped: [{ ref: 'U1', libsource: 'LM193' }] }, 'kicad-legacy', 'x.sch');
    assert.deepEqual(blockers, [{
      type: 'unmapped-component', format: 'kicad-legacy', sourceName: 'x.sch',
      ref: 'U1', reason: 'LM193',
    }]);
  });

  it('makes engine capability and domain refusals visible', () => {
    const oldEngine = runOperatingPointAnalysis({}, []);
    assert.equal(oldEngine.ok, false);
    assert.match(oldEngine.reason, /does not provide DC operating-point analysis/);
    const unsupported = runOperatingPointAnalysis({
      operatingPoint() { throw new Error('operatingPoint: unsupported part kinds: inductor'); },
    }, []);
    assert.equal(unsupported.ok, false);
    assert.match(unsupported.reason, /unsupported part kinds: inductor/);
  });

  it('blockers survive save/load with their source text', () => {
    const circuit = rcCircuit();
    circuit.analysisBlockers = [{ type: 'semantic-import-loss', ref: 'V1', reason: 'lost', source: 'V1 x 0 wavefile=a.wav' }];
    const saved = circuit.toJSON();
    const loaded = Circuit.fromJSON(saved);
    assert.deepEqual(loaded.analysisBlockers, circuit.analysisBlockers);
    assert.notEqual(loaded.analysisBlockers, circuit.analysisBlockers, 'save/load owns an independent array');
  });

  it('the existing simulation controls render the reachable result/refusal panel', () => {
    const designer = readFileSync(join(root, 'src', 'components', 'CircuitDesigner.jsx'), 'utf8');
    const controls = designer.slice(designer.indexOf('data-simulation-controls'), designer.indexOf('data-scope-module'));
    assert.match(controls, /<OperatingPointPanel board=\{activeBoard\} blockers=\{circuit\.analysisBlockers\}/);
    const panel = readFileSync(join(root, 'src', 'components', 'OperatingPointPanel.jsx'), 'utf8');
    assert.match(panel, /data-testid="bw-operating-point-result"/);
    assert.match(panel, /data-testid="bw-operating-point-refusal"/);
    assert.match(panel, /does not change transient simulation state/);
    assert.match(panel, /currentConvention/);
    assert.match(panel, /data-testid="bw-operating-point-unavailable-currents"/);
    assert.match(panel, /rows\.unavailableCurrents\.join/);
    assert.match(panel, /controlled sources.*controlledSources/s);
    assert.match(panel, /supported kinds.*supportedKinds/s);
  });
});

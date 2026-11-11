/**
 * One circuit, one autosave record (Lite task I5). handleLoad's synchronous
 * write and the debounced autosave must produce identical bytes for an
 * unchanged file-owned circuit, or a remount after a load silently rewrites
 * the stored record (a host refusing a project sidecar saw it change).
 */
import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Circuit, resetIds } from '../src/model/circuit.js';
import { autosaveRecord, carriesFileNets } from '../src/model/autosave-record.js';

const designer = readFileSync(new URL('../src/components/CircuitDesigner.jsx', import.meta.url), 'utf8');

const wiredFile = () => {
  resetIds();
  const c = new Circuit();
  const r = c.addPart('resistor', { resistance: 220 }, 100, 100);
  const led = c.addPart('led', {}, 200, 100);
  c.addWire(r.id, r.terminals[1], led.id, led.terminals[0]);
  return c.toJSON();
};

describe('one autosave record per circuit', () => {
  it('a wire-based file: the load write equals the later debounced autosave', () => {
    const file = wiredFile();
    assert.equal(carriesFileNets(file), false);
    const parsed = Circuit.fromJSON(file);
    const atLoad = autosaveRecord(parsed.toJSON(), { fileNets: carriesFileNets(file), nets: file.nets });
    // The live circuit after the load, as the debounced autosave sees it.
    const live = Circuit.fromJSON(JSON.parse(atLoad));
    assert.ok(Array.isArray(live.resolvedNets) && live.resolvedNets.length > 0,
      'the live circuit does have resolved nets the old autosave would have added');
    const later = autosaveRecord(live.toJSON(), { fileNets: carriesFileNets(file), nets: live.resolvedNets });
    assert.equal(later, atLoad);
    assert.equal(JSON.parse(later).nets, undefined);
  });

  it('a nets-described file keeps its connectivity across autosaves', () => {
    const nets = [{ id: 'n1', terminals: [{ part: 'r1', terminal: 'a' }] }];
    assert.equal(carriesFileNets({ parts: [], nets }), true);
    assert.deepEqual(JSON.parse(autosaveRecord({ parts: [] }, { fileNets: true, nets })).nets, nets);
  });

  it('both Designer writers build the record through autosaveRecord', () => {
    assert.equal((designer.match(/autosaveRecord\(/g) || []).length, 2);
    assert.doesNotMatch(designer, /saved\.nets = circuit\.resolvedNets/);
    assert.match(designer, /fileNets: fileLoadedRef\.current && fileNetsRef\.current/);
  });
});

/**
 * Strict SPICE LEVEL=1 NMOS admission across the importer and source-analysis
 * boundary.  The general importer intentionally reads useful fields from
 * richer MOS cards; this test proves that only the complete represented law
 * receives Board's public DC selector.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { importSpice } from '../src/importers/spice.js';
import { runSourceAnalyses } from '../src/model/source-analysis.js';

const deck = ({
  model = 'NMOS(Level=1 VTO=1 KP=50u LAMBDA=0.01)',
  instance = 'W=100u L=1u',
  bulk = '0',
} = {}) => [
  '* exact grounded-bulk Level-1 NMOS',
  'VDD vdd 0 9',
  'R1 vdd gate 11k',
  'R2 gate 0 6.8k',
  'RD vdd drain 910',
  'RS source 0 180',
  `M1 drain gate source ${bulk} NM ${instance}`,
  `.model NM ${model}`,
  '.op',
  '.end',
].join('\n');

const transistor = imported => imported.parts.find(part => part.id === 'M1');

describe('strict grounded-bulk Level-1 NMOS source analysis', () => {
  it('admits the exact represented card and preserves its fourth source node', () => {
    const imported = importSpice(deck());
    assert.deepEqual(transistor(imported).params, {
      vth: 1, kp: 50e-6, lambda: 0.01, _model: 'NM',
      w: 100e-6, l: 1e-6, bulkAtGround: true, model: 'level1',
    });

    const [run] = runSourceAnalyses(imported, { format: 'spice' });
    assert.equal(run.status, 'pass', JSON.stringify(run));
    assert.equal(run.evidence, 'original-direct');
    assert.deepEqual(run.topology.find(card => card.kind === 'M').nodes,
      ['n2', 'n1', 'n3', 'gnd']);
    assert.deepEqual(run.metadata.nmos, {
      model: 'explicit-spice-level1-grounded-bulk',
      requiredParameters: ['vth', 'kp', 'w', 'l', 'lambda', 'bulkAtGround'],
      defaults: { bulkIs: 1e-14, bulkN: 1 }, thermalVoltage: 0.02585,
      temperatureModel: 'fixed',
    });
    const voltage = id => run.observables.nodes.find(node => node.id === id).voltage;
    assert.ok(Math.abs(voltage('n1') - 3.438202247191011) < 1e-10);
    assert.ok(Math.abs(voltage('n2') - 4.032561273612058) < 1e-9);
    assert.ok(Math.abs(voltage('n3') - 0.9825702966209605) < 1e-9);
    assert.deepEqual(run.observables.sourceCurrents.map(row => row.id), ['s0']);
    assert.ok(Math.abs(run.observables.sourceCurrents[0].current
      + 0.005964341852679672) < 1e-10);
  });

  it('withholds the selector from every richer, incomplete, or unproved shape', () => {
    const cases = [
      ['missing LAMBDA', { model: 'NMOS(Level=1 VTO=1 KP=50u)' }],
      ['other level', { model: 'NMOS(Level=2 VTO=1 KP=50u LAMBDA=0.01)' }],
      ['extra model field', { model: 'NMOS(Level=1 VTO=1 KP=50u LAMBDA=0.01 GAMMA=0.5)' }],
      ['bare model flag', { model: 'NMOS(Level=1 VTO=1 KP=50u LAMBDA=0.01 EXTRA)' }],
      ['missing W', { instance: 'L=1u' }],
      ['extra instance field', { instance: 'W=100u L=1u AD=2p' }],
      ['duplicate geometry', { instance: 'W=100u W=200u L=1u' }],
      ['unparsed instance token', { instance: 'W=100u L=1u EXTRA' }],
      ['bulk on source', { bulk: 'source' }],
      ['bulk on a third node', { bulk: 'body' }],
      ['PMOS', { model: 'PMOS(Level=1 VTO=-1 KP=50u LAMBDA=0.01)' }],
    ];
    for (const [name, options] of cases) {
      const imported = importSpice(deck(options));
      assert.equal(transistor(imported).params.model, undefined,
        `${name} must not acquire the strict selector: ${JSON.stringify(transistor(imported).params)}`);
      const [run] = runSourceAnalyses(imported, { format: 'spice' });
      assert.notEqual(run.status, 'pass', `${name} must remain refused: ${JSON.stringify(run)}`);
    }
  });
});

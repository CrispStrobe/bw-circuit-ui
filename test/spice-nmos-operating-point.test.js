/**
 * Strict SPICE LEVEL=1 NMOS admission across the importer and source-analysis
 * boundary.  The general importer intentionally reads useful fields from
 * richer MOS cards; this test proves that only the complete represented law
 * receives Board's public DC selector.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { importSpice } from '../src/importers/spice.js';
import { Circuit } from '../src/model/circuit.js';
import { extractNetlist } from '../src/model/netlist.js';
import { toSpice } from '../src/model/exporters/spice.js';
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
const HAS_NGSPICE = spawnSync('ngspice', ['--version'], { encoding: 'utf8' }).status === 0;

function ngspiceSourceBulk(deckText) {
  const text = `${deckText.replace(/\n\.op\n\.end$/i, '')}
.temp 27
.options tnom=27 reltol=1e-12 abstol=1e-18 vntol=1e-15
.control
set numdgt=17
op
print v(out) @m1[id] i(vs)
.endc
.end
`;
  const run = spawnSync('ngspice', ['-b'], { input: text, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const read = name => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = run.stdout.match(new RegExp(`${escaped}\\s*=\\s*([-+0-9.e]+)`, 'i'));
    assert.ok(match, `${name} absent from:\n${run.stdout}`);
    return Number(match[1]);
  };
  return { out: read('v(out)'), drain: read('@m1[id]'), supply: read('i(vs)') };
}

function ngspiceBodyEffect(deckText) {
  const text = `${deckText.replace(/\n\.op\n\.end$/i, '')}
.temp 27
.options tnom=27 reltol=1e-12 abstol=1e-18 vntol=1e-15
.control
set numdgt=17
op
print v(gate) v(drain) v(source) i(vdd)
.endc
.end
`;
  const run = spawnSync('ngspice', ['-b'], { input: text, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const read = name => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = run.stdout.match(new RegExp(`${escaped}\\s*=\\s*([-+0-9.e]+)`, 'i'));
    assert.ok(match, `${name} absent from:\n${run.stdout}`);
    return Number(match[1]);
  };
  return Object.fromEntries(['v(gate)', 'v(drain)', 'v(source)', 'i(vdd)']
    .map(name => [name, read(name)]));
}

const sourceBulkDeck = ({ model = 'NMOS(Level=1 VTO=1 KP=100u LAMBDA=0.02)',
  instance = 'W=1u L=1u' } = {}) => [
  '* exact source-tied-bulk Level-1 NMOS, forward-biased drain junction',
  'VS source 0 5',
  'R1 out 0 10k',
  `M1 out source source source NM ${instance}`,
  `.model NM ${model}`,
  '.op',
  '.end',
].join('\n');

const reverseVdsDeck = () => [
  '* exact grounded-bulk Level-1 NMOS with authored negative VDS',
  'VG gate 0 3',
  'VD drain 0 -0.2',
  'M1 drain gate 0 0 NM W=1u L=1u',
  '.model NM NMOS(LEVEL=1 VTO=1 KP=100u LAMBDA=.02)',
  '.op',
  '.end',
].join('\n');

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
      optionalParameterGroups: [['gamma', 'phi']],
      defaults: { bulkIs: 1e-14, bulkN: 1 }, thermalVoltage: 0.025864925786328753,
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
    const missingModel = importSpice(deck().replace(/^\.model.*$/m, ''));
    assert.equal(transistor(missingModel).params.model, undefined);
    assert.notEqual(runSourceAnalyses(missingModel, { format: 'spice' })[0].status, 'pass');

    const cases = [
      ['missing LAMBDA', { model: 'NMOS(Level=1 VTO=1 KP=50u)' }],
      ['other level', { model: 'NMOS(Level=2 VTO=1 KP=50u LAMBDA=0.01)' }],
      ['extra model field', { model: 'NMOS(Level=1 VTO=1 KP=50u LAMBDA=0.01 GAMMA=0.5)' }],
      ['bare model flag', { model: 'NMOS(Level=1 VTO=1 KP=50u LAMBDA=0.01 EXTRA)' }],
      ['missing W', { instance: 'L=1u' }],
      ['extra instance field', { instance: 'W=100u L=1u AD=2p' }],
      ['duplicate geometry', { instance: 'W=100u W=200u L=1u' }],
      ['unparsed instance token', { instance: 'W=100u L=1u EXTRA' }],
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

  it('preserves signed reverse-VDS channel current through the imported source-analysis route', {
    skip: !HAS_NGSPICE,
  }, () => {
    const text = reverseVdsDeck();
    const oracleRun = spawnSync('ngspice', ['-b'], {
      input: text.replace('\n.op\n.end', [
        '.temp 27',
        '.options tnom=27 reltol=1e-12 abstol=1e-18 vntol=1e-15',
        '.control',
        'set numdgt=17',
        'op',
        'print @m1[id] i(vd)',
        '.endc',
        '.end',
      ].join('\n')),
      encoding: 'utf8',
    });
    assert.equal(oracleRun.status, 0, oracleRun.stderr || oracleRun.stdout);
    const read = name => {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = oracleRun.stdout.match(new RegExp(`${escaped}\\s*=\\s*([-+0-9.e]+)`, 'i'));
      assert.ok(match, `${name} absent from:\n${oracleRun.stdout}`);
      return Number(match[1]);
    };

    const imported = importSpice(text);
    const [run] = runSourceAnalyses(imported, { format: 'spice' });
    assert.equal(run.status, 'pass', JSON.stringify(run));
    assert.deepEqual(run.topology.find(card => card.kind === 'M').nodes,
      ['n1', 'n0', 'gnd', 'gnd']);
    const drainSource = run.observables.sourceCurrents.find(row => row.id === 's1').current;
    assert.ok(drainSource > 0, `reverse-VDS supply current lost its sign: ${drainSource}`);
    assert.ok(Math.abs(drainSource - read('i(vd)')) < 1e-12,
      `${drainSource} vs source-lead ${read('i(vd)')}`);
    assert.ok(Math.abs(drainSource + read('@m1[id]')) < 1e-12,
      `${drainSource} vs MOS authored-drain ${read('@m1[id]')}`);
  });
});

describe('exact grounded-bulk Level-1 NMOS body-effect DC', () => {
  const bodyEffectDeck = (analysis = '.op', model =
    'NMOS(LEVEL=1 VTO=1 KP=100u LAMBDA=.02 GAMMA=.5 PHI=.6)') => [
    '* exact NMOS body-effect law',
    'VDD vdd 0 10',
    'VG gate 0 DC 3 AC 1',
    'RS source 0 1k',
    'RD vdd drain 1k',
    'M1 drain gate source 0 NM W=100u L=1u',
    `.model NM ${model}`,
    analysis,
    '.end',
  ].join('\n');

  it('runs the complete represented DC law and its qualified body-effect AC Jacobian', {
    skip: !HAS_NGSPICE,
  }, () => {
    const oracle = ngspiceBodyEffect(bodyEffectDeck());
    const imported = importSpice(bodyEffectDeck());
    assert.equal(transistor(imported).params.model, 'level1');
    assert.equal(transistor(imported).params.gamma, 0.5);
    assert.equal(transistor(imported).params.phi, 0.6);
    const [op] = runSourceAnalyses(imported, { format: 'spice' });
    assert.equal(op.status, 'pass', JSON.stringify(op));
    const mosNodes = op.topology.find(card => card.kind === 'M').nodes;
    for (const [index, name] of [[0, 'v(drain)'], [1, 'v(gate)'], [2, 'v(source)']]) {
      const actual = op.observables.nodes.find(node => node.id === mosNodes[index]).voltage;
      assert.ok(Math.abs(actual - oracle[name]) < 1e-6,
        `${name}: ${actual} vs ${oracle[name]}`);
    }
    const supply = op.observables.sourceCurrents.find(row => row.id === 's0').current;
    assert.ok(Math.abs(supply - oracle['i(vdd)']) < 1e-8,
      `i(vdd): ${supply} vs ${oracle['i(vdd)']}`);

    const [ac] = runSourceAnalyses(importSpice(bodyEffectDeck('.ac lin 3 1k 3k')),
      { format: 'spice' });
    assert.equal(ac.status, 'pass', JSON.stringify(ac));
    assert.deepEqual(ac.observables.axis.values, [1000, 2000, 3000]);
    assert.ok(ac.observables.nodes.some(node =>
      node.magnitude.some(value => Number.isFinite(value) && value > 0)));
  });

  it('exports and re-imports GAMMA and PHI without broadening the selector', () => {
    const imported = importSpice(bodyEffectDeck());
    const circuit = Circuit.fromJSON({ parts: imported.parts, wires: imported.wires });
    const exported = toSpice(extractNetlist(circuit), 'body-effect NMOS');
    assert.deepEqual(exported.skipped, []);
    assert.match(exported.text,
      /^\.model NM_Q1 NMOS \(LEVEL=1 VTO=1 KP=100u LAMBDA=20m GAMMA=500m PHI=600m\)$/m);
    const roundTrip = importSpice(exported.text);
    const roundTripMos = roundTrip.parts.find(part => part.kind === 'nmos');
    assert.equal(roundTripMos.params.model, 'level1');
    assert.equal(runSourceAnalyses(roundTrip, { format: 'spice' })[0].status, 'pass');

    const partial = importSpice(bodyEffectDeck());
    delete transistor(partial).params.phi;
    const partialExport = toSpice(extractNetlist(Circuit.fromJSON({
      parts: partial.parts, wires: partial.wires,
    })), 'partial body-effect NMOS');
    assert.equal(partialExport.skipped.length, 1);
    assert.match(partialExport.skipped[0], /exact known-bulk NMOS export requires/);

    for (const model of [
      'NMOS(LEVEL=1 VTO=1 KP=100u LAMBDA=.02 GAMMA=.5)',
      'NMOS(LEVEL=1 VTO=1 KP=100u LAMBDA=.02 GAMMA=-.5 PHI=.6)',
      'NMOS(LEVEL=1 VTO=1 KP=100u LAMBDA=.02 GAMMA=.5 PHI=0)',
      'NMOS(LEVEL=1 VTO=1 KP=100u LAMBDA=.02 GAMMA=.5 PHI=.6 TOX=10n)',
    ]) {
      const declined = importSpice(bodyEffectDeck('.op', model));
      assert.equal(transistor(declined).params.model, undefined, model);
      assert.notEqual(runSourceAnalyses(declined, { format: 'spice' })[0].status, 'pass', model);
    }
  });
});

describe('strict source-tied-bulk Level-1 NMOS source analysis', () => {
  it('preserves the exact topology and matches the live ngspice junction witness', {
    skip: !HAS_NGSPICE,
  }, () => {
    const text = sourceBulkDeck();
    const oracle = ngspiceSourceBulk(text);
    const imported = importSpice(text);
    assert.deepEqual(transistor(imported).params, {
      vth: 1, kp: 100e-6, lambda: 0.02, _model: 'NM',
      w: 1e-6, l: 1e-6, bulkOnSource: true, model: 'level1',
    });
    const [run] = runSourceAnalyses(imported, { format: 'spice' });
    assert.equal(run.status, 'pass', JSON.stringify(run));
    assert.deepEqual(run.topology.find(card => card.kind === 'M').nodes,
      ['n1', 'n0', 'n0', 'n0']);
    assert.equal(run.metadata.nmos.model, 'explicit-spice-level1-source-tied-bulk');
    const out = run.observables.nodes.find(node => node.id === 'n1').voltage;
    const supply = run.observables.sourceCurrents.find(row => row.id === 's0').current;
    assert.ok(Math.abs(out - oracle.out) < 5e-6, `${out} vs ${oracle.out}`);
    assert.ok(Math.abs(supply - oracle.supply) < 1e-8, `${supply} vs ${oracle.supply}`);
    assert.ok(Math.abs(supply - oracle.drain) < 1e-8, 'source lead returns drain-bulk current');
  });

  it('exports and re-imports the fourth node as the source node', () => {
    const imported = importSpice(sourceBulkDeck());
    const circuit = Circuit.fromJSON({ parts: imported.parts, wires: imported.wires });
    const exported = toSpice(extractNetlist(circuit), 'source-tied NMOS');
    assert.deepEqual(exported.skipped, []);
    assert.match(exported.text,
      /^MQ1 (\S+) (\S+) (\S+) \3 NM_Q1 W=1u L=1u$/m);
    assert.match(exported.text,
      /^\.model NM_Q1 NMOS \(LEVEL=1 VTO=1 KP=100u LAMBDA=20m\)$/m);
    const roundTrip = importSpice(exported.text);
    const mos = roundTrip.parts.find(part => part.kind === 'nmos');
    assert.equal(mos.params.bulkOnSource, true);
    assert.equal(mos.params.model, 'level1');
    assert.equal(runSourceAnalyses(roundTrip, { format: 'spice' })[0].status, 'pass');
  });

  it('keeps richer, incomplete, and model-default source-bulk cards refused', () => {
    for (const [name, options] of [
      ['GAMMA/PHI', { model: 'NMOS(Level=1 VTO=1 KP=100u LAMBDA=.02 GAMMA=.5 PHI=.7)' }],
      ['missing LAMBDA', { model: 'NMOS(Level=1 VTO=1 KP=100u)' }],
      ['model-card geometry', { model: 'NMOS(Level=1 VTO=1 KP=100u W=1u L=1u)', instance: '' }],
    ]) {
      const imported = importSpice(sourceBulkDeck(options));
      assert.equal(transistor(imported).params.model, undefined, name);
      assert.notEqual(runSourceAnalyses(imported, { format: 'spice' })[0].status, 'pass', name);
    }
  });
});

describe('strict Level-1 NMOS model-card geometry defaults', () => {
  const modelGeometryDeck = (model = 'NMOS(VTO=1 KP=2m W=10u L=1u)', instance = '') => [
    '* model-card W/L defaults',
    'VD drain 0 5',
    'VG gate 0 3',
    `M1 drain gate 0 0 NM ${instance}`.trim(),
    `.model NM ${model}`,
    '.op',
    '.end',
  ].join('\n');

  it('uses authored model W/L with the Level-1 and LAMBDA defaults', () => {
    for (const model of [
      'NMOS(VTO=1 KP=2m W=10u L=1u)',
      'NMOS(LEVEL=1 VTO=1 KP=2m W=10u L=1u)',
    ]) {
      const imported = importSpice(modelGeometryDeck(model));
      assert.deepEqual(transistor(imported).params, {
        vth: 1, kp: 0.002, _model: 'NM', bulkAtGround: true,
        w: 10e-6, l: 1e-6, lambda: 0, model: 'level1',
      });
      const [run] = runSourceAnalyses(imported, { format: 'spice' });
      assert.equal(run.status, 'pass', JSON.stringify(run));
      assert.ok(Math.abs(run.observables.sourceCurrents.find(row => row.id === 's0').current + 0.04) < 1e-10);
    }
  });

  it('exports the represented law canonically and re-imports it unchanged', () => {
    const imported = importSpice(modelGeometryDeck());
    const circuit = Circuit.fromJSON({ parts: imported.parts, wires: imported.wires });
    const exported = toSpice(extractNetlist(circuit), 'model geometry NMOS');
    assert.deepEqual(exported.skipped, []);
    assert.match(exported.text, /^MQ1 \S+ \S+ \S+ 0 NM_Q1 W=10u L=1u$/m);
    assert.match(exported.text,
      /^\.model NM_Q1 NMOS \(LEVEL=1 VTO=1 KP=2m LAMBDA=0\)$/m);
    const roundTrip = importSpice(exported.text);
    assert.deepEqual(roundTrip.parts.find(part => part.kind === 'nmos').params, {
      vth: 1, kp: 0.002, lambda: 0, _model: 'NM_Q1',
      w: 10e-6, l: 1e-6, bulkAtGround: true, model: 'level1',
    });
  });

  it('does not generalize the default across missing, mixed, richer, invalid, or PMOS cards', () => {
    const cases = [
      ['missing W', 'NMOS(VTO=1 KP=2m L=1u)', ''],
      ['mixed instance and model geometry', 'NMOS(VTO=1 KP=2m W=10u L=1u)', 'W=20u L=2u'],
      ['richer model', 'NMOS(VTO=1 KP=2m W=10u L=1u LAMBDA=.01)', ''],
      ['other level', 'NMOS(LEVEL=2 VTO=1 KP=2m W=10u L=1u)', ''],
      ['negative W', 'NMOS(VTO=1 KP=2m W=-10u L=1u)', ''],
      ['PMOS', 'PMOS(VTO=-1 KP=2m W=10u L=1u)', ''],
    ];
    for (const [name, model, instance] of cases) {
      const imported = importSpice(modelGeometryDeck(model, instance));
      assert.equal(transistor(imported).params.model, undefined,
        `${name}: ${JSON.stringify(transistor(imported).params)}`);
      assert.notEqual(runSourceAnalyses(imported, { format: 'spice' })[0].status, 'pass', name);
    }
  });
});

const pmosDeck = ({
  model = 'PMOS(LEVEL=1 VTO=-1 KP=25u LAMBDA=0.01)',
  instance = 'W=100u L=1u',
  bulk = 'bulk',
} = {}) => [
  '* exact explicit-bulk Level-1 PMOS',
  'VB bulk 0 10',
  'VS source 0 8',
  'VG gate 0 5',
  'RD drain 0 500',
  `M1 drain gate source ${bulk} PM ${instance}`,
  `.model PM ${model}`,
  '.op',
  '.end',
].join('\n');

describe('strict explicit-bulk Level-1 PMOS source analysis', () => {
  it('retains the physical fourth terminal and reaches the exact native law', () => {
    const imported = importSpice(pmosDeck());
    const pmos = transistor(imported);
    assert.deepEqual(imported.losses, []);
    assert.deepEqual(imported.unmapped, []);
    assert.deepEqual(imported.warnings, []);
    assert.deepEqual(pmos.terminals, ['gate', 'drain', 'source', 'bulk']);
    assert.deepEqual(pmos.params, {
      vth: -1, kp: 25e-6, lambda: 0.01, _model: 'PM',
      w: 100e-6, l: 1e-6, model: 'level1',
    });
    assert.ok(imported.wires.some(wire => wire.to === 'M1' && wire.toTerminal === 'bulk'));

    const [run] = runSourceAnalyses(imported, { format: 'spice' });
    assert.equal(run.status, 'pass', JSON.stringify(run));
    assert.equal(run.evidence, 'original-direct');
    assert.deepEqual(run.topology.find(card => card.kind === 'M').nodes,
      ['n3', 'n2', 'n1', 'n0']);
    assert.deepEqual(run.metadata.pmos, {
      model: 'explicit-spice-level1-explicit-bulk-terminal',
      requiredParameters: ['vth', 'kp', 'w', 'l', 'lambda'],
      requiredTerminals: ['gate', 'drain', 'source', 'bulk'],
      defaults: { bulkIs: 1e-14, bulkN: 1 }, thermalVoltage: 0.025864925786328753,
      temperatureModel: 'fixed',
    });
    const voltage = id => run.observables.nodes.find(node => node.id === id).voltage;
    assert.ok(Math.abs(voltage('n3') - 2.6341463476788824) < 1e-10);
    assert.ok(Math.abs(run.observables.sourceCurrents.find(row => row.id === 's1').current
      + 0.0052682926859719155) < 1e-10);
  });

  it('exports and re-imports the same explicit law and fourth-node topology', () => {
    const imported = importSpice(pmosDeck());
    const circuit = Circuit.fromJSON({ parts: imported.parts, wires: imported.wires });
    const exported = toSpice(extractNetlist(circuit), 'explicit PMOS');
    assert.deepEqual(exported.skipped, []);
    assert.match(exported.text,
      /^MQ1 \S+ \S+ \S+ \S+ PM_Q1 W=100u L=1u$/m);
    assert.match(exported.text,
      /^\.model PM_Q1 PMOS \(LEVEL=1 VTO=-1 KP=25u LAMBDA=10m\)$/m);

    const roundTrip = importSpice(exported.text);
    const roundTripPmos = roundTrip.parts.find(part => part.kind === 'pmos');
    assert.deepEqual(roundTripPmos.terminals, ['gate', 'drain', 'source', 'bulk']);
    assert.deepEqual({ ...roundTripPmos.params, _model: 'PM' }, transistor(imported).params);
    const point = Circuit.fromJSON({ parts: roundTrip.parts, wires: roundTrip.wires })
      .operatingPoint();
    assert.equal(point.converged, true);
  });

  it('withholds the selector and physical bulk from every broader topology or law', () => {
    const cases = [
      ['bulk at ground', { bulk: '0' }],
      ['bulk on source', { bulk: 'source' }],
      ['missing LAMBDA', { model: 'PMOS(LEVEL=1 VTO=-1 KP=25u)' }],
      ['other level', { model: 'PMOS(LEVEL=2 VTO=-1 KP=25u LAMBDA=0.01)' }],
      ['wrong threshold sign', { model: 'PMOS(LEVEL=1 VTO=1 KP=25u LAMBDA=0.01)' }],
      ['extra model field', { model: 'PMOS(LEVEL=1 VTO=-1 KP=25u LAMBDA=0.01 GAMMA=0.5)' }],
      ['missing W', { instance: 'L=1u' }],
      ['extra instance field', { instance: 'W=100u L=1u AD=2p' }],
      ['duplicate geometry', { instance: 'W=100u W=200u L=1u' }],
    ];
    for (const [name, options] of cases) {
      const imported = importSpice(pmosDeck(options));
      const pmos = transistor(imported);
      assert.equal(pmos.params.model, undefined, `${name}: ${JSON.stringify(pmos.params)}`);
      assert.equal(pmos.terminals, undefined, `${name} must not gain the physical bulk terminal`);
      const [run] = runSourceAnalyses(imported, { format: 'spice' });
      assert.notEqual(run.status, 'pass', `${name}: ${JSON.stringify(run)}`);
    }
  });
});

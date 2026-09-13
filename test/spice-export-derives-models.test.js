/**
 * The SPICE exporter's `.model` bodies are DERIVED from bw-board's parts
 * library, not kept here. A golden deck cannot prove that: a copied number
 * equals the library's number until the day the library moves, which is
 * exactly how `.model LED Rs=5` lived beside the solver's rd = 10 for weeks.
 * So this test perturbs the model source and asserts the deck MOVES, and
 * checks the un-perturbed deck against the library's own derivation.
 */
import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toSpice, junctionModel } from '../src/model/exporters/spice.js';
import { spiceModelFor, cardFor, resolveParams, cardIds } from 'bw-board/parts-library.js';
import { JUNCTION_RD, SILICON_RD } from 'bw-board/mna.js';

const netlistWith = (parts) => ({
  parts,
  nets: [
    { name: 'GND', nodes: parts.flatMap(p => (p.pins || []).slice(0, 1).map(pin => ({ refdes: p.refdes, pin }))) },
    { name: 'N1', nodes: parts.flatMap(p => (p.pins || []).slice(1).map(pin => ({ refdes: p.refdes, pin }))) },
  ],
});

const npn = (part) => ({ refdes: 'Q1', kind: 'npn', pins: ['collector', 'base', 'emitter'], params: part ? { part } : {} });

test('a named transistor takes its .model from the library, byte for byte', () => {
  const card = cardFor('2N2222');
  assert.ok(card, 'the library ships a 2N2222 card');
  const { text } = toSpice(netlistWith([npn('2N2222')]));
  const m = spiceModelFor('2N2222');
  assert.match(text, new RegExp(`^Q1 .* 2N2222$`, 'm'), 'the element line names the card');
  assert.ok(text.includes(`.model ${m.name} ${m.type} (${m.body})`), `deck lacks the derived model line:\n${text}`);
  assert.ok(text.includes(`Bf=${card.params.beta}`), 'Bf is the card\'s beta');
});

test('perturbing the model source moves the deck — models are derived, not copied', () => {
  const real = toSpice(netlistWith([npn('2N2222')])).text;
  const perturbed = toSpice(netlistWith([npn('2N2222')]), 'BrickWright Circuit', {
    modelFor: id => {
      const m = spiceModelFor(id);
      return m && { ...m, body: m.body.replace(/Bf=\S+/, 'Bf=999999') };
    },
  }).text;
  assert.notEqual(perturbed, real, 'a changed card left the deck unchanged: the exporter keeps its own copy');
  assert.ok(perturbed.includes('Bf=999999') && !real.includes('Bf=999999'));
});

test('every card with a Q/D type the exporter emits is derivable, and the library is non-trivial', () => {
  const ids = cardIds();
  assert.ok(ids.length >= 5, `only ${ids.length} cards`);
  for (const id of ids) {
    const m = spiceModelFor(id);
    assert.ok(m && m.body.length > 0, `${id} has no derivable .model`);
  }
});

test('a named diode takes its junction numbers from the card; a bare one takes the solver\'s class defaults', () => {
  const card = cardFor('1N4148');
  const named = junctionModel({ kind: 'diode', params: { part: '1N4148' } });
  const want = resolveParams({ part: '1N4148' });
  assert.equal(named.rs, Number(want.rs), 'rs comes from the card');
  assert.equal(named.n, Number(want.n), 'n comes from the card');
  assert.ok(card.params.rs !== 2, 'the card does not happen to equal the old literal, so this is not vacuous');
  const bareLed = junctionModel({ kind: 'led', params: {} });
  const bareDiode = junctionModel({ kind: 'diode', params: {} });
  assert.equal(bareLed.rs, JUNCTION_RD, 'an un-carded LED uses the solver\'s JUNCTION_RD, not a literal');
  assert.equal(bareDiode.rs, SILICON_RD, 'an un-carded silicon diode uses the solver\'s SILICON_RD');
  // An explicit number still wins over the card: a user who typed it meant it.
  assert.equal(junctionModel({ kind: 'diode', params: { part: '1N4148', rs: 3 } }).rs, 3);
});

test('a bare npn is the symbol table\'s card, derived; no generic Q literal remains', () => {
  // The symbol table names WHICH card a bare class is (npn -> 2N2222); the
  // library supplies the body. Two decisions, two homes, each its own.
  const { text } = toSpice(netlistWith([npn(null)]));
  const m = spiceModelFor('2N2222');
  assert.ok(text.includes(`.model ${m.name} ${m.type} (${m.body})`), text);
  assert.ok(!text.includes('Q_DEFAULT'));
});

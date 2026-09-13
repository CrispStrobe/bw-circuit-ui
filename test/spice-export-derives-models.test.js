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
import { spiceModelFor, cardFor, resolveParams, allCards, cardAliases, classDefaults } from 'bw-board/parts-library.js';

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

test('every card the exporter emits is derivable — the empty set, stated', () => {
  // This read as a shrink-only LEDGER of underivable cards while `tip120` and
  // `nmos` had no branch upstream. Both were fixed on 2026-09-13, the ledger
  // emptied, and the assertion is now the stronger one: NOTHING is underivable.
  // Derived from the library, never typed, so a new card with no branch fails
  // here rather than surfacing as a deck that cannot simulate.
  const cards = allCards();
  assert.ok(cards.length >= 5, `only ${cards.length} cards`);
  const underivable = cards.filter(c => {
    const m = spiceModelFor(c.id);
    return !(m && m.body.length > 0);
  }).map(c => c.id);
  assert.deepEqual(underivable, [],
    'a card with no derivable `.model` body: the exporter must refuse to emit such a part, '
    + 'so this is the set that must stay empty');
  // Anti-vacuity: the derivation really runs, and both spellings resolve.
  assert.match(spiceModelFor('MOSFET').body, /Vto=/);
  assert.match(spiceModelFor('NMOS_GENERIC').body, /Vto=/);
  assert.ok(cardAliases().includes('MOSFET') && cardAliases().includes('NMOS_GENERIC'),
    'cardAliases must carry every name that resolves, or a card is invisible to this scan');
});

test('a part whose model cannot be produced is REFUSED by name, never left dangling', () => {
  // The state this kills: replacing the `.model` literals with derivation made a
  // `tip120` part export an element naming `.model TIP120` that the deck never
  // defined — no warning, `skipped` empty, a deck that reads complete and cannot
  // simulate (measured 2026-09-13).
  //
  // It is driven through the injected model source rather than through a really
  // underivable card, because the library no longer HAS one: pointing this at
  // `tip120` today would exercise nothing while still passing. The guard must
  // outlive the gap that revealed it.
  const { text, skipped } = toSpice(netlistWith([npn('2N2222')]), 'BrickWright Circuit',
    { modelFor: () => null });
  const referenced = [...text.matchAll(/^[QMD]\d+ .* (\S+)$/gm)].map(m => m[1]);
  const defined = [...text.matchAll(/^\.model (\S+) /gm)].map(m => m[1]);
  assert.deepEqual(referenced.filter(r => !defined.includes(r)), [],
    `the deck references a model it never defines:\n${text}`);
  assert.equal(skipped.length, 1, 'the part must be refused by name, not silently dropped');
  assert.match(skipped[0], /no `\.model` line can be produced/);
  // Anti-vacuity on the other side: with the real library the same part exports.
  const ok = toSpice(netlistWith([npn('2N2222')]));
  assert.equal(ok.skipped.length, 0);
  assert.match(ok.text, /^\.model 2N2222 NPN \(/m);
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
  // classDefaults is the accessor mna.js's junctionOpts reads, so the deck and the
  // solve share ONE definition. It replaced the piecewise constants here on
  // 2026-09-13: a deck is the EXPONENTIAL model, and importing the wrong one of
  // the two is what reddened the spice-oracle job.
  assert.equal(bareLed.rs, classDefaults('led').rs, 'an un-carded LED uses its class default, not a literal');
  assert.equal(bareDiode.rs, classDefaults('diode').rs, 'an un-carded silicon diode uses its class default');
  assert.notEqual(classDefaults('led').rs, classDefaults('diode').rs, 'the two classes differ, so this is not vacuous');
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

test('an IRRELEVANT part in the netlist does not change another part\'s emitted model', () => {
  // The shape, generalised from a bw-board defect found on 2026-09-13 (see
  // BLOCKED.md): `_junctionHeadroomV` summed vf over EVERY junction in the
  // netlist and fed one number to the per-part model chooser, so an unrelated
  // LED flipped another LED's model and moved its current 13 %. Nothing caught
  // it because every routing test held one junction, or a deliberate series
  // string — none held a junction that was simply IRRELEVANT.
  //
  // This exporter reads netlist-wide state too (the used-model set, the lowest
  // source frequency), so it has the same exposure: a part nothing else touches
  // must not change what is emitted for the parts around it.
  const alone = toSpice(netlistWith([npn('2N2222')])).text;
  const withStranger = toSpice(netlistWith([npn('2N2222'), {
    refdes: 'D9', kind: 'diode', pins: ['anode', 'cathode'], params: { part: '1N4148' },
  }])).text;
  const modelLinesFor = (deck, name) => deck.split('\n').filter(l => l.includes(`.model ${name} `));
  assert.deepEqual(modelLinesFor(withStranger, '2N2222'), modelLinesFor(alone, '2N2222'),
    'a second, unrelated part changed the first part\'s emitted model');
  assert.match(withStranger, /^Q1 .* 2N2222$/m, 'the first part still names its own card');
  // Anti-vacuity, and it earned its place: the first version of this assertion
  // looked for the card id '1N4148' in the deck and FAILED — a carded diode
  // emits a per-part `.model D_<refdes>` whose numbers come from the card but
  // whose NAME does not, so the comparison above had been running on two decks
  // that differed in nothing at all. Assert the stranger by its refdes instead.
  assert.ok(!alone.includes('D9 ') && withStranger.includes('D9 '),
    'the stranger is absent from the second deck: this test was comparing a deck with itself');
  assert.match(withStranger, /^\.model D_D9 D \(/m, 'the stranger emits its own derived model');
});

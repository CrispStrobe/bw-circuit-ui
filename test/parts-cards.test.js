/**
 * Named standard parts: the card in bw-board's parts library is the ONLY home
 * of an electrical number, and this repo's job is the face and the route to it.
 *
 * Four properties, each driven at a planted counter-example:
 *
 *   1. No sidecar carries an electrical value. A sidecar's `params` / `defaults`
 *      may not use a key from ELECTRICAL_FIELDS (imported, never restated — a
 *      copied list is a fifth home). Scoped to those two objects on purpose:
 *      measured 2026-09-13, all 267 sidecars carry a geometry `w` and ten name
 *      pins `rs`/`k`/`rd` under footprint.leads, which are spellings, not values.
 *   2. Every sidecar `part` reference resolves to a card (case-insensitively).
 *   3. Every card is REACHABLE: its kind has a sidecar (a face) and the palette
 *      offers it — by `params.part` naming the card, or (ledgered) by an engine
 *      kind spelled like the card id. An export nobody can invoke is not a
 *      feature; neither is a part nobody can place.
 *   4. No engine kind is spelled like a card id unless that card's `kind` IS the
 *      kind — otherwise a placed `<kind>` never consults the card and a placed
 *      `<card.kind>` never gets the kind's stamp: two homes. The one known case
 *      is ledgered below with its owner; the ledger may only shrink.
 */
import './_setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ELECTRICAL_FIELDS, cardFor, cardIds, allCards } from 'bw-board/parts-library.js';
import { registerAllDevices } from 'bw-board/register-all.js';
import { getDevice } from 'bw-board/devices.js';

registerAllDevices();
const here = path.dirname(fileURLToPath(import.meta.url));
const PARTS_DATA = path.join(here, '..', 'src', 'parts-data');
const PALETTE = readFileSync(path.join(here, '..', 'src', 'components', 'PartPalette.jsx'), 'utf8');

/**
 * Engine kinds that share a spelling with a card id but whose card names a
 * DIFFERENT kind. Each entry is a known two-homes defect with an owner and a
 * date; fixing one means deleting its line in the same commit.
 */
const KNOWN_KIND_CARD_CONFLICTS = new Map([
  ['TIP120', 'bw-board registers a `tip120` Darlington kind (devices/analog-ics.js) while the TIP120 card says kind npn; raised to lego-ac 2026-09-13, ruling pending'],
]);

/** Electrical keys found in a sidecar's params/defaults — the only places a value could hide. */
export const electricalKeysIn = (sidecar) => {
  const out = [];
  for (const section of ['params', 'defaults']) {
    const obj = sidecar?.[section];
    if (obj && typeof obj === 'object') {
      for (const k of Object.keys(obj)) if (ELECTRICAL_FIELDS.has(k)) out.push(`${section}.${k}`);
    }
  }
  return out;
};

const sidecars = readdirSync(PARTS_DATA).filter(f => f.endsWith('.json')).map(f => ({
  file: f,
  json: JSON.parse(readFileSync(path.join(PARTS_DATA, f), 'utf8')),
}));

test('the population is real: hundreds of sidecars, a non-trivial field set, several cards', () => {
  assert.ok(sidecars.length >= 200, `only ${sidecars.length} sidecars`);
  assert.ok(ELECTRICAL_FIELDS.size >= 8 && ELECTRICAL_FIELDS.has('vf') && ELECTRICAL_FIELDS.has('beta'));
  assert.ok(cardIds().length >= 5, `only ${cardIds().length} cards`);
  // The scoping is a measured fact, not an assumption: geometry `w` is everywhere.
  assert.ok(sidecars.every(s => 'w' in s.json), 'every sidecar carries a geometry w — the reason the scan is scoped to params/defaults');
});

test('1. no sidecar carries an electrical value in params/defaults', () => {
  const offenders = sidecars.flatMap(s => electricalKeysIn(s.json).map(k => `${s.file}: ${k}`));
  assert.deepEqual(offenders, [], 'an electrical number in a sidecar is a second home; the card is the only one');
  // Driven: a planted sidecar with a value fires; geometry and lead names do not.
  assert.deepEqual(electricalKeysIn({ w: 40, params: { vf: 2.0, color: 'red' } }), ['params.vf']);
  assert.deepEqual(electricalKeysIn({ w: 40, defaults: { beta: 100 } }), ['defaults.beta']);
  assert.deepEqual(electricalKeysIn({ w: 40, footprint: { leads: { rs: {}, k: {} } } }), []);
});

test('2. every sidecar part reference resolves to a card', () => {
  const refs = sidecars.filter(s => s.json.part !== undefined);
  const dangling = refs.filter(s => !cardFor(s.json.part)).map(s => `${s.file}: part ${JSON.stringify(s.json.part)}`);
  assert.deepEqual(dangling, []);
  // Driven: the resolver is case-insensitive and refuses an unknown id.
  assert.ok(cardFor('2n2222') && cardFor('2N2222'));
  assert.equal(cardFor('NOT-A-PART-9999'), null);
});

test('3. every card is reachable: a face for its kind, and a palette entry that names it', () => {
  const unreachable = [];
  for (const card of allCards()) {
    const face = existsSync(path.join(PARTS_DATA, `${card.kind}.json`));
    const byPart = PALETTE.includes(`part: '${card.id}'`);
    const byKind = getDevice(card.id.toLowerCase()) && PALETTE.includes(`kind: '${card.id.toLowerCase()}'`);
    if (!face) unreachable.push(`${card.id}: no sidecar for kind ${card.kind} — no face`);
    if (!byPart && !byKind) unreachable.push(`${card.id}: no palette entry names it (params.part) and no kind is spelled like it`);
  }
  assert.deepEqual(unreachable, [], 'a card nobody can place is a defect that looks like a feature');
  // Driven: the palette scan sees a real entry and refuses a fake one.
  assert.ok(PALETTE.includes("part: '2N2222'"));
  assert.ok(!PALETTE.includes("part: 'NOT-A-PART-9999'"));
});

test('4. an engine kind spelled like a card id is that card\'s kind, or a ledgered conflict', () => {
  const conflicts = [];
  for (const card of allCards()) {
    const kindLikeId = card.id.toLowerCase();
    if (getDevice(kindLikeId) && kindLikeId !== card.kind) conflicts.push(card.id);
  }
  const unledgered = conflicts.filter(id => !KNOWN_KIND_CARD_CONFLICTS.has(id));
  const healed = [...KNOWN_KIND_CARD_CONFLICTS.keys()].filter(id => !conflicts.includes(id));
  assert.deepEqual(unledgered, [], 'a kind and a card with the same name and different stamps are two homes');
  assert.deepEqual(healed, [], 'a ledgered conflict no longer exists — delete its line in this commit (the ledger only shrinks)');
  // The predicate fires: the ledgered case is a real conflict today, not a placeholder.
  assert.ok(conflicts.length === KNOWN_KIND_CARD_CONFLICTS.size);
});

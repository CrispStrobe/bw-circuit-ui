/**
 * A CORPUS-WIDE ZERO THAT WAS A READER POINTED AT THE WRONG BYTES.
 *
 * ADI2005 v5's `output` field is a worked answer, not a netlist: four numbered
 * phases of identification, design equations and component selection, and then
 * the deck. Handed to a SPICE reader whole, the PROSE parses as circuit
 * elements -- `Phase 1` as a P card, `f0 = 1/(2piRC)` as an F card (CCCS),
 * `A Wien-bridge oscillator ...` as an XSPICE A card. Every one of the 12,520
 * decks carried four to nine "unmapped parts" and the corpus scored 0.0 %.
 *
 * Measured on the first 500 rows: **0 agreeing whole, 410 agreeing extracted.**
 *
 * The rule is deliberately narrow, and the narrowness is the point. A line
 * mentioning a SPICE netlist, then up to and including the first `.end` after
 * it. No marker or no `.end` returns null, and 1,040 of the 12,520 have no
 * marker -- those are left alone. Scanning backwards from `.end` for "lines
 * that look like SPICE" would recover some and would also, eventually, truncate
 * a real deck or swallow a sentence. A reader that guesses is how this corpus
 * came to score zero.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractCotNetlist, looksLikeCotDocument } from '../scripts/cot-netlist.mjs';

const doc = (...body) => [
  'Phase 1 — Circuit Identification',
  'A Wien-bridge oscillator uses a non-inverting op-amp.',
  'Phase 2 — Design Equations',
  'f0 = 1/(2piRC) = 20kHz',
  'Phase 4 — SPICE Netlist',
  ...body,
].join('\n');

describe('pulling the netlist out of a worked answer', () => {
  it('returns the deck, starting at its TITLE line', () => {
    const out = extractCotNetlist(doc('', '', '* wien bridge', 'V1 a 0 DC 5', 'R1 a 0 20k', '.op', '.END', '', 'Phase 5 — Notes'));
    // A SPICE deck's first line IS its title and is not optional. Leaving the
    // blank lines after the marker would make the title empty and promote the
    // first element card into it -- the deck would lose a component silently.
    assert.equal(out.split('\n')[0], '* wien bridge');
    assert.match(out, /^\* wien bridge\nV1 a 0 DC 5\nR1 a 0 20k\n\.op\n\.END$/);
    // And the trailing prose is gone.
    assert.ok(!/Phase 5/.test(out), out);
  });

  it('refuses when the document does not delimit a netlist', () => {
    // No marker: 1,040 of 12,520 v5 rows. Left alone, not guessed at.
    assert.equal(extractCotNetlist('Phase 1 — Id\nsome prose\nV1 a 0 DC 5\n.END'), null);
    // No `.end`: nothing to bound the deck with.
    assert.equal(extractCotNetlist('Phase 4 — SPICE Netlist\n* t\nV1 a 0 DC 5'), null);
    assert.equal(extractCotNetlist(''), null);
    assert.equal(extractCotNetlist(null), null);
    // AND THE MARKER AFTER THE `.end`, which is the ordering guard: slicing
    // from a marker that sits past the deck's end runs backwards and yields
    // either nothing or a fragment of the following prose.
    assert.equal(extractCotNetlist('* t\nV1 a 0 DC 5\n.end\nNotes on the SPICE netlist above.'),
      null);
  });

  it('leaves a PLAIN netlist alone, so the adapter cannot eat a real deck', () => {
    // THE CONTROL. A deck is not a document, and a deck that happens to mention
    // the words must not be truncated at them.
    assert.equal(extractCotNetlist('* t\nV1 a 0 DC 5\n.op\n.end'), null);
    assert.equal(looksLikeCotDocument('* t\nV1 a 0 DC 5\n.op\n.end'), false);
    // A marker on the FIRST line is a deck's own title, not a document's
    // section heading, and extracting would throw the whole deck away.
    assert.equal(looksLikeCotDocument('* SPICE netlist for a divider\nV1 a 0 DC 5\n.end'), false);
  });

  it('takes the FIRST .end after the marker, not the last', () => {
    // A document can carry a second deck or a second `.end` in later prose.
    // Running to the last one would splice the two together.
    const out = extractCotNetlist(doc('* first', 'V1 a 0 DC 5', '.end', 'Phase 5 — Alternative', '* second', 'V2 b 0 DC 9', '.end'));
    assert.match(out, /^\* first\nV1 a 0 DC 5\n\.end$/, out);
    assert.ok(!/second/.test(out), out);
  });

  it('accepts the shapes the corpus actually uses', () => {
    for (const marker of ['Phase 4 — SPICE Netlist', 'SPICE netlist:', '## SPICE Netlist', 'Here is the SPICE Netlist']) {
      const out = extractCotNetlist(['Intro prose.', marker, '* t', 'V1 a 0 DC 5', '.end'].join('\n'));
      assert.equal(out, '* t\nV1 a 0 DC 5\n.end', `marker ${marker}`);
    }
  });
});

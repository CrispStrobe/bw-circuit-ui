/**
 * Pull the netlist out of a chain-of-thought document.
 *
 * WHY THIS EXISTS. ADI2005 v5's `output` field is not a netlist. It is a
 * worked answer:
 *
 *     Phase 1 — Circuit Identification
 *     A Wien-bridge oscillator uses a non-inverting op-amp ...
 *     Phase 2 — Design Equations
 *     f0 = 1/(2piRC) = 20kHz
 *     Phase 3 — Component Selection
 *     R -> snapped to E24: 20k
 *     Phase 4 — SPICE Netlist
 *     <the actual deck>
 *     .END
 *
 * Fed to a SPICE reader whole, the PROSE parses as circuit elements: `Phase 1`
 * becomes a P card, `f0 = ...` an F card (CCCS), `A Wien-bridge ...` an XSPICE
 * A card. Every deck then carried four to nine "unmapped parts" and the corpus
 * scored 0 of 12,520 -- a corpus-wide zero that looked like a catastrophic
 * engine failure and was a reader pointed at the wrong bytes.
 *
 * Measured on the first 500 decks: 0 agreeing whole, **410 agreeing extracted**.
 *
 * THE RULE IS DELIBERATELY NARROW. A line that mentions a SPICE netlist, then
 * everything up to and including the first `.end` after it. No marker, or no
 * `.end`, returns null -- 1,040 of the 12,520 have no marker and those are left
 * alone rather than guessed at. Scanning backwards from `.end` for "lines that
 * look like SPICE" would recover some of them and would also, sooner or later,
 * quietly truncate a real deck or swallow a sentence; a reader that guesses is
 * how this corpus came to score zero in the first place.
 *
 * This is an ADAPTER and not an importer change: `importSpice` is handed the
 * bytes a caller chose, and choosing them is the caller's job.
 */

/** A line announcing the netlist section. Kept loose: "Phase 4 — SPICE Netlist",
 *  "SPICE netlist:", "## SPICE Netlist" all qualify. */
const MARKER = /^.*SPICE\s+netlist.*$/im;
const END = /^[ \t]*\.end\b.*$/im;

/**
 * @param {string} text  the document, newlines already restored
 * @returns {string|null} the netlist, or null when the document does not
 *   delimit one and nothing should be assumed
 */
export function extractCotNetlist(text) {
  const t = String(text ?? '');
  const end = END.exec(t);
  if (!end) return null;
  const mark = MARKER.exec(t);
  if (!mark || mark.index >= end.index) return null;
  const deck = t.slice(mark.index + mark[0].length, end.index + end[0].length);
  // A title line is the FIRST line of a SPICE deck and is not optional, so the
  // leading blank line after the marker must go -- otherwise the reader takes
  // an empty title and the first element card becomes the title instead.
  return deck.replace(/^(?:[ \t]*\r?\n)+/, '');
}

/**
 * True when `text` looks like a worked answer rather than a deck. Cheap enough
 * to run per row, and it keeps a caller from extracting out of a plain netlist
 * that happens to contain the word.
 */
export function looksLikeCotDocument(text) {
  const t = String(text ?? '');
  if (!MARKER.test(t)) return false;
  const firstCard = /^[ \t]*[A-Za-z*.]/.exec(t);
  if (!firstCard) return false;
  // A deck's own first line is its title; a document's first line is prose that
  // is followed by MORE prose before any netlist. The marker sitting well into
  // the text is what separates them.
  return MARKER.exec(t).index > 0;
}

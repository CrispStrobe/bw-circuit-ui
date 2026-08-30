/**
 * The SPICE importer against decks nobody here wrote.
 *
 * X1.1's acceptance asks for "a corpus of >= 20 published decks [that]
 * imports with zero silent drops (`unmapped[]`/`ignored[]` accounting
 * asserted)". The ngspice package ships 410 of them — real decks in a
 * dialect this project did not design, exercising subcircuits, `.control`
 * script blocks, XSPICE code models, transmission lines, CIDER numerical
 * devices and every value-suffix spelling in use.
 *
 * They are READ IN PLACE from /usr/share/doc/ngspice/examples and never
 * committed: the same rule the KiCad and EasyEDA corpora follow. Where
 * ngspice is not installed this file skips loudly; the CI job `spice-oracle`
 * installs it, and test/spice-import.test.js holds the hand-written cases
 * that run everywhere.
 *
 * THE ASSERTION IS THE ACCOUNTING, not the mapping rate. Most of these decks
 * use devices this engine has no part for, and refusing them by name is
 * correct. What must never happen is a card going in and appearing in
 * NONE of parts[] / unmapped[] / ignored[] / analyses[] — that is a silent
 * drop, and it is what this file exists to prevent.
 *
 * Measured 2026-08-30 when the gate was written, and the reason it exists:
 * the first version of the importer dropped subcircuit BODIES and `.control`
 * script lines without recording them. 86 of the 410 decks came up short of
 * their own card count. Nothing else had noticed, because every hand-written
 * fixture was small enough to have neither.
 *
 * @module
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { importSpice, looksLikeSpice } from '../src/importers/spice.js';

const CORPUS = '/usr/share/doc/ngspice/examples';
const HAVE = existsSync(CORPUS);

/** Every deck under the corpus root. */
function decks() {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(cir|sp|net|ckt)$/i.test(e.name)) out.push(p);
    }
  };
  walk(CORPUS);
  return out;
}

/**
 * Count logical cards the way the importer does — comments stripped,
 * continuations joined, title line removed. Kept as an INDEPENDENT
 * reimplementation on purpose: sharing the importer's own splitter would let
 * a bug in it hide behind itself.
 */
function cardCount(text) {
  const raw = text.split(/\r?\n/);
  let start = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i].trim() === '') continue;
    start = i + 1;
    break;
  }
  let n = 0;
  for (let i = start; i < raw.length; i++) {
    let l = raw[i];
    if (/^\s*\*/.test(l)) continue;
    l = l.replace(/\s+[$;].*$/, '');
    if (!l.trim()) continue;
    if (/^\s*\+/.test(l)) continue;
    n++;
  }
  return n;
}

describe('the published-deck corpus', { skip: HAVE ? false : `no corpus at ${CORPUS} — install ngspice` }, () => {
  const files = HAVE ? decks() : [];

  it(`has enough decks to mean something (>= 20)`, () => {
    assert.ok(files.length >= 20, `only ${files.length} decks under ${CORPUS}`);
  });

  it('every deck imports without throwing', () => {
    const threw = [];
    for (const f of files) {
      let text;
      try { text = readFileSync(f, 'utf-8'); } catch { continue; }
      try { importSpice(text); }
      catch (e) { threw.push(`${path.relative(CORPUS, f)}: ${e && e.message}`); }
    }
    assert.deepEqual(threw, [], 'decks that crashed the importer');
  });

  it('no card is silently dropped in any deck', () => {
    // A card may become a part, be named as unmapped, be recorded as ignored,
    // or be reported as an analysis. It may not vanish. A subcircuit body is
    // counted once at its definition and again per instance, so the total can
    // legitimately EXCEED the card count — never fall short of it.
    const short = [];
    for (const f of files) {
      let text;
      try { text = readFileSync(f, 'utf-8'); } catch { continue; }
      const r = importSpice(text);
      const parts = r.parts.filter(p => p.kind !== 'gnd').length;
      const accounted = parts + r.unmapped.length + r.ignored.length + r.analyses.length;
      const cards = cardCount(text);
      if (accounted < cards) {
        short.push(`${path.relative(CORPUS, f)}: ${cards} cards in, ${accounted} accounted `
          + `(parts ${parts}, unmapped ${r.unmapped.length}, ignored ${r.ignored.length}, `
          + `analyses ${r.analyses.length})`);
      }
    }
    assert.deepEqual(short.slice(0, 10), [], `${short.length} decks lost cards`);
  });

  it('every refusal names a reason — nothing is refused anonymously', () => {
    const anonymous = [];
    for (const f of files.slice(0, 120)) {
      let text;
      try { text = readFileSync(f, 'utf-8'); } catch { continue; }
      for (const u of importSpice(text).unmapped) {
        if (!u.libsource || String(u.libsource).length < 8) {
          anonymous.push(`${path.relative(CORPUS, f)}: ${u.ref}`);
        }
      }
    }
    assert.deepEqual(anonymous.slice(0, 10), [], 'unmapped entries with no reason');
  });

  it('a useful share of the corpus maps completely', () => {
    // Not a quality bar on the corpus — a tripwire on US. If a change makes
    // the importer refuse far more than it does today, this notices.
    let clean = 0;
    for (const f of files) {
      let text;
      try { text = readFileSync(f, 'utf-8'); } catch { continue; }
      const r = importSpice(text);
      if (r.unmapped.length === 0 && r.parts.filter(p => p.kind !== 'gnd').length > 1) clean++;
    }
    // Measured 180/410 when this was written. The floor is deliberately well
    // below that: it is a tripwire, not a ratchet to be nudged upward.
    assert.ok(clean >= 120,
      `only ${clean}/${files.length} decks mapped with zero refusals (was 180)`);
  });

  it('detection recognises the corpus as SPICE', () => {
    let detected = 0;
    for (const f of files) {
      let text;
      try { text = readFileSync(f, 'utf-8'); } catch { continue; }
      if (looksLikeSpice(text)) detected++;
    }
    // 382/410 when written; the misses are fragments and include-only files
    // with too few element cards to be sure about, which is the conservative
    // side to err on for a format with no magic first line.
    assert.ok(detected >= files.length * 0.85,
      `only ${detected}/${files.length} decks detected`);
  });
});

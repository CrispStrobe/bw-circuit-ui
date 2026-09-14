/**
 * Resolve a foreign deck's UNDECLARED model and subcircuit names against a
 * local LTspice library tree.
 *
 * WHY THIS IS A SEPARATE MODULE AND NOT PART OF THE IMPORTER OR THE ORACLE.
 *
 * `importSpice(text, { libraries })` takes libraries as SPICE TEXT the CALLER
 * chose to supply, and `judgeForeignDeck` says the same in its own comment. That
 * is deliberate: the importer must never read a file, because a parser that can
 * reach the filesystem resolves differently on two machines and its results stop
 * being reproducible from its input. So the file reading lives HERE, in the
 * caller's half, and the deck-to-text decision is explicit at the call site.
 *
 * WHY IT IS DRIVEN BY AN ENVIRONMENT VARIABLE. The library is Analog Devices'
 * own, shipped inside the LTspice installer. We may RUN it as an oracle input;
 * we may not redistribute it. An env var means no path is baked into the tree,
 * nothing is vendored, and a checkout with the variable unset behaves exactly as
 * it did before this file existed.
 *
 * WHAT IT DOES NOT PROMISE. A name being DEFINED is not the same as the deck
 * becoming solvable. Vendor subcircuits are behavioural macromodels built from
 * controlled sources, tables and nested subcircuits, and the importer flattens
 * ONE level. So this module's job ends at "here is the text that defines the
 * names your deck left undeclared"; whether that text imports is the importer's
 * answer to give, and the sweep's to measure.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** LTspice writes some library files as UTF-16LE with a BOM and others as UTF-8. */
export function readLibraryFile(path) {
  const bytes = readFileSync(path);
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.toString('utf16le');
  return bytes.toString('utf8');
}

/**
 * The importer's comment rule, and it must stay the importer's rule: `;` starts
 * a comment anywhere, `$` only at a token start. Getting this wrong does not
 * fail loudly -- it silently reads a trailing pin-name comment such as
 * `;pnba Run)GND)SW)Vin)FB)Mode` as the subcircuit's NAME, and then reports the
 * library as missing a definition no deck ever asked for. Measured: that defect
 * put `in+)in-)v+)v-)out` at the top of a "still missing" census with 9,167
 * occurrences.
 */
const stripComment = (line) => line.replace(/;.*$/, '').replace(/(^|\s)\$.*$/, '');

/** Node counts before the model name on each element card that names a model. */
const MODEL_NAME_POSITION = { D: 2, Q: 3, J: 3, M: 4 };

/**
 * Every `.model`/`.subckt` name a deck DECLARES for itself, lower-cased.
 * These are not resolved from a library: SPICE's own precedence gives the deck
 * the last word, and the importer implements that.
 */
export function declaredNames(deckText) {
  const out = new Set();
  for (const m of String(deckText).matchAll(/^\s*\.(?:subckt|model)\s+(\S+)/gim)) out.add(m[1].toLowerCase());
  return out;
}

/** Every model/subcircuit name a deck REFERENCES but does not declare. */
export function undeclaredReferences(deckText) {
  const declared = declaredNames(deckText);
  const refs = new Set();
  for (const raw of String(deckText).split(/\r?\n/)) {
    const line = stripComment(raw).trim();
    if (!line) continue;
    const x = /^X\S*\s+(.*)$/i.exec(line);
    if (x) {
      // `Xname node1 .. nodeN subcktname [param=value ...]` -- the name is the
      // last token that is not a parameter assignment.
      const toks = x[1].split(/\s+/).filter((t) => t && !t.includes('='));
      if (toks.length) {
        const ref = toks[toks.length - 1].toLowerCase();
        if (!declared.has(ref)) refs.add(ref);
      }
    }
    const el = /^([DQJM])\S*\s+(.*)$/i.exec(line);
    if (el) {
      const toks = el[2].split(/\s+/).filter((t) => t && !t.includes('='));
      const at = MODEL_NAME_POSITION[el[1].toUpperCase()];
      if (toks.length > at) {
        const ref = toks[at].toLowerCase();
        if (!declared.has(ref)) refs.add(ref);
      }
    }
  }
  return refs;
}

/**
 * name -> defining file, over an LTspice `lib` tree (`sub/`, `cmp/`, `*.lib`).
 *
 * FIRST DEFINITION WINS, and that is a choice rather than an accident: the same
 * part number appears in several files (`LTC3405A.sub` and `LTC3405A-x.x.sub`),
 * and picking a different one per run would make the oracle's answer depend on
 * directory order. Deterministic by sorted path.
 */
export function buildLibraryIndex(root) {
  const index = new Map();
  if (!root || !existsSync(root)) return index;
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir).sort(); } catch { return; }
    for (const entry of entries) {
      const path = join(dir, entry);
      let st;
      try { st = statSync(path); } catch { continue; }
      if (st.isDirectory()) { walk(path); continue; }
      if (!/\.(sub|lib|mod|dio|bjt|mos|jft|ind|cap|prm|txt)$/i.test(entry)) continue;
      let text;
      try { text = readLibraryFile(path); } catch { continue; }
      for (const m of text.matchAll(/^\s*\.(?:subckt|model)\s+(\S+)/gim)) {
        const name = m[1].toLowerCase();
        if (!index.has(name)) index.set(name, path);
      }
    }
  };
  walk(root);
  return index;
}

let cachedRoot = null;
let cachedIndex = null;

/** The index for `LTSPICE_LIB_DIR`, built once. Empty when the variable is unset. */
export function libraryIndex(root = process.env.LTSPICE_LIB_DIR) {
  if (cachedIndex && cachedRoot === root) return cachedIndex;
  cachedRoot = root;
  cachedIndex = buildLibraryIndex(root);
  return cachedIndex;
}

/**
 * The library TEXTS that define what this deck left undeclared, ready to hand
 * to `importSpice`/`judgeForeignDeck` as `libraries`.
 *
 * Returns `{ libraries, resolved, missing }` and not just the text, because the
 * sweep has to be able to tell "the library had nothing for this deck" from
 * "the library had it and the import still failed". Those are an acquisition
 * problem and an importer problem, and one census reporting both as a single
 * number is how a lane spends a month on the wrong half.
 */
export function librariesForDeck(deckText, index = libraryIndex()) {
  const refs = undeclaredReferences(deckText);
  const resolved = []; const missing = []; const paths = new Set();
  for (const ref of refs) {
    const path = index.get(ref);
    if (!path) { missing.push(ref); continue; }
    resolved.push(ref); paths.add(path);
  }
  const libraries = [...paths].sort().map((path) => {
    try { return readLibraryFile(path); } catch { return ''; }
  }).filter(Boolean);
  return { libraries, resolved: resolved.sort(), missing: missing.sort() };
}

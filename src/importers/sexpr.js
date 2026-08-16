/**
 * Minimal s-expression parser for KiCad netlist files (.net).
 *
 * KiCad netlists use a subset of s-expressions: atoms are unquoted tokens
 * or double-quoted strings, lists are parenthesized. No dotted pairs, no
 * special forms. Comments are not used in .net files.
 *
 * Returns a nested array tree: each list is an Array whose first element
 * is the tag atom, rest are children (atoms or sub-lists).
 *
 *   (export (version D)
 *     (components (comp (ref U1) (value 74LS173))))
 *   →
 *   ["export", ["version", "D"],
 *     ["components", ["comp", ["ref", "U1"], ["value", "74LS173"]]]]
 *
 * @param {string} text  Raw .net file content
 * @returns {Array}      Parsed tree (top-level list)
 */
export function parseSexpr(text) {
  let i = 0;
  const len = text.length;

  function skipWs() {
    while (i < len && (text[i] === ' ' || text[i] === '\t' ||
                       text[i] === '\n' || text[i] === '\r')) i++;
  }

  function readAtom() {
    if (text[i] === '"') {
      // Quoted string
      i++; // skip opening quote
      let s = '';
      while (i < len && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < len) { s += text[++i]; }
        else { s += text[i]; }
        i++;
      }
      i++; // skip closing quote
      return s;
    }
    // Unquoted token
    let s = '';
    while (i < len && text[i] !== '(' && text[i] !== ')' &&
           text[i] !== ' ' && text[i] !== '\t' &&
           text[i] !== '\n' && text[i] !== '\r') {
      s += text[i++];
    }
    return s;
  }

  function readList() {
    i++; // skip '('
    const list = [];
    while (i < len) {
      skipWs();
      if (i >= len) break;
      if (text[i] === ')') { i++; return list; }
      if (text[i] === '(') { list.push(readList()); }
      else { list.push(readAtom()); }
    }
    return list; // unterminated — return what we have
  }

  skipWs();
  if (i < len && text[i] === '(') return readList();
  return [];
}

/**
 * Find all direct child lists with a given tag.
 * @param {Array} node   Parsed s-expr list
 * @param {string} tag   Tag to search for (first element of child list)
 * @returns {Array[]}    Matching child lists
 */
export function findAll(node, tag) {
  return node.filter(c => Array.isArray(c) && c[0] === tag);
}

/**
 * Find first direct child list with a given tag.
 * @param {Array} node
 * @param {string} tag
 * @returns {Array|undefined}
 */
export function findOne(node, tag) {
  return node.find(c => Array.isArray(c) && c[0] === tag);
}

/**
 * Get the text value of a tagged child: (tag value) → "value".
 * @param {Array} node
 * @param {string} tag
 * @returns {string|undefined}
 */
export function getVal(node, tag) {
  const child = findOne(node, tag);
  return child ? child[1] : undefined;
}

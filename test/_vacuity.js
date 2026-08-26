/**
 * Find tests that cannot fail.
 *
 * A `test()` / `it()` whose body contains no assertion — and no call to a
 * local helper that asserts on its behalf — reports green from the slot the
 * real check would occupy. `test/debug-status.test.js` had one for years: it
 * navigated, waited 500 ms, closed the page, and explained in a comment what
 * should have happened.
 *
 * ── Two corrections this detector needed, both worth keeping ────────
 * The first version looked for the next `{` after the test name, so an arrow
 * with an EXPRESSION body (`() => assert.ok(x)`, no braces) was mis-parsed
 * against some object literal further down: it reported 29 vacuous tests where
 * there were 4. The second version scanned the raw source, so the words
 * "must sit BEFORE it (inside the svg)" in a COMMENT matched `it(` and
 * z-contract-order.test.js was accused of asserting nothing. 29 → 5 → 4.
 *
 * Then a third: the phrase "test(s)" inside this gate's OWN error message —
 * a template literal, not a comment — matched `test(`, and the gate accused
 * itself. 29 → 5 → 4 → 4-and-honest.
 *
 * All three are one mistake in different clothes: reading text that merely
 * LOOKS like code. So locating calls runs over a copy with comments blanked
 * AND string CONTENTS blanked, while names are read back from a copy that
 * keeps the strings. Offsets are preserved in both, so the two line up.
 *
 * @module
 */

/** Tokens that mean "this test can fail". */
const ASSERTY = /\b(assert|expect|deepEqual|strictEqual|notEqual|\.throws|\.rejects|fail)\b/;

/**
 * Blank out comments while preserving offsets and string literals.
 * @param {string} src
 * @returns {string}
 */
export function stripComments (src, blankStrings = false) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i]; const n = src[i + 1];
    if (c === '/' && n === '/') {
      const e = src.indexOf('\n', i); const j = e < 0 ? src.length : e;
      out += ' '.repeat(j - i); i = j; continue;
    }
    if (c === '/' && n === '*') {
      const e = src.indexOf('*/', i + 2); const j = e < 0 ? src.length : e + 2;
      out += src.slice(i, j).replace(/[^\n]/g, ' '); i = j; continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) { if (src[j] === '\\') j++; j++; }
      const lit = src.slice(i, j + 1);
      // Keep the quotes and the length; blank what is between them when the
      // caller is looking for CODE, so a message reading "N test(s) contain…"
      // is not mistaken for a call.
      out += blankStrings ? lit[0] + lit.slice(1, -1).replace(/[^\n]/g, ' ') + (lit.at(-1) ?? '')
        : lit;
      i = j + 1; continue;
    }
    out += c; i++;
  }
  return out;
}

/** Extent of the call whose '(' sits at `open`, respecting quotes. */
function callAt (src, open) {
  let d = 0; let q = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '(') d++;
    else if (c === ')' && --d === 0) return src.slice(open, i + 1);
  }
  return null;
}

/** Local functions whose own body asserts — calling one counts as asserting. */
function assertingHelpers (src) {
  const names = new Set();
  const scan = (re) => {
    for (const m of src.matchAll(re)) {
      const window = src.slice(m.index, m.index + 3000).split('\n').slice(0, 40).join('\n');
      if (ASSERTY.test(window)) names.add(m[1]);
    }
  };
  scan(/(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g);
  scan(/const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/g);
  return names;
}

/**
 * Does this test declare `{ skip: ... }`?
 *
 * Only the options region counts — everything before the callback — so a body
 * that merely mentions the word does not exempt itself. A skipped test has no
 * business asserting, and after the tautology sweep the skipped ones have
 * empty bodies on purpose.
 * @param {string} call the test call, parens included
 */
function isSkipped (call) {
  const afterName = call.replace(/^\(\s*(['"`])(?:[^\\]|\\.)*?\1/, '');
  const cb = afterName.search(/=>|\bfunction\b/);
  const opts = cb < 0 ? afterName : afterName.slice(0, cb);
  return /\bskip\s*:/.test(opts);
}

/**
 * @param {string} raw a test file's source
 * @returns {Array<{line: number, name: string}>} tests that cannot fail
 */
export function vacuousTests (raw) {
  const src = stripComments(raw);                 // names still readable
  const scan = stripComments(raw, true);          // string contents blanked
  const helpers = assertingHelpers(src);
  const out = [];
  for (const m of scan.matchAll(/(?<![.\w])(test|it)\s*\(/g)) {
    const call = callAt(src, m.index + m[0].length - 1);
    if (!call) continue;
    const body = call.replace(/^\(\s*(['"`])(?:[^\\]|\\.)*?\1/, '');
    if (isSkipped(call)) continue;   // a skipped test is not asked to assert
    if (ASSERTY.test(body)) continue;
    if ([...helpers].some((h) => new RegExp(`\\b${h}\\s*\\(`).test(body))) continue;
    const name = (/^\(\s*(['"`])([\s\S]*?)\1/.exec(call) || [])[2] || '(computed name)';
    out.push({ line: src.slice(0, m.index).split('\n').length, name });
  }
  return out;
}

/** A literal: nothing here can differ between runs. */
function isLiteral (s) {
  return /^(true|false|null|undefined|-?\d+(\.\d+)?|'[^']*'|"[^"]*"|`[^`${]*`|\[\s*\]|\{\s*\})$/.test(s.trim());
}

/** Split on top-level commas, ignoring nesting and quotes. */
function splitArgs (inner) {
  const out = []; let d = 0; let q = null; let cur = '';
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (q) { cur += c; if (c === '\\') { cur += inner[++i] ?? ''; continue; } if (c === q) q = null; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; cur += c; continue; }
    if ('([{'.includes(c)) d++;
    else if (')]}'.includes(c)) d--;
    if (c === ',' && d === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * An assertion that holds no matter what the code does.
 * @param {string} method the assert method, '' for a bare `assert(...)`
 * @param {string} call the parenthesised argument list, parens included
 */
function isTautology (method, call) {
  const args = splitArgs(call.slice(1, -1));
  if (method === '' || method === 'ok') {
    return args.length >= 1 && /^(true|1|!0)$/.test(args[0]);
  }
  if (/^(equal|strictEqual|deepEqual|deepStrictEqual)$/.test(method)) {
    return args.length >= 2 && args[0] === args[1] && isLiteral(args[0]);
  }
  return false;
}

/**
 * Tests whose every assertion is trivially true.
 *
 * vacuousTests() asks whether a test asserts at all, so `assert.ok(true)`
 * satisfies it — the token is there. That is the shape a skipped-prerequisite
 * branch reaches for: safety-lesson-canary.test.js registered
 * `it('SKIP: canary file not available', () => assert.ok(true))`, so a gate
 * reading nothing reported a green TICK rather than a skip, which is the one
 * outcome nobody reviewing the output can notice. An assertion that cannot
 * fail is the same defect as no assertion wearing its clothes.
 *
 * @param {string} raw a test file's source
 * @returns {Array<{line: number, name: string}>}
 */
export function tautologicalTests (raw) {
  const src = stripComments(raw);
  const scan = stripComments(raw, true);
  const out = [];
  for (const m of scan.matchAll(/(?<![.\w])(test|it)\s*\(/g)) {
    const call = callAt(src, m.index + m[0].length - 1);
    if (!call) continue;
    const body = call.replace(/^\(\s*(['"`])(?:[^\\]|\\.)*?\1/, '');
    if (!ASSERTY.test(body)) continue;                 // vacuousTests owns that case

    const scanBody = scan.slice(m.index, m.index + call.length);
    let asserts = 0; let trivial = 0;
    for (const a of scanBody.matchAll(/(?<![.\w])assert(?:\.([A-Za-z]+))?\s*\(/g)) {
      const argCall = callAt(src, m.index + a.index + a[0].length - 1);
      if (!argCall) continue;
      asserts++;
      if (isTautology(a[1] || '', argCall)) trivial++;
    }
    if (asserts > 0 && asserts === trivial) {
      const name = (/^\(\s*(['"`])([\s\S]*?)\1/.exec(call) || [])[2] || '(computed name)';
      out.push({ line: src.slice(0, m.index).split('\n').length, name });
    }
  }
  return out;
}

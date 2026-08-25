/**
 * Land-pattern registry and its validator.
 *
 * The data lives in src/data/land-patterns.js; this module is the API the
 * projection, the DRC and the lift consume, plus the Phase-1 oracle: a
 * pattern whose pads do not cover EXACTLY the kind's terminals is a hard
 * error, not a warning (plan §6). The terminal map is DERIVED from the pads'
 * `terminal` fields — one authority, not a second list that can drift.
 *
 * @module
 */

import { LAND_PATTERNS, PACKAGE_KIND_RULES, PAD_TERMINALS } from '../data/land-patterns.js';
import { terminalsForKind } from './circuit.js';

/** Default variant = the first one declared for the kind. */
export function getLandPattern(kind, variant = null) {
  const variants = LAND_PATTERNS[kind];
  if (!variants) return null;
  const name = variant || Object.keys(variants)[0];
  const entry = variants[name];
  if (!entry) return null;
  return { kind, variant: name, ...entry };
}

export function listLandPatternKinds() {
  return Object.keys(LAND_PATTERNS);
}

export function listVariants(kind) {
  return Object.keys(LAND_PATTERNS[kind] || {});
}

/** terminal -> [pad numbers], derived from the pads. */
export function terminalMap(pattern) {
  const map = {};
  for (const pad of pattern.pads) {
    (map[pad.terminal] = map[pad.terminal] || []).push(pad.num);
  }
  return map;
}

/** pad number -> terminal name. */
export function padTerminal(pattern, num) {
  const pad = pattern.pads.find((p) => p.num === String(num));
  return pad ? pad.terminal : null;
}

/**
 * The Phase-1 oracle. Returns a list of problems; empty = valid.
 */
export function validateLandPattern(kind, variant, params = undefined) {
  const pattern = getLandPattern(kind, variant);
  if (!pattern) return [`no pattern for ${kind}/${variant}`];
  return validatePattern(pattern, kind, params);
}

/**
 * Validate a pattern OBJECT against a kind's terminals. Split out so the
 * oracle itself is testable with a deliberately broken pattern — a gate
 * that cannot fail is not a gate.
 *
 * `pattern.partial: true` relaxes only the COVERAGE direction (a 1x4
 * header legitimately uses four of the engine header's eight terminals);
 * the naming direction — every pad names a real terminal — always holds.
 */
export function validatePattern(pattern, kind, params = undefined) {
  const problems = [];
  // Module kinds (pi_pico) carry their own pin-order table; asking
  // terminalsForKind for a dynamic kind without a live engine returns the
  // ['a','b'] fallback, which would flunk every real module pattern.
  const table = PAD_TERMINALS[kind];
  const wanted = table
    ? new Set(Array.isArray(table) ? table : Object.values(table))
    : new Set(terminalsForKind(kind, params) || []);
  const covered = new Set();
  const nums = new Set();
  for (const pad of pattern.pads) {
    if (nums.has(pad.num)) problems.push(`${kind}/${pattern.variant}: duplicate pad number ${pad.num}`);
    nums.add(pad.num);
    if (!wanted.has(pad.terminal)) {
      problems.push(`${kind}/${pattern.variant}: pad ${pad.num} names unknown terminal "${pad.terminal}"`);
    }
    covered.add(pad.terminal);
    if (!Number.isFinite(pad.x) || !Number.isFinite(pad.y)) {
      problems.push(`${kind}/${pattern.variant}: pad ${pad.num} has no position`);
    }
    if (!(pad.w > 0) || !(pad.h > 0)) {
      problems.push(`${kind}/${pattern.variant}: pad ${pad.num} has no size`);
    }
    if (pad.drill > 0 && pad.drill >= Math.min(pad.w, pad.h)) {
      problems.push(`${kind}/${pattern.variant}: pad ${pad.num} drill ${pad.drill} swallows the ${pad.w}x${pad.h} pad`);
    }
  }
  if (!pattern.partial) {
    for (const t of wanted) {
      if (!covered.has(t)) problems.push(`${kind}/${pattern.variant}: terminal "${t}" has no pad`);
    }
  }
  if (!pattern.courtyard || !(pattern.courtyard.w > 0) || !(pattern.courtyard.h > 0)) {
    problems.push(`${kind}/${pattern.variant}: no courtyard`);
  }
  return problems;
}

/**
 * Recognise an EasyEDA package string (plus refdes as a tiebreak) as a
 * modelled kind. Returns { kind, variant, params } or null. `variant` may
 * be null: kind recognised, no land pattern yet — the lift still names it
 * instead of shipping an anonymous placeholder.
 */
export function recognizePackage(pkg, ref = '') {
  const s = String(pkg || '');
  // Our own spelling first: `kind:variant` is what the projection stamps,
  // and it is exact — no pattern matching to mis-fire.
  const own = /^([a-z0-9_]+):(.+)$/.exec(s);
  if (own && LAND_PATTERNS[own[1]] && LAND_PATTERNS[own[1]][own[2]]) {
    return { kind: own[1], variant: own[2], params: undefined };
  }
  for (const rule of PACKAGE_KIND_RULES) {
    const m = s.match(rule.match);
    if (!m) continue;
    const variant = rule.variantFromMatch ? rule.variantFromMatch(m) : (rule.variant ?? null);
    // A computed variant must actually exist; a 1x40 header has no pattern
    // and must not pretend to.
    if (variant && !getLandPattern(rule.kind, variant)) {
      return { kind: rule.kind, variant: null, params: rule.paramsFromMatch ? rule.paramsFromMatch(m) : (rule.params || undefined) };
    }
    return {
      kind: rule.kind,
      variant,
      params: rule.paramsFromMatch ? rule.paramsFromMatch(m) : (rule.params || undefined),
    };
  }
  void ref; // reserved: refdes-prefix tiebreaks when packages are anonymous
  return null;
}

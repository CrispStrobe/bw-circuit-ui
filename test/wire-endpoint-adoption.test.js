/**
 * ONE canonical reader for the two wire-endpoint dialects — enforced.
 *
 * WHAT THIS GUARDS. circuit.json wires arrive in two shapes, MIXED WITHIN A
 * SINGLE FILE: the flat `{from:'ID', fromTerminal:'t'}` and the nested
 * `{from:{part,terminal}}` / `{to:{board,hole}}`. src/model/wire-endpoints.js
 * is the one reader that handles both. Every place that hand-rolled the split
 * instead has produced a real, silent defect:
 *
 *   - bw-board's examples-gate union-found on "[object Object] undefined"
 *     and failed 26 healthy examples;
 *   - a corpus rail-short scan reported 802 phantom shorts in 2,040 files;
 *   - the EAGLE and KiCad serializers keyed nets on `w.from` raw, so
 *     "Export → EAGLE" from the running app — where Circuit.fromJSON has
 *     already normalized every wire to the NESTED dialect — wrote a
 *     schematic with ZERO nets, every part floating, for every circuit.
 *     Nothing failed; the file just came out wrong.
 *
 * None of those announce themselves. They produce a plausible artefact with
 * the connectivity missing, which is why a gate and not a convention.
 *
 * WHAT COUNTS AS A VIOLATION. Naming a dialect field on a member expression:
 * `.fromTerminal`, `.toTerminal`, or `.from`/`.to` drilled into `.part`,
 * `.terminal`, `.board`, `.boardId`, `.hole`. That is the exact spelling of
 * every defect above. It does NOT catch handing a whole endpoint to a helper
 * (`endPos(w.from)`) — the helper's own field read is what gets caught, and
 * pretending otherwise would be claiming teeth this gate does not have.
 *
 * THE RATCHET. KNOWN_DIRECT_READS records the files that still read fields
 * directly and WHY each is safe. Counts may only SHRINK. A file not listed
 * may have none; a listed file must have EXACTLY its recorded count — fewer
 * means someone improved it and must lower the number or delete the entry,
 * so the list can never quietly describe a repo it no longer matches. Never
 * raise a count to make this green: the point is the fix, not the number.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve from this file, never from CWD — a suite that only passes when run
// from the repo root is a suite that runs nowhere else.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

/** Any dialect field named on a member expression. */
const DIALECT_FIELD =
    /\.(?:fromTerminal|toTerminal)\b|\.(?:from|to)\.(?:part|terminal|board|boardId|hole)\b/g;

/**
 * The subset that ONLY a wire endpoint has. Gesture state in the interaction
 * machine shares `terminal`/`hole`/`boardId` with wire endpoints but never
 * `part` (it says `partId`) and never the flat `fromTerminal`. Used to prove
 * the machine.js exemption below is still describing gesture code.
 */
const WIRE_ONLY_FIELD = /\.(?:fromTerminal|toTerminal)\b|\.(?:from|to)\.part\b/g;

/**
 * Files exempt from the scan entirely, each with the reason it is not a
 * hand-rolled dialect split. Both are checked, not asserted:
 * wire-endpoints.js must EXPORT the reader, and machine.js must contain no
 * wire-only spelling at all.
 */
const EXEMPT = new Map([
    ['src/model/wire-endpoints.js', 'is the canonical reader'],
    ['src/interaction/machine.js',
     'reads GESTURE state (`g.from` is the drag origin: partId/boardId/hole), ' +
     'not wire endpoints — same field names, different objects'],
]);

/**
 * Files that still read endpoint fields directly, and why that is safe here.
 * MAY ONLY SHRINK.
 */
const KNOWN_DIRECT_READS = new Map([
    ['src/components/BoardCanvas.jsx', { count: 22, why:
        'renders `circuit.wires`, which Circuit.fromJSON has already normalized ' +
        'to the nested dialect. These sit in per-frame render loops over every ' +
        'wire, where wireEndpoint\'s per-call object copy is a cost the canvas ' +
        'does not need to pay for a dialect that cannot reach it.' }],
    ['src/model/circuit.js', { count: 14, why:
        'OWNS the normalization — fromJSON reads the raw dialects through ' +
        'wireEndpoint and every read after that is on wires it just normalized. ' +
        'Two of them mutate `e.terminal` in place to resolve terminal aliases, ' +
        'which a copy-returning accessor cannot express.' }],
    ['src/model/drc.js', { count: 4, why:
        'reads the output of flatWire(), which IS the flat shape by design. ' +
        'Banning reads of the accessor\'s own return value would ban using it.' }],
]);

describe('the wire-endpoint dialect has exactly one reader', () => {
    const files = [];
    (function walk (dir) {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
            const p = join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else if (/\.(js|jsx|mjs)$/.test(e.name)) files.push(p);
        }
    })(SRC);

    // Comments describe the defect at length (this file included); counting
    // prose as violations would make the ratchet a measure of documentation.
    const stripComments = (s) => s
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/([^:])\/\/.*$/gm, '$1');

    const hits = new Map();      // relative path -> count
    for (const f of files) {
        const rel = relative(ROOT, f);
        const n = (stripComments(readFileSync(f, 'utf8')).match(DIALECT_FIELD) || []).length;
        if (n) hits.set(rel, n);
    }

    test('the scanner works at all (anti-vacuity)', () => {
        assert.ok(files.length > 50,
            `only ${files.length} source files scanned — the walk found nothing`);
        // A known-positive and a known-negative, so a regex that stopped
        // matching cannot pass this suite by finding zero of everything.
        assert.match('key(w.from.part, w.fromTerminal)', DIALECT_FIELD);
        assert.doesNotMatch('const rows = Array.from(xs); wireEndpoint(w, "from")', DIALECT_FIELD);
        assert.ok(hits.size > 0, 'zero hits anywhere — the scan is not reading the source');
    });

    test('every exempt file is still what its exemption claims', () => {
        for (const [rel, why] of EXEMPT) {
            const path = join(ROOT, rel);
            assert.ok(existsSync(path), `${rel} is exempt but no longer exists — drop the exemption`);
            const code = stripComments(readFileSync(path, 'utf8'));
            if (rel === 'src/model/wire-endpoints.js') {
                for (const fn of ['wireEndpoint', 'flatWire', 'isBoardEndpoint']) {
                    assert.match(code, new RegExp(`export function ${fn}\\b`),
                        `${rel} ${why}, but no longer exports ${fn}`);
                }
            } else {
                const wireOnly = code.match(WIRE_ONLY_FIELD) || [];
                assert.deepEqual(wireOnly, [],
                    `${rel} is exempt because it ${why} — but it now names ` +
                    `${wireOnly.join(', ')}, which only a WIRE endpoint has. ` +
                    `Either route that through wire-endpoints.js or retire the exemption.`);
            }
        }
    });

    test('no unlisted file reads endpoint fields directly', () => {
        const unlisted = [...hits.entries()]
            .filter(([rel]) => !EXEMPT.has(rel) && !KNOWN_DIRECT_READS.has(rel))
            .map(([rel, n]) => `${rel} (${n})`);
        assert.deepEqual(unlisted, [],
            `${unlisted.length} file(s) hand-roll the wire-endpoint dialect. Import ` +
            `wireEndpoint()/flatWire() from src/model/wire-endpoints.js instead — one ` +
            `dialect handled and the other silently mishandled is how the EAGLE and ` +
            `KiCad exporters wrote schematics with no nets in them. Do NOT add an ` +
            `entry to KNOWN_DIRECT_READS to make this pass.`);
    });

    test('the ratchet matches the repo exactly, and may only shrink', () => {
        for (const [rel, { count, why }] of KNOWN_DIRECT_READS) {
            assert.ok(existsSync(join(ROOT, rel)),
                `${rel} is in KNOWN_DIRECT_READS but no longer exists — delete the entry`);
            const actual = hits.get(rel) || 0;
            assert.ok(actual <= count,
                `${rel} now has ${actual} direct endpoint reads, up from ${count}. ` +
                `The reason on file is: ${why}. A new one needs wireEndpoint(), not a bigger number.`);
            assert.equal(actual, count,
                `${rel} is down to ${actual} direct endpoint reads from ${count} — good. ` +
                `Lower the count in KNOWN_DIRECT_READS (or delete the entry at 0), or this ` +
                `list stops describing the repo and the ratchet stops holding.`);
        }
    });
});

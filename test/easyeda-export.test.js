/**
 * EasyEDA native export — the oracle HIERARCHY, weakest excuse removed
 * first:
 *
 *  1. ROUND TRIP through our own importer: export → importEasyEda →
 *     the electrical partition equals the source's resolved nets. Two
 *     mutation guards prove the oracle can fail: a dropped wire, and —
 *     the sharper probe — a wire endpoint nudged a few units off its
 *     pin, this dialect's real failure mode (186/209 exact-touch was
 *     the measured rate on the vendor reference board).
 *  2. PROVEN-IMPLEMENTATION conformance: assertions encoding what
 *     KiCad's independent C++ EasyEDA parser reads
 *     (eeschema/sch_io/easyeda/sch_easyeda_parser.cpp): LIB head
 *     arr[1]/arr[2]/arr[3], backtick pairs incl. `pre`, pin mainParts
 *     [3]=number [4]=x [5]=y and name at section3[4], W arr[1] point
 *     pairs, F arr[1] flag TYPE + section2[0] net name, T text content
 *     at arr[12]. Where both readers agree, our output satisfies two
 *     independently written parsers of the dialect.
 *  3. CORPUS: the owner-named calculator examples from lite, read in
 *     place (skip-with-reason when the sibling is absent).
 *  4. The actual application import stays a MANUAL owner step — stated,
 *     not silently claimed.
 */

import './_setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
import { Circuit } from '../src/model/circuit.js';
import { toEasyEdaSchematic, exportEasyEdaJson } from '../src/model/exporters/easyeda-schematic.js';
import { importEasyEda, looksLikeEasyEda, easyEdaSheets } from '../src/importers/easyeda.js';

// ── canonical electrical partitions ─────────────────────────────────

/** Union-find partition over an imported {parts, wires}. */
function importedPartition(r) {
    const railKind = new Map(r.parts.filter((p) => p.kind === 'vcc' || p.kind === 'gnd')
        .map((p) => [p.id, p.kind]));
    const parent = new Map();
    const find = (k) => {
        if (!parent.has(k)) parent.set(k, k);
        let root = k;
        while (parent.get(root) !== root) root = parent.get(root);
        while (parent.get(k) !== root) { const n = parent.get(k); parent.set(k, root); k = n; }
        return root;
    };
    const key = (part, term) => `${part}${term}`;
    for (const w of r.wires) {
        const a = find(key(w.from, w.fromTerminal));
        const b = find(key(w.to, w.toTerminal));
        if (a !== b) parent.set(a, b);
    }
    const groups = new Map();
    for (const k of parent.keys()) {
        const root = find(k);
        if (!groups.has(root)) groups.set(root, new Set());
        const [part, term] = k.split('');
        groups.get(root).add(railKind.has(part)
            ? `rail:${railKind.get(part)}`
            : `${part}.${String(term).toLowerCase()}`);
    }
    return canonNets([...groups.values()]);
}

/** The source truth: a live Circuit's resolvedNets. */
function sourcePartition(circuit) {
    const railKind = new Map(circuit.parts
        .filter((p) => p.kind === 'vcc' || p.kind === 'gnd').map((p) => [p.id, p.kind]));
    const structural = new Set(circuit.parts
        .filter((p) => p.kind === 'breadboard').map((p) => p.id));
    const nets = [];
    for (const n of circuit.resolvedNets ?? []) {
        const s = new Set();
        for (const t of n.terminals ?? []) {
            if (structural.has(t.part)) continue;
            s.add(railKind.has(t.part)
                ? `rail:${railKind.get(t.part)}`
                : `${t.part}.${String(t.terminal).toLowerCase()}`);
        }
        nets.push(s);
    }
    return canonNets(nets);
}

/** Drop singleton nets (no connectivity content), sort canonically. */
function canonNets(sets) {
    return sets.map((s) => [...s].sort())
        .filter((a) => a.length >= 2)
        .map((a) => a.join('|'))
        .sort();
}

// ── fixtures ────────────────────────────────────────────────────────

function handCircuit() {
    return Circuit.fromJSON({
        vcc: 5,
        parts: [
            { id: 'PWR', kind: 'vcc', x: 0, y: 0 },
            { id: 'G', kind: 'gnd', x: 0, y: 40 },
            { id: 'R1', kind: 'resistor', params: { ohms: 330 }, x: 60, y: 0 },
            { id: 'D1', kind: 'led', params: {}, x: 120, y: 0 },
            { id: 'B1', kind: 'button', params: {}, x: 180, y: 0 },
        ],
        wires: [
            { from: 'PWR', fromTerminal: 'vcc', to: 'R1', toTerminal: 'a' },
            { from: 'R1', fromTerminal: 'b', to: 'D1', toTerminal: 'anode' },
            { from: 'D1', fromTerminal: 'cathode', to: 'B1', toTerminal: 'a' },
            { from: 'B1', fromTerminal: 'b', to: 'G', toTerminal: 'gnd' },
        ],
    });
}

// ── 1. round trip + mutation guards ─────────────────────────────────

describe('round trip through our own importer', () => {
    test('the hand fixture exports, detects, parses, and re-imports to the SAME partition', () => {
        const c = handCircuit();
        const { text, report } = toEasyEdaSchematic(c);
        assert.equal(report.skipped.length, 0, JSON.stringify(report.skipped));
        assert.ok(looksLikeEasyEda(text), 'detection accepts our output');
        assert.equal(easyEdaSheets(JSON.parse(text)).length, 1, 'one parseable sheet');
        const r = importEasyEda(text);
        assert.deepEqual(importedPartition(r), sourcePartition(c),
            'the electrical partition survives the trip');
        // Kinds survive too — a resistor must come back a resistor.
        const kinds = new Map(r.parts.map((p) => [p.id, p.kind]));
        assert.equal(kinds.get('R1'), 'resistor');
        assert.equal(kinds.get('D1'), 'led');
        assert.equal(kinds.get('B1'), 'button');
    });

    test('MUTATION: dropping one exported wire breaks partition equality', () => {
        const c = handCircuit();
        const { text } = toEasyEdaSchematic(c);
        const doc = JSON.parse(text);
        const shape = doc.schematics[0].dataStr.shape;
        const wi = shape.findIndex((s) => s.startsWith('W~'));
        shape.splice(wi, 1);
        const r = importEasyEda(JSON.stringify(doc));
        assert.notDeepEqual(importedPartition(r), sourcePartition(c),
            'a missing wire must be VISIBLE to the oracle');
    });

    test('MUTATION: nudging a wire endpoint off its pin breaks equality (the real failure mode)', () => {
        const c = handCircuit();
        const { text } = toEasyEdaSchematic(c);
        const doc = JSON.parse(text);
        const shape = doc.schematics[0].dataStr.shape;
        // Deliberately target a wire that STARTS on a known pin: find
        // R1's first pin coordinate, then the escape wire beginning
        // there — nudging an arbitrary wire can miss (a lane segment's
        // end is not a pin), and a guard that sometimes fires is not a
        // guard.
        const lib = shape.find((s2) => s2.includes('spicePre`R`'));
        const pin = lib.split('#@$').find((s2) => s2.startsWith('P~'));
        const main = pin.split('^^')[0].split('~');
        const px = Number(main[4]); const py = Number(main[5]);
        const wi = shape.findIndex((s2) => s2.startsWith('W~')
            && s2.split('~')[1].startsWith(`${px} ${py} `));
        assert.ok(wi !== -1, 'an escape wire starts on the pin');
        const f = shape[wi].split('~');
        const pts = f[1].split(' ').map(Number);
        pts[1] += 3; // off the pin, off its own row — touches nothing
        f[1] = pts.join(' ');
        shape[wi] = f.join('~');
        const r = importEasyEda(JSON.stringify(doc));
        assert.notDeepEqual(importedPartition(r), sourcePartition(c),
            'a not-quite-touching polyline must be VISIBLE to the oracle');
    });

    test('the oracle covers BOTH dataStr forms (6.5.x object and 6.2.x string)', () => {
        const c = handCircuit();
        const { text } = toEasyEdaSchematic(c);
        const doc = JSON.parse(text);
        doc.schematics[0].dataStr = JSON.stringify(doc.schematics[0].dataStr);
        const r = importEasyEda(JSON.stringify(doc));
        assert.deepEqual(importedPartition(r), sourcePartition(c),
            'the string form imports identically');
    });
});

// ── 2. proven-implementation conformance (KiCad parser expectations) ─

describe("conformance to KiCad's independent parser (sch_easyeda_parser.cpp)", () => {
    const { text } = toEasyEdaSchematic(handCircuit());
    const shape = JSON.parse(text).schematics[0].dataStr.shape;

    test('LIB head: arr[1]/arr[2] numeric origin, arr[3] backtick pairs with pre AND spicePre', () => {
        const lib = shape.find((s) => s.startsWith('LIB~'));
        const head = lib.split('#@$')[0].split('~');
        assert.ok(Number.isFinite(Number(head[1])) && Number.isFinite(Number(head[2])),
            'origin at arr[1], arr[2]');
        const pairs = head[3].split('`');
        const attrs = {};
        for (let i = 1; i < pairs.length; i += 2) attrs[pairs[i - 1]] = pairs[i];
        assert.ok(attrs.spicePre, 'spicePre pair (our importer reads it)');
        assert.ok(attrs.pre && /\?$/.test(attrs.pre),
            'pre pair with a ?-suffixed designator prefix (KiCad reads it)');
        assert.ok('package' in attrs, 'package pair');
    });

    test('pins: mainParts[3]=number, [4]=x, [5]=y; name at section3 field 4', () => {
        const lib = shape.find((s) => s.includes('spicePre`R`'));
        const pin = lib.split('#@$').find((s) => s.startsWith('P~'));
        const main = pin.split('^^')[0].split('~');
        assert.equal(main[3], '1', 'first pin numbered 1 at mainParts[3]');
        assert.ok(Number.isFinite(Number(main[4])) && Number.isFinite(Number(main[5])),
            'absolute x/y at mainParts[4..5]');
        const nameSec = pin.split('^^')[3].split('~');
        assert.equal(typeof nameSec[4], 'string', 'name field exists at section3[4]');
    });

    test('T~P and T~N carry their content at arr[12] (KiCad) AND after the comment marker (ours)', () => {
        const lib = shape.find((s) => s.includes('spicePre`R`'));
        const tp = lib.split('#@$').find((s) => s.startsWith('T~P'));
        const arr = tp.split('~');
        assert.equal(arr[12], 'R1', 'designator at arr[12]');
        assert.equal(arr[11], 'comment', 'the comment marker precedes it');
        const tn = lib.split('#@$').find((s) => s.startsWith('T~N'));
        assert.equal(tn.split('~')[12], '330', 'value at arr[12]');
    });

    test('W wires: arr[1] is space-separated point pairs, even count', () => {
        const w = shape.find((s) => s.startsWith('W~'));
        const pts = w.split('~')[1].split(' ').map(Number);
        assert.ok(pts.length >= 4 && pts.length % 2 === 0 && pts.every(Number.isFinite));
    });

    test('F flags: arr[1] TYPE matches the rail, name at section2[0]', () => {
        const flags = shape.filter((s) => s.startsWith('F~'));
        const byName = new Map(flags.map((s) => [s.split('^^')[2].split('~')[0], s.split('~')[1]]));
        assert.equal(byName.get('GND'), 'part_netLabel_gnD',
            'a GND flag is TYPED as ground (KiCad draws the symbol from arr[1])');
        assert.equal(byName.get('VCC'), 'part_netLabel_VCC',
            'a VCC flag is typed as supply, NOT ground');
    });
});

// ── refusals ────────────────────────────────────────────────────────

describe('document refusals — empty-but-valid is the worst output', () => {
    test('a faceplate controller.json refuses BY NAME', () => {
        const controller = JSON.stringify({ version: 1, widgets: [{ type: 'button' }] });
        assert.throws(() => exportEasyEdaJson(controller, Circuit),
            /faceplate controller document.*not a circuit/s);
    });

    test('non-JSON and part-less JSON refuse', () => {
        assert.throws(() => exportEasyEdaJson('not json', Circuit), /not JSON/);
        assert.throws(() => exportEasyEdaJson('{"parts": []}', Circuit), /no parts/);
    });
});

// ── 2b. our own writer's spelling must survive our own reader ──────
//
// A byName chip emits the ENGINE terminal, uppercased. For most parts
// that equals the datasheet name, but every ACTIVE-LOW pin carries a
// trailing `b` in the engine (`y0b`, `g2ab`) where a vendor library
// writes the bare name (`Y0`, `G2A`) — so the importer's 74HC138 map was
// built around the vendor spelling and silently dropped ours. The export
// drew the wire, the geometry was correct, and the connection was simply
// absent on re-import. This is the smallest circuit that shows it.

describe('a writer must round-trip its own spelling', () => {
    test('wires to ACTIVE-LOW pins survive (74HC138, both edges)', () => {
        for (const pin of ['y0b', 'g2ab', 'g2bb', 'y7b', 'g1', 'a']) {
            const c = Circuit.fromJSON({
                vcc: 5,
                parts: [
                    { id: 'vcc1', kind: 'vcc', params: {}, x: 40, y: 40 },
                    { id: 'gnd1', kind: 'gnd', params: {}, x: 40, y: 300 },
                    { id: 'u1', kind: '74hc138', params: {}, x: 300, y: 150 },
                    { id: 'led1', kind: 'led', params: {}, x: 220, y: 80 },
                ],
                wires: [
                    { from: 'vcc1', fromTerminal: 'vcc', to: 'u1', toTerminal: 'vcc' },
                    { from: 'gnd1', fromTerminal: 'gnd', to: 'u1', toTerminal: 'gnd' },
                    { from: 'led1', fromTerminal: 'cathode', to: 'u1', toTerminal: pin },
                    { from: 'led1', fromTerminal: 'anode', to: 'vcc1', toTerminal: 'vcc' },
                ],
            });
            const r = importEasyEda(toEasyEdaSchematic(c, { title: pin }).text);
            const joined = r.wires.some((w) => (w.from === 'led1' && w.to === 'u1' && w.toTerminal === pin)
                || (w.to === 'led1' && w.from === 'u1' && w.fromTerminal === pin));
            assert.ok(joined, `u1.${pin} lost its wire on re-import — a drawn connection that does not conduct`);
        }
    });
});

// ── 3. the corpus the owner named ───────────────────────────────────

// Resolved the way EVERY other corpus gate in this directory resolves it.
//
// This was a single hardcoded `$HOME/code/lego/brickwright-lite/overlay/
// scratch-gui/examples`. That path exists on no machine this suite runs on --
// not this VPS (the repo lives under /mnt/volume1), not CI (HOME is
// /home/runner and the clone is a sibling) -- so `haveExamples` was false
// everywhere and BOTH corpus blocks below skipped, silently, forever. The
// 2,098-circuit export/re-import round trip they contain had never executed
// anywhere, and docs/SCHEMATIC-AUDIT.md cited it as evidence. Combined with
// the file being absent from `npm test` (see scripts/check-test-registration
// and the gate in test/test-registration.test.js), it was invisible twice
// over.
const CORPUS_ROOTS = process.env.EXAMPLES_DIR ? [process.env.EXAMPLES_DIR] : [
    join(here, '..', '..', 'sb3-creator', 'examples'),
    join(here, '..', '..', 'lego', 'brickwright-lite', 'overlay', 'scratch-gui', 'examples'),
    join(process.env.HOME || '', 'code', 'sb3-creator', 'examples'),
    join(process.env.HOME || '', 'code', 'lego', 'brickwright-lite',
        'overlay', 'scratch-gui', 'examples'),
];
const CORPUS = ['78-a2-calculator/circuit.json',
    '70-calculator/circuit.json', '70-calculator-simple/circuit.json',
    // The two mega variants that shorted (escape leg landed on a lane):
    // named fixtures so the regression stays visible even if the full
    // sweep's enumeration ever regresses.
    '60-retro-console/circuit-flat.arduino-mega.json',
    '61-console-pong/circuit-flat.arduino-mega.json'];
const EXAMPLES = CORPUS_ROOTS.find((r) => existsSync(join(r, CORPUS[0])))
    || CORPUS_ROOTS.find((r) => existsSync(r)) || CORPUS_ROOTS[0];
const haveExamples = existsSync(join(EXAMPLES, CORPUS[0]));

describe('the calculator corpus (read in place from lite)',
    { skip: haveExamples ? false : 'needs the lite examples sibling' }, () => {
        for (const rel of CORPUS) {
            test(`${rel} exports and round-trips its full partition`, () => {
                const text = readFileSync(join(EXAMPLES, rel), 'utf8');
                const c = Circuit.fromJSON(JSON.parse(text));
                const { text: out, report } = toEasyEdaSchematic(c, { title: rel });
                const unexpected = report.skipped.filter((s2) => s2.kind !== 'breadboard');
                assert.deepEqual(unexpected, [],
                    'only the breadboard may be structurally omitted — everything else by name');
                const r = importEasyEda(out);
                assert.deepEqual(importedPartition(r), sourcePartition(c),
                    'the calculator survives the trip whole');
            });
        }
    });

// ── 3b. the WHOLE examples corpus, as a property sweep ──────────────
// Every loadable circuit FILE in lite — bare circuit.json AND every
// per-MCU twin (circuit.<target>.json, circuit-flat.<target>.json): the
// exported subgraph must round-trip to exactly the source partition
// RESTRICTED to exported parts, and every omission must be a NAMED
// skip — silent loss is the only forbidden outcome. The census prints
// so coverage is a number, not a feeling.
//
// The denominator matters as much as the assertion: the first sweep
// enumerated only bare circuit.json (222 files) and by construction
// could not see the mega-only lane/escape short, which lived solely in
// two circuit-flat.arduino-mega.json variants — found by an independent
// reader over all 2,098 files. Hence the file-count floor below: a glob
// that silently stops matching must FAIL, not pass complete-looking.

describe('the full lite examples corpus',
    { skip: haveExamples ? false : 'needs the lite examples sibling' }, () => {
        test('every loadable circuit file round-trips its exported subgraph or refuses by name', () => {

            const dirs = readdirSync(EXAMPLES, { withFileTypes: true })
                .filter((d) => d.isDirectory()).map((d) => d.name);
            let full = 0; let partial = 0; let unloadable = 0; let mismatched = [];
            let fileCount = 0;
            const skipCensus = new Map();
            const isCircuitFile = (name) => /^circuit([.-][^/]+)*\.json$/.test(name);
            for (const dir of dirs) {
                const files = readdirSync(join(EXAMPLES, dir)).filter(isCircuitFile);
                for (const fname of files) {
                const file = join(EXAMPLES, dir, fname);
                fileCount++;
                let c;
                try { c = Circuit.fromJSON(JSON.parse(readFileSync(file, 'utf8'))); }
                catch { unloadable++; continue; }
                let out;
                try { out = toEasyEdaSchematic(c, { title: `${dir}/${fname}` }); }
                catch { unloadable++; continue; }
                const skippedIds = new Set(out.report.skipped.map((s2) => s2.id));
                for (const s2 of out.report.skipped) {
                    skipCensus.set(s2.kind, (skipCensus.get(s2.kind) ?? 0) + 1);
                }
                const src = sourcePartitionRestricted(c, skippedIds);
                const r = importEasyEda(out.text);
                const imp = importedPartition(r);
                if (JSON.stringify(imp) === JSON.stringify(src)) {
                    if (out.report.skipped.every((s2) => s2.kind === 'breadboard')) full++;
                    else partial++;
                } else {
                    mismatched.push(`${dir}/${fname}`);
                }
                }
            }
            console.log(`  corpus census: ${fileCount} files — ${full} full, ${partial} partial (named skips), `
                + `${unloadable} not loadable as circuits, ${mismatched.length} MISMATCHED`);
            console.log(`  skip census: ${JSON.stringify([...skipCensus.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10))}`);
            assert.deepEqual(mismatched, [],
                'a partition mismatch is an exporter DEFECT — skips must be named, never silent');
            assert.ok(fileCount >= 2000,
                `the glob must keep matching the per-MCU twins (2,098 files on 2026-08-24): got ${fileCount}`);
            assert.ok(full >= 1900, `nearly all circuit files export FULLY: got ${full} of ${fileCount}`);
        });
    });

/** Source partition with the named-skipped parts removed too. */
function sourcePartitionRestricted(circuit, skippedIds) {
    const railKind = new Map(circuit.parts
        .filter((p) => p.kind === 'vcc' || p.kind === 'gnd').map((p) => [p.id, p.kind]));
    const drop = new Set([...skippedIds,
        ...circuit.parts.filter((p) => p.kind === 'breadboard').map((p) => p.id)]);
    const nets = [];
    for (const n of circuit.resolvedNets ?? []) {
        const s = new Set();
        for (const t of n.terminals ?? []) {
            if (drop.has(t.part)) continue;
            s.add(railKind.has(t.part)
                ? `rail:${railKind.get(t.part)}`
                : `${t.part}.${String(t.terminal).toLowerCase()}`);
        }
        nets.push(s);
    }
    return canonNets(nets);
}

#!/usr/bin/env node
/**
 * EasyEDA round trip, BOTH directions, with denominators.
 *
 * ── The exposure this measures ──────────────────────────────────────
 * Our net solver is MORE PERMISSIVE than EasyEDA's. `kicad-common.js`'s
 * NetSolver folds in a T -- a registered point (a wire endpoint, a pin, a
 * label anchor) lying on another segment's span -- because that is KiCad's
 * rule: eeschema drops a junction dot at a T itself. EasyEDA does not imply
 * one. A T with no `J` on it is a CROSSING there and a CONNECTION here, so an
 * imported schematic can behave differently here than in the tool it was
 * drawn in.
 *
 * The EXPORT side was measured clean by an independent reader (0 cross-net
 * contacts over 2,098), so the exposure is IMPORT-ONLY. This instrument
 * measures it by reading the SAME file twice with the SAME tested solver,
 * once under each rule, and classifying every disagreement.
 *
 * ── Why easyEdaPartition and not a fresh walk ───────────────────────
 * `easyEdaPartition` is the tested oracle over EasyEDA's own
 * (designator, pin-number) nodes, independent of our kind mapping. It already
 * knows the things an ad-hoc script gets wrong and that were got wrong four
 * times from this side before it existed:
 *
 *   - `F` power flags and `N` labels join BY NAME, so a net-label pair is ONE
 *     net however far apart the two labels sit;
 *   - `BE` bus entries conduct while `B` bus bodies do not;
 *   - a pin lying on a wire's span is a connection, not a floating pin;
 *   - names are scoped PER SHEET, so two sheets on the same canvas
 *     coordinates are not welded together.
 *
 * Miss any of those and the run invents dangling ends that are not there.
 * `O` no-connect flags matter for the same reason on the floating-pin count,
 * and `importEasyEda` reads them; they do not affect a partition, because a
 * no-connect connects nothing by definition.
 *
 * ── What it prints ──────────────────────────────────────────────────
 * Per corpus: files, nets under our rule, nets under EasyEDA's, and every
 * disagreement classified as
 *
 *   net-split    one permissive net is two or more strict ones
 *   node-orphan  a node that has a net under our rule and none under theirs
 *                (it becomes a dangling pin in EasyEDA)
 *
 * Usage:
 *   EXAMPLES_DIR=<sb3-creator>/examples node scripts/easyeda-roundtrip.mjs
 *      exports every shipped circuit and reads the export back both ways
 *
 *   EASYEDA_DIR=<dir of real .json schematics> node scripts/easyeda-roundtrip.mjs
 *      reads real EasyEDA documents both ways -- THE import-side denominator,
 *      and the one this box cannot supply: it holds four vendor-dialect
 *      fixtures and no live corpus.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
await import(path.join(here, '..', 'test', '_setup.js'));
const { Circuit, resetIds } = await import(path.join(here, '..', 'src', 'model', 'circuit.js'));
const { toEasyEdaSchematic } = await import(path.join(here, '..', 'src', 'model', 'exporters', 'easyeda-schematic.js'));
const { easyEdaPartition, importEasyEda, looksLikeEasyEda } = await import(path.join(here, '..', 'src', 'importers', 'easyeda.js'));

/** node -> net index, from a partition's "A|B|C" strings. */
function nodeMap (partition) {
    const m = new Map();
    partition.forEach((net, i) => { for (const node of net.split('|')) m.set(node, i); });
    return m;
}

/**
 * Classify how the strict reading differs from the permissive one.
 *
 * Direction matters: strict can only ever REMOVE connections, because it
 * folds a subset of the Ts. So every disagreement is a permissive net coming
 * apart, and the two shapes it comes apart into are the two classes.
 */
export function classifyDisagreement (permissive, strict) {
    const strictOf = nodeMap(strict);
    const splits = []; const orphans = [];
    for (const net of permissive) {
        const nodes = net.split('|');
        const groups = new Map();
        for (const n of nodes) {
            const g = strictOf.has(n) ? `n${strictOf.get(n)}` : null;
            if (g === null) orphans.push(n);
            else groups.set(g, (groups.get(g) || 0) + 1);
        }
        if (groups.size > 1) splits.push({ net, pieces: groups.size });
    }
    return { splits, orphans };
}

/** Every `J`-less T the permissive reading folded in, with coordinates. */
export function undottedTees (text) {
    const w = (importEasyEda(text).warnings || [])
        .find((x) => /T-joint\(s\) without a junction/.test(x));
    if (!w) return { count: 0, where: [] };
    return {
        count: Number(/^(\d+) T-joint/.exec(w)[1]),
        where: [...w.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((m) => `${m[1]},${m[2]}`),
    };
}

/** One row per document. */
export function measureDocument (id, text) {
    const permissive = easyEdaPartition(text);
    const strict = easyEdaPartition(text, { strict: true });
    const { splits, orphans } = classifyDisagreement(permissive, strict);
    const tees = undottedTees(text);
    return {
        id,
        netsOurs: permissive.length,
        netsEasyEda: strict.length,
        splits: splits.length,
        orphans: orphans.length,
        orphanNodes: orphans,
        tees: tees.count,
        teeWhere: tees.where,
        agree: splits.length === 0 && orphans.length === 0,
    };
}

function circuitFiles (root) {
    const out = [];
    for (const d of readdirSync(root, { withFileTypes: true })) {
        if (!d.isDirectory()) continue;
        for (const f of readdirSync(path.join(root, d.name))) {
            if (/^circuit.*\.json$/i.test(f)) out.push({ id: `${d.name}/${f}`, p: path.join(root, d.name, f) });
        }
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
}

function easyEdaFiles (root) {
    const out = [];
    const walk = (dir) => {
        for (const d of readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, d.name);
            if (d.isDirectory()) walk(full);
            else if (/\.json$/i.test(d.name) && statSync(full).size < 64 * 1024 * 1024) {
                const text = readFileSync(full, 'utf-8');
                if (looksLikeEasyEda(text)) out.push({ id: path.relative(root, full), text });
            }
        }
    };
    walk(root);
    return out.sort((a, b) => a.id.localeCompare(b.id));
}

function report (label, rows) {
    const disagree = rows.filter((r) => !r.agree);
    const teeFiles = rows.filter((r) => r.tees > 0);
    console.log(`\n${label}`);
    console.log(`  documents                                 ${rows.length}`);
    console.log(`  nets under OUR rule (total)               ${rows.reduce((n, r) => n + r.netsOurs, 0)}`);
    console.log(`  nets under EASYEDA's junction rule        ${rows.reduce((n, r) => n + r.netsEasyEda, 0)}`);
    console.log(`  documents where the two readings AGREE    ${rows.length - disagree.length} / ${rows.length}`);
    console.log(`  documents with a J-less T                 ${teeFiles.length} / ${rows.length}   (${rows.reduce((n, r) => n + r.tees, 0)} joints)`);
    console.log(`  disagreements: net-split                  ${rows.reduce((n, r) => n + r.splits, 0)}`);
    console.log(`  disagreements: node-orphan                ${rows.reduce((n, r) => n + r.orphans, 0)}`);
    for (const r of disagree.slice(0, 15)) {
        console.log(`    ${r.id}: ours ${r.netsOurs} nets, EasyEDA ${r.netsEasyEda}; `
            + `${r.splits} split, ${r.orphans} orphaned (${r.orphanNodes.join(' ')})`
            + (r.teeWhere.length ? `; J-less T at ${r.teeWhere.join(' ')}` : ''));
    }
    if (disagree.length > 15) console.log(`    ... and ${disagree.length - 15} more`);
    return disagree;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    let any = false;
    if (process.env.EASYEDA_DIR) {
        const root = process.env.EASYEDA_DIR;
        if (!existsSync(root)) { console.error(`EASYEDA_DIR=${root} does not exist`); process.exit(2); }
        const docs = easyEdaFiles(root);
        if (!docs.length) {
            console.error(`no EasyEDA documents under ${root} — looksLikeEasyEda matched nothing. `
                + 'An empty denominator must not read as a clean result.');
            process.exit(2);
        }
        report(`REAL EasyEDA documents (${root})`, docs.map((d) => measureDocument(d.id, d.text)));
        any = true;
    }
    if (process.env.EXAMPLES_DIR) {
        const rows = [];
        for (const f of circuitFiles(process.env.EXAMPLES_DIR)) {
            let text;
            try {
                resetIds();
                text = toEasyEdaSchematic(Circuit.fromJSON(JSON.parse(readFileSync(f.p, 'utf-8')))).text;
            } catch { continue; }
            rows.push(measureDocument(f.id, text));
        }
        report(`OUR OWN exports (${process.env.EXAMPLES_DIR})`, rows);
        any = true;
    }
    if (!any) {
        console.error('set EXAMPLES_DIR and/or EASYEDA_DIR');
        process.exit(2);
    }
}

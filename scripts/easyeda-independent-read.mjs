#!/usr/bin/env node
/**
 * An INDEPENDENT reader of the EasyEDA dialect we export.
 *
 * WHAT THIS IS FOR. `test/easyeda-export.test.js` oracles the exporter by
 * round-tripping through `src/importers/easyeda.js`. That is a good oracle, but
 * the exporter and the importer are two halves of one understanding of the
 * dialect, so any assumption they SHARE is invisible to it. This script reads
 * the exported shape stream with no code in common with the importer, applying
 * the binding rule as the exporter's own header states it:
 *
 *     a wire ENDPOINT lying on another wire binds (endpoint-on-endpoint or
 *     endpoint-on-span); a PIN lying on a wire binds; a proper X-crossing
 *     (interior x interior) does NOT.
 *
 * and compares the partition it recovers against the SOURCE resolved nets.
 *
 * WHAT THIS IS NOT. It is deliberately NOT wired into `npm test`, and that is a
 * measured decision rather than laziness. It found the lane/escape short in
 * 60-retro-console and 61-console-pong — but re-running the round-trip oracle
 * against the broken exporter (8b6dada) on the same file gives 36 classes
 * against the source's 37, so the round trip was never blind to that defect.
 * The denominator was: the corpus sweep read bare `circuit.json` and the
 * `circuit-flat.<target>.json` twins were outside it. The glob fix plus the
 * fileCount floor is the complete fix for that class, and a second corpus gate
 * would be machinery justified by a premise that turned out to be false.
 *
 * The residual value is narrow and real: it cross-checks whether OUR importer's
 * binding rule matches the ACTUAL dialect. Neither oracle can settle that —
 * only the vendor artefact can, and it is not on this machine. Keep this script
 * for the day it mounts, and for the next time someone changes the router and
 * wants a second opinion that does not share the first one's assumptions.
 *
 * Usage:
 *   node scripts/easyeda-independent-read.mjs <examples-dir>
 *   node scripts/easyeda-independent-read.mjs <examples-dir> --shorts
 *
 * `--shorts` reports only cross-net wire CONTACTS, using the net index the
 * exporter rides in each W shape's gge id — which is what turns "these two
 * nets merged" into "these two segments touch, here".
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
await import(path.join(ROOT, 'test', '_setup.js'));
const { Circuit, resetIds } = await import(path.join(ROOT, 'src', 'model', 'circuit.js'));
const { toEasyEdaSchematic } = await import(path.join(ROOT, 'src', 'model', 'exporters', 'easyeda-schematic.js'));

const EPS = 1e-9;
/** Is (px,py) on segment a-b, endpoints included? */
const onSeg = (px, py, a, b) => {
    const cross = (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x);
    if (Math.abs(cross) > EPS) return false;
    return px >= Math.min(a.x, b.x) - EPS && px <= Math.max(a.x, b.x) + EPS
        && py >= Math.min(a.y, b.y) - EPS && py <= Math.max(a.y, b.y) + EPS;
};

class UF {
    constructor () { this.p = new Map(); }
    find (x) {
        if (!this.p.has(x)) this.p.set(x, x);
        let r = x;
        while (this.p.get(r) !== r) r = this.p.get(r);
        while (this.p.get(x) !== r) { const n = this.p.get(x); this.p.set(x, r); x = n; }
        return r;
    }
    union (a, b) { const A = this.find(a), B = this.find(b); if (A !== B) this.p.set(A, B); }
}

/** Pins and wires out of the exported shape stream. Nothing imported. */
export function readShapes (text) {
    const doc = JSON.parse(text);
    const ds = doc.schematics[0].dataStr;               // object (6.5.x) or string (6.2.x)
    const shape = (typeof ds === 'string' ? JSON.parse(ds) : ds).shape;
    const pins = [], wires = [];
    for (const s of shape) {
        if (s.startsWith('LIB~')) {
            const subs = s.split('#@$');
            let desig = '?';
            for (const sub of subs) if (sub.startsWith('T~P~')) desig = sub.split('~')[12];
            for (const sub of subs) {
                if (!sub.startsWith('P~')) continue;
                const h = sub.split('^^')[0].split('~');
                pins.push({ desig, num: h[3], x: Number(h[4]), y: Number(h[5]) });
            }
        } else if (s.startsWith('W~')) {
            const f = s.split('~');
            const n = f[1].trim().split(/\s+/).map(Number);
            const m = /_n(\d+)$/.exec(f[6] || '');
            for (let i = 0; i + 3 < n.length; i += 2) {
                wires.push({ net: m ? Number(m[1]) : -1,
                    a: { x: n[i], y: n[i + 1] }, b: { x: n[i + 2], y: n[i + 3] } });
            }
        }
    }
    return { pins, wires };
}

/** The partition a reader of the artwork infers, by the stated rule. */
export function partitionOf ({ pins, wires }) {
    const uf = new UF();
    for (let i = 0; i < wires.length; i++) {
        for (let j = i + 1; j < wires.length; j++) {
            const A = wires[i], B = wires[j];
            if (onSeg(A.a.x, A.a.y, B.a, B.b) || onSeg(A.b.x, A.b.y, B.a, B.b)
             || onSeg(B.a.x, B.a.y, A.a, A.b) || onSeg(B.b.x, B.b.y, A.a, A.b)) uf.union('w' + i, 'w' + j);
        }
    }
    for (let k = 0; k < pins.length; k++) {
        uf.find('p' + k);
        for (let i = 0; i < wires.length; i++) {
            if (onSeg(pins[k].x, pins[k].y, wires[i].a, wires[i].b)) uf.union('p' + k, 'w' + i);
        }
    }
    const g = new Map();
    pins.forEach((p, k) => { const r = uf.find('p' + k); if (!g.has(r)) g.set(r, []); g.get(r).push(p); });
    return [...g.values()];
}

/** Cross-net wire CONTACT: a short, named with coordinates. */
export function crossNetContacts ({ wires }) {
    const out = [];
    for (let i = 0; i < wires.length; i++) {
        for (let j = i + 1; j < wires.length; j++) {
            const A = wires[i], B = wires[j];
            if (A.net === B.net || A.net < 0 || B.net < 0) continue;
            let at = null;
            if (onSeg(A.a.x, A.a.y, B.a, B.b)) at = A.a;
            else if (onSeg(A.b.x, A.b.y, B.a, B.b)) at = A.b;
            else if (onSeg(B.a.x, B.a.y, A.a, A.b)) at = B.a;
            else if (onSeg(B.b.x, B.b.y, A.a, A.b)) at = B.b;
            if (at) out.push({ nets: [A.net, B.net], at,
                A: `(${A.a.x},${A.a.y})->(${A.b.x},${A.b.y})`,
                B: `(${B.a.x},${B.a.y})->(${B.b.x},${B.b.y})` });
        }
    }
    return out;
}

export function analyse (file) {
    resetIds();
    const c = Circuit.fromJSON(JSON.parse(readFileSync(file, 'utf-8')));
    const { text, report } = toEasyEdaSchematic(c);
    const s = readShapes(text);
    const exported = new Set(report.exported);
    const mine = partitionOf(s).map((g) => g.length).filter((n) => n > 1).sort((a, b) => b - a);
    const theirs = (c.resolvedNets ?? [])
        .map((n) => (n.terminals ?? []).filter((t) => exported.has(t.part)).length)
        .filter((n) => n > 1).sort((a, b) => b - a);
    return { mine, theirs, shorts: crossNetContacts(s), pins: s.pins.length, wires: s.wires.length };
}

/** Every circuit FILE, hyphen included — the denominator that hid the short. */
export function discover (root) {
    const out = [];
    for (const d of readdirSync(root)) {
        const p = path.join(root, d);
        if (!statSync(p).isDirectory()) continue;
        for (const f of readdirSync(p)) if (/^circuit([.-][^/]+)*\.json$/i.test(f)) out.push(path.join(p, f));
    }
    return out.sort();
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const root = process.argv[2];
    if (!root || !existsSync(root)) {
        console.error('usage: node scripts/easyeda-independent-read.mjs <examples-dir> [--shorts]');
        process.exit(2);
    }
    const onlyShorts = process.argv.includes('--shorts');
    const files = discover(root);
    let match = 0, clean = 0;
    const mismatch = [], shorted = [], errored = [];
    for (const f of files) {
        const rel = f.replace(root + '/', '');
        try {
            const r = analyse(f);
            JSON.stringify(r.mine) === JSON.stringify(r.theirs) ? match++ : mismatch.push(rel);
            r.shorts.length ? shorted.push({ rel, r }) : clean++;
        } catch (e) { errored.push(`${rel}: ${String(e && e.message).slice(0, 80)}`); }
    }
    console.log(`corpus: ${root}\nfiles ${files.length}`);
    if (!onlyShorts) console.log(`  partition matches source : ${match}    MISMATCH: ${mismatch.length}`);
    console.log(`  no cross-net contact     : ${clean}    SHORTED : ${shorted.length}`);
    console.log(`  errored                  : ${errored.length}`);
    for (const m of mismatch.slice(0, 10)) console.log(`   MISMATCH ${m}`);
    for (const { rel, r } of shorted.slice(0, 10)) {
        console.log(`   SHORT ${rel} (${r.shorts.length})`);
        const h = r.shorts[0];
        console.log(`      nets ${h.nets.join(' & ')} touch at ${h.at.x},${h.at.y}\n        A ${h.A}\n        B ${h.B}`);
    }
    for (const e of errored.slice(0, 5)) console.log(`   ERR ${e}`);
    if (mismatch.length || shorted.length) process.exitCode = 1;
}

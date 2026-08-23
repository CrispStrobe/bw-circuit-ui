#!/usr/bin/env node
/**
 * Corpus-wide audit of the schematic viewer.
 *
 * Projects EVERY shipped circuit file and measures each defect class against
 * the solver's own netlist. Reports per-class counts with denominators and the
 * worst offenders, as JSON on stdout (`--json`) or a human table.
 *
 * Discovery is DELIBERATELY loose (`^circuit.*\.json$`): the shipped gates use
 * `^circuit(?:\.[^.]+)*\.json$`, whose `\.` cannot match the hyphen in
 * `circuit-flat.<target>.json`, so 1,006 of 2,107 files — every per-MCU flat
 * twin — were outside every schematic gate's denominator while the gates
 * reported "discovered 1101, analysed 1101".
 *
 * Usage:
 *   EXAMPLES_DIR=/path/to/sb3-creator/examples node scripts/schematic-audit.mjs [--json]
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
await import(path.join(here, '..', 'test', '_setup.js'));
const { Circuit, resetIds } = await import(path.join(here, '..', 'src', 'model', 'circuit.js'));
const { projectSchematic } = await import(path.join(here, '..', 'src', 'model', 'schematic-projection.js'));

const INFRA_KINDS = new Set([
    'breadboard', 'breadboard_full', 'breadboard_half', 'breadboard_mini', 'meter',
]);
const IMPLICIT_GND = '__implicit_gnd__';
const tKey = (part, terminal) => `${part}:${String(terminal).toLowerCase()}`;

class UF {
    constructor () { this.parent = new Map(); }
    find (x) {
        if (!this.parent.has(x)) this.parent.set(x, x);
        let r = x;
        while (this.parent.get(r) !== r) r = this.parent.get(r);
        while (this.parent.get(x) !== r) { const n = this.parent.get(x); this.parent.set(x, r); x = n; }
        return r;
    }
    union (a, b) { const ra = this.find(a), rb = this.find(b); if (ra !== rb) this.parent.set(ra, rb); }
    same (a, b) { return this.find(a) === this.find(b); }
    has (x) { return this.parent.has(x); }
    groups () {
        const g = new Map();
        for (const k of this.parent.keys()) {
            const r = this.find(k);
            if (!g.has(r)) g.set(r, new Set());
            g.get(r).add(k);
        }
        return [...g.values()].filter((s) => s.size >= 2);
    }
}

// ── the RENDERED partition: what a reader infers from the artwork ──────────

const near = (a, b) => Math.abs(a - b) < 0.75;

/** Every drawn, non-infrastructure pin, indexed by coordinate. */
function pinIndex (projection) {
    const byCoord = new Map();
    const visible = new Set();
    const pins = [];
    for (const sym of projection.symbols) {
        if (INFRA_KINDS.has(sym.kind) || sym.id === IMPLICIT_GND) continue;
        for (const pin of sym.pins) {
            const k = tKey(sym.id, pin.name);
            visible.add(k);
            pins.push({ key: k, x: pin.x, y: pin.y, netId: pin.netId, sym: sym.id, name: pin.name });
            const c = `${Math.round(pin.x)},${Math.round(pin.y)}`;
            if (!byCoord.has(c)) byCoord.set(c, []);
            byCoord.get(c).push(k);
        }
    }
    return { byCoord, visible, pins };
}

/**
 * Rendered connectivity: drawn copper, then repeated net labels.
 *
 * ONLY the PIN-SIDE endpoint of a conductor counts. The trunk-side endpoint
 * and every intermediate vertex are meant to sit in free space, and resolving
 * pins there unions every pin a trunk merely PASSES THROUGH. A first version
 * of this audit did exactly that and reported 588 invented connections across
 * 38 circuits, all of them the instrument. Whether those vertices really are
 * in free space is a SEPARATE question, measured as class I below rather than
 * assumed here.
 */
function renderedUF (projection, idx) {
    const uf = new UF();
    const at = (x, y) => idx.byCoord.get(`${Math.round(x)},${Math.round(y)}`) || [];
    for (const w of projection.wires || []) {
        const touched = [];
        if (w.stubs) {
            // stubs[i] = [{at the pin}, {at the trunk}] — index 0 only.
            for (const seg of w.stubs) if (seg.length) touched.push(...at(seg[0].x, seg[0].y));
        }
        if (w.segments && w.segments.length) {
            const first = w.segments[0];
            const last = w.segments[w.segments.length - 1];
            if (first.length) touched.push(...at(first[0].x, first[0].y));
            if (last.length) touched.push(...at(last[last.length - 1].x, last[last.length - 1].y));
        }
        const uniq = [...new Set(touched)];
        for (let i = 1; i < uniq.length; i++) uf.union(uniq[0], uniq[i]);
    }
    const byText = new Map();
    for (const l of projection.netLabels || []) {
        if (!byText.has(l.text)) byText.set(l.text, []);
        byText.get(l.text).push(...at(l.x1, l.y1));
    }
    for (const keys of byText.values()) {
        const uniq = [...new Set(keys)];
        for (let i = 1; i < uniq.length; i++) uf.union(uniq[0], uniq[i]);
    }
    return { uf, byText };
}

/** Solver connectivity restricted to what the projection could have drawn. */
function solverUF (nets, parts, visible) {
    const kindOf = new Map(parts.map((p) => [p.id, p.kind]));
    const uf = new UF();
    for (const net of nets) {
        const keys = [];
        for (const t of net.terminals || []) {
            const pid = t.part || t.partId;
            if (!pid || INFRA_KINDS.has(kindOf.get(pid))) continue;
            if (String(pid).startsWith('@bb:')) continue;
            const k = tKey(pid, t.terminal);
            if (visible.has(k)) keys.push(k);
        }
        for (let i = 1; i < keys.length; i++) uf.union(keys[0], keys[i]);
    }
    return uf;
}

// ── geometry: junctions vs crossings ──────────────────────────────────────

/** Every drawn segment, tagged with its net. */
function segmentsOf (projection) {
    const out = [];
    for (const w of projection.wires || []) {
        if (w.segments) {
            for (const [a, b] of w.segments) out.push({ netId: w.netId, a, b });
        } else {
            out.push({ netId: w.netId, a: { x: w.trunk.x, y: w.trunk.y1 }, b: { x: w.trunk.x, y: w.trunk.y2 } });
            for (const [a, b] of w.stubs || []) out.push({ netId: w.netId, a, b });
        }
    }
    return out;
}

const isH = (s) => near(s.a.y, s.b.y);
const isV = (s) => near(s.a.x, s.b.x);
const within = (v, p, q) => v > Math.min(p, q) + 0.75 && v < Math.max(p, q) - 0.75;
const withinInc = (v, p, q) => v >= Math.min(p, q) - 0.75 && v <= Math.max(p, q) + 0.75;

/**
 * Where an H and a V segment meet. Returns {x, y, interiorH, interiorV}:
 * "interior" means the crossing point is strictly inside that segment rather
 * than at one of its ends. H-interior AND V-interior is a true X crossing;
 * exactly one interior is a T.
 */
function meets (h, v) {
    const x = v.a.x, y = h.a.y;
    if (!withinInc(x, h.a.x, h.b.x) || !withinInc(y, v.a.y, v.b.y)) return null;
    return { x, y, interiorH: within(x, h.a.x, h.b.x), interiorV: within(y, v.a.y, v.b.y) };
}

function crossingsAndJunctions (projection) {
    const segs = segmentsOf(projection);
    const hs = segs.filter(isH); const vs = segs.filter(isV);
    const dots = new Set((projection.junctions || []).map((j) => `${Math.round(j.x)},${Math.round(j.y)}`));

    const foreignCrossWithDot = [];   // two DIFFERENT nets meet where a dot is drawn
    const sameNetTeeNoDot = [];       // one net's T-junction with no dot
    for (const h of hs) {
        for (const v of vs) {
            const m = meets(h, v);
            if (!m) continue;
            const c = `${Math.round(m.x)},${Math.round(m.y)}`;
            if (h.netId !== v.netId) {
                // Different nets crossing. A dot here asserts a connection the
                // solver does not have — the opposite meaning.
                if (dots.has(c)) foreignCrossWithDot.push({ a: h.netId, b: v.netId, x: m.x, y: m.y });
            } else if (m.interiorH !== m.interiorV && !dots.has(c)) {
                // Same net, a T: copper branches here and a reader needs the dot
                // to know it is a branch rather than two wires passing.
                sameNetTeeNoDot.push({ netId: h.netId, x: m.x, y: m.y });
            }
        }
    }
    // Any real crossing between two different nets, so a mutation proof can
    // place a dot on one instead of inventing coordinates that cross nothing.
    let anyForeignCrossing = null;
    for (const h of hs) {
        for (const v of vs) {
            if (h.netId === v.netId) continue;
            const m = meets(h, v);
            if (m && m.interiorH && m.interiorV) { anyForeignCrossing = { x: m.x, y: m.y, a: h.netId, b: v.netId }; break; }
        }
        if (anyForeignCrossing) break;
    }
    return { foreignCrossWithDot, sameNetTeeNoDot, anyForeignCrossing, segCount: segs.length };
}

/** The class-I detector, callable on a projection alone (mutation proofs). */
export function wireThroughForeignPinOf (projection) {
    return wireThroughForeignPin(projection, pinIndex(projection));
}

/** The class-F/G detector, callable on a projection alone (mutation proofs). */
export function crossingsOf (projection) {
    return crossingsAndJunctions(projection);
}

/**
 * CLASS I — a drawn conductor that runs through a pin belonging to a
 * DIFFERENT net.
 *
 * The rendered-netlist gate excludes trunk-side vertices from connectivity on
 * the stated ground that they "sit in free space". That is an assumption about
 * geometry, not a check of it, and it is the assumption a reader cannot make:
 * a line passing exactly through a pin reads as attached to it. Every schematic
 * convention avoids routing copper through a pin for this reason. So the claim
 * is measured here instead of trusted: any segment whose body touches a pin
 * of another net is a connection the artwork shows and the solver denies.
 */
function wireThroughForeignPin (projection, idx) {
    const segs = segmentsOf(projection);
    const out = [];
    for (const s of segs) {
        for (const p of idx.pins) {
            if (p.netId === s.netId) continue;              // its own pin: legitimate
            const onH = isH(s) && near(p.y, s.a.y) && withinInc(p.x, s.a.x, s.b.x);
            const onV = isV(s) && near(p.x, s.a.x) && withinInc(p.y, s.a.y, s.b.y);
            if (onH || onV) out.push({ netId: s.netId, pin: p.key, pinNet: p.netId, x: p.x, y: p.y });
        }
    }
    return out;
}

/** Two nets' trunks so close they read as one wire. */
function trunkOverlaps (projection) {
    const trunks = (projection.wires || []).filter((w) => w.trunk)
        .map((w) => ({ netId: w.netId, x: w.trunk.x, y1: Math.min(w.trunk.y1, w.trunk.y2), y2: Math.max(w.trunk.y1, w.trunk.y2) }));
    const out = [];
    for (let i = 0; i < trunks.length; i++) {
        for (let j = i + 1; j < trunks.length; j++) {
            const a = trunks[i], b = trunks[j];
            if (Math.abs(a.x - b.x) >= 4) continue;               // 4px: below this two lines merge
            const lo = Math.max(a.y1, b.y1), hi = Math.min(a.y2, b.y2);
            if (hi - lo > 8) out.push({ a: a.netId, b: b.netId, dx: Math.abs(a.x - b.x), span: hi - lo });
        }
    }
    return out;
}

/**
 * CLASS J — one solver net drawn under TWO different label texts.
 *
 * The shipped gate checks label INJECTIVITY (one text must not span two nets),
 * which catches a false connection. The reverse is a false DISCONNECTION: a
 * reader who sees N01 on one pin and N07 on another reads two nets where the
 * solver has one, so a circuit that is connected renders as broken.
 */
function splitLabelNets (projection) {
    const byNet = new Map();
    for (const l of projection.netLabels || []) {
        if (!byNet.has(l.netId)) byNet.set(l.netId, new Set());
        byNet.get(l.netId).add(l.text);
    }
    return [...byNet].filter(([, texts]) => texts.size > 1)
        .map(([netId, texts]) => ({ netId, texts: [...texts] }));
}

/**
 * CLASS K — one solver net drawn as copper in one place and as a label in
 * another. Half the pins are joined by a visible wire, the rest only by text;
 * nothing tells the reader the two halves are the same net.
 */
function mixedRouting (projection) {
    const copper = new Set((projection.wires || []).map((w) => w.netId));
    const labelled = new Set((projection.netLabels || []).map((l) => l.netId));
    return [...copper].filter((n) => labelled.has(n));
}

// ── per-circuit analysis ──────────────────────────────────────────────────

export function analyse (file) {
    const data = JSON.parse(readFileSync(file, 'utf-8'));
    resetIds();
    const loaded = Circuit.fromJSON(data);
    const nets = loaded.resolvedNets || [];
    const proj = projectSchematic(loaded.parts, nets);

    const idx = pinIndex(proj);
    const { uf: ruf } = renderedUF(proj, idx);
    const suf = solverUF(nets, loaded.parts, idx.visible);

    const drops = [];       // solver-connected, not rendered-connected
    for (const group of suf.groups()) {
        const m = [...group];
        for (let i = 0; i < m.length; i++) {
            for (let j = i + 1; j < m.length; j++) {
                if (!ruf.has(m[i]) || !ruf.has(m[j]) || !ruf.same(m[i], m[j])) drops.push([m[i], m[j]]);
            }
        }
    }
    const invents = [];     // rendered-connected, not solver-connected
    for (const group of ruf.groups()) {
        const m = [...group];
        for (let i = 0; i < m.length; i++) {
            for (let j = i + 1; j < m.length; j++) {
                if (!suf.has(m[i]) || !suf.has(m[j]) || !suf.same(m[i], m[j])) invents.push([m[i], m[j]]);
            }
        }
    }

    // A drawn pin whose net the projection could not resolve: the symbol shows
    // a terminal, and it connects to nothing at all.
    const unresolvedPins = idx.pins.filter((p) => !p.netId).map((p) => p.key);

    // Parts present and electrical in the file, absent from the artwork.
    const drawn = new Set(proj.symbols.map((s) => s.id));
    const droppedParts = loaded.parts
        .filter((p) => !INFRA_KINDS.has(p.kind) && !drawn.has(p.id))
        .map((p) => `${p.id}:${p.kind}`);

    // Solver nets with >=2 VISIBLE terminals that got neither copper nor label.
    const routedNets = new Set();
    for (const w of proj.wires || []) routedNets.add(w.netId);
    for (const l of proj.netLabels || []) routedNets.add(l.netId);
    const kindOf = new Map(loaded.parts.map((p) => [p.id, p.kind]));
    const undrawnNets = [];
    for (const net of nets) {
        const vis = (net.terminals || []).filter((t) => {
            const pid = t.part || t.partId;
            return pid && !INFRA_KINDS.has(kindOf.get(pid)) && idx.visible.has(tKey(pid, t.terminal));
        });
        if (vis.length >= 2 && !routedNets.has(net.id)) undrawnNets.push(net.id);
    }

    const geo = crossingsAndJunctions(proj);
    return {
        drops, invents, unresolvedPins, droppedParts, undrawnNets,
        foreignCrossWithDot: geo.foreignCrossWithDot,
        wireThroughPin: wireThroughForeignPin(proj, idx),
        splitLabelNets: splitLabelNets(proj),
        mixedRouting: mixedRouting(proj),
        sameNetTeeNoDot: geo.sameNetTeeNoDot,
        trunkOverlaps: trunkOverlaps(proj),
        visibleCount: idx.visible.size,
        partCount: loaded.parts.length,
        segCount: geo.segCount,
        labelled: !!proj.labelledRouting,
        renderedPairs: ruf.groups().reduce((n, g) => n + (g.size * (g.size - 1)) / 2, 0),
    };
}

export function discover (root) {
    const out = [];
    for (const dir of readdirSync(root, { withFileTypes: true })) {
        if (!dir.isDirectory()) continue;
        const dirPath = path.join(root, dir.name);
        for (const file of readdirSync(dirPath)) {
            if (/^circuit.*\.json$/i.test(file)) out.push({ id: `${dir.name}/${file}`, path: path.join(dirPath, file) });
        }
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const root = process.env.EXAMPLES_DIR;
    if (!root || !existsSync(root)) {
        console.error('set EXAMPLES_DIR to a sb3-creator examples directory');
        process.exit(2);
    }
    const files = discover(root);
    const rows = [];
    let errored = 0;
    for (const f of files) {
        try { rows.push({ id: f.id, ...analyse(f.path) }); }
        catch (e) { errored++; rows.push({ id: f.id, error: String(e && e.message).slice(0, 120) }); }
    }
    const ok = rows.filter((r) => !r.error);
    const CLASSES = [
        ['A undrawn solver connection', (r) => r.drops.length],
        ['B invented connection', (r) => r.invents.length],
        ['C drawn pin on no net', (r) => r.unresolvedPins.length],
        ['D electrical part not drawn', (r) => r.droppedParts.length],
        ['E net with no copper and no label', (r) => r.undrawnNets.length],
        ['F foreign crossing marked as junction', (r) => r.foreignCrossWithDot.length],
        ['G same-net tee with no junction dot', (r) => r.sameNetTeeNoDot.length],
        ['H two trunks closer than 4px', (r) => r.trunkOverlaps.length],
        ['I conductor runs through a foreign pin', (r) => r.wireThroughPin.length],
        ['J one net under two label texts', (r) => r.splitLabelNets.length],
        ['K one net drawn as both copper and label', (r) => r.mixedRouting.length],
    ];
    if (process.argv.includes('--json')) {
        console.log(JSON.stringify({ root, discovered: files.length, errored, rows }, null, 1));
    } else {
        console.log(`corpus: ${root}`);
        console.log(`discovered ${files.length}, analysed ${ok.length}, errored ${errored}\n`);
        for (const [name, get] of CLASSES) {
            const hit = ok.filter((r) => get(r) > 0);
            const total = ok.reduce((n, r) => n + get(r), 0);
            console.log(`${name.padEnd(42)} ${String(hit.length).padStart(5)} / ${ok.length} circuits   ${total} occurrences`);
        }
        console.log('\nWorst by (A + B + C + D + E + F + I):');
        const score = (r) => r.drops.length + r.undrawnNets.length + r.droppedParts.length +
            r.foreignCrossWithDot.length + r.invents.length + r.wireThroughPin.length + r.unresolvedPins.length;
        for (const r of ok.filter((r) => score(r) > 0).sort((a, b) => score(b) - score(a)).slice(0, 15)) {
            console.log(`  ${String(score(r)).padStart(5)}  ${r.id}  ` +
                `[A=${r.drops.length} B=${r.invents.length} C=${r.unresolvedPins.length} D=${r.droppedParts.length} ` +
                `E=${r.undrawnNets.length} F=${r.foreignCrossWithDot.length} I=${r.wireThroughPin.length}]`);
        }
        if (errored) {
            console.log('\nErrored:');
            for (const r of rows.filter((r) => r.error).slice(0, 15)) console.log(`  ${r.id}: ${r.error}`);
        }
    }
}

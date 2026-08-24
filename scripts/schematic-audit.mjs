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
const { shapeFor } = await import(path.join(here, '..', 'src', 'model', 'schematic-symbols.js'));

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

/**
 * CLASS L / M — a conductor that TOUCHES another net's conductor.
 *
 * Two lines meeting at a proper X with no dot is the schematic convention for
 * "these do not connect", and orthogonal routing cannot avoid crossings. The
 * two configurations that are NOT crossings:
 *
 *   L  a T — one net's line ends on the interior of another's. Convention
 *      reads a T as a branch, because there is no reason to draw one
 *      otherwise, so a foreign T asserts a connection the solver denies.
 *   M  a shared corner — both lines end at the same vertex, and the reader
 *      sees one wire turning a corner rather than two wires touching.
 *
 * A foreign meet that CARRIES a dot is class F and counted there, so these
 * three classes partition the foreign meets and never double-count.
 */
function foreignContact (projection) {
    const segs = segmentsOf(projection);
    const hs = segs.filter(isH); const vs = segs.filter(isV);
    const dots = new Set((projection.junctions || []).map((j) => `${Math.round(j.x)},${Math.round(j.y)}`));
    const tees = []; const corners = [];
    for (const h of hs) {
        for (const v of vs) {
            if (h.netId === v.netId) continue;
            const m = meets(h, v);
            if (!m) continue;
            if (dots.has(`${Math.round(m.x)},${Math.round(m.y)}`)) continue;   // class F
            if (m.interiorH && m.interiorV) continue;                         // a legitimate crossing
            const hit = { a: h.netId, b: v.netId, x: m.x, y: m.y };
            if (m.interiorH || m.interiorV) tees.push(hit); else corners.push(hit);
        }
    }
    return { tees, corners };
}

/**
 * CLASS N — two nets drawn COLLINEAR and close enough to read as one line.
 *
 * Class H below is the same idea restricted to `w.trunk` wires and to the
 * vertical axis. That restriction was the whole of its blindness: a detour
 * route carries `segments` and no `trunk`, so H never looked at one, and the
 * previous lane's class-I fix converted 799 circuits' trunks INTO detours —
 * moving them out of H's denominator at the moment they most needed watching.
 * N covers every wire shape and both axes.
 */
function parallelMerge (projection) {
    const segs = segmentsOf(projection);
    const out = [];
    const scan = (list, perp, lo, hi) => {
        for (let i = 0; i < list.length; i++) {
            for (let j = i + 1; j < list.length; j++) {
                const a = list[i], b = list[j];
                if (a.netId === b.netId) continue;
                if (Math.abs(perp(a) - perp(b)) >= 4) continue;
                const s = Math.max(Math.min(lo(a), hi(a)), Math.min(lo(b), hi(b)));
                const e = Math.min(Math.max(lo(a), hi(a)), Math.max(lo(b), hi(b)));
                if (e - s > 0.75) out.push({ a: a.netId, b: b.netId, span: e - s, d: Math.abs(perp(a) - perp(b)) });
            }
        }
    };
    scan(segs.filter(isV), (s) => s.a.x, (s) => s.a.y, (s) => s.b.y);
    scan(segs.filter(isH), (s) => s.a.y, (s) => s.a.x, (s) => s.b.x);
    return out;
}

/**
 * CLASS O — a terminal the SOLVER puts on a multi-pin net, on a part the
 * projection DID draw, with no drawn pin for it.
 *
 * The correspondence gates restrict the solver side of their comparison to
 * terminals the projection chose to draw (`visible`), so a terminal the
 * projection omits leaves BOTH sides of the equation at once and every class
 * stays green. Measured here against the nets instead: a seated MCU ships
 * `terminals: ["pb0"]` while its `seat.leadMap` puts 28 leads in holes, so the
 * strips resolve `vcc`/`avcc`/`gnd` onto the same part and the drawing showed
 * an ATtiny88 with one pin and no supply.
 */
function missingPins (projection, nets, parts, idx) {
    const kindOf = new Map(parts.map((p) => [p.id, p.kind]));
    const drawnSyms = new Set(projection.symbols.map((s) => s.id));
    const out = [];
    for (const net of nets) {
        const ts = (net.terminals || []).filter((t) => {
            const pid = t.part || t.partId;
            return pid && !INFRA_KINDS.has(kindOf.get(pid)) &&
                !String(pid).startsWith('@bb:') && drawnSyms.has(pid);
        });
        if (ts.length < 2) continue;
        for (const t of ts) {
            const k = tKey(t.part || t.partId, t.terminal);
            if (!idx.visible.has(k)) out.push({ net: net.id, terminal: k });
        }
    }
    return out;
}

/**
 * CLASS P — a net LABEL's leader line touching a foreign net's conductor.
 *
 * The leader is the short stub joining a pin to its label text, drawn in the
 * same stroke as copper, so it obeys copper's rule: it may CROSS another net's
 * conductor and must not TOUCH one.
 *
 * The first draft of this detector counted crossings too and reported 578
 * circuits / 1,232 incidences. That was wrong by 14x: a leader crossing a wire
 * at a proper X with no dot is the ordinary convention for "not connected".
 * Counting only contact gives 43 circuits / 86 incidences, which is the number
 * this class is worth. Recorded because a detector that over-counts by 14x
 * would have sent a large and pointless change through the drawing.
 */
function labelLeaderContact (projection) {
    const segs = segmentsOf(projection);
    const out = [];
    for (const l of projection.netLabels || []) {
        const la = { x: l.x1, y: l.y1 }, lb = { x: l.x2, y: l.y2 };
        const lead = { netId: l.netId, a: la, b: lb };
        if (!isH(lead) && !isV(lead)) continue;
        for (const s of segs) {
            if (s.netId === l.netId) continue;
            if (isH(lead) && isV(s)) {
                const m = meets(lead, s);
                if (m && !(m.interiorH && m.interiorV)) out.push({ label: l.text, net: l.netId, other: s.netId, x: m.x, y: m.y });
            } else if (isV(lead) && isH(s)) {
                const m = meets(s, lead);
                if (m && !(m.interiorH && m.interiorV)) out.push({ label: l.text, net: l.netId, other: s.netId, x: m.x, y: m.y });
            } else if (isH(lead) === isH(s)) {
                const perp = isH(lead) ? [lead.a.y, s.a.y] : [lead.a.x, s.a.x];
                if (Math.abs(perp[0] - perp[1]) >= 4) continue;
                const p1 = isH(lead) ? [lead.a.x, lead.b.x] : [lead.a.y, lead.b.y];
                const p2 = isH(lead) ? [s.a.x, s.b.x] : [s.a.y, s.b.y];
                const lo = Math.max(Math.min(...p1), Math.min(...p2));
                const hi = Math.min(Math.max(...p1), Math.max(...p2));
                if (hi - lo > 0.75) out.push({ label: l.text, net: l.netId, other: s.netId, span: hi - lo });
            }
        }
    }
    return out;
}

/** Class P, callable on a projection alone (mutation proofs). */
export function labelLeaderContactOf (projection) { return labelLeaderContact(projection); }

/** Class L/M and N detectors, callable on a projection alone (mutation proofs). */
export function foreignContactOf (projection) { return foreignContact(projection); }
export function parallelMergeOf (projection) { return parallelMerge(projection); }

/** Class O, callable on a projection plus the solver's own view (mutation proofs). */
export function missingPinsOf (projection, nets, parts) {
    return missingPins(projection, nets, parts, pinIndex(projection));
}

/**
 * The LIVE segment objects behind the artwork, so a mutation proof can move a
 * real conductor rather than invent coordinates that touch nothing. Trunk
 * endpoints are synthesised (a trunk is stored as x/y1/y2), so mutations
 * should move `segments` and `stubs` points, which are the real ones.
 */
export function segmentRefsOf (projection) { return segmentsOf(projection); }

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


// ── a symbol's OWN copper, read INDEPENDENTLY of the projection ───────────
//
// Classes A-P all measure `projection.wires`. A symbol's strokes are drawn by
// the two renderers straight from schematic-symbols.js and never appear
// there, so no class up to P could see any of them — and 403 drawn pins
// across 109 shipped circuits sat where their symbol's artwork does not
// reach. `disp-sevenseg/circuit.json` draws a digit outline with two
// whiskers at y=0 and lands EIGHT wires on eight points that touch no copper.
//
// This reader shares the shape TABLE with the fix (there is only one) and
// shares no CODE with it: the path parser below is separate from
// `artCopper()` in schematic-symbols.js on purpose, so a gate cannot be green
// because the fix and the check make the same mistake. It mirrors what
// schematic-svg.js and SchematicPanel.jsx actually draw, including their
// `s.generic` branch.

/** The `d` subset the symbol table writes. Arcs contribute no chord. */
function dSegments (d) {
    const t = String(d).trim().split(/[\s,]+/);
    const out = [];
    let i = 0, cur = null, start = null;
    while (i < t.length) {
        const c = t[i++];
        if (c === 'M') { cur = {x: +t[i++], y: +t[i++]}; start = cur; }
        else if (c === 'L') { const q = {x: +t[i++], y: +t[i++]}; if (cur) out.push([cur, q]); cur = q; }
        else if (c === 'Q') { i += 2; const q = {x: +t[i++], y: +t[i++]}; if (cur) out.push([cur, q]); cur = q; }
        else if (c === 'T') { const q = {x: +t[i++], y: +t[i++]}; if (cur) out.push([cur, q]); cur = q; }
        else if (c === 'A') { i += 5; cur = {x: +t[i++], y: +t[i++]}; }
        else if (c === 'Z') { if (cur && start) out.push([cur, start]); cur = start; }
        else i++;
    }
    return out;
}

/** Every stroke a symbol group contains, in PAGE coordinates. */
function symbolCopper (sym) {
    const art = sym.generic ? null : shapeFor(sym.kind, sym.params || {});
    const out = [];
    const push = (a, b) => out.push([{x: a.x + sym.x, y: a.y + sym.y}, {x: b.x + sym.x, y: b.y + sym.y}]);
    if (art) {
        for (const p of art.paths || []) for (const [a, b] of dSegments(typeof p === 'string' ? p : p.d)) push(a, b);
        for (const c of art.circles || []) {
            push({x: c.cx - c.r, y: c.cy}, {x: c.cx, y: c.cy - c.r});
            push({x: c.cx, y: c.cy - c.r}, {x: c.cx + c.r, y: c.cy});
            push({x: c.cx + c.r, y: c.cy}, {x: c.cx, y: c.cy + c.r});
            push({x: c.cx, y: c.cy + c.r}, {x: c.cx - c.r, y: c.cy});
        }
    } else {
        // The generic labelled box, as both renderers build it.
        const pins = sym.pins || [];
        const perSide = Math.max(1, sym.pinsPerSide || Math.ceil(pins.length / 2));
        const halfH = Math.max(20, ((perSide - 1) * 18) / 2 + 16);
        push({x: -26, y: -halfH}, {x: 26, y: -halfH});
        push({x: 26, y: -halfH}, {x: 26, y: halfH});
        push({x: 26, y: halfH}, {x: -26, y: halfH});
        push({x: -26, y: halfH}, {x: -26, y: -halfH});
        for (const pin of pins) {
            push({x: pin.side === 'left' ? -26 : 26, y: pin.y - sym.y}, {x: pin.x - sym.x, y: pin.y - sym.y});
        }
    }
    return out;
}

const pointToSeg = (p, [a, b]) => {
    const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
    const t = L === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

/**
 * CLASS Q — a drawn pin the symbol's own artwork does not reach.
 *
 * The wire arrives; there is nothing there to arrive AT. A reader sees a wire
 * ending in blank space beside the part, which is the plainest possible way
 * for a drawing to be wrong and the one no class before P was looking for.
 */
function orphanPins (projection) {
    const out = [];
    for (const sym of projection.symbols) {
        if (INFRA_KINDS.has(sym.kind)) continue;
        const copper = symbolCopper(sym);
        if (!copper.length) continue;
        for (const pin of sym.pins || []) {
            if (!copper.some((seg) => pointToSeg(pin, seg) <= 1.5)) {
                out.push({sym: sym.id, kind: sym.kind, pin: pin.name, x: pin.x, y: pin.y});
            }
        }
    }
    return out;
}

/**
 * CLASS Q2 — a symbol lead END, outside the body, that reaches no pin.
 *
 * Measured and DISPROVED as a defect rather than reported as one. All 44 in
 * the corpus are honest: a two- or three-terminal part with a terminal the
 * circuit does not use (`74-ammeter`'s potentiometer leaves `b` open, a slide
 * switch uses one throw), and drawing the unused lead is how a schematic says
 * so. It carries a ratchet instead of a zero.
 */
function orphanLeads (projection) {
    const out = [];
    for (const sym of projection.symbols) {
        if (INFRA_KINDS.has(sym.kind)) continue;
        const copper = symbolCopper(sym);
        for (const seg of copper) {
            for (const end of seg) {
                if (Math.abs(end.x - sym.x) < 25 && Math.abs(end.y - sym.y) < 22) continue;
                if ((sym.pins || []).some((p) => Math.hypot(p.x - end.x, p.y - end.y) < 1.5)) continue;
                if (copper.some((o) => o !== seg && pointToSeg(end, o) < 0.5)) continue;
                out.push({sym: sym.id, kind: sym.kind, x: end.x, y: end.y});
            }
        }
    }
    return out;
}

/**
 * CLASS R — a junction dot whose DRAWN DISC covers a foreign conductor.
 *
 * Class F asks whether a dot sits exactly on a foreign meet. The dot is drawn
 * `r=2.4` (schematic-svg.js), which is larger than the 2px pin clearance and
 * three times the 0.75px contact tolerance, so a dot 2px from another net's
 * copper is a filled blob touching it. Measured and found clean: 0 / 2098.
 */
function fatJunctions (projection, segs) {
    const out = [];
    for (const j of projection.junctions || []) {
        const own = new Set(segs.filter((s) => pointToSeg(j, [s.a, s.b]) < 0.75).map((s) => s.netId));
        for (const s of segs) {
            if (own.has(s.netId)) continue;
            const d = pointToSeg(j, [s.a, s.b]);
            if (d >= 0.75 && d < 2.4) out.push({x: j.x, y: j.y, other: s.netId, d});
        }
    }
    return out;
}

/**
 * CLASS S — a conductor TOUCHING a foreign symbol's own copper.
 *
 * Class L is this test against another net's WIRES. The router knew nothing
 * about symbol copper at all — it avoided body boxes and foreign pins and
 * nothing else — so a route could end on a lead. Seven shipped circuits did:
 * `74-ammeter` draws a potentiometer whose unconnected `b` lead ends at
 * (300,163) and another net's wire ends on that exact point, which reads as
 * that net joined to the pot's third terminal.
 *
 * Contact only. A wire CROSSING a symbol lead at a proper X is the same legal
 * crossing it is anywhere else.
 */
function symbolContact (projection, segs) {
    const out = [];
    const copper = [];
    for (const sym of projection.symbols) {
        if (INFRA_KINDS.has(sym.kind)) continue;
        const nets = new Set((sym.pins || []).map((p) => p.netId));
        for (const seg of symbolCopper(sym)) copper.push({seg, sym: sym.id, nets});
    }
    for (const s of segs) {
        for (const {seg, sym, nets} of copper) {
            if (nets.has(s.netId)) continue;
            const [a, b] = seg;
            const contacts = pointToSeg(s.a, seg) < 0.75 || pointToSeg(s.b, seg) < 0.75 ||
                pointToSeg(a, [s.a, s.b]) < 0.75 || pointToSeg(b, [s.a, s.b]) < 0.75;
            if (contacts) { out.push({sym, net: s.netId}); break; }
        }
    }
    return out;
}

/**
 * CLASS T — a drawn pin whose netId disagrees with the SOLVER's net.
 *
 * Every class from I onward compares a wire's `netId` with a pin's `netId`,
 * and BOTH are written by the projection. That is the projection checked
 * against itself. This one compares the drawn pin against `resolvedNets`,
 * which is the engine's answer, and closes the loop. Clean: 0 / 2098.
 */
function pinNetDisagreement (projection, nets) {
    const truth = new Map();
    for (const n of nets) {
        for (const t of n.terminals || []) truth.set(tKey(t.part || t.partId, t.terminal), n.id);
    }
    const out = [];
    for (const sym of projection.symbols) {
        if (INFRA_KINDS.has(sym.kind) || sym.id === IMPLICIT_GND) continue;
        for (const pin of sym.pins || []) {
            const want = truth.get(tKey(sym.id, pin.name));
            if (want !== undefined && pin.netId !== want) {
                out.push({pin: tKey(sym.id, pin.name), drawn: pin.netId, solver: want});
            }
        }
    }
    return out;
}

/** Q, R, S, T callable on a projection alone (mutation proofs). */
export function orphanPinsOf (projection) { return orphanPins(projection); }
export function orphanLeadsOf (projection) { return orphanLeads(projection); }
export function fatJunctionsOf (projection) { return fatJunctions(projection, segmentsOf(projection)); }
export function symbolContactOf (projection) { return symbolContact(projection, segmentsOf(projection)); }
export function pinNetDisagreementOf (projection, nets) { return pinNetDisagreement(projection, nets); }
export function symbolCopperOf (symbol) { return symbolCopper(symbol); }


// ── the TEXT, and the page edge — the last ink no class read ──────────────
//
// Third-pass finding: every class up to T reads geometry. The SVG also draws
// 57,672 TEXT runs across the corpus — net-label texts, part labels, pin
// names, kind names, value strings — and not one class looked at any of them.
// It also has a viewBox, and geometry outside it is ink that does not exist
// for the reader.
//
// GLYPH MODEL, stated because the counts depend on it: monospace at
// TEXT_ADVANCE em per character and 0.7 em cap height. DejaVu Sans Mono, the
// usual resolution of `font-family="monospace"`, advances 0.602 em. The V and
// W counts roughly DOUBLE between advance 0.50 and 0.62 (55 -> 105 pin-name
// collisions; 124 -> 172 label texts on foreign copper), so the classes are
// real at every setting in that range and their MAGNITUDE is a property of
// this model, not of the drawing. Changing the constant invalidates the
// ratchets, which is why it lives here and is asserted in the gate.
const TEXT_ADVANCE = 0.6;
const TEXT_CAP = 0.7;

/** Every text run the two renderers draw, as page-space boxes. */
function textRuns (projection) {
    const out = [];
    const push = (x, y, str, size, anchor, kind, netId) => {
        const s = String(str ?? '');
        if (!s) return;
        const w = TEXT_ADVANCE * size * s.length;
        const h = TEXT_CAP * size;
        const x1 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
        out.push({ x1, x2: x1 + w, y1: y - h, y2: y, s, kind, netId });
    };
    for (const l of projection.netLabels || []) push(l.x, l.y, l.text, 6.5, l.anchor, 'netlabel', l.netId);
    for (const sym of projection.symbols || []) {
        if (INFRA_KINDS.has(sym.kind)) continue;
        const art = sym.generic ? null : shapeFor(sym.kind, sym.params || {});
        push(sym.x, sym.y - 24, sym.label, 9, 'middle', 'symlabel');
        if (art) {
            for (const t of art.texts || []) push(sym.x + t.x, sym.y + t.y, t.s, t.size || 8, 'middle', 'glyph');
            const p = sym.params || {};
            const v = art.value === 'ohms' && p.ohms != null ? 'ohm'
                : art.value === 'farads' && p.farads != null ? 'farad'
                    : art.value === 'volts' ? `${p.volts ?? 5}V` : '';
            if (v) push(sym.x, sym.y + 19, v, 8, 'middle', 'value');
        } else {
            const pins = sym.pins || [];
            const perSide = Math.max(1, sym.pinsPerSide || Math.ceil(pins.length / 2));
            const halfH = Math.max(20, ((perSide - 1) * 18) / 2 + 16);
            for (const pin of pins) {
                push(sym.x + (pin.side === 'left' ? -22 : 22), pin.y + 2.5, pin.name, 6.5,
                    pin.side === 'left' ? 'start' : 'end', 'pinname');
            }
            push(sym.x, sym.y - halfH + 9, String(sym.kind).slice(0, 9), 7, 'middle', 'kindname');
        }
    }
    return out;
}

const boxesOverlap = (a, b) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;

/**
 * CLASS U — drawn geometry outside the viewBox.
 *
 * `schematic-svg.js` sizes the SVG from `projection.width/height`. Anything
 * beyond that is ink the reader never sees, which is a DROPPED connection
 * that leaves no trace in any geometric class: the pins are there, the wire
 * joins them, and the page stops before it. Measured: 0 / 2098.
 */
function offPage (projection) {
    const W = Math.max(1, Math.ceil(projection.width || 0));
    const H = Math.max(1, Math.ceil(projection.height || 0));
    const out = [];
    const chk = (x, y, what) => { if (x < 0 || y < 0 || x > W || y > H) out.push({ x, y, what }); };
    for (const sym of projection.symbols || []) {
        if (INFRA_KINDS.has(sym.kind)) continue;
        for (const p of sym.pins || []) chk(p.x, p.y, `${sym.id}:${p.name}`);
    }
    for (const s of segmentsOf(projection)) { chk(s.a.x, s.a.y, 'segment'); chk(s.b.x, s.b.y, 'segment'); }
    for (const j of projection.junctions || []) chk(j.x, j.y, 'junction');
    for (const l of projection.netLabels || []) chk(l.x, l.y, `label ${l.text}`);
    return out;
}

/**
 * CLASS V — two PIN NAMES whose text boxes overlap.
 *
 * Deliberately narrower than "two text runs overlap". Measured over the
 * corpus, 813 pairs overlap and 708 of them are a part's own kind name or
 * label sitting under its own label — untidy, and it misleads nobody. The
 * 105 that destroy information are two PIN NAMES: a generic box is 52px wide
 * and its names are drawn inward from ±22, so two long names on opposite
 * sides (`GPIO16`, six characters at 6.5px, reaches 23px) collide and neither
 * can be read. A reader who cannot tell which pin is which has lost the one
 * thing the labelled box exists to provide.
 */
function pinNameCollisions (projection) {
    const names = textRuns(projection).filter((t) => t.kind === 'pinname');
    const out = [];
    for (let i = 0; i < names.length; i++) {
        for (let j = i + 1; j < names.length; j++) {
            if (boxesOverlap(names[i], names[j])) out.push({ a: names[i].s, b: names[j].s });
        }
    }
    return out;
}

/**
 * CLASS W — a NET LABEL's text box lying on a FOREIGN net's conductor.
 *
 * Class P forbids the label's LEADER from touching foreign copper. The text
 * is the other four fifths of the same mark and was never checked, and it is
 * the half a reader actually reads: "same text = same net" is the entire
 * contract when routing falls back to labels, so a label text lying across
 * another net's wire invites reading that wire as carrying that name.
 *
 * Restricted to net labels on FOREIGN copper on purpose. A part label over a
 * wire (1,353 occurrences) is untidy; it names a part, not a net, and asserts
 * no connection. Counting those would have made this class eight times bigger
 * and eight times less true.
 */
function labelTextOnForeignCopper (projection) {
    const labels = textRuns(projection).filter((t) => t.kind === 'netlabel');
    const segs = segmentsOf(projection);
    const out = [];
    for (const t of labels) {
        for (const s of segs) {
            if (s.netId === t.netId) continue;
            const sx1 = Math.min(s.a.x, s.b.x), sx2 = Math.max(s.a.x, s.b.x);
            const sy1 = Math.min(s.a.y, s.b.y), sy2 = Math.max(s.a.y, s.b.y);
            if (t.x1 < sx2 && sx1 < t.x2 && t.y1 < sy2 && sy1 < t.y2) {
                out.push({ text: t.s, net: t.netId, other: s.netId });
                break;
            }
        }
    }
    return out;
}

/** U, V, W callable on a projection alone (mutation proofs). */
export function offPageOf (projection) { return offPage(projection); }
export function pinNameCollisionsOf (projection) { return pinNameCollisions(projection); }
export function labelTextOnForeignCopperOf (projection) { return labelTextOnForeignCopper(projection); }
export function textRunsOf (projection) { return textRuns(projection); }
export const TEXT_MODEL = { advance: TEXT_ADVANCE, cap: TEXT_CAP };

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
    const contact = foreignContact(proj);
    const segs = segmentsOf(proj);
    return {
        orphanPins: orphanPins(proj),
        orphanLeads: orphanLeads(proj),
        fatJunctions: fatJunctions(proj, segs),
        symbolContact: symbolContact(proj, segs),
        pinNetDisagreement: pinNetDisagreement(proj, nets),
        offPage: offPage(proj),
        pinNameCollisions: pinNameCollisions(proj),
        labelTextOnCopper: labelTextOnForeignCopper(proj),
        textRuns: textRuns(proj).length,
        drops, invents, unresolvedPins, droppedParts, undrawnNets,
        foreignCrossWithDot: geo.foreignCrossWithDot,
        wireThroughPin: wireThroughForeignPin(proj, idx),
        splitLabelNets: splitLabelNets(proj),
        mixedRouting: mixedRouting(proj),
        sameNetTeeNoDot: geo.sameNetTeeNoDot,
        trunkOverlaps: trunkOverlaps(proj),
        foreignTees: contact.tees,
        foreignCorners: contact.corners,
        parallelMerge: parallelMerge(proj),
        missingPins: missingPins(proj, nets, loaded.parts, idx),
        leaderContact: labelLeaderContact(proj),
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
        ['L conductor tees onto a foreign conductor', (r) => r.foreignTees.length],
        ['M two nets share a corner vertex', (r) => r.foreignCorners.length],
        ['N two nets collinear within 4px', (r) => r.parallelMerge.length],
        ['O connected terminal with no drawn pin', (r) => r.missingPins.length],
        ['P label leader touching a foreign conductor', (r) => r.leaderContact.length],
        ['Q drawn pin the symbol art does not reach', (r) => r.orphanPins.length],
        ['Q2 symbol lead reaching no pin (ratchet)', (r) => r.orphanLeads.length],
        ['R junction dot disc covering foreign copper', (r) => r.fatJunctions.length],
        ['S conductor touching foreign symbol copper', (r) => r.symbolContact.length],
        ['T drawn pin netId disagrees with the solver', (r) => r.pinNetDisagreement.length],
        ['U drawn geometry outside the viewBox', (r) => r.offPage.length],
        ['V two pin NAMES overlapping (ratchet)', (r) => r.pinNameCollisions.length],
        ['W a net label TEXT on foreign copper (ratchet)', (r) => r.labelTextOnCopper.length],
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
        console.log('\nWorst by (A + B + C + D + E + F + I + L + M + N + O + P):');
        const score = (r) => r.drops.length + r.undrawnNets.length + r.droppedParts.length +
            r.foreignCrossWithDot.length + r.invents.length + r.wireThroughPin.length + r.unresolvedPins.length +
            r.foreignTees.length + r.foreignCorners.length + r.parallelMerge.length + r.missingPins.length +
            r.leaderContact.length + r.orphanPins.length + r.fatJunctions.length +
            r.symbolContact.length + r.pinNetDisagreement.length;
        for (const r of ok.filter((r) => score(r) > 0).sort((a, b) => score(b) - score(a)).slice(0, 15)) {
            console.log(`  ${String(score(r)).padStart(5)}  ${r.id}  ` +
                `[A=${r.drops.length} B=${r.invents.length} C=${r.unresolvedPins.length} D=${r.droppedParts.length} ` +
                `E=${r.undrawnNets.length} F=${r.foreignCrossWithDot.length} I=${r.wireThroughPin.length} ` +
                `L=${r.foreignTees.length} M=${r.foreignCorners.length} N=${r.parallelMerge.length} ` +
                `O=${r.missingPins.length} P=${r.leaderContact.length} Q=${r.orphanPins.length} ` +
                `R=${r.fatJunctions.length} S=${r.symbolContact.length} T=${r.pinNetDisagreement.length}]`);
        }
        if (errored) {
            console.log('\nErrored:');
            for (const r of rows.filter((r) => r.error).slice(0, 15)) console.log(`  ${r.id}: ${r.error}`);
        }
    }
}

#!/usr/bin/env node
/**
 * seat-examples — batch re-author: every example whose parts float in
 * the air becomes a SEATED breadboard build, the way the real machines
 * are wired (owner photo, 2026-08-15). Uses the app's OWN footprint
 * and occupancy model, so what this writes is exactly what the
 * designer would have produced by hand:
 *   - adds a full-size breadboard when none exists
 *   - seats every part that has a FOOTPRINT, left to right, DIPs
 *     straddling the gutter (computeLeadMap's own convention)
 *   - converts part-to-part wires between seated parts into colored
 *     hole jumpers in the pins' own column groups
 *   - vcc/gnd wires become rail jumpers (t+ / b-), red/black
 *   - anything unseatable (retro DIPs without footprints yet) stays a
 *     floating part with logical wires — degraded, not broken
 *
 * Usage: node scripts/seat-examples.mjs --examples <dir> [--only id]
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { FOOTPRINTS, computeLeadMap } from '../src/model/footprints.js';
import { BreadboardModel } from '../src/model/breadboard.js';

const args = process.argv.slice(2);
const dir = args[args.indexOf('--examples') + 1];
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
if (!dir) { console.error('need --examples <dir>'); process.exit(1); }

const COLORS = ['green', 'blue', 'yellow', 'orange', 'purple'];

function widthOf(fp) {
    let max = 0;
    for (const o of Object.values(fp.leads)) max = Math.max(max, o.dCol);
    return max + 1;
}

function seatExample(id) {
    const p = join(dir, id, 'circuit.json');
    if (!existsSync(p)) return null;
    const c = JSON.parse(readFileSync(p, 'utf8'));
    if (!Array.isArray(c.parts) || !Array.isArray(c.wires)) return { id, skip: 'format' };
    if (c.parts.some(q => q.seat)) return { id, skip: 'already-seated' };
    if (c.parts.some(q => q.kind === 'breadboard')) return { id, skip: 'has-board' };

    const seatable = [];
    const floating = [];
    for (const part of c.parts) {
        if (part.kind === 'vcc' || part.kind === 'gnd') { floating.push(part); continue; }
        const fp0 = FOOTPRINTS[part.kind];
        if (!fp0) { floating.push(part); continue; }
        seatable.push(part);
    }
    if (!seatable.length) return { id, skip: 'nothing-seatable' };

    // The board.
    const bb = { id: 'bb1', kind: 'breadboard', params: {}, terminals: [], x: 470, y: 330, rotation: 0 };
    const model = new BreadboardModel(bb.id, {});

    // Pack left → right; MCU-ish first so it sits like the photo.
    seatable.sort((a, b) => (b.kind === 'mcu') - (a.kind === 'mcu'));
    let col = 3;
    const seats = new Map();
    for (const part of seatable) {
        const fp = FOOTPRINTS[part.kind];
        const w = widthOf(fp);
        if (col + w > 62) { floating.push(part); continue; }   // v1: one board; overflow floats
        // A gutter-straddling DIP seats at row e: its top pin row lands in e
        // and the bottom row in f — the tight straddle a real chip makes.
        // Seating it at row a stretched the legs across the whole top block
        // (a..f), which is not how any physical DIP sits. Flat parts keep
        // row a/b territory.
        const refRow = fp.straddlesGutter ? 'e' : 'a';
        let leadMap;
        try { leadMap = computeLeadMap(fp, `${refRow}${col}`); } catch { floating.push(part); continue; }
        try { model.occupy(part.id, leadMap); }
        catch { floating.push(part); continue; }   // occupy throws on conflict
        part.seat = { boardId: bb.id, leadMap };
        delete part.x; delete part.y;
        seats.set(part.id, leadMap);
        col += w + 2;
    }
    if (!seats.size) return { id, skip: 'no-seats-fit' };

    // Column-group jumper endpoints: same column, a free row in the block.
    const used = new Set();
    for (const lm of seats.values()) for (const h of Object.values(lm)) used.add(h);
    const groupRows = { top: ['a', 'b', 'c', 'd', 'e'], bottom: ['f', 'g', 'h', 'i', 'j'] };
    const freeHole = (hole) => {
        const row = hole[0]; const colN = hole.slice(1);
        const rows = groupRows.top.includes(row) ? groupRows.top : groupRows.bottom;
        for (const r of rows) {
            const h = `${r}${colN}`;
            if (!used.has(h)) { used.add(h); return h; }
        }
        return null;
    };

    const holeWires = Array.isArray(c.holeWires) ? c.holeWires : [];
    const keptWires = [];
    let wireN = 0; let ci = 0;
    const powerKind = (pid) => { const q = c.parts.find(x => x.id === pid); return q && (q.kind === 'vcc' || q.kind === 'gnd') ? q.kind : null; };
    for (const w of c.wires) {
        const A = seats.get(w.from); const B = seats.get(w.to);
        const aHole = A && A[w.fromTerminal]; const bHole = B && B[w.toTerminal];
        const pk = powerKind(w.from) || powerKind(w.to);
        if (aHole && bHole) {
            const a = freeHole(aHole); const b = freeHole(bHole);
            if (a && b) {
                holeWires.push({ ref: `bbw:${bb.id}:gen_${wireN++}`, boardId: bb.id, a, b, color: COLORS[ci++ % COLORS.length] });
            }
        } else if (pk && (aHole || bHole)) {
            // Power to a seated pin: jumper to the matching rail.
            const pinHole = aHole || bHole;
            const a = freeHole(pinHole);
            const railRow = pk === 'vcc' ? 't+' : 'b-';
            const rail = `${railRow}${pinHole.slice(1)}`;
            if (a) {
                holeWires.push({ ref: `bbw:${bb.id}:gen_${wireN++}`, boardId: bb.id, a, b: rail, color: pk === 'vcc' ? 'red' : 'black' });
            }
        }
        keptWires.push(w);   // ALWAYS kept: wires are the electrical
    }                        // truth; jumpers are the visual layer.

    // Floating parts get parked above the board, spaced.
    let fx = 80;
    for (const part of floating) {
        if (part.x == null || (part.x === 120 && part.y === 120)) { part.x = fx; part.y = 60; fx += 140; }
    }

    c.parts.push(bb);
    c.wires = keptWires;
    c.holeWires = holeWires;
    writeFileSync(p, JSON.stringify(c, null, 1));
    return { id, seated: seats.size, jumpers: wireN, kept: keptWires.length, floating: floating.length };
}

const ids = only ? [only] : readdirSync(dir).filter(d => existsSync(join(dir, d, 'circuit.json')));
const stats = { done: 0, skipped: 0 };
for (const id of ids) {
    const r = seatExample(id);
    if (!r) continue;
    if (r.skip) { stats.skipped++; continue; }
    stats.done++;
    console.log(`${r.id}: seated ${r.seated}, jumpers ${r.jumpers}, kept-logical ${r.kept}, floating ${r.floating}`);
}
console.log(`\n${stats.done} examples re-authored as seated builds, ${stats.skipped} skipped (already seated / pure / unseatable)`);

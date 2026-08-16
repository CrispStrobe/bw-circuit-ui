#!/usr/bin/env node
/**
 * seat-examples — batch re-author: every example whose parts float in
 * the air becomes a SEATED breadboard build, the way the real machines
 * are wired (owner photo, 2026-08-15). Uses the app's OWN footprint
 * and occupancy model, so what this writes is exactly what the
 * designer would have produced by hand:
 *   - adds full-size breadboards when none exist — up to four,
 *     stacked like the real multi-board machines: when a chip no
 *     longer fits the current board, the next board opens instead of
 *     the chip floating off into the air (v1 floated the Z80 bench's
 *     ACIA and glue for exactly this reason)
 *   - seats every part that has a FOOTPRINT, left to right, DIPs
 *     straddling the gutter (computeLeadMap's own convention)
 *   - converts part-to-part wires between seated parts ON THE SAME
 *     BOARD into colored hole jumpers in the pins' own column groups;
 *     cross-board connections stay logical wires (they render anchored
 *     at the seated holes, arcing board to board like real hookup wire)
 *   - vcc/gnd wires become rail jumpers (t+ / b-) on the pin's own
 *     board, red/black
 *   - anything unseatable (no footprint, or wider than a board) stays
 *     a floating part with logical wires — degraded, not broken
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

    // Boards open on demand, stacked vertically like the real machines
    // (a full-size board is ~310 world units tall; 360 leaves an air gap
    // for the arcing cross-board wires).
    const MAX_BOARDS = 4;
    const boards = [];
    const openBoard = () => {
        const n = boards.length + 1;
        const bb = { id: `bb${n}`, kind: 'breadboard', params: {}, terminals: [], x: 470, y: 330 + (n - 1) * 360, rotation: 0 };
        const board = { bb, model: new BreadboardModel(bb.id, {}), col: 3 };
        boards.push(board);
        return board;
    };

    // Pack left → right; MCU-ish first, then widest-first so the big
    // DIPs claim whole boards before the small parts fill the gaps.
    seatable.sort((a, b) =>
        ((b.kind === 'mcu') - (a.kind === 'mcu')) ||
        (widthOf(FOOTPRINTS[b.kind]) - widthOf(FOOTPRINTS[a.kind])));
    const seats = new Map();        // part id → leadMap
    const seatBoard = new Map();    // part id → board
    let board = openBoard();
    for (const part of seatable) {
        const fp = FOOTPRINTS[part.kind];
        const w = widthOf(fp);
        if (board.col + w > 62) {
            if (w + 3 > 62 || boards.length >= MAX_BOARDS) { floating.push(part); continue; }
            board = openBoard();
        }
        // A gutter-straddling DIP seats at row e: its top pin row lands in e
        // and the bottom row in f — the tight straddle a real chip makes.
        // Seating it at row a stretched the legs across the whole top block
        // (a..f), which is not how any physical DIP sits. Flat parts keep
        // row a/b territory.
        const refRow = fp.straddlesGutter ? 'e' : 'a';
        let leadMap;
        try { leadMap = computeLeadMap(fp, `${refRow}${board.col}`); } catch { floating.push(part); continue; }
        try { board.model.occupy(part.id, leadMap); }
        catch { floating.push(part); continue; }   // occupy throws on conflict
        part.seat = { boardId: board.bb.id, leadMap };
        delete part.x; delete part.y;
        seats.set(part.id, leadMap);
        seatBoard.set(part.id, board);
        // +3, not +2: DIP bodies overhang their pin span by ~10 world
        // units each side, so a 2-column gap left bodies 8 units apart —
        // reading as touching/overlapping on screen (owner screenshot).
        board.col += w + 3;
    }
    if (!seats.size) return { id, skip: 'no-seats-fit' };

    // Column-group jumper endpoints: same column, a free row in the block.
    // Occupancy is per board — the same hole name exists once per board.
    const used = new Set();
    for (const [pid, lm] of seats) for (const h of Object.values(lm)) used.add(`${seatBoard.get(pid).bb.id}:${h}`);
    const groupRows = { top: ['a', 'b', 'c', 'd', 'e'], bottom: ['f', 'g', 'h', 'i', 'j'] };
    const freeHole = (bbId, hole) => {
        const row = hole[0]; const colN = hole.slice(1);
        const rows = groupRows.top.includes(row) ? groupRows.top : groupRows.bottom;
        for (const r of rows) {
            const h = `${r}${colN}`;
            if (!used.has(`${bbId}:${h}`)) { used.add(`${bbId}:${h}`); return h; }
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
        const aBoard = seatBoard.get(w.from); const bBoard = seatBoard.get(w.to);
        const pk = powerKind(w.from) || powerKind(w.to);
        if (aHole && bHole && aBoard === bBoard) {
            const bbId = aBoard.bb.id;
            const a = freeHole(bbId, aHole); const b = freeHole(bbId, bHole);
            if (a && b) {
                holeWires.push({ ref: `bbw:${bbId}:gen_${wireN++}`, boardId: bbId, a, b, color: COLORS[ci++ % COLORS.length] });
            }
        } else if (pk && (aHole || bHole)) {
            // Power to a seated pin: jumper to the matching rail on the
            // pin's own board.
            const pinHole = aHole || bHole;
            const pinBoard = aBoard || bBoard;
            const bbId = pinBoard.bb.id;
            const a = freeHole(bbId, pinHole);
            const railRow = pk === 'vcc' ? 't+' : 'b-';
            const rail = `${railRow}${pinHole.slice(1)}`;
            if (a) {
                holeWires.push({ ref: `bbw:${bbId}:gen_${wireN++}`, boardId: bbId, a, b: rail, color: pk === 'vcc' ? 'red' : 'black' });
            }
        }
        // Cross-board seated pairs land here with no jumper: the kept
        // logical wire IS the hookup wire between boards.
        keptWires.push(w);   // ALWAYS kept: wires are the electrical
    }                        // truth; jumpers are the visual layer.

    // Floating parts park ABOVE the first board, spaced — always. Keeping
    // an original x/y sounded respectful and put floats ON TOP of the
    // board that did not exist when those coordinates were authored
    // (owner screenshot: an LED column through the middle of the build).
    const boardTop = 330 - 310 / 2;   // first board's top edge in world units
    let fx = 80;
    for (const part of floating) {
        part.x = fx; part.y = Math.min(60, boardTop - 100); fx += 140;
    }

    // Boards go to the FRONT of the parts array: every renderer that
    // paints in array order then has the substrate below the parts.
    for (const b of boards.reverse()) c.parts.unshift(b.bb);
    c.wires = keptWires;
    c.holeWires = holeWires;
    writeFileSync(p, JSON.stringify(c, null, 1));
    return { id, seated: seats.size, boards: boards.length, jumpers: wireN, kept: keptWires.length, floating: floating.length };
}

const ids = only ? [only] : readdirSync(dir).filter(d => existsSync(join(dir, d, 'circuit.json')));
const stats = { done: 0, skipped: 0 };
for (const id of ids) {
    const r = seatExample(id);
    if (!r) continue;
    if (r.skip) { stats.skipped++; continue; }
    stats.done++;
    console.log(`${r.id}: seated ${r.seated} on ${r.boards} board(s), jumpers ${r.jumpers}, kept-logical ${r.kept}, floating ${r.floating}`);
}
console.log(`\n${stats.done} examples re-authored as seated builds, ${stats.skipped} skipped (already seated / pure / unseatable)`);

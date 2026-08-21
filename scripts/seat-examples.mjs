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
import { FOOTPRINTS, computeLeadMap, straddleRefRow } from '../src/model/footprints.js';
import { holeWorldPos } from '../src/interaction/seat-geometry.js';
import { BreadboardModel } from '../src/model/breadboard.js';
import { registerSidecar } from '../src/model/parts-registry.js';
import { layoutFloatingParts } from '../src/model/board-geometry.js';

// The FOOTPRINTS proxy falls back to sidecar-declared footprints (the
// matrix8x8 seats that way); in the app the loader registers them —
// here we bulk-load, or the generator would float every sidecar-seated
// part the designer can seat.
const sidecarByKind = new Map(); // kind → sidecar (float spacing reads w/h)
{
    const dir = new URL('../src/parts-data/', import.meta.url);
    for (const f of readdirSync(dir)) {
        if (!f.endsWith('.json')) continue;
        try {
            const sc = JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
            if (sc.kind) { registerSidecar(sc); sidecarByKind.set(sc.kind, sc); }
        } catch { /* a bad sidecar is bw-parts' problem, not the batch's */ }
    }
}

const args = process.argv.slice(2);
const dir = args[args.indexOf('--examples') + 1];
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const reseat = args.includes('--reseat');
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
    if (reseat) {
        // CURATED benches are off limits: a board id outside the generator's
        // own bb<N> naming means a human (or the designer) authored this
        // bench, tap wires and all — stripping it dangles every {board,hole}
        // reference (it broke the eleven pc* pure-circuit lessons).
        const foreignBoard = c.parts.some(q => q.kind === 'breadboard' && !/^bb\d+$/.test(q.id));
        if (foreignBoard) return { id, skip: 'curated-bench' };
        // Strip everything a previous batch generated: boards, seats, the
        // gen_* jumpers and gen-tap wires. Logical wires were ALWAYS kept,
        // so the electrical truth survives the round trip.
        c.parts = c.parts.filter(q => q.kind !== 'breadboard');
        for (const q of c.parts) { delete q.seat; }
        c.holeWires = (c.holeWires || []).filter(j => !/^bbw:bb\d+:gen_/.test(j.ref));
        c.wires = c.wires.filter(w => !w.genPower);
    } else {
        if (c.parts.some(q => q.seat)) return { id, skip: 'already-seated' };
        if (c.parts.some(q => q.kind === 'breadboard')) return { id, skip: 'has-board' };
    }

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
        // col: top-block cursor (row a / gutter DIPs). colBot: bottom-block
        // cursor (row f) — flat parts overflow there before a NEW board
        // opens. This is what keeps an 8×(R+LED) rank on ONE board the way
        // the real Ben Eater build lies (owner: "at most 3 breadboards").
        const board = { bb, model: new BreadboardModel(bb.id, {}), col: 3, colBot: 3 };
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
        const straddles = !!fp.straddlesGutter;
        // Small flat parts use a tighter gap: a resistor does not overhang
        // its span the way a DIP body does, and +3 gaps are what pushed the
        // LED rank onto a fourth board.
        const gap = (!straddles && w <= 6) ? 1 : 3;
        // Where does this part go? Gutter DIPs need the top cursor. Flat
        // parts take the top cursor while it fits, then the BOTTOM block
        // of any open board, and only then a new board.
        let target = null, useBottom = false;
        if (board.col + w <= 62) { target = board; }
        if (!target && !straddles) {
            for (const b2 of boards) {
                if (b2.colBot + w <= 62) { target = b2; useBottom = true; break; }
            }
        }
        if (!target) {
            if (w + 3 > 62 || boards.length >= MAX_BOARDS) { floating.push(part); continue; }
            board = openBoard();
            target = board;
        }
        // A gutter-straddling part seats at the row its PHYSICAL span
        // demands: a classic DIP at e (0.3", the tight straddle), the
        // Nano at b (0.6"), the Pico at a (0.7") — straddleRefRow reads
        // the sidecar's rowSpanPitches. Flat parts keep row a territory
        // on top, row f when they overflow to the bottom block.
        const refRow = straddles ? straddleRefRow(fp) : (useBottom ? 'f' : 'a');
        const col = useBottom ? target.colBot : target.col;
        let leadMap;
        try { leadMap = computeLeadMap(fp, `${refRow}${col}`); } catch { floating.push(part); continue; }
        try { target.model.occupy(part.id, leadMap); }
        catch { floating.push(part); continue; }   // occupy throws on conflict
        part.seat = { boardId: target.bb.id, leadMap };
        // Keep x/y AS WELL: the app derives position from the seat, but the
        // file stays self-describing for every consumer that predates seats
        // (the round-trip validity test requires coordinates on all parts).
        try {
            const firstHole = Object.values(leadMap)[0];
            const pos = holeWorldPos(target.bb, firstHole);
            part.x = Math.round(pos.x); part.y = Math.round(pos.y);
        } catch { part.x = target.bb.x; part.y = target.bb.y; }
        seats.set(part.id, leadMap);
        seatBoard.set(part.id, target);
        if (useBottom) target.colBot += w + gap;
        else target.col += w + gap;
        // A gutter-straddling DIP owns its f-row columns too — the bottom
        // cursor must clear them or every flat part sent to the bottom
        // block lands on the CPU's own pins, occupy() throws, and the
        // whole LED rank ends up parked as floats in a line above the
        // bench (self-taken screenshot, 2026-08-16).
        if (straddles) target.colBot = Math.max(target.colBot, target.col);
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

    const railsUsed = new Set(); // `${bbId}:${railRow}` touched by any generated jumper
    const holeWires = Array.isArray(c.holeWires) ? c.holeWires : [];
    const keptWires = [];
    let wireN = 0; let ci = 0;
    const powerKind = (pid) => { const q = c.parts.find(x => x.id === pid); return q && (q.kind === 'vcc' || q.kind === 'gnd') ? q.kind : null; };
    // The catalog mixes wire dialects: the original flat form
    // ({from: 'id', fromTerminal: 't'}) and the modern object form
    // ({from: {part, terminal}}) that later re-authors wrote. Reading
    // only the flat fields silently skipped every object-form wire —
    // pico01-blink came out of the batch with ZERO jumpers.
    const norm = (w, side) => {
        const v = w[side];
        if (v && typeof v === 'object') return { part: v.part, terminal: v.terminal };
        return { part: v, terminal: w[side + 'Terminal'] };
    };
    for (const w of c.wires) {
        const F = norm(w, 'from'); const T = norm(w, 'to');
        const A = seats.get(F.part); const B = seats.get(T.part);
        const aHole = A && A[F.terminal]; const bHole = B && B[T.terminal];
        const aBoard = seatBoard.get(F.part); const bBoard = seatBoard.get(T.part);
        const pk = powerKind(F.part) || powerKind(T.part);
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
                // This rail now CARRIES a load — it must be fed. Without
                // this, a rank of LEDs dropped to a second board's ground
                // rail hung off an unpowered strip: they could never
                // light and the DRC flagged every one (owner screenshot,
                // 8-LED chaser).
                railsUsed.add(`${bbId}:${railRow}`);
            }
        }
        // Cross-board seated pairs land here with no jumper: the kept
        // logical wire IS the hookup wire between boards.
        keptWires.push(w);   // ALWAYS kept: wires are the electrical
    }                        // truth; jumpers are the visual layer.

    // ── POWER DISCIPLINE (owner audit 2026-08-16: 107 examples had MCU
    // power pins wired to NOTHING and rails that floated) ──────────────
    // 1. Every seated part's power-named pins jumper to the matching rail
    //    on its own board — the chip is FED, visibly, like a real build.
    // 2. Every vcc/gnd SYMBOL taps the first board's rail, so the rail
    //    net actually carries the supply instead of floating decor.
    // 3. Rails of LATER boards chain from board 1's rails via the
    //    symbols' logical net (tap wires per board).
    const POWER_TOP = new Set(['vcc', 'vdd', 'avcc', '5v', '3v3', 'vbus', 'vsys']);
    const POWER_BOT = new Set(['gnd', 'gnd2', 'gnd3', 'vss', 'agnd', 'swd_gnd',
        'gnd_1', 'gnd_2', 'gnd_3', 'gnd_4', 'gnd_5', 'gnd_6', 'gnd_7']);
    const powered = new Set(); // `${bbId}:${railRow}` that already carry supply
    // A power pin the AUTHOR wired deliberately keeps its wiring: the
    // calculator feeds vsys THROUGH the ON/OFF switch, and the blanket
    // rail jumper here silently bypassed it — pwr.a and pwr.com ended in
    // one net and the switch could never cut anything (peer probe,
    // 2026-08-17). Auto-feed only power pins with NO logical wire.
    const wiredPower = new Set();
    for (const w of keptWires) {
        for (const side of ['from', 'to']) {
            const v = w[side];
            const part = (v && typeof v === 'object') ? v.part : v;
            const term = (v && typeof v === 'object') ? v.terminal : w[side + 'Terminal'];
            if (part && term) wiredPower.add(`${part}:${String(term).toLowerCase()}`);
        }
    }
    for (const [pid, lm] of seats) {
        const bId = seatBoard.get(pid).bb.id;
        for (const [term, hole] of Object.entries(lm)) {
            const t = term.toLowerCase();
            const isTop = POWER_TOP.has(t); const isBot = POWER_BOT.has(t);
            if (!isTop && !isBot) continue;
            if (wiredPower.has(`${pid}:${t}`)) continue;
            const railRow = isTop ? 't+' : 'b-';
            const a = freeHole(bId, hole);
            if (!a) continue;
            holeWires.push({ ref: `bbw:${bId}:gen_${wireN++}`, boardId: bId, a, b: `${railRow}${hole.slice(1)}`, color: isTop ? 'red' : 'black' });
            powered.add(`${bId}:${railRow}`);
            railsUsed.add(`${bId}:${railRow}`);
        }
    }
    const symbols = c.parts.filter(q => q.kind === 'vcc' || q.kind === 'gnd');

    // A floating development board is not breadboard-seated, so its actual
    // supply pins never pass through the rail-jumper loop above. Generated
    // benches must still power the board itself, not merely its peripherals.
    // Append omitted supply terminals (program-derived benches often list
    // only GPIOs), then connect the canonical symbols exactly once.
    const DEV_POWER = {
        arduino_uno: { vcc: ['5v'], gnd: ['gnd2', 'gnd3', 'gnd'] },
        arduino_nano: { vcc: ['5v'], gnd: ['gnd', 'gnd2'] },
        arduino_mega: { vcc: ['5v'], gnd: ['gnd2', 'gnd3', 'gnd'] },
        pi_pico: { vcc: ['vbus', 'vsys'], gnd: ['gnd_1', 'gnd_2', 'gnd_3', 'gnd_4', 'gnd_5'] },
    };
    const endpointUsed = (partId, terminal) => keptWires.some(w => {
        const F = norm(w, 'from'); const T = norm(w, 'to');
        return (F.part === partId && F.terminal === terminal) ||
            (T.part === partId && T.terminal === terminal);
    });
    for (const dev of floating) {
        const candidates = DEV_POWER[dev.kind];
        if (!candidates) continue;
        const declared = new Set(dev.terminals || []);
        const physical = new Set((sidecarByKind.get(dev.kind)?.terminals || []).map(t => t.name));
        for (const supplyKind of ['vcc', 'gnd']) {
            const sym = symbols.find(q => q.kind === supplyKind);
            const alreadyPowered = candidates[supplyKind].some(name => endpointUsed(dev.id, name));
            const terminal = candidates[supplyKind].find(name => physical.has(name));
            if (!sym || !terminal || alreadyPowered) continue;
            if (!declared.has(terminal)) {
                dev.terminals = [...(dev.terminals || []), terminal];
                declared.add(terminal);
            }
            keptWires.push({
                from: sym.id, fromTerminal: supplyKind,
                to: dev.id, toTerminal: terminal,
                color: supplyKind === 'vcc' ? 'red' : 'black',
                genPower: true,
            });
        }
    }

    // Symbols feed the rails they serve. genPower marks these wires so a
    // --reseat run can strip and regenerate them.
    for (const sym of symbols) {
        const railRow = sym.kind === 'vcc' ? 't+' : 'b-';
        for (const b2 of boards) {
            const bId = b2.bb.id;
            // Tap every rail that carries EITHER a chip's power pin or any
            // generated rail drop — a used rail without a supply is decor
            // that silently breaks the circuit.
            if (!powered.has(`${bId}:${railRow}`) && !railsUsed.has(`${bId}:${railRow}`)) continue;
            keptWires.push({
                from: sym.id, fromTerminal: sym.kind,
                to: { board: bId, hole: `${railRow}${2 + boards.indexOf(b2)}` },
                // Bench color convention — without this the gnd tap rendered
                // in the tap layer's default red (self-taken SOS screenshot).
                color: sym.kind === 'vcc' ? 'red' : 'black',
                genPower: true,
            });
        }
    }

    // Floating parts park in body-aware rows ABOVE the first board. This
    // uses the exact same physical board geometry as rendering and hit-test;
    // x/y are centres, not mistaken left edges.
    const floatPositions = layoutFloatingParts(
        floating,
        kind => sidecarByKind.get(kind),
        { boardTop: 330 - 310 / 2, left: 40, right: 1000, gap: 40 },
    );
    for (const part of floating) Object.assign(part, floatPositions.get(part.id));

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

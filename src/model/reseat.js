/**
 * reseat.js — the CIRCUIT substitution (the bw-circuit-ui half of the reseat
 * gate, ROADMAP §3.8.3). A near-pure function — its only dependency is the
 * canonical wire-endpoint reader (src/model/wire-endpoints.js), the single
 * sanctioned place that reads the {from, fromTerminal} vs {from:{part,terminal}}
 * dialect. It otherwise operates on
 * plain { parts, wires }: it lifts the CPU subsystem of a 6502 board and drops
 * in an 8086/8255 subsystem, PRESERVING the net identity of the LED nets.
 *
 * The gate (bw-board) proves this transform preserves observable behaviour; the
 * transform lives HERE so it is testable on its own. See RESEAT-GATE.md.
 *
 * The contract this honours (settled with lego-47):
 *  #4 INFER the boundary, don't mark it. The lifted subsystem is the CPU plus
 *     the transitive closure of ACTIVE parts (ICs) reachable from it — the VIA,
 *     the ROM, the decoder. Growth passes through ICs and STOPS at passives (an
 *     LED reaches a resistor and ground), so the port pins are the cut. No
 *     per-example marker in the JSON.
 *  #5 Preserve NET IDENTITY, not pin identity. The LEDs, resistors and their
 *     nets STAY. For each logical pin the program drives, we find the NET its
 *     ORIGINAL (VIA) terminal sits on, and re-terminate the SAME net onto the
 *     new (8255) terminal the pin declaration names. The mapping is
 *     program-logical-pin → net; a port mismatch is then impossible to express
 *     silently — it shows up as the LED net landing on the wrong 8255 port.
 */

import { wireEndpoint } from './wire-endpoints.js';

// Parts that never join the lifted subsystem: two-terminal passives and the
// fixtures a board's OUTPUT is read from. Growth stops here — that is the cut.
const PASSIVE = new Set([
    'resistor', 'led', 'rgb_led', 'capacitor', 'inductor', 'diode', 'zener',
    'button', 'switch', 'potentiometer', 'buzzer', 'ldr', 'ntc',
]);
const POWER = new Set(['vcc', 'gnd']);

const kindOf = (parts, id) => { const p = parts.find((x) => x.id === id); return p ? (p.kind || p.type) : null; };

/**
 * Union-find over wire endpoints → a root id per electrical net. Everything is
 * derived from WIRES: the parts in a gallery circuit carry no `terminals` array,
 * so the wires are the only record of which terminal is on which net.
 */
function buildNets(wires) {
    const parent = new Map();
    const find = (x) => { while (parent.has(x) && parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x)) ?? parent.get(x)); x = parent.get(x); } return x; };
    const key = (p, t) => `${p}.${t}`;
    const add = (k) => { if (!parent.has(k)) parent.set(k, k); };
    const endpoints = []; // { part, terminal, k }  (k = key)
    for (const w of wires) {
        const ef = wireEndpoint(w, 'from'), et = wireEndpoint(w, 'to');
        if (!ef?.terminal || !et?.terminal) continue; // skip board-hole / malformed endpoints
        const a = key(ef.part, ef.terminal), b = key(et.part, et.terminal);
        add(a); add(b); parent.set(find(a), find(b));
        endpoints.push({ part: ef.part, terminal: ef.terminal, k: a }, { part: et.part, terminal: et.terminal, k: b });
    }
    // root -> [{part, terminal}]
    const netMembers = new Map();
    for (const e of endpoints) {
        const root = find(e.k);
        if (!netMembers.has(root)) netMembers.set(root, []);
        netMembers.get(root).push({ part: e.part, terminal: e.terminal });
    }
    return { find, key, netMembers };
}

/**
 * Infer the CPU subsystem to lift: the CPU part plus every ACTIVE (non-passive,
 * non-power) part transitively connected to it by a shared net. Growth passes
 * through ICs and stops at passives, so the port pins are the boundary.
 * Adjacency comes from the wires (parts have no terminals array).
 */
function inferSubsystem(parts, wires, cpuId) {
    const { find, key, netMembers } = buildNets(wires);
    const lifted = new Set([cpuId]);
    const queue = [cpuId];
    while (queue.length) {
        const cur = queue.shift();
        for (const members of netMembers.values()) {
            if (!members.some((m) => m.part === cur)) continue;
            for (const m of members) {
                if (lifted.has(m.part)) continue;
                const k = kindOf(parts, m.part);
                if (PASSIVE.has(k) || POWER.has(k)) continue; // stop at the cut
                lifted.add(m.part); queue.push(m.part);
            }
        }
    }
    return { lifted, find, key, netMembers };
}

/**
 * The 8086/8255 subsystem the substitution drops in, wired so extract8086Machine
 * yields a PPI at base 0x60 (register selects on A0/A1 → port A=0x60, B=0x61,
 * C=0x62, control=0x63, matching the blink ROM) and ROM over $E0000–$FFFFF
 * (covers the reset vector). Terminal names match the registered parts and the
 * extractor. `gndId`/`vccId` reuse the board's existing rails.
 */
function subsystem8086(gndId, vccId) {
    const parts = [
        { id: 'cpu86', kind: 'i8086', params: {}, x: 40, y: 40, terminals: i8086Terminals() },
        { id: 'ram86', kind: '62256', params: {}, x: 40, y: 200, terminals: memTerminals() },
        { id: 'rom86', kind: '28c256', params: {}, x: 40, y: 320, terminals: memTerminals() },
        { id: 'ppi86', kind: 'i8255', params: {}, x: 240, y: 200, terminals: i8255Terminals() },
        { id: 'decm', kind: '74hc138', params: {}, x: 240, y: 40, terminals: dec138Terminals() },
        { id: 'deci', kind: '74hc138', params: {}, x: 240, y: 120, terminals: dec138Terminals() },
        { id: 'inv86', kind: '74hc04', params: {}, x: 140, y: 120, terminals: inv04Terminals() },
    ];
    const w = (from, fromTerminal, to, toTerminal) => ({ from, fromTerminal, to, toTerminal });
    const wires = [];
    // CPU low address lines to RAM and ROM (A0..A14)
    for (let i = 0; i < 15; i++) { wires.push(w('cpu86', `a${i}`, 'ram86', `a${i}`), w('cpu86', `a${i}`, 'rom86', `a${i}`)); }
    // PPI register selects ride A0/A1
    wires.push(w('cpu86', 'a0', 'ppi86', 'a0'), w('cpu86', 'a1', 'ppi86', 'a1'));
    // Memory decoder: A=A17 B=A18 C=A19, G2A/G2B=GND, G1=M/IO (datasheet pins).
    wires.push(
        w(gndId, 'gnd', 'decm', 'g2ab'), w(gndId, 'gnd', 'decm', 'g2bb'), w('cpu86', 'mio', 'decm', 'g1'),
        w('cpu86', 'a17', 'decm', 'a'), w('cpu86', 'a18', 'decm', 'b'), w('cpu86', 'a19', 'decm', 'c'),
        w('decm', 'y0b', 'ram86', 'csb'),   // RAM $00000-$1FFFF
        w('decm', 'y7b', 'rom86', 'ceb'),   // ROM $E0000-$FFFFF (reset vector)
    );
    // I/O decoder: A=A5 B=A6 C=A7, G1 = ~M/IO, G2A/G2B=GND; y3 selects A7A6A5=011
    wires.push(
        w('cpu86', 'mio', 'inv86', '1a'), w('inv86', '1y', 'deci', 'g1'),
        w(gndId, 'gnd', 'deci', 'g2ab'), w(gndId, 'gnd', 'deci', 'g2bb'),
        w('cpu86', 'a5', 'deci', 'a'), w('cpu86', 'a6', 'deci', 'b'), w('cpu86', 'a7', 'deci', 'c'),
        w('deci', 'y3b', 'ppi86', 'csb'),   // PPI $60-$7F (base 0x60)
    );
    // Power rails to every new chip
    for (const id of ['cpu86', 'ram86', 'rom86', 'ppi86', 'decm', 'deci', 'inv86']) {
        wires.push(w(vccId, 'vcc', id, 'vcc'), w(gndId, 'gnd', id, 'gnd'));
    }
    return { parts, wires };
}

// Terminal lists mirror the registered parts (bw-board) / sidecars. Extraction
// reads wire terminal NAMES, not these arrays, but a complete part is honest.
function i8086Terminals() {
    const t = [];
    for (let i = 0; i < 20; i++) t.push(`a${i}`);
    for (let i = 0; i < 8; i++) t.push(`d${i}`);
    return [...t, 'mio', 'rdb', 'wrb', 'ale', 'clk', 'reset', 'ready', 'intr', 'nmi', 'intab', 'gnd', 'vcc'];
}
function i8255Terminals() {
    return ['pa3', 'pa2', 'pa1', 'pa0', 'rdb', 'csb', 'gnd', 'a1', 'a0', 'pc7', 'pc6', 'pc5', 'pc4', 'pc0',
        'pc1', 'pc2', 'pc3', 'pb0', 'pb1', 'pb2', 'pb3', 'pb4', 'pb5', 'pb6', 'pb7', 'vcc', 'd7', 'd6',
        'd5', 'd4', 'd3', 'd2', 'd1', 'd0', 'reset', 'wrb', 'pa7', 'pa6', 'pa5', 'pa4'];
}
function memTerminals() {
    const t = [];
    for (let i = 0; i < 15; i++) t.push(`a${i}`);
    for (let i = 0; i < 8; i++) t.push(`d${i}`);
    return [...t, 'csb', 'ceb', 'oeb', 'web', 'vcc', 'gnd'];
}
function dec138Terminals() { return ['a', 'b', 'c', 'g1', 'g2ab', 'g2bb', 'y0b', 'y1b', 'y2b', 'y3b', 'y4b', 'y5b', 'y6b', 'y7b', 'vcc', 'gnd']; }
function inv04Terminals() { return ['1a', '1y', '2a', '2y', '3a', '3y', '4y', '4a', '5y', '5a', '6y', '6a', 'vcc', 'gnd']; }

/**
 * Reseat a 6502 board onto an 8086/8255, preserving LED-net identity.
 *
 * @param {{parts: object[], wires: object[]}} circuit  the original board.
 * @param {object} opts
 * @param {string} opts.cpuId          the 6502 CPU part id to lift around.
 * @param {Array<{source: string, target: string}>} opts.pinMap  the pin
 *        declaration: each entry maps an ORIGINAL terminal ('via1.pb0') the
 *        program's logical pin drives to the NEW terminal ('ppi86.pb0') it
 *        drives after the swap. The transform re-terminates the SOURCE's net
 *        onto TARGET — net identity, not a name coincidence.
 * @returns {{parts: object[], wires: object[]}} the reseated board.
 */
export function reseatOnto8086(circuit, { cpuId, pinMap }) {
    const parts = circuit.parts;
    const wires = circuit.wires;
    const { lifted, find, key, netMembers } = inferSubsystem(parts, wires, cpuId);
    const kindById = (id) => kindOf(parts, id);

    // Reuse the board's existing power rails.
    const gnd = parts.find((p) => (p.kind || p.type) === 'gnd');
    const vcc = parts.find((p) => (p.kind || p.type) === 'vcc');
    if (!gnd || !vcc) throw new Error('reseat: board has no vcc/gnd rail to reuse');

    // For each declared logical pin, find the net its SOURCE terminal is on and
    // record the SURVIVING (kept, non-power) endpoints to re-terminate.
    const reterminations = [];
    for (const { source, target } of pinMap) {
        const dot = source.lastIndexOf('.');
        const srcPart = source.slice(0, dot), srcTerm = source.slice(dot + 1);
        if (!lifted.has(srcPart)) throw new Error(`reseat: pinMap source ${source} is not on the lifted subsystem`);
        const root = find(key(srcPart, srcTerm));
        const survivors = (netMembers.get(root) || []).filter(
            (m) => !lifted.has(m.part) && !POWER.has(kindById(m.part)),
        );
        if (survivors.length === 0) throw new Error(`reseat: net of ${source} has no surviving endpoint to re-terminate`);
        reterminations.push({ target, survivors });
    }

    // Drop the lifted parts and every wire touching them.
    const keptParts = parts.filter((p) => !lifted.has(p.id)).map((p) => ({ ...p }));
    const keptWires = wires.filter((w) => {
        const ef = wireEndpoint(w, 'from'), et = wireEndpoint(w, 'to');
        return ef && et && !lifted.has(ef.part) && !lifted.has(et.part);
    }).map((w) => ({ ...w }));

    // Add the 8086/8255 subsystem.
    const sub = subsystem8086(gnd.id, vcc.id);
    const outParts = [...keptParts, ...sub.parts];
    const outWires = [...keptWires, ...sub.wires];

    // Re-terminate: the SAME LED net, now driven by the new 8255 pin.
    for (const { target, survivors } of reterminations) {
        const dot = target.lastIndexOf('.');
        const tgtPart = target.slice(0, dot), tgtTerm = target.slice(dot + 1);
        for (const s of survivors) outWires.push({ from: tgtPart, fromTerminal: tgtTerm, to: s.part, toTerminal: s.terminal });
    }

    return {
        ...circuit,
        _title: (circuit._title ? circuit._title + ' ' : '') + '(reseated → 8086)',
        parts: outParts,
        wires: outWires,
    };
}

export default reseatOnto8086;

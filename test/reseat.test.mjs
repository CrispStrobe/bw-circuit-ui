// The reseat substitution (ROADMAP §3.8.3) — the bw-circuit-ui half. It lifts a
// 6502 board's CPU subsystem and drops in an 8086/8255, preserving the LED
// nets' identity. This tests the transform on its OWN terms (structure + net
// identity); that the reseated board RUNS the same program is the gate's job,
// in bw-board (it consumes the artifacts this transform emits).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { reseatOnto8086 } from '../src/model/reseat.js';

const here = dirname(fileURLToPath(import.meta.url));
const gallery = join(here, '..', 'gallery');
const original = JSON.parse(readFileSync(join(gallery, 'e4-via-blink.json'), 'utf8'));
const portMap = (port) => Array.from({ length: 8 }, (_, i) => ({ source: `via1.pb${i}`, target: `ppi86.${port}${i}` }));
const reseated = reseatOnto8086(original, { cpuId: 'cpu', pinMap: portMap('pb') });

const kinds = (c) => c.parts.map((p) => p.kind || p.type);
const netOf = (c, part, term) => {
    // trivial union-find just for the test's identity checks
    const parent = new Map();
    const f = (x) => { while (parent.has(x) && parent.get(x) !== x) x = parent.get(x); return x; };
    const k = (p, t) => `${p}.${t}`;
    for (const w of c.wires) { const a = k(w.from, w.fromTerminal), b = k(w.to, w.toTerminal); if (!parent.has(a)) parent.set(a, a); if (!parent.has(b)) parent.set(b, b); parent.set(f(a), f(b)); }
    return f(k(part, term));
};
const membersOf = (c, root) => {
    const parent = new Map();
    const f = (x) => { while (parent.has(x) && parent.get(x) !== x) x = parent.get(x); return x; };
    const k = (p, t) => `${p}.${t}`;
    const eps = [];
    for (const w of c.wires) { const a = k(w.from, w.fromTerminal), b = k(w.to, w.toTerminal); if (!parent.has(a)) parent.set(a, a); if (!parent.has(b)) parent.set(b, b); parent.set(f(a), f(b)); eps.push([w.from, w.fromTerminal, a], [w.to, w.toTerminal, b]); }
    return eps.filter(([, , kk]) => f(kk) === root).map(([p, t]) => `${p}.${t}`);
};

test('the 6502 CPU subsystem is lifted: CPU, VIA, ROM, decoder gone', () => {
    for (const gone of ['cpu', 'via1', 'rom', 'nand1']) {
        assert.ok(!reseated.parts.some((p) => p.id === gone), `${gone} lifted`);
    }
    assert.ok(!kinds(reseated).includes('w65c02'), 'no 6502');
    assert.ok(!kinds(reseated).includes('w65c22'), 'no VIA');
});

test('the LEDs, resistors and rails STAY (they are the observable, not the subsystem)', () => {
    for (let i = 0; i < 8; i++) {
        assert.ok(reseated.parts.some((p) => p.id === `led${i}`), `led${i} kept`);
        assert.ok(reseated.parts.some((p) => p.id === `rl${i}`), `rl${i} kept`);
    }
    assert.ok(reseated.parts.some((p) => (p.kind || p.type) === 'vcc'), 'vcc rail kept');
    assert.ok(reseated.parts.some((p) => (p.kind || p.type) === 'gnd'), 'gnd rail kept');
});

test('the 8086/8255 subsystem is dropped in', () => {
    const k = kinds(reseated);
    for (const need of ['i8086', 'i8255', '62256', '28c256', '74hc138', '74hc04']) {
        assert.ok(k.includes(need), `has ${need}`);
    }
});

test('NET IDENTITY: each LED net is the SAME net, now driven by the 8255 port-B pin', () => {
    for (let i = 0; i < 8; i++) {
        // In the ORIGINAL, led i's driven net is {via1.pb<i>, rl<i>.a}.
        const origMembers = membersOf(original, netOf(original, 'via1', `pb${i}`));
        assert.ok(origMembers.includes(`rl${i}.a`), `original: via1.pb${i} shares a net with rl${i}.a`);
        // After the swap, that SAME net (identified by its surviving endpoint
        // rl<i>.a) is driven by ppi86.pb<i> — not by a coincidental name, but
        // because the pin declaration re-terminated THIS net onto that pin.
        const newMembers = membersOf(reseated, netOf(reseated, `rl${i}`, 'a'));
        assert.ok(newMembers.includes(`ppi86.pb${i}`), `reseated: rl${i}.a is driven by ppi86.pb${i}`);
        // The kept side of the net (resistor → LED → ground) is untouched.
        assert.ok(reseated.wires.some((w) => (w.from === `rl${i}` && w.to === `led${i}`) || (w.from === `led${i}` && w.to === `rl${i}`)),
            `rl${i} → led${i} chain intact`);
    }
});

test('a WRONG pin declaration lands the LED nets on PORT A (the gate must catch this)', () => {
    const wrong = reseatOnto8086(original, { cpuId: 'cpu', pinMap: portMap('pa') });
    // rl0.a is now on ppi86.pa0, NOT pb0 — the program drives port B, so nothing lights.
    const rl0net = membersOf(wrong, netOf(wrong, 'rl0', 'a'));
    assert.ok(rl0net.includes('ppi86.pa0'), 'wrong reseat wires LEDs to port A');
    assert.ok(!rl0net.includes('ppi86.pb0'), 'and NOT to port B');
});

test('golden: the committed artifacts match a fresh transform (drift guard)', () => {
    const freshCorrect = JSON.stringify(reseatOnto8086(original, { cpuId: 'cpu', pinMap: portMap('pb') }), null, 2) + '\n';
    const committed = readFileSync(join(gallery, 'reseat', 'e4-reseated-8086.json'), 'utf8');
    assert.equal(freshCorrect, committed, 'gallery/reseat/e4-reseated-8086.json is stale — rerun scripts/gen-reseated-8086.mjs');
});

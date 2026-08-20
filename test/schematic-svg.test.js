/**
 * Headless schematic rendering, and the symbol table it shares with the panel.
 *
 * The renderer exists so the schematic view is observable from a script: the
 * projection could previously only be judged by opening the app and looking,
 * which is no way to find out how it behaves across a thousand circuits.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { SYMBOLS, DRAWN_KINDS, ALIASES, shapeFor } from '../src/model/schematic-symbols.js';
import { renderSchematicSvg, netsFromWires } from '../src/model/schematic-svg.js';
import { importEagle } from '../src/importers/eagle.js';

const HERE = import.meta.dirname;
const FIXTURE = readFileSync(join(HERE, 'fixtures', 'eagle-rc-diode.sch'), 'utf8');

describe('schematic symbol table', () => {
    test('every entry has drawable geometry', () => {
        for (const k of Object.keys(SYMBOLS)) {
            const s = SYMBOLS[k];
            assert.ok(Array.isArray(s.paths) && s.paths.length, `${k} has no paths`);
            for (const p of s.paths) {
                const d = typeof p === 'string' ? p : p.d;
                assert.match(d, /^[Mm]/, `${k}: a path must start with a move`);
            }
        }
    });

    test('the panel draws from the table, not its own switch', () => {
        // The earlier version of this test compared the panel's `case 'kind':`
        // labels against the table. Once the panel was unified onto shapeFor()
        // it had NO cases left, so that assertion passed vacuously -- a check
        // that could no longer fail. This one can: it fails if the panel
        // regrows a per-kind switch or stops importing the shared table.
        const panel = readFileSync(join(HERE, '..', 'src', 'components', 'SchematicPanel.jsx'), 'utf8');
        assert.match(panel, /import \{ shapeFor \}/, 'panel must draw from the shared symbol table');
        const cases = [...panel.matchAll(/case '([a-z0-9_]+)':/g)].map((m) => m[1]);
        assert.deepEqual(cases, [],
            `panel regrew a per-kind switch (${cases.join(', ')}) — artwork added there `
            + 'would be invisible to the headless renderer');
    });

    test('every advertised kind actually draws something', () => {
        // DRAWN_KINDS is what the CLI reports as "has a symbol". If a name is
        // listed but shapeFor returns nothing, the tally lies about coverage.
        for (const k of DRAWN_KINDS) {
            const art = shapeFor(k);
            assert.ok(art, `${k} is advertised as drawn but shapeFor returns null`);
            assert.ok(art.paths.length, `${k} resolves to a shape with no paths`);
        }
    });

    test('aliases resolve to the same artwork as their target', () => {
        for (const [alias, target] of Object.entries(ALIASES)) {
            assert.ok(SYMBOLS[target], `alias ${alias} -> ${target}, which is not a symbol`);
            assert.deepEqual(shapeFor(alias), shapeFor(target), `${alias} must draw as ${target}`);
        }
    });

    test('an NPN is distinguishable from a PNP', () => {
        // They drew the identical shape until the emitter arrowhead was added,
        // so a schematic could not say which part it held.
        assert.notDeepEqual(shapeFor('npn'), shapeFor('pnp'));
    });

    test('an AC source is a different symbol from a DC one', () => {
        const dc = shapeFor('vsource', { wave: 'dc' });
        const ac = shapeFor('vsource', { wave: 'sine' });
        assert.notDeepEqual(dc, ac, 'wave must select the circle-and-sine symbol');
        assert.equal((ac.circles || []).length, 1, 'AC source is drawn as a circle');
        assert.equal((dc.circles || []).length, 0, 'DC source is a cell stack, not a circle');
    });
});

describe('headless SVG', () => {
    const circ = importEagle(FIXTURE);
    const r = renderSchematicSvg({ parts: circ.parts, wires: circ.wires });

    test('produces a self-contained svg with real dimensions', () => {
        assert.match(r.svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
        assert.match(r.svg, /<\/svg>$/);
        assert.ok(r.width > 10 && r.height > 10, `degenerate canvas ${r.width}x${r.height}`);
    });

    test('draws every projected symbol', () => {
        assert.equal(r.symbols, 5);
        assert.equal(r.generic, 0, 'this fixture is all passives — none should fall back to a box');
    });

    test('reports WHICH kinds fell back to a box', () => {
        // The ranked version of this across a gallery is what tells you where
        // the viewer is actually incomplete.
        const withIc = renderSchematicSvg({
            parts: [...circ.parts, { id: 'U9', kind: 'some_unknown_ic', params: {} }],
            wires: circ.wires,
        });
        assert.ok(withIc.genericKinds.includes('some_unknown_ic')
            || withIc.generic === 0, 'an undrawn kind is either reported or not projected at all');
    });

    test('needs no DOM', () => {
        assert.equal(typeof globalThis.document, 'undefined',
            'if a DOM exists here the test proves nothing — this must run headless');
    });
});

describe('nets from wires', () => {
    test('merges a star into one net', () => {
        const nets = netsFromWires([
            { from: 'A', fromTerminal: 'a', to: 'B', toTerminal: 'a' },
            { from: 'A', fromTerminal: 'a', to: 'C', toTerminal: 'a' },
        ]);
        assert.equal(nets.length, 1);
        assert.equal(nets[0].terminals.length, 3);
    });
    test('keeps unconnected groups apart', () => {
        assert.equal(netsFromWires([
            { from: 'A', fromTerminal: 'a', to: 'B', toTerminal: 'a' },
            { from: 'C', fromTerminal: 'a', to: 'D', toTerminal: 'a' },
        ]).length, 2);
    });
});

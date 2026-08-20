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
import { SYMBOLS, DRAWN_KINDS } from '../src/model/schematic-symbols.js';
import { renderSchematicSvg, netsFromWires } from '../src/model/schematic-svg.js';
import { importEagle } from '../src/importers/eagle.js';

const HERE = import.meta.dirname;
const FIXTURE = readFileSync(join(HERE, 'fixtures', 'eagle-rc-diode.sch'), 'utf8');

describe('schematic symbol table', () => {
    test('every entry has drawable geometry', () => {
        for (const k of DRAWN_KINDS) {
            const s = SYMBOLS[k];
            assert.ok(Array.isArray(s.paths) && s.paths.length, `${k} has no paths`);
            for (const d of s.paths) assert.match(d, /^[Mm]/, `${k}: a path must start with a move`);
        }
    });

    test('the panel and the table agree on which kinds have artwork', () => {
        // Two renderers over one description. If SchematicPanel gains a case
        // the table does not have, the CLI silently draws a box instead —
        // the drift this file exists to make loud.
        const panel = readFileSync(join(HERE, '..', 'src', 'components', 'SchematicPanel.jsx'), 'utf8');
        const cases = [...panel.matchAll(/case '([a-z0-9_]+)':/g)].map((m) => m[1]);
        const missing = [...new Set(cases)].filter((k) => !SYMBOLS[k]);
        assert.deepEqual(missing, [],
            `SchematicPanel draws these but schematic-symbols.js does not: ${missing.join(', ')}`);
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

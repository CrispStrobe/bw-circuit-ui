#!/usr/bin/env node
/**
 * Render a circuit.json to a schematic SVG through the SAME projection the
 * panel uses — no DOM, no interaction layer, byte-deterministic.
 *
 * The point is that a change to the drawing becomes a diff someone can look
 * at, instead of a claim someone has to argue with. docs/schematic-baselines/
 * holds the reviewed output for the circuits the audit named as worst, and
 * test/schematic-baselines.test.js fails when any of them moves.
 *
 * Usage:
 *   node scripts/render-schematic.mjs --circuit <file.json> [--out DIR] [--name NAME.svg]
 *   node scripts/render-schematic.mjs --baselines            # rewrite every baseline
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
await import(path.join(ROOT, 'test', '_setup.js'));
const { Circuit, resetIds } = await import(path.join(ROOT, 'src', 'model', 'circuit.js'));
const { renderSchematicSvg } = await import(path.join(ROOT, 'src', 'model', 'schematic-svg.js'));

/**
 * The circuits docs/SCHEMATIC-AUDIT.md names as the ten worst — every one of
 * them drew a conductor through a foreign pin before the router learned to
 * treat pins as obstacles. Baselining exactly these means the regression that
 * matters is the one that shows up first.
 */
export const BASELINE_CASES = [
    ['46-port-overcurrent/circuit-flat.arduino-mega.json', '46-port-overcurrent-flat.arduino-mega.svg'],
    ['50-7seg-chase/circuit-flat.stc15f2k60s2.json', '50-7seg-chase-flat.stc15f2k60s2.svg'],
    ['50-7seg-chase/circuit-flat.stc89c52rc.json', '50-7seg-chase-flat.stc89c52rc.svg'],
    ['50-7seg-chase/circuit.stc15f2k60s2.json', '50-7seg-chase.stc15f2k60s2.svg'],
    ['50-7seg-chase/circuit.stc89c52rc.json', '50-7seg-chase.stc89c52rc.svg'],
    ['46-port-overcurrent/circuit-flat.attiny88.json', '46-port-overcurrent-flat.attiny88.svg'],
    ['46-port-overcurrent/circuit.attiny88.json', '46-port-overcurrent.attiny88.svg'],
    ['46-port-overcurrent/circuit-flat.arduino-nano.json', '46-port-overcurrent-flat.arduino-nano.svg'],
    ['46-port-overcurrent/circuit-flat.arduino-uno.json', '46-port-overcurrent-flat.arduino-uno.svg'],
    ['46-port-overcurrent/circuit-flat.atmega168p.json', '46-port-overcurrent-flat.atmega168p.svg'],
];

export const BASELINE_DIR = path.join(ROOT, 'docs', 'schematic-baselines');

/** Render one circuit file to an SVG string, deterministically. */
export function renderCircuitFile (file) {
    // resetIds() first: generated part/wire ids leak into the output otherwise
    // and every render differs from the last for no reason anyone can see.
    resetIds();
    const loaded = Circuit.fromJSON(JSON.parse(readFileSync(file, 'utf-8')));
    const { svg } = renderSchematicSvg({
        parts: loaded.parts,
        wires: loaded.wires,
        nets: loaded.resolvedNets || [],
    });
    return svg.endsWith('\n') ? svg : svg + '\n';
}

const args = process.argv.slice(2);
const value = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };

if (import.meta.url === `file://${process.argv[1]}`) {
    if (args.includes('--baselines')) {
        const examples = process.env.EXAMPLES_DIR;
        if (!examples) { console.error('set EXAMPLES_DIR'); process.exit(2); }
        mkdirSync(BASELINE_DIR, { recursive: true });
        for (const [rel, name] of BASELINE_CASES) {
            writeFileSync(path.join(BASELINE_DIR, name), renderCircuitFile(path.join(examples, rel)));
            console.log('wrote', name);
        }
    } else {
        const circuit = value('--circuit');
        if (!circuit) { console.error('usage: --circuit <file.json> [--out DIR] [--name N.svg]'); process.exit(2); }
        const svg = renderCircuitFile(circuit);
        const out = value('--out');
        if (out) {
            mkdirSync(out, { recursive: true });
            const name = value('--name') || path.basename(circuit).replace(/\.json$/, '.svg');
            writeFileSync(path.join(out, name), svg);
            console.log('wrote', path.join(out, name));
        } else {
            process.stdout.write(svg);
        }
    }
}

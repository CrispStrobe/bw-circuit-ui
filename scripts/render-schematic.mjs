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
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
await import(path.join(ROOT, 'test', '_setup.js'));
const { Circuit, resetIds } = await import(path.join(ROOT, 'src', 'model', 'circuit.js'));
const { renderSchematicSvg } = await import(path.join(ROOT, 'src', 'model', 'schematic-svg.js'));

/**
 * The circuits docs/SCHEMATIC-AUDIT.md names as worst, in three named groups
 * because there have now been two audit passes and one exemplar class.
 *
 * CLASS_I_WORST — the first pass's ten worst. Every one drew a conductor
 * through a foreign pin before the router treated pins as obstacles.
 *
 * CONTACT_WORST — the second pass's ten worst, by L+M+N (a net ending on
 * another net, sharing its corner, or running down the same line). These are
 * different circuits: the class-I defect lived in dense DIP drawings, and this
 * one lives wherever obstacleRoute sent several detours round one column.
 *
 * ART_FIT_WORST — the third pass's ten worst, by class Q (a drawn pin the
 * symbol's OWN artwork does not reach). Different circuits again, and for a
 * different reason: this defect follows the PART, not the routing, so it
 * lives wherever a multi-terminal kind has bespoke two-lead artwork —
 * seven-segment displays, op-amps, RGB LEDs, relays. Ranks 4-10 are a tie at
 * 8 across near-identical `disp-sevenseg` MCU variants; they are kept because
 * the ranking is the ranking, and the tie is stated rather than smoothed.
 *
 * SYMBOL_CONTACT_EXEMPLAR — class S, all 7 of which are one shape:
 * `74-ammeter` draws a potentiometer wired as a rheostat, so its `b` lead
 * ends at (300,163) with no pin, and another net's wire ended on that point.
 *
 * MISSING_PIN_EXEMPLAR — class O. Ten of these would be ten copies of one
 * drawing: EVERY class-O circuit has the same shape, a seated MCU whose
 * declared terminal list omits the power pins its seat.leadMap wires up, so
 * the chip drew with no supply. One representative is baselined and the
 * corpus gate carries the other 364.
 */
export const CLASS_I_WORST = [
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

export const CONTACT_WORST = [
    ['arduino-05-arrays/circuit-flat.pico.json', 'arduino-05-arrays-flat.pico.svg'],
    ['arduino-05-arrays/circuit.pico.json', 'arduino-05-arrays.pico.svg'],
    ['arduino-05-for-loop/circuit-flat.pico.json', 'arduino-05-for-loop-flat.pico.svg'],
    ['arduino-05-for-loop/circuit.pico.json', 'arduino-05-for-loop.pico.svg'],
    ['arduino-05-switch-case-2/circuit-flat.pico.json', 'arduino-05-switch-case-2-flat.pico.svg'],
    ['arduino-05-switch-case-2/circuit.pico.json', 'arduino-05-switch-case-2.pico.svg'],
    ['arduino-05-arrays/circuit-flat.json', 'arduino-05-arrays-flat.svg'],
    ['arduino-05-arrays/circuit.arduino-mega.json', 'arduino-05-arrays.arduino-mega.svg'],
    ['arduino-05-arrays/circuit.atmega168p.json', 'arduino-05-arrays.atmega168p.svg'],
    ['arduino-05-arrays/circuit.json', 'arduino-05-arrays.svg'],
];

export const ART_FIT_WORST = [
    ['78-a2-calculator/circuit.json', '78-a2-calculator.svg'],
    ['76-multimeter/circuit-flat.json', '76-multimeter-flat.svg'],
    ['76-multimeter/circuit.json', '76-multimeter.svg'],
    ['disp-sevenseg/circuit.arduino-mega.json', 'disp-sevenseg.arduino-mega.svg'],
    ['disp-sevenseg/circuit.arduino-nano.json', 'disp-sevenseg.arduino-nano.svg'],
    ['disp-sevenseg/circuit.arduino-uno.json', 'disp-sevenseg.arduino-uno.svg'],
    ['disp-sevenseg/circuit.atmega168p.json', 'disp-sevenseg.atmega168p.svg'],
    ['disp-sevenseg/circuit.attiny88.json', 'disp-sevenseg.attiny88.svg'],
    ['disp-sevenseg/circuit.json', 'disp-sevenseg.svg'],
    ['disp-sevenseg/circuit.pico.json', 'disp-sevenseg.pico.svg'],
];

export const SYMBOL_CONTACT_EXEMPLAR = [
    ['74-ammeter/circuit.json', '74-ammeter.svg'],
];

export const MISSING_PIN_EXEMPLAR = [
    ['01-blink/circuit.attiny88.json', '01-blink.attiny88.svg'],
];

export const BASELINE_CASES = [...CLASS_I_WORST, ...CONTACT_WORST, ...ART_FIT_WORST,
    ...SYMBOL_CONTACT_EXEMPLAR, ...MISSING_PIN_EXEMPLAR];

export const BASELINE_DIR = path.join(ROOT, 'docs', 'schematic-baselines');

/**
 * The corpus each baseline was reviewed against.
 *
 * Baselines are a picture of ANOTHER repository's tree, and that tree moves.
 * `78-a2-calculator/circuit.json` was swapped, swapped back and re-baselined
 * three times on 2026-08-25 alone. Without this file the gate can only say
 * "X.svg changed", which lands on whoever pushes next rather than on whoever
 * moved the corpus — and reads like a rendering regression when it is not one.
 *
 * A per-file CONTENT hash, not just the corpus git sha: the sha says the tree
 * moved, the hashes say whether it moved anything THESE baselines depend on,
 * and they still work where the corpus is a copy, a tarball or a shallow
 * clone with no useful history.
 */
export const CORPUS_STAMP = path.join(BASELINE_DIR, 'CORPUS.json');

/** sha256 of a file's bytes, or null if it is not there. */
export function sourceHash (file) {
    if (!existsSync(file)) return null;
    return createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 16);
}

/** The corpus's git sha, when it happens to be a checkout. Informational. */
export function corpusSha (examples) {
    try {
        return execFileSync('git', ['-C', examples, 'rev-parse', 'HEAD'],
            { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch { return null; }
}

/** Read the recorded stamp, or null when there is none yet. */
export function readCorpusStamp () {
    try { return JSON.parse(readFileSync(CORPUS_STAMP, 'utf-8')); } catch { return null; }
}

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
        const sources = {};
        for (const [rel, name] of BASELINE_CASES) {
            writeFileSync(path.join(BASELINE_DIR, name), renderCircuitFile(path.join(examples, rel)));
            sources[rel] = sourceHash(path.join(examples, rel));
            console.log('wrote', name);
        }
        // Stamp what they were reviewed against, in the same act that writes
        // them — a stamp written separately is a stamp that drifts.
        const stamp = { corpusSha: corpusSha(examples), sources };
        writeFileSync(CORPUS_STAMP, `${JSON.stringify(stamp, null, 2)}\n`);
        console.log('wrote CORPUS.json', stamp.corpusSha
            ? `(corpus ${stamp.corpusSha.slice(0, 7)}, ${Object.keys(sources).length} sources)`
            : `(${Object.keys(sources).length} sources; corpus is not a git checkout)`);
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

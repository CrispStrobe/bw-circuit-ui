/**
 * gen-reseated-8086.mjs — emit the reseated-onto-8086 circuits the reseat gate
 * consumes (ROADMAP §3.8.3). Runs the SUBSTITUTION (src/model/reseat.js) on the
 * shipped e4-via-blink 6502 board and writes two gallery artifacts:
 *
 *   gallery/reseat/e4-reseated-8086.json           — LED nets re-terminated onto the
 *       8255's PORT B (the port the program drives). The gate proves this runs
 *       the same walking bit as the 6502 original.
 *   gallery/reseat/e4-reseated-8086-wrongport.json — the SAME transform but the pin
 *       declaration lands the LED nets on PORT A. The program still drives port
 *       B, so nothing lights: the gate must go RED on this. It is the §5
 *       invariant ("a port mismatch MUST fail") made concrete — a board that
 *       compiles, runs, and lights nothing.
 *
 *   node scripts/gen-reseated-8086.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { reseatOnto8086 } from '../src/model/reseat.js';

const here = dirname(fileURLToPath(import.meta.url));
const gallery = join(here, '..', 'gallery');

const original = JSON.parse(readFileSync(join(gallery, 'e4-via-blink.json'), 'utf8'));

// The pin declaration is the authority (contract #5): each logical LED bit the
// program drives maps from its ORIGINAL VIA terminal to a NEW 8255 terminal.
const portMap = (port) => Array.from({ length: 8 }, (_, i) => ({ source: `via1.pb${i}`, target: `ppi86.${port}${i}` }));

const correct = reseatOnto8086(original, { cpuId: 'cpu', pinMap: portMap('pb') });
const wrong = reseatOnto8086(original, { cpuId: 'cpu', pinMap: portMap('pa') });
wrong._title = (original._title || '') + ' (reseated → 8086, LEDs mis-wired to PORT A)';

writeFileSync(join(gallery, 'reseat', 'e4-reseated-8086.json'), JSON.stringify(correct, null, 2) + '\n');
writeFileSync(join(gallery, 'reseat', 'e4-reseated-8086-wrongport.json'), JSON.stringify(wrong, null, 2) + '\n');
console.log('wrote gallery/reseat/e4-reseated-8086.json and gallery/reseat/e4-reseated-8086-wrongport.json');

#!/usr/bin/env node
/**
 * The 2x2: how much of each routing rule's corpus evidence is masked by the
 * other one.
 *
 * `segmentHitsForeignPin` (class I, first audit pass) and the symbol-lead
 * registration (class S, third pass) forbid nearly the same geometry from
 * opposite sides. A pin sits at the END of its own symbol lead, so a route
 * that runs through a foreign pin almost always also touches that pin's lead,
 * and vice versa.
 *
 * That matters because it makes each rule's REVERT MEASUREMENT look tiny while
 * the other rule is in place, and a revert measurement is how this codebase
 * decides whether a gate is load-bearing:
 *
 *              lead rule ON        lead rule OFF
 *   pin ON     I 0    S 0          I 0    S 7           <- shipped is top-left
 *   pin OFF    I 18   S 14         I 801  S 585
 *
 * Read the diagonal: reverting the pin rule alone breaks 18 circuits, and
 * reverting the lead rule alone breaks 7. Either number invites the
 * conclusion that the rule is nearly dead code. Reverting BOTH breaks 801.
 *
 * Neither is redundant — each leaves a remainder the other does not catch (18
 * and 7 respectively, and they are different circuits) — but neither can be
 * judged by its own revert while the other stands. This script exists so that
 * claim is reproducible rather than remembered.
 *
 * Deliberately NOT wired into `npm test`: it reverts source, and four corpus
 * passes take about three minutes. Same standing as
 * scripts/easyeda-independent-read.mjs.
 *
 * IT REFUSES TO RUN ON A DIRTY WORKING TREE, and restores through `git
 * checkout` rather than through a string it read at start-up. The first
 * version did the latter and was silently WRONG: an earlier run of it had
 * been killed by a timeout mid-measurement, leaving the source reverted, so
 * the next run read the REVERTED file as its baseline and reported the
 * shipped configuration as `I 18 / 32`. Every cell was shifted by one and
 * nothing said so. A tool that edits source and then measures it must treat
 * "the tree is where I think it is" as a precondition to CHECK, not to
 * assume — the same failure this document keeps finding in gates, arriving in
 * the instrument that measures them.
 *
 * Usage:
 *   EXAMPLES_DIR=<sb3-creator>/examples node scripts/rule-isolation.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const SOURCE = path.join(ROOT, 'src', 'model', 'schematic-projection.js');
const AUDIT = path.join(here, 'schematic-audit.mjs');

const PIN_RULE = {
    name: 'segmentHitsForeignPin',
    find: '  const segmentHitsForeignPin = (a, b, netId) => {',
    replace: '  const segmentHitsForeignPin = (a, b, netId) => { return false;\n'
        + '  // eslint-disable-next-line no-unreachable',
};
const LEAD_RULE = {
    name: 'symbol-lead registration',
    find: '  for (const s of symbols) {\n'
        + '    for (const [a, b, netId] of symbolLeads(s)) registerConductor(a, b, netId);\n'
        + '  }',
    replace: '  // reverted by scripts/rule-isolation.mjs',
};

/** Fail unless the source is exactly what git has committed. */
function requireCleanSource () {
    const dirty = execFileSync('git', ['status', '--porcelain', '--', SOURCE],
        { cwd: ROOT, encoding: 'utf-8' }).trim();
    if (dirty) {
        throw new Error(`${SOURCE} has uncommitted changes:\n  ${dirty}\n`
            + 'This script measures a tree by editing it, so it must start from a known one. '
            + 'If a previous run was interrupted the source may still be reverted, and '
            + 'measuring from there silently shifts every cell. Commit or restore first.');
    }
}

/** Apply the named reverts to the source, run the audit, restore, return counts. */
function measure (reverts) {
    requireCleanSource();
    const original = readFileSync(SOURCE, 'utf-8');
    try {
        let text = original;
        for (const r of reverts) {
            if (!text.includes(r.find)) {
                throw new Error(`cannot revert ${r.name}: its source no longer matches. This `
                    + 'script edits source by literal, so a refactor breaks it LOUDLY rather '
                    + 'than silently measuring an unreverted tree.');
            }
            text = text.replace(r.find, r.replace);
        }
        writeFileSync(SOURCE, text);
        const out = execFileSync(process.execPath, [AUDIT], {
            encoding: 'utf-8', env: process.env, maxBuffer: 64 * 1024 * 1024,
        });
        const grab = (letter) => {
            const m = new RegExp(`^${letter} [^\\n]*?(\\d+) / (\\d+) circuits\\s+(\\d+) occurrences`, 'm').exec(out);
            return m ? { circuits: +m[1], occurrences: +m[3], denominator: +m[2] } : null;
        };
        return { I: grab('I'), S: grab('S') };
    } finally {
        // Restore from git, not from `original`: if this process is killed
        // between the write and here, the NEXT run must still find a clean
        // tree, and `git checkout` is the only restore that is true
        // regardless of what this process managed to read.
        try {
            execFileSync('git', ['checkout', '--', SOURCE], { cwd: ROOT });
        } catch {
            writeFileSync(SOURCE, original);   // not a git checkout: fall back
        }
    }
}

if (!process.env.EXAMPLES_DIR) {
    console.error('set EXAMPLES_DIR to a sb3-creator examples directory');
    process.exit(2);
}

const cells = [
    ['pin ON   lead ON  (shipped)', []],
    ['pin ON   lead OFF', [LEAD_RULE]],
    ['pin OFF  lead ON', [PIN_RULE]],
    ['pin OFF  lead OFF', [PIN_RULE, LEAD_RULE]],
];
const rows = [];
for (const [label, reverts] of cells) {
    process.stderr.write(`measuring ${label} ...\n`);
    const r = measure(reverts);
    rows.push([label, r]);
    console.log(`${label.padEnd(30)} `
        + `I ${String(r.I?.circuits ?? '?').padStart(4)} / ${String(r.I?.occurrences ?? '?').padStart(4)}   `
        + `S ${String(r.S?.circuits ?? '?').padStart(4)} / ${String(r.S?.occurrences ?? '?').padStart(4)}`);
}

const both = rows[3][1];
const pinOnly = rows[2][1];
const leadOnly = rows[1][1];
console.log('');
console.log(`Reverting the pin rule alone shows ${pinOnly.I.circuits} class-I circuits.`);
console.log(`Reverting the lead rule alone shows ${leadOnly.S.circuits} class-S circuits.`);
console.log(`Reverting BOTH shows ${both.I.circuits} class-I and ${both.S.circuits} class-S.`);
console.log('Neither rule may be judged by its own revert while the other stands.');

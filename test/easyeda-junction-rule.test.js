/**
 * OUR NET SOLVER IS MORE PERMISSIVE THAN EASYEDA'S.
 *
 * `kicad-common.js`'s NetSolver folds in a T — a registered point (a wire
 * endpoint, a pin, a label anchor) sitting on another segment's span — because
 * that is KiCad's rule: eeschema drops a junction dot at a T itself, so
 * reading one as connected reads the file correctly.
 *
 * EasyEDA does not imply one. A T with no `J` shape on it is a CROSSING on the
 * board and a CONNECTION here, so we can read a file as joined that is
 * separated in the tool that wrote it. That is an import defect, not a
 * curiosity: the circuit the learner sees is not the circuit the author drew.
 *
 * It is the same distinction the schematic viewer's corpus gate calls class G,
 * arriving from the other side. There we must not DRAW a branch without a dot;
 * here we must not READ one. Both are the thing a schematic exists to
 * distinguish — a junction and a crossing mean opposite things.
 *
 * The importer REPORTS it rather than acting on it. Dropping those unions
 * would lose connections wherever the author's tool did imply them, and this
 * importer prefers to lose nothing silently (see its bus note).
 *
 * === What this gate measures, and on what ===
 *
 * 1. A vendor-dialect fixture, its geometry checked BY HAND against the tilde
 *    shapes rather than against our own reading: `easyeda-rc-divider.json`
 *    carries three Ts and two `J` dots, so exactly one T is undotted.
 * 2. The whole shipped corpus, round-tripped through OUR OWN EasyEDA
 *    exporter — which is what the app produces, not a literal anyone typed.
 *    The exporter claims its routing is "safe by construction" under the
 *    permissive rule; this measures it under the STRICTER one it was not
 *    written against. 0 of 2,098.
 * 3. A mutation on app-produced geometry: move one exported wire's endpoint
 *    onto another wire's span and the warning must fire. A count that cannot
 *    go up is not a measurement.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './_setup.js';
import { importEasyEda } from '../src/importers/easyeda.js';
import { toEasyEdaSchematic } from '../src/model/exporters/easyeda-schematic.js';
import { Circuit, resetIds } from '../src/model/circuit.js';
import { discover } from '../scripts/schematic-audit.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const TEE = /^(\d+) T-joint\(s\) without a junction/;

/** The warning's count, or 0 when it does not fire. */
function undottedTees (result) {
  const w = (result.warnings || []).find((x) => TEE.test(x));
  return w ? Number(TEE.exec(w)[1]) : 0;
}

describe('EasyEDA junction rule: a T is not a connection there', () => {
  test('the rc-divider fixture: three Ts, two dots, one reported', () => {
    const text = readFileSync(path.join(here, 'fixtures', 'easyeda-rc-divider.json'), 'utf-8');
    // Checked by hand from the tilde shapes, not from our own solver:
    //   W~100 -220 100 -260   is a vertical span x=100, y=-220..-260
    //   W~300 -220 300 -240 100 -240   ENDS at (100,-240), strictly inside it
    //   J~100~-160  and  J~100~-220    are the only two junction dots
    // so (100,-240) is a T the author did not dot, and the two dotted Ts must
    // NOT be counted — a detector that cannot tell them apart is worthless.
    assert.match(text, /W~100 -220 100 -260~/, 'fixture must still carry the vertical span');
    assert.match(text, /W~300 -220 300 -240 100 -240~/, 'fixture must still carry the T');
    assert.doesNotMatch(text, /J~100~-240~/, 'the T must still be undotted');

    const r = importEasyEda(text);
    assert.equal(undottedTees(r), 1,
      'exactly one undotted T is present; a count of 3 means the dotted ones are being '
      + 'counted too, and a count of 0 means the rule is not being applied at all');
    const w = r.warnings.find((x) => TEE.test(x));
    assert.match(w, /100,-240/, 'the warning must name where, so the reader can look');
    assert.match(w, /EasyEDA treats these as crossings/,
      'the warning must say what the difference IS — a count alone teaches nothing');
  });

  test('a dotted T is not reported: the author said connect, and we agree', () => {
    const text = readFileSync(path.join(here, 'fixtures', 'easyeda-rc-divider.json'), 'utf-8');
    // Dot the one undotted T. The count must fall to zero, and the import's
    // net partition must not move — the connection was already being read.
    const before = importEasyEda(text);
    const dotted = text.replace('"J~100~-160~2.5~#CC0000~gge310~0"',
      '"J~100~-160~2.5~#CC0000~gge310~0","J~100~-240~2.5~#CC0000~gge399~0"');
    assert.notEqual(dotted, text, 'the fixture\'s J shape must still be there to clone');
    const after = importEasyEda(dotted);
    assert.equal(undottedTees(after), 0, 'a dotted T is agreed geometry and must not be reported');
    assert.equal(after.wires.length, before.wires.length,
      'dotting a T we already folded in must not change the netlist — if it does, the '
      + 'warning is describing something other than what the solver did');
  });

  const CORPUS_ROOTS = process.env.EXAMPLES_DIR ? [process.env.EXAMPLES_DIR] : [
    path.resolve(here, '../../sb3-creator/examples'),
    path.resolve(here, '../../lego/brickwright-lite/overlay/scratch-gui/examples'),
  ];
  const root = CORPUS_ROOTS.find((r) => existsSync(r)) || null;

  test('every circuit this app EXPORTS survives the stricter rule', { timeout: 300000 }, () => {
    assert.notEqual(root, null,
      `Corpus absent. Tried:\n  ${CORPUS_ROOTS.join('\n  ')}\nA gate that cannot run must not `
      + 'report green.');
    const files = discover(root);
    assert.ok(files.length >= 2000, `only ${files.length} circuit files discovered`);
    const offenders = [];
    let exported = 0;
    for (const f of files) {
      let text;
      try {
        resetIds();
        const c = Circuit.fromJSON(JSON.parse(readFileSync(f.path, 'utf-8')));
        text = toEasyEdaSchematic(c).text;
      } catch { continue; }        // the exporter's own refusals are its gate's business
      exported++;
      const n = undottedTees(importEasyEda(text));
      if (n) offenders.push(`${f.id}: ${n}`);
    }
    console.log(`\n  exported and re-read ${exported} / ${files.length} circuits`);
    console.log(`  undotted T-joints: ${offenders.length} file(s)`);
    assert.ok(exported >= 2000,
      `only ${exported} circuits exported — the round trip is vacuous at this size`);
    assert.deepEqual(offenders, [],
      `${offenders.length} exported schematic(s) contain a T with no junction dot. The exporter's `
      + 'lane routing gives each net its own lane and each pin its own vertical, so every '
      + 'remaining contact between different nets should be an X crossing. A T here means a '
      + 'connection that exists in our reading and not on the board.');
  });

  test('MUTATION: a T introduced into an exported file turns the warning red', () => {
    assert.notEqual(root, null, 'corpus needed to produce a real export');
    const files = discover(root);
    // Start from what the app PRODUCES. A hand-authored fixture here would
    // test the codec, not the feature.
    let text = null;
    for (const f of files) {
      try {
        resetIds();
        const c = Circuit.fromJSON(JSON.parse(readFileSync(f.path, 'utf-8')));
        const t = toEasyEdaSchematic(c).text;
        if (/"W~[-\d. ]+~/.test(t)) { text = t; break; }
      } catch { /* try the next */ }
    }
    assert.ok(text, 'no circuit in the corpus exported a wire to mutate');
    assert.equal(undottedTees(importEasyEda(text)), 0, 'the export must be clean before mutation');

    // Take one wire's long vertical run and land ANOTHER net's wire endpoint
    // in the middle of it — the T EasyEDA reads as a crossing.
    //
    // The victim must be on a DIFFERENT net. NetSolver records only
    // LOAD-BEARING Ts (ones whose union actually merged two nets), which is
    // the right rule — a T inside a net that is already joined elsewhere
    // reads the same in both tools and there is nothing to warn about — and
    // it means a mutation that tees a net onto ITSELF correctly reports
    // nothing. So the pairs are searched rather than guessed.
    const wires = [...text.matchAll(/"(W~[^"]*)"/g)].map((m) => m[1]);
    let mutated = null;
    outer:
    for (const w of wires) {
      const pts = w.split('~')[1].trim().split(/\s+/).map(Number);
      for (let i = 0; i + 3 < pts.length; i += 2) {
        const [x1, y1, x2, y2] = [pts[i], pts[i + 1], pts[i + 2], pts[i + 3]];
        if (x1 !== x2 || Math.abs(y2 - y1) < 8) continue;        // want a vertical run
        const mid = `${x1} ${(y1 + y2) / 2}`;
        for (const victim of wires) {
          if (victim === w) continue;
          const vf = victim.split('~');
          vf[1] = `${vf[1].trim()} ${mid}`;                      // extend it to end ON the run
          const candidate = text.replace(`"${victim}"`, `"${vf.join('~')}"`);
          if (undottedTees(importEasyEda(candidate)) > 0) { mutated = candidate; break outer; }
        }
      }
    }
    assert.ok(mutated,
      'no pair of exported wires could be teed together at all, so this proof never ran. A '
      + 'wire endpoint landed in the middle of another net\'s span must be reported: our solver '
      + 'folds it in as a connection and EasyEDA does not, so a file that reads as joined here '
      + 'is separated on the board and nothing says so.');
    const n = undottedTees(importEasyEda(mutated));
    console.log(`  mutation: ${n} undotted T-joint(s) reported on an exported file`);
    assert.ok(n > 0, 'the mutation must be the thing that turned it red');
  });
});

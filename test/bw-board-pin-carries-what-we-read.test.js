/**
 * THE PINNED bw-board MUST CARRY THE VALUES THIS TREE READS OUT OF IT.
 *
 * This test exists because of a red that could only ever appear in CI. Locally
 * `node_modules/bw-board` is a symlink to a working copy, so every test sees
 * whatever is checked out there; in CI it is a git-sha dependency, so the tests
 * see the PIN. When the exporter started reading `classDefaults('tip120')` the
 * pin was `018d0d7`, which predates that entry, and the result was:
 *
 *     local   `npm test`  2,544 tests, 0 failures
 *     CI      `npm test`  spice-export-tip120-switch: no S switch, no SW model
 *
 * A green local run is not evidence about the pin. Nothing checked the two
 * against each other, so the gap could only surface as a mystery CI failure on
 * a branch whose diff did not touch the exporter.
 *
 * WHY IT ENUMERATES FROM THE SOURCE rather than from a list. A hand-kept list
 * of "capabilities we need" goes stale the first time someone reads a new value
 * and does not update it -- and going stale is invisible, because the list still
 * passes. So the subjects come from the exporter's own text: every
 * `classDefaults('<kind>')` call site it contains. Add a call site and this test
 * covers it without being edited; delete one and the coverage shrinks with it.
 *
 * AND IT IS THE FIELDS, NOT THE ENTRY. The first version asserted only that
 * `classDefaults(kind)` came back non-empty, and that assertion PASSED against
 * the broken pin -- `018d0d7` answers `classDefaults('tip120')` with the card's
 * own `{beta, is, vbe, rceSat}` and no `rBase`. Non-empty is not the
 * requirement; the named fields the exporter reads are. So the fields are
 * declared per kind below, and the declared kinds are asserted to be EXACTLY
 * the kinds found in the source -- add a call site without declaring what you
 * read out of it and this test reds asking for it.
 *
 * WHAT IT DOES NOT DO. It does not pin a sha or compare shas. A sha assertion
 * would red on every legitimate bump and says nothing about whether the code
 * works; the question that matters is whether the resolved module answers the
 * calls this tree makes. Related: a `.model` card can exist for a kind while
 * `classDefaults` has no entry for it -- which is exactly what `018d0d7` was --
 * so asserting the CARD exists would have passed on the broken pin.
 *
 * ONE SHAPE NOTE, learned by driving the failure. The first version of this file
 * imported `ebersMollCompanion` at the top. Against the old pin that name is not
 * exported at all, so the MODULE failed to load and node reported the whole file
 * as one anonymous `not ok` -- a red, but one whose message is a bare
 * "does not provide an export named" with no remedy in it. The engine capability
 * is therefore reached through a dynamic import inside the test, so a missing
 * export is reported as a sentence naming the pin.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { classDefaults } from 'bw-board/parts-library.js';

const here = dirname(fileURLToPath(import.meta.url));
const EXPORTER = join(here, '..', 'src', 'model', 'exporters', 'spice.js');

/** Every kind the exporter names in a `classDefaults('<kind>')` call. */
function kindsTheExporterReads() {
  const source = readFileSync(EXPORTER, 'utf8');
  const kinds = new Set();
  for (const m of source.matchAll(/classDefaults\(\s*['"]([a-z0-9_]+)['"]\s*\)/gi)) {
    kinds.add(m[1]);
  }
  return [...kinds];
}

/**
 * The fields this tree actually reads out of each kind's class defaults.
 *
 * `tip120` builds the deck's `.model SW_<ref> SW(VT= RON= ROFF=)` from exactly
 * these three, and a partial entry writes `VT=undefined`, which ngspice refuses
 * for an unrelated-looking reason.
 */
const FIELDS_READ = {
  tip120: ['rBase', 'vbe', 'rceSat'],
};

describe('the resolved bw-board answers what this tree asks of it', () => {
  it('declares the fields it reads for EVERY kind the exporter names', () => {
    const kinds = kindsTheExporterReads();
    // Anti-vacuity: if the regex stops matching -- a rename, a constant
    // extracted to a variable, a formatting change -- this file would otherwise
    // pass by iterating an empty list, which is the failure mode it exists to
    // prevent in the first place.
    assert.ok(kinds.length > 0,
      'no classDefaults(\'<kind>\') call sites were found in the exporter, so this '
      + 'test is measuring nothing -- fix the scan, do not delete the assertion');
    assert.deepEqual(kinds.slice().sort(), Object.keys(FIELDS_READ).sort(),
      'the exporter names a kind whose fields are not declared in FIELDS_READ (or '
      + 'declares one it no longer names). Add the fields you read out of it, or this '
      + 'gate silently stops covering the new call site.');
  });

  it('carries every declared field, in the RESOLVED module', () => {
    for (const [kind, fields] of Object.entries(FIELDS_READ)) {
      const d = classDefaults(kind) || {};
      for (const field of fields) {
        assert.equal(typeof d[field], 'number',
          `classDefaults('${kind}').${field} is ${JSON.stringify(d[field])} in the resolved `
          + 'bw-board. If this passes locally and fails in CI, the bw-board pin in '
          + 'package.json is older than the code that reads it -- bump it to a sha '
          + `containing ${kind}'s ${field}. (Non-empty is NOT the test: 018d0d7 answered `
          + "classDefaults('tip120') with the card's own fields and no rBase.)");
        assert.ok(Number.isFinite(d[field]) && d[field] > 0, `${kind}.${field} = ${d[field]}`);
      }
    }
  });

  it('has a MOS stamp that honours the Ksubthres this importer now carries', async () => {
    // The importer reads `Ksubthres` off a VDMOS card and puts it on the part.
    // A pinned engine without the soft-plus branch ignores it SILENTLY -- the
    // device cuts off hard where ngspice conducts, and the deck then disagrees
    // for a reason nothing in this tree would name.
    //
    // Checked through the public board API rather than by reaching for the
    // internal smoothing helper: exporting a numeric internal so a consumer's
    // gate can poke it would make this test the reason that function is public,
    // and the question here is what the ENGINE DOES, not what it exposes.
    const { BoardImpl } = await import('bw-board/board.js');
    const { registerAllDevices } = await import('bw-board/register-all.js');
    registerAllDevices();
    const drain = (ksubthres) => {
      const b = new BoardImpl(5);
      b.setNetlist([
        { id: 'GND1', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'VD', kind: 'vsource', params: { volts: 2 }, terminals: ['pos', 'neg'] },
        { id: 'VG', kind: 'vsource', params: { volts: 0.75 }, terminals: ['pos', 'neg'] },
        { id: 'RD', kind: 'resistor', params: { ohms: 1 }, terminals: ['a', 'b'] },
        { id: 'M1', kind: 'nmos', params: { vth: 1, kp: 0.12, w: 1, l: 1, ...(ksubthres ? { ksubthres } : {}) },
          terminals: ['drain', 'gate', 'source'] },
      ], [
        { id: 'n_dd', terminals: [{ part: 'VD', terminal: 'pos' }, { part: 'RD', terminal: 'a' }] },
        { id: 'n_d', terminals: [{ part: 'RD', terminal: 'b' }, { part: 'M1', terminal: 'drain' }] },
        { id: 'n_g', terminals: [{ part: 'VG', terminal: 'pos' }, { part: 'M1', terminal: 'gate' }] },
        { id: 'n_0', terminals: [
          { part: 'GND1', terminal: 'gnd' }, { part: 'M1', terminal: 'source' },
          { part: 'VD', terminal: 'neg' }, { part: 'VG', terminal: 'neg' },
        ] },
      ]);
      return Math.abs(b.branchCurrent('RD', 'a'));
    };
    // A quarter volt below threshold: cut off without the parameter, and
    // ngspice's own VDMOS draws 3.7342e-6 A there with Ksubthres = 0.1.
    assert.ok(drain(0) < 1e-9, `without Ksubthres this must be cut off: ${drain(0)}`);
    const withSub = drain(0.1);
    assert.ok(Math.abs(withSub - 3.7342e-6) < 3.7342e-6 * 2e-3,
      `with Ksubthres=0.1 the pinned engine must read ngspice's 3.7342e-6 A, read `
      + `${withSub.toExponential(4)}. If this is cut off, the bw-board pin in `
      + 'package.json predates the subthreshold branch -- bump it.');
  });

  it('loads the qualified MOS bulk thermal law, not the generic junction constant', async () => {
    // ADI-v2 exposed seven Level-1 MOS circuits (20 observations) whose only
    // numerical disagreement was the grounded bulk-source/drain junction. The
    // public engine contract must name the law, and this forward-biased witness
    // must exercise it: checking only the pin would let stale installed bytes
    // pass locally while CI loaded a different package artifact.
    const { BoardImpl } = await import('bw-board/board.js');
    const { registerAllDevices } = await import('bw-board/register-all.js');
    registerAllDevices();
    const board = new BoardImpl(5);
    board.setNetlist([
      { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'VN', kind: 'vsource', params: { volts: 0.45 }, terminals: ['pos', 'neg'] },
      { id: 'R', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'M', kind: 'nmos', params: {
        model: 'level1', vth: 1, kp: 50e-6, w: 100e-6, l: 1e-6,
        lambda: 0.01, bulkAtGround: true,
      }, terminals: ['drain', 'gate', 'source'] },
    ], [
      { id: 'gnd', terminals: [
        { part: 'G', terminal: 'gnd' }, { part: 'VN', terminal: 'pos' },
        { part: 'M', terminal: 'drain' }, { part: 'M', terminal: 'gate' },
      ] },
      { id: 'neg', terminals: [
        { part: 'VN', terminal: 'neg' }, { part: 'R', terminal: 'a' },
      ] },
      { id: 'src', terminals: [
        { part: 'R', terminal: 'b' }, { part: 'M', terminal: 'source' },
      ] },
    ]);
    const result = board.operatingPoint();
    assert.equal(result.converged, true);
    assert.equal(result.analysis.nmos.thermalVoltage, 0.025864925786328753);
    assert.ok(Math.abs(result.nodeVoltages.get('src') - (-0.4496452412103367)) < 1e-12,
      `forward-bulk witness moved: ${result.nodeVoltages.get('src')}`);
    assert.ok(Math.abs(result.branchCurrents.get('M').get('bulk') - 3.5475878966362055e-7) < 1e-15,
      `bulk current moved: ${result.branchCurrents.get('M').get('bulk')}`);
  });

  it('has an Ebers-Moll stamp that honours the VAF this tree now exports', async () => {
    // The exporter writes `Vaf=` into a per-part model card. If the pinned
    // engine has no Early term, the deck states a parameter the solver ignores
    // -- the comparison is then between two different transistors and every
    // affected corpus deck disagrees by millivolts for no visible reason.
    const mna = await import('bw-board/mna.js');
    assert.equal(typeof mna.ebersMollCompanion, 'function',
      'the pinned bw-board does not export `ebersMollCompanion`, so its Early-effect '
      + 'support cannot be checked at all. Bump the bw-board pin in package.json.');
    const { ebersMollCompanion } = mna;
    const p = { is: 1e-14, nVt: 0.025852, bf: 200, br: 1 };
    const plain = ebersMollCompanion(0.65, -4.0, p);
    const early = ebersMollCompanion(0.65, -4.0, { ...p, vaf: 100 });
    assert.ok(Math.abs(early.ic / plain.ic - 1.04) < 1e-6,
      `the pinned bw-board ignores VAF: Ic ratio ${early.ic / plain.ic}, expected 1.04. `
      + 'Bump the bw-board pin to a sha containing the Early effect.');
    assert.equal(early.ib, plain.ib, 'and it must not scale the base current');
  });
});

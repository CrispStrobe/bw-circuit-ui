/**
 * Physical DRC: every rule proven able to fire AND able to stay quiet.
 *
 * Synthetic cases mutate the mini fixture in memory (relabel a pad's net,
 * chop an outline segment) so each rule's firing condition is planted
 * deliberately — the un-mutated fixture is the stays-quiet half.
 *
 * The live corpus assertions are the full measured verdicts:
 *
 *   BROKEN calculator — 12 findings, all real, all four §1 fault classes:
 *     terminal-short x6  the six dead keys: SW5, SW8, SW11, SW13, SW14,
 *                        SW16, each with a GPIO and GND on one internal
 *                        terminal. THE founding fault of the plan.
 *     net-island x1      GND: the battery pad is its own island.
 *     outline-open x1    8 loose ends (the two ~39 mm tails and friends).
 *     unfinished x2      BAT1_2 and VCC reach one pad each.
 *     sch-split x1       R2 exists only in the schematic.
 *     sch-vocabulary x1  the OLED (ssd1306 vs header footprint).
 *
 *   REPAIRED board — 9 findings without the schematic, 11 with: the
 *     repair introduced three hairline via-track overlaps (clearance
 *     danger x3 + copper-short x2 + sch-bridge x2, three independent
 *     rules seeing the same three defects) and two genuine sub-clearance
 *     near-misses (0.042 and 0.076 mm). Cross-checked against the raw
 *     files by an independent Python sweep.
 *
 *   TinyProbe (fabbed, working) — ZERO findings. The §7.2 guard: a rule
 *     set that fires on healthy boards stops being read.
 */

import './_setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { importEasyEda } from '../src/importers/easyeda.js';
import { importEasyEdaPcb } from '../src/importers/easyeda-pcb.js';
import { runPcbDrc } from '../src/model/pcb-drc.js';

const FIX = join(import.meta.dirname, 'fixtures');
const mini = () => importEasyEdaPcb(readFileSync(join(FIX, 'easyeda-pcb-mini.json'), 'utf8'));
const rules = (f) => f.map((x) => x.rule).sort();
const byRule = (f, r) => f.filter((x) => x.rule === r);

describe('mini fixture: the planted defects and nothing else', () => {
  const f = runPcbDrc(mini());

  test('only VCC is unfinished; SW1.3 is NOT an island (the switch joins it)', () => {
    // SW1.3 shares terminal `a` with the routed SW1.1, so the part's own
    // metal joins them once soldered — an unrouted twin pad is normal
    // practice, and calling it a split net would fire on every healthy
    // board with multi-pad terminals (§7.2). The genuine-split case lives
    // in the mutation suite below.
    assert.deepEqual(rules(f), ['unfinished-net']);
    assert.deepEqual(byRule(f, 'unfinished-net').map((x) => x.net), ['VCC']);
  });

  test('a closed outline and matched terminals stay quiet', () => {
    assert.equal(byRule(f, 'outline-open').length, 0);
    assert.equal(byRule(f, 'terminal-short').length, 0);
    assert.equal(byRule(f, 'clearance').length, 0);
  });
});

describe('each rule can fire (planted mutations)', () => {
  test('net-island: a net declared on an UNCONNECTED pad of another part', () => {
    const b = mini();
    // R1.1 (VCC, copper reaches nothing) relabelled N1: now N1 claims a
    // pad no copper and no internal terminal can reach — a genuine split.
    b.parts.find((p) => p.ref === 'R1').pads.find((p) => p.num === '1').net = 'N1';
    const hits = byRule(runPcbDrc(b), 'net-island');
    assert.equal(hits.length, 1);
    assert.match(hits[0].explanation, /Net N1/);
    assert.equal(hits[0].severity, 'danger');
  });

  test('terminal-short: GND on the other pad of terminal a', () => {
    const b = mini();
    const sw = b.parts.find((p) => p.ref === 'SW1');
    sw.pads.find((p) => p.num === '3').net = 'GND'; // pad 1 stays N1 — one terminal, two nets
    const hits = byRule(runPcbDrc(b), 'terminal-short');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].partId, 'SW1');
    assert.equal(hits[0].severity, 'danger');
    assert.match(hits[0].explanation, /one node INSIDE the part/);
    assert.deepEqual(hits[0].nets.sort(), ['GND', 'N1']);
  });

  test('outline-open: chop one segment and two ends come loose', () => {
    const b = mini();
    b.outline.splice(1, 1);
    const hits = byRule(runPcbDrc(b), 'outline-open');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].looseEnds.length, 2);
    assert.equal(hits[0].severity, 'danger');
  });

  test('copper-short: relabel a pour-joined pad and the island carries two nets', () => {
    const b = mini();
    const sw = b.parts.find((p) => p.ref === 'SW1');
    sw.pads.find((p) => p.num === '4').net = 'VBAT'; // pad 2 stays GND; copper joins them
    const f = runPcbDrc(b);
    assert.equal(byRule(f, 'copper-short').length, 1);
    assert.match(byRule(f, 'copper-short')[0].explanation, /GND.*VBAT|VBAT.*GND/);
  });

  test('clearance: a foreign track dragged across a GND track overlaps', () => {
    const b = mini();
    // Move the top-layer N1 track to the bottom layer, running through
    // x 18..23 at y 8 — straight across the vertical GND track at
    // x 22.86 (unit 4090). Same layer, different nets, gap 0.
    const t = b.tracks.find((x) => x.net === 'N1');
    t.layerId = 2; t.layer = 'bottom';
    t.points = [[18, 8], [23, 8]];
    const f = runPcbDrc(b);
    const overlaps = byRule(f, 'clearance').filter((x) => x.severity === 'danger');
    assert.equal(overlaps.length, 1, JSON.stringify(rules(f)));
    assert.deepEqual(overlaps[0].nets.sort(), ['GND', 'N1']);
  });

  test('no-legend: a connector with bare silk warns, a labelled one does not', () => {
    const bare = {
      parts: [{
        id: 'J1', ref: 'J1', package: 'HDR-1X4', x: 5, y: 5, rotation: 0, side: 'top',
        pads: [1, 2, 3, 4].map((n) => ({
          num: String(n), net: `N${n}`, shape: 'circle', x: n * 2.54, y: 5,
          w: 1.7, h: 1.7, rotation: 0, drill: 1, plated: true, through: true, layer: 'through', points: null, id: `p${n}`,
        })),
        silk: { tracks: [], arcs: [], texts: [], circles: [], rects: [] },
        warnings: [],
      }],
      freePads: [], tracks: [], vias: [], holes: [], arcs: [], pours: [],
      outline: [
        { type: 'line', x1: 0, y1: 0, x2: 20, y2: 0 }, { type: 'line', x1: 20, y1: 0, x2: 20, y2: 10 },
        { type: 'line', x1: 20, y1: 10, x2: 0, y2: 10 }, { type: 'line', x1: 0, y1: 10, x2: 0, y2: 0 },
      ],
      silk: { tracks: [], arcs: [], texts: [], circles: [], rects: [] },
      texts: [], nets: ['N1', 'N2', 'N3', 'N4'], copperLayers: [1, 2],
    };
    const f1 = runPcbDrc(bare);
    assert.equal(byRule(f1, 'no-legend').length, 1);
    assert.equal(byRule(f1, 'no-legend')[0].partId, 'J1');
    // Now give it a legend.
    const labelled = structuredClone(bare);
    labelled.silk.texts.push({ kind: 'L', x: 6, y: 7, layerId: 3, text: 'SDA SCL VCC GND', display: true, rotation: 0, mirror: false, id: 't1' });
    assert.equal(byRule(runPcbDrc(labelled), 'no-legend').length, 0);
  });
});

// ── live corpus ────────────────────────────────────────────────────

const LIVE = process.env.BW_PCB_BOARDS || join(homedir(), 'Downloads');
const files = {
  broken: 'PCB_PCB_TaschenRechner3_2026-08-25.json',
  brokenSch: 'SCH_TaschenRechner3_2026-08-25.json',
  fixed: 'PCB_TaschenRechner3_FIXED.json',
  fixedSch: 'SCH_TaschenRechner3_FIXED.json',
  probe: 'PCB_TinyProbe_v1.0_2026-08-20.json',
};
const haveLive = Object.values(files).every((f) => existsSync(join(LIVE, f)));
const load = (f) => readFileSync(join(LIVE, f), 'utf8');

describe('live corpus (skips without the local boards)', { skip: !haveLive }, () => {
  test('the broken calculator: 12 findings, all four fault classes of plan §1', () => {
    const f = runPcbDrc(importEasyEdaPcb(load(files.broken)),
      { schematic: importEasyEda(load(files.brokenSch)) });
    assert.equal(f.length, 12, rules(f).join(','));
    // THE finding: six dead keys, by name.
    const shorts = byRule(f, 'terminal-short');
    assert.deepEqual(shorts.map((x) => x.partId).sort(),
      ['SW11', 'SW13', 'SW14', 'SW16', 'SW5', 'SW8']);
    assert.ok(shorts.every((x) => x.nets.includes('GND')));
    assert.equal(byRule(f, 'net-island').length, 1);
    assert.match(byRule(f, 'net-island')[0].explanation, /Net GND.*BAT1\.1/);
    assert.equal(byRule(f, 'outline-open')[0].looseEnds.length, 8);
    assert.deepEqual(byRule(f, 'unfinished-net').map((x) => x.net).sort(), ['BAT1_2', 'VCC']);
    assert.equal(byRule(f, 'clearance').length, 0, 'the broken board has no clearance faults');
  });

  test('the repaired board: the repair itself planted three shorts', () => {
    const f = runPcbDrc(importEasyEdaPcb(load(files.fixed)),
      { schematic: importEasyEda(load(files.fixedSch)) });
    const overlaps = byRule(f, 'clearance').filter((x) => x.severity === 'danger');
    assert.equal(overlaps.length, 3, 'three hairline via-track overlaps');
    assert.equal(byRule(f, 'copper-short').length, 2);
    assert.equal(byRule(f, 'sch-bridge').length, 2);
    const nearMisses = byRule(f, 'clearance').filter((x) => x.severity === 'warning');
    assert.equal(nearMisses.length, 2);
    for (const x of nearMisses) assert.ok(x.gap > 0 && x.gap < 0.152);
    // And the faults the broken board had are GONE: no terminal shorts,
    // no net islands, a closed outline.
    assert.equal(byRule(f, 'terminal-short').length, 0);
    assert.equal(byRule(f, 'net-island').length, 0);
    assert.equal(byRule(f, 'outline-open').length, 0);
  });

  test('TinyProbe, fabbed and working: zero findings', () => {
    const f = runPcbDrc(importEasyEdaPcb(load(files.probe)));
    assert.deepEqual(f, []);
  });
});

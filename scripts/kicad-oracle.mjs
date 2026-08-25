/**
 * The independent DRC oracle: KiCad judges OUR router (plan §5/§6).
 *
 * Projects deterministic circuits with board-projection, writes each as
 * .kicad_pcb through our exporter, and runs `kicad-cli pcb drc` on the
 * result. kicad-cli is a foreign-authored exact checker: a router gated by
 * two unrelated checkers cannot inherit a blind spot from either.
 *
 * Where kicad-cli is absent the script says so and exits 0 — the CI job
 * installs KiCad and runs it for real (see .github/workflows/ci.yml).
 *
 * Gating: only violation classes that speak about COPPER CORRECTNESS gate
 * (clearance, shorts, crossing or dangling tracks, starved thermals,
 * malformed courtyards do not exist in our exports anyway). Cosmetic
 * classes (silk legibility, missing 3D models, lib lookups) are reported
 * but do not fail — the oracle is for the router, not the artwork. A
 * netclass clearance of 0.127 mm is written into a sibling .kicad_pro so
 * KiCad judges by rules compatible with ours (0.152 mm) rather than its
 * 0.2 mm default.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import '../test/_setup.js';
import { projectBoard } from '../src/model/board-projection.js';
import { exportKicadPcb } from '../src/model/exporters/kicad-pcb.js';
import { runPcbDrc } from '../src/model/pcb-drc.js';

const GATING = new Set([
  'clearance', 'shorting_items', 'tracks_crossing', 'track_dangling',
  'via_dangling', 'hole_clearance', 'hole_near_hole', 'edge_clearance',
]);

const CASES = [
  ['chain', {
    parts: [
      { id: 'J1', kind: 'header', params: { pins: 2 } },
      { id: 'R1', kind: 'resistor', params: {} },
      { id: 'LED1', kind: 'led', params: {} },
      { id: 'SW1', kind: 'button', params: {} },
    ],
    wires: [
      { from: 'J1', fromTerminal: 'p1', to: 'R1', toTerminal: 'a' },
      { from: 'R1', fromTerminal: 'b', to: 'LED1', toTerminal: 'anode' },
      { from: 'LED1', fromTerminal: 'cathode', to: 'SW1', toTerminal: 'a' },
      { from: 'SW1', fromTerminal: 'b', to: 'J1', toTerminal: 'p2' },
    ],
  }],
  ['keypad', (() => {
    // A Pico with a 3x3 key matrix: rows/columns force real routing with
    // vias, deterministic and self-contained (no live corpus needed).
    const parts = [{ id: 'U1', kind: 'pi_pico', params: {} }];
    const wires = [];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const id = `SW${r * 3 + c + 1}`;
        parts.push({ id, kind: 'button', params: {} });
        wires.push({ from: id, fromTerminal: 'a', to: 'U1', toTerminal: `gp${r}` });
        wires.push({ from: id, fromTerminal: 'b', to: 'U1', toTerminal: `gp${3 + c}` });
      }
    }
    return { parts, wires };
  })()],
];

const which = spawnSync('kicad-cli', ['version'], { encoding: 'utf8' });
const haveKicad = which.status === 0;
if (!haveKicad) {
  console.log('kicad-cli not found — oracle SKIPPED (the CI job runs it with KiCad installed).');
  process.exit(0);
}
console.log(`kicad-cli ${which.stdout.trim()}`);

const dir = mkdtempSync(join(tmpdir(), 'bw-kicad-oracle-'));
let failed = false;

for (const [name, circuit] of CASES) {
  const { board, unrouted, unplaced } = projectBoard(circuit);
  if (unrouted.length || unplaced.length) {
    console.error(`${name}: projection incomplete (unrouted ${unrouted}, unplaced ${unplaced})`);
    failed = true;
    continue;
  }
  const own = runPcbDrc(board);
  if (own.length) {
    console.error(`${name}: our own DRC is not clean (${own.length} findings) — fix that first.`);
    failed = true;
    continue;
  }
  const { text } = exportKicadPcb(board, { title: name });
  const pcbPath = join(dir, `${name}.kicad_pcb`);
  writeFileSync(pcbPath, text);
  writeFileSync(join(dir, `${name}.kicad_pro`), JSON.stringify({
    board: {
      design_settings: {
        rules: { min_clearance: 0.1, min_track_width: 0.2 },
      },
    },
    net_settings: {
      classes: [{
        name: 'Default', clearance: 0.127, track_width: 0.254,
        via_diameter: 0.61, via_drill: 0.3,
      }],
    },
  }));
  const report = join(dir, `${name}.drc.json`);
  try {
    execFileSync('kicad-cli', ['pcb', 'drc', '--format', 'json', '--output', report,
      '--severity-error', '--severity-warning', pcbPath], { encoding: 'utf8' });
  } catch (e) {
    // kicad-cli exits non-zero with --exit-code-violations only; a crash
    // here is a real failure.
    if (!e.stdout && !e.stderr) throw e;
  }
  const drc = JSON.parse(readFileSync(report, 'utf8'));
  const violations = (drc.violations || []).filter((v) => GATING.has(v.type));
  const cosmetic = (drc.violations || []).filter((v) => !GATING.has(v.type));
  const unconnected = drc.unconnected_items || [];
  console.log(`${name}: ${violations.length} gating, ${cosmetic.length} cosmetic, ${unconnected.length} unconnected (KiCad's reading)`);
  for (const v of violations.slice(0, 10)) {
    console.error(`  GATING ${v.type}: ${v.description}`);
  }
  for (const u of unconnected.slice(0, 5)) {
    console.error(`  UNCONNECTED: ${u.description}`);
  }
  if (violations.length || unconnected.length) failed = true;
}

if (failed) {
  console.error('kicad-cli oracle: FAILED');
  process.exit(1);
}
console.log('kicad-cli oracle: clean.');

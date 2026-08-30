/**
 * Instructions that never reach the user (X0.7).
 *
 * `toEasyEDA` composes eight lines telling the user how to get the file it
 * just wrote into the other tool, and ExportNetlistMenu sent them to
 * `console.log`. The SPICE export's skipped-part list went to console.log
 * too, the EAGLE warnings to console.log, the native-EasyEDA omissions to
 * console.warn — and BoardCanvas's own export handler did not even
 * destructure `instructions`, so it computed the string and dropped it.
 *
 * Nobody using this app has a console open. This file asserts the property
 * that fixes the whole class rather than the four instances: no transfer
 * path may speak only to the console, and everything a transfer can say has
 * a component to say it in.
 *
 * @module
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Circuit } from '../src/model/circuit.js';
import { extractNetlist } from '../src/model/netlist.js';
import { toEasyEDA } from '../src/model/exporters/easyeda.js';
import { CIRCUIT_EXPORTS, BOARD_EXPORTS, runExport }
  from '../src/model/exporters/registry.js';
import { projectBoardFromCircuit } from '../src/model/board-projection.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '../src');

function bench() {
  return Circuit.fromJSON({
    parts: [
      { id: 'VCC1', kind: 'vcc', params: {}, x: 0, y: 0 },
      { id: 'GND1', kind: 'gnd', params: {}, x: 0, y: 200 },
      { id: 'R1', kind: 'resistor', params: { ohms: 220 }, x: 60, y: 0 },
      { id: 'LED1', kind: 'led', params: { color: 'red' }, x: 120, y: 0 },
    ],
    wires: [
      { from: 'VCC1', fromTerminal: 'vcc', to: 'R1', toTerminal: 'a' },
      { from: 'R1', fromTerminal: 'b', to: 'LED1', toTerminal: 'anode' },
      { from: 'LED1', fromTerminal: 'cathode', to: 'GND1', toTerminal: 'gnd' },
    ],
  });
}

describe('no transfer path speaks only to the console (X0.7)', () => {
  it('the export path in BoardCanvas has no console call at all', () => {
    const canvas = readFileSync(path.join(SRC, 'components/BoardCanvas.jsx'), 'utf-8');
    const start = canvas.indexOf('const handleExport');
    assert.ok(start > 0, 'handleExport found');
    const body = canvas.slice(start, start + 2200);
    assert.ok(!/console\.(log|warn|error|info)/.test(body),
      `console-only guidance in the export path:\n${body.match(/console\.[a-z]+\([^\n]*/g)}`);
    assert.ok(/say\(/.test(body), 'it must report to the user instead');
  });

  it('no exporter or importer module logs user guidance to the console', () => {
    const offenders = [];
    const walk = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { walk(p); continue; }
        if (!/\.(js|jsx)$/.test(e.name)) continue;
        const text = readFileSync(p, 'utf-8');
        for (const m of text.matchAll(/console\.(log|warn)\(([^\n]*)/g)) {
          offenders.push(`${path.relative(SRC, p)}: console.${m[1]}(${m[2].slice(0, 60)}`);
        }
      }
    };
    walk(path.join(SRC, 'importers'));
    walk(path.join(SRC, 'model/exporters'));
    assert.deepEqual(offenders, [],
      'a writer or reader that logs is a writer or reader whose message the '
      + 'user will never see — return it in the report instead');
  });

  it('the instructions the EasyEDA export composes are carried by the registry', () => {
    const circuit = bench();
    const netlist = extractNetlist(circuit);
    const direct = toEasyEDA(netlist);
    assert.ok(direct.instructions.length > 50, 'the exporter still composes them');

    const entry = CIRCUIT_EXPORTS.find(e => e.id === 'easyeda-netlist');
    assert.ok(entry, 'the via-netlist EasyEDA export is registered');
    return runExport(entry, { circuit }).then(({ report }) => {
      assert.equal(report.instructions, direct.instructions,
        'the registry must hand the instructions on verbatim, not drop them');
    });
  });

  it('every registry entry that can warn returns its warnings, not logs them', async () => {
    const circuit = bench();
    const board = projectBoardFromCircuit(circuit).board;
    for (const entry of [...CIRCUIT_EXPORTS, ...BOARD_EXPORTS]) {
      if (entry.browserOnly) continue;
      const { report } = await runExport(entry, { circuit, board });
      for (const key of ['skipped', 'warnings']) {
        if (report[key] !== undefined) {
          assert.ok(Array.isArray(report[key]),
            `${entry.id}.report.${key} must be an array, got ${typeof report[key]}`);
        }
      }
      if (report.instructions !== undefined && report.instructions !== null) {
        assert.equal(typeof report.instructions, 'string', `${entry.id}.report.instructions`);
      }
    }
  });
});

describe('the report component exists and is mounted where the user is', () => {
  const canvas = readFileSync(path.join(SRC, 'components/BoardCanvas.jsx'), 'utf-8');
  const panel = readFileSync(path.join(SRC, 'components/BoardPanel.jsx'), 'utf-8');
  const report = readFileSync(path.join(SRC, 'components/TransferReport.jsx'), 'utf-8');

  it('BoardCanvas renders it, and OUTSIDE the popover that unmounts the menu', () => {
    assert.ok(canvas.includes('<TransferReport'), 'BoardCanvas renders TransferReport');
    // If it were drawn inside the ⋯ popover, onDone would unmount it in the
    // same frame the action ran. Assert it sits under the canvas div, which
    // is a sibling of the toolbar.
    const mount = canvas.indexOf('<TransferReport');
    const canvasDiv = canvas.indexOf('data-canvas');
    const popover = canvas.indexOf('data-toolbar-more-menu');
    assert.ok(mount > canvasDiv, 'the report is mounted inside the canvas box');
    assert.ok(mount > popover, 'and after the popover, not inside it');
  });

  it('BoardPanel renders it too — a board export can warn as well', () => {
    assert.ok(panel.includes('<TransferReport'), 'BoardPanel renders TransferReport');
  });

  it('it shows every channel a transfer can speak on', () => {
    for (const field of ['error', 'summary', 'skipped', 'warnings', 'instructions']) {
      assert.ok(new RegExp(`report\\.${field}|${field}\\.length|const ${field}`).test(report),
        `TransferReport never renders report.${field}`);
    }
    assert.ok(report.includes('data-transfer-report'), 'it is findable by a browser probe');
    assert.ok(/labelDe|de \?/.test(report), 'and bilingual like the rest of the UI');
  });

  it('it renders nothing when there is nothing to say', () => {
    assert.ok(/if \(!report\) return null/.test(report),
      'a clean export must not make the user dismiss a panel');
  });
});

/**
 * The export registry — every writer we ship, in one list.
 *
 * WHY THIS EXISTS. An export nobody can invoke is not a feature, it is a
 * defect that looks like a feature: it has tests, it has a golden file, and
 * it has never once run for a user. Measured on 2026-08-30 at ee0d108, SEVEN
 * of our writers had zero call sites reachable from any UI:
 *
 *     toKicadSch        the only writer producing an OPENABLE schematic
 *     exportWokwi       re-exported from importers/index.js and nowhere else
 *     exportSvgAsPng    zero references anywhere in src/
 *     toEagleSch        reached only from ExportNetlistMenu.jsx, which was
 *                       itself imported by BoardCanvas and never rendered
 *     exportGerbers     exported from the package barrel, called by nobody
 *     exportKicadPcb    called only by scripts/kicad-oracle.mjs
 *     exportEasyEdaPcb  no callers at all
 *
 * Two whole COMPONENTS were in the same state: ExportNetlistMenu.jsx and
 * ImportCircuitMenu.jsx were imported by BoardCanvas/CircuitDesigner and
 * never placed in any tree, so their formats — EAGLE export, the KiCad 4/5
 * .sch + -cache.lib pairing, the import report — did not exist in the app.
 *
 * The fix is structural, not a list of menu entries. Menus render FROM this
 * registry, so an entry is the only way to add a format and a format cannot
 * exist without an entry; and test/export-reachability.test.js enumerates
 * the writer modules on disk and fails by name when one is not registered.
 * Adding an exporter is now the only thing you have to do.
 *
 * SHAPE. Each entry declares what it needs and returns files plus a report:
 *
 *   needs   'netlist' | 'circuit' | 'board' | 'svg'
 *   run(ctx) -> { files: [{name, text?, blob?, mime?}], report? }
 *   report   { skipped?, warnings?, substituted?, instructions? }
 *
 * `run` may be async (PNG rasterises through an Image load). Nothing in here
 * touches the DOM: the caller downloads what it gets back. That is what
 * makes every entry testable in Node.
 *
 * @module
 */

import { extractNetlist } from '../netlist.js';
import { toSpice } from './spice.js';
import { toKicadNet } from './kicad.js';
import { toKicadSch } from './kicad-sch.js';
import { toEasyEDA } from './easyeda.js';
import { toEasyEdaSchematic } from './easyeda-schematic.js';
import { toEagleSch } from './eagle.js';
import { exportKicadPcb } from './kicad-pcb.js';
import { exportEasyEdaPcb } from './easyeda-pcb.js';
import { exportGerbers } from './gerber.js';
import { exportWokwi } from '../../importers/wokwi.js';

/** Formats that describe the CIRCUIT (schematic, netlist, picture). */
export const CIRCUIT_EXPORTS = [
  {
    id: 'spice',
    label: 'SPICE deck (.cir)', labelDe: 'SPICE-Netzliste (.cir)',
    needs: 'netlist',
    run: ({ netlist }) => {
      const { text, skipped, warnings } = toSpice(netlist);
      return {
        files: [{ name: 'circuit.cir', text, mime: 'text/plain' }],
        report: { skipped, warnings },
      };
    },
  },
  {
    id: 'kicad-net',
    label: 'KiCad netlist (.net)', labelDe: 'KiCad-Netzliste (.net)',
    needs: 'netlist',
    run: ({ netlist }) => ({
      files: [{ name: 'circuit.net', text: toKicadNet(netlist), mime: 'text/plain' }],
    }),
  },
  {
    id: 'kicad-sch',
    // The only writer here that produces a file the other tool OPENS as a
    // drawing — lib_symbols, per-rail power symbols, deterministic UUIDs —
    // and it was the one with no way to invoke it.
    label: 'KiCad schematic (.kicad_sch)', labelDe: 'KiCad-Schaltplan (.kicad_sch)',
    needs: 'circuit',
    run: ({ circuit, terminalsForKind }) => {
      const { text, warnings, skipped } = toKicadSch(
        { parts: circuit.parts, wires: circuit.wires },
        terminalsForKind ? { terminalsForKind } : {});
      return {
        files: [{ name: 'circuit.kicad_sch', text, mime: 'text/plain' }],
        report: { warnings, skipped },
      };
    },
  },
  {
    id: 'easyeda-native',
    label: 'EasyEDA schematic (.json)', labelDe: 'EasyEDA-Schaltplan (.json)',
    needs: 'circuit',
    run: ({ circuit }) => {
      const { text, report } = toEasyEdaSchematic(circuit);
      return {
        files: [{ name: 'circuit.easyeda.json', text, mime: 'application/json' }],
        report: { skipped: report.skipped, warnings: report.warnings },
      };
    },
  },
  {
    id: 'easyeda-netlist',
    label: 'EasyEDA (via KiCad netlist)', labelDe: 'EasyEDA (via KiCad-Netzliste)',
    needs: 'netlist',
    run: ({ netlist }) => {
      const { text, instructions } = toEasyEDA(netlist);
      // These instructions went to console.log for the whole life of this
      // exporter (X0.7). The user is not in the console.
      return {
        files: [{ name: 'circuit-for-easyeda.net', text, mime: 'text/plain' }],
        report: { instructions },
      };
    },
  },
  {
    id: 'eagle',
    label: 'EAGLE schematic (.sch, netlist only)',
    labelDe: 'EAGLE-Schaltplan (.sch, nur Netzliste)',
    needs: 'circuit',
    run: ({ circuit }) => {
      // From the circuit's own parts and wires, NOT the netlist: extractNetlist
      // drops power rails and infrastructure, and a round trip that loses
      // every GND symbol is not a round trip.
      const { xml, warnings } = toEagleSch({ parts: circuit.parts, wires: circuit.wires });
      return {
        files: [{ name: 'circuit.sch', text: xml, mime: 'application/xml' }],
        report: {
          warnings,
          instructions: 'Connectivity only: this file carries nets and part '
            + 'names, not symbol geometry, so EAGLE will not draw it as a '
            + 'schematic. It re-imports here with the same net partition and '
            + 'is useful as interchange.',
        },
      };
    },
  },
  {
    id: 'wokwi',
    label: 'Diagram (diagram.json)', labelDe: 'Diagramm (diagram.json)',
    needs: 'circuit',
    run: ({ circuit }) => {
      const { text, skipped, substituted } = exportWokwi(
        { parts: circuit.parts, wires: circuit.wires });
      return {
        files: [{ name: 'diagram.json', text, mime: 'application/json' }],
        report: {
          skipped: skipped.map(s => `${s.id} (${s.kind}): no diagram type for this kind`),
          warnings: substituted.map(s => `${s.id}: ${s.note}`),
        },
      };
    },
  },
  {
    id: 'png',
    label: 'Picture (.png)', labelDe: 'Bild (.png)',
    needs: 'svg',
    // Browser only: rasterising needs Canvas 2D. The reachability gate knows
    // (browserOnly) and asserts the entry exists rather than running it.
    browserOnly: true,
    run: async ({ svgElement }) => {
      const { svgToPngBlob } = await import('../export-png.js');
      return {
        files: [{ name: 'circuit.png', blob: await svgToPngBlob(svgElement, 2) }],
      };
    },
  },
];

/** Formats that describe the BOARD (the PCB projection). */
export const BOARD_EXPORTS = [
  {
    id: 'kicad-pcb',
    label: 'KiCad board (.kicad_pcb)', labelDe: 'KiCad-Platine (.kicad_pcb)',
    needs: 'board',
    run: ({ board }) => {
      const { text, warnings } = exportKicadPcb(board);
      return {
        files: [{ name: 'board.kicad_pcb', text, mime: 'text/plain' }],
        report: { warnings },
      };
    },
  },
  {
    id: 'easyeda-pcb',
    label: 'EasyEDA board (.json)', labelDe: 'EasyEDA-Platine (.json)',
    needs: 'board',
    run: ({ board }) => ({
      files: [{ name: 'board.easyeda.json', text: exportEasyEdaPcb(board), mime: 'application/json' }],
    }),
  },
  {
    id: 'gerber',
    label: 'Gerber + drill (folder)', labelDe: 'Gerber + Bohrdatei (Ordner)',
    needs: 'board',
    run: ({ board }) => {
      const { files, warnings } = exportGerbers(board);
      return {
        files: Object.entries(files).map(([name, text]) => ({
          name, text, mime: 'text/plain',
        })),
        report: {
          warnings,
          instructions: 'A fabricator wants these as one archive. Your browser '
            + 'saves them individually; zip the folder before uploading.',
        },
      };
    },
  },
];

export const ALL_EXPORTS = [...CIRCUIT_EXPORTS, ...BOARD_EXPORTS];

/**
 * Run one registry entry, resolving whatever it declared it needs.
 *
 * @param {object} entry — a CIRCUIT_EXPORTS / BOARD_EXPORTS member
 * @param {{circuit?: object, board?: object, svgElement?: SVGElement,
 *          terminalsForKind?: Function}} ctx
 * @returns {Promise<{files: Array, report: object}>}
 */
export async function runExport(entry, ctx) {
  const full = { ...ctx };
  if (entry.needs === 'netlist' && !full.netlist) full.netlist = extractNetlist(ctx.circuit);
  const out = await entry.run(full);
  return { files: out.files || [], report: out.report || {} };
}

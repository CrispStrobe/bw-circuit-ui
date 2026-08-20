/**
 * Find the circuits in a corpus that a LINEAR solver can legitimately check,
 * and translate them to an lcapy netlist.
 *
 * Eligibility is deliberately narrow. lcapy solves linear circuits exactly,
 * so anything whose value is not a constant in the file is excluded rather
 * than guessed at: an LDR or NTC gets its resistance from light or
 * temperature, and a wave source has an instantaneous value rather than a DC
 * one. Including them would mean telling lcapy what OUR engine chose, which
 * would couple the two sides and stop this being an independent check.
 *
 * Connectors are inert: a header or a USB socket contributes terminals, not a
 * circuit element. Same for the breadboard — it is wiring, not a component.
 *
 * @module
 */

import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectFormat } from '../../src/importers/detect.js';
import { importEagle } from '../../src/importers/eagle.js';
import { importKicadSch } from '../../src/importers/kicad-sch.js';
import { importKicadLegacy } from '../../src/importers/kicad-legacy.js';
import { netsFromWires } from '../../src/model/schematic-svg.js';
import { terminalsForKind } from '../../src/model/circuit.js';

const IMPORTERS = { eagle: importEagle, 'kicad-sch': importKicadSch, 'kicad-legacy': importKicadLegacy };
const INERT = new Set(['header', 'usb_a', 'crystal']);
const LINEAR = new Set(['resistor', 'capacitor', 'inductor', 'vsource', 'isource', 'vcc', 'gnd']);

/**
 * @param {string} root directory to walk
 * @returns {{specs: Record<string,string>, ours: Record<string,object>, skipped: string[]}}
 */
export function collectLinearCircuits(root) {
  const files = [];
  (function walk(d) {
    for (const e of readdirSync(d)) {
      if (e === '.git' || e === 'node_modules') continue;
      const q = join(d, e);
      let st; try { st = statSync(q); } catch { continue; }
      if (st.isDirectory()) walk(q);
      else if (/\.(sch|kicad_sch)$/i.test(e)) files.push(q);
    }
  })(root);

  const specs = {}; const ours = {}; const skipped = [];
  for (const f of files) {
    let txt; try { txt = readFileSync(f, 'utf8'); } catch { continue; }
    let fmt; try { fmt = detectFormat(txt, f); } catch { continue; }
    const imp = IMPORTERS[fmt]; if (!imp) continue;
    let c; try { c = imp(txt); } catch { continue; }
    if (!c.parts?.length) continue;

    const kinds = [...new Set(c.parts.map((p) => p.kind))].filter((k) => !INERT.has(k));
    if (!kinds.length || kinds.some((k) => !LINEAR.has(k))) continue;
    const name = `[${fmt}] ${f.split('/').pop()}`;

    const nets = netsFromWires(c.wires).map((n, i) => ({ id: `N${i}`, terminals: n.terminals }));
    const gndIds = new Set(c.parts.filter((p) => p.kind === 'gnd').map((p) => p.id));
    // EVERY net carrying a ground symbol is the same node. A board draws one
    // GND symbol per connection point, so a schematic routinely has several
    // separate ground NETS that are electrically one reference — an Adafruit
    // MAX4466 has two. Taking only the first left the others floating in the
    // lcapy netlist while our engine correctly clamped them all, which read as
    // a solver disagreement and was this line.
    const gndNets = nets.filter((n) => n.terminals.some((t) => gndIds.has(t.part)));
    const gndNet = gndNets[0];
    // A hierarchical SUB-SHEET draws its supply from the parent through
    // hierarchical labels and carries no ground symbol of its own. It is a
    // fragment, not a circuit, and is skipped rather than forced.
    if (!gndNet) { skipped.push(`${name}: no ground (hierarchical fragment?)`); continue; }

    const node = new Map(gndNets.map((n) => [n.id, 0]));
    let k = 1; for (const n of nets) if (!node.has(n.id)) node.set(n.id, k++);
    const netOf = (part, terminal) => {
      const n = nets.find((x) => x.terminals.some((t) => t.part === part && t.terminal === terminal));
      return n ? node.get(n.id) : null;
    };

    const lines = []; const vccNodes = new Set();
    for (const p of c.parts) {
      if (INERT.has(p.kind) || p.kind === 'gnd') continue;
      if (p.kind === 'vcc') { const a = netOf(p.id, 'vcc'); if (a != null && a !== 0) vccNodes.add(a); continue; }
      const t = p.terminals || ['a', 'b'];
      const a = netOf(p.id, t[0]); const b = netOf(p.id, t[1]);
      if (a == null || b == null || a === b) continue;
      if (p.kind === 'resistor') lines.push(`R${p.id} ${a} ${b} ${p.params?.ohms ?? 1000}`);
      else if (p.kind === 'capacitor') lines.push(`C${p.id} ${a} ${b} ${p.params?.farads ?? 1e-7}`);
      else if (p.kind === 'inductor') lines.push(`L${p.id} ${a} ${b} ${p.params?.henries ?? 1e-3}`);
      else if (p.kind === 'vsource') {
        if (p.params?.wave && p.params.wave !== 'dc') { lines.length = 0; break; }
        lines.push(`V${p.id} ${a} ${b} dc ${p.params?.volts ?? 5}`);
      }
    }
    let i = 0; for (const n of vccNodes) lines.push(`Vsupply${i++} ${n} 0 dc 5`);
    if (lines.length < 2) { skipped.push(`${name}: fewer than 2 elements once wired`); continue; }

    // The importers do not attach a terminals array — the engine derives it
    // from the kind — but solveMNA needs one, and a part with `terminals:
    // undefined` is silently SKIPPED: nothing gets clamped and every node
    // reads 0 V. That looked exactly like a solver failure on 25 of 26 boards.
    const engineParts = c.parts.filter((p) => !INERT.has(p.kind)).map((p) => ({
      id: p.id, kind: p.kind, params: p.params || {},
      terminals: p.terminals?.length ? p.terminals : terminalsForKind(p.kind, p.params || {}),
    }));
    specs[name] = lines.join('\n');
    ours[name] = { parts: engineParts, nets, node: Object.fromEntries(node) };
  }
  return { specs, ours, skipped };
}

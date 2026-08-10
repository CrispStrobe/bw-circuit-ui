// Every example, through the ACTUAL projection, with geometric invariants:
//  A. everything inside the canvas (nothing clipped)
//  B. every stub outer end lands ON a symbol pin (wires meet symbols)
//  C. every drawn net has >= 2 pins (no dangling one-ended wires)
import './test/_setup.js';
import { Circuit, resetIds } from './src/model/circuit.js';
import { buildSeatedFromDeclarations } from './src/model/infer-seated.js';
import { projectSchematic } from './src/model/schematic-projection.js';

const idx = await (await fetch('https://crispstrobe.github.io/brickwright-lite/examples/index.json')).json();
const list = Array.isArray(idx) ? idx : idx.examples;
let ok = 0; const bad = [];
for (const ex of list) {
  try {
    resetIds();
    let c;
    const data = ex.files?.circuit
      ? await (await fetch(`https://crispstrobe.github.io/brickwright-lite/examples/${ex.files.circuit}`)).json()
      : null;
    const legacy = data && Array.isArray(data.wires) && data.wires.some(w => typeof w.from === 'string');
    // mirror the app: program examples derive the seated bench; pure files load verbatim
    if (ex.kind !== 'circuit' && ex.files?.program) {
      // approximate: derive pins from the file's mcu or a single output pin
      c = new Circuit(5);
      buildSeatedFromDeclarations(c, { device: 'STC12C5A60S2', pins: [
        { name: 'led1', port: 1, bit: 0, direction: 'output', activeLow: true },
        { name: 'led2', port: 1, bit: 1, direction: 'output', activeLow: true },
      ] });
    } else if (data) {
      c = Circuit.fromJSON(data);
    } else continue;
    const parts = c.parts;
    const nets = c.board.getNets();
    const proj = projectSchematic(parts, nets);
    const errs = [];
    const inside = (x, y) => x >= -1 && y >= -1 && x <= proj.width + 1 && y <= proj.height + 1;
    for (const s of proj.symbols) {
      if (!inside(s.x, s.y)) errs.push(`symbol ${s.id} at ${s.x | 0},${s.y | 0} outside ${proj.width | 0}x${proj.height | 0}`);
      for (const pin of s.pins) if (!inside(pin.x, pin.y)) errs.push(`pin ${s.id}.${pin.name} outside`);
    }
    const pinSet = new Set();
    for (const s of proj.symbols) for (const pin of s.pins) pinSet.add(`${Math.round(pin.x)},${Math.round(pin.y)}`);
    for (const w of proj.wires) {
      if (!inside(w.trunk.x, w.trunk.y1) || !inside(w.trunk.x, w.trunk.y2)) errs.push(`trunk ${w.netId} outside`);
      for (const seg of w.stubs) {
        const [a, b2] = seg;
        if (!inside(a.x, a.y) || !inside(b2.x, b2.y)) errs.push(`stub of ${w.netId} outside`);
        // outer end (the non-trunk end) must be a pin
        const outer = Math.abs(a.x - w.trunk.x) > Math.abs(b2.x - w.trunk.x) ? a : b2;
        if (!pinSet.has(`${Math.round(outer.x)},${Math.round(outer.y)}`)) {
          errs.push(`stub of ${w.netId} ends at ${outer.x | 0},${outer.y | 0} — not on any pin`);
        }
      }
      if (w.stubs.length < 2) errs.push(`net ${w.netId} drawn with ${w.stubs.length} stub(s) — dangling`);
    }
    // D. no trunk runs through a symbol's column band at a row it crosses
    for (const w of proj.wires) {
      for (const sym of proj.symbols) {
        const half = 30;
        if (Math.abs(w.trunk.x - sym.x) < half &&
            w.trunk.y1 < sym.y + 20 && w.trunk.y2 > sym.y - 20) {
          errs.push(`trunk ${w.netId} passes through symbol ${sym.id}`);
        }
      }
    }
    if (errs.length) bad.push(`${ex.id}: ${errs.slice(0, 3).join(' | ')}`);
    else ok++;
  } catch (e) { bad.push(`${ex.id}: THREW ${String(e).split('\n')[0].slice(0, 70)}`); }
}
console.log(`ok=${ok} bad=${bad.length}`);
console.log(bad.slice(0, 20).join('\n'));

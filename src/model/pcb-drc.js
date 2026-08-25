/**
 * Physical DRC — evaluate a BOARD against the faults only a board can have.
 *
 * Emits the same finding shape as `drc.js` ({severity, rule, partId,
 * explanation}, severity 'info' | 'warning' | 'danger') so findings land in
 * the existing chip, panel and overlay with no UI work (plan §5 Phase 2).
 *
 * Rules:
 *   1. terminal-short   two nets on pads that are ONE terminal inside the
 *                       part (the six dead keys of plan §1). Needs only the
 *                       land pattern's terminal map and the pads' declared
 *                       nets — no geometry, no simulator, no schematic.
 *   2. copper-short     one copper island carrying pads of different
 *                       declared nets (a hairline via-track overlap).
 *   3. net-island       a declared net whose pads are NOT all joined by
 *                       copper.
 *   4. clearance        different-net copper closer than the clearance on
 *                       the same layer — the EXACT check the router is
 *                       gated by. Distances via pcb-geometry; no inscribed
 *                       circles (§7.1).
 *   5. outline-open     board outline not a closed loop (fab rejects, or
 *                       mills wrong).
 *   6. no-legend        a connector with no silk pin legend (reversed
 *                       rails kill the module).
 *   7. unfinished-net   a net that reaches exactly one pad. Counting is
 *                       not detecting (§7.2), so this stays a WARNING and
 *                       names the pad: on a board — unlike a schematic
 *                       rail — a single-pad net drives nothing by
 *                       construction.
 *   8. sch-split / sch-bridge / sch-vocabulary  (only when a paired
 *                       schematic is passed): the Phase-0.5 pairing diff
 *                       formatted into findings.
 *
 * @module
 */

import { computeCopperNetlist } from './copper-netlist.js';
import { recognizePackage, getLandPattern, padTerminal } from './land-patterns.js';
import { liftBoardToCircuit } from './board-lift.js';
import { diffBoardAgainstSchematic } from './board-pairing.js';
import { padShape, trackShapes, viaShape, shapeDist } from './pcb-geometry.js';

/** EasyEDA's own default clearance (routerRule.trackClearance), in mm. */
export const DEFAULT_CLEARANCE_MM = 0.152;

const finding = (severity, rule, partId, explanation, extra = {}) =>
  ({ severity, rule, partId, explanation, ...extra });

// ── rule 1: terminal-short ─────────────────────────────────────────

function checkTerminalShorts(board, findings) {
  for (const part of board.parts) {
    const rec = recognizePackage(part.package, part.ref);
    if (!rec || !rec.variant) continue;
    const pattern = getLandPattern(rec.kind, rec.variant);
    const byTerminal = new Map();
    for (const pad of part.pads) {
      const t = padTerminal(pattern, pad.num);
      if (!t || !pad.net) continue;
      if (!byTerminal.has(t)) byTerminal.set(t, []);
      byTerminal.get(t).push(pad);
    }
    for (const [terminal, pads] of byTerminal) {
      const nets = [...new Set(pads.map((p) => p.net))];
      if (nets.length < 2) continue;
      const detail = pads.map((p) => `pad ${p.num} (${p.net})`).join(' and ');
      findings.push(finding('danger', 'terminal-short', part.ref || part.id,
        `${part.ref || part.id}: ${detail} are one node INSIDE the part — `
        + `terminal "${terminal}" of a ${rec.kind} permanently joins ${nets.join(' to ')}. `
        + 'The copper never touches; the part itself makes the connection, soldered in.',
        { nets, terminal }));
    }
  }
}

// ── rules 2 + 3: copper connectivity ───────────────────────────────

function checkCopper(board, copper, findings) {
  for (const island of copper.islands) {
    if (island.nets.length >= 2) {
      const byNet = new Map();
      for (const p of island.pads) {
        if (!p.net) continue;
        if (!byNet.has(p.net)) byNet.set(p.net, []);
        byNet.get(p.net).push(`${p.ref || '?'}.${p.num}`);
      }
      const detail = [...byNet.entries()].map(([net, pads]) => `${net} (${pads.join(', ')})`).join(' — ');
      findings.push(finding('danger', 'copper-short', island.pads[0]?.ref || '',
        `One piece of copper joins ${island.nets.length} nets: ${detail}. `
        + 'Somewhere along it, copper of different nets touches.',
        { nets: island.nets }));
    }
  }
  for (const [net, islandIdx] of Object.entries(copper.netIslands)) {
    if (islandIdx.length < 2) continue;
    const groups = islandIdx.map((i) => copper.islands[i].pads
      .filter((p) => p.net === net).map((p) => `${p.ref || '?'}.${p.num}`));
    groups.sort((a, b) => a.length - b.length);
    const approx = islandIdx.some((i) => copper.islands[i].approxPour);
    findings.push(finding('danger', 'net-island', groups[0][0]?.split('.')[0] || '',
      `Net ${net} is ${islandIdx.length} separate copper islands: `
      + groups.map((g) => `[${g.join(', ')}]`).join(' and ')
      + '. The copper never joins them.'
      + (approx ? ' (A pour without file fill is involved; connectivity is over-approximated, so the real board can only be MORE split.)' : ''),
      { net }));
  }
}

// ── rule 4: clearance ──────────────────────────────────────────────

/** All copper items as {shape, layer (0 = every layer), net, label}. */
function copperItems(board) {
  const items = [];
  const layerOf = (name, id) => (id === 2 || name === 'bottom' ? 2 : id === 1 || name === 'top' ? 1 : 0);
  for (const part of board.parts) {
    for (const pad of part.pads) {
      items.push({
        shape: padShape(pad), net: pad.net,
        layer: pad.through ? 0 : layerOf(pad.layer),
        label: `pad ${part.ref || part.id}.${pad.num}`,
        partId: part.ref || part.id,
      });
    }
  }
  for (const pad of board.freePads) {
    items.push({
      shape: padShape(pad), net: pad.net, layer: pad.through ? 0 : layerOf(pad.layer),
      label: `pad ${pad.id}`, partId: '',
    });
  }
  for (const t of board.tracks) {
    for (const s of trackShapes(t)) {
      items.push({ shape: s, net: t.net, layer: t.layerId, label: `track ${t.id}`, partId: '' });
    }
  }
  for (const v of board.vias) {
    items.push({ shape: viaShape(v), net: v.net, layer: 0, label: `via ${v.id}`, partId: '' });
  }
  return items;
}

function checkClearance(board, clearance, findings) {
  const items = copperItems(board);
  // One finding per item PAIR, at the MINIMUM gap. A track polyline is
  // several segment items under one label; keeping the first sub-clearance
  // segment hid an actual overlap behind an 0.085 mm near-miss of an
  // earlier segment of the same track (measured, FIXED board, first run).
  const byPair = new Map();
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]; const b = items[j];
      if (!a.net || !b.net || a.net === b.net) continue;
      if (a.layer && b.layer && a.layer !== b.layer) continue;
      const d = shapeDist(a.shape, b.shape);
      if (d >= clearance) continue;
      const pairKey = [a.label, b.label].sort().join('~');
      const prev = byPair.get(pairKey);
      if (!prev || d < prev.d) byPair.set(pairKey, { a, b, d });
    }
  }
  const results = [...byPair.values()];
  results.sort((x, y) => x.d - y.d);
  const MAX = 40;
  for (const { a, b, d } of results.slice(0, MAX)) {
    const overlap = d === 0;
    findings.push(finding(overlap ? 'danger' : 'warning', 'clearance', a.partId || b.partId,
      overlap
        ? `${a.label} (${a.net}) and ${b.label} (${b.net}) OVERLAP — a hard short between nets.`
        : `${a.label} (${a.net}) is ${d.toFixed(3)} mm from ${b.label} (${b.net}); the clearance rule is ${clearance} mm.`,
      { gap: d, nets: [a.net, b.net] }));
  }
  if (results.length > MAX) {
    findings.push(finding('info', 'clearance', '',
      `${results.length - MAX} further clearance findings suppressed (worst ${MAX} shown).`));
  }
}

// ── rule 5: outline ────────────────────────────────────────────────

function checkOutline(board, findings) {
  if (!board.outline.length) {
    findings.push(finding('danger', 'outline-open', '',
      'The board has no outline (layer 10 is empty). A fab cannot cut what is not drawn.'));
    return;
  }
  // Every segment endpoint must meet another endpoint. Endpoints are
  // matched within 10 µm — EasyEDA writes shared vertices exactly, so the
  // tolerance only forgives float noise, not real gaps.
  const TOL = 0.01;
  const ends = [];
  for (const seg of board.outline) {
    ends.push([seg.x1, seg.y1], [seg.x2, seg.y2]);
  }
  const used = new Array(ends.length).fill(false);
  const lonely = [];
  for (let i = 0; i < ends.length; i++) {
    if (used[i]) continue;
    let mate = -1;
    for (let j = 0; j < ends.length; j++) {
      if (i === j || used[j]) continue;
      if (Math.hypot(ends[i][0] - ends[j][0], ends[i][1] - ends[j][1]) <= TOL) { mate = j; break; }
    }
    if (mate >= 0) { used[i] = used[mate] = true; } else { lonely.push(ends[i]); }
  }
  if (lonely.length) {
    const spots = lonely.map(([x, y]) => `(${x.toFixed(1)}, ${y.toFixed(1)})`).join(', ');
    findings.push(finding('danger', 'outline-open', '',
      `The board outline is not a closed loop: ${lonely.length} loose end(s) at ${spots} mm. `
      + 'A fab rejects an open outline, or mills something you did not mean.',
      { looseEnds: lonely }));
  }
}

// ── rule 6: silk legend ────────────────────────────────────────────

function checkLegends(board, findings) {
  for (const part of board.parts) {
    const rec = recognizePackage(part.package, part.ref);
    if (!rec || rec.kind !== 'header') continue;
    // A legend = any VISIBLE silk text beyond the bare refdes, on the part
    // or near it (within 10 mm of the part origin) — pin names, "SDA",
    // "GND", a "1". The refdes alone does not say which pin is which.
    const own = part.silk.texts.filter((t) => t.display && t.kind === 'L' && t.text.trim());
    const near = board.silk.texts.filter((t) => t.display && t.text.trim()
      && Math.hypot(t.x - part.x, t.y - part.y) < 10);
    if (own.length + near.length === 0) {
      findings.push(finding('warning', 'no-legend', part.ref || part.id,
        `${part.ref || part.id}: a ${part.pads.length}-pin connector with no pin legend on the silk. `
        + 'Whoever plugs the module in has to guess the rail orientation, and a reversed '
        + 'rail kills the module (plan §1: it happened).'));
    }
  }
}

// ── rule 7: unfinished nets ────────────────────────────────────────

function checkUnfinishedNets(board, findings) {
  const padsByNet = new Map();
  const eat = (pad, ref) => {
    if (!pad.net) return;
    if (!padsByNet.has(pad.net)) padsByNet.set(pad.net, []);
    padsByNet.get(pad.net).push(`${ref}.${pad.num}`);
  };
  for (const part of board.parts) for (const pad of part.pads) eat(pad, part.ref || part.id);
  for (const pad of board.freePads) eat(pad, pad.id);
  for (const [net, pads] of padsByNet) {
    if (pads.length === 1) {
      findings.push(finding('warning', 'unfinished-net', pads[0].split('.')[0],
        `Net ${net} reaches exactly one pad (${pads[0]}). On a board a one-pad net `
        + 'drives nothing; either the second end was never routed, or the label is stale.',
        { net }));
    }
  }
}

// ── rule 8: schematic pairing ──────────────────────────────────────

function checkSchematic(board, schematic, copper, findings) {
  const lift = liftBoardToCircuit(board, { copper });
  const d = diffBoardAgainstSchematic(schematic, lift);
  for (const s of d.splits) {
    findings.push(finding('danger', 'sch-split', s.net[0].split('.')[0],
      `The schematic connects ${s.net.join(', ')} as ONE net; the board leaves it as `
      + `${s.islands.length} pieces: ${s.islands.map((i) => `[${i.join(', ')}]`).join(' vs ')}.`));
  }
  for (const b of d.bridges) {
    if (b.severity !== 'error') continue;
    findings.push(finding('danger', 'sch-bridge', b.island[0].split('.')[0],
      `The board joins what the schematic keeps apart: ${b.nets.map((n) => `[${n.join(', ')}]`).join(' + ')} `
      + 'are one piece of copper.'));
  }
  for (const v of d.vocabularyMismatch) {
    findings.push(finding('info', 'sch-vocabulary', v.ref,
      `${v.ref} could not be cross-checked: the schematic reads it as ${v.schKind}, `
      + `the board footprint as ${v.boardKind}. If the footprint is a stand-in `
      + '(a diode in a resistor footprint), that is worth knowing before fab.'));
  }
  for (const ref of d.onlySchematic) {
    findings.push(finding('warning', 'sch-split', ref,
      `${ref} is in the schematic but not on the board.`));
  }
}

/**
 * @param {object} board  importEasyEdaPcb output
 * @param {object} [opts]
 * @param {number} [opts.clearance]  mm, default EasyEDA's 0.152
 * @param {object} [opts.schematic]  paired importEasyEda output (optional)
 * @param {object} [opts.copper]     precomputed copper netlist (optional)
 * @returns {Array<{severity, rule, partId, explanation}>}
 */
export function runPcbDrc(board, opts = {}) {
  const findings = [];
  const clearance = opts.clearance ?? DEFAULT_CLEARANCE_MM;
  const copper = opts.copper || computeCopperNetlist(board);
  checkTerminalShorts(board, findings);
  checkCopper(board, copper, findings);
  checkClearance(board, clearance, findings);
  checkOutline(board, findings);
  checkLegends(board, findings);
  checkUnfinishedNets(board, findings);
  if (opts.schematic) checkSchematic(board, opts.schematic, copper, findings);
  const rank = { danger: 0, warning: 1, info: 2 };
  findings.sort((a, b) => (rank[a.severity] - rank[b.severity]) || a.rule.localeCompare(b.rule));
  return findings;
}

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

/** KiCad's machine-generated single-pad net names — no drawn intent. */
const isMachineNet = (net) => /^(Net-|unconnected-)\(.+\)$/.test(net);

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
  // Islands joined INSIDE a part are one node once soldered: pads sharing
  // a terminal (via the land pattern's map, or KiCad's same-number
  // convention) merge for the net-island verdict. This is physics, not
  // leniency — a tact switch's unrouted twin pad is normal practice, and
  // KiCad assigns the net to BOTH same-numbered pads while routing one;
  // without the merge, every healthy KiCad board reads as split nets
  // (§7.2: a warning that fires on healthy designs stops being read).
  // copper-short stays PER PHYSICAL ISLAND: internal joins cannot excuse
  // two nets on one piece of board copper.
  const islandGroup = Array.from({ length: copper.islands.length }, (_, i) => i);
  const rootOf = (i) => { let r = i; while (islandGroup[r] !== r) r = islandGroup[r]; islandGroup[i] = r; return r; };
  const unite = (a, b) => { const ra = rootOf(a); const rb = rootOf(b); if (ra !== rb) islandGroup[ra] = rb; };
  // Keyed by the pad's unique id: KiCad footprints legitimately carry
  // duplicate pad NUMBERS (1,1,2,2 on a tact switch), which would collide.
  const islandOfPad = new Map();
  copper.islands.forEach((isl, i) => {
    for (const p of isl.pads) if (p.padId) islandOfPad.set(p.padId, i);
  });
  for (const part of board.parts) {
    const rec = recognizePackage(part.package, part.ref);
    const pattern = rec && rec.variant ? getLandPattern(rec.kind, rec.variant) : null;
    const byTerminal = new Map();
    for (const pad of part.pads) {
      const t = pattern ? (padTerminal(pattern, pad.num) ?? `num:${pad.num}`) : `num:${pad.num}`;
      if (!byTerminal.has(t)) byTerminal.set(t, []);
      byTerminal.get(t).push(pad);
    }
    for (const pads of byTerminal.values()) {
      const islands = pads.map((p) => islandOfPad.get(p.id)).filter((i) => i !== undefined);
      for (let i = 1; i < islands.length; i++) unite(islands[0], islands[i]);
    }
  }

  for (const island of copper.islands) {
    if (island.nets.length >= 2) {
      const byNet = new Map();
      for (const p of island.pads) {
        if (!p.net) continue;
        if (!byNet.has(p.net)) byNet.set(p.net, []);
        byNet.get(p.net).push(`${p.ref || '?'}.${p.num}`);
      }
      const detail = [...byNet.entries()].map(([net, pads]) => `${net} (${pads.join(', ')})`).join(' — ');
      // A machine-named net is a pad nothing was DRAWN to. When at most
      // one net on the island is real, the pattern is an alternate-
      // position footprint pad (a TRRS jack's two orientations) or a
      // test pad sitting on live copper — deliberately coincident on
      // shipped boards. That stays a warning; two REAL nets on one
      // copper stays a danger.
      const realNets = island.nets.filter((n) => !isMachineNet(n));
      const sev = realNets.length >= 2 ? 'danger' : 'warning';
      findings.push(finding(sev, 'copper-short', island.pads[0]?.ref || '',
        `One piece of copper joins ${island.nets.length} nets: ${detail}. `
        + (sev === 'danger'
          ? 'Somewhere along it, copper of different nets touches.'
          : 'Only one is a drawn net; the rest are auto-named pads sitting on its copper '
            + '(an alternate-position footprint pad, or a test pad) — deliberate on most boards, but look once.'),
        { nets: island.nets }));
    }
  }
  for (const [net, islandIdxAll] of Object.entries(copper.netIslands)) {
    // Collapse to internally-merged groups before judging.
    const byRoot = new Map();
    for (const i of islandIdxAll) {
      const r = rootOf(i);
      if (!byRoot.has(r)) byRoot.set(r, []);
      byRoot.get(r).push(i);
    }
    if (byRoot.size < 2) continue;
    const islandIdx = [...byRoot.values()].map((g) => g[0]);
    const groups = [...byRoot.values()].map((g) => g.flatMap((i) => copper.islands[i].pads
      .filter((p) => p.net === net).map((p) => `${p.ref || '?'}.${p.num}`)));
    groups.sort((a, b) => a.length - b.length);
    const approx = islandIdxAll.some((i) => copper.islands[i].approxPour);
    findings.push(finding('danger', 'net-island', groups[0][0]?.split('.')[0] || '',
      `Net ${net} is ${byRoot.size} separate copper islands: `
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
    items.push({
      shape: viaShape(v), net: v.net, layer: 0, layers: v.layers || null,
      label: `via ${v.id}`, partId: '',
    });
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
      if (a.layers && b.layers ? !a.layers.some((l) => b.layers.includes(l))
        : a.layers ? (b.layer && !a.layers.includes(b.layer))
          : b.layers ? (a.layer && !b.layers.includes(a.layer))
            : (a.layer && b.layer && a.layer !== b.layer)) continue;
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
  // tolerance only forgives float noise, not real gaps. "Meets" is a
  // CLUSTER test, not greedy pairing: duplicated outline segments (drawn
  // twice, seen in the wild) put three or more ends on one vertex, and
  // greedy pairing would starve one of them into a phantom loose end.
  const TOL = 0.01;
  const ends = [];
  for (let s = 0; s < board.outline.length; s++) {
    const seg = board.outline[s];
    ends.push({ p: [seg.x1, seg.y1], seg: s }, { p: [seg.x2, seg.y2], seg: s });
  }
  const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= TOL;
  const lonely = [];
  const overlapping = new Set();
  for (let i = 0; i < ends.length; i++) {
    if (ends.some((e, j) => j !== i && near(ends[i].p, e.p))) continue;
    // No mate. The rounded-corner idiom: users draw a CLOSED ring, then
    // lay corner arcs on top of it — the arc's ends land mid-edge on the
    // ring, on another segment's body. That outline is closed (the ring
    // is), so it is an overlap note, not an open outline.
    const [px, py] = ends[i].p;
    const onBody = board.outline.some((o, s2) => {
      if (s2 === ends[i].seg) return false;
      const dx = o.x2 - o.x1; const dy = o.y2 - o.y1;
      const L2 = dx * dx + dy * dy;
      if (!L2) return near([px, py], [o.x1, o.y1]);
      const t = Math.max(0, Math.min(1, ((px - o.x1) * dx + (py - o.y1) * dy) / L2));
      return Math.hypot(px - (o.x1 + t * dx), py - (o.y1 + t * dy)) <= TOL;
    });
    if (onBody) overlapping.add(ends[i].seg);
    else lonely.push(ends[i].p);
  }
  // Split the loose ends by gap size: two ends within 0.1 mm of each
  // other are a HAIRLINE gap (hand-drawn outlines carry tens of µm of
  // slop; fabs heal those silently) — a warning. Anything wider is a
  // real hole in the contour — a danger.
  const HEAL = 0.1;
  const open = [];
  const hairline = [];
  const taken = new Array(lonely.length).fill(false);
  for (let i = 0; i < lonely.length; i++) {
    if (taken[i]) continue;
    let mate = -1; let best = Infinity;
    for (let j = i + 1; j < lonely.length; j++) {
      if (taken[j]) continue;
      const d = Math.hypot(lonely[i][0] - lonely[j][0], lonely[i][1] - lonely[j][1]);
      if (d <= HEAL && d < best) { best = d; mate = j; }
    }
    if (mate >= 0) { taken[i] = taken[mate] = true; hairline.push({ at: lonely[i], gap: best }); }
    else open.push(lonely[i]);
  }
  if (open.length) {
    const spots = open.map(([x, y]) => `(${x.toFixed(1)}, ${y.toFixed(1)})`).join(', ');
    findings.push(finding('danger', 'outline-open', '',
      `The board outline is not a closed loop: ${open.length} loose end(s) at ${spots} mm. `
      + 'A fab rejects an open outline, or mills something you did not mean.',
      { looseEnds: open }));
  }
  if (hairline.length) {
    const spots = hairline.map((h) => `(${h.at[0].toFixed(1)}, ${h.at[1].toFixed(1)}): ${(h.gap * 1000).toFixed(0)} µm`).join(', ');
    findings.push(finding('warning', 'outline-gap', '',
      `The outline has ${hairline.length} hairline gap(s) — ${spots}. Fabs heal gaps this small `
      + 'automatically, but the contour is not exactly closed as drawn.',
      { gaps: hairline }));
  }
  if (overlapping.size) {
    findings.push(finding('info', 'outline-overlap', '',
      `${overlapping.size} outline segment(s) end on the body of another outline segment `
      + '(the rounded-corner-over-a-closed-ring drawing idiom). The outline is closed, but the fab '
      + 'sees two contours where these overlap — worth a look before ordering.',
      { segments: [...overlapping] }));
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
      // KiCad spells "this pin is unconnected" as a machine-named
      // single-pad net -- Net-(U1-Pad20) up to v7, unconnected-(U1-...) from
      // v8. Every IC with spare pins carries dozens; that is a statement of
      // intent, not a missing route. The rule fires only on HUMAN-named
      // nets (a VCC reaching one pad was meant to reach more).
      if (/^(Net-|unconnected-)\(.+\)$/.test(net)) continue;
      // A pour carrying the net IS its second consumer: a touch-sensor
      // electrode is one pin plus its comb (measured, tomu's cap pads).
      if ((board.pours || []).some((z) => z.net === net)) continue;
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

/**
 * KiCad PCB writer (`.kicad_pcb`) — the second exporter of plan Phase 5.
 *
 * Two jobs: hand a BrickWright board to a KiCad user, and unlock the
 * INDEPENDENT DRC ORACLE — `kicad-cli pcb drc` is a foreign-authored exact
 * checker, and a router gated by two unrelated checkers cannot inherit a
 * blind spot from either (scripts/kicad-oracle.mjs runs it where a KiCad
 * install exists).
 *
 * Emit-only and deliberately conservative:
 *
 *   - every footprint is written at ROTATION 0 with absolute pad offsets.
 *     Our model stores pads absolute, so nothing is lost — and KiCad's
 *     pad-angle-is-absolute quirk (the classic import trap) can never
 *     bite a file that contains no rotations.
 *   - arcs go out as KiCad's 3-POINT form (start/mid/end, midpoint from
 *     arcPointAt(t = 0.5)); three points survive any Y convention
 *     unambiguously, which no sweep flag does.
 *   - a pour fill group WITH holes is exported as an unfilled zone
 *     outline (KiCad refills on open — its filled_polygons are fractured
 *     simple rings, and writing our holed groups as rings would turn the
 *     holes back into copper). A single-ring group exports as the exact
 *     filled_polygon. The loss is reported in the returned warnings, not
 *     swallowed.
 *
 * Frame: model mm/Y-up/origin-bottom-left → KiCad mm/Y-down at a page
 * offset of (20, 20) so everything lands on the sheet.
 *
 * @module
 */

import { arcPointAt } from '../pcb-geometry.js';

const OFF = 20;

const fmt = (n) => {
  const r = Math.round(n * 10000) / 10000;
  return Object.is(r, -0) ? '0' : String(r);
};
const q = (s) => `"${String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/**
 * @param {object} board  board model (importer or projection output)
 * @param {object} [opts] {title}
 * @returns {{text: string, warnings: string[]}}
 */
export function exportKicadPcb(board, opts = {}) {
  const warnings = [];
  const H = board.bbox?.h ?? 0;
  const X = (x) => fmt(OFF + x);
  const Y = (y) => fmt(OFF + (H - y));

  // Net registry: 0 is KiCad's "no net", always present.
  const netIds = new Map([['', 0]]);
  const netOf = (name) => {
    const key = name || '';
    if (!netIds.has(key)) netIds.set(key, netIds.size);
    return netIds.get(key);
  };
  for (const p of board.parts || []) for (const pad of p.pads) netOf(pad.net);
  for (const pad of board.freePads || []) netOf(pad.net);
  for (const t of board.tracks || []) netOf(t.net);
  for (const v of board.vias || []) netOf(v.net);
  for (const z of board.pours || []) netOf(z.net);

  // Inner copper keeps its identity: layer ids above 2 are inner layers
  // (importer numbering varies by format — 20+n for KiCad, 15..18 for
  // Pro), named In1..InN.Cu by stack position. Collapsing them onto
  // F.Cu welded a 4-layer board's power and ground planes into one
  // island on re-import (measured, upduino round-trip).
  const innerIds = [...new Set((board.copperLayers || []).filter((id) => id > 2))].sort((a, b) => a - b);
  const innerName = new Map(innerIds.map((id, i) => [id, `In${i + 1}.Cu`]));
  const cuNameOf = (id, layer) => ((id === 2 || layer === 'bottom') ? 'B.Cu' : innerName.get(id) || 'F.Cu');
  const layerOut = (t) => cuNameOf(t.layerId, t.layer);

  const body = [];

  // ── footprints ───────────────────────────────────────────────────
  for (const part of board.parts || []) {
    const fp = [];
    fp.push(`(footprint ${q(part.package || 'bw:part')} (layer ${part.side === 'bottom' ? '"B.Cu"' : '"F.Cu"'})`);
    fp.push(`  (at ${X(part.x)} ${Y(part.y)})`);
    const refText = part.silk?.texts?.find((t) => t.kind === 'P');
    const refAt = refText ? `(at ${fmt(refText.x - part.x)} ${fmt(-(refText.y - part.y))})` : '(at 0 -3)';
    fp.push(`  (property "Reference" ${q(part.ref || part.id)} ${refAt} (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))`);
    fp.push(`  (property "Value" ${q(part.name || '')} (at 0 3) (layer "F.Fab") (effects (font (size 1 1) (thickness 0.15))))`);
    fp.push(`  (attr through_hole)`);
    for (const t of part.silk?.tracks || []) {
      for (let i = 0; i + 1 < t.points.length; i++) {
        fp.push(`  (fp_line (start ${fmt(t.points[i][0] - part.x)} ${fmt(-(t.points[i][1] - part.y))}) `
          + `(end ${fmt(t.points[i + 1][0] - part.x)} ${fmt(-(t.points[i + 1][1] - part.y))}) `
          + `(stroke (width ${fmt(t.width || 0.12)}) (type solid)) (layer "F.SilkS"))`);
      }
    }
    for (const rc of part.silk?.rects || []) {
      const cs = [
        [rc.x, rc.y], [rc.x + rc.w, rc.y], [rc.x + rc.w, rc.y + rc.h], [rc.x, rc.y + rc.h], [rc.x, rc.y],
      ].map(([px, py]) => [px - part.x, -(py - part.y)]);
      for (let i = 0; i + 1 < cs.length; i++) {
        fp.push(`  (fp_line (start ${fmt(cs[i][0])} ${fmt(cs[i][1])}) (end ${fmt(cs[i + 1][0])} ${fmt(cs[i + 1][1])}) `
          + '(stroke (width 0.12) (type solid)) (layer "F.SilkS"))');
      }
    }
    for (const c of part.silk?.circles || []) {
      fp.push(`  (fp_circle (center ${fmt(c.cx - part.x)} ${fmt(-(c.cy - part.y))}) `
        + `(end ${fmt(c.cx - part.x + c.r)} ${fmt(-(c.cy - part.y))}) `
        + '(stroke (width 0.12) (type solid)) (fill none) (layer "F.SilkS"))');
    }
    for (const t of part.silk?.texts || []) {
      if (t.kind !== 'L' || t.display === false || !t.text) continue;
      fp.push(`  (fp_text user ${q(t.text)} (at ${fmt(t.x - part.x)} ${fmt(-(t.y - part.y))}) `
        + '(layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))');
    }
    for (const pad of part.pads) {
      fp.push('  ' + padOut(pad, part, netIds, warnings));
    }
    fp.push(')');
    body.push(fp.join('\n'));
  }
  for (const pad of board.freePads || []) {
    // KiCad has no free pads; wrap each in a one-pad anonymous footprint.
    body.push(`(footprint "bw:free-pad" (layer "F.Cu")\n  (at ${X(pad.x)} ${Y(pad.y)})\n  (attr through_hole)\n  `
      + padOut(pad, { x: pad.x, y: pad.y }, netIds, warnings) + '\n)');
  }

  for (const h of board.holes || []) {
    // KiCad spells a free mounting hole as a footprint with one unplated pad.
    body.push(`(footprint "bw:hole" (layer "F.Cu")\n  (at ${X(h.x)} ${Y(h.y)})\n  (attr through_hole exclude_from_pos_files exclude_from_bom)\n`
      + `  (pad "" np_thru_hole circle (at 0 0) (size ${fmt(h.diameter)} ${fmt(h.diameter)}) (drill ${fmt(h.diameter)}) (layers "*.Cu" "*.Mask"))\n)`);
  }

  // ── copper ───────────────────────────────────────────────────────
  for (const t of board.tracks || []) {
    for (let i = 0; i + 1 < t.points.length; i++) {
      body.push(`(segment (start ${X(t.points[i][0])} ${Y(t.points[i][1])}) `
        + `(end ${X(t.points[i + 1][0])} ${Y(t.points[i + 1][1])}) `
        + `(width ${fmt(t.width)}) (layer ${q(layerOut(t))}) (net ${netOf(t.net)}))`);
    }
  }
  for (const a of board.arcs || []) {
    for (const s of a.segs || []) {
      if (s.type !== 'arc') {
        body.push(`(segment (start ${X(s.x1)} ${Y(s.y1)}) (end ${X(s.x2)} ${Y(s.y2)}) `
          + `(width ${fmt(a.width || 0.254)}) (layer ${q(cuNameOf(a.layerId))}) (net ${netOf(a.net)}))`);
        continue;
      }
      const [mx, my] = arcPointAt(s, 0.5);
      body.push(`(arc (start ${X(s.x1)} ${Y(s.y1)}) (mid ${X(mx)} ${Y(my)}) (end ${X(s.x2)} ${Y(s.y2)}) `
        + `(width ${fmt(a.width || 0.254)}) (layer ${q(cuNameOf(a.layerId))}) (net ${netOf(a.net)}))`);
    }
  }
  for (const v of board.vias || []) {
    // A spanned via (blind/micro, v.layers = copper ids) keeps its span:
    // writing it as through-all would manufacture connectivity the source
    // board does not have, and the round-trip oracle would catch it.
    const lname = (id) => (id === 1 ? 'F.Cu' : id === 2 ? 'B.Cu' : innerName.get(id) || 'F.Cu');
    const span = v.layers && v.layers.length
      ? `(layers "${lname(v.layers[0])}" "${lname(v.layers[v.layers.length - 1])}")`
      : '(layers "F.Cu" "B.Cu")';
    const kind = v.layers && v.layers.length ? 'blind ' : '';
    body.push(`(via ${kind}(at ${X(v.x)} ${Y(v.y)}) (size ${fmt(v.diameter)}) (drill ${fmt(v.drill)}) `
      + `${span} (net ${netOf(v.net)}))`);
  }
  for (const z of board.pours || []) {
    const layer = cuNameOf(z.layerId, z.layer);
    const ring = (pts) => `(pts ${pts.map(([x, y]) => `(xy ${X(x)} ${Y(y)})`).join(' ')})`;
    const zone = [`(zone (net ${netOf(z.net)}) (net_name ${q(z.net)}) (layer ${q(layer)}) `
      + `(connect_pads (clearance ${fmt(z.clearance || 0.2)})) (min_thickness 0.2)`];
    zone.push(`  (fill yes (thermal_gap 0.3) (thermal_bridge_width 0.3))`);
    zone.push(`  (polygon ${ring(z.outline || [])})`);
    let holed = 0;
    for (const group of z.fills || []) {
      if (group.length === 1) zone.push(`  (filled_polygon (layer ${q(layer)}) ${ring(group[0])})`);
      else holed++;
    }
    if (holed) {
      warnings.push(`Zone ${z.net}: ${holed} fill group(s) with holes exported as unfilled outline — refill in KiCad (holes cannot be written as fractured rings without a fracture pass).`);
    }
    zone.push(')');
    body.push(zone.join('\n'));
  }

  // ── outline and free silk/text ───────────────────────────────────
  for (const s of board.outline || []) {
    if (s.type === 'arc') {
      const [mx, my] = arcPointAt(s, 0.5);
      body.push(`(gr_arc (start ${X(s.x1)} ${Y(s.y1)}) (mid ${X(mx)} ${Y(my)}) (end ${X(s.x2)} ${Y(s.y2)}) `
        + '(stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))');
    } else {
      body.push(`(gr_line (start ${X(s.x1)} ${Y(s.y1)}) (end ${X(s.x2)} ${Y(s.y2)}) `
        + '(stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))');
    }
  }
  for (const t of board.silk?.tracks || []) {
    for (let i = 0; i + 1 < t.points.length; i++) {
      body.push(`(gr_line (start ${X(t.points[i][0])} ${Y(t.points[i][1])}) `
        + `(end ${X(t.points[i + 1][0])} ${Y(t.points[i + 1][1])}) `
        + `(stroke (width ${fmt(t.width || 0.12)}) (type solid)) (layer ${q(t.layerId === 4 ? 'B.SilkS' : 'F.SilkS')}))`);
    }
  }
  for (const t of board.silk?.texts || []) {
    if (t.display === false || !t.text) continue;
    body.push(`(gr_text ${q(t.text)} (at ${X(t.x)} ${Y(t.y)}) (layer ${q(t.layerId === 4 ? 'B.SilkS' : 'F.SilkS')}) `
      + '(effects (font (size 1 1) (thickness 0.15))))');
  }

  const netDecls = [...netIds.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([name, idNum]) => `(net ${idNum} ${q(name)})`);

  const text = [
    '(kicad_pcb (version 20221018) (generator "bw-circuit-ui")',
    '  (general (thickness 1.6))',
    '  (paper "A4")',
    `  (title_block (title ${q(opts.title ?? 'brickwright-board')}))`,
    '  (layers',
    '    (0 "F.Cu" signal)',
    ...innerIds.map((id, i) => `    (${i + 1} "In${i + 1}.Cu" signal)`),
    '    (31 "B.Cu" signal)',
    '    (36 "B.SilkS" user "B.Silkscreen")',
    '    (37 "F.SilkS" user "F.Silkscreen")',
    '    (38 "B.Mask" user "B.Mask")',
    '    (39 "F.Mask" user "F.Mask")',
    '    (44 "Edge.Cuts" user)',
    '    (46 "B.Fab" user)',
    '    (47 "F.Fab" user)',
    '  )',
    '  (setup (pad_to_mask_clearance 0))',
    ...netDecls.map((n) => '  ' + n),
    ...body.map((b) => b.split('\n').map((l) => '  ' + l).join('\n')),
    ')',
  ].join('\n');
  return { text, warnings };
}

function padOut(pad, part, netIds, warnings) {
  const dx = fmt(pad.x - part.x);
  const dy = fmt(-(pad.y - part.y)); // footprint frame is Y-down too
  let shape = { circle: 'circle', rect: 'rect', oval: 'oval', polygon: 'rect' }[pad.shape] || 'circle';
  // A cornerRadius pad is a real roundrect in KiCad's vocabulary.
  const rrOut = pad.cornerRadius > 0 && shape === 'rect'
    ? ` (roundrect_rratio ${fmt(pad.cornerRadius / Math.min(pad.w, pad.h))})` : '';
  if (rrOut) shape = 'roundrect';
  if (pad.shape === 'polygon') {
    warnings.push(`pad ${pad.num}: polygon pad exported as its bounding rect (custom-pad primitives are a later fidelity step).`);
    shape = 'rect';
  }
  const type = pad.through ? 'thru_hole' : 'smd';
  const layers = pad.through ? '"*.Cu" "*.Mask"'
    : pad.layer === 'bottom' ? '"B.Cu" "B.Paste" "B.Mask"' : '"F.Cu" "F.Paste" "F.Mask"';
  let drill = pad.through && pad.drill ? ` (drill ${fmt(pad.drill)})` : '';
  if (pad.through && pad.slotLength > pad.drill) {
    // A slot: (drill oval W H) in the pad's own frame. The slot axis
    // relative to the pad angle decides which dimension is which.
    const alongX = (((pad.slotRotation ?? 0) - (pad.rotation ?? 0)) % 180 + 180) % 180 < 45
      || (((pad.slotRotation ?? 0) - (pad.rotation ?? 0)) % 180 + 180) % 180 > 135;
    drill = alongX
      ? ` (drill oval ${fmt(pad.slotLength)} ${fmt(pad.drill)})`
      : ` (drill oval ${fmt(pad.drill)} ${fmt(pad.slotLength)})`;
  }
  const netId = netIds.get(pad.net || '') ?? 0;
  const net = pad.net ? ` (net ${netId} "${String(pad.net).replace(/"/g, '')}")` : '';
  // Model pad rotation is the EasyEDA raw angle (padShape negates it in the
  // Y-up frame); KiCad's Y-down frame matches the raw sense again.
  const rot = pad.rotation ? ` ${fmt(pad.rotation)}` : '';
  return `(pad ${q(pad.num)} ${type} ${shape} (at ${dx} ${dy}${rot}) (size ${fmt(pad.w)} ${fmt(pad.h)})${rrOut}${drill} (layers ${layers})${net})`;
}

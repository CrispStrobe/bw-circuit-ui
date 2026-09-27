/** Deterministic fabrication-readiness report for a board export. */

import { runPcbDrc } from './pcb-drc.js';

const sortedNumbers = (values) => [...new Set(values.filter(Number.isFinite))].sort((a, b) => a - b);

export function fabricationPreflight(board, { findings = null, unrouted = [], exportId = null } = {}) {
  const drc = findings || runPcbDrc(board);
  const openOutline = drc.filter((finding) => finding.rule === 'outline-open');
  const danger = drc.filter((finding) => finding.severity === 'danger');
  const unfinished = drc.filter((finding) => finding.rule === 'unfinished-net')
    .map((finding) => finding.net).filter(Boolean);
  const unroutedNets = [...new Set([...(unrouted || []), ...unfinished])].sort();

  const drills = [];
  const slots = [];
  const consumePad = (pad, source) => {
    if (!(pad.drill > 0)) return;
    const rec = { source, diameter: pad.drill, plated: pad.plated !== false };
    if (pad.slotLength > pad.drill) slots.push({ ...rec, length: pad.slotLength });
    else drills.push(rec);
  };
  for (const part of board.parts || []) {
    for (const pad of part.pads || []) consumePad(pad, `${part.ref || part.id}.${pad.num}`);
  }
  for (const pad of board.freePads || []) consumePad(pad, pad.id || pad.num || 'free-pad');
  for (const via of board.vias || []) drills.push({ source: via.id || 'via', diameter: via.drill, plated: true, via: true });
  for (const hole of board.holes || []) drills.push({ source: hole.id || 'hole', diameter: hole.diameter, plated: false });

  const copperIds = [...new Set((board.copperLayers?.length ? board.copperLayers : [1, 2]))].sort((a, b) => a - b);
  const layerNames = copperIds.map((id, index) => id === 1 ? 'top' : id === 2 ? 'bottom' : `inner-${index - 1}`);
  const checks = [
    { id: 'outline', ok: openOutline.length === 0, label: 'Outline closed', detail: openOutline.length ? `${openOutline.length} open-outline finding(s)` : `${(board.outline || []).length} boundary segment(s)` },
    { id: 'danger-drc', ok: danger.length === 0, label: 'Zero danger DRC', detail: danger.length ? `${danger.length} danger finding(s)` : `${drc.length} total finding(s), none danger` },
    { id: 'unrouted', ok: unroutedNets.length === 0, label: 'Zero unrouted nets', detail: unroutedNets.length ? unroutedNets.join(', ') : '0 unrouted' },
  ];

  return {
    ready: checks.every((check) => check.ok),
    checks,
    drills: {
      roundCount: drills.length,
      slotCount: slots.length,
      platedCount: drills.filter((drill) => drill.plated).length + slots.filter((slot) => slot.plated).length,
      unplatedCount: drills.filter((drill) => !drill.plated).length + slots.filter((slot) => !slot.plated).length,
      roundDiametersMm: sortedNumbers(drills.map((drill) => drill.diameter)),
      slots: slots.map(({ diameter, length, plated }) => ({ diameter, length, plated })),
    },
    stackup: { copperLayerCount: copperIds.length, copperLayerIds: copperIds, layerNames },
    provenance: {
      generator: 'bw-circuit-ui', contract: 'fabrication-preflight-v1',
      boardFormat: board.format || 'unknown', exportId: exportId || null,
    },
    unroutedNets,
    dangerRules: [...new Set(danger.map((finding) => finding.rule))].sort(),
  };
}

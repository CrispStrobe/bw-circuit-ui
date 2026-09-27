/**
 * Explicit SMD-to-breadboard carrier assemblies.
 *
 * A bare surface-mount package is never breadboard-seat-able.  Mounting one
 * on a carrier is a separate, persisted physical choice: the device keeps its
 * electrical kind while the carrier contributes 0.1-inch header legs.  Pin
 * numbers are preserved one-to-one; terminal names come from the audited
 * physical sidecar order rather than being guessed from function names.
 */

import { getSidecar } from './parts-registry.js';

export const CARRIERS = Object.freeze({
  'soic8-dip8': Object.freeze({
    label: 'SOIC-8 to DIP-8 breakout',
    package: 'SOIC-8',
    inputPitchMm: 1.27,
    headerPitchMm: 2.54,
    sourcing: 'vendor-neutral',
    pinCount: 8,
    layout: 'dip',
    compatibleKinds: Object.freeze(['lt1006', 'adtl082', 'lt1678', 'adp7118', 'lt1763']),
  }),
  'soic14-dip14': Object.freeze({
    label: 'SOIC-14 to DIP-14 breakout',
    package: 'SOIC-14',
    inputPitchMm: 1.27,
    headerPitchMm: 2.54,
    sourcing: 'vendor-neutral',
    pinCount: 14,
    layout: 'dip',
    compatibleKinds: Object.freeze(['op747']),
  }),
  'tsot5-header5': Object.freeze({
    label: 'TSOT-5 to 0.1-inch breakout',
    package: 'TSOT-5',
    inputPitchMm: 0.95,
    headerPitchMm: 2.54,
    sourcing: 'vendor-neutral',
    pinCount: 5,
    layout: 'single-row',
    compatibleKinds: Object.freeze(['adp151']),
  }),
});

export function carrierOptionsForPart(part) {
  if (!part || part.sourcePackage === 'unspecified') return [];
  return Object.entries(CARRIERS)
    .filter(([, carrier]) => carrier.compatibleKinds.includes(part.kind))
    .map(([id, carrier]) => ({ id, label: carrier.label }));
}

export function carrierForPart(part) {
  if (!part || part.sourcePackage === 'unspecified') return null;
  const carrier = part && CARRIERS[part.carrier];
  if (!carrier || !carrier.compatibleKinds.includes(part.kind)) return null;
  const terminals = getSidecar(part.kind)?.terminals || [];
  return terminals.length === carrier.pinCount ? carrier : null;
}

/** Build the breadboard footprint of the combined device+carrier assembly. */
export function carrierFootprintForPart(part) {
  const carrier = carrierForPart(part);
  if (!carrier) return null;
  const terminals = getSidecar(part.kind).terminals.map((terminal) => terminal.name);
  const leads = {};
  if (carrier.layout === 'dip') {
    const half = carrier.pinCount / 2;
    for (let i = 0; i < half; i++) leads[terminals[i]] = { dRow: 0, dCol: i };
    for (let i = half; i < carrier.pinCount; i++) {
      leads[terminals[i]] = { dRow: 5, dCol: carrier.pinCount - 1 - i };
    }
    return {
      refTerminal: terminals[0],
      leads,
      straddlesGutter: true,
      minCols: half,
      carrier: part.carrier,
    };
  }
  for (let i = 0; i < terminals.length; i++) leads[terminals[i]] = { dRow: 0, dCol: i };
  return {
    refTerminal: terminals[0],
    leads,
    minCols: terminals.length,
    carrier: part.carrier,
  };
}

/** Bare THT sidecar footprint, or an explicit carrier footprint. */
export function breadboardFootprintForPart(part, bareFootprints) {
  if (!part) return null;
  return bareFootprints?.[part.kind] || carrierFootprintForPart(part);
}

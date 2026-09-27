/**
 * Deterministic, printable top-view assembly legends for SMD carriers.
 *
 * These are assembly aids, not manufacturer drawings: dimensions state only
 * the package and header pitches in the carrier contract.  Pad dimensions,
 * board outline and supplier part numbers are deliberately not invented.
 */

import { carrierForPart } from './carriers.js';
import { getSidecar } from './parts-registry.js';

const esc = (value) => String(value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&apos;');

function pinPositions(carrier) {
  if (carrier.layout === 'dip') {
    const half = carrier.pinCount / 2;
    return Array.from({ length: carrier.pinCount }, (_, index) => {
      const left = index < half;
      const row = left ? index : carrier.pinCount - 1 - index;
      return { x: left ? 145 : 655, y: 150 + row * 42, anchor: left ? 'end' : 'start' };
    });
  }
  const span = Math.max(1, carrier.pinCount - 1);
  return Array.from({ length: carrier.pinCount }, (_, index) => ({
    x: 160 + index * (480 / span), y: 255, anchor: 'middle',
  }));
}

/** Return a standalone SVG assembly legend for one mounted physical device. */
export function carrierAssemblySvg(part) {
  const carrier = carrierForPart(part);
  const terminals = getSidecar(part?.kind)?.terminals || [];
  if (!carrier || terminals.length !== carrier.pinCount) {
    throw new Error('carrier assembly legend requires a compatible physical part and carrier');
  }
  const positions = pinPositions(carrier);
  const bodyHeight = carrier.layout === 'dip'
    ? Math.max(120, (carrier.pinCount / 2 - 1) * 42 + 70) : 120;
  const bodyY = carrier.layout === 'dip' ? 125 : 195;
  const bodyX = carrier.layout === 'dip' ? 245 : 110;
  const bodyWidth = carrier.layout === 'dip' ? 310 : 580;
  const pinMarkup = terminals.map((terminal, index) => {
    const p = positions[index];
    const labelY = carrier.layout === 'dip' ? p.y + 5 : p.y + 42;
    return `<g data-pin="${index + 1}" data-terminal="${esc(terminal.name)}">`
      + `<circle cx="${p.x}" cy="${p.y}" r="13" fill="#fff" stroke="#111" stroke-width="2"/>`
      + `<text x="${p.x}" y="${p.y + 5}" text-anchor="middle" font-size="13">${index + 1}</text>`
      + `<text x="${p.x + (p.anchor === 'end' ? -22 : p.anchor === 'start' ? 22 : 0)}" y="${labelY}" text-anchor="${p.anchor}" font-size="13">${esc(terminal.name)}</text>`
      + '</g>';
  }).join('');
  const height = Math.max(430, bodyY + bodyHeight + 115);
  return `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="${height}" viewBox="0 0 800 ${height}" role="img" aria-labelledby="title desc">`
    + `<title id="title">${esc(part.kind)} on ${esc(part.carrier)} assembly legend</title>`
    + `<desc id="desc">Top view. Pin 1 marker and one-to-one physical pin labels. Vendor-neutral assembly aid, not a fabrication drawing.</desc>`
    + '<rect width="100%" height="100%" fill="#fff"/>'
    + `<text x="400" y="38" text-anchor="middle" font-size="22" font-family="monospace">${esc(part.kind)} · ${esc(carrier.label)}</text>`
    + `<text x="400" y="65" text-anchor="middle" font-size="14" font-family="monospace">${esc(carrier.package)} ${carrier.inputPitchMm} mm → ${carrier.headerPitchMm} mm header · ${carrier.sourcing}</text>`
    + `<rect x="${bodyX}" y="${bodyY}" width="${bodyWidth}" height="${bodyHeight}" rx="10" fill="#e8edf2" stroke="#111" stroke-width="3"/>`
    + `<circle cx="${bodyX + 24}" cy="${bodyY + 24}" r="8" fill="#111" data-pin-one-marker="true"/>`
    + pinMarkup
    + `<text x="400" y="${height - 52}" text-anchor="middle" font-size="13" font-family="monospace">TOP VIEW · verify the chosen carrier datasheet before assembly</text>`
    + `<text x="400" y="${height - 28}" text-anchor="middle" font-size="12" font-family="monospace">No manufacturer, board outline, or pad dimensions are prescribed.</text>`
    + '</svg>\n';
}

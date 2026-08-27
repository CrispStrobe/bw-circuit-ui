// Physical geometry shared by board faces, terminals, hit-testing and layout.
// Arduino dimensions and pin positions are normalized from
// @wokwi/elements 1.9.2 (MIT, Copyright Uri Shaked). Keeping this data beside
// the geometry math prevents the rendered face and electrical endpoints from
// acquiring separate, contradictory coordinate systems.

export const BOARD_PIN_PITCH = 20;
export const SIDE_ART_PIN_PITCH = 8;
export const BREADBOARD_PITCH = 14;
export const WORLD_UNITS_PER_MM = BREADBOARD_PITCH / 2.54;
const CSS_PIXELS_PER_MM = 96 / 25.4;
const WORLD_UNITS_PER_WOKWI_PIXEL = WORLD_UNITS_PER_MM / CSS_PIXELS_PER_MM;

const unoPins = {
  aref: [106, 9], gnd: [115.5, 9],
  reset: [140.5, 191.5], '3v3': [150, 191.5], '5v': [160, 191.5],
  gnd2: [169.5, 191.5], gnd3: [179, 191.5], vin: [188.5, 191.5],
};
[255.5, 246, 236.5, 227, 217.5, 208, 198.5, 189, 173, 163, 153.5, 144, 134.5, 125]
  .forEach((x, n) => { unoPins[`d${n}`] = [x, 9]; });
[208, 217.5, 227, 236.5, 246, 255.5]
  .forEach((x, n) => { unoPins[`a${n}`] = [x, 191.5]; });

const nanoPins = {
  gnd2: [125.3, 4.8], reset2: [134.9, 4.8],
  '3v3': [29.3, 62.4], aref: [38.9, 62.4], '5v': [125.3, 62.4],
  reset: [134.9, 62.4], gnd: [144.5, 62.4], vin: [154.1, 62.4],
};
const nanoTop = { d12: 19.7, d11: 29.3, d10: 38.9, d9: 48.5, d8: 58.1,
  d7: 67.7, d6: 77.3, d5: 86.9, d4: 96.5, d3: 106.1, d2: 115.7,
  d0: 144.5, d1: 154.1 };
for (const [name, x] of Object.entries(nanoTop)) nanoPins[name] = [x, 4.8];
nanoPins.d13 = [19.7, 62.4];
[48.5, 58.1, 67.7, 77.3, 86.9, 96.5, 106.1, 115.7]
  .forEach((x, n) => { nanoPins[`a${n}`] = [x, 62.4]; });

const megaPins = {
  aref: [109, 9], gnd: [119, 9], reset: [145.5, 184.5],
  '3v3': [155, 184.5], '5v': [164.5, 184.5], gnd2: [174.25, 184.5],
  gnd3: [183.75, 184.5], vin: [193.5, 184.5],
};
[257.5, 247.5, 238, 228.5, 219, 209.5, 200, 190, 177, 167.5, 157.5, 148, 138, 129,
  270.5, 280, 289.5, 299, 308.5, 318.5, 328, 337.5]
  .forEach((x, n) => { megaPins[`d${n}`] = [x, 9]; });
for (let n = 22; n <= 53; n++) {
  const row = Math.floor((n - 22) / 2);
  megaPins[`d${n}`] = [n % 2 === 0 ? 361 : 371, 17.5 + row * 9.6];
}
[208.5, 218, 227.5, 237.25, 246.75, 256.25, 266, 275.5,
  290.25, 300, 309.5, 319.25, 328.75, 338.5, 348, 357.75]
  .forEach((x, n) => { megaPins[`a${n}`] = [x, 184.5]; });

export const WOKWI_BOARD_SPECS = Object.freeze({
  arduino_uno: { mmW: 72.58, mmH: 53.34, pins: unoPins },
  arduino_nano: { mmW: 44.9, mmH: 17.8, pins: nanoPins },
  arduino_mega: { mmW: 102.66, mmH: 50.8, pins: megaPins },
});

// Code-rendered fallback: Raspberry Pi Pico's public mechanical envelope.
// Its header positions come from our own breadboard footprint below, so this
// introduces no third-party artwork or restrictive asset licence.
const CODE_BOARD_SPECS = Object.freeze({
  pi_pico: { mmW: 51, mmH: 21, transpose: true },
  pybadge: { mmW: 85.6, mmH: 54, transpose: false },
});

/** Dimensions in circuit-world units, before part rotation. */
export function boardVisualGeometry(kind, sidecar) {
  const spec = WOKWI_BOARD_SPECS[kind];
  if (spec) {
    return {
      w: spec.mmW * WORLD_UNITS_PER_MM,
      h: spec.mmH * WORLD_UNITS_PER_MM,
      nativeW: spec.mmW * CSS_PIXELS_PER_MM,
      nativeH: spec.mmH * CSS_PIXELS_PER_MM,
      wokwiScale: WORLD_UNITS_PER_WOKWI_PIXEL,
      source: 'wokwi',
    };
  }
  const codeSpec = CODE_BOARD_SPECS[kind];
  if (codeSpec) return {
    w: codeSpec.mmW * WORLD_UNITS_PER_MM,
    h: codeSpec.mmH * WORLD_UNITS_PER_MM,
    transpose: codeSpec.transpose,
    source: 'code',
  };
  if (!sidecar?.w || !sidecar?.h) return null;
  const scale = BOARD_PIN_PITCH / SIDE_ART_PIN_PITCH;
  const transpose = sidecar.h > sidecar.w;
  return {
    scale,
    transpose,
    w: (transpose ? sidecar.h : sidecar.w) * scale,
    h: (transpose ? sidecar.w : sidecar.h) * scale,
    source: 'sidecar',
  };
}

/** Backwards-compatible sidecar-only geometry. */
export function boardGeometry(sidecar) {
  if (!sidecar?.w || !sidecar?.h) return null;
  const scale = BOARD_PIN_PITCH / SIDE_ART_PIN_PITCH;
  return { scale, w: sidecar.w * scale, h: sidecar.h * scale };
}

/** Terminal offsets relative to the visual centre, in circuit-world units. */
export function boardTerminalOffsets(kind, sidecar) {
  const spec = WOKWI_BOARD_SPECS[kind];
  if (spec) {
    const nativeW = spec.mmW * CSS_PIXELS_PER_MM;
    const nativeH = spec.mmH * CSS_PIXELS_PER_MM;
    const result = {};
    for (const [name, [x, y]] of Object.entries(spec.pins)) {
      result[name] = {
        dx: (x - nativeW / 2) * WORLD_UNITS_PER_WOKWI_PIXEL,
        dy: (y - nativeH / 2) * WORLD_UNITS_PER_WOKWI_PIXEL,
      };
    }
    return result;
  }
  if (kind === 'pi_pico' && sidecar?.footprint?.leads) {
    const leads = sidecar.footprint.leads;
    const values = Object.values(leads);
    const minCol = Math.min(...values.map(v => v.dCol));
    const maxCol = Math.max(...values.map(v => v.dCol));
    const minRow = Math.min(...values.map(v => v.dRow));
    const maxRow = Math.max(...values.map(v => v.dRow));
    const result = {};
    for (const [name, lead] of Object.entries(leads)) result[name] = {
      dx: (lead.dCol - (minCol + maxCol) / 2) * BREADBOARD_PITCH,
      dy: (lead.dRow - (minRow + maxRow) / 2) * BREADBOARD_PITCH,
    };
    // Non-header pads and the onboard LED are not breadboard leads, but they
    // remain addressable simulation endpoints and need honest face anchors.
    result.swclk = { dx: 112, dy: -14 };
    result.swd_gnd = { dx: 112, dy: 0 };
    result.swdio = { dx: 112, dy: 14 };
    result.gp25 = { dx: 0, dy: 0 };
    return result;
  }
  const geometry = boardVisualGeometry(kind, sidecar);
  if (!geometry || !sidecar?.terminals) return {};
  const result = {};
  for (const terminal of sidecar.terminals) {
    result[terminal.name] = geometry.transpose
      ? { dx: terminal.y * geometry.scale - geometry.w / 2,
          dy: terminal.x * geometry.scale - geometry.h / 2 }
      : { dx: terminal.x * geometry.scale - geometry.w / 2,
          dy: terminal.y * geometry.scale - geometry.h / 2 };
  }
  return result;
}

/**
 * Pack floating symbols and controller boards into rows above a breadboard.
 * Coordinates are body centres; rows are bottom-aligned so a tall Uno cannot
 * extend into the breadboard while small supply symbols remain nearby.
 */
export function layoutFloatingParts(parts, sidecarForKind, options = {}) {
  const left = options.left ?? 40;
  const right = options.right ?? 1000;
  const boardTop = options.boardTop ?? 175;
  const gap = options.gap ?? 40;
  const fallback = { w: 60, h: 60 };
  const sizeOf = part => {
    const sidecar = sidecarForKind(part.kind);
    if (part.kind === 'vcc' || part.kind === 'gnd') return { w: 36, h: 40 };
    if (['arduino_uno', 'arduino_nano', 'arduino_mega', 'pi_pico', 'pybadge'].includes(part.kind)) {
      const board = boardVisualGeometry(part.kind, sidecar);
      if (board) return { w: board.w, h: board.h };
    }
    return sidecar?.w && sidecar?.h ? { w: sidecar.w, h: sidecar.h } : fallback;
  };

  const rows = [];
  let row = { items: [], width: 0, height: 0 };
  for (const part of parts) {
    const size = sizeOf(part);
    const required = row.items.length ? gap + size.w : size.w;
    if (row.items.length && left + row.width + required > right) {
      rows.push(row);
      row = { items: [], width: 0, height: 0 };
    }
    row.items.push({ part, size });
    row.width += (row.items.length > 1 ? gap : 0) + size.w;
    row.height = Math.max(row.height, size.h);
  }
  if (row.items.length) rows.push(row);

  let rowBottom = boardTop - gap;
  const positions = new Map();
  for (const packed of rows) {
    let cursor = left;
    for (const { part, size } of packed.items) {
      positions.set(part.id, {
        x: Math.round(cursor + size.w / 2),
        y: Math.round(rowBottom - size.h / 2),
      });
      cursor += size.w + gap;
    }
    rowBottom -= packed.height + gap;
  }
  return positions;
}

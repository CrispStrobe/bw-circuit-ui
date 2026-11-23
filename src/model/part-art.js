/**
 * Part art faces: kinds the canvas draws with their vendored bw-parts art
 * (`src/parts-data/<kind>.svg`) instead of the generic labelled module box.
 *
 * The sidecar's terminal x/y ARE the art's leg ends (both come from bw-parts,
 * in the art's viewBox). terminalOffsetsForPart places these kinds' pins at
 * sidecarCenterOffsets, i.e. at those same points relative to the body
 * centre, so drawing the art with its top-left at (-w/2, -h/2) puts every leg
 * end exactly on its pin. A kind belongs in ART_FACE_KINDS only when that
 * holds: its viewBox is the sidecar's w x h and its pins come from the
 * sidecar (test/art-coverage.test.js checks both).
 *
 * The URLs themselves live in src/components/part-art-urls.js (static
 * imports, so Vite and Lite's Webpack both resolve them); this module stays
 * importable from Node.
 *
 * @module
 */

/** Kinds whose canvas face is their vendored art. */
export const ART_FACE_KINDS = Object.freeze([
  'antenna',
  'earth',
  'ferrite_coil',
  'air_coil',
  'varicap',
  'earphone',
  'speaker',
  'oscilloscope',
  'function_gen',
  'polarized_cap',
]);

/**
 * Kinds with vendored art whose canvas pins come from the sidecar but which
 * deliberately do NOT draw that art, and why. Each entry is a decision, not
 * an oversight; removing one means drawing its art.
 */
export const ART_FACE_EXCEPTIONS = Object.freeze({
  // A knob control (position 0..1 sets the capacitance). The Wokwi
  // potentiometer face turns under the pointer and its pointer angle shows the
  // live position (controlValues read-back); tuning_cap.svg's knob is painted
  // at one fixed angle and would show the wrong setting the moment it turns.
  tuning_cap: 'knob control: the turnable potentiometer face shows its live position; the art knob is static',
  // An 8-pin DIP whose art has its pins on two 10-unit side columns, while
  // seated it straddles the gutter on the 14-unit breadboard pitch in two
  // rows: the art's legs cannot meet the holes without redrawing the package.
  lm386: 'DIP: seated pins straddle the gutter on the 14-unit row pitch, the art has 10-unit side columns',
});

const finite = v => typeof v === 'number' && Number.isFinite(v);

/** Sidecar terminal positions relative to the art centre. */
export function artTerminalOffsets(sidecar) {
  if (!sidecar?.terminals?.length || !finite(sidecar.w) || !finite(sidecar.h)) return null;
  const out = {};
  for (const t of sidecar.terminals) {
    if (!finite(t.x) || !finite(t.y)) return null;
    out[t.name] = { dx: t.x - sidecar.w / 2, dy: t.y - sidecar.h / 2 };
  }
  return out;
}

/**
 * Where to draw a kind's art, in the part's unrotated frame (origin = the
 * part's x/y), and the leads to draw from the art's leg ends to the pins.
 *
 * Free part: the art is centred on the origin, exactly where the canvas
 * already puts the pins (sidecarCenterOffsets), so there are no extra leads.
 * Seated part: the origin is the centroid of its holes. The art is moved so
 * the centroid of its leg ends lands on the centroid of the holes; a leg end
 * that then still misses its hole (an electrolytic whose leads are closer
 * than its footprint's hole spacing) gets a straight lead to the hole.
 *
 * @param {{w:number,h:number,terminals:Array<{name:string,x:number,y:number}>}} sidecar
 * @param {Record<string,{dx:number,dy:number}>|null} [holes] seated hole
 *   positions per terminal, relative to the part origin in its unrotated frame
 * @returns {{x:number,y:number,w:number,h:number,legs:Record<string,{dx:number,dy:number}>,
 *   leads:Array<{name:string,from:{dx:number,dy:number},to:{dx:number,dy:number}}>}|null}
 */
export function artFaceLayout(sidecar, holes = null) {
  const art = artTerminalOffsets(sidecar);
  if (!art) return null;
  const { w, h } = sidecar;
  let sx = 0, sy = 0;
  const seated = holes ? Object.keys(art).filter(n => holes[n] && finite(holes[n].dx) && finite(holes[n].dy)) : [];
  if (seated.length) {
    let ax = 0, ay = 0, hx = 0, hy = 0;
    for (const n of seated) { ax += art[n].dx; ay += art[n].dy; hx += holes[n].dx; hy += holes[n].dy; }
    sx = (hx - ax) / seated.length; sy = (hy - ay) / seated.length;
  }
  const legs = {};
  const leads = [];
  for (const [name, p] of Object.entries(art)) {
    legs[name] = { dx: p.dx + sx, dy: p.dy + sy };
    const hole = seated.includes(name) ? holes[name] : null;
    if (hole && Math.hypot(hole.dx - legs[name].dx, hole.dy - legs[name].dy) > 0.5) {
      leads.push({ name, from: legs[name], to: { dx: hole.dx, dy: hole.dy } });
    }
  }
  return { x: -w / 2 + sx, y: -h / 2 + sy, w, h, legs, leads };
}

/** Shared lexical helpers for SPICE-compatible `.model` cards. */

import { parseSpiceValue } from './si.js';

/** Split a model parameter list: `(Is=1e-14 N=1.5)` or bare `Is=1e-14`. */
/**
 * A COMMA IS A SEPARATOR, AND WE WERE SWALLOWING IT INTO THE VALUE.
 *
 * SPICE treats commas in a parameter list as whitespace, and the value pattern
 * below stops only at whitespace and `=`. So a card written with commas -- which
 * is how Analog Devices' own library writes every one of them --
 *
 *     .MODEL NOX NMOS (LEVEL=2,KP=8.00E-05,VTO=+0.6,LAMBDA=0.02,RD=0)
 *
 * captured `8.00E-05,VTO` as KP's value, parsed it as NaN, and the device then
 * reached the engine with NO vth, NO kp and NO lambda -- silently, at the
 * engine's fallback transconductance. Measured: 971 Si7li no-aug decks and 452
 * ADI v2 decks resolve a library containing such a card.
 *
 * Only the PARAMETER SCAN normalises commas. `body` is preserved verbatim for
 * the strict validators that read it, so nothing that matches on the original
 * text changes behaviour.
 */
export function parseSpiceModelParams(rest) {
  const params = {};
  const body = String(rest || '').replace(/[(),]/g, ' ');
  for (const match of body.matchAll(/([A-Za-z_]\w*)\s*=\s*([^\s=]+)/g)) {
    params[match[1].toLowerCase()] = parseSpiceValue(match[2]);
  }
  return params;
}

/** Parse the text after `.model`, preserving its body for strict validation. */
export function parseSpiceModelDeclaration(rest) {
  const declaration = String(rest || '').trim().match(/^(\S+)\s+([A-Za-z]+)\s*(.*)$/s);
  if (!declaration) return null;
  const body = declaration[3] || '';
  return {
    name: declaration[1],
    type: declaration[2].toUpperCase(),
    body,
    params: parseSpiceModelParams(body),
  };
}

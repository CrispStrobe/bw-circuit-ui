/** Shared lexical helpers for SPICE-compatible `.model` cards. */

import { parseSpiceValue } from './si.js';

/** Split a model parameter list: `(Is=1e-14 N=1.5)` or bare `Is=1e-14`. */
export function parseSpiceModelParams(rest) {
  const params = {};
  const body = String(rest || '').replace(/[()]/g, ' ');
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

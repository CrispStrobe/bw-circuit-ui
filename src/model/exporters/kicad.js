/**
 * KiCad netlist serializer (.net).
 *
 * Produces S-expression format that KiCad 5/6/7 and EasyEDA can import.
 * This is the MVP path to getting bw circuits into a real PCB tool.
 *
 * @module
 */

/**
 * Escape a string for S-expression output.
 * Wraps in quotes if it contains spaces or special chars.
 */
function sexp(str) {
  if (!str) return '""';
  if (/^[A-Za-z0-9_.+\-*/]+$/.test(str)) return str;
  return `"${str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Serialize a netlist to KiCad .net S-expression format.
 *
 * @param {import('../netlist.js').Netlist} netlist
 * @returns {string}
 */
export function toKicadNet(netlist) {
  const lines = [];
  const indent = (n) => '  '.repeat(n);

  lines.push('(export (version "E")');

  // ── Design block ──────────────────────────────────────────────
  lines.push(`${indent(1)}(design`);
  lines.push(`${indent(2)}(source "brickwright-circuit.kicad_sch")`);
  lines.push(`${indent(2)}(date "${new Date().toISOString().slice(0, 10)}")`);
  lines.push(`${indent(2)}(tool "BrickWright Circuit Designer"))`);

  // ── Components block ──────────────────────────────────────────
  lines.push(`${indent(1)}(components`);
  for (const part of netlist.parts) {
    const lib = part.symbol ? part.symbol.split(':')[0] || 'Device' : 'Device';
    const sym = part.symbol ? part.symbol.split(':')[1] || part.kind : part.kind;

    lines.push(`${indent(2)}(comp (ref ${sexp(part.refdes)})`);
    lines.push(`${indent(3)}(value ${sexp(part.value || part.kind)})`);
    lines.push(`${indent(3)}(footprint ${sexp(part.footprint || '')})`);
    lines.push(`${indent(3)}(datasheet "~")`);
    lines.push(`${indent(3)}(libsource (lib ${sexp(lib)}) (part ${sexp(sym)}) (description ""))`);
    lines.push(`${indent(3)}(sheetpath (names "/") (tstamps "/"))`);
    lines.push(`${indent(3)}(tstamps ${sexp(part.partId)}))`);
  }
  lines.push(`${indent(1)})`); // close components

  // ── Nets block ────────────────────────────────────────────────
  lines.push(`${indent(1)}(nets`);
  for (let i = 0; i < netlist.nets.length; i++) {
    const net = netlist.nets[i];
    const code = i + 1;
    lines.push(`${indent(2)}(net (code ${sexp(String(code))}) (name ${sexp(net.name)})`);
    for (const node of net.nodes) {
      lines.push(`${indent(3)}(node (ref ${sexp(node.refdes)}) (pin ${sexp(node.pin)}) (pinfunction "~") (pintype "passive"))`);
    }
    lines.push(`${indent(2)})`);
  }
  lines.push(`${indent(1)})`); // close nets

  lines.push(')'); // close export
  return lines.join('\n');
}

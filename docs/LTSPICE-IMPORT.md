# LTspice ASC/ASY interchange

Brickwright reads an LTspice schematic in two deliberately separate layers.

`result.sourceDocument` is the format-level document. It is available even
when no device can be simulated. It retains Version 4/4.1, sheet dimensions,
the normalized source text, every ordered non-empty record, symbol instances,
all repeated attribute records and their effective last value, text and SPICE
directives, unknown records, caller-supplied ASY documents, unresolved
dependencies, transformed `SpiceOrder` pins, net aliases and terminal
partitions. A pin at a wire endpoint or on a wire segment connects; two bare
segments that only cross do not. Named flags are case-insensitive electrically
and preserve their authored spellings as aliases.

`parts`, `wires`, `unmapped` and `losses` are the narrower bw-board electrical
projection. Standard R/C/L/V/I/D symbols use verified built-in pin contracts.
Caller-supplied ASYs can project Q/M/E/G and one-level X subcircuits through
the shared SPICE importer. Missing definitions, mismatched pin counts,
unresolved subcircuits, separate MOS source/bulk nets, model families or fields
outside the native equations, and unimplemented instance tails remain explicit
refusals or analysis blockers. Document success therefore never implies that a
numeric analysis is eligible.

The importer opens no path or URL and never executes a directive. Library and
symbol text must be supplied by the caller. The GUI accepts one ASC and up to
256 explicitly selected ASYs (1 MiB each, 16 MiB total). `bwc` supplies only
bounded ASYs already beside the explicitly requested ASC; an ASC library name
cannot cause it to leave that directory, and `.include`/`.lib` directives are
always inert dependencies.

An unchanged imported ASC exports from its retained source document, preserving
layout and unknown records. Once the projected circuit is edited, export
switches to a generated electrical-interchange schematic and says so. Generated
Q/M/E/G schematics include small self-authored companion ASYs; those files must
remain beside the ASC. Supported SPICE and KiCad conversions are tested by
terminal partitions and numeric/model fields, never byte equality.


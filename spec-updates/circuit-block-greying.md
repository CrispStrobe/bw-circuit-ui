# circuit_* block greying on hardware targets: NOT IMPLEMENTED

Filed 2026-08-10 from bw-circuit-ui. Finding, not a fix.

## What PARTS-TO-BLOCKS.md says (present tense)

> "On a live board they must be unavailable, not wrong."

## What actually happens

The 7 circuit_* blocks return NaN when no board is attached. They are
NOT greyed, hidden, or disabled on a hardware target. The extension's
own comments (circuit/index.js:139-142) say:

> "NO READER EXISTS YET; the palette layer in brickwright-lite needs to
> consult [stc12liveCapabilities] and suppress these five reporters."

## Status

- `runtime.stc12liveCapabilities` — written by stc12live, read by nobody
- `simulationOnly` prop — zeroes out voltage labels, no effect on blocks
- Fix belongs in brickwright-lite's palette layer

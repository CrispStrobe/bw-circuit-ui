# Third-Party Attributions

This file tracks all external sources consulted or used in the bw-parts repository.

## Style references

- **wokwi-elements** (MIT License, https://github.com/wokwi/wokwi-elements):
  Visual style reference for bench-style front-view component rendering.
  No SVG paths or code were copied; art is drawn independently in the same
  photoreal-ish register.

## Datasheet references (factual pin data, not copyrightable)

DIP IC pin maps in `generate-dip.js` use pin names and positions from
manufacturer datasheets. See `ART-PROVENANCE.md` for the full list of
datasheet sources per chip.

## Copied or derived works

None. Every SVG is original work. No paths, coordinates, or code were
copied from any third-party source. See `ART-PROVENANCE.md` for the
full provenance statement.

<!-- bw-circuit-ui local provenance: kept by scripts/sync-parts-data.mjs -->
## Copied works in bw-circuit-ui (LOCAL_ONLY parts, not in bw-parts)

The "None" above applies to bw-parts. This directory also contains two SVGs
copied from Microsoft MakeCode simulator targets. Both are under the MIT
License:

- `calliopemini.svg` comes from **pxt-calliope** 3.0.30 (`built/sim.js`, `BOARD_SVG`). npm package `pxt-calliope`; its package.json names the repository github.com/Microsoft/pxt-microbit, which it forks
- `circuit_playground_express.svg` comes from **pxt-adafruit** 1.6.8 (`built/sim.js`, `visuals.BOARD_SVG`). npm package `pxt-adafruit`, repository github.com/Microsoft/pxt-adafruit

```
The MIT License (MIT)

Copyright (c) Microsoft Corporation

All rights reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

See `ART-PROVENANCE.md` for exactly what was changed in each file.

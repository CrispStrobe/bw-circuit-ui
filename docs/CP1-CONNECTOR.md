# Kosmos CP1 circuit connector

The Boards palette offers **Kosmos CP1** and **Kosmos CP1 + CP3**. Both place a
whole-system connector. Its drawing is an original MIT-licensed schematic
abstraction authored for this project; it does not reproduce Kosmos product
art. The 8049, internal 8155 wiring, keyboard, and display belong to the machine
bench, while this connector exposes the external circuit connections.

## Contacts and firmware

The base machine has ports P1 and P2. CP3 enables P3, P4, and the six contacts of
P5. Names use zero-based bit numbers: `P1.0` is physical contact 1. Blue contacts
on the drawing require CP3. The extractor refuses their use when expansion is
disabled. The two supply contacts are `5v` and `gnd`.

Select the connector to reveal its wire targets. Draw external circuits using
the normal resistor, LED, button, and other parts. Choose **Build Machine** to
pass the connector identity, expansion setting, and 6 MHz clock into the host's
CP1 bench. The host must inject `extractCp1Machine` through `setEngine`; the
standalone development harness does this as well.

Supply your own **2048-byte 8049 firmware ROM** through the file picker. The
picker validates the length and sends a `bw-machine-media-load` event with
`kind: 'cp1'`, `slotId: 'rom'`, and the bytes. It offers no automatic ROM
download. CP1 program cells are entered in the host's CP1 panel; they are not
8049 firmware images.

## Clock ownership

The external CP1 adapter owns execution and solver time after the host attaches
it to the designer's board. The designer stops its own simulation clock while
an external board is attached and does not reset that same board on the green
flag. The illustrative MCU blink script does not write CP1 pins. The host must
retain the extracted `partId` when importing firmware or changing CP3 settings,
so the adapter continues to resolve this connector's qualified GPIO names.

## Artwork and verification

`node scripts/generate-cp1-connector.mjs` regenerates the SVG and sidecar from one
coordinate source. The sidecar has 40 unique contacts and uses exactly the
SVG's 300 × 400 coordinate system. The local-only parts-sync list preserves both
files when upstream catalogue assets are refreshed.

- `node --test test/cp1-integration.test.js` checks geometry, serialization,
  extraction, configuration handoff, demo isolation, and parts-sync preservation.
- `npm run verify:cp1` builds and server-renders the actual canvas at all four
  rotations and both mirror states, checks all 40 targets, resolves the artwork
  through the lazy loader, and renders both palette entries.
- `npm run verify:cp1:browser` starts the dev harness and checks the rendered
  contact positions, palette, Build Machine event, and ROM file validation in
  Chromium. Install Playwright Chromium first, or set
  `BW_CHROMIUM_EXECUTABLE` to an existing Chromium executable.
  The gate writes `result.json` and a desktop screenshot under
  `test-results/cp1-connector-browser` (override with `BW_CP1_BROWSER_OUT`).
  A launch or assertion failure remains fatal and records the error; a page
  screenshot is also preserved when a page exists.

Server rendering does not test pointer interaction, browser layout, or execution
of firmware. The browser gate and the engine's external-circuit tests cover
those separate boundaries.

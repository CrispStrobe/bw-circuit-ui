# Request: STC12 DIP-40 sidecar from bw-parts

Filed 2026-08-09 from bw-circuit-ui.

## What I need

`parts/mcu.json` currently has empty terminals and generic 120×160 dimensions.
For the DIP-40 STC12C5A60S2, I need:

```json
{
  "kind": "mcu",
  "variant": "stc12c5a60s2_dip40",
  "w": 200,
  "h": 260,
  "terminals": [
    { "name": "P1.0", "pin": 1, "x": 0, "y": 20 },
    { "name": "P1.1", "pin": 2, "x": 0, "y": 33 },
    ...
    { "name": "VCC", "pin": 40, "x": 200, "y": 20 }
  ]
}
```

Pin numbering follows the STC12C5A60S2 datasheet DIP-40 package:
- Pins 1-20 left side (top to bottom)
- Pins 21-40 right side (bottom to top)
- Pin 20 = GND, Pin 40 = VCC

## What I'm doing in the meantime

Drawing an interim DIP-40 chip body in BoardCanvas: black rectangle with
notch, numbered legs, "STC12" label. This replaces the gray rectangle that
has been the MCU's visual since day one. The interim will be replaced by
the sidecar SVG once it lands.

# bw-circuit-ui

Circuit designer panel for Brickwright. Drag parts onto a board, wire them,
turn a potentiometer and watch an LED dim, probe nodes with a virtual multimeter.

**Every electrical value comes from [bw-board](../bw-board).** Nothing is fabricated.

**Live:** [brickwright-lite.vercel.app](https://brickwright-lite.vercel.app/) → Circuit tab.

## Importing as a component

```jsx
import { setEngine, CircuitDesigner } from 'bw-circuit-ui';
import { BoardImpl, inferNetlist, checkWiring } from './lib/bw-board/index.js';

setEngine({ BoardImpl, inferNetlist, checkWiring });

<CircuitDesigner
  project={{ device: 'STC12C5A60S2', clock: 11059200, pins: [...] }}
  onDeclarationChange={(decls) => { /* write to project.stc */ }}
  onBoardReady={(board) => { /* hand to circuit extension */ }}
/>
```

## Dev harness

```bash
npm install
npm run dev        # Vite on port 3100
```

## Testing

```bash
npm test             # 187 unit tests
npm run test:render  # 5 Playwright rendering tests (needs dev server)
npm run test:all     # both
node --test test/e2e.test.js  # 6 end-to-end browser tests
```

Verify the deployed site: `node scripts/check-deployed.mjs`

## Bundle size

Full app bundle: **318 KB / 95 KB gzip** (with React).

wokwi-elements cost (measured): 8 elements bundled, **+7 KB gzip** for
7-segment, LCD1602, IR receiver (added to the original LED, resistor,
pot, buzzer, pushbutton).

## Boundary C — inference rows

| # | Source | Direction | Inferred netlist |
|---|---|---|---|
| 1 | PIN | output activeLow | VCC → 1kΩ → LED → pin |
| 2 | PIN | output | pin → 1kΩ → LED → GND |
| 3 | PIN | input | VCC → 10kΩ pull-up → pin ← button → GND |
| 4 | PIN | analog | VCC → pot → GND, wiper → pin |
| 5 | PIN | tone | pin → buzzer → GND |
| 6 | PORT | output | 8× (pin → 330Ω → LED) per bit |
| 7 | PART | 74hc595 | 3 control pins + 8 outputs (note) |

Plus `pwm` (alias for output) and `tone` (singular — one Timer 1).

## Declaration constraints

Parts write declarations with three constraints:
- **Polarity from wiring** — VCC→R→LED→pin = activeLow, pin→R→LED→GND = activeHigh
- **TONE is singular** — second buzzer becomes OUTPUT (one Timer 1)
- **ANALOG is P1.x only** — pot on other ports becomes INPUT

Round-trip validated against 7 compiler-produced `pins.json` fixtures.

## Dependencies

| Package | Licence | Runtime/Dev |
|---|---|---|
| react, react-dom | MIT | peer (host provides) |
| @wokwi/elements | MIT | runtime |
| lit | BSD-3-Clause | runtime |
| @lit/react | BSD-3-Clause | runtime |
| vite | MIT | dev only |
| playwright | Apache-2.0 | dev only |

# bw-circuit-ui

Circuit designer panel for Brickwright. Drag parts onto a board, wire them,
turn a potentiometer and watch an LED dim, probe nodes with a virtual multimeter.

**Every electrical value comes from [bw-board](../bw-board).** Nothing is fabricated.

## Importing as a component

```jsx
import { CircuitDesigner } from 'bw-circuit-ui';

<CircuitDesigner
  project={{
    device: 'STC12C5A60S2',
    clock: 11059200,
    pins: [
      { name: 'led1', port: 1, bit: 0, direction: 'output', activeLow: true },
    ],
  }}
/>
```

The component is self-contained: it creates a `BoardImpl` internally, infers a
default circuit from the project's pin declarations, and drives the simulation.

**Entry point:** `src/index.js` — exports `CircuitDesigner` and model utilities.
No Vite-specific imports, no `import.meta.env`, no CSS modules.

## Dev harness

```bash
npm install
npm run dev        # Vite on port 3100
```

## Testing

```bash
npm test           # 75 unit tests (node --test, no browser needed)
npm run test:render  # 3 Playwright rendering tests (needs dev server on 3100)
npm run test:all   # both
```

## Bundle size

Full app bundle (Vite production build): **240 KB / 76 KB gzip**.

### wokwi-elements cost (measured, not guessed)

| Component | Bundled | Purpose |
|---|---|---|
| @wokwi/elements (5 elements used) | ~37 KB | LED, resistor, pot, buzzer, pushbutton visuals |
| lit (runtime for wokwi) | ~28 KB | Web component base class |
| @lit/react (wrappers) | ~1 KB | React 18 ↔ web component bridge |
| **Total wokwi+lit** | **~66 KB / ~22 KB gzip** | |

The wokwi+lit dependency adds ~22 KB gzip to the bundle. The alternative
(hand-drawn SVGs) would remove this at the cost of reimplementing the component
visuals. **Decision: keep wokwi-elements until measured bundle pressure from
brickwright-lite integration says otherwise.** Do not replace speculatively.

## Dependencies

| Package | Licence | Runtime/Dev |
|---|---|---|
| react, react-dom | MIT | peer (host provides) |
| @wokwi/elements | MIT | runtime |
| lit | BSD-3-Clause | runtime |
| @lit/react | BSD-3-Clause | runtime |
| vite | MIT | dev only |
| playwright | Apache-2.0 | dev only |

bw-board is imported by relative path — it is dependency-free ESM.

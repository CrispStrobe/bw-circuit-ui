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

Vite production build, tree-shaken, minified. React excluded (host provides).

| Build | Minified | Gzipped |
|---|---|---|
| Circuit designer + wokwi + lit | 102 KB | 38 KB |
| Circuit designer alone (stub SVGs) | 58 KB | 24 KB |
| **Delta: wokwi + lit + @lit/react** | **44 KB** | **14.3 KB** |

Tree-shaking works: 5 elements bundled out of 53 in @wokwi/elements.

The 44 KB / 14.3 KB gzip cost buys polished part visuals (LED glow,
resistor color bands, potentiometer knob). The alternative is hand-drawn
SVGs for 5 parts, which would remove all three deps.

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

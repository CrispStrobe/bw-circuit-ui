# Mini breadboard variant — spec-update for model/breadboard.js

Filed 2026-08-09 from bw-circuit-ui per target inventory.

## What

The target inventory calls for three breadboard sizes:
- **Standard** (63 columns) — exists, `size: 'full'` (default)
- **Half** (30 columns) — exists, `size: 'half'`
- **Mini** (17 columns) — needed, `size: 'mini'`

The mini is the 170-point board (17 columns, rows a–e / f–j, NO power
rails). Common in kits; fits small circuits without the visual weight of
a full board.

## Proposed change to BreadboardModel

```js
constructor(spec = {}) {
  if (spec.size === 'mini') {
    this.cols = 17;
    this.hasRails = false;  // mini boards have no power rails
  } else {
    this.cols = spec.size === 'half' ? 30 : 63;
    this.hasRails = true;
  }
  // ...
}

isValidHole(holeId) {
  // Rail holes invalid when !this.hasRails
  const rail = RAILS.find(r => holeId.startsWith(r));
  if (rail) return this.hasRails && ...;
  // ...
}
```

## Renderer impact

`breadboard-snap.js` derives geometry from `bbHoleOrigin` which hardcodes
`COLS = 63`. It would need to read the board part's `params.size` (or a
`cols` param) to adapt. The placement flow already reads `params` from
the palette entry.

## Palette entry

```js
{ kind: 'breadboard', label: 'Mini Board', params: { size: 'mini' }, ... }
```

The model changes are small; I can implement them after coordinator approval.

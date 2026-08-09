# Part kind rename: `ledcube` → `led_cube` — cross-repo (RESOLVED)

Filed 2026-08-09 from bw-circuit-ui. Three repos must change together.

## Evidence

```
bw-board       'led_cube'   — types.js:65, board.js:225, board.js:1010,
                              devices.js:114, validate.js:46
bw-board       'ledcube'    — NOWHERE

bw-circuit-ui  'led_cube'   — already renamed (commit c45228d)
bw-circuit-ui  'ledcube'    — only in src/interaction/hittest.js:32 (coordinator's file)

sb3-creator    'ledcube'    — part kind in emitted data, MUST change
```

## The break

A cube part emitted by sb3-creator arrives at bw-board as `'ledcube'` — a kind
the device registry does not know. `getDevice('ledcube')` returns nothing, the
validator has no entry, and the cube silently gets **no electrical model**. The
renderer's own accumulator does the brightness work, which is why nothing looked
broken.

## Decision

`led_cube` wins: every other composite part in the engine is snake_case
(`shift_register`, `char_lcd`, `led_matrix`, `seven_segment`, `rgb_led`), and
the engine owns part kinds because it owns the device registry and validator.

Block opcodes (`ledcube_*`) stay unchanged — different namespace, no churn.

## What changes where

| repo | file | change |
|------|------|--------|
| bw-circuit-ui | src/interaction/hittest.js:32 | `ledcube` → `led_cube` |
| sb3-creator | wherever `'ledcube'` is emitted as a part kind | → `'led_cube'` |
| bw-board | nothing — already uses `led_cube` everywhere |

bw-circuit-ui's own model/circuit.js, wire-router.js, BoardCanvas.jsx,
PartPalette.jsx, CircuitDesigner.jsx are already renamed (commit c45228d).

## Resolution (2026-08-09)

Adopted. All three repos now use `led_cube` as the engine part kind.
- bw-circuit-ui: c45228d (model) + coordinator 10cb1c0 (hittest)
- sb3-creator: NO change needed — `ledcube` there is the extension/runtime id
  namespace (opcodes `ledcube_*`), not a part kind
- bw-board: already used `led_cube` everywhere
- bw-blocks: simulator driver already addresses board kind as `led_cube`

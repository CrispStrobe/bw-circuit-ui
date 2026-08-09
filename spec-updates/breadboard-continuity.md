# Breadboard electrical continuity — integration design

Filed 2026-08-09 from bw-circuit-ui for coordinator review.

## The question

When parts sit on a breadboard, the strip topology (not drawn wires) creates
the electrical connections. The breadboard model's `deriveNets()` already
produces boundary-B `Net[]` shape. The open question is: **how does a snapped
ghost position become an `occupy(partId, leadMap)` call?**

## Proposed flow

```
palette click → machine.startPlacing(kind, params)
  → pointer move → snapGhost(g, parts) → {hole, boardId, snapped}
  → if snapped:
      footprint = FOOTPRINTS[kind]
      leadMap = computeLeadMap(footprint, hole)
      ghost shows occupied holes (green/red)
  → click commits:
      1. addPart(kind, params, snapX, snapY, declName)
      2. breadboardModel.occupy(partId, leadMap)
      3. {nets, notes} = breadboardModel.deriveNets()
      4. circuit.syncWithExternalNets(nets)
      5. render teaching notes
```

## The mapping: snapped hole → leadMap

`snapGhost` returns a single `hole` (the hole nearest the cursor). The footprint
model (`src/model/footprints.js`) defines offsets relative to a reference terminal.
`computeLeadMap(footprint, refHole)` resolves this to `{terminal → holeId}`.

The reference hole is the one under the cursor — the `hole` from `snapGhost`.
The footprint's `refTerminal` tells which terminal sits there.

## When to sync nets

On every breadboard mutation (occupy, release, addWire, removeWire), re-derive
nets and feed the engine:

```js
const { nets, notes } = breadboardModel.deriveNets();
circuit.syncWithExternalNets(nets);
```

This replaces the wire-derived nets from `_syncNetlist` for parts on the board.
Parts placed on the free canvas (not snapped to a breadboard) still use the
schematic wiring path unchanged.

## Open: mixed mode

When some parts are on the breadboard and some are on the free canvas, the nets
come from two sources: breadboard strips and schematic wires. The simplest
correct answer: merge both net sets before feeding the engine. A net that
appears in both (same terminals) is deduplicated; otherwise they coexist.

## What already exists

- `BreadboardModel` — `occupy()`, `deriveNets()`, `addWire()` (test/breadboard.test.js, 7 tests)
- `FOOTPRINTS` + `computeLeadMap()` (src/model/footprints.js, test/footprints.test.js, 12 tests)
- `circuit.syncWithExternalNets(nets)` (src/model/circuit.js)
- `snapGhost()` + `nearestHole()` (src/interaction/breadboard-snap.js)

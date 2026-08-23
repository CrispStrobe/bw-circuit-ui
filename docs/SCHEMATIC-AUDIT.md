# Schematic viewer — end-to-end audit

Measured 2026-08-23 against a pinned rig, by RENDERING every shipped circuit
rather than by reading the code:

| repo | sha | role |
|---|---|---|
| bw-circuit-ui | `05c56820ff138360658821c705a0edd2ada63bd4` | the projection under audit (pre-fix baseline) |
| bw-board | `e195f64de9d7a6661007429520b34c7cba32486e` | the engine that resolves nets |
| sb3-creator | `965d1720c9dc636a051acafdea8a1af4a7a5cc57` | the corpus, 2,107 circuit files |

Reproduce with:

```
EXAMPLES_DIR=<sb3-creator>/examples node scripts/schematic-audit.mjs
```

The same module backs `test/schematic-geometry-corpus.test.js`, so the gate and
this report cannot drift apart.

---

## 1. The contract

**Input.** `Circuit.fromJSON(circuit.json)` yields `parts` and `resolvedNets` —
the ENGINE's nets, with wires and breadboard strips already merged. The
schematic is a pure function of those two: `projectSchematic(parts, nets)`.
No state, no interaction world, regenerated on every change.

**Output.** `{symbols, wires, junctions, netLabels, labelledRouting,
collisionRoutedNets, detouredRoutingNets, width, height}`.

### It MUST render

- **One symbol per electrical part.** Everything except `breadboard*` and
  `meter`.
- **Every connected terminal as a pin.** "Connected" means the terminal's net
  holds at least two part-pins.
- **Every net with two or more drawn pins as a connection** — either as drawn
  copper, or as repeated net labels.
- **A junction dot wherever one net branches**, and none where two nets merely
  cross. These are opposite meanings and the difference is not cosmetic.
- **An implicit ground symbol** when the circuit has no explicit `gnd` part but
  a voltage source's `neg` terminal is the reference node. This is ADDED, not
  omitted: the reference node is a fact about the circuit and the drawing must
  show it.

### It MAY omit

- **Breadboards and meters.** Infrastructure. A strip's whole job is to put
  terminals in a common net, and the nets already reflect that.
- **Unconnected terminals.** A DIP-40 MCU on a bench uses three of its forty
  pins; drawing all forty scattered connection points ±170px beyond the body,
  which reads as "the chip is connected to nothing".
- **Copper, in favour of net labels.** Two cases, both standard schematic
  practice: a route that cannot avoid crossing a symbol, and a drawing dense
  enough (`>18 nets` or `>52 pins`) that a trunk per net is a thicket rather
  than information. Same label text = same net is the reader's contract.

### It MUST NOT

- **Invent a connection.** A schematic that shows a connection the solver does
  not have teaches a falsehood.
- **Drop a connection** the solver has between two drawn pins.
- **Draw one net under two label texts**, or two nets under one. The first is a
  false disconnection, the second a false connection.
- **Route a conductor through a pin that is not on its net.** A line touching a
  pin reads as attached to it. This is the one the viewer was violating.

---

## 2. What the gates were measuring, and what they were not

Two gates already existed and are careful work:
`schematic-electrical-correspondence.test.js` and
`schematic-rendered-netlist.test.js`. Both had the same two blind spots.

### 2.1 Half the corpus was outside the denominator

Both discovered circuits with `/^circuit(?:\.[^.]+)*\.json$/i`. That `\.`
cannot match the **hyphen** in `circuit-flat.<target>.json`.

```
discovered by the shipped pattern   1,101
actually present                    2,107
never looked at                     1,006   (47.7%)
```

Every per-MCU "flat twin" variant. The gates reported `discovered: 1101,
analysed: 1101, errored: 0`, which reads as complete coverage. Fixed here, and
the corpus-size floor raised from `>= 1000` (below the broken count, so the
regression passed it) to `>= 2000`.

Coverage after: **25,945 → 48,986 rendered pin-pairs compared.**

### 2.2 The geometry was assumed, not checked

`schematic-rendered-netlist.test.js` builds the reader's netlist from the
**pin-side endpoint of each conductor only**, saying:

> ONLY the pin-side endpoint of a conductor is a connection. The trunk-side
> endpoint and every intermediate vertex sit in free space.

That is an assumption about geometry rather than a check of it, and it was
false — see class I below. A gate cannot find a defect it has defined away.

---

## 3. Corpus measurement, per defect class

All 2,107 files, all analysed, none errored.

| | class | circuits | occurrences |
|---|---|---|---|
| A | solver connection with no drawn path | 0 / 2107 | 0 |
| B | connection drawn that the solver denies | 0 / 2107 | 0 |
| C | drawn pin resolving to no net | 4 / 2107 | 10 |
| D | electrical part with no symbol | 0 / 2107 | 0 |
| E | visible net with neither copper nor label | 0 / 2107 | 0 |
| F | foreign crossing carrying a junction dot | 0 / 2107 | 0 |
| G | same-net tee with no junction dot | 0 / 2107 | 0 |
| H | two trunks within 4px over a shared span | 0 / 2107 | 0 |
| **I** | **conductor through a pin on another net** | **799 / 2107** | **4,213** |
| J | one net under two label texts | 0 / 2107 | 0 |
| K | one net as both copper and label | 0 / 2107 | 0 |

A zero is only worth as much as the detector behind it, so F and G are
mutation-proved against real corpus geometry (692 circuits contain a genuine
foreign crossing, 286 contain junction dots — the detectors have material).

### Class I — the defect (799 of 2,107 circuits, 37.9%)

`bodyBounds`, which the router uses to keep a conductor off a symbol, stops
**26px** from a symbol's centre. That symbol's pins reach **30px**. A trunk
placed in the 4px band between the two passed the collision test and ran
straight down a column of pins.

Concretely, in `46-port-overcurrent/circuit.json`: the MCU body sits at x=270,
so its left pins are at x=240 and its body box ends at x=244. Net
`bb1:n-col-b3` routed its trunk to x=240, spanning y=79→185. On that line sit

```
mcu1:P1.1  (240, 97)   net bb1:n-col-b4
mcu1:P1.2  (240,115)   net bb1:n-col-b45
mcu1:P1.3  (240,133)   net bb1:n-col-b48
mcu1:P1.4  (240,151)   net bb1:n-col-b51
```

Four pins on four different nets, with one wire drawn through all of them. A
reader sees five nets shorted together. The solver has them separate, and no
gate said a word.

Spread: **105 example directories**.

### The ten worst

| class-I incidences | circuit |
|---|---|
| 33 | `46-port-overcurrent/circuit-flat.arduino-mega.json` |
| 32 | `50-7seg-chase/circuit-flat.stc15f2k60s2.json` |
| 32 | `50-7seg-chase/circuit-flat.stc89c52rc.json` |
| 32 | `50-7seg-chase/circuit.stc15f2k60s2.json` |
| 32 | `50-7seg-chase/circuit.stc89c52rc.json` |
| 31 | `46-port-overcurrent/circuit-flat.attiny88.json` |
| 31 | `46-port-overcurrent/circuit.attiny88.json` |
| 30 | `46-port-overcurrent/circuit-flat.arduino-nano.json` |
| 30 | `46-port-overcurrent/circuit-flat.arduino-uno.json` |
| 30 | `46-port-overcurrent/circuit-flat.atmega168p.json` |

All ten now carry a reviewed SVG baseline in `docs/schematic-baselines/`.

### Class C is a corpus fact, not a viewer defect

Ten drawn pins across four files resolve to no net, and the viewer is right to
draw them dangling — the circuits really are unwired there:

| circuit | pins | why |
|---|---|---|
| `eater6502-full-build/circuit-flat.json` | 4 | `kbd` d0/d1 and `bargraph` a0/k0 seated on empty breadboard columns |
| `eater6502-full-build/circuit.json` | 2 | `kbd` d0/d1, same cause |
| `pico01-blink/circuit-flat.json` | 3 | **the file has zero wires**: 2 parts, nothing joins them |
| `pico01-blink/circuit.json` | 1 | likewise, 3 parts and no wires |

`pico01-blink` shipping with an unwired circuit is an upstream corpus finding,
not a rendering one — see PLAN.md.

---

## 4. The fix

One invariant, added to the router: **a conductor may pass through its own
net's pins — that is what a stub does — and never through another net's.**

`segmentHitsForeignPin()` in `src/model/schematic-projection.js`, consulted by
both `routeCollisions` (trunk routes) and `obstacleRoute`'s `clear()` (detour
routes), with 2px clearance. A blocked route falls through the machinery that
already existed: detour first for two-pin nets, labelled stubs otherwise.

It is surgical. Comparing full drawn geometry — every symbol, pin, trunk, stub,
junction and label coordinate — across all 2,107 circuits:

```
identical drawing   1,308
changed               799
```

**The 799 that changed are exactly the 799 that had a violation.** Nothing else
in the corpus moved. Net effect on the ten worst: `46-port-overcurrent-flat.
arduino-mega.svg` goes from 55 to 67 drawn line elements — the trunks that cut
through pin columns become routed detours.

### A ninth private endpoint reader, found on the way

`schematic-svg.js` carried its own dialect adapter reading `wire[side]` and
`` wire[`${side}Terminal`] ``. The adoption ratchet from the previous lane could
not see it: the pattern matched dotted access only, and this is **computed**
access. Both are fixed — the reader now imports `wireEndpoint`, and
`test/wire-endpoint-adoption.test.js` now matches `[`${side}Terminal`]`,
`[side + 'Terminal']` and `["fromTerminal"]`.

(That gate also had a live bug of its own: its assertions reused one `/g`
regex, and `assert.match` calls `RegExp.test`, which advances `lastIndex` — so
the second assertion resumed mid-string and reported "did not match" for a
pattern that did. Each assertion now gets a fresh non-global copy.)

---

## 5. Gates added

| gate | covers | mutation-proved by |
|---|---|---|
| `schematic-geometry-corpus.test.js` | C, D, E, F, G, H, I, J, K over all 2,107 | reverting the router fix → 799/4,213 red; dragging a trunk onto a foreign pin; placing a dot on a real foreign crossing; removing a dot from a real tee |
| `schematic-baselines.test.js` | the ten worst, byte-for-byte | reverting the router fix → baseline red |
| discovery + floors in the two existing gates | the missing 1,006 files | corpus floor raised to 2,000, which the broken pattern's 1,101 fails |

Every class except C must be **zero**. C's ratchet may only shrink: a listed
circuit that gets wired up must be deleted from it, and an unlisted circuit
that appears is a failure, never a new entry.

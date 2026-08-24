# Schematic viewer — end-to-end audit

Measured by RENDERING every shipped circuit, not by reading the code.

**This document has two passes.** The first (sections 1-5) audited the DRAWING
and found one real defect, class I, out of eleven classes. The second
("Second pass", sections 6-10) audited the DETECTORS on the grounds that ten
classes reporting zero from detectors written by the same hand is an untested
claim — and found five more. **Where the two disagree about shas, counts or the
ten worst, the second pass is current.**

## Denominators move — every number here names its sha

The corpus is another repo's tree and it changes under this document. Both
figures below are correct, at their own sha, and the difference is nine circuit
files deleted upstream:

| sb3-creator sha | circuit files |
|---|---|
| `965d1720c9dc636a051acafdea8a1af4a7a5cc57` (first measurement) | 2,107 |
| `3c4973b08034a25f1e1e7edda64e600282459804` (current, and what CI clones) | 2,098 |

**The rig for the FIRST pass's numbers** — superseded for anything measured
after it; the second pass names its own shas under "Second pass" below, and
those are the current ones:

| repo | sha | role |
|---|---|---|
| bw-circuit-ui | `0a3ec00e848e67615eef19ff8642b86bf533780c` | the projection |
| bw-board | `a7338cdcdd5d54122bdc5be44c02908bdb6a4fd6` | the engine that resolves nets |
| sb3-creator | `3c4973b08034a25f1e1e7edda64e600282459804` | the corpus, 2,098 circuit files |

**CI evidence** — both gates run there, against a cloned corpus, not skipped:

- bw-circuit-ui [run 32663059860](https://github.com/CrispStrobe/bw-circuit-ui/actions/runs/32663059860) —
  `discovered 2098, analysed 2098, failed 0`, `I conductor through a foreign
  pin  0 / 2098`, suite `951 tests, 937 pass, 0 fail, 14 skipped`.
- sb3-creator [run 32664733204](https://github.com/CrispStrobe/sb3-creator/actions/runs/32664733204) —
  checks out bw-circuit-ui at `0a3ec00e…` and runs the cross-repo gates:
  `6451 tests, 6356 pass, 0 fail, 95 skipped`.

Reproduce locally with:

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

At the current rig: 2,098 files, all analysed, none errored. The first column
maps the classes onto the six the audit was asked for by name.

| asked for as | | class | circuits | occurrences |
|---|---|---|---|---|
| net exists electrically, no drawn path | A | solver connection with no drawn path | 0 / 2098 | 0 |
| — | B | connection drawn that the solver denies | 0 / 2098 | 0 |
| terminals resolving nowhere | C | drawn pin resolving to no net | 4 / 2098 | 10 |
| components silently dropped | D | electrical part with no symbol | 0 / 2098 | 0 |
| net exists electrically, no drawn path | E | visible net with neither copper nor label | 0 / 2098 | 0 |
| crossings drawn as junctions | F | foreign crossing carrying a junction dot | 0 / 2098 | 0 |
| junctions drawn as crossings | G | same-net tee with no junction dot | 0 / 2098 | 0 |
| — | H | two trunks within 4px over a shared span | 0 / 2098 | 0 |
| **wire through a pin it is not connected to** | **I** | **conductor through a pin on another net** | **0 / 2098** | **0** |
| labels attached to the wrong net | J | one net under two label texts | 0 / 2098 | 0 |
| — | K | one net as both copper and label | 0 / 2098 | 0 |

"Labels attached to the wrong net" has two directions and both are gated. J
above is one net wearing two texts — a false DISCONNECTION, the reader sees two
nets where there is one. The other direction, one text worn by two nets — a
false CONNECTION — is `net labels are injective` in
`schematic-rendered-netlist.test.js`, also 0 across the corpus.

A zero is worth only as much as the detector behind it, so F and G are
mutation-proved against real corpus geometry rather than invented coordinates:
692 circuits contain a genuine foreign crossing and 286 contain junction dots,
so the detectors have material to work on.

### What class I looked like BEFORE the fix

Same corpus, same engine, only the router reverted:

| | at sb3-creator `965d1720…` (2,107 files) | at `3c4973b0…` (2,098 files) |
|---|---|---|
| circuits affected | 799 (37.9%) | 790 (37.7%) |
| pin incidences | 4,213 | 4,204 |
| example directories | 105 | 105 |

The ten worst are identical in both, in the same order — the nine deleted files
were not among them.

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

Spread: **105 example directories**, unchanged across both corpus shas.

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

All ten carry a reviewed SVG baseline in `docs/schematic-baselines/`, gated
byte-for-byte by `test/schematic-baselines.test.js`. The ranking is the same at
both corpus shas, so the baseline set is still exactly the ten worst — which
that gate re-derives rather than trusting this table.

### Class C is a corpus fact, not a viewer defect

Ten drawn pins across four files resolve to no net, and the viewer is right to
draw them dangling — the circuits really are unwired there:

| circuit | pins | why |
|---|---|---|
| `eater6502-full-build/circuit-flat.json` | 4 | `kbd` d0/d1 and `bargraph` a0/k0 seated on empty breadboard columns |
| `eater6502-full-build/circuit.json` | 2 | `kbd` d0/d1, same cause |
| `pico01-blink/circuit-flat.json` | 3 | **the file has zero wires**: 2 parts, nothing joins them |
| `pico01-blink/circuit.json` | 1 | likewise, 3 parts and no wires |

Unchanged at both corpus shas: 4 circuits, 10 pins.

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

---

# Second pass — the detectors were the blind spot

The first pass found one real defect out of eleven classes and reported the
other ten as zero. Ten zeros from detectors written by the same hand that wrote
the thing under test is not a clean bill of health, it is an untested claim, and
the owner twice said the viewer still looked wrong. So this pass audited the
AUDIT: for every class, what geometry does the detector define away?

That question had already paid twice — the discovery regex that missed half the
corpus, and the "trunk-side vertices sit in free space" assumption that became
class I. It paid a third, fourth, fifth and sixth time.

**CI evidence** — "the gates exist" and "the gates ran" are different claims and
only the second is worth anything.
[run 32704664707](https://github.com/CrispStrobe/bw-circuit-ui/actions/runs/32704664707)
at `a5fbe123a8bf1f82031b525760cd15b79f063800`, against a freshly cloned corpus:

```
  discovered 2098, analysed 2098, failed 0
  C drawn pin resolving to no net                    4 / 2098 circuits, 10 occurrences
  D E F G H I J K L M N O P                          0 / 2098 circuits,  0 occurrences
# tests 959   # pass 945   # fail 0   # skipped 14
```

(The local suite reports 965/951/0/14 — six tests are registered only when a
local-only fixture is present. Both are 0 fail.)

**Rig for every number below:**

| repo | sha | role |
|---|---|---|
| bw-circuit-ui | `1b854032a7c38159bea3b919e5341e233b6d1e6f` (branch point) | the projection |
| bw-board | `a7338cdcdd5d54122bdc5be44c02908bdb6a4fd6` | the engine, for the class measurements |
| bw-board | `1dac64c7ac38ea030b2760a8b221ef4cce4f5bd5` | the engine, for the suite and the re-check |
| sb3-creator | `4a0826ae492d4b6b4f00d90528074e31c510c16d` | the corpus, 2,098 circuit files |

**Two engine shas, deliberately.** The engine resolves the nets the projection
draws, so a newer engine could in principle bring a class back. Every class
count below was measured at `a7338cdc…`; all fifteen were then re-measured at
`1dac64c…` and are identical — `C 4 / 10`, everything else `0 / 2098`. Naming
one sha and measuring at another is how a number stops meaning anything.

One consequence worth stating rather than hiding: at `a7338cdc…` the local suite
has one failure, `palette-engine-coverage`, because `ay8912` — added to the
designer in bw-circuit-ui `410f8ce` — has no engine device at that sha. It is a
rig-pinning artefact, not a viewer defect, and it is why the suite number below
is quoted at `1dac64c…`. See PLAN.md.

## 6. Five new classes, and one detector that was wrong

| | class | circuits | occurrences | severity |
|---|---|---|---|---|
| **L** | one net's conductor ENDS on another net's (a T) | **426 / 2098** | **3,461** | false connection |
| **M** | two nets' conductors share a corner vertex | **85 / 2098** | **218** | false connection |
| **N** | two nets collinear within 4px over a shared span | **426 / 2098** | **1,807** | false connection |
| **O** | a solver-connected terminal with NO drawn pin | **365 / 2098** | **763** | dropped connection |
| **P** | a net label's leader touching a foreign conductor | **43 / 2098** | **86** | false connection |

All five are now **0 / 2098**, gated, and mutation-proved.

### The measurement that decides everything: touching vs crossing

Two lines meeting at a proper **X** with no dot is the schematic convention for
*not connected*, and orthogonal routing cannot avoid crossings. A **T** or a
shared **corner** is the opposite: convention reads a T as a branch, because
there is no reason to draw one otherwise. Every class below counts only
**contact**, never crossing. This is the distinction a schematic exists to make
and it is the whole content of classes L, M and P.

### The ten worst

Ranked by `A+B+C+D+E+F+I+L+M+N+O` on the unfixed tree, which is the only tree
where a ranking exists — after the fix every score is 0. Reproduce with the
router reverted and `node scripts/schematic-audit.mjs`:

| score | circuit | L | M | N |
|---|---|---|---|---|
| 64 | `arduino-05-arrays/circuit-flat.pico.json` | 39 | 4 | 21 |
| 64 | `arduino-05-arrays/circuit.pico.json` | 39 | 4 | 21 |
| 64 | `arduino-05-for-loop/circuit-flat.pico.json` | 39 | 4 | 21 |
| 64 | `arduino-05-for-loop/circuit.pico.json` | 39 | 4 | 21 |
| 64 | `arduino-05-switch-case-2/circuit-flat.pico.json` | 39 | 4 | 21 |
| 64 | `arduino-05-switch-case-2/circuit.pico.json` | 39 | 4 | 21 |
| 55 | `arduino-05-arrays/circuit-flat.json` | 35 | 2 | 18 |
| 55 | `arduino-05-arrays/circuit.arduino-mega.json` | 35 | 2 | 18 |
| 55 | `arduino-05-arrays/circuit.atmega168p.json` | 35 | 2 | 18 |
| 55 | `arduino-05-arrays/circuit.json` | 35 | 2 | 18 |

These are **different circuits from the first pass's ten worst**, which is the
point: class I lived in dense DIP drawings (`46-port-overcurrent`,
`50-7seg-chase`), and contact lives wherever `obstacleRoute` sent several
detours around one column. Both sets are baselined — see §10.

Class O does not appear here and that is not an oversight: every class-O circuit
scores 1-3, because a seated MCU omits two or three power pins and no more. It
is the *most* teaching-harmful class in this pass and the *lowest*-scoring, which
is a reason to distrust a single ranking rather than a reason to ignore it.

### L, M, N — the router had no notion of another net's copper

The class-I fix taught the router that a foreign **pin** is an obstacle. It
still knew nothing about a foreign **conductor**. Worse, `obstacleRoute`
derives its candidate coordinates from symbol-box edges, so every net detouring
around the same column proposes the *same* x, and the cheapest candidate wins
for all of them.

In `arduino-05-arrays/circuit.pico.json`, five different column nets ran their
detours down **exactly x=385**:

```
bb1:n-col-b27  (385,153)->(385,541)
bb1:n-col-b31  (385,121)->(385,223)     dx=0, overlap 70px
bb1:n-col-b35  (385,177)->(385,293)     dx=0, overlap 116px
bb1:n-col-b39  (385,255)->(385,363)     dx=0, overlap 108px
bb1:n-col-b43  (385,325)->(385,433)     dx=0, overlap 108px
```

Five nets drawn as one wire. **Class H was aimed at exactly this and read 0** —
because it inspects `w.trunk` wires only, and every one of these is a
`segments` detour. The class-I fix had just converted 799 circuits' trunks
*into* detours, moving them out of H's denominator at the moment they most
needed watching. A fix that relocates a defect past its own gate is the
failure mode this pass exists to catch.

**The fix**: `segmentTouchesForeignConductor()`, consulted by `routeCollisions`
for trunks and by `obstacleRoute`'s `clear()` for detours. Committed routes
register their segments, so each net is routed against the copper already on
the page. Crossings stay legal; contact does not.

### O — a microcontroller drawn with no power

`01-blink/circuit.attiny88.json` renders an ATtiny88 as a **one-pin symbol**.
Its `vcc`, `avcc` and `gnd` are wired — the solver has them on the rails — and
the drawing simply does not have pins for them:

```
NET bb1:rail-b-   GND:gnd  LED_led1:cathode  MCU:gnd      MISSING PIN: MCU:gnd
NET bb1:rail-t+   MCU:avcc MCU:vcc  VCC:vcc              MISSING PIN: MCU:avcc MCU:vcc
```

The cause is two disagreeing truths in one loaded model. The corpus file
declares `terminals: ["pb0"]` — only the terminal an explicit wire names —
while its `seat.leadMap` drops **28** leads into breadboard holes (`vcc:f9`,
`gnd:f10`, `avcc:e8`). `Circuit.fromJSON` honours the declared list verbatim,
the breadboard strips resolve nets that attribute those 28 terminals to the same
part, and the projection read only the first. It was structurally incapable of
drawing the chip's supply.

**Why no gate saw it, and this is the important part**: both correspondence
gates restrict the SOLVER side of their comparison to terminals the projection
chose to draw (`visible`). A terminal the projection omits therefore leaves
*both* sides of the equation at once, and every class stays green. The gate was
asking "of the pins I drew, are they joined correctly?" — never "did I draw the
pins I am required to draw?".

**The fix**: `declaredAndWired()` — the drawable terminal set is the declared
list UNIONED with what the resolved nets attribute to that part. Corpus pin
count rose by exactly 763, matching the class-O count.

### P — and a detector that was wrong by 14×

A label's leader is the short stub joining a pin to its text, drawn in the same
stroke as copper, so it obeys copper's rule. In `46-port-overcurrent/
circuit.pico.json`, net `b40`'s wire ends at `(305,117)` — a point on net
`b27`'s VCC leader, which spans `x=300..313` at `y=117`.

The first version of this detector counted **crossings** as contact and reported
**578 circuits / 1,232 incidences**. That is 14× the truth, and acting on it
would have driven a large and pointless change through the drawing. Counting
contact only gives **43 / 86**. Recorded here because the discipline that
catches a defect is the same discipline that catches a phantom, and only one of
those two mistakes is usually written down.

**The fix**: `labelPin` shortens the leader (13→10→8→6→4px) until it is clear,
and registers it as a conductor so later routes avoid it.

## 7. The classes that really were clean

A zero means nothing without material behind it. These were measured with the
detectors exercised on real corpus geometry — 20,374 segments, 35,165 pins, 924
junction dots and 22,321 label leaders:

| probe | result |
|---|---|
| two pins of different nets at one coordinate | 0 |
| a junction dot where no two segments meet | 0 |
| a segment that is neither horizontal nor vertical | 0 |
| a wire carrying both `segments` and `stubs` shapes | 0 |
| a segment crossing a symbol body box | 0 |
| a label anchored on no pin | 0 — **false positive**, see below |

The label probe first reported 50 circuits. Every one was a label anchored on
the **implicit ground** symbol's pin, which the probe excluded from its pin set
and which is a perfectly legitimate pin. Disproved rather than reported.

## 8. Cost of the fix

Corpus-wide, comparing the drawing before and after:

| | before | after |
|---|---|---|
| drawn segments | 20,925 | 20,374 |
| drawn pins | 34,402 | 35,165 |
| net labels | 20,936 | 22,321 |
| trunk routes | 2,247 | 2,125 |
| detour routes | 4,260 | 4,144 |

**1,385 more label stubs and 551 fewer drawn segments.** That is the price of
refusing to let two nets touch: a net that cannot be routed without contacting
another falls back to repeated net labels, which is standard schematic practice
and which the rendered-netlist gate already treats as connectivity. The 763
extra pins are class O — connections that were previously not drawn at all.

If the owner would rather see copper than labels there, the lever is the routing
band (`COL_W` / `PIN_HALF` / the `>18 nets` label threshold), not the contact
rule. Loosening the contact rule buys wires by drawing shorts.

## 9. Mutation proofs — every gate shown RED

A gate that has never failed is a gate nobody has tested. Each fix below was
reverted **in the source**, the corpus gate re-run over all 2,098 files, and the
fix restored. Reproduce any row with
`scripts/` + the revert named in the "reverted" column.

| reverted | classes that went RED | pass/fail |
|---|---|---|
| `segmentHitsForeignPin` (the first pass's fix) | **I 801 / 2098, 1,852** — and P 801 / 1,852 with it | 13 pass, 5 fail |
| `segmentTouchesForeignConductor` | **L 456 / 3,659 · M 91 / 230 · N 456 / 1,913** | 16 pass, 2 fail |
| `declaredAndWired` | **O 365 / 2098, 763** | 16 pass, 2 fail |
| leader clearance in `labelPin` | **P 43 / 2098, 86** | 17 pass, 1 fail |

Class I's RED output, as the audit asked for explicitly — the previously fixed
defect re-introduced, confirmed red, restored:

```
#   I conductor through a foreign pin                801 / 2098 circuits, 1852 occurrences
not ok 1 - schematic geometry across the whole shipped corpus
# tests 18
# pass 13
# fail 5

  801 circuit(s) draw a conductor through a foreign pin, 1852 incidences. A line
  touching a pin reads as attached to it, so the drawing asserts a connection the
  solver does not have. The router must treat foreign pins as obstacles
  (segmentHitsForeignPin in schematic-projection.js), not only symbol bodies.
```

Two things about that row are worth stating rather than glossing:

- **801 / 1,852, not the 790 / 4,204 the first pass recorded.** A reverted-router
  measurement is a measurement of a *tree*, and this tree also has the L/M/N/O/P
  fixes, which change where routes go. Same defect, different surroundings,
  different count. A before-number that does not name its tree is not a number.
- **Class P goes red alongside it, at the same count.** That is mechanical, not a
  bug in either detector: a conductor drawn through a pin necessarily also
  touches the leader of the label anchored at that pin, and in these drawings
  each such pin carries exactly one label. The L/M/N revert leaves P at 2 / 4,
  which is what shows the two detectors are independent.

And the three classes L, M, N under their own revert:

```
#   L conductor tees onto a foreign conductor        456 / 2098 circuits, 3659 occurrences
#   M two nets share a corner vertex                  91 / 2098 circuits, 230 occurrences
#   N two nets collinear within 4px                  456 / 2098 circuits, 1913 occurrences
# tests 18
# pass 16
# fail 2
```

`O` and `P` each go red alone, with every other class still 0 — an isolated
proof, which is the useful kind:

```
#   O connected terminal with no drawn pin           365 / 2098 circuits, 763 occurrences
#   P label leader touching a foreign conductor       43 / 2098 circuits, 86 occurrences
```

The in-suite mutation proofs are separate from these source-level reverts and
run on every CI build. Each searches the corpus for geometry that actually
exercises its detector and **fails if no such circuit exists**, so a detector
that has gone vacuous is a failure rather than a zero:

| in-suite proof | acts on |
|---|---|
| drag a trunk onto a foreign pin (I) | `46-port-overcurrent/circuit.json` |
| shorten one net's conductor onto another's (L) | a real foreign crossing, searched for |
| end two nets at one vertex (M) | the same crossing |
| slide one net onto another's x (N) | two real overlapping verticals |
| stretch a leader onto a foreign conductor (P) | a drawing with both labels and copper |
| delete a drawn pin the solver connects (O) | `01-blink/circuit.attiny88.json` |
| place a dot on a real foreign crossing (F) | searched for |
| remove a dot from a real tee (G) | searched for |

## 10. Baselines

`docs/schematic-baselines/` now holds **21** reviewed SVGs in three groups, and
`test/schematic-baselines.test.js` gates them byte-for-byte:

- **`CLASS_I_WORST`** (10) — the first pass's ten worst, regenerated, since this
  pass changes their drawings too.
- **`CONTACT_WORST`** (10) — this pass's ten worst by L+M+N, which are different
  circuits: class I lived in dense DIP drawings, contact lives wherever
  `obstacleRoute` sent several detours round one column. Top of the ranking is
  `arduino-05-arrays/circuit-flat.pico.json` at L=39, M=4, N=21.
- **`MISSING_PIN_EXEMPLAR`** (1) — `01-blink/circuit.attiny88.json`, class O.
  Ten of these would be ten copies of one drawing: every class-O circuit has the
  same shape, a seated MCU whose declared terminal list omits the power pins its
  `seat.leadMap` wires up. The corpus gate carries the other 364.

The class-O exemplar is the one to look at first. Before: an ATtiny88 drawn as a
single `pb0` pin, floating. After: `pb0`, `gnd`, `avcc`, `vcc`, with the `VCC`
and `GND` net labels that put it on the rails.

---

# Third pass — everything measured so far lived in `projection.wires`

The second pass audited the detectors and found five more classes. This pass
asked the question one level out: **what is in the drawing that no detector
reads at all?**

The answer is a whole category. Classes A through P are computed from
`projection.wires`, `projection.junctions` and `projection.netLabels`. A
**symbol's own copper** — the strokes `schematic-svg.js` and
`SchematicPanel.jsx` draw from `schematic-symbols.js` — appears in none of
those, so no class up to P could see a single stroke of it. Sixteen classes
reporting clean said nothing about roughly a third of the ink on the page.

Measured there: **403 drawn pins across 109 circuits sit where their symbol's
artwork does not reach.** `disp-sevenseg/circuit.json` draws a seven-segment
digit as a figure-8 with two horizontal whiskers at y=0, and then lands
**eight** wires on eight points that touch no copper at all. A reader sees
eight wires ending in blank space beside the part. It is the plainest way a
drawing can be wrong, and it was invisible to every gate.

**Rig for every number below.** The corpus moved twice during this pass, which
is why each sha is named rather than described:

| repo | sha | role |
|---|---|---|
| bw-circuit-ui | `dce2175af5bf407400eb551452508a6f39700ab9` (branch point) | the projection |
| bw-board | `1dac64c7ac38ea030b2760a8b221ef4cce4f5bd5` | the engine that resolves nets |
| sb3-creator | `553a6395289e1e28249416f24d75804a2624a718` | the corpus, 2,098 circuit files |

**Two engine shas, deliberately — and this time because CI uses the other
one.** `.github/workflows/ci.yml` clones bw-board with `--depth 1` at its
default branch, so a CI green is measured against bw-board MASTER
(`b1da99e21bc67c422144f8dedbfb5d29bab0c49a`) while the local rig above pins
`1dac64c…`. The engine resolves the nets the projection draws, so those are
two different measurements unless someone checks. All twenty-one classes were
re-run against master:

```
A 0/0  B 0/0  C 2/6  D 0/0  E 0/0  F 0/0  G 0/0  H 0/0  I 0/0  J 0/0  K 0/0
L 0/0  M 0/0  N 0/0  O 0/0  P 0/0  Q 0/0  Q2 44/44  R 0/0  S 0/0  T 0/0
```

Identical. Naming one sha and measuring at another is how a number stops
meaning anything.

**Corpus sha, and why it is not the one this pass started on.** The first
measurements here were taken at sb3-creator `0777a17`; another lane landed
`553a639` mid-pass, changing two `circuit.json` files (`44-darlington-motor`,
a transistor beta). The denominator is 2,098 at both, no baselined circuit
moved, and every number in this section was re-taken at `553a639` rather than
carried over.

**CI evidence** — "the gates exist" and "the gates ran" are different claims
and only the second is worth anything.
[run 32763155938](https://github.com/CrispStrobe/bw-circuit-ui/actions/runs/32763155938)
at `be4f0e17c4d85f3097a680ea3841e58f04600072`, against freshly cloned siblings:

```
  exported and re-read 2098 / 2098 circuits
  undotted T-joints: 0 file(s)
  discovered 2098, analysed 2098, failed 0
  Q drawn pin the symbol art does not reach          0 / 2098 circuits, 0 occurrences
  Q2 symbol lead reaching no pin                    44 / 2098 circuits, 44 occurrences
  R junction dot disc covering foreign copper        0 / 2098 circuits, 0 occurrences
  S conductor touching foreign symbol copper         0 / 2098 circuits, 0 occurrences
  T drawn pin netId disagrees with the solver        0 / 2098 circuits, 0 occurrences
# tests 984   # pass 970   # fail 0   # skipped 14
```

(The local suite reports 995/978/0/17 — eleven tests register only when a
local-only fixture is present. Both are 0 fail.)

## 11. Four new classes, two of them real

| | class | circuits | occurrences | severity |
|---|---|---|---|---|
| **Q** | a drawn pin the symbol's own artwork does not reach | **109 / 2098** | **403** | the wire ends in blank space |
| **Q2** | a symbol lead end that reaches no pin | 44 / 2098 | 44 | **disproved** — see below |
| **R** | a junction dot whose drawn disc covers foreign copper | **0 / 2098** | 0 | clean |
| **S** | a conductor TOUCHING a foreign symbol's own copper | **7 / 2098** | **7** | false connection |
| **T** | a drawn pin whose netId disagrees with the solver | **0 / 2098** | 0 | clean |

Q and S are now **0 / 2098**, gated, and mutation-proved. R and T were
measured and found clean; Q2 was measured and **disproved as a defect**.

All sixteen earlier classes were re-measured at the shas above and are
unchanged: **C 2 / 6** (down from 4 / 10 — `pico01-blink` was wired upstream
and came off the ratchet in `c11d305`), everything else **0 / 2098**.

### Q — the symbol and the pin placement were two truths in one drawing

A `Shape` in `schematic-symbols.js` carries its leads at FIXED local
coordinates: a resistor's at (±30, 0), an op-amp's inputs at (-30, ∓7), a
seven-segment digit's two whiskers at (±30, 0). `projectSchematic` places pins
on its OWN grid — ±`PIN_HALF` on x, `PIN_PITCH` apart on y. The two coincide
in exactly two cases: a two-terminal part whose leads sit at y=0, or a part
whose art declares `anchors`.

Every other combination draws pins in mid-air. In `disp-sevenseg`:

```
dis1  seven_segment  at (420,106)   art leads:  M -30 0 L -8 0    M 8 0 L 30 0
  a       local(-30,-27)      no copper within 27px
  b       local(-30, -9)      no copper
  c       local(-30,  9)      no copper
  d       local(-30, 27)      no copper
  e       local( 30,-27)      no copper
  f       local( 30, -9)      no copper
  g       local( 30,  9)      no copper
  common  local( 30, 27)      no copper
```

Eight of eight. And in `76-multimeter`, an LM358 drawn as a triangle with its
inputs at y=±7 gets `vcc`, `gnd` and `1_pos` on the left at y=-18/0/+18 and
`1_neg`, `1_out` on the right — four of its five pins land nowhere, and the
one that lands is the output.

**The most useful thing about this class is that the codebase had already
written it down.** `schematic-symbols.js` explains why `optocoupler` is
deliberately undrawn:

> its four terminals are laid out first-half-left by schematic-projection,
> which would put the emitter above the collector and draw the
> phototransistor upside down. It needs per-terminal placement first

That is exactly class Q, correctly diagnosed, for one kind — and fourteen
other kinds shipped with it. A hazard avoided by hand in one place and not
made structural is a hazard that has already recurred somewhere else.

**The fix** makes it structural. `artReachesPins(art, localPins)` in
`schematic-symbols.js`; the projection uses a kind's artwork **only if it
reaches every pin of THIS instance**, and otherwise sets `symbol.generic` and
falls back to the labelled box, which draws a lead and a terminal name to
every pin by construction. Both renderers honour the flag (`git grep
'shapeFor('` — every call site outside the decision itself now reads
`s.generic ? null : shapeFor(...)`).

Where the art can be matched EXACTLY it is matched instead of discarded:

- `slide_switch` gained `anchors` — the SPDT drawing has three lead ends and
  the engine's device has three terminals (`a`, `com`, `b`), so the blade
  pivots on `com` and the throws are `a` and `b`. 24 instances keep their
  symbol. `dip_switch` (eight terminals) and `tilt_sensor` (two) borrow the
  same artwork and can NOT be mapped onto three leads, so they keep the bare
  shape and take the box.
- the four two-input gates gained `anchors` (`in0`/`in1` left, `out` right).
  16 instances.

Guessing was refused where the mapping is not derivable. A `relay` has five
terminals (`coil_a`, `coil_b`, `com`, `nc`, `no`) and the drawing has four
lead ends plus an armature; `lm358` has eight and a triangle has three. An
anchor invented for those would be a fabricated drawing — a pin labelled `com`
on a lead that is not the pole — which is worse than a correct box.

**Cost, corpus-wide.** Of 14,843 drawn symbols, **76 trade bespoke artwork for
the labelled box** (0.5 %):

| kind | instances | why the art cannot host it |
|---|---|---|
| relay | 22 | 5 terminals, 4 lead ends and an armature |
| seven_seg_3 | 14 | 3 digits, 2 whiskers |
| rgb_led | 14 | 4 terminals, an LED's 2 leads |
| seven_segment | 10 | 8 terminals, 2 whiskers |
| opamp | 6 | 5 connected terminals, 3 leads |
| lm358 | 4 | dual op-amp; `vcc`/`gnd` have nowhere to go |
| seven_seg_4 | 2 | 4 digits, 2 whiskers |
| tilt_sensor | 2 | 2 terminals borrowing an SPDT drawing |
| dip_switch | 2 | 8 terminals borrowing an SPDT drawing |

Everything else in the drawing barely moves:

| | at the branch point | after |
|---|---|---|
| drawn segments | 20,406 | 20,370 |
| drawn pins | 35,223 | 35,223 |
| net labels | 22,315 | 22,345 |
| trunk routes | 2,129 | 2,122 |
| detour routes | 4,150 | 4,146 |
| symbols drawn with artwork | 12,516 | 12,440 |

The 21 baselines from the first two passes render **byte-identical** after
this change: none of them contained an affected kind. That is what "surgical"
looks like when it is measured rather than claimed.

### Q2 — measured, then disproved

44 symbol lead ends reach no pin. Every one is honest, and the class is a
**ratchet by kind**, not a zero:

| kind | leads | what it is |
|---|---|---|
| slide_switch | 24 | `70-calculator-simple`'s `pwr` is wired `com` + `a`; the second throw is spare, and showing it is the point of drawing an SPDT |
| potentiometer | 18 | `74-ammeter`, `76-multimeter` and the two 555 benches wire the pot as a RHEOSTAT — `a` and `wiper`, with `b` open |
| relay | 2 | `pc25-relay-isolator`'s armature, drawn mid-swing between contacts |

Drawing an unused terminal is how a schematic says the terminal exists and is
unconnected. Hiding it would be the lie. Recorded because the same measurement
that finds a defect finds a non-defect, and only one of those two usually gets
written down.

### S — the router had never heard of a symbol's copper

Class L asks whether a conductor ends on another net's WIRE. Nothing asked
whether it ends on another part's LEAD, because a lead is not in
`projection.wires`. Seven shipped circuits do, all the same shape:

```
74-ammeter/circuit.json
  load1  potentiometer at (270,163), wired as a rheostat
         zigzag: M -30 0 L -18 0 ... L 14 0 L 30 0
         `b` is UNCONNECTED, so the lead end at (300,163) has no pin
  net bb1:n-col-t6's conductor ENDS at (300,163)
```

A reader sees that net joined to the pot's third terminal. The solver has them
apart. **The fix**: every symbol lead that leaves the body box is registered
as a conductor before routing begins — under its pin's net if it ends on one,
and under a sentinel net id (foreign to everyone) if it does not. Crossings
stay legal; contact does not. 7 → 0, and nothing else in the corpus moved.

### R and T — clean, and worth stating why they were asked

**R.** Class F asks whether a junction dot sits *exactly* on a foreign meet.
The dot is drawn `r=2.4` (`schematic-svg.js`), which is larger than the 2px
pin clearance and more than three times the 0.75px contact tolerance — so a
dot 2px from another net's copper is a filled blob touching it while class F
stays silent. Measured across 950 drawn dots: **0**.

**T.** Every class from I to S compares a wire's `netId` with a pin's `netId`,
and **both are written by the projection**. That is the projection checked
against itself, and a systematically wrong `pin.netId` would leave all of them
green — the same species of tautology this codebase has recorded before. T
compares each drawn pin against `resolvedNets`, which is the engine's answer.
Across 35,223 drawn pins: **0**. The tautology is now closed by a gate rather
than by argument.

## 12. The EasyEDA junction rule — our solver is more permissive than theirs

Raised by the owner, and it belongs here because it is **class G arriving from
the other side**.

`kicad-common.js`'s `NetSolver` folds in a **T** — a registered point (a wire
endpoint, a pin, a label anchor) lying on another segment's span. That is
KiCad's rule, stated in its own header: eeschema drops a junction dot at a T
itself, so reading one as connected reads the file correctly.

**EasyEDA does not imply one.** A T with no `J` shape on it is a CROSSING on
the board and a CONNECTION here. So we can read a file as joined that is
separated in the tool that wrote it — an import defect, not a curiosity: the
circuit the learner sees is not the circuit the author drew.

In the viewer, class G says *we must not DRAW a branch without a dot*. Here it
says *we must not READ one*. Same distinction, opposite direction, and it is
the whole reason a schematic distinguishes a dot from a crossing.

**Reported, not acted on.** Dropping those unions would lose connections
wherever the author's tool did imply them, and this importer prefers to lose
nothing silently (see its bus note). `NetSolver` now records every
**load-bearing** T — one whose union actually merged two different nets — and
the EasyEDA importer warns:

```
1 T-joint(s) without a junction (1 wire-to-wire); EasyEDA treats these as
crossings, so these connections exist here and not on the board -- at 100,-240
```

"Load-bearing" is the right filter and not a convenience: a T inside a net
that is already joined elsewhere reads the same in both tools, and warning
about it would bury the ones that matter.

### Measured, with two denominators

| corpus | files | with an undotted T |
|---|---|---|
| vendor-dialect fixtures, geometry checked by hand | 4 | **1** (`easyeda-rc-divider`) |
| the whole shipped corpus, round-tripped through OUR OWN exporter | 2,098 | **0** |

The fixture was verified against the tilde shapes directly, not against our
own reading of them:

```
W~100 -220 100 -260          a vertical span at x=100, y=-220..-260
W~300 -220 300 -240 100 -240 ENDS at (100,-240), strictly inside it
J~100~-160   J~100~-220      the only two junction dots
```

So (100,-240) is a T the author did not dot, and the two dotted Ts must not be
counted — a detector that cannot tell them apart is worthless. It reports 1.

The second row is the more interesting number and it is **good news measured
rather than assumed**. `exporters/easyeda-schematic.js` claims its routing is
"safe by construction": one lane per net, one vertical per pin, so every
remaining contact between different nets is an X crossing. That claim was
written against the PERMISSIVE rule. Under the stricter one it still holds,
across all 2,098 exported schematics. The round trip starts from what the app
produces, not from a literal anyone typed.

**Honesty bound.** There is no local corpus of third-party EasyEDA files. The
denominators above are the four vendor-dialect fixtures and our own exports;
what an arbitrary sheet drawn in the real application contains is not measured
here, and the warning is what will tell its reader.

## 13. Gates added, and every one shown RED

A gate that has never failed is a gate nobody has tested. Each proof below
runs in CI on every build, searches the corpus for geometry that actually
exercises its detector, and **fails if no such circuit exists** — so a
detector gone vacuous is a failure, not a zero.

| gate | class | mutation |
|---|---|---|
| `schematic-geometry-corpus.test.js` | Q | slide one pin of an ART symbol 23px off its own lead |
| " | Q (the fix) | assert a multi-terminal seven-segment RESOLVES to the box; if it ever chooses the art again, class Q returns |
| " | Q2 | ratchet by kind; an unlisted kind is a failure, a listed kind that stops reproducing must be deleted |
| " | R | move a real dot to 2px off a foreign conductor — inside the drawn disc, outside the contact tolerance |
| " | S | end a real routed conductor 2px inboard of a foreign pin, ON the lead and not on the pin (so it proves S and not I) |
| " | T | relabel a drawn pin's netId and require the solver comparison to catch it |
| `easyeda-junction-rule.test.js` | the EasyEDA rule | extend one EXPORTED wire's polyline to end on another net's span |
| `schematic-baselines.test.js` | Q, S | 11 more reviewed SVGs |

### Class Q, RED — the defect this pass found

**At the branch point** (`dce2175`, no part of this pass applied), over the
current corpus — this is the defect as found:

```
Q drawn pin the symbol art does not reach    109 / 2098 circuits   403 occurrences
Q2 symbol lead reaching no pin (ratchet)     125 / 2098 circuits   304 occurrences
S conductor touching foreign symbol copper     7 / 2098 circuits     7 occurrences
```

**Reverting only `artReachesPins` on the FIXED tree** — that is, keeping the
`slide_switch` and gate anchors — and re-running the corpus gate over all
2,098 files:

```
#   Q drawn pin the symbol art does not reach         73 / 2098 circuits, 363 occurrences
#   Q2 symbol lead reaching no pin                   113 / 2098 circuits, 264 occurrences
not ok 11 - Q: every drawn pin has the symbol's own copper to meet
not ok 12 - Q2: the unused-lead ratchet matches the corpus by kind, and may only shrink
not ok 23 - MUTATION: a symbol whose art cannot host its pins must fall back to the box
# tests 27
# pass 24
# fail 3

  73 circuit(s) draw 363 pin(s) where the symbol's own artwork does not reach.
  The wire arrives and there is nothing there to arrive at — a wire ending in
  blank space beside the part.
```

**73 / 363 here and 109 / 403 there, and the difference is exactly the
anchors**: 24 `slide_switch` pins and 16 gate pins now fit their artwork, so
36 circuits and 40 pins leave the class before the revert can reach them. Both
numbers are correct at their own tree, and a before-number that does not name
its tree is not a number. That has now bitten three times in this document.

Q2 goes red beside Q, at 264 rather than its ratcheted 44, and that is
mechanical rather than a second defect: with the art kept for symbols it
cannot host, every lead those symbols draw reaches no pin either. The two
detectors ARE independent — see the isolated class-S revert below, where Q2
stays at exactly its ratcheted 44.

### Class S, RED, isolated

Reverting only the symbol-lead registration. Every other class stays clean,
which is the useful kind of proof:

```
#   Q drawn pin the symbol art does not reach          0 / 2098 circuits, 0 occurrences
#   Q2 symbol lead reaching no pin                    44 / 2098 circuits, 44 occurrences
#   R junction dot disc covering foreign copper        0 / 2098 circuits, 0 occurrences
#   S conductor touching foreign symbol copper         7 / 2098 circuits, 7 occurrences
#   T drawn pin netId disagrees with the solver        0 / 2098 circuits, 0 occurrences
not ok 13 - R/S: a symbol's own copper is copper, and a dot is as wide as it is drawn
# tests 27
# pass 26
# fail 1
```

### Class I, RED — the defect that was already fixed

Asked for explicitly, because a fix without a standing gate comes back.
Reverting `segmentHitsForeignPin` on the CURRENT tree:

```
#   I conductor through a foreign pin                 18 / 2098 circuits, 32 occurrences
#   P label leader touching a foreign conductor       18 / 2098 circuits, 32 occurrences
not ok 3 - I: no conductor runs through a pin that is not on its net
not ok 10 - P: a label leader may cross a foreign net, never touch one
not ok 13 - R/S: a symbol's own copper is copper, and a dot is as wide as it is drawn
# tests 27
# pass 24
# fail 3
```

**18 / 32 here, against 801 / 1,852 in the second pass and 790 / 4,204 in the
first.** The collapse is worth more than the number, and the first account
written here of WHY was half right in a way that would mislead a reader, so it
is replaced by a measurement.

The suspicion was that this pass's symbol-lead rule absorbs class I: a pin
sits at the END of its own lead, so a route running through a foreign pin
almost always also touches that pin's lead. True — but stated that way it
invites "then `segmentHitsForeignPin` is nearly dead code", which is false,
and the reason is symmetric. Both rules were reverted in all four
combinations (`scripts/rule-isolation.mjs`, reproducible):

| | lead rule ON | lead rule OFF |
|---|---|---|
| **pin rule ON** | I 0 / 0 · S 0 / 0 — **shipped** | I 0 / 0 · **S 7 / 7** |
| **pin rule OFF** | **I 18 / 32** · S 14 / 14 | **I 801 / 1850** · S 585 / 802 |

Read the diagonal. Reverting the pin rule alone breaks 18 circuits; reverting
the lead rule alone breaks 7. **Either number on its own reads as "this rule
barely does anything."** Reverting both breaks 801. Each rule is suppressing
about 98 % of the other's corpus evidence, in both directions — it is not that
the new rule subsumed the old one, it is that the two forbid nearly the same
geometry from opposite sides.

Two consequences, and the second is the one that matters:

- **Neither rule is redundant.** Each leaves a remainder the other does not
  catch — 18 circuits for the pin rule, 7 for the lead rule — and they are
  different circuits. `segmentHitsForeignPin` catches a conductor passing
  through a pin PERPENDICULAR to its lead, which class S does not count
  because a proper crossing is legal contact-wise; the lead rule catches a
  conductor ending on a lead at a point that is not a pin, which class I
  cannot see.
- **A revert measurement is only valid against the rest of the tree it is
  taken on, and that now includes other rules covering the same ground.** This
  document has said "a before-number that does not name its tree is not a
  number" twice already, about the corpus and about the engine. This is the
  third form and the least obvious: a number can be honest, reproducible, and
  still not measure what its reader thinks, because a DIFFERENT fix is holding
  the drawing up.

The bottom-right cell is also the best available check that nothing else
drifted: **801 / 1,850 with both rules off, against pass two's 801 / 1,852 on
its own tree.** Same 801 circuits; the two missing occurrences are corpus
drift. So the collapse really is these two rules overlapping, and not some
third change quietly repairing the routing.

**The instrument got this wrong once, and how it did is the point.** Its first
version restored the source from a string it read at start-up. An earlier run
had been killed by a two-minute timeout mid-measurement, which left the source
REVERTED on disk — so the next run read the reverted file as its baseline and
reported the shipped configuration as `I 18 / 32`. Every cell was shifted by
one row and nothing said so; the output was internally consistent and
completely wrong. It now refuses to start unless `git status --porcelain` on
that file is empty, and restores through `git checkout` so that being killed
mid-run cannot poison the next one. The refusal is mutation-proved:

```
$ printf '\n// deliberate dirt\n' >> src/model/schematic-projection.js
$ node scripts/rule-isolation.mjs
Error: src/model/schematic-projection.js has uncommitted changes:
  M src/model/schematic-projection.js
This script measures a tree by editing it, so it must start from a known one.
```

A tool that edits a tree in order to measure it must treat "the tree is where
I think it is" as a precondition to CHECK rather than to assume. That is the
same failure this document has now found three times in gates, arriving in the
instrument built to measure the gates.

Class P goes red alongside I at the identical count, exactly as pass two
recorded: a conductor drawn through a pin necessarily also touches the leader
of the label anchored at that pin.

## 14. What this pass says about the previous two

Both earlier passes were careful and both were bounded by the same unstated
assumption: *the drawing is `projection.wires`*. It is not — it is the SVG,
and a third of that SVG comes from a different module.

The pattern is now three for three:

1. pass one — the discovery regex could not match a hyphen, so half the corpus
   was outside every denominator;
2. pass two — the netlist gate defined trunk-side vertices as free space, so
   the class-I geometry was outside its question; and class H inspected only
   `w.trunk`, so the class-I FIX moved 799 circuits out of H's denominator;
3. pass three — every class read `projection.wires`, so all symbol copper was
   outside all sixteen.

Each time the defect was not in the code the gate watched; it was in what the
gate's input excluded. **The question that pays is not "is this class zero"
but "what is not in this class's denominator".**

## 15. Baselines

`docs/schematic-baselines/` now holds **32** reviewed SVGs in five groups,
gated byte-for-byte:

- **`CLASS_I_WORST`** (10) and **`CONTACT_WORST`** (10) — the first two passes.
  Byte-identical after this pass's change.
- **`ART_FIT_WORST`** (10) — this pass's ten worst by class Q. Different
  circuits again, and for a different reason: this defect follows the PART,
  not the routing.

  | Q | circuit |
  |---|---|
  | 24 | `78-a2-calculator/circuit.json` |
  | 11 | `76-multimeter/circuit-flat.json` |
  | 11 | `76-multimeter/circuit.json` |
  | 8 | `disp-sevenseg/circuit.arduino-mega.json` |
  | 8 | `disp-sevenseg/circuit.arduino-nano.json` |
  | 8 | `disp-sevenseg/circuit.arduino-uno.json` |
  | 8 | `disp-sevenseg/circuit.atmega168p.json` |
  | 8 | `disp-sevenseg/circuit.attiny88.json` |
  | 8 | `disp-sevenseg/circuit.json` |
  | 8 | `disp-sevenseg/circuit.pico.json` |

  Ranks 4-10 are a **tie at 8** across near-identical `disp-sevenseg` MCU
  variants. Kept, because the ranking is the ranking; stated, because seven
  copies of one drawing is thin coverage and the reader should know that
  rather than infer breadth from a count of ten.
- **`SYMBOL_CONTACT_EXEMPLAR`** (1) — `74-ammeter/circuit.json`, class S. All
  seven class-S circuits are the same shape; the corpus gate carries the other
  six.
- **`MISSING_PIN_EXEMPLAR`** (1) — unchanged from pass two.

**Suite, at the rig above**: `EXAMPLES_DIR=<sb3-creator>/examples
SB3_CREATOR=<sb3-creator> npm test` → `995 tests, 978 pass, 0 fail, 17
skipped`. The two env vars are a WORKTREE artefact and not a rig requirement:
both gates resolve their sibling as `../../<repo>`, which is right from a
normal checkout and one level too shallow from a worktree under `wt/`. CI
clones both siblings at the depth the tests expect and needs neither variable.

The one to look at is `disp-sevenseg.svg`. Before: a figure-8 with two
whiskers and eight wires ending in blank space. After: a labelled box with a
lead and a terminal name — `a`, `b`, `c`, `d`, `e`, `f`, `g`, `common` — at
each of the eight pins.

---

# Fourth pass — the round trip, and the last of the ink

Two things this document had left as findings rather than fixes, plus the
question the third pass ended on.

**Rig.** bw-circuit-ui `43e2171` (branch point), bw-board `1dac64c` (and CI's
own clone of bw-board master), sb3-creator `553a639` — 2,098 circuit files.

**CI evidence** — the gates ran, against freshly cloned siblings.
[run 32785286382](https://github.com/CrispStrobe/bw-circuit-ui/actions/runs/32785286382)
at `bf22e34`:

```
  vendor fixtures: 4, disagreeing 1
  exports read both ways: 2098 documents
  nets under OUR rule 11683, under EASYEDA's 11683
  disagreeing documents: 0
  Q drawn pin the symbol art does not reach          0 / 2098 circuits, 0 occurrences
  Q2 symbol lead reaching no pin                    44 / 2098 circuits, 44 occurrences
  U drawn geometry outside the viewBox               0 / 2098 circuits, 0 occurrences
  57672 text runs inspected — no class before this one read any of them
  V two pin NAMES overlapping                       57 / 2098 circuits, 105 occurrences
  W net label TEXT on foreign copper               104 / 2098 circuits, 172 occurrences
# tests 994   # pass 980   # fail 0   # skipped 14
```

(Locally 1005/988/0/17 — eleven tests register only with a local-only fixture.)

## 16. The 403: closed, and now proved by REINTRODUCTION

Re-verified at this sha rather than carried over: **Q is 0 / 2098**. The fix
landed in `be4f0e1`; what was missing was the proof the DoD names.

The class-Q gate had one mutation, which slides a pin off its own lead. That
proves the DETECTOR reads geometry. It does not prove the thing that keeps the
corpus clean, which is the projection's RULING about whether a kind's artwork
can host this instance's terminals. So there is now a second mutation that
re-creates the defect itself:

```
MUTATION: REINTRODUCING a bad symbol turns class Q red
  class Q reintroduction fixture: 01-blink/circuit-flat.attiny88.json
```

It takes a symbol the projection ruled generic, forces `generic = false`, and
sets its kind to `seven_segment` — artwork with exactly two lead ends at
(±30, 0), which is precisely the state `disp-sevenseg` shipped in. Every pin
but the two at y=0 must land in blank space. If that ever passes, the
projection has stopped choosing the box on the artwork's ability to reach the
pins and the 403 is on its way back.

## 17. EasyEDA, both directions, with denominators

### The exposure, restated precisely

Our solver folds in a **T** — a registered point on another segment's span —
because that is KiCad's rule. EasyEDA does not imply one. The export side was
measured clean by an independent reader (0 cross-net contacts over 2,098), so
**the exposure is import-only**: a schematic drawn in EasyEDA can behave
differently here than in the tool it was drawn in.

### Read the same file twice, with the same tested solver

`easyEdaPartition(text)` is the tested oracle over EasyEDA's own
`(designator, pin-number)` nodes, independent of our kind mapping. It now
takes `{strict: true}`, which applies EasyEDA's junction rule through the same
`NetSolver` — `solve({foldTeeAt})`, opt-in, so KiCad's readers are untouched.

Using it rather than a fresh walk is not fastidiousness. An ad-hoc script has
to re-learn that `F` power flags and `N` labels join **by name** so a
label pair is one net however far apart the labels sit; that `BE` bus entries
conduct while `B` bus bodies do not; that a pin on a wire's span is a
connection; and that names are scoped per sheet. Miss any and the run invents
dangling ends that are not there — the mistake made four times from this side
before the tested solver existed.

### The table

| corpus | documents | nets, our rule | nets, EasyEDA's | agree | J-less T | net-split | node-orphan |
|---|---|---|---|---|---|---|---|
| our own exports of every shipped circuit | **2,098** | 11,683 | 11,683 | **2,098 / 2,098** | 0 | 0 | 0 |
| vendor-dialect fixtures | 4 | 5 | 5 | **3 / 4** | 1 | 0 | **1** |

Every disagreement is classified, and there are only two shapes it can take,
because the strict rule can only ever REMOVE connections:

- **net-split** — one permissive net is two or more strict ones;
- **node-orphan** — a node with a net under our rule and none under theirs; in
  EasyEDA it is a dangling pin.

The one disagreement, in full:

```
easyeda-rc-divider.json: ours 2 nets, EasyEDA 2; 0 split, 1 orphaned (P1/2)
                         J-less T at 100,-240
```

### The trap in the obvious instrument, which has its own test

**A table of net counts would have called that file clean.** Ours: 2 nets.
EasyEDA's: 2 nets. The undotted T joins `P1/2` to a net that already has two
other members, so under EasyEDA's rule that net loses a member and remains a
net. The connector pin is dangling all the same, and only a NODE-level
comparison sees it. The DoD asked for "how many nets we infer vs how many
EasyEDA's junction rule would give"; that column is in the table above and it
is the column that would have missed the defect. The gate asserts on the
classification.

### The import warning now carries what it costs

A bare joint count is not actionable — a file can carry ten J-less Ts and lose
nothing, or one and drop a pin. The warning names the coordinates, the kind of
each joint, and the same document read the other way:

```
1 T-joint(s) without a junction (1 wire-to-wire); EasyEDA treats these as
crossings, so these connections exist here and not on the board -- at
100,-240. Read EasyEDA's way this document has 2 net(s) rather than 2:
0 net(s) come apart, and 1 pin(s) end up connected to nothing (P1/2)
```

When nothing is in dispute it says so instead, rather than leaving the reader
to guess whether a count of ten matters.

### Honesty bound on the denominator

**This box holds four EasyEDA documents and no live corpus.** The 2,098-row is
our own exports read back, which measures the exporter and not the importer;
the 4-row is the only real vendor-dialect evidence here. So
`scripts/easyeda-roundtrip.mjs` takes `EASYEDA_DIR=<directory>` and produces
the same classified table over any tree of real schematics — the import-side
denominator is one command away for whoever has the files. It refuses an empty
directory rather than printing a clean-looking zero.

## 18. What still no detector reads — not zero, and here is the number

The third pass found a third of the ink outside every denominator. The
question was whether that is now zero or merely smaller. **Merely smaller.**

Enumerating what `schematic-svg.js` emits against what classes A–T read leaves
two families:

| | class | circuits | occurrences | verdict |
|---|---|---|---|---|
| **U** | drawn geometry outside the viewBox | **0 / 2098** | 0 | clean |
| **V** | two pin NAMES whose text boxes overlap | **57 / 2098** | **105** | ratchet |
| **W** | a net label's TEXT on a foreign net's conductor | **104 / 2098** | **172** | ratchet |

**57,672 text runs** are drawn across the corpus and not one class had ever
looked at any of them. U is the geometric remainder and it is clean: nothing
is drawn off the page.

**V and W are narrowed on purpose.** Measured raw, 813 pairs of text runs
overlap and 1,525 text runs sit on copper. Most of that is not a defect:

| raw finding | occurrences | verdict |
|---|---|---|
| a part's kind name under its own label | 388 | untidy, misleads nobody |
| a pin name under its part's label | 320 | untidy |
| **two PIN NAMES over each other** | **105** | **information destroyed** |
| a part label lying over a wire | 1,353 | untidy; it names a part, not a net |
| **a NET LABEL's text on FOREIGN copper** | **172** | **misleading** |

Counting the untidy ones would have made W eight times bigger and eight times
less true — the same 14× mistake class P made in the second pass, avoided here
by classifying before reporting.

The two that survive are real. A labelled box is 52px wide with its names
drawn inward from ±22, so two long names facing each other (`GPIO16`, six
characters at 6.5px, reaches 23px) collide and NEITHER can be read — the
reader loses the one thing the labelled box exists to provide. And class P
already forbids a label's LEADER from touching foreign copper; the text is the
other four fifths of the same mark, and it is the half a reader actually
reads.

### The glyph model, and why the ratchets name it

Both counts depend on a text-metrics model: monospace at `TEXT_ADVANCE = 0.6`
em per character, 0.7 em cap height. DejaVu Sans Mono — the usual resolution
of `font-family="monospace"` — advances 0.602 em. Swept:

| advance | V pin-name collisions | W label texts on foreign copper |
|---|---|---|
| 0.50 | 55 | 124 |
| 0.55 | 68 | 139 |
| **0.60** (nominal) | **105** | **172** |
| 0.62 | 105 | 172 |

The counts roughly double across that range. **The classes are real at every
setting — the conservative floor is 55 and 124, not zero — and their
magnitude is a property of the model, not of the drawing.** The gate asserts
the constant, so changing it fails loudly instead of silently re-baselining
the ratchets against a different drawing.

These are ratchets rather than zeros because fixing them means a
collision-aware text placer, which would churn all 32 baselines; that is a
scoped change and not this lane's. What is not deferred is the measurement:
they can only shrink from here.

## 19. Gates added

| gate | class | mutation |
|---|---|---|
| `schematic-geometry-corpus.test.js` | Q | **reintroduce a bad symbol**: force a generic symbol back onto two-lead artwork |
| " | U | push a pin 40px past the page edge |
| " | V | give two facing pins fifteen-character names across a 52px box |
| " | W | lengthen a label's text until its box reaches foreign copper — derived from the STRING, so it proves the class reads drawn text |
| `easyeda-junction-rule.test.js` | the two readings | a net-count table would call the defective fixture clean; the classification must not |
| " | " | the strict reading is not vacuous — dotted Ts still fold in |
| " | " | 2,098 exports read both ways, 0 disagreements, with a floor on nets read so two empty readings cannot agree trivially |

Corpus gate: **33 tests, 33 pass**. Junction-rule gate: **8 tests, 8 pass**.

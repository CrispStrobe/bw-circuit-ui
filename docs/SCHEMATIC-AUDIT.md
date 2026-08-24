# Schematic viewer — end-to-end audit

Measured by RENDERING every shipped circuit, not by reading the code.

## Denominators move — every number here names its sha

The corpus is another repo's tree and it changes under this document. Both
figures below are correct, at their own sha, and the difference is nine circuit
files deleted upstream:

| sb3-creator sha | circuit files |
|---|---|
| `965d1720c9dc636a051acafdea8a1af4a7a5cc57` (first measurement) | 2,107 |
| `3c4973b08034a25f1e1e7edda64e600282459804` (current, and what CI clones) | 2,098 |

**The current, authoritative rig:**

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

**Rig for every number below:**

| repo | sha | role |
|---|---|---|
| bw-circuit-ui | `1b854032a7c38159bea3b919e5341e233b6d1e6f` (branch point) | the projection |
| bw-board | `a7338cdcdd5d54122bdc5be44c02908bdb6a4fd6` | the engine that resolves nets |
| sb3-creator | `4a0826ae492d4b6b4f00d90528074e31c510c16d` | the corpus, 2,098 circuit files |

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

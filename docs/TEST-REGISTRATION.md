# Which tests actually run — a census

**Measured 2026-08-25**, at bw-circuit-ui `a799945`, after stc-b6 noted in
LANES that this repo's `npm test` enumerates its files explicitly and an
unregistered test therefore never runs.

## What was found

`npm test` is one long literal list of paths. A test file that is not in it
does not run, does not fail, and does not show up anywhere as missing — the
count simply omits it and still looks healthy.

| bucket | files | ran in CI before |
|---|---|---|
| listed in `npm test` | 105 | yes |
| `examples-fabric-gate.test.js`, its own CI step | 1 | yes |
| `test:boards` | 3 | **no — CI never invoked the script** |
| `test:render` | 6 (2 of them launch a browser) | **no** |
| `test:a2` | 1 | **no** |
| **in no script and no CI job at all** | **17** | **no** |

The 17 orphans held **87 tests, 5 of them failing.** Three whole scripts
existed that CI never called, so ten further files were gated on someone
remembering to type them.

## The five failures, diagnosed rather than deleted

| test | verdict |
|---|---|
| `controller-faces` — *onSetPartParam is threaded from SvgParts call site* | **the test was wrong.** It sliced `indexOf('<SvgParts') + 2000` characters and the prop sits at offset **2321**. The code is present and correct; the element merely grew. Now slices the JSX element, not a byte count. |
| `ili9341-face` — *parallel variants have terminal offsets* | **the test was wrong**, same shape: `+ 5000` against a case at offset **5394**. Now takes the function body by brace balance. |
| `extractor-ladder` — *E6 full EATER6502* | **a real disagreement, and not ours.** See below. |
| `debug-status`, `snapshot-render` | hard-import `playwright`; no browser here. Moved to `test:browser`. |

A byte-window scrape does not test what it claims to test — it tests the
file's length, and it fails the first time anything above it grows. Both were
invisible because neither file ran.

### The extractor disagreement (bw-board's, recorded not patched)

`extract6502Machine` and the `EATER6502` preset are both bw-board's, so this
test compares that repo against itself:

```
extracted chips: [{via1, at 0x6000, span 8192}, {acia1, at 0x5000, span 4096}]
preset chips   : [{via1, at 0x6000},            {acia1, at 0x5000}]
```

`m6502-machine.js:184` reads `c.span || regs`, so the preset's implicit span is
the chip's **register count, 16**. The extractor's spans are the board's real
decode windows. That is not a missing field, it is different emulated
behaviour: on Ben Eater's board the decode uses the high address lines, so the
VIA is selected across `$6000–$7FFF` and mirrors every 16 bytes. A program
reading `$6010` finds the VIA on real hardware and on the extracted config, and
finds nothing on the preset config. **The extractor is the faithful one.**

This repo may not edit a sibling, so the test now compares the fields the
preset defines and carries an `OPEN DEFECT:` sentinel for the span. When
bw-board settles it the sentinel goes red, and the instruction to fold `span`
back into the comparison is written on it.

## The gate I cited that had never executed

`easyeda-export.test.js` contains a 2,098-circuit export → re-import partition
round trip, which **`docs/SCHEMATIC-AUDIT.md` cited as evidence in its fourth
pass.** It was invisible twice over:

1. the file was not in `npm test`; and
2. its corpus resolved to a single hardcoded
   `$HOME/code/lego/brickwright-lite/overlay/scratch-gui/examples` — a path
   that exists on neither this VPS (the repo is under `/mnt/volume1`) nor CI
   (`HOME` is `/home/runner`) — so `haveExamples` was false everywhere and both
   corpus blocks **skipped, silently, always**.

It now resolves its corpus the way every other corpus gate does, and runs:

```
corpus census: 2099 files — 2097 full, 2 partial (named skips),
               0 not loadable as circuits, 0 MISMATCHED
skip census: [["breadboard",1119],["ps2",2]]
```

So the claim was true and the evidence was not there. It is now.

## What CI runs after this

`npm test`, the fabric gate, and — newly — `test:boards`, `test:render` and
`test:a2`. `test:render` no longer contains `rendering.test.js`, which
hard-imports playwright.

## The nine browser tests, and a near-miss worth recording

`test:browser` holds all nine. Four hard-import playwright. **The other five
look safe for `npm test` and are not**: they wrap the import in `try/catch` and
skip on `!chromium`, which asks whether the *package* is importable, not
whether a *browser* exists. CI runs `npm install`, which installs playwright (a
devDependency) **without downloading browsers** — so in CI the guard passes,
the suite runs, and `chromium.launch()` throws. Registering them into
`npm test` would have turned CI red. Caught by reading the guard rather than
trusting that it had skipped locally.

## I walked into the trap I had just documented

The section above was written, and then `test:render` was wired into CI and
**CI went red on exactly that failure**:

```
Headless render gates
  browserType.launch: Executable doesn't exist at
  /home/runner/.cache/ms-playwright/chromium_headless_shell-1228/...
  # tests 30   # pass 25   # fail 0   # cancelled 5
```

`mcu-device-label.test.js` and `pendant-attiny88.test.js` live inside
`test:render` and launch a browser. They were missed because the detector for
"needs a browser" grepped two literal **import** forms — and these reach
playwright another way. Locally they skipped (no playwright at all) and the
script passed, so the local run said nothing.

The lesson is not "check more carefully". It is that **the property to detect
is what a file DOES, not how it imports**: a launch cannot be disguised, an
import can. So the list is now derived from `*.launch(`, and there is an
invariant rather than a list:

> **Nothing reachable from CI may launch a browser.**

`test/test-registration.test.js` asserts it, mutation-proved:

```
MUTATION — a browser test put back into a CI-run script
not ok 3 - nothing CI runs launches a browser
    +   'test/mcu-device-label.test.js'
```

Local green would not have caught this, and does not now — the invariant does.

## The structural fix

`test/test-registration.test.js` asserts that every `test/*.test.*` file is
reachable from an npm script or a CI step, and that the set CI does *not* run
is exactly a recorded list with a reason per entry. Both directions are
mutation-proved:

```
MUTATION 1 — an unregistered file appears
not ok 2 - no test file is missing from every npm script and every CI step
    +   'test/zz-mutation-proof.test.js'

MUTATION 2 — a recorded browser test is wired into CI
not ok 3 - the files CI does not run are exactly the ones on the record
    -   'test/e2e.test.js'
```

It reads only the **values of `run:` keys**, block scalars included, with
comments stripped. The first version matched `npm (run )?<name>` against the
whole workflow and counted an explanatory *comment* mentioning
`npm run test:browser` as CI running the browser suite — reporting every file
as covered. A detector that reads text which merely looks like a command is
the same error as one that reads a `data-testid` as a storage key, and it
happened while writing the gate against exactly that failure.

## Counts

| | before | after |
|---|---|---|
| `npm test` | 1,675 tests, 0 fail | **1,775 tests, 0 fail**, 4 skipped |
| test files run by nothing | 17 | **0** |
| test files in a script CI never calls | 10 | **0** |
| test files deliberately outside CI | undeclared | **9, each with a reason** |

The +100 is the newly registered files counted one by one (+95) plus
stc-b6's `easyeda-pin-numbering.test.js` (+5), which landed in `eade8e3` while
this lane was open and conflicted on the same `test` line; both sides'
registrations are kept. The
baseline was re-measured on unmodified master rather than remembered — a
figure carried from an earlier session would have been 1,005 and wrong, the
suite having grown under this lane.

## CI evidence

[run 32854558234](https://github.com/CrispStrobe/bw-circuit-ui/actions/runs/32854558234)
at `efbafb5`, all five steps green:

```
  corpus census: 2099 files — 2097 full, 2 partial (named skips),
                 0 not loadable as circuits, 0 MISMATCHED
  138 test files on disk, 137 reachable from an npm script, 127 reachable from CI
# tests 1097   # pass 1083   # fail 0   # skipped 14
```

The corpus census line is the point: that gate had never executed anywhere
before this lane, and it now runs on every build.

(CI's `npm test` count is lower than the local 1,776 because several suites
register tests only when a local-only fixture is present.)

---

# The browser suite, run for the first time

`npm run test:browser` had never been executed: this checkout had no
`node_modules` at all, and the files were outside every script. Installing
devDependencies and a matching chromium made it runnable, and it reported
**40 tests, 21 pass, 19 fail** — not the 5 the orphan census had counted,
which was only ever the two browser files the census could attempt.

## 19 → 0, in four causes

**1. Nineteen failures, one missing server (19 → 11).** `debug-status`, `e2e`,
`rendering` and `snapshot-render` navigate to a hardcoded `localhost:3100` and
start nothing — they assume a human has `npm run dev` open. Run unattended
every one fails `ERR_CONNECTION_REFUSED`, which reads like nineteen broken
features and is one missing server. They now use `test/_dev-server.js`.

While writing it: `serial-console` and `pendant-attiny88` both claimed port
**3195**. `node --test` runs files concurrently and vite is started with
`--strictPort`, so the loser dies rather than falling back — a flake waiting
for an unlucky schedule. Ports live in one table now, uniqueness is asserted at
import, and `test/test-registration.test.js` checks the table against the files
**in CI**, where the browser suite itself never runs.

**2. The UI moved (11 → 6).** Controls became icon buttons (`title="Simulation
mode"`, `"Undo (Ctrl+Z)"`), Save moved into the ⋯ overflow menu, the palette
gained a search box and labels its parts by value (`Resistor 1kΩ`), the
multimeter hides behind a `⌁ Meter` toggle, and the SNAPSHOT/HARDWARE status
became the `title` of a collapsed chip. Each assertion was pointed at the
surface the UI now uses rather than deleted — the claims are unchanged.

**3. The harness had lost its presets (6 → 2).** `CircuitDesigner` renders
`InferPanel` only when no `examples` prop is given, and the dev harness gained
three curriculum examples, which displaced the numbered presets the render
tests assert engine values against. `?examples=none` gives the tests a way
back to them; nothing about the app changed.

**4. A real product defect (2 → 0).** See below.

## The defect the browser tests existed to catch

The last two failures were `should show 2.1V junction` — and the reason was
not the test. Loading a preset produced:

```
netlist-rejected
Invalid netlist:
  - Net "breadboard_1:n-col-b1" references unknown part "led_13"
  - Net "breadboard_1:n-col-b1" references unknown part "mcu_2"
  … 46 nets
```

`useCircuit.loadInferred` cleared `circuit.parts` and `circuit.wires` — **but
not `circuit.breadboards`.** A breadboard is not a part, so the previous
circuit's board survived, its strips went on resolving nets naming the parts
just deleted, the engine refused the whole netlist, and the board went
inactive. In the app: **load an example, simulation dead.**

`handleClear` in `CircuitDesigner.jsx` had always cleared them. The repo knew
the rule; one path missed it. One line.

With it fixed, and power switched on (Simulation mode no longer implies power),
the circuit solves and the assertion is satisfied by the real thing:

```
volts: 2.1V 5.0V     percents: 14%
```

which is the comparison the simulator exists to make — the active-low LED at
~14.5 %.

Mutation-proved: reverting that one line brings `netlist-rejected` straight
back. And because the browser suite may never run in CI,
`test/load-clears-breadboards.test.js` gates the same invariant headlessly —
including a test asserting that the *reproduction still reproduces*, so the
gate cannot quietly go vacuous.

## Counts

| | before | after |
|---|---|---|
| `npm run test:browser` | 40 tests, **19 fail** (and unrunnable before that) | **40 pass, 0 fail** |
| `npm test` | 1,776 | **1,778**, 0 fail |

---

# The three vacuous tests

`test/debug-status.test.js` had three tests. One navigated, waited 500 ms and
closed the page **without asserting anything**, under a comment explaining what
should have happened:

```js
await p.goto(`${server.url}/?debug=snapshot`, …);
await p.waitForTimeout(500);
// Note: debugState in main.jsx snapshot mode has halted:true but no
// haltReason/tasks — The DebugStatus should still show HALTED
await p.close();
```

It reported green for as long as it existed, because there was nothing in it to
fail. The comment was also wrong: `main.jsx` passes `haltReason: 'user'`,
`bwMs` and tasks for snapshot mode. **A vacuous test is worse than a missing
one** — it occupies the slot the real check would go in and reports success
from it.

## Why the surface was invisible

`DebugStatus` docks inside the instruments panel, which is collapsed by
default, so nothing it renders reaches `body.innerText` until the panel is
opened. That is presumably why the assertions were never written.

It also has no test handle, and body text is not a usable substitute: the
simulation-controls panel beside it renders the same ⏭/↩ glyphs, so a
text-based assertion passes even in `live` mode — where `DebugStatus` returns
`null` and renders nothing at all. It now carries `data-debug-status`, the same
idiom as `data-meter-module` on the multimeter, and every assertion is scoped
to it.

## What they assert now

The component exists for one distinction — *"a non-zero skew turns this from a
frozen world into a SNAPSHOT of one that kept moving"* — so the tests turn on
exactly that. `paused` and `snapshot` are **both HALTED** and differ only in
the wall-time line:

| mode | mounted | says | wall-time line |
|---|---|---|---|
| `snapshot` | yes | HALTED, "by user", `1250.7 ms`, frozen | **`+4.2 s ahead (board kept running)`** |
| `paused` | yes | HALTED, "Hit breakpoint", `82.3 ms`, frozen | **absent — the board froze with the program** |
| `live` | **no** (`!debugState → null`) | the chip still reports LIVE | — |

A test that only checked "says HALTED" would pass on either and could not tell
a pause from a snapshot, which is the falsehood the surface exists to prevent.

## Mutation-proved three ways

```
1. snapshot's skewNs → 0n  (a snapshot posing as a pause)
   not ok 1 — 'a non-zero skew must be reported as wall time ahead — without it a
              snapshot is indistinguishable from a frozen world…'

2. paused given skewNs 3 s  (a pause posing as a snapshot)
   not ok 2 — 'skewNs is 0, so there is no wall-time skew to report. If this line
              appears the surface is showing a snapshot where there is only a pause.'

3. live given a debugState  (the surface must not mount)
   not ok 3 — 'with no debugState the debugger surface must not mount…'
```

Each fails for its own reason and the other two stay green — so the three tests
are independent, not one assertion written three times.

| | before | after |
|---|---|---|
| `debug-status.test.js` | 3 tests, **1 asserting nothing**, 0 discriminating | 3 tests, **3 mutation-proved** |
| `npm test` | 1,778 | **1,781**, 0 fail |
| `npm run test:browser` | 40 pass | **40 pass** |

---

# The sweep: every test that asserts nothing

`debug-status` raised the obvious question — how many others? Swept all 138
test files: every `test()` / `it()` whose body contains no assertion **and** no
call to a local helper that asserts on its behalf.

## The detector needed correcting three times, and that is the finding

| version | reported | why it was wrong |
|---|---|---|
| v1 | **29** | looked for the next `{` after the test name, so an arrow with an EXPRESSION body (`() => assert.ok(x)`, no braces) was matched against some object literal further down the file |
| v2 | **5** | scanned raw source, so the words *"must sit BEFORE it (inside the svg)"* in a **comment** matched `it(` and accused `z-contract-order.test.js` |
| v3 | **4** | scanned with comments stripped but strings kept, so `"N test(s) contain no assertion"` in **the gate's own error message** matched `test(` and it accused itself |

29 → 5 → 4. All three are one mistake in different clothes: **reading text that
merely looks like code.** The shipped detector locates calls in a copy with
comments blanked *and string contents blanked*, then reads names back from a
copy that keeps the strings — offsets preserved in both.

It carries six controls, and the four false-positive traps are the ones that
matter: a helper-delegating test, an arrow expression body, a message
containing `test(s)`, and prose containing `it (`. All four read clean; the two
genuinely empty ones are flagged.

## The four, and what each became

| test | was | now |
|---|---|---|
| `interaction.test.js` — *empty circuit, no crashes on advanceTo* | the throw was the only check, and implicit | explicit `doesNotThrow`, plus a postcondition: still no parts, no wires, no nets — the difference between "did not crash" and "did the nothing it was meant to" |
| `presets.test.js` — *loads into Circuit without crash* | same, and a preset inferring **zero parts** sailed through it | asserts parts were inferred and all reached the circuit, that advancing does not throw, and that no resolved net names a part the circuit lacks (the `netlist-rejected` shape) |
| `serialiser-roundtrip.test.js` — *summary: report all losses* | `console.log` only; losses could triple in silence | ratchet at **33 losses across 11 files**, plus a floor of 200 files so a summary over nothing cannot report "no losses" |
| `terminal-crosscheck.test.js` — *summary: two populations* | `console.log` only | ratchets at **162** naming diffs and **4** coverage gaps, counted apart so a real gap cannot hide inside naming churn |

Each ratchet fails in **both** directions: above it is a regression, below it
means the ratchet has stopped ratcheting and must be lowered in the same
commit.

Mutation-proved:

```
serialiser ratchet 33 → 32   not ok — '33 serialiser losses across 11 files, ratcheted at 32…'
crosscheck gaps    4 → 3     not ok — '4 kinds the engine does not model (ads1115, max6675,
                                       microbit_arcade, seven_seg_8), ratcheted at 3…'
presets: infer no parts      not ok — '01-blink: inferred no parts at all, so "loads without
                                       crash" is vacuous'
```

## The gate

`test/test-registration.test.js` now asserts **no test file contains a test
that asserts nothing** — with an empty allowance list, so there is nowhere to
hide a new one. Mutation-proved by adding a vacuous test (flagged) and one
whose only `assert` is inside a comment (also flagged).

## An upstream note, not this lane's work

`docs/schematic-baselines/78-a2-calculator.svg` is regenerated here and the
change is **not mine**: sb3-creator moved a third time today
(`09c6753` → `d7f2c3c`) and **reverted** that circuit — `seven_seg_4` ×2 back
to `sevenseg8` ×1, wires 66 → 55. The new render is byte-identical (34,874 B)
to the one taken at `1d846130d`, i.e. the drawing is exactly where it was
before the earlier swap. Reviewed as 417 → 350 elements, consistent with two
4-digit displays collapsing into one 8-digit module.

**Worth someone's attention:** that circuit has now been swapped, swapped back,
and re-baselined three times in one day, and the baseline gate records no
corpus sha — so the churn is invisible until the gate fails, and it fails for
whoever pushes next rather than for whoever moved the corpus.

---

# Pinning the corpus in the baseline gate

The previous section flagged it: the baseline gate recorded no corpus sha, so
when sb3-creator moved under it the failure said only `X.svg changed` and
landed on whoever pushed next — reading like a rendering regression when it was
an upstream edit. `78-a2-calculator` moved **five times on 2026-08-25**, and
the history shows why it was not thrash but a deliberate hold:

```
b627b0d  A2 rescue: land the crashed session's work…
86cc6cb  Hold 78-a2-calculator back: its new display kind has no part in bw-circuit-ui
818557c  cui pin 410f8ce -> af5cc08, and 78-a2-calculator comes off the shelf
```

## What is recorded, and why not just the sha

`docs/schematic-baselines/CORPUS.json`, written by
`render-schematic.mjs --baselines` **in the same act that writes the SVGs** —
a stamp written separately is a stamp that drifts:

```json
{ "corpusSha": "42c6b241…",
  "sources": { "74-ammeter/circuit.json": "6d08fed1b68d4de0", … 32 entries } }
```

A per-file **content hash**, not just the git sha. The sha says the tree moved;
the hashes say whether it moved anything *these baselines actually draw* — and
they still work where the corpus is a copy, a tarball, or a shallow clone with
no useful history. The sha is informational only.

## The gate now names the cause

When a baseline differs, the source hash decides which of two very different
things happened:

| source hash | verdict |
|---|---|
| **changed** | `THE CORPUS MOVED under these baselines … so this is not a rendering regression`, naming the file and both hashes |
| **identical** | `the drawing changed while every source circuit stayed byte-identical, so this IS a rendering change in this repo` |

A corpus move that touches nothing these baselines draw is **not** a failure —
it prints a line and passes:

```
corpus has moved since the baselines were stamped: 42c6b24 -> 23a16d4
```

which happened, unprompted, during the verification run for this very change.

## Mutation-proved four ways

```
1. a baselined SOURCE changes upstream (a corpus COPY, sibling never touched)
   not ok 4 — THE CORPUS MOVED under these baselines …
              74-ammeter/circuit.json  6d08fed1b68d4de0 -> 1e80dc72c3cec988

2. the PROJECTION changes, sources byte-identical (MARGIN_X 70 -> 72)
   not ok 4 — the drawing changed while every source circuit stayed
              byte-identical, so this IS a rendering change in this repo

3. a baseline added without re-stamping
   not ok 3 — a baselined circuit has no recorded source hash …

4. the stamp deleted
   not ok 3 — docs/schematic-baselines/CORPUS.json is missing …
```

Note the first proof: the corpus is a read-only sibling, so the "upstream
change" was made in a **copy** pointed at by `EXAMPLES_DIR`, never in the
mirror. The first attempt at it also failed to reproduce — moving a part's
`x` changes nothing, because the schematic computes its own layout — so the
edit had to be something the drawing actually reads (a resistor's `ohms`,
which is rendered as its value label).

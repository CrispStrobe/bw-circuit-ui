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

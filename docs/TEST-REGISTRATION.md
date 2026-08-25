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
| `test:render` | 6 | **no** |
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

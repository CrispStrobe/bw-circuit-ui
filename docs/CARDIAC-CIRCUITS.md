# CARDIAC and the Brickwright I/O adapter

This circuit part connects a decimal teaching computer to a small, explicitly
modern I/O adapter. The original Bell Labs CARDIAC was made from cardboard and
had no electrical terminals. The independent engine implements its documented
instruction set; the adapter below is a Brickwright teaching extension.
Instruction semantics and historical source references are maintained in the
[pinned Board contract](https://github.com/CrispStrobe/bw-board/blob/0f6b38a8d6d3b15861ee7b35eda45e5db45035f2/docs/CARDIAC.md).

## Wiring

| Terminal | Behavior |
| --- | --- |
| `IN` | Sample the solved voltage relative to `gnd` with **Sample IN once**. The adapter clamps 0–5 V to one integer card from 000 to 999. Merely changing voltage adds no cards. |
| `OUT` | The latest output card 001 latches a nominal 5 V drive; every other word latches 0 V. Complete numbers remain visible in the output tray. Use a series resistor for an LED. |
| `5v` | The simplified adapter's 5 V supply for this experiment. |
| `gnd` | Reference and return. |

These are educational source/drive models, not the electrical specifications of
an historical product. Word values are decimal. The 100 memory cells are not
100 bytes, and the display rate in instructions per second is a teaching rate,
not historical clock timing.

## Use the circuit controls

Place **CARDIAC + Brickwright I/O adapter** from Boards. Its instrument panel
reads the actual active Board and offers Run, Pause, Step and Restart. Run wakes
the existing shared circuit clock. The panel contains no second interpreter,
clock or instruction loop. In an embedded host, the host remains the clock owner.

Choose **Manual cards** to queue signed values from -999 through 999. Choose
**Circuit samples** to queue a measured `IN` card. Both actions are deliberate;
every queued card keeps its source label. An empty input instruction waits
without writing an invented zero. A voltage change does not release that wait
until a sample is explicitly queued.

**Open CARDIAC lab** emits `bw-cardiac-open` with `{partId}`. Brickwright opens
the full code/memory view for that part using the Board already supplied by
`CircuitDesigner.onBoardReady`. This event never creates another machine and
contains no portable live-state object. A standalone Circuit UI host can use
the same event to provide its own editor; the compact circuit controls remain
usable without that host.

After a host successfully loads a program into that same Board, it emits
`bw-cardiac-program-loaded` with `{partId, program: {words, entry}}`. The designer
checks that the supplied image matches the active engine's accepted image,
then saves the engine image with the circuit. A stale or unaccepted image is
ignored. Equivalent repeated notifications preserve the program counter,
live stores and queued cards; they do not reload the machine.

The compact panel emits `bw-cardiac-run` with `{partId}` after an accepted Run.
Before Pause, Step, Restart or a program load, it emits `bw-cardiac-pause` so an
attached host can stop its shared scheduler before that mutation. The host
matches the CARDIAC target and part id; unrelated runners ignore the events.
These notifications do not install another timer or interpreter.

## Night-light experiment

**Open wired night-light example** loads one CARDIAC, a potentiometer representing
a light-level sample, a 1 kΩ resistor and a yellow LED. Six editable wires carry
power, the measured input and the output current. The program compares each card
with 500 and outputs 001 below that threshold, otherwise 000. It then waits for
the next card. A card exactly equal to 500 turns the lamp off.

The numeric image matches the original `cardiac-night-light` source in
`sb3-creator/src/utils/cardiacExamples.js`: data cells 80–84, entry 01. The other
numeric examples match `cardiac-echo` and `cardiac-add`. The full Brickwright
integration should compare the assembled source against this saved image.

## Persistence and ownership

Each part saves the accepted initial `{words, entry}` image in `params.program`.
Program controls persist only after the engine accepts the whole image. An
invalid load leaves the previous program intact. Live stores, instruction
position, output history and queued cards are runtime state; they do not silently
rewrite the authored image. Restart restores that image. Structural circuit
edits rebuild the Board and reset runtime; ordinary re-rendering does not.

Machine state comes from `board.getDeviceState(partId)`. All mutations use
`board.setDeviceControl(partId, verb, value)`. The Board's CARDIAC device owns
instruction scheduling and updates the same solver nets as every other part.
Two placed CARDIACs retain separate memory, programs and input queues.

## Authorship and checks

The panel, help text, connector SVG and numeric examples are independently
authored. `scripts/generate-cardiac-connector.mjs` generates the original SVG
and its terminal sidecar; no historical board artwork, manual page, firmware or
third-party emulator UI is included. These assets are protected as local files
in the parts sync and their contacts share the rendered face's coordinates.

Run `npm run verify:cardiac` for the generated-asset and circuit integration
checks. `npm run verify:cardiac:browser` exercises the actual CircuitDesigner,
its controls and electrical output in Chromium, including a 390-pixel viewport.
It writes its own bounded result and screenshots and fails when browser launch
or any assertion fails. The browser harness is not the full Brickwright app;
full-host assembly, lessons, debugger and `.sb3` persistence have separate gates.

Qualification results must identify the tested `bw-board` revision and whether
it was the installed package or a local development link. Local results do not
claim hosted CI or a deployed application.

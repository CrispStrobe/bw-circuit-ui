# Busch Microtronic 2090 in Circuits

The **Boards → Busch Microtronic 2090** palette entry places a functional
learner computer with eleven wire terminals and opens its controls in
Instruments. The controls operate the Microtronic device on the active circuit
Board. Its display, registers, flags, input/output values and program counter
come directly from that device.

This first integration is an original **behavioral model** of the documented
learner instruction set. Native TMS1600 firmware execution and the later
firmware rewrite are separate work. No historical firmware, external emulator
implementation or manual artwork is included.

## Try the connected example

1. Add the Microtronic from Boards.
2. Press **Open wired I/O example** in its controls. This opens a complete
   editable circuit; the previous circuit remains in the normal undo history.
3. Press **Run**, then toggle IN1, IN2 or IN3 in the existing Switches controls.
   The corresponding external LED follows each input through the running
   three-instruction program.
4. OUT4 changes with the separate 1 Hz clock because the example explicitly
   wires `CLOCK` to `IN4`. Removing that wire removes that input signal.

The example contains ordinary resistors, switches, LEDs and wires. It does not
animate LED states in the interface. The engine's electrical solver supplies
their voltages and current. IN1/OUT1 has weight 1; IN4/OUT4 has weight 8.

The original sample programs are in `src/model/microtronic-demo.js`:

| Program | Words | Behavior |
| --- | --- | --- |
| Input to output | `FD0 FE0 C00` | Read the input nibble into R0, write R0 to the output latch, repeat. |
| Binary counter | `100 FE0 510 C01` | Initialize R0, display its nibble on the four outputs, increment and repeat. |

## Programs and front-panel keys

The program editor accepts three-digit hexadecimal words, optional `00:`
address labels and `;` comments. **Load program** validates the complete source
before replacing memory. **Run** and **Step** first load an edited draft;
ordinary live display refreshes preserve the draft. **Open file** reads a
local text program into the editor. It does not execute it immediately.

The six-column keypad follows the original documented layout:

| | | | | | |
| --- | --- | --- | --- | --- | --- |
| C | D | E | F | NEXT | REG |
| 8 | 9 | A | B | BKP | STEP |
| 4 | 5 | 6 | 7 | RUN | HALT |
| 0 | 1 | 2 | 3 | C/CE | PGM |

Use `HALT → NEXT → two hex digits` to select a program address. Enter three
instruction digits and press NEXT to commit them and advance. `HALT → REG →
one hex digit` selects a working register. RESET clears runtime registers,
outputs and time, while retaining the program. PGM 3 and 4 set/view time;
PGM 5 and 6 fill program memory. Other built-ins report unsupported rather
than pretending to execute native monitor code.

Keyboard shortcuts are confined to the focused front panel: hexadecimal keys,
Enter for NEXT, Escape for HALT, and Space for Run/Halt. Textarea editing and
native button activation retain their normal keyboard behavior. Repeat
keydown events do not enter unintended repeated digits.

## Persistence and time ownership

Accepted loads and committed keypad edits write canonical source to the
selected part's `params.program`. Circuit save/load, autosave, duplication and
undo therefore carry the actual accepted learner program. Each trainer has
separate program memory and controls. An uncommitted textarea draft is not
part of the saved circuit.

Run activates the existing shared circuit simulation and preserves the
machine state that accepted RUN. The panel does not own an execution timer.
Halt stops only this trainer's instruction execution and holds its outputs;
the normal circuit Pause control freezes the whole experiment. A host-supplied
external Board remains the owner of its time.

Structural Build edits rebuild the circuit Board and reset runtime state.
They preserve loaded program parameters. Saving a circuit stores the program
and wiring; it is not a resumable machine snapshot.

The default rate is 20 learner instructions per simulated second, with
`params.instructionHz` supporting 1–1000. That is a teaching rate, not a claim
about the original processor's instruction timing. All four outputs, four
inputs, `CLOCK`, `5v` and `gnd` are ordinary engine terminals. `CLOCK` is never
silently connected to an input.

## Sources and model boundary

The public manufacturer documentation provides behavior and layout facts:

- [Busch Microtronic download page](https://www.busch-modell.de/information/Microtronic-Computer.aspx).
- [Busch manual, part 1](https://www.busch-model.com/online/produktinfos/docs/anl2090-1.pdf),
  printed pp. 8–9 for the clock connection, pp. 72–73 for operation and
  pp. 74–76 for learner instructions and flags.
- [Original block diagram](https://github.com/lambdamikel/Busch-2090/blob/master/manuals/blockschaltbild.jpg)
  for the keyboard arrangement and system interfaces, and
  [original schematic](https://github.com/lambdamikel/Busch-2090/blob/master/manuals/microtronic.jpg).

`scripts/generate-microtronic-connector.mjs` authors the connector art and its
sidecar from one coordinate source. The picture is a functional abstraction,
not a trace or copy of a manual scan. The actual state display is an original
seven-segment SVG component in `MicrotronicPanel.jsx`.

The engine model explicitly simplifies the electrical output stages, clock
driver, input thresholds and timing. It does not model the raw supply rails,
transistor behavior, multiplex display bus, cassette interface, SRAM bus
mapping, native monitor self-tests or G/H experiment contacts. The authoritative
engine contract and its electrical assumptions are documented in
[bw-board's Microtronic guide](https://github.com/CrispStrobe/bw-board/blob/master/docs/MICROTRONIC.md).

## Verification

```sh
node --test test/microtronic-integration.test.js
npm run verify:microtronic:browser
```

The headless integration tests exercise real engine registration, terminal
and artwork agreement, rotation and fitting, program persistence and undo,
atomic invalid loads, switch/clock/LED wiring, and independent instances.
The browser gate runs the actual full CircuitDesigner, clicks its palette and
controls, imports a local learner program, checks the shared clock, tests live
editor rerenders and save/load, and compares every rendered contact to its
actual wire target at all quarter turns and mirrored orientations. It also
captures desktop and narrow-screen evidence. Set `BW_CHROMIUM_EXECUTABLE` to
use an explicitly installed Chromium binary.

These are Circuits checks. Full Brickwright package adoption and deployment
are separate consumer gates; a successful UI harness does not claim either.

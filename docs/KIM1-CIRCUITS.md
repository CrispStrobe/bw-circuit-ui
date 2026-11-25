# KIM-1 in Circuits

The KIM-1 is available in the computer palette. Placing it opens its front
panel in Instruments. An independently written NMOS 6502 machine in bw-board
owns memory, execution and user I/O; this UI sends commands to that same Board.
There is no second emulator or wall-clock loop in the panel.

## First experiment

Place **KIM-1**, then press **GO**. The supplied program increments port A.
Open **Open wired I/O example** for four switches on PB0–PB3 and four
resistor/LED outputs on PA0–PA3. Press GO and operate the switches. Their
voltages travel through the actual circuit nets.

The CPU is slowed for observation: the palette counter uses 100 Hz and the
wired example uses 1000 Hz. The physical KIM-1 used approximately 1 MHz.
Instruction cycle counts and the peripheral timer share the Board clock.

## Front panel

- **AD** selects address entry; four hexadecimal digits select memory.
- **DA** selects byte entry; two hexadecimal digits edit that address.
- **+** advances the address without changing address/data mode.
- **GO** executes from the selected address.
- **SST** makes GO execute one instruction.
- **ST** stops execution; **PC** selects the stopped program counter.
- **RS** resets the machine while retaining user RAM.

The left four display digits show an address; the right two show its byte.
Keyboard shortcuts apply only within the focused panel: hexadecimal keys enter
digits, Enter is +, Escape is ST, and Space is GO/ST. Native text fields and
buttons keep their ordinary keyboard behavior.

## Programs and persistence

The program editor accepts addressed hexadecimal bytes, for example:

```text
0200: A9 2A 8D 00 03 00
```

Every data line starts with a four-digit address and colon, followed by
two-digit bytes. Semicolon and hash comments are supported. Loading is atomic:
invalid input does not replace the accepted program. GO also applies a dirty
editor before running. Reset retains memory. Loading a new source image clears
the prior user image as an explicit replacement.

Accepted program bytes and keypad RAM edits persist with each part's parameters,
including circuit save/load, duplication and undo. Unloaded editor text remains
a local draft until Load or GO. Electrical Build edits recreate runtime state,
as they do for other Circuits devices.

## User I/O

PA0–PA7 and PB0–PB5/PB7 expose fifteen user GPIO lines. PB6 is reserved and is
not offered as a user terminal. The public port register addresses are:

| Address | Function |
|---|---|
| $1700 | Port A |
| $1701 | Port A direction; a set bit selects output |
| $1702 | Port B |
| $1703 | Port B direction; a set bit selects output |

AD/DA can also write these I/O registers directly while the computer is stopped.
I/O writes affect the live device and are not inserted into the saved RAM image.
The 5v and gnd terminals power external experiments. I/O uses the circuit's
digital voltage model; this is not a transistor model of the original board.

## Scope and provenance

The historical MOS ROM is not bundled. The front-panel learning monitor is an
independent implementation of documented behavior; archived software that calls
historical cassette or TTY ROM routines is outside this initial Circuits model.
Unsupported execution reports an error. Instruction execution and peripheral
time are modeled; cycle-by-cycle bus transactions are not claimed.

New KIM-specific UI, controls, programs, tests and connector artwork are original
MIT-licensed work. Existing repository files retain their own licensing; the
repository LICENSE is MPL-2.0. No incompatible external implementation, ROM,
disassembly, manual illustration, photograph or PCB artwork was included.
Research and implementation agents were separated; implementation received only
independently phrased hardware facts.

Fact references:

- [MOS KIM-1 manuals](https://bitsavers.trailing-edge.com/components/mosTechnology/kim-1/)
- [cc65 KIM-1 target documentation](https://cc65.github.io/doc/kim1.html)
- [KIM Uno operating guide](https://obsolescence.wixsite.com/obsolescence/kim-uno-how-to-use)

The two original example programs are authored from instruction-set and
register-address facts. They are not copies of archived KIM programs.

## Verification

`test/kim1-integration.test.js` checks real Board I/O, memory entry, program
persistence, independent instances and connector geometry.
`npm run verify:kim1:browser` drives the actual CircuitDesigner in Chromium,
including palette placement, visible keys, source loading, real wired switches
and LEDs, save/load, and a narrow viewport. Browser results describe that
upstream designer harness; they do not by themselves claim a full Brickwright
application build.

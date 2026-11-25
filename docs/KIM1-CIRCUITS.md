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

The program editor accepts addressed hex, Intel HEX, and MOS paper tape (.pap/.ptp). An addressed-hex example follows.

```text
0200: A9 2A 8D 00 03 00
```

Use **Open…** and **Load program** to import a file. The loader validates the
whole file before applying it. Paper-tape and Intel HEX imports can enable
expansion RAM, which stays enabled when the program is saved. GO applies a
dirty editor before running. In the learning monitor, loading replaces the
current image and selects its entry address. In hardware mode, select the
entry on the keypad after loading.

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

The learning monitor is selected by default. Under **Firmware and TTY**, mount
two 1 KiB files named for 6530-003 and 6530-002 or one 2 KiB file in that order.
The hardware monitor runs on the 1 MHz circuit clock and drives the keypad,
six display digits and TTY via the 6530 registers. The optional TTY terminal
runs at 300 baud. ST and SST use the original monitor’s NMI path, which requires
the program’s `$17FA–17FB` soft vector to be set. The ROM files stay in the
active session. The circuit saves the program image and its RAM configuration.

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

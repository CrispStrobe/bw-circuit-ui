# Spec-update: the foreign-deck oracle, and where its adapters live

This records the boundary that kept the SPICE importer honest while ~60,000
foreign decks were run through it, and the two rules that were each learned by
breaking them. Nothing here proposes new work; it exists because the next person
to point the importer at a corpus will otherwise re-derive it the expensive way.

## The rule: `importSpice` is handed bytes the caller chose

`importSpice(text, { libraries })` takes libraries as SPICE **text**, never a
path. A parser that can reach the filesystem resolves differently on two
machines, and its results stop being reproducible from its input — which is the
one property a comparison against another simulator needs most.

So every corpus adapter lives in the **caller's** half, under `scripts/`:

| adapter | what it is | why it cannot be in the importer |
|---|---|---|
| `ltspice-library-resolver.mjs` | name → library text, from `LTSPICE_LIB_DIR` | reads files; the tree is vendor-licensed and must not be vendored |
| `cot-netlist.mjs` | pulls a deck out of a chain-of-thought document | the corpus's `output` field is prose *about* a netlist, not a netlist |
| `spice-oracle.mjs` | runs ngspice, compares, refuses by name | ngspice is GPL: a development and CI oracle only, never linked, never shipped |

Each of those was a measured win, not a tidiness exercise:

* The library resolver's **comment rule** must be the importer's own rule (`;`
  anywhere, `$` at token start). Getting it wrong is silent: a trailing pin-name
  comment `;pnba Run)GND)SW)Vin)FB)Mode` was read as the subcircuit's NAME, and
  the resolver then reported a library as missing a definition no deck had asked
  for — 9,167 occurrences of one phantom name at the top of a census.
* `cot-netlist.mjs` took ADI2005 v5 from **0 to 10,366 of 12,520**. The corpus
  scored 0.0 % not because anything was wrong with the engine but because its
  `output` field is a reasoning document with a netlist inside it. A corpus-wide
  zero deserves the same suspicion as a corpus-wide pass.
* `readLibraryFile` decodes UTF-8 **strictly** and falls back to CP1252 only
  when that throws. 3,010 of the 4,908 `.sub`/`.lib` files in the LTspice 24.x
  tree are not valid UTF-8, and 2,957 of those contain 0xB5 — the micro sign, as
  in `I2 3 N002 55µ`. `Buffer.toString('utf8')` substitutes rather than throws,
  so the value arrived as `55<FFFD>` and was reported as a semantic loss. A
  refusal that names a value it could not read, when the value is sitting in the
  file in a different encoding, is a wrong answer wearing a refusal's clothes.

## What the oracle refuses, and why refusing is the product

`judgeForeignDeck` compares only where both engines answer, and each refusal is
**named** so a corpus census can count causes rather than failures:

* `unmapped N` — our importer produced no device for N elements.
* `loss: …` — a value or directive was dropped, by name.
* `unrepresented` / `exportApproximated` — we solved something the deck does not
  describe (an op-amp's `iLimit`, say), so the numbers are not comparable.
* `oracle-clamped-is` — ngspice silently clamps diode `IS` at 1e-28, so any deck
  below that is comparing two different devices. Ours is the faithful one.
* `oracle-non-convergence` / singular matrix — ngspice itself cannot solve it.
  On ADI v3 that is **1,722 decks**, mostly common-emitter amps whose output
  hangs on a coupling capacitor and floats at `.op`.

**The denominator is the thing to get right.** "Agreement" must be measured over
decks where BOTH engines produced numbers. Subtracting only ngspice's refusals
put every unmapped deck in the denominator and reported Si7li's raw 53k corpus
at `0.00 %`, when the truth was that **nothing reached the comparison at all**.
Two different statements, and only one of them is about the engine.

## Faithful export shapes, where a kind has no SPICE primitive

The exporter's job is a deck that describes the device the engine solves. Three
cases needed a specific form, each chosen against a measurement:

* **tip120** → `RB<ref>` + a voltage-controlled switch `S<ref>` with
  `.model SW_<ref> SW(VT=<vbe> RON=<rceSat> ROFF=1e12)`. The numbers come from
  the part's params or `classDefaults('tip120')`, never from literals here.
* **opamp** → a `B` source, `V = min(max(gain*V(inp,inn), railLow), railHigh)`.
  Not `E … TABLE`: ngspice **rounds a table's corners**, which put
  `pc40-opamp-threshold` 125 mV out. `min(max(...))` clamps sharply.
* **an authored value the card contradicts** → a per-part `.model Q_<refdes>`,
  for `Bf` and for `Vaf`. A parameter the engine reads and the deck omits means
  the comparison is between two different transistors; that defect cost 59 mV on
  `44-darlington-motor` before a test held it.

Two ideal voltage sources across one node pair is a singular matrix, so a
capacitor's held-voltage source is dropped and **named** (`exportRedundant`) when
its pair is already fixed by a rail.

## Licence boundary, not negotiable

ngspice is GPL and is a development/CI oracle only: never bundled, never
shipped, never linked. The LTspice library is Analog Devices' own — it may be
*run* as an oracle input via `LTSPICE_LIB_DIR`, and no byte of it may enter this
tree, its tests, its goldens, or a CI artefact. Every fixture in the suites
below is authored:

    test/ltspice-library-resolver.test.js
    test/spice-micro-sign-scale-factor.test.js
    test/cot-netlist.test.js
    test/oracle-clamped-is.test.js

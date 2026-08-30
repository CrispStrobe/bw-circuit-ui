# bw-circuit-ui — roadmap (scoped 2026-08-23)

Actionable items from the 2026-08-23 format-surface and instrument audit. Each item
names files, scope, and acceptance. House rules apply: every electrical value comes
from bw-board; no fabricated numbers; importers never silently drop or silently
approximate; **no competitor names in committed content** — file formats are named
only where the user must recognise their own file (nominative use), closed tools are
never named, and the line-oriented applet format is referred to by its extension
(`.circuitjs.txt`) only.

Engine-side prerequisites live in `../bw-board/ROADMAP.md` (items E*); they are
referenced where a UI item depends on one.

---

## X0 — Fix the exporters we ship (days; do these first)

**Status 2026-08-30 — X0.1, X0.2, X0.3, X0.5, X0.6, X0.7 LANDED.** Every claim
below was re-measured against the code as it stood at `77ab613` before anything
was touched; the measurements are in the commit messages and in the header of
each gate. **X0.4 landed 2026-08-30** (`e4046d0`), so X0 is complete.

| item | verdict | landed | gate |
|---|---|---|---|
| X0.1 SPICE decks unsimulatable | confirmed, fixed | `ee0d108` | `scripts/spice-oracle.mjs` (CI job `spice-oracle`, ngspice 42) + `test/spice-deck.test.js` |
| X0.2 mega/milli suffix | confirmed, fixed | `ee0d108` | `test/spice-deck.test.js` (incl. a corpus sweep property) |
| X0.3 dead exporters | confirmed — and **seven**, not three | `1397493` | `test/export-reachability.test.js` |
| X0.4 schematic as a document | landed | `e4046d0` | `test/schematic-document.test.js` + gate scenario `schematic-svg-save` |
| X0.5 dead import-menu entry | confirmed, fixed | `1397493` | `test/import-reachability.test.js` |
| X0.6 silent part substitutions | confirmed, fixed | `1397493` | `test/import-reachability.test.js` |
| X0.7 console-only instructions | confirmed, and worse than scoped | `1397493` | `test/transfer-report.test.js` |
| X1.1 SPICE netlist importer | landed (X0 was clean) | see below | `test/spice-import.test.js`, `test/spice-corpus.test.js`, the oracle's foreign phase |

Numbers worth keeping:

- The VCC/GND rename in `netlist.js` tested `net.id` for the substrings
  `vcc`/`gnd`. Real engine ids are `net-lgc-2`, `n-bb1-row-12`, `net-7` and can
  contain neither, so it fired on **zero** circuits. Nets are named by rail
  **part membership** now.
- `formatSi` writes 1 MOhm as `1M`; SPICE reads a bare `M` as milli.
  **19 values** in the shipped corpus (5124 electrical values scanned across
  `gallery/`, `test/fixtures/` and `../sb3-creator/examples/`) sat at or above
  1e6 and exported 10^9x too small — all 1 MOhm resistors, in five distinct
  examples (`arduino-06-knock` across 14 device variants, `pc50-two-stage-rc`,
  `pc51-series-capacitors`, `pc66-555-langzeit`).
- Dead writers found by walking `src/` for call sites: `toKicadSch`,
  `exportWokwi`, `exportSvgAsPng`, `toEagleSch`, `exportGerbers`,
  `exportKicadPcb`, `exportEasyEdaPcb` — **seven of eleven**. Two whole
  components, `ExportNetlistMenu.jsx` and `ImportCircuitMenu.jsx`, were
  imported and never rendered; both are deleted.
- The oracle's own blind spot, found by mutation: ngspice aliases a node named
  `gnd` to node 0 as a courtesy, so **removing the ground->0 mapping still
  passed every numeric comparison**. That is now a structural assertion about
  the deck rather than a question about what one simulator tolerates.

### X0.1 SPICE decks are structurally unsimulatable — `src/model/exporters/spice.js`, `src/model/netlist.js`

**LANDED `ee0d108`.** All five scope points done. The deck maps ground to node
`0` (falling back to the first vsource's negative net, the rule the engine
itself falls back to), synthesizes `V…_SUPPLY <rail> 0 DC <circuit.vcc>` per
rail, emits `.op` plus a `.tran` template sized from the lowest declared source
frequency (10 ms otherwise), names rails by rail-part membership, and splits the
potentiometer into the two resistors the engine stamps. Each junction gets its
own `.model` derived from that part's Vf with bw-board's Shockley calibration,
so the deck carries the same device equations the engine solves.
`scripts/spice-oracle.mjs` runs six decks through ngspice and compares node by
node: **6/6, largest disagreement 0.057 %** on a two-junction string. The
PWL-vs-Shockley gap the deck cannot express is printed every run rather than
hidden in a tolerance: 2.970 mA vs 3.120 mA on the canonical bench, 4.804 %.
`extractNetlist` strips `vcc`/`gnd` parts (`POWER_RAILS`, netlist.js:22,100), so the
deck has **no node 0, no ground, no source, and no analysis directive** — it loads
and cannot run. Scope:
- Map the ground net to node `0` (all gnd-bearing nets, after the same merge the
  engine performs).
- Synthesize `VDD <vccnet> 0 DC <circuit.vcc>` for each distinct rail.
- Emit a default `.op` plus a commented `.tran` template sized from the circuit
  (10 periods of the lowest source frequency, else 10 ms).
- Fix net naming: the VCC/GND rename tests strings that engine net ids
  (`net-N`/`n-<strip>`) can never match — rename by *rail part membership*, not id
  substring.
- Potentiometer: export as two resistors about the wiper (a/wiper, wiper/b), not one
  2-node R with the full value.
Acceptance: the exported deck for the canonical 5 V / 1 kΩ / LED bench runs in the
CI oracle simulator and its `.op` LED current matches `branchCurrent` within model
tolerance; a deck with no rail parts still exports with a warning naming what is
missing.

### X0.2 Mega/milli suffix bug — `src/model/si.js`, netlist value path

**LANDED `ee0d108`.** `formatSpiceValue` lives beside `formatSi`; display
formatting still says `M` for mega and only the deck path uses the new one.
`netlist.js` carries `valueNumber` so a serializer never re-parses a
human-formatted string. Corpus impact measured, not assumed: 19 of 5124.
`formatSi` emits `M` for 1e6; SPICE reads `M` as milli — a silent 10⁹× error on any
part ≥ 1 MΩ/1 MH. Emit `MEG` in the SPICE value path (display formatting elsewhere
keeps `M`). Acceptance: 1 MΩ exports as `1MEG`; 1 mΩ as `1m`; round-trip through the
oracle simulator's parser confirms magnitudes.

### X0.3 Wire up the three dead exporters

**LANDED `1397493` — there were seven, not three.** Fixed at the layer that
makes it un-reopenable rather than by adding menu entries:
`src/model/exporters/registry.js` is the one list, menus render from it
(`BoardCanvas` for circuit writers, `BoardPanel` for the three board writers,
which had no save affordance at all), and it is exported from the package
barrel so a host cannot hand-maintain a second list either.
`test/export-reachability.test.js` enumerates the writer modules from the
FILESYSTEM, so a new file cannot slip past a hand-written list.
`exportWokwi` no longer invents type names: unmapped kinds are skipped and
named, a kind whose only spelling is approximate exports and says so, and
wires onto skipped parts are dropped rather than left dangling.
`toKicadSch` (`model/exporters/kicad-sch.js` — the only writer producing an openable
schematic, with lib_symbols, per-rail power symbols, deterministic UUIDs),
`exportWokwi` (`importers/wokwi.js:208`), and `exportSvgAsPng`
(`model/export-png.js`) have **zero call sites**. Scope: add all three to
`ExportNetlistMenu.jsx` and the `BoardCanvas.jsx` FileMenu; export them from the
package barrel (`index.js`); `exportWokwi` must stop inventing type names for
unmapped kinds — unmapped kinds go to a `skipped[]` list surfaced in the UI, matching
the import-side refusal policy. Acceptance: each menu entry downloads a file; the
schematic export re-imports through our own importer with an identical net partition
(the existing partition-oracle pattern); a golden-file test per exporter.

### X0.4 Schematic as a document — **LANDED `e4046d0`**

Both saves are in the panel and both are registry entries, so the file menu offers
them and the reachability gate covers them. What they save is NOT the panel's own
element: that one carries a camera, so serializing it would hand the user whatever
happened to be in the viewport. Both go through `renderSchematicSvg` at the
projection's own bounds, and `test/schematic-document.test.js` asserts that every
symbol is drawn at the projection's own coordinates — the document path cannot
become a drifting second renderer.

The standalone claim is asserted on the BYTES, not trusted: the namespace is there,
nothing references a stylesheet, a class, a font, an image or a script, every `<text>`
names its own fill/font-family/font-size, only generic font families appear, the
symbol count equals the projection's and every label is in the file.

Both faults named in the original scope were real. The style inlining the comment
promised never happened — the loop only cleared `pointerEvents` — and it matters
because a rasterised SVG is loaded through `new Image()` from a blob URL, which sees
none of the page's stylesheets; the presentation properties are now copied from
`getComputedStyle` of the live element. The hardcoded `#16213e` background put a dark
slab under every light-theme export; it comes from the element's own computed
background now, and the schematic document paints its own and asks for none.

Also landed beyond the scope: the report names what the drawing could NOT do —
parts it could only box, and any geometric invariant it had to break. A picture that
quietly omits its compromises is the multimeter that lies in another medium.

Browser gate scenario `schematic-svg-save` clicks Save SVG, takes the download,
parses it with the browser's own SVG parser and requires the symbol count in the FILE
to equal the count on SCREEN — the check a well-formed but empty SVG, or an SVG of the
camera's view, would fail. Measured in CI at `e4046d0`: 5268 bytes, 7 symbols against
7 on screen, 21 labels, zero CSS-dependent nodes. NOT done: the PDF print stylesheet,
and the 246-example batch smoke test (the geometry corpus already sweeps the
projection those drawings come from).

Original scope, for the record:

### X0.4 Schematic as a document — `components/SchematicPanel.jsx`, `model/schematic-svg.js`
`renderSchematicSvg()` already produces a complete schematic SVG headlessly; the
panel offers no save. Scope: **Save SVG** (serialize, download) and **Save PNG**
(via the fixed `exportSvgAsPng`; replace the hardcoded dark background with the
current theme background and actually inline the computed styles its comment
promises). PDF: a print stylesheet on the schematic view is sufficient for v1 — no
new dependency. Acceptance: saved SVG opens standalone with all symbols/labels
intact (no CSS-dependent invisibility); PNG matches at 2× scale; both work for the
246-example corpus via a batch smoke test.

### X0.5 Import-menu dead entry — `components/BoardCanvas.jsx:2748`

**LANDED `1397493`.** The submenu renders from `IMPORT_FORMATS` in
`importers/index.js`, whose ids are checked against `IMPORTERS` by
`test/import-reachability.test.js`; every registered importer is either offered
or listed in `NOT_OFFERED` with a reason. An unrecognised file, a library
picked without its schematic, and an import that mapped nothing are all named
refusals in the report now. The KiCad 4/5 `.sch` + `-cache.lib` pairing, which
only ever existed in the never-rendered `ImportCircuitMenu`, works from the
real menu.
The "Diagram (.json)" entry forces `pendingFormat='json'`, which is not a key in
`IMPORTERS` — the click silently does nothing. Fix: route the entry through
`detectFormat` (it resolves the placement-preserving diagram JSON vs the vendor JSON
correctly), and surface "unrecognised file" as a visible message, never a silent
no-op. Acceptance: importing a diagram JSON via the explicit menu entry works; a
garbage `.json` shows the message.

### X0.6 Silent part substitutions in the diagram-JSON importer — `importers/wokwi.js:24-63`

**LANDED `1397493`.** All four approximations carry a `_note` naming both
sides plus `_substituted` (the original type), and each raises a warning the
report shows. A faithful mapping carries no note, so the notice means
something. The gate reads the `APPROXIMATIONS` table out of the source and
requires every entry in it to produce a note — a new one cannot be added
silently.
Deliberate approximations (RTC chip, humidity sensor, slide pot, stepper variant)
carry no `_note`/warning, violating the policy every other importer follows. Add
`_note` params and warnings for every approximating map entry. Acceptance: importing
a file containing each substituted type yields a visible warning naming both sides.

### X0.7 Instructions that never reach the user — `model/exporters/easyeda.js`, `ExportNetlistMenu.jsx:86`

**LANDED `1397493`.** Worse than scoped: besides the EasyEDA instructions,
SPICE's skipped-part list, EAGLE's warnings and the native-EasyEDA omissions
all went to the console, and `BoardCanvas`'s own handler did not even
destructure `instructions`. `components/TransferReport.jsx` draws all of it
over the canvas — deliberately outside the `⋯` popover, which unmounts the
menu the moment an action runs. `test/transfer-report.test.js` forbids
`console.log`/`console.warn` anywhere under `src/importers/` or
`src/model/exporters/`, which is the grep-able acceptance the item asked for.
The via-netlist export's import instructions go to `console.log`. Show them in the
UI (post-export dialog or expandable note). Acceptance: instructions render; no
console-only user guidance remains in the export paths (grep-able).

---

## X1 — New interchange formats (ranked by feasibility × audience fit)

Clean-room rule for every importer/exporter below: implement from official format
documentation and from inspecting files we generate ourselves; **never read GPL
implementations** of these formats. New format knowledge sources get a row in
`THIRD-PARTY.md` in the same commit.

### X1.1 SPICE netlist importer — new `importers/spice.js`

**LANDED.** `src/importers/spice.js`, registered as the `spice` format and
detected in `detect.js` (last among the content rules — a deck has no magic
first line, since line one is free text by definition).

Scope delivered: title line, `+` continuations, `*`/`$`/`;` comments;
R C L V I D Q M mapped, E and G mapped as `vcvs`/`vccs`; `.model` cards mapped
onto part params with a diode's Vf RECOVERED at the rated 20 mA (the exact
inverse of the exporter's calibration, which is what makes the round trip
close); `.subckt`/`.ends` flattened one level with dotted refdes and per-instance
internal nets; node `0`/`gnd`/`GND` to a single `gnd` part; analyses recognised
and reported, never executed; star wiring, no placement.

**Two re-measurements changed the plan.** The ROADMAP said E/F/G/H import as
`unmapped[]` until bw-board E3.5 lands. Measured at bw-board `6571648`: E3.5a
(vcvs/vccs) IS landed, so E and G map for real; E3.5b (cccs/ccvs) is deferred by
ruling, so F and H are refused by name and cite the deferral. And the SPICE
MOSFET has four terminals to the engine's three, so `M` maps with its bulk node
dropped and named.

Acceptance, all three parts:
- Round trip: `test/spice-import.test.js` compares NET PARTITIONS over four
  circuits. It is netlist -> deck -> netlist, not circuit -> deck -> circuit,
  because `extractNetlist` deliberately reassigns refdes (LED1 becomes D1).
- Corpus: the ngspice package installs **410** published decks; they are read in
  place and never committed (`test/spice-corpus.test.js`). Zero silent drops is
  asserted as an ACCOUNTING — every card becomes a part, a named refusal, an
  ignored card or a reported analysis. That gate found a real bug on its first
  run: subcircuit bodies and `.control` script lines were being dropped
  unrecorded, in **86 of 410** decks. Fixed; 408/410 balance and the last two
  were a duplicate `.model` redeclaration, also fixed. 180/410 map with zero
  refusals.
- The duplicate-suffix trap has its own test, with ngspice's semantics measured
  rather than assumed: `1M` = 1e-3, `1MEG` = 1e6, `1MIL` = 2.54e-5, `1F` = 1e-15.

**The oracle grew a third phase, because the second one had a blind spot.**
Round-tripping our exporter through our importer cannot see a SYMMETRIC error:
reintroducing X0.2's mega/milli bug on the READ side left all six self
round-trips green, since our exporter never writes a bare `M` for mega and so
never asks the question. `test/fixtures/spice/*.cir` are hand-written in
spellings our exporter does not emit; each is simulated as authored, read by our
importer, written back out, and simulated again. That phase fails 2/4 under the
same mutation. 16 decks now run in the oracle: 6 exports, 6 self round-trips,
4 foreign.
The universal bridge: the closed schematic tools all export SPICE netlists even
though their native formats are closed or undocumented — one importer covers them
all without naming any of them. Scope (v1): title line, continuation `+` lines,
comments; elements R C L V I D Q M and E/F/G/H (engine support: bw-board E3.5;
until it lands, E/F/G/H parts import as `unmapped[]` with a note); `.model` cards
mapped onto part params (Vf/Is/n from D models, beta from Q); `.subckt`/`.ends`
flattened one level with dotted refdes; node `0`/`GND` → a `gnd` part;
`.tran`/`.ac`/`.op`/`.end` recognised and reported (analyses noted, not executed);
value suffixes incl. `MEG` vs `M`-as-milli (the inverse of X0.2). No placement —
star wiring like the other netlist-shaped importers, `x:0,y:0`. Detection: add to
`importers/detect.js` (title-line + element-letter heuristic, after all structured
formats). Acceptance: our own X0.1 exporter's output re-imports with an identical
net partition (round-trip property test, the precedent set by the XML-schematic
importer's symmetry test); a corpus of ≥ 20
published decks imports with zero silent drops (`unmapped[]`/`ignored[]` accounting
asserted); the duplicate-suffix trap (1M vs 1MEG) has an explicit test.

### X1.2 Breadboard-format import/export (`.fzz`/`.fz`) — new `importers/fritzing.js`, `model/exporters/fritzing.js`
The single most conspicuous absence: it is the breadboard-first interchange format,
and our model (hole seating via `seat.leadMap`, `holeWires` jumpers,
`BreadboardModel`) maps to it nearly one-to-one. The desktop app is GPL — **format
docs only, no code reading**; its stock part graphics are CC-BY-SA — **never ship
them**, map onto our own parts-data. Scope: `.fzz` = ZIP of XML (use the zip code
path already available in the host bundle, or a tiny permissive inflate; no new
heavy dependency); import reads instances + breadboard view geometry → parts with
seats, buses → `holeWires`; parts we don't know → `unmapped[]` with their label;
export writes our breadboard view (schematic/PCB views omitted — stated in the
file, the honesty-label precedent from the netlist-only exporter). Acceptance:
round-trip property test (export→import preserves parts, seats, net partition);
import of ≥ 10 published starter-kit files lands every seated part on the right
strip (assert via net partition against the file's own netlist section).

### X1.3 Applet text format import/export (`.circuitjs.txt`) — new `importers/circuitjstxt.js`
The classroom lingua franca for analog toys; line-oriented (`$` header line, one
element per line: type code, coords, flags, params). The reference implementation is
GPL — **clean-room from the format's shape and community format notes; do not read
the source**. Scope (v1): R, C, L, wire, ground, voltage/current source (dc + sine),
diode, LED, BJT, MOSFET, switch, pot, op-amp → our kinds; coords → placement
(this format carries geometry — keep it, like the diagram-JSON importer does);
everything else → `unmapped[]` with the type code. Export the same subset; parts
outside it are listed as skipped in the UI. Acceptance: round-trip property test on
the supported subset; 10 hand-authored fixture files covering every mapped type
code; net partition asserted against hand-derived nets.

### X1.4 LaTeX schematic export (circuitikz) — new `model/exporters/circuitikz.js`
Pure text generation — bundles nothing regardless of any package's licence. The
publishable-document story for teachers. Scope: emit a `\begin{circuitikz}` picture
from `model/schematic-projection.js` geometry (positions exist; the projection
already routes 2,126 nets in the corpus): bipoles (R, C, L, diode/LED, sources,
switch) on `to[...]` paths, multi-pin parts as labelled `node`s with stub pins,
net labels where the schematic shows them. v1 targets *readable*, not *beautiful* —
state it in the file header. Acceptance: output compiles under `latexmk` with the
package installed (CI-side check, tectonic or a docker latex — dev-side only, not
bundled); golden files for 5 representative examples; every part kind either
renders or is listed in the emitted comment header as unsupported (no silent drops).

### X1.5 OLE-compound schematic read (`.SchDoc`) — later, behind demand
A professional on-ramp. An MIT-licensed browser parser (incl. a minimal OLE/CFB
reader) exists and may be adapted with attribution; the ASCII variant is easier and
should come first. Read-only; write is unmapped territory and out of scope. Do not
start before X1.1–X1.3 have shipped. Acceptance when built: nets-only import with
the standard `unmapped[]`/`ignored[]` accounting and a partition self-audit warning.

### X1.6 Native-format hygiene — `model/circuit.js`, `importers/detect.js`
- Add `"format": "bw-circuit", "version": 1` to `toJSON`; `fromJSON` accepts
  versionless legacy (the existing shape-sniffing funnel becomes the v0 reader).
- Register the native format in `detectFormat` (top-level `parts` array +
  no `editorVersion`) so the generic import path recognises our own files — the
  guard the current comment defers to lives in an unvendored CLI.
- Unify the two disjoint KiCad symbol vocabularies: `importers/kicad-netlist.js`'s
  private `KICAD_KIND_MAP` merges into `importers/kicad-common.js`'s rule table
  (one format, one table); fix the `74ls273` pinMap duplicate keys
  (`'12'`/`'13'` restated — a 20-pin part crammed onto a 16-pin map) while there.
Acceptance: old saves load (fixture per legacy dialect); new saves carry the
version; netlist importer behaviour unchanged on its fixture corpus after the merge
(partition equality before/after).

---

## X2 — Instruments and post-processing

### X2.1 True AC sweep UI — **LANDED `a05967e`+`a3b5f81` (the path), `1b1bf5d` (what it says)**

`runBode` reaches `BoardImpl.runAc` on an offline board, and the correlation path
stays. What the second half of this item turned out to be is not "add a toggle" but
three things the toggle by itself made worse, because the analytical path became the
DEFAULT while nothing in the panel said so.

**It is not a speed setting.** The control was one checkbox reading "measure like a
scope would (slower)": it named one side, left the default unlabelled, and described
the difference as speed. They are two different measurements — one linearises the
circuit around its DC operating point and solves the complex network per frequency,
the other drives a real sine into the real nonlinear circuit and correlates the
response. A learner told only "slower" picks the fast one and never finds out that
the two disagree exactly where the interesting circuits live. Both are named for what
they are now, both carry a sentence saying it, and the status line names which one
produced the numbers.

**fab-cond's region honesty reaches the screen.** bw-board reports `outOfLinear` per
point (`spec-updates/ac-operating-region.md`); the panel had one aggregate banner of
region codes. Every ROW carries its own verdict as a sentence now — "not in its linear
region at this point: U1 (output sitting at the positive rail) — the small-signal
number here is not the stage's gain" — the row is coloured, the point is ringed on the
curve, and the curve BREAKS there rather than being drawn through a number nothing
measured. Which surfaced a defect: a railed output's transfer is exactly zero, so its
dB is −Infinity, and that was setting the plot's lower bound — every plotted y NaN and
an axis label reading "-Infinity dB". Such a point no longer sets the scale.

**Progress and Stop were theatre.** `createSweepRun` computed the whole analytical
sweep in one synchronous `runAc` and then handed out rows that already existed: the
freeze X2.6 removed, moved one function inwards. It is one frequency per engine call
now, and `runBode` takes the same route, so the synchronous and the chunked answers
are equal by construction rather than by assertion. The engine's batched call is
faster (it reuses one factorization across a sweep, `ac.js`) and is NOT bit-identical
to asking point by point — two of nine points differ by one ulp on an RC bench — so
the product has ONE route and the residual is measured and bounded in the test rather
than assumed small.

Acceptance, hand-computed (`test/sweep-small-signal.test.js`):

| bench | oracle | measured |
|---|---|---|
| RC 10 kΩ/100 nF at 1/(2πRC) = 159.15494309189535 Hz | −3.0102999566398125 dB = 20 log₁₀(1/√2), −45.000° | within 4.3e-8 dB — the solver's 1e-12 gmin against this node's 1e-4 S, a 1e-8 relative perturbation |
| the decade above it | 10 log₁₀(10001/101) = 19.95722 dB — NOT the slogan's 20 | within 1e-6 dB |
| op-amp open loop, 1 µV bias | 20 log₁₀(1e6) = 120.000 dB, no flag at all | within 1e-6 dB |
| the same op-amp, 1 V bias | railed high; transfer exactly zero; flagged by name | −∞ dB, `U1:high` |

Browser gate scenarios `sweep-ac-method` and `sweep-ac-region`, on a railed op-amp
bench injected through the harness's real `circuitData` door. NOT measured: the
"50-net board in < 200 ms" budget — point-at-a-time re-solves the operating point per
point and trades exactly that number for a Stop button that works, so the old figure
would be measuring a path the product no longer takes.

Original scope, for the record:

### X2.1 True AC sweep UI — `components/SweepPanel.jsx`, `model/sweep-runner.js`
When bw-board E2.1 lands, `runBode` switches to the engine's `runAc` (offline board,
same pattern as today). The time-domain correlation path stays available behind a
"measure like a scope would" toggle — it is now the *demonstration* that the two
agree, which is itself a lesson. Acceptance: RC corner reads −3 dB/−45° at the
analytic frequency; sweep of a 50-net board completes < 200 ms end-to-end.

### X2.2 FFT / THD / trace export — **SHIPPED 2026-08-29** (`model/fft.js`, `ScopePanel`)
This item's first line was wrong, and finding out was the work. It said "pure
post-processing over the existing scope ring buffers"; the existing ring buffers are
a (min, max) ENVELOPE, whose two numbers are two different instants reported as one,
so a transform over them describes a waveform that never existed — and it would look
plausible. So the engine grew a second capture mode (`addScopeChannel({capture:
'sample'})`, bw-board `9441e4f` + `825b019`) whose sample instants are SOLVE POINTS,
and the spectrum view is a second tap rather than a redrawing of the first.
`seriesFromScopeData` refuses an envelope buffer BY NAME.

Two things also differ from the acceptance below, both because it was written before
anyone measured:

- **"> 40 dB to the next bin" is a rectangular-window, bin-aligned claim.** A Hann
  mainlobe is four bins wide by construction, so the bin next to the peak is
  supposed to be about −6 dB. The measurable form of the same requirement is the
  distance to everything OUTSIDE the mainlobe, and that is what the test asserts.
- **Amplitudes come from the lobe's ENERGY, not its tallest bin.** A tone off bin
  centre loses up to 1.42 dB to scalloping: reading the peak bin gave a square wave's
  harmonics as 0.322/0.180/0.127 against the series' 0.333/0.200/0.143 and THD as
  40.46 % against 42.88 %. The energy in the lobe is invariant to sub-bin offset and
  reproduces all of them to four decimals.

The spectrum tap carries its own capture rate, labelled by the bandwidth it buys,
because a sample-series channel puts a solve point on every sample instant: 10 kHz
costs nothing (100 µs is the floor the integrator already used), 100 kHz makes the
whole simulation ~5× slower — measured in a real browser, the page stopped answering
clicks for 30 s. The default is 10 kHz.

Original scope, for the record:

### X2.2 FFT / THD / trace export — new `model/fft.js`, `components/ScopePanel.jsx`
Pure post-processing over the existing scope ring buffers (the curriculum already
promises FFT lessons). Scope: radix-2 real FFT (own implementation, ~100 lines —
no dependency), Hann window, magnitude display with the existing scope styling;
THD readout from the fundamental bin; **Save CSV** of the visible trace window
(t, min, max per bucket — the decimation envelope is exported honestly, stated in
the header row). NaN gaps excluded from the FFT window with a visible "trace
incomplete" refusal — never transformed silently (the multimeter-that-lies rule).
Acceptance: FFT of the engine's own 1 kHz sine source peaks in the right bin with
> 40 dB to the next bin; square wave shows odd harmonics at 1/n; CSV re-plots to
the same envelope.

### X2.3 Tolerance / Monte-Carlo runner — new `model/montecarlo-runner.js`, panel
Teaches "real resistors are ±5 %" — absent from every browser education tool.
Scope: per-part `tolerance` param editable in the inspector (engine passthrough,
bw-board E2.3); runner builds N offline boards (sweep-runner pattern) with values
perturbed uniformly within tolerance, runs the chosen measurement (node voltage /
branch current / DC sweep), renders the envelope (min/median/max) in the sweep
panel's plot style. **Runs in a Web Worker** (bw-board E1.5 is the prerequisite);
N default 100, cancellable, progress shown. Acceptance: a divider with two ±5 %
resistors shows the hand-computed worst-case bounds (±~4.9 % of nominal at the
extremes); UI stays responsive during a 1000-run sweep (no main-thread solve).

### X2.4 Parameter stepping — `components/SweepPanel.jsx`
Family-of-curves: step one part parameter (resistance, source amplitude, beta)
across K values, overlay the K sweep traces with a legend. Offline-board pattern;
worker-hosted with X2.3's harness. Acceptance: LED I-V family across 3 series
resistors matches 3 individual sweeps.

### X2.5 Logic-analyzer panel — after bw-board E4.2
Digital channels (transition-list capture) rendered as timing lanes under the
scope; shares timebase and cursors with `model/scope-tools.js`. Blocked on the
engine's scheduled-events work; do not fake it with sampled analog channels.

### X2.6 Sweeps off the main thread — **SHIPPED 2026-08-29** (`model/sweep-protocol.js`, `model/sweep-session.js`, `SweepPanel`)
The sweep ran synchronously inside a `setTimeout(…, 20)` whose only job was to let
the button repaint BEFORE the freeze. Both acceptance criteria hold: the rows are
`assert.equal`-identical to the synchronous path (not close — `runDcSweep` and
`runAcSweep` are loops over points against one board with monotonic time, so one
point per call in the same order is the same sequence of operations), and the canvas
drags while a sweep runs.

**It could not be a worker alone, and the reason is structural.** The engine reaches
this library through `setEngine` as LIVE JS OBJECTS, and a class is not
structured-cloneable — only the host knows where its engine module is, so only the
host can build the worker. So: `sweep-protocol.js` sends a NETLIST across the
boundary and exports `sweepWorkerHandler` for the worker side;
`setEngine({createSweepWorker})` is the optional hook; `dev/sweep-worker.js` is
the reference implementation and the dev harness wires it. Without the hook the same
points run chunked on the main thread, one per macrotask — worse (one slow POINT
still blocks) but real, and the panel's status line says WHICH path produced the
numbers rather than leaving it a guess.

While wiring it: the dev harness never injected `runDcSweep`/`runAcSweep`/`logSpace`
at all, so `SweepPanel` refused every run there and no browser scenario could reach
it. Fixed in `main.jsx` — an export nobody calls is a bug, and so is a panel nobody
can reach.

Still open, and NOT this item: the D9 engine half — a Bode point costs 10/f seconds
of simulated time (6 settle + 4 measure cycles). Moving the cost off the main thread
is not removing it; `runAcSweep`'s semantics are bw-board's to change.

Original scope, for the record:

### X2.6 Sweeps off the main thread — `components/SweepPanel.jsx:113-127`
Today's sweep runs synchronously inside a `setTimeout(…, 20)` so the button can
repaint. Fold into the X2.3 worker harness (one worker protocol for sweep / AC /
Monte Carlo / stepping). Acceptance: a deliberately heavy sweep leaves the canvas
interactive; results identical to the synchronous path on fixtures.

---

## Sequencing

1. **X0 (all)** — shipped wrong answers and dead features; days of work.
2. **X1.6** native-format hygiene (small, de-risks everything else), then **X1.1
   SPICE import** (pairs with the X0.1 exporter fix; round-trip property test),
   then **X1.2** breadboard format, **X1.3** applet text, **X1.4** LaTeX.
3. **X2.2 FFT/CSV** (no engine dependency) any time; **X2.6/X2.3/X2.4** once
   bw-board E1.5 confirms worker-safety; **X2.1** when E2.1 lands; **X2.5** last.
   X0.4, X2.2, X2.6 and X2.1 have all landed; X2.3/X2.4/X2.5 remain.

Cross-repo: engine items in `../bw-board/ROADMAP.md`; brickwright-lite re-vendors
via `sync:circuitui` after each landing and carries the attribution/disclaimer
items listed in its own ROADMAP §3.5.

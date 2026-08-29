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

### X0.1 SPICE decks are structurally unsimulatable — `src/model/exporters/spice.js`, `src/model/netlist.js`
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
`formatSi` emits `M` for 1e6; SPICE reads `M` as milli — a silent 10⁹× error on any
part ≥ 1 MΩ/1 MH. Emit `MEG` in the SPICE value path (display formatting elsewhere
keeps `M`). Acceptance: 1 MΩ exports as `1MEG`; 1 mΩ as `1m`; round-trip through the
oracle simulator's parser confirms magnitudes.

### X0.3 Wire up the three dead exporters
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
The "Diagram (.json)" entry forces `pendingFormat='json'`, which is not a key in
`IMPORTERS` — the click silently does nothing. Fix: route the entry through
`detectFormat` (it resolves the placement-preserving diagram JSON vs the vendor JSON
correctly), and surface "unrecognised file" as a visible message, never a silent
no-op. Acceptance: importing a diagram JSON via the explicit menu entry works; a
garbage `.json` shows the message.

### X0.6 Silent part substitutions in the diagram-JSON importer — `importers/wokwi.js:24-63`
Deliberate approximations (RTC chip, humidity sensor, slide pot, stepper variant)
carry no `_note`/warning, violating the policy every other importer follows. Add
`_note` params and warnings for every approximating map entry. Acceptance: importing
a file containing each substituted type yields a visible warning naming both sides.

### X0.7 Instructions that never reach the user — `model/exporters/easyeda.js`, `ExportNetlistMenu.jsx:86`
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

Cross-repo: engine items in `../bw-board/ROADMAP.md`; brickwright-lite re-vendors
via `sync:circuitui` after each landing and carries the attribution/disclaimer
items listed in its own ROADMAP §3.5.

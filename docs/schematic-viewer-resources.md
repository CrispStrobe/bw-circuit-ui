# Resources for the schematic viewer, and for schematic formats

Notes for LATER work on `src/model/schematic-projection.js` and
`src/components/SchematicPanel.jsx`. Nothing here is a dependency and nothing
has been vendored — this is a reading list with the licence stated, because
the licence decides whether a thing can be copied, learned from, or only
looked at.

## Where the viewer actually stands

Measured, not guessed:

- `schematic-projection.js` is ~255 lines of rank-based auto-layout: sources
  anchor left, everything else ranks by net-graph distance, nets route as
  orthogonal trunk-and-stub with junction dots.
- It draws **22 symbol cases** against **62 kinds** in `circuit.js`'s terminal
  table, and ~200 devices registered in the engine. So most parts fall back to
  a generic box. That gap IS the "incomplete" feeling — it is a symbol
  problem at least as much as a layout problem.

**Superseded, 2026-08-20.** The two renderers are now one: `SchematicPanel.jsx`
and the headless `schematic-svg.js` both draw `shapeFor()` from
`schematic-symbols.js`, and the symbol count is up from 22. Rendering the whole
gallery headless (1034 circuits, 8387 parts) and ranking the fallbacks showed
the gap is much narrower than "62 minus 22" suggests: most undrawn kinds are
ICs, MCUs, memories and display modules, for which a pin-labelled rectangle IS
the conventional symbol. Generic boxes went 1199 → 1111 in our gallery and
1310 → 348 across the imported corpus by adding only the discretes. Measure
with `bwc batch <dir> --render <dir>` before adding artwork.

Anyone improving this should measure first: with a corpus (below) you can
import hundreds of real schematics and count overlapping symbols, off-canvas
placement, crossing trunks and unsymboled parts. That turns "buggy" into a
ranked list, which is a different job from "make it prettier".

## Symbols — the biggest single gap

These are symbol libraries, NOT schematics. They do not help a corpus; they
help the 22-of-62 problem.

| source | licence | what it gives |
| --- | --- | --- |
| `devbisme/KiCad-Schematic-Symbol-Libraries` | check per-repo | KiCad symbol set, broad coverage |
| `tylercrumpton/CrumpSchemes` | NOASSERTION | hand-made KiCad symbols |
| `JiriS97/KiCAD-MyLibrary` | check per-repo | personal KiCad library |
| `pacuserra/schemalib` | check per-repo | schematic symbol library |
| `keikawa/InkscapeCircuitSymbols` | check per-repo | SVG symbols — closest to what SchematicPanel draws |
| `qeda/qeda` | MIT | GENERATES symbols from YAML component descriptions |
| `bfueldner/pykicadlib` | check per-repo | generates KiCad libraries programmatically |
| `ddtdanilo/Personal-Altium-Library` | check per-repo | Altium — we do not read Altium, see below |

`qeda` and `pykicadlib` are the interesting two: a generator beats a fixed
library, because our symbol set has to match OUR kinds, not KiCad's.

**Licence caution before copying any symbol art**: a symbol library is
creative work. MIT is fine; CC BY-SA obliges share-alike on what you build
from it; several of these declare nothing at all, which means default
copyright, i.e. not usable. Learn the geometry conventions, draw our own.

## Rendering and layout — code to learn from

| source | licence | why it is worth reading |
| --- | --- | --- |
| `leoheck/kiri` | MIT | visual schematic/layout REVIEW tool — diffing and presenting schematics is exactly our panel's job |
| `jnavila/plotkicadsch` | NOASSERTION | exports KiCad v5 sch to SVG; a working reference for symbol placement and wire rendering |

## Format handling — code to learn from

| source | licence | why |
| --- | --- | --- |
| `circuit-synth/circuit-synth` | MIT | Python-defined circuits that GENERATE KiCad schematics — both a corpus generator and a model of how to lay a schematic out programmatically |
| `circuit-synth/kicad-sch-api` | MIT | API over `.kicad_sch` s-expressions, with examples |
| `agrimsingh/kicad-sch-ts` | none declared | TypeScript `.kicad_sch` reader/writer — closest to what a JS importer needs, but NO LICENCE means read for understanding only |
| `microsoft/SchGen` | MIT | small, 3 schematics |

Not relevant despite the name: `schematics/schematics` is a Python data
validation library ("Data Structures for Humans"), nothing to do with
circuits.

## The corpus, and why it is not in this repo

A local corpus of ~335 schematics (254 EAGLE, ~63 KiCad v6) was collected from
open-hardware orgs and the MIT sources above. It lives OUTSIDE every repo and
is never committed: the SparkFun/Adafruit hardware is CC BY-SA, and copying it
in would pull share-alike onto our source — the same reasoning that keeps
`stc-research` local.

Tests that use it are env-gated (`EAGLE_CORPUS`) and skip without it. The
corpus is what took the EAGLE importer from 50% to 82% component coverage:
supply symbols are named after the rail (`5V`, `3.3V`), passives after their
value (`0.1UF`, `1KOHM`), and a large fraction of "unmapped components" turned
out to be fiducials, mounting holes and drawing frames.

## What the format split says about priorities

Roughly half the collectable corpus is KiCad v6 `.kicad_sch`, which we cannot
read: we import EAGLE schematics and KiCad NETLISTS, not KiCad schematics. A
`.kicad_sch` importer would roughly double the material we can test against,
and `kicad-sch-api` / `kicad-sch-ts` are the references for its s-expression
shape (`sexpr.js` already exists here).

Altium `.SchDoc`/`.PcbDoc` remains declined: OLE2 compound binary, no public
spec, only partial reverse-engineered readers. Route it through an exported
netlist instead.


## Reviewed 2026-08-20: ten KiCad-adjacent repositories

Cloned to `~/code/kicad-refs/` — **LOCAL ONLY, never committed, never
published**, same rule as `~/code/eagle-corpus`. Licences below were read from
each repo's own LICENSE file, not taken from its README badge.

| repo | licence (verified) | what it is | what it is good for |
|---|---|---|---|
| `Steffen-W/KiCadFiles` | **MIT** | >200 Python dataclasses covering the whole KiCad S-expression vocabulary; 13 `.kicad_sch`, 2 `.kicad_sym` | **The one worth porting.** MIT permits it. Its `schematic_system.py` names exactly the tokens a geometric-connectivity importer must handle: `Junction`, `Label`, `GlobalLabel`, `HierarchicalLabel`, `Bus`, `BusEntry`, `NoConnect` |
| `hunes3d/kicad-skip` | **LGPL-2.1** (fork of psychogenic/kicad-skip) | Pythonic read/modify of `.kicad_sch` | Format knowledge only. **Copy no code.** A fact about what a token means is not copyrightable; an implementation is |
| `hunes3d/kAIcad` | **AGPL-3.0** | AI sidecar for KiCad, 8.7k lines | Ideas only, and treat even those carefully. **Copy nothing.** AGPL would reach our whole served application |
| `toandeptrai16zz/kicad-ai-assistant` | MIT | KiCad plugin, multi-provider LLM chat over a board | Shows how a plugin reads `.kicad_sch` from board context. Not on our path |
| `upb-lea/KiClearance` | **no LICENSE file** | clearance checking, 2 `.kicad_sch` | All rights reserved by default. Ideas only, local test files only |
| `PatriceVigier/…-Reorder-Schematic-Fields-Script` / `-Plugin` / `-Default-Fields-Plugin` | MIT | reorder `(property …)` blocks inside `(symbol …)`, KiCad 6–9 | Small and directly relevant to **roundtrip fidelity**: they show which properties exist on a symbol and that their ORDER is meaningful. Our exporter should preserve unknown properties rather than drop them |
| `eoommaa/Water-Sump-Pump` | MIT | real RP2040 project, 3 `.kicad_sch`, 3 `.kicad_sym` | Import test material. Filenames contain spaces — a good accidental test of path handling |
| `Ikarthikmb/Circuit-Designs` | **no LICENSE file** | 7 projects | Turned out to be **KiCad v4/v5 LEGACY `.sch`** (`EESchema Schematic File Version 4`), not S-expression and not EAGLE. Local test only |

### The finding that changes the plan

`Circuit-Designs` exposed a **third** schematic format. Counting what is on
disk now:

- 266 EAGLE `.sch` (XML) — supported, 94.1% part coverage
- 81 KiCad v6+ `.kicad_sch` (S-expression) — **not supported**
- 7 KiCad v4/v5 `.sch` (legacy EESchema text) — **not supported**

KiCad legacy and EAGLE share the `.sch` extension, which is precisely why
`detect.js` sniffs CONTENT rather than trusting the extension. That decision
now pays for itself.

### Why KiCad import is harder than EAGLE, in one sentence

EAGLE states connectivity (`<pinref>` inside `<net>`); KiCad v6 does **not** —
a pin is connected because its resolved position coincides with a wire
endpoint or junction, so the importer has to place every symbol's pins through
its `lib_symbols` definition, apply the instance rotation and mirror, union
wire segments by shared endpoints, and then merge nets that share a `label` /
`global_label` name. Power symbols in particular connect by NAME, not by wire.
An importer that gets this subtly wrong produces a plausible schematic with
silently missing connections, which is why the roundtrip property is net
partitions, never wire counts.

## Symbol ARTWORK: the licence trap, and the way around it

`.kicad_sym` files carry complete symbol geometry — polylines, rectangles,
arcs, circles and pins with positions — in exactly the shape our
`schematic-symbols.js` already models (`{paths, circles, texts}`). It is
tempting to harvest KiCad's official library and be done with 200 symbols.

**Do not.** The KiCad symbol libraries are **CC-BY-SA 4.0 with an exception**,
and the exception is narrower than it first reads (verified 2026-08-20 against
`KiCad/kicad-symbols/LICENSE.md`):

> "To the extent that the creation of electronic designs that use 'Licensed
> Material' can be considered to be 'Adapted Material', then the copyright
> holder waives article 3 of the license with respect to these designs and any
> generated files which use data provided as part of the 'Licensed Material'."

That waiver covers **designs made with** the library. It does not cover
**redistributing the library**, which is what bundling its geometry into our
source would be — and share-alike would then reach our own files. This is the
same rule already applied to `eagle-corpus`.

The way around it is a feature rather than a workaround: **render `.kicad_sym`
the user supplies**, at runtime, instead of shipping any. The user's own
library stays the user's; we ship a renderer, not artwork. `shapeFor()` already
returns a plain `{paths, circles, texts}` shape and both renderers consume it,
so a `kicad_sym → Shape` adapter drops straight in beside the hand-drawn table.
That also scales past anything we would ever draw by hand.

Hand-drawn symbols stay the default for the parts our own gallery uses, so the
app is complete offline with nothing imported.


## Second review, 2026-08-20: EasyEDA, an analysis oracle, and OSHWLab access

Cloned to `~/code/kicad-refs/` — **LOCAL ONLY**, same rule as before. Licences
read from each repo's own LICENSE file.

| repo | licence (verified) | what it actually holds |
|---|---|---|
| `mph-/lcapy` | **LGPL-2.1** | **The find.** A symbolic circuit-analysis library plus **501 `.sch` files** — see below |
| `makeabilitylab/physcomp` | MIT | physical-computing course material; no schematic sources (2 json, 6 py) |
| `tscircuit/easyeda-converter` | MIT | TypeScript. Talks to `easyeda.com/api/components/{uuid}` — **components only, not projects**, and its search endpoint wants a session cookie |
| `CircuitSetup/EasyEDA-to-Fusion360-Eagle` | MIT | Python, EasyEDA → EAGLE. Same scope: parts, not whole schematics |
| `Robusr/Hsiwu` | MIT | 157 files, all docs/config — no circuit material |
| `kycilius/8085-microprocessor-devkit` | **NO LICENCE FILE** | one real **EasyEDA schematic JSON** (`docType: 5`, editor 6.5.50). Local test only |
| `ElectroIoT/EasyEDA-Tutorial-Project` | **NO LICENCE FILE** | readmes and a logo. **No project files at all** — not test material |
| `gitlab.cba.mit.edu/pub/circuits` | no licence | 1 `.sch`. Research reading only |

Two of these were offered as MIT and are not: `8085-microprocessor-devkit` and
`EasyEDA-Tutorial-Project` carry no LICENSE file, so they are
all-rights-reserved by default.

### lcapy is an ORACLE, not a corpus

`lcapy`'s `.sch` is its own netlist dialect — one component per line, node
pair, plus a drawing hint:

```
V 2 0; down
R 2 1; right
C 1 3; right
L 3 0_3; down
```

That matters more than the 501 files do. lcapy solves circuits
**symbolically**, so for any of them it can state an exact transfer function
or node voltage — an answer computed by a completely independent
implementation, in closed form rather than to a tolerance. Our MNA has been
checked against itself and against measured benches; it has never been
checked against a second solver.

The obvious use: translate a handful of lcapy netlists into our parts/wires
shape, ask lcapy for the symbolic result, evaluate it at specific component
values, and compare against our MNA. A disagreement is then a real finding
rather than a judgement call.

**Licence care.** LGPL-2.1: read it for FORMAT and use it as an ORACLE by
running it, but **copy no code**, and do not vendor the `.sch` files into our
repo — they are part of an LGPL work. Generate our fixtures ourselves and
cite which lcapy circuit each corresponds to.

### EasyEDA would be a FOURTH schematic format

`docType: 5`, `editorVersion` 6.x, a `schematics` array of sheets. Both MIT
converters above stop at components (JLCPCB parts by UUID), so neither gives
us schematic import for free — but they do establish the API surface and the
JSON vocabulary, and MIT permits porting what they know.

### Getting files off OSHWLab — what is actually true

Measured, not assumed:

- **`robots.txt` is `Disallow:` with an empty value — everything is
  permitted** — and it names a sitemap.
- **The sitemap is useless**: 39 entries, all top-level pages, generated by a
  free online tool in 2024. It does not enumerate projects.
- **`curl` gets 403 on everything until you send a browser User-Agent.** That
  is UA filtering, not a block; with one, pages and APIs answer normally.
- **`GET https://easyeda.com/api/projects/{uuid}` works unauthenticated** and
  returns project metadata as JSON — including a **`license` field** (the
  example project reads `"Public Domain"`). So licence filtering is possible
  and machine-readable. The OSHWLab project page itself also embeds
  `"license":"…"` in its Next.js flight payload.
- **The schematic documents are NOT in that payload** (`docs: 0`), and
  `/docs`, `/documents`, `/files`, `/schematics` under it all 404.
- **No unauthenticated project SEARCH endpoint was found.** `/explore` renders
  client-side; the only API path in its JS chunks is a gateway,
  `POST /api/integrated`, whose request envelope was not reverse-engineered.
  `easyeda-converter`'s component search sends a `cookie` header, which
  suggests search is session-gated.

So the honest position: **per-project download by UUID is easy and licence is
readable; ENUMERATION is the hard part.** The remaining route is to drive a
real browser over the client-rendered listing (playwright is already a
devDependency here) to harvest project URLs, then hit the metadata API per
project. robots.txt permits it; it is still scraping a third party's site, so
it wants a low rate and should never be run in a loop from CI.

A cheaper corpus, and the one that worked for EAGLE: search GitHub for
EasyEDA project JSON in repositories that carry an explicit licence, where
the licence is stated once for the whole repo instead of per artefact.

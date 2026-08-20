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

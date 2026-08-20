# Third-party dependencies

| Package | Version | Licence | URL |
|---|---|---|---|
| react | 18.3.x | MIT | https://github.com/facebook/react |
| react-dom | 18.3.x | MIT | https://github.com/facebook/react |
| @wokwi/elements | 1.9.x | MIT | https://github.com/wokwi/wokwi-elements |
| lit | 3.x | BSD-3-Clause | https://github.com/lit/lit |
| @lit/react | 1.x | BSD-3-Clause | https://github.com/lit/lit |
| vite | 8.x | MIT | https://github.com/vitejs/vite (dev only) |
| @vitejs/plugin-react | 6.x | MIT | https://github.com/vitejs/vite-plugin-react (dev only) |

## Format knowledge, not code

No third-party source is vendored into this repository. Several file formats
are read here that nobody in this project designed, and the facts about them
-- what a token means, where a pin's origin sits, how an orientation matrix is
applied -- came from published documentation, from reading other people's
projects, and from measuring real files. Facts about a format are not
copyrightable; an implementation is, and none was copied.

| Source | Licence | What was taken |
|---|---|---|
| KiCad file-format documentation (dev-docs.kicad.org) | CC-BY-SA 4.0 (docs) | the `.kicad_sch` and legacy EESchema grammars |
| [KiCadFiles](https://github.com/ImpulseAdventure/KiCadFiles) | MIT | schema knowledge for `.kicad_sch` tokens |
| EasyEDA Standard `.json` documents | — | the tilde-delimited shape DSL, decoded by MEASURING published schematics; no reader's source was read while writing `src/importers/easyeda.js` |

EasyEDA publishes no grammar, so that one was worked out from the files: field
positions confirmed by counting, and the load-bearing claims (pins are already
in sheet space; a bus body does not conduct) confirmed by mutating a real
board and watching the net partition move. `easyeda-converter` (MIT) and
`easyeda2kicad` (MIT, with an Apache-2.0 carve-out on one file) exist and
handle COMPONENTS rather than whole schematics; neither was copied or
paraphrased. No third-party schematic is committed here -- the fixtures under
`test/fixtures/easyeda-*.json` are hand-authored, and the tests that use a
published board read it in place and skip when it is absent.

Two other KiCad readers were consulted to understand the FORMAT and are
deliberately not reflected in the code: `kicad-skip` (LGPL-2.1) and `kAIcad`
(AGPL-3.0). Nothing from either was copied or paraphrased.

The corpora used to measure coverage -- roughly ninety real schematics --
are local to the author's machine and are not, and must not be, committed
here. Some carry no licence at all. Everything under `test/fixtures/` that
concerns KiCad was written for this repository, which is also why its
expected net partitions can be derived by hand rather than asserted from
whatever the importer happened to produce.

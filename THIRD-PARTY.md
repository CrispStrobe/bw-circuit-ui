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

No third-party source is vendored into this repository. Two file formats are
read here that nobody in this project designed, and the facts about them --
what a token means, where a pin's origin sits, how an orientation matrix is
applied -- came from published documentation and from reading other people's
projects. Facts about a format are not copyrightable; an implementation is,
and none was copied.

| Source | Licence | What was taken |
|---|---|---|
| KiCad file-format documentation (dev-docs.kicad.org) | CC-BY-SA 4.0 (docs) | the `.kicad_sch` and legacy EESchema grammars |
| [KiCadFiles](https://github.com/ImpulseAdventure/KiCadFiles) | MIT | schema knowledge for `.kicad_sch` tokens |

Two other KiCad readers were consulted to understand the FORMAT and are
deliberately not reflected in the code: `kicad-skip` (LGPL-2.1) and `kAIcad`
(AGPL-3.0). Nothing from either was copied or paraphrased.

The corpora used to measure coverage -- roughly ninety real schematics --
are local to the author's machine and are not, and must not be, committed
here. Some carry no licence at all. Everything under `test/fixtures/` that
concerns KiCad was written for this repository, which is also why its
expected net partitions can be derived by hand rather than asserted from
whatever the importer happened to produce.

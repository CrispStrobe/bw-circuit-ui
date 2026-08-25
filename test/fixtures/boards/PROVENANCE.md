# Real-board test corpus — provenance and licences

Every file in this directory is a REAL published PCB design, committed here
as a test fixture under its own permissive licence. Licences were verified
on 2026-08-25 from each repository's LICENSE file (via the GitHub API
`license.spdx_id` plus a read of the README for hardware carve-outs — two
projects in the wider search had MIT code but CC-BY-NC-SA hardware, so the
carve-out check is not optional). Files were fetched from the raw URLs
below; sha256 prefixes recorded so drift is visible.

Boards whose licences do NOT permit redistribution (GPL, CC-BY-SA, NC) are
NOT here — they live in the LOCAL corpus (`~/code/pcb-corpus-local`, or
`$BW_PCB_CORPUS`), which `test/board-corpus.test.js` sweeps when present
and skips cleanly when not, exactly like the `~/Downloads` live boards.

| file | project | licence | source (raw URL base) | sha256 (16) |
|---|---|---|---|---|
| dvi-sock.kicad_pcb/.kicad_sch | [Pico-DVI-Sock](https://github.com/Wren6991/Pico-DVI-Sock) (Wren6991) | CC0-1.0 | raw.githubusercontent.com/Wren6991/Pico-DVI-Sock/master/ | 11c389053ae88714 / 5de0109a71bbac76 |
| otter-front/back.kicad_pcb | [OtterCastAmp](https://github.com/Ottercast/OtterCastAmp) front panels | MIT (README: only 3D/ and datasheets/ excluded) | raw.githubusercontent.com/Ottercast/OtterCastAmp/master/front/ | 93f397a100e3242a / 897bdf6215935653 |
| tiny-esp.kicad_pcb | [tiny-ESP8266-breakout](https://github.com/skorokithakis/tiny-ESP8266-breakout) (skorokithakis) | BSD-2-Clause | raw.githubusercontent.com/skorokithakis/tiny-ESP8266-breakout/master/breakout.kicad_pcb | 458ec8a347a46746 |
| orpheuspad.kicad_pcb/.kicad_sch | [hackpad / orpheuspad](https://github.com/hackclub/hackpad) (Hack Club) | MIT | raw.githubusercontent.com/hackclub/hackpad/master/extras/orpheuspad/pcb/ | 140d8e9e05f16d26 / 810f7f3446f3d8c4 |
| atomic14.kicad_pcb | [basic-esp32s3-dev-board](https://github.com/atomic14/basic-esp32s3-dev-board) (atomic14) | MIT | raw.githubusercontent.com/atomic14/basic-esp32s3-dev-board/main/dev-board.kicad_pcb | 70df526cee6d24d4 |
| nanoels-pcb/-sch.json | [NanoEls](https://github.com/kachurovskiy/nanoels) LCD board (kachurovskiy) | MIT | raw.githubusercontent.com/kachurovskiy/nanoels/main/h2/EasyEDA/NanoElsLcd/ | d28e035c32c648a6 / ec7273f61c9b0d85 |
| tuitar-pcb/-sch.json | [tuitar](https://github.com/orhun/tuitar) (orhun) | MIT OR Apache-2.0 | raw.githubusercontent.com/orhun/tuitar/main/hardware/ | 8c9661ebf38e4f5f / 1fd0dd171f9baa1d |
| macropad.epcb | [macropad](https://github.com/anirudh12032008/macropad) (anirudh12032008) | MIT (GitHub licence detection; LICENSE present) | raw.githubusercontent.com/anirudh12032008/macropad/main/PCB/PCB1.epcb | 26455ef7be9c5397 |
| nanohub.epcb | [Nano_Hub](https://github.com/Irtaza2009/Nano_Hub) (Irtaza2009) | MIT (GitHub licence detection; LICENSE present) | raw.githubusercontent.com/Irtaza2009/Nano_Hub/main/pcb/PCB1.epcb | 2b1546a865ee2af6 |
| smartcar.epcb | [smart_car](https://github.com/paper-tei/smart_car) (paper-tei) | MIT (GitHub licence detection; LICENSE present) | raw.githubusercontent.com/paper-tei/smart_car (v7 board) | bf3d183864c45d14 |

The three `.epcb` files are **EasyEDA PRO V2** bare PCB documents (array
JSON-lines) — the Pro generation GitHub actually carries. Pro's only real
V3 sample (KiCad's QA `.epru`, "provided for QA testing", no standard
licence) lives in the local corpus as `ls2k0300-v3.epru`, alongside the
MIT OpenSTM archive's main PCB (`openstm-main.epcb`).

Coverage the set was chosen for: KiCad v4 (tiny-esp), v5 (otter, with the
centre/angle arc spelling and 16 decorative Edge.Cuts arcs), v6-dev
(dvi-sock: pre-fracture zone fills whose holes are separate rings,
castellated pads with drill offsets, 33 stitching vias), v8 (orpheuspad:
XIAO hybrid pads with rotated drill offsets), v9 (atomic14: arc entries
inside zone fill polygons) — plus two EasyEDA Standard docType-3 boards
with pours, one with matching schematics on both formats.

These files are DATA fixtures, not source: the app's MIT licence does not
apply to them and theirs do not apply to the app (mere aggregation). See
THIRD-PARTY.md at the repo root.

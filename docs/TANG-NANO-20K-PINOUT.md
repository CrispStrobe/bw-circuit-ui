# Tang Nano 20K pinout — three sources reconciled, both conflicts resolved

Compiled 2026-09-15 for TN0 (the board part). **Datasheet facts, no library
copied** — the same standard `land-patterns.js` already sets for `pi_pico`.

Part: `GW2AR-LV18QN88C8/I7`, QN88. 20736 LUT4 / 15552 FF, 64 Mbit SDRAM in
package, HDMI, microSD, RGB LED, 27 MHz input, onboard USB-JTAG.

## The two sources

| source | what it is | licence |
|---|---|---|
| **Sipeed pin-label diagram** (`tang_nano_20k_pinlabel.png`, wiki.sipeed.com) | the board vendor's own diagram — **primary** | vendor documentation |
| **litex-boards** `litex_boards/platforms/sipeed_tang_nano_20k.py` | `_io` + `_connectors`, machine-readable | **BSD-2-Clause**, © 2023 Icenowy Zheng |
| **Sipeed Tang Nano 20K Datasheet v1.3** (Shenzhen Sipeed Technology) | Pinout page + mechanical drawing — **decisive** | vendor documentation |

Where they disagree, **Sipeed wins** — and the datasheet says why in its own
revision history: *"Fixed the issue of pinout picture."* **An earlier Sipeed
pinout diagram was wrong, and the 2023 LiteX file encodes it.** That is the
explanation for both disagreements below; neither is a board revision, and
neither needs a multimeter after all.

Independent check on the whole table: the datasheet states **"2x20P 2.54mm DIP
Pin Headers with 34 free IOs"**, and the table below has exactly 34 I/O pins
and 6 power/ground pins across 40 positions.

## Header pinout (Sipeed diagram, primary)

LiteX's `J5`/`J6` names are matched to physical sides **by pin content**, not by
any label in the diagram. Treat that mapping as inferred.

### Left header — LiteX `J6`

| # | FPGA pin | bank name | onboard function |
|---|---|---|---|
| 1 | 73 | IOT40A | |
| 2 | 74 | IOT34B | |
| 3 | 75 | IOT34A | HSPI_DIR — *was CONFLICT 1* |
| 4 | 85 | IOT4B | SDIO_D1 |
| 5 | 77 | IOT30A | LCD_CLK |
| 6 | 15 | IOL47A | LED0 |
| 7 | 16 | IOL47B | LED1 |
| 8 | 27 | IOB8A | LCD_B7 |
| 9 | 28 | IOB8B | LCD_B6 |
| 10 | 25 | IOB6A | LCD_HS — *was CONFLICT 2* |
| 11 | 26 | IOB6B | LCD_VS — *was CONFLICT 2* |
| 12 | 29 | IOB14A | LCD_B5 |
| 13 | 30 | IOB14B | LCD_B4 |
| 14 | 31 | IOB29A | LCD_B3 |
| 15 | 17 | IOL49A | LED2 |
| 16 | 20 | IOL50B | LED5 |
| 17 | 19 | IOL51A | LED4 |
| 18 | 18 | IOL49B | LED3 |
| 19 | — | **3V3** | power out |
| 20 | — | **GND** | |

### Right header — LiteX `J5`

| # | FPGA pin | bank name | onboard function |
|---|---|---|---|
| 1 | — | **5V** | power out — **never an input, see below** |
| 2 | — | **GND** | |
| 3 | 76 | IOT30B | HSPI_DAT — *was CONFLICT 1* |
| 4 | 80 | IOT27A | SDIO_D2 |
| 5 | 42 | IOB42B | LCD_R3 |
| 6 | 41 | IOB43A | LCD_R4 |
| 7 | 56 | IOR36A | I2S_BCLK |
| 8 | 54 | IOR38A | I2S_DIN |
| 9 | 51 | IOR45A | PA_EN |
| 10 | 48 | IOR49B | LCD_DE |
| 11 | 55 | IOR36B | I2S_LRCK |
| 12 | 49 | IOR49A | LCD_BL |
| 13 | 86 | IOT4A | |
| 14 | 79 | IOT27B | 2812_DIN (RGB LED) |
| 15 | — | **GND** | |
| 16 | — | **3V3** | power out |
| 17 | 72 | IOT40B | |
| 18 | 71 | IOT44A | |
| 19 | 53 | IOR38B | EDID_CLK |
| 20 | 52 | IOR39A | EDID_DAT |

## CONFLICT 1 — RESOLVED: pins 75 and 76

    Sipeed:  75 on the LEFT header (pos 3),  76 on the RIGHT header (pos 3)
    LiteX:   76 on J6 (left, pos 4),         75 on J5 (right, pos 4)

They are exactly swapped. **Resolved in favour of Sipeed** by the datasheet
v1.3 pinout page, whose revision history records the pinout-picture fix that the
2023 LiteX file predates. **75 is on the LEFT header, 76 on the RIGHT.**

## CONFLICT 2 — RESOLVED: pins 25 and 26

    Sipeed:  ... 28, 25 (LCD_HS), 26 (LCD_VS), 29 ...
    LiteX:   ... 28, 26,          25,          29 ...

Same two pins, adjacent, swapped. **Resolved the same way: Sipeed v1.3 is
correct — 25 (LCD_HS) then 26 (LCD_VS).**

### A third correction, to this document's own first draft

Pin 20 is **`IOL51B`**, not `IOL50B`. The low-resolution wiki diagram was
misread here; the datasheet render is unambiguous, and `IOL51B`/`IOL51A`
(20/19) are the expected adjacent pair.

## Electrical facts that drive the DRC

- **Every bank on the headers is V_IO = 3.3 V** — the diagram's legend marks
  BANK0, BANK1, BANK3, BANK5 and BANK6 all at 3.3 V.
- **Gowin I/O is NOT 5 V tolerant.** This is the rule TN0 exists to enforce.
- **There IS a 5 V pin on the right header (position 1).** It is the USB rail,
  an **output**. A learner can legitimately power a 5 V part from it — and then
  wire that part's output back into a 3.3 V bank pin and destroy the FPGA. That
  is the exact mistake to catch: *5 V out is fine, 5 V in is not.*
- HDMI `hdp`/`cec` are LVCMOS18 (1.8 V) per LiteX, but those are not on the
  headers, so they are out of scope for the part.

## Mechanical, from the datasheet's drawing

- **54.04 mm x 22.55 mm**, 2.54 mm header pitch.
- **Header rows are 20.32 mm apart = 8 pitches**, measured off the mechanical
  drawing against its own stated 22.55 mm width. That is `rowSpanPitches: 8` in
  the footprint, against `pi_pico`'s 7 (0.7") and `arduino_nano`'s 6 (0.6").

## Still open

- **A PCB land pattern.** `LAND_PATTERNS[kind] || {}` degrades gracefully, so
  the part works on the breadboard without one; only the PCB view lacks a
  footprint. Deliberately deferred rather than guessed.
- Which pins double as onboard peripherals is recorded above and matters: pins
  15–20 are the LEDs and 79 is the RGB LED, so driving them from the breadboard
  also drives onboard hardware. The part should say so rather than pretend the
  header pin is free.

# Displays Acceptance — Results

| Field | Value |
|-------|-------|
| Date | 2026-08-16T23:10:38.639Z |
| Deploy SHA | `bad79ba` |
| URL | https://crispstrobe.github.io/brickwright-lite/ |
| Summary | **4 PASS**, 3 FAIL, 1 SKIP |

## Probe results

| Row | Verdict | Screenshot | Notes |
|-----|---------|------------|-------|
| matrix | ✅ PASS | `/tmp/accept-matrix.png` | brightness changed between samples (max=0.999) |
| char_lcd | ✅ PASS | `/tmp/accept-char-lcd.png` | LCD text: "H" (wokwi) |
| 7seg | ✅ PASS | `/tmp/accept-7seg-t1.png` | segments changed: "0,0,0,0,0,0,0,0" → "1,0,0,0,0,0,0,0" |
| seven_seg_3 | ⚪ SKIP | `/tmp/accept-seven-seg-3.png` | seven_seg_3 part added but no display face rendered (walking-8 check pending) |
| ssd1306 | ❌ FAIL | `/tmp/accept-ssd1306.png` | no SSD1306 PCB body rect (fill="#0a0a1e") in SVG — face not deployed |
| vdp | ❌ FAIL | `/tmp/accept-vdp.png` | VDP canvas still blank after ROM injection |
| serial | ✅ PASS | `/tmp/accept-serial.png` | Tali Forth 2 banner detected |
| machine_lcd | ❌ FAIL | `/tmp/accept-machine-lcd.png` | LCD device state found (activeBoard) but text empty — __bwMachineBoard undefined, board-attach not wired |

## Findings

- **seven_seg_3** (SKIP): face — seven_seg_3 display face not yet in deployed build
- **ssd1306** (FAIL): face — SvgParts ssd1306 handler not in deployed build (needs vendor-forward)
- **vdp** (FAIL): face — VdpScreen canvas not mounted or TMS9918 render not wired
- **machine_lcd** (FAIL): engine — board-attach not wiring machine VIA to designer LCD (bw-board deploy pending)

# Displays Acceptance — Results

| Field | Value |
|-------|-------|
| Date | 2026-08-17T00:04:28.256Z |
| Deploy SHA | `1f31195` |
| URL | https://crispstrobe.github.io/brickwright-lite/ |
| Summary | **5 PASS**, 2 FAIL, 1 SKIP |

## Probe results

| Row | Verdict | Screenshot | Notes |
|-----|---------|------------|-------|
| matrix | ✅ PASS | `/tmp/accept-matrix.png` | brightness changed between samples (max=1.000) |
| char_lcd | ✅ PASS | `/tmp/accept-char-lcd.png` | LCD text: "H" (wokwi) |
| 7seg | ✅ PASS | `/tmp/accept-7seg-t1.png` | segments changed: "0,0,0,0,0,0,0,0" → "1,0,0,0,0,0,0,0" |
| seven_seg_3 | ⚪ SKIP | `/tmp/accept-seven-seg-3.png` | seven_seg_3 part added but no display face rendered (walking-8 check pending) |
| ssd1306 | ❌ FAIL | `/tmp/accept-ssd1306.png` | no SSD1306 PCB body rect (fill="#0a0a1e") in SVG — face not deployed |
| vdp | ❌ FAIL | `/tmp/accept-vdp.png` | VDP canvas still blank after ROM injection |
| serial | ✅ PASS | `/tmp/accept-serial.png` | Tali Forth 2 banner detected |
| machine_lcd | ✅ PASS | `/tmp/accept-machine-lcd.png` | device-state: "HI" via board; face: wokwi shows "" |

## Findings

- **seven_seg_3** (SKIP): face — seven_seg_3 display face not yet in deployed build
- **ssd1306** (FAIL): face — SvgParts ssd1306 handler not in deployed build (needs vendor-forward)
- **vdp** (FAIL): face — VdpScreen canvas not mounted or TMS9918 render not wired

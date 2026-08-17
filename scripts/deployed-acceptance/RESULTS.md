# Displays Acceptance — Results

| Field | Value |
|-------|-------|
| Date | 2026-08-17T18:35:43.231Z |
| Deploy SHA | `504ddd2` |
| URL | https://crispstrobe.github.io/brickwright-lite/ |
| Summary | **4 PASS**, 6 FAIL, 1 SKIP |

## Probe results

| Row | Verdict | Screenshot | Notes |
|-----|---------|------------|-------|
| matrix | ❌ FAIL | `/tmp/accept-matrix.png` | matrix8x8 part or board not found |
| char_lcd | ❌ FAIL | `/tmp/accept-char-lcd.png` | no LCD part |
| 7seg | ❌ FAIL | `/tmp/accept-7seg-t0.png` | no wokwi-7segment elements found |
| seven_seg_3 | ⚪ SKIP | `/tmp/accept-seven-seg-3.png` | seven_seg_3 part added but no display face rendered (walking-8 check pending) |
| ssd1306 | ❌ FAIL | `/tmp/accept-ssd1306.png` | no SSD1306 PCB body rect (fill="#0a0a1e") in SVG — face not deployed |
| vdp | ❌ FAIL | `/tmp/accept-vdp.png` | VDP canvas still blank after ROM injection |
| serial | ✅ PASS | `/tmp/accept-serial.png` | Tali Forth 2 banner detected |
| machine_lcd | ✅ PASS | `/tmp/accept-machine-lcd.png` | device-state: "HI" via board; face: wokwi shows "HI              
                " |
| console_matrix | ❌ FAIL | `/tmp/accept-console-matrix.png` | zero lit dots in SVG — scan-duty gamma not producing visible pixels |
| lcd_hello | ✅ PASS | `/tmp/accept-lcd-hello.png` | LCD text: "HI BRICKWR" |
| contrast_pot | ✅ PASS | `/tmp/accept-contrast-pot.png` | contrast swept: 1 → 0 (pot 0→1) |

## Findings

- **matrix** (FAIL): example — no matrix8x8 part in Blinkenrocket
- **char_lcd** (FAIL): example — no LCD part in "LCD hello"
- **7seg** (FAIL): face — Wokwi 7-segment element not rendered
- **seven_seg_3** (SKIP): face — seven_seg_3 display face not yet in deployed build
- **ssd1306** (FAIL): face — SvgParts ssd1306 handler not in deployed build (needs vendor-forward)
- **vdp** (FAIL): face — VdpScreen canvas not mounted or TMS9918 render not wired
- **console_matrix** (FAIL): face — ledDisplayLevel gamma curve not applied

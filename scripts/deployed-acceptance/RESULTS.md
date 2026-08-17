# Displays Acceptance — Results

| Field | Value |
|-------|-------|
| Date | 2026-08-17T15:12:29.897Z |
| Deploy SHA | `fd21631` |
| URL | https://crispstrobe.github.io/brickwright-lite/ |
| Summary | **1 PASS**, 9 FAIL, 1 SKIP |

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
| machine_lcd | ❌ FAIL | `/tmp/accept-machine-lcd.png` | LCD device state: no LCD device state (2 boards) |
| console_matrix | ❌ ERROR | — | TimeoutError: page.screenshot: Timeout 30000ms exceeded. |
| lcd_hello | ❌ FAIL | `/tmp/accept-lcd-hello.png` | no LCD device state found after LCD Hello preset |
| contrast_pot | ❌ FAIL | `/tmp/accept-contrast-pot.png` | no LCD contrast data available |

## Findings

- **matrix** (FAIL): example — no matrix8x8 part in Blinkenrocket
- **char_lcd** (FAIL): example — no LCD part in "LCD hello"
- **7seg** (FAIL): face — Wokwi 7-segment element not rendered
- **seven_seg_3** (SKIP): face — seven_seg_3 display face not yet in deployed build
- **ssd1306** (FAIL): face — SvgParts ssd1306 handler not in deployed build (needs vendor-forward)
- **vdp** (FAIL): face — VdpScreen canvas not mounted or TMS9918 render not wired
- **machine_lcd** (FAIL): engine — machine board not exposing LCD device state
- **console_matrix** (ERROR): harness — probe threw an unhandled exception
- **lcd_hello** (FAIL): engine — LCD device state not populated
- **contrast_pot** (FAIL): engine — LCD contrast model not exposing data

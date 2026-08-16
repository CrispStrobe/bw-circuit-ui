# Displays Acceptance — Results

| Field | Value |
|-------|-------|
| Date | 2026-08-16T21:44:41.880Z |
| Deploy SHA | `db96fed` |
| URL | https://crispstrobe.github.io/brickwright-lite/ |
| Summary | **3 PASS**, 3 FAIL, 1 SKIP |

## Probe results

| Row | Verdict | Screenshot | Notes |
|-----|---------|------------|-------|
| matrix | ✅ PASS | `/tmp/accept-matrix.png` | brightness changed between samples (max=0.999) |
| char_lcd | ✅ PASS | `/tmp/accept-char-lcd.png` | LCD text: "HI BRICK" (wokwi) |
| 7seg | ✅ PASS | `/tmp/accept-7seg-t1.png` | segments changed: "0,0,0,0,0,0,0,0" → "1,0,0,0,0,0,0,0" |
| seven_seg_3 | ⚪ SKIP | `/tmp/accept-seven-seg-3.png` | seven_seg_3 part added but no display face rendered (walking-8 check pending) |
| ssd1306 | ❌ FAIL | `/tmp/accept-ssd1306.png` | no SSD1306 PCB body rect (fill="#0a0a1e") in SVG — face not deployed |
| vdp | ❌ FAIL | `/tmp/accept-vdp.png` | no runner or loadRom (canvases: 3) |
| serial | ❌ FAIL | `/tmp/accept-serial.png` | no serial console element found (data-testid="bw-serial-console") |

## Findings

- **seven_seg_3** (SKIP): face — seven_seg_3 display face not yet in deployed build
- **ssd1306** (FAIL): face — SvgParts ssd1306 handler not in deployed build (needs vendor-forward)
- **vdp** (FAIL): engine — debug runner not mounted or missing loadRom
- **serial** (FAIL): face — serial console not mounted in debug panel

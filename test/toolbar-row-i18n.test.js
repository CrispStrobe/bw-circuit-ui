/**
 * The circuit toolbar is ONE row that scrolls sideways (the Robot Lab / Code-tab
 * pattern), with the ⋯ menu pinned outside the scroller; and the palette has a
 * German word for every English one it shows.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PALETTE_DE, paletteText, paletteUi, ledColorName } from '../src/i18n/palette-de.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = file => readFileSync(join(here, '..', file), 'utf8');
const canvas = read('src/components/BoardCanvas.jsx');

test('the toolbar is one non-wrapping row; its controls scroll and ⋯ stays pinned', () => {
  const bar = canvas.slice(canvas.indexOf('<div ref={toolbarRef} data-circuit-toolbar'));
  const scroll = bar.indexOf('data-circuit-toolbar-scroll');
  const more = bar.indexOf('<CircuitMenuPopup data-toolbar-more-menu');
  assert.ok(scroll > 0 && more > scroll, 'scroller first, ⋯ after it');
  assert.match(bar.slice(0, scroll), /flexWrap: 'nowrap'/, 'the row never wraps');
  assert.doesNotMatch(bar.slice(0, more), /flexWrap: 'wrap'/);
  const scroller = bar.slice(scroll, bar.indexOf('}}>', scroll));
  assert.match(scroller, /overflowX: 'auto'/);
  assert.match(scroller, /minWidth: 0/);
  // The scroller closes before ⋯, so the menu trigger is outside it (never scrolled away).
  assert.match(bar.slice(scroll, more), /<\/div>\s*\{\/\* Pinned at the end, outside the scroller: always reachable\. \*\/\}\s*$/);
});

test('the warnings popover is portalled and fixed, so the scroller cannot clip it', () => {
  const pop = canvas.slice(canvas.indexOf('{warningsOpen && ReactDOM.createPortal('));
  assert.ok(pop.length > 0);
  assert.match(pop.slice(0, 400), /position: 'fixed'/);
  assert.match(pop, /<\/div>, document\.body/);
});

test('every palette string has German', () => {
  const src = read('src/components/PartPalette.jsx');
  const block = src.slice(src.indexOf('const CATEGORIES = ['), src.indexOf('const ALL_PARTS'));
  const strings = [...block.matchAll(/(?:name|label|tooltip|capability):\s*'((?:[^'\\]|\\.)*)'/g)].map(m => m[1]);
  assert.ok(strings.length > 200, `found ${strings.length}`);
  // Proper names and part numbers stay as they are; they need no entry.
  const sameEverywhere = /^(?:[A-Z0-9][A-Z0-9-]*(?: [A-Z0-9][A-Za-z0-9-]*)?|Arduino \w+|Raspberry Pi Pico|Sipeed Tang Nano 20K|Adafruit PyBadge|Calliope mini|Circuit Playground Express|Intel 8086|ATtiny\w+(?: QFN-32)?|74HC\d+ [A-Z]+|CD4093 NAND|LED|NPN|PNP|N-MOSFET|P-MOSFET|MCU \(STC12\)|LDR|NeoPixel|LCD 16×2|LCD I²C|OLED 128×64|24C64 EEPROM|MCP4725 DAC|8255 PPI|1N\d+A?|2N\d+|TIP120|L293D|USB-A|TMP36|DHT22)$/;
  const missing = strings.filter(s => !PALETTE_DE[s] && !sameEverywhere.test(s));
  assert.deepEqual(missing, [], 'palette strings without German');
  assert.equal(paletteText('Breadboard', 'de'), 'Steckbrett');
  assert.equal(paletteText('Breadboard', 'en'), 'Breadboard');
  assert.equal(paletteText('Something new', 'de'), 'Something new', 'missing German falls back to English');
  assert.equal(paletteUi('led', 'de', {color: ledColorName('red', 'de')}), 'LED (rot)');
});

test('the designer hands the language to the palette and the examples browser', () => {
  const designer = read('src/components/CircuitDesigner.jsx');
  assert.match(designer, /<PartPalette theme=\{theme\} lang=\{lang\}/);
  assert.match(designer, /<ExamplesBrowser examples=\{examples\} lang=\{lang\}/);
});

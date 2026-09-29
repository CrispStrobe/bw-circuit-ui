/**
 * The micro:bit's own 5x5 LED matrix on its circuit face.
 *
 * A micro:bit reaches the canvas as an `mcu` part (the canonical loader
 * rewrites controller kinds) whose device string names it, so the matrix is
 * drawn inside the mcu face when mcuChipInfo says micro:bit. The picture comes
 * from its emulator (bw-board Board.setPartMatrix, fed by the labwired tier)
 * as deviceStates[id].matrix = {width, height, brightness 0..1, levels 0..9}.
 * Before this, a micro:bit's matrix was never drawn on the circuit at all.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const boardSrc = readFileSync(join(here, '../src/components/BoardCanvas.jsx'), 'utf8');
const svgParts = boardSrc.slice(boardSrc.indexOf('function SvgParts'), boardSrc.indexOf('function WokwiParts'));
const mcuCase = svgParts.slice(svgParts.indexOf("case 'mcu': {"), svgParts.indexOf("case 'mcu': {") + 6000);

test('the mcu face draws a micro:bit matrix from its device state', () => {
  assert.match(mcuCase, /const isMicrobit = chipInfo\.label === 'micro:bit';/);
  assert.match(mcuCase, /deviceStates\?\.get\(id\)\?\.matrix/, 'reads deviceStates[id].matrix');
  assert.match(mcuCase, /Array\.from\(\{ length: 25 \}/, 'draws 25 LEDs');
  assert.match(mcuCase, /mbMatrix\.brightness\?\.\[i\]/, 'per-LED brightness');
  assert.match(mcuCase, /ledDisplayLevel\(b\)/, 'the same perceptual curve as the matrix faces');
});

test('no picture: the LEDs are dark, not guessed', () => {
  assert.match(mcuCase, /const b = mbMatrix && mbMatrix\.width === 5 \? \(mbMatrix\.brightness\?\.\[i\] \?\? 0\) : 0;/);
  assert.match(mcuCase, /data-microbit-matrix=\{mbMatrix \? 'live' : 'dark'\}/);
});

test('mcu parts are fed their device state (the micro:bit matrix travels there)', () => {
  const list = boardSrc.slice(boardSrc.indexOf('const m = new Map();'), boardSrc.indexOf('let ds = eb.getDeviceState(p.id);'));
  assert.match(list, /p\.kind === 'mcu'/, "'mcu' is on the deviceStates allow-list");
});

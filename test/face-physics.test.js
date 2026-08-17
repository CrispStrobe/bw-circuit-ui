/**
 * Face–physics binding: the knob angle and LCD glass must come from the
 * engine, never hardcoded.  Source-level pins so a regression shows up
 * as a test failure, not a silently-wrong render.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../src/components/BoardCanvas.jsx'),
  'utf8');

test('potentiometer knob reads controlValues from the engine, not hardcoded 0.5', () => {
  // The WokwiPotentiometer value= must reference controlValues, not a literal.
  // Use the WokwiParts instance (the second occurrence is inside the render).
  const potStart = src.indexOf("case 'potentiometer': {");
  assert.ok(potStart > 0, 'potentiometer render block found');
  const potBlock = src.slice(potStart, potStart + 2000);
  assert.ok(potBlock.includes('controlValues'), 'pot face must read controlValues');
  assert.ok(
    /value=\{controlValues/.test(potBlock),
    'value= prop must bind to controlValues (not a literal)',
  );
  // There must be a fallback for when the board hasn't set a control yet.
  assert.ok(potBlock.includes('?? 0.5'), 'fallback to 0.5 when controlValues missing');
});

test('WokwiParts receives controlValues prop', () => {
  // The function signature must destructure controlValues.
  const sig = src.match(/function WokwiParts\(\{[^}]+\}/);
  assert.ok(sig, 'WokwiParts function signature found');
  assert.ok(sig[0].includes('controlValues'), 'controlValues in WokwiParts destructuring');
});

test('controlValues map is built from the engine board', () => {
  // The caller must construct a controlValues map by calling getControl
  // on the active board.
  const caller = src.slice(src.indexOf('<WokwiParts'));
  assert.ok(caller.includes('controlValues={'), 'controlValues prop passed to WokwiParts');
  assert.ok(caller.includes('getControl'), 'getControl called to build the map');
});

test('LCD face passes backlight from deviceState to WokwiLcd1602', () => {
  // The LCD render block starts at `case 'char_lcd':` (the second
  // occurrence — inside WokwiParts, after terminal offsets).
  const lcdCaseStart = src.lastIndexOf("case 'char_lcd':");
  assert.ok(lcdCaseStart > 0, 'char_lcd render case found');
  const lcdBlock = src.slice(lcdCaseStart, lcdCaseStart + 3000);
  assert.ok(lcdBlock.includes('backlight={'), 'backlight prop passed to WokwiLcd1602');
  // Must read from deviceStates, not hardcode.
  assert.ok(lcdBlock.includes('ds.backlight'), 'backlight read from device state');
});

test('LCD backlight threshold: dim below 0.1, not a hard binary', () => {
  // The parallel-LCD model gives a 0..1 float. The face must threshold it
  // at a low value so a dim-but-nonzero backlight still reads as "on".
  const lcdCaseStart = src.lastIndexOf("case 'char_lcd':");
  assert.ok(lcdCaseStart > 0, 'char_lcd render case found');
  const lcdBlock = src.slice(lcdCaseStart, lcdCaseStart + 3000);
  assert.ok(
    lcdBlock.includes('> 0.1'),
    'backlight threshold at 0.1 (not 0.0 or 0.5)',
  );
});

/**
 * Buzzer-audio source-level pins: AudioContext resume, shared context API,
 * and the buzzer-effect dependency on `mode`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const audioSrc = readFileSync(join(here, '../src/audio/buzzer-audio.js'), 'utf8');
const designerSrc = readFileSync(join(here, '../src/components/CircuitDesigner.jsx'), 'utf8');
const indexSrc = readFileSync(join(here, '../src/index.js'), 'utf8');

test('AudioContext is resumed when suspended (autoplay-policy unlock)', () => {
  assert.ok(
    audioSrc.includes("audioCtx.state === 'suspended'") && audioSrc.includes('audioCtx.resume()'),
    'getAudioCtx must check suspended state and call resume()',
  );
});

test('setSharedAudioContext is exported for host integration', () => {
  assert.ok(
    audioSrc.includes('export function setSharedAudioContext'),
    'buzzer-audio exports setSharedAudioContext',
  );
  assert.ok(
    indexSrc.includes('setSharedAudioContext'),
    'index.js re-exports setSharedAudioContext for the host',
  );
});

test('buzzer update effect depends on mode so it re-fires after build→simulate', () => {
  // Find the buzzer update useEffect — the one with updateBuzzerAudio
  const effectStart = designerSrc.indexOf("updateBuzzerAudio(bz.id, tone)");
  assert.ok(effectStart > 0, 'buzzer update effect found');
  // The closing deps array should include `mode`
  const effectBlock = designerSrc.slice(effectStart, effectStart + 300);
  assert.ok(
    effectBlock.includes(', mode]'),
    'buzzer useEffect deps must include mode',
  );
});

test('buzzer effect guards on simulate mode', () => {
  // The effect should not produce audio when mode !== 'simulate'
  const effectIdx = designerSrc.indexOf("updateBuzzerAudio(bz.id, tone)");
  const effectBlock = designerSrc.slice(Math.max(0, effectIdx - 300), effectIdx);
  assert.ok(
    effectBlock.includes("mode !== 'simulate'"),
    'buzzer effect must check mode before producing audio',
  );
});

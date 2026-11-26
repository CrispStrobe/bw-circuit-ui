// SPDX-License-Identifier: MIT
import React, {useEffect, useRef, useState} from 'react';
import {AceKimMachine} from 'bw-board/ace-kim-machine.js';

const KEYS = ['←', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '→',
  'F', 'E', 'D', 'C', 'ESC', 'INS', 'PgUp', 'A', '↑', 'DEL', 'PgDn', 'B'];
const HOST_KEYS = new Map([['ArrowLeft', '←'], ['ArrowRight', '→'], ['ArrowUp', '↑'],
  ['Escape', 'ESC'], ['Insert', 'INS'], ['Delete', 'DEL'], ['PageUp', 'PgUp'], ['PageDown', 'PgDn']]);
const FIRMWARE = {
  bios: 'https://raw.githubusercontent.com/acwright/6502-BIOS/932021a429bf2c9cdc3a9cbd6a974bef9268e183/BIOS.bin',
  monitor: 'https://raw.githubusercontent.com/acwright/6502-KIM/b01b5dcda9409385188abab4ec47bed237dac3c0/Firmware/KC%20Monitor/KC%20Monitor.bin'
};

export function AceKimPanel() {
  const [machine, setMachine] = useState(null);
  const [display, setDisplay] = useState(['', '']);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const remaining = useRef(0);
  const mounted = useRef(null);
  useEffect(() => {
    const controller = new AbortController();
    mounted.current = controller;
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!machine) return;
    let frame;
    const tick = () => {
      if (remaining.current) {
        const batch = Math.min(remaining.current, 20000);
        machine.run(batch);
        remaining.current -= batch;
        const lines = machine.lcd.text;
        setDisplay(last => lines.every((line, index) => line === last[index]) ? last : lines.slice());
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [machine]);

  const start = async () => {
    const controller = mounted.current;
    if (!controller) return;
    setLoading(true);
    setError('');
    try {
      const entries = await Promise.all(Object.entries(FIRMWARE).map(async ([slot, url]) => {
        const response = await fetch(url, {signal: controller.signal});
        if (!response.ok) throw new Error(`Firmware download failed (${response.status}).`);
        return [slot, new Uint8Array(await response.arrayBuffer())];
      }));
      if (controller.signal.aborted) return;
      remaining.current = 1_300_000;
      setMachine(new AceKimMachine(Object.fromEntries(entries)));
    } catch (problem) {
      if (!controller.signal.aborted) setError(problem.message);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };
  const press = index => {
    if (!machine) return;
    machine.pressKey(index);
    remaining.current = Math.max(remaining.current, 100_000);
  };
  return <details className="kim1-help"><summary>ACE KIM · 65C02</summary>
    {machine ? <>
      <div className="kim1-editor-actions">
        <button type="button" title="Reset ACE KIM" onClick={() => { machine.reset(); remaining.current = 1_300_000; }}>↻</button>
      </div>
      <pre aria-label="ACE KIM LCD" data-ace-kim-lcd>{display.join('\n')}</pre>
      <div className="kim1-keypad ace-kim-keypad" role="group" aria-label="ACE KIM keypad" tabIndex={0}
        onKeyDown={event => {
          const index = KEYS.indexOf(HOST_KEYS.get(event.key) ?? event.key.toUpperCase());
          if (index < 0 || event.repeat) return;
          event.preventDefault();
          event.stopPropagation();
          press(index);
        }}>
        {KEYS.map((label, index) => <button type="button" key={label} onClick={() => press(index)}>{label}</button>)}
      </div>
    </> : <button type="button" disabled={loading} onClick={start}>{loading ? 'Loading…' : 'Load ACE firmware'}</button>}
    {error && <p role="alert">{error}</p>}
  </details>;
}

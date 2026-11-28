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

export function AceKimFace({machine, disabled = false}) {
  const [display, setDisplay] = useState(() => machine.lcd.text.slice());
  const [error, setError] = useState('');
  const remaining = useRef(0);
  const frame = useRef(null);
  const wake = useRef(null);
  useEffect(() => {
    const tick = () => {
      frame.current = null;
      try {
        const batch = Math.min(remaining.current, 20000);
        machine.run(batch);
        remaining.current -= batch;
        const lines = machine.lcd.text;
        setDisplay(last => lines.every((line, index) => line === last[index]) ? last : lines.slice());
        if (remaining.current) frame.current = requestAnimationFrame(tick);
      } catch (problem) {
        remaining.current = 0;
        setError(problem.message);
      }
    };
    const run = instructions => {
      remaining.current = Math.max(remaining.current, instructions);
      if (frame.current === null) frame.current = requestAnimationFrame(tick);
    };
    wake.current = run;
    run(1300000);
    return () => {
      wake.current = null;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [machine]);
  const press = index => {
    machine.pressKey(index);
    wake.current?.(100000);
  };
  const reset = () => {
    machine.reset();
    setDisplay(machine.lcd.text.slice());
    setError('');
    wake.current?.(1300000);
  };
  return <>
    <div className="kim1-editor-actions">
      <button type="button" title="Reset ACE KIM" aria-label="Reset ACE KIM" disabled={disabled} onClick={reset}>↻</button>
    </div>
    <pre aria-label="ACE KIM LCD" data-ace-kim-lcd>{display.join('\n')}</pre>
    <div className="kim1-keypad ace-kim-keypad" role="group" aria-label="ACE KIM keypad" tabIndex={disabled ? -1 : 0}
      onKeyDown={event => {
        const index = KEYS.indexOf(HOST_KEYS.get(event.key) ?? event.key.toUpperCase());
        if (disabled || index < 0 || event.repeat) return;
        event.preventDefault();
        event.stopPropagation();
        press(index);
      }}>
      {KEYS.map((label, index) => <button type="button" key={label} disabled={disabled} onClick={() => press(index)}>{label}</button>)}
    </div>
    {error && <p role="alert">{error}</p>}
  </>;
}

export function AceKimPanel() {
  const [machine, setMachine] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const mounted = useRef(null);
  useEffect(() => {
    const controller = new AbortController();
    mounted.current = controller;
    return () => controller.abort();
  }, []);

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
      setMachine(new AceKimMachine(Object.fromEntries(entries)));
    } catch (problem) {
      if (!controller.signal.aborted) setError(problem.message);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };
  return <details className="kim1-help"><summary>ACE KIM · 65C02</summary>
    {machine ? <AceKimFace machine={machine} /> :
      <button type="button" disabled={loading} onClick={start}>{loading ? 'Loading…' : 'Load ACE firmware'}</button>}
    {error && <p role="alert">{error}</p>}
  </details>;
}

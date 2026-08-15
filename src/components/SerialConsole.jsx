/**
 * SerialConsole — terminal emulator face for serial-bearing machines.
 *
 * Renders TX output as scrolling text, sends keyboard input as RX bytes.
 * Used by z80-bench (Searle ACIA), eater6502 (W65C51 ACIA), and any
 * machine whose adapter exposes onSerial/sendSerial.
 *
 * Not a full VT100 — just honest character display: CR returns the
 * cursor, LF scrolls, printable ASCII renders, control chars ignored.
 * Backspace erases. That is what the Searle monitor actually sends.
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { t } from '../i18n/strings.js';

const MAX_LINES = 200;
const MAX_LINE_LEN = 80;

export function SerialConsole({ onSerialFn, sendSerialFn, lang = 'en' }) {
  const [lines, setLines] = useState(['']);
  const [focused, setFocused] = useState(false);
  const wrapRef = useRef(null);
  const bottomRef = useRef(null);
  const cursorRef = useRef({ line: 0, col: 0 });

  // Subscribe to TX output
  useEffect(() => {
    if (typeof onSerialFn !== 'function') return;
    onSerialFn((byte) => {
      setLines(prev => {
        const next = [...prev];
        const ch = byte & 0x7f;
        if (ch === 0x0a) { // LF
          next.push('');
          cursorRef.current = { line: next.length - 1, col: 0 };
          if (next.length > MAX_LINES) next.splice(0, next.length - MAX_LINES);
        } else if (ch === 0x0d) { // CR
          cursorRef.current.col = 0;
        } else if (ch === 0x08) { // BS
          const i = next.length - 1;
          if (next[i].length > 0) next[i] = next[i].slice(0, -1);
          cursorRef.current.col = Math.max(0, cursorRef.current.col - 1);
        } else if (ch >= 0x20 && ch < 0x7f) { // printable
          const i = next.length - 1;
          if (next[i].length < MAX_LINE_LEN) {
            next[i] += String.fromCharCode(ch);
            cursorRef.current.col++;
          }
        }
        return next;
      });
    });
  }, [onSerialFn]);

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'nearest' });
  }, [lines]);

  // Keyboard → RX
  const handleKeyDown = useCallback((e) => {
    if (typeof sendSerialFn !== 'function') return;
    if (e.key === 'Enter') { sendSerialFn(0x0d); e.preventDefault(); }
    else if (e.key === 'Backspace') { sendSerialFn(0x08); e.preventDefault(); }
    else if (e.key.length === 1) { sendSerialFn(e.key.charCodeAt(0)); e.preventDefault(); }
  }, [sendSerialFn]);

  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onClick={() => wrapRef.current?.focus()}
      data-serial-console
      style={{
        background: '#0a0a0a', color: '#22c55e',
        fontFamily: '"Courier New", monospace', fontSize: 12, lineHeight: 1.3,
        padding: 8, borderRadius: 4, width: '100%', boxSizing: 'border-box',
        minHeight: 80, maxHeight: 200, overflowY: 'auto',
        border: focused ? '2px solid #3b82f6' : '1px solid #333',
        outline: 'none', cursor: 'text', whiteSpace: 'pre',
      }}
    >
      {lines.length === 0 || (lines.length === 1 && lines[0] === '') ? (
        <span style={{ color: '#555' }}>{t('serialEmpty', lang)}</span>
      ) : (
        lines.map((line, i) => <div key={i}>{line || '\u00a0'}</div>)
      )}
      <div ref={bottomRef} />
    </div>
  );
}

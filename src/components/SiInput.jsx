/**
 * SiInput — a text input that accepts SI suffix notation.
 *
 * Accepts: 10k, 4.7k, 1M, 100, 47u, 100n, 10p
 * Click to edit, type a value with suffix, Enter or blur to commit.
 */

import React, { useState, useCallback } from 'react';
import { parseSi, formatSi } from '../model/si.js';

export { parseSi, formatSi };

export function SiInput({ value, onChange, style }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');

  const startEdit = useCallback(() => {
    setEditing(true);
    setText(formatSi(value));
  }, [value]);

  const commit = useCallback(() => {
    setEditing(false);
    const parsed = parseSi(text);
    if (!isNaN(parsed) && parsed > 0) {
      onChange(parsed);
    }
  }, [text, onChange]);

  if (editing) {
    return (
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
        autoFocus
        style={{ ...style, width: '60px' }}
      />
    );
  }

  return (
    <span
      onClick={startEdit}
      style={{
        ...style,
        cursor: 'text',
        display: 'inline-block',
        width: '60px',
        padding: '2px 4px',
      }}
    >
      {formatSi(value)}
    </span>
  );
}

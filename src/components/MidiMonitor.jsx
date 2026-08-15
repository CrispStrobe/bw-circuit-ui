/**
 * MidiMonitor — decodes MIDI note-on/off from a serial TX stream at
 * 31250 baud. Renders a rolling list of note events with pitch names.
 *
 * The monitor reads from the board's serial output buffer (if the
 * baud rate matches MIDI). It does NOT render a full piano; it shows
 * the decoded event stream for teaching what MIDI bytes mean.
 */

import React, { useEffect, useState, useRef } from 'react';
import { t } from '../i18n/strings.js';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const MAX_EVENTS = 20;

function noteName(n) {
  return `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;
}

/**
 * @param {{ serialDataFn: () => number[], lang?: string }} props
 * serialDataFn returns new bytes since last call (or empty array).
 */
export function MidiMonitor({ serialDataFn, lang = 'en' }) {
  const [events, setEvents] = useState([]);
  const bufRef = useRef([]);
  const idRef = useRef(0);

  useEffect(() => {
    if (typeof serialDataFn !== 'function') return;
    let raf;
    const poll = () => {
      const bytes = serialDataFn();
      if (bytes && bytes.length) {
        const buf = bufRef.current;
        buf.push(...bytes);

        // Parse MIDI messages (status + data bytes)
        const newEvents = [];
        while (buf.length >= 1) {
          const status = buf[0];
          // Note On: 0x9n + note + velocity
          if ((status & 0xf0) === 0x90 && buf.length >= 3) {
            const ch = status & 0x0f;
            const note = buf[1];
            const vel = buf[2];
            newEvents.push({
              id: ++idRef.current,
              type: vel > 0 ? 'on' : 'off',
              channel: ch,
              note,
              velocity: vel,
              name: noteName(note),
            });
            buf.splice(0, 3);
          // Note Off: 0x8n + note + velocity
          } else if ((status & 0xf0) === 0x80 && buf.length >= 3) {
            const ch = status & 0x0f;
            const note = buf[1];
            newEvents.push({
              id: ++idRef.current,
              type: 'off',
              channel: ch,
              note,
              velocity: buf[2],
              name: noteName(note),
            });
            buf.splice(0, 3);
          // Other status byte: consume as 3-byte message if enough data
          } else if ((status & 0x80) && buf.length >= 3) {
            buf.splice(0, 3);
          // Real-time byte (0xF8-0xFF): single byte
          } else if (status >= 0xf8) {
            buf.splice(0, 1);
          // Not enough data yet
          } else if (status & 0x80) {
            break;
          // Data byte without status: discard
          } else {
            buf.splice(0, 1);
          }
        }

        if (newEvents.length) {
          setEvents(prev => [...prev.slice(-MAX_EVENTS + newEvents.length), ...newEvents]);
        }
      }
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, [serialDataFn]);

  return (
    <div data-midi-monitor style={{
      background: '#16213e', borderRadius: 6, padding: 8,
      fontFamily: 'monospace', fontSize: 10, color: '#94a3b8',
      width: '100%', boxSizing: 'border-box',
    }}>
      <strong style={{ color: '#e2e8f0', fontSize: 11 }}>{t('midiMonitor', lang)}</strong>
      {events.length === 0 ? (
        <div style={{ color: '#475569', marginTop: 6, fontSize: 9 }}>
          {t('midiNoData', lang)}
        </div>
      ) : (
        <div style={{ marginTop: 4, maxHeight: 120, overflowY: 'auto' }}>
          {events.map(ev => (
            <div key={ev.id} style={{
              display: 'flex', gap: 6, padding: '1px 0',
              color: ev.type === 'on' ? '#22c55e' : '#94a3b8',
            }}>
              <span style={{ minWidth: 50 }}>
                {ev.type === 'on' ? `♪ ${t('midiNoteOn', lang)}` : `○ ${t('midiNoteOff', lang)}`}
              </span>
              <span style={{ color: '#3b82f6', minWidth: 30 }}>{ev.name}</span>
              <span style={{ color: '#475569' }}>ch{ev.channel} vel{ev.velocity}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

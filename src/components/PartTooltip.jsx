/**
 * PartTooltip — shows part info and live readings on hover.
 *
 * All values come from the engine. Nothing is fabricated.
 */

import React from 'react';
import { partLabel, fmtOhms } from '../model/format.js';

/**
 * @param {{ part, circuit, visible, x, y }} props
 */
export function PartTooltip({ part, circuit, visible, x, y, lang = 'en' }) {
  if (!visible || !part) return null;
  const de = /^de/i.test(String(lang || ''));

  const lines = [];
  lines.push(partLabel(part));

  // Live readings from the engine (if available)
  try {
    switch (part.kind) {
      // A light path: the light its receiver gets through it (full light = 100 %).
      case 'light_path': {
        const rep = circuit.opticalReport?.();
        const rx = rep && (Object.entries(rep.receivers).find(([id]) => id === part.params?.to)
          ?? Object.entries(rep.receivers)[0]);
        if (rx) {
          const pct = (rx[1].light * 100).toFixed(1);
          lines.push(de ? `Licht am Empfänger: ${pct.replace('.', ',')} %` : `Light at receiver: ${pct}%`);
        }
        break;
      }
      case 'led': {
        const b = circuit.ledBrightness(part.id);
        lines.push(de ? `Helligkeit: ${(b * 100).toFixed(1).replace('.', ',')} %` : `Brightness: ${(b * 100).toFixed(1)}%`);
        if (b > 0.001) {
          lines.push(de ? `Strom: ${(b * 20).toFixed(2).replace('.', ',')} mA` : `Current: ${(b * 20).toFixed(2)} mA`);
        }
        break;
      }
      case 'buzzer':
      case 'piezo':
      // The coil transducers also report loudness (level 0..1, 1 = rated
      // power) and the RMS coil current that sets it.
      case 'speaker':
      case 'earphone': {
        const tone = circuit.buzzerTone(part.id);
        lines.push(tone?.on ? `${tone.hz.toFixed(0)} Hz` : (de ? 'Aus' : 'Off'));
        if (tone?.on && typeof tone.level === 'number') {
          const pct = (tone.level * 100).toFixed(0);
          lines.push(de ? `Lautstärke: ${pct} %` : `Level: ${pct}%`);
        }
        if (tone?.on && typeof tone.amps === 'number') {
          const mA = tone.amps * 1000;
          const s = mA >= 1 ? mA.toFixed(1) : mA.toFixed(3);
          lines.push(de ? `Strom: ${s.replace('.', ',')} mA eff.` : `Current: ${s} mA RMS`);
        }
        break;
      }
      case 'resistor':
        lines.push(`${fmtOhms(part.params.ohms)}`);
        break;
      case 'potentiometer':
        lines.push(`${fmtOhms(part.params.ohms)} ${de ? 'Poti' : 'pot'}`);
        break;
      case 'capacitor':
        lines.push(`${part.params.farads} F`);
        break;
      default:
        break;
    }
  } catch {
    // Part might not be wired to engine yet
  }

  return (
    <div style={{
      position: 'fixed',
      left: x + 15,
      top: y - 10,
      background: '#0a0a1a',
      border: '1px solid #3498db',
      borderRadius: '4px',
      padding: '6px 8px',
      fontFamily: 'monospace',
      fontSize: '10px',
      color: '#ecf0f1',
      pointerEvents: 'none',
      zIndex: 100,
      whiteSpace: 'nowrap',
      boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
    }}>
      {lines.map((line, i) => (
        <div key={i} style={{
          color: i === 0 ? '#3498db' : '#bdc3c7',
          fontWeight: i === 0 ? 'bold' : 'normal',
        }}>{line}</div>
      ))}
    </div>
  );
}

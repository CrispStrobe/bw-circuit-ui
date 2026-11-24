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
      // Sensing transducers (bw-board sensing-transducers.js): the readouts
      // their device models publish on the device state.
      case 'thermocouple': {
        const s = circuit.board?.getDeviceState?.(part.id);
        if (s && Number.isFinite(s.emfV)) {
          const mv = (s.emfV * 1000).toFixed(2);
          lines.push(de ? `Thermospannung: ${mv.replace('.', ',')} mV` : `EMF: ${mv} mV`);
          lines.push(de ? `Lötstelle ${Math.round(s.hotC)} °C, Umgebung ${Math.round(s.coldC)} °C`
            : `Junction ${Math.round(s.hotC)} °C, bench ${Math.round(s.coldC)} °C`);
        }
        break;
      }
      case 'air_coil': {
        const s = circuit.board?.getDeviceState?.(part.id);
        if (s && Number.isFinite(s.amps)) {
          const mA = (s.amps * 1000).toFixed(1);
          const mT = (s.fieldT * 1000).toFixed(3);
          lines.push(de ? `Strom: ${mA.replace('.', ',')} mA` : `Current: ${mA} mA`);
          lines.push(de ? `Feld innen: ${mT.replace('.', ',')} mT` : `Field inside: ${mT} mT`);
          lines.push(de ? `Kompass: ${s.compassDeg.toFixed(0)}° ausgelenkt` : `Compass: ${s.compassDeg.toFixed(0)}° deflected`);
        }
        break;
      }
      case 'electrolysis_cell': {
        const s = circuit.board?.getDeviceState?.(part.id);
        if (s && Number.isFinite(s.amps)) {
          const uA = Math.abs(s.faradaicAmps * 1e6);
          const shown = uA >= 100 ? uA.toFixed(0) : uA.toFixed(2);
          lines.push(de ? `Elektrolyse: ${shown.replace('.', ',')} µA` : `Electrolysis: ${shown} µA`);
          const taste = { none: de ? 'nichts' : 'nothing', faint: de ? 'schwach' : 'faint', strong: de ? 'deutlich' : 'strong' }[s.taste];
          lines.push(de ? `Geschmack: ${taste}` : `Taste: ${taste}`);
        }
        break;
      }
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

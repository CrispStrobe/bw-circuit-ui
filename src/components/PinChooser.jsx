/**
 * PinChooser — shows alternate functions for MCU pins.
 *
 * Three states from getPinFunctions (bw-board owns the accessor):
 *   null    → not yet audited (show GPIO with "?" marker)
 *   []      → audited, no alternates (show "GPIO only")
 *   [...]   → audited, these are the functions
 *
 * The distinction between null and [] must survive to the pixel.
 * bw-board tested it across the API; this component is where it
 * either reaches the user or dies in the last hop.
 *
 * Presentation-only: no editing, no interaction beyond display.
 */

import React from 'react';

const FUNCTION_LABELS = {
  gpio: 'GPIO',
  analog_only: 'Analog only',
};

function formatFunction(fn) {
  return FUNCTION_LABELS[fn] || fn.toUpperCase();
}

/**
 * @param {{ pins: Array<{name: string, functions: string[]|null}> }} props
 */
export function PinChooser({ pins }) {
  if (!pins || pins.length === 0) return null;

  const audited = pins.filter(p => p.functions !== null && p.functions !== undefined);
  const total = pins.length;

  return (
    <div style={{
      background: '#1a1a2e', border: '1px solid #2c3e50', borderRadius: 8,
      padding: 8, fontFamily: 'monospace', fontSize: 10, maxHeight: 200,
      overflowY: 'auto',
    }}>
      <div style={{ color: '#7f8c8d', marginBottom: 4 }}>
        Pin functions ({audited.length}/{total} audited)
      </div>
      {pins.map(pin => (
        <div key={pin.name} style={{
          display: 'flex', gap: 6, padding: '2px 4px', alignItems: 'center',
          borderBottom: '1px solid #16213e',
        }}>
          <span style={{ color: '#f39c12', width: 40, flexShrink: 0 }}>{pin.name}</span>
          {pin.functions === null || pin.functions === undefined ? (
            // NOT AUDITED — show GPIO assumed with ? marker
            <span style={{ color: '#556' }}>
              GPIO <span style={{ color: '#f39c12' }} title="Not yet audited — alternate functions unknown">?</span>
            </span>
          ) : pin.functions.length === 0 ? (
            // AUDITED, NO ALTERNATES
            <span style={{ color: '#7f8c8d' }}>GPIO only</span>
          ) : pin.functions.includes('analog_only') ? (
            // ANALOG ONLY — no digital
            <span style={{ color: '#e67e22' }}>Analog only (no digital)</span>
          ) : (
            // AUDITED WITH FUNCTIONS
            <span style={{ color: '#2ecc71' }}>
              {pin.functions.map(formatFunction).join(' · ')}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

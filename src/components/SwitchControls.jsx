import React from 'react';
import {switchClosed, toggleSwitch} from '../model/switch-controls.js';

/** Live contacts, including while the CPU is paused; no second switch latch. */
export function SwitchControls({parts, board, onControlChange, lang = 'en'}) {
  const switches = parts.filter(part => part.kind === 'switch');
  if (switches.length === 0) return null;
  const de = /^de/i.test(lang);
  return (
    <section data-switch-controls aria-label={de ? 'Schalter' : 'Switches'} style={{width: '100%'}}>
      <div style={{fontWeight: 600, color: '#e2e8f0', marginBottom: 4}}>{de ? 'Schalter' : 'Switches'}</div>
      <div style={{fontSize: 9, marginBottom: 6}}>
        {de ? 'Geschlossen verbindet die beiden Anschlüsse.' : 'Closed joins the two terminals.'}
      </div>
      <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(112px, 1fr))', gap: 5}}>
        {switches.map(part => {
          const closed = switchClosed(part, board);
          const name = part.declName || part.id;
          const state = de ? (closed ? 'Geschlossen' : 'Offen') : (closed ? 'Closed' : 'Open');
          return (
            <button key={part.id} type="button" data-switch-control={part.id}
              aria-pressed={closed} aria-label={`${name}: ${state}`}
              disabled={typeof onControlChange !== 'function'}
              onClick={() => toggleSwitch(part, board, onControlChange)}
              style={{minHeight: 34, padding: '5px 7px', textAlign: 'left',
                border: `1px solid ${closed ? '#38bdf8' : '#64748b'}`, borderRadius: 4,
                background: closed ? '#164e63' : '#1e293b', color: '#f1f5f9',
                cursor: typeof onControlChange === 'function' ? 'pointer' : 'default',
                fontFamily: 'monospace', fontSize: 10, overflowWrap: 'anywhere'}}>
              <span style={{display: 'block', fontWeight: 600}}>{name}</span>
              <span style={{display: 'block', fontSize: 9, marginTop: 2}}>{state}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

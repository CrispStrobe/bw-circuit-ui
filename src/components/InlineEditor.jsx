/**
 * InlineEditor — appears on double-click over a part.
 *
 * Shows the part's editable properties in a compact popup near the
 * part, without needing the side panel. Double-click is the standard
 * interaction in professional circuit tools.
 */

import React, { useEffect, useRef } from 'react';
import { partLabel } from '../model/format.js';

export function InlineEditor({ part, x, y, onUpdateParams, onClose }) {
  const ref = useRef(null);
  const firstInput = useRef(null);

  useEffect(() => {
    firstInput.current?.focus();
    firstInput.current?.select?.();
  }, [part?.id]);

  // Close on click-outside or Escape
  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener('keydown', handleKey);
    document.addEventListener('mousedown', handleClick, true);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleClick, true);
    };
  }, [onClose]);

  if (!part) return null;

  const editableParams = Object.entries(part.params || {})
    .filter(([k]) => k !== 'pins');

  return (
    <div ref={ref} data-inline-editor onPointerDown={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} style={{
      position: 'fixed',
      left: x + 20,
      top: y - 10,
      background: '#ffffff',
      border: '1px solid #3498db',
      borderRadius: '6px',
      padding: '8px 10px',
      fontFamily: 'monospace',
      fontSize: '11px',
      zIndex: 200,
      minWidth: '120px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
    }}>
      <div style={{ color: '#1d4ed8', fontWeight: 'bold', marginBottom: '6px' }}>
        {partLabel(part)}
      </div>

      {/* Declaration name */}
      {part.declName != null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px' }}>
          <span style={{ color: '#7f8c8d', fontSize: '10px' }}>name:</span>
          <input
            type="text"
            value={part.declName}
            onChange={(e) => {
              part.declName = e.target.value;
              onUpdateParams(part.id, {});
            }}
            style={{
              width: '70px', padding: '2px 4px',
              background: '#ffffff', border: '1px solid #94a3b8',
              borderRadius: '2px', color: '#1e293b',
              fontFamily: 'monospace', fontSize: '10px',
            }}
          />
        </div>
      )}

      {editableParams.map(([k, v], index) => (
        <div key={k} style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '3px' }}>
          <span style={{ color: '#7f8c8d', fontSize: '10px', minWidth: '35px' }}>{k}:</span>
          <input
            ref={index === 0 ? firstInput : undefined}
            type={typeof v === 'number' ? 'number' : 'text'}
            inputMode={typeof v === 'number' ? 'decimal' : undefined}
            step={typeof v === 'number' ? (k === 'ohms' ? 1 : 0.1) : undefined}
            min={typeof v === 'number' ? 0 : undefined}
            value={v ?? ''}
            onChange={(e) => {
              const newVal = typeof v === 'number' ? (e.target.value === '' ? 0 : Number(e.target.value)) : e.target.value;
              onUpdateParams(part.id, { [k]: newVal });
            }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            style={{
              width: '72px', height: '28px', boxSizing: 'border-box', padding: '2px 4px',
              background: '#ffffff', border: '1px solid #64748b',
              borderRadius: '3px', color: '#1e293b',
              fontFamily: 'monospace', fontSize: '11px',
            }}
          />
        </div>
      ))}
    </div>
  );
}

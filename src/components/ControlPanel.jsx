/**
 * ControlPanel — mode switch, power toggle, selection info, delete actions.
 */

import React from 'react';

export function ControlPanel({
  mode, onModeChange,
  powered, onPowerToggle,
  selectedPart, selectedWire,
  parts,
  onRemovePart, onRemoveWire,
}) {
  const selPart = selectedPart ? parts.find(p => p.id === selectedPart) : null;

  return (
    <div style={{
      background: '#1a1a2e',
      border: '1px solid #2c3e50',
      borderRadius: '8px',
      padding: '12px',
      width: '180px',
      fontFamily: 'monospace',
      fontSize: '12px',
    }}>
      <h3 style={{ color: '#ecf0f1', fontSize: '13px', marginBottom: '12px' }}>
        Controls
      </h3>

      {/* Mode toggle */}
      <div style={{ marginBottom: '12px' }}>
        <label style={{ color: '#bdc3c7', fontSize: '11px' }}>Mode:</label>
        <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
          <button
            onClick={() => onModeChange('build')}
            style={{
              flex: 1, padding: '6px',
              background: mode === 'build' ? '#2c3e50' : '#16213e',
              border: mode === 'build' ? '1px solid #3498db' : '1px solid #2c3e50',
              color: mode === 'build' ? '#3498db' : '#7f8c8d',
              borderRadius: '4px', cursor: 'pointer', fontFamily: 'monospace',
            }}
          >Build</button>
          <button
            onClick={() => onModeChange('simulate')}
            style={{
              flex: 1, padding: '6px',
              background: mode === 'simulate' ? '#2c3e50' : '#16213e',
              border: mode === 'simulate' ? '1px solid #2ecc71' : '1px solid #2c3e50',
              color: mode === 'simulate' ? '#2ecc71' : '#7f8c8d',
              borderRadius: '4px', cursor: 'pointer', fontFamily: 'monospace',
            }}
          >Sim</button>
        </div>
      </div>

      {/* Power toggle */}
      <div style={{ marginBottom: '12px' }}>
        <button
          onClick={onPowerToggle}
          style={{
            width: '100%', padding: '8px',
            background: powered ? '#27ae60' : '#c0392b',
            border: 'none', borderRadius: '4px',
            color: '#ecf0f1', fontFamily: 'monospace',
            cursor: 'pointer', fontWeight: 'bold',
          }}
        >{powered ? 'POWER ON' : 'POWER OFF'}</button>
      </div>

      {/* Selection info */}
      <div style={{
        padding: '8px',
        background: '#16213e',
        borderRadius: '4px',
        marginBottom: '8px',
        minHeight: '60px',
      }}>
        <div style={{ color: '#7f8c8d', fontSize: '10px', marginBottom: '4px' }}>
          Selected:
        </div>
        {selPart ? (
          <>
            <div style={{ color: '#ecf0f1' }}>{selPart.kind}</div>
            <div style={{ color: '#7f8c8d', fontSize: '10px' }}>{selPart.id}</div>
            {Object.entries(selPart.params).map(([k, v]) => (
              <div key={k} style={{ color: '#bdc3c7', fontSize: '10px' }}>
                {k}: {v}
              </div>
            ))}
          </>
        ) : selectedWire ? (
          <div style={{ color: '#2ecc71' }}>Wire {selectedWire}</div>
        ) : (
          <div style={{ color: '#7f8c8d' }}>Nothing</div>
        )}
      </div>

      {/* Delete */}
      {(selectedPart || selectedWire) && (
        <button
          onClick={() => {
            if (selectedWire) onRemoveWire(selectedWire);
            else if (selectedPart) onRemovePart(selectedPart);
          }}
          style={{
            width: '100%', padding: '8px',
            background: '#c0392b', border: 'none',
            borderRadius: '4px', color: '#ecf0f1',
            fontFamily: 'monospace', cursor: 'pointer',
          }}
        >Delete Selected</button>
      )}

      {/* Help */}
      <div style={{ marginTop: '16px', color: '#7f8c8d', fontSize: '10px', lineHeight: '1.4' }}>
        Click red dots to wire.<br/>
        Select + Del to remove.<br/>
        ESC to cancel/deselect.<br/>
        All values from engine.
      </div>
    </div>
  );
}

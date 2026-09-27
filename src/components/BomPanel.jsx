/**
 * BomPanel — Bill of Materials display.
 *
 * Shows a parts list with quantities and values, generated from the
 * circuit model. Includes CSV export. Presentation-only.
 */

import React, { useMemo, useCallback } from 'react';
import { generateBom, bomToCsv } from '../model/bom.js';
import { carrierAssemblySvg } from '../model/carrier-assembly-svg.js';
import { downloadText } from '../model/exporters/download.js';
import { PartThumbnail } from './PartThumbnail.jsx';

export function BomPanel({ parts }) {
  const bom = useMemo(() => generateBom(parts || []), [parts]);

  const handleExport = useCallback(() => {
    const csv = bomToCsv(bom);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bom.csv';
    a.click();
    URL.revokeObjectURL(url);
  }, [bom]);

  const handleAssemblyExport = useCallback((line, kind) => {
    const svg = carrierAssemblySvg({ kind, carrier: line.carrier.id });
    downloadText(svg, `${kind}-${line.carrier.id}-assembly.svg`, 'image/svg+xml');
  }, []);

  if (bom.length === 0) {
    return (
      <div style={{
        background: '#1a1a2e', border: '1px solid #2c3e50', borderRadius: '8px',
        padding: '12px', fontFamily: 'monospace', fontSize: '11px', color: '#556',
      }}>
        No parts to list
      </div>
    );
  }

  const totalParts = bom.reduce((s, b) => s + b.qty, 0);

  return (
    <div style={{
      background: '#1a1a2e',
      border: '1px solid #2c3e50',
      borderRadius: '8px',
      padding: '8px',
      fontFamily: 'monospace',
      fontSize: '10px',
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: '6px',
      }}>
        <span style={{ color: '#ecf0f1', fontSize: '11px', fontWeight: 'bold' }}>
          Bill of Materials ({totalParts} parts)
        </span>
        <button onClick={handleExport} style={{
          background: '#16213e', border: '1px solid #2c3e50', borderRadius: '4px',
          color: '#7f8c8d', padding: '2px 8px', cursor: 'pointer',
          fontFamily: 'monospace', fontSize: '9px',
        }}>CSV</button>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #2c3e50' }}>
            <th style={{ textAlign: 'right', padding: '3px 6px', color: '#7f8c8d' }}>Qty</th>
            <th style={{ textAlign: 'left', padding: '3px 6px', color: '#7f8c8d' }}></th>
            <th style={{ textAlign: 'left', padding: '3px 6px', color: '#7f8c8d' }}>Part</th>
          </tr>
        </thead>
        <tbody>
          {bom.map((line, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #16213e' }}>
              <td style={{ textAlign: 'right', padding: '4px 6px', color: '#ecf0f1' }}>
                {line.qty}×
              </td>
              <td style={{ padding: '2px 4px' }}>
                <PartThumbnail kind={line.kind} displaySize={20} />
              </td>
              <td style={{ padding: '4px 6px', color: '#bdc3c7' }}>
                {line.label}
                {line.carrier && (
                  <div style={{ marginTop: 3, color: '#7f8c8d', fontSize: 9 }}>
                    {line.carrier.inputPackage} {line.carrier.inputPitchMm} mm →{' '}
                    {line.carrier.headerPitchMm} mm header · {line.carrier.sourcing}
                    {line.assemblyKinds.map(kind => (
                      <button key={kind} data-carrier-assembly={kind}
                        onClick={() => handleAssemblyExport(line, kind)}
                        title={`Download printable ${kind} pin legend`}
                        style={{ marginLeft: 6, border: '1px solid #2c3e50', borderRadius: 3,
                          background: '#16213e', color: '#9fb3c8', cursor: 'pointer',
                          fontFamily: 'monospace', fontSize: 8 }}>
                        {kind} legend SVG
                      </button>
                    ))}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

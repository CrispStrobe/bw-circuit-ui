/**
 * Export Netlist Menu — dropdown offering SPICE / KiCad / EasyEDA export.
 *
 * Self-contained React component: pass it a Circuit instance, it handles
 * netlist extraction, serialization, and file download. No other props
 * needed. Follows the existing toolbar button style (34×34, border, emoji).
 *
 * Integration: add to the toolbar in BoardCanvas.jsx after the save button:
 *   {circuit && <ExportNetlistMenu circuit={circuit} lang={lang} />}
 *
 * @module
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { extractNetlist } from '../model/netlist.js';
import { toSpice } from '../model/exporters/spice.js';
import { toKicadNet } from '../model/exporters/kicad.js';
import { toEasyEDA } from '../model/exporters/easyeda.js';
import { toEasyEdaSchematic } from '../model/exporters/easyeda-schematic.js';
import { toEagleSch } from '../model/exporters/eagle.js';
import { downloadText } from '../model/exporters/download.js';

const FORMATS = [
  { id: 'spice', label: 'SPICE (.cir)', labelDe: 'SPICE (.cir)',
    ext: '.cir', mime: 'text/plain' },
  { id: 'kicad', label: 'KiCad Netlist (.net)', labelDe: 'KiCad-Netzliste (.net)',
    ext: '.net', mime: 'text/plain' },
  // Native dialect: the application opens this directly; round-trips
  // through our importer with partition equality (221/222 examples).
  { id: 'easyeda-native', label: 'EasyEDA schematic (.json)',
    labelDe: 'EasyEDA-Schaltplan (.json)', ext: '.json', mime: 'application/json' },
  { id: 'easyeda', label: 'EasyEDA (via KiCad netlist)', labelDe: 'EasyEDA (via KiCad-Netzliste)',
    ext: '.net', mime: 'text/plain' },
  // Connectivity only — no symbol geometry, so EAGLE itself will not render
  // it. Round-trips through our own importer; useful as interchange.
  { id: 'eagle', label: 'EAGLE schematic (.sch, netlist only)',
    labelDe: 'EAGLE-Schaltplan (.sch, nur Netzliste)', ext: '.sch', mime: 'application/xml' },
];

/**
 * @param {{ circuit: object, lang?: string }} props
 */
export default function ExportNetlistMenu({ circuit, lang = 'en' }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);
  const de = /^de/i.test(lang);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleExport = useCallback((formatId) => {
    setOpen(false);
    if (!circuit) return;

    const netlist = extractNetlist(circuit);
    const filename = `circuit${FORMATS.find(f => f.id === formatId).ext}`;

    switch (formatId) {
      case 'spice': {
        const { text, skipped } = toSpice(netlist);
        if (skipped.length > 0) {
          console.log('[Export] SPICE skipped parts:', skipped);
        }
        downloadText(text, filename);
        break;
      }
      case 'kicad': {
        const text = toKicadNet(netlist);
        downloadText(text, filename);
        break;
      }
      case 'eagle': {
        // From the circuit's own parts and wires, NOT the netlist:
        // extractNetlist drops power rails and infrastructure, and a
        // round-trip that loses every GND symbol is not a round-trip.
        const { xml, warnings } = toEagleSch({ parts: circuit.parts, wires: circuit.wires });
        if (warnings.length) console.log('[Export] EAGLE:\n  ' + warnings.join('\n  '));
        downloadText(xml, filename);
        break;
      }
      case 'easyeda-native': {
        const { text, report } = toEasyEdaSchematic(circuit);
        if (report.skipped.length) {
          console.warn('EasyEDA export omissions:', report.skipped);
        }
        downloadText(text, 'circuit.easyeda.json');
        break;
      }
      case 'easyeda': {
        const { text, instructions } = toEasyEDA(netlist);
        downloadText(text, `circuit-for-easyeda${FORMATS.find(f => f.id === formatId).ext}`);
        console.log('[Export] EasyEDA import instructions:\n' + instructions);
        break;
      }
    }
  }, [circuit]);

  const btnStyle = {
    width: 34, minWidth: 34, height: 34, padding: 0,
    background: '#2c3e50', border: '1px solid #8e44ad',
    borderRadius: 3, color: '#9b59b6', fontSize: 14,
    cursor: 'pointer', position: 'relative',
  };

  const menuStyle = {
    position: 'absolute', top: '100%', right: 0, zIndex: 999,
    background: '#1e293b', border: '1px solid #475569',
    borderRadius: 4, padding: '4px 0', minWidth: 180,
    boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
  };

  const itemStyle = {
    display: 'block', width: '100%', padding: '6px 12px',
    background: 'none', border: 'none', color: '#e2e8f0',
    fontFamily: 'monospace', fontSize: 11, textAlign: 'left',
    cursor: 'pointer',
  };

  return (
    <div ref={menuRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen(v => !v)}
        title={de ? 'Netzliste exportieren' : 'Export netlist'}
        aria-label={de ? 'Netzliste exportieren' : 'Export netlist'}
        style={btnStyle}
      >
        📤
      </button>
      {open && (
        <div style={menuStyle}>
          <div style={{ padding: '4px 12px', color: '#94a3b8', fontSize: 10, fontFamily: 'monospace' }}>
            {de ? 'Netzliste exportieren' : 'Export Netlist'}
          </div>
          {FORMATS.map(fmt => (
            <button
              key={fmt.id}
              onClick={() => handleExport(fmt.id)}
              style={itemStyle}
              onMouseEnter={e => e.target.style.background = '#334155'}
              onMouseLeave={e => e.target.style.background = 'none'}
            >
              {de ? fmt.labelDe : fmt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

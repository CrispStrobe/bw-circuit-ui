/**
 * Import Circuit Menu — the counterpart to ExportNetlistMenu.
 *
 * Reads a foreign schematic/netlist and hands the result to a load callback.
 * Self-contained: a file picker, the format registry, and — the part that
 * matters — a REPORT of what could not be mapped.
 *
 * That report is the point, not a nicety. An importer that quietly drops the
 * components it does not understand produces a circuit nobody drew, which the
 * engine will then simulate confidently. importCircuit already refuses to
 * invent kinds; this surfaces that refusal to the person who pressed the
 * button.
 *
 * PLACEMENT: mounted in CircuitDesigner beside the other load paths, because
 * it needs handleLoad, which lives there (the same reason InferPanel takes
 * onLoadCircuit). It is self-contained, so moving it next to
 * ExportNetlistMenu in BoardCanvas is a two-line change — one import, one
 * element — once whoever owns the toolbar wants it there.
 *
 * @module
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { importCircuit } from '../importers/index.js';
import { detectFormat } from '../importers/detect.js';

const FORMATS = [
  { id: 'eagle', label: 'EAGLE schematic (.sch)', labelDe: 'EAGLE-Schaltplan (.sch)',
    accept: '.sch,.xml' },
  { id: 'kicad-sch', label: 'KiCad 6+ schematic (.kicad_sch)',
    labelDe: 'KiCad-6+-Schaltplan (.kicad_sch)', accept: '.kicad_sch' },
  // A KiCad 4/5 .sch holds no pin geometry -- it lives in the project's
  // -cache.lib -- so the picker takes both files at once and the hint says so.
  // Without the library the import is every part and not one connection.
  { id: 'kicad-legacy', label: 'KiCad 4/5 schematic (.sch + -cache.lib)',
    labelDe: 'KiCad-4/5-Schaltplan (.sch + -cache.lib)', accept: '.sch,.lib',
    hint: 'pick the .sch AND its -cache.lib together',
    hintDe: 'die .sch UND die -cache.lib zusammen wählen' },
  { id: 'kicad-netlist', label: 'KiCad netlist (.net/.xml)', labelDe: 'KiCad-Netzliste (.net/.xml)',
    accept: '.net,.xml' },
  { id: 'wokwi', label: 'Wokwi (diagram.json)', labelDe: 'Wokwi (diagram.json)',
    accept: '.json' },
];

/**
 * @param {{ onImport: (data: {parts: Array, wires: Array}) => void, lang?: string }} props
 */
export function ImportCircuitMenu({ onImport, lang = 'en' }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState(null);   // { name, parts, wires, unmapped, warnings }
  const menuRef = useRef(null);
  const fileRef = useRef(null);
  const de = /^de/i.test(lang);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleFile = useCallback(async (files, forcedFormat) => {
    const picked = [...(files || [])];
    if (!picked.length) return;
    // A .lib is never the thing being imported; it is the symbol library a
    // KiCad 4/5 schematic needs and does not contain.
    const libFiles = picked.filter((f) => /\.lib$/i.test(f.name));
    const file = picked.find((f) => !/\.lib$/i.test(f.name));
    if (!file) {
      setResult({ name: picked[0].name,
        error: de
          ? 'Nur eine Bibliothek gewählt — bitte auch den Schaltplan wählen.'
          : 'That is only a symbol library — pick the schematic too.' });
      return;
    }
    let text; let libs;
    try {
      text = await file.text();
      libs = await Promise.all(libFiles.map((f) => f.text()));
    } catch (e) {
      setResult({ name: file.name, error: String(e && e.message || e) });
      return;
    }
    const format = forcedFormat || detectFormat(text, file.name);
    if (!format) {
      setResult({
        name: file.name,
        error: de
          ? 'Format nicht erkannt — bitte oben auswählen.'
          : 'Could not recognise this file — pick a format above.',
      });
      return;
    }
    const r = importCircuit(format, text, libs.length ? { lib: libs } : {});
    setResult({ name: file.name, format, ...r });
    // Load even when some components were unmapped: a partial import is
    // useful as long as the gap is stated. Nothing is loaded if NOTHING
    // mapped, because that is a failed import wearing a success's clothes.
    if (r.parts.length && typeof onImport === 'function') {
      onImport({ parts: r.parts, wires: r.wires });
    }
  }, [de, onImport]);

  const pick = (formatId) => {
    if (fileRef.current) {
      fileRef.current.dataset.format = formatId || '';
      fileRef.current.accept = formatId
        ? FORMATS.find((f) => f.id === formatId).accept
        : FORMATS.map((f) => f.accept).join(',');
      fileRef.current.click();
    }
  };

  return (
    <span ref={menuRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={de ? 'Schaltplan importieren' : 'Import a schematic'}
        aria-label={de ? 'Schaltplan importieren' : 'Import a schematic'}
        data-testid="import-circuit-button"
        style={{ width: 34, height: 34, border: '1px solid #cbd5e1', borderRadius: 6,
          background: open ? '#e2e8f0' : '#f8fafc', cursor: 'pointer' }}
      >📥</button>

      <input
        ref={fileRef}
        type="file"
        style={{ display: 'none' }}
        data-testid="import-circuit-file"
        multiple
        onChange={(e) => {
          const fs = e.target.files;
          const forced = e.target.dataset.format || '';
          e.target.value = '';            // so the same file can be re-picked
          setOpen(false);
          handleFile(fs, forced || undefined);
        }}
      />

      {open && (
        <div style={{ position: 'absolute', top: '100%', right: 0, zIndex: 60, marginTop: 4,
          minWidth: 240, background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8,
          boxShadow: '0 8px 24px rgba(15,23,42,.18)', padding: 4, textAlign: 'left' }}
        >
          <button type="button" onClick={() => pick('')}
            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px',
              border: 0, background: 'transparent', cursor: 'pointer', fontWeight: 600 }}
          >{de ? 'Datei wählen (automatisch)' : 'Choose a file (auto-detect)'}</button>
          {FORMATS.map((f) => (
            <button key={f.id} type="button" onClick={() => pick(f.id)}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px',
                border: 0, background: 'transparent', cursor: 'pointer' }}
            >
              {de ? f.labelDe : f.label}
              {f.hint && (
                <span style={{ display: 'block', fontSize: 11, color: '#64748b' }}>
                  {de ? f.hintDe : f.hint}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {result && (
        <div data-testid="import-circuit-report"
          style={{ position: 'absolute', top: '100%', right: 0, zIndex: 59, marginTop: 44,
            width: 300, maxHeight: 260, overflowY: 'auto', background: '#fff',
            border: '1px solid #cbd5e1', borderRadius: 8, padding: '8px 10px',
            boxShadow: '0 8px 24px rgba(15,23,42,.18)', fontSize: 12, textAlign: 'left' }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{result.name}</strong>
            <button type="button" onClick={() => setResult(null)}
              style={{ border: 0, background: 'transparent', cursor: 'pointer' }}
              aria-label={de ? 'Schließen' : 'Close'}
            >✕</button>
          </div>
          {result.error
            ? <div style={{ color: '#b91c1c' }}>{result.error}</div>
            : (
              <>
                <div>{de
                  ? `${result.parts.length} Bauteile, ${result.wires.length} Verbindungen`
                  : `${result.parts.length} parts, ${result.wires.length} connections`}</div>
                {result.unmapped.length > 0 && (
                  <>
                    <div style={{ marginTop: 6, color: '#b45309' }}>
                      {de
                        ? `${result.unmapped.length} nicht zugeordnet — NICHT importiert:`
                        : `${result.unmapped.length} unmapped — NOT imported:`}
                    </div>
                    <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                      {result.unmapped.map((u, i) => (
                        <li key={i}>{u.ref}: {u.libsource}{u.value ? ` (${u.value})` : ''}</li>
                      ))}
                    </ul>
                  </>
                )}
                {result.needsLibrary && (
                  <div style={{ color: '#b45309', marginTop: 6 }}>
                    {de
                      ? 'Ohne die -cache.lib des Projekts konnten keine Verbindungen aufgelöst '
                        + 'werden — bitte .sch und .lib zusammen wählen.'
                      : 'Without the project\'s -cache.lib no connections could be resolved — '
                        + 'pick the .sch and the .lib together.'}
                  </div>
                )}
                {result.parts.length === 0 && (
                  <div style={{ color: '#b91c1c', marginTop: 6 }}>
                    {de ? 'Nichts importiert.' : 'Nothing was imported.'}
                  </div>
                )}
              </>
            )}
        </div>
      )}
    </span>
  );
}

export default ImportCircuitMenu;

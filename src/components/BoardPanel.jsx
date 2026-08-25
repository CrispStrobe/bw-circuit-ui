/**
 * BoardPanel — the projected (or imported) BOARD, rendered beside the canvas.
 *
 * The board is a pure projection of the circuit via projectBoardFromCircuit
 * (or projectBoard for bare parts/wires, or an imported board model passed
 * straight in). The canvas stays the one editable surface for CONNECTIVITY;
 * this panel edits PLACEMENT only, through the overrides layer of plan
 * Phase 6: drag a part (item 1), rotate it in 90° steps (item 2), pick a
 * package variant (item 3). Every gesture ends in onOverridesChange with a
 * fresh `circuit.pcb`-shaped object — the panel never mutates anything,
 * and nothing here can ever say what touches what.
 *
 * Layer toggles are CSS over one rendered SVG (board-svg.js emits stable
 * group classes); DRC findings ride in a chip.
 */

import React, { useMemo, useState, useRef, useCallback } from 'react';
import { projectBoard, projectBoardFromCircuit } from '../model/board-projection.js';
import { renderBoardSvg } from '../model/board-svg.js';
import { runPcbDrc } from '../model/pcb-drc.js';
import { listVariants } from '../model/land-patterns.js';

const LAYERS = [
  ['copper-top', 'Top'],
  ['copper-bottom', 'Bottom'],
  ['pads', 'Pads'],
  ['silk', 'Silk'],
  ['labels', 'Refs'],
  ['drills', 'Drills'],
  ['pours', 'Pours'],
];

const SEVERITY_COLOR = { danger: '#e74c3c', warning: '#f39c12', info: '#3498db' };

export default function BoardPanel({
  circuit = null, parts = [], wires = [], board = null,
  overrides = null, onOverridesChange = null,
}) {
  const [hidden, setHidden] = useState(() => new Set());
  const [showFindings, setShowFindings] = useState(false);
  const [selected, setSelected] = useState(null);
  const [localOverrides, setLocalOverrides] = useState(null);
  const containerRef = useRef(null);
  const dragRef = useRef(null);

  // Controlled when the host passes overrides+handler; self-contained
  // otherwise (an imported-board viewer needs no host state).
  const effOverrides = overrides ?? localOverrides;
  const setOverrides = useCallback((next) => {
    if (onOverridesChange) onOverridesChange(next);
    else setLocalOverrides(next);
  }, [onOverridesChange]);

  const projected = useMemo(() => {
    if (board) return { board, unplaced: [], unrouted: [], warnings: board.warnings || [] };
    if (circuit) return projectBoardFromCircuit(circuit, { overrides: effOverrides });
    return projectBoard({ parts, wires }, { overrides: effOverrides });
  }, [board, circuit, parts, wires, effOverrides]);

  const svg = useMemo(() => renderBoardSvg(projected.board), [projected]);
  const findings = useMemo(() => runPcbDrc(projected.board), [projected]);

  const editable = !board; // an imported board has no projection to steer

  // ── gestures: drag writes {x, y}; placement space = model mm ─────
  const mmPoint = useCallback((e) => {
    const svgEl = containerRef.current?.querySelector('svg');
    if (!svgEl) return null;
    const rect = svgEl.getBoundingClientRect();
    const vb = svgEl.viewBox.baseVal;
    // Y flip back: the renderer emits y' = H − y.
    const H = Number(svgEl.dataset.boardH || vb.height - 2);
    const x = vb.x + ((e.clientX - rect.left) / rect.width) * vb.width;
    const yDown = vb.y + ((e.clientY - rect.top) / rect.height) * vb.height;
    return [x, H - yDown];
  }, []);

  const partOrigin = useCallback((id) => {
    const p = projected.board.parts.find((q) => (q.ref || q.id) === id);
    return p ? [p.x, p.y] : null;
  }, [projected]);

  const onPointerDown = useCallback((e) => {
    const target = e.target.closest?.('[data-part-id]');
    const id = target?.getAttribute('data-part-id') || null;
    setSelected(id);
    if (!editable || !id) return;
    const at = mmPoint(e);
    const origin = partOrigin(id);
    if (!at || !origin) return;
    dragRef.current = { id, grab: at, origin };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }, [editable, mmPoint, partOrigin]);

  const onPointerUp = useCallback((e) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    const at = mmPoint(e);
    if (!at) return;
    const dx = at[0] - drag.grab[0];
    const dy = at[1] - drag.grab[1];
    if (Math.hypot(dx, dy) < 0.5) return; // a click, not a drag
    const prev = effOverrides || {};
    setOverrides({
      ...prev,
      parts: {
        ...(prev.parts || {}),
        [drag.id]: {
          ...((prev.parts || {})[drag.id] || {}),
          x: Math.round((drag.origin[0] + dx) * 100) / 100,
          y: Math.round((drag.origin[1] + dy) * 100) / 100,
        },
      },
    });
  }, [mmPoint, effOverrides, setOverrides]);

  const patchSelected = useCallback((patch) => {
    if (!selected) return;
    const prev = effOverrides || {};
    const mine = (prev.parts || {})[selected] || {};
    setOverrides({
      ...prev,
      parts: { ...(prev.parts || {}), [selected]: { ...mine, ...patch } },
    });
  }, [selected, effOverrides, setOverrides]);

  const rotateSelected = useCallback(() => {
    const cur = ((effOverrides?.parts || {})[selected]?.rotation || 0);
    patchSelected({ rotation: (cur + 90) % 360 });
  }, [selected, effOverrides, patchSelected]);

  const selectedKind = useMemo(() => {
    if (!selected) return null;
    if (circuit) return circuit.parts.find((p) => p.id === selected)?.kind || null;
    return parts.find((p) => p.id === selected)?.kind || null;
  }, [selected, circuit, parts]);
  const variants = selectedKind ? listVariants(selectedKind) : [];

  const toggle = (key) => setHidden((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const css = [...hidden].map((k) => `.bw-pcb-view .bw-pcb-${k}{display:none}`).join('')
    + (selected
      ? `.bw-pcb-view [data-part-id="${selected}"]{stroke:#f1c40f;stroke-width:0.25;stroke-dasharray:0.8 0.5}`
      : '');
  const worst = findings.find((f) => f.severity === 'danger') ? 'danger'
    : findings.find((f) => f.severity === 'warning') ? 'warning' : 'info';

  return (
    <div data-board-panel style={{ display: 'flex', flexDirection: 'column', gap: 6, height: '100%', minHeight: 0 }}>
      <style>{css}</style>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {LAYERS.map(([key, label]) => (
          <label key={key} style={{ color: '#9ab0c4', fontFamily: 'monospace', fontSize: 10, display: 'inline-flex', gap: 3, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={!hidden.has(key)} onChange={() => toggle(key)} />
            {label}
          </label>
        ))}
        <span style={{ flex: 1 }} />
        {editable && selected && (
          <span data-board-part-tools style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            <span style={{ color: '#f1c40f', fontFamily: 'monospace', fontSize: 10 }}>{selected}</span>
            <button onClick={rotateSelected} title="Rotate 90°"
              style={{ background: '#1e293b', color: '#9ab0c4', border: '1px solid #475569', borderRadius: 4, fontSize: 11, cursor: 'pointer', padding: '1px 6px' }}>⟳</button>
            {variants.length > 1 && (
              <select value={(effOverrides?.parts || {})[selected]?.package || variants[0]}
                onChange={(e) => patchSelected({ package: e.target.value })}
                style={{ background: '#1e293b', color: '#9ab0c4', border: '1px solid #475569', borderRadius: 4, fontSize: 10 }}>
                {variants.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            )}
          </span>
        )}
        {findings.length > 0 && (
          <button data-board-findings-chip onClick={() => setShowFindings((v) => !v)}
            style={{ background: 'transparent', border: `1px solid ${SEVERITY_COLOR[worst]}`, color: SEVERITY_COLOR[worst], borderRadius: 10, fontFamily: 'monospace', fontSize: 10, padding: '1px 8px', cursor: 'pointer' }}>
            {findings.length} finding{findings.length === 1 ? '' : 's'}
          </button>
        )}
        {projected.unrouted.length > 0 && (
          <span style={{ color: '#f39c12', fontFamily: 'monospace', fontSize: 10 }}>
            {projected.unrouted.length} net(s) unrouted
          </span>
        )}
      </div>
      {showFindings && findings.length > 0 && (
        <div data-board-findings style={{ maxHeight: 140, overflowY: 'auto', background: '#0f172a', border: '1px solid #2c3e50', borderRadius: 6, padding: 6 }}>
          {findings.map((f, i) => (
            <div key={i} style={{ color: SEVERITY_COLOR[f.severity] || '#9ab0c4', fontFamily: 'monospace', fontSize: 10, marginBottom: 3 }}>
              [{f.rule}] {f.explanation}
            </div>
          ))}
        </div>
      )}
      <div ref={containerRef} className="bw-pcb-view" data-board-svg
        onPointerDown={onPointerDown} onPointerUp={onPointerUp}
        style={{ flex: 1, minHeight: 0, overflow: 'auto', background: '#0b1020', borderRadius: 6, touchAction: 'none' }}
        // The renderer is ours end to end (board-svg.js, no user HTML);
        // the same string is byte-compared by the baseline test.
        dangerouslySetInnerHTML={{ __html: svg }} />
      {projected.unplaced.length > 0 && (
        <div style={{ color: '#7f8c8d', fontFamily: 'monospace', fontSize: 10 }}>
          Not placed (no land pattern yet): {projected.unplaced.join(', ')}
        </div>
      )}
    </div>
  );
}

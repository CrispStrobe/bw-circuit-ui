/**
 * BoardPanel — the projected (or imported) BOARD, rendered beside the canvas.
 *
 * Strictly read-only, exactly like SchematicPanel: the board is a pure
 * projection of (parts, wires) via projectBoard, regenerated on every
 * change, or an imported board model passed in directly. The canvas stays
 * the one editable surface (plan §3); overrides come in as props and go
 * out as callbacks — this panel never mutates anything.
 *
 * Layer toggles are CSS over one rendered SVG (board-svg.js emits stable
 * group classes), so flipping layers costs no re-render. DRC findings for
 * the shown board ride in a chip, same shape the canvas warning chip uses.
 */

import React, { useMemo, useState } from 'react';
import { projectBoard } from '../model/board-projection.js';
import { renderBoardSvg } from '../model/board-svg.js';
import { runPcbDrc } from '../model/pcb-drc.js';

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

export default function BoardPanel({ parts = [], wires = [], overrides = null, board = null }) {
  const [hidden, setHidden] = useState(() => new Set());
  const [showFindings, setShowFindings] = useState(false);

  const projected = useMemo(() => {
    if (board) return { board, unplaced: [], unrouted: [], warnings: board.warnings || [] };
    return projectBoard({ parts, wires }, overrides ? { overrides } : {});
  }, [board, parts, wires, overrides]);

  const svg = useMemo(() => renderBoardSvg(projected.board), [projected]);
  const findings = useMemo(() => runPcbDrc(projected.board), [projected]);

  const toggle = (key) => setHidden((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const css = [...hidden].map((k) => `.bw-pcb-view .bw-pcb-${k}{display:none}`).join('');
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
      <div className="bw-pcb-view" data-board-svg
        style={{ flex: 1, minHeight: 0, overflow: 'auto', background: '#0b1020', borderRadius: 6 }}
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

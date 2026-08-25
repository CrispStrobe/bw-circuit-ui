/**
 * SchematicPanel — the auto-generated schematic, rendered BESIDE the canvas.
 *
 * Strictly read-only: standard symbols drawn from projectSchematic's pure
 * output, regenerated on every circuit change. No handlers, no second
 * interaction world — the canvas remains the one editable surface, and this
 * view exists so a learner can read the same circuit both ways at once.
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { projectSchematic } from '../model/schematic-projection.js';
import { shapeFor } from '../model/schematic-symbols.js';
import { classifyWheel } from '../interaction/transform.js';

const STROKE = '#9ab0c4';
const LABEL = '#6b8299';

function Symbol({ s }) {
  const { kind, x, y, params } = s;
  const g = (children) => (
    <g transform={`translate(${x} ${y})`} stroke={STROKE} strokeWidth={1.6}
      fill="none" strokeLinecap="round">
      {children}
      <text x={0} y={-24} textAnchor="middle" fill={LABEL} fontSize={9}
        fontFamily="monospace" stroke="none">{s.label}</text>
    </g>
  );

  // One description, two renderers: this and schematic-svg.js's headless one
  // both draw shapeFor(). When they each had their own switch, artwork added
  // to one silently missed the other.
  // `s.generic`: the projection ruled this kind's artwork does not reach
  // this instance's pins, so the labelled box — which draws a lead to every
  // pin by construction — is the honest symbol. See artReachesPins.
  const art = s.generic ? null : shapeFor(kind, params || {});
  if (art) {
    const val = art.value === 'ohms' ? (params.ohms != null ? fmtOhms(params.ohms) : '')
      : art.value === 'farads' ? (params.farads != null ? fmtFarads(params.farads) : '')
        : art.value === 'volts' ? `${params.volts ?? 5}V` : '';
    return g(<>
      {art.paths.map((p, i) => (
        <path key={`p${i}`} d={typeof p === 'string' ? p : p.d}
          strokeWidth={typeof p === 'string' ? undefined : p.w}
          fill={typeof p === 'string' || !p.fill ? undefined
            : (p.fill === 'currentColor' ? STROKE : p.fill)} />
      ))}
      {(art.circles || []).map((c, i) => (
        <circle key={`c${i}`} cx={c.cx} cy={c.cy} r={c.r} fill={c.fill || 'none'} />
      ))}
      {(art.texts || []).map((t, i) => (
        <text key={`t${i}`} x={t.x} y={t.y} textAnchor="middle" fill={STROKE}
          fontSize={t.size || 8} fontFamily="monospace" stroke="none">{t.s}</text>
      ))}
      {val && (
        <text x={0} y={20} textAnchor="middle" fill={LABEL} fontSize={8}
          fontFamily="monospace" stroke="none">{val}</text>
      )}
    </>);
  }

  // Generic IC/part box, sized to its CONNECTED pins, one stub and one
  // pin-name label per connection -- so an MCU visibly meets its wires
  // instead of floating beside them (the projection only lays out pins
  // that carry a net). For ICs, MCUs and modules this IS the conventional
  // symbol, not a placeholder; see schematic-symbols.js on what is
  // deliberately left to it.
  const pins = s.pins || [];
  const perSide = Math.max(1, s.pinsPerSide || Math.ceil(pins.length / 2));
  const halfH = Math.max(20, ((perSide - 1) * 18) / 2 + 16);
  return g(<>
    <rect x={-26} y={-halfH} width={52} height={halfH * 2} rx={2} />
    {pins.map(pin => {
      const edgeX = pin.side === 'left' ? -26 : 26;
      const py = pin.y - s.y;
      return (
        <g key={pin.name}>
          <path d={`M ${edgeX} ${py} L ${pin.x - s.x} ${py}`} strokeWidth={1.2} />
          <circle cx={pin.x - s.x} cy={py} r={1.6} fill={STROKE} stroke="none" />
          <text x={pin.side === 'left' ? -22 : 22} y={py + 2.5}
            textAnchor={pin.side === 'left' ? 'start' : 'end'}
            fill={LABEL} fontSize={s.pinNameSize ?? 6.5} fontFamily="monospace"
            stroke="none">{pin.name}</text>
        </g>
      );
    })}
    <text x={0} y={-halfH + 9} textAnchor="middle" fill={STROKE} fontSize={7}
      fontFamily="monospace" stroke="none">{kind.slice(0, 9)}</text>
  </>);
}

function fmtOhms(v) {
  if (v >= 1e6) return `${v / 1e6}MΩ`;
  if (v >= 1e3) return `${v / 1e3}kΩ`;
  return `${v}Ω`;
}
function fmtFarads(v) {
  if (v >= 1e-3) return `${(v * 1e3).toFixed(0)}mF`;
  if (v >= 1e-6) return `${(v * 1e6).toFixed(0)}µF`;
  if (v >= 1e-9) return `${(v * 1e9).toFixed(0)}nF`;
  return `${(v * 1e12).toFixed(0)}pF`;
}

export function SchematicPanel({ parts, nets }) {
  const proj = projectSchematic(parts, nets);
  // A read-only view still needs a CAMERA: wheel/two-finger pans, pinch or
  // ctrl+wheel zooms at the cursor, drag pans, double-click resets to fit.
  // cam = null means "fit the drawing", recomputed whenever the projection
  // grows beyond the current view.
  const [cam, setCam] = useState(null); // {x, y, k} in drawing units
  const hostRef = useRef(null);
  const dragRef = useRef(null);
  const [viewport, setViewport] = useState({ width: 1, height: 1 });

  // Match the viewBox aspect ratio to the actual viewport. The old camera
  // used the drawing's aspect ratio while preserveAspectRatio letterboxed it;
  // pointer coordinates then counted those bars as drawing space, so zoom
  // drifted away from the cursor and vertical pans barely moved (or jumped).
  const drawingAspect = proj.width / Math.max(1, proj.height);
  const viewportAspect = viewport.width / Math.max(1, viewport.height);
  let fitW = proj.width;
  let fitH = proj.height;
  if (viewportAspect > drawingAspect) fitW = fitH * viewportAspect;
  else fitH = fitW / viewportAspect;
  fitW *= 1.08;
  fitH *= 1.08;
  const fitX = (proj.width - fitW) / 2;
  const fitY = (proj.height - fitH) / 2;
  const view = cam ?? {x: fitX, y: fitY, k: 1};
  const vw = fitW / view.k;
  const vh = fitH / view.k;

  useEffect(() => {
    const el = hostRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        const width = Math.max(1, Math.round(r.width));
        const height = Math.max(1, Math.round(r.height));
        setViewport(old => old.width === width && old.height === height ? old : {width, height});
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, []);

  const onWheel = useCallback((e) => {
    e.preventDefault();
    const g = classifyWheel(e);
    setCam(c => {
      const cur = c ?? {x: fitX, y: fitY, k: 1};
      if (g.kind === 'pan') {
        return { ...cur,
          x: cur.x + g.dx * (fitW / cur.k) / viewport.width,
          y: cur.y + g.dy * (fitH / cur.k) / viewport.height };
      }
      const nk = Math.max(0.4, Math.min(6, cur.k * g.factor));
      // Zoom about the cursor: keep the drawing point under it fixed.
      const host = hostRef.current;
      if (!host) return cur;
      const r = host.getBoundingClientRect();
      const fx = (e.clientX - r.left) / r.width;
      const fy = (e.clientY - r.top) / r.height;
      const wx = cur.x + fx * (fitW / cur.k);
      const wy = cur.y + fy * (fitH / cur.k);
      return { x: wx - fx * (fitW / nk), y: wy - fy * (fitH / nk), k: nk };
    });
  }, [fitX, fitY, fitW, fitH, viewport.width, viewport.height]);

  // React makes wheel listeners passive; preventDefault needs a real one.
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  if (proj.symbols.length === 0) {
    return (
      <div style={{ padding: 16, color: '#556', fontFamily: 'monospace', fontSize: 11 }}>
        the schematic mirrors the canvas — add parts to see it
      </div>
    );
  }
  return (
    <svg data-schematic width="100%" height="100%" ref={hostRef}
      viewBox={`${view.x} ${view.y} ${vw} ${vh}`}
      preserveAspectRatio="xMidYMid meet"
      onPointerDown={(e) => {
        dragRef.current = { x: e.clientX, y: e.clientY };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!dragRef.current) return;
        const r = e.currentTarget.getBoundingClientRect();
        const scale = vw / r.width;
        setCam(c => {
          const cur = c ?? {x: fitX, y: fitY, k: 1};
          return { ...cur,
            x: cur.x - (e.clientX - dragRef.current.x) * scale,
            y: cur.y - (e.clientY - dragRef.current.y) * (vh / r.height) };
        });
        dragRef.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={() => { dragRef.current = null; }}
      onDoubleClick={() => setCam(null)}
      style={{
        background: '#111a26', borderRadius: 6, display: 'block',
        cursor: 'grab', touchAction: 'none', minHeight: 240,
      }}>
      {proj.wires.map(w => (
        <g key={w.netId} stroke="#3d5a75" strokeWidth={1.3} fill="none">
          {!w.segments && <line x1={w.trunk.x} y1={w.trunk.y1} x2={w.trunk.x} y2={w.trunk.y2} />}
          {(w.segments || w.stubs).map((seg, i) => (
            <line key={i} x1={seg[0].x} y1={seg[0].y} x2={seg[1].x} y2={seg[1].y} />
          ))}
        </g>
      ))}
      {proj.junctions.map((j, i) => (
        <circle key={i} cx={j.x} cy={j.y} r={2.4} fill="#3d5a75" />
      ))}
      {proj.netLabels.map((label, i) => (
        <g key={`${label.netId}-${i}`}>
          <line x1={label.x1} y1={label.y1} x2={label.x2} y2={label.y2}
            stroke="#3d5a75" strokeWidth={1.2} />
          <text x={label.x} y={label.y} textAnchor={label.anchor}
            fill="#64748b" fontSize={6.5} fontFamily="monospace">{label.text}</text>
        </g>
      ))}
      {proj.symbols.map(s => <Symbol key={s.id} s={s} />)}
    </svg>
  );
}

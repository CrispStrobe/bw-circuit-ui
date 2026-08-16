/**
 * ArchitectureFace — graphical debugger: per-core SVG block diagram
 * with LIVE register state, updated on every step/halt.
 *
 * v1 = the 6502: boxes for A/X/Y/SP/PC/P-flags, address and data
 * buses, IR. Values from debugState.regs() on each render. The
 * executed instruction's data path is highlighted via an opcode-class
 * → path map (load/store/alu/branch/stack/jump).
 *
 * Designed as a face: the STC12/AVR diagrams follow the same contract
 * (a component that reads regs + disasm and renders a block diagram).
 *
 * Note: the SAP-1 TTL tier needs none of this — there the circuit
 * itself is the diagram, bus LEDs light in the designer.
 */

import React, { useEffect, useState, useRef } from 'react';
import { t } from '../i18n/strings.js';

// Opcode class → which data paths light up (simplified 6502 grouping)
const OPCODE_PATHS = (() => {
  const map = {};
  // Load: data bus → register
  for (const op of [0xa9, 0xa5, 0xb5, 0xad, 0xbd, 0xb9, 0xa1, 0xb1]) map[op] = { bus: 'data', dest: 'a', class: 'load' };
  for (const op of [0xa2, 0xa6, 0xb6, 0xae, 0xbe]) map[op] = { bus: 'data', dest: 'x', class: 'load' };
  for (const op of [0xa0, 0xa4, 0xb4, 0xac, 0xbc]) map[op] = { bus: 'data', dest: 'y', class: 'load' };
  // Store: register → data bus
  for (const op of [0x85, 0x95, 0x8d, 0x9d, 0x99, 0x81, 0x91]) map[op] = { bus: 'data', src: 'a', class: 'store' };
  for (const op of [0x86, 0x96, 0x8e]) map[op] = { bus: 'data', src: 'x', class: 'store' };
  for (const op of [0x84, 0x94, 0x8c]) map[op] = { bus: 'data', src: 'y', class: 'store' };
  // ALU: A + data bus → A + flags
  for (const op of [0x69, 0x65, 0x75, 0x6d, 0x7d, 0x79, 0x61, 0x71]) map[op] = { bus: 'data', dest: 'a', flags: true, class: 'alu' }; // ADC
  for (const op of [0xe9, 0xe5, 0xf5, 0xed, 0xfd, 0xf9, 0xe1, 0xf1]) map[op] = { bus: 'data', dest: 'a', flags: true, class: 'alu' }; // SBC
  for (const op of [0x29, 0x25, 0x35, 0x2d, 0x3d, 0x39, 0x21, 0x31]) map[op] = { bus: 'data', dest: 'a', flags: true, class: 'alu' }; // AND
  for (const op of [0x09, 0x05, 0x15, 0x0d, 0x1d, 0x19, 0x01, 0x11]) map[op] = { bus: 'data', dest: 'a', flags: true, class: 'alu' }; // ORA
  for (const op of [0x49, 0x45, 0x55, 0x4d, 0x5d, 0x59, 0x41, 0x51]) map[op] = { bus: 'data', dest: 'a', flags: true, class: 'alu' }; // EOR
  // Compare: flags only
  for (const op of [0xc9, 0xc5, 0xd5, 0xcd, 0xdd, 0xd9, 0xc1, 0xd1]) map[op] = { bus: 'data', flags: true, class: 'alu' }; // CMP
  for (const op of [0xe0, 0xe4, 0xec]) map[op] = { bus: 'data', flags: true, class: 'alu' }; // CPX
  for (const op of [0xc0, 0xc4, 0xcc]) map[op] = { bus: 'data', flags: true, class: 'alu' }; // CPY
  // Transfer: register → register
  map[0xaa] = { src: 'a', dest: 'x', class: 'transfer' }; // TAX
  map[0xa8] = { src: 'a', dest: 'y', class: 'transfer' }; // TAY
  map[0x8a] = { src: 'x', dest: 'a', class: 'transfer' }; // TXA
  map[0x98] = { src: 'y', dest: 'a', class: 'transfer' }; // TYA
  map[0xba] = { src: 'sp', dest: 'x', class: 'transfer' }; // TSX
  map[0x9a] = { src: 'x', dest: 'sp', class: 'transfer' }; // TXS
  // Branch: PC modified conditionally
  for (const op of [0x10, 0x30, 0x50, 0x70, 0x90, 0xb0, 0xd0, 0xf0]) map[op] = { dest: 'pc', flags: true, class: 'branch' };
  // Jump/call
  map[0x4c] = { dest: 'pc', bus: 'addr', class: 'jump' }; // JMP abs
  map[0x6c] = { dest: 'pc', bus: 'addr', class: 'jump' }; // JMP (ind)
  map[0x20] = { dest: 'pc', src: 'sp', bus: 'addr', class: 'jump' }; // JSR
  map[0x60] = { dest: 'pc', src: 'sp', class: 'jump' }; // RTS
  // Stack
  map[0x48] = { src: 'a', dest: 'sp', class: 'stack' }; // PHA
  map[0x68] = { src: 'sp', dest: 'a', class: 'stack' }; // PLA
  map[0x08] = { dest: 'sp', flags: true, class: 'stack' }; // PHP
  map[0x28] = { src: 'sp', flags: true, class: 'stack' }; // PLP
  // Inc/Dec registers
  map[0xe8] = { dest: 'x', flags: true, class: 'alu' }; // INX
  map[0xc8] = { dest: 'y', flags: true, class: 'alu' }; // INY
  map[0xca] = { dest: 'x', flags: true, class: 'alu' }; // DEX
  map[0x88] = { dest: 'y', flags: true, class: 'alu' }; // DEY
  return map;
})();

const PATH_COLORS = {
  load: '#22c55e', store: '#3b82f6', alu: '#f59e0b',
  transfer: '#a855f7', branch: '#ec4899', jump: '#ef4444', stack: '#06b6d4',
};

const hex = (v, w = 2) => v != null ? v.toString(16).toUpperCase().padStart(w, '0') : '--';
const FLAG_NAMES = ['C', 'Z', 'I', 'D', 'B', '-', 'V', 'N'];

export function ArchitectureFace({ debugState, lang = 'en' }) {
  const [regs, setRegs] = useState(null);
  const [disasmText, setDisasmText] = useState('');
  const [opcode, setOpcode] = useState(null);
  const rafRef = useRef(0);

  useEffect(() => {
    if (!debugState || typeof debugState.regs !== 'function') return;
    const poll = () => {
      const r = debugState.regs();
      setRegs(r);
      if (typeof debugState.disasm === 'function' && r) {
        const d = debugState.disasm(r.pc);
        setDisasmText(d?.text || '');
        // Read opcode byte for path highlighting
        if (typeof debugState.readMem === 'function') {
          const mem = debugState.readMem('code', r.pc, 1);
          setOpcode(mem?.[0] ?? null);
        } else if (d?.bytes?.length > 0) {
          setOpcode(d.bytes[0]);
        }
      }
      rafRef.current = requestAnimationFrame(poll);
    };
    rafRef.current = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(rafRef.current);
  }, [debugState]);

  if (!regs) return null;

  const path = opcode != null ? OPCODE_PATHS[opcode] : null;
  const pathColor = path ? PATH_COLORS[path.class] || '#666' : '#333';
  const lit = (name) => path && (path.src === name || path.dest === name);
  const busLit = (bus) => path && path.bus === bus;

  const regBox = (label, value, name, x, y, w = 50, h = 28) => (
    <g key={name}>
      <rect x={x} y={y} width={w} height={h} rx={3}
        fill={lit(name) ? pathColor + '33' : '#1e293b'}
        stroke={lit(name) ? pathColor : '#475569'} strokeWidth={lit(name) ? 2 : 1} />
      <text x={x + 4} y={y + 10} fill="#94a3b8" fontSize={8} fontFamily="monospace">{label}</text>
      <text x={x + w / 2} y={y + h - 5} textAnchor="middle" fill={lit(name) ? pathColor : '#e2e8f0'}
        fontSize={12} fontFamily="monospace" fontWeight="bold">{value}</text>
    </g>
  );

  const p = regs.p ?? 0;

  return (
    <div data-architecture-face style={{
      background: '#0f172a', borderRadius: 6, padding: 8,
      width: '100%', boxSizing: 'border-box',
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#e2e8f0', marginBottom: 4, fontFamily: 'monospace' }}>
        {t('archFace6502', lang)}
      </div>
      <svg viewBox="0 0 280 180" style={{ width: '100%', height: 'auto', display: 'block' }}>
        {/* Address bus */}
        <rect x={10} y={5} width={260} height={12} rx={2}
          fill={busLit('addr') ? '#ef444433' : '#1a1a2e'} stroke={busLit('addr') ? '#ef4444' : '#334155'} strokeWidth={1} />
        <text x={140} y={14} textAnchor="middle" fill={busLit('addr') ? '#ef4444' : '#64748b'}
          fontSize={7} fontFamily="monospace">ADDR ${hex(regs.pc, 4)}</text>

        {/* Data bus */}
        <rect x={10} y={163} width={260} height={12} rx={2}
          fill={busLit('data') ? '#3b82f633' : '#1a1a2e'} stroke={busLit('data') ? '#3b82f6' : '#334155'} strokeWidth={1} />
        <text x={140} y={172} textAnchor="middle" fill={busLit('data') ? '#3b82f6' : '#64748b'}
          fontSize={7} fontFamily="monospace">DATA</text>

        {/* PC */}
        {regBox('PC', '$' + hex(regs.pc, 4), 'pc', 10, 25, 60, 28)}

        {/* IR (current opcode) */}
        <rect x={80} y={25} width={50} height={28} rx={3}
          fill={path ? pathColor + '22' : '#1e293b'} stroke={path ? pathColor : '#475569'} strokeWidth={1} />
        <text x={84} y={35} fill="#94a3b8" fontSize={8} fontFamily="monospace">IR</text>
        <text x={105} y={47} textAnchor="middle" fill={path ? pathColor : '#e2e8f0'}
          fontSize={11} fontFamily="monospace" fontWeight="bold">{opcode != null ? hex(opcode) : '--'}</text>

        {/* A register */}
        {regBox('A', '$' + hex(regs.a), 'a', 10, 65, 50, 28)}
        {/* X register */}
        {regBox('X', '$' + hex(regs.x), 'x', 70, 65, 50, 28)}
        {/* Y register */}
        {regBox('Y', '$' + hex(regs.y), 'y', 130, 65, 50, 28)}

        {/* SP */}
        {regBox('SP', '$01' + hex(regs.sp), 'sp', 190, 65, 60, 28)}

        {/* P flags */}
        <rect x={10} y={105} width={170} height={28} rx={3}
          fill={path?.flags ? pathColor + '22' : '#1e293b'}
          stroke={path?.flags ? pathColor : '#475569'} strokeWidth={path?.flags ? 2 : 1} />
        <text x={14} y={115} fill="#94a3b8" fontSize={8} fontFamily="monospace">P</text>
        {FLAG_NAMES.map((f, i) => {
          const bit = (p >> (7 - i)) & 1;
          return (
            <g key={f}>
              <text x={30 + i * 19} y={115} fill="#64748b" fontSize={7} fontFamily="monospace">{f}</text>
              <text x={30 + i * 19} y={127} fill={bit ? '#22c55e' : '#475569'}
                fontSize={11} fontFamily="monospace" fontWeight="bold">{bit}</text>
            </g>
          );
        })}

        {/* Disassembly */}
        <rect x={10} y={140} width={260} height={16} rx={2}
          fill="#0f172a" stroke="#334155" strokeWidth={0.5} />
        <text x={15} y={152} fill={path ? pathColor : '#94a3b8'} fontSize={9} fontFamily="monospace">
          ${hex(regs.pc, 4)}: {disasmText}
        </text>

        {/* Cycle counter */}
        <text x={270} y={98} textAnchor="end" fill="#475569" fontSize={7} fontFamily="monospace">
          {regs.cycles != null ? `${regs.cycles} cyc` : ''}
        </text>
      </svg>
    </div>
  );
}

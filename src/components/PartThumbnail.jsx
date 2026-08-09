/**
 * PartThumbnail — small SVG illustrations for each part kind.
 *
 * Used in the palette cards to give a visual preview.
 * These are presentation-only: no event handlers, no interactivity.
 */

import React from 'react';

const S = 48; // internal coordinate space

export function PartThumbnail({ kind, color, params, displaySize }) {
  const w = displaySize || S;
  const h = displaySize || S;
  const cx = S / 2, cy = S / 2;

  switch (kind) {
    case 'vcc':
      return (
        <svg width={w} height={h} viewBox={`0 0 ${S} ${S}`}>
          <line x1={cx} y1={cy + 12} x2={cx} y2={cy} stroke="#e74c3c" strokeWidth={2} />
          <line x1={cx - 10} y1={cy} x2={cx + 10} y2={cy} stroke="#e74c3c" strokeWidth={2} />
          <text x={cx} y={cy - 4} textAnchor="middle" fill="#e74c3c" fontSize={8} fontFamily="monospace" fontWeight="bold">VCC</text>
        </svg>
      );
    case 'gnd':
      return (
        <svg width={w} height={h} viewBox={`0 0 ${S} ${S}`}>
          <line x1={cx} y1={cy - 8} x2={cx} y2={cy} stroke="#3498db" strokeWidth={2} />
          <line x1={cx - 10} y1={cy} x2={cx + 10} y2={cy} stroke="#3498db" strokeWidth={2} />
          <line x1={cx - 7} y1={cy + 4} x2={cx + 7} y2={cy + 4} stroke="#3498db" strokeWidth={2} />
          <line x1={cx - 4} y1={cy + 8} x2={cx + 4} y2={cy + 8} stroke="#3498db" strokeWidth={2} />
        </svg>
      );
    case 'resistor':
      return (
        <svg width={w} height={h} viewBox={`0 0 ${S} ${S}`}>
          <line x1={4} y1={cy} x2={12} y2={cy} stroke="#999" strokeWidth={1.5} />
          <rect x={12} y={cy - 5} width={24} height={10} rx={2} fill="#e0c890" stroke="#b8a060" strokeWidth={1} />
          {/* Color bands */}
          <rect x={16} y={cy - 5} width={2} height={10} fill="#8B4513" />
          <rect x={20} y={cy - 5} width={2} height={10} fill="#111" />
          <rect x={24} y={cy - 5} width={2} height={10} fill="#e74c3c" />
          <rect x={30} y={cy - 5} width={2} height={10} fill="#C0A000" />
          <line x1={36} y1={cy} x2={44} y2={cy} stroke="#999" strokeWidth={1.5} />
        </svg>
      );
    case 'led': {
      const ledColor = params?.color || color || 'red';
      const fill = ledColor === 'white' ? '#eee' : ledColor;
      return (
        <svg width={w} height={h} viewBox={`0 0 ${S} ${S}`}>
          <line x1={4} y1={cy} x2={14} y2={cy} stroke="#999" strokeWidth={1.5} />
          {/* LED body — triangle + flat */}
          <polygon points={`${14},${cy - 8} ${14},${cy + 8} ${30},${cy}`} fill={fill} opacity={0.8} stroke={fill} strokeWidth={1} />
          <line x1={30} y1={cy - 8} x2={30} y2={cy + 8} stroke={fill} strokeWidth={1.5} />
          {/* Light rays */}
          <line x1={32} y1={cy - 6} x2={36} y2={cy - 10} stroke={fill} strokeWidth={0.8} opacity={0.6} />
          <line x1={33} y1={cy - 2} x2={38} y2={cy - 4} stroke={fill} strokeWidth={0.8} opacity={0.6} />
          <line x1={30} y1={cy} x2={44} y2={cy} stroke="#999" strokeWidth={1.5} />
        </svg>
      );
    }
    case 'capacitor':
      return (
        <svg width={w} height={h} viewBox={`0 0 ${S} ${S}`}>
          <line x1={4} y1={cy} x2={20} y2={cy} stroke="#999" strokeWidth={1.5} />
          <line x1={20} y1={cy - 8} x2={20} y2={cy + 8} stroke="#34495e" strokeWidth={2.5} />
          <path d={`M 26 ${cy - 8} Q 24 ${cy} 26 ${cy + 8}`} fill="none" stroke="#34495e" strokeWidth={2.5} />
          <line x1={28} y1={cy} x2={44} y2={cy} stroke="#999" strokeWidth={1.5} />
        </svg>
      );
    case 'potentiometer':
      return (
        <svg width={w} height={h} viewBox={`0 0 ${S} ${S}`}>
          <rect x={10} y={cy - 8} width={28} height={16} rx={3} fill="#2c3e50" stroke="#9b59b6" strokeWidth={1} />
          {/* Shaft */}
          <circle cx={cx} cy={cy} r={5} fill="#555" stroke="#9b59b6" strokeWidth={1} />
          <line x1={cx} y1={cy} x2={cx + 4} y2={cy - 3} stroke="#bbb" strokeWidth={1.5} />
          {/* Terminals */}
          <line x1={4} y1={cy + 6} x2={10} y2={cy + 6} stroke="#999" strokeWidth={1} />
          <line x1={cx} y1={cy - 8} x2={cx} y2={cy - 14} stroke="#999" strokeWidth={1} />
          <line x1={38} y1={cy + 6} x2={44} y2={cy + 6} stroke="#999" strokeWidth={1} />
        </svg>
      );
    case 'button':
      return (
        <svg width={w} height={h} viewBox={`0 0 ${S} ${S}`}>
          <rect x={12} y={cy - 8} width={24} height={16} rx={3} fill="#2c3e50" stroke="#f39c12" strokeWidth={1} />
          <circle cx={cx} cy={cy} r={4} fill="#f39c12" />
          <line x1={4} y1={cy} x2={12} y2={cy} stroke="#999" strokeWidth={1.5} />
          <line x1={36} y1={cy} x2={44} y2={cy} stroke="#999" strokeWidth={1.5} />
        </svg>
      );
    case 'buzzer':
      return (
        <svg width={w} height={h} viewBox={`0 0 ${S} ${S}`}>
          <circle cx={cx} cy={cy} r={10} fill="#1a1a2e" stroke="#1abc9c" strokeWidth={1.5} />
          <circle cx={cx} cy={cy} r={3} fill="#1abc9c" />
          <line x1={4} y1={cy} x2={14} y2={cy} stroke="#999" strokeWidth={1.5} />
          <line x1={34} y1={cy} x2={44} y2={cy} stroke="#999" strokeWidth={1.5} />
          {/* Sound waves */}
          <path d={`M 36 ${cy - 5} Q 40 ${cy} 36 ${cy + 5}`} fill="none" stroke="#1abc9c" strokeWidth={0.8} opacity={0.5} />
          <path d={`M 39 ${cy - 7} Q 44 ${cy} 39 ${cy + 7}`} fill="none" stroke="#1abc9c" strokeWidth={0.8} opacity={0.3} />
        </svg>
      );
    case 'mcu':
      return (
        <svg width={w} height={h} viewBox={`0 0 ${S} ${S}`}>
          <rect x={8} y={6} width={32} height={36} rx={3} fill="#2c3e50" stroke="#7f8c8d" strokeWidth={1} />
          <text x={cx} y={cy} textAnchor="middle" fill="#ecf0f1" fontSize={6} fontFamily="monospace">STC12</text>
          {/* Pins */}
          {[0, 1, 2, 3].map(i => (
            <React.Fragment key={i}>
              <rect x={4} y={10 + i * 8} width={4} height={3} fill="#f39c12" />
              <rect x={40} y={10 + i * 8} width={4} height={3} fill="#f39c12" />
            </React.Fragment>
          ))}
        </svg>
      );
    case 'seven_segment':
      return (
        <svg width={w} height={h} viewBox={`0 0 ${S} ${S}`}>
          <rect x={10} y={4} width={28} height={40} rx={3} fill="#111" stroke="#333" strokeWidth={1} />
          {/* 7-segment digit "8" */}
          <line x1={16} y1={8} x2={30} y2={8} stroke="#e74c3c" strokeWidth={2} />
          <line x1={16} y1={23} x2={30} y2={23} stroke="#e74c3c" strokeWidth={2} />
          <line x1={16} y1={38} x2={30} y2={38} stroke="#e74c3c" strokeWidth={2} />
          <line x1={14} y1={10} x2={14} y2={21} stroke="#e74c3c" strokeWidth={2} />
          <line x1={14} y1={25} x2={14} y2={36} stroke="#e74c3c" strokeWidth={2} />
          <line x1={32} y1={10} x2={32} y2={21} stroke="#e74c3c" strokeWidth={2} />
          <line x1={32} y1={25} x2={32} y2={36} stroke="#e74c3c" strokeWidth={2} />
        </svg>
      );
    case 'char_lcd':
      return (
        <svg width={w} height={h} viewBox={`0 0 ${S} ${S}`}>
          <rect x={2} y={10} width={44} height={28} rx={3} fill="#1a4030" stroke="#2980b9" strokeWidth={1} />
          <rect x={6} y={14} width={36} height={20} rx={2} fill="#2a6040" />
          <text x={cx} y={cy + 2} textAnchor="middle" fill="#3c8" fontSize={7} fontFamily="monospace">Hello</text>
        </svg>
      );
    case 'led_matrix':
      return (
        <svg width={w} height={h} viewBox={`0 0 ${S} ${S}`}>
          <rect x={8} y={8} width={32} height={32} rx={2} fill="#111" stroke="#27ae60" strokeWidth={1} />
          {/* 4x4 dot grid */}
          {[0, 1, 2, 3].map(r => [0, 1, 2, 3].map(c => (
            <circle key={`${r}${c}`} cx={14 + c * 8} cy={14 + r * 8} r={2}
              fill={(r + c) % 2 === 0 ? '#2ecc71' : '#1a3a20'} />
          )))}
        </svg>
      );
    case 'led_cube':
      return (
        <svg width={w} height={h} viewBox={`0 0 ${S} ${S}`}>
          {/* Simple 3D cube */}
          <polygon points="12,16 24,10 36,16 24,22" fill="none" stroke="#2ecc71" strokeWidth={1} />
          <polygon points="12,16 12,32 24,38 24,22" fill="none" stroke="#2ecc71" strokeWidth={1} />
          <polygon points="24,22 24,38 36,32 36,16" fill="none" stroke="#2ecc71" strokeWidth={1} />
          {/* Glow dots */}
          <circle cx={18} cy={18} r={1.5} fill="#2ecc71" opacity={0.6} />
          <circle cx={30} cy={18} r={1.5} fill="#2ecc71" opacity={0.4} />
          <circle cx={24} cy={30} r={1.5} fill="#2ecc71" opacity={0.8} />
        </svg>
      );
    case 'shift_register':
      return (
        <svg width={w} height={h} viewBox={`0 0 ${S} ${S}`}>
          <rect x={8} y={10} width={32} height={28} rx={2} fill="#2c3e50" stroke="#8e44ad" strokeWidth={1} />
          <text x={cx} y={cy - 1} textAnchor="middle" fill="#ddd" fontSize={5} fontFamily="monospace">74HC</text>
          <text x={cx} y={cy + 6} textAnchor="middle" fill="#ddd" fontSize={5} fontFamily="monospace">595</text>
          <circle cx={12} cy={14} r={2} fill="#444" />
          {[0, 1, 2].map(i => <rect key={i} x={4} y={18 + i * 7} width={4} height={3} fill="#8e44ad" />)}
          {[0, 1, 2].map(i => <rect key={i} x={40} y={18 + i * 7} width={4} height={3} fill="#8e44ad" />)}
        </svg>
      );
    case 'ir_receiver':
      return (
        <svg width={w} height={h} viewBox={`0 0 ${S} ${S}`}>
          <path d={`M ${cx - 8} ${cy + 8} L ${cx - 8} ${cy - 4} A 8 8 0 0 1 ${cx + 8} ${cy - 4} L ${cx + 8} ${cy + 8} Z`}
            fill="#1a1a2e" stroke="#c0392b" strokeWidth={1.5} />
          <circle cx={cx} cy={cy - 2} r={3} fill="#c0392b" opacity={0.6} />
          {[0, 1, 2].map(i => <line key={i} x1={cx - 6 + i * 6} y1={cy + 8} x2={cx - 6 + i * 6} y2={cy + 14} stroke="#999" strokeWidth={1} />)}
        </svg>
      );
    case 'temp_sensor':
      return (
        <svg width={w} height={h} viewBox={`0 0 ${S} ${S}`}>
          <path d={`M ${cx - 5} ${cy + 8} L ${cx - 5} ${cy - 8} A 5 5 0 0 1 ${cx + 5} ${cy - 8} L ${cx + 5} ${cy + 8} Z`}
            fill="#1a1a2e" stroke="#16a085" strokeWidth={1.5} />
          <text x={cx} y={cy + 2} textAnchor="middle" fill="#16a085" fontSize={6} fontFamily="monospace">T</text>
          {[0, 1, 2].map(i => <line key={i} x1={cx - 4 + i * 4} y1={cy + 8} x2={cx - 4 + i * 4} y2={cy + 14} stroke="#999" strokeWidth={1} />)}
        </svg>
      );
    case 'eeprom':
      return (
        <svg width={w} height={h} viewBox={`0 0 ${S} ${S}`}>
          <rect x={12} y={10} width={24} height={28} rx={2} fill="#2c3e50" stroke="#7f8c8d" strokeWidth={1} />
          <text x={cx} y={cy + 2} textAnchor="middle" fill="#bbb" fontSize={5} fontFamily="monospace">ROM</text>
          <circle cx={16} cy={14} r={1.5} fill="#444" />
          {[0, 1, 2, 3].map(i => <rect key={i} x={8} y={16 + i * 5} width={4} height={2} fill="#7f8c8d" />)}
          {[0, 1, 2, 3].map(i => <rect key={i} x={36} y={16 + i * 5} width={4} height={2} fill="#7f8c8d" />)}
        </svg>
      );
    case 'meter':
      return (
        <svg width={w} height={h} viewBox={`0 0 ${S} ${S}`}>
          <rect x={6} y={6} width={36} height={36} rx={4} fill="#1a1a2e" stroke="#f1c40f" strokeWidth={1.5} />
          <text x={cx} y={cy - 4} textAnchor="middle" fill="#f1c40f" fontSize={12} fontFamily="monospace" fontWeight="bold">V</text>
          <text x={cx} y={cy + 8} textAnchor="middle" fill="#ecf0f1" fontSize={7} fontFamily="monospace">5.00</text>
          {/* Probes */}
          <line x1={14} y1={42} x2={14} y2={46} stroke="#e74c3c" strokeWidth={2} />
          <line x1={34} y1={42} x2={34} y2={46} stroke="#1a1a1a" strokeWidth={2} />
        </svg>
      );
    case 'diode':
      return (
        <svg width={w} height={h} viewBox={`0 0 ${S} ${S}`}>
          <line x1={4} y1={cy} x2={14} y2={cy} stroke="#999" strokeWidth={1.5} />
          <polygon points={`${14},${cy - 6} ${14},${cy + 6} ${28},${cy}`} fill="none" stroke="#95a5a6" strokeWidth={1.5} />
          <line x1={28} y1={cy - 6} x2={28} y2={cy + 6} stroke="#95a5a6" strokeWidth={1.5} />
          <line x1={28} y1={cy} x2={44} y2={cy} stroke="#999" strokeWidth={1.5} />
        </svg>
      );
    case 'switch':
      return (
        <svg width={w} height={h} viewBox={`0 0 ${S} ${S}`}>
          <line x1={4} y1={cy} x2={16} y2={cy} stroke="#999" strokeWidth={1.5} />
          <circle cx={16} cy={cy} r={2} fill="#bdc3c7" />
          <line x1={16} y1={cy} x2={32} y2={cy - 8} stroke="#bdc3c7" strokeWidth={1.5} />
          <circle cx={32} cy={cy} r={2} fill="#bdc3c7" />
          <line x1={32} y1={cy} x2={44} y2={cy} stroke="#999" strokeWidth={1.5} />
        </svg>
      );
    default:
      return (
        <svg width={w} height={h} viewBox={`0 0 ${S} ${S}`}>
          <rect x={8} y={8} width={32} height={32} rx={4} fill="none" stroke={color || '#555'} strokeWidth={1} strokeDasharray="4 2" />
          <text x={cx} y={cy + 3} textAnchor="middle" fill={color || '#777'} fontSize={8} fontFamily="monospace">{kind}</text>
        </svg>
      );
  }
}

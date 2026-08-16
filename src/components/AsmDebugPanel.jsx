/**
 * AsmDebugPanel — glass-box assembler debug view.
 *
 * Visualises the three internal stages of a two-pass assembler:
 *
 *  1. **Token stream** — every lexeme the scanner produced, colour-coded
 *     by type.  Hovering a token highlights the corresponding source line
 *     (via onHighlightLine callback to the asm editor).
 *
 *  2. **Symbol table** — pass-1 (forward refs may be unresolved) beside
 *     pass-2 (all values resolved).  Unresolved→resolved transitions are
 *     highlighted so the student sees what the second pass accomplished.
 *
 *  3. **Listing** — final assembled output with addresses, machine code
 *     bytes, and the original source, like a traditional assembler .lst.
 *
 * Concept reference: mggates39/EightBitCPUSim (GPL — re-implemented from
 * scratch, nothing copied).  Data shape comes from stc-compiler /assemble:
 *
 *   { tokens: [{type, text, line, col}],
 *     passes: [{symbols: {name: {value, resolved}}}],
 *     listing: [{addr, bytes, source, line}] }
 *
 * @module
 */

import React, { useState, useCallback } from 'react';

// ── Token type colours ───────────────────────────────────────────
const TOKEN_COLORS = {
  instruction: '#e06c75', // mnemonic / opcode
  register:    '#61afef', // register name
  identifier:  '#abb2bf', // unclassified identifier (instruction/register/symbol)
  number:      '#d19a66', // numeric literal
  label:       '#98c379', // label definition / reference
  directive:   '#c678dd', // assembler directive (.org, .db)
  string:      '#98c379', // string literal
  operator:    '#abb2bf', // + - , : ( )
  comment:     '#5c6370', // ; comment
  newline:     'transparent',
  whitespace:  'transparent',
};

const TAB_STYLE = (active) => ({
  padding: '4px 10px', fontSize: '10px', fontFamily: 'monospace',
  fontWeight: active ? 700 : 400, cursor: 'pointer',
  background: active ? '#2a3a5e' : 'transparent',
  color: active ? '#61afef' : '#7f8c8d',
  border: 'none', borderBottom: active ? '2px solid #61afef' : '2px solid transparent',
  borderRadius: '4px 4px 0 0',
});

// ── Token Stream tab ─────────────────────────────────────────────

function TokenStream({ tokens, onHighlightLine }) {
  const [hovered, setHovered] = useState(null);

  if (!tokens || tokens.length === 0) {
    return <div style={{ color: '#5c6370', padding: 8 }}>No tokens</div>;
  }

  // Group tokens by source line for visual scanning
  const lines = [];
  let cur = [];
  let curLine = tokens[0].line;
  for (const tok of tokens) {
    if (tok.type === 'newline') {
      lines.push({ line: curLine, tokens: cur });
      cur = [];
      curLine = tok.line + 1;
      continue;
    }
    if (tok.type === 'whitespace') continue;
    cur.push(tok);
  }
  if (cur.length) lines.push({ line: curLine, tokens: cur });

  return (
    <div style={{ overflowY: 'auto', maxHeight: '100%' }}>
      {lines.map((group, gi) => (
        <div key={gi}
          onMouseEnter={() => { setHovered(group.line); if (onHighlightLine) onHighlightLine(group.line); }}
          onMouseLeave={() => { setHovered(null); if (onHighlightLine) onHighlightLine(null); }}
          style={{
            display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'baseline',
            padding: '1px 4px',
            background: hovered === group.line ? '#1e2d4a' : 'transparent',
            borderLeft: hovered === group.line ? '2px solid #61afef' : '2px solid transparent',
            transition: 'background 60ms',
          }}>
          <span style={{ color: '#3e4452', fontSize: '8px', width: 20, textAlign: 'right',
            flexShrink: 0, marginRight: 4 }}>{group.line}</span>
          {group.tokens.map((tok, ti) => (
            <span key={ti} title={`${tok.type} [${tok.line}:${tok.col}]`}
              style={{
                color: TOKEN_COLORS[tok.type] || '#abb2bf',
                background: TOKEN_COLORS[tok.type] === 'transparent' ? 'none' : `${TOKEN_COLORS[tok.type] || '#abb2bf'}11`,
                padding: '0 2px', borderRadius: 2,
                fontSize: '10px', fontFamily: 'monospace',
              }}>{tok.text}</span>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Symbol Table tab ─────────────────────────────────────────────

function SymbolTable({ passes }) {
  if (!passes || passes.length === 0) {
    return <div style={{ color: '#5c6370', padding: 8 }}>No symbol data</div>;
  }

  const pass1 = passes[0]?.symbols || {};
  const pass2 = (passes[1] || passes[0])?.symbols || {};
  const allNames = [...new Set([...Object.keys(pass1), ...Object.keys(pass2)])].sort();

  if (allNames.length === 0) {
    return <div style={{ color: '#5c6370', padding: 8 }}>No symbols defined</div>;
  }

  const fmtVal = (v) => v == null ? '—' : typeof v === 'number' ? `$${v.toString(16).toUpperCase().padStart(4, '0')}` : String(v);

  return (
    <div style={{ overflowY: 'auto', maxHeight: '100%' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px', fontFamily: 'monospace' }}>
        <thead>
          <tr style={{ color: '#7f8c8d', borderBottom: '1px solid #2c3e50' }}>
            <th style={{ textAlign: 'left', padding: '3px 6px', fontWeight: 600 }}>Symbol</th>
            <th style={{ textAlign: 'right', padding: '3px 6px', fontWeight: 600 }}>Pass 1</th>
            <th style={{ textAlign: 'center', padding: '3px 2px', fontWeight: 400 }}></th>
            <th style={{ textAlign: 'right', padding: '3px 6px', fontWeight: 600 }}>Pass 2</th>
          </tr>
        </thead>
        <tbody>
          {allNames.map(name => {
            const p1 = pass1[name];
            const p2 = pass2[name];
            const wasUnresolved = p1 && !p1.resolved;
            const nowResolved = p2 && p2.resolved;
            const changed = wasUnresolved && nowResolved;
            return (
              <tr key={name} style={{
                borderBottom: '1px solid #1a1a2e',
                background: changed ? '#1a2e1a' : 'transparent',
              }}>
                <td style={{ padding: '2px 6px', color: '#98c379' }}>{name}</td>
                <td style={{
                  padding: '2px 6px', textAlign: 'right',
                  color: p1?.resolved ? '#d19a66' : '#e06c75',
                  fontStyle: p1?.resolved ? 'normal' : 'italic',
                }}>{p1 ? fmtVal(p1.value) : '—'}{p1 && !p1.resolved ? ' ?' : ''}</td>
                <td style={{ padding: '2px 2px', textAlign: 'center',
                  color: changed ? '#2ecc71' : '#3e4452' }}>{changed ? '→' : '·'}</td>
                <td style={{
                  padding: '2px 6px', textAlign: 'right',
                  color: p2?.resolved ? '#d19a66' : '#e06c75',
                  fontWeight: changed ? 700 : 400,
                }}>{p2 ? fmtVal(p2.value) : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Listing tab ──────────────────────────────────────────────────
// The live backend sends listing as a raw string (sdas/ca65 .lst output).
// We render it as a coloured pre-formatted block: the address column in
// gray, hex bytes in orange, source in white — same colours as the parsed
// format but without needing a structured parse on every toolchain.

function Listing({ listing, onHighlightLine }) {
  const [hovered, setHovered] = useState(null);

  if (!listing || (typeof listing === 'string' && !listing.trim()) ||
      (Array.isArray(listing) && listing.length === 0)) {
    return <div style={{ color: '#5c6370', padding: 8 }}>No listing</div>;
  }

  // Raw string format from the live backend
  if (typeof listing === 'string') {
    const lines = listing.split('\n').filter(l => l.trim());
    return (
      <div style={{ overflowY: 'auto', maxHeight: '100%' }}>
        {lines.map((line, i) => (
          <div key={i}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            style={{
              fontFamily: 'monospace', fontSize: '9px',
              padding: '0 4px', lineHeight: 1.6, whiteSpace: 'pre',
              background: hovered === i ? '#1e2d4a' : 'transparent',
              borderLeft: hovered === i ? '2px solid #61afef' : '2px solid transparent',
              color: '#abb2bf',
            }}>{line}</div>
        ))}
      </div>
    );
  }

  // Parsed array format (future structured backend or client-side parse)
  return (
    <div style={{ overflowY: 'auto', maxHeight: '100%' }}>
      {listing.map((entry, i) => (
        <div key={i}
          onMouseEnter={() => { setHovered(i); if (entry.line != null && onHighlightLine) onHighlightLine(entry.line); }}
          onMouseLeave={() => { setHovered(null); if (onHighlightLine) onHighlightLine(null); }}
          style={{
            display: 'flex', gap: 0, fontFamily: 'monospace', fontSize: '10px',
            padding: '1px 4px', lineHeight: 1.5,
            background: hovered === i ? '#1e2d4a' : 'transparent',
            borderLeft: hovered === i ? '2px solid #61afef' : '2px solid transparent',
          }}>
          {/* Address */}
          <span style={{ color: '#7f8c8d', width: 44, textAlign: 'right', flexShrink: 0 }}>
            {entry.addr != null ? `${entry.addr.toString(16).toUpperCase().padStart(4, '0')}` : '    '}
          </span>
          {/* Machine code bytes */}
          <span style={{ color: '#d19a66', width: 80, marginLeft: 6, flexShrink: 0, letterSpacing: '0.5px' }}>
            {entry.bytes ? entry.bytes.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ') : ''}
          </span>
          {/* Source line */}
          <span style={{ color: '#abb2bf', marginLeft: 6, flex: 1 }}>
            {entry.source || ''}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Main panel ───────────────────────────────────────────────────

/**
 * @param {{
 *   asmDebug: { tokens, passes, listing } | null,
 *   onHighlightLine?: (line: number | null) => void,
 *   lang?: string,
 * }} props
 */
export function AsmDebugPanel({ asmDebug, onHighlightLine, lang = 'en' }) {
  const [tab, setTab] = useState('tokens');

  if (!asmDebug) return null;
  const { tokens, passes, listing } = asmDebug;

  const tokenCount = tokens?.filter(t => t.type !== 'newline' && t.type !== 'whitespace').length || 0;
  const symbolCount = passes?.[passes.length - 1]
    ? Object.keys(passes[passes.length - 1].symbols || {}).length : 0;
  const listingLines = typeof listing === 'string'
    ? listing.split('\n').filter(l => l.trim()).length
    : (listing?.length || 0);

  return (
    <div style={{
      background: '#1a1a2e', border: '1px solid #2c3e50', borderRadius: '6px',
      fontFamily: 'monospace', fontSize: '10px',
      display: 'flex', flexDirection: 'column',
      height: '100%', minHeight: 0, overflow: 'hidden',
    }} data-testid="asm-debug-panel">
      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid #2c3e50', flexShrink: 0 }}>
        <button type="button" style={TAB_STYLE(tab === 'tokens')}
          onClick={() => setTab('tokens')}>
          Tokens {tokenCount > 0 && <span style={{ color: '#5c6370' }}>({tokenCount})</span>}
        </button>
        <button type="button" style={TAB_STYLE(tab === 'symbols')}
          onClick={() => setTab('symbols')}>
          Symbols {symbolCount > 0 && <span style={{ color: '#5c6370' }}>({symbolCount})</span>}
        </button>
        <button type="button" style={TAB_STYLE(tab === 'listing')}
          onClick={() => setTab('listing')}>
          Listing {listingLines > 0 && <span style={{ color: '#5c6370' }}>({listingLines})</span>}
        </button>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '4px 0' }}>
        {tab === 'tokens' && <TokenStream tokens={tokens} onHighlightLine={onHighlightLine} />}
        {tab === 'symbols' && <SymbolTable passes={passes} />}
        {tab === 'listing' && <Listing listing={listing} onHighlightLine={onHighlightLine} />}
      </div>
    </div>
  );
}

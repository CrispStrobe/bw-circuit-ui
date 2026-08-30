/**
 * TransferReport — what the import or export actually did, where the user is.
 *
 * Three defects share one cause and this component is the shared fix:
 *
 *   X0.5  the "Diagram (.json)" import entry forced a format id that is not
 *         a key in IMPORTERS, so the click did nothing — and the warning
 *         explaining that went into a return value nobody read.
 *   X0.6  the diagram importer substituted parts (an RTC for a different
 *         RTC, a DHT11's readings for a DHT22's) with no notice at all.
 *   X0.7  the via-netlist export's import instructions went to console.log,
 *         and the SPICE export's skipped-part list went there too.
 *
 * The cause: every transfer path could SAY something and none of them had
 * anywhere to say it. A silent degrade is worse than a refusal, so the
 * refusals and the degradations both land here, next to the button that
 * caused them, and stay until dismissed.
 *
 * It lives outside the ⋯ popover on purpose. The menu closes when an action
 * runs; a report drawn inside it would be unmounted in the same frame.
 *
 * @module
 */

import React from 'react';

const TONE = {
  error: { border: '#b91c1c', text: '#fca5a5', mark: '✕' },
  warn: { border: '#b45309', text: '#fcd34d', mark: '!' },
  info: { border: '#475569', text: '#cbd5e1', mark: 'i' },
};

/**
 * @typedef {object} Transfer
 * @property {'import'|'export'} kind
 * @property {string} title        — the file, or the format
 * @property {string} [summary]    — one line: what landed
 * @property {string} [error]      — a refusal, shown first and in red
 * @property {string[]} [skipped]  — things NOT written or NOT imported
 * @property {string[]} [warnings] — things done differently than asked
 * @property {string} [instructions] — what to do with the file now
 */

/**
 * @param {{report: Transfer|null, lang?: string, onClose: () => void}} props
 */
export default function TransferReport({ report, lang = 'en', onClose }) {
  if (!report) return null;
  const de = /^de/i.test(lang);
  const skipped = report.skipped || [];
  const warnings = report.warnings || [];
  const tone = report.error ? 'error' : (skipped.length || warnings.length) ? 'warn' : 'info';
  const t = TONE[tone];

  const line = (text, color, key) => (
    <li key={key} style={{ color, marginBottom: 3, lineHeight: 1.35, wordBreak: 'break-word' }}>
      {text}
    </li>
  );

  return (
    <div
      data-transfer-report
      data-transfer-kind={report.kind}
      data-transfer-tone={tone}
      role="status"
      style={{
        position: 'absolute', top: 46, right: 8, zIndex: 90,
        width: 330, maxWidth: 'calc(100% - 16px)', maxHeight: 300, overflowY: 'auto',
        background: '#0f172a', border: `1px solid ${t.border}`, borderRadius: 6,
        padding: '8px 10px', boxShadow: '0 6px 20px rgba(0,0,0,.45)',
        fontFamily: 'monospace', fontSize: 11, color: '#cbd5e1',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
        <strong style={{ color: t.text, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {t.mark} {report.title}
        </strong>
        <button
          type="button"
          data-transfer-report-close
          onClick={onClose}
          aria-label={de ? 'Schließen' : 'Close'}
          style={{ border: 0, background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontSize: 13 }}
        >✕</button>
      </div>

      {report.error && (
        <div style={{ color: '#fca5a5', marginTop: 5 }}>{report.error}</div>
      )}
      {report.summary && !report.error && (
        <div style={{ marginTop: 5 }}>{report.summary}</div>
      )}

      {skipped.length > 0 && (
        <>
          <div style={{ marginTop: 7, color: '#fcd34d' }}>
            {de ? `${skipped.length} nicht übernommen:` : `${skipped.length} not included:`}
          </div>
          <ul style={{ margin: '3px 0 0 14px', padding: 0 }}>
            {skipped.map((s, i) => line(s, '#fcd34d', i))}
          </ul>
        </>
      )}

      {warnings.length > 0 && (
        <>
          <div style={{ marginTop: 7, color: '#fdba74' }}>
            {de ? 'Hinweise:' : 'Notes:'}
          </div>
          <ul style={{ margin: '3px 0 0 14px', padding: 0 }}>
            {warnings.map((w, i) => line(w, '#fdba74', i))}
          </ul>
        </>
      )}

      {report.instructions && (
        <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px solid #334155', whiteSpace: 'pre-wrap', color: '#94a3b8' }}>
          {report.instructions}
        </div>
      )}
    </div>
  );
}

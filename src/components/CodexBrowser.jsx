/**
 * CodexBrowser — the Codex shell: a trail/chapter/station lens over the
 * same examples that ExamplesBrowser shows.
 *
 * Renders curriculum.json's trails → chapters → stations as a grimoire-
 * style navigation. Clicking a station opens the intro reader modal,
 * then "Open on the bench" loads the example.
 *
 * Steelpunk / Neuromancer-marginalia flair on the existing dark theme.
 * No new runtime dependencies.
 *
 * @module
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { DevicePicker } from './ExamplesBrowser.jsx';

// ── Shared intro helpers (same logic as ExamplesBrowser) ────────────

const INTRO_L10N = {
  en: { loading: 'Loading…', noIntro: 'No introduction available.',
        level: 'Level', age: 'Age', prereqs: 'Prerequisites', teaches: 'Teaches',
        openBench: 'Open on the bench' },
  de: { loading: 'Wird geladen…', noIntro: 'Keine Einführung verfügbar.',
        level: 'Stufe', age: 'Alter', prereqs: 'Voraussetzungen', teaches: 'Vermittelt',
        openBench: 'Auf die Werkbank' },
};

const LEVEL_LABELS = {
  en: { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' },
  de: { beginner: 'Anfänger', intermediate: 'Fortgeschritten', advanced: 'Fortgeschritten+' },
};

const LEVEL_COLORS = { beginner: '#22c55e', intermediate: '#f59e0b', advanced: '#f97316' };

function parseIntro(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (kv) {
      const val = kv[2].trim();
      meta[kv[1]] = val.startsWith('[') ? val.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean) : val;
    }
  }
  return { meta, body: m[2].trim() };
}

function renderInline(text) {
  const parts = [];
  let rest = text;
  let key = 0;
  while (rest.length) {
    const linkM = rest.match(/\[([^\]]+)\]\(([^)]+)\)/);
    const boldM = rest.match(/\*\*([^*]+)\*\*/);
    const codeM = rest.match(/`([^`]+)`/);
    const matches = [linkM, boldM, codeM].filter(Boolean);
    if (!matches.length) { parts.push(rest); break; }
    const earliest = matches.reduce((a, b) => (a.index < b.index ? a : b));
    if (earliest.index > 0) parts.push(rest.slice(0, earliest.index));
    if (earliest === linkM) {
      parts.push(<a key={key++} href={linkM[2]} style={{color: '#d4a574', textDecoration: 'underline'}}
        onClick={e => e.stopPropagation()}>{linkM[1]}</a>);
    } else if (earliest === boldM) {
      parts.push(<strong key={key++}>{boldM[1]}</strong>);
    } else {
      parts.push(<code key={key++} style={{background: 'rgba(212,165,116,0.12)', padding: '1px 3px', borderRadius: 2, fontSize: 11}}>{codeM[1]}</code>);
    }
    rest = rest.slice(earliest.index + earliest[0].length);
  }
  return parts;
}

function renderMarkdown(md, palette) {
  const lines = md.split('\n');
  const elements = [];
  let listItems = [];
  const flushList = () => {
    if (listItems.length) {
      elements.push(<ul key={`ul-${elements.length}`} style={{margin: '4px 0 8px', paddingLeft: 18, color: palette.text, fontSize: 12}}>{listItems}</ul>);
      listItems = [];
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^## /.test(line)) {
      flushList();
      elements.push(<div key={`h-${i}`} style={{fontWeight: 700, fontSize: 13, color: palette.heading, marginTop: i > 0 ? 10 : 0, marginBottom: 3}}>{line.slice(3)}</div>);
    } else if (/^- /.test(line)) {
      listItems.push(<li key={`li-${i}`} style={{marginBottom: 2}}>{renderInline(line.slice(2))}</li>);
    } else if (/^\d+\. /.test(line)) {
      listItems.push(<li key={`li-${i}`} style={{marginBottom: 2}}>{renderInline(line.replace(/^\d+\.\s*/, ''))}</li>);
    } else if (line.trim()) {
      flushList();
      elements.push(<p key={`p-${i}`} style={{margin: '2px 0 6px', color: palette.text, fontSize: 12, lineHeight: 1.5}}>{renderInline(line)}</p>);
    }
  }
  flushList();
  return elements;
}

// ── Progress persistence ────────────────────────────────────────────

const PROGRESS_KEY = 'bw-codex-progress';

function readProgress() {
  try { return JSON.parse(localStorage.getItem(PROGRESS_KEY)) || {}; } catch { return {}; }
}

function markSeen(stationKey) {
  const p = readProgress();
  if (!p[stationKey]) {
    p[stationKey] = Date.now();
    try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(p)); } catch { /* full */ }
  }
  return p;
}

function stationKey(trailId, chapterIdx, stationIdx) {
  return `${trailId}/${chapterIdx}/${stationIdx}`;
}

// ── Codex palette — steelpunk grimoire on dark ──────────────────────

function codexPalette(dark) {
  return dark ? {
    panel: '#0f0e0c',
    panelBorder: '#2a2520',
    heading: '#d4a574',        // warm brass
    text: '#c4b59a',           // aged parchment
    muted: '#7a6f60',          // faded ink
    accent: '#d4a574',
    accentDim: 'rgba(212,165,116,0.15)',
    chapterBg: '#161412',
    chapterBorder: '#2a2520',
    stationBg: '#1a1816',
    stationHover: '#201d19',
    stationBorder: '#2a2520',
    interludeBg: 'rgba(212,165,116,0.05)',
    interludeBorder: '#2a2520',
    disabledText: '#4a4540',
    tick: '#8b7355',           // subtle seen-marker
    button: '#2a2520',
    buttonText: '#d4a574',
    trailBg: '#131210',
    trailBorder: '#2a2520',
    trailHover: '#1a1816',
    modalBg: '#0f0e0c',
    modalBorder: '#2a2520',
    modalShadow: '0 24px 64px rgba(0,0,0,0.65)',
  } : {
    panel: '#faf8f5',
    panelBorder: '#d8cfc0',
    heading: '#6b4c2a',
    text: '#4a3f30',
    muted: '#8a7e6e',
    accent: '#8b6f47',
    accentDim: 'rgba(139,111,71,0.1)',
    chapterBg: '#f5f0e8',
    chapterBorder: '#d8cfc0',
    stationBg: '#ffffff',
    stationHover: '#f0ebe0',
    stationBorder: '#d8cfc0',
    interludeBg: 'rgba(139,111,71,0.06)',
    interludeBorder: '#d8cfc0',
    disabledText: '#b8b0a0',
    tick: '#8b7355',
    button: '#e8dfd0',
    buttonText: '#6b4c2a',
    trailBg: '#ffffff',
    trailBorder: '#d8cfc0',
    trailHover: '#f5f0e8',
    modalBg: '#faf8f5',
    modalBorder: '#d8cfc0',
    modalShadow: '0 24px 64px rgba(0,0,0,0.18)',
  };
}

// ── Component ───────────────────────────────────────────────────────

/**
 * @param {{
 *   curriculum: { version: number, trails: Array },
 *   examples: Array,
 *   lang?: string,
 *   onLoadExample?: function,
 *   theme?: string,
 *   currentDevice?: string,
 * }} props
 */
export function CodexBrowser({ curriculum, examples, lang = 'en', onLoadExample, theme: themeProp, currentDevice }) {
  const [storedTheme, setStoredTheme] = useState(() => {
    try { return localStorage.getItem('bw-circuit-theme') || 'dark'; } catch { return 'dark'; }
  });
  const theme = themeProp || storedTheme;
  const dark = theme === 'dark';
  const p = codexPalette(dark);

  useEffect(() => {
    const onTheme = e => {
      const next = e.detail && e.detail.value;
      if (next === 'light' || next === 'dark') setStoredTheme(next);
    };
    window.addEventListener('bw-circuit-theme', onTheme);
    return () => window.removeEventListener('bw-circuit-theme', onTheme);
  }, []);

  // Index examples by id for fast lookup
  const exampleMap = useMemo(() => {
    const m = new Map();
    if (examples) for (const ex of examples) m.set(ex.id, ex);
    return m;
  }, [examples]);

  const trails = curriculum?.trails || [];

  // Navigation state: which trail, which chapter is expanded
  const [activeTrail, setActiveTrail] = useState(null);
  const [expandedChapters, setExpandedChapters] = useState({});
  // Intro reader modal state
  const [readerStation, setReaderStation] = useState(null); // { trail, chapterIdx, stationIdx, example, station }
  const [introData, setIntroData] = useState(null); // null | 'loading' | 'none' | { meta, body }
  // Device picker for multi-device examples in the reader
  const [readerDevice, setReaderDevice] = useState(null);
  // Progress
  const [progress, setProgress] = useState(readProgress);

  const toggleChapter = (key) => {
    setExpandedChapters(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const t = INTRO_L10N[lang] || INTRO_L10N.en;
  const ll = LEVEL_LABELS[lang] || LEVEL_LABELS.en;

  // Open station reader
  const openStation = useCallback((trail, chapterIdx, stationIdx, station, example) => {
    const sk = stationKey(trail.id, chapterIdx, stationIdx);
    setProgress(markSeen(sk));
    setReaderStation({ trail, chapterIdx, stationIdx, example, station });
    setIntroData(null);
    // Restore persisted device choice for this example
    if (example && Array.isArray(example.devices) && example.devices.length > 1) {
      try {
        const saved = JSON.parse(localStorage.getItem('bw-example-device') || '{}');
        setReaderDevice(saved[example.id] || example.devices[0]);
      } catch { setReaderDevice(example.devices[0]); }
    } else {
      setReaderDevice(null);
    }

    // Fetch intro for example stations
    if (example && example.files) {
      setIntroData('loading');
      const introFile = lang === 'de' && example.files.introDE ? example.files.introDE : example.files.intro;
      if (introFile) {
        fetch(introFile)
          .then(r => r.ok ? r.text() : Promise.reject())
          .then(text => setIntroData(parseIntro(text)))
          .catch(() => {
            // Fallback to English if DE failed
            if (lang === 'de' && example.files.intro) {
              fetch(example.files.intro)
                .then(r => r.ok ? r.text() : Promise.reject())
                .then(text => setIntroData(parseIntro(text)))
                .catch(() => setIntroData('none'));
            } else {
              setIntroData('none');
            }
          });
      } else {
        setIntroData('none');
      }
    }
  }, [lang]);

  const closeReader = () => setReaderStation(null);

  const loadOnBench = () => {
    if (readerStation?.example && onLoadExample) {
      const ex = readerStation.example;
      const opts = readerDevice ? { device: readerDevice, bench: ex.benches?.[readerDevice] } : undefined;
      onLoadExample(ex, opts);
    }
    closeReader();
  };
  const handleReaderDevicePick = (d) => {
    setReaderDevice(d);
    if (readerStation?.example) {
      try {
        const m = JSON.parse(localStorage.getItem('bw-example-device') || '{}');
        m[readerStation.example.id] = d;
        localStorage.setItem('bw-example-device', JSON.stringify(m));
      } catch { /* privacy mode */ }
    }
  };

  // ── Trail list view ───────────────────────────────────────────────

  if (activeTrail === null) {
    return (
      <div style={{ padding: '8px 10px', fontFamily: 'Georgia, "Times New Roman", serif',
        background: p.panel, minHeight: '100%' }}
        data-testid="codex-browser">
        <div style={{ fontSize: 14, fontWeight: 700, color: p.heading, marginBottom: 8,
          letterSpacing: '0.04em', textTransform: 'uppercase',
          borderBottom: `1px solid ${p.panelBorder}`, paddingBottom: 6 }}>
          {lang === 'de' ? 'Lehrpfade' : 'Trails'}
        </div>
        {trails.length === 0 && (
          <div style={{ color: p.muted, fontSize: 12, fontStyle: 'italic' }}>
            {lang === 'de' ? 'Kein Curriculum geladen.' : 'No curriculum loaded.'}
          </div>
        )}
        {trails.map((trail, ti) => {
          // Count stations and progress for this trail
          let total = 0, seen = 0;
          for (let ci = 0; ci < trail.chapters.length; ci++) {
            for (let si = 0; si < trail.chapters[ci].stations.length; si++) {
              const st = trail.chapters[ci].stations[si];
              if (st.interlude) continue; // interludes don't count
              total++;
              if (progress[stationKey(trail.id, ci, si)]) seen++;
            }
          }
          return (
            <div key={trail.id}
              onClick={() => setActiveTrail(ti)}
              style={{
                padding: '10px 12px', marginBottom: 6, cursor: 'pointer',
                background: p.trailBg, border: `1px solid ${p.trailBorder}`,
                borderRadius: 4, transition: 'background 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = p.trailHover}
              onMouseLeave={e => e.currentTarget.style.background = p.trailBg}
              data-testid={`codex-trail-${trail.id}`}>
              <div style={{ fontSize: 13, fontWeight: 700, color: p.heading, marginBottom: 3 }}>
                {trail.title[lang] || trail.title.en}
              </div>
              <div style={{ fontSize: 10, color: p.muted, display: 'flex', gap: 8, alignItems: 'center' }}>
                <span>{trail.audience}</span>
                <span style={{ color: p.tick }}>
                  {trail.chapters.length} {lang === 'de' ? 'Kapitel' : 'ch.'}
                </span>
                {total > 0 && (
                  <span style={{ color: seen === total ? '#22c55e' : p.tick }}>
                    {seen}/{total}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // ── Chapter spine + stations view ─────────────────────────────────

  const trail = trails[activeTrail];
  if (!trail) { setActiveTrail(null); return null; }

  return (
    <div style={{ padding: '6px 8px', fontFamily: 'Georgia, "Times New Roman", serif',
      background: p.panel, minHeight: '100%' }}
      data-testid="codex-browser">
      {/* Back button + trail title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
        borderBottom: `1px solid ${p.panelBorder}`, paddingBottom: 6 }}>
        <button type="button" onClick={() => setActiveTrail(null)}
          style={{ background: 'none', border: 'none', color: p.heading,
            cursor: 'pointer', fontSize: 16, padding: '0 4px', fontFamily: 'inherit' }}
          aria-label="Back to trails">◂</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: p.heading, letterSpacing: '0.03em' }}>
            {trail.title[lang] || trail.title.en}
          </div>
          <div style={{ fontSize: 9, color: p.muted }}>{trail.audience}</div>
        </div>
      </div>

      {/* Chapters */}
      {trail.chapters.map((chapter, ci) => {
        const chKey = `${activeTrail}-${ci}`;
        const isExpanded = expandedChapters[chKey] !== false; // default open

        return (
          <div key={ci} style={{ marginBottom: 6 }}>
            {/* Chapter header */}
            <div
              onClick={() => toggleChapter(chKey)}
              style={{
                padding: '6px 10px', cursor: 'pointer',
                background: p.chapterBg, border: `1px solid ${p.chapterBorder}`,
                borderRadius: isExpanded ? '4px 4px 0 0' : 4,
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
              <span style={{ fontSize: 10, color: p.muted, transition: 'transform 0.15s',
                display: 'inline-block', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0)' }}>▸</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: p.heading, flex: 1 }}>
                {chapter.title[lang] || chapter.title.en}
              </span>
              <span style={{ fontSize: 9, color: p.muted }}>
                {chapter.stations.filter(s => !s.interlude).length}
              </span>
            </div>

            {/* Stations */}
            {isExpanded && (
              <div style={{ borderLeft: `1px solid ${p.chapterBorder}`,
                borderRight: `1px solid ${p.chapterBorder}`,
                borderBottom: `1px solid ${p.chapterBorder}`,
                borderRadius: '0 0 4px 4px', overflow: 'hidden' }}>
                {chapter.stations.map((station, si) => {
                  const isInterlude = !!station.interlude;
                  const exId = station.example;
                  const example = exId ? exampleMap.get(exId) : null;
                  const disabled = !isInterlude && exId && !example;
                  const sk = stationKey(trail.id, ci, si);
                  const seen = !!progress[sk];

                  if (isInterlude) {
                    // Interlude: text-only narrative block
                    const text = station.interlude[lang] || station.interlude.en;
                    return (
                      <div key={si} style={{
                        padding: '8px 12px',
                        background: p.interludeBg,
                        borderTop: si > 0 ? `1px solid ${p.interludeBorder}` : 'none',
                        fontSize: 11, fontStyle: 'italic', color: p.muted,
                        lineHeight: 1.55, letterSpacing: '0.01em',
                      }}
                      data-testid="codex-interlude">
                        {text}
                      </div>
                    );
                  }

                  // Example station
                  const title = (station.title && (station.title[lang] || station.title.en))
                    || (example && (example.title?.[lang] || example.title?.en))
                    || exId || '???';
                  const lead = station.lead ? (station.lead[lang] || station.lead.en) : null;

                  return (
                    <div key={si}
                      onClick={disabled ? undefined : () => openStation(trail, ci, si, station, example)}
                      style={{
                        padding: '7px 12px', cursor: disabled ? 'default' : 'pointer',
                        background: p.stationBg,
                        borderTop: si > 0 ? `1px solid ${p.stationBorder}` : 'none',
                        opacity: disabled ? 0.4 : 1,
                        transition: 'background 0.12s',
                      }}
                      onMouseEnter={disabled ? undefined : e => { e.currentTarget.style.background = p.stationHover; }}
                      onMouseLeave={disabled ? undefined : e => { e.currentTarget.style.background = p.stationBg; }}
                      title={disabled ? (lang === 'de' ? `Beispiel „${exId}" nicht gefunden` : `Example "${exId}" not found`) : undefined}
                      data-testid={`codex-station-${exId || 'unknown'}`}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                        {/* Progress tick */}
                        <span style={{ fontSize: 7, color: seen ? p.tick : 'transparent',
                          flexShrink: 0, lineHeight: 1 }}>●</span>
                        <span style={{ fontSize: 11, fontWeight: 600, color: disabled ? p.disabledText : p.heading,
                          flex: 1 }}>
                          {title}
                        </span>
                        {station.level && (
                          <span style={{ fontSize: 8, color: p.muted, flexShrink: 0 }}>
                            L{station.level}
                          </span>
                        )}
                      </div>
                      {lead && (
                        <div style={{ fontSize: 10, color: p.muted, marginTop: 2, lineHeight: 1.45,
                          paddingLeft: 13 }}>
                          {lead}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* ── Intro reader modal ──────────────────────────────────────── */}
      {readerStation && createPortal(
        <div
          onClick={closeReader}
          onKeyDown={e => { if (e.key === 'Escape') closeReader(); }}
          role="dialog" aria-modal="true" tabIndex={-1}
          ref={el => el && el.focus()}
          style={{ position: 'fixed', inset: 0, zIndex: 3000,
            background: 'rgba(8, 6, 4, 0.72)', backdropFilter: 'blur(3px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ width: 'min(880px, 94vw)', maxHeight: '90vh', overflowY: 'auto',
              padding: '24px 28px 20px', background: p.modalBg,
              border: `1px solid ${p.modalBorder}`, borderRadius: 10,
              boxShadow: p.modalShadow }}
            data-testid="codex-reader-modal">

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
              <div style={{ fontSize: 17, fontWeight: 750, color: p.heading, flex: 1,
                fontFamily: 'Georgia, "Times New Roman", serif' }}>
                {readerStation.station.title?.[lang] || readerStation.station.title?.en
                  || readerStation.example?.title?.[lang] || readerStation.example?.title?.en
                  || readerStation.station.example || '—'}
              </div>
              {readerStation.example?.difficulty && (
                <span style={{ color: p.muted, fontSize: 12 }}>
                  {'★'.repeat(readerStation.example.difficulty)}{'☆'.repeat(3 - readerStation.example.difficulty)}
                </span>
              )}
              <button type="button" onClick={closeReader} aria-label="Close"
                style={{ width: 26, height: 26, border: `1px solid ${p.panelBorder}`,
                  borderRadius: '50%', background: p.button, color: p.heading,
                  cursor: 'pointer', fontSize: 14, fontWeight: 700, lineHeight: 1 }}>×</button>
            </div>

            {/* Lead paragraph — the station's pedagogical hook */}
            {readerStation.station.lead && (
              <div style={{ fontSize: 13, color: p.text, lineHeight: 1.6,
                marginBottom: 14, paddingLeft: 12,
                borderLeft: `2px solid ${p.accent}`,
                fontStyle: 'italic' }}>
                {readerStation.station.lead[lang] || readerStation.station.lead.en}
              </div>
            )}

            {/* Intro content */}
            {introData === 'loading' && <div style={{color: p.muted, fontSize: 12}}>{t.loading}</div>}
            {introData === 'none' && <div style={{color: p.muted, fontSize: 12, fontStyle: 'italic'}}>{t.noIntro}</div>}
            {introData && typeof introData === 'object' && (
              <>
                {/* Badges */}
                <div style={{display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap'}}>
                  {introData.meta.level && (
                    <span style={{fontSize: 10, padding: '1px 6px', borderRadius: 10,
                      background: LEVEL_COLORS[introData.meta.level] || '#64748b', color: '#fff', fontWeight: 600}}>
                      {t.level}: {ll[introData.meta.level] || introData.meta.level}
                    </span>
                  )}
                  {introData.meta.age && (
                    <span style={{fontSize: 10, padding: '1px 6px', borderRadius: 10,
                      background: '#6366f1', color: '#fff', fontWeight: 600}}>
                      {t.age}: {introData.meta.age}
                    </span>
                  )}
                  {Array.isArray(introData.meta.teaches) && introData.meta.teaches.map(tag => (
                    <span key={tag} style={{fontSize: 10, padding: '1px 6px', borderRadius: 10,
                      background: p.accentDim, color: p.text, border: `1px solid ${p.panelBorder}`}}>
                      {tag}
                    </span>
                  ))}
                </div>
                {renderMarkdown(introData.body, p)}
              </>
            )}

            {/* Device picker for multi-device examples */}
            {readerStation.example && Array.isArray(readerStation.example.devices) && readerStation.example.devices.length > 1 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 10, color: p.muted, marginBottom: 3, fontWeight: 600 }}>
                  {lang === 'de' ? 'Zielgerät' : 'Target device'}
                </div>
                <DevicePicker devices={readerStation.example.devices} selected={readerDevice}
                  onSelect={handleReaderDevicePick}
                  palette={{ accent: p.accent, button: p.button, muted: p.muted, buttonBorder: p.panelBorder }} />
              </div>
            )}

            {/* Open on the bench */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
              {readerStation.example && onLoadExample && (
                <button type="button"
                  onClick={loadOnBench}
                  data-testid="codex-open-bench"
                  style={{ padding: '8px 20px', border: `1px solid ${p.accent}`,
                    borderRadius: 6, background: p.accentDim,
                    color: p.heading, fontSize: 13,
                    fontWeight: 700, cursor: 'pointer',
                    fontFamily: 'Georgia, "Times New Roman", serif',
                    letterSpacing: '0.03em' }}>
                  {t.openBench}
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

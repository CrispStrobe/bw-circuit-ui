/**
 * ExamplesBrowser — gallery panel showing example circuits + programs.
 *
 * Reads examples/index.json from bw-cfront and renders categorized cards.
 * Click loads the example's circuit into the designer.
 * Presentation-only: no canvas interaction.
 */

import React, { useState, useEffect, useMemo } from 'react';

const INTRO_L10N = {
  en: { intro: 'About this example', loading: 'Loading…', noIntro: 'No introduction available.',
        level: 'Level', age: 'Age', prereqs: 'Prerequisites', teaches: 'Teaches' },
  de: { intro: 'Über dieses Beispiel', loading: 'Wird geladen…', noIntro: 'Keine Einführung verfügbar.',
        level: 'Stufe', age: 'Alter', prereqs: 'Voraussetzungen', teaches: 'Vermittelt' },
};
const LEVEL_LABELS = {
  en: { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' },
  de: { beginner: 'Anfänger', intermediate: 'Fortgeschritten', advanced: 'Fortgeschritten+' },
};
const LEVEL_COLORS = { beginner: '#22c55e', intermediate: '#f59e0b', advanced: '#f97316' };

/** Parse YAML frontmatter + markdown body from an intro file. */
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

/** Render minimal markdown to React elements (## headings, **bold**, `code`, lists, links, paragraphs). */
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
      elements.push(<div key={`h-${i}`} style={{fontWeight: 700, fontSize: 13, color: palette.heading, marginTop: i > 0 ? 10 : 0, marginBottom: 3}} data-intro-heading>{line.slice(3)}</div>);
    } else if (/^- /.test(line)) {
      listItems.push(<li key={`li-${i}`} style={{marginBottom: 2}}>{renderInline(line.slice(2))}</li>);
    } else if (/^\d+\. /.test(line)) {
      // Numbered list item — render as unordered for simplicity
      listItems.push(<li key={`li-${i}`} style={{marginBottom: 2}}>{renderInline(line.replace(/^\d+\.\s*/, ''))}</li>);
    } else if (line.trim()) {
      flushList();
      elements.push(<p key={`p-${i}`} style={{margin: '2px 0 6px', color: palette.text, fontSize: 12, lineHeight: 1.5}}>{renderInline(line)}</p>);
    }
  }
  flushList();
  return elements;
}

/** Render inline markdown: **bold**, `code`, [links](url). */
function renderInline(text) {
  const parts = [];
  let rest = text;
  let key = 0;
  while (rest.length) {
    // Links: [text](url)
    const linkM = rest.match(/\[([^\]]+)\]\(([^)]+)\)/);
    // Bold: **text**
    const boldM = rest.match(/\*\*([^*]+)\*\*/);
    // Code: `text`
    const codeM = rest.match(/`([^`]+)`/);
    // Find the earliest match
    const matches = [linkM, boldM, codeM].filter(Boolean);
    if (!matches.length) { parts.push(rest); break; }
    const earliest = matches.reduce((a, b) => (a.index < b.index ? a : b));
    if (earliest.index > 0) parts.push(rest.slice(0, earliest.index));
    if (earliest === linkM) {
      parts.push(<a key={key++} href={linkM[2]} style={{color: '#3b82f6', textDecoration: 'underline'}}
        onClick={e => e.stopPropagation()}>{linkM[1]}</a>);
    } else if (earliest === boldM) {
      parts.push(<strong key={key++}>{boldM[1]}</strong>);
    } else {
      parts.push(<code key={key++} style={{background: 'rgba(0,0,0,0.08)', padding: '1px 3px', borderRadius: 2, fontSize: 11}}>{codeM[1]}</code>);
    }
    rest = rest.slice(earliest.index + earliest[0].length);
  }
  return parts;
}

const CATEGORY_LABELS = {
  basics: 'Basics',
  analog: 'Analog',
  digital: 'Digital',
  motors: 'Motors & Actuators',
  'pure-circuit': 'Pure circuits',
};

const CATEGORY_COLORS = {
  basics: '#2ecc71',
  analog: '#f39c12',
  digital: '#9b59b6',
  motors: '#e74c3c',
  'pure-circuit': '#16a085',
};

const DIFFICULTY_LABELS = ['', 'Beginner', 'Intermediate', 'Advanced'];
const DIFFICULTY_COLORS = ['#64748b', '#22c55e', '#f59e0b', '#f97316'];
const PART_LABELS = {mcu: 'MCU', 'no-mcu': 'No MCU'};
const TARGET_LABELS = {
  'no-mcu': 'No MCU',
  generic: 'Any MCU',
  stc12: 'STC12',
  stc89: 'STC89',
  avr: 'AVR / Arduino',
  'arduino-nano': 'Arduino Nano',
  rp2040: 'RP2040 / Pico',
};

function examplePartTags(example) {
  const explicit = example.parts || example.partTags || example.components;
  const tags = Array.isArray(explicit) ? explicit.map(String) : [];
  const hasMcu = example.mcu === true || example.device || example.kind === 'program' ||
    tags.some(tag => /mcu|arduino|stc|pico|rp2040|avr|micro:bit/i.test(tag));
  tags.unshift(hasMcu ? 'mcu' : 'no-mcu');
  return [...new Set(tags)];
}

function partLabel(part) {
  if (PART_LABELS[part]) return PART_LABELS[part];
  return part.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function targetKey(target) {
  const value = String(target).toLowerCase();
  if (/arduino-nano/.test(value)) return 'arduino-nano';
  if (/arduino|atmega|avr/.test(value)) return 'avr';
  if (/pico|rp2040/.test(value)) return 'rp2040';
  if (/stc89/.test(value)) return 'stc89';
  if (/stc|8051/.test(value)) return 'stc12';
  if (/generic|any/.test(value)) return 'generic';
  return value;
}

function exampleTargetTags(example) {
  const explicit = example.targets || example.target;
  const targets = Array.isArray(explicit) ? explicit : explicit ? [explicit] : [];
  if (targets.length) return [...new Set(targets.map(targetKey))];
  if (example.device) return [targetKey(example.device)];
  if (example.kind === 'program') return ['stc12'];
  return ['no-mcu'];
}

function targetLabel(target) {
  return TARGET_LABELS[target] || target.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * @param {{ examples: Array, lang?: string, onLoadExample?: function, currentDevice?: string }} props
 */
export function ExamplesBrowser({ examples, lang = 'en', onLoadExample, theme: themeProp, currentDevice }) {
  const [filter, setFilter] = useState('');
  // The on-demand example info lived in InferPanel and was LOST when
  // this browser took over examples mode — restored here: load an
  // example, the i button shows its details compactly.
  const [lastLoaded, setLastLoaded] = useState(null);
  const [showInfo, setShowInfo] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [selectedDifficulty, setSelectedDifficulty] = useState(null);
  const [selectedPart, setSelectedPart] = useState(null);
  const [selectedTarget, setSelectedTarget] = useState(null);
  const [storedTheme, setStoredTheme] = useState(() => {
    try { return localStorage.getItem('bw-circuit-theme') || 'light'; } catch { return 'light'; }
  });
  const theme = themeProp || storedTheme;
  const dark = theme === 'dark';
  const palette = dark ? {
    panel: '#1a1a2e', border: '#2c3e50', heading: '#f8fafc', text: '#ecf0f1',
    muted: '#cbd5e1', input: '#0a0a1a', button: '#24324b', buttonBorder: '#52627a',
    card: '#16213e', cardHover: '#1e2d4a', cardBorder: '#2c3e50', accent: '#3b82f6',
  } : {
    panel: '#f8fafc', border: '#cbd5e1', heading: '#0f172a', text: '#334155',
    muted: '#475569', input: '#ffffff', button: '#e2e8f0', buttonBorder: '#94a3b8',
    card: '#ffffff', cardHover: '#eff6ff', cardBorder: '#cbd5e1', accent: '#2563eb',
  };

  useEffect(() => {
    const onTheme = event => {
      const next = event.detail && event.detail.value;
      if (next === 'light' || next === 'dark') setStoredTheme(next);
    };
    window.addEventListener('bw-circuit-theme', onTheme);
    return () => window.removeEventListener('bw-circuit-theme', onTheme);
  }, []);
  // The dedicated Examples mode is already an explicitly selected panel;
  // starting it collapsed made the mode look empty and hid its scroll area.
  const [open, setOpen] = useState(() => true);

  const categories = useMemo(() => {
    if (!examples) return [];
    return [...new Set(examples.map(e => e.category))];
  }, [examples]);

  const partTags = useMemo(() => {
    if (!examples) return [];
    return [...new Set(examples.flatMap(examplePartTags))].sort((a, b) => {
      if (a === 'mcu') return -1;
      if (b === 'mcu') return 1;
      if (a === 'no-mcu') return -1;
      if (b === 'no-mcu') return 1;
      return a.localeCompare(b);
    });
  }, [examples]);

  const targetTags = useMemo(() => {
    if (!examples) return [];
    return [...new Set(examples.flatMap(exampleTargetTags))].sort((a, b) => {
      if (a === 'no-mcu') return -1;
      if (b === 'no-mcu') return 1;
      return targetLabel(a).localeCompare(targetLabel(b));
    });
  }, [examples]);

  const filtered = useMemo(() => {
    if (!examples) return [];
    let list = examples;
    if (selectedCategory) {
      list = list.filter(e => e.category === selectedCategory);
    }
    if (selectedDifficulty) {
      list = list.filter(e => e.difficulty === selectedDifficulty);
    }
    if (selectedPart) {
      list = list.filter(e => examplePartTags(e).includes(selectedPart));
    }
    if (selectedTarget) {
      list = list.filter(e => exampleTargetTags(e).includes(selectedTarget));
    }
    if (filter) {
      const q = filter.toLowerCase();
      list = list.filter(e => {
        const title = e.title?.[lang] || e.title?.en || e.id;
        return title.toLowerCase().includes(q) || e.id.includes(q) || e.category.includes(q);
      });
    }
    return list;
  }, [examples, filter, selectedCategory, selectedDifficulty, selectedPart, selectedTarget, lang]);

  if (!examples || examples.length === 0) {
    return (
      <div style={{
        background: palette.panel, border: `1px solid ${palette.border}`, borderRadius: '8px',
        padding: '12px', fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif', fontSize: '13px', color: palette.muted,
      }}>
        No examples available
      </div>
    );
  }

  return (
    <div data-examples-selector style={{
      background: palette.panel,
      border: `1px solid ${palette.border}`,
      borderRadius: '8px',
      padding: '8px',
      fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      height: '100%',
      flex: '1 1 auto',
      overflow: 'hidden',
      minHeight: 0,
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open}
        aria-label={open ? 'Collapse examples selector' : 'Expand examples selector'}
        title={open ? 'Collapse examples selector' : 'Expand examples selector'}
        style={{position: 'absolute', left: 5, top: 5, width: 24, height: 24, padding: 0, zIndex: 2,
          /* left: 5, not -13: this container clips (overflow hidden), and a
             handle outside the clip is invisible AND unclickable — the click
             lands on whatever sits underneath. The heading's paddingLeft: 34
             reserves this seat. The designer's own handles keep -13 because
             their containers are overflow: visible. */
          border: `1px solid ${palette.buttonBorder}`, borderRadius: '999px', background: palette.button, color: palette.text, cursor: 'pointer'}}>
        {open ? '‹' : '›'}
      </button>
      <div style={{ color: palette.heading, fontSize: '16px', marginBottom: '8px', fontWeight: 700, paddingLeft: 34, letterSpacing: '.01em', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>Examples <span style={{color: palette.muted, fontSize: '12px', fontWeight: 400}}>({filtered.length}/{examples.length})</span></span>
        <button type="button" onClick={() => setShowInfo(v => !v)} disabled={!lastLoaded}
          aria-label={lastLoaded ? `Info for ${lastLoaded.title?.[lang] || lastLoaded.title?.en || lastLoaded.id}` : 'Example info'}
          title={lastLoaded ? 'Show information for the loaded example' : 'Load an example to see information'}
          style={{width: 22, height: 22, padding: 0, borderRadius: '50%', border: `1px solid ${palette.buttonBorder}`,
            background: lastLoaded ? palette.button : 'transparent', color: palette.text,
            cursor: lastLoaded ? 'pointer' : 'default', fontWeight: 700, fontSize: 12}}>i</button>
      </div>
      {showInfo && lastLoaded && (
        <div data-example-info style={{marginBottom: 8, padding: 6, borderRadius: 4,
          border: `1px solid ${palette.border}`, color: palette.text, fontSize: 11, lineHeight: 1.4}}>
          <strong>{lastLoaded.title?.[lang] || lastLoaded.title?.en || lastLoaded.id}</strong>
          {lastLoaded.desc ? <div>{lastLoaded.desc?.[lang] || lastLoaded.desc?.en || String(lastLoaded.desc)}</div> : null}
          <div style={{color: palette.muted}}>{lastLoaded.category}{lastLoaded.level ? ` · level ${lastLoaded.level}` : ''}</div>
        </div>
      )}

      {!open ? null : <div data-examples-selector-content style={{flex: '1 1 auto', minHeight: 0, maxHeight: 'none', overflowY: 'auto', overscrollBehavior: 'contain'}}>

      {/* Search — prominent for large catalogues */}
      <div style={{ position: 'relative', marginBottom: '6px' }}>
        <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)',
          color: palette.muted, fontSize: '13px', pointerEvents: 'none' }}>&#x1F50D;</span>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={`Search ${examples.length} examples\u2026`}
          style={{
            width: '100%', padding: '6px 8px 6px 28px',
            background: palette.input, border: `1px solid ${palette.border}`,
            borderRadius: '6px', color: palette.text,
            fontFamily: 'inherit', fontSize: '13px',
            boxSizing: 'border-box',
          }}
        />
        {filter && <button type="button" onClick={() => setFilter('')}
          style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
            background: 'none', border: 'none', color: palette.muted, cursor: 'pointer',
            fontSize: '14px', padding: '0 2px', lineHeight: 1 }}
          aria-label="Clear search">&times;</button>}
      </div>

      {/* Filter toolbar: each group stays compact and the groups share rows. */}
      <div style={{display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'nowrap', overflowX: 'auto', paddingBottom: '4px', marginBottom: '4px'}}>
      <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'nowrap', flexShrink: 0 }}>
        <button
          onClick={() => setSelectedCategory(null)}
          style={{
            padding: '5px 9px', borderRadius: '5px', fontSize: '12px',
            fontFamily: 'inherit', cursor: 'pointer',
            background: !selectedCategory ? palette.accent : palette.button,
            color: !selectedCategory ? '#fff' : palette.text,
            border: `1px solid ${!selectedCategory ? palette.accent : palette.buttonBorder}`,
          }}
        >All</button>
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(selectedCategory === cat ? null : cat)}
            style={{
              padding: '5px 9px', borderRadius: '5px', fontSize: '12px',
              fontFamily: 'inherit', cursor: 'pointer',
              background: selectedCategory === cat ? (CATEGORY_COLORS[cat] || palette.accent) : palette.button,
              color: selectedCategory === cat ? '#fff' : (dark ? (CATEGORY_COLORS[cat] || palette.text) : palette.text),
              border: `1px solid ${selectedCategory === cat ? (CATEGORY_COLORS[cat] || palette.accent) : palette.buttonBorder}`,
            }}
          >{CATEGORY_LABELS[cat] || cat}</button>
        ))}
      </div>

      <FilterRow label="Level" palette={palette}>
        <FilterButton palette={palette} active={!selectedDifficulty} onClick={() => setSelectedDifficulty(null)}>All</FilterButton>
        {[1, 2, 3].map(level => (
          <FilterButton palette={palette} key={level} active={selectedDifficulty === level} color={DIFFICULTY_COLORS[level]}
            onClick={() => setSelectedDifficulty(selectedDifficulty === level ? null : level)}>
            {DIFFICULTY_LABELS[level]}
          </FilterButton>
        ))}
      </FilterRow>

      <FilterRow label="Parts" palette={palette}>
        <FilterButton palette={palette} active={!selectedPart} onClick={() => setSelectedPart(null)}>All</FilterButton>
        {partTags.map(part => (
          <FilterButton palette={palette} key={part} active={selectedPart === part}
            color={part === 'mcu' ? '#38bdf8' : '#14b8a6'}
            onClick={() => setSelectedPart(selectedPart === part ? null : part)}>
            {partLabel(part)}
          </FilterButton>
        ))}
      </FilterRow>

      <FilterRow label="Target" palette={palette}>
        <FilterButton palette={palette} active={!selectedTarget} onClick={() => setSelectedTarget(null)}>All</FilterButton>
        {targetTags.map(target => (
          <FilterButton palette={palette} key={target} active={selectedTarget === target}
            color={target === 'no-mcu' ? '#14b8a6' : '#6366f1'}
            onClick={() => setSelectedTarget(selectedTarget === target ? null : target)}>
            {targetLabel(target)}
          </FilterButton>
        ))}
      </FilterRow>
      </div>

      {/* Example cards */}
      {filtered.length === 0 ? (
        <div style={{ color: palette.muted, fontSize: '13px', padding: '8px 4px' }}>No examples match these filters.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {filtered.map(ex => {
            const compat = deviceCompat(ex, currentDevice);
            const reason = !compat.ok
              ? deviceCompatReason(ex, currentDevice, lang)
              : '';
            return (
              <ExampleCard
                key={ex.id}
                example={ex}
                lang={lang}
                palette={palette}
                disabled={!compat.ok}
                disabledReason={reason}
                onClick={() => { if (onLoadExample) { onLoadExample(ex); setLastLoaded(ex); setShowInfo(false); } }}
              />
            );
          })}
        </div>
      )}
      </div>}
    </div>
  );
}

function FilterRow({label, children, palette}) {
  return (
    <div style={{display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'nowrap', flexShrink: 0}}>
      <span style={{color: palette.muted, fontSize: '12px', minWidth: 'auto', fontWeight: 600}}>{label}</span>
      {children}
    </div>
  );
}

function FilterButton({active, color = '#3b82f6', onClick, children, palette}) {
  return (
    <button type="button" onClick={onClick} style={{
      padding: '5px 9px', borderRadius: '5px', fontSize: '12px',
      fontFamily: 'inherit', cursor: 'pointer',
      background: active ? color : palette.button,
      color: active ? '#fff' : palette.text,
      border: `1px solid ${active ? color : palette.buttonBorder}`,
      boxShadow: active ? '0 1px 2px rgba(0,0,0,.25)' : 'none',
    }}>{children}</button>
  );
}

/**
 * Is this example compatible with the given device?
 * Uses the `devices` array from index.json when present.
 * Examples without a `devices` field (pure circuits, device-specific) are always shown.
 */
function deviceCompat(example, device) {
  if (!device || !Array.isArray(example.devices)) return { ok: true };
  if (example.devices.includes(device)) return { ok: true };
  return { ok: false };
}

/** Build a human-readable reason why this example is not available. */
function deviceCompatReason(example, device, lang = 'en') {
  if (!device || !Array.isArray(example.devices)) return '';
  if (example._retargetReasons && example._retargetReasons[device]) {
    return example._retargetReasons[device].join('; ');
  }
  const supported = example.devices.map(d => DEVICE_LABELS[d] || d).join(', ');
  return `${/^de/i.test(lang) ? 'Benötigt' : 'Needs'}: ${supported}`;
}

const DEVICE_LABELS = {
  stc12c5a60s2: 'STC12', stc89c52rc: 'STC89', stc15f2k60s2: 'STC15',
  'arduino-uno': 'Uno', 'arduino-nano': 'Nano', 'arduino-mega': 'Mega',
  pico: 'Pico', attiny85: 'ATtiny85', attiny88: 'ATtiny88',
  atmega168p: 'ATmega168P', atmega328p: 'ATmega328P', atmega2560: 'ATmega2560',
  eater6502: '6502 Breadboard', z80: 'Z80', microbit: 'micro:bit',
};

function ExampleCard({ example, lang, onClick, palette, disabled, disabledReason }) {
  const [hovered, setHovered] = useState(false);
  const [introOpen, setIntroOpen] = useState(false);
  const [introData, setIntroData] = useState(null); // {meta, body} or 'loading' or 'none'
  const title = example.title?.[lang] || example.title?.en || example.id;
  const catColor = CATEGORY_COLORS[example.category] || '#555';
  const diff = DIFFICULTY_LABELS[example.difficulty] || '';
  const t = INTRO_L10N[lang] || INTRO_L10N.en;
  const ll = LEVEL_LABELS[lang] || LEVEL_LABELS.en;

  const loadIntro = () => {
    if (introData && introData !== 'loading') { setIntroOpen(!introOpen); return; }
    setIntroOpen(true);
    setIntroData('loading');
    const suffix = lang === 'de' ? '.de.md' : '.md';
    const dir = example.id;
    fetch(`examples/${dir}/intro${suffix}`)
      .then(r => r.ok ? r.text() : null)
      .then(text => {
        if (!text && lang === 'de') {
          // Fallback to English
          return fetch(`examples/${dir}/intro.md`).then(r => r.ok ? r.text() : null);
        }
        return text;
      })
      .then(text => {
        if (text) setIntroData(parseIntro(text));
        else setIntroData('none');
      })
      .catch(() => setIntroData('none'));
  };

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={disabledReason || ''}
      style={{
        padding: '4px 6px',
        background: hovered && !disabled ? palette.cardHover : palette.card,
        border: `1px solid ${hovered && !disabled ? catColor : palette.cardBorder}`,
        borderRadius: '4px',
        transition: 'border-color 80ms, background 80ms',
        opacity: disabled ? 0.7 : 1,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
        <div style={{ color: palette.heading, fontSize: '12px', fontWeight: 650, cursor: 'pointer', flex: 1, lineHeight: 1.3 }}
          onClick={onClick}>{title}</div>
        {diff && <span style={{ color: palette.muted, fontSize: '9px', flexShrink: 0 }}>
          {'★'.repeat(example.difficulty)}{'☆'.repeat(3 - example.difficulty)}
        </span>}
        <span style={{
          fontSize: '9px', color: palette.text,
          background: `${catColor}22`, padding: '1px 4px',
          borderRadius: '2px', flexShrink: 0,
        }}>{example.category}</span>
        {/* Intro toggle — ℹ icon */}
        <button type="button" onClick={e => { e.stopPropagation(); loadIntro(); }}
          title={t.intro}
          style={{
            width: 18, height: 18, padding: 0, border: 'none', borderRadius: '50%',
            background: introOpen ? palette.accent : palette.button,
            color: introOpen ? '#fff' : palette.muted,
            fontSize: 10, fontWeight: 700, cursor: 'pointer', fontStyle: 'italic',
            flexShrink: 0,
          }}
          data-testid="bw-example-intro-toggle">i</button>
      </div>
      {disabled && disabledReason && (
        <div style={{ color: '#94a3b8', fontSize: '11px', marginTop: '4px', fontStyle: 'italic',
          cursor: 'pointer' }} onClick={onClick}
          title={/^de/i.test(lang) ? 'Klicken zum Laden — Gerät wird automatisch gewechselt' : 'Click to load — device will switch automatically'}>
          {disabledReason}
        </div>
      )}
      {/* Intro panel — expandable */}
      {introOpen && (
        <div style={{ marginTop: 8, padding: '8px 10px', background: palette.panel,
          border: `1px solid ${palette.border}`, borderRadius: 6 }}
          data-testid="bw-example-intro-panel">
          {introData === 'loading' && <div style={{color: palette.muted, fontSize: 12}}>{t.loading}</div>}
          {introData === 'none' && <div style={{color: palette.muted, fontSize: 12}}>{t.noIntro}</div>}
          {introData && typeof introData === 'object' && (
            <>
              {/* Badges: level, age */}
              <div style={{display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap'}}>
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
                    background: palette.button, color: palette.text, border: `1px solid ${palette.border}`}}>
                    {tag}
                  </span>
                ))}
              </div>
              {/* Prereqs as links */}
              {Array.isArray(introData.meta.prereqs) && introData.meta.prereqs.length > 0 && (
                <div style={{fontSize: 11, color: palette.muted, marginBottom: 6}}>
                  {t.prereqs}: {introData.meta.prereqs.map((p, i) => (
                    <span key={p}>
                      {i > 0 && ', '}
                      <a href="#" onClick={e => { e.preventDefault(); e.stopPropagation(); }}
                        style={{color: palette.accent, textDecoration: 'underline'}}>{p}</a>
                    </span>
                  ))}
                </div>
              )}
              {/* Markdown body */}
              {renderMarkdown(introData.body, palette)}
            </>
          )}
        </div>
      )}
    </div>
  );
}

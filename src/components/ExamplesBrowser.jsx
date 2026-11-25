/**
 * ExamplesBrowser — gallery panel showing example circuits + programs.
 *
 * Reads examples/index.json from bw-cfront and renders categorized cards.
 * Click loads the example's circuit into the designer.
 * Presentation-only: no canvas interaction.
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';

// The intro document's parser, renderer and labels now live in one place so the
// catalogue and the top bar's (i) cannot drift apart. Extracted verbatim.
import { INTRO_L10N, LEVEL_LABELS, LEVEL_COLORS, parseIntro, renderMarkdown }
  from '../intro-doc.jsx';

// Catalogue concerns, not intro concerns. These came back here after an
// extraction took them by span rather than by meaning — see the gate below.
const CATEGORY_LABELS = {
  basics: 'Basics',
  analog: 'Analog',
  digital: 'Digital',
  motors: 'Motors & Actuators',
  'pure-circuit': 'Pure circuits',
};

const PART_LABELS = {mcu: 'MCU', 'no-mcu': 'No MCU'};
const TARGET_LABELS = {
  'no-mcu': 'No MCU',
  'kosmos-cp1': 'Kosmos CP1',
  generic: 'Any MCU',
  stc12: 'STC12',
  stc89: 'STC89',
  avr: 'AVR / Arduino',
  'arduino-nano': 'Arduino Nano',
  rp2040: 'RP2040 / Pico',
};
const CATEGORY_COLORS = {
  basics: '#2ecc71',
  analog: '#f39c12',
  digital: '#9b59b6',
  motors: '#e74c3c',
  'pure-circuit': '#16a085',
};

const DIFFICULTY_LABELS = ['', 'Beginner', 'Intermediate', 'Advanced'];
const EXAMPLE_BATCH_SIZE = 32;

// The browser's own words in German. Catalogue keys stay English; only what is SHOWN moves.
const EB_DE = {
  'Basics': 'Grundlagen', 'Analog': 'Analog', 'Digital': 'Digital', 'Motors & Actuators': 'Motoren & Aktoren',
  'Pure circuits': 'Reine Schaltungen', 'No MCU': 'Ohne MCU', 'Any MCU': 'Beliebige MCU',
  'Beginner': 'Einsteiger', 'Intermediate': 'Fortgeschritten', 'Advanced': 'Experte',
  'All': 'Alle', 'Level': 'Stufe', 'Parts': 'Bauteile', 'Target': 'Zielchip', 'Examples': 'Beispiele',
  'Category': 'Kategorie', 'Type': 'Typ', 'Lvl': 'Stufe',
  'Example info': 'Beispiel-Info', 'Info for {title}': 'Info zu {title}',
  'Show information for the loaded example': 'Informationen zum geladenen Beispiel anzeigen',
  'Load an example to see information': 'Lade ein Beispiel, um Informationen zu sehen',
  'Search {n} examples\u2026': '{n} Beispiele durchsuchen\u2026', 'Clear search': 'Suche leeren',
  'No examples match these filters.': 'Keine Beispiele passen zu diesen Filtern.',
  'level {n}': 'Stufe {n}', 'Open \u201c{title}\u201d?': '\u201e{title}\u201c öffnen?', 'Chip': 'Chip',
  'Cancel': 'Abbrechen', 'OK': 'OK', ' — unavailable: ': ' — nicht verfügbar: ',
};
/** `text` in `lang` (German from EB_DE, else the English), with {placeholders} filled. */
function ebt(text, lang, vars) {
  let s = (/^de/i.test(lang || '') && EB_DE[text]) || text;
  for (const [k, v] of Object.entries(vars || {})) s = s.replace(`{${k}}`, String(v));
  return s;
}


function examplePartTags(example) {
  const explicit = example.parts || example.partTags || example.components;
  const tags = Array.isArray(explicit) ? explicit.map(String) : [];
  const hasMcu = example.mcu === true || example.device || example.kind === 'program' ||
    tags.some(tag => /mcu|arduino|stc|pico|rp2040|avr|micro:bit/i.test(tag));
  tags.unshift(hasMcu ? 'mcu' : 'no-mcu');
  return [...new Set(tags)];
}

function partLabel(part, lang) {
  if (PART_LABELS[part]) return ebt(PART_LABELS[part], lang);
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

function targetLabel(target, lang) {
  return (TARGET_LABELS[target] && ebt(TARGET_LABELS[target], lang)) || target.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * @param {{ examples: Array, lang?: string, onLoadExample?: function, currentDevice?: string }} props
 */
export function ExamplesBrowser({ examples, lang = 'en', onLoadExample, theme: themeProp, currentDevice, headingControl }) {
  const [filter, setFilter] = useState('');
  const [visibleCount, setVisibleCount] = useState(EXAMPLE_BATCH_SIZE);
  const endOfExamples = useRef(null);
  const scrollArea = useRef(null);
  // The on-demand example info lived in InferPanel and was LOST when
  // this browser took over examples mode — restored here: load an
  // example, the i button shows its details compactly.
  const [lastLoaded, setLastLoaded] = useState(null);
  const [showInfo, setShowInfo] = useState(false);
  // Confirm dialog state: when set, shows the device-chooser dialog
  // before loading the example.
  const [pendingLoad, setPendingLoad] = useState(null); // {example, device}
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
  // Collapse is now managed by the host (CircuitDesigner) — ExamplesBrowser
  // always renders its full content when mounted.

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

  const showMore = () => setVisibleCount(count => Math.min(count + EXAMPLE_BATCH_SIZE, filtered.length));
  const hasMore = visibleCount < filtered.length;
  useEffect(() => {
    if (!hasMore || !endOfExamples.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        observer.disconnect();
        setVisibleCount(count => Math.min(count + EXAMPLE_BATCH_SIZE, filtered.length));
      }
    }, {root: scrollArea.current, rootMargin: '120px 0px'});
    observer.observe(endOfExamples.current);
    return () => observer.disconnect();
  }, [filtered.length, hasMore, visibleCount]);
  const changeFilter = (setter, value) => {
    setVisibleCount(EXAMPLE_BATCH_SIZE);
    if (scrollArea.current) scrollArea.current.scrollTop = 0;
    setter(value);
  };

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
      boxSizing: 'border-box',
      minWidth: 0,
      flex: '1 1 auto',
      overflow: 'hidden',
      minHeight: 0,
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <div data-example-heading style={{color: palette.heading, marginBottom: 6, display: 'flex',
        gap: 4, alignItems: 'center', flexShrink: 0}}>
        {headingControl}
        <span style={{fontSize: 13, fontWeight: 700, minWidth: 0, flex: 1, whiteSpace: 'nowrap'}}>
          {ebt('Examples', lang)} <span style={{color: palette.muted, fontSize: 10, fontWeight: 400}}>({filtered.length}/{examples.length})</span>
        </span>
        <button type="button" onClick={() => setShowInfo(v => !v)} disabled={!lastLoaded}
          aria-label={lastLoaded ? ebt('Info for {title}', lang, {title: lastLoaded.title?.[lang] || lastLoaded.title?.en || lastLoaded.id}) : ebt('Example info', lang)}
          title={lastLoaded ? ebt('Show information for the loaded example', lang) : ebt('Load an example to see information', lang)}
          style={{width: 18, height: 18, flexShrink: 0, padding: 0, borderRadius: '50%', border: `1px solid ${palette.buttonBorder}`,
            background: lastLoaded ? palette.button : 'transparent', color: palette.text,
            cursor: lastLoaded ? 'pointer' : 'default', fontWeight: 700, fontSize: 12}}>i</button>
      </div>
      {showInfo && lastLoaded && (
        <div data-example-info style={{marginBottom: 8, padding: 6, borderRadius: 4,
          border: `1px solid ${palette.border}`, color: palette.text, fontSize: 11, lineHeight: 1.4}}>
          <strong>{lastLoaded.title?.[lang] || lastLoaded.title?.en || lastLoaded.id}</strong>
          {lastLoaded.desc ? <div>{lastLoaded.desc?.[lang] || lastLoaded.desc?.en || String(lastLoaded.desc)}</div> : null}
          <div style={{color: palette.muted}}>{lastLoaded.category}{lastLoaded.level ? ` · ${ebt('level {n}', lang, {n: lastLoaded.level})}` : ''}</div>
        </div>
      )}

      <div data-examples-selector-content style={{flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column'}}>

      {/* Search — prominent for large catalogues */}
      <div style={{ position: 'relative', marginBottom: '6px', flexShrink: 0 }}>
        <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)',
          color: palette.muted, fontSize: '13px', pointerEvents: 'none' }}>&#x1F50D;</span>
        <input
          type="text"
          value={filter}
          onChange={(e) => changeFilter(setFilter, e.target.value)}
          placeholder={ebt('Search {n} examples\u2026', lang, {n: examples.length})}
          style={{
            width: '100%', padding: '6px 8px 6px 28px',
            background: palette.input, border: `1px solid ${palette.border}`,
            borderRadius: '6px', color: palette.text,
            fontFamily: 'inherit', fontSize: '13px',
            boxSizing: 'border-box',
          }}
        />
        {filter && <button type="button" onClick={() => changeFilter(setFilter, '')}
          style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
            background: 'none', border: 'none', color: palette.muted, cursor: 'pointer',
            fontSize: '14px', padding: '0 2px', lineHeight: 1 }}
          aria-label={ebt('Clear search', lang)}>&times;</button>}
      </div>

      <div data-example-filters style={{display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
        gap: 4, marginBottom: 6, flexShrink: 0}}>
        <FilterSelect title={ebt('Category', lang)} label={ebt('Type', lang)} value={selectedCategory}
          onChange={value => changeFilter(setSelectedCategory, value)} palette={palette}
          options={categories.map(key => [key, ebt(CATEGORY_LABELS[key] || key, lang)])} />
        <FilterSelect title={ebt('Level', lang)} label={ebt('Lvl', lang)} value={selectedDifficulty}
          onChange={value => changeFilter(setSelectedDifficulty, value ? Number(value) : null)} palette={palette}
          options={[1, 2, 3].map(key => [key, ebt(DIFFICULTY_LABELS[key], lang)])} />
        <FilterSelect title={ebt('Parts', lang)} label={ebt('Parts', lang)} value={selectedPart}
          onChange={value => changeFilter(setSelectedPart, value)} palette={palette}
          options={partTags.map(key => [key, partLabel(key, lang)])} />
        <FilterSelect title={ebt('Target', lang)} label={ebt('Chip', lang)} value={selectedTarget}
          onChange={value => changeFilter(setSelectedTarget, value)} palette={palette}
          options={targetTags.map(key => [key, targetLabel(key, lang)])} />
      </div>

      <div ref={scrollArea} data-example-list tabIndex={0} aria-label={ebt('Examples', lang)}
        onScroll={event => {
          const {scrollTop, scrollHeight, clientHeight} = event.currentTarget;
          if (hasMore && typeof IntersectionObserver === 'undefined' && scrollHeight - scrollTop - clientHeight < 120) showMore();
        }}
        style={{minWidth: 0, minHeight: 0, flex: '1 1 auto', overflowY: 'auto', overflowX: 'hidden',
          scrollbarWidth: 'thin', overscrollBehavior: 'contain'}}>
      {/* Example cards */}
      {filtered.length === 0 ? (
        <div style={{ color: palette.muted, fontSize: '13px', padding: '8px 4px' }}>{ebt('No examples match these filters.', lang)}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {filtered.slice(0, visibleCount).map(ex => {
            // THE DEVICE IS CHOSEN AFTER THE EXAMPLE, so the catalogue must not
            // narrow or annotate by whatever chip happens to be selected now.
            // This greyed a card and labelled it "Benötigt: STC12, STC15, …"
            // against `currentDevice` — a device the learner has not chosen yet
            // and may be about to change — which made a browsable catalogue
            // read as a list of things that do not work (owner, 2026-09-07).
            //
            // Compatibility is not dropped, it MOVES to where the choice is
            // actually made: the confirm dialog's device picker below already
            // offers exactly `ex.devices` and greys each refusal with its own
            // reason. Same information, at the moment it is actionable, rather
            // than a warning about a decision not yet taken.
            return (
              <ExampleCard
                key={ex.id}
                example={ex}
                lang={lang}
                palette={palette}
                disabled={false}
                disabledReason={''}
                onClick={() => {
                  // Open the confirm dialog with device chooser.
                  const devices = ex.devices || [];
                  // Default device: current project chip if compatible, else
                  // saved choice (only if still in the example's device list),
                  // else the authoring chip.
                  const saved = savedDeviceFor(ex.id);
                  // Curated builds (kind 'full') default to their AUTHORED
                  // device — current-chip-first loaded a generated LED bench
                  // where the retro console's matrices belonged. Plain
                  // programs keep current-chip-first.
                  const defaultDev = ex.kind === 'full'
                    ? (ex.authored || devices[0] || undefined)
                    : devices.includes(currentDevice) ? currentDevice
                    : (saved && devices.includes(saved)) ? saved
                    : (ex.authored || devices[0] || undefined);
                  setPendingLoad({ example: ex, device: defaultDev });
                }}
              />
            );
          })}
        </div>
      )}
      {hasMore && <div ref={endOfExamples} aria-hidden="true" style={{height: 1}} />}
      </div>
      </div>

      {/* ── Confirm dialog with device chooser ─────────────────── */}
      {pendingLoad && (() => {
        const { example: pEx, device: pDev } = pendingLoad;
        const pTitle = pEx.title?.[lang] || pEx.title?.en || pEx.id;
        const pDevices = pEx.devices || [];
        const hasDevices = pDevices.length > 1;
        const handleOk = () => {
          if (onLoadExample) {
            // Read the select's CURRENT DOM value to avoid stale-closure issues
            // when external tools (Playwright) change the select between renders.
            const selEl = typeof document !== 'undefined'
              ? document.querySelector('[data-device-chooser-select]') : null;
            const d = (selEl?.value) || pendingLoad.device || pDevices[0];
            // Picking the AUTHORED device means the authored pairing —
            // no opts, so the host loads the curated circuit instead of a
            // generated bench (a single-entry list used to silently
            // retarget the self-test to Mega: 'Simulated ATmega, not STC').
            const opts = d && d !== pEx.authored ? { device: d, bench: pEx.benches?.[d] } : undefined;
            onLoadExample(pEx, opts);
            setLastLoaded(pEx);
            setShowInfo(false);
          }
          setPendingLoad(null);
        };
        const handleCancel = () => setPendingLoad(null);
        return createPortal(
          <div style={{ position: 'fixed', inset: 0, zIndex: 10000, display: 'flex',
            alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)' }}
            onClick={handleCancel}
            onKeyDown={e => {
              if (e.key === 'Escape') handleCancel();
              if (e.key === 'Enter') { e.preventDefault(); handleOk(); }
            }}>
            <div style={{
              background: palette.panel, border: `1px solid ${palette.border}`,
              borderRadius: 8, padding: '16px 20px', minWidth: 260, maxWidth: 360,
              boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            }} onClick={e => e.stopPropagation()}>
              <div style={{ color: palette.heading, fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
                {ebt('Open \u201c{title}\u201d?', lang, {title: pTitle})}
              </div>
              {hasDevices && (
                <div style={{ marginBottom: 12 }}>
                  <label style={{ color: palette.muted, fontSize: 11, display: 'block', marginBottom: 4 }}>
                    {ebt('Chip', lang)}
                  </label>
                  <select data-device-chooser-select
                    value={pDev || ''}
                    onChange={e => setPendingLoad(prev => ({ ...prev, device: e.target.value }))}
                    style={{
                      width: '100%', padding: '4px 8px', fontSize: 12,
                      background: palette.input, color: palette.text,
                      border: `1px solid ${palette.buttonBorder}`, borderRadius: 4,
                    }}>
                    {pDevices.map(d => {
                      // Transform refusals are app-readable data
                      // (e.transformRefused, sb3 0da6ed2): offer the pick
                      // greyed with its reason instead of loading a
                      // mismatched pairing.
                      const refusal = pEx.transformRefused && pEx.transformRefused[d];
                      return (
                        <option key={d} value={d} disabled={!!refusal}
                          title={refusal || undefined}>
                          {(DEVICE_LABELS[d] || d) + (refusal ? ebt(' — unavailable: ', lang) + refusal : '')}
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" onClick={handleCancel} autoFocus
                  style={{
                    padding: '5px 14px', fontSize: 12, borderRadius: 4, cursor: 'pointer',
                    background: palette.button, color: palette.text,
                    border: `1px solid ${palette.buttonBorder}`,
                  }}>{ebt('Cancel', lang)}</button>
                <button type="button" onClick={handleOk}
                  style={{
                    padding: '5px 14px', fontSize: 12, borderRadius: 4, cursor: 'pointer',
                    background: palette.accent, color: '#fff', border: 'none',
                  }}>OK</button>
              </div>
            </div>
          </div>,
          document.body,
        );
      })()}
    </div>
  );
}

function FilterSelect({title, label, value, onChange, options, palette}) {
  const selectedLabel = options.find(([key]) => key === value)?.[1];
  return (
    <select aria-label={title} title={selectedLabel ? `${title} · ${selectedLabel}` : title}
      value={value ?? ''} onChange={event => onChange(event.target.value || null)}
      style={{width: '100%', minWidth: 0, height: 28, boxSizing: 'border-box',
        appearance: 'none', textAlign: 'center', textOverflow: 'ellipsis', padding: '0 3px',
        borderRadius: 5, border: `1px solid ${value ? palette.accent : palette.buttonBorder}`,
        background: value ? palette.accent : palette.button, color: value ? '#fff' : palette.text,
        font: '11px system-ui, sans-serif', cursor: 'pointer'}}>
      <option value="">{label}</option>
      {options.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
    </select>
  );
}

/* deviceCompat / deviceCompatReason removed 2026-09-07. They existed only to
 * grey a catalogue card against the CURRENTLY selected device, which is a
 * device the learner has not chosen yet — the catalogue is browsed before the
 * chip is picked. The same fact is expressed where it is actionable, in the
 * confirm dialog's device picker, which greys each unavailable device with
 * its own refusal reason. Deleted rather than left unused so nothing
 * reintroduces the pre-selection by finding a helper that invites it. */

export const DEVICE_LABELS = {
  stc12c5a60s2: 'STC12', stc89c52rc: 'STC89', stc15f2k60s2: 'STC15',
  'arduino-uno': 'Uno', 'arduino-nano': 'Nano', 'arduino-mega': 'Mega',
  pico: 'Pico', attiny85: 'ATtiny85', attiny88: 'ATtiny88', attiny13: 'ATtiny13', attiny2313: 'ATtiny2313',
  atmega168p: 'ATmega168P', atmega328p: 'ATmega328P', atmega2560: 'ATmega2560',
  eater6502: '6502 Breadboard', gpascal: 'G-Pascal', z80: 'Z80', microbit: 'micro:bit',
};

// ── Per-example device persistence ────────────────────────────────
const DEVICE_STORAGE_KEY = 'bw-example-device';
function loadDeviceChoices() {
  try { return JSON.parse(localStorage.getItem(DEVICE_STORAGE_KEY)) || {}; } catch { return {}; }
}
function saveDeviceChoice(exampleId, device) {
  try {
    const m = loadDeviceChoices();
    m[exampleId] = device;
    localStorage.setItem(DEVICE_STORAGE_KEY, JSON.stringify(m));
  } catch { /* privacy mode */ }
}
function savedDeviceFor(exampleId) {
  return loadDeviceChoices()[exampleId] || null;
}

/**
 * DevicePicker — compact chip-row for choosing which device runs an example.
 * Rendered on cards whose `devices` array has more than one entry.
 */
export function DevicePicker({ devices, selected, onSelect, palette }) {
  if (!devices || devices.length <= 1) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 3 }}
      data-testid="bw-device-picker">
      {devices.map(d => {
        const active = d === selected;
        return (
          <button key={d} type="button"
            onClick={e => { e.stopPropagation(); onSelect(d); }}
            style={{
              padding: '1px 6px', borderRadius: 8, fontSize: 9, fontWeight: active ? 700 : 500,
              fontFamily: 'inherit', cursor: 'pointer', lineHeight: '16px',
              background: active ? palette.accent : palette.button,
              color: active ? '#fff' : palette.muted,
              border: `1px solid ${active ? palette.accent : palette.buttonBorder}`,
            }}>
            {DEVICE_LABELS[d] || d}
          </button>
        );
      })}
    </div>
  );
}

let artworkObserver;
function ExampleArtwork({ url }) {
  const image = useRef(null);
  useEffect(() => {
    const element = image.current;
    if (typeof IntersectionObserver === 'undefined') {
      element.src = url;
      return;
    }
    // Native lazy loading can fetch the whole catalogue inside nested panes.
    // Share one observer and let the viewport and scrolling panes clip its targets.
    artworkObserver ??= new IntersectionObserver(entries => {
      for (const { target, isIntersecting } of entries) {
        if (isIntersecting && target.isConnected) {
          target.src = target.dataset.exampleArtwork;
          artworkObserver.unobserve(target);
        }
      }
    }, { rootMargin: '160px' });
    artworkObserver.observe(element);
    return () => artworkObserver.unobserve(element);
  }, [url]);

  return <img ref={image} data-example-artwork={url} alt="" width={44} height={34}
    loading="lazy" decoding="async" draggable={false}
    style={{ objectFit: 'contain', flexShrink: 0, borderRadius: 3 }} />;
}

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
      data-example-id={example.id}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={disabledReason || ebt(CATEGORY_LABELS[example.category] || example.category, lang)}
      style={{
        padding: '4px 6px',
        background: hovered && !disabled ? palette.cardHover : palette.card,
        border: `1px solid ${catColor}`,
        borderRadius: '4px',
        transition: 'border-color 80ms, background 80ms',
        opacity: disabled ? 0.7 : 1,
      }}
    >
      <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 18}}>
        {diff ? <span aria-label={ebt(diff, lang)} title={ebt(diff, lang)}
          style={{color: palette.muted, fontSize: 9, letterSpacing: '.06em'}}>
          {'★'.repeat(example.difficulty)}{'☆'.repeat(3 - example.difficulty)}
        </span> : <span />}
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
      <button type="button" onClick={onClick} style={{display: 'flex', alignItems: 'center', textAlign: 'start',
        width: '100%', minWidth: 0, gap: 6, padding: 0, border: 0, background: 'transparent',
        color: palette.heading, fontSize: 12, fontWeight: 650, cursor: 'pointer', lineHeight: 1.3}}>
        {example.artworkUrl && <ExampleArtwork key={example.artworkUrl} url={example.artworkUrl} />}
        <span style={{minWidth: 0, overflowWrap: 'anywhere'}}>{title}</span>
      </button>
      {disabled && disabledReason && (
        <div style={{ color: '#94a3b8', fontSize: '11px', marginTop: '4px', fontStyle: 'italic',
          cursor: 'pointer' }} onClick={() => onClick()}
          title={/^de/i.test(lang) ? 'Klicken zum Laden — Gerät wird automatisch gewechselt' : 'Click to load — device will switch automatically'}>
          {disabledReason}
        </div>
      )}
      {/* Intro READER — an almost-fullscreen modal via portal. The old
          inline expander squeezed real intros into the card's few dozen
          pixels (owner: "the (i) must display as an almost-fullscreen
          modal"). The portal escapes the list frame entirely; the same
          reader becomes the Lehrpfad's station view later. */}
      {introOpen && createPortal(
        <div
          onClick={() => setIntroOpen(false)}
          onKeyDown={e => { if (e.key === 'Escape') setIntroOpen(false); }}
          role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}
          ref={el => el && el.focus()}
          style={{ position: 'fixed', inset: 0, zIndex: 3000,
            background: 'rgba(10, 16, 28, 0.62)', backdropFilter: 'blur(2px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div onClick={e => e.stopPropagation()}
          style={{ width: 'min(880px, 94vw)', maxHeight: '90vh', overflowY: 'auto',
            padding: '22px 28px 18px', background: palette.panel,
            border: `1px solid ${palette.border}`, borderRadius: 12,
            boxShadow: '0 24px 64px rgba(0,0,0,0.45)', zoom: 1.2 }}
          data-testid="bw-example-intro-panel">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
            <div style={{ fontSize: 17, fontWeight: 750, color: palette.heading, flex: 1 }}>{title}</div>
            {diff && <span style={{ color: palette.muted, fontSize: 12 }}>
              {'★'.repeat(example.difficulty)}{'☆'.repeat(3 - example.difficulty)}</span>}
            <span style={{ fontSize: 11, color: palette.text, background: `${catColor}22`,
              padding: '2px 8px', borderRadius: 4 }}>{example.category}</span>
            <button type="button" onClick={() => setIntroOpen(false)} aria-label="Close"
              style={{ width: 26, height: 26, border: 'none', borderRadius: '50%',
                background: palette.button, color: palette.text, cursor: 'pointer',
                fontSize: 14, fontWeight: 700, lineHeight: 1 }}>×</button>
          </div>
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
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            {!disabled && (
              <button type="button"
                onClick={() => { setIntroOpen(false); onClick(pickedDevice); }}
                data-testid="bw-example-intro-open-bench"
                style={{ padding: '8px 18px', border: 'none', borderRadius: 8,
                  background: palette.accent, color: '#fff', fontSize: 13,
                  fontWeight: 700, cursor: 'pointer' }}>
                {lang === 'de' ? 'Auf die Werkbank' : 'Open on the bench'}
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

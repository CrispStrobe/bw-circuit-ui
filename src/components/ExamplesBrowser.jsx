/**
 * ExamplesBrowser — gallery panel showing example circuits + programs.
 *
 * Reads examples/index.json from bw-cfront and renders categorized cards.
 * Click loads the example's circuit into the designer.
 * Presentation-only: no canvas interaction.
 */

import React, { useState, useEffect, useMemo } from 'react';
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
const CATEGORY_COLORS = {
  basics: '#2ecc71',
  analog: '#f39c12',
  digital: '#9b59b6',
  motors: '#e74c3c',
  'pure-circuit': '#16a085',
};

const DIFFICULTY_LABELS = ['', 'Beginner', 'Intermediate', 'Advanced'];


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
  const open = true;

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
      {/* Collapse control now lives in CircuitDesigner at left: -13,
         aligned with the Parts panel's control. */}
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
      </div>}

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
                Open &ldquo;{pTitle}&rdquo;?
              </div>
              {hasDevices && (
                <div style={{ marginBottom: 12 }}>
                  <label style={{ color: palette.muted, fontSize: 11, display: 'block', marginBottom: 4 }}>
                    Chip
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
                          {(DEVICE_LABELS[d] || d) + (refusal ? ' — unavailable: ' + refusal : '')}
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
                  }}>Cancel</button>
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
          onClick={() => onClick()}>{title}</div>
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

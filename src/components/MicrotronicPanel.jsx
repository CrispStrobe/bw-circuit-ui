// SPDX-License-Identifier: MIT
import React, {useEffect, useRef, useState} from 'react';
import {MICROTRONIC_KEY_ROWS, microtronicControl, microtronicKeyboardKey} from '../model/microtronic-controls.js';
import {MICROTRONIC_EXAMPLES} from '../model/microtronic-demo.js';
import './microtronic-panel.css';

// Original seven-segment drawing. The engine supplies the six characters.
const DIGITS = {0:'abcdef', 1:'bc', 2:'abdeg', 3:'abcdg', 4:'bcfg', 5:'acdfg',
  6:'acdefg', 7:'abc', 8:'abcdefg', 9:'abcdfg', A:'abcefg', B:'cdefg', C:'adef',
  D:'bcdeg', E:'adefg', F:'aefg', r:'eg', '-':'g', ' ':''};
const SEGMENTS = {a:[5,2,15,3], b:[21,6,3,15], c:[21,26,3,15], d:[5,42,15,3],
  e:[1,26,3,15], f:[1,6,3,15], g:[5,22,15,3]};
export function MicrotronicDisplay({value = '      '}) {
  const display = String(value).padEnd(6, ' ').slice(0, 6);
  return <svg data-microtronic-display={display} className="microtronic-display" viewBox="0 0 188 55"
    role="img" aria-label={`Microtronic display: ${display}`}>
    <title>{display}</title>
    {[...display].map((digit, i) => <g key={i} transform={`translate(${5 + i * 30},4)`}>
      {Object.entries(SEGMENTS).map(([segment, [x,y,width,height]]) => <rect key={segment}
        x={x} y={y} width={width} height={height} rx="1"
        fill={(DIGITS[digit] || DIGITS[digit.toUpperCase()] || '').includes(segment) ? '#ff654c' : '#321d24'} />)}
    </g>)}
  </svg>;
}

const hex = (n, width = 1) => Number(n || 0).toString(16).toUpperCase().padStart(width, '0');
function BitLamps({name, value}) {
  return <div className="microtronic-bits"><span>{name}</span>{[0,1,2,3].map(bit =>
    <span key={bit} data-microtronic-bit={`${name}${bit + 1}`} data-high={!!(value & (1 << bit))}
      aria-label={`${name}${bit + 1}: ${value & (1 << bit) ? 1 : 0}`}>
      <i />{bit + 1}
    </span>)}</div>;
}

/** All state, execution and time are owned by the actual circuit Board. */
export function MicrotronicPanel({part, board, lang = 'en', onProgramChange, onExecutionModeChange, onRunClock, onOpenExample, externalClock = false, variant = 'full', Editor}) {
  const showFront = variant !== 'code';
  const showCode = variant !== 'front';
  const de = /^de/i.test(lang);
  const tr = (en, german) => de ? german : en;
  const source = part.params?.program || 'F00';
  const [draft, setDraft] = useState(source);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const [, redraw] = useState(0);
  const fileInput = useRef(null);
  const identity = useRef(null);
  // A loaded circuit can reuse an id; its part object still changes. Old file
  // promises must never write into that replacement, or a different board.
  useEffect(() => {
    const token = {}; identity.current = token;
    setDraft(part.params?.program || 'F00'); setDirty(false); dirtyRef.current = false;
    setError(null); setNotice('');
    return () => { if (identity.current === token) identity.current = null; };
  }, [board, part]);
  useEffect(() => { if (!dirtyRef.current) setDraft(source); }, [source]);

  const state = board?.getDeviceState?.(part.id);
  const editDraft = value => { setDraft(value); setDirty(true); dirtyRef.current = true; setNotice(''); };
  const acceptDraft = next => {
    setDraft(next.programSource); setDirty(false); dirtyRef.current = false;
  };
  const control = (verb, value) => microtronicControl({board, part, verb, value, onProgramChange});
  const command = (verb, value) => {
    try {
      setError(null); setNotice('');
      const starts = verb === 'run' || verb === 'step' || (verb === 'key' && ['RUN', 'STEP'].includes(value));
      if (starts && dirtyRef.current) acceptDraft(control('loadProgram', draft));
      const next = control(verb, value);
      if (verb === 'loadProgram') {
        acceptDraft(next);
        setNotice(tr('Program loaded. Address 00 is ready.', 'Programm geladen. Adresse 00 ist bereit.'));
      } else if (!dirtyRef.current) setDraft(next.programSource);
      if (next.running && (verb === 'run' || (verb === 'key' && value === 'RUN'))) onRunClock?.();
      redraw(n => n + 1);
      return next;
    } catch (e) { setError(String(e.message || e)); redraw(n => n + 1); return null; }
  };
  const loadFile = async event => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    const token = identity.current;
    try {
      if (file.size > 65536) throw new Error(tr('Program files must be smaller than 64 KB.', 'Programmdateien müssen kleiner als 64 KB sein.'));
      const text = await file.text();
      if (!token || identity.current !== token) return;
      editDraft(text); setError(null);
      setNotice(tr(`${file.name} is ready to load.`, `${file.name} ist bereit zum Laden.`));
    } catch (e) { if (token && identity.current === token) setError(String(e.message || e)); }
  };
  const waiting = state?.waitingForKey != null;
  const native = state?.model === 'tms1600';
  return <section className={variant === 'code' ? 'microtronic-code-editor' : 'microtronic-panel'}
    data-microtronic-panel={part.id} data-microtronic-view={variant} tabIndex={0}
    aria-label={`Busch Microtronic ${part.declName || part.id}`}
    onKeyDown={event => {
      // Keep the canvas's delete/rotate/run shortcuts out of a focused trainer.
      event.stopPropagation();
      if (!showFront) return;
      const key = microtronicKeyboardKey(event, state?.running);
      if (key) { event.preventDefault(); command('key', key); }
    }}>
    {showFront && <header><div><strong>BUSCH MICROTRONIC</strong><small>2090 · {part.declName || part.id}</small></div>
      <select className="microtronic-model" aria-label={tr('Microtronic execution mode', 'Microtronic-Ausführungsmodus')}
        value={native ? 'tms1600' : 'documented-behavior'} disabled={!state || !onExecutionModeChange}
        onChange={event => onExecutionModeChange(part.id, event.target.value)}>
        <option value="documented-behavior">{tr('Behavioral', 'Verhaltensmodell')}</option>
        <option value="tms1600">TMS1600</option>
      </select></header>}
    {showFront && (!state ? <p role="alert">{tr('This board has no Microtronic engine.', 'Diese Platine hat keine Microtronic-Engine.')}</p> : <>
      <MicrotronicDisplay value={state.display} />
      <div className="microtronic-status" data-microtronic-status>
        <strong>{waiting ? tr('Waiting for key', 'Wartet auf Taste') : state.running ? tr('Running', 'Läuft') : tr('Halted', 'Angehalten')}</strong>
        <span>PC {hex(state.pc, 2)}</span><span data-active={!!state.carry}>C</span><span data-active={!!state.zero}>Z</span>
        <span data-active={!!state.clockHigh}>1 Hz</span>
      </div>
      <div className="microtronic-io"><BitLamps name="IN" value={state.input} /><BitLamps name="OUT" value={state.output} /></div>
      <div className="microtronic-actions">
        <button type="button" data-microtronic-action="run" onClick={() => command('run')}>{tr('Run', 'Start')}</button>
        <button type="button" data-microtronic-action="halt" onClick={() => command('halt')}>{tr('Halt', 'Stopp')}</button>
        <button type="button" data-microtronic-action="step" onClick={() => command('step')}>{tr('Step', 'Schritt')}</button>
        <button type="button" data-microtronic-action="reset" onClick={() => command('reset')}>Reset</button>
      </div>
      <div className="microtronic-keypad" role="group" aria-label={tr('Microtronic keypad', 'Microtronic-Tastatur')}>
        {MICROTRONIC_KEY_ROWS.flat().map(key => <button type="button" key={key} data-microtronic-key={key}
          className={key.length > 1 ? 'microtronic-function' : ''} onClick={() => command('key', key)}>{key}</button>)}
      </div>
      <div className="microtronic-mode">{native
        ? <span title={tr('Native ROM instruction address', 'Native ROM-Befehlsadresse')}>ROM {hex(state.nativeAddress, 3)}</span>
        : state.mode} · {part.params?.instructionHz ?? 20} {tr('instructions/s', 'Befehle/s')}</div>
    </>)}
    {(error || state?.error) && <p className="microtronic-error" role="alert">{error || state.error}</p>}
    {showCode && <div className="microtronic-editor">
      <label>{tr('Example', 'Beispiel')}<select aria-label={tr('Microtronic example', 'Microtronic-Beispiel')} defaultValue=""
        onChange={event => { const example = MICROTRONIC_EXAMPLES.find(e => e.id === event.target.value); if (example) editDraft(example.source); event.target.value = ''; }}>
        <option value="">{tr('Choose a program…', 'Programm wählen…')}</option>
        {MICROTRONIC_EXAMPLES.map(e => <option value={e.id} key={e.id}>{de ? e.nameDe : e.name}</option>)}
      </select></label>
      <div className="microtronic-editor-actions">
        <button type="button" data-microtronic-load onClick={() => command('loadProgram', draft)} disabled={!state}>{tr('Load program', 'Programm laden')}</button>
        {variant === 'code' && <button type="button" data-microtronic-run-source
          disabled={!state} onClick={() => command('run')}>{tr('Run', 'Start')}</button>}
        <button type="button" onClick={() => fileInput.current?.click()}>{tr('Open file…', 'Datei öffnen…')}</button>
        <input ref={fileInput} type="file" accept=".mic,.txt,.hex,text/plain" hidden onChange={loadFile} aria-label={tr('Microtronic program file', 'Microtronic-Programmdatei')} />
      </div>
      {Editor ? <React.Suspense fallback={null}>
        <Editor value={draft} onChange={editDraft} lang="asm" isVisible />
      </React.Suspense> : (<textarea aria-label={tr('Microtronic program', 'Microtronic-Programm')} value={draft}
        onChange={event => editDraft(event.target.value)} spellCheck={false} rows={5} />)}
      {dirty && <span>{tr('Not loaded', 'Nicht geladen')}</span>}
      {notice && <p className="microtronic-notice" role="status">{notice}</p>}
    </div>}
    {onOpenExample && <button className="microtronic-example" type="button" onClick={onOpenExample}>{tr('Open wired I/O example', 'Verdrahtetes E/A-Beispiel öffnen')}</button>}
    {showFront && state && <details><summary>{tr('Registers', 'Register')}</summary><div className="microtronic-registers">
      {state.registers.map((value, i) => <span key={i}>R{hex(i)} <b>{hex(value)}</b></span>)}
    </div></details>}
    {showFront && <details className="microtronic-help"><summary>{tr('Keys, wiring and model', 'Tasten, Verdrahtung und Modell')}</summary>
      <p>{tr('HALT → NEXT → two hex digits selects an address. Enter three instruction digits, then NEXT to store and advance. HALT → REG → a hex digit selects a working register. RESET keeps the program.', 'HALT → NEXT → zwei Hex-Ziffern wählt eine Adresse. Drei Befehlsziffern eingeben, dann mit NEXT speichern und weitergehen. HALT → REG → eine Hex-Ziffer wählt ein Arbeitsregister. RESET behält das Programm.')}</p>
      <p>{tr('IN1/OUT1 carries bit 0. The 1 Hz CLOCK is independent; connect CLOCK to IN4 for clock programs. The 5v and gnd terminals supply external experiments. The wired example has three switches and four LED outputs.', 'IN1/OUT1 trägt Bit 0. Der 1-Hz-Takt CLOCK ist unabhängig; für Uhrprogramme CLOCK mit IN4 verbinden. 5v und gnd versorgen externe Experimente. Das verdrahtete Beispiel hat drei Schalter und vier LED-Ausgänge.')}</p>
      <p>{native
        ? tr('TMS1600 runs the Brickwright monitor ROM with simulated digital peripherals. Some learner instructions and monitor commands are still experimental.', 'TMS1600 führt das Brickwright-Monitor-ROM mit simulierten digitalen Peripheriegeräten aus. Einige Lernbefehle und Monitorfunktionen sind noch experimentell.')
        : tr('The behavioral model runs the documented learner instructions. PGM 3/4 sets/views the clock and PGM 5/6 fills memory.', 'Das Verhaltensmodell führt die dokumentierten Lernbefehle aus. PGM 3/4 stellt/zeigt die Uhr, PGM 5/6 füllt den Speicher.')}</p>
      <p>{externalClock ? tr('The connected host owns simulation time.', 'Der angeschlossene Host steuert die Simulationszeit.') : tr('Run starts the shared circuit simulation. Halt stops this computer; Pause in the circuit toolbar freezes the whole experiment.', 'Start startet die gemeinsame Schaltungssimulation. Stopp hält diesen Computer an; Pause in der Schaltungsleiste hält das gesamte Experiment an.')}</p>
      <p>{tr('Circuit edits in Build rebuild the board and reset runtime registers. Loaded programs stay with each part and are saved with the circuit.', 'Schaltungsänderungen im Bauen-Modus erstellen die Platine neu und setzen Laufzeitregister zurück. Geladene Programme bleiben bei ihrem Bauteil und werden mit der Schaltung gespeichert.')}</p>
      <p>{tr('With this panel focused: hex keys enter digits, Enter is NEXT, Escape is HALT, Space toggles Run/Halt.', 'Bei fokussiertem Panel: Hex-Tasten geben Ziffern ein, Eingabe ist NEXT, Escape ist HALT, Leertaste schaltet Start/Stopp um.')}</p>
    </details>}
  </section>;
}

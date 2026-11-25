// SPDX-License-Identifier: MIT
import React, {useEffect, useRef, useState} from 'react';
import {KIM1_KEY_ROWS, kim1Control, kim1KeyboardKey} from '../model/kim1-controls.js';
import {KIM1_EXAMPLES} from '../model/kim1-demo.js';
import './kim1-panel.css';

// Original vector display. The four address digits and two data digits have a gap.
const GLYPHS = {0:'abcdef', 1:'bc', 2:'abdeg', 3:'abcdg', 4:'bcfg', 5:'acdfg',
  6:'acdefg', 7:'abc', 8:'abcdefg', 9:'abcdfg', A:'abcefg', B:'cdefg', C:'adef',
  D:'bcdeg', E:'adefg', F:'aefg', '-':'g', ' ':''};
const SEGMENTS = {a:[4,1,14,3], b:[19,5,3,13], c:[19,23,3,13], d:[4,37,14,3],
  e:[0,23,3,13], f:[0,5,3,13], g:[4,19,14,3]};
export function Kim1Display({value = '020000'}) {
  const display = String(value).padEnd(6, ' ').slice(0, 6);
  return <svg className="kim1-display" data-kim1-display={display} viewBox="0 0 196 53"
    role="img" aria-label={`KIM-1 display: ${display.slice(0,4)} ${display.slice(4)}`}>
    <title>{`${display.slice(0,4)} ${display.slice(4)}`}</title>
    {[...display].map((digit, index) => <g key={index} transform={`translate(${7 + index * 29 + (index >= 4 ? 8 : 0)},6)`}>
      {Object.entries(SEGMENTS).map(([segment, [x,y,width,height]]) => <rect key={segment}
        x={x} y={y} width={width} height={height} rx="1"
        fill={(GLYPHS[digit.toUpperCase()] || '').includes(segment) ? '#ff705c' : '#351d22'} />)}
    </g>)}
  </svg>;
}

const hex = (value, width = 2) => Number(value || 0).toString(16).toUpperCase().padStart(width, '0');

export function Kim1Panel({part, board, lang = 'en', onProgramChange, onRunClock, onOpenExample, externalClock = false}) {
  const de = /^de/i.test(lang);
  const tr = (en, german) => de ? german : en;
  const source = part.params?.program || '0200: EA 4C 00 02';
  const [draft, setDraft] = useState(source);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const [, redraw] = useState(0);
  const fileInput = useRef(null);
  const identity = useRef(null);
  useEffect(() => {
    const token = {}; identity.current = token;
    setDraft(part.params?.program || '0200: EA 4C 00 02');
    setDirty(false); dirtyRef.current = false; setError(null); setNotice('');
    return () => { if (identity.current === token) identity.current = null; };
  }, [board, part]);
  useEffect(() => { if (!dirtyRef.current) setDraft(source); }, [source]);
  const state = board?.getDeviceState?.(part.id);
  const editDraft = value => { setDraft(value); setDirty(true); dirtyRef.current = true; setNotice(''); };
  const accept = next => { setDraft(next.programSource); setDirty(false); dirtyRef.current = false; };
  const control = (verb, value) => kim1Control({board, part, verb, value, onProgramChange});
  const command = (verb, value) => {
    try {
      setError(null); setNotice('');
      const starts = verb === 'run' || verb === 'step' || (verb === 'key' && value === 'GO');
      if (starts && dirtyRef.current) accept(control('loadProgram', draft));
      const next = control(verb, value);
      if (verb === 'loadProgram') {
        accept(next);
        setNotice(tr(`Program loaded at ${hex(next.address,4)}.`, `Programm bei ${hex(next.address,4)} geladen.`));
      } else if (!dirtyRef.current) setDraft(next.programSource);
      if (next.running && starts) onRunClock?.();
      redraw(value => value + 1);
      return next;
    } catch (problem) { setError(String(problem.message || problem)); redraw(value => value + 1); return null; }
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
    } catch (problem) { if (identity.current === token) setError(String(problem.message || problem)); }
  };
  const saveFile = () => {
    const url = URL.createObjectURL(new Blob([state?.programSource || source], {type:'text/plain'}));
    const link = document.createElement('a'); link.href = url; link.download = 'kim-1-program.hex'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section className="kim1-panel" data-kim1-panel={part.id} tabIndex={0}
    aria-label={`KIM-1 ${part.declName || part.id}`} onKeyDown={event => {
      event.stopPropagation();
      const key = kim1KeyboardKey(event, state?.running);
      if (key) { event.preventDefault(); command('key', key); }
    }}>
    <header><div><strong>KIM-1</strong><small>MOS 6502 · {part.declName || part.id}</small></div>
      <span className="kim1-badge">{tr('Learning monitor', 'Lernmonitor')}</span></header>
    {!state ? <p role="alert">{tr('This board has no KIM-1 engine.', 'Diese Platine hat keine KIM-1-Engine.')}</p> : <>
      <Kim1Display value={state.display} />
      <div className="kim1-display-labels"><span>{tr('Address', 'Adresse')}</span><span>{tr('Data', 'Daten')}</span></div>
      <div className="kim1-status" data-kim1-status><strong>{state.running ? tr('Running', 'Läuft') : tr('Stopped', 'Angehalten')}</strong>
        <span>PC {hex(state.pc,4)}</span><span>{state.mode === 'data' ? 'DA' : state.mode === 'run' ? 'GO' : 'AD'}</span></div>
      <div className="kim1-run-keys">
        {['GO','ST','RS'].map(key => <button type="button" key={key} data-kim1-key={key}
          title={key === 'GO' ? tr('Execute from selected address', 'Ab gewählter Adresse ausführen') : key === 'ST' ? tr('Stop', 'Anhalten') : tr('Reset; keep RAM', 'Reset; RAM bleibt erhalten')}
          onClick={() => command('key',key)}>{key}</button>)}
        <label title={tr('GO executes one instruction', 'GO führt einen Befehl aus')}>
          <input type="checkbox" data-kim1-sst aria-label="KIM-1 SST" checked={!!state.singleStep}
            onChange={event => command('setSst',event.target.checked)} />SST</label>
      </div>
      <div className="kim1-keypad" role="group" aria-label={tr('KIM-1 keypad', 'KIM-1-Tastatur')}>
        {KIM1_KEY_ROWS.flat().map(key => <button type="button" key={key} data-kim1-key={key}
          className={key.length > 1 || key === '+' ? 'kim1-function' : ''} onClick={() => command('key',key)}>{key}</button>)}
      </div>
      <div className="kim1-registers"><span>A <b>{hex(state.cpu?.a)}</b></span><span>X <b>{hex(state.cpu?.x)}</b></span>
        <span>Y <b>{hex(state.cpu?.y)}</b></span><span>SP <b>{hex(state.cpu?.s)}</b></span><span>P <b>{hex(state.cpu?.p)}</b></span></div>
      <div className="kim1-ports"><span>PA <b>{hex(state.portA)}</b></span><span>PB <b>{hex(state.portB)}</b></span>
        <span>DDR <b>{hex(state.ddrA)}/{hex(state.ddrB)}</b></span></div>
    </>}
    {(error || state?.error) && <p className="kim1-error" role="alert">{error || state.error}</p>}
    <details open className="kim1-editor"><summary>{tr('Program', 'Programm')} {dirty && <span>· {tr('not loaded', 'nicht geladen')}</span>}</summary>
      <label>{tr('Example', 'Beispiel')}<select aria-label={tr('KIM-1 example', 'KIM-1-Beispiel')} defaultValue=""
        onChange={event => { const example = KIM1_EXAMPLES.find(item => item.id === event.target.value); if (example) editDraft(example.source); event.target.value = ''; }}>
        <option value="">{tr('Choose a program…', 'Programm wählen…')}</option>
        {KIM1_EXAMPLES.map(example => <option key={example.id} value={example.id}>{de ? example.nameDe : example.name}</option>)}
      </select></label>
      <textarea aria-label={tr('KIM-1 program', 'KIM-1-Programm')} value={draft} spellCheck={false} rows={5}
        onChange={event => editDraft(event.target.value)} />
      <small>{tr('Hex address: bytes, for example 0200: A9 01. Load or GO applies the editor.', 'Hex-Adresse: Bytes, zum Beispiel 0200: A9 01. Laden oder GO übernimmt den Editor.')}</small>
      <div className="kim1-editor-actions">
        <button type="button" data-kim1-load disabled={!state} onClick={() => command('loadProgram',draft)}>{tr('Load program', 'Programm laden')}</button>
        <button type="button" onClick={() => fileInput.current?.click()}>{tr('Open…', 'Öffnen…')}</button>
        <button type="button" disabled={!state} onClick={saveFile}>{tr('Save', 'Speichern')}</button>
        <input ref={fileInput} type="file" hidden accept=".hex,.txt,.kim,text/plain" onChange={loadFile}
          aria-label={tr('KIM-1 program file', 'KIM-1-Programmdatei')} />
      </div>
      {notice && <p className="kim1-notice" role="status">{notice}</p>}
    </details>
    {onOpenExample && <button type="button" className="kim1-wired-example" onClick={onOpenExample}>
      {tr('Open wired I/O example', 'Verdrahtetes E/A-Beispiel öffnen')}</button>}
    <details className="kim1-help"><summary>{tr('Keys and wiring', 'Tasten und Verdrahtung')}</summary>
      <p>{tr('AD selects an address; enter four hex digits. DA edits its byte; enter two digits. + advances. GO runs from the displayed address, or executes one instruction with SST enabled. ST stops; PC returns to the stopped program counter; RS resets and keeps RAM.', 'AD wählt die Adresse: vier Hex-Ziffern eingeben. DA ändert das Byte: zwei Ziffern eingeben. + geht weiter. GO startet an der angezeigten Adresse oder führt mit SST einen Befehl aus. ST hält an; PC zeigt den angehaltenen Programmzähler; RS setzt zurück und behält RAM.')}</p>
      <p>{tr('PA0–PA7, PB0–PB5 and PB7 are the 15 user I/O pins. Set data directions at $1701/$1703 and use ports $1700/$1702. A set direction bit is an output. 5v and gnd power external experiments.', 'PA0–PA7, PB0–PB5 und PB7 sind die 15 Benutzer-E/A-Pins. Datenrichtungen liegen bei $1701/$1703, Ports bei $1700/$1702. Ein gesetztes Richtungsbit bedeutet Ausgang. 5v und gnd versorgen externe Versuche.')}</p>
      <p>{tr(`CPU clock: ${part.params?.clockHz ?? 1000} Hz on the shared circuit clock, slowed for learning from the original 1 MHz. An independently written monitor provides the front panel. Historical ROM, cassette/TTY routines and cycle-level bus timing are outside this first Circuits model.`, `CPU-Takt: ${part.params?.clockHz ?? 1000} Hz im gemeinsamen Schaltungstakt, zum Lernen gegenüber den ursprünglichen 1 MHz verlangsamt. Ein unabhängig geschriebener Monitor bedient das Frontpanel. Historisches ROM, Kassetten-/TTY-Routinen und taktgenaues Bus-Timing gehören nicht zu diesem ersten Schaltungsmodell.`)}</p>
      <p>{externalClock ? tr('The connected host controls simulation time.', 'Der angeschlossene Host steuert die Simulationszeit.') : tr('GO starts circuit simulation. ST stops this computer; Pause in the circuit toolbar freezes the whole experiment.', 'GO startet die Schaltungssimulation. ST hält diesen Computer an; Pause in der Schaltungsleiste hält den gesamten Versuch an.')}</p>
      <p>{tr('Programs and keypad edits stay with each part when you save the circuit. Build edits reset runtime registers. With this panel focused: hex keys enter digits, Enter is +, Escape is ST, Space is GO/ST.', 'Programme und Tastatureingaben werden mit dem Bauteil gespeichert. Änderungen im Bauen-Modus setzen Laufzeitregister zurück. Bei fokussiertem Panel: Hex-Tasten geben Ziffern ein, Eingabe ist +, Escape ist ST, Leertaste ist GO/ST.')}</p>
    </details>
  </section>;
}

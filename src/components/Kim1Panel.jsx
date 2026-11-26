// SPDX-License-Identifier: MIT
import React, {useEffect, useRef, useState} from 'react';
import {KIM1_KEY_ROWS, kim1Control, kim1KeyboardKey} from '../model/kim1-controls.js';
import {exportKim1MemoryCard} from 'bw-board/kim1-expansion.js';
import {Kim1Video} from './Kim1Video.jsx';
import {AceKimPanel} from './AceKimPanel.jsx';
import {KIM1_EXAMPLES} from '../model/kim1-demo.js';
import './kim1-panel.css';

// Original vector display. The four address digits and two data digits have a gap.
const GLYPHS = {0:'abcdef', 1:'bc', 2:'abdeg', 3:'abcdg', 4:'bcfg', 5:'acdfg',
  6:'acdefg', 7:'abc', 8:'abcdefg', 9:'abcdfg', A:'abcefg', B:'cdefg', C:'adef',
  D:'bcdeg', E:'adefg', F:'aefg', '-':'g', ' ':''};
const SEGMENTS = {a:[4,1,14,3], b:[19,5,3,13], c:[19,23,3,13], d:[4,37,14,3],
  e:[0,23,3,13], f:[0,5,3,13], g:[4,19,14,3]};
export function Kim1Display({value = '020000', masks}) {
  const display = String(value).padEnd(6, ' ').slice(0, 6);
  return <svg className="kim1-display" data-kim1-display={display} viewBox="0 0 196 53"
    role="img" aria-label={`KIM-1 display: ${display.slice(0,4)} ${display.slice(4)}`}>
    <title>{`${display.slice(0,4)} ${display.slice(4)}`}</title>
    {[...display].map((digit, index) => <g key={index} transform={`translate(${7 + index * 29 + (index >= 4 ? 8 : 0)},6)`}>
      {Object.entries(SEGMENTS).map(([segment, [x,y,width,height]], bit) => <rect key={segment}
        x={x} y={y} width={width} height={height} rx="1"
        fill={(masks ? masks[index] & (1 << bit) : (GLYPHS[digit.toUpperCase()] || '').includes(segment)) ? '#ff705c' : '#351d22'} />)}
    </g>)}
  </svg>;
}

const EXPANSION_MODULES = ['kim-2', 'kim-3', 'kim-3b', 'kim-5'];

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
  const [ttyInput, setTtyInput] = useState('');
  const [slots, setSlots] = useState([]);
  const [slotKind, setSlotKind] = useState('kim-2');
  const [slotAddress, setSlotAddress] = useState('2000');
  const [diskKind, setDiskKind] = useState('mountSD');
  const [drive, setDrive] = useState(0);
  const [showExpansion, setShowExpansion] = useState(false);
  const [, redraw] = useState(0);
  const fileInput = useRef(null);
  const romInput = useRef(null);
  const identity = useRef(null);
  useEffect(() => {
    const token = {}; identity.current = token;
    setDraft(part.params?.program || '0200: EA 4C 00 02');
    setDirty(false); dirtyRef.current = false; setError(null); setNotice(''); setTtyInput(''); setSlots([]);
    return () => { if (identity.current === token) identity.current = null; };
  }, [board, part]);
  useEffect(() => { if (!dirtyRef.current) setDraft(source); }, [source]);
  const state = board?.getDeviceState?.(part.id);
  const hardware = !!state?.roms;
  const brickwrightRom = state?.romSource === 'brickwright';
  const tty = !!state?.frontPanel?.tty;
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
      if (next.running && (starts || verb === 'loadRoms' || verb === 'useBrickwrightRom' || verb === 'setTty' || (hardware && verb === 'key'))) onRunClock?.();
      redraw(value => value + 1);
      return next;
    } catch (problem) { setError(String(problem.message || problem)); redraw(value => value + 1); return null; }
  };
  const loadFile = async event => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    const token = identity.current;
    try {
      if (file.size > 1048576) throw new Error(tr('Program files must be 1 MB or smaller.', 'Programmdateien müssen höchstens 1 MB groß sein.'));
      const text = await file.text();
      if (!token || identity.current !== token) return;
      editDraft(text); setError(null);
      setNotice(tr(`${file.name} is ready to load.`, `${file.name} ist bereit zum Laden.`));
    } catch (problem) { if (identity.current === token) setError(String(problem.message || problem)); }
  };
  const loadRoms = async event => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    const token = identity.current;
    try {
      let images;
      if (files.length === 1 && files[0].size === 2048) {
        const data = new Uint8Array(await files[0].arrayBuffer());
        images = [data.slice(0, 1024), data.slice(1024)];
      } else {
        const ordered = ['003', '002'].map(model => files.find(file => file.name.includes(model)));
        if (files.length !== 2 || ordered[0] === ordered[1] || !ordered.every(file => file?.size === 1024)) {
          throw new Error(tr('Choose the 6530-003 and 6530-002 images by filename, or a combined 2 KiB image.',
            '6530-003 und 6530-002 nach Dateinamen oder ein kombiniertes 2-KiB-Abbild wählen.'));
        }
        images = await Promise.all(ordered.map(async file => new Uint8Array(await file.arrayBuffer())));
      }
      if (token && identity.current === token) command('loadRoms', images);
    } catch (problem) { if (identity.current === token) setError(String(problem.message || problem)); }
  };
  const pickBinary = (verb, limit, convert = value => value, onSuccess) => async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const token = identity.current;
    try {
      if (file.size > limit) throw new Error(tr('File exceeds the size limit.', 'Die Datei ist zu groß.'));
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (token && identity.current === token) {
        const value = convert(bytes);
        if (command(verb, value)) onSuccess?.(value);
      }
    } catch (problem) {
      if (identity.current === token) setError(String(problem.message || problem));
    }
  };
  const updateSlots = next => {
    if (command('setBackplane', next.length ? next : null)) setSlots(next);
  };
  const download = (data, name, type = 'application/octet-stream') => {
    const url = URL.createObjectURL(new Blob([data], {type}));
    const link = document.createElement('a');
    link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const saveFile = () => {
    download(state?.programSource || source, 'kim-1-program.kim', 'text/plain');
  };
  return <section className="kim1-panel" data-kim1-panel={part.id} tabIndex={0}
    aria-label={`KIM-1 ${part.declName || part.id}`} onKeyDown={event => {
      event.stopPropagation();
      const runningUserCode = state?.running && (!hardware || (state.pc < 0x1800 || state.pc >= 0x2000));
      const key = kim1KeyboardKey(event, runningUserCode);
      if (key) { event.preventDefault(); command('key', key); }
    }}>
    <header><div><strong>KIM-1</strong><small>MOS 6502 · {part.declName || part.id}</small></div>
      <span className="kim1-badge">{brickwrightRom ? 'Brickwright ROM' : hardware ? tr('ROM monitor', 'ROM-Monitor') : tr('Learning monitor', 'Lernmonitor')}</span></header>
    {!state ? <p role="alert">{tr('This board has no KIM-1 engine.', 'Diese Platine hat keine KIM-1-Engine.')}</p> : <>
      <Kim1Display value={state.display} masks={hardware ? state.segments : undefined} />
      <div className="kim1-display-labels"><span>{tr('Address', 'Adresse')}</span><span>{tr('Data', 'Daten')}</span></div>
      <div className="kim1-status" data-kim1-status><strong>{hardware ? tr('Hardware', 'Hardware') : state.running ? tr('Running', 'Läuft') : tr('Stopped', 'Angehalten')}</strong>
        <span>PC {hex(state.pc,4)}</span><span>{hardware ? tty ? 'TTY' : 'KB' : state.mode === 'data' ? 'DA' : state.mode === 'run' ? 'GO' : 'AD'}</span></div>
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
      <small>{tr('Addressed hex, Intel HEX, or KIM-1 paper tape (.pap, .ptp).', 'Adressiertes Hex, Intel HEX oder KIM-1-Lochstreifen (.pap, .ptp).')}</small>
      <div className="kim1-editor-actions">
        <button type="button" data-kim1-load disabled={!state} onClick={() => command('loadProgram',draft)}>{tr('Load program', 'Programm laden')}</button>
        <button type="button" onClick={() => fileInput.current?.click()}>{tr('Open…', 'Öffnen…')}</button>
        <button type="button" disabled={!state} onClick={saveFile}>{tr('Save', 'Speichern')}</button>
        <input ref={fileInput} type="file" hidden accept=".hex,.ihx,.ihex,.pap,.ptp,.txt,.kim,text/plain" onChange={loadFile}
          aria-label={tr('KIM-1 program file', 'KIM-1-Programmdatei')} />
      </div>
      {notice && <p className="kim1-notice" role="status">{notice}</p>}
    </details>
    {state && 'roms' in state && <details className="kim1-help"><summary>{tr('Firmware and TTY', 'Firmware und TTY')}</summary>
      <div className="kim1-editor-actions">
        {'romSource' in state && <button type="button" aria-pressed={brickwrightRom}
          onClick={() => command('useBrickwrightRom')}>{tr('Use Brickwright ROM', 'Brickwright-ROM verwenden')}</button>}
        <button type="button" onClick={() => romInput.current?.click()}>{tr('Mount ROMs…', 'ROMs laden…')}</button>
        <input ref={romInput} data-kim1-rom-input type="file" multiple hidden accept=".bin,.rom,application/octet-stream"
          aria-label={tr('KIM-1 ROM images', 'KIM-1-ROM-Abbilder')} onChange={loadRoms} />
        {hardware && <>
          <button type="button" onClick={() => command('useTeachingMonitor')}>{tr('Learning monitor', 'Lernmonitor')}</button>
          <label><input type="checkbox" checked={tty}
            onChange={event => command('setTty', {enabled: event.target.checked, baud: 300})} />TTY</label>
        </>}
      </div>
      <small>{tr('ROMs stay in this simulation session. Combined image order: 6530-003, 6530-002.',
        'ROMs bleiben in dieser Simulationssitzung. Reihenfolge im kombinierten Abbild: 6530-003, 6530-002.')}</small>
    </details>}
    {state && 'backplane' in state && <details className="kim1-help" onToggle={event => setShowExpansion(event.currentTarget.open)}><summary>{tr('Expansion and storage', 'Erweiterung und Speicher')}</summary>
      <div className="kim1-editor-actions">
        <label><input type="checkbox" checked={!!state.expansion}
          onChange={event => command('setExpandedRam', event.target.checked)} />{tr('Expanded RAM', 'RAM-Erweiterung')}</label>
        <select aria-label="K-1008" value={state.k1008?.address ?? ''} onChange={event =>
          command('setK1008', event.target.value ? Number(event.target.value) : null)}>
          <option value="">K-1008 · {tr('Off', 'Aus')}</option>
          {[0x2000, 0x4000, 0x6000, 0x8000, 0xa000, 0xc000, 0xe000].map(address =>
            <option key={address} value={address}>K-1008 · {hex(address, 4)}</option>)}
        </select>
      </div>
      {showExpansion && state.k1008 && <Kim1Video device={state.k1008} memoryCard={state.memoryCard} />}
      <div className="kim1-editor-actions">
        <select aria-label={tr('KIM-4 module', 'KIM-4-Modul')} value={slotKind} onChange={event => setSlotKind(event.target.value)}>
          {EXPANSION_MODULES.map(kind => <option key={kind} value={kind}>{kind.toUpperCase()}</option>)}
        </select>
        {slotKind === 'kim-5' ? <input type="file" accept=".bin,.rom" aria-label="KIM-5 ROM"
          onChange={pickBinary('setBackplane', 6144, image => {
            const next = [...slots, {kind: 'kim-5', address: 0xe000, image}];
            if (slots.length >= 6) throw new Error(tr('KIM-4 has six slots.', 'KIM-4 hat sechs Steckplätze.'));
            return next;
          }, setSlots)} /> : <>
          <input aria-label={tr('Module address in hex', 'Moduladresse in Hex')} value={slotAddress} maxLength={4} size={5}
            onChange={event => setSlotAddress(event.target.value)} />
          <button type="button" disabled={slots.length >= 6 || !/^[0-9a-f]{4}$/i.test(slotAddress)}
            onClick={() => updateSlots([...slots, {kind: slotKind, address: parseInt(slotAddress, 16)}])}>{tr('Add RAM', 'RAM hinzufügen')}</button>
        </>}
      </div>
      <div className="kim1-editor-actions">{slots.map(({kind, address}, index) =>
        <button type="button" key={address} title={tr('Remove module', 'Modul entfernen')}
          onClick={() => updateSlots(slots.filter((_, i) => i !== index))}>{kind.toUpperCase()} {hex(address, 4)} ×</button>)}</div>
      <div className="kim1-editor-actions">
        <label>memcfg <input type="file" accept=".raw,.bin" aria-label="memcfg raw" onChange={pickBinary('setMemoryCard', 131072)} /></label>
        {state.memoryCard && <>
          <button type="button" onClick={() => download(exportKim1MemoryCard(state.memoryCard), 'kim1-memcfg.raw')}>{tr('Save map', 'Karte speichern')}</button>
          <button type="button" onClick={() => command('setMemoryCard', null)}>{tr('Eject', 'Auswerfen')}</button>
        </>}
      </div>
      <div className="kim1-editor-actions">
        <select aria-label={tr('Storage interface', 'Speicheranschluss')} value={diskKind} onChange={event => setDiskKind(event.target.value)}>
          <option value="mountSD">SD (SPI)</option><option value="mountCorshamDisk">Corsham (DSK)</option>
          <option value="mountK1013">K-1013</option>
        </select>
        {diskKind === 'mountK1013' && <select aria-label={tr('K-1013 drive', 'K-1013-Laufwerk')} value={drive}
          onChange={event => setDrive(Number(event.target.value))}>
          {[0, 1, 2, 3].map(unit => <option key={unit} value={unit}>{String.fromCharCode(65 + unit)}</option>)}
        </select>}
        <input type="file" accept=".img,.bin,.dsk,.imd,.raw" aria-label={tr('Storage image', 'Speicherabbild')}
          onChange={pickBinary(diskKind, diskKind === 'mountK1013' ? 1024 * 1024 : 128 * 1024 * 1024,
            image => diskKind === 'mountK1013' ? {drive, image} : image)} />
        {diskKind === 'mountK1013' && state.k1013?.chip.drives[drive]?.image && <>
          <button type="button" onClick={() => download(state.k1013.chip.drives[drive].image, `kim1-k1013-${drive}.img`)}>{tr('Save image', 'Abbild speichern')}</button>
          <button type="button" onClick={() => command('mountK1013', {drive, image: null})}>{tr('Eject', 'Auswerfen')}</button>
        </>}
        {diskKind !== 'mountK1013' && (state.sdCard || state.corshamDisk) && <>
          <button type="button" onClick={() => download((state.sdCard || state.corshamDisk).image, state.sdCard ? 'kim1-sd.img' : 'kim1.dsk')}>{tr('Save image', 'Abbild speichern')}</button>
          <button type="button" onClick={() => command(state.sdCard ? 'mountSD' : 'mountCorshamDisk', null)}>{tr('Eject', 'Auswerfen')}</button>
        </>}
      </div>
    </details>}
    {tty && <details open className="kim1-help"><summary>TTY · 300 baud</summary>
      <pre data-kim1-tty-output aria-label={tr('TTY output', 'TTY-Ausgabe')} tabIndex={0}>{state.ttyOutput.replace(/[^\x20-\x7e\r\n\t]/g, '')}</pre>
      <form className="kim1-editor-actions" onSubmit={event => {
        event.preventDefault();
        if (command('sendTty', ttyInput)) setTtyInput('');
      }}>
        <input value={ttyInput} onChange={event => setTtyInput(event.target.value)} aria-label={tr('TTY input', 'TTY-Eingabe')} />
        <button>{tr('Send', 'Senden')}</button>
        <button type="button" onClick={() => command('sendTty', '\r')}>{tr('Return', 'Zeilenumbruch')}</button>
        <button type="button" onClick={() => command('clearTty')}>{tr('Clear', 'Leeren')}</button>
      </form>
    </details>}
    <AceKimPanel />
    {onOpenExample && <button type="button" className="kim1-wired-example" onClick={onOpenExample}>
      {tr('Open wired I/O example', 'Verdrahtetes E/A-Beispiel öffnen')}</button>}
    <details className="kim1-help"><summary>{tr('Keys and wiring', 'Tasten und Verdrahtung')}</summary>
      <p>{tr('AD selects an address; enter four hex digits. DA edits its byte; enter two digits. + advances. GO runs from the displayed address, or executes one instruction with SST enabled. ST stops; PC returns to the stopped program counter; RS resets and keeps RAM.', 'AD wählt die Adresse: vier Hex-Ziffern eingeben. DA ändert das Byte: zwei Ziffern eingeben. + geht weiter. GO startet an der angezeigten Adresse oder führt mit SST einen Befehl aus. ST hält an; PC zeigt den angehaltenen Programmzähler; RS setzt zurück und behält RAM.')}</p>
      <p>{tr('PA0–PA7, PB0–PB5 and PB7 are the 15 user I/O pins. Set data directions at $1701/$1703 and use ports $1700/$1702. A set direction bit is an output. 5v and gnd power external experiments.', 'PA0–PA7, PB0–PB5 und PB7 sind die 15 Benutzer-E/A-Pins. Datenrichtungen liegen bei $1701/$1703, Ports bei $1700/$1702. Ein gesetztes Richtungsbit bedeutet Ausgang. 5v und gnd versorgen externe Versuche.')}</p>
      <p>{hardware ? tr('The mounted ROM runs at 1 MHz. The keypad and display connect to the emulated 6530.', 'Das geladene ROM läuft mit 1 MHz. Tastatur und Anzeige sind mit dem emulierten 6530 verbunden.') : tr(`Learning monitor at ${part.params?.clockHz ?? 1000} Hz. Use Firmware and TTY to switch to the ROM monitor.`, `Lernmonitor mit ${part.params?.clockHz ?? 1000} Hz. Unter Firmware und TTY zum ROM-Monitor wechseln.`)}</p>
      <p>{externalClock ? tr('The connected host controls simulation time.', 'Der angeschlossene Host steuert die Simulationszeit.') : tr('GO starts circuit simulation. ST stops this computer; Pause in the circuit toolbar freezes the whole experiment.', 'GO startet die Schaltungssimulation. ST hält diesen Computer an; Pause in der Schaltungsleiste hält den gesamten Versuch an.')}</p>
      <p>{tr('Programs and keypad RAM edits stay with each part when you save the circuit. I/O register writes affect the current run. Build edits reset runtime registers. With this panel focused: hex keys enter digits, Enter is +, Escape is ST, Space is GO/ST.', 'Programme und RAM-Tastatureingaben werden mit dem Bauteil gespeichert. E/A-Registeränderungen betreffen den aktuellen Lauf. Änderungen im Bauen-Modus setzen Laufzeitregister zurück. Bei fokussiertem Panel: Hex-Tasten geben Ziffern ein, Eingabe ist +, Escape ist ST, Leertaste ist GO/ST.')}</p>
    </details>
  </section>;
}

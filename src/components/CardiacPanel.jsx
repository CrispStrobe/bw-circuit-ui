// SPDX-License-Identifier: MIT
import React, {useEffect, useState} from 'react';
import {cardiacControl, cardiacKeyboardCommand, formatCardiacWord, openCardiacLab,
  parseCardiacInputCards} from '../model/cardiac-controls.js';
import {CARDIAC_EXAMPLES} from '../model/cardiac-demo.js';
import './cardiac-panel.css';

/** A view/controller of the active Board's machine; no interpreter or clock. */
export function CardiacPanel({part, board, lang = 'en', onProgramChange, onRunClock,
  onControlSettling, onOpenExample, externalClock = false}) {
  const de = /^de/i.test(lang);
  const tr = (en, german) => de ? german : en;
  const [cards, setCards] = useState('');
  const [source, setSource] = useState(part.params?.inputSource === 'circuit' ? 'circuit' : 'manual');
  const [exampleId, setExampleId] = useState('echo');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [, redraw] = useState(0);
  useEffect(() => {
    setCards(''); setError(''); setNotice('');
    setSource(part.params?.inputSource === 'circuit' ? 'circuit' : 'manual');
  }, [board, part]);
  const state = board?.getDeviceState?.(part.id);
  const command = (verb, value) => {
    try {
      setError(''); setNotice('');
      const next = cardiacControl({board, part, verb, value, onProgramChange});
      if (verb === 'run' && next.running) onRunClock?.();
      onControlSettling?.();
      redraw(n => n + 1);
      return next;
    } catch (failure) {
      setError(String(failure.message || failure)); redraw(n => n + 1); return null;
    }
  };
  const enqueue = event => {
    event.preventDefault();
    try {
      const values = parseCardiacInputCards(cards);
      if (command('enqueueInput', values)) {
        setCards('');
        setNotice(tr(`${values.length} card(s) queued.`, `${values.length} Karte(n) eingereiht.`));
      }
    } catch (failure) { setError(String(failure.message || failure)); }
  };
  const queue = state?.inputQueue || [];
  const output = state?.output || [];
  const currentStatus = state?.waiting ? tr('Waiting for a card', 'Wartet auf eine Karte') :
    state?.halted ? tr('Halted', 'Angehalten') : state?.running ? tr('Running', 'Läuft') : tr('Paused', 'Pausiert');
  const lastOutput = state?.lastOutput ?? null;
  return <section className="cardiac-panel" data-cardiac-panel={part.id} tabIndex={0}
    aria-label={`CARDIAC ${part.declName || part.id}`} onKeyDown={event => {
      event.stopPropagation();
      const verb = cardiacKeyboardCommand(event, state?.running);
      if (verb) { event.preventDefault(); command(verb); }
    }}>
    <header><div><strong>CARDIAC</strong><small>{tr('Brickwright I/O adapter', 'Brickwright-E/A-Adapter')}</small></div>
      <span className="cardiac-badge">{tr('Decimal', 'Dezimal')}<br />00–99</span></header>
    {!state ? <p role="alert">{tr('This board has no CARDIAC engine.', 'Diese Platine hat keine CARDIAC-Engine.')}</p> : <>
      <div className="cardiac-registers">
        <div><span>PC</span><output data-cardiac-pc>{formatCardiacWord(state.pc, 2)}</output></div>
        <div><span>ACC</span><output data-cardiac-acc>{formatCardiacWord(state.acc, 4)}</output></div>
      </div>
      <div className="cardiac-status" data-cardiac-status aria-live="polite">{currentStatus}</div>
      <div className="cardiac-actions">
        {[
          ['run', tr('Run', 'Start')], ['pause', tr('Pause', 'Pause')],
          ['step', tr('Step', 'Schritt')], ['reset', tr('Restart', 'Neustart')],
        ].map(([verb, label]) => <button key={verb} type="button" data-cardiac-action={verb}
          onClick={() => command(verb)}>{label}</button>)}
      </div>
      <fieldset className="cardiac-input">
        <legend>{tr('Input cards', 'Eingabekarten')}</legend>
        <label>{tr('Source', 'Quelle')}
          <select aria-label={tr('CARDIAC input source', 'CARDIAC-Eingabequelle')} value={source}
            onChange={event => setSource(event.target.value)}>
            <option value="manual">{tr('Manual cards', 'Manuelle Karten')}</option>
            <option value="circuit">{tr('Circuit samples', 'Schaltungsproben')}</option>
          </select>
        </label>
        {source === 'manual' ? <form onSubmit={enqueue}>
          <label>{tr('Signed decimal words', 'Dezimalzahlen mit Vorzeichen')}
            <input aria-label={tr('CARDIAC input cards', 'CARDIAC-Eingabekarten')} value={cards}
              onChange={event => setCards(event.target.value)} placeholder="123 456 -007" maxLength={4096}
              autoComplete="off" spellCheck={false} />
          </label>
          <button type="submit" data-cardiac-enqueue>{tr('Queue cards', 'Karten einreihen')}</button>
        </form> : <div className="cardiac-sample">
          <p>{tr('IN: 0–5 V → one card from 000 to 999.', 'IN: 0–5 V → eine Karte von 000 bis 999.')}</p>
          <button type="button" data-cardiac-sample onClick={() => {
            if (command('sampleInput')) setNotice(tr('One circuit sample queued.', 'Eine Schaltungsprobe eingereiht.'));
          }}>{tr('Sample IN once', 'IN einmal abtasten')}</button>
        </div>}
        <div className="cardiac-queue" data-cardiac-queue aria-label={tr('Queued cards', 'Wartende Karten')}>
          {queue.length ? queue.slice(0, 12).map((value, index) => <span key={index}
            title={state.inputSources?.[index] === 'circuit' ? tr('Circuit sample', 'Schaltungsprobe') : tr('Manual card', 'Manuelle Karte')}>
            {formatCardiacWord(value)}<small>{state.inputSources?.[index] === 'circuit' ? 'IN' : '✎'}</small>
          </span>) : <i>{tr('Queue empty', 'Warteschlange leer')}</i>}
          {queue.length > 12 && <i>+{queue.length - 12}</i>}
        </div>
      </fieldset>
      <div className="cardiac-output">
        <div><span>{tr('Last output', 'Letzte Ausgabe')}</span>
          <output data-cardiac-output>{formatCardiacWord(lastOutput)}</output></div>
        <span data-cardiac-pin-high={state.outputHigh === true} className="cardiac-pin-state">
          <i /> OUT {state.outputHigh === true ? '5 V' : '0 V'}</span>
      </div>
      <details className="cardiac-output-tray"><summary>{tr('Output cards', 'Ausgabekarten')} ({output.length})</summary>
        <pre data-cardiac-output-tray>{output.length ? output.slice(-100).map(value => formatCardiacWord(value)).join('  ') : '—'}</pre>
        {output.length > 100 && <small>{tr('Showing the last 100 cards.', 'Die letzten 100 Karten werden angezeigt.')}</small>}
      </details>
    </>}
    {(error || state?.error) && <p className="cardiac-error" role="alert">{error || state.error}</p>}
    {notice && <p className="cardiac-notice" role="status">{notice}</p>}
    <details className="cardiac-program"><summary>{tr('Load a program', 'Programm laden')}</summary>
      <label>{tr('Starter programs', 'Einstiegsprogramme')}
        <select aria-label={tr('CARDIAC example', 'CARDIAC-Beispiel')} value={exampleId}
          onChange={event => setExampleId(event.target.value)}>
          {CARDIAC_EXAMPLES.map(example => <option key={example.id} value={example.id}>
            {de ? example.nameDe : example.name}</option>)}
        </select>
      </label>
      <button type="button" data-cardiac-load disabled={!state} onClick={() => {
        const example = CARDIAC_EXAMPLES.find(item => item.id === exampleId);
        if (example && command('loadProgram', example.program)) {
          setNotice(tr('Program loaded; the initial image is saved with this part.', 'Programm geladen; das Startabbild wird mit diesem Bauteil gespeichert.'));
        }
      }}>{tr('Load selected program', 'Ausgewähltes Programm laden')}</button>
    </details>
    <button type="button" className="cardiac-open" data-cardiac-open onClick={() => openCardiacLab(part.id)}>
      {tr('Open CARDIAC lab', 'CARDIAC-Labor öffnen')}</button>
    <small className="cardiac-host-note">{tr('Full memory and code view opens in Brickwright.', 'Die vollständige Speicher- und Codeansicht öffnet sich in Brickwright.')}</small>
    {onOpenExample && <button type="button" className="cardiac-example" data-cardiac-example onClick={onOpenExample}>
      {tr('Open wired night-light example', 'Verdrahtetes Nachtlicht öffnen')}</button>}
    <details className="cardiac-help"><summary>{tr('Wiring and execution', 'Verdrahtung und Ausführung')}</summary>
      <p>{tr('The historic CARDIAC was a cardboard computer. These four electrical terminals are a modern Brickwright adapter.',
        'Der historische CARDIAC war ein Pappcomputer. Diese vier elektrischen Anschlüsse gehören zu einem modernen Brickwright-Adapter.')}</p>
      <p>{tr('Each Sample IN click queues one measured card. Changing the voltage alone adds no cards. Manual cards and circuit samples keep their source labels in the queue.',
        'Jeder Klick auf IN einmal abtasten reiht eine gemessene Karte ein. Eine Spannungsänderung allein erzeugt keine Karten. Manuelle Karten und Schaltungsproben behalten ihre Herkunftsmarkierung.')}</p>
      <p>{tr('OUT holds 5 V only when the latest output card is 001. Every other output holds 0 V; its complete number remains in the output tray. Connect an LED through a series resistor. The 5v and gnd terminals supply the experiment.',
        'OUT hält nur bei der letzten Ausgabekarte 001 die Spannung 5 V. Jede andere Ausgabe hält 0 V; die vollständige Zahl bleibt in der Kartenablage. Eine LED benötigt einen Vorwiderstand. 5v und gnd versorgen das Experiment.')}</p>
      <p>{externalClock ? tr('The connected host owns simulation time.', 'Der angeschlossene Host steuert die Simulationszeit.') :
        tr('Run starts the shared circuit clock. Pause stops this CARDIAC; the toolbar pause freezes the whole circuit.',
          'Start aktiviert den gemeinsamen Schaltungstakt. Pause hält diesen CARDIAC an; die Pause in der Werkzeugleiste hält die gesamte Schaltung an.')}</p>
      <p>{tr('Restart restores the loaded program. Circuit edits rebuild the board and reset runtime; saved programs remain. This teaching rate is not historical hardware timing.',
        'Neustart stellt das geladene Programm wieder her. Schaltungsänderungen erstellen die Platine neu und setzen Laufzeitwerte zurück; gespeicherte Programme bleiben erhalten. Die Lerngeschwindigkeit ist kein historisches Hardware-Timing.')}</p>
    </details>
  </section>;
}

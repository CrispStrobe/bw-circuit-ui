/**
 * Lightweight i18n — keyed strings with EN + DE.
 *
 * Usage: import { t } from '../i18n/strings.js';
 *        t('pause', lang)  → 'Pause' / 'Pause'
 *        t('resume', lang) → 'Resume' / 'Fortsetzen'
 *
 * Interpolation: t('nSelected', lang, { n: 3 }) → '3 selected'
 * Keys not found fall back to EN, then to the key itself.
 */

const STRINGS = {
  // ── CircuitDesigner status bar ────────────────────────────────────
  statusHardware:      { en: 'HARDWARE — voltage/current readings need the simulator', de: 'HARDWARE — Spannungs-/Stromwerte brauchen den Simulator' },
  statusSnapshot:      { en: 'SNAPSHOT — the board kept running for {ms} while the program was stopped', de: 'SNAPSHOT — das Board lief {ms} weiter, während das Programm gestoppt war' },
  statusPaused:        { en: 'PAUSED — program and board are frozen together', de: 'PAUSE — Programm und Board sind zusammen eingefroren' },
  statusLive:          { en: 'LIVE — emulator driving pins', de: 'LIVE — Emulator steuert die Pins' },
  statusSimulating:    { en: 'SIMULATING — scripted MCU demo', de: 'SIMULATION — MCU-Demomodus' },
  placingProbe:        { en: 'Placing probe {which} — click a terminal', de: 'Messpunkt {which} setzen — auf einen Anschluss klicken' },
  collapse:            { en: 'collapse', de: 'einklappen' },
  examples:            { en: 'Examples', de: 'Beispiele' },
  parts:               { en: 'Parts', de: 'Bauteile' },
  staleMs:             { en: '{ms} ms stale', de: '{ms} ms veraltet' },
  staleSec:            { en: '{s} s stale', de: '{s} s veraltet' },
  wiringOnly:          { en: 'wiring only — no sim', de: 'nur Verdrahtung — keine Simulation' },
  viewRealistic:       { en: 'Realistic', de: 'Realistisch' },
  viewSchematic:       { en: 'Schematic', de: 'Schaltplan' },
  resume:              { en: 'resume', de: 'fortsetzen' },
  pause:               { en: 'pause', de: 'anhalten' },
  resumeTitle:         { en: 'Resume simulation', de: 'Simulation fortsetzen' },
  pauseTitle:          { en: 'Pause simulation (board time freezes; knobs stay live)', de: 'Simulation anhalten (Board-Zeit friert ein; Regler bleiben aktiv)' },
  stepTitle:           { en: 'Advance one 50 ms tick', de: 'Einen 50-ms-Takt weiter' },
  step:                { en: 'step', de: 'Schritt' },
  simSpeed:            { en: 'Simulation speed', de: 'Simulationsgeschwindigkeit' },
  moveBlocked:         { en: 'move blocked — target holes occupied, gutter, or board edge', de: 'Verschieben blockiert — Ziel belegt, Rinne oder Brettrand' },
  schematicCaption:    { en: 'Schematic — read-only projection of the circuit above. Edit in Realistic view.', de: 'Schaltplan — schreibgeschützte Projektion. Bearbeitung in der realistischen Ansicht.' },
  controls:            { en: 'Controls', de: 'Steuerung' },
  circuitDesigner:     { en: 'Circuit Designer', de: 'Schaltungseditor' },
  addPartsHint:        { en: 'Add parts from the palette, or load a preset', de: 'Bauteile aus der Palette hinzufügen oder ein Preset laden' },
  tryHint:             { en: 'Try "Correct (active-low)" vs "Naive (active-high)"', de: '„Korrekt (active-low)" vs. „Naiv (active-high)" vergleichen' },
  whyWiring:           { en: 'to see why wiring matters', de: 'um zu sehen, warum Verdrahtung wichtig ist' },

  // ── ControlPanel ──────────────────────────────────────────────────
  mode:                { en: 'Mode:', de: 'Modus:' },
  modeBuild:           { en: 'Build', de: 'Bauen' },
  modeSim:             { en: 'Sim', de: 'Sim' },
  powerOn:             { en: 'POWER ON', de: 'STROM EIN' },
  powerOff:            { en: 'POWER OFF', de: 'STROM AUS' },
  undo:                { en: 'Undo', de: 'Rückgängig' },
  redo:                { en: 'Redo', de: 'Wiederholen' },
  selected:            { en: 'Selected:', de: 'Auswahl:' },
  labelName:           { en: 'name:', de: 'Name:' },
  wire:                { en: 'Wire {id}', de: 'Kabel {id}' },
  nothing:             { en: 'Nothing', de: 'Nichts' },
  deleteSelected:      { en: 'Delete Selected', de: 'Auswahl löschen' },
  save:                { en: 'Save', de: 'Speichern' },
  load:                { en: 'Load', de: 'Laden' },
  helpClickDots:       { en: 'Click red dots to wire.', de: 'Rote Punkte klicken zum Verdrahten.' },
  helpSelectDel:       { en: 'Select + Del to remove.', de: 'Auswählen + Entf zum Löschen.' },
  helpScrollZoom:      { en: 'Scroll to zoom, 0 to reset.', de: 'Scrollen zum Zoomen, 0 zum Zurücksetzen.' },
  helpUndoRedo:        { en: 'Ctrl+Z undo, Ctrl+Y redo.', de: 'Strg+Z Rückgängig, Strg+Y Wiederholen.' },
  helpEngine:          { en: 'All values from engine.', de: 'Alle Werte vom Simulator.' },

  // ── Multimeter ────────────────────────────────────────────────────
  multimeter:          { en: 'Multimeter', de: 'Multimeter' },
  probes:              { en: 'Probes:', de: 'Messpunkte:' },
  probeLabel:          { en: 'Probe {which}:', de: 'Messpunkt {which}:' },
  clickTerminal:       { en: 'click a terminal...', de: 'Anschluss klicken...' },
  notPlaced:           { en: 'not placed', de: 'nicht platziert' },
  turnPowerOff:        { en: 'Turn power OFF', de: 'Strom AUSSCHALTEN' },
  readingsFromEngine:  { en: 'All readings from engine.', de: 'Alle Messwerte vom Simulator.' },

  // ── ScopePanel ────────────────────────────────────────────────────
  oscilloscope:        { en: 'Oscilloscope', de: 'Oszilloskop' },
  scopeRun:            { en: 'RUN', de: 'LAUF' },
  scopeHold:           { en: 'HOLD', de: 'HALT' },
  scopeSlow:           { en: 'slow', de: 'langsam' },
  scopeMedium:         { en: 'medium', de: 'mittel' },
  scopeFast:           { en: 'fast', de: 'schnell' },
  scopeScale:          { en: 'V/div', de: 'V/Div' },
  scopeAuto:           { en: 'auto', de: 'auto' },
  scopeCenter:         { en: 'centre', de: 'Mitte' },
  scopeTrigger:        { en: 'trigger', de: 'Trigger' },
  scopeTriggerOff:     { en: 'free', de: 'frei' },
  scopeTriggerRise:    { en: 'rising', de: 'steigend' },
  scopeTriggerFall:    { en: 'falling', de: 'fallend' },
  scopeLevel:          { en: 'level', de: 'Pegel' },
  scopeTriggered:      { en: 'TRIG', de: 'TRIG' },
  scopeWaiting:        { en: 'WAIT', de: 'WARTEN' },
  scopeCursors:        { en: 'time cursors', de: 'Zeitcursor' },
  scopeEmpty:          { en: 'add a channel to capture — nothing is drawn that was not measured', de: 'Kanal hinzufügen — nur Gemessenes wird angezeigt' },
  scopeNet:            { en: 'net\u2026', de: 'Netz\u2026' },
  scopeAddChannel:     { en: '+ channel', de: '+ Kanal' },
  scopeFooter:         { en: 'engine samples only \u00b7 capture resets when the circuit is edited', de: 'nur Simulatordaten \u00b7 Aufnahme wird bei Schaltungsänderung zurückgesetzt' },

  // ── SchematicPanel ────────────────────────────────────────────────
  schematicEmpty:      { en: 'the schematic mirrors the canvas — add parts to see it', de: 'der Schaltplan spiegelt die Arbeitsfläche — Bauteile hinzufügen' },

  // ── PartPalette ───────────────────────────────────────────────────
  searchParts:         { en: 'search...', de: 'suchen...' },
  noMatches:           { en: 'No matches', de: 'Keine Treffer' },

  // ── ExamplesBrowser ───────────────────────────────────────────────
  noExamples:          { en: 'No examples available', de: 'Keine Beispiele verfügbar' },
  searchExamples:      { en: 'search examples...', de: 'Beispiele suchen...' },
  all:                 { en: 'All', de: 'Alle' },
  catBasics:           { en: 'Basics', de: 'Grundlagen' },
  catAnalog:           { en: 'Analog', de: 'Analog' },
  catDigital:          { en: 'Digital', de: 'Digital' },
  catMotors:           { en: 'Motors & Actuators', de: 'Motoren & Aktoren' },
  diffBeginner:        { en: 'Beginner', de: 'Anfänger' },
  diffIntermediate:    { en: 'Intermediate', de: 'Mittelstufe' },
  diffAdvanced:        { en: 'Advanced', de: 'Fortgeschritten' },

  // ── DebugStatus ───────────────────────────────────────────────────
  halted:              { en: 'HALTED', de: 'ANGEHALTEN' },
  running:             { en: 'RUNNING', de: 'LÄUFT' },
  haltBreakpoint:      { en: 'Hit breakpoint', de: 'Haltepunkt erreicht' },
  haltStep:            { en: 'Step completed', de: 'Schritt abgeschlossen' },
  haltUser:            { en: 'Paused by user', de: 'Vom Benutzer angehalten' },
  haltReset:           { en: 'Reset', de: 'Zurückgesetzt' },
  programTime:         { en: 'Program time: ', de: 'Programmzeit: ' },
  advancing:           { en: ' (advancing)', de: ' (läuft)' },
  frozen:              { en: ' (frozen)', de: ' (eingefroren)' },
  boardKeptRunning:    { en: ' (board kept running)', de: ' (Board lief weiter)' },
  wallTimeAhead:       { en: 'Wall time: +{ms} ahead', de: 'Echtzeit: +{ms} voraus' },
  state:               { en: 'state ', de: 'Zustand ' },
  waitUntil:           { en: 'until ', de: 'bis ' },
  noSingleStep:        { en: 'Single-step not available on this target', de: 'Einzelschritt auf diesem Ziel nicht verfügbar' },
  noBreakpoints:       { en: 'Code breakpoints not available on this target', de: 'Code-Haltepunkte auf diesem Ziel nicht verfügbar' },
  stepOver:            { en: 'Step over', de: 'Überspringen' },
  stepOut:             { en: 'Step out', de: 'Herausspringen' },
  stepOverTitle:       { en: 'Step over current block (runs to next sibling)', de: 'Aktuellen Block überspringen (zum nächsten Geschwister)' },
  stepOutTitle:        { en: 'Step out of current block (returns to parent)', de: 'Aus aktuellem Block herausspringen (zum Elternteil)' },
  addWatchpoint:       { en: 'Watch address…', de: 'Adresse beobachten…' },
  watchpointPlaceholder: { en: 'hex addr', de: 'Hex-Adresse' },

  // ── Build Machine ─────────────────────────────────────────────────
  buildMachine:        { en: 'Build Machine', de: 'Maschine bauen' },
  buildMachineTitle:   { en: 'Analyze bus wiring and boot a computer from this circuit', de: 'Busverdrahtung analysieren und einen Computer aus dieser Schaltung starten' },
  machineBooted:       { en: 'Machine booted', de: 'Maschine gestartet' },
  extractFailed:       { en: 'Cannot build machine:', de: 'Maschine kann nicht gebaut werden:' },
  extractNote:         { en: 'Note:', de: 'Hinweis:' },
  noRetroChips:        { en: 'No retro CPU found — place a W65C02 or Z80 with address-decoded memory and I/O chips.', de: 'Keine Retro-CPU gefunden — W65C02 oder Z80 mit adressdekodiertem Speicher und E/A-Chips platzieren.' },

  // ── Orientation input face ────────────────────────────────────────
  orientation:         { en: 'Orientation', de: 'Orientierung' },
  orientDrag:          { en: 'Drag', de: 'Ziehen' },
  orientSliders:       { en: 'Sliders', de: 'Regler' },

  // ── MIDI monitor ──────────────────────────────────────────────────
  midiMonitor:         { en: 'MIDI Monitor', de: 'MIDI-Monitor' },
  midiNoteOn:          { en: 'Note ON', de: 'Note EIN' },
  midiNoteOff:         { en: 'Note OFF', de: 'Note AUS' },
  midiNoData:          { en: 'No MIDI data — connect TX at 31250 baud', de: 'Keine MIDI-Daten — TX mit 31250 Baud verbinden' },

  // ── Stimulus controls ─────────────────────────────────────────────
  stimKnockTap:        { en: 'Tap', de: 'Klopfen' },
  stimKnockTitle:      { en: 'Simulate a knock/tap on the piezo sensor', de: 'Klopfen/Antippen am Piezosensor simulieren' },
  stimDistance:        { en: 'Distance', de: 'Entfernung' },
  stimDistanceTitle:   { en: 'Set ultrasonic target distance (cm)', de: 'Ultraschall-Zielentfernung einstellen (cm)' },

  // ── Serial console ────────────────────────────────────────────────
  serialConsole:       { en: 'Serial Console', de: 'Serielle Konsole' },
  serialEmpty:         { en: 'Waiting for serial output… (click to type)', de: 'Warte auf serielle Ausgabe… (klicken zum Tippen)' },

  // ── Architecture face ─────────────────────────────────────────────
  archFace6502:        { en: '6502 Architecture', de: '6502-Architektur' },

  // ── Instruments panel sections ─────────────────────────────────────
  debugger:            { en: 'Debugger', de: 'Debugger' },
  debuggerInactive:    { en: 'Debugger inactive', de: 'Debugger inaktiv' },
  noPinsYet:           { en: 'No program pins declared yet. Add a PIN declaration in Blocks to enable run and step.', de: 'Noch keine Programm-Pins deklariert. Eine PIN-Deklaration in Blöcken hinzufügen.' },
  simControls:         { en: 'Simulation controls', de: 'Simulationssteuerung' },
  resumeSim:           { en: 'Resume simulation', de: 'Simulation fortsetzen' },
  pauseSim:            { en: 'Pause simulation', de: 'Simulation anhalten' },
  stepOneTick:         { en: 'Step one tick', de: 'Einen Takt weiter' },
  speed:               { en: 'Speed', de: 'Geschwindigkeit' },
  scope:               { en: 'Scope', de: 'Oszilloskop' },
  hideScope:           { en: 'Hide scope', de: 'Oszilloskop ausblenden' },
  meter:               { en: 'Meter', de: 'Messgerät' },
  hideMeter:           { en: 'Hide meter', de: 'Messgerät ausblenden' },

  // ── BoardCanvas toolbar ───────────────────────────────────────────
  modeWiring:          { en: 'WIRING', de: 'VERDRAHTUNG' },
  modeSelect:          { en: 'SELECT', de: 'AUSWAHL' },
  nSelected:           { en: '{n} selected', de: '{n} ausgewählt' },
  rotateTitle:         { en: 'Rotate (R)', de: 'Drehen (R)' },
  rotate:              { en: 'Rotate', de: 'Drehen' },
  duplicateTitle:      { en: 'Duplicate (Ctrl+D)', de: 'Duplizieren (Strg+D)' },
  duplicate:           { en: 'Duplicate', de: 'Duplizieren' },
  wireColorTitle:      { en: 'Wire color (auto = colored by voltage)', de: 'Kabelfarbe (auto = nach Spannung)' },
  deleteTitle:         { en: 'Delete (Del)', de: 'Löschen (Entf)' },
  deleteLabel:         { en: 'Delete', de: 'Löschen' },
  undoTitle:           { en: 'Undo (Ctrl+Z)', de: 'Rückgängig (Strg+Z)' },
  redoTitle:           { en: 'Redo (Ctrl+Y)', de: 'Wiederholen (Strg+Y)' },
  saveTitle:           { en: 'Save wiring as file', de: 'Verdrahtung als Datei speichern' },
  loadTitle:           { en: 'Load wiring from file', de: 'Verdrahtung aus Datei laden' },
  voltVcc:             { en: '~5V (VCC)', de: '~5V (VCC)' },
  volt2to4:            { en: '2-4V', de: '2-4V' },
  volt05to2:           { en: '0.5-2V', de: '0,5-2V' },
  voltGnd:             { en: '~0V (GND)', de: '~0V (GND)' },
  adjust:              { en: 'adjust', de: 'einstellen' },
  pinChooserPrompt:    { en: 'Which pin of {chip}? The wire will connect to it.', de: 'Welcher Pin von {chip}? Das Kabel wird dort angeschlossen.' },
  pinChooserCancel:    { en: 'Esc or click outside to cancel', de: 'Esc oder außerhalb klicken zum Abbrechen' },
  noSignal:            { en: 'no signal', de: 'kein Signal' },
  clickToPlay:         { en: 'Click to play — arrow keys or WASD to steer', de: 'Klicken zum Spielen — Pfeiltasten oder WASD zum Steuern' },
  dropSnapshot:        { en: 'Drop .SNA or .Z80 snapshot', de: '.SNA- oder .Z80-Snapshot ablegen' },
  snapshotLoaded:      { en: 'Snapshot loaded', de: 'Snapshot geladen' },
  snapshotFailed:      { en: 'Snapshot failed', de: 'Snapshot fehlgeschlagen' },
  breadboardAnnotation:{ en: 'a complete circuit — the battery feeds the rails, the strips do the wiring', de: 'ein vollständiger Stromkreis — die Batterie speist die Schienen, die Streifen verbinden' },
};

/**
 * Translate a key.
 * @param {string} key
 * @param {string} [lang='en']
 * @param {Record<string, string|number>} [vars] — interpolation: {foo} → vars.foo
 * @returns {string}
 */
export function t(key, lang = 'en', vars) {
  const entry = STRINGS[key];
  if (!entry) return key;
  let s = entry[lang] || entry.en || key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(`{${k}}`, String(v));
    }
  }
  return s;
}

/** Get the category label map for the current lang. */
export function categoryLabels(lang = 'en') {
  return {
    basics: t('catBasics', lang),
    analog: t('catAnalog', lang),
    digital: t('catDigital', lang),
    motors: t('catMotors', lang),
  };
}

/** Get the difficulty labels for the current lang. */
export function difficultyLabels(lang = 'en') {
  return ['', t('diffBeginner', lang), t('diffIntermediate', lang), t('diffAdvanced', lang)];
}

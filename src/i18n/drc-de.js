/**
 * German for the design-rule check (model/drc.js) and for the engine warnings the
 * designer shows beside it (bw-board getWarnings, which only speaks English).
 *
 * drc.js keeps its English `explanation` / `fix` exactly as they were and adds a
 * message id (`msg`) and the values it interpolated (`args`). This module words
 * the same finding in German from those, so a number or a pin name is never
 * re-parsed out of an English sentence. test/drc-i18n.test.js fails when drc.js
 * gains a rule or a message id without a German entry here.
 *
 * Engine warnings have no message id (they come from another package), so they
 * are matched by their English wording; one that does not match stays English.
 * Text that is not ours to word stays English too: a bus extractor's reason, an
 * engine refusal's `why`, a thrown error's message.
 *
 * Loaded with the designer (DrcPanel / BoardCanvas), never at first load.
 */

/** German decimal comma; `digits` fixed decimals when given. */
const num = (x, digits) => {
  const n = Number(x);
  if (!Number.isFinite(n)) return String(x);
  return (digits === undefined ? String(n) : n.toFixed(digits)).replace('.', ',');
};

const list = items => {
  const all = (items || []).map(String);
  if (all.length < 2) return all.join('');
  return `${all.slice(0, -1).join(', ')} und ${all[all.length - 1]}`;
};

const CONTROL_SYMPTOMS_DE = {
  '6502': {
    IRQB: 'Zufällige Interrupts – die CPU sieht durch Rauschen auf der offenen Leitung IRQ-Flanken, die es nicht gibt.',
    NMIB: 'Unerwarteter NMI – die CPU springt unvorhersehbar zum NMI-Vektor.',
    RDY: 'Die CPU hält zufällig an – ein als LOW gelesenes RDY bremst den Bus.',
    BE: 'Der Bus geht zufällig hochohmig – BE auf LOW trennt die CPU vom Bus.',
  },
  'z80': {
    INTB: 'Zufällige Interrupts – der Z80 sieht durch Rauschen INT-Flanken, die es nicht gibt.',
    NMIB: 'Unerwarteter NMI – der Z80 springt unvorhersehbar nach $0066.',
    WAITB: 'Die CPU hängt zufällig – ein als LOW gelesenes WAIT friert den Buszyklus ein.',
    BUSRQB: 'Der Bus geht zufällig hochohmig – BUSRQ auf LOW trennt die CPU.',
  },
};

const floatingControl = cpu => ({
  explanation: a => `${a.pin} ist offen (kein Netz). ${CONTROL_SYMPTOMS_DE[cpu][a.pin] || ''}`.trim(),
  fix: a => `Einen 3,3-kΩ-Pull-up-Widerstand von ${a.pin} nach VCC einsetzen.`,
});

/**
 * One entry per drc.js message id. `explanation` and `fix` take the warning's
 * `args`; a string is used as is. A message whose English has no fix has none here.
 */
export const DRC_DE = {
  'esp32-s040-voltage': {
    explanation: a => `${a.pin} ist ein GPIO des ESP32-S3 mit 3,3 V. Diese Verbindung erreicht eine Quelle über 3,6 V und kann den ESP32-S3 beschädigen.`,
    fix: 'Eine 3,3-V-Signalquelle oder einen Pegelwandler verwenden. H1 5V versorgt den Spannungsregler der Platine; es ist keine GPIO-Versorgung und kein Logikpegel.',
  },
  'pico-voltage': {
    explanation: a => `${a.pin} ist ein GPIO des RP2040 mit 3,3 V. Diese Verbindung erreicht eine Quelle mit 5 V oder mehr und kann den Pico beschädigen.`,
    fix: 'Die 3V3-Schiene des Pico oder einen echten Logik-Pegelwandler verwenden; VBUS bleibt für die Versorgung der Platine.',
  },
  'tang-nano-voltage': {
    explanation: a => `${a.pin} ist ein Bank-Pin des Gowin GW2AR-18 mit 3,3 V. Diese Verbindung erreicht eine Quelle mit 5 V oder mehr; der Pin ist nicht 5-V-tolerant und wird beschädigt.`,
    fix: 'Die 3V3-Schiene des Tang Nano oder einen Pegelwandler verwenden. Sein 5V-Pin ist ein Versorgungs-AUSGANG – ein 5-V-Bauteil daraus zu versorgen ist in Ordnung, dessen 5-V-Signal an einen Bank-Pin zurückzuführen nicht.',
  },
  'esp32-s040-reserved-pin': {
    explanation: a => `${a.pin} ist kein zugänglicher H1-Anschluss des ESP32-4848S040. Interne LCD-, Touch- und Speicher-Pins sowie GPIO22–25 können keine Erweiterungsanschlüsse sein.`,
    fix: 'H1 GPIO1, GPIO2, GPIO40, GPIO43 oder GPIO44 verwenden und eine eventuell bestückte Relais-/Audio-Option prüfen.',
  },
  'board-rail-not-simulated': {
    explanation: a => `${a.pin} ist ein Versorgungs-Pin der Platine ${a.kind}. Die Simulation bildet diese Platine nur als Pins ab, ihre Schienen führen also nichts – ein Stromkreis, der hierüber zurückläuft, wirkt offen, nicht wie Masse.`,
    fix: 'Für den simulierten Aufbau den Rückleiter an ein GND-Bauteil führen (und die Versorgung an ein VCC-Bauteil). Auf der echten Platine ist der Pin in Ordnung.',
  },
  'source-current/load': {
    explanation: a => `${a.pin} ist im quasi-bidirektionalen Modus und liefert nur etwa 230 µA. Ein ${a.load} braucht typischerweise 50–200 mA. Der Pin kann diese Last nicht direkt treiben – ${a.load} wird nicht funktionieren.`,
    fix: 'Einen Transistor (NPN oder TIP120) zum Schalten der Last einsetzen. Der Pin steuert die Basis; der Transistor schaltet den Laststrom aus VCC.',
  },
  'source-current/led': {
    explanation: a => `${a.pin} liefert im quasi-bidirektionalen Modus nur etwa 230 µA. Diese LED wird kaum sichtbar leuchten. Besser active-low verdrahten: Pin → Widerstand → LED-Kathode, LED-Anode → VCC. Der Pin kann 20 mA aufnehmen, das reicht gut.`,
    fix: 'Active-low verdrahten: LED-Anode an VCC, Kathode über einen Widerstand an den Pin.',
  },
  'missing-resistor': {
    explanation: a => `Diese LED hat keinen Vorwiderstand. Ohne ihn begrenzt nur der Eigenwiderstand der LED (etwa 10 Ω) den Strom, also etwa ${a.kind === 'led' ? '300' : '150'} mA – weit über dem Höchstwert von 20 mA. Die LED brennt durch.`,
    fix: 'Einen Widerstand (220 Ω–1 kΩ) in Reihe schalten. Für 5 V und eine rote LED: R = (5 − 2) / 0,015 = 200 Ω.',
  },
  'missing-flyback': {
    explanation: a => `Dieses Bauteil (${a.kind}) ist eine induktive Last. Beim Abschalten erzeugt das zusammenbrechende Magnetfeld eine Spannungsspitze (Gegeninduktion), die ${a.driver ? 'den treibenden Transistor' : 'die ansteuernde Schaltung'} zerstören kann. Eine Freilaufdiode über der Spule fängt diese Spitze sicher ab.`,
    fix: 'Eine Diode parallel zur Last schalten, Kathode zur VCC-Seite (im Normalbetrieb in Sperrrichtung).',
  },
  'floating-input/unwired': {
    explanation: a => `${a.pin} ist als Eingang eingestellt, aber nichts ist angeschlossen. Ein offener Eingang liest zufälliges Rauschen und kann unvorhersehbares Verhalten auslösen.`,
    fix: 'Einen Pull-up- oder Pull-down-Widerstand anschließen, den Modus input-pullup verwenden oder eine Signalquelle (Taster, Sensor usw.) anschließen.',
  },
  'floating-input/alone': {
    explanation: a => `${a.pin} ist als Eingang eingestellt, aber sonst ist nichts an seinem Netz. Der Pin ist elektrisch offen und liest Rauschen.`,
    fix: 'Eine Signalquelle (Taster, Sensor) anschließen oder einen Pull-up-/Pull-down-Widerstand einsetzen.',
  },
  'supply-short/source': {
    explanation: 'Beide Anschlüsse dieser Spannungsquelle liegen am selben elektrischen Netz. Eine Quellspannung ungleich null würde durch diese Verbindung kurzgeschlossen.',
    fix: 'Die Anschlüsse der Quelle trennen und die Last zwischen sie schalten.',
  },
  'supply-polarity': {
    explanation: 'Diese Gleichspannungsquelle zieht die feste positive Schiene unter ihre Masseschiene.',
    fix: 'Vorzeichen der Quellspannung prüfen und bei Bedarf die Anschlüsse tauschen. Eine schwebende negative Versorgung ist zulässig, eine verpolte feste positive Versorgung nicht.',
  },
  'supply-short/net': {
    explanation: a => `${a.positive} und ${a.ground} liegen am selben elektrischen Netz. Das schließt die positive Versorgung direkt mit Masse kurz und kann Platine, Batterie oder Netzteil beschädigen.`,
    fix: 'Verdrahtung prüfen. Jeder Weg von VCC nach GND muss über eine Last führen (Widerstand, LED, Motor usw.).',
  },
  'polarity': {
    explanation: a => `Dieser gepolte Kondensator ist verkehrt herum eingebaut (Minuspol bei ${num(a.plusVolts, 1)} V, Pluspol bei ${num(a.minusVolts, 1)} V). Ein Elektrolytkondensator kann in Sperrrichtung aufplatzen oder explodieren.`,
    fix: 'Die Anschlüsse des Kondensators tauschen, sodass die +-Seite an der höheren Spannung liegt.',
  },
  'missing-pullup': {
    explanation: a => `Die ${a.line}-Leitung von ${a.kind} hat keinen Pull-up-Widerstand. I²C ist ein Open-Drain-Bus – ohne Pull-ups (typisch 4,7 kΩ nach VCC) kann das Signal nicht auf HIGH gehen, und die Kommunikation scheitert.`,
    fix: a => `Einen 4,7-kΩ-Widerstand von ${a.line} nach VCC einsetzen.`,
  },
  'mcu-power-pins': {
    explanation: a => `${(a.missing || []).length > 1 ? 'Die Pins' : 'Der Pin'} ${list(a.missing)} des Chips ${(a.missing || []).length > 1 ? 'sind' : 'ist'} nicht verdrahtet. Der Simulator versorgt den Mikrocontroller stillschweigend, deshalb läuft trotzdem alles – auf einem echten Aufbau tut ein unversorgter Chip nichts.`,
    fix: 'VCC (Pin 40) an die +5-V-Schiene und GND (Pin 20) an Masse legen, so wie es die echte Platine braucht.',
  },
  'aggregate-current/over': {
    explanation: a => `Der Gesamtstrom der Schaltung beträgt ${a.atLeast ? 'mindestens ' : ''}${a.totalMa} mA und überschreitet die Grenze des ${a.chip} von etwa ${a.limitMa} mA. `
      + `Größte Verbraucher: ${(a.top || []).map(c => `${c.kind} (${c.mA} mA)`).join(', ')}.`
      + (a.atLeast ? ` Einige Bauteile (${(a.unrated || []).join(', ')}) lassen sich nicht bewerten – der echte Gesamtstrom kann höher sein.` : ''),
    fix: 'Weniger Lasten gleichzeitig einschalten oder externe Treiber (Transistoren, Schieberegister) verwenden, damit sie aus VCC statt aus den Pins des Mikrocontrollers versorgt werden.',
  },
  'aggregate-current/near': {
    explanation: a => `Bewertete Bauteile ziehen ${a.totalMa} mA (Grenze des ${a.chip} etwa ${a.limitMa} mA), aber ${(a.unrated || []).join(', ')} lässt sich nicht bewerten – die Summe ist eine Untergrenze. Der tatsächliche Strom kann die Grenze überschreiten.`,
    fix: 'Den Strom durch die unbewerteten Bauteile mit dem Multimeter prüfen.',
  },
  // The reason and the note are the bus extractor's own English text.
  'bus-extract-6502': {
    explanation: a => String(a.reason ?? ''),
    fix: 'Die Adressdecodierung auf dem Steckbrett prüfen.',
  },
  'bus-extract-6502-note': {explanation: a => String(a.note ?? '')},
  'bus-extract-z80': {
    explanation: a => String(a.reason ?? ''),
    fix: 'Die Adressdecodierung auf dem Steckbrett prüfen.',
  },
  'bus-extract-z80-note': {explanation: a => String(a.note ?? '')},
  'bus-extract-error': {explanation: a => `Bus-Extraktor fehlgeschlagen: ${a.message}`},
  'floating-control-6502': floatingControl('6502'),
  'floating-control-z80': floatingControl('z80'),
  'bare-reset-6502': {
    explanation: 'RESB ist verdrahtet, hat aber keine RC-Reset-Schaltung. Bei 1 MHz setzt die CPU beim Einschalten womöglich nicht sauber zurück – die Errata von tebl/BE6502 beschreiben das.',
    fix: 'Für einen zuverlässigen Einschalt-Reset einen 1-µF-Kondensator von RESB nach GND und einen 1-kΩ-Widerstand von RESB nach VCC einsetzen.',
  },
};

/**
 * Engine (bw-board) and host warnings, matched by their English wording. The
 * captured values are reused as they are; a value that is itself English prose
 * (an engine refusal's reason, an error message) stays English.
 */
export const ENGINE_DE = [
  [/^(.+) appeared in both (.+) and (.+) — merged: one pin is one node\. The drawing \(or its wire derivation\) lists the terminal twice\.$/,
    m => `${m[1]} lag sowohl in ${m[2]} als auch in ${m[3]} – zusammengeführt: ein Pin ist ein Knoten. Die Zeichnung (oder ihre Leitungsableitung) führt den Anschluss doppelt.`],
  [/^(.+) is configured as a macromodel op-amp, but the bench has no ground net to reference the internal pole against — it is running as an IDEAL op-amp \(no bandwidth, no slew\) until a gnd part exists\.$/,
    m => `${m[1]} ist als Makromodell-Operationsverstärker eingestellt, aber der Aufbau hat kein Massenetz als Bezug für den internen Pol – er läuft als IDEALER Operationsverstärker (keine Bandbreite, keine Anstiegsbegrenzung), bis ein GND-Bauteil vorhanden ist.`],
  [/^"(.+)" on (.+?) was ignored — ([\s\S]*?)(?: \((\d+)×\))?$/,
    m => `„${m[1]}“ an ${m[2]} wurde ignoriert – ${m[3]}${m[4] ? ` (${m[4]}×)` : ''}`],
  [/^Transient integration hit its step-attempt backstop — the last stretch of this interval was integrated coarsely\. Waveforms there are approximate\.$/,
    () => 'Die Transientenrechnung hat ihre Grenze für Schrittversuche erreicht – das letzte Stück dieses Intervalls wurde grob integriert. Die Kurven sind dort nur Näherungen.'],
  [/^Device sub-step limit reached — some timed transitions may have been skipped\. This happens when many device deadlines fall within one advanceTo interval\.$/,
    () => 'Grenze für Bauteil-Teilschritte erreicht – einige zeitgesteuerte Übergänge wurden womöglich übersprungen. Das passiert, wenn viele Bauteil-Termine in ein advanceTo-Intervall fallen.'],
  [/^Circuit did not converge — voltages shown are approximate\. This can happen with circuits that have no stable operating point\.$/,
    () => 'Die Schaltung ist nicht konvergiert – die angezeigten Spannungen sind Näherungen. Das kann bei Schaltungen ohne stabilen Arbeitspunkt passieren.'],
  [/^(.+): current ([\d.]+) mA exceeds 20 mA rating\. Add or increase the series resistor\.$/,
    m => `${m[1]}: Strom ${num(m[2])} mA überschreitet die Belastbarkeit von 20 mA. Einen Vorwiderstand einsetzen oder vergrößern.`],
  [/^(.+): pin drives LOW but is wired directly to VCC\. This is a short circuit\.$/,
    m => `${m[1]}: Der Pin treibt LOW, ist aber direkt mit VCC verbunden. Das ist ein Kurzschluss.`],
  [/^(.+): pin drives HIGH but is wired directly to GND\. This is a short circuit\.$/,
    m => `${m[1]}: Der Pin treibt HIGH, ist aber direkt mit GND verbunden. Das ist ein Kurzschluss.`],
  [/^(.+): LED appears to be wired backward \(cathode at (-?[\d.]+)V > anode at (-?[\d.]+)V\)\. Swap anode and cathode\.$/,
    m => `${m[1]}: Die LED scheint verkehrt herum eingebaut (Kathode bei ${num(m[2])} V > Anode bei ${num(m[3])} V). Anode und Kathode tauschen.`],
  [/^(.+): output pin is driving but nothing is connected to it\.$/,
    m => `${m[1]}: Der Ausgangspin treibt, aber nichts ist an ihm angeschlossen.`],
  [/^Total I\/O current ([\d.]+) mA exceeds chip limit of (\d+) mA\.$/,
    m => `Gesamter E/A-Strom ${num(m[1])} mA überschreitet die Chipgrenze von ${m[2]} mA.`],
  [/^Up to ([\d.]+) mA at maximum ratings — may exceed chip limit of (\d+) mA\.$/,
    m => `Bis zu ${num(m[1])} mA bei Höchstwerten – kann die Chipgrenze von ${m[2]} mA überschreiten.`],
  [/^Up to ([\d.]+) mA at maximum ratings \((.+) depend on your wiring\) — may exceed chip limit of (\d+) mA\.$/,
    m => `Bis zu ${num(m[1])} mA bei Höchstwerten (${m[2]} hängen von deiner Verdrahtung ab) – kann die Chipgrenze von ${m[3]} mA überschreiten.`],
  [/^Current budget: up to ([\d.]+) mA counted; (.+) depend on your wiring\.$/,
    m => `Strombudget: bis zu ${num(m[1])} mA gezählt; ${m[2]} hängen von deiner Verdrahtung ab.`],
  [/^Total supply current ([\d.]+) mA exceeds USB limit of (\d+) mA\.$/,
    m => `Gesamter Versorgungsstrom ${num(m[1])} mA überschreitet die USB-Grenze von ${m[2]} mA.`],
  [/^At least ([\d.]+) mA supply current \((.+) depend on your wiring\) exceeds USB limit of (\d+) mA\.$/,
    m => `Mindestens ${num(m[1])} mA Versorgungsstrom (${m[2]} hängen von deiner Verdrahtung ab) überschreiten die USB-Grenze von ${m[3]} mA.`],
  // The designer's own wrapper around an engine refusal (CircuitDesigner.jsx).
  [/^The engine rejected this circuit — the board is inactive until this is fixed: ([\s\S]*)$/,
    m => `Die Simulation hat diese Schaltung abgelehnt – die Platine bleibt inaktiv, bis das behoben ist: ${m[1]}`],
];

const call = (v, args) => (typeof v === 'function' ? v(args || {}) : v);

/** German for one English engine/host message, or the message itself. */
export function engineMessageDe(message) {
  const text = String(message ?? '');
  for (const [pattern, word] of ENGINE_DE) {
    const m = pattern.exec(text);
    if (m) return word(m);
  }
  return text;
}

/**
 * A DRC warning worded for `lang`. English (and any language without a table)
 * returns the warning unchanged; German returns a copy with `explanation` and
 * `fix` in German where there is German for them.
 */
export function localizeDrcWarning(w, lang) {
  if (!w || !/^de/i.test(String(lang || ''))) return w;
  const entry = w.msg && DRC_DE[w.msg];
  if (entry) {
    return {
      ...w,
      explanation: call(entry.explanation, w.args),
      fix: w.fix && entry.fix ? call(entry.fix, w.args) : w.fix,
    };
  }
  if (w.explanation) return {...w, explanation: engineMessageDe(w.explanation)};
  if (w.message) return {...w, message: engineMessageDe(w.message)};
  return w;
}

/** Short canvas badge per rule (DrcOverlay), German. */
export const DRC_BADGE_DE = {
  'source-current': '⚡ schwach',
  'missing-resistor': 'kein R',
  'missing-flyback': 'keine Diode',
  'floating-input': 'offen',
  'supply-short': 'KURZSCHLUSS',
  'polarity': '± verpolt',
  'missing-pullup': 'kein Pull-up',
  'aggregate-current': '⚡ Chipgrenze',
  'supply-current': '⚡ USB-Grenze',
  'net-coalesced': '⧉ Netze vereint',
};

/** Words around the findings (DrcPanel, warnings popover, severity summary). */
export const DRC_UI = {
  en: {problem: 'Problem', check: 'Check', note: 'Note', title: 'Circuit Check', clean: 'No issues found', fix: 'Fix', add: 'Add {part}', close: 'Close'},
  de: {problem: 'Problem', check: 'Prüfen', note: 'Hinweis', title: 'Schaltungsprüfung', clean: 'Keine Befunde', fix: 'Abhilfe', add: '{part} hinzufügen', close: 'Schließen'},
};

export const drcUi = (key, lang, vars) => {
  const table = /^de/i.test(String(lang || '')) ? DRC_UI.de : DRC_UI.en;
  let s = table[key] ?? DRC_UI.en[key] ?? key;
  for (const [k, v] of Object.entries(vars || {})) s = s.replace(`{${k}}`, String(v));
  return s;
};

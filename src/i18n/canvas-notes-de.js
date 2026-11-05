/**
 * German for the teaching notes written onto the canvas when the bench is built
 * from the code's pin declarations (model/infer-seated.js, model/inference.js).
 *
 * Those notes are plain English strings that tests and the file loader already
 * rely on, so they stay as they are and are worded in German at render time,
 * matched by their English shape. A pin name, a pad name or a board label is
 * carried over unchanged. A note without a match stays English;
 * test/drc-i18n.test.js builds the declared benches and fails on any such note.
 */

const NOTES_DE = [
  [/^active-low$/, () => 'low-aktiv'],
  [/^active-high$/, () => 'high-aktiv'],
  [/^Showing the first 8 of (\d+) declared pins — the board is full\.$/,
    m => `Gezeigt werden die ersten 8 von ${m[1]} deklarierten Pins – das Steckbrett ist voll.`],
  [/^ESP32-4848S040: front display and rear H1 connector\. The display is pending until supported firmware and an emulator are bound to this board\.$/,
    () => 'ESP32-4848S040: Display vorne, H1-Stecker hinten. Das Display bleibt aus, bis unterstützte Firmware und ein Emulator an diese Platine gebunden sind.'],
  [/^ESP32-4848S040: rear H1 remains floating; a 5 V supply powers the board and a separate 3\.3 V supply powers the signal rails, with shared ground\. Check optional relay\/audio assembly on GPIO40\/2\/1\.$/,
    () => 'ESP32-4848S040: H1 hinten bleibt offen; eine 5-V-Quelle versorgt die Platine und eine eigene 3,3-V-Quelle die Signalschienen, mit gemeinsamer Masse. Eine eventuell bestückte Relais-/Audio-Option an GPIO40/2/1 prüfen.'],
  [/^(.+): the board powers the breadboard — its (\S+) pad \(3\.3 V\) to the \+ rails, GND to the − rails\.$/,
    m => `${m[1]}: Die Platine versorgt das Steckbrett – ihr ${m[2]}-Pad (3,3 V) an die +-Schienen, GND an die −-Schienen.`],
  [/^(.+): seated on the breadboard\. Power from the rails through column jumpers\.$/,
    m => `${m[1]}: auf das Steckbrett gesteckt. Versorgung von den Schienen über Spaltenbrücken.`],
  [/^(.+): (\S+) and GND feed the controller from the rails\.$/,
    m => `${m[1]}: ${m[2]} und GND versorgen den Controller von den Schienen.`],
  [/^VCC \(pin 40\) and GND \(pin 20\) feed the chip from the rails\.$/,
    () => 'VCC (Pin 40) und GND (Pin 20) versorgen den Chip von den Schienen.'],
  [/^100 nF beside the chip \+ 10 µF at the battery decouple the rails\.$/,
    () => '100 nF neben dem Chip + 10 µF an der Batterie entkoppeln die Schienen.'],
  [/^(.+?): (.+) is not an accessible signal pad of ESP32-4848S040 H1 \((.+)\) — not wired\.$/,
    m => `${m[1]}: ${m[2]} ist kein zugängliches Signal-Pad von ESP32-4848S040 H1 (${m[3]}) – nicht verdrahtet.`],
  [/^(.+?): (.+) is not a pad of the (.+) \((.+)\) — not wired\.$/,
    m => `${m[1]}: ${m[2]} ist kein Pad von ${m[3]} (${m[4]}) – nicht verdrahtet.`],
  [/^(.+?): (\S+) has no ADC input on H1; use GPIO1 or GPIO2 — not wired\.$/,
    m => `${m[1]}: ${m[2]} hat an H1 keinen ADC-Eingang; GPIO1 oder GPIO2 verwenden – nicht verdrahtet.`],
  [/^(.+?): a (\S+) above a 10k lower leg — the pin reads the junction between them, not a knob\.$/,
    m => `${m[1]}: ${m[2]} über einem unteren 10k-Zweig – der Pin liest den Knoten dazwischen, keinen Drehregler.`],
  [/^(.+?): pressing pulls (\S+) up to 3\.3 V; the 10k pull-down holds it LOW when released\.$/,
    m => `${m[1]}: Drücken zieht ${m[2]} auf 3,3 V; losgelassen hält der 10k-Pull-down ihn auf LOW.`],
  [/^(.+?): an external 10k pull-up to 3\.3 V holds (\S+) HIGH; pressing pulls it LOW\.$/,
    m => `${m[1]}: Ein externer 10k-Pull-up nach 3,3 V hält ${m[2]} auf HIGH; Drücken zieht ihn auf LOW.`],
  [/^(.+?): the chip\x27s internal pull-up holds the pin HIGH; pressing pulls it LOW\.$/,
    m => `${m[1]}: Der interne Pull-up des Chips hält den Pin auf HIGH; Drücken zieht ihn auf LOW.`],
  [/^(.+?): wired active-low — the pin SINKS the buzzer current; writing 0 sounds it\.$/,
    m => `${m[1]}: low-aktiv verdrahtet – der Pin NIMMT den Summerstrom AUF; eine 0 lässt ihn ertönen.`],
  [/^(.+?): driven directly, no series resistor — a buzzer is not an LED\.$/,
    m => `${m[1]}: direkt getrieben, ohne Vorwiderstand – ein Summer ist keine LED.`],
  [/^(.+?): wired active-low from the 3\.3 V rail into (\S+); writing 0 lights it\.$/,
    m => `${m[1]}: low-aktiv von der 3,3-V-Schiene in ${m[2]} verdrahtet; eine 0 schaltet sie ein.`],
  [/^(.+?): wired active-low — the pin SINKS current \(20 mA\) far better than it sources \(~230 µA\); writing 0 lights it\.$/,
    m => `${m[1]}: low-aktiv verdrahtet – der Pin kann Strom viel besser AUFNEHMEN (20 mA) als liefern (~230 µA); eine 0 schaltet sie ein.`],
  [/^(.+?): (\S+) drives the LED through 1k to the − rail; writing 1 lights it\.$/,
    m => `${m[1]}: ${m[2]} treibt die LED über 1k zur −-Schiene; eine 1 schaltet sie ein.`],
  [/^(.+?): wired active-high — a quasi pin sources only ~230 µA, so this LED will be DIM unless the pin is push-pull\. That is the lesson\.$/,
    m => `${m[1]}: high-aktiv verdrahtet – ein quasi-bidirektionaler Pin liefert nur ~230 µA, diese LED bleibt also DUNKEL, solange der Pin nicht im Gegentaktmodus ist. Genau das ist die Lektion.`],
];

/** German for one canvas note, or the note itself when there is none. */
export function canvasNoteDe(text) {
  const s = String(text ?? '');
  for (const [pattern, word] of NOTES_DE) {
    const m = pattern.exec(s);
    if (m) return word(m);
  }
  return s;
}

/** The note for `lang`: German when asked for and known, else as written. */
export const canvasNote = (text, lang) => (/^de/i.test(String(lang || '')) ? canvasNoteDe(text) : text);

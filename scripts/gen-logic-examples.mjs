/**
 * Publish the logic ladder as USER-FACING examples, seated on breadboards.
 *
 *   node scripts/gen-logic-examples.mjs --out ~/code/sb3-creator-logic
 *
 * gallery/l0..l9 and c0..c3 are the electrical truth — proven rung by rung in
 * test/logic-ladder.test.js. They are wire-level, which is right for a
 * test corpus and wrong for a learner: the ask was breadboards. This
 * script takes those exact circuits, seats their parts in real holes,
 * and writes them into sb3-creator's `examples/` as `pure-circuit`
 * entries with bilingual intros.
 *
 * The connectivity is NOT re-derived. Every `wires` entry is carried
 * across untouched, so what ships is the circuit whose truth table was
 * asserted. Seating only says where a part SITS.
 *
 * Which makes the one real hazard strip merges: two leads of different
 * nets landing on one five-hole strip are shorted by the board itself,
 * and nothing in the wire list would show it. The allocator therefore
 * never reuses a column — every part gets its own span, so the board
 * contributes no connectivity at all — and when a board runs out of
 * columns a SECOND board is added rather than packing parts closer.
 * test/logic-examples.test.js then re-runs the full truth tables against
 * the seated circuits, which is what actually proves no short crept in.
 *
 * Coordinates matter too, and have bitten this before: a previous
 * example shipped with `params` leaked into `y`, so every part had a
 * non-finite coordinate and three sb3-creator gates went red. Every part
 * here gets a real number for x and y, and params stay in params.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import '../test/_setup.js';
import { FOOTPRINTS, computeLeadMap } from '../src/model/footprints.js';
import { BreadboardModel } from '../src/model/breadboard.js';
import { generateBom } from '../src/model/bom.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const GALLERY = join(HERE, '..', 'gallery');

const outIdx = process.argv.indexOf('--out');
if (outIdx < 0) {
  console.error('usage: gen-logic-examples.mjs --out <sb3-creator checkout>');
  process.exit(2);
}
const OUT = process.argv[outIdx + 1].replace(/^~/, process.env.HOME);
const EXAMPLES = join(OUT, 'examples');
if (!existsSync(EXAMPLES)) {
  console.error(`no examples/ under ${OUT}`);
  process.exit(2);
}

/** Columns on a full breadboard, and the margin kept at each end. */
const LAST_COL = 63;
const FIRST_COL = 2;

/** Widest column offset a footprint reaches, in columns. */
function fpWidth(fp) {
  let max = 0;
  for (const off of Object.values(fp.leads)) max = Math.max(max, off.dCol || 0);
  return max + 1;
}

/**
 * Seat as many parts as fit, opening a new breadboard when one fills.
 * Chips and DIP switches straddle the gutter (reference row e); two-lead
 * parts lie flat in row a, well clear of anything else.
 */
function seatAll(parts) {
  const boards = [];
  let board = null;
  let col = FIRST_COL;
  const openBoard = () => {
    board = { id: `bb${boards.length + 1}`, model: new BreadboardModel(`bb${boards.length + 1}`, 'full') };
    boards.push(board);
    col = FIRST_COL;
  };
  openBoard();

  // Chips first, then the switch banks, then the parts a learner reads
  // (LEDs and their resistors), then the pull-downs.
  const rank = (p) => (/^(74hc|cd4)/.test(p.kind) ? 0
    : p.kind === 'dip_switch_spst' ? 1
      : p.kind === 'led' ? 2 : p.kind === 'resistor' ? 3 : 9);
  const order = [...parts].sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));

  const seated = new Map();
  for (const p of order) {
    const fp = FOOTPRINTS[p.kind];
    if (!fp || !fp.leads) continue;                       // vcc/gnd/display: no footprint, stays off-board
    const terms = Object.keys(fp.leads);
    if (terms.length < 2) continue;                       // an incomplete footprint is not a seat
    const w = fpWidth(fp);
    if (col + w > LAST_COL) openBoard();
    if (col + w > LAST_COL) break;                        // a part wider than a board: give up honestly
    const straddles = fp.straddlesGutter || terms.some((t) => (fp.leads[t].dRow || 0) >= 5);
    const ref = `${straddles ? 'e' : 'a'}${col}`;
    const leadMap = computeLeadMap(fp, ref);
    try {
      board.model.occupy(p.id, leadMap);
    } catch {
      col += w + 1;                                       // a refused seat is never forced
      continue;
    }
    seated.set(p.id, { boardId: board.id, leadMap, col, boardIndex: boards.length - 1 });
    col += w + 1;                                         // one clear column between neighbours
  }
  return { seated, boardCount: boards.length };
}

/** Canvas coordinates: finite numbers, laid out to read left-to-right. */
function place(p, seat, i) {
  if (seat) return { x: 90 + seat.col * 15, y: 300 + seat.boardIndex * 300 };
  // Off-board parts get a tidy column at the left: rails at the top,
  // everything else stepping down.
  if (p.kind === 'vcc') return { x: 60, y: 60 };
  if (p.kind === 'gnd') return { x: 60, y: 620 };
  return { x: 60 + (i % 3) * 110, y: 140 + Math.floor(i / 3) * 70 };
}

// ── the eight rungs, with what each one is for ─────────────────────

const LADDER = [
  {
    src: 'l0-and-gate', id: 'pc90-74hc08-and-gate', difficulty: 1,
    en: { title: 'AND gate on a breadboard (74HC08)',
      teaches: 'AND truth table, pull-down resistors, IC power pins' },
    de: { title: 'UND-Gatter auf dem Steckbrett (74HC08)', desc: "Zwei DIP-Schalter an ein 74HC08-UND-Gatter, eine LED am Ausgang. Die LED leuchtet nur, wenn BEIDE Schalter geschlossen sind — die Wahrheitstabelle zum Anfassen. Beachte die 10-kΩ-Pulldowns: ein offener Schalter muss auf ein echtes LOW gezogen werden, sonst hängt ein CMOS-Eingang einfach in der Luft.",
      teaches: 'UND-Wahrheitstabelle, Pulldown-Widerstände, IC-Versorgungspins' },
    table: [['0', '0', 'off'], ['1', '0', 'off'], ['0', '1', 'off'], ['1', '1', 'ON']],
    cols: ['A', 'B', 'LED'],
  },
  {
    src: 'l1-not-gate', id: 'pc91-74hc04-inverter', difficulty: 1,
    en: { title: 'NOT gate: the inverter (74HC04)', teaches: 'inversion, active-low thinking' },
    de: { title: 'NICHT-Gatter: der Inverter (74HC04)', desc: "Ein 74HC04-Inverter. Schalter offen, LED an; Schalter geschlossen, LED aus. Das erste Gatter, das etwas tut, was ein Draht nicht kann.", teaches: 'Invertierung, Low-aktives Denken' },
    table: [['0', 'ON'], ['1', 'off']],
    cols: ['A', 'LED'],
  },
  {
    src: 'l2-and-or-xor', id: 'pc92-and-or-xor-compared', difficulty: 2,
    en: { title: 'AND, OR and XOR side by side', teaches: 'comparing three truth tables on one pair of inputs' },
    de: { title: 'UND, ODER und XOR im Vergleich', desc: "Dieselben zwei Schalter treiben gleichzeitig ein UND (74HC08), ein ODER (74HC32) und ein XOR (74HC86), jedes mit eigener LED. Gehe die vier Eingangskombinationen durch und lies drei Wahrheitstabellen nebeneinander. XOR ist der Sonderfall — es bedeutet „genau einer von beiden“ — und genau dieses Gatter addiert.", teaches: 'drei Wahrheitstabellen an einem Eingangspaar vergleichen' },
    table: [['0', '0', 'off', 'off', 'off'], ['1', '0', 'off', 'ON', 'ON'],
      ['0', '1', 'off', 'ON', 'ON'], ['1', '1', 'ON', 'ON', 'off']],
    cols: ['A', 'B', 'AND', 'OR', 'XOR'],
  },
  {
    src: 'l3-nand-is-universal', id: 'pc93-nand-is-universal', difficulty: 3,
    en: { title: 'NAND is universal', teaches: 'De Morgan, building any gate from one gate type' },
    de: { title: 'NAND genügt für alles', desc: "NICHT, UND und ODER, gebaut aus nichts als 74HC00-NAND-Gattern. Verbinde die beiden Eingänge eines NAND, und es invertiert; invertiere ein NAND, und es wird zum UND; verknüpfe zwei invertierte Eingänge mit NAND, und De Morgan schenkt dir das ODER. Ein einziger Gattertyp kann jeden anderen bauen — deshalb muss eine Chipfabrik nur in einer Sache gut sein.", teaches: 'De Morgan, jedes Gatter aus einem Gattertyp bauen' },
    table: [['0', '0', 'ON', 'off', 'off'], ['1', '0', 'off', 'off', 'ON'],
      ['0', '1', 'ON', 'off', 'ON'], ['1', '1', 'off', 'ON', 'ON']],
    cols: ['A', 'B', 'NOT A', 'A AND B', 'A OR B'],
  },
  {
    src: 'l4-half-adder', id: 'pc94-half-adder', difficulty: 3,
    en: { title: 'The half adder (XOR + AND)', teaches: 'binary addition of one bit, sum and carry' },
    de: { title: 'Der Halbaddierer (XOR + UND)', desc: "Ein XOR und ein UND, und die Maschine kann ein Bit zu einem Bit addieren. SUMME ist das XOR (1+0 = 1, und 1+1 = 0, weil es übergetragen hat), ÜBERTRAG ist das UND. Schließe beide Schalter: SUMME wird dunkel und ÜBERTRAG leuchtet — das ist binär 1+1 = 10, über zwei LEDs gelesen. Er heißt HALB, weil er keinen Platz für einen hereinkommenden Übertrag hat.", teaches: 'Binäraddition eines Bits, Summe und Übertrag' },
    table: [['0', '0', 'off', 'off'], ['1', '0', 'ON', 'off'],
      ['0', '1', 'ON', 'off'], ['1', '1', 'off', 'ON']],
    cols: ['A', 'B', 'SUM', 'CARRY'],
  },
  {
    src: 'l5-full-adder', id: 'pc95-full-adder', difficulty: 4,
    en: { title: 'The full adder (carry in, carry out)', teaches: 'why adders chain: the carry input' },
    de: { title: 'Der Volladdierer (Übertrag rein, Übertrag raus)', desc: "Zwei XOR, zwei UND und ein ODER: A + B + ein hereinkommender Übertrag. Dieser dritte Eingang ist der ganze Punkt — er erlaubt es, Addierer zu verketten, wobei jeder seinen Übertrag an den nächsten weitergibt. Schließe alle drei Schalter: 1+1+1 = 11 binär, also leuchten SUMME und ÜBERTRAG gemeinsam.", teaches: 'warum Addierer sich verketten: der Übertragseingang' },
    table: [['0', '0', '0', 'off', 'off'], ['1', '0', '0', 'ON', 'off'],
      ['1', '1', '0', 'off', 'ON'], ['1', '1', '1', 'ON', 'ON']],
    cols: ['A', 'B', 'Cin', 'SUM', 'CARRY'],
  },
  {
    src: 'l6-four-bit-adder', id: 'pc96-four-bit-adder-74hc283', difficulty: 4,
    en: { title: '4-bit adder on one chip (74HC283)', teaches: 'binary place value, ripple carry, reading a bus' },
    de: { title: '4-Bit-Addierer auf einem Chip (74HC283)', desc: "Acht Schalter rein, fünf LEDs raus: ein kompletter 4-Bit-Addierer in einem 16-poligen Gehäuse. Darin steckt viermal der Volladdierer, den du gerade gebaut hast, Übertrag an Übertrag gekettet. Lies A auf der linken Schalterbank, B auf der rechten und die Antwort über den LEDs (die rote ist der Übertrag und zählt 16). Die Engine schreibt die Bitstellen a0..a3 — a0 ist das Einer-Bit.", teaches: 'binäre Stellenwerte, Ripple-Carry, einen Bus lesen' },
    table: [['0000', '0000', '0 0000'], ['0101', '0011', '0 1000'],
      ['1111', '0001', '1 0000'], ['1111', '1111', '1 1110']],
    cols: ['A', 'B', 'Cout + SUM'],
  },
  {
    src: 'l7-calculator', id: 'pc97-logic-calculator', difficulty: 5,
    en: { title: 'A calculator with no computer in it', teaches: 'BCD decoding, driving a 7-segment display, the limits of 4 bits' },
    de: { title: 'Ein Rechner ohne Computer darin', desc: "Stelle A auf der einen Schalterbank ein und B auf der anderen; der 74HC283 addiert sie, und der CD4511 macht aus der 4-Bit-Antwort eine Dezimalziffer auf der Anzeige. Es gibt keine CPU, keine Firmware und nichts zu programmieren — die Antwort ist die Verdrahtung. Summen von 10 bis 15 lassen die Anzeige dunkel: ein BCD-Dekoder kennt nur 0 bis 9, und genau diese ehrliche Grenze ist der Grund, warum echte Addierer eine Dezimalkorrektur-Stufe haben.", teaches: 'BCD-Dekodierung, 7-Segment-Anzeige ansteuern, die Grenzen von 4 Bit' },
    table: [['0', '0', '0'], ['5', '3', '8'], ['4', '5', '9'], ['9', '1', 'blank (10)'], ['15', '15', 'blank, carry lit']],
    cols: ['A', 'B', 'display'],
  },
  {
    src: 'l8-add-subtract', id: 'pc98-adder-subtractor', difficulty: 4,
    en: { title: 'Subtraction is the same circuit',
      teaches: "two's complement, XOR as a controlled inverter, the borrow flag" },
    de: { title: 'Subtraktion ist dieselbe Schaltung',
      desc: 'Ein einziger zusätzlicher 74HC86 macht aus dem Addierer einen Addierer-Subtrahierer. Der Modus-Schalter '
        + 'geht gleichzeitig an die XOR-Bank UND an den Übertragseingang: offen rechnet die Schaltung A + B, '
        + 'geschlossen kippt jedes B-Bit und unten kommt eine 1 herein — das ist das Zweierkomplement. '
        + 'Die rote LED bedeutet jetzt „kein Borgen": sie leuchtet, wenn A größer oder gleich B ist.',
      teaches: 'Zweierkomplement, XOR als steuerbarer Inverter, das Borge-Flag' },
    table: [['+', '7', '2', '9'], ['−', '7', '2', '5, carry lit (no borrow)'],
      ['−', '2', '7', '11, carry dark (borrowed)'], ['+', '15', '1', '0, carry lit']],
    cols: ['mode', 'A', 'B', 'result'],
  },
  {
    src: 'l9-bcd-calculator', id: 'pc99-bcd-two-digit-calculator', difficulty: 5,
    en: { title: 'Two digits: the calculator that does not give up at nine',
      teaches: 'BCD correction (add six), decimal carry, driving two displays' },
    de: { title: 'Zwei Ziffern: der Rechner, der bei neun nicht aufgibt',
      desc: 'L7 blieb über 9 dunkel, weil ein BCD-Dekoder nur zehn Ziffern kennt. Das hier ist die richtige Lösung, '
        + 'und jeder Dezimaladdierer macht es so: verlässt die Summe den Dezimalbereich, ADDIERE SECHS und trage '
        + 'einen Zehner weiter. Drei Gatter erkennen den Überlauf (Cout, oder S3 mit S2, oder S3 mit S1), ein '
        + 'zweiter 74HC283 addiert die Sechs, und derselbe Übertrag lässt die Zehnerstelle leuchten. '
        + 'Stelle beide Bänke auf eine Dezimalziffer 0–9 und lies das Ergebnis, 0 bis 18.',
      teaches: 'BCD-Korrektur (plus sechs), Dezimalübertrag, zwei Anzeigen ansteuern' },
    table: [['3', '4', '07'], ['9', '0', '09'], ['9', '1', '10'], ['7', '6', '13'], ['9', '9', '18']],
    cols: ['A', 'B', 'display'],
  },
  {
    src: 'c0-clock', id: 'pc100-555-clock', difficulty: 2,
    en: { title: 'The clock — a machine needs a heartbeat',
      teaches: '555 astable, RC timing, why a computer needs a clock' },
    de: { title: 'Der Takt — eine Maschine braucht einen Herzschlag',
      desc: 'Ein 555 als astabiler Multivibrator mit etwa 1 Hz und einer LED, damit man ihn sehen kann. '
        + 'Alles Weitere bewegt sich nur, wenn dieser Pin wechselt. Über den Kondensator wird es schneller '
        + 'oder langsamer: f = 1,44 / ((R1 + 2·R2)·C). Pin 5 (Control) braucht seine 10-nF-Abblockung — '
        + 'lässt man ihn offen, ist die Referenz undefiniert und der Timer kippt nie.',
      teaches: '555-Astabil, RC-Zeitkonstante, warum ein Rechner einen Takt braucht' },
    table: [['~1 Hz', 'LED blinks'], ['bigger C', 'slower'], ['smaller C', 'faster']],
    cols: ['setting', 'effect'],
  },
  {
    src: 'c1-program-counter', id: 'pc101-program-counter', difficulty: 3,
    en: { title: 'The program counter — where the machine is looking',
      teaches: 'binary counting, active-low control pins, ripple carry' },
    de: { title: 'Der Programmzähler — wohin die Maschine schaut',
      desc: 'Ein 74LS161 zählt im Binärsystem von 0 bis 15, ein Schritt pro Takt. Dieses Register sagt, welcher '
        + 'Befehl als Nächstes kommt — ein Programm ist nichts anderes als diese Zahl, die hochläuft. '
        + 'Die rote LED ist der Übertrag (RCO), der bei 15 leuchtet und mit dem man Zähler zu breiteren '
        + 'verkettet. Clear und Load sind LOW-AKTIV und liegen deshalb auf High.',
      teaches: 'Binärzählen, Low-aktive Steuerpins, Ripple-Carry' },
    table: [['0', '0000'], ['1', '0001'], ['9', '1001'], ['15', '1111 + RCO lit'], ['16', 'wraps to 0000']],
    cols: ['clocks', 'LEDs'],
  },
  {
    src: 'c2-memory', id: 'pc102-ram-16x4', difficulty: 4,
    en: { title: 'Memory — sixteen places to put a number',
      teaches: 'address vs data, hand-loading a program, the 74LS189 inverted outputs' },
    de: { title: 'Speicher — sechzehn Plätze für eine Zahl',
      desc: 'Der Zähler aus C1 treibt jetzt die ADRESS-Pins eines 74LS189, eines 16×4-Bit-RAMs. Gelbe LEDs zeigen, '
        + 'welche Adresse gerade anliegt, grüne, was dort steht. Daten einstellen, WRITE pulsen, weitertakten — '
        + 'so wurden die ersten Rechner von Hand programmiert. ACHTUNG: Der 74LS189 hat INVERTIERTE Ausgänge. '
        + 'Speichere 5 und die LEDs zeigen 10. Das ist der echte Chip, kein Fehler — deshalb sitzt in SAP-1-'
        + 'Aufbauten hinter dem RAM ein Inverter.',
      teaches: 'Adresse gegen Daten, Programm von Hand laden, die invertierten Ausgänge des 74LS189' },
    table: [['store 5', 'LEDs read 10 (inverted!)'], ['store 0', 'LEDs read 15'], ['clock', 'address advances']],
    cols: ['action', 'what you see'],
  },
  {
    src: 'c3-accumulator', id: 'pc103-accumulator', difficulty: 5,
    en: { title: 'The accumulator — a circuit with a past',
      teaches: 'registers, feedback, state that survives between clocks' },
    de: { title: 'Der Akkumulator — eine Schaltung mit Vergangenheit',
      desc: 'Ein 74LS173 hält eine laufende Summe, ein 74HC283 addiert den Schalterwert dazu, und die Summe geht '
        + 'direkt wieder in das Register. Jeder Taktimpuls addiert erneut: stell 1 ein und es zählt, stell 3 ein '
        + 'und es geht 3, 6, 9. Das ist die erste Schaltung hier, deren Antwort davon abhängt, was vorher war — '
        + 'und diese Rückkopplung, Register raus, durch Logik, ins Register zurück, ist die Form jedes Prozessors. '
        + 'MR setzt alles auf null.',
      teaches: 'Register, Rückkopplung, Zustand der den Takt überdauert' },
    table: [['+3, clock 1', '3'], ['clock 2', '6'], ['clock 3', '9'], ['no clock', 'unchanged'], ['MR', '0']],
    cols: ['action', 'total'],
  },
  {
    src: 'c4-ring-counter', id: 'pc104-ring-counter', difficulty: 4,
    en: { title: 'The ring counter — six beats to every instruction',
      teaches: 'one-hot counting, timing states, self-resetting a counter' },
    de: { title: 'Der Ringzähler — sechs Takte für jeden Befehl',
      desc: 'Ein SAP-1 erledigt einen Befehl nicht in einem Rutsch: er braucht sechs Zeitschritte, T1 bis T6, '
        + 'und genau einer ist jeweils aktiv. T1–T3 sind für jeden Befehl gleich (Adresse ausgeben, Speicher '
        + 'lesen, Zähler weiterschalten); T4–T6 machen den Unterschied zwischen LDA und ADD. '
        + 'Ein CD4017 ist von Haus aus one-hot, und wenn man seinen siebten Ausgang auf den eigenen RESET '
        + 'zurückführt, springt er nach sechs Schritten um — ein Sechs-Schritt-Ringzähler aus einem Chip '
        + 'und einem Draht.',
      teaches: 'One-hot-Zählen, Zeitschritte, einen Zähler sich selbst zurücksetzen lassen' },
    table: [['0', 'T1'], ['1', 'T2'], ['5', 'T6'], ['6', 'T1 again']],
    cols: ['clocks', 'active state'],
  },
  {
    src: 'c5-instruction-decoder', id: 'pc105-instruction-decoder', difficulty: 5,
    en: { title: 'The instruction decoder — a number becomes a meaning',
      teaches: 'decoders, enable pins, active-low outputs' },
    de: { title: 'Der Befehlsdekoder — aus einer Zahl wird eine Bedeutung',
      desc: 'Vier Schalter sind der Opcode, fünf LEDs sind die Befehle: 0000 ist LDA, 0001 ADD, 0010 SUB, '
        + '1110 OUT, 1111 HLT. Zwei 74HC138-Dekoder teilen sich nach dem obersten Bit auf — einer ist '
        + 'freigegeben, solange es LOW ist, der andere, solange es HIGH ist. Genau dafür sind die drei '
        + 'Freigabe-Pins eines Dekoders da. Die Ausgänge sind LOW-AKTIV, deshalb hängt jede LED von +5 V '
        + 'nach unten IN den Chip hinein und leuchtet, wenn ihre Leitung auf LOW geht.',
      teaches: 'Dekoder, Freigabe-Pins, Low-aktive Ausgänge' },
    table: [['0000', 'LDA'], ['0001', 'ADD'], ['0010', 'SUB'], ['1110', 'OUT'], ['1111', 'HLT'], ['0111', 'nothing — not an instruction']],
    cols: ['opcode', 'decoded'],
  },
  {
    src: 'c6-control-matrix', id: 'pc106-control-matrix', difficulty: 5,
    en: { title: 'The control matrix — the part that decides',
      teaches: 'hardwired control, AND-OR arrays, the fetch-execute cycle' },
    de: { title: 'Die Steuermatrix — der Teil, der entscheidet',
      desc: 'Stelle einen Opcode ein, takte dann durch die sechs Zeitschritte und sieh zu, wie die '
        + 'Steuerleitungen der Reihe nach feuern. T1 legt den Programmzähler auf den Bus (Ep, Lm), T2 zählt '
        + 'weiter (Cp), T3 holt den Befehl (CE, Li) — so weit ist es für jeden Befehl gleich. Ab T4 übernimmt '
        + 'der Opcode: LDA lädt den Akku aus dem Speicher, ADD führt über das B-Register und den Addierer, '
        + 'SUB genauso mit gesetztem Su, OUT kopiert den Akku in das Ausgaberegister. '
        + 'Jede Lampe hier ist ein UND-Term, verodert mit den anderen, die dieselbe Leitung treiben. Mehr ist '
        + 'ein fest verdrahtetes Steuerwerk nicht — und genau dieses Teil macht aus Registern, Speicher und '
        + 'Addierer einen Computer.',
      teaches: 'Fest verdrahtete Steuerung, UND-ODER-Matrix, der Hol-und-Ausführ-Zyklus' },
    table: [['any', 'T1', 'Ep, Lm'], ['any', 'T2', 'Cp'], ['any', 'T3', 'CE, Li'],
      ['LDA', 'T5', 'CE, La'], ['ADD', 'T6', 'Eu, La'], ['SUB', 'T6', 'Eu, La, Su'], ['OUT', 'T4', 'Ea, Lo']],
    cols: ['instruction', 'state', 'lines asserted'],
  },
  {
    src: 'c7-the-bus', id: 'pc107-the-bus', difficulty: 4,
    en: { title: 'The bus — one set of wires, many talkers',
      teaches: 'tri-state outputs, bus contention, why a control unit exists' },
    de: { title: 'Der Bus — eine Leitung, viele Sprecher',
      desc: 'Zwei Quellen, ein Vier-Bit-Bus. Gib A frei, und der Bus zeigt A; gib B frei, und er zeigt B; gib '
        + 'keinen frei, und die Pulldowns ziehen ihn auf null. Möglich macht das der Tristate-Treiber im '
        + '74HC244: sein Ausgang kann HIGH, LOW oder ganz LOSGELASSEN sein — ein drittes Verhalten, das ein '
        + 'gewöhnliches Gatter nicht hat. '
        + 'Gib jetzt BEIDE gleichzeitig frei. Ein Chip zieht eine Leitung hoch, während der andere sie '
        + 'herunterzieht, die Spannung landet in der Mitte, wo sie weder 1 noch 0 ist, und beide Chips werden '
        + 'warm. Das ist Busklemmung — und sie zu verhindern ist genau der Grund, warum es ein Steuerwerk gibt.',
      teaches: 'Tristate-Ausgänge, Busklemmung, warum ein Steuerwerk nötig ist' },
    table: [['neither', '0000'], ['A only', 'shows A'], ['B only', 'shows B'], ['both', 'neither 1 nor 0 — contention']],
    cols: ['enabled', 'bus'],
  },
  {
    src: 'c8-memory-walker', id: 'pc108-memory-walker', difficulty: 5,
    en: { title: 'The machine reads its own memory',
      teaches: 'clock phases, latching on the falling edge, address vs data paths' },
    de: { title: 'Die Maschine liest ihren eigenen Speicher',
      desc: 'Hier wird nichts mehr von Hand angefasst außer dem Takt. Der Programmzähler legt eine Adresse auf '
        + 'den Bus, das Adressregister übernimmt sie, das RAM antwortet mit dem dort Gespeicherten, und die '
        + 'grünen LEDs zeigen die Antwort — der nächste Takt macht dasselbe eine Adresse weiter. '
        + 'Erst laden: Daten einstellen, WRITE drücken, weitertakten, wiederholen. Dann nur noch takten und '
        + 'zusehen, wie die Maschine durch das läuft, was du geschrieben hast. '
        + 'Das Timing ist die eigentliche Lektion: Die Zustände schalten mit der STEIGENDEN Taktflanke weiter, '
        + 'die Register übernehmen mit der FALLENDEN — über einen Inverter. So ist der Bus eingeschwungen und '
        + 'der richtige Treiber aktiv, bevor irgendetwas übernommen wird. '
        + 'Die Inverterbank am RAM-Ausgang sitzt dort, weil der 74LS189 seine Daten invertiert zurückgibt.',
      teaches: 'Taktphasen, Übernahme mit der fallenden Flanke, Adress- und Datenpfad' },
    table: [['write 3,9,5,12', 'into cells 0-3'], ['then clock', 'cell 0 shows 3'], ['clock', '9'], ['clock', '5'], ['clock', '12']],
    cols: ['action', 'data LEDs'],
  },
  {
    src: 'c9-fetch-cycle', id: 'pc109-fetch-cycle', difficulty: 5,
    en: { title: 'The fetch cycle — reading an instruction, and knowing what it says',
      teaches: 'fetch sequencing, latched vs transparent registers, one driver at a time' },
    de: { title: 'Der Holzyklus — einen Befehl lesen und verstehen',
      desc: 'Drei Zeitschritte, und am Ende hält die Maschine einen Befehl, den sie versteht. T1: Der '
        + 'Programmzähler treibt den Bus, das Adressregister übernimmt die Adresse. T2: Der Zähler geht weiter '
        + '— gefahrlos, denn die Adresse ist schon gesichert. T3: Das RAM treibt den Bus, das Befehlsregister '
        + 'übernimmt, und der Dekoder macht sofort eine leuchtende Lampe daraus: LDA, ADD, SUB oder OUT. '
        + 'Ein Befehl ist hier vier Bit breit — die oberen zwei sind der Opcode, die unteren zwei die Adresse, '
        + 'auf die er wirkt — mehr kann ein Vier-Bit-Bus ehrlicherweise nicht tragen. '
        + 'Erst mit den Datenschaltern und WRITE ein Programm laden, dann takten und zusehen. '
        + 'Achte darauf, dass immer nur EIN Treiber aktiv ist: der Zähler bei T1, das RAM bei T3, bei T2 '
        + 'niemand. Genau diese Regel hält das Steuerwerk aufrecht.',
      teaches: 'Ablauf des Holzyklus, gelatchte gegen transparente Register, immer nur ein Treiber' },
    table: [['T1', 'counter drives bus, MAR latches'], ['T2', 'counter advances, bus idle'],
      ['T3', 'RAM drives bus, IR latches'], ['0111', 'decodes ADD'], ['1100', 'decodes OUT']],
    cols: ['state', 'what happens'],
  },
  {
    src: 'c10-the-machine', id: 'pc110-the-machine', difficulty: 5,
    en: { title: 'The whole machine — it runs a program',
      teaches: 'the stored-program idea, bus discipline, fetch-execute end to end' },
    de: { title: 'Die ganze Maschine — sie führt ein Programm aus',
      desc: 'Fünfundzwanzig Chips, ein Bus und ein Programm im Speicher. Lade vier Zellen von Hand und tu '
        + 'dann nichts mehr außer takten: Die Maschine holt jeden Befehl, findet heraus, was er bedeutet, und '
        + 'bewegt die Daten selbst. LDA lädt den Akkumulator aus dem Speicher, ADD und SUB laufen über das '
        + 'B-Register und den Addierer, OUT kopiert den Akku ins Ausgaberegister. '
        + 'Ein Befehl besteht aus zwei Bit Opcode und zwei Bit Adresse, also liegen Programm und Daten in den '
        + 'ersten vier Zellen. Schreibe LDA 3, ADD 3, OUT und 5 in die Zellen 0 bis 3, und am Ausgang steht '
        + 'zehn. Ändere nur Zelle 1 auf SUB, und dieselbe Hardware rechnet etwas anderes — genau das ist die '
        + 'Idee des gespeicherten Programms. '
        + 'Fünf verschiedene Dinge könnten diesen Bus treiben, und immer treibt ihn genau eines. Diese eine '
        + 'Regel, aufrechterhalten von der Steuermatrix, unterscheidet einen Computer von einem Haufen '
        + 'Register. '
        + 'Taktet man über OUT hinaus weiter, wird das Ergebnis zerstört — das ist kein Fehler: Ein Zwei-Bit-'
        + 'Opcode hat Platz für genau vier Befehle, und alle vier sind vergeben, also gibt es kein HALT. Der '
        + 'Zähler läuft in Zelle 3 weiter, liest die DATEN dort als Befehl und führt sie aus. Genau deshalb '
        + 'braucht jede echte Maschine ein Halt oder einen Sprung — und keines von beiden passt in zwei Bit.',
      teaches: 'Das gespeicherte Programm, Busdisziplin, Holen und Ausführen von Anfang bis Ende' },
    table: [['cell 0', 'LDA 3 (0011)'], ['cell 1', 'ADD 3 (0111)'], ['cell 2', 'OUT (1100)'],
      ['cell 3', 'data 5 (0101)'], ['after 3 cycles', 'OUT shows 10'], ['cell 1 -> SUB', 'OUT shows 0']],
    cols: ['memory', 'contents'],
  },
  {
    src: 'l10-diode-keypad', id: 'pc111-diode-keypad', difficulty: 4,
    en: { title: 'A decimal keypad made of diodes',
      teaches: 'diode-OR encoding, the forward drop, why priority encoders exist' },
    de: { title: 'Eine Dezimaltastatur aus Dioden',
      desc: 'Zehn Tasten, vier Leitungen, fünfzehn Dioden, kein einziger Chip. Jede Taste ist über Dioden auf '
        + 'genau die Bitleitungen verodert, die ihre Zahl nennt — drücke 5, und sie treibt die Einer- und die '
        + 'Vierer-Leitung, denn 5 ist 0101. Das ist der Teil, der aus einer Binärmaschine eine macht, in die '
        + 'man dezimal tippen kann. '
        + 'Zwei Dinge fallen auf, beide echt. Eine aktive Leitung liegt bei etwa 4,3 V statt 5 V, weil jedes '
        + 'Signal hier durch eine Diode läuft und eine Diode 0,7 V kostet — du siehst die Flussspannung in den '
        + 'LEDs. Und zwei gleichzeitig gedrückte Tasten ergeben die ODER-Verknüpfung ihrer Codes statt einer '
        + 'der beiden Zahlen: 1 und 2 zusammen lesen sich als 3. Eine Diodenmatrix hat keine Meinung dazu, '
        + 'welche Taste zuerst kam — genau deshalb sitzt hinter echten Tastaturen ein PRIORITÄTS-Encoder. '
        + 'Taste 0 hat gar keine Diode, also sehen „Null gedrückt" und „nichts gedrückt" gleich aus. Auch dafür '
        + 'haben echte Encoder eine eigene Leitung, die meldet, dass überhaupt eine Taste unten ist.',
      teaches: 'Dioden-ODER-Kodierung, Flussspannung, warum es Prioritäts-Encoder gibt' },
    table: [['1', '0001'], ['5', '0101'], ['9', '1001'], ['1 and 2 together', '0011 — a digit nobody pressed'],
      ['0 / nothing', 'both 0000']],
    cols: ['key', 'bit lines'],
  },
  {
    src: 'c11-control-rom', id: 'pc112-control-rom', difficulty: 5,
    en: { title: 'The control ROM — a control word you can program',
      teaches: 'microcode: the control word is fetched, not computed; why real CPUs are microcoded' },
    de: { title: 'Das Steuer-ROM — ein Steuerwort, das man programmieren kann',
      desc: 'Dieselbe Steuertabelle wie in pc106, und kein einziges Gatter berechnet sie. Vier Schalter sind '
        + 'der Opcode, ein 74LS161 zählt die sechs Schritte, und zusammen ADRESSIEREN sie zwei EEPROMs, deren '
        + 'Inhalt das Steuerwort IST. '
        + 'Der Unterschied ist der Punkt der Übung. Die Gattermatrix braucht für jeden neuen Befehl neue '
        + 'Gatter und wächst wie Befehle mal Zustände; das ROM braucht neue BYTES. Genau deshalb sind SAP-2, '
        + 'SAP-3 und jede echte CPU danach mikroprogrammiert. '
        + 'Achte auf den Zähler: Der Ringzähler aus pc104 sagt mit einer leuchtenden Leitung, WELCHER Zustand '
        + 'gerade gilt — eine ROM-Adresse will aber eine ZAHL. Deshalb steht hier ein Binärzähler. '
        + 'Zwölf Steuerleitungen passen nicht in ein Byte, also liegen zwei ROMs am selben Adressbus, genau '
        + 'wie in einem echten Aufbau. Die Holphase steht für alle sechzehn Opcodes im ROM, auch für die, die '
        + 'nichts bedeuten: Holen kann nicht davon abhängen, welchen Befehl die Maschine noch nicht gelesen '
        + 'hat. Stelle einen unbekannten Opcode ein, und die Maschine holt ihn ordentlich und tut dann nichts.',
      teaches: 'Mikrocode: das Steuerwort wird geholt, nicht berechnet — warum echte CPUs mikroprogrammiert sind' },
    table: [['T1', 'Ep, Lm — every opcode'], ['T2', 'Cp'], ['T3', 'CE, Li'],
      ['T4 (LDA/ADD/SUB)', 'Ei, Lm'], ['T4 (OUT)', 'Ea, Lo'], ['T5 (ADD)', 'CE, Lb'],
      ['T6 (SUB)', 'Eu, La, Su'], ['unknown opcode', 'fetches, then nothing']],
    cols: ['step', 'control word'],
  },
  {
    src: 'c12-conditional-jump', id: 'pc113-conditional-jump', difficulty: 5,
    en: { title: 'Flags — the same ROM, now with an opinion',
      teaches: 'conditional execution: flags as ADDRESS lines, so a branch costs bytes not gates' },
    de: { title: 'Flags — dasselbe ROM, jetzt mit einer Meinung',
      desc: 'Ein bedingter Sprung ist der Punkt, an dem eine Maschine aufhört, ein Selbstspielklavier zu '
        + 'sein: JZ tut je nach dem, was gerade passiert ist, das eine oder das andere. '
        + 'Stelle den Opcode auf 0011 (JZ) und takte bis T4. Ist der Z-Schalter aus, leuchtet nichts. '
        + 'Schalte Z ein, und derselbe Schritt setzt Ei und Lp — der Operand geht in den Programmzähler, '
        + 'und die Maschine springt. '
        + 'Dafür wurde kein einziges Gatter ergänzt. Die beiden Flags sind einfach zwei weitere '
        + 'ADRESSLEITUNGEN am Steuerspeicher, der dadurch von 128 auf 512 Byte wächst. Genau das kauft man '
        + 'sich mit Mikrocode ein, und deshalb ist es bei einer SAP-2 eine Programmier- und keine '
        + 'Verdrahtungsarbeit, Befehle hinzuzufügen. '
        + 'Zwei Proben lohnen sich: LDA verhält sich bei jeder Flagstellung gleich, und die Holphase auch. '
        + 'Wäre eine Adressleitung falsch angeschlossen, hinge plötzlich jeder Befehl vom letzten Ergebnis '
        + 'ab — und das Holen eines Befehls kann unmöglich davon abhängen, was der vorige ergeben hat.',
      teaches: 'Bedingte Ausführung: Flags als Adressleitungen, ein Sprung kostet Bytes statt Gatter' },
    table: [['JZ, Z=0', 'nothing at T4'], ['JZ, Z=1', 'Ei + Lp — it jumps'],
      ['JC, C=0', 'nothing'], ['JC, C=1', 'Ei + Lp'],
      ['LDA, any flags', 'unchanged'], ['store', '128 bytes -> 512']],
    cols: ['opcode and flags', 'what T4 does'],
  },
  {
    src: 'c13-alu-flags', id: 'pc114-alu-flags', difficulty: 5,
    en: { title: 'Eight bits, and flags the machine works out for itself',
      teaches: 'widening is mechanical; a zero flag is a comparator you can buy, an 8-input NOR is not' },
    de: { title: 'Acht Bit, und Flags, die die Maschine selbst ermittelt',
      desc: 'In pc113 kamen die Flags von zwei Schaltern. Hier kommen sie tatsächlich her. '
        + 'Zwei 74HC283 hintereinander — der Übertrag des unteren geht in den Carry-Eingang des oberen — '
        + 'ergeben einen Acht-Bit-Addierer. Das Verbreitern ist der langweilige Teil, und genau das sollte '
        + 'man einmal gesehen haben: keine neue Idee, nur doppelt so viel davon. '
        + 'Die Flags sind die neue Idee, und beide sind unterschiedlich teuer. CARRY ist einfach der '
        + 'Cout des oberen Addierers — eine Leitung, die ohnehin schon da war. ZERO nicht: Dafür müssen '
        + 'alle acht Summenbits gleichzeitig Low sein, und ein NOR mit acht Eingängen verkauft niemand. '
        + 'Deshalb liegt hier ein 74HC688-Komparator, dessen Q-Seite auf Masse gelegt ist: Er meldet '
        + 'P=Q genau dann, wenn die Summe null ist — und das ist ein Zero-Flag. So kauft man ein '
        + 'Acht-Eingang-NOR im Laden. '
        + 'Der Modus-Schalter invertiert über die XOR-Bank jedes B-Bit und schiebt unten eine Eins hinein: '
        + 'Zweierkomplement, dieselbe Hardware subtrahiert. Die Carry-Lampe bedeutet dann "kein Borgen".',
      teaches: 'Verbreitern ist mechanisch; ein Zero-Flag ist ein Komparator, den man kaufen kann' },
    table: [['200 + 100', 'sum 44, carry'], ['255 + 1', 'sum 0, carry AND zero'],
      ['0 - 1', 'sum 255, carry clear = borrow'], ['5 - 5', 'sum 0, zero, no borrow'],
      ['zero detect', '74HC688 with Q tied low'], ['adder', 'two 74HC283, carry chained']],
    cols: ['input', 'result'],
  },
  {
    src: 'c14-the-stack', id: 'pc115-the-stack', difficulty: 5,
    en: { title: 'A stack — the thing CALL and RET are made of',
      teaches: 'LIFO from a RAM and an up/down counter; why pop must retreat before it reads' },
    de: { title: 'Ein Stapel — das, woraus CALL und RET gemacht sind',
      desc: 'Dasselbe 16x4-RAM wie in pc102, nur liefert die Adresse jetzt ein 74LS193 statt des '
        + 'Programmzählers — und genau darum geht es: Ein 74LS161 zählt nur in eine Richtung, ein daraus '
        + 'gebauter Zeiger könnte ablegen und nie zurückholen. '
        + 'Ablegen heißt: Schalter stellen, /WE pulsen (Wert nach [SP]), dann PUSH pulsen (Zeiger weiter). '
        + 'Zurückholen heißt: erst POP pulsen (Zeiger zurück), DANN lesen. Diese Reihenfolge ist die ganze '
        + 'Disziplin — wer vor dem Zurücksetzen liest, bekommt die leere Zelle ÜBER dem Stapel und hält '
        + 'das für zerstörten Speicher, obwohl nur ein Zähler einen Moment zu spät getaktet wurde. '
        + 'Lege drei Zahlen ab und hole sie zurück: Sie kommen in umgekehrter Reihenfolge — die '
        + 'Eigenschaft, die eine Rücksprungadresse einen verschachtelten Aufruf überleben lässt. '
        + 'Beachte die Taster: Die beiden Takteingänge des 193 ruhen HIGH, hängen also an Pull-ups, und '
        + 'gezählt wird beim LOSLASSEN. Verdrahtet man sie andersherum, bewegt sich der Zeiger nie und '
        + 'der Stapel überschreibt still immer dieselbe Zelle.',
      teaches: 'LIFO aus RAM und Auf-/Ab-Zähler; warum POP erst zurücksetzen und dann lesen muss' },
    table: [['push 3, 7, 12', 'SP goes 0 -> 3'], ['pop', '12'], ['pop', '7'], ['pop', '3'],
      ['16 pushes', 'SP wraps to 0 — no depth check'], ['clocks', 'idle HIGH, count on release']],
    cols: ['action', 'what happens'],
  },
  {
    src: 'c15-call-and-return', id: 'pc116-call-and-return', difficulty: 5,
    en: { title: 'CALL and RET — the microcode moves the pointer',
      teaches: 'a subroutine call as rows of bytes; why CALL stores then moves and RET moves then reads' },
    de: { title: 'CALL und RET — der Mikrocode bewegt den Zeiger',
      desc: 'In pc115 wurde der Stapel von Hand bedient. Hier macht das der Steuerspeicher: zwei weitere '
        + 'Ausgangsbits, Spd und Spu, und CALL und RET sind einfach Bytezeilen wie jeder andere Befehl. '
        + 'Opcode 0101 einstellen und durchtakten — die Stapelzelle wird adressiert, die Rücksprungadresse '
        + 'kommt auf den Bus, und im letzten Schritt bewegt sich der Zeiger und die Maschine springt. '
        + '0110 ist dasselbe rückwärts, und dort bewegt sich der Zeiger ZUERST, denn die gesuchte Zelle '
        + 'liegt unter der, auf der er ruht. Diese Reihenfolge ist das ganze Korrektheitsargument: '
        + 'vertauscht man sie auf einer der beiden Seiten, wird die Rücksprungadresse aus einer nie '
        + 'beschriebenen Zelle gelesen. '
        + 'Und der Inverter ist kein Beiwerk: Eine Steuerleitung ruht LOW, die beiden Takteingänge des '
        + '74LS193 ruhen HIGH. Ohne ihn lägen beide Takte dauerhaft low, der Zeiger bewegte sich nie, und '
        + 'CALL wäre still ein Sprung, der vergisst, woher er kam.',
      teaches: 'Ein Unterprogrammaufruf als Bytezeilen; warum CALL erst speichert und RET erst zurückgeht' },
    table: [['CALL T4', 'Esp + Lm — address the slot'], ['CALL T5', 'Ep — return address on the bus'],
      ['CALL T6', 'Spd + Ei + Lp — move and jump'], ['RET T4', 'Spu — move FIRST'],
      ['RET T5', 'Esp + Lm'], ['RET T6', 'CE + Lp — read it back']],
    cols: ['step', 'control word'],
  },
  {
    src: 'c16-microcoded-machine', id: 'pc117-microcoded-machine', difficulty: 5,
    en: { title: 'The machine again, with a ROM where the matrix was',
      teaches: 'a microcoded CPU and a hardwired one are the same machine; what differs is what happens next' },
    de: { title: 'Dieselbe Maschine, nur mit einem ROM statt der Matrix',
      desc: 'Derselbe Rechner wie pc110, dasselbe Programm, dieselbe Antwort — und aus zehn Chips '
        + 'Steuerlogik sind zwei EEPROMs geworden. Schreibe LDA 3, ADD 3, OUT und 5 in die Zellen 0 bis 3, '
        + 'takte, und am Ausgang steht zehn, genau wie vorher. '
        + 'Der Datenpfad darunter ist der von pc110, Draht für Draht: derselbe Bus, dieselben Register, '
        + 'derselbe Addierer. Geändert hat sich nur, WOHER das Steuerwort kommt. Einen Befehlsdecoder gibt '
        + 'es auch nicht mehr, denn ein ROM braucht keinen — der Opcode IST ein Teil der Adresse. '
        + 'Der Unterschied zeigt sich erst beim nächsten Befehl: Eine Gattermatrix wächst um Gatter, ein '
        + 'ROM wächst um eine Zeile. Der Befehlssatz wird eine Datei, die man ändert, statt einer Platine, '
        + 'die man neu verdrahtet.',
      teaches: 'Mikroprogrammiert und festverdrahtet sind dieselbe Maschine; der Unterschied kommt später' },
    table: [['program', 'LDA 3, ADD 3, OUT, data 5'], ['output', '10, exactly as pc110'],
      ['control chips', '10 -> 2'], ['decoder', 'gone — the opcode is address bits'],
      ['step counter', 'binary, not one-hot'], ['microcode', '32 rows per ROM']],
    cols: ['what', 'value'],
  },
];

const mdTable = (cols, rows) => [
  `| ${cols.join(' | ')} |`,
  `|${cols.map(() => '---').join('|')}|`,
  ...rows.map((r) => `| ${r.join(' | ')} |`),
].join('\n');

const written = [];
const indexEntries = [];

for (const rung of LADDER) {
  const circuit = JSON.parse(readFileSync(join(GALLERY, `${rung.src}.json`), 'utf8'));
  const { seated, boardCount } = seatAll(circuit.parts);

  const parts = [];
  for (let i = 0; i < boardCount; i++) {
    parts.push({ id: `bb${i + 1}`, kind: 'breadboard', params: {}, terminals: [],
      x: 470, y: 300 + i * 300, rotation: 0 });
  }
  circuit.parts.forEach((p, i) => {
    const seat = seated.get(p.id);
    const { x, y } = place(p, seat, i);
    parts.push({
      id: p.id, kind: p.kind, params: p.params || {}, x, y,
      ...(seat ? { seat: { boardId: seat.boardId, leadMap: seat.leadMap } } : {}),
    });
  });

  const out = { vcc: circuit.vcc, parts, wires: circuit.wires };
  const dir = join(EXAMPLES, rung.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'circuit.json'), `${JSON.stringify(out, null, 1)}\n`);

  const seatedCount = seated.size;
  const offBoard = circuit.parts.length - seatedCount;
  const boardNote = {
    en: boardCount > 1
      ? `The build needs ${boardCount} breadboards — real logic runs out of holes quickly.`
      : 'Everything sits on one breadboard.',
    de: boardCount > 1
      ? `Der Aufbau braucht ${boardCount} Steckbretter — echter Logik gehen die Löcher schnell aus.`
      : 'Alles sitzt auf einem Steckbrett.',
  };
  const railNote = {
    en: 'Every chip gets +5 V and GND — an IC with no power does nothing, and a floating input does '
      + 'something worse: it reads whatever the room is doing. That is what the 10 kΩ pull-downs prevent.',
    de: 'Jeder Chip bekommt +5 V und GND — ein IC ohne Versorgung tut nichts, und ein offener Eingang tut '
      + 'Schlimmeres: er liest, was der Raum gerade macht. Genau das verhindern die 10-kΩ-Pulldowns.',
  };

  // A corpus meant to be BUILT owes the reader a shopping list. Rails are
  // dropped (vcc/gnd are symbols, not parts you buy) and the switch state
  // is stripped from the label — `switches=3` is this example's starting
  // position, not a thing to order.
  const bom = generateBom(circuit.parts)
    .filter((l) => l.kind !== 'vcc' && l.kind !== 'gnd')
    .map((l) => ({ qty: l.qty, label: l.label.replace(/\s*switches=\d+/, '') }));
  const bomTable = [
    '| qty | part |', '|---|---|',
    ...bom.map((l) => `| ${l.qty} | ${l.label} |`),
  ].join('\n');
  // decade_counter IS the CD4017, so a prefix test on the slug alone
  // undercounts it — and the count is quoted in docs/LADDERS.md.
  const isChip = (k) => /^(74|cd4|555|lm|ne5)/.test(k) || k === 'decade_counter';
  const chipCount = circuit.parts.filter((p) => isChip(p.kind)).length;

  writeFileSync(join(dir, 'intro.md'),
    `# ${rung.en.title}\n\n`
    + `${circuit._description}\n\n`
    + `**Teaches:** ${rung.en.teaches}\n\n`
    + `## What to do\n\nSet the DIP switches and watch the outputs. `
    + `${boardNote.en}\n\n${railNote.en}\n\n`
    + `## What you should see\n\n${mdTable(rung.cols, rung.table)}\n\n`
    + `## What to buy\n\n${bomTable}\n\n`
    + `${chipCount} integrated circuit(s), ${boardCount} breadboard(s), 5 V.\n`);

  writeFileSync(join(dir, 'intro.de.md'),
    `# ${rung.de.title}\n\n`
    + `${rung.de.desc}\n\n`
    + `**Vermittelt:** ${rung.de.teaches}\n\n`
    + `## Was zu tun ist\n\nStelle die DIP-Schalter und beobachte die Ausgänge. `
    + `${boardNote.de}\n\n${railNote.de}\n\n`
    + `## Was du sehen solltest\n\n${mdTable(rung.cols, rung.table)}\n\n`
    + `## Was du brauchst\n\n${bomTable}\n\n`
    + `${chipCount} integrierte Schaltkreis(e), ${boardCount} Steckbrett(er), 5 V.\n`);

  writeFileSync(join(dir, 'EXPECTED.md'),
    `# Expected behaviour — ${rung.en.title}\n\n`
    + `${mdTable(rung.cols, rung.table)}\n\n`
    + `Asserted by simulation in bw-circuit-ui's test/logic-ladder.test.js `
    + `(the same circuit, wire for wire) and re-checked seated in test/logic-examples.test.js.\n\n`
    + `Parts on a board: ${seatedCount}. Off board (rails and parts with no breadboard footprint): ${offBoard}.\n\n`
    + `## To build it\n\n${bomTable}\n\n`
    + `${chipCount} integrated circuit(s), ${boardCount} breadboard(s), 5 V.\n`);

  indexEntries.push({
    id: rung.id,
    title: { en: rung.en.title, de: rung.de.title },
    category: 'pure-circuit',
    difficulty: rung.difficulty,
    kind: 'circuit',
    files: {
      circuit: `${rung.id}/circuit.json`,
      expected: `${rung.id}/EXPECTED.md`,
      intro: `${rung.id}/intro.md`,
      introDE: `${rung.id}/intro.de.md`,
    },
  });
  written.push(`${rung.id}: ${parts.length} parts (${seatedCount} seated, ${boardCount} board(s)), ${circuit.wires.length} wires`);
}

// ── splice into examples/index.json, in id order after the last pc ──

const idxPath = join(EXAMPLES, 'index.json');
const index = JSON.parse(readFileSync(idxPath, 'utf8'));
const byId = new Map(index.map((e) => [e.id, e]));
for (const e of indexEntries) byId.set(e.id, e);
const merged = [...byId.values()];
writeFileSync(idxPath, `${JSON.stringify(merged, null, 1)}\n`);

for (const line of written) console.log(line);
console.log(`\n${indexEntries.length} examples written; index.json now has ${merged.length} entries.`);

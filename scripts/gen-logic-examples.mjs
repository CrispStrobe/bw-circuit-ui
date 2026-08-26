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

  writeFileSync(join(dir, 'intro.md'),
    `# ${rung.en.title}\n\n`
    + `${circuit._description}\n\n`
    + `**Teaches:** ${rung.en.teaches}\n\n`
    + `## What to do\n\nSet the DIP switches and watch the outputs. `
    + `${boardNote.en}\n\n${railNote.en}\n\n`
    + `## What you should see\n\n${mdTable(rung.cols, rung.table)}\n`);

  writeFileSync(join(dir, 'intro.de.md'),
    `# ${rung.de.title}\n\n`
    + `${rung.de.desc}\n\n`
    + `**Vermittelt:** ${rung.de.teaches}\n\n`
    + `## Was zu tun ist\n\nStelle die DIP-Schalter und beobachte die Ausgänge. `
    + `${boardNote.de}\n\n${railNote.de}\n\n`
    + `## Was du sehen solltest\n\n${mdTable(rung.cols, rung.table)}\n`);

  writeFileSync(join(dir, 'EXPECTED.md'),
    `# Expected behaviour — ${rung.en.title}\n\n`
    + `${mdTable(rung.cols, rung.table)}\n\n`
    + `Asserted by simulation in bw-circuit-ui's test/logic-ladder.test.js `
    + `(the same circuit, wire for wire) and re-checked seated in test/logic-examples.test.js.\n\n`
    + `Parts on a board: ${seatedCount}. Off board (rails and parts with no breadboard footprint): ${offBoard}.\n`);

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

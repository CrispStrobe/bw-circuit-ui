/**
 * What kind of part does a pin's DECLARED NAME assert?
 *
 * `buildSeatedFromDeclarations` chooses a part from the pin's DIRECTION alone —
 * analog becomes a potentiometer, input a button, output an LED — and uses the
 * declared name only as a label. So `PIN ldr = P1.3 ANALOG` is drawn as a
 * potentiometer and the picture contradicts the word the author wrote.
 *
 * Measured 2026-09-07 across the sb3-creator example corpus: of 2,504 seated
 * parts carrying a declName, twenty contradict their pin's name, all of them
 * `ldr` drawn as `potentiometer`. The authored benches are otherwise right —
 * relays, motors and buzzers there are real relays, motors and buzzers, wired
 * with their drivers. The defect belongs to this INFERENCE path, which draws
 * when no authored bench exists for the chosen device, so the person it
 * misleads is whoever writes their own program and gets a potentiometer for
 * their LDR.
 *
 * This module says what a name asserts and NOTHING about wiring. Two rules:
 *   1. DERIVED — a name token that IS a footprint kind wins outright. No table,
 *      and it grows by itself as the footprint library grows.
 *   2. A SMALL, STATED synonym table for words authors actually write.
 * A name that asserts nothing returns null and the direction-only default
 * stands. Agreement is never a contradiction: `piezo` on a piezo part is not a
 * defect, and an earlier measurement called twelve of those defects by applying
 * the synonym table before checking for agreement.
 */

export const NAME_SYNONYMS = {
  light: 'ldr', photo: 'ldr', lux: 'ldr', photocell: 'ldr',
  buzz: 'buzzer', beep: 'buzzer', speaker: 'buzzer', spk: 'buzzer',
  fan: 'dc_motor', pump: 'dc_motor',
  thermistor: 'ntc'
};

const byLength = (a, b) => b.length - a.length;

export function declaredPartKind(declName, kinds) {
  const name = String(declName || '').toLowerCase();
  if (!name) return null;
  const known = kinds instanceof Set ? kinds : new Set(kinds || []);
  for (const kind of [...known].sort(byLength)) {
    if (kind.length >= 3 && name.includes(kind)) return kind;
  }
  for (const word of Object.keys(NAME_SYNONYMS).sort(byLength)) {
    if (name.includes(word)) return NAME_SYNONYMS[word];
  }
  return null;
}

/**
 * Which asserted kinds this inference path can actually WIRE, by direction.
 *
 * Deliberately short. A kind is here only when the fallback can draw a circuit
 * that is correct without inventing parts the author did not ask for:
 *   - the analog entries are two-terminal RESISTIVE sensors, which take the
 *     same divider the potentiometer already takes;
 *   - a piezo buzzer is driven straight off a pin.
 * `dc_motor`, `relay` and `servo` are NOT here on purpose. A motor or a relay
 * coil needs a transistor and a flyback diode — which is exactly what the
 * authored benches draw — and synthesising a driver here would be inventing
 * electrical behaviour rather than reading a name. For those the default
 * stands, wrongly but visibly, until someone teaches this path about drivers.
 */
export const WIRABLE = {
  analog: new Set(['ldr', 'ntc', 'photodiode']),
  output: new Set(['buzzer'])
};

export function wirableKind(declName, kinds, dir) {
  const asserted = declaredPartKind(declName, kinds);
  if (!asserted) return null;
  const group = dir === 'analog' ? WIRABLE.analog : WIRABLE.output;
  return group.has(asserted) ? asserted : null;
}

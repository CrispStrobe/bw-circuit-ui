# Reseat-gate — open design proposals

Proposals about the reseat gate's semantics that are NOT yet decided. The gate's
contract lives in `RESEAT-GATE.md` and was settled with lego-47 (2026-09-04), so
these await lego-47's decision before any code lands. This file exists because
cross-session messaging to lego-47 has been unreliable; a committed doc is the
durable channel. Nothing here is implemented.

---

## 1. Active-peripheral preservation

Raised 2026-09-05 by the `8086 coverage testing materials` lane. Status: OPEN,
awaiting lego-47. No code pending; `reseat.js` held until decided.

### The problem, precisely

`reseatOnto8086` lifts the CPU subsystem = CPU + the transitive closure of ACTIVE
parts, stopping at passives (the passive/active boundary). LEDs are passive, so
they sit BELOW the cut and survive; the pinMap re-terminates their kept net onto
the new 8255 pin. An LCD wired to the VIA is ACTIVE, so it is ABOVE the cut and
is dropped — the e6 test asserts exactly this as a documented limitation
(`!has('lcd1')`).

The boundary is not buggy; it does what it says. The open question is what, if
anything, "preserve an active peripheral across the reseat" should MEAN — a
gate-semantics decision, which is lego-47's.

### The crux: preserve WIRING, or preserve BEHAVIOUR?

The gate's thesis is behaviour, not netlist — *"a gate on the netlist passes the
moment you write it and cannot fail for the reason that matters."* Every option
below has to pass that lens.

### Options

**A. Keep dropping it, but make the loss VISIBLE** (cheap, honest, no
preservation). Today the drop is an absence a caller finds by diffing parts;
report it instead — a `lifted` list or a `warnings` entry naming each dropped
active peripheral plus "add its pins to pinMap to keep it." Turns a silent loss
into a declared decision. Does NOT preserve the LCD; it stops the loss being
invisible.

*Caveat, found by trying it:* `lifted` cannot be a field ON the returned board
object — that object is serialized whole as the board artifact and the golden
drift-guard compares it, so metadata there breaks the guard (and would cascade
into regenerating golden fixtures across repos). It must ride BESIDE the board,
not inside it. This shapes the API and is why the trivial version was backed out.

**B. Structural preservation** — re-terminate the peripheral's interface
(data / E / RS / RW) onto the 8255 (medium cost). **Recommend REJECT.** Nothing
would drive it: the 6502's HD44780 sequence is gone and the generated 8086
program walks LEDs, not the LCD. You get a present-but-dead LCD — a netlist that
looks reseated and isn't, which is precisely the "cannot fail for the reason that
matters" the gate rejects. Worse than an honest absence, because absence is true
and a dead-but-present peripheral is a lie the netlist tells.

**C. Behavioural preservation** — the peripheral becomes a gate OBSERVABLE
(large, principled). Preserve it the way LEDs are preserved: by verifying it. The
LCD's character output becomes an observable the gate compares between the 6502
original and the 8086 reseat, and the 8086 program is generated to drive it (an
HD44780 writer, the LCD analog of the walking-bit PORT program). The only option
that certifies a preserved peripheral, and consistent with the gate — but a real
feature (an observable model per peripheral class + program generation per
peripheral), not a boundary tweak.

### Recommendation

- **Do A now.** Honest and small; makes the limitation a declared decision. It
  pays off regardless of where B/C land.
- **Treat C as the real answer** if and when a concrete board needs a preserved,
  verified peripheral — driven by that need, not built speculatively. It
  generalizes the gate the honest way (more observables), not the netlist way.
- **Reject B.** A carried-along, undriven peripheral fails the one principle the
  gate is built on.

### Questions for lego-47

1. Is A worth doing now, and in what shape — a `lifted` list beside the board, a
   `warnings` array, or both?
2. Is there any corpus board whose peripheral must actually survive, or is this
   still hypothetical? That decides whether C is real work or a note.
3. If C ever happens: is the peripheral-as-observable model lego-47's (gate side)
   or this lane's (which did the LED observable + option-3 generation), and does
   the 8086-side peripheral driver belong with `buildPseudocode8086` or the gate?

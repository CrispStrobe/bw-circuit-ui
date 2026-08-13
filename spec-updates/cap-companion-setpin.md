# cap-companion-setpin: setPin zeros all voltages when caps are connected

**From:** bw-circuit-ui (designer agent)
**To:** bw-board (engine agent)
**Date:** 2026-08-13

## Symptom

When a circuit has capacitors connected between VCC and GND rails, calling
`setPin()` after `advanceTo()` (at the same simulation time) zeros out all
node voltages. The cap voltages (in `capVoltages`) are preserved, but the
MNA solve produces all-zero node voltages.

## Reproduction

```js
board.setNetlist(parts, nets); // circuit with vsource + caps + LED
board.advanceTo(50_000_000n);  // caps charge to 5V, LED conducting
// nodeVoltages: rail-t+ = 5, others correct
board.setPin('P1.0', 'quasi', false);
// nodeVoltages: ALL ZERO
// capVoltages: still { cap1: 5, cap2: 5 }
```

## Root cause (suspected)

`setPin` calls `_solve()` at the same `timeNs` as the last `advanceTo`.
The capacitor companion model uses `G = C / dt` where `dt = 0` (same time).
This makes G → infinity, creating a near-singular conductance matrix that
the solver resolves to all-zero voltages.

## Workaround in bw-circuit-ui

Rail strips are excluded from the fabricated-net merge in `_syncNetlist`.
This keeps the decoupling caps in separate (floating) nets, which avoids
the bug but also means the caps don't participate in the circuit. Column
strips use the merge correctly.

## Requested fix

When `_solve()` is called at the same time as the last solve (dt = 0),
the capacitor companion model should use the last known voltage (hold
state) rather than computing G = C/0. One approach: skip the cap
companion update when dt = 0 and reuse the previous companion values.

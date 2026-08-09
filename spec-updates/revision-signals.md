# Revision signals: onDeclarationChange is correct for DRC and BOM

Filed 2026-08-09 from bw-circuit-ui in response to coordinator question.

## The question

Should CircuitDesigner expose an explicit revision signal (e.g. `onRevChange`)
for the host to know when to re-render panels, or is `onDeclarationChange`
sufficient?

## Answer: `onDeclarationChange` is the right trigger for DRC and BOM

**DRC** depends on circuit **structure** — which parts exist, how they're wired,
what pin modes are set. Structure changes are exactly when declarations change.
A `setControl(pot, 0.5)` or `advanceTo(100ms)` doesn't change wiring or
pin configuration, so the DRC result is unchanged.

**BOM** depends on the **parts list** — add/remove part = declaration change.
Simulation-time mutations don't affect the BOM.

**What `rev` bumps on that declarations don't:**
- `advanceTo` / `advanceBy` (simulation time)
- `setControl` (potentiometer position)
- `setPin` (pin mode change — this DOES affect DRC, and it also fires
  `onDeclarationChange` when the pin is declared)
- `setPower` (power toggle)

The `rev` counter is an internal React rendering signal, not a semantic one.
Exposing it to the host would couple lite to bw-circuit-ui's internal
render cycle — every pot turn would fire the callback.

## If live instrument displays need a signal later

For a scope panel showing live voltages, the right mechanism is
`board.onChange` (already exists in boundary B), not a CircuitDesigner prop.
The scope reads directly from the board instance it received via
`onCircuitReady` / `onBoardReady`.

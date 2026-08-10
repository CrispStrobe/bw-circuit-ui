# Circuit load precedence — three paths, one order

Filed 2026-08-10 from bw-circuit-ui.

## The three mechanisms

1. **circuitData prop** — gallery example loaded by the host (84b4dda)
2. **Autosave restore** — last session's wiring from localStorage (dd44d9c)
3. **Starter circuit** — the teaching circuit built on first open (9752b8c)
4. **Pin inference** — infer from project.stc.pins when declared

## Stated precedence (highest wins)

```
circuitData prop  >  pin inference  >  autosave  >  starter circuit
```

- An explicitly opened example always wins — the user clicked it.
- Pin declarations win over autosave — the project defines the circuit.
- Autosave wins over the starter — losing an evening's work to a reload
  was the bug dd44d9c fixed.
- The starter appears only on a genuinely first visit (no autosave, no
  pins, no circuitData).

## Current behavior

- circuitData fires via useEffect AFTER the mount effect, so it loads
  over whatever mount produced. This is correct.
- Autosave always has content after the first session, so the starter
  circuit is seen exactly once. This is by design — the starter is a
  first-impression, not a home screen.
- circuitData loading also triggers autosave (the example becomes the
  saved state). This means next visit without an example shows the last
  example, not the starter. Acceptable — the autosave IS the user's
  last state.

## What would be a bug

- A stale autosave shadowing a circuitData load (not possible — the
  effect fires after mount)
- The starter circuit appearing when autosave has real work (not
  possible — autosave check returns early before starter runs)
- circuitData being ignored because autosave loaded first (not possible
  — circuitData effect runs after mount effect)

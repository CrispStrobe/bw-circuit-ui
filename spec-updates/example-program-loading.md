# Example program loading: onProgramChange callback

## Problem
Examples that have both `circuit.json` and `program.bw` (e.g.
`33-inductive-no-flyback`) load only the circuit into the designer.
The program half is dropped — the debugger says "no pins declared"
even though the program declares `PIN motor_ctrl = P1.0 OUTPUT`.

## bw-circuit-ui change
CircuitDesigner now accepts an `onProgramChange` prop. When a user
loads an example that carries a `.program` field, the designer calls
`onProgramChange(example.program)` alongside `onLoadExample(example)`.

## Host (bw-bundle/lite) action required
1. The gallery index (`examples/index.json`) must include the parsed
   `program` field for examples that have `program.bw`:
   ```json
   {
     "id": "33-inductive-no-flyback",
     "program": {
       "source": "DEVICE STC12C5A60S2\nCLOCK 11059200\nPIN motor_ctrl = P1.0 OUTPUT\n...",
       "device": "STC12C5A60S2",
       "pins": [{"name": "motor_ctrl", "port": 1, "bit": 0, "direction": "output"}]
     },
     "circuit": { ... }
   }
   ```
2. CircuitTab must pass `onProgramChange` to CircuitDesigner and
   handle it by loading the program into the runtime:
   ```jsx
   <CircuitDesigner
     onProgramChange={(prog) => {
       // Load prog.source into the blocks editor
       // Update runtime.stc with prog.pins
     }}
   />
   ```

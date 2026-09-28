# CLI oscilloscope and multimeter

`bwc measure` runs the same circuit model and instrument APIs as the browser,
but reports measurements as text or JSON. It accepts Brickwright circuit JSON
and every foreign schematic format already accepted by `bwc info`.

Probe endpoints are explicit. Use `<part>.<terminal>` or `net:<engine-net-id>`;
the command refuses unknown and ambiguous selectors rather than guessing.

```sh
# Ideal scope tap and a voltage reading
bwc measure examples/50-rc-scope/circuit.json \
  --scope R1.b,GND.gnd \
  --meter voltage:R1.b,GND.gnd \
  --duration 20ms --rate 100kHz

# A real passive-probe approximation; 10x and 1x require an explicit reference
bwc measure divider.json \
  --scope RT.b,GND.gnd --probe 10x \
  --duration 1ms --rate 10kHz --json

# Signed current and power-off resistance
bwc measure divider.json \
  --meter current:RT.a \
  --meter resistance:RT.a,RT.b

# Uniform true samples for another tool
bwc measure divider.json --scope RT.b --duration 10ms --rate 20kHz \
  --csv trace.csv
```

Repeat `--scope` and `--meter` for multiple channels/readings. Scope summaries
report sample count, minimum, maximum, mean, RMS and last voltage. CSV records
the engine's true uniformly spaced samples oldest-first. JSON includes the
resolved net IDs, probe preset and the same summary.

The command is intentionally bounded to 10 seconds, 2 MHz and 200,000 samples
per channel. It refuses unmapped components, semantic import losses and
retained analysis blockers. Resistance readings turn circuit power off before
calling the existing multimeter API. Voltage/current readings and scope traces
are captured first while powered.

The `ideal` scope preset does not load the circuit. `10x` is 10 MΩ in parallel
with 15 pF and `1x` is 1 MΩ in parallel with 100 pF; both require an explicit
reference net. The CLI voltage meter is the existing ideal observer. To model
meter input impedance, place a physical meter part in the circuit.

These are native engine measurements, not independent oracle comparisons. A
private corpus item can be measured by passing its locally materialized file;
the CLI neither searches nor copies private corpus payload.

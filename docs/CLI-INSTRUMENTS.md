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

# Watch the actual simulation clock advance (newline-delimited JSON)
bwc measure sine.cir --scope V1.pos,V1.neg \
  --meter voltage:V1.pos,V1.neg --duration 1ms --rate 100kHz --watch

# Compare every timestamp and voltage with a reviewed analytical/oracle trace
bwc measure sine.cir --scope V1.pos,V1.neg \
  --duration 1ms --rate 100kHz --expect expected-waveform.json --json
```

Repeat `--scope` and `--meter` for multiple channels/readings. Scope summaries
report sample count, minimum, maximum, mean, RMS and last voltage. CSV records
the engine's true uniformly spaced samples oldest-first. Its rows use elapsed
time from the oldest retained sample, while the header's `startTimeNs` records
that sample's absolute simulation time. JSON includes `startTimeSeconds`, the
sample interval, resolved net IDs, probe preset and the same summary.

Every successful JSON meter reading includes numeric `siValue`/`siUnit` fields
for computation as well as the formatted display value. Current display values
autorange across A, mA, µA, nA and pA; a real nonzero current is never rounded
into a displayed zero merely because it is smaller than one microamp.

`--watch` emits one NDJSON `sample` record after each requested simulation-time
advance and finishes with one `summary` record. Each sample carries absolute and
elapsed simulation time, every scope voltage, and simultaneous numeric meter
readings. It does not sleep to imitate wall time: a 1 ms circuit simulation can
finish much faster or slower than 1 ms, while its timestamps remain the engine's
clock. Resistance mode is rejected because measuring resistance powers the
circuit off and therefore is not a powered time series.

Measurement keeps the engine's live interactive integration profile. An explicit
`--profile interactive-v1` selects the same policy; other profile requests refuse
instead of being silently ignored. For bounded high-accuracy source-declared
analysis, use `bwc analyze --profile precision-v1`.

JSON reports and watch summaries include `requestedTransientProfile` and the
engine's `transient` status: configured profile, integration mode, local step
qualification, failure detail and work counters. Text reports also name the
profile and local check. The status is captured before resistance mode powers
the circuit off. A local step check is not a global waveform-error bound or
independent-oracle agreement; unknown (`null`) or unmet status stays explicit.

Follow-up roadmap: support precision instrument capture only with explicit
initial-condition semantics, total-work budgets and independent waveform proof.
Do not turn arbitrary measurement durations into unbounded precision runs.

`--expect` reads a bounded, explicit waveform document and compares every sample
timestamp and voltage. Point-count, trace identity, missing samples and timestamp
drift fail independently of voltage tolerance. Defaults are 1 µV absolute,
1 ppm relative and 1 ps time tolerance; override them explicitly with
`--abs-volts`, `--rel` and `--time-tolerance`. A failed comparison exits 1 and
still prints the complete report.

A capture containing a nonfinite point is refused rather than dropping that
point and shifting later timestamps. Waveform comparison requires finite times
and voltages on both sides and at least one compared sample: neither an infinite
relative-tolerance calculation nor an empty trace can qualify as a pass.

The format is:

```json
{
  "schemaVersion": 1,
  "provenance": { "kind": "ngspice", "version": "42" },
  "traces": [{
    "tip": "V1.pos",
    "reference": "V1.neg",
    "samples": [
      { "timeSeconds": 0.00001, "volts": 0.9993335328713915 }
    ]
  }]
}
```

Provenance is reported but not trusted merely because a caller wrote
`"kind":"ngspice"`; the CLI therefore keeps `independentOracle:false`. The
independent CI/corpus runner is responsible for constructing and verifying real
ngspice references before handing the same sample document to this command.

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

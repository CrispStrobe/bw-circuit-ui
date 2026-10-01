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

The engine rounds sample periods and simulated duration to integer nanoseconds.
`rateHz` and `requestedSamples` retain the user's nominal request;
`effectiveRateHz`, `simulatedDurationSeconds`, and `plannedSamples` disclose the
actual clock and its complete-point count. Scope rows also expose the effective
rate and exact interval. Capture capacity and the 200,000-point safety limit
use that clock-derived count, so a non-divisor requested rate cannot silently
wrap away its first sample or evade the limit. Durations rounding to zero refuse.

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

Watching reads only the newest scope-buffer pair per channel per tick, rather
than rebuilding the entire trace at every observation. This keeps instrument
readout work linear in the number of streamed samples; circuit integration and
output transport have their own costs. The final summary still validates every
retained point, so earlier nonfinite samples cannot be hidden by this fast path.

Measurement defaults to the engine's live interactive integration profile. An
explicit `--profile interactive-v1` selects the same policy. Unknown profiles
refuse instead of being silently ignored. Source-declared analyses remain a
separate action: `bwc analyze --profile precision-v1`.

Opt-in precision **batch** capture:

```sh
node bin/bwc.mjs measure test/fixtures/cli-measure-probe.cir \
  --scope R2.a,V1.neg --probe 10x --duration 200us --rate 2MHz \
  --profile precision-v1 --initial zero-state --json --csv capture.csv
```

`zero-state` means initially uncharged capacitors and zero inductor current, not
a source-declared DC bias or LTspice startup ramp. The CLI flags select capture
timing/initialization; this is not execution of the deck's analysis cards.
Explicit part initial-condition fields refuse rather than being silently used.
The native time-zero operating point is checked for admission **with probe
loading**, but its bias is never adopted. A nonzero DC RC-step regression proves
the output charges from zero instead of starting at its steady-state voltage.

The initial admitted domain is a consistent time-zero R/C/L/V/I/E/G graph, at
most 32 user parts and 32 resolved nets, 1–4 scopes and at most 8 voltage/current
meters. Only fixed-size native waveforms are admitted; PWL/PCM, current-limited
supplies, non-passive/timed models and graphs lacking a solvable admitted bias
refuse by name. Redundant ideal-voltage constraint loops refuse, including an
initially-zero source that would later contradict its short. An explicit DC
zero self-short remains valid. This conservative boundary does not mean a
refused circuit is physically invalid or unsupported by other engine actions.

Precision capture advances the passive/source graph **once**: no `--watch`,
timed-device deadlines, driven PWM or resistance power-off tick can turn the
per-integrator limit into a repeated allowance. The fixed limit is 20,000
transient attempts, at most 60,001 transient solves (including the final
backstop solve), and one transient advance. Preflight checks the adaptive grid/
maximum-step floor; actual work and local failures are checked before JSON/CSV
qualification. Hitting the cap is a named refusal, never a partial passing trace.
Part/net/channel bounds also constrain setup and the separate admission solve;
the counters do not claim to measure CPU time or every setup operation.
Static captures with no transient work retain explicit unassessed (`null`)
local-step status. The policy/initialization are disclosed in `precisionCapture`.

JSON reports and watch summaries include `requestedTransientProfile` and the
engine's `transient` status: configured profile, integration mode, local step
qualification, failure detail and work counters. Text reports also name the
profile and local check. The status is captured before resistance mode powers
the circuit off. A local step check is not a global waveform-error bound or
independent-oracle agreement; unknown (`null`) or unmet status stays explicit.

Follow-up roadmap: add native whole-run work limits before enabling precision
streaming and timed/non-passive models, then qualify explicit DC-bias and startup
initialization separately. Do not turn arbitrary durations into repeated budget
allowances. Op-amp/device captures still use interactive measurement or their
separately bounded source-analysis action, not this narrower precision batch.

The pinned engine includes the fractional solve-time sampling repair: a solve
rounded up to a nanosecond grid point cannot publish that scope point early,
and interpolation retains the actual solve instants. Public Circuit regression
captures cover both passive probe presets on an imported pulse divider, checking
all 800 observations against live ngspice and an independent first-order R/C
response at 1 microvolt + 1 ppm. The same two fixtures are now compared through
the shipping CLI action and exported CSV at all 800 aligned points, with a
changed reference point making each comparison fail. These are two circuits/
probe configurations, not 800 distinct imported circuits or a universal oracle
certificate. Neither default CLI nor live GUI switches away from interactive.

Upstream follow-up: legacy MNA convergence can omit a grounded nonzero ideal
voltage source when another node exists. Strict `operatingPoint` already rejects
it; this action does not trust the weaker flag alone. Repair the general solver
constraint/closed-source handling under its own ownership, with nonzero/zero,
waveform, merged-ground and finite-internal-resistance controls. No general
legacy-solver repair is claimed by this CLI admission gate.

Voltage/current meters observe a DC mean over at most the last 100 ms. The CLI
primes each powered meter before advancing the capture, so both batch and watch
readout include the waveform from capture start rather than starting history at
the first output sample. JSON exposes `poweredMeterAcquisition` with that start
time, the maximum window and `independentIntegralCertificate: false`. Text output
states the same distinction. Scope samples remain instantaneous; a source's
last scope voltage generally differs from its meter mean.

The engine integrates accepted solve points at their actual substep times using
piecewise-linear quadrature, retaining the left/right limits of discrete changes.
The first direct API read still starts a watch and returns an instantaneous value;
the CLI's priming read is not emitted as a sample. Histories do not predate that
read. Idle watches expire after 2 s, so powered single-advance batches longer than
2 s refuse with `--watch` as the alternative. This does not raise the precision
work budget, and scope-only/resistance captures retain their existing policies.

Independent consumer fixtures check sine and pulse areas and signed resistor
currents through the installed package, Circuit, Instruments and CLI against
closed forms and live ngspice. Those are two self-authored source/resistor circuits;
the analytic inductor fixture below is a third, not a corpus
qualification. Numerical quadrature error depends on waveform curvature and
accepted step spacing: even an exact sine endpoint does not make its trapezoid
area exact. The short interactive sine watch test uses the explicitly derived
curvature/step error bound; the fixed precision oracle fixtures use 50 µV/50 nA.
An engine local step check is not a global integral certificate, physical meter
bandwidth model or true-RMS claim. The source-constrained analytic-inductor path
now supplies exact delayed/damped/phase-shifted sine integrals for its narrow
three-part topology: one ideal SINE current source, one ideal inductor and
ground. It retains its endpoint solver and first instantaneous meter reading;
later voltage and signed current means clip the actual analytic interval.
Editing the source/inductor parameters during an active watch still refuses
by name, because ideal-inductor jumps/impulses are not qualified.

For example, with `I1 0 signal SINE(0 1m 250)` and `L1 signal 0 1m`:

```sh
bwc measure inductor.cir --meter voltage:L1.a,L1.b --meter current:L1.a \
  --duration 7ms --rate 1kHz --json
```

This meter-only command uses the default interactive profile and the exact
analytic route; its current is signed OUT of `L1.a`. `--watch` reports the
running mean at each requested tick. The engine now coalesces unchanged
analytic history without changing the physical interval:
the imported Circuit/Instruments test retains two points across 700 ticks
and bounds actual indexed history reads per tick. The actual CLI watch test
checks all 700 voltage/current means at 100 kHz, not only a final endpoint.
Power boundaries and clipped 100 ms windows remain independently checked.
This is bounded history work, not a wall-time speedup or broader circuit claim.
The existing precision CLI admission
still requires 1–4 scope channels; it does not admit meter-only batches.
Adding a scope excludes the analytic shortcut and uses the adaptive solver;
this adoption does not newly qualify that different topology/acquisition path.
The imported inductor fixture is also checked against a separate live ngspice
voltage/current area and independent closed forms; it is not a corpus claim.

Remaining work: nonlinear and
high-frequency/aliasing cases, power-off residual-charge current measurements,
and explicit meter bandwidth/RMS behavior. No general legacy-MNA fix or GUI/Lite
package/deployment adoption is claimed here.

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
Scope ring metadata and values are frozen before that power-off tick, including
when the tick crosses the next sampling boundary; it cannot append a false 0 V
tail to the powered waveform.

The `ideal` scope preset does not load the circuit. `10x` is 10 MΩ in parallel
with 15 pF and `1x` is 1 MΩ in parallel with 100 pF; both require an explicit
reference net. The CLI voltage meter is the existing ideal observer. To model
meter input impedance, place a physical meter part in the circuit.

These are native engine measurements, not independent oracle comparisons. A
private corpus item can be measured by passing its locally materialized file;
the CLI neither searches nor copies private corpus payload.

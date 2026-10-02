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

Repeat `--scope` and `--meter` for multiple channels/readings. Scope traces
can be checked with `--expect`; meter-only captures now also support
`--expect-meters meter-reference.json` in batch and `--watch` modes.

### Full-grid AC reference checks

`analyze` can compare its existing source-declared AC results with an explicit
complex-voltage reference:

```sh
bwc analyze filter.cir --profile precision-v1 --expect-ac ac-reference.json --json
```

The input needs a supported `.ac` card and explicit independent AC excitation.
The source-analysis adapter's native model, grid and convergence refusals are
unchanged. `precision-v1` is the command's existing explicit profile selection;
it does not turn AC analysis into a transient capture.

Reference schema (an illustrative one-node, two-frequency result):

```json
{
  "schemaVersion": 1,
  "provenance": {"kind": "reviewed-reference"},
  "analyses": [{
    "analysisId": "0:ac",
    "frequenciesHz": [10, 100],
    "frequencyToleranceHz": 0.000000001,
    "nodes": [{
      "id": "n0", "unit": "V",
      "absoluteTolerance": 0.000000001, "relativeTolerance": 0.000001,
      "real": [1, 1], "imaginary": [0, 0]
    }]
  }]
}
```

Include **every** AC analysis and every reported node in report order. Analysis
ids include their ordinal among all source analysis cards; canonical node ids
(`n0`, `n1`, ...) are source-topology identities, not original SPICE names.
Review the report's topology when building an independent reference. The
comparison does not certify source-file identity or the correctness of this
mapping. It supplies no source-file identity attestation.

Each observation is a ground-referenced complex voltage in volts. Reported
magnitude/phase is converted to real/imaginary components, then compared by
complex Euclidean error against `absoluteTolerance + relativeTolerance *
hypot(expectedReal, expectedImaginary)`. Relative allowance uses the reference,
not the actual reading. Equivalent phases such as -180 and +180 degrees agree;
finite zero magnitude is phase-insensitive. Nonfinite readings, negative
magnitude or overflowed allowance fail, not pass. Terminal-current and
differential-voltage references are not supplied by this adapter.

Frequency identity is checked independently with the explicit nonnegative
absolute Hz allowance (default 1e-9 Hz). No interpolation, grid resampling,
analysis/node omission or compared-zero pass. All AC results must be successful;
any refused non-AC source analysis also retains the command's failure status.
Reference bounds: 4 MiB, 1–8 analyses, 1–128 nodes each, 1–4096 positive strictly
increasing frequencies each, and 200,000 complex observations total. Node ids
and analysis ids must be unique within their respective scopes; every node
needs an explicit `V` unit and finite nonnegative absolute tolerance. Relative
tolerance defaults to zero. Every real/imaginary entry must be finite.

JSON adds `acComparison` without altering native `results`; text prints its
summary. Exit 0 means execution and reference comparison succeeded, exit 1
means a numerical/structural mismatch or native refusal, and exit 2 means invalid
arguments/reference input. At most 20 mismatch details are included; failure
totals remain complete. Without `--expect-ac`, existing output is unchanged.
User-written provenance is untrusted metadata: agreement with supplied values
does not assert that an independent oracle ran or establish hardware fidelity.

The focused CLI tests run one RC and one resonant RLC circuit against live
ngspice and independent complex-impedance controls: 201 frequencies per circuit,
402 frequency points and 1,005 complex node-voltage observations altogether.
Changing reference point 137 fails exactly that point in each curve. These are
two deliberately constructed circuits, not a corpus-wide qualification.

### Strict DC source curves

```sh
bwc dc-sweep divider.cir --source V1 --from -1 --to 1 --points 201 \
  --observe R1.b,GND1.gnd --current V1.pos --json

bwc dc-sweep diode.cir --source V1 --from 0 --to 5 --points 201 \
  --observe R1.b,GND1.gnd --current D1.anode --expect dc-reference.json --json
```

`--from`/`--to` are finite voltages (plain numbers, including scientific notation);
`--points` includes both endpoints. Ascending and descending grids are supported.
Defaults are 0 to 5 V, 21 points. The selected source must be one uniquely named
`vsource`, not a supply part. Each point clones the imported circuit, sets only
that source's `volts`, and calls public strict `operatingPoint`. No previous
point's storage, meter history or nonlinear solver state is reused. This is a
static curve, **not** a time trace, oscilloscope acquisition or temperature sweep.

Repeat `--observe tip[,reference]` and `--current part.terminal`. Voltages are
differential or relative to engine ground; currents retain the native signed
terminal convention. Limits: 2–501 points, 1–32 parts, at most 32 nets and
1–8 observations, endpoints within ±1000 V. A grid that collapses at floating
point resolution refuses. The engine's strict DC supported-kind/parameter
domain remains authoritative. Non-DC source waveforms, selected-source explicit
`dcBias`, semantic import losses and retained blockers refuse rather than being
silently overridden. Any unconverged/conflicting or nonfinite point aborts with
its index and swept voltage; no successful partial JSON curve is printed.

`--expect` uses this curve schema, distinct from transient/meter references.
This illustrative reference is for a **two-point divider** sweep from -1 to
1 V; the 201-point commands above require their own full matching references:

```json
{
  "schemaVersion": 1,
  "sourceId": "V1",
  "observations": [
    {"kind": "voltage", "selector": "R1.b", "reference": "GND1.gnd",
     "unit": "V", "absoluteTolerance": 0.000001, "relativeTolerance": 0},
    {"kind": "current", "selector": "V1.pos", "reference": "",
     "unit": "A", "absoluteTolerance": 0.000000001, "relativeTolerance": 0}
  ],
  "sourceVoltageTolerance": 0.000000000001,
  "samples": [
    {"sourceVolts": -1, "values": [-0.5, 0.0005]},
    {"sourceVolts": 1, "values": [0.5, -0.0005]}
  ]
}
```

Voltage observations precede current observations, with command order retained
within each group. Reference channel identity/order, SI units, grid and sample
counts must match; values are not interpolated or dropped. Every channel needs
an explicit nonnegative absolute tolerance; relative tolerance defaults to 0
and scales the **expected** magnitude. Reference size is bounded at 4 MiB,
501 points and 8 channels. A mismatch exits 1 with full result and at most 20
diagnostics; unsupported input or a failed solve exits 2; completion/match exits
0. Text output is a tab-separated curve; JSON preserves typed channels, strict
analysis metadata and optional comparison. Caller reference provenance is
reported, never authenticated as an independent-oracle certificate.

The focused proof uses two self-authored circuits: 201 divider points checked
against closed form and live ngspice, plus 201 Shockley/series-resistance diode
points checked against an independent implicit equation and live ngspice.
That is 402 operating points / 804 selected V/A observations—not 402 imported
corpus circuits, nor universal nonlinear or transient qualification.

### Reproducible diagnostic receipts

Use `--receipt capture.json` to save a separate JSON diagnostic record without
changing measurements or their normal JSON/text/NDJSON output:

```sh
bwc measure sine.cir --scope V1.pos,V1.neg --duration 1ms --rate 100kHz \
  --expect expected-waveform.json --csv trace.csv --receipt capture.json --json
```

The receipt records SHA-256 and byte counts of the exact top-level input and
reference buffers used, an imported parts/wires/supply fingerprint, observed
Board and CLI JS/JSON runtime tree fingerprints, the declared package spec,
actual engine selection (including `BW_BOARD`), Node version, working directory,
argument array, effective integer-nanosecond clock, CSV hash if requested, and
the complete final report including endpoints, local work/failure and reference
comparison diagnostics. A completed comparison failure still writes a receipt
with `exitCode: 1`; a refused/aborted acquisition does not produce a completed
receipt. Watch receipts contain the final summary and sample count, not all
NDJSON samples: redirect stdout if the full timeline is needed.

Save the input, references and optional CSV/NDJSON alongside the receipt. Replay
the recorded argument array under the recorded working directory and compare
content fingerprints before comparing numbers; choose a **new** receipt path.
Existing receipt destinations are refused, and the final write is exclusive.
The receipt and CSV paths must differ. Receipt files intentionally contain local
paths/invocation details, so review them before publishing.

This is opt-in forensic evidence, not a hermetic execution or oracle certificate.
Fingerprints are observed before simulation, not a guarantee that files cannot
change later. The runtime tree covers `package.json`, recursive `src` JS/JSON,
and the CLI entrypoint for CUI; external modules, WASM, native binaries and other
assets are not an execution-closure attestation. Sibling libraries/sheets read
by importers are not archived or independently hashed, though changes to their
resulting parts/wires alter the imported-circuit fingerprint. A declared pin is
not falsely presented as an overridden engine's identity. Source bytes and full
waveforms are not embedded, and supplied reference provenance remains untrusted.

### Verify a saved receipt before comparing a replay

```sh
bwc verify-receipt capture.json --input sine.cir \
  --expect expected-waveform.json --csv trace.csv --json
```

Supply `--expect-meters` too if that reference was recorded. Verification is
read-only: it does not simulate, execute saved arguments, use saved working
directories or follow embedded runtime roots. Files must be supplied explicitly;
the current installed engine (or current `BW_BOARD`) and current CLI are
fingerprinted. It compares input/reference/CSV hashes **and byte counts**,
imported parts/wires/supply, engine selection/declared spec/observed tree, CLI
tree and Node version. Equal bytes may be relocated or renamed. Missing or
unexpected artifacts, changed importer output and changed runtimes are named
in `checks`; changing the CLI code itself legitimately changes its tree hash.

Exit `0` means these identity checks match, `1` means at least one differs,
and `2` means malformed/unsupported receipt, unavailable supplied file or
invalid command. Receipts larger than 4 MiB refuse. Optional reference/CSV
files recorded in the receipt must be supplied for a match; their embedded
filenames are never automatically opened. Unrelated acquisition flags refuse.

An identity match does **not** mean the recorded measurements passed. The
reported `recordedMeasurementExitCode` remains separate, and is itself an
untrusted receipt field. This does not verify recorded measurement values,
clock/invocation integrity, a complete dependency closure, signed provenance,
physical fidelity or independent oracle agreement. Run the numerical reference
checks again on replay output; retain actual CSV/NDJSON for waveform review.

```sh
bwc measure inductor.cir --meter current:L1.a --duration 7ms --rate 100kHz \
  --watch --expect-meters meter-reference.json
```

A meter reference has this explicit schema (a batch has exactly one sample
per channel; a watch has one per emitted sample, excluding its summary):

```json
{
  "schemaVersion": 1,
  "acquisition": "batch",
  "provenance": {"kind": "analytical", "model": "constant 1 mA, signed OUT"},
  "timeToleranceSeconds": 1e-12,
  "meters": [{
    "mode": "current", "probes": ["L1.a"], "siUnit": "A",
    "quantity": "observed-dc-mean", "absoluteTolerance": 1e-9,
    "relativeTolerance": 0,
    "samples": [{"timeSeconds": 0.007, "siValue": -0.001}]
  }]
}
```

This example describes a constant-current fixture, not the sine fixture above.
Channel order, mode, ordered probe selectors, units, quantity, sample count and
simulation timestamps must match.
Batch channel order follows the report: powered meters first, then resistance
readings, preserving order within each group. Streaming preserves meter order.
The allowed value error is the channel's
explicit absolute tolerance plus its relative tolerance times the absolute
**reference** value. No interpolation, resampling, dropped points or unsigned
current substitution occurs. Voltage/current are observed DC means over the
watch interval (at most the trailing 100 ms), not instantaneous scope samples
or true RMS. Resistance uses unit `Ω`, quantity `power-off-resistance` and the
actual timestamp after the power-off tick; it is batch-only.

References are parsed before simulation; malformed/nonfinite values, incompatible
acquisition, missing quantities/absolute tolerances and unsupported units refuse
with exit 2. At most eight channels, 200,000 total reference points and 16 MiB
are accepted. Comparison retains counters and at most 20 mismatch diagnostics,
not a second actual history. A completed mismatch exits 1 and includes
`meterComparison` in JSON or the watch summary, with per-channel worst error,
timestamp/value context and complete failure counts. Match exits 0. Supplied
provenance is reported, never trusted as an independent-oracle certificate.
For ngspice ground truth, integrate signed current/voltage over the same meter
window before writing the reference; raw transient endpoints are not meter means.

Scope summaries
report sample count, minimum, maximum, mean, RMS and last voltage. CSV records
the engine's true uniformly spaced samples oldest-first. Its rows use elapsed
time from the oldest retained sample, while the header's `startTimeNs` records
that sample's absolute simulation time. JSON includes `startTimeSeconds`, the
sample interval, resolved net IDs, probe preset and the same summary.

Scope RMS is the square root of the mean squared **sample values**, not a
bandwidth-qualified physical-meter reading. Its accumulation is scaled so
finite representable results do not become Infinity/null or zero merely because
raw squares overflow or underflow. Mean retains the existing finite sum;
only an overflowed sum uses a bounded normalized fallback. Zero traces remain
zero, and nonfinite samples still refuse. These are floating-point robustness
guarantees, not exact cancellation arithmetic, an expanded physical-voltage
domain, anti-alias filtering or additional solver fidelity. Numeric boundary
tests use deliberately extreme ideal sources, not real hardware voltages.

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

An independent source with finite positive `rInternal` is not an ideal voltage
constraint: its resistance permits a voltage difference and determines its
current. Precision admission resolves both terminals but does not add that
source to the ideal-cycle graph. Unknown/nonfinite resistance and ideal/VCVS
cycles retain the existing refusal policy; current-limited precision sources
remain outside the admitted domain. Native source consistency is checked during
netlist construction, so a contradictory ideal self-short can refuse before
the precision topology check.

For a 5 V source with 10 Ω internal resistance and its external terminals
shorted, the measured current is 0.5 A whether those terminals are at ground
or on a driven 1 V node. That circulating current does not load an unrelated
supply on the node. Installed-engine regressions cover both polarities in
batch, watch and precision mode; the native OP oracle uses equivalent explicit
source/resistor ngspice decks. A zero-resistance redundant ideal source has
indeterminate individual branch current; its valid voltage identity is not a
physical current-measurement guarantee.

Requesting the current of that redundant ideal source now refuses capture:
the shared meter model displays an unavailable reading (`---`, no numeric
value), and CLI batch/watch/precision exits with an error rather than returning
`0 A`. Its valid voltage identity and unrelated load currents remain readable.
Finite resistance makes the branch current determinate, including a genuine
zero-current result. A powered-off source also retains its known zero reading.
This is a scoped source-current availability contract, not a claim that every
missing device-current entry has been classified.

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

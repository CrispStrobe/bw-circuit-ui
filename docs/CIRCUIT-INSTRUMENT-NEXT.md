# Circuit and instrument campaign

Current execution order, 2026-10-15. This guide is the shared circuit campaign
contract; each repository's `LANES.md` still controls ownership. Historical
results retain their original revision and do not qualify a newer package.

## Evidence regimes

Keep four states separate: upstream implemented and tested; consumer pin and
lock adopted; installed CLI/GUI actually exercised; deployed/released artifact
verified. Advancing one state does not establish the next. Board owns device
physics and integration; CUI owns import/export and instruments; Lite owns its
packaged application and user journeys. Never repair an upstream defect by
introducing a consumer source fork.

## Five ordered tasks

### 1. LM741 evidence audit and landing — complete

Exact CUI `1db1bb9ee565338672c7acfefec4cf94b27196e1` passed all four jobs in
[CI 38677905766](https://github.com/CrispStrobe/bw-circuit-ui/actions/runs/38677905766)
and landed normally. A standalone reader, without producer-helper imports or
engine replay, accepted six signed/phase cases: 960 batch/watch voltage values
and 738 meter values, plus exact whole-window work and stream receipts.
Maximum observed errors were 3.637 nV at the output, 0.282 nV for the voltage
mean and 28.18 fA for the load-current mean; load-terminal current sums were
zero. The fixed gates remain 100 µV/2 µV/0.2 nA, not fitted to these results.
The precision surface passes 138 tests with no skips. These are nominal model
checks, not physical-device calibration or general vendor-model equivalence.

### 2. One coordinated consumer refresh — next

Start after the existing STM32 package adoption, Lite PR952, not beside it.
Preserve that lane's qualified Board/SB3 selections. Advance the CUI authority
deliberately to a qualified descendant carrying the current-selector refusal
and LM741 domain; derive both package specifications/locks and affected notice,
census and pin assertions from that authority. Review the complete range.

Accept only with exact installed package identity, the relevant measurement
tests using the installed CLI without a checkout override, and an actual built
GUI instrument journey. No source copy, fallback-to-HEAD, unrelated pin churn
or deployment claim. Source-documentation-only successors do not require a
second package refresh when the runtime bytes are unchanged.

### 3. Current-pinned stratified measurement regression

Run at least 300 deterministic public or project-authored circuit cases across
resistor networks, RC/RL filters, diode circuits, transistor stages, op-amp
followers/amplifiers and regulator startup. Report distinct topologies and
parameter variants separately. Freeze exact engine, importer, harness, oracle,
inputs and tolerances before the run; use hosted compute for engine execution.

Exercise meaningful differential voltage and signed terminal-current insertion
points, complete time traces, meter windows and finite watch prefixes. Compare
against independent analytical controls and ngspice where its equations match
the declared model. Include deliberately wrong references, missing samples,
nonfinite observations and sign reversals. Report requested, attempted,
comparable, passed, failed and refused separately; an oracle startup success is
not numerical agreement. Do not silently reinterpret unsupported vendor models.

### 4. Classify and repair observed failures

Assign each actual failure to importer loss, missing dependency, unsupported
physics, solver/integration, instrument/acquisition or harness/oracle error.
Preserve the original failure, isolate a minimal public/project-authored
reproducer and repair its owning repository. Add a load-bearing negative or
mutation and rerun the affected stratum with the original bounds. Document
unimplemented domains as refusals rather than fabricating a pass. This task
closes defects demonstrated by task 3, not every model in the external corpus.

### 5. Demonstrated instrument-realism closure

Audit probe/reference loading, DC/AC/GND coupling and analogue bandwidth,
sampling/aliasing and ADC/range behavior, and trigger/record semantics in the
actual CLI and GUI. Distinguish already implemented behavior from genuine gaps.
Implement the highest-priority bounded user-visible gap established by that
audit, retaining an ideal diagnostic path and unchanged solver/source data.

Prove the selected behavior using analytical or independent-oracle expectations,
actual timed readings and actual GUI controls; cover mode changes, reset,
record identity and refusal/negative cases. Keep existing source/model tests
green and qualify the installed consumer. Noise, physical calibration and
manufacturer-specific accuracy need separate evidence and are not implied.
After these five tasks, report the reached evidence and remaining limits and
ask the user for further direction before taking another campaign.

## Corpus denominators and model priorities

The [private corpus inventory](https://github.com/CrispStrobe/circuit-oracle-corpora)
records 136,880 physical records across its catalog layers. That is not a count
of unique circuits, successful imports, simulations or oracle comparisons.
The recorded 46,403-row additive ADI run has 35,079 import passes, 10,907 partial
imports and 417 support/not-run records. Its independent comparison partition
is 12,516 pass, 1,654 partial, 96 fail and 32,137 not-run; 5,625,557 of 5,625,902
actually compared finite observations pass. Those are historical exact-head
receipts, not a resweep of the current packages. Never publish restricted
payload merely because it appears in an index.

Prioritize useful educational/practical circuits and repeatable underlying
defects. Imported macro-model dependencies are not equivalent to native named
parts. Preserve physical package identity, actual pin order, breadboard/carrier
or PCB mounting, and bounded electrical behavior as separate requirements.
Do not add a decorative part or silently substitute a model to improve a count.

## Other fronts

The [Board x86 lanes](https://github.com/CrispStrobe/bw-board/blob/master/docs/X86-NEXT-LANES.md),
[Lite SPIKE lanes](https://github.com/CrispStrobe/brickwright-lite/blob/main/docs/SPIKE-STATUS-AND-LANES.md),
[target lanes](https://github.com/CrispStrobe/brickwright-lite/blob/main/docs/TARGET-NEXT-LANES.md)
and [Arcade handoff](https://github.com/CrispStrobe/brickwright-lite/blob/main/docs/ARCADE-AGENT-HANDOFF.md)
remain their owners' authorities. This campaign does not take their executable
paths or promote their upstream progress into a shipped-app claim.

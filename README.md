# bw-circuit-ui

A React circuit workshop for Brickwright: build and wire circuits, inspect them
as breadboards or schematics, and measure their simulated behavior. It also
provides the `bwc` command-line tools for import, analysis and instrument tests.

Electrical simulation comes from [bw-board](https://github.com/CrispStrobe/bw-board).
This repository owns the circuit editor, import/export adapters, instrument UI
and CLI—not the engine's device physics or the host application's deployment.

## Run locally

Use Node.js 20 or newer and npm:

```sh
npm ci
npm run dev
```

Open http://localhost:3100. The development app supplies the engine integration;
embedding the library in another app requires the setup below.

## What you can do

- Place parts, wire breadboards, interact with controls and inspect circuit warnings.
- View generated schematics, bills of materials and examples, including
  the logic ladder (l0..l10) and computer ladder (c0..c17).
- Use oscilloscope traces, voltage/current/resistance meters, DC operating points
  and supported frequency/source analyses.
- Import supported subsets of SPICE, LTspice ASC, KiCad, EAGLE, EasyEDA,
  Fritzing and Wokwi documents. Import reports expose unsupported components
  and semantic losses; loading a drawing does not guarantee it is simulatable.
- Work with supported PCB documents, footprints and copper connectivity,
  and export circuit/board data through the shared export registry.

Format versions and supported models differ. See the
[import registry](src/importers/index.js), [export registry](src/model/exporters/registry.js),
[LTspice guide](docs/LTSPICE-IMPORT.md) and [PCB support](docs/PCB-SUPPORT-PLAN.md).

## Command-line instruments

From a checkout, run `node bin/bwc.mjs --help`; the installed package exposes
the same command as `bwc`.

```sh
# Inspect an included circuit
node bin/bwc.mjs info test/fixtures/cli-measure-divider.json

# Capture a waveform and a voltage reading
node bin/bwc.mjs measure test/fixtures/cli-measure-divider.json \
  --scope RT.b,GND.gnd --meter voltage:RT.b,GND.gnd \
  --duration 20ms --rate 100kHz --json
```

Commands include `info`, `op`, `analyze`, `measure`, `dc-sweep`,
`verify-receipt`, `convert`, `render` and `audit`.
Measurements support text/JSON, CSV traces, live simulation-clock output,
explicit waveform/meter references and optional provenance receipts.
DC sweeps use fresh strict operating points and can compare complete signed
voltage/current curves against a supplied reference.

Read [CLI instruments](docs/CLI-INSTRUMENTS.md) for selectors, acquisition
profiles, limits, schemas and exit codes, and
[source analysis](docs/SOURCE-ANALYSIS.md) for supported analysis domains.
A receipt verifies recorded identities and inputs; it is not a numerical
oracle, hardware calibration or proof that a deployment contains this code.

## Embed in a React application

Install compatible `bw-circuit-ui` and `bw-board` revisions together with
React 18. Pin Git dependencies to full commit SHAs and commit the lockfile
rather than copying source into the host.

```jsx
import { CircuitDesigner, setEngine } from 'bw-circuit-ui';
import {
  BoardImpl, inferNetlist, checkWiring, getDevice, registerAllDevices,
} from 'bw-board';

registerAllDevices();
setEngine({ BoardImpl, inferNetlist, checkWiring, getDevice });

export function Workshop() {
  return <CircuitDesigner project={{ pins: [] }} />;
}
```

An optional `board` prop connects an externally driven emulator instead of
the standalone scripted simulation. The host owns program loading, persistence
and application layout. See [component props](src/components/CircuitDesigner.jsx),
[engine injection](src/engine.js) and [public exports](src/index.js).
Repository and consumer responsibilities are described in
[UPSTREAM-WIP](docs/UPSTREAM-WIP.md).

## Limits worth knowing

- This is not a drop-in implementation of every SPICE dialect, vendor model
  or schematic/PCB format. Unsupported analysis domains must be inspected,
  not treated as successful measurements.
- Op-amp and other component readings follow the particular engine model;
  they do not imply complete silicon, parasitic or thermal fidelity.
- PCB import and connectivity tools do not constitute manufacturing sign-off.
  Automatic schematic projection is not an authored publication-quality layout.
- Canvas artwork mixes rendering systems. Palette appearance, placed-part
  geometry and dense-circuit legibility are not universally identical.
  Selected seating is highlighted; hover feedback is not complete everywhere.
- Host pane layouts and hardware/block integration are separate from this
  package's simulated editor. A working simulation does not certify hardware execution.

## Tests and further documentation

```sh
npm test
npm run test:source-precision
npm run test:render
```

Browser interaction checks and optional independent-oracle checks have their
own setup requirements. See [test registration](docs/TEST-REGISTRATION.md),
[schematic verification](docs/SCHEMATIC-AUDIT.md) and the
[CI results](https://github.com/CrispStrobe/bw-circuit-ui/actions).
Test totals and corpus agreement depend on the revision, available tools and
selected suite; they are not universal compatibility claims.

Development plans live in [ROADMAP.md](ROADMAP.md) and [PLAN.md](PLAN.md).
Historical receipts remain in their detailed documents, not this introduction.

## License

MIT. See [LICENSE](LICENSE) and [third-party notices](THIRD-PARTY.md).

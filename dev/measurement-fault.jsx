// Browser-only test fixture: real installed engine and shipping UI components.
import React, {useMemo, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {BoardImpl} from 'bw-board/board.js';
import {inferNetlist, checkWiring} from 'bw-board/infer-netlist.js';
import {getDevice} from 'bw-board/devices.js';
import {registerAllDevices} from 'bw-board/register-all.js';
import {setEngine} from '../src/engine.js';
import {Circuit} from '../src/model/circuit.js';
import {importCircuit} from '../src/importers/index.js';
import {resolveEndpointNet} from '../src/model/instrument-report.js';
import {Multimeter} from '../src/components/Multimeter.jsx';
import {ScopePanel} from '../src/components/ScopePanel.jsx';

registerAllDevices();
setEngine({BoardImpl, inferNetlist, checkWiring, getDevice});

function Fixture() {
  const c = useMemo(() => {
    const input = importCircuit('spice', '* live fault\nV1 signal 0 1\nVBAD 0 0 0\nR1 signal 0 1k\n.end\n');
    if (input.unmapped?.length || input.losses?.length) throw new Error('Fixture import must be lossless');
    const circuit = Circuit.fromJSON({parts: input.parts, wires: input.wires});
    if (circuit.netlistError) throw new Error(circuit.netlistError);
    circuit.setPower(true);
    return circuit;
  }, []);
  const [, refresh] = useState(0);
  const [message, setMessage] = useState('');
  const [placing, setPlacing] = useState(null);
  const [placement, setPlacement] = useState(null);
  const signal = resolveEndpointNet(c.resolvedNets, 'V1.pos');
  const ground = resolveEndpointNet(c.resolvedNets, 'V1.neg');
  const probe = (which, netId) => {setPlacing(which); setPlacement({netId, partId: null, terminal: null});};
  const control = volts => {
    try {c.setControl('VBAD', volts); setMessage('Constraint repaired; old capture stays invalid');}
    catch (error) {setMessage(error.message);}
    refresh(n => n + 1);
  };
  return <main data-testid="measurement-fault-fixture" data-signal={signal} data-ground={ground}
    style={{display: 'flex', gap: 16, color: '#eee', background: '#101525', padding: 16}}>
    <section>
      <button onClick={() => probe('A', signal)}>Probe A signal</button>
      <button onClick={() => probe('B', ground)}>Probe B ground</button>
      <button onClick={() => probe('A', ground)}>Probe A ground</button>
      <button onClick={() => probe('B', signal)}>Probe B signal</button>
      <button onClick={() => {c.advanceTo(c.timeNs + 100_000_000n); refresh(n => n + 1);}}>Acquire 100 ms</button>
      <button onClick={() => control(5)}>Introduce constraint fault</button>
      <button onClick={() => control(0)}>Repair constraint</button>
      <button onClick={() => {c.setControl('V1', 2); refresh(n => n + 1);}}>Raise healthy source</button>
      <button onClick={() => {c.setControl('V1', 1); refresh(n => n + 1);}}>Restore healthy source</button>
      <output data-testid="fixture-control-status">{message}</output>
      <Multimeter circuit={c} wires={c.wires} parts={c.parts} placingProbe={placing}
        probePlacement={placement} onStartPlacing={setPlacing} onStopPlacing={() => setPlacing(null)} />
    </section>
    <section style={{width: 300}}><ScopePanel board={c.board} nets={[signal, ground]} /></section>
  </main>;
}
createRoot(document.getElementById('root')).render(<Fixture />);

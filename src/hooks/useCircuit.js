/**
 * useCircuit — React hook wrapping the Circuit model.
 *
 * Provides reactive state: any mutation triggers a re-render
 * with fresh instrument readings from the engine.
 */

import { useState, useCallback, useRef } from 'react';
import { Circuit, resetIds } from '../model/circuit.js';

/**
 * @param {number} [vcc=5.0]
 * @returns {object} circuit API for React components
 */
export function useCircuit(vcc = 5.0) {
  const circuitRef = useRef(null);
  if (!circuitRef.current) {
    resetIds();
    circuitRef.current = new Circuit(vcc);
  }

  // Revision counter to trigger re-renders after mutations.
  const [rev, setRev] = useState(0);
  const bump = useCallback(() => setRev(r => r + 1), []);

  const circuit = circuitRef.current;

  const addPart = useCallback((kind, params, x, y) => {
    const p = circuit.addPart(kind, params, x, y);
    bump();
    return p;
  }, [circuit, bump]);

  const removePart = useCallback((partId) => {
    const ok = circuit.removePart(partId);
    if (ok) bump();
    return ok;
  }, [circuit, bump]);

  const movePart = useCallback((partId, x, y) => {
    const ok = circuit.movePart(partId, x, y);
    if (ok) bump();
    return ok;
  }, [circuit, bump]);

  const addWire = useCallback((fromPart, fromTerm, toPart, toTerm) => {
    const w = circuit.addWire(fromPart, fromTerm, toPart, toTerm);
    if (w) bump();
    return w;
  }, [circuit, bump]);

  const removeWire = useCallback((wireId) => {
    const ok = circuit.removeWire(wireId);
    if (ok) bump();
    return ok;
  }, [circuit, bump]);

  const setControl = useCallback((partId, value) => {
    circuit.setControl(partId, value);
    bump();
  }, [circuit, bump]);

  const setPin = useCallback((pin, mode, driveHigh) => {
    circuit.setPin(pin, mode, driveHigh);
    bump();
  }, [circuit, bump]);

  const advanceTo = useCallback((tNs) => {
    circuit.advanceTo(tNs);
    bump();
  }, [circuit, bump]);

  const advanceBy = useCallback((deltaNs) => {
    circuit.advanceBy(deltaNs);
    bump();
  }, [circuit, bump]);

  const setPower = useCallback((on) => {
    circuit.setPower(on);
    bump();
  }, [circuit, bump]);

  // Read-only accessors — these read from the engine, never fabricate.
  const ledBrightness = useCallback((partId) => {
    return circuit.ledBrightness(partId);
  }, [circuit]);

  const buzzerTone = useCallback((partId) => {
    return circuit.buzzerTone(partId);
  }, [circuit]);

  const nodeVoltage = useCallback((netId) => {
    return circuit.nodeVoltage(netId);
  }, [circuit]);

  return {
    // State (read on each render, rev forces refresh)
    parts: circuit.parts,
    wires: circuit.wires,
    powered: circuit.powered,
    rev,

    // Mutations
    addPart,
    removePart,
    movePart,
    addWire,
    removeWire,
    setControl,
    setPin,
    advanceTo,
    advanceBy,
    setPower,

    // Instruments (from engine)
    ledBrightness,
    buzzerTone,
    nodeVoltage,

    // Raw circuit for advanced access
    circuit,
  };
}

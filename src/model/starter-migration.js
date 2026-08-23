/**
 * Migrate only the original built-in LED starter's redundant rail jumpers.
 *
 * This runs on RAW autosave JSON, before Circuit.fromJSON has normalized
 * anything — so both endpoint dialects are live here and the canonical
 * reader is the only safe way to look at one.
 */
import { wireEndpoint, isBoardEndpoint } from './wire-endpoints.js';

function joins(wire, a, b) {
  return (wire.a === a && wire.b === b) || (wire.a === b && wire.b === a);
}

function tap(wire, batteryId, terminal, boardId, hole) {
  const from = wireEndpoint(wire, 'from');
  const to = wireEndpoint(wire, 'to');
  return Boolean(from && to && !isBoardEndpoint(from) && isBoardEndpoint(to) &&
    from.part === batteryId && from.terminal === terminal &&
    to.board === boardId && to.hole === hole);
}

export function migrateStarterAutosave(data) {
  if (!data || !Array.isArray(data.parts) || !Array.isArray(data.wires) ||
      !Array.isArray(data.holeWires)) return data;
  const board = data.parts.find(part => part.kind === 'breadboard');
  const battery = data.parts.find(part =>
    (part.kind === 'vsource' || part.kind === 'battery') &&
    (part.params?.variant === '9v' || part.params?.volts === 5));
  const resistor = data.parts.find(part => part.kind === 'resistor' && part.params?.ohms === 1000);
  const led = data.parts.find(part => part.kind === 'led' && part.declName === 'led1');
  if (!board || !battery || !resistor || !led) return data;
  const jumpers = data.holeWires.filter(wire => wire.boardId === board.id && (
    joins(wire, 't+8', 'a5') || joins(wire, 'a10', 't-8')));
  if (jumpers.length !== 2) return data;
  const positive = data.wires.find(wire => tap(wire, battery.id, 'pos', board.id, 't+3'));
  const negative = data.wires.find(wire => tap(wire, battery.id, 'neg', board.id, 't-3'));
  if (!positive || !negative) return data;
  return {
    ...data,
    wires: data.wires.map(wire => {
      // `tap()` has already proved this side is a hole endpoint in either
      // dialect; wireEndpoint gives it back as an object to rewrite.
      if (wire === positive) return {...wire, to: {...wireEndpoint(wire, 'to'), hole: 'a5'}};
      if (wire === negative) return {...wire, to: {...wireEndpoint(wire, 'to'), hole: 'a10'}};
      return wire;
    }),
    holeWires: data.holeWires.filter(wire => !jumpers.includes(wire)),
  };
}

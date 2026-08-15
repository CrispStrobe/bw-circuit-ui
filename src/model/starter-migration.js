/** Migrate only the original built-in LED starter's redundant rail jumpers. */
function joins(wire, a, b) {
  return (wire.a === a && wire.b === b) || (wire.a === b && wire.b === a);
}

function tap(wire, batteryId, terminal, boardId, hole) {
  return wire.from?.part === batteryId && wire.from?.terminal === terminal &&
    wire.to?.board === boardId && wire.to?.hole === hole;
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
      if (wire === positive) return {...wire, to: {...wire.to, hole: 'a5'}};
      if (wire === negative) return {...wire, to: {...wire.to, hole: 'a10'}};
      return wire;
    }),
    holeWires: data.holeWires.filter(wire => !jumpers.includes(wire)),
  };
}

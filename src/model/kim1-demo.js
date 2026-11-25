// SPDX-License-Identifier: MIT
// Original programs, encoded from the documented NMOS 6502 instruction set.
export const KIM1_EXAMPLES = Object.freeze([
  {id:'counter', name:'Output counter', nameDe:'Ausgangszähler',
    source:'; Set port A to output, then increment its eight bits.\n0200: A9 FF 8D 01 17 A9 00 8D 00 17 EE 00 17 4C 0A 02\n'},
  {id:'echo', name:'Input to output', nameDe:'Eingabe zu Ausgabe',
    source:'; Copy the user bits of port B to port A. PB6 is reserved.\n0200: A9 FF 8D 01 17 A9 00 8D 03 17 AD 02 17 29 BF 8D\n0210: 00 17 4C 0A 02\n'},
]);

/** Switches drive actual PB nets; PA outputs light actual resistor/LED circuits. */
export function kim1DemoCircuit() {
  const terminals = [...Array.from({length:8},(_,i)=>`PA${i}`),
    ...[0,1,2,3,4,5,7].map(i=>`PB${i}`), '5v', 'gnd'];
  const parts = [{id:'kim1', kind:'kim-1', x:420, y:280,
    params:{program:KIM1_EXAMPLES[1].source, clockHz:1000}, terminals}];
  const wires = [];
  const wire = (from, terminal, to, target, color) => wires.push({id:`kimwire${wires.length+1}`,
    from:{part:from,terminal}, to:{part:to,terminal:target}, ...(color?{color}:{})});
  for (let bit=0;bit<4;bit++) {
    const y=165+bit*68;
    parts.push({id:`input${bit}`,kind:'switch',declName:`PB${bit}`,x:110,y,
      params:{closed:false},terminals:['a','b']});
    parts.push({id:`bias${bit}`,kind:'resistor',x:220,y:y+25,
      params:{ohms:33000},terminals:['a','b']});
    wire('kim1','5v',`input${bit}`,'a','#ef4444');
    wire(`input${bit}`,'b','kim1',`PB${bit}`,'#38bdf8');
    wire(`input${bit}`,'b',`bias${bit}`,'a');
    wire(`bias${bit}`,'b','kim1','gnd','#64748b');
    parts.push({id:`limit${bit}`,kind:'resistor',x:655,y,params:{ohms:1000},terminals:['a','b']});
    parts.push({id:`lamp${bit}`,kind:'led',declName:`PA${bit}`,x:755,y,
      params:{color:['red','yellow','green','blue'][bit]},terminals:['anode','cathode']});
    wire('kim1',`PA${bit}`,`limit${bit}`,'a','#f59e0b');
    wire(`limit${bit}`,'b',`lamp${bit}`,'anode');
    wire(`lamp${bit}`,'cathode','kim1','gnd','#64748b');
  }
  return {vcc:5,fileOnly:true,parts,wires,holeWires:[]};
}

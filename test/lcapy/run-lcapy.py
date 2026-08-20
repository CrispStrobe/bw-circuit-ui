"""Solve each netlist symbolically and print exact node voltages as decimals."""
import json, sys
from lcapy import Circuit

specs = json.load(sys.stdin)
out = {}
for name, netlist in specs.items():
    try:
        c = Circuit(netlist)
        nodes = sorted({n for n in c.nodes if str(n) != '0'}, key=str)
        out[name] = {str(n): float(c[n].V.dc.expr) for n in nodes}
    except Exception as e:                      # report, never silently skip
        out[name] = {'__error__': f'{type(e).__name__}: {e}'}
print(json.dumps(out))

# Foreign-dialect SPICE decks

Hand-written for this repository, from the published SPICE netlist grammar.
Nothing here is copied from anyone: these are OUR decks, written the way a
foreign tool writes them rather than the way our exporter does.

That difference is the whole point. `scripts/spice-oracle.mjs` also runs a
round trip through our own exporter and importer, and a round trip through
one pair cannot see a SYMMETRIC error: if the writer and the reader share a
wrong value table, the deck goes out wrong and comes back wrong and the
comparison is perfectly happy. Measured — reintroducing X0.2's mega/milli bug
on the READ side left all six self round-trips green.

These decks break that symmetry. Each is written in spellings our exporter
never emits, is simulated by ngspice as authored, and must produce the same
operating point after our importer has read it and our exporter has written
it back out:

  foreign-divider.cir      bare `M` for milli beside `MEG` for mega, the trap
                           itself, in a divider whose answer moves 10^9x if
                           they are confused
  foreign-suffixes.cir     every scale letter and scientific notation mixed,
                           with unit letters trailing (4.7kOhm, 100nF)
  foreign-subckt.cir       a two-instance subcircuit with internal nodes that
                           must not merge across instances
  foreign-diode.cir        a `.model` written in a different case and order,
                           whose Vf must be recovered rather than guessed

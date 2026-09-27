# A card's numbers must reach the device — the silent-fallback family

Seven importer defects were closed in one sitting and they are all the same
shape: **a model card states a number, the part is created, the engine solves
it, and the number never arrived.** No refusal, no loss, often not even a
warning. This file exists so the eighth is recognised on sight rather than found
by chasing a corpus disagreement for an afternoon.

## The seven

| what was dropped | how | population |
|---|---|---|
| `µ` in a library value | `Buffer.toString('utf8')` substitutes U+FFFD instead of throwing, so CP1252 files lost their micro sign | 3,010 of 4,908 library files are CP1252; 2,957 contain 0xB5 |
| a BJT's model name | a 4-node card `Q1 c b e <substrate> MODEL` had the substrate read as the model | 5,285 parts across 2,028 decks |
| every parameter of a card | `KP=8E-5,VTO=0.6` captured `8E-5,VTO` as KP's value — commas are separators in SPICE | 971 Si7li and 452 ADI v2 decks resolve such a library |
| `KP` itself | derived from `UO` and `TOX` when a card states the process numbers instead | 1,519 decks ran on the engine's fallback transconductance |
| a MOSFET's polarity | a VDMOS states p-channel with a bare `pchan` FLAG, not a model type | every p-channel power MOSFET imported as n-channel |
| a controlled source's gain | `GP1 98 12 (9,98) 1` — the parenthesised control pair became one field, leaving the part with empty params | every LTspice op-amp macromodel's gain path |
| a zener's knee current | `IBV` sat in a "does not move a bias point" list, true only while the engine's zener was piecewise | 976 decks state it |

## Why they are silent, and what to look for

Three mechanisms recur:

1. **A substituting reader.** `toString('utf8')` never fails. Anything that
   replaces bad input with a placeholder turns a decoding problem into a
   *value* problem one layer up, where it looks like the deck's fault.
2. **A positional parse with an optional field.** The BJT substrate and the
   parenthesised control pair are both "the field I wanted is one position
   further along sometimes". A token count cannot separate `Q1 c b e MOD 2`
   from `Q1 c b e s MOD`; consult the model table, then fall back to a
   *syntactic* rule (a bracketed token or a bare integer is a node, never a
   model name) so the two sites that parse the same card agree.
3. **A bare flag.** A flag that is not `key=value` leaves no parameter behind,
   so nothing is missing to notice. Match it as a TOKEN — `pchanx=1` is not a
   polarity.

**The tell in every case is a part with suspiciously few params.** A MOSFET with
no `kp`, a controlled source with `{}`, a BJT whose `_model` is `"0"`. A census
of "semiconductors that reached the engine with no model-derived parameter"
found four of these seven in an afternoon and is worth re-running after any
importer change.

## Two rules learned the hard way

**Both crossings, or neither.** A parameter the engine reads and the exporter
omits means the deck describes a different device than the one solved. That
defect has now appeared three times — `Bf`, `Vaf`, `Ksubthres` — so a new
engine parameter gets its exporter line in the same commit.

**Moving a field out of one list is not putting it in another.** Taking `ibv`
out of `DIODE_NON_DC_FIELDS` without adding it to `DIODE_MAPPED_FIELDS` made it
an *unknown* field, which blocks the entire model: every BV+IBV card imported as
a bare diode with no breakdown at all — strictly worse than before the change.
The classifier's buckets are exhaustive by design, and the default for
"unrecognised" is refusal.

## The corpus counts are the point, not the decoration

Every row in the table above was measured before the fix, and four of the seven
turned out to have a **zero** effect on the comparable set — their decks are
blocked upstream by element coverage. They were landed anyway, labelled as
correctness. What the counts buy is the ability to say which of these matters
today and which is insurance, instead of implying all seven moved a number.

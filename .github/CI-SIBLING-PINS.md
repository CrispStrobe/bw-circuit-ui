# CI sibling pins

`ci-siblings.json` records the general-purpose external repositories that CI
checks out beside this repository. CI fetches the exact 40-character commit
recorded there, so rerunning one `bw-circuit-ui` commit does not silently test
different dependency source.

The schematic suite's `sb3-creator` checkout is deliberately separate: its SHA
comes from `docs/schematic-baselines/CORPUS.json`, so reviewed baseline sources
and the checked-out corpus cannot move independently. The integrity test covers
both checkout mechanisms and rejects any additional unpinned sibling clone.

Move a pin deliberately, in its own commit, after reviewing the upstream delta.
Run the full suite against the proposed commit and include the resulting hosted
CI receipt with the pin-bump review. Do not combine a dependency pin bump with a
change to this checkout mechanism.

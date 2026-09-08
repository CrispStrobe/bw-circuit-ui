# CI sibling pins

`ci-siblings.json` records every external repository that the CI workflow checks
out beside this repository. CI fetches the exact 40-character commit recorded
there, so rerunning one `bw-circuit-ui` commit does not silently test different
dependency source.

Move a pin deliberately, in its own commit, after reviewing the upstream delta.
Run the full suite against the proposed commit and include the resulting hosted
CI receipt with the pin-bump review. Do not combine a dependency pin bump with a
change to this checkout mechanism.

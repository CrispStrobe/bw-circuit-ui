/**
 * Where the shipped example corpus is, resolved so a WORKTREE finds it too.
 *
 * THE DEFECT THIS CLOSES. Fourteen test files each carried their own list of
 * candidate roots, and every list began `path.resolve(here, '../../sb3-creator/
 * examples')` — the sibling of the repository ROOT. That is correct in a normal
 * checkout (`/mnt/volume1/code/bw-circuit-ui` -> `/mnt/volume1/code`) and wrong
 * in every git worktree, where the repo sits one or two levels deeper
 * (`/mnt/volume1/code/wt/<lane>` -> `/mnt/volume1/code/wt`) and the sibling does
 * not exist.
 *
 * The consequence is not a narrower run, it is a WRONG VERDICT. Measured on two
 * independent worktrees:
 *
 *   this one, nine corpus-bearing files    91 tests, 42 fail   ->  606 tests, 0 fail
 *   lego-38's, two files                   35 tests, 23 fail   ->   40 tests, 1 fail
 *
 * So a lane run without `EXAMPLES_DIR` reds for a reason that is not the code,
 * and anyone reading those failures goes hunting. It also silently changes the
 * POPULATION: 91 tests became 606, because the corpus gates register a
 * placeholder skip when they find nothing — a skip count is not a coverage
 * count.
 *
 * THE FIX IS TO WALK UP RATHER THAN TO COUNT LEVELS. `../..` encodes an
 * assumption about how deep the repo is; searching upward for a directory that
 * actually contains the corpus does not, and works in a checkout, a worktree,
 * and a worktree of a worktree. `EXAMPLES_DIR` still wins and still refuses a
 * path that does not exist, because an explicitly selected corpus must never be
 * silently replaced by another one.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

/** Relative locations of the corpus, tried in order under each ancestor. */
const RELATIVE = [
  'sb3-creator/examples',
  'bw-cfront/sb3-creator/examples',
  'lego/brickwright-lite/overlay/scratch-gui/examples',
];

/**
 * Every candidate root, best first.
 * @param {string} from - a directory inside this repo, usually the test's own.
 */
export function corpusRoots(from) {
  const explicit = process.env.EXAMPLES_DIR || null;
  if (explicit) {
    if (!existsSync(explicit)) {
      throw new Error(`EXAMPLES_DIR=${explicit} does not exist. An explicitly selected `
        + 'corpus is never silently replaced by another one — fix the path or unset it.');
    }
    return [explicit];
  }
  const out = [];
  // Walk up from `from` to the filesystem root, trying each relative location.
  // Stops at `/`; a handful of stat calls, run once per test file.
  let dir = path.resolve(from);
  for (;;) {
    for (const rel of RELATIVE) out.push(path.join(dir, rel));
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  out.push(path.join(process.env.HOME || '', 'code', 'sb3-creator', 'examples'));
  return out;
}

/** The first candidate that exists, or null. */
export function findCorpus(from) {
  return corpusRoots(from).find(r => existsSync(r)) || null;
}

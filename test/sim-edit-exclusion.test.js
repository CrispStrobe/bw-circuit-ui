/**
 * A rapid simulated button press can emit `dblclick` after its down/up pair.
 * Property editing is a Build-mode capability, so every editor entry and the
 * final render boundary share one tested policy.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {partEditingAllowed} from '../src/interaction/edit-policy.js';

const boardSource = readFileSync(
  path.resolve(import.meta.dirname, '../src/components/BoardCanvas.jsx'), 'utf8');
const policySource = readFileSync(
  path.resolve(import.meta.dirname, '../src/interaction/edit-policy.js'), 'utf8');

const policyVerdict = policy => ({build: policy(false), simulate: policy(true)});

test('property editing is enabled only in Build mode', () => {
  assert.deepEqual(policyVerdict(partEditingAllowed), {build: true, simulate: false});
});

test('BoardCanvas applies the policy through one editor-opening door', () => {
  assert.match(boardSource,
    /const canEditParts = partEditingAllowed\(simulate\);/,
    'the component must derive its decision from the tested policy');
  assert.match(boardSource,
    /const openPartEditor = useCallback[\s\S]*?if \(!canEditParts\) return;[\s\S]*?setInlineEdit\(\{partId, x, y\}\);/,
    'the shared opening door must enforce the tested policy');
  const directOpeners = boardSource.match(/setInlineEdit\(\{/g) || [];
  assert.equal(directOpeners.length, 1,
    'the shared mode-aware door must be the only code that opens the editor');
});

test('the policy test catches SIM being permitted', async () => {
  const mutated = policySource.replace('return !simulate;', 'return true;');
  assert.notEqual(mutated, policySource, 'mutation must change the policy');
  const module = await import(`data:text/javascript,${encodeURIComponent(mutated)}`);
  assert.notDeepEqual(policyVerdict(module.partEditingAllowed), {build: true, simulate: false},
    'the mutation must violate the same two-mode truth table');
});

test('the wiring gate catches a new entry bypassing the shared door', () => {
  const mutated = boardSource.replace('openPartEditor(only.id, sx, sy);',
    'setInlineEdit({partId: only.id, x: sx, y: sy});');
  assert.notEqual(mutated, boardSource, 'mutation must bypass the shared opening door');
  const directOpeners = mutated.match(/setInlineEdit\(\{/g) || [];
  assert.notEqual(directOpeners.length, 1,
    'a new unguarded entry must change the derived direct-opener denominator');
});

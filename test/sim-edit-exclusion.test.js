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

test('BoardCanvas applies the policy at every editor boundary', () => {
  assert.match(boardSource,
    /const canEditParts = partEditingAllowed\(simulate\);/,
    'the component must derive its decision from the tested policy');
  const uses = boardSource.match(/\bcanEditParts\b/g) || [];
  assert.equal(uses.length, 7,
    'one definition plus stale-state/effect, canvas, adjust-chip, rendered-part and final-render guards');
});

test('the policy test catches SIM being permitted', async () => {
  const mutated = policySource.replace('return !simulate;', 'return true;');
  assert.notEqual(mutated, policySource, 'mutation must change the policy');
  const module = await import(`data:text/javascript,${encodeURIComponent(mutated)}`);
  assert.notDeepEqual(policyVerdict(module.partEditingAllowed), {build: true, simulate: false},
    'the mutation must violate the same two-mode truth table');
});

test('the wiring gate catches one editor boundary losing the policy', () => {
  const mutated = boardSource.replace('if (!canEditParts) return;', '');
  assert.notEqual(mutated, boardSource, 'mutation must remove the canvas guard');
  const uses = mutated.match(/\bcanEditParts\b/g) || [];
  assert.notEqual(uses.length, 7, 'a missing boundary must change the expected wiring count');
});

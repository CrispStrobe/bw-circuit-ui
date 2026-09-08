/**
 * SIM owns every pointer gesture on a part. In particular, a rapid button
 * press produces a browser dblclick after the down/up pair; that event must
 * never open the Build-mode property editor.
 *
 * BoardCanvas cannot be imported by Node without compiling JSX, so this gate
 * checks every entry and the final render boundary in the source that ships.
 * The mutation cases prove the check distinguishes each missing guard.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';

const FILE = path.resolve(import.meta.dirname, '../src/components/BoardCanvas.jsx');
const source = readFileSync(FILE, 'utf8');

const requireShape = (src, pattern, message) => assert.match(src, pattern, message);

function verifySimEditExclusion(src) {
  requireShape(src,
    /React\.useEffect\(\(\) => \{\s*if \(simulate\) setInlineEdit\(null\);\s*\}, \[simulate\]\);/,
    'entering SIM must close an editor retained from Build mode');
  requireShape(src,
    /onDoubleClick=\{\(e\) => \{\s*if \(simulate\) return;\s*const \{ x, y \} = eventToWorld\(e\);/,
    'the canvas double-click entry must refuse SIM mode');
  requireShape(src,
    /if \(simulate \|\| !selectedParts \|\| selectedParts\.size !== 1 \|\| inlineEdit\) return null;/,
    'the click-to-adjust editor entry must not render in SIM mode');
  requireShape(src,
    /onDoubleClick=\{simulate \? undefined :\s*\(partId, cx, cy\) => setInlineEdit/,
    'rendered parts must not receive a property double-click callback in SIM mode');
  requireShape(src,
    /\{!simulate && inlineEdit && onUpdateParams && \(/,
    'the property editor render boundary must refuse SIM mode');
}

test('every property-editor entry and render boundary excludes SIM mode', () => {
  verifySimEditExclusion(source);
});

test('the gate catches a rapid-button double-click guard being removed', () => {
  const mutated = source.replace('if (simulate) return;\n          const { x, y } = eventToWorld(e);',
    'const { x, y } = eventToWorld(e);');
  assert.notEqual(mutated, source, 'mutation must change the canvas handler');
  assert.throws(() => verifySimEditExclusion(mutated), /canvas double-click entry/);
});

test('the gate catches the final SIM render exclusion being removed', () => {
  const mutated = source.replace('{!simulate && inlineEdit && onUpdateParams && (',
    '{inlineEdit && onUpdateParams && (');
  assert.notEqual(mutated, source, 'mutation must change the final render boundary');
  assert.throws(() => verifySimEditExclusion(mutated), /editor render boundary/);
});

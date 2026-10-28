// SPDX-License-Identifier: MIT
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {circuitEditorActions, navigateCircuitMenu} from '../src/components/circuit-menu-actions.js';

function editor(overrides = {}) {
  const calls = [];
  const record = name => value => calls.push([name, value instanceof Set ? [...value] : value]);
  const input = {canEdit: true, canUndo: true, canRedo: true, canPaste: true,
    parts: [{id: 'a'}, {id: 'b'}], selectedParts: new Set(['a', 'b']),
    ...Object.fromEntries(['onUndo', 'onRedo', 'onCopy', 'onPaste', 'onSelectAll',
      'onDuplicatePart', 'onRotatePart', 'onFlipPart', 'onRemovePart', 'onRemoveWire',
      'onSelectPart', 'onSelectWire', 'fit', 'resetView', 'toggleVoltageView'].map(name => [name, record(name)])),
    ...overrides};
  const actions = circuitEditorActions(input);
  return {calls, actions, action: name => actions.find(item => item.name === name)};
}

test('every editor descriptor names a real command and a stable menu group', () => {
  const {actions} = editor({simulate: true});
  assert.deepEqual(actions.map(item => item.name), ['undo', 'redo', 'copy', 'paste', 'select-all',
    'duplicate', 'rotate', 'flip', 'delete', 'view-fit', 'view-reset', 'voltage-view']);
  for (const action of actions) {
    assert.equal(action.location, 'edit');
    assert.equal(typeof action.label, 'string');
    assert.equal(typeof action.run, 'function');
    assert.equal(typeof action.enabled, 'boolean');
    assert.ok(['history', 'clipboard', 'selection', 'view'].includes(action.submenu));
  }
});

test('undo/redo and empty clipboard guards prevent callback invocation', () => {
  const {action, calls} = editor({canUndo: false, canRedo: false, canPaste: false});
  for (const name of ['undo', 'redo', 'paste']) { assert.equal(action(name).enabled, false); action(name).run(); }
  assert.deepEqual(calls, []);
});

test('available undo/redo/paste call the actual callbacks once each', () => {
  const {action, calls} = editor();
  for (const name of ['undo', 'redo', 'paste']) action(name).run();
  assert.deepEqual(calls, [['onUndo', undefined], ['onRedo', undefined], ['onPaste', undefined]]);
});

test('all transforms apply only to current real selected parts', () => {
  const {action, calls} = editor({selectedParts: new Set(['a', 'missing', 'b'])});
  for (const name of ['copy', 'duplicate', 'rotate', 'flip']) action(name).run();
  assert.deepEqual(calls, [['onCopy', ['a', 'b']], ['onDuplicatePart', 'a'], ['onDuplicatePart', 'b'],
    ['onRotatePart', 'a'], ['onRotatePart', 'b'], ['onFlipPart', 'a'], ['onFlipPart', 'b']]);
});

test('empty or stale selection disables selection commands', () => {
  for (const selection of [new Set(), new Set(['missing'])]) {
    const {action, calls} = editor({selectedParts: selection});
    for (const name of ['copy', 'duplicate', 'rotate', 'flip', 'delete']) {
      assert.equal(action(name).enabled, false, name); action(name).run();
    }
    assert.deepEqual(calls, []);
  }
});

test('simulation refuses mutating commands while preserving selection and view', () => {
  const {action, calls} = editor({canEdit: false});
  for (const name of ['undo', 'redo', 'paste', 'duplicate', 'rotate', 'flip', 'delete']) {
    assert.equal(action(name).enabled, false, name); action(name).run();
  }
  action('copy').run(); action('select-all').run(); action('view-fit').run(); action('view-reset').run();
  assert.deepEqual(calls, [['onCopy', ['a', 'b']], ['onSelectAll', undefined], ['fit', undefined], ['resetView', undefined]]);
});

test('deleting a wire takes priority and clears the wire selection', () => {
  const {action, calls} = editor({selectedWire: 'w1'});
  action('delete').run();
  assert.deepEqual(calls, [['onRemoveWire', 'w1'], ['onSelectWire', null]]);
});

test('deleting selected parts uses real removal then clears part selection', () => {
  const {action, calls} = editor(); action('delete').run();
  assert.deepEqual(calls, [['onRemovePart', 'a'], ['onRemovePart', 'b'], ['onSelectPart', null]]);
});

test('missing callback disables its command without calling a placeholder', () => {
  const {action, calls} = editor({onUndo: undefined, onRotatePart: undefined, onRemoveWire: undefined, selectedWire: 'w1'});
  for (const name of ['undo', 'rotate', 'delete']) { assert.equal(action(name).enabled, false); action(name).run(); }
  assert.deepEqual(calls, []);
});

test('voltage switch reports the real state and calls the actual toggle', () => {
  assert.equal(editor().action('voltage-view'), undefined);
  for (const checked of [true, false]) {
    const {action, calls} = editor({simulate: true, voltageView: checked});
    assert.equal(action('voltage-view').checked, checked); action('voltage-view').run();
    assert.deepEqual(calls, [['toggleVoltageView', undefined]]);
  }
  assert.equal(editor({de: true}).action('rotate').label, 'Drehen');
});

function menu() {
  const doc = {activeElement: null};
  const buttons = [0, 1, 2].map(index => ({index, focus() {doc.activeElement = this;}}));
  const selectors = [];
  const panel = {ownerDocument: doc, querySelectorAll(selector) {selectors.push(selector); return buttons;}};
  let closed = 0; let prevented = 0; let stopped = 0;
  const key = name => navigateCircuitMenu({key: name, preventDefault() {prevented++;}, stopPropagation() {stopped++;}}, panel, () => closed++);
  return {key, doc, selectors, counts: () => ({closed, prevented, stopped})};
}

test('menu arrows wrap and Home/End reach the first/last enabled command', () => {
  const {key, doc, selectors} = menu();
  key('ArrowDown'); assert.equal(doc.activeElement.index, 0);
  key('ArrowUp'); assert.equal(doc.activeElement.index, 2);
  key('ArrowDown'); assert.equal(doc.activeElement.index, 0);
  key('End'); assert.equal(doc.activeElement.index, 2);
  key('Home'); assert.equal(doc.activeElement.index, 0);
  assert.ok(selectors.every(selector => selector === 'button:not(:disabled)'));
});

test('Escape closes and is consumed; Tab/typing are left to native focus behavior', () => {
  const {key, counts} = menu(); key('Tab'); key('a');
  assert.deepEqual(counts(), {closed: 0, prevented: 0, stopped: 0});
  key('Escape');
  assert.deepEqual(counts(), {closed: 1, prevented: 1, stopped: 1});
});


test('embedded workbench inputs retain their native arrow and Home/End keys', () => {
  let consumed = 0;
  for (const key of ['ArrowUp', 'ArrowDown', 'Home', 'End']) {
    navigateCircuitMenu({key, target: {closest: () => ({tagName: 'INPUT'})},
      preventDefault() {consumed++;}}, null, () => consumed++);
  }
  assert.equal(consumed, 0);
});

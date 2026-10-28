// SPDX-License-Identifier: MIT
// Menu descriptors call the same editor callbacks as the canvas controls.
export function circuitEditorActions({de = false, canEdit, canUndo, canRedo, canPaste,
  parts = [], selectedParts, selectedWire, onUndo, onRedo, onCopy, onPaste,
  onSelectAll, onDuplicatePart, onRotatePart, onFlipPart, onRemovePart,
  onRemoveWire, onSelectPart, onSelectWire, fit, resetView, simulate,
  voltageView, toggleVoltageView}) {
  const ids = [...(selectedParts || [])].filter(id => parts.some(part => part.id === id));
  const chosen = ids.length > 0;
  const actions = [];
  const add = (name, en, german, submenu, enabled, run, shortcut, checked) => {
    actions.push({name, label: de ? german : en, location: 'edit', submenu,
      enabled: Boolean(enabled), run: () => enabled ? run() !== false : false, shortcut,
      ...(checked === undefined ? {} : {checked: Boolean(checked)})});
  };
  add('undo', 'Undo', 'Rückgängig', 'history', canEdit && canUndo && onUndo, onUndo, 'Ctrl+Z');
  add('redo', 'Redo', 'Wiederholen', 'history', canEdit && canRedo && onRedo, onRedo, 'Ctrl+Shift+Z');
  add('copy', 'Copy', 'Kopieren', 'clipboard', chosen && onCopy, () => onCopy(new Set(ids)), 'Ctrl+C');
  add('paste', 'Paste', 'Einfügen', 'clipboard', canEdit && canPaste && onPaste, onPaste, 'Ctrl+V');
  add('select-all', 'Select all', 'Alles auswählen', 'selection', parts.length && onSelectAll, onSelectAll, 'Ctrl+A');
  for (const [name, en, german, callback, shortcut] of [
    ['duplicate', 'Duplicate', 'Duplizieren', onDuplicatePart, 'Ctrl+D'],
    ['rotate', 'Rotate', 'Drehen', onRotatePart, 'R'],
    ['flip', 'Flip horizontally', 'Horizontal spiegeln', onFlipPart, 'H'],
  ]) add(name, en, german, 'selection', canEdit && chosen && callback, () => ids.forEach(id => callback(id)), shortcut);
  add('delete', 'Delete selection', 'Auswahl löschen', 'selection', canEdit &&
    (selectedWire ? onRemoveWire : chosen && onRemovePart), () => {
      if (selectedWire) { onRemoveWire(selectedWire); onSelectWire?.(null); }
      else { ids.forEach(id => onRemovePart(id)); onSelectPart?.(null); }
    }, 'Delete');
  add('view-fit', 'Fit circuit in view', 'Schaltung einpassen', 'view', fit, fit, 'F');
  add('view-reset', 'Reset zoom and pan', 'Zoom und Ansicht zurücksetzen', 'view', resetView, resetView, '0');
  if (simulate) add('voltage-view', 'Show voltages', 'Spannungen anzeigen', 'view', toggleVoltageView,
    toggleVoltageView, undefined, voltageView);
  return actions;
}

/** Native buttons retain Tab/Enter/Space; arrows and Home/End navigate the group. */
export function navigateCircuitMenu(event, panel, close) {
  if (event.key === 'Escape') {
    event.preventDefault(); event.stopPropagation(); close(); return;
  }
  // Workbench number fields and other embedded controls retain native editing.
  if (event.target?.closest?.('input, select, textarea, [contenteditable="true"]')) return;
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const buttons = [...panel.querySelectorAll('button:not(:disabled)')];
  if (!buttons.length) return;
  event.preventDefault();
  const current = buttons.indexOf(panel.ownerDocument.activeElement);
  const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 :
    event.key === 'ArrowDown' ? (current + 1) % buttons.length :
      (current < 0 ? buttons.length - 1 : (current - 1 + buttons.length) % buttons.length);
  buttons[index].focus();
}

// Retained menu descriptors must report refusal after edits/view teardown.
export function runCurrentEditorAction(actions, mounted, name) {
  const current = actions.find(action => action.name === name);
  if (!mounted || current?.enabled !== true || typeof current.run !== 'function') return false;
  return current.run() !== false;
}

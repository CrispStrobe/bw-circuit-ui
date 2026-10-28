// SPDX-License-Identifier: MIT
import React from 'react';
import ReactDOM from 'react-dom';
import {navigateCircuitMenu, runCurrentEditorAction} from './circuit-menu-actions.js';
const menuCSS = `.circuit-menu-popup {position:fixed;z-index:3000;width:300px;max-width:calc(100vw - 16px);overflow-y:auto;box-sizing:border-box;padding:6px;color:#e2e8f0;background:#0f172a;border:1px solid #64748b;border-radius:9px;box-shadow:0 8px 28px #02061766;font:12px system-ui,sans-serif;}
.circuit-menu-trigger {display:flex;align-items:center;justify-content:center;width:34px;height:34px;padding:0;color:#e2e8f0;background:#2c3e50;border:1px solid #64748b;border-radius:6px;cursor:pointer;}
.circuit-menu-trigger[aria-expanded=true] {background:#1e3a5f;}
.circuit-menu-heading {margin:6px 4px 3px;padding:6px 4px 3px;border-top:1px solid #334155;color:#94a3b8;font:600 11px system-ui,sans-serif;letter-spacing:.03em;}
.circuit-menu-heading:first-child {margin-top:0;border-top:0;}
.circuit-menu-row {display:flex;align-items:center;gap:10px;width:100%;min-height:34px;box-sizing:border-box;padding:7px 9px;border:0;border-radius:5px;color:#e2e8f0;background:transparent;font:12px system-ui,sans-serif;text-align:left;cursor:pointer;}
.circuit-menu-row svg {flex:0 0 auto;}
.circuit-menu-row:disabled {opacity:.4;cursor:default;}
.circuit-menu-row:not(:disabled):hover {background:#1e293b;}
.circuit-menu-row:focus-visible,.circuit-menu-trigger:focus-visible {outline:2px solid #93c5fd;outline-offset:-2px;background:#1e3a5f;}
.circuit-menu-label {flex:1;}
.circuit-menu-row kbd {color:#94a3b8;font:10px system-ui,sans-serif;white-space:nowrap;}
@media(pointer:coarse) {.circuit-menu-row {min-height:42px;}.circuit-menu-trigger {min-width:40px;min-height:40px;}}
`;
export const CircuitMenuStyles = () => <style>{menuCSS}</style>;

const paths = {
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  open: 'M3 6h6l2 2h10v3M3 6v14h15l3-9H6l-3 9',
  save: 'M4 3h13l4 4v14H3V3zM7 3v6h10V3M7 21v-8h10v8',
  import: 'M12 3v12M7 10l5 5 5-5M4 17v4h16v-4',
  export: 'M12 15V3M7 8l5-5 5 5M4 17v4h16v-4',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  paste: 'M9 3h6v4H9zM8 5H5v16h14V5h-3',
  duplicate: 'M8 8h12v12H8zM4 16V4h12M14 11v6M11 14h6',
  rotate: 'M19 12a7 7 0 1 1-2-4.9M19 4v4h-4',
  flip: 'M12 3v18M9 7l-6 5 6 5zM15 7l6 5-6 5z',
  delete: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  'select-all': 'M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4',
  'view-fit': 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5M9 9h6v6H9z',
  'view-reset': 'M3 11l9-8 9 8M5 9v12h5v-6h4v6h5V9',
  'voltage-view': 'M14 2L4 14h7l-1 8L20 10h-7z',
};
export function CircuitMenuIcon({name}) {
  return <svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth={name === 'more' ? 4 : 1.8} strokeLinecap="round" strokeLinejoin="round">
    <path d={paths[name] || paths.open} />
  </svg>;
}
export function CircuitMenuHeading({children}) {
  return <div className="circuit-menu-heading">{children}</div>;
}
export function CircuitMenuAction({action, onDone}) {
  const toggle = action.checked !== undefined;
  return <button type="button" className="circuit-menu-row" data-editor-action={action.name}
    disabled={!action.enabled} role={toggle ? 'switch' : undefined}
    aria-checked={toggle ? action.checked : undefined} aria-keyshortcuts={action.shortcut}
    onClick={() => { if (action.enabled) { action.run(); onDone?.(); } }}>
    <CircuitMenuIcon name={action.name} /><span className="circuit-menu-label">{action.label}</span>
    {toggle ? <span aria-hidden="true">{action.checked ? '✓' : ''}</span> :
      action.shortcut ? <kbd>{action.shortcut.replaceAll('+', ' + ')}</kbd> : null}
  </button>;
}

/** Publish stable callbacks; retained descriptors always consult the latest guards. */
export function useEditorMenuActions(actions, publish) {
  const latest = React.useRef(actions); latest.current = actions;
  const mounted = React.useRef(true);
  const signature = JSON.stringify(actions.map(({run, ...metadata}) => metadata));
  const descriptors = React.useMemo(() => latest.current.map(action => ({...action,
    run: () => runCurrentEditorAction(latest.current, mounted.current, action.name),
  })), [signature]);
  React.useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  React.useEffect(() => {
    if (typeof publish !== 'function') return undefined;
    publish(descriptors);
    return () => publish([]);
  }, [publish, descriptors]);
  return descriptors;
}

/** A viewport-bounded popup, independent of the canvas overflow and key bindings. */
let nextMenuId = 0;
export function CircuitMenuPopup({open, onOpenChange, lang, children, ...panelAttributes}) {
  const anchor = React.useRef(null);
  const panel = React.useRef(null);
  const [position, setPosition] = React.useState({left: 8, top: 8, maxHeight: '70vh'});
  const close = React.useCallback((restore = false) => {
    onOpenChange(false);
    if (restore) anchor.current?.focus();
  }, [onOpenChange]);
  React.useLayoutEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(300, window.innerWidth - 16);
      const height = Math.min(panel.current?.scrollHeight || 400, window.innerHeight - 16);
      const top = rect.bottom + 4 + height <= window.innerHeight - 8 ? rect.bottom + 4 :
        Math.max(8, rect.top - height - 4);
      setPosition({left: Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width)),
        top, maxHeight: window.innerHeight - top - 8});
    };
    place();
    panel.current?.focus();
    const outside = event => {
      if (!anchor.current?.contains(event.target) && !panel.current?.contains(event.target)) close();
    };
    const blur = event => {
      if (!anchor.current?.contains(event.target) && !panel.current?.contains(event.target)) close();
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', blur);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      if (panel.current?.contains(document.activeElement)) anchor.current?.focus();
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', blur);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, close]);
  const label = /^de/i.test(lang) ? 'Weitere Schaltungsaktionen' : 'More circuit controls';
  const menuId = React.useRef(null);
  if (menuId.current === null) menuId.current = `circuit-menu-${++nextMenuId}`;
  const id = menuId.current;
  return <div data-toolbar-more><CircuitMenuStyles />
    <button ref={anchor} type="button" className="circuit-menu-trigger" title={label} aria-label={label}
      aria-haspopup="dialog" aria-controls={open ? id : undefined} aria-expanded={open}
      onClick={() => onOpenChange(!open)} onKeyDown={event => {
        if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); onOpenChange(true); }
      }}><CircuitMenuIcon name="more" /></button>
    {open ? ReactDOM.createPortal(<div {...panelAttributes} ref={panel} id={id} role="dialog" tabIndex={-1}
      aria-label={label} className="circuit-menu-popup" data-toolbar-more-menu style={position}
      onKeyDown={event => { event.stopPropagation(); navigateCircuitMenu(event, panel.current, () => close(true)); }}
      onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
      {children}
    </div>, document.body) : null}
  </div>;
}

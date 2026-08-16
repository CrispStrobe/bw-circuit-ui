/**
 * MediaPanel — ROM/software loader for retro machines.
 *
 * Renders one drop-target per media slot described by the board's
 * describeMedia(kind) → [{id, label, accept, at, hint}], plus a
 * bundle drop that accepts a .zip containing brickwright-media.json
 * ({"slots": {"rom0": "128.rom", ...}}) and feeds one applyMedia call.
 *
 * MCU kinds (STC12, ATtiny, etc.) return [] from describeMedia and
 * never see this panel — their flash path is unchanged.
 *
 * Part of the same pane family as AsmDebugPanel.
 *
 * bw-board contract (cc479b7):
 *   describeMedia(kind) → [{id, label, accept, at, hint}]
 *   applyMedia(target, {slotId: Uint8Array}) → {applied, errors}
 *
 * @module
 */

import React, { useState, useCallback, useEffect } from 'react';

// ── Slot drop target ─────────────────────────────────────────────

function SlotDrop({ slot, onLoad, error, status }) {
  const [dragOver, setDragOver] = useState(false);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => setDragOver(false), []);

  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    const ext = file.name.toLowerCase().split('.').pop();
    const accepted = (slot.accept || '').split(',').map(s => s.trim().replace(/^\./, ''));
    if (accepted.length && !accepted.includes(ext)) {
      onLoad(slot.id, null, `Wrong file type: .${ext} (expected ${slot.accept})`);
      return;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      onLoad(slot.id, bytes, null);
    } catch (err) {
      onLoad(slot.id, null, err.message || 'Read error');
    }
  }, [slot, onLoad]);

  // Click to open file picker
  const handleClick = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = slot.accept || '';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        onLoad(slot.id, bytes, null);
      } catch (err) {
        onLoad(slot.id, null, err.message || 'Read error');
      }
    };
    input.click();
  }, [slot, onLoad]);

  const borderColor = error ? '#e74c3c'
    : status === 'ok' ? '#2ecc71'
    : dragOver ? '#61afef'
    : '#2c3e50';

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
      style={{
        border: `1px dashed ${borderColor}`,
        borderRadius: 4, padding: '6px 8px',
        background: dragOver ? '#1e2d4a' : '#0f172a',
        cursor: 'pointer', transition: 'border-color 100ms, background 100ms',
        marginBottom: 4,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: '#e2e8f0', fontSize: 10, fontWeight: 600 }}>{slot.label}</span>
        <span style={{ color: '#5c6370', fontSize: 8 }}>{slot.accept}</span>
      </div>
      {slot.hint && (
        <div style={{ color: '#7f8c8d', fontSize: 9, marginTop: 2 }}>{slot.hint}</div>
      )}
      {slot.at != null && (
        <div style={{ color: '#5c6370', fontSize: 8, marginTop: 1 }}>
          @ ${typeof slot.at === 'number' ? '0x' + slot.at.toString(16).toUpperCase() : slot.at}
        </div>
      )}
      {status === 'ok' && !error && (
        <div style={{ color: '#2ecc71', fontSize: 9, marginTop: 2 }}>Loaded</div>
      )}
      {error && (
        <div style={{ color: '#e74c3c', fontSize: 9, marginTop: 2 }}>{error}</div>
      )}
    </div>
  );
}

// ── Bundle drop target (.zip) ────────────────────────────────────

function BundleDrop({ slots, onBundleLoad }) {
  const [dragOver, setDragOver] = useState(false);
  const [status, setStatus] = useState(null); // null | 'loading' | 'ok' | {error: string}

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => setDragOver(false), []);

  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    const ext = file.name.toLowerCase().split('.').pop();
    if (ext !== 'zip') {
      setStatus({ error: 'Expected a .zip bundle' });
      setTimeout(() => setStatus(null), 3000);
      return;
    }
    setStatus('loading');
    try {
      const result = await unpackBundle(file, slots);
      onBundleLoad(result);
      setStatus('ok');
    } catch (err) {
      setStatus({ error: err.message || 'Bundle error' });
    }
    setTimeout(() => setStatus(null), 3000);
  }, [slots, onBundleLoad]);

  const borderColor = status?.error ? '#e74c3c'
    : status === 'ok' ? '#2ecc71'
    : status === 'loading' ? '#f39c12'
    : dragOver ? '#61afef'
    : '#2c3e50';

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        border: `1px dashed ${borderColor}`,
        borderRadius: 4, padding: '6px 8px',
        background: dragOver ? '#1e2d4a' : '#0a0f1a',
        cursor: 'default', transition: 'border-color 100ms, background 100ms',
        marginTop: 4,
      }}
    >
      <div style={{ color: '#94a3b8', fontSize: 10, fontWeight: 600 }}>
        Bundle (.zip)
      </div>
      <div style={{ color: '#5c6370', fontSize: 9, marginTop: 2 }}>
        Drop a .zip with brickwright-media.json to load all slots at once
      </div>
      {status === 'loading' && (
        <div style={{ color: '#f39c12', fontSize: 9, marginTop: 2 }}>Unpacking...</div>
      )}
      {status === 'ok' && (
        <div style={{ color: '#2ecc71', fontSize: 9, marginTop: 2 }}>Bundle applied</div>
      )}
      {status?.error && (
        <div style={{ color: '#e74c3c', fontSize: 9, marginTop: 2 }}>{status.error}</div>
      )}
    </div>
  );
}

/**
 * Unpack a brickwright-media.json bundle from a .zip file.
 * Returns {slotId: Uint8Array} mapping for applyMedia.
 */
async function unpackBundle(file, slots) {
  // Dynamic import: piggyback on the host's JSZip (scratch-gui dep)
  let JSZip;
  try {
    JSZip = (await import('jszip')).default || (await import('jszip'));
  } catch {
    throw new Error('JSZip not available — cannot unpack .zip bundles');
  }

  const buf = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);

  const manifestFile = zip.file('brickwright-media.json');
  if (!manifestFile) {
    throw new Error('No brickwright-media.json in archive');
  }

  const manifest = JSON.parse(await manifestFile.async('text'));
  if (!manifest.slots || typeof manifest.slots !== 'object') {
    throw new Error('brickwright-media.json must have a "slots" object');
  }

  const slotIds = new Set(slots.map(s => s.id));
  const media = {};

  for (const [slotId, fileName] of Object.entries(manifest.slots)) {
    if (!slotIds.has(slotId)) {
      throw new Error(`Unknown slot "${slotId}" in manifest`);
    }
    const entry = zip.file(fileName);
    if (!entry) {
      throw new Error(`File "${fileName}" for slot "${slotId}" not found in archive`);
    }
    media[slotId] = new Uint8Array(await entry.async('uint8array'));
  }

  return media;
}

// ── Main panel ───────────────────────────────────────────────────

/**
 * @param {{
 *   describeMedia?: (kind: string) => Array<{id, label, accept, at, hint}>,
 *   applyMedia?: (target: any, media: Record<string, Uint8Array>) => {applied: string[], errors: Record<string, string>},
 *   target?: any,
 *   machineKind?: string,
 *   lang?: string,
 * }} props
 */
export function MediaPanel({ describeMedia, applyMedia, target, machineKind, lang = 'en' }) {
  const [slotStatus, setSlotStatus] = useState({}); // slotId → 'ok' | null
  const [slotErrors, setSlotErrors] = useState({}); // slotId → error string

  // Describe available media slots for this machine kind
  const slots = describeMedia && machineKind ? describeMedia(machineKind) : [];

  // Reset state when machine kind changes
  useEffect(() => {
    setSlotStatus({});
    setSlotErrors({});
  }, [machineKind]);

  // MCU kinds return [] — hide the panel
  if (!slots || slots.length === 0) return null;

  const handleSlotLoad = useCallback((slotId, bytes, error) => {
    if (error) {
      setSlotErrors(prev => ({ ...prev, [slotId]: error }));
      return;
    }
    if (!applyMedia || !target) {
      setSlotErrors(prev => ({ ...prev, [slotId]: 'No target available' }));
      return;
    }
    const result = applyMedia(target, { [slotId]: bytes });
    if (result.errors && Object.keys(result.errors).length > 0) {
      setSlotErrors(prev => ({ ...prev, ...result.errors }));
    } else {
      setSlotErrors(prev => { const n = { ...prev }; delete n[slotId]; return n; });
      setSlotStatus(prev => ({ ...prev, [slotId]: 'ok' }));
    }
  }, [applyMedia, target]);

  const handleBundleLoad = useCallback((media) => {
    if (!applyMedia || !target) return;
    const result = applyMedia(target, media);
    if (result.errors && Object.keys(result.errors).length > 0) {
      setSlotErrors(prev => ({ ...prev, ...result.errors }));
    }
    if (result.applied) {
      const newStatus = {};
      for (const id of result.applied) newStatus[id] = 'ok';
      setSlotStatus(prev => ({ ...prev, ...newStatus }));
      // Clear errors for successfully applied slots
      setSlotErrors(prev => {
        const n = { ...prev };
        for (const id of result.applied) delete n[id];
        return n;
      });
    }
  }, [applyMedia, target]);

  return (
    <div style={{
      background: '#1a1a2e', border: '1px solid #2c3e50', borderRadius: '6px',
      fontFamily: 'monospace', fontSize: '10px',
      padding: 8,
    }} data-testid="media-panel">
      <div style={{
        color: '#e2e8f0', fontSize: 11, fontWeight: 700, marginBottom: 6,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span>Media</span>
        <span style={{ color: '#5c6370', fontWeight: 400, fontSize: 9 }}>
          {slots.length} slot{slots.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Per-slot drop targets */}
      {slots.map(slot => (
        <SlotDrop
          key={slot.id}
          slot={slot}
          onLoad={handleSlotLoad}
          error={slotErrors[slot.id] || null}
          status={slotStatus[slot.id] || null}
        />
      ))}

      {/* Bundle drop — only when there are 2+ slots */}
      {slots.length >= 2 && (
        <BundleDrop slots={slots} onBundleLoad={handleBundleLoad} />
      )}
    </div>
  );
}

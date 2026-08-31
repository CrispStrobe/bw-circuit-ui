/** Host file commands must terminate above the mutually-exclusive views. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const designer = readFileSync(path.join(here, '../src/components/CircuitDesigner.jsx'), 'utf8');
const canvas = readFileSync(path.join(here, '../src/components/BoardCanvas.jsx'), 'utf8');

describe('one view-independent circuit file-command owner', () => {
  it('CircuitDesigner owns and mounts the actionable file menu', () => {
    assert.match(designer, /import\s*\{[^}]*FileMenu[^}]*\}\s*from ['"]\.\/BoardCanvas\.jsx['"]/,
      'the always-mounted designer must import the actionable picker');
    assert.match(designer, /data-host-file-command[\s\S]*?<FileMenu/,
      'setting fileAction must mount FileMenu above the view branches');
    assert.match(designer, /<FileMenu[\s\S]*?fileAction=\{fileAction\}/,
      'the persistent menu must receive the command, not merely consume it');
  });

  it('BoardCanvas no longer receives host fileAction state', () => {
    const start = designer.indexOf('<BoardCanvas');
    const mount = designer.slice(start, start + 9000);
    assert.doesNotMatch(mount, /fileAction=|onFileActionDone=/,
      'a canvas-only receiver disappears with Schematic or Board view');
  });

  it('the picker remains a real exporter', () => {
    assert.match(canvas, /export function FileMenu\s*\(/);
    assert.match(canvas, /runExport\(entry/);
    assert.match(canvas, /download(?:Text|Blob)\(/,
      'event delivery without an artifact is still a silent no-op');
  });
});

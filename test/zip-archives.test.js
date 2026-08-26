/**
 * The ZIP reader, and the two archive formats that need it.
 *
 * `.fzz` (Fritzing) and `.epro` (EasyEDA Pro) are both zips around
 * documents this app can already read, so the archive layer is the only
 * thing standing between a user's export and a working import.
 *
 * The fixture archives are BUILT HERE rather than committed: a STORED
 * (uncompressed) zip is a few dozen bytes of header per entry, so the
 * test can construct one exactly and no binary blob enters the repo.
 * That also means the reader is tested against bytes whose every field
 * this file chose, which is a stronger check than trusting a blob.
 */

import './_setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readZipEntriesSync, readZipEntryData, readZipText } from '../src/importers/zip.js';
import { importEasyEdaProArchive } from '../src/importers/easyeda-pro-pcb.js';

/** Build a STORED-only zip. Enough to exercise every header field. */
function makeZip(files) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc32 = (b) => {
    let c = 0xFFFFFFFF;
    for (const x of b) c = crcTable[(c ^ x) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  };
  for (const [name, text] of Object.entries(files)) {
    const nameB = enc.encode(name);
    const dataB = enc.encode(text);
    const crc = crc32(dataB);
    const loc = new Uint8Array(30 + nameB.length);
    const lv = new DataView(loc.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true);
    lv.setUint16(8, 0, true);                     // STORED
    lv.setUint32(14, crc, true);
    lv.setUint32(18, dataB.length, true); lv.setUint32(22, dataB.length, true);
    lv.setUint16(26, nameB.length, true);
    loc.set(nameB, 30);
    const cen = new Uint8Array(46 + nameB.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint16(10, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, dataB.length, true); cv.setUint32(24, dataB.length, true);
    cv.setUint16(28, nameB.length, true);
    cv.setUint32(42, offset, true);
    cen.set(nameB, 46);
    central.push(cen);
    chunks.push(loc, dataB);
    offset += loc.length + dataB.length;
  }
  const cenStart = offset;
  let cenSize = 0;
  for (const c of central) { chunks.push(c); cenSize += c.length; }
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, central.length, true); ev.setUint16(10, central.length, true);
  ev.setUint32(12, cenSize, true); ev.setUint32(16, cenStart, true);
  chunks.push(eocd);
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out;
}

describe('the ZIP reader', () => {
  const zip = makeZip({ 'a.txt': 'hello', 'dir/b.json': '{"x":1}' });

  it('lists the central directory', () => {
    const { entries, warnings } = readZipEntriesSync(zip);
    assert.deepEqual(warnings, []);
    assert.deepEqual(entries.map((e) => e.name), ['a.txt', 'dir/b.json']);
    assert.equal(entries[0].size, 5);
  });

  it('reads STORED entries back byte for byte', async () => {
    const { entries } = readZipEntriesSync(zip);
    const data = await readZipEntryData(zip, entries[0]);
    assert.equal(new TextDecoder().decode(data), 'hello');
  });

  it('reads a whole archive as text, filtered', async () => {
    const { files } = await readZipText(zip, (n) => n.endsWith('.json'));
    assert.deepEqual(Object.keys(files), ['dir/b.json']);
    assert.equal(files['dir/b.json'], '{"x":1}');
  });

  it('says so when handed something that is not a zip', () => {
    const { entries, warnings } = readZipEntriesSync(new TextEncoder().encode('not a zip at all'));
    assert.deepEqual(entries, []);
    assert.match(warnings[0], /Not a ZIP archive/);
  });
});

describe('EasyEDA Pro project archive', () => {
  // A real committed Pro board, wrapped as a project export would wrap it.
  const board = readFileSync(join(import.meta.dirname, 'fixtures', 'boards', 'macropad.epcb'), 'utf8');

  it('finds the PCB document inside and imports it', async () => {
    const zip = makeZip({ 'project.json': '{"name":"x"}', 'PCB/board1.epcb': board });
    const r = await importEasyEdaProArchive(zip);
    assert.ok(r.board, 'a board came back');
    assert.ok(r.board.tracks.length > 0, 'with real copper on it');
    assert.ok(r.documents.some((d) => d.docType === 'PCB'));
  });

  it('names what it found when there is no PCB, instead of returning nothing', async () => {
    const zip = makeZip({ 'x.esch': '["DOCTYPE","SCHEMATIC","1.0"]\n' });
    const r = await importEasyEdaProArchive(zip);
    assert.equal(r.board, null);
    assert.ok(r.warnings.some((w) => /no PCB/.test(w) && /SCHEMATIC/.test(w)));
  });

  it('reports FOOTPRINT masters as an unapplied gap rather than pretending', async () => {
    const zip = makeZip({
      'PCB/b.epcb': board,
      'FP/f1.efoo': '["DOCTYPE","FOOTPRINT","1.0"]\n',
    });
    const r = await importEasyEdaProArchive(zip);
    assert.ok(r.board);
    assert.ok(r.warnings.some((w) => /FOOTPRINT master/.test(w) && /not implemented/.test(w)),
      'the gap must be stated, since component pads stay absent');
  });
});

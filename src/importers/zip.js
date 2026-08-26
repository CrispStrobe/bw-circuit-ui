/**
 * A minimal ZIP reader — enough to open the archive formats this app is
 * handed, and nothing more.
 *
 * Two importers need it and neither can take a dependency: `.fzz` (a
 * Fritzing project, which is a zip around one `.fz` document) and
 * EasyEDA Pro's `.epro`/`.epro2` (a zip of JSON documents, including the
 * FOOTPRINT masters a bare `.epcb` lacks).
 *
 * This runs in the BROWSER as well as in Node, so `zlib` is not
 * available. Inflation uses `DecompressionStream('deflate-raw')`, which
 * both have — and which is async, hence the async surface. STORED
 * entries need no inflation at all and are returned synchronously by
 * `readZipEntriesSync`, which is why that variant exists: a caller that
 * only wants the file LIST, or an uncompressed member, need not await.
 *
 * Deliberately not supported: encryption, multi-disk archives, ZIP64
 * beyond the 4 GB fields, and compression methods other than STORE (0)
 * and DEFLATE (8). Anything else is reported by name rather than
 * silently skipped — a half-read archive that does not say so is the
 * failure mode this codebase keeps designing against.
 *
 * @module
 */

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

const u16 = (v, o) => v.getUint16(o, true);
const u32 = (v, o) => v.getUint32(o, true);

/**
 * Parse the central directory. Returns entry descriptors WITHOUT data,
 * so listing an archive is cheap.
 *
 * @param {ArrayBuffer|Uint8Array} buf
 * @returns {{entries: Array<{name: string, method: number, compressedSize: number,
 *            size: number, offset: number}>, warnings: string[]}}
 */
export function readZipEntriesSync(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const warnings = [];

  // The end-of-central-directory record sits at the tail, after a comment
  // of up to 64 KB — so scan backwards for its signature.
  let eocd = -1;
  const from = Math.max(0, bytes.length - 22 - 0xFFFF);
  for (let i = bytes.length - 22; i >= from; i--) {
    if (u32(view, i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) return { entries: [], warnings: ['Not a ZIP archive: no end-of-central-directory record.'] };

  const count = u16(view, eocd + 10);
  let p = u32(view, eocd + 16);
  const entries = [];
  for (let i = 0; i < count && p + 46 <= bytes.length; i++) {
    if (u32(view, p) !== CEN_SIG) { warnings.push('ZIP central directory is malformed; stopped early.'); break; }
    const method = u16(view, p + 10);
    const compressedSize = u32(view, p + 20);
    const size = u32(view, p + 24);
    const nameLen = u16(view, p + 28);
    const extraLen = u16(view, p + 30);
    const commentLen = u16(view, p + 32);
    const offset = u32(view, p + 42);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.push({ name, method, compressedSize, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { entries, warnings };
}

/** Locate an entry's raw bytes by walking its local header. */
function rawData(bytes, entry) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (u32(view, entry.offset) !== LOC_SIG) return null;
  const nameLen = u16(view, entry.offset + 26);
  const extraLen = u16(view, entry.offset + 28);
  const start = entry.offset + 30 + nameLen + extraLen;
  return bytes.subarray(start, start + entry.compressedSize);
}

/**
 * Read one entry's bytes, inflating if needed.
 *
 * @param {ArrayBuffer|Uint8Array} buf
 * @param {{name: string, method: number, compressedSize: number, offset: number}} entry
 * @returns {Promise<Uint8Array>}
 */
export async function readZipEntryData(buf, entry) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const raw = rawData(bytes, entry);
  if (!raw) throw new Error(`ZIP entry ${entry.name}: local header not found`);
  if (entry.method === 0) return raw;
  if (entry.method !== 8) throw new Error(`ZIP entry ${entry.name}: unsupported compression method ${entry.method}`);
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This runtime has no DecompressionStream, so DEFLATE entries cannot be read.');
  }
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Read a whole archive as {name → text} for the entries a predicate
 * selects. Entries that cannot be decompressed are reported rather than
 * dropped.
 *
 * @param {ArrayBuffer|Uint8Array} buf
 * @param {(name: string) => boolean} [want]
 * @returns {Promise<{files: Record<string,string>, warnings: string[]}>}
 */
export async function readZipText(buf, want = () => true) {
  const { entries, warnings } = readZipEntriesSync(buf);
  const files = {};
  for (const e of entries) {
    if (e.name.endsWith('/')) continue;
    if (!want(e.name)) continue;
    try {
      files[e.name] = new TextDecoder().decode(await readZipEntryData(buf, e));
    } catch (err) {
      warnings.push(`${e.name}: ${err.message}`);
    }
  }
  return { files, warnings };
}

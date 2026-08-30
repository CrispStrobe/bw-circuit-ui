/**
 * File download utility for netlist exporters.
 *
 * Follows the same Blob → anchor → click pattern as export-png.js,
 * but for text files (SPICE .cir, KiCad .net, etc.).
 *
 * @module
 */

/**
 * Trigger a browser download of a text string as a file.
 *
 * @param {string} content — file content
 * @param {string} filename — download filename (e.g. 'circuit.cir')
 * @param {string} [mimeType='text/plain'] — MIME type
 */
export function downloadText(content, filename, mimeType = 'text/plain') {
  downloadBlob(new Blob([content], { type: `${mimeType};charset=utf-8` }), filename);
}

/**
 * Trigger a browser download of an already-built Blob.
 *
 * The one download path. Before this, export-png.js built its own anchor
 * and revoked the wrong URL, so every writer had to be its own downloader
 * and none of them could be tested without a browser.
 *
 * @param {Blob} blob
 * @param {string} filename
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

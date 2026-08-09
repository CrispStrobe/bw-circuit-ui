/**
 * PNG export — render the canvas SVG to a downloadable PNG image.
 *
 * Takes the SVG element from the canvas, serializes it, draws it onto
 * an offscreen canvas, and triggers a download. This is a browser-only
 * utility (uses Canvas 2D and Blob).
 *
 * @module
 */

/**
 * Export an SVG element as a PNG download.
 * @param {SVGElement} svgElement — the canvas SVG
 * @param {string} [filename='circuit.png']
 * @param {number} [scale=2] — resolution multiplier (2 = retina)
 * @returns {Promise<void>}
 */
export async function exportSvgAsPng(svgElement, filename = 'circuit.png', scale = 2) {
  const svgClone = svgElement.cloneNode(true);

  // Inline computed styles for elements that rely on CSS
  const allElements = svgClone.querySelectorAll('*');
  for (const el of allElements) {
    // Remove pointer-events styling (irrelevant for export)
    el.style.pointerEvents = '';
  }

  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(svgClone);

  const viewBox = svgElement.getAttribute('viewBox');
  let w, h;
  if (viewBox) {
    const parts = viewBox.split(/\s+/).map(Number);
    w = parts[2];
    h = parts[3];
  } else {
    w = svgElement.clientWidth || 700;
    h = svgElement.clientHeight || 500;
  }

  const canvas = document.createElement('canvas');
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);

  // Draw background
  ctx.fillStyle = '#16213e';
  ctx.fillRect(0, 0, w, h);

  const img = new Image();
  const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  return new Promise((resolve, reject) => {
    img.onload = () => {
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        if (!blob) { reject(new Error('Failed to create PNG blob')); return; }
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
        resolve();
      }, 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to render SVG to image'));
    };
    img.src = url;
  });
}

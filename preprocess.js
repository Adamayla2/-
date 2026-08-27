/**
 * preprocess.js
 * Canvas-based preprocessing. Deliberately scoped: automatic contrast
 * stretch + manual rotate/brightness/contrast controls. True perspective
 * correction and page-boundary detection need real computer-vision (OpenCV)
 * and don't have a solid pure-JS/no-build equivalent — modern vision models
 * are quite tolerant of a slightly-off photo, so this app leans on that
 * instead of trying to fake heavy CV in the browser. See README "Known
 * limitations".
 *
 * IMPORTANT: never mutates the original File. All functions return a NEW
 * canvas/Blob; the original upload is kept untouched in memory until the
 * user confirms extraction (and is discarded after, per the privacy
 * setting).
 */

export function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

/** Returns a canvas rotated by 0/90/180/270 degrees. */
export function rotateToCanvas(img, degrees) {
  const rad = (degrees * Math.PI) / 180;
  const swap = degrees % 180 !== 0;
  const w = swap ? img.naturalHeight || img.height : img.naturalWidth || img.width;
  const h = swap ? img.naturalWidth || img.width : img.naturalHeight || img.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.translate(w / 2, h / 2);
  ctx.rotate(rad);
  ctx.drawImage(img, -(img.naturalWidth || img.width) / 2, -(img.naturalHeight || img.height) / 2);
  return canvas;
}

/**
 * Simple auto-contrast: stretch the histogram so the darkest ~0.5% of
 * pixels become black and the lightest ~0.5% become white. Cheap, fast,
 * and reliably improves faint pencil/pen marks on photographed paper.
 */
export function autoContrast(canvas, brightnessAdj = 0, contrastAdj = 0) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const imgData = ctx.getImageData(0, 0, width, height);
  const d = imgData.data;

  let min = 255, max = 0;
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    if (lum < min) min = lum;
    if (lum > max) max = lum;
  }
  const range = Math.max(1, max - min);

  const contrastFactor = (259 * (contrastAdj + 255)) / (255 * (259 - contrastAdj));

  for (let i = 0; i < d.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      let v = ((d[i + c] - min) / range) * 255; // stretch
      v = contrastFactor * (v - 128) + 128 + brightnessAdj; // manual tweak
      d[i + c] = Math.max(0, Math.min(255, v));
    }
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

export function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.92) {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

export function canvasToFile(canvas, filename, type = 'image/jpeg', quality = 0.92) {
  return canvasToBlob(canvas, type, quality).then(
    blob => new File([blob], filename, { type })
  );
}

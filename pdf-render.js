/**
 * pdf-render.js
 * Renders each page of an uploaded PDF questionnaire to a canvas/File using
 * pdf.js (loaded from a CDN in index.html). After this step, a PDF upload
 * is indistinguishable from a photographed image upload to the rest of the
 * app — everything downstream (preprocess, extraction, review) just sees
 * page images.
 */

function requirePdfJs() {
  if (typeof window === 'undefined' || !window.pdfjsLib) {
    throw new Error('pdf.js did not load. Check your internet connection and reload the app.');
  }
  return window.pdfjsLib;
}

/** Renders every page of a PDF File to an array of Files (image/png). */
export async function pdfFileToImageFiles(file, scale = 2.0) {
  const pdfjsLib = requirePdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const outFiles = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const baseName = file.name.replace(/\.pdf$/i, '');
    outFiles.push(new File([blob], `${baseName}_p${pageNum}.png`, { type: 'image/png' }));
  }
  return outFiles;
}

/* Extraction du texte positionné d'un PDF (pdf.js). Rend, pour chaque page, la liste des éléments {str, x, y, w}. */
'use strict';
let pdfjsP = null;
function loadPdfjs() {
  if (!pdfjsP) pdfjsP = import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsP;
}

async function extractPages(buf) {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(buf.buffer ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) : buf);
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false, verbosity: 0 }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    const items = [];
    for (const it of tc.items) {
      if (typeof it.str !== 'string' || !it.str.trim()) continue;
      const t = it.transform;
      const rot = Math.abs(t[1]) > 0.01 || Math.abs(t[2]) > 0.01; // texte pivoté (code-barres en marge)
      if (rot) continue;
      items.push({ str: it.str, x: t[4], y: t[5], w: it.width });
    }
    pages.push({ number: i, items });
  }
  await doc.destroy();
  return pages;
}

module.exports = { extractPages };

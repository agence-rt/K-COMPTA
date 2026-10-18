'use strict';
const { PDFDocument, StandardFonts } = require('pdf-lib');
/** Facture PDF de test : lignes de texte de haut en bas. */
async function makeInvoice(rows) {
  const doc = await PDFDocument.create(), f = await doc.embedFont(StandardFonts.Helvetica), page = doc.addPage([595, 842]);
  let y = 800; rows.forEach(r => { page.drawText(r, { x: 50, y, size: 10, font: f }); y -= 16; });
  return Buffer.from(await doc.save());
}
module.exports = { makeInvoice };

/* Compilation des justificatifs en un seul PDF : page de garde (résumé TVA, pièces manquantes), index, puis les
   justificatifs numérotés dans l'ordre : compte bancaire, dépenses, recettes, hors TVA, puis date. */
'use strict';
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const C = require('../calc');
const { SOC, fmt, fmt0, frFull, TYPE_SHORT } = C;

const wa = s => String(s == null ? '' : s).replace(/[  ]/g, ' ').replace(/[−–—]/g, '-').replace(/[‘’]/g, '\'').replace(/[“”]/g, '"')
  .split('').map(ch => { const c = ch.charCodeAt(0); return c < 32 ? ' ' : (c <= 126 || (c >= 160 && c <= 255)) ? ch : (c === 0x20ac ? ch : '?'); }).join('');

/** readDoc(ligne) rend le contenu du justificatif (Buffer) ou null. */
async function buildPdf(soc, periodId, data, readDoc) {
  const s = SOC[soc], p = C.periodInfo(soc, periodId), model = C.exportModel(data, soc), { D } = C.totals(data);
  const out = await PDFDocument.create();
  const f = await out.embedFont(StandardFonts.Helvetica), fb = await out.embedFont(StandardFonts.HelveticaBold);
  const RED = rgb(0.70, 0.08, 0.11), INK = rgb(0.13, 0.11, 0.11), MUT = rgb(0.42, 0.38, 0.38), LINE = rgb(0.85, 0.83, 0.82);
  const pieces = [], missing = [];
  for (const it of model.flat) {
    const l = it.l;
    if (l.doc) {
      let src = null, err = '';
      const buf = await readDoc(l);
      if (buf) { try { src = await PDFDocument.load(buf, { ignoreEncryption: true }); } catch (e) { err = 'PDF illisible'; } } else err = 'fichier introuvable';
      pieces.push({ it, src, err, pages: src ? src.getPageCount() : 1 });
    } else if (C.needsDoc(l)) missing.push(it);
  }
  if (!pieces.length) return null;
  const ROWS = 40, indexPages = Math.max(1, Math.ceil(pieces.length / ROWS));
  let nextPage = 2 + indexPages;
  pieces.forEach(pc => { pc.start = nextPage; nextPage += pc.pages; });
  const fit = (txt, font, size, w) => { let t = wa(txt); if (font.widthOfTextAtSize(t, size) <= w) return t; while (t.length > 1 && font.widthOfTextAtSize(t + '...', size) > w) t = t.slice(0, -1); return t + '...'; };
  const bshort = it => it.bank.id.toUpperCase();
  let pg = out.addPage([595.28, 841.89]);
  const T = (txt, x, y, size, font, color) => pg.drawText(wa(txt), { x, y, size, font: font || f, color: color || INK });
  const TR = (txt, xr, y, size, font, color) => { const t = wa(txt), fo = font || f; pg.drawText(t, { x: xr - fo.widthOfTextAtSize(t, size), y, size, font: fo, color: color || INK }); };
  pg.drawRectangle({ x: 40, y: 770, width: 46, height: 46, color: RED }); T('CPT', 47, 785, 15, fb, rgb(1, 1, 1));
  T('AGOA COMPTA', 98, 797, 18, fb); T('Justificatifs classés dans l\'ordre', 98, 779, 11, f, MUT);
  T(s.name, 40, 730, 15, fb); T(p.label + ' · déclaration ' + s.freqLabel.toLowerCase() + (s.siren ? ' · SIREN ' + s.siren : ''), 40, 712, 10.5, f, MUT);
  pg.drawLine({ start: { x: 40, y: 696 }, end: { x: 555, y: 696 }, thickness: .7, color: LINE });
  T('Résumé de la TVA', 40, 672, 12, fb);
  [['TVA brute due (ligne 16)', D.L16], ['TVA déductible (ligne 23)', D.L23]].forEach((r, i) => { T(r[0], 40, 650 - i * 18, 10.5); TR(fmt0(r[1]) + '\u00a0€', 555, 650 - i * 18, 10.5, fb); });
  const res = D.TD > 0 ? 'TVA à payer (ligne 32)' : D.TD < 0 ? 'Crédit de TVA (ligne 25)' : 'Aucune TVA à payer';
  pg.drawRectangle({ x: 40, y: 592, width: 515, height: 26, color: rgb(0.97, 0.94, 0.94) });
  T(res, 48, 601, 11, fb); TR(fmt0(Math.abs(D.TD)) + '\u00a0€', 547, 601, 12, fb, RED);
  T('Montants déclarés, arrondis à l\'euro.', 40, 574, 8.5, f, MUT);
  T('Contenu', 40, 544, 12, fb);
  T(pieces.length + ' justificatif' + (pieces.length > 1 ? 's' : '') + ' · ' + model.flat.length + ' ligne' + (model.flat.length > 1 ? 's' : '') + ' · ordre : compte bancaire, dépenses, recettes, hors TVA, puis date', 40, 526, 9.5, f, MUT);
  if (missing.length) {
    T('Justificatifs manquants (' + missing.length + ')', 40, 494, 12, fb, RED);
    let y = 476;
    missing.slice(0, 22).forEach(it => { T(it.n + '  ' + frFull(it.l.date) + '  ' + fit(it.l.label || '(sans libellé)', f, 9, 300) + '  ' + bshort(it) + '  ' + fmt(C.lineTTC(it.l)) + '\u00a0€', 40, y, 9); y -= 14; });
    if (missing.length > 22) T('... et ' + (missing.length - 22) + ' autres (voir l\'export Excel).', 40, y, 9, f, MUT);
  }
  T('Édité le ' + new Date().toLocaleDateString('fr-FR') + ' par AGOA COMPTA', 40, 40, 8.5, f, MUT);
  for (let ip = 0; ip < indexPages; ip++) {
    pg = out.addPage([595.28, 841.89]);
    T('Index des justificatifs', 40, 800, 14, fb); TR('Page ' + (ip + 1) + ' / ' + indexPages + ' · ' + s.short + ' · ' + p.label, 555, 800, 9, f, MUT);
    let y = 772;
    [['N°', 40], ['Date', 66], ['Libellé', 120], ['Nature', 330], ['Montant', 440]].forEach(h => T(h[0], h[1], y, 8.5, fb, MUT));
    TR('Page', 555, y, 8.5, fb, MUT);
    pg.drawLine({ start: { x: 40, y: y - 5 }, end: { x: 555, y: y - 5 }, thickness: .7, color: LINE }); y -= 20;
    pieces.slice(ip * ROWS, (ip + 1) * ROWS).forEach(pc => {
      const it = pc.it, l = it.l;
      T(String(it.n), 40, y, 9); T(frFull(l.date), 66, y, 9); T(fit(l.label || '(sans libellé)', f, 9, 200), 120, y, 9);
      T(TYPE_SHORT[it.type] + ' · ' + bshort(it), 330, y, 9); TR((l.debit > 0 ? '-' : '+') + fmt(C.lineTTC(l)) + '\u00a0€', 515, y, 9);
      TR(pc.src ? String(pc.start) + (pc.pages > 1 ? '-' + (pc.start + pc.pages - 1) : '') : 'n/i', 555, y, 9, fb, pc.src ? INK : RED);
      y -= 17;
    });
  }
  for (const pc of pieces) {
    const it = pc.it, l = it.l;
    const label = 'Pièce n° ' + it.n + ' · ' + bshort(it) + ' · ' + TYPE_SHORT[it.type] + ' · ' + frFull(l.date) + ' · ' + (l.label || '');
    let first;
    if (pc.src) { const cp = await out.copyPages(pc.src, pc.src.getPageIndices()); cp.forEach(x => out.addPage(x)); first = cp[0]; }
    else {
      first = out.addPage([595.28, 841.89]);
      first.drawText(wa('Justificatif non intégré : ' + pc.err), { x: 40, y: 760, size: 11, font: f, color: INK });
      first.drawText(wa(l.doc.name || ''), { x: 40, y: 742, size: 9, font: f, color: MUT });
    }
    const h = first.getSize().height, txt = fit(label, fb, 8, 420), w = fb.widthOfTextAtSize(txt, 8) + 10;
    first.drawRectangle({ x: 14, y: h - 24, width: w, height: 14, color: rgb(1, 1, 1), borderColor: RED, borderWidth: .7 });
    first.drawText(txt, { x: 19, y: h - 20, size: 8, font: fb, color: RED });
  }
  return Buffer.from(await out.save());
}
module.exports = { buildPdf };

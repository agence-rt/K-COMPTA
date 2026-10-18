/* Fabrique des relevés PDF de test qui reproduisent la mise en page des relevés Crédit Mutuel et Société Générale :
   textes positionnés par colonnes, montants alignés à droite sous Débit / Crédit. */
'use strict';
const { PDFDocument, StandardFonts, rgb, degrees } = require('@cantoo/pdf-lib');

const fmtAmt = s => { const [i, d] = Number(s).toFixed(2).split('.'); return i.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + d; };
const date = day => String(day).padStart(2, '0') + '/09/2026';

async function make(kind, data) {
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(StandardFonts.Helvetica);
  const H = 842, W = 595;
  const right = (page, txt, xr, y, size = 9) => page.drawText(txt, { x: xr - f.widthOfTextAtSize(txt, size), y, size, font: f });
  const L = (page, txt, x, y, size = 9) => page.drawText(txt, { x, y, size, font: f });
  let page, y, pageNo = 0;
  const cm = kind === 'cm';
  const colD = cm ? 480 : 485, colC = cm ? 550 : 555;
  const newPage = () => {
    page = doc.addPage([W, H]); pageNo++;
    if (cm) {
      L(page, 'CAISSE DE CREDIT MUTUEL ENSEIGNANT LOIRE HAUTE LOIRE, Société coopérative de crédit à capital variable', 40, 810, 7);
      L(page, 'Page ' + pageNo + 'Sous réserve des extournes ou annulations éventuelles', 40, 796, 7);
      if (pageNo === 1) { L(page, 'SARL THOMAS KOCHANSKI ARCHITECTE', 40, 770, 9); L(page, '1 B RUE GABRIEL TYR', 40, 758, 9); }
      L(page, 'RELEVE ET INFORMATIONS BANCAIRES Caisse 07391', 40, 700, 9);
      L(page, '30 septembre 2026', 40, 688, 9);
      L(page, 'C/C Eurocompte PRO Confort N° 00020453745 en euros (GD)', 40, 670, 9);
      L(page, 'Date', 40, 640, 8); L(page, 'Date valeur', 90, 640, 8); L(page, 'Opération', 150, 640, 8);
      L(page, 'Débit', 410, 640, 8); L(page, 'EUROS', 440, 640, 8); L(page, 'Crédit', 500, 640, 8); L(page, 'EUROS', 530, 640, 8);
      page.drawText('H T . 2 0 2 6 1 0 0 1', { x: 585, y: 300, size: 6, font: f, rotate: degrees(90) });
      y = 615;
    } else {
      L(page, 'Société Générale 552 120 222 RCS Paris', 40, 810, 7);
      L(page, 'THOMAS KOCHANSKI ARCHITECTE', 40, 770, 9); L(page, '1 B RUE GABRIEL TYR', 40, 758, 9);
      L(page, 'RELEVÉ DE COMPTE', 40, 720, 11);
      L(page, 'n° 30003 01842 00028011512 20', 40, 706, 9); L(page, 'du 01/09/2026 au 30/09/2026', 40, 694, 9);
      L(page, 'RELEVÉ DES OPÉRATIONS', 40, 650, 9);
      L(page, 'Date', 40, 636, 8); L(page, 'Valeur', 95, 636, 8); L(page, 'Nature de l\'opération', 150, 636, 8); L(page, 'Débit', 455, 636, 8); L(page, 'Crédit', 520, 636, 8);
      y = 612;
    }
  };
  newPage();
  const need = n => { if (y - n * 12 < 90) { L(page, '<<Suite au verso>>', 40, 60, 8); newPage(); } };
  if (cm) { L(page, 'SOLDE CREDITEUR AU 31/08/2026', 150, y, 9); right(page, fmtAmt(data.meta.open), colC, y); y -= 18; }
  else { L(page, 'SOLDE PRÉCÉDENT AU 31/08/2026', 150, y, 9); right(page, fmtAmt(data.meta.open), colC, y); y -= 22; }
  data.lines.forEach(l => {
    const det = [];
    if (l.hint && l.hint.text) {
      if (cm) { if (l.hint.tva && !l.hint.ht) det.push('DONT TVA ' + String(l.hint.tva).replace('.', ',') + 'EUR'); else det.push('TVA' + l.hint.rate); }
      else { det.push('MONTANT NT : 30,39 EUR'); det.push('MONTANT HT : ' + String(l.hint.ht).replace('.', ',') + ' EUR'); det.push('TVA A 20,00%: ' + String(l.hint.tva).replace('.', ',') + ' EUR'); }
    }
    let first = l.label;
    if (cm && /^PAIEMENT (CB|PSC) /.test(l.label)) { const m = l.label.match(/^(PAIEMENT (?:CB|PSC)) (.*)$/); first = m[1] + '  0109 PARIS'; det.unshift(m[2] + ' CARTE 6829'); }
    else if (cm && /^PRLV SEPA /.test(l.label)) det.push('ICS : FR55ZZZ143065', 'RUM : MTMXPAXBHCXCZMD');
    else if (cm) det.push('VH62462PXVVN9F01');
    if (!cm && /^PRELEVEMENT EUROPEEN/.test(l.label)) { first = 'PRELEVEMENT EUROPEEN 6514750415'; det.unshift('DE: GESTION ASSURANCES', 'ID: FR40ZZZ470807', 'MOTIF: MRPRO SOGESSUR'); }
    if (!cm && /^VIR PERM/.test(l.label)) { first = '000001 VIR PERM'; det.unshift('POUR: FAURIEL49', 'REF: 668868786504', 'MOTIF: LOCATION FAURIEL49'); }
    need(det.length + 3);
    const xr = l.dir === 'D' ? colD : colC;
    L(page, date(l.day), 40, y); L(page, date(l.day), cm ? 90 : 95, y); L(page, first, 150, y);
    if (cm) right(page, fmtAmt(l.amount), xr, y);
    y -= 12;
    det.forEach(t => { L(page, t, 150, y, 8); y -= 11; });
    if (!cm) { right(page, fmtAmt(l.amount) + (l.label.startsWith('COTISATION') ? ' *' : ''), xr + (l.label.startsWith('COTISATION') ? 6 : 0), y, 9); y -= 12; }
    y -= 8;
  });
  need(6);
  if (cm) {
    L(page, 'Total des mouvements', 150, y, 9); right(page, fmtAmt(data.meta.td), colD, y); right(page, fmtAmt(data.meta.tc), colC, y); y -= 16;
    L(page, 'Réf : 009 SOLDE CREDITEUR AU 30/09/2026', 150, y, 9); right(page, fmtAmt(data.meta.close), colC, y); y -= 14;
    L(page, 'IBAN : FR76 1027 8073 9100 0204 5374 566', 40, y, 8);
  } else {
    L(page, 'TOTAUX DES MOUVEMENTS', 150, y, 9); right(page, fmtAmt(data.meta.td), colD, y); y -= 16;
    L(page, 'NOUVEAU SOLDE AU 30/09/2026', 150, y, 9); right(page, '+ ' + fmtAmt(data.meta.close), colC, y); y -= 14;
  }
  return Buffer.from(await doc.save());
}
module.exports = { make };

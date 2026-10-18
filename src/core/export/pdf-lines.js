/* Export PDF « Lignes et TVA » : même contenu que l'Excel (résumé TVA puis un tableau par compte bancaire), en paysage. */
'use strict';
const { PDFDocument, StandardFonts, rgb } = require('@cantoo/pdf-lib');
const C = require('../calc');
const { SOC, fmt, fmt0, frFull, r2, TYPE_NOTE, TYPE_SHORT } = C;
const { wa } = require('./pdf');

const W = 841.89, H = 595.28, MX = 36;
const eur = n => fmt(n) + ' €';

async function buildLinesPdf(soc, periodId, data) {
  const s = SOC[soc], p = C.periodInfo(soc, periodId), model = C.exportModel(data, soc), { t, D } = C.totals(data), k = C.stats(data, soc);
  const out = await PDFDocument.create();
  const f = await out.embedFont(StandardFonts.Helvetica), fb = await out.embedFont(StandardFonts.HelveticaBold);
  const RED = rgb(0.70, 0.08, 0.11), INK = rgb(0.13, 0.11, 0.11), MUT = rgb(0.42, 0.38, 0.38), LINE = rgb(0.85, 0.83, 0.82), BG = rgb(0.96, 0.95, 0.94);
  const BLUE = rgb(0.08, 0.40, 0.75), GREEN = rgb(0.10, 0.48, 0.25), ORANGE = rgb(0.80, 0.45, 0.05);
  let pg = null, y = 0, pageNo = 0; const pages = [];
  const fit = (txt, font, size, w) => { let x = wa(txt); if (font.widthOfTextAtSize(x, size) <= w) return x; while (x.length > 1 && font.widthOfTextAtSize(x + '...', size) > w) x = x.slice(0, -1); return x + '...'; };
  const T = (txt, x, yy, size, font, color) => pg.drawText(wa(txt), { x, y: yy, size, font: font || f, color: color || INK });
  const TR = (txt, xr, yy, size, font, color) => { const x = wa(txt), fo = font || f; pg.drawText(x, { x: xr - fo.widthOfTextAtSize(x, size), y: yy, size, font: fo, color: color || INK }); };
  const newPage = title => {
    pg = out.addPage([W, H]); pages.push(pg); pageNo++;
    pg.drawRectangle({ x: MX, y: H - 50, width: 26, height: 26, color: RED }); T('CPT', MX + 4, H - 41, 9, fb, rgb(1, 1, 1));
    T('AGOA COMPTA · ' + s.name, MX + 36, H - 36, 11, fb); T(p.label + ' · ' + title, MX + 36, H - 49, 9, f, MUT);
    pg.drawLine({ start: { x: MX, y: H - 58 }, end: { x: W - MX, y: H - 58 }, thickness: .6, color: LINE });
    y = H - 80;
  };

  /* ---------- page 1 : résumé de la TVA ---------- */
  newPage('Résumé de la TVA');
  T('Formulaire 3310-CA3', MX, y, 12, fb); y -= 8;
  const cols = [MX, MX + 40, 520, 620, 720]; // ligne, intitulé, base, tva (droite)
  const head = () => { y -= 14; T('Ligne', cols[0], y, 8.5, fb, MUT); T('Intitulé', cols[1], y, 8.5, fb, MUT); TR('Base HT', 640, y, 8.5, fb, MUT); TR('TVA', 760, y, 8.5, fb, MUT); y -= 5; pg.drawLine({ start: { x: MX, y }, end: { x: W - MX, y }, thickness: .6, color: LINE }); y -= 13; };
  head();
  const row = (a, b, base, tva, bold) => { T(a, cols[0], y, 9.5, bold ? fb : f); T(b, cols[1], y, 9.5, bold ? fb : f); if (base != null) TR(fmt0(base) + ' €', 640, y, 9.5, bold ? fb : f); if (tva != null) TR(fmt0(tva) + ' €', 760, y, 9.5, bold ? fb : f); y -= 15; };
  row('A1', 'Ventes, prestations de services', D.A1, null);
  row('08', 'TVA brute · taux normal 20 %', D.b08, D.t08);
  row('9B', 'TVA brute · taux réduit 10 %', D.b9B, D.t9B);
  row('16', 'Total de la TVA brute due', null, D.L16, true);
  row('19', 'TVA déductible · immobilisations', null, D.L19);
  row('20', 'TVA déductible · autres biens et services', null, D.L20);
  row('22', 'Report du crédit de TVA précédent', null, D.L22);
  row('23', 'Total de la TVA déductible', null, D.L23, true);
  y -= 4; pg.drawRectangle({ x: MX, y: y - 8, width: W - 2 * MX, height: 26, color: BG });
  T(D.TD > 0 ? 'TVA à payer (ligne 32)' : D.TD < 0 ? 'Crédit de TVA (ligne 25)' : 'Aucune TVA à payer', MX + 8, y, 11.5, fb); TR(fmt0(Math.abs(D.TD)) + ' €', 752, y, 12.5, fb, RED); y -= 40;
  T('Montants déclarés arrondis à l\'euro ; détail exact ci-dessous.', MX, y + 18, 8, f, MUT);

  const half = 380, yTop = y;
  const detail = (title, o, label, x0) => {
    let yy = yTop; pg.drawText(wa(title), { x: x0, y: yy, size: 10.5, font: fb, color: INK }); yy -= 14;
    const ks = Object.keys(o).map(Number).sort((a, b) => b - a);
    pg.drawText('Taux', { x: x0, y: yy, size: 8.5, font: fb, color: MUT }); const wr = (txt, xr, fo) => pg.drawText(wa(txt), { x: xr - (fo || f).widthOfTextAtSize(wa(txt), 9), y: yy, size: 9, font: fo || f, color: INK });
    const w8 = (txt, xr) => pg.drawText(wa(txt), { x: xr - fb.widthOfTextAtSize(wa(txt), 8.5), y: yy, size: 8.5, font: fb, color: MUT });
    w8('Base HT', x0 + 220); w8(label, x0 + half - 30); yy -= 14;
    if (!ks.length) { pg.drawText('Aucune ligne', { x: x0, y: yy, size: 9, font: f, color: MUT }); yy -= 14; }
    ks.forEach(r => { pg.drawText(wa(C.rl(r)), { x: x0, y: yy, size: 9, font: f, color: INK }); wr(eur(r2(o[r].ht)), x0 + 220); wr(eur(r2(o[r].tva)), x0 + half - 30); yy -= 14; });
    return yy;
  };
  const y1 = detail('Recettes', t.rec, 'TVA collectée', MX), y2 = detail('Dépenses', t.dep, 'TVA déductible', MX + half + 20);
  y = Math.min(y1, y2) - 14;
  T('Soldes par compte', MX, y, 10.5, fb); y -= 14;
  [['Compte', 60], ['Ouverture', 300], ['Débits', 390], ['Crédits', 480], ['Calculé', 570], ['Relevé', 660], ['Écart', 750]].forEach((h, i) => { if (i === 0) T(h[0], MX, y, 8.5, fb, MUT); else TR(h[0], h[1] + 36, y, 8.5, fb, MUT); }); y -= 14;
  model.secs.forEach(sc => {
    const a = sc.acct, A = data.accounts[sc.bank.id] || { open: 0, close: 0 }, bad = Math.abs(a.ecart) >= 0.005;
    T(sc.bank.name, MX, y, 9.5, fb, sc.bank.id === 'sg' ? RED : BLUE);
    [A.open, a.d, a.c, a.calc, A.close].forEach((v, i) => TR(eur(v), 336 + i * 90, y, 9.5)); TR(eur(a.ecart), 786, y, 9.5, bad ? fb : f, bad ? RED : GREEN); y -= 15;
  });
  y -= 8; T('Contrôles : ' + k.n + ' ligne' + (k.n > 1 ? 's' : '') + ' · ' + k.todo + ' à classer · ' + k.bad + ' à corriger · ' + k.miss + ' justificatif(s) manquant(s) · ' + k.bank + ' compte(s) avec écart de solde', MX, y, 9, f, MUT);

  /* ---------- tableaux par compte ---------- */
  const COL = { code: MX, date: MX + 82, label: MX + 132, deb: 430, cre: 490, nat: 498, tx: 556, ht: 660, tva: 720, doc: 728 };
  const lineCols = () => {
    T('Code', COL.code, y, 8, fb, MUT); T('Date', COL.date, y, 8, fb, MUT); T('Libellé', COL.label, y, 8, fb, MUT); TR('Débit', COL.deb + 44, y, 8, fb, MUT); TR('Crédit', COL.cre + 50, y, 8, fb, MUT);
    T('Nature', 548, y, 8, fb, MUT); T('Taux', 612, y, 8, fb, MUT); TR('Base HT', 704, y, 8, fb, MUT); TR('TVA', 758, y, 8, fb, MUT); T('PDF', 768, y, 8, fb, MUT);
    pg.drawLine({ start: { x: MX, y: y - 4 }, end: { x: W - MX, y: y - 4 }, thickness: .5, color: LINE }); y -= 15;
  };
  const natColor = tp => tp === 'dep' ? RED : tp === 'rec' ? GREEN : tp === 'hors' ? ORANGE : MUT;
  model.secs.forEach(sc => {
    const bcol = sc.bank.id === 'sg' ? RED : BLUE;
    newPage(sc.bank.name); T(sc.bank.name + ' · ' + sc.count + ' ligne' + (sc.count > 1 ? 's' : ''), MX, y, 12, fb, bcol); y -= 8;
    if (!sc.groups.length) { y -= 14; T('Aucune ligne sur ce compte.', MX, y, 9.5, f, MUT); return; }
    sc.groups.forEach(g => {
      const need = 60; if (y < need + 20) { newPage(sc.bank.name); }
      y -= 16; T(g.title + ' · ' + TYPE_NOTE[g.type], MX, y, 10, fb, natColor(g.type)); y -= 14; lineCols();
      let sd = 0, sc2 = 0, sh = 0, st = 0;
      g.items.forEach(it => {
        if (y < 52) { newPage(sc.bank.name); T(g.title + ' (suite)', MX, y, 10, fb, natColor(g.type)); y -= 14; lineCols(); }
        const l = it.l, ht = l.vent.reduce((a, v) => a + v.ht, 0), tva = l.vent.reduce((a, v) => a + C.vTva(v), 0);
        const rates = [...new Set(l.vent.map(v => v.rate))];
        const taux = !(l.type === 'dep' || l.type === 'rec') ? '-' : rates.length > 1 ? 'Ventilée' : rates.length === 1 ? C.rl(rates[0]) : '-';
        T(l.code || String(it.n), COL.code, y, 7.5, f, MUT); T(frFull(l.date), COL.date, y, 8.5); T(fit(l.label || '(sans libellé)', f, 8.5, 285), COL.label, y, 8.5);
        if (l.debit > 0) TR(eur(l.debit), COL.deb + 44, y, 8.5); if (l.credit > 0) TR(eur(l.credit), COL.cre + 50, y, 8.5);
        T(TYPE_SHORT[it.type], 548, y, 8.5, f, natColor(it.type)); T(taux, 612, y, 8.5);
        if (l.vent.length) { TR(eur(r2(ht)), 704, y, 8.5); TR(eur(r2(tva)), 758, y, 8.5); }
        const needs = C.needsDoc(l); T(l.doc ? 'oui' : l.valid ? 'validé' : needs ? 'manquant' : '-', 768, y, 8, f, l.doc ? GREEN : needs ? RED : MUT);
        sd += l.debit > 0 ? l.debit : 0; sc2 += l.credit > 0 ? l.credit : 0; sh += ht; st += tva; y -= 13;
      });
      pg.drawLine({ start: { x: MX, y: y + 8 }, end: { x: W - MX, y: y + 8 }, thickness: .4, color: LINE });
      T('Total ' + g.title.toLowerCase(), COL.label, y - 3, 8.5, fb); TR(eur(r2(sd)), COL.deb + 44, y - 3, 8.5, fb); TR(eur(r2(sc2)), COL.cre + 50, y - 3, 8.5, fb); TR(eur(r2(sh)), 704, y - 3, 8.5, fb); TR(eur(r2(st)), 758, y - 3, 8.5, fb); y -= 12;
    });
  });
  pages.forEach((pp, i) => { pp.drawText(wa('Édité le ' + new Date().toLocaleDateString('fr-FR') + ' par AGOA COMPTA · page ' + (i + 1) + ' / ' + pages.length), { x: MX, y: 22, size: 8, font: f, color: MUT }); });
  return Buffer.from(await out.save());
}
module.exports = { buildLinesPdf };

/* Export Excel : résumé de la TVA + un onglet par compte bancaire (dépenses, recettes, hors TVA). */
'use strict';
const X = require('xlsx');
const C = require('../calc');
const { r2, SOC } = C;

const RATES_X = [20, 10, 5.5, 2.1];
function xlRow(it) {
  const l = it.l, vt = {};
  l.vent.forEach(v => { const k = v.rate; vt[k] = vt[k] || { ht: 0, tva: 0 }; vt[k].ht += v.ht; vt[k].tva += C.vTva(v); });
  const row = [it.n, C.frFull(l.date), l.label || '', l.debit > 0 ? l.debit : null, l.credit > 0 ? l.credit : null];
  RATES_X.forEach(r => { row.push(vt[r] ? r2(vt[r].ht) : null, vt[r] ? r2(vt[r].tva) : null); });
  let hors = null;
  if (l.type === 'hors') hors = r2(C.lineTTC(l));
  else if (l.type === 'dep' && l.vent.length) { const r = r2(C.lineTTC(l) - l.vent.reduce((a, v) => a + C.vTTC(v), 0)); if (r > 0.005) hors = r; }
  row.push(hors, l.immo ? 'Oui' : '', l.doc ? (l.doc.name || '') : '');
  return row;
}
function sumCols(rows) { const o = []; for (let c = 3; c <= 13; c++) { let t = 0, any = false; rows.forEach(r => { if (typeof r[c] === 'number') { t += r[c]; any = true; } }); o.push(any ? r2(t) : null); } return o; }

function buildXlsx(soc, periodId, data) {
  const s = SOC[soc], p = C.periodInfo(soc, periodId), model = C.exportModel(data, soc), { t, D } = C.totals(data), k = C.stats(data, soc);
  const wb = X.utils.book_new();
  const lab = D.TD > 0 ? 'TVA à payer' : D.TD < 0 ? 'Crédit de TVA' : 'Aucune TVA à payer';
  const sum = [
    ['AGOA COMPTA — Résumé de la TVA'], ['Société', s.name], ['Période', p.label], ['Déclaration', s.freqLabel + (s.siren ? ' · SIREN ' + s.siren : '')], ['Édité le', new Date().toLocaleDateString('fr-FR')], [],
    ['Formulaire 3310-CA3', '', 'Base HT déclarée', 'TVA déclarée', 'Base HT exacte', 'TVA exacte'],
    ['A1', 'Ventes, prestations de services', D.A1, null, r2(t.b20 + t.b10), null],
    ['08', 'TVA brute · taux normal 20 %', D.b08, D.t08, r2(t.b20), r2(t.t20)],
    ['9B', 'TVA brute · taux réduit 10 %', D.b9B, D.t9B, r2(t.b10), r2(t.t10)],
    ['16', 'Total de la TVA brute due', null, D.L16, null, r2(t.t20 + t.t10)],
    ['19', 'TVA déductible · immobilisations', null, D.L19, null, r2(t.d19)],
    ['20', 'TVA déductible · autres biens et services', null, D.L20, null, r2(t.d20)],
    ['22', 'Report du crédit de TVA précédent', null, D.L22, null, r2(data.report || 0)],
    ['23', 'Total de la TVA déductible', null, D.L23, null, r2(t.d19 + t.d20 + (data.report || 0))],
    ['TD', 'TVA due (ligne 16 − ligne 23)', null, D.TD, null, r2(D.TD)]
  ];
  if (D.TD > 0) sum.push(['32', 'Total à payer', null, D.TD]); else if (D.TD < 0) sum.push(['25', 'Crédit de TVA', null, -D.TD]);
  sum.push([], ['RÉSULTAT', lab, null, Math.abs(D.TD)], []);
  const rowsFor = o => { const ks = Object.keys(o).map(Number).sort((a, b) => b - a); return ks.length ? ks.map(r => [C.rl(r), '', r2(o[r].ht), r2(o[r].tva)]) : [['Aucune ligne']]; };
  sum.push(['Recettes', '', 'Base HT', 'TVA collectée']); rowsFor(t.rec).forEach(r => sum.push(r));
  sum.push([], ['Dépenses', '', 'Base HT', 'TVA déductible']); rowsFor(t.dep).forEach(r => sum.push(r));
  sum.push([], ['Soldes par compte', 'Solde d\'ouverture', 'Débits', 'Crédits', 'Solde calculé', 'Solde du relevé', 'Écart']);
  model.secs.forEach(sc => { const a = sc.acct, A = data.accounts[sc.bank.id] || { open: 0, close: 0 }; sum.push([sc.bank.name, A.open, a.d, a.c, a.calc, A.close, a.ecart]); });
  sum.push([], ['Contrôles'], ['Lignes', k.n], ['À classer', k.todo], ['Ventilations à corriger', k.bad], ['Justificatifs manquants', k.miss], ['Comptes avec un écart de solde', k.bank]);
  const ws0 = X.utils.aoa_to_sheet(sum);
  ws0['!cols'] = [{ wch: 24 }, { wch: 44 }, { wch: 17 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 12 }];
  Object.keys(ws0).forEach(a => { if (a[0] === '!') return; const c = ws0[a]; if (c.t === 'n') { const col = X.utils.decode_cell(a).c; if (col >= 1) c.z = (col === 2 || col === 3) && Number.isInteger(c.v) ? '#,##0' : '#,##0.00'; } });
  X.utils.book_append_sheet(wb, ws0, 'Résumé TVA');
  model.secs.forEach(sc => {
    const a = sc.acct, A = data.accounts[sc.bank.id] || { open: 0, close: 0 };
    const rows = [['AGOA COMPTA — ' + s.name], [sc.bank.name + ' · ' + p.label], [],
      ['', '', 'Solde d\'ouverture', A.open], ['', '', 'Total des débits', a.d], ['', '', 'Total des crédits', a.c], ['', '', 'Solde calculé', a.calc], ['', '', 'Solde du relevé', A.close], ['', '', 'Écart', a.ecart], [],
      ['N°', 'Date', 'Libellé', 'Débit', 'Crédit', 'HT 20 %', 'TVA 20 %', 'HT 10 %', 'TVA 10 %', 'HT 5,5 %', 'TVA 5,5 %', 'HT 2,1 %', 'TVA 2,1 %', 'Part hors TVA', 'Immo.', 'Justificatif']];
    sc.groups.forEach(g => {
      rows.push([], [g.title.toUpperCase() + ' · ' + C.TYPE_NOTE[g.type]]);
      const body = g.items.map(xlRow); body.forEach(r => rows.push(r));
      rows.push(['', '', 'Total ' + g.title.replace(/^./, c => c.toLowerCase())].concat(sumCols(body)));
    });
    if (!sc.groups.length) rows.push([], ['Aucune ligne sur ce compte.']);
    const ws = X.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 6 }, { wch: 11 }, { wch: 44 }, { wch: 12 }, { wch: 12 }, { wch: 11 }, { wch: 11 }, { wch: 11 }, { wch: 11 }, { wch: 11 }, { wch: 11 }, { wch: 11 }, { wch: 11 }, { wch: 13 }, { wch: 7 }, { wch: 38 }];
    Object.keys(ws).forEach(ad => { if (ad[0] === '!') return; const c = ws[ad]; if (c.t === 'n') { const d = X.utils.decode_cell(ad); if (d.c >= 3 && d.c <= 13) c.z = '#,##0.00'; } });
    X.utils.book_append_sheet(wb, ws, sc.bank.name.slice(0, 31));
  });
  return Buffer.from(X.write(wb, { bookType: 'xlsx', type: 'buffer' }));
}
module.exports = { buildXlsx };

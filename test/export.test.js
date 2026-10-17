'use strict';
const test = require('node:test');
const assert = require('node:assert');
const X = require('xlsx');
const { PDFDocument } = require('pdf-lib');
const C = require('../src/core/calc');
const { buildXlsx } = require('../src/core/export/xlsx');
const { buildPdf } = require('../src/core/export/pdf');

function sample() {
  const d = C.blankPeriod('archi', '2026-09');
  d.accounts = { cm: { open: 1000, close: 1000 + 120 - 54.4 }, sg: { open: 0, close: 0 } };
  const L = o => { const l = C.makeLine(o); d.lines.push(l); return l; };
  const a = L({ date: '2026-09-10', label: 'FACT SGT', bank: 'cm', debit: 27.16, hint: { tva: 1.68, rate: 20 } }); C.setType(a, 'dep');
  const b = L({ date: '2026-09-03', label: 'VIR CLIENT', bank: 'cm', credit: 120 }); C.setType(b, 'rec');
  const c = L({ date: '2026-09-16', label: 'URSSAF', bank: 'cm', debit: 27.24 }); C.setType(c, 'hors');
  a.doc = { name: 'a.pdf', rel: 'a' }; b.doc = { name: 'b.pdf', rel: 'b' };
  return { d, a, b };
}
const onePage = async n => { const x = await PDFDocument.create(); for (let i = 0; i < n; i++) x.addPage([595, 842]); return Buffer.from(await x.save()); };

test('Excel : résumé TVA et un onglet par compte, lignes classées', () => {
  const { d } = sample();
  const wb = X.read(buildXlsx('archi', '2026-09', d), { type: 'buffer' });
  assert.deepStrictEqual(wb.SheetNames, ['Résumé TVA', 'Crédit Mutuel', 'Société Générale']);
  const rows = X.utils.sheet_to_json(wb.Sheets['Crédit Mutuel'], { header: 1 });
  const titles = rows.filter(r => r.length === 1 && /^(DÉPENSES|RECETTES|HORS TVA|À CLASSER)/.test(r[0])).map(r => r[0]);
  assert.ok(titles[0].startsWith('DÉPENSES') && titles[1].startsWith('RECETTES') && titles[2].startsWith('HORS TVA'), titles.join(' | '));
  const sum = X.utils.sheet_to_json(wb.Sheets['Résumé TVA'], { header: 1 });
  const td = sum.find(r => r[0] === 'TD'); assert.strictEqual(td[3], 20 - 2);
});

test('PDF : justificatifs numérotés dans l\'ordre, pièces manquantes sur la page de garde', async () => {
  const { d, a } = sample();
  const docs = { [d.lines.find(l => l.label === 'FACT SGT').id]: await onePage(2), [d.lines.find(l => l.label === 'VIR CLIENT').id]: await onePage(1) };
  const pdf = await buildPdf('archi', '2026-09', d, async l => docs[l.id] || null);
  const out = await PDFDocument.load(pdf);
  assert.strictEqual(out.getPageCount(), 1 + 1 + 2 + 1);
  assert.strictEqual(await buildPdf('archi', '2026-09', C.blankPeriod('archi', '2026-09'), async () => null), null);
  assert.ok(a);
});

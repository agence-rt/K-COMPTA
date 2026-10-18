'use strict';
const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { make } = require('./helpers/synth');
const { makeInvoice } = require('./helpers/invoice');
const { Store } = require('../src/main/store');
const { analyseInvoice } = require('../src/core/parse/invoice');
const C = require('../src/core/calc');
const F = require('./fixtures/septembre-2026.json');

test('lecture d\'une facture : émetteur, date, HT, TVA, TTC', async () => {
  const a = await analyseInvoice(await makeInvoice(['ADOBE SYSTEMS SOFTWARE IRELAND', 'Facture n° 123', 'Date : 29/09/2026', 'Total HT 261,96 EUR', 'TVA 20,00 % 52,39 EUR', 'Total TTC 314,35 EUR']));
  assert.strictEqual(a.total, 314.35); assert.strictEqual(a.ht, 261.96); assert.deepStrictEqual(a.tva, [{ rate: 20, amount: 52.39 }]);
  assert.strictEqual(a.date, '2026-09-29'); assert.match(a.issuer, /ADOBE/);
});

test('A-TRAITER : relevés puis factures, rapprochement automatique, codes, renommage', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agoa-')), st = new Store(root); st.ensure();
  const inbox = st.inboxDir(), w = (n, b) => fs.writeFileSync(path.join(inbox, n), b);
  w('Extrait de comptes Compte 07391 Eurocompte PRO Confort SARL THOMAS KOCHANSKI ARCHITECTE au 2026-09-30.pdf', await make('cm', { lines: F.CM, meta: F.meta.CM }));
  w('releve_THOMAS_KOCHANSKI_ARCHITECTE_00028011512_30092026.pdf', await make('sg', { lines: F.SG, meta: F.meta.SG }));
  w('adobe.pdf', await makeInvoice(['ADOBE SYSTEMS SOFTWARE IRELAND', 'Date : 29/09/2026', 'Total HT 261,96 EUR', 'TVA 20,00 % 52,39 EUR', 'Total TTC 314,35 EUR']));
  w('vistaprint.pdf', await makeInvoice(['VISTAPRINT', 'Date : 17/09/2026', 'Total HT 27,50 EUR', 'TVA 20,00 % 5,50 EUR', 'Total TTC 33,00 EUR']));      // ligne à 31,73 : montant erroné
  w('inconnu.pdf', await makeInvoice(['PLOMBERIE DUPONT', 'Date : 02/09/2026', 'Total TTC 999,99 EUR']));                                              // aucune ligne
  const rep = await st.importInbox();
  const byFile = n => rep.find(r => r.file === n);
  assert.ok(byFile('adobe.pdf').ok && !byFile('adobe.pdf').matched.mismatch);
  assert.ok(byFile('vistaprint.pdf').ok && byFile('vistaprint.pdf').matched.mismatch);
  assert.strictEqual(byFile('inconnu.pdf').ok, false);
  const d = st.load('archi', '2026-09');
  const ad = d.lines.find(l => l.label.includes('ADOBE'));
  assert.match(ad.code, /^2026-09-CM-\d+$/); assert.strictEqual(ad.doc.name, ad.code + '.pdf'); assert.strictEqual(ad.type, 'dep');
  assert.deepStrictEqual(ad.vent, [{ rate: 20, ht: 261.96, tva: null }]);
  assert.strictEqual(C.lineState(ad).t, 'Ventilée');
  assert.ok(fs.existsSync(st.absPath('archi', '2026-09', ad.doc.rel)));
  const vp = d.lines.find(l => l.label.includes('VISTAPRINT'));
  const s = C.lineState(vp); assert.strictEqual(s.t, 'À vérifier'); assert.match(s.why, /33,00/);
  assert.deepStrictEqual(fs.readdirSync(inbox), ['inconnu.pdf']);                 // les PDF rapprochés quittent A-TRAITER
  // codes uniques, sans doublon
  const codes = d.lines.map(l => l.code); assert.strictEqual(new Set(codes).size, codes.length);
  assert.strictEqual(codes.filter(c => c.startsWith('2026-09-SG-')).length, 3);
  // ligne sans justificatif : à vérifier (rouge) une fois classée
  const o = d.lines.find(l => l.label.includes('ORANGE')); C.setType(o, 'dep'); assert.strictEqual(C.lineState(o).t, 'À vérifier');
});

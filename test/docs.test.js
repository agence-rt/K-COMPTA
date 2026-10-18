'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { Store } = require('../src/main/store');
const { makeInvoice } = require('./helpers/invoice');
const C = require('../src/core/calc');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agoa-'));
async function setup() {
  const root = tmp(), st = new Store(root); st.ensure();
  const d = C.blankPeriod('archi', '2026-09');
  const a = C.makeLine({ date: '2026-09-10', label: 'FACT A', bank: 'cm', debit: 120 }); C.setType(a, 'dep');
  const b = C.makeLine({ date: '2026-09-11', label: 'FACT B', bank: 'cm', debit: 60 }); C.setType(b, 'dep');
  d.lines.push(a, b); C.assignCodes(d); st.save('archi', '2026-09', d);
  const src = path.join(root, 'in1.pdf'); fs.writeFileSync(src, await makeInvoice(['ACME SAS', 'Total TTC 120,00 EUR']));
  const src2 = path.join(root, 'in2.pdf'); fs.writeFileSync(src2, await makeInvoice(['AUTRE SARL', 'Total TTC 99,00 EUR']));
  return { root, st, d, a, b, src, src2, jdir: path.join(st.periodDir('archi', '2026-09'), 'justificatifs'), cdir: path.join(st.periodDir('archi', '2026-09'), 'corbeille') };
}

test('remplacer un justificatif : l\'ancien PDF quitte le dossier, le nouveau reprend le nom du code', async () => {
  const { st, a, src, src2, jdir, cdir } = await setup();
  a.doc = await st.attachDoc('archi', '2026-09', a, src);
  assert.deepStrictEqual(fs.readdirSync(jdir), [a.code + '.pdf']);
  const nd = await st.attachDoc('archi', '2026-09', a, src2, { replace: a.doc.rel });
  assert.strictEqual(nd.name, a.code + '.pdf');                       // pas de -2 : l'ancien fichier est parti
  assert.deepStrictEqual(fs.readdirSync(jdir), [a.code + '.pdf']);
  assert.strictEqual(fs.readdirSync(cdir).length, 1);                 // l'ancien est récupérable dans corbeille
  assert.strictEqual(nd.total, 99);                                   // le contenu est bien le nouveau
});

test('supprimer un justificatif : le fichier est retiré du dossier justificatifs', async () => {
  const { st, a, src, jdir, cdir } = await setup();
  a.doc = await st.attachDoc('archi', '2026-09', a, src);
  assert.ok(st.trashDoc('archi', '2026-09', a.doc.rel));
  assert.deepStrictEqual(fs.readdirSync(jdir), []); assert.strictEqual(fs.readdirSync(cdir).length, 1);
  assert.strictEqual(st.trashDoc('archi', '2026-09', a.doc.rel), null);   // déjà parti : sans erreur
  assert.throws(() => st.trashDoc('archi', '2026-09', '../../periode.compta'), /refusé/);
});

test('nettoyage : renomme d\'après le code, range les PDF orphelins, signale les fichiers absents et partagés', async () => {
  const { st, d, a, b, src, src2, jdir, cdir } = await setup();
  const da = await st.attachDoc('archi', '2026-09', a, src); da.name = 'facture-acme.pdf';
  fs.renameSync(path.join(jdir, a.code + '.pdf'), path.join(jdir, 'facture-acme.pdf')); da.rel = path.join('justificatifs', 'facture-acme.pdf'); da.total = null;
  a.doc = da;
  b.doc = { name: 'fantome.pdf', rel: path.join('justificatifs', 'fantome.pdf'), total: null };
  fs.writeFileSync(path.join(jdir, 'orphelin.pdf'), fs.readFileSync(src2));
  st.save('archi', '2026-09', d);
  const rep = await st.auditDocs('archi', '2026-09');
  assert.deepStrictEqual(rep.renamed, [{ from: 'facture-acme.pdf', to: a.code + '.pdf' }]);
  assert.deepStrictEqual(rep.trashed, ['orphelin.pdf']);
  assert.strictEqual(rep.missing.length, 1); assert.strictEqual(rep.missing[0].code, b.code);
  assert.deepStrictEqual(fs.readdirSync(jdir), [a.code + '.pdf']);
  assert.strictEqual(fs.readdirSync(cdir).length, 1);
  const after = st.load('archi', '2026-09').lines.find(l => l.id === a.id);
  assert.strictEqual(after.doc.name, a.code + '.pdf'); assert.strictEqual(after.doc.total, 120); assert.strictEqual(after.doc.issuer, 'ACME SAS');
  // deuxième passage : plus rien à faire
  const again = await st.auditDocs('archi', '2026-09');
  assert.deepStrictEqual([again.renamed.length, again.trashed.length, again.refreshed], [0, 0, 0]);
  // un fichier partagé par deux lignes est signalé, pas touché
  const l2 = st.load('archi', '2026-09'); const x = l2.lines.find(l => l.id === b.id); x.doc = Object.assign({}, l2.lines.find(l => l.id === a.id).doc); st.save('archi', '2026-09', l2);
  const sh = await st.auditDocs('archi', '2026-09'); assert.strictEqual(sh.shared.length, 1); assert.ok(fs.existsSync(path.join(jdir, a.code + '.pdf')));
});

'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { make } = require('./helpers/synth');
const { Store } = require('../src/main/store');
const { splitByPeriod, mergePart } = require('../src/core/import');
const C = require('../src/core/calc');
const F = require('./fixtures/septembre-2026.json');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agoa-'));

test('dépôt de deux relevés dans A-TRAITER : lignes, soldes, rangement', async () => {
  const root = tmp(), st = new Store(root); st.ensure();
  fs.writeFileSync(path.join(st.inboxDir(), 'Extrait de comptes Compte 07391 Eurocompte PRO Confort SARL THOMAS KOCHANSKI ARCHITECTE au 2026-09-30.pdf'), await make('cm', { lines: F.CM, meta: F.meta.CM }));
  fs.writeFileSync(path.join(st.inboxDir(), 'releve_THOMAS_KOCHANSKI_ARCHITECTE_00028011512_30092026.pdf'), await make('sg', { lines: F.SG, meta: F.meta.SG }));
  const rep = await st.importInbox();
  assert.strictEqual(rep.length, 2);
  rep.forEach(r => { assert.ok(r.ok, JSON.stringify(r)); assert.deepStrictEqual(r.issues, []); assert.ok(r.moved); });
  assert.deepStrictEqual(st.listInbox(), []);
  const d = st.load('archi', '2026-09');
  assert.strictEqual(d.lines.length, 50);
  assert.strictEqual(d.statements.length, 2);
  assert.deepStrictEqual([d.accounts.cm.open, d.accounts.cm.close, d.accounts.cm.td, d.accounts.cm.tc], [38544.17, 90802.51, 27318.66, 79577]);
  assert.deepStrictEqual([d.accounts.sg.open, d.accounts.sg.close], [79970.69, 76312.92]);
  assert.strictEqual(C.acct(d, 'cm').ecart, 0);
  assert.strictEqual(C.acct(d, 'sg').ecart, 0);
  assert.ok(fs.existsSync(path.join(root, 'AGOA-COMPTA', 'ARCHI PRO', '2026', '09', 'releves')));
  assert.strictEqual(fs.readdirSync(path.join(root, 'AGOA-COMPTA', 'ARCHI PRO', '2026', '09', 'releves')).length, 2);
});

test('un relevé redéposé n\'est pas compté deux fois', async () => {
  const root = tmp(), st = new Store(root); st.ensure();
  const f = path.join(st.inboxDir(), 'releve_THOMAS_KOCHANSKI_ARCHITECTE_00028011512_30092026.pdf');
  const pdf = await make('sg', { lines: F.SG, meta: F.meta.SG });
  fs.writeFileSync(f, pdf); await st.importInbox();
  fs.writeFileSync(f, pdf); const rep = await st.importInbox();
  assert.strictEqual(rep[0].parts[0].added, false);
  assert.strictEqual(st.load('archi', '2026-09').lines.length, 3);
});

test('classement et ventilation conservés après enregistrement', async () => {
  const root = tmp(), st = new Store(root);
  const d = C.blankPeriod('archi', '2026-09');
  const l = C.makeLine({ date: '2026-09-10', label: 'FACT SGT', bank: 'cm', debit: 27.16, hint: { tva: 1.68, rate: 20 } });
  d.lines.push(l); C.setType(l, 'dep');
  st.save('archi', '2026-09', d);
  const back = st.load('archi', '2026-09');
  assert.deepStrictEqual(back.lines[0].vent, [{ rate: 20, ht: 8.4, tva: 1.68 }]);
  assert.strictEqual(C.totals(back).D.L20, 2);
});

test('justificatif rangé sous le code de la ligne', async () => {
  const root = tmp(), st = new Store(root), src = path.join(root, 'facture.pdf');
  fs.writeFileSync(src, '%PDF-1.4');
  const l = C.makeLine({ date: '2026-09-10', label: 'PAIEMENT CB ADOBE', bank: 'cm' });
  const d = C.blankPeriod('archi', '2026-09'); d.lines.push(l); C.assignCodes(d);
  assert.strictEqual(l.code, '2026-09-CM-1');
  const a = await st.attachDoc('archi', '2026-09', l, src), b = await st.attachDoc('archi', '2026-09', l, src);
  assert.strictEqual(a.name, '2026-09-CM-1.pdf');
  assert.strictEqual(b.name, '2026-09-CM-1-2.pdf');
  assert.ok(fs.existsSync(st.absPath('archi', '2026-09', a.rel)));
  assert.throws(() => st.absPath('archi', '2026-09', '../../x'));
});

test('relevé à cheval sur deux mois : traité mois par mois', () => {
  const parsed = { soc: 'archi', bank: 'cm', account: '1', opening: { v: 1000 }, closing: { v: 1150 }, totals: { debit: 150, credit: 300 },
    lines: [{ date: '2026-09-28', label: 'A', debit: 100, credit: 0 }, { date: '2026-09-29', label: 'B', debit: 0, credit: 200 }, { date: '2026-10-02', label: 'C', debit: 50, credit: 100 }] };
  const parts = splitByPeriod(parsed);
  assert.deepStrictEqual(parts.map(p => [p.period, p.open, p.close]), [['2026-09', 1000, 1100], ['2026-10', 1100, 1150]]);
  const sep = C.blankPeriod('archi', '2026-09'); mergePart(sep, parsed, parts[0], { name: 'x.pdf' });
  assert.strictEqual(C.acct(sep, 'cm').ecart, 0);
  const oct = C.blankPeriod('archi', '2026-10'); mergePart(oct, parsed, parts[1], { name: 'x.pdf' });
  assert.strictEqual(C.acct(oct, 'cm').ecart, 0);
});

test('trimestre FAURIEL49 : trois relevés mensuels', async () => {
  const mk = (day, amount, dir, label) => ({ day, label, amount, dir, hint: null });
  const part = (open, lines, close, td, tc) => ({ opening: { v: open }, closing: { v: close }, totals: { debit: td, credit: tc }, lines });
  const root = tmp(), st = new Store(root);
  const base = { soc: 'sci', bank: 'sg', account: '1' };
  const d = C.blankPeriod('sci', 'T3-2026');
  [['2026-07-05', 100, 1000, 900, 'j'], ['2026-08-05', 50, 900, 850, 'a'], ['2026-09-05', 20, 850, 830, 's']].forEach(([date, amt, o, c, nm]) => {
    const p = Object.assign({}, base, { opening: { v: o }, closing: { v: c }, totals: { debit: amt, credit: 0 }, lines: [{ date, label: 'L', debit: amt, credit: 0 }] });
    mergePart(d, p, splitByPeriod(p)[0], { name: nm + '.pdf' });
  });
  assert.deepStrictEqual([d.accounts.sg.open, d.accounts.sg.close], [1000, 830]);
  assert.strictEqual(C.acct(d, 'sg').ecart, 0);
  assert.strictEqual(C.periodIdOf('sci', '2026-08-05'), 'T3-2026');
});

test('fichier .compta : enregistrement, relecture, ancien format, fichier étranger', () => {
  const { readComptaFile } = require('../src/main/store');
  const root = tmp(), st = new Store(root), d = C.blankPeriod('archi', '2026-09'); d.report = 12.5;
  st.save('archi', '2026-09', d);
  const f = path.join(st.periodDir('archi', '2026-09'), 'periode.compta');
  assert.ok(fs.existsSync(f));
  assert.deepStrictEqual(readComptaFile(f), { soc: 'archi', period: '2026-09' });
  assert.strictEqual(st.load('archi', '2026-09').report, 12.5);
  fs.writeFileSync(path.join(tmp(), 'x.compta'), '{"app":"autre"}');
  assert.throws(() => readComptaFile(path.join(path.dirname(f), 'releves-absent.compta')));
  const bad = path.join(tmp(), 'x.compta'); fs.writeFileSync(bad, '{"app":"autre"}'); assert.throws(() => readComptaFile(bad));
  fs.unlinkSync(f); fs.writeFileSync(path.join(path.dirname(f), 'periode.json'), JSON.stringify(Object.assign(C.blankPeriod('archi', '2026-09'), { report: 7 })));
  assert.strictEqual(st.load('archi', '2026-09').report, 7);
});

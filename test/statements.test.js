'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { make } = require('./helpers/synth');
const { parseStatement } = require('../src/core/parse/statements');
const F = require('./fixtures/septembre-2026.json');

for (const [kind, key, file] of [['cm', 'CM', 'Extrait de comptes Compte 07391 Eurocompte PRO Confort SARL THOMAS KOCHANSKI ARCHITECTE au 2026-09-30.pdf'], ['sg', 'SG', 'releve_THOMAS_KOCHANSKI_ARCHITECTE_00028011512_30092026.pdf']]) {
  test('relevé ' + key + ' : lignes, sens, totaux et soldes', async () => {
    const pdf = await make(kind, { lines: F[key], meta: F.meta[key] });
    const r = await parseStatement(pdf, file);
    assert.deepStrictEqual(r.issues, [], 'aucune anomalie : ' + r.issues.join(' | '));
    assert.strictEqual(r.bank, kind);
    assert.strictEqual(r.soc, 'archi');
    assert.strictEqual(r.lines.length, F[key].length);
    r.lines.forEach((l, i) => {
      const e = F[key][i];
      assert.strictEqual(l.date, '2026-09-' + String(e.day).padStart(2, '0'), 'date ligne ' + i);
      assert.strictEqual(e.dir === 'D' ? l.debit : l.credit, Number(e.amount), 'montant ligne ' + i + ' ' + e.label);
      assert.strictEqual(e.dir === 'D' ? l.credit : l.debit, 0, 'sens ligne ' + i);
    });
    assert.strictEqual(r.opening.v, Number(F.meta[key].open));
    assert.strictEqual(r.closing.v, Number(F.meta[key].close));
    assert.strictEqual(r.check.balanceOk, true);
  });
}

test('indications de TVA lues sur le relevé', async () => {
  const cm = await parseStatement(await make('cm', { lines: F.CM, meta: F.meta.CM }), 'cm.pdf');
  const withHint = cm.lines.filter(l => l.hint);
  assert.deepStrictEqual(withHint.map(l => [l.hint.rate, l.hint.tva ?? null]), [[20, 1.68], [10, null], [20, null]]);
  const sg = await parseStatement(await make('sg', { lines: F.SG, meta: F.meta.SG }), 'sg.pdf');
  const j = sg.lines.find(l => l.hint);
  assert.deepStrictEqual([j.hint.ht, j.hint.tva, j.hint.rate], [11.61, 2.32, 20]);
});

test('libellés lisibles', async () => {
  const cm = await parseStatement(await make('cm', { lines: F.CM, meta: F.meta.CM }), 'cm.pdf');
  assert.ok(cm.lines.some(l => l.label === 'PAIEMENT CB GOOGLE CLOUD V6Z'), cm.lines.map(l => l.label).join('\n'));
  const sg = await parseStatement(await make('sg', { lines: F.SG, meta: F.meta.SG }), 'sg.pdf');
  assert.ok(sg.lines[0].label.includes('MRPRO SOGESSUR'), sg.lines[0].label);
  assert.ok(sg.lines[1].label.startsWith('VIR PERM'), sg.lines[1].label);
});

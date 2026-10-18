const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { writeAtomic } = require('../src/main/store');

test('writeAtomic : écrit le fichier et ne laisse pas de .tmp', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'agoa-')), f = path.join(d, 'a', 'periode.compta');
  writeAtomic(f, 'un'); writeAtomic(f, 'deux');
  assert.equal(fs.readFileSync(f, 'utf8'), 'deux'); assert.ok(!fs.existsSync(f + '.tmp'));
});

test('writeAtomic : renommage refusé (EPERM de Dropbox) → réessai puis écriture directe', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'agoa-')), f = path.join(d, 'periode.compta');
  fs.writeFileSync(f, 'ancien');
  const real = fs.renameSync; let n = 0;
  fs.renameSync = () => { n++; const e = new Error('EPERM: operation not permitted, rename'); e.code = 'EPERM'; throw e; };
  try { writeAtomic(f, 'nouveau'); } finally { fs.renameSync = real; }
  assert.ok(n > 1, 'le renommage doit être réessayé');
  assert.equal(fs.readFileSync(f, 'utf8'), 'nouveau'); assert.ok(!fs.existsSync(f + '.tmp'));
});

test('writeAtomic : un EPERM passager sur le renommage est absorbé', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'agoa-')), f = path.join(d, 'p.compta');
  const real = fs.renameSync; let n = 0;
  fs.renameSync = (a, b) => { if (n++ < 2) { const e = new Error('EPERM'); e.code = 'EPERM'; throw e; } return real(a, b); };
  try { writeAtomic(f, 'ok'); } finally { fs.renameSync = real; }
  assert.equal(fs.readFileSync(f, 'utf8'), 'ok');
});

test('sauvegardes de secours : au plus 10 conservées, espacées dans le temps', () => {
  const { Store } = require('../src/main/store'), C = require('../src/core/calc');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agoa-bk-')); Store.backupEvery = 0;
  try {
    const s = new Store(root), d = C.blankPeriod('archi', '2026-09');
    for (let i = 0; i < 15; i++) { d.note = 'v' + i; s.save('archi', '2026-09', d); }
    const b = s.listBackups('archi', '2026-09');
    assert.equal(b.length, 10);
    const newest = JSON.parse(fs.readFileSync(path.join(s.periodDir('archi', '2026-09'), 'backups', b[0]), 'utf8'));
    assert.equal(newest.data.note, 'v13');                       // le dernier backup est l'état juste avant la dernière écriture
    Store.backupEvery = 60000; Store.lastBackup = {};
    const t = new Store(root); t.save('archi', '2026-09', d); t.save('archi', '2026-09', d); t.save('archi', '2026-09', d);
    assert.equal(t.listBackups('archi', '2026-09').length, 10);   // 1 seul nouveau backup pour 3 enregistrements rapprochés (rotation)
    const dest = path.join(root, 'copie.compta'); t.exportCompta('archi', '2026-09', dest);
    assert.equal(JSON.parse(fs.readFileSync(dest, 'utf8')).app, 'AGOA-COMPTA');
  } finally { Store.backupEvery = 5 * 60 * 1000; Store.lastBackup = {}; }
});

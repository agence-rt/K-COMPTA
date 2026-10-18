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

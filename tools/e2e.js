/* Test de bout en bout de l'interface : Chromium + vrai moteur (Store, exports) derrière un faux window.agoa. */
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs'), os = require('os'), path = require('path');
const { make } = require('../test/helpers/synth');
const F = require('../test/fixtures/septembre-2026.json');
const { createApi } = require('../src/main/api');
const { Config } = require('../src/main/config');
const { Auth } = require('../src/main/auth');
const { Store } = require('../src/main/store');
const assert = require('assert');

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-'));
  const root = path.join(tmp, '003-COMPTABILITE'); fs.mkdirSync(root);
  const st = new Store(root); st.ensure();
  fs.writeFileSync(path.join(st.inboxDir(), 'Extrait de comptes Compte 07391 Eurocompte PRO Confort SARL THOMAS KOCHANSKI ARCHITECTE au 2026-09-30.pdf'), await make('cm', { lines: F.CM, meta: F.meta.CM }));
  fs.writeFileSync(path.join(st.inboxDir(), 'releve_THOMAS_KOCHANSKI_ARCHITECTE_00028011512_30092026.pdf'), await make('sg', { lines: F.SG, meta: F.meta.SG }));
  const just = path.join(tmp, 'facture.pdf'); fs.writeFileSync(just, await make('sg', { lines: [], meta: F.meta.SG }).catch(() => Buffer.from('%PDF-1.4')));
  const config = new Config(path.join(tmp, 'config.json')); config.set({ root, google: { clientId: 'cid' } });
  const auth = new Auth({ getConfig: () => config.get(), openExternal: async () => {} });
  auth.login = async () => { auth.session = { user: { email: 'agence@remithollet.fr', name: 'Agence' } }; return auth.current(); };   // le vrai flux est testé dans auth.test.js
  const api = createApi({ config, auth, version: 'test', openPath: async () => {}, dialogs: { folder: async () => root, files: async (t) => [just] } });

  const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
  const page = await br.newPage({ viewport: { width: 1320, height: 860 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.exposeFunction('__call', async (ch, args) => { try { return { v: await api[ch](...args) }; } catch (e) { return { e: e.message }; } });
  await page.addInitScript(() => {
    const c = ch => async (...a) => { const r = await window.__call(ch, a); if (r.e) throw new Error(r.e); return r.v; };
    window.agoa = { openFile: { pending: c('app:pendingOpen'), onOpen: () => {} },
      cfg: { get: c('cfg:get'), chooseRoot: c('cfg:chooseRoot') },
      auth: { session: c('auth:session'), login: c('auth:login'), logout: c('auth:logout') },
      period: { load: c('period:load'), save: c('period:save'), saveSync: () => true },
      inbox: { list: c('inbox:list'), importAll: c('inbox:importAll') }, statement: { pick: c('statement:pick') },
      doc: { pick: c('doc:pick'), open: c('doc:open'), read: async (...a) => { const r = await window.__call('doc:read', a); if (r.e) throw new Error(r.e); return new Uint8Array(Object.values(r.v.data || r.v)); } }, folder: { open: c('folder:open') }, export: { run: c('export:run') } };
  });
  await page.goto('file://' + path.resolve(__dirname, '../src/renderer/index.html'));
  const shot = n => page.screenshot({ path: path.join(process.env.SHOTS || tmp, n + '.png') });

  await page.waitForSelector('text=Continuer avec Google'); await shot('1-gate');
  assert.ok(!(await page.content()).includes('mode local'));
  await page.click('[data-act=login]');
  await page.waitForSelector('.mhead');
  // période : septembre 2026
  await page.selectOption('[data-f=year]', '2026'); await page.selectOption('[data-f=period]', '2026-09');
  await page.click('[data-act=scaninbox]');
  await page.waitForSelector('tr.row', { timeout: 20000 });
  const n = await page.locator('tr.row').count(); console.log('lignes affichées', n); assert.strictEqual(n, 50);
  console.log('chips:', (await page.textContent('#chips')).replace(/\s+/g, ' '));
  assert.ok(/2\/2 concordants/.test(await page.textContent('#chips')));
  await shot('2-lignes');
  // classer une ligne en dépense, ajouter un justificatif
  const row = page.locator('tr.row', { has: page.locator('input[value="PAIEMENT CB ADOBE"]') }).first();
  await row.locator('[data-act=type][data-v=dep]').click();
  await row.locator('select.rate').selectOption('10');
  await row.locator('[data-act=expand]').click(); await page.locator('[data-f=vht]').first().fill('100'); await page.locator('[data-f=vht]').first().dispatchEvent('change');
  await shot('2b-ventilation');
  await row.locator('[data-act=adddoc]').click();
  await page.waitForSelector('.chip .fn');
  await page.waitForSelector('#viewer:not([hidden])'); assert.ok((await page.getAttribute('#vframe','src')).startsWith('blob:')); assert.ok(await page.locator('body.viewer-open').count());
  await page.waitForTimeout(500); await page.evaluate(() => window.scrollTo(0, 0)); await page.locator('tr.row.viewing').scrollIntoViewIfNeeded(); await shot('2c-panneau');
  await page.click('[data-act=tab][data-v=syn]'); console.log('synthèse:', (await page.textContent('.result')).replace(/\s+/g, ' ').slice(0, 160)); await shot('3-synthese');
  await page.click('[data-act=tab][data-v=exp]');
  await page.click('[data-act=exp-all]'); await page.waitForSelector('#expout li');
  console.log('exports:', (await page.textContent('#expout')).replace(/\s+/g, ' ')); await shot('4-export');
  await page.click('[data-act=tab][data-v=doc]'); await page.click('[data-act=tab][data-v=set]'); await shot('5-reglages');
  await page.waitForTimeout(1200);                                             // enregistrement automatique
  const d = st.load('archi', '2026-09'); const l = d.lines.find(x => x.label.includes('ADOBE'));
  console.log('ligne ADOBE enregistrée:', l.type, !!l.doc, l.vent.length);
  assert.strictEqual(l.type, 'dep'); assert.ok(l.doc); assert.strictEqual(l.vent[0].rate, 10); assert.strictEqual(l.vent[0].ht, 100);
  assert.ok(fs.existsSync(path.join(st.periodDir('archi', '2026-09'), 'periode.compta')));
  const ex = fs.readdirSync(path.join(st.periodDir('archi', '2026-09'), 'exports')); console.log(ex); assert.strictEqual(ex.length, 2);
  // rechargement : l'état revient du disque
  await page.reload(); await page.waitForSelector('tr.row'); assert.strictEqual(await page.locator('tr.row').count(), 50); assert.ok(await page.locator('.chip .fn').count() === 1);
  console.log('erreurs page:', errs); assert.deepStrictEqual(errs, []);
  await br.close(); console.log('E2E OK');
})().catch(e => { console.error('E2E KO', e); process.exit(1); });

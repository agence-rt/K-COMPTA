/* Test de bout en bout de l'interface : Chromium + vrai moteur (Store, exports) derrière un faux window.agoa. */
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs'), os = require('os'), path = require('path');
const { make } = require('../test/helpers/synth');
const { makeInvoice } = require('../test/helpers/invoice');
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
  fs.writeFileSync(path.join(st.inboxDir(), 'vistaprint.pdf'), await makeInvoice(['VISTAPRINT', 'Date : 17/09/2026', 'Total HT 27,50 EUR', 'TVA 20,00 % 5,50 EUR', 'Total TTC 33,00 EUR']));
  fs.writeFileSync(path.join(st.inboxDir(), 'free.pdf'), await makeInvoice(['FREE MOBILE', 'Date : 09/09/2026', 'Total HT 1,67 EUR', 'TVA 20,00 % 0,33 EUR', 'Total TTC 2,00 EUR']));
  const just = path.join(tmp, 'facture.pdf'); fs.writeFileSync(just, await make('sg', { lines: [], meta: F.meta.SG }).catch(() => Buffer.from('%PDF-1.4')));
  const config = new Config(path.join(tmp, 'config.json')); config.set({ root, google: { clientId: 'cid' } });
  const auth = new Auth({ getConfig: () => config.get(), openExternal: async () => {} });
  auth.login = async () => { auth.session = { user: { email: 'agence@remithollet.fr', name: 'Agence' } }; return auth.current(); };   // le vrai flux est testé dans auth.test.js
  const api = createApi({ config, auth, version: '0.1.99', openPath: async () => {}, dialogs: { save: async (t, n) => path.join(root, 'sortie-' + n), folder: async () => root, files: async (t) => [just] } });

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
      doc: { remove: c('doc:remove'), audit: c('doc:audit'), pick: c('doc:pick'), open: c('doc:open'), read: async (...a) => { const r = await window.__call('doc:read', a); if (r.e) throw new Error(r.e); return new Uint8Array(Object.values(r.v.data || r.v)); } }, folder: { open: c('folder:open') }, file: { saveAs: c('file:saveAs'), backups: c('file:backups') }, export: { run: c('export:run') } };
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
  const vp = page.locator('tr.row', { has: page.locator('input[value="PAIEMENT CB VISTAPRINT"]') });
  assert.match(await vp.locator('td.codec').textContent(), /^2026-09-CM-\d+$/);
  assert.strictEqual((await vp.locator('[id^=st-]').textContent()).trim(), 'À vérifier'); assert.ok(await vp.locator('[id^=st-].bad').count());
  const fr = page.locator('tr.row', { has: page.locator('input[value="PRLV SEPA FREE MOBILE"]') });
  assert.strictEqual((await fr.locator('[id^=st-]').textContent()).trim(), 'TVA ok'); assert.ok((await fr.locator('.chip .fn').textContent()).includes('2026-09-CM-'));
  const ad0 = page.locator('tr.row', { has: page.locator('input[value="PAIEMENT CB ADOBE"]') });
  if ((await vp.locator('select.rate').inputValue()) === '') await vp.locator('select.rate').selectOption('20');
  assert.strictEqual((await vp.locator('[id^=st-]').textContent()).trim(), 'À vérifier');
  await vp.locator('[id^=st-]').click(); assert.strictEqual((await vp.locator('[id^=st-]').textContent()).trim(), 'Validée'); assert.ok(await vp.locator('[id^=st-].ok').count());
  await vp.locator('[id^=st-]').click(); assert.strictEqual((await vp.locator('[id^=st-]').textContent()).trim(), 'À vérifier');
  await vp.locator('[id^=st-]').click(); console.log('validation OK');
  console.log('rapprochements OK'); await shot('2a-rapprochement');
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
  // largeur du volet : glisser la poignée (même au-dessus du PDF), mémorisation, double-clic = défaut
  const vw = async () => Math.round((await page.locator('#viewer').boundingBox()).width);
  const w0 = await vw(), gb = await page.locator('#vgrip').boundingBox(), gx = gb.x + gb.width / 2, gy = gb.y + 200;
  await page.mouse.move(gx, gy); await page.mouse.down(); await page.mouse.move(gx - 120, gy, { steps: 6 }); await page.mouse.move(gx - 200, gy, { steps: 4 }); await page.mouse.up();
  await page.waitForTimeout(150); const w1 = await vw(); assert.ok(w1 > w0 + 150, 'élargi ' + w0 + ' → ' + w1);
  const gb2 = await page.locator('#vgrip').boundingBox(), x2 = gb2.x + gb2.width / 2;
  await page.mouse.move(x2, gy); await page.mouse.down(); await page.mouse.move(x2 + 150, gy, { steps: 8 }); await page.mouse.up();      // le pointeur passe au-dessus du PDF
  await page.waitForTimeout(150); const w2 = await vw(); assert.ok(w2 < w1 - 100, 'rétréci ' + w1 + ' → ' + w2);
  assert.ok(+(await page.evaluate(() => localStorage.getItem('agoa.vw'))) > 0);
  await page.click('#vsize'); await page.waitForTimeout(100); assert.notStrictEqual(await vw(), w2);
  await page.locator('#vgrip').dblclick(); await page.waitForTimeout(100); assert.ok(Math.abs((await vw()) - Math.round(1320 * .38)) < 6);
  console.log('largeur du volet OK', w0, w1, w2);
  // volet dépliable : replier, onglet visible, rouvrir, liste des justificatifs
  await page.click('#vclose'); assert.ok(await page.locator('#viewer[hidden]').count()); assert.ok(await page.locator('#vtab:not([hidden])').count());
  await page.click('#vtab'); await page.waitForSelector('#viewer:not([hidden])'); assert.ok((await page.locator('#vsel option').count()) >= 2);
  const firstCode = await page.locator('tr.row td.codec').first().textContent(); assert.match(firstCode, /^\d{4}-\d{2}-[A-Z]+-\d+$/);
  assert.equal(await page.locator('table.t thead th').first().textContent(), 'Code'); console.log('volet + colonne code OK');
  assert.match(await page.textContent('.tb .ver'), /v0\.1\.99/);
  assert.ok(await page.locator('select.bk-cm').count()); assert.ok(await page.locator('select.bk-sg').count());
  const col = async c => page.locator('select.bk-' + c).first().evaluate(e => getComputedStyle(e).color);
  assert.equal(await col('sg'), 'rgb(198, 40, 40)'); assert.equal(await col('cm'), 'rgb(21, 101, 192)');
  await page.click('[data-act=saveas]'); await page.waitForFunction(() => /Fichier enregistré/.test(document.querySelector('#toast').textContent));
  assert.ok(fs.readdirSync(root).some(n => /^sortie-.*\.compta$/.test(n))); console.log('version, couleurs, enregistrer sous OK');
  // retrait d'un justificatif : le fichier quitte le dossier justificatifs
  const jd = path.join(st.periodDir('archi', '2026-09'), 'justificatifs'), nBefore = fs.readdirSync(jd).length;
  const adobe = page.locator('tr.row', { has: page.locator('input[value="PAIEMENT CB ADOBE"]') });
  await adobe.locator('[data-act=rmdoc]').click(); await page.waitForTimeout(600);
  assert.strictEqual(fs.readdirSync(jd).length, nBefore - 1); assert.ok(fs.existsSync(path.join(st.periodDir('archi', '2026-09'), 'corbeille')));
  // remplacement : un nouveau PDF sur la ligne VISTAPRINT ne laisse qu'un fichier pour cette ligne
  const vpr = page.locator('tr.row', { has: page.locator('input[value="PAIEMENT CB VISTAPRINT"]') });
  const n2 = fs.readdirSync(jd).length; await vpr.locator('[data-act=adddoc]').first().click(); await page.waitForTimeout(800);
  assert.strictEqual(fs.readdirSync(jd).length, n2);
  // nettoyage / vérification
  await page.click('[data-act=tab][data-v=doc]'); await page.click('[data-act=auditdocs]'); await page.waitForSelector('#auditout .note');
  console.log('audit:', (await page.textContent('#auditout')).replace(/\s+/g, ' ').slice(0, 200)); await page.click('[data-act=tab][data-v=lines]');
  console.log('retrait / remplacement / nettoyage OK');
  // panneau PDF ouvert : le volet société / période / dossier surveillé reste accessible
  await page.waitForSelector('#viewer:not([hidden])');
  assert.ok(await page.locator('.side').isVisible()); assert.ok(await page.locator('.side [data-f=year]').isVisible()); assert.ok(await page.locator('.side #watchinfo').count());
  await page.locator('.ctx [data-act=soc][data-v=sci]').click(); await page.waitForSelector('.mhead h1:has-text("FAURIEL")');
  await page.locator('.ctx [data-f=period]').selectOption({ index: 1 }); await page.waitForSelector('.mhead p:has-text("2")');
  await page.locator('.ctx [data-act=soc][data-v=archi]').click(); await page.waitForSelector('.mhead h1:has-text("KOCHANSKI")');
  console.log('société / période / surveillance accessibles avec le panneau ouvert');
  await page.click('[data-act=tab][data-v=syn]'); console.log('synthèse:', (await page.textContent('.result')).replace(/\s+/g, ' ').slice(0, 160)); await shot('3-synthese');
  await page.click('[data-act=tab][data-v=exp]');
  await page.click('[data-act=exp-all]'); await page.waitForSelector('#expout li');
  console.log('exports:', (await page.textContent('#expout')).replace(/\s+/g, ' ')); await shot('4-export');
  await page.click('[data-act=tab][data-v=doc]'); await page.click('[data-act=tab][data-v=set]'); await shot('5-reglages');
  await page.waitForTimeout(1200);                                             // enregistrement automatique
  const d = st.load('archi', '2026-09'); const l = d.lines.find(x => x.label.includes('ADOBE'));
  console.log('ligne ADOBE enregistrée:', l.type, !!l.doc, l.vent.length);
  assert.strictEqual(l.type, 'dep'); assert.ok(!l.doc); assert.strictEqual(l.vent[0].rate, 10); assert.strictEqual(l.vent[0].ht, 100);
  assert.ok(fs.existsSync(path.join(st.periodDir('archi', '2026-09'), 'periode.compta')));
  const ex = fs.readdirSync(path.join(st.periodDir('archi', '2026-09'), 'exports')); console.log(ex); assert.strictEqual(ex.length, 3);
  // rechargement : l'état revient du disque
  await page.reload(); await page.waitForSelector('tr.row'); assert.strictEqual(await page.locator('tr.row').count(), 50); assert.strictEqual(await page.locator('.chip .fn').count(), 2);
  console.log('erreurs page:', errs); assert.deepStrictEqual(errs, []);
  await br.close(); console.log('E2E OK');
})().catch(e => { console.error('E2E KO', e); process.exit(1); });

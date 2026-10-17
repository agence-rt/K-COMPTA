'use strict';
const test = require('node:test'), assert = require('node:assert');
const http = require('http');
const { Auth, checkIdentity } = require('../src/main/auth');

const jwt = claims => 'x.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.y';

test('identité : domaine imposé', () => {
  assert.equal(checkIdentity({ email: 'agence@remithollet.fr', email_verified: true }, 'agence@remithollet.fr').ok, true);
  const r = checkIdentity({ email: 'autre@remithollet.fr' }, 'agence@remithollet.fr'); assert.equal(r.ok, false); assert.equal(r.denied, true);
  assert.equal(checkIdentity({ email: 'agence@remithollet.fr.evil.com' }, 'agence@remithollet.fr').ok, false);
});

async function run(claims, status = 200) {
  const tokSrv = http.createServer((req, res) => { let b = ''; req.on('data', d => b += d); req.on('end', () => {
    tokSrv.body = new URLSearchParams(b); res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status === 200 ? { id_token: jwt(claims) } : { error: 'invalid_grant', error_description: 'refus' })); }); });
  await new Promise(r => tokSrv.listen(0, '127.0.0.1', r));
  const auth = new Auth({
    getConfig: () => ({ google: { clientId: 'cid', clientSecret: 'sec', allowedEmail: 'agence@remithollet.fr' } }),
    endpoints: { token: 'http://127.0.0.1:' + tokSrv.address().port + '/token' },
    openExternal: async url => { const u = new URL(url); assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
      const cb = new URL(u.searchParams.get('redirect_uri')); cb.searchParams.set('code', 'CODE'); cb.searchParams.set('state', u.searchParams.get('state'));
      http.get(cb.toString(), r => r.resume()); },
    timeoutMs: 5000 });
  const r = await auth.login(); tokSrv.close(); return { r, auth, body: tokSrv.body };
}

test('connexion Google réussie (serveur de jetons simulé, PKCE)', async () => {
  const { r, auth, body } = await run({ email: 'agence@remithollet.fr', name: 'Agence', email_verified: true });
  assert.equal(r.ok, true); assert.equal(r.user.email, 'agence@remithollet.fr');
  assert.equal(body.get('code'), 'CODE'); assert.ok(body.get('code_verifier').length >= 43); assert.equal(body.get('client_secret'), 'sec');
  assert.equal(auth.current().ok, true); auth.logout(); assert.equal(auth.current().ok, false);
});
test('compte hors domaine refusé', async () => {
  const { r, auth } = await run({ email: 'collegue@remithollet.fr', email_verified: true });
  assert.equal(r.ok, false); assert.equal(r.denied, true); assert.equal(auth.current().ok, false);
});
test('refus de Google', async () => { const { r } = await run({}, 400); assert.equal(r.ok, false); });
test('pas de contournement : aucune méthode locale', () => { assert.equal(typeof new Auth({ getConfig: () => ({}) }).local, 'undefined'); });
test('connexion désactivée : accès direct', () => { const a = new Auth({ required: false, getConfig: () => ({}) }); assert.equal(a.current().ok, true); a.logout(); assert.equal(a.current().ok, true); });

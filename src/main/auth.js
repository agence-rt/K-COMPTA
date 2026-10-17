/* Connexion Google (OAuth 2.0 pour application de bureau : navigateur système + retour sur 127.0.0.1 + PKCE).
   Obligatoire à chaque lancement : seul le compte autorisé (agence@remithollet.fr) donne accès au logiciel. */
'use strict';
const http = require('http');
const crypto = require('crypto');

const b64u = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

function decodeJwt(t) {
  try { return JSON.parse(Buffer.from(String(t).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); } catch (e) { return null; }
}

/** Vérifie qu'une identité Google est celle du compte autorisé (adresse exacte). */
function checkIdentity(claims, allowed) {
  if (!claims || !claims.email) return { ok: false, message: 'Identité Google illisible.' };
  const email = String(claims.email).toLowerCase(), want = String(allowed || '').toLowerCase();
  if (claims.email_verified === false) return { ok: false, denied: true, message: 'Adresse e-mail non vérifiée par Google.' };
  if (!want || email !== want) return { ok: false, denied: true, message: 'Le compte ' + email + ' n\'est pas autorisé. Connectez-vous avec ' + want + '.' };
  return { ok: true, user: { email, name: claims.name || email, picture: claims.picture || null } };
}

class Auth {
  /** opts: {getConfig, openExternal, fetch, endpoints:{auth,token}, timeoutMs} — injectables pour les tests. */
  constructor(opts) {
    this.getConfig = opts.getConfig;
    this.openExternal = opts.openExternal;
    this.fetch = opts.fetch || globalThis.fetch;
    this.auth = (opts.endpoints && opts.endpoints.auth) || AUTH_URL;
    this.token = (opts.endpoints && opts.endpoints.token) || TOKEN_URL;
    this.timeoutMs = opts.timeoutMs || 180000;
    this.session = opts.session || null;        // {user, local?}
    this.onSession = opts.onSession || (() => {});
  }
  current() { return this.session ? { ok: true, user: this.session.user } : { ok: false }; }
  logout() { this.session = null; this.onSession(null); }
  async login() {
    const c = this.getConfig(), g = c.google || {};
    if (!g.clientId) return { ok: false, message: 'Connexion Google non configurée.' };
    const verifier = b64u(crypto.randomBytes(32)), challenge = b64u(crypto.createHash('sha256').update(verifier).digest());
    const state = b64u(crypto.randomBytes(16));
    let server;
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Délai dépassé : connexion non terminée.')), this.timeoutMs);
      server = http.createServer((req, res) => {
        const u = new URL(req.url, 'http://127.0.0.1');
        if (u.pathname !== '/cb') { res.writeHead(404); res.end(); return; }
        const done = (msg, ok) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end('<!doctype html><meta charset="utf-8"><title>AGOA COMPTA</title><body style="font:16px Segoe UI,sans-serif;padding:40px"><h2>' + msg + '</h2><p>Vous pouvez fermer cet onglet et revenir dans AGOA COMPTA.</p>'); clearTimeout(timer); ok ? resolve(u.searchParams.get('code')) : reject(new Error(msg)); };
        if (u.searchParams.get('error')) return done('Connexion refusée : ' + u.searchParams.get('error'), false);
        if (u.searchParams.get('state') !== state) return done('Réponse inattendue.', false);
        done('Connexion réussie.', true);
      });
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        this.redirect = 'http://127.0.0.1:' + server.address().port + '/cb';
        const q = new URLSearchParams({ client_id: g.clientId, redirect_uri: this.redirect, response_type: 'code', scope: 'openid email profile', code_challenge: challenge, code_challenge_method: 'S256', state, access_type: 'online', prompt: 'select_account' });
        q.set('login_hint', g.allowedEmail || '');
        Promise.resolve(this.openExternal(this.auth + '?' + q)).catch(reject);
      });
    }).catch(e => ({ error: e })).finally(() => { try { server && server.close(); } catch (e) { /* ignore */ } });
    if (code && code.error) return { ok: false, message: code.error.message };
    if (!code) return { ok: false, message: 'Aucun code reçu de Google.' };
    const body = new URLSearchParams({ code, client_id: g.clientId, redirect_uri: this.redirect, grant_type: 'authorization_code', code_verifier: verifier });
    if (g.clientSecret) body.set('client_secret', g.clientSecret);
    let tok;
    try {
      const r = await this.fetch(this.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
      tok = await r.json();
      if (!r.ok || !tok.id_token) return { ok: false, message: 'Google a refusé la connexion' + (tok && tok.error_description ? ' : ' + tok.error_description : '.') };
    } catch (e) { return { ok: false, message: 'Google injoignable : ' + e.message }; }
    const claims = decodeJwt(tok.id_token);
    const chk = checkIdentity(claims, g.allowedEmail);
    if (!chk.ok) return chk;
    this.session = { user: chk.user }; this.onSession(this.session);
    return { ok: true, user: chk.user };
  }
}
module.exports = { Auth, checkIdentity, decodeJwt };

/* Réglages de l'application : dossier Dropbox, connexion Google. Enregistrés dans le profil de l'utilisateur. */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const ALLOWED_EMAIL = 'agence@remithollet.fr';
const SUB = path.join('08 -THOMAS', '003-COMPTABILITE');

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } }
const exists = p => { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } };

/** Cherche le dossier 003-COMPTABILITE dans la Dropbox synchronisée du poste. */
function detectComptaRoot(env = process.env, home = os.homedir()) {
  const bases = [];
  [env.APPDATA && path.join(env.APPDATA, 'Dropbox', 'info.json'), env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Dropbox', 'info.json'), path.join(home, '.dropbox', 'info.json')]
    .filter(Boolean).forEach(f => { const j = readJson(f); if (j) Object.keys(j).forEach(k => { if (j[k] && j[k].path) bases.push(j[k].path); }); });
  try { fs.readdirSync(home).filter(n => /dropbox/i.test(n)).forEach(n => bases.push(path.join(home, n))); } catch (e) { /* ignore */ }
  const variants = ['08 -THOMAS', '08-THOMAS', '08 - THOMAS'];
  for (const b of bases) {
    const subs = [''];
    try { fs.readdirSync(b).forEach(n => { if (exists(path.join(b, n))) subs.push(n); }); } catch (e) { /* ignore */ }
    for (const s of subs) for (const v of variants) {
      const p = path.join(b, s, v, '003-COMPTABILITE');
      if (exists(p)) return p;
    }
  }
  return null;
}

class Config {
  constructor(file, defaults) {
    this.file = file;
    const saved = readJson(file) || {}, d = defaults || {};
    this.data = Object.assign({ root: null }, saved, { google: Object.assign({ clientId: '', clientSecret: '' }, d, saved.google || {}, { allowedEmail: ALLOWED_EMAIL }) });
    delete this.data.localMode;
  }
  get() { return this.data; }
  set(patch) {
    this.data = Object.assign({}, this.data, patch, { google: Object.assign({}, this.data.google, patch.google || {}, { allowedEmail: ALLOWED_EMAIL }) });
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    return this.data;
  }
  /** Dossier 003-COMPTABILITE à utiliser (réglage, sinon détection). */
  comptaRoot() { return this.data.root && exists(this.data.root) ? this.data.root : detectComptaRoot(); }
}
module.exports = { Config, detectComptaRoot, SUB, ALLOWED_EMAIL };

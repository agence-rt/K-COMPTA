/* Lecture d'une facture / d'un justificatif PDF (émetteur, date, montants) et rapprochement avec les lignes bancaires. */
'use strict';
const { extractPages } = require('./extract');
const { toRows } = require('./statements');
const C = require('../calc');
const { r2 } = C;

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
const NUM = /-?\d{1,3}(?:[ .  ]\d{3})*[.,]\d{2}(?!\d)|-?\d+[.,]\d{2}(?!\d)/g;
function parseAmt(t) {
  let s = String(t).replace(/[\s  ]/g, '');
  if (/,\d{2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(/,/g, '');
  const v = parseFloat(s); return isNaN(v) ? null : Math.abs(v);
}
const amountsIn = txt => (String(txt).replace(/\d{1,2}(?:[.,]\d{1,2})?\s*%/g, ' ').match(NUM) || []).map(parseAmt).filter(v => v != null);

const MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
function findDate(text) {
  const t = String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const out = [];
  let m; const re1 = /\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](20\d\d)\b/g;
  while ((m = re1.exec(t))) out.push([m.index, m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0')]);
  const re2 = new RegExp('\\b(\\d{1,2})(?:er)?\\s+(' + MONTHS.join('|') + ')\\s+(20\\d\\d)\\b', 'g');
  while ((m = re2.exec(t))) out.push([m.index, m[3] + '-' + String(MONTHS.indexOf(m[2]) + 1).padStart(2, '0') + '-' + m[1].padStart(2, '0')]);
  const ok = out.filter(x => { const mo = +x[1].slice(5, 7), d = +x[1].slice(8); return mo >= 1 && mo <= 12 && d >= 1 && d <= 31; }).sort((a, b) => a[0] - b[0]);
  return ok.length ? ok[0][1] : null;
}

/** Analyse les lignes de texte d'un justificatif. */
function analyseRows(rows) {
  const lines = rows.map(r => r.text);
  const text = lines.join('\n');
  const T = lines.map(norm);
  let ttcRank = 99, total = null;
  const lvl = [/TOTAL\s*(T\.?T\.?C|TOUTES\s*TAXES)|MONTANT\s*(T\.?T\.?C|TOTAL)|NET\s*A\s*PAYER|TOTAL\s*A\s*PAYER|MONTANT\s*A\s*PAYER|AMOUNT\s*DUE|TOTAL\s*DUE|TOTAL\s*FACTURE|TOTAL\s*GENERAL|TOTAL\s*(EUR|€)|\bTTC\b/, /^\s*TOTAL\b(?!\s*(H\.?T|TVA|HORS))/];
  T.forEach((t, i) => {
    if (/TOTAL\s*(H\.?T|HORS)|MONTANT\s*H\.?T|SOUS[- ]?TOTAL/.test(t)) return;
    lvl.forEach((re, k) => {
      if (!re.test(t)) return;
      let a = amountsIn(lines[i]);
      if (!a.length && lines[i + 1]) a = amountsIn(lines[i + 1]);
      if (!a.length) return;
      const v = Math.max(...a);
      if (k < ttcRank || (k === ttcRank && v > total)) { ttcRank = k; total = v; }
    });
  });
  let ht = null;
  T.forEach((t, i) => { if (/TOTAL\s*H\.?T|MONTANT\s*H\.?T|NET\s*H\.?T|TOTAL\s*HORS\s*TAXE|\bH\.?T\b\s*[:€\d]/.test(t) && !/TTC/.test(t)) { const a = amountsIn(lines[i]); if (a.length && ht == null) ht = Math.max(...a); } });
  const tva = []; let tvaTotal = null;
  T.forEach((t, i) => {
    if (!/\bTVA\b|\bVAT\b|T\.V\.A/.test(t) || /N°|NUMERO|INTRACOM|FR\d{2}\s?\d/.test(t)) return;
    const rm = lines[i].match(/(\d{1,2}(?:[.,]\d{1,2})?)\s*%/), a = amountsIn(lines[i]);
    if (rm && a.length) tva.push({ rate: parseFloat(rm[1].replace(',', '.')), amount: a[a.length - 1] });
    else if (a.length && /TOTAL|MONTANT/.test(t)) tvaTotal = a[a.length - 1];
  });
  let issuer = null;
  const first = rows.filter(r => r.page === 1).slice(0, 12);
  for (const r of first) { const s = r.text.trim(); if (/[A-Za-zÀ-ÿ]{3}/.test(s) && !/^(facture|invoice|date|page|n°|avoir|devis|reçu|recu|tel|www)/i.test(s) && s.length <= 60) { issuer = s; break; } }
  return { text, normText: norm(text), total, ht, tva, tvaTotal, date: findDate(text), issuer };
}
async function analyseInvoice(buf) {
  const pages = await extractPages(buf);
  const rows = [];
  pages.forEach(pg => toRows(pg.items).forEach(r => { r.page = pg.number; rows.push(r); }));
  const a = analyseRows(rows); a.pages = pages.length; return a;
}

/** Lignes de ventilation lues sur le justificatif (somme = TTC), sinon null. */
function ventFrom(inv, ttc, allowed) {
  const near = (r) => { let b = null; allowed.forEach(x => { if (Math.abs(x - r) < 0.6 && (b == null || Math.abs(x - r) < Math.abs(b - r))) b = x; }); return b; };
  const out = []; let sum = 0;
  for (const t of inv.tva) {
    const rate = near(t.rate); if (rate == null || !t.amount) continue;
    const ht = r2(t.amount * 100 / rate); out.push({ rate, ht, tva: t.amount }); sum += ht + t.amount;
  }
  if (out.length === 1 && inv.ht != null) { out[0].ht = inv.ht; sum = inv.ht + out[0].tva; }
  if (out.length && Math.abs(sum - ttc) <= 0.05) { out.forEach(v => { const auto = r2(v.ht * v.rate / 100); if (Math.abs(auto - v.tva) < 0.005) v.tva = null; }); return out; }
  return null;
}

/* ---------- rapprochement ---------- */
const STOP = new Set(['PAIEMENT', 'PRLV', 'SEPA', 'VIR', 'VIREMENT', 'INST', 'FACT', 'REM', 'CHQ', 'REF', 'PSC', 'SARL', 'SELARL', 'EURL', 'SASU', 'FRANCE', 'COTISATION', 'MENSUELLE', 'PERM', 'POUR', 'LOCATION', 'CARTE', 'PRELEVEMENT', 'EUROPEEN', 'DATE', 'DIRECTION', 'GENE', 'ARCHI', 'ARCHITECTE']);
function labelTokens(label) { return [...new Set(norm(label).split(/[^A-Z0-9]+/).filter(t => t.length >= 4 && !/^\d+$/.test(t) && !STOP.has(t)))]; }
const dayDiff = (a, b) => Math.abs((Date.parse(a) - Date.parse(b)) / 86400000);

/** candidates : [{ soc, period, line }] lignes sans justificatif. Rend { status, best, others }.
 *  status : 'match' (montant identique, choix net), 'mismatch' (émetteur reconnu mais montant différent), 'ambiguous', 'none'. */
function matchInvoice(inv, candidates) {
  const scored = candidates.map(c => {
    const l = c.line, ttc = C.lineTTC(l);
    const tok = labelTokens(l.label), hit = tok.filter(t => inv.normText.includes(t)).length;
    const name = Math.min(hit, 3), strong = hit >= 2 || (tok.length === 1 && hit === 1);
    const amount = inv.total != null && Math.abs(inv.total - ttc) < 0.005;
    let score = (amount ? 10 : 0) + name * 2;
    if (inv.date && l.date && dayDiff(inv.date, l.date) <= 45) score += 1;
    if (/FAURIEL/.test(inv.normText) && c.soc === 'sci') score += 2;
    if (/KOCHANSKI/.test(inv.normText) && c.soc === 'archi') score += 2;
    return { c, score, name, strong, amount, ttc };
  });
  const ex = scored.filter(x => x.amount).sort((a, b) => b.score - a.score);
  if (ex.length) {
    if (ex.length === 1 || ex[0].score > ex[1].score) return { status: 'match', best: ex[0].c, why: ex[0].name ? 'montant et émetteur' : 'montant' };
    return { status: 'ambiguous', others: ex.map(x => x.c) };
  }
  const nm = scored.filter(x => x.strong && (!inv.date || !x.c.line.date || dayDiff(inv.date, x.c.line.date) <= 45)).sort((a, b) => b.score - a.score);
  if (nm.length && (nm.length === 1 || nm[0].score > nm[1].score)) return { status: 'mismatch', best: nm[0].c };
  return { status: nm.length ? 'ambiguous' : 'none', others: nm.map(x => x.c) };
}

module.exports = { analyseInvoice, analyseRows, matchInvoice, ventFrom, labelTokens, findDate, parseAmt, norm };

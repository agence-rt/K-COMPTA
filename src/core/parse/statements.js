/* Lecture des relevés bancaires PDF (Crédit Mutuel, Société Générale).
   Principe : on reconstitue les lignes du tableau d'après les positions du texte, et le sens d'une opération
   (débit ou crédit) d'après la colonne dans laquelle se trouve le montant. Les totaux et soldes du relevé
   servent ensuite à contrôler la lecture. */
'use strict';
const { extractPages } = require('./extract');

const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const AMOUNT = /^\d{1,3}(?:\.\d{3})*,\d{2}$|^\d+,\d{2}$/;
const toNum = s => parseFloat(String(s).replace(/\./g, '').replace(',', '.'));
const iso = d => { const m = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? m[3] + '-' + m[2] + '-' + m[1] : ''; };
const clean = s => String(s).replace(/\s+/g, ' ').trim();

/* ---------- éléments positionnés -> lignes de mots ---------- */
function toRows(items) {
  const toks = [];
  items.forEach(it => {
    const s = it.str, len = s.length, re = /\S+/g; let m;
    while ((m = re.exec(s))) toks.push({ str: m[0], x0: it.x + it.w * m.index / len, x1: it.x + it.w * (m.index + m[0].length) / len, y: it.y });
  });
  toks.sort((a, b) => b.y - a.y || a.x0 - b.x0);
  const rows = [];
  toks.forEach(t => {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last.y - t.y) <= 2.5) last.toks.push(t); else rows.push({ y: t.y, toks: [t] });
  });
  rows.forEach(r => { r.toks.sort((a, b) => a.x0 - b.x0); r.text = r.toks.map(t => t.str).join(' '); });
  return rows;
}

/* ---------- colonnes Débit / Crédit ---------- */
function findHeader(rows) {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const d = r.toks.find(t => /^d[ée]bit$/i.test(t.str)), c = r.toks.find(t => /^cr[ée]dit$/i.test(t.str));
    if (d && c && c.x0 > d.x0 && /date|valeur|op[ée]ration|nature/i.test(r.text)) return { index: i, y: r.y, d, c };
  }
  return null;
}
/* Frontière entre colonne Débit (à gauche) et colonne Crédit (à droite) : on regroupe les bords droits des montants
   (alignés à droite dans chaque colonne) et on coupe au plus grand écart ; à défaut, on s'appuie sur les en-têtes. */
function columnBoundary(edges, hd) {
  const e = edges.slice().sort((x, y) => x - y);
  let best = 0, at = -1;
  for (let i = 1; i < e.length; i++) if (e[i] - e[i - 1] > best) { best = e[i] - e[i - 1]; at = i; }
  if (best >= 12) return { x: (e[at] + e[at - 1]) / 2, learned: true };
  return { x: (hd.d.x1 + hd.c.x1) / 2, learned: false };
}

/* ---------- libellé et indications de TVA ---------- */
function composeLabel(first, details) {
  let label = clean(first);
  const card = label.match(/^(PAIEMENT (?:CB|PSC))\s+\d{4}\s*(.*)$/i);
  if (card) {
    const d0 = clean((details[0] || '').replace(/\s+CARTE\s+\d+.*$/i, '').replace(/\/.*$/, ''));
    label = card[1].toUpperCase() + ' ' + (d0 || clean(card[2]));
    return clean(label);
  }
  label = label.replace(/^\d{4,}\s+/, '').replace(/\s+\d{6,}$/, '');
  const pick = key => { const l = details.find(x => new RegExp('^' + key + '\\s*:', 'i').test(x)); return l ? clean(l.replace(/^[^:]*:/, '')) : ''; };
  const extra = [pick('DE'), pick('POUR'), pick('MOTIF')].filter(Boolean);
  return clean(label + ' ' + extra.join(' '));
}
function readHint(details) {
  const t = details.join(' ');
  const fm = s => s.replace(/\./g, '').replace(',', '.');
  let m, h = t.match(/MONTANT HT\s*:\s*([\d.]*\d,\d{2})/i), v = t.match(/TVA A\s*([\d,]+)\s*%\s*:\s*([\d.]*\d,\d{2})/i);
  if (h && v) return { ht: parseFloat(fm(h[1])), tva: parseFloat(fm(v[2])), rate: parseFloat(fm(v[1])), text: 'Relevé : HT ' + h[1] + ' € · TVA ' + v[1] + ' % ' + v[2] + ' €' };
  if ((m = t.match(/DONT TVA\s*([\d.]*\d,\d{2})\s*EUR/i))) return { tva: parseFloat(fm(m[1])), rate: 20, text: 'Relevé : dont TVA ' + m[1] + ' €' };
  if ((m = t.match(/\bTVA\s?(10|20)\b/i))) return { rate: +m[1], text: 'Relevé : TVA' + m[1] };
  return null;
}

/* ---------- lecture d'un relevé (à partir des pages positionnées) ---------- */
function parseStatementRows(pages, filename) {
  const issues = [];
  const pageRows = pages.map(p => toRows(p.items));
  const fullText = pageRows.map(rs => rs.map(r => r.text).join('\n')).join('\n');

  /* banque, société, compte */
  let bank = /cr[ée]dit mutuel/i.test(fullText) ? 'cm' : /soci[ée]t[ée] g[ée]n[ée]rale/i.test(fullText) ? 'sg' : null;
  if (!bank) bank = /eurocompte|credit.?mutuel/i.test(filename || '') ? 'cm' : /^releve_|socgen|societe/i.test(filename || '') ? 'sg' : null;
  const headText = (() => { const rs = pageRows[0] || []; const k = rs.findIndex(r => /RELEV[ÉE]/i.test(r.text)); return rs.slice(0, k > 0 ? k : 15).map(r => r.text).join(' '); })();
  let soc = /KOCHANSKI/i.test(headText) ? 'archi' : /FAURIEL/i.test(headText) ? 'sci' : null;
  if (!soc) soc = /KOCHANSKI/i.test(filename || '') ? 'archi' : /FAURIEL/i.test(filename || '') ? 'sci' : null;
  let account = '';
  { const cm = fullText.match(/C\/C[^\n]*?N°\s*(\d{8,})/i), sg = fullText.match(/n°\s*(\d{5}\s+\d{5}\s+\d{11}\s+\d{2})/i); account = cm ? cm[1] : sg ? sg[1].replace(/\s+/g, ' ') : ''; }
  if (!bank) issues.push('Banque non reconnue.');
  if (!soc) issues.push('Société non reconnue.');

  /* passe 1 : lignes brutes (montants avec leur position) */
  const raw = []; let cur = null, ended = false, hdPrev = null;
  const bal = { open: null, close: null, td: null, tc: null, totalsRow: null };
  const balances = [];
  const BOILER = /^(<<Suite|Page \d|.*Sous réserve|Date\s+Date valeur|Date\s+Valeur)/i;
  pageRows.forEach(rows => {
    const hd = findHeader(rows) || hdPrev; if (!hd) return; hdPrev = hd;
    const colLeft = hd.d.x0 - 40;
    const startIdx = rows.findIndex(r => r.y <= hd.y - 0.5);
    rows.slice(startIdx < 0 ? rows.length : startIdx).forEach(r => {
      const text = r.text;
      let m;
      /* soldes */
      if ((m = text.match(/SOLDE\s+(CREDITEUR|DEBITEUR)\s+AU\s+(\d{2}\/\d{2}\/\d{4})\s+([\d.]*\d,\d{2})/i))) {
        balances.push({ date: iso(m[2]), v: (/DEBITEUR/i.test(m[1]) ? -1 : 1) * toNum(m[3]) }); return;
      }
      if ((m = text.match(/SOLDE\s+PR[ÉE]C[ÉE]DENT\s+AU\s+(\d{2}\/\d{2}\/\d{4})\s+([+-])?\s*([\d.]*\d,\d{2})/i))) { bal.open = { date: iso(m[1]), v: (m[2] === '-' ? -1 : 1) * toNum(m[3]) }; return; }
      if ((m = text.match(/NOUVEAU\s+SOLDE\s+AU\s+(\d{2}\/\d{2}\/\d{4})\s+([+-])?\s*([\d.]*\d,\d{2})/i))) { bal.close = { date: iso(m[1]), v: (m[2] === '-' ? -1 : 1) * toNum(m[3]) }; return; }
      if (/^(TOTAL(?:\s+DES)?\s+MOUVEMENTS|TOTAUX\s+DES\s+MOUVEMENTS)/i.test(text)) { bal.totalsRow = r; ended = true; cur = null; return; }
      if (ended) return;
      if (BOILER.test(text)) return;
      const amts = r.toks.filter(t => AMOUNT.test(t.str) && t.x1 > colLeft);
      const date = text.match(/^(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+(.*)$/);
      if (date) {
        const labelToks = r.toks.filter(t => !amts.includes(t) && t.str !== '*').slice(2).map(t => t.str).join(' ');
        cur = { date: iso(date[1]), valueDate: iso(date[2]), first: labelToks, details: [], amts: amts.slice() };
        raw.push(cur); return;
      }
      if (!cur) return;
      if (amts.length && !cur.amts.length && r.toks.every(t => amts.includes(t) || t.str === '*' || /^[+-]$/.test(t.str))) { cur.amts = amts.slice(); return; }
      const dt = r.toks.filter(t => !amts.includes(t)).map(t => t.str).join(' ');
      if (dt) cur.details.push(clean(dt));
    });
  });
  if (raw.length === 0) issues.push('Aucune ligne reconnue dans le relevé.');

  /* soldes : ouverture = 1er solde CM, clôture = dernier */
  if (!bal.open && balances.length) bal.open = balances[0];
  if (!bal.close && balances.length > 1) bal.close = balances[balances.length - 1];

  /* passe 2 : sens des montants, d'après la colonne */
  const hdAny = hdPrev;
  if (!hdAny) issues.push('Colonnes Débit / Crédit non détectées.');
  const allAmts = raw.reduce((a, l) => a.concat(l.amts), []);
  const bound = hdAny && allAmts.length ? columnBoundary(allAmts.map(t => t.x1), hdAny) : { x: Infinity, learned: false };
  const dirOf = t => (t.x1 < bound.x ? 'D' : 'C');
  const sums = (flip) => { let d = 0, c = 0; allAmts.forEach(a => { const dd = (dirOf(a) === 'D') !== !!flip; if (dd) d += toNum(a.str); else c += toNum(a.str); }); return { d: r2(d), c: r2(c) }; };
  if (bal.totalsRow && hdAny) {
    const tt = bal.totalsRow.toks.filter(t => AMOUNT.test(t.str));
    let td = 0, tc = 0; tt.forEach(t => { if (dirOf(t) === 'D') td += toNum(t.str); else tc += toNum(t.str); });
    bal.td = r2(td); bal.tc = r2(tc);
  }
  /* si les totaux du relevé ne concordent qu'une fois débit et crédit permutés, on permute */
  let flip = false;
  if (bal.td != null) {
    const a = sums(false), b2 = sums(true);
    const okA = Math.abs(a.d - bal.td) < 0.005 && Math.abs(a.c - bal.tc) < 0.005;
    const okB = Math.abs(b2.d - bal.tc) < 0.005 && Math.abs(b2.c - bal.td) < 0.005;
    if (!okA && okB) { flip = true; const x = bal.td; bal.td = bal.tc; bal.tc = x; }
  }
  const lines = raw.map(l => {
    let debit = 0, credit = 0;
    l.amts.forEach(a => { const v = toNum(a.str); if ((dirOf(a) === 'C') !== flip) credit += v; else debit += v; });
    if (!l.amts.length) issues.push('Montant introuvable : ' + l.date + ' ' + clean(l.first));
    const o = { date: l.date, valueDate: l.valueDate, label: composeLabel(l.first, l.details), bank, debit: r2(debit), credit: r2(credit) };
    const h = readHint(l.details); if (h) o.hint = h;
    return o;
  });

  /* contrôles */
  const sum = lines.reduce((a, l) => { a.d += l.debit; a.c += l.credit; return a; }, { d: 0, c: 0 });
  const check = { debits: r2(sum.d), credits: r2(sum.c), totalDebit: bal.td, totalCredit: bal.tc };
  if (bal.td != null && (Math.abs(check.debits - bal.td) >= 0.005 || Math.abs(check.credits - bal.tc) >= 0.005)) issues.push('Les lignes ne correspondent pas aux totaux du relevé (débits ' + check.debits + ' / ' + bal.td + ', crédits ' + check.credits + ' / ' + bal.tc + ').');
  if (bal.open && bal.close) {
    const calc = r2(bal.open.v + sum.c - sum.d);
    check.balanceOk = Math.abs(calc - bal.close.v) < 0.005;
    if (!check.balanceOk) issues.push('Le solde de clôture ne correspond pas : calculé ' + calc + ', relevé ' + bal.close.v + '.');
  } else issues.push('Soldes du relevé non trouvés.');

  return { file: filename || '', bank, soc, account, opening: bal.open, closing: bal.close, totals: { debit: bal.td, credit: bal.tc }, columns: bound.learned ? 'détectées' : 'estimées', lines, check, issues };
}

async function parseStatement(buf, filename) {
  const pages = await extractPages(buf);
  return parseStatementRows(pages, filename);
}

module.exports = { parseStatement, parseStatementRows, toRows, composeLabel, readHint };

/* AGOA COMPTA — interface. L'état est tenu ici ; la lecture/écriture des fichiers passe par window.agoa (preload). */
(function(){
'use strict';
const C=window.AgoaCalc, A=window.agoa;
const {SOC,RATES_DEP,RATES_REC,r2,rl,frFull,slug,TYPE_LABEL,TYPE_NOTE,TYPE_SHORT,lineTTC,vTva,vTTC,remain,needsDoc,lineState}=C;
const fmt=n=>C.fmt(n)+'\u00a0€', fmt0=n=>C.fmt0(n)+'\u00a0€';
const parse=s=>{const v=parseFloat(String(s).replace(/[\s\u00a0\u202f€]/g,'').replace(',','.'));return isNaN(v)?0:Math.max(v,0)};
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $=(s,r)=>(r||document).querySelector(s);
const fr=d=>{const p=String(d).split('-');return p.length===3?p[2]+'/'+p[1]:d};
const root=$('#root');

/* ---------- état ---------- */
function defaultPeriod(soc){
  const d=new Date();d.setDate(1);d.setMonth(d.getMonth()-1);          // période en cours de clôture : le mois précédent
  const iso=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-01';
  return C.periodIdOf(soc,iso);
}
const S={soc:'archi',period:{archi:defaultPeriod('archi'),sci:defaultPeriod('sci')},tab:'lines',filter:'all',bankf:'all',expanded:new Set(),data:{},
  auth:'checking',me:null,cfg:null,busy:false,inbox:0,authMsg:''};
const yearOf=()=>C.periodYear(S.period[S.soc]);
const per=()=>C.periodInfo(S.soc,S.period[S.soc]);
const key=()=>S.soc+'|'+S.period[S.soc];
const store=()=>S.data[key()];
const find=id=>store().lines.find(l=>l.id===id);

/* ---------- chargement et enregistrement automatique ---------- */
const snap={};let saveTimer=null;
async function load(){
  const k=key();
  if(!S.data[k]){S.data[k]=await A.period.load(S.soc,S.period[S.soc]);snap[k]=JSON.stringify(S.data[k])}
}
function queueSave(){clearTimeout(saveTimer);saveTimer=setTimeout(flushSave,600)}
function markSaved(){const e=document.getElementById('saved');S.savedAt=new Date();if(e)e.textContent=savedLabel()}
function savedLabel(){return S.savedAt?'Enregistré à '+S.savedAt.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}):'Enregistrement automatique'}
async function flushSave(){
  clearTimeout(saveTimer);
  for(const k of Object.keys(S.data)){
    const j=JSON.stringify(S.data[k]);
    if(j!==snap[k]){const [soc,period]=k.split('|');snap[k]=j;try{await A.period.save(soc,period,S.data[k]);markSaved()}catch(e){toast('Enregistrement impossible : '+e.message)}}
  }
}
window.addEventListener('beforeunload',()=>{for(const k of Object.keys(S.data)){const j=JSON.stringify(S.data[k]);if(j!==snap[k]){const [soc,period]=k.split('|');A.period.saveSync(soc,period,S.data[k])}}});

/* ---------- calculs liés à la période affichée ---------- */
const acct=bank=>C.acct(store(),bank);
const stats=()=>C.stats(store(),S.soc);
const totals=()=>C.totals(store());
const exportModel=()=>C.exportModel(store(),S.soc);
const bankName=id=>(SOC[S.soc].banks.find(b=>b.id===id)||{}).name||id;

/* ---------- icônes ---------- */
const IC={
  chev:'<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>',
  trash:'<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M5 4.5l.6 8h4.8l.6-8"/></svg>',
  x:'<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 3l6 6M9 3l-6 6"/></svg>',
  clip:'<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 7.5l-5 5a3 3 0 01-4.2-4.2l5.5-5.5a2 2 0 012.8 2.8L6.7 11a1 1 0 01-1.4-1.4L10 5"/></svg>',
  pdf:'<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M4 1.5h5.5L13 5v9.5H4z"/><path d="M9.5 1.5V5H13"/></svg>'
};

/* ---------- rendu ---------- */
function toast(msg){const t=$('#toast');t.textContent=msg;t.hidden=false;clearTimeout(toast.h);toast.h=setTimeout(()=>{t.hidden=true},3600)}

/* ---------- panneau PDF (à droite) ---------- */
const V={cur:null,url:null,open:false};
function setOpen(o){
  V.open=!!o;$('#viewer').hidden=!V.open;$('#vtab').hidden=V.open;document.body.classList.toggle('viewer-open',V.open);
  try{localStorage.setItem('agoa.viewer',V.open?'1':'0')}catch(e){}
}
function fillVsel(){
  const sel=$('#vsel'),st=store();if(!sel)return;
  const docs=(st&&st.lines||[]).filter(l=>l.doc).sort((a,b)=>(a.code||'')<(b.code||'')?-1:1);
  sel.innerHTML='<option value="">'+(docs.length?'Choisir un justificatif…':'Aucun justificatif')+'</option>'+docs.map(l=>'<option value="'+esc(l.doc.rel)+'"'+(V.cur&&V.cur.rel===l.doc.rel?' selected':'')+'>'+esc((l.code||'')+' · '+(l.label||'').slice(0,28))+'</option>').join('');
  sel.disabled=!docs.length;
}
function emptyPdf(){
  const fr=$('#vframe'),msg=$('#vmsg');fr.hidden=true;fr.removeAttribute('src');
  $('#vtitle').textContent='Justificatifs';$('#vopen').disabled=true;
  msg.hidden=false;msg.className='vmsg muted';msg.textContent='Cliquez sur le nom d\'un justificatif dans le tableau, ou choisissez-en un dans la liste ci-dessus.';
}
async function showPdf(rel,name){
  const fr=$('#vframe'),msg=$('#vmsg');
  V.cur={soc:S.soc,period:S.period[S.soc],rel,name};
  $('#vtitle').textContent=name;$('#vopen').disabled=false;setOpen(true);
  msg.hidden=true;
  try{
    const buf=await A.doc.read(V.cur.soc,V.cur.period,rel);
    if(V.url)URL.revokeObjectURL(V.url);
    V.url=URL.createObjectURL(new Blob([buf],{type:'application/pdf'}));
    fr.src=V.url;fr.hidden=false;
  }catch(e){fr.hidden=true;fr.removeAttribute('src');msg.hidden=false;msg.className='vmsg';msg.textContent='Document illisible : '+e.message}
  render();
}
/* replie le volet (le document affiché est conservé) */
function hidePdf(){setOpen(false)}
/* le document affiché vient d'être retiré ou remplacé : on vide la visionneuse */
function hidePdfDoc(){V.cur=null;if(V.url){URL.revokeObjectURL(V.url);V.url=null}emptyPdf()}
$('#vclose').addEventListener('click',hidePdf);
$('#vtab').addEventListener('click',()=>{setOpen(true);if(!V.cur)emptyPdf();fillVsel()});
$('#vsel').addEventListener('change',e=>{const l=(store().lines||[]).find(x=>x.doc&&x.doc.rel===e.target.value);if(l)showPdf(l.doc.rel,l.doc.name)});
$('#vopen').addEventListener('click',()=>{if(V.cur)A.doc.open(V.cur.soc,V.cur.period,V.cur.rel)});
(function(){const g=$('#vgrip');let drag=false;
  g.addEventListener('mousedown',e=>{drag=true;e.preventDefault()});
  window.addEventListener('mouseup',()=>{drag=false});
  window.addEventListener('mousemove',e=>{if(!drag)return;const w=Math.min(Math.max(window.innerWidth-e.clientX,320),window.innerWidth-520);document.documentElement.style.setProperty('--vw',w+'px')}) })();

function render(){
  if(S.auth!=='ok'){root.innerHTML=gateHTML();return}
  root.innerHTML=
  '<div class="win"><div class="tb"><span class="appico" aria-hidden="true">CPT</span>'+
  '<span class="ttl"><strong>AGOA COMPTA</strong> <span class="ver" title="Version du logiciel">'+esc(verLabel())+'</span> — '+esc(SOC[S.soc].name)+'</span>'+
  userChip()+'</div>'+
  '<div class="app"><aside class="side">'+sideHTML()+'</aside><main class="main">'+headHTML()+tabsHTML()+'<div id="pane">'+paneHTML()+'</div></main></div></div>';
  refresh();fillVsel();
}
function sideHTML(){
  const st=store(),cfg=S.cfg||{};
  const socs=Object.keys(SOC).map(k=>'<button class="soc" data-act="soc" data-v="'+k+'" aria-pressed="'+(S.soc===k)+'"><b>'+esc(SOC[k].short)+'</b><small>'+esc(SOC[k].freqLabel)+' · '+SOC[k].banks.length+' compte'+(SOC[k].banks.length>1?'s':'')+'</small></button>').join('');
  const y=yearOf(),years=[];for(let i=y-3;i<=new Date().getFullYear()+1;i++)years.push(i);
  const yopts=years.map(v=>'<option value="'+v+'"'+(v===y?' selected':'')+'>'+v+'</option>').join('');
  const opts=C.periodsFor(S.soc,y).map(p=>'<option value="'+p.id+'"'+(p.id===S.period[S.soc]?' selected':'')+'>'+esc(p.label)+'</option>').join('');
  const files=st.statements.length?'<ul class="files">'+st.statements.map((f,i)=>'<li>'+IC.pdf+'<button class="fn lnk2" title="Afficher '+esc(f.name)+'" data-act="openstmt" data-i="'+i+'">'+esc(f.name)+'</button>'+(f.src==='dropbox'?'<span class="pill">Dropbox</span>':'')+(f.info?'<span class="info">'+esc(f.info)+'</span>':'')+'</li>').join('')+'</ul>':'<p class="note" style="margin:0 0 8px">Aucun relevé pour cette période.</p>';
  const dbx=cfg.root?
    '<p style="margin:0 0 8px"><span class="pill ok">Dossier Dropbox trouvé</span></p><p style="margin:0 0 8px;font:12px/1.5 var(--mono);word-break:break-all">'+esc(cfg.root)+'\\AGOA-COMPTA\\A-TRAITER</p>'+
    '<label class="auto"><input type="checkbox" data-act="autoinbox"'+(S.auto?' checked':'')+'> Importer automatiquement</label><p class="note" id="watchinfo" style="margin:2px 0 8px">'+esc(watchLabel())+'</p>'+'<button class="btn small" data-act="scaninbox" id="scanbtn">'+(S.inbox?'Lire les '+S.inbox+' relevé'+(S.inbox>1?'s':'')+' à traiter':'Chercher les nouveaux relevés')+'</button>':
    '<p style="margin:0 0 8px"><span class="pill bad">Dossier Dropbox introuvable</span></p><button class="btn small" data-act="chooseroot">Choisir le dossier…</button>';
  return '<div><h2>Société</h2>'+socs+'</div>'+
    '<div><h2>Période</h2><div style="display:grid;grid-template-columns:84px 1fr;gap:6px"><select class="sel" data-f="year" aria-label="Année">'+yopts+'</select><select class="sel" data-f="period" aria-label="Période">'+opts+'</select></div></div>'+
    '<div><h2>Relevés PDF</h2>'+files+'<button class="drop" data-act="importstmt">Importer un relevé depuis ce PC</button></div>'+
    '<div><h2>Dossier Dropbox surveillé</h2><div class="card" style="padding:10px 12px">'+dbx+'</div>'+
    '<p class="note">Les relevés déposés dans A-TRAITER sont lus et rangés par période. Les factures et reçus PDF sont lus (émetteur, montant), rapprochés des lignes, renommés avec le code de la ligne et rangés dans justificatifs.</p></div>';
}
function headHTML(){
  const s=SOC[S.soc],p=per();
  const y=yearOf(),yrs=[];for(let i=y-3;i<=new Date().getFullYear()+1;i++)yrs.push(i);
  const ctx='<div class="ctx" role="group" aria-label="Société et période affichées">'+Object.keys(SOC).map(k=>'<button class="soc2" data-act="soc" data-v="'+k+'" aria-pressed="'+(S.soc===k)+'">'+esc(SOC[k].short)+'</button>').join('')+
    '<select class="sel" data-f="year" aria-label="Année">'+yrs.map(v=>'<option value="'+v+'"'+(v===y?' selected':'')+'>'+v+'</option>').join('')+'</select>'+
    '<select class="sel" data-f="period" aria-label="Période">'+C.periodsFor(S.soc,y).map(q=>'<option value="'+q.id+'"'+(q.id===S.period[S.soc]?' selected':'')+'>'+esc(q.label)+'</option>').join('')+'</select></div>';
  return ctx+'<div class="mhead"><div><h1>'+esc(s.name)+'</h1><p>'+esc(p.label)+' · Déclaration '+esc(s.freqLabel.toLowerCase())+(s.siren?' · SIREN '+esc(s.siren)+' · mini-réel':'')+'</p></div><div class="mact"><div class="chips" id="chips"></div><button class="btn small" data-act="saveas" title="Enregistrer une copie du fichier .compta à l\'emplacement de votre choix">Enregistrer sous…</button><span class="saved" id="saved" title="Enregistrement automatique, avec 10 sauvegardes de secours">'+esc(savedLabel())+'</span></div></div>';
}
function tabsHTML(){
  const T=[['lines','Lignes bancaires'],['syn','Synthèse TVA'],['exp','Export'],['doc','Dossier AGOA-COMPTA'],['set','Réglages']];
  return '<nav class="tabs" aria-label="Sections">'+T.map(t=>'<button data-act="tab" data-v="'+t[0]+'"'+(S.tab===t[0]?' aria-current="true"':'')+'>'+t[1]+'</button>').join('')+'</nav>';
}
function paneHTML(){return S.tab==='lines'?linesHTML():S.tab==='syn'?synHTML():S.tab==='exp'?expHTML():S.tab==='doc'?docHTML():setHTML()}

function chipsHTML(){
  const s=stats();
  if(!s.n)return '<span class="pill">Aucune ligne</span>';
  const p=[];
  p.push('<span class="pill '+(s.bank?'bad':'ok')+'">Soldes : '+(s.banks-s.bank)+'/'+s.banks+' concordants</span>');
  p.push('<span class="pill '+(s.todo?'todo':'ok')+'">'+s.todo+' à classer</span>');
  p.push('<span class="pill '+(s.bad?'bad':'ok')+'">'+s.bad+' à corriger</span>');
  p.push('<span class="pill '+(s.miss?'todo':'ok')+'">'+s.miss+' justificatif'+(s.miss>1?'s':'')+' manquant'+(s.miss>1?'s':'')+'</span>');
  return p.join('');
}


function linesHTML(){
  const st=store(),banks=SOC[S.soc].banks;
  const cards=banks.map(b=>{
    const a=st.accounts[b.id];
    return '<div class="acct"><div class="acct-h"><strong>'+esc(b.name)+'</strong><span class="pill" id="ecart-'+b.id+'"></span></div><dl>'+
      '<dt>Solde d\'ouverture</dt><dd><input class="mono" inputmode="decimal" data-f="open" data-bank="'+b.id+'" value="'+(a.open?fmt(a.open):'')+'" aria-label="Solde d\'ouverture '+esc(b.name)+'"></dd>'+
      '<dt>Crédits − débits des lignes</dt><dd class="mono" id="mv-'+b.id+'"></dd>'+
      '<dt class="tot">Solde calculé</dt><dd class="mono tot" id="calc-'+b.id+'"></dd>'+
      '<dt>Solde du relevé</dt><dd><input class="mono" inputmode="decimal" data-f="close" data-bank="'+b.id+'" value="'+(a.close?fmt(a.close):'')+'" aria-label="Solde du relevé '+esc(b.name)+'"></dd>'+
    (a.td!=null?'<dt>Totaux lus sur le relevé</dt><dd class="mono" id="tt-'+b.id+'"></dd>':'')+'</dl></div>';
  }).join('');
  const F=[['all','Toutes'],['todo','À classer'],['dep','Dépenses'],['rec','Recettes'],['hors','Hors TVA']];
  const cnt=k=>k==='all'?st.lines.length:k==='todo'?st.lines.filter(l=>!l.type).length:st.lines.filter(l=>l.type===k).length;
  const flt=F.map(f=>'<button data-act="filter" data-v="'+f[0]+'" aria-pressed="'+(S.filter===f[0])+'">'+f[1]+' · '+cnt(f[0])+'</button>').join('');
  const bflt=banks.length>1?'<select class="sel" style="width:auto" data-f="bankf" aria-label="Filtrer par compte"><option value="all">Tous les comptes</option>'+banks.map(b=>'<option value="'+b.id+'"'+(S.bankf===b.id?' selected':'')+'>'+esc(b.name)+'</option>').join('')+'</select>':'';
  let rows=st.lines.filter(l=>(S.filter==='all'||(S.filter==='todo'?!l.type:l.type===S.filter))&&(S.bankf==='all'||l.bank===S.bankf));
  rows.sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:0);
  const body=rows.map(rowHTML).join('');
  const sampleNote=st.sample?'<p class="note" style="margin:0 0 10px">Données d\'exemple.</p>':(st.real?'<p class="note" style="margin:0 0 10px">Lignes lues sur les 2 relevés du dossier A-TRAITER. Elles restent à classer et à ventiler. Un texte gris sous un libellé reprend une indication de TVA écrite sur le relevé.</p>':'');
  const table=st.lines.length?
    '<div class="tw"><table class="t"><thead><tr><th>Code</th><th>Date</th><th>Libellé</th>'+(banks.length>1?'<th>Compte</th>':'')+'<th class="num">Débit</th><th class="num">Crédit</th><th>Nature</th><th>Taux TVA</th><th class="num">TVA</th><th>Justificatif</th><th>État</th><th><span class="sr" style="position:absolute;left:-9999px">Actions</span></th></tr></thead><tbody>'+(body||'<tr><td colspan="11" class="muted" style="padding:16px">Aucune ligne pour ce filtre.</td></tr>')+'</tbody></table></div>':
    '<div class="empty"><b>Aucune ligne pour '+esc(per().label)+'</b>Importez les relevés PDF, ou ajoutez les lignes à la main.</div>';
  return '<div class="accts">'+cards+'</div>'+sampleNote+
    '<div class="bar"><div class="flt">'+flt+'</div><div class="flt">'+bflt+'<button class="btn primary" data-act="addline">+ Ajouter une ligne</button></div></div>'+table;
}
function rowHTML(l){
  const open=S.expanded.has(l.id)&&(l.type==='dep'||l.type==='rec');
  const banks=SOC[S.soc].banks;
  const seg='<div class="seg" role="group" aria-label="Nature de la ligne">'+[['dep','Dépense'],['rec','Recette'],['hors','Hors TVA']].map(t=>'<button data-act="type" data-id="'+l.id+'" data-v="'+t[0]+'" aria-pressed="'+(l.type===t[0])+'">'+t[1]+'</button>').join('')+'</div>';
  let r='<tr class="row'+(V.cur&&l.doc&&l.doc.rel===V.cur.rel?' viewing':'')+'"><td class="codec" id="cd-'+l.id+'" title="Code unique de la ligne : nom du justificatif rangé dans Dropbox">'+esc(l.code||'')+'</td><td><input class="cell dt" type="date" data-f="date" data-id="'+l.id+'" value="'+esc(l.date)+'" aria-label="Date"></td>'+
    '<td><input class="cell lbl" data-f="label" data-id="'+l.id+'" value="'+esc(l.label)+'" placeholder="Libellé du relevé" aria-label="Libellé">'+(l.hint?'<div class="hint">'+esc(l.hint.text)+'</div>':'')+'</td>'+
    (banks.length>1?'<td><select class="cell bk bk-'+esc(l.bank)+'" data-f="bank" data-id="'+l.id+'" aria-label="Compte">'+banks.map(b=>'<option value="'+b.id+'" title="'+esc(b.name)+'"'+(l.bank===b.id?' selected':'')+'>'+b.id.toUpperCase()+'</option>').join('')+'</select></td>':'')+
    '<td><input class="cell m" inputmode="decimal" data-f="debit" data-id="'+l.id+'" value="'+(l.debit?fmt(l.debit):'')+'" aria-label="Débit"></td>'+
    '<td><input class="cell m" inputmode="decimal" data-f="credit" data-id="'+l.id+'" value="'+(l.credit?fmt(l.credit):'')+'" aria-label="Crédit"></td>'+
    '<td>'+seg+'</td><td>'+rateCell(l)+'</td><td class="num mono" id="tv-'+l.id+'"></td><td id="dc-'+l.id+'">'+docCell(l)+'</td>'+
    '<td><span class="pill" id="st-'+l.id+'" data-id="'+l.id+'"></span></td>'+
    '<td style="white-space:nowrap"><button class="ico" data-act="expand" data-id="'+l.id+'" aria-label="Ventilation TVA" aria-expanded="'+open+'"'+((l.type==='dep'||l.type==='rec')?'':' disabled')+' style="'+(open?'transform:rotate(180deg)':'')+'">'+IC.chev+'</button>'+
    '<button class="ico" data-act="delline" data-id="'+l.id+'" aria-label="Supprimer la ligne">'+IC.trash+'</button></td></tr>';
  if(open)r+='<tr class="detail"><td colspan="'+(banks.length>1?12:11)+'">'+edHTML(l)+'</td></tr>';
  return r;
}
function rateCell(l){
  const ok=l.type==='dep'||l.type==='rec';
  if(!ok)return '<select class="cell rate" disabled aria-label="Taux de TVA"><option>—</option></select>';
  const rates=l.type==='dep'?RATES_DEP:RATES_REC,multi=l.vent.length>1,one=l.vent.length===1?l.vent[0].rate:null;
  const opts=['<option value=""'+(!l.vent.length?' selected':'')+'>—</option>'].concat(rates.map(r=>'<option value="'+r+'"'+(one===r?' selected':'')+'>'+rl(r)+'</option>'));
  if(multi)opts.push('<option value="multi" selected>Ventilée</option>');
  else if(one!=null&&!rates.includes(one))opts.push('<option value="'+one+'" selected>'+rl(one)+'</option>');
  return '<select class="cell rate" data-f="rate" data-id="'+l.id+'" aria-label="Taux de TVA">'+opts.join('')+'</select>';
}
function docCell(l){
  if(l.doc)return '<span class="chip">'+IC.clip+'<button class="fn lnk2" title="Ouvrir '+esc(l.doc.name)+'" data-act="opendoc" data-id="'+l.id+'">'+esc(l.doc.name)+'</button><button class="ico" style="padding:2px" data-act="adddoc" data-id="'+l.id+'" aria-label="Remplacer le justificatif" title="Remplacer le justificatif">↻</button><button class="ico" style="padding:2px" title="Retirer le justificatif" data-act="rmdoc" data-id="'+l.id+'" aria-label="Retirer le justificatif">'+IC.x+'</button></span>';
  return '<button class="btn small'+(needsDoc(l)?' warn':'')+'" data-act="adddoc" data-id="'+l.id+'" title="Ajouter le justificatif PDF">+ PDF</button>';
}
function edHTML(l){
  const dep=l.type==='dep',rates=dep?RATES_DEP:RATES_REC;
  const vr=l.vent.map((v,i)=>'<tr><td><select data-f="vrate" data-id="'+l.id+'" data-i="'+i+'" aria-label="Taux de TVA">'+rates.map(r=>'<option value="'+r+'"'+(v.rate===r?' selected':'')+'>'+rl(r)+'</option>').join('')+'</select></td>'+
    '<td><input class="mono" inputmode="decimal" data-f="vht" data-id="'+l.id+'" data-i="'+i+'" value="'+fmt(v.ht)+'" aria-label="Base HT"></td>'+
    '<td><input class="mono" inputmode="decimal" data-f="vtva" data-id="'+l.id+'" data-i="'+i+'" value="'+fmt(vTva(v))+'" aria-label="Montant de TVA"></td>'+
    '<td class="mono" id="vt-'+l.id+'-'+i+'" style="text-align:right"></td>'+
    '<td><button class="ico" data-act="rmvent" data-id="'+l.id+'" data-i="'+i+'" aria-label="Retirer ce taux">'+IC.x+'</button></td></tr>').join('');
  return '<div class="ed"><div class="ed-h"><strong>'+(dep?'Dépense':'Recette')+'</strong> · montant TTC de la ligne : <span class="mono"><b id="ttc-'+l.id+'"></b></span>'+' · saisissez la base HT soumise à chaque taux : la part non ventilée est hors TVA.'+'</div>'+
    '<div class="scroll"><table class="vt"><thead><tr><th>Taux</th><th style="text-align:right">Base HT</th><th style="text-align:right">TVA</th><th style="text-align:right">TTC</th><th></th></tr></thead><tbody>'+vr+'</tbody></table></div>'+
    '<div class="ed-act"><button class="btn small" data-act="addvent" data-id="'+l.id+'">+ Ajouter un taux</button>'+
    '<button class="btn small" data-act="all" data-v="20" data-id="'+l.id+'">Tout à 20 %</button><button class="btn small" data-act="all" data-v="10" data-id="'+l.id+'">Tout à 10 %</button>'+
    (dep?'<label><input type="checkbox" data-f="immo" data-id="'+l.id+'"'+(l.immo?' checked':'')+'> Immobilisation (ligne 19)</label>':'')+
    '</div><div class="msg" id="ef-'+l.id+'"></div></div>';
}

/* ---------- synthèse ---------- */
function synHTML(){
  const st=store();
  return '<div class="syn"><div class="stack"><div class="card"><h3>Contrôles avant déclaration</h3><ul class="chk" id="synchk"></ul></div>'+
    '<div class="card"><h3>Paramètres</h3><label style="display:grid;gap:4px;font-size:13px">Report du crédit de TVA précédent (ligne 22)'+
    '<input class="mono" style="padding:5px 8px;border:1px solid var(--line);border-radius:4px;background:var(--surface);text-align:right" inputmode="decimal" data-f="report" value="'+(st.report?fmt(st.report):'')+'" placeholder="0,00"></label></div></div>'+
    '<div id="synout" class="stack"></div></div>';
}
function cell(decl,calc){return '<td class="v"><b>'+fmt0(decl)+'</b><small>'+fmt(calc)+'</small></td>'}
function synOutHTML(){
  const{t,D}=totals(),st=store();
  const res=D.TD>0?'pay':D.TD<0?'credit':'zero';
  const lab=D.TD>0?'TVA à payer (ligne 32)':D.TD<0?'Crédit de TVA (ligne 25)':'Aucune TVA à payer';
  const empty='<td class="v"></td>';
  const f=
  '<table class="form"><thead><tr><th class="h" style="text-align:left" colspan="2">Formulaire 3310-CA3</th><th class="h">Base HT</th><th class="h">TVA</th></tr></thead><tbody>'+
  '<tr class="sec"><th colspan="4">A · Montant des opérations réalisées</th></tr>'+
  '<tr><td class="ln">A1</td><td>Ventes, prestations de services</td>'+cell(D.A1,t.b20+t.b10)+empty+'</tr>'+
  '<tr class="sec"><th colspan="4">B · TVA brute</th></tr>'+
  '<tr><td class="ln">08</td><td>Taux normal 20 %</td>'+cell(D.b08,t.b20)+cell(D.t08,t.t20)+'</tr>'+
  '<tr><td class="ln">9B</td><td>Taux réduit 10 %</td>'+cell(D.b9B,t.b10)+cell(D.t9B,t.t10)+'</tr>'+
  '<tr class="tot"><td class="ln">16</td><td>Total de la TVA brute due</td>'+empty+cell(D.L16,t.t20+t.t10)+'</tr>'+
  '<tr class="sec"><th colspan="4">TVA déductible</th></tr>'+
  '<tr><td class="ln">19</td><td>Biens constituant des immobilisations</td>'+empty+cell(D.L19,t.d19)+'</tr>'+
  '<tr><td class="ln">20</td><td>Autres biens et services</td>'+empty+cell(D.L20,t.d20)+'</tr>'+
  '<tr><td class="ln">22</td><td>Report du crédit précédent</td>'+empty+cell(D.L22,st.report)+'</tr>'+
  '<tr class="tot"><td class="ln">23</td><td>Total TVA déductible</td>'+empty+cell(D.L23,t.d19+t.d20+st.report)+'</tr>'+
  '<tr class="sec"><th colspan="4">Taxe due</th></tr>'+
  '<tr class="tot"><td class="ln">TD</td><td>TVA due (ligne 16 − ligne 23)</td>'+empty+cell(D.TD,D.TD)+'</tr>'+
  (D.TD>0?'<tr><td class="ln">28</td><td>TVA nette due</td>'+empty+cell(D.TD,D.TD)+'</tr><tr class="tot"><td class="ln">32</td><td>Total à payer</td>'+empty+cell(D.TD,D.TD)+'</tr>':
   D.TD<0?'<tr class="tot"><td class="ln">25</td><td>Crédit de TVA</td>'+empty+cell(-D.TD,-D.TD)+'</tr>':'')+
  '</tbody></table><p class="note">En gras : montant à déclarer, arrondi à l\'euro. En gris : total exact des lignes.</p>';
  const rowsFor=o=>{const k=Object.keys(o).map(Number).sort((a,b)=>b-a);return k.length?k.map(r=>'<tr><td>'+rl(r)+'</td><td class="r mono">'+fmt(o[r].ht)+'</td><td class="r mono">'+fmt(o[r].tva)+'</td></tr>').join(''):'<tr><td colspan="3" class="muted">Aucune ligne</td></tr>'};
  const det='<div class="card"><h3>Détail par taux</h3><div class="scroll"><table class="tbl"><thead><tr><th>Recettes</th><th class="r">Base HT</th><th class="r">TVA collectée</th></tr></thead><tbody>'+rowsFor(t.rec)+'</tbody></table>'+
    '<table class="tbl" style="margin-top:12px"><thead><tr><th>Dépenses</th><th class="r">Base HT</th><th class="r">TVA déductible</th></tr></thead><tbody>'+rowsFor(t.dep)+'</tbody></table></div></div>';
  return '<div class="result '+res+'"><span>'+lab+'</span><span class="big">'+fmt0(Math.abs(D.TD))+'</span></div>'+
    '<div class="card scroll">'+f+'<div style="margin-top:10px"><button class="btn" data-act="copy">Copier les montants</button></div></div>'+det;
}
function synChecksHTML(){
  const s=stats();
  const it=(ok,txt)=>'<li><span class="pill '+(ok?'ok':'bad')+'">'+(ok?'OK':'À voir')+'</span><span>'+txt+'</span></li>';
  const wr=(ok,txt)=>'<li><span class="pill '+(ok?'ok':'todo')+'">'+(ok?'OK':'À voir')+'</span><span>'+txt+'</span></li>';
  if(!s.n)return '<li><span class="pill">—</span><span>Aucune ligne importée pour cette période.</span></li>';
  return it(!s.bank,s.bank?s.bank+' compte'+(s.bank>1?'s':'')+' avec un écart de solde':'Les soldes correspondent aux relevés')+
    wr(!s.todo,s.todo?s.todo+' ligne'+(s.todo>1?'s':'')+' à classer':'Toutes les lignes sont classées')+
    it(!s.bad,s.bad?s.bad+' ventilation'+(s.bad>1?'s':'')+' à corriger':'Ventilations cohérentes')+
    wr(!s.miss,s.miss?s.miss+' justificatif'+(s.miss>1?'s':'')+' manquant'+(s.miss>1?'s':''):'Justificatifs complets')+
    '<li><span class="pill '+(s.ready?'ok':'warn')+'">'+(s.ready?'Prêt':'En cours')+'</span><span>'+(s.ready?'La déclaration peut être saisie.':'Réglez les points ci-dessus avant de déclarer.')+'</span></li>';
}


/* ---------- export ---------- */
const exportBase=()=>'AGOA-COMPTA_'+slug(SOC[S.soc].short)+'_'+per().id;
function expHTML(){
  const m=exportModel(),s=stats();
  const withDoc=m.flat.filter(i=>i.l.doc).length,miss=m.flat.filter(i=>needsDoc(i.l)).length;
  const path='AGOA-COMPTA\\'+SOC[S.soc].folder+'\\'+yearOf()+'\\'+per().folder+'\\exports\\';
  const left='<div class="stack"><div class="card"><h3>Exporter la période</h3>'+
    '<p style="margin:0 0 12px"><span class="pill '+(s.ready?'ok':'warn')+'">'+(s.ready?'Dossier prêt':'Dossier en cours')+'</span></p>'+
    '<div class="act"><button class="btn primary" data-act="exp-xlsx"'+(m.flat.length?'':' disabled')+'>Lignes et TVA (Excel)</button><small>Un onglet par compte bancaire, lignes classées en dépenses, recettes et hors TVA, plus l\'onglet Résumé TVA.</small></div>'+
    '<div class="act"><button class="btn primary" data-act="exp-lines"'+(m.flat.length?'':' disabled')+'>Lignes et TVA (PDF)</button><small>Résumé de la TVA (formulaire CA3), soldes par compte, puis les lignes de chaque compte avec nature, taux, base HT et TVA.</small></div>'+
    '<div class="act"><button class="btn primary" data-act="exp-pdf"'+(withDoc?'':' disabled')+'>Justificatifs classés (PDF)</button><small>'+(withDoc?withDoc+' justificatif'+(withDoc>1?'s':'')+' numéroté'+(withDoc>1?'s':'')+' dans l\'ordre ci-contre, avec page de garde et résumé de la TVA.':'Aucun justificatif rattaché pour cette période.')+(miss?' '+miss+' manquant'+(miss>1?'s':'')+', listé'+(miss>1?'s':'')+' sur la page de garde.':'')+'</small></div>'+
    '<div class="act"><button class="btn primary" data-act="exp-all"'+(m.flat.length?'':' disabled')+'>Tout exporter</button><small>Crée la synthèse TVA (Excel) et les deux PDF compilés : lignes et TVA, justificatifs classés.</small></div>'+
    '<p class="note">Les fichiers sont rangés dans <span class="mono" style="word-break:break-all">'+esc(path)+'</span></p>'+
    '<div id="expout"></div></div></div>';
  let right;
  if(!m.flat.length)right='<div class="empty"><b>Aucune ligne à exporter</b>Importez un relevé ou ajoutez des lignes dans l\'onglet Lignes bancaires.</div>';
  else right='<div class="stack">'+m.secs.filter(sc=>sc.count).map(sc=>{
    const rows=sc.groups.map(g=>'<tr class="gh"><td colspan="5">'+esc(g.title)+' · '+esc(TYPE_NOTE[g.type])+' · '+g.items.length+'</td></tr>'+g.items.map(it=>{
      const l=it.l;return '<tr><td class="mono">'+it.n+'</td><td class="mono">'+esc(fr(l.date))+'</td><td>'+esc(l.label||'(sans libellé)')+'</td><td class="r mono">'+(l.debit>0?'−':'+')+fmt(lineTTC(l))+'</td><td>'+(l.doc?'<span class="pill ok">'+esc(l.doc.name.length>26?l.doc.name.slice(0,25)+'…':l.doc.name)+'</span>':needsDoc(l)?'<span class="pill todo">Manquant</span>':'—')+'</td></tr>'}).join('')).join('');
    return '<div class="card"><h3 class="bk">'+esc(sc.bank.name)+' · '+sc.count+' ligne'+(sc.count>1?'s':'')+'</h3><div class="scroll"><table class="tbl"><thead><tr><th>N°</th><th>Date</th><th>Libellé</th><th class="r">Montant</th><th>Justificatif</th></tr></thead><tbody>'+rows+'</tbody></table></div></div>'}).join('')+'</div>';
  return '<div class="exp">'+left+right+'</div>';
}
function setBusy(b){S.busy=b;document.querySelectorAll('[data-act^="exp-"],[data-act="scaninbox"],[data-act="importstmt"]').forEach(x=>{x.disabled=b})}
async function runExport(kind){
  if(S.busy)return;
  if(!exportModel().flat.length){toast('Aucune ligne à exporter.');return}
  setBusy(true);
  try{
    await flushSave();
    const r=await A.export.run(S.soc,S.period[S.soc],kind);
    const out=$('#expout');
    if(out)out.innerHTML=r.files.length?'<ul class="chk" style="margin-top:10px">'+r.files.map(f=>'<li><span class="pill ok">Créé</span><span>'+esc(f.name)+'</span></li>').join('')+'</ul>'+(r.message?'<p class="note" style="'+(r.skipped?'color:var(--bad)':'')+'">'+esc(r.message)+'</p>':'')+'<button class="btn small" style="margin-top:8px" data-act="openexp">Ouvrir le dossier</button>':'';
    toast(r.files.length?r.files.length+' fichier'+(r.files.length>1?'s':'')+' créé'+(r.files.length>1?'s':'')+'.'+(r.skipped?' Attention : certains justificatifs n\'ont pas pu être intégrés.':''):(r.message||'Rien à exporter.'));
  }catch(e){toast('Export impossible : '+e.message)}
  finally{setBusy(false)}
}

/* ---------- dossier ---------- */
function docHTML(){
  const s=SOC[S.soc],p=per(),st=store(),cfg=S.cfg||{};
  const base=(cfg.root||'…')+'\\AGOA-COMPTA\\'+s.folder+'\\'+yearOf()+'\\'+p.folder+'\\';
  const just=st.lines.filter(l=>l.doc);
  const jl=just.length?just.map(l=>'<li><span class="new">'+esc(l.doc.name)+'</span></li>').join(''):'<li class="exist">(aucun justificatif ajouté)</li>';
  const sl=st.statements.length?st.statements.map(f=>'<li><span class="new">'+esc(f.name)+'</span></li>').join(''):'<li class="exist">(aucun relevé importé)</li>';
  return '<div class="spec"><div class="card"><h3>Rangement</h3><div class="scroll"><ul class="tree root"><li>003-COMPTABILITE/</li><li><ul class="tree">'+
    '<li class="exist">ARCHI PRO/ · anciennes déclarations et bilans</li><li class="exist">FAURIEL49/ · anciennes déclarations et bilans</li>'+
    '<li>AGOA-COMPTA/<ul class="tree"><li><span class="new">A-TRAITER/</span> <span class="exist">· relevés déposés, lus puis rangés</span></li><li>'+esc(s.folder)+'/'+yearOf()+'/'+p.folder+'/<ul class="tree"><li>periode.compta <span class="exist">· lignes, classement, soldes</span></li><li>releves/<ul class="tree">'+sl+'</ul></li><li>justificatifs/<ul class="tree">'+jl+'</ul></li><li>exports/</li></ul></li></ul></li></ul></li></ul></div>'+
    '<p style="margin:10px 0 0"><button class="btn small" data-act="openfolder">Ouvrir le dossier de la période</button> <button class="btn small" data-act="auditdocs" title="Renomme les PDF d\'après le code de la ligne, relit les montants et range dans « corbeille » les PDF qu\'aucune ligne n\'utilise">Nettoyer et vérifier les justificatifs</button></p><div id="auditout"></div></div>'+
    '<div class="card"><h3>Dossier de la période</h3><p style="margin:0 0 8px;font-size:13px;word-break:break-all">'+esc(base)+'</p><ul class="chk" id="docchk"></ul></div></div>';
}
function docChecksHTML(){
  const s=stats(),st=store();
  return '<li><span class="pill">'+st.statements.length+'</span><span>relevé'+(st.statements.length>1?'s':'')+' PDF</span></li>'+
    '<li><span class="pill">'+st.lines.filter(l=>l.doc).length+'</span><span>justificatif'+(st.lines.filter(l=>l.doc).length>1?'s':'')+' rattaché'+(st.lines.filter(l=>l.doc).length>1?'s':'')+'</span></li>'+
    '<li><span class="pill '+(s.miss?'todo':'ok')+'">'+s.miss+'</span><span>justificatif'+(s.miss>1?'s':'')+' manquant'+(s.miss>1?'s':'')+' (dépenses et recettes)</span></li>';
}

/* ---------- réglages ---------- */
function setHTML(){
  const c=S.cfg||{},g=c.google||{};
  return '<div class="spec"><div class="card"><h3>Dossier Dropbox</h3><p style="margin:0 0 8px;font-size:13px">Dossier <b>003-COMPTABILITE</b> de la Dropbox synchronisée sur ce poste.</p>'+
    '<p style="margin:0 0 10px;font:12px/1.5 var(--mono);word-break:break-all">'+(c.root?esc(c.root):'(introuvable)')+'</p>'+
    '<p style="margin:0 0 10px"><span class="pill '+(c.root?'ok':'bad')+'">'+(c.root?(c.rootSource==='config'?'Dossier choisi':'Trouvé automatiquement'):'Non trouvé')+'</span></p>'+
    '<button class="btn" data-act="chooseroot">Choisir le dossier…</button></div>'+
    '<div class="card"><h3>Connexion Google</h3><p style="margin:0 0 10px;font-size:13px">Le logiciel ne se lance qu\'après connexion avec le compte <b>'+esc(g.email||'agence@remithollet.fr')+'</b>.</p>'+
    '<p style="margin:0 0 10px"><span class="pill '+(g.configured?'ok':'bad')+'">'+(g.configured?'Connexion Google active':'Identifiants Google absents')+'</span></p></div>'+
    '<div class="card"><h3>À propos</h3><p style="margin:0;font-size:13px">AGOA COMPTA '+esc((c.version)||'')+'<br>Données enregistrées dans le dossier AGOA-COMPTA de la Dropbox, partagées entre les postes.</p></div></div>';
}

function refresh(){
  const st=store();
  const ch=$('#chips');if(ch)ch.innerHTML=chipsHTML();
  SOC[S.soc].banks.forEach(b=>{
    const a=acct(b.id),e=$('#ecart-'+b.id);
    if(e){
      if(a.empty){e.className='pill';e.textContent='Aucun mouvement'}
      else if(Math.abs(a.ecart)<0.005){e.className='pill ok';e.textContent='Solde concordant'}
      else{e.className='pill bad';e.textContent='Écart '+(a.ecart>0?'+':'−')+fmt(Math.abs(a.ecart))}
    }
    const mv=$('#mv-'+b.id);if(mv)mv.textContent=(a.c-a.d>=0?'+':'−')+fmt(Math.abs(a.c-a.d))+'';
    const cl=$('#calc-'+b.id);if(cl)cl.textContent=fmt(a.calc)+'';
    const tt=$('#tt-'+b.id),A=st.accounts[b.id];
    if(tt&&A.td!=null){const ok=Math.abs(A.td-a.d)<0.005&&Math.abs(A.tc-a.c)<0.005;
      tt.textContent='−'+fmt(A.td)+' / +'+fmt(A.tc)+(ok?' · concordent':' · écart');
      tt.title=ok?'Concordent avec les lignes':'Lignes : débits '+fmt(a.d)+', crédits '+fmt(a.c);
      tt.style.color=ok?'var(--ok)':'var(--bad)'}
  });
  st.lines.forEach(l=>{
    const s=lineState(l),e=$('#st-'+l.id);
    if(e){e.className='pill '+s.c+(s.act?' act':'');e.textContent=s.t;e.title=s.why||'';if(s.act){e.setAttribute('data-act','validate');e.setAttribute('role','button');e.tabIndex=0}else{e.removeAttribute('data-act');e.removeAttribute('role');e.removeAttribute('tabindex')}}
    const tv=$('#tv-'+l.id);
    if(tv){const sum=l.vent.reduce((a,v)=>a+vTva(v),0);tv.textContent=(l.type==='dep'||l.type==='rec')&&l.vent.length?fmt(sum):'—';tv.title=l.type==='dep'?'TVA déductible':l.type==='rec'?'TVA collectée':''}
    const ttc=$('#ttc-'+l.id);if(ttc)ttc.textContent=fmt(lineTTC(l));
    l.vent.forEach((v,i)=>{const c=$('#vt-'+l.id+'-'+i);if(c)c.textContent=fmt(vTTC(v))});
    const ef=$('#ef-'+l.id);
    if(ef){
      const r=remain(l);
      if(r<-0.005){ef.className='msg bad';ef.textContent='La ventilation dépasse la ligne de '+fmt(-r)+'.'}
      else if(r>0.005){ef.className='msg info';ef.textContent='Part hors TVA : '+fmt(r)+', non soumise à TVA.'}
      else{ef.className='msg ok';ef.textContent='Ligne entièrement ventilée.'}
    }
    const dc=$('#dc-'+l.id);if(dc)dc.innerHTML=docCell(l);
    const rc=$('select.rate[data-id="'+l.id+'"]');if(rc&&document.activeElement!==rc)rc.outerHTML=rateCell(l);
  });
  const so=$('#synout');if(so)so.innerHTML=synOutHTML();
  const sc=$('#synchk');if(sc)sc.innerHTML=synChecksHTML();
  const dk=$('#docchk');if(dk)dk.innerHTML=docChecksHTML();
}

/* après chaque mise à jour de l'affichage, on met en file l'enregistrement si quelque chose a changé */
const _refresh=refresh;
refresh=function(){_refresh();queueSave()};

/* ---------- connexion ---------- */
function verLabel(){const v=(S.cfg||{}).version;return v?'v'+v:''}
function userChip(){const m=S.me||{};return '<span class="usr"><span>'+esc(m.email||'')+'</span>'+((S.cfg||{}).authRequired?'<button class="lnk" data-act="logout">Se déconnecter</button>':'')+'</span>'}
function gateHTML(){
  const a=S.auth,c=S.cfg||{},g=c.google||{},mail=g.email||'agence@remithollet.fr';
  const tb='<div class="tb"><span class="appico" aria-hidden="true">CPT</span><span class="ttl"><strong>AGOA COMPTA</strong></span></div>';
  let h,p,btns='',extra='';
  if(a==='checking'){h='Démarrage…';p='Chargement des réglages.'}
  else if(a==='denied'){h='Accès refusé';p=esc(S.authMsg||'Ce compte n\'est pas autorisé.');btns='<button class="btn primary" data-act="login">Se connecter avec un autre compte</button>'}
  else if(g.configured){h='Connexion';p='Pour utiliser AGOA COMPTA, identifiez-vous avec le compte Google <b>'+esc(mail)+'</b>. Un navigateur va s\'ouvrir.'+(S.authMsg?'<br><b style="color:var(--bad)">'+esc(S.authMsg)+'</b>':'');btns='<button class="btn primary" data-act="login">Continuer avec Google</button>'}
  else{h='Connexion Google indisponible';p='Le logiciel ne se lance qu\'après une connexion Google avec <b>'+esc(mail)+'</b>. Les identifiants Google ne sont pas intégrés à cette version du logiciel : contactez l\'administrateur.'}
  return '<div class="win">'+tb+'<div class="gate"><div class="card"><span class="logo" aria-hidden="true">CPT</span><h1>'+h+'</h1><p>'+p+'</p>'+extra+(btns?'<div class="ed-act">'+btns+'</div>':'')+'</div></div></div>';
}
async function start(){
  render();
  S.cfg=await A.cfg.get();
  const s=await A.auth.session();
  if(s&&s.ok){S.me=s.user;S.auth='ok';await enter()}
  else{S.auth='needs';render()}
}
async function enter(){
  const p=await A.openFile.pending();
  if(p){S.soc=p.soc;S.period[p.soc]=p.period}
  await load();render();refreshInbox();
}
A.openFile.onOpen(async p=>{if(S.auth==='ok'&&p)await switchTo(p.soc,p.period)});
async function refreshInbox(){
  try{const r=await A.inbox.list();S.inbox=r.count;const b=$('#scanbtn');if(b&&!S.busy)b.textContent=S.inbox?'Lire les '+S.inbox+' relevé'+(S.inbox>1?'s':'')+' à traiter':'Chercher les nouveaux relevés'}catch(e){/* ignore */}
}
/* lecture du dossier A-TRAITER : à la demande, ou automatiquement quand de nouveaux PDF y arrivent (surveillance toutes les 15 s) */
try{S.auto=localStorage.getItem('agoa.auto')!=='0'}catch(e){S.auto=true}
async function scanInbox(auto){
  if(S.busy)return;
  setBusy(true);
  try{await flushSave();const r=await A.inbox.importAll();if(!r.reports.length){if(!auto)toast('Aucun relevé dans A-TRAITER.')}else await afterImport(r.reports)}
  catch(x){toast((auto?'Lecture automatique impossible : ':'Lecture impossible : ')+x.message)}finally{setBusy(false)}
}
async function watchInbox(){
  if(S.auth!=='ok')return;
  await refreshInbox();S.checkedAt=new Date();const e=$('#watchinfo');if(e)e.textContent=watchLabel();
  const a=document.activeElement;
  if(S.auto&&S.inbox>0&&!S.busy&&!(a&&/^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)))await scanInbox(true);
}
function watchLabel(){return S.auto?('Surveillance active'+(S.checkedAt?' · vérifié à '+S.checkedAt.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'')):'Surveillance désactivée'}
setInterval(watchInbox,15000);

/* ---------- actions ---------- */
function fillAll(l,rate){C.fillAll(l,rate)}
function setType(l,v){C.setType(l,v);S.expanded.delete(l.id)}
async function switchTo(soc,period){
  await flushSave();
  if(V.cur&&(V.cur.soc!==soc||V.cur.period!==period)){V.cur=null;if(V.url){URL.revokeObjectURL(V.url);V.url=null}emptyPdf()}
  S.soc=soc;S.period[soc]=period;S.filter='all';S.bankf='all';S.expanded.clear();
  await load();render();
}
async function afterImport(reports){
  /* les périodes touchées ont changé sur le disque : on les recharge */
  let first=null;
  reports.forEach(r=>{(r.parts||[]).forEach(p=>{delete S.data[r.soc+'|'+p.period];delete snap[r.soc+'|'+p.period];if(!first&&p.added)first={soc:r.soc,period:p.period}});(r.touched||[]).forEach(t=>{delete S.data[t.soc+'|'+t.period];delete snap[t.soc+'|'+t.period]})});
  if(first){await switchTo(first.soc,first.period)}else{delete S.data[key()];await load();render()}
  const rel=reports.filter(r=>r.kind!=='justificatif'),jus=reports.filter(r=>r.kind==='justificatif');
  const ok=rel.filter(r=>r.ok),ko=rel.filter(r=>!r.ok);
  const lines=ok.reduce((a,r)=>a+r.parts.reduce((b,p)=>b+(p.added?p.lines:0),0),0);
  const warn=ok.filter(r=>r.issues.length).length;
  const jok=jus.filter(r=>r.ok),jko=jus.filter(r=>!r.ok),jmis=jok.filter(r=>r.matched&&r.matched.mismatch).length;
  const parts=[];
  if(rel.length)parts.push(ok.length?ok.length+' relevé'+(ok.length>1?'s':'')+' lu'+(ok.length>1?'s':'')+', '+lines+' ligne'+(lines>1?'s':'')+' ajoutée'+(lines>1?'s':'')+'.':'Aucun relevé lu.');
  if(jus.length)parts.push(jok.length+' justificatif'+(jok.length>1?'s':'')+' rapproché'+(jok.length>1?'s':'')+(jmis?' ('+jmis+' à vérifier)':'')+(jko.length?', '+jko.length+' à traiter à la main':'')+'.');
  toast(parts.join(' ')+(warn?' '+warn+' relevé'+(warn>1?'s':'')+' à vérifier.':'')+(ko.length?' '+ko.length+' non lu'+(ko.length>1?'s':'')+' : '+ko[0].issues[0]:''));
  S.lastReports=reports;showReports(reports);
  refreshInbox();
}
function showReports(rs){
  const bad=rs.filter(r=>r.issues&&r.issues.length);if(!bad.length)return;
  console.warn('Relevés à vérifier',bad.map(r=>r.file+' : '+r.issues.join(' ; ')));
  const box=$('#pane');if(!box)return;
  const el=document.createElement('div');el.className='card warnbox';
  el.innerHTML='<h3>Relevés et justificatifs à vérifier</h3><ul class="chk">'+bad.map(r=>'<li><span class="pill '+(r.ok?'todo':'bad')+'">'+(r.ok?'À voir':(r.kind==='justificatif'?'Non rapproché':'Non lu'))+'</span><span><b>'+esc(r.file)+'</b><br>'+r.issues.map(esc).join('<br>')+'</span></li>').join('')+'</ul>';
  box.prepend(el);
}

root.addEventListener('click',async e=>{
  const b=e.target.closest('[data-act]');if(!b)return;
  const a=b.dataset.act,id=b.dataset.id,v=b.dataset.v;
  if(a==='login'){S.authMsg='';const r=await A.auth.login();if(r.ok){S.me=r.user;S.auth='ok';await enter()}else{S.auth=r.denied?'denied':'needs';S.authMsg=r.message||'';render()}return}
  if(a==='logout'){await flushSave();await A.auth.logout();S.auth='needs';S.me=null;S.data={};render();return}
  if(a==='saveas'){try{await flushSave();const r=await A.file.saveAs(S.soc,S.period[S.soc]);if(r&&r.path)toast('Fichier enregistré : '+r.path)}catch(x){toast('Enregistrement impossible : '+x.message)}return}
  if(a==='chooseroot'){const r=await A.cfg.chooseRoot();if(r&&r.cfg){S.cfg=r.cfg;S.data={};await load();render();refreshInbox();toast('Dossier enregistré.')}return}
  if(S.auth!=='ok')return;
  const l=id?find(id):null,st=store();
  if(a==='exp-xlsx'||a==='exp-pdf'||a==='exp-lines'||a==='exp-all'){runExport(a.slice(4))}
  else if(a==='openexp'){A.folder.open(S.soc,S.period[S.soc],'exports')}
  else if(a==='auditdocs'){
    setBusy(true);
    try{
      await flushSave();const r=await A.doc.audit();
      Object.keys(S.data).forEach(k=>{delete S.data[k];delete snap[k]});await load();render();
      const R=r.reports,sum=k=>R.reduce((a,x)=>a+x[k].length,0),ref=R.reduce((a,x)=>a+x.refreshed,0),n=R.reduce((a,x)=>a+x.files,0);
      const items=[];R.forEach(x=>{const tag=x.soc+' '+x.period+' : ';x.renamed.forEach(y=>items.push(['ok',tag+'renommé '+y.from+' → '+y.to]));x.trashed.forEach(y=>items.push(['warn',tag+y+' non utilisé, rangé dans « corbeille »']));x.missing.forEach(y=>items.push(['bad',tag+'fichier introuvable pour '+y.code+' ('+y.name+')']));x.shared.forEach(y=>items.push(['bad',tag+y.name+' sert à plusieurs lignes : '+y.codes.join(', ')]))});
      const head='<p class="note" style="margin:10px 0 6px">'+n+' PDF contrôlé'+(n>1?'s':'')+' · '+sum('renamed')+' renommé(s) · '+sum('trashed')+' retiré(s) · '+ref+' relu(s) · '+sum('missing')+' introuvable(s) · '+sum('shared')+' partagé(s)</p>';
      const o=$('#auditout');if(o)o.innerHTML=head+(items.length?'<ul class="chk">'+items.map(i=>'<li><span class="pill '+(i[0]==='ok'?'ok':i[0]==='warn'?'todo':'bad')+'">'+(i[0]==='ok'?'Corrigé':i[0]==='warn'?'Rangé':'À voir')+'</span><span>'+esc(i[1])+'</span></li>').join('')+'</ul>':'');
      toast('Justificatifs vérifiés : '+sum('renamed')+' renommé(s), '+sum('trashed')+' retiré(s), '+sum('missing')+' introuvable(s).');
    }catch(x){toast('Vérification impossible : '+x.message)}finally{setBusy(false)}
  }
  else if(a==='openfolder'){A.folder.open(S.soc,S.period[S.soc],'')}
  else if(a==='soc'){await switchTo(v,S.period[v])}
  else if(a==='tab'){S.tab=v;render()}
  else if(a==='filter'){S.filter=v;render()}
  else if(a==='type'&&l){setType(l,v);render()}
  else if(a==='expand'&&l){S.expanded.has(id)?S.expanded.delete(id):S.expanded.add(id);render()}
  else if(a==='addvent'&&l){
    const r=remain(l),used=l.vent.map(x=>x.rate),rt=(l.type==='dep'?RATES_DEP:RATES_REC).find(x=>!used.includes(x))||10;
    l.vent.push({rate:rt,ht:r>0?r2(r/(1+rt/100)):0,tva:null});render();
  }
  else if(a==='rmvent'&&l){l.vent.splice(+b.dataset.i,1);render()}
  else if(a==='all'&&l){fillAll(l,+v);render()}
  else if(a==='adddoc'&&l){
    await flushSave();
    const r=await A.doc.pick(S.soc,S.period[S.soc],{code:l.code,date:l.date,label:l.label,oldRel:l.doc?l.doc.rel:null});
    if(r&&r.doc){if(V.cur&&l.doc&&V.cur.rel===l.doc.rel)hidePdfDoc();l.doc=r.doc;l.valid=false;render();await showPdf(r.doc.rel,r.doc.name)}
  }
  else if(a==='opendoc'&&l&&l.doc){await showPdf(l.doc.rel,l.doc.name)}
  else if(a==='openstmt'){const f=st.statements[+b.dataset.i];if(f&&f.rel)await showPdf(f.rel,f.name)}
  else if(a==='rmdoc'&&l){const old=l.doc;l.doc=null;l.valid=false;if(old&&V.cur&&V.cur.rel===old.rel)hidePdfDoc();render();if(old){try{await A.doc.remove(S.soc,S.period[S.soc],old.rel)}catch(x){toast('Fichier non retiré du dossier : '+x.message)}}}
  else if(a==='validate'&&l){l.valid=!l.valid;render()}
  else if(a==='delline'&&l){if(l.doc){if(V.cur&&V.cur.rel===l.doc.rel)hidePdfDoc();try{await A.doc.remove(S.soc,S.period[S.soc],l.doc.rel)}catch(x){toast('Fichier non retiré du dossier : '+x.message)}}st.lines=st.lines.filter(x=>x.id!==id);S.expanded.delete(id);render()}
  else if(a==='addline'){
    const nl=C.makeLine({date:per().start,bank:S.bankf!=='all'?S.bankf:SOC[S.soc].banks[0].id});
    st.lines.push(nl);C.assignCodes(st);S.filter='all';render();
    const i=$('[data-f="label"][data-id="'+nl.id+'"]');if(i)i.focus();
  }
  else if(a==='importstmt'&&!S.busy){
    setBusy(true);try{await flushSave();const r=await A.statement.pick();if(r&&r.reports&&r.reports.length)await afterImport(r.reports)}catch(x){toast('Import impossible : '+x.message)}finally{setBusy(false)}
  }
  else if(a==='scaninbox'&&!S.busy){
    await scanInbox(false);
  }
  else if(a==='autoinbox'){S.auto=!S.auto;try{localStorage.setItem('agoa.auto',S.auto?'1':'0')}catch(e){}render();if(S.auto)refreshInbox()}
  else if(a==='copy'){
    const{D}=totals();
    const txt=['A1 '+D.A1,'08 base '+D.b08+' taxe '+D.t08,'9B base '+D.b9B+' taxe '+D.t9B,'16 '+D.L16,'19 '+D.L19,'20 '+D.L20,'22 '+D.L22,'23 '+D.L23,'TD '+D.TD].join('\n');
    try{await navigator.clipboard.writeText(txt);toast('Montants copiés.')}catch(x){toast('Copie refusée.')}
  }
});
root.addEventListener('input',e=>{
  const t=e.target,f=t.dataset.f;if(!f||S.auth!=='ok')return;
  const st=store(),l=t.dataset.id?find(t.dataset.id):null,i=+t.dataset.i;
  if(f==='label'&&l)l.label=t.value;
  else if(f==='date'&&l){l.date=t.value;C.recode(st,l);const cd=document.getElementById('cd-'+l.id);if(cd)cd.textContent=l.code||''}
  else if(f==='debit'&&l){l.debit=parse(t.value);l.valid=false}
  else if(f==='credit'&&l){l.credit=parse(t.value);l.valid=false}
  else if(f==='vht'&&l){const v=l.vent[i];v.ht=parse(t.value);v.tva=null;const x=$('[data-f="vtva"][data-id="'+l.id+'"][data-i="'+i+'"]');if(x)x.value=fmt(vTva(v))}
  else if(f==='vtva'&&l){l.vent[i].tva=parse(t.value)}
  else if(f==='open'||f==='close'){st.accounts[t.dataset.bank][f]=parse(t.value)}
  else if(f==='report'){st.report=parse(t.value)}
  else return;
  refresh();
});
root.addEventListener('change',async e=>{
  const t=e.target,f=t.dataset.f;if(!f||S.auth!=='ok')return;
  const l=t.dataset.id?find(t.dataset.id):null;
  if(['debit','credit','vht','vtva','open','close','report'].includes(f)){const n=parse(t.value);t.value=(n||f==='vht'||f==='vtva')?fmt(n):'';return}
  if(f==='year'){const y=+t.value,list=C.periodsFor(S.soc,y),cur=C.periodInfo(S.soc,S.period[S.soc]);const same=list.find(p=>p.folder===cur.folder)||list[0];await switchTo(S.soc,same.id)}
  else if(f==='period'){await switchTo(S.soc,t.value)}
  else if(f==='bankf'){S.bankf=t.value;render()}
  else if(f==='bank'&&l){l.bank=t.value;C.recode(st,l);render()}
  else if(f==='rate'&&l){if(t.value==='')l.vent=[];else if(t.value!=='multi'){const keep=l.vent[0]&&l.vent.length===1?l.vent[0]:null;fillAll(l,+t.value)}render()}
  else if(f==='vrate'&&l){const v=l.vent[+t.dataset.i];v.rate=+t.value;v.tva=null;render()}
  else if(f==='immo'&&l){l.immo=t.checked;refresh()}
});

try{if(localStorage.getItem('agoa.viewer')==='1'){setOpen(true);emptyPdf()}else setOpen(false)}catch(e){setOpen(false)}
start();
})();

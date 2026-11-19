'use strict';
const os=require('node:os'),fs=require('node:fs'),path=require('node:path');
process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'allo-cat-'));
const {test,after}=require('node:test'),assert=require('node:assert/strict');
const store=require('../storage');
const cats=JSON.parse(fs.readFileSync(path.join(__dirname,'..','assets/services.json'),'utf8')).categories;
const {createCatalogue}=require('../catalogue-admin');
const cat=createCatalogue({db:store.db,store,categories:cats});
after(()=>fs.rmSync(process.env.DATA_DIR,{recursive:true,force:true}));
const owner={email:'owner@example.org',role:'owner'},mgr={email:'mgr@example.org',role:'manager'},mgr2={email:'mgr2@example.org',role:'manager'};
const throwsWith=(fn,props)=>{try{fn()}catch(e){for(const [k,v] of Object.entries(props))assert.deepEqual(e[k],v,`error.${k}`);return e}assert.fail('expected an error')};

test('every change is recorded with who/when/why and a no-op records nothing',()=>{
  const slug='cameras-ip';
  assert.equal(store.revisions(slug).length,0);
  store.updateService(slug,{fr:'Caméras IP — v2'},{actor:owner,source:'direct-edit',note:'titre'});
  const revs=store.revisions(slug);assert.deepEqual(revs.map(r=>[r.rev,r.source]),[[2,'direct-edit'],[1,'baseline']]);
  assert.deepEqual(revs[0].changed,['fr']);assert.equal(revs[0].actor,owner.email);assert.equal(revs[0].actor_role,'owner');
  store.updateService(slug,{fr:'Caméras IP — v2'},{actor:owner});assert.equal(store.revisions(slug).length,2,'identical update adds no revision');
  assert.throws(()=>store.updateService(slug,{category:'does-not-exist'},{actor:owner}),/Catégorie/);
  assert.throws(()=>store.updateService(slug,{fr:''},{actor:owner}),/Champ non valide/);
  assert.equal(store.revisions(slug).length,2,'rejected updates leave no trace');
  assert.equal(store.getService(slug).fr,'Caméras IP — v2');
  const d=cat.revisionDetail(slug,2);assert.deepEqual(d.diff_vs_previous.map(x=>x.field),['fr']);assert.deepEqual(d.diff_vs_current,[]);
  assert.throws(()=>cat.revisionDetail(slug,99),/introuvable/);
});

test('duplicate prevention: exact and near-exact titles blocked, similar ones only warned, self excluded',()=>{
  const base=store.getService('wifi-professionnel');
  const e=throwsWith(()=>cat.assertNotDuplicate({fr:base.fr,ar:'اسم مختلف تماما',slug:'x-new'}),{status:409,code:'duplicate'});
  assert.equal(e.candidates[0].slug,'wifi-professionnel');
  throwsWith(()=>cat.assertNotDuplicate({fr:'  '+base.fr.toUpperCase()+'  ',ar:'',slug:'y-new'}),{code:'duplicate'});
  throwsWith(()=>cat.assertNotDuplicate({fr:'Autre titre sans rapport',ar:'',slug:'wifi-professionnel'}),{code:'duplicate'});
  assert.doesNotThrow(()=>cat.assertNotDuplicate({fr:base.fr,ar:base.ar,slug:base.slug},{excludeSlug:base.slug}),'a service is never its own duplicate');
  assert.doesNotThrow(()=>cat.assertNotDuplicate({fr:base.fr,ar:'x',slug:'z-new'},{force:true}),'owner may force');
  const warn=cat.assertNotDuplicate({fr:'OCR documents arabe',ar:'',slug:'ocr-new'});assert.ok(Array.isArray(warn));
  assert.deepEqual(cat.duplicatePairs(0.99),[],'seed catalogue has no exact duplicates');
});

test('quality report flags generic Arabic text and structural gaps from real data',()=>{
  const q=cat.quality();assert.equal(q.checked,100);assert.ok(q.by_code.ar_desc_generic>=60,'seed Arabic descriptions are mostly generic boilerplate');
  const s=store.getService('depannage-pc');
  const issues=cat.issuesFor({...s,ar:'English only',desc_ar:'English only',desc:'short',terms:'',technologies:[],includes:[],problems:[],status:'Disponible',published:false}).map(i=>i.code);
  for(const c of ['ar_title_missing','ar_desc_missing','fr_desc_short','no_terms','no_technologies','no_includes','no_problems','available_hidden'])assert.ok(issues.includes(c),c);
  const o=cat.overview();assert.equal(o.total,100);assert.equal(o.languages.ar.present,100);assert.ok(o.languages.ar.generic>=60);assert.deepEqual(o.languages.unsupported,['en','darija']);
});

test('taxonomy: inconsistent spellings are detected and merged with revisions, idempotently',()=>{
  const before=cat.taxonomy();assert.ok(before.inconsistent>=10);
  const t=before.technologies.find(x=>x.inconsistent);const names=t.variants.map(v=>v.name);
  assert.throws(()=>cat.mergeTechnologies({from:[],to:'X'},owner),/invalides/);
  assert.throws(()=>cat.mergeTechnologies({from:names,to:''},owner),/cible/);
  const r=cat.mergeTechnologies({from:names,to:names[0]},owner);assert.ok(r.services_updated>=1);
  const after=cat.taxonomy().technologies.find(x=>x.key===t.key);assert.equal(after.variants.length,1);assert.equal(after.variants[0].name,names[0]);
  const touched=store.fullRows().filter(s=>store.revisions(s.slug).some(x=>x.source==='taxonomy-merge'&&x.actor===owner.email));
  assert.equal(touched.length,r.services_updated,'exactly the changed services got a revision');
  assert.equal(cat.mergeTechnologies({from:names,to:names[0]},owner).services_updated,0,'second run changes nothing');
});

test('draft workflow: author proposes, owner approves, live content + revision + audit trail',()=>{
  const slug='sites-web',live0=store.getService(slug);
  assert.throws(()=>cat.createDraft({slug,patch:{status:'Disponible'}},mgr),/réservées au propriétaire/);
  assert.throws(()=>cat.createDraft({slug,patch:{published:false}},mgr),/réservées au propriétaire/);
  assert.throws(()=>cat.createDraft({slug,patch:{fr:live0.fr}},mgr),/Aucune différence/);
  assert.throws(()=>cat.createDraft({slug,patch:{fr:''}},mgr),/Champ non valide/);
  assert.throws(()=>cat.createDraft({slug:'ghost',patch:{fr:'x'}},mgr),/introuvable/);
  const d=cat.createDraft({slug,patch:{desc:'Description française réécrite, claire et suffisamment détaillée pour le client.',technologies:['WordPress','  Next.js  ','']},note:'refonte texte'},mgr);
  assert.equal(d.status,'draft');assert.deepEqual(d.patch.technologies,['WordPress','Next.js']);assert.deepEqual(Object.keys(d.base).sort(),['desc','technologies']);
  assert.equal(store.getService(slug).desc,live0.desc,'a draft never changes the live site');
  assert.throws(()=>cat.approve(d.id,{},owner),/en attente/,'cannot approve an unsubmitted draft');
  assert.throws(()=>cat.submit(d.id,mgr2),/auteur/,'only the author submits');
  const sub=cat.submit(d.id,mgr);assert.equal(sub.draft.status,'pending_review');
  assert.throws(()=>cat.updateDraft(d.id,{patch:{desc:'x'.repeat(50)},version:sub.draft.version},mgr),/brouillon ou une proposition rejetée/);
  assert.throws(()=>cat.approve(d.id,{},mgr),/propriétaire/,'a manager can never approve, not even their own draft');
  const ok=cat.approve(d.id,{note:'validé'},owner);assert.equal(ok.status,'published');assert.equal(ok.reviewer,owner.email);
  assert.equal(store.getService(slug).desc,d.patch.desc);
  const rev=store.revisions(slug)[0];assert.equal(rev.source,'draft#'+d.id);assert.equal(rev.actor,owner.email);assert.match(rev.note,/mgr@example.org/);
  assert.throws(()=>cat.approve(d.id,{},owner),/en attente/,'cannot approve twice');
});

test('draft conflicts: approval is refused when live content changed, with the exact fields; force overrides',()=>{
  const slug='ecommerce',d=cat.createDraft({slug,patch:{desc:'Version proposée par le gestionnaire, longue et détaillée pour la boutique.'}},mgr);cat.submit(d.id,mgr);
  store.updateService(slug,{desc:'Le propriétaire a modifié la description entre-temps, sans voir le brouillon.'},{actor:owner,source:'direct-edit'});
  const e=throwsWith(()=>cat.approve(d.id,{},owner),{status:409,code:'conflict'});assert.deepEqual(e.conflicts,['desc']);assert.match(e.current.desc,/entre-temps/);assert.notEqual(e.base.desc,e.current.desc);
  assert.match(store.getService(slug).desc,/entre-temps/,'refused approval changed nothing');
  assert.equal(cat.listDrafts({id:d.id})[0].status,'pending_review');
  cat.approve(d.id,{force:true,note:'écrase'},owner);assert.match(store.getService(slug).desc,/gestionnaire/);
});

test('reject needs a reason, rejected drafts can be edited and resubmitted, withdraw closes; optimistic locking on drafts',()=>{
  const slug='crm-sur-mesure',d=cat.createDraft({slug,patch:{terms:'crm sur mesure clients pipeline'}},mgr);cat.submit(d.id,mgr);
  assert.throws(()=>cat.reject(d.id,{note:' '},owner),/motif/);
  const rj=cat.reject(d.id,{note:'mots-clés trop génériques'},owner);assert.equal(rj.status,'rejected');assert.equal(rj.review_note,'mots-clés trop génériques');
  assert.throws(()=>cat.updateDraft(d.id,{patch:{terms:'autre'},version:1},mgr),/modifié entre-temps/,'stale version');
  const up=cat.updateDraft(d.id,{patch:{terms:'crm sur mesure erp clients pipeline devis'},version:rj.version},mgr);assert.equal(up.status,'draft');
  assert.throws(()=>cat.updateDraft(d.id,{patch:{terms:'x y z'},version:up.version},mgr2),/auteur/,'another manager cannot hijack it');
  cat.submit(d.id,mgr);const w=cat.withdraw(d.id,mgr);assert.equal(w.status,'withdrawn');assert.throws(()=>cat.submit(d.id,mgr),/brouillon peut être soumis/);
});

test('restore: a past revision becomes a new draft (never goes live directly)',()=>{
  const slug='cameras-ip',before=store.getService(slug);
  const dr=cat.restoreAsDraft(slug,1,mgr);assert.equal(dr.status,'draft');assert.match(dr.note,/révision 1/);assert.ok(dr.patch.fr&&dr.patch.fr!==before.fr);
  assert.equal(store.getService(slug).fr,before.fr);
  assert.throws(()=>cat.restoreAsDraft(slug,store.revisions(slug)[0].rev,mgr),/identique/,'restoring the current state is refused');
  assert.throws(()=>cat.restoreAsDraft(slug,99,mgr),/introuvable/);
});

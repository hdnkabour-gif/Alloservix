'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite');
const {createStudio}=require('../knowledge-studio');
function fixture(){const db=new DatabaseSync(':memory:');db.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE services(slug TEXT PRIMARY KEY,category TEXT,fr TEXT,ar TEXT,description TEXT,desc_ar TEXT,terms TEXT,technologies TEXT,includes TEXT,problems TEXT,status TEXT,published INTEGER,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);`);
 const store={getService:slug=>db.prepare('SELECT * FROM services WHERE slug=?').get(slug)||null};const studio=createStudio(db,store,['it','network']);return {db,store,studio};}
const service={slug:'wifi-maison',category:'network',fr:'Wi-Fi maison',ar:'ويفي الدار',desc:'Diagnostic Wi-Fi et couverture',desc_ar:'فحص الويفي',terms:'wifi maison',technologies:['mesh'],includes:['étude'],problems:['zone faible']};
test('a new service is hidden and Sur étude',()=>{const {studio,db}=fixture();const s=studio.createService(service);assert.equal(s.published,0);assert.equal(s.status,'Sur étude');assert.equal(db.prepare('SELECT count(*) n FROM services').get().n,1)});
test('duplicate slug rejected and category whitelisted',()=>{const {studio}=fixture();studio.createService(service);assert.throws(()=>studio.createService(service),/Slug déjà/);assert.throws(()=>studio.createService({...service,slug:'evil-one',category:'unknown'}),/Catégorie/)});
test('concept approval alone never improves ranking',()=>{const {studio}=fixture();studio.createService(service);const c=studio.createConcept({key:'ma-kaywselch',fr:'Signal faible',ar:'الويفي ضعيف',aliases:['wifi ma kaywselch','weak signal']});studio.createLink({concept_id:Number(c.id),service_slug:'wifi-maison',relation:'problem'});const services=[{...service}];assert.equal(studio.enrich(services)[0].terms,service.terms);studio.reviewConcept(c.id,'approved');assert.equal(studio.enrich(services)[0].terms,service.terms);studio.reviewLink(1,'approved');assert.match(studio.enrich(services)[0].terms,/weak signal/)});
test('concept edits revoke approval, archived links no longer affect ranking',()=>{const {studio}=fixture();studio.createService(service);const c=studio.createConcept({key:'weak-signal',fr:'Signal faible',ar:'إشارة ضعيفة',aliases:['connexion cachee']});studio.createLink({concept_id:Number(c.id),service_slug:'wifi-maison',relation:'problem'});studio.reviewConcept(c.id,'approved');studio.reviewLink(1,'approved');assert.match(studio.enrich([service])[0].terms,/connexion cachee/);studio.updateConcept(c.id,{aliases:['changed synonym']});assert.equal(studio.enrich([service])[0].terms,service.terms);studio.reviewConcept(c.id,'approved');studio.reviewLink(1,'archived');assert.equal(studio.enrich([service])[0].terms,service.terms)});
test('unknown service, unknown concept and invalid relations rejected',()=>{const {studio}=fixture();const c=studio.createConcept({key:'wifi-word',fr:'Wireless',ar:'واي فاي',aliases:[]});assert.throws(()=>studio.createLink({concept_id:Number(c.id),service_slug:'not-found',relation:'problem'}),/Service absent/);assert.throws(()=>studio.createLink({concept_id:199,service_slug:'not-found',relation:'problem'}),/Concept absent/)});
test('SQL injection is blocked by strict IDs',()=>{const {studio}=fixture();assert.throws(()=>studio.createService({...service,slug:'x; drop table services'}),/Slug/);assert.throws(()=>studio.createConcept({key:'drop tables;',fr:'A',ar:'ب',aliases:[]}),/Identifiant/)});

test('only reviewed aliases can steer catalogue recommendations',()=>{
 const {studio}=fixture();studio.createService(service);
 const {rank,detect}=require('../intent-engine');
 const withStatus={...service,published:true,status:'Sur étude'};
 const query='unusualuniquealias';
 const run=()=>rank(query,studio.enrich([withStatus]),detect(query)).map(s=>s.slug);
 assert.deepEqual(run(),[]);
 const c=studio.createConcept({key:'unusual-alias',fr:'Cas spécifique',ar:'حالة خاصة',aliases:[query]});
 const l=studio.createLink({concept_id:Number(c.id),service_slug:service.slug,relation:'problem'});
 assert.deepEqual(run(),[]);
 studio.reviewConcept(c.id,'approved');
 assert.deepEqual(run(),[]);
 studio.reviewLink(l.id,'approved');
 assert.deepEqual(run(),[service.slug]);
 studio.updateConcept(c.id,{aliases:['differentalias']});
 assert.deepEqual(run(),[]);
});

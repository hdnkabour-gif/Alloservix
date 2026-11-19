'use strict';
// Curated knowledge links. AI is never allowed to publish or approve these entries.
const SLUG=/^[a-z0-9][a-z0-9-]{2,79}$/;
const RELATIONS=new Set(['synonym','problem','device','requires','related','applies_to']);
function reject(message){const e=new Error(message);e.public=true;throw e}
const str=(x,max)=>{if(typeof x!=='string'||!x.trim()||x.length>max)reject('Champ invalide');return x.trim()};
const aliasList=(v)=>{if(!Array.isArray(v)||v.length>30||v.some(s=>typeof s!=='string'||!s.trim()||s.length>120))reject('Liste d’alias invalide');return [...new Set(v.map(s=>s.trim()))]};
function createStudio(db,store,categoryIds){
  db.exec(`CREATE TABLE IF NOT EXISTS knowledge_concepts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE,
    fr TEXT NOT NULL, ar TEXT NOT NULL, aliases TEXT NOT NULL DEFAULT '[]',
    review_state TEXT NOT NULL DEFAULT 'draft' CHECK (review_state IN ('draft','approved','archived')),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS knowledge_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT, concept_id INTEGER NOT NULL REFERENCES knowledge_concepts(id),
    service_slug TEXT NOT NULL REFERENCES services(slug),
    relation TEXT NOT NULL CHECK (relation IN ('synonym','problem','device','requires','related','applies_to')),
    review_state TEXT NOT NULL DEFAULT 'draft' CHECK(review_state IN ('draft','approved','archived')),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(concept_id,service_slug,relation));
  CREATE INDEX IF NOT EXISTS idx_knowledge_links_service ON knowledge_links(service_slug,review_state);`);
  const categories=new Set(categoryIds);
  function createService(payload){
    if(!payload||typeof payload!=='object'||Array.isArray(payload))reject('Champs de prestation requis');
    const slug=str(payload.slug,80);if(!SLUG.test(slug))reject('Slug invalide');
    const category=str(payload.category,40);if(!categories.has(category))reject('Catégorie inconnue');
    if(store.getService(slug))reject('Slug déjà utilisé');
    const fr=str(payload.fr,200),ar=str(payload.ar,200),desc=str(payload.desc,4000),desc_ar=str(payload.desc_ar,4000),terms=str(payload.terms,4000);
    const technologies=aliasList(payload.technologies||[]),includes=aliasList(payload.includes||[]),problems=aliasList(payload.problems||[]);
    // Always draft. The administrator must explicitly approve availability and publication in the existing editor.
    db.prepare(`INSERT INTO services(slug,category,fr,ar,description,desc_ar,terms,technologies,includes,problems,status,published)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,0)`).run(slug,category,fr,ar,desc,desc_ar,terms,JSON.stringify(technologies),JSON.stringify(includes),JSON.stringify(problems),'Sur étude');
    return store.getService(slug);
  }
  function concepts(){return db.prepare('SELECT * FROM knowledge_concepts ORDER BY updated_at DESC,id DESC LIMIT 500').all().map(c=>({...c,aliases:JSON.parse(c.aliases)}))}
  function links(){return db.prepare(`SELECT l.*,c.fr AS concept_fr,c.ar AS concept_ar,c.review_state AS concept_state,s.fr AS service_fr
      FROM knowledge_links l JOIN knowledge_concepts c ON c.id=l.concept_id JOIN services s ON s.slug=l.service_slug
      ORDER BY l.updated_at DESC,l.id DESC LIMIT 1000`).all()}
  function createConcept(payload){
    if(!payload||typeof payload!=='object'||Array.isArray(payload))reject('Concept requis');
    const key=str(payload.key,80);if(!SLUG.test(key))reject('Identifiant invalide');
    const fr=str(payload.fr,180),ar=str(payload.ar,180),aliases=aliasList(payload.aliases||[]);
    try{const r=db.prepare('INSERT INTO knowledge_concepts(key,fr,ar,aliases) VALUES(?,?,?,?)').run(key,fr,ar,JSON.stringify(aliases));return db.prepare('SELECT * FROM knowledge_concepts WHERE id=?').get(r.lastInsertRowid)}catch(e){if(/UNIQUE constraint/.test(e.message))reject('Concept existant');throw e}
  }
  function updateConcept(id,payload){
    const old=db.prepare('SELECT * FROM knowledge_concepts WHERE id=?').get(id);if(!old)reject('Concept introuvable');
    const fr=str(payload.fr??old.fr,180),ar=str(payload.ar??old.ar,180),aliases=aliasList(payload.aliases??JSON.parse(old.aliases));
    // Editing approved knowledge revokes approval of that knowledge until review.
    db.prepare("UPDATE knowledge_concepts SET fr=?,ar=?,aliases=?,review_state='draft',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(fr,ar,JSON.stringify(aliases),id);
    return db.prepare('SELECT * FROM knowledge_concepts WHERE id=?').get(id);
  }
  function reviewConcept(id,state){if(!['draft','approved','archived'].includes(state))reject('Statut invalide');const r=db.prepare('UPDATE knowledge_concepts SET review_state=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(state,id);if(!r.changes)reject('Concept introuvable');return db.prepare('SELECT * FROM knowledge_concepts WHERE id=?').get(id)}
  function createLink(payload){
    if(!payload||typeof payload!=='object'||Array.isArray(payload))reject('Relation requise');
    const concept_id=Number(payload.concept_id),service_slug=str(payload.service_slug,80),relation=str(payload.relation,30);
    if(!Number.isSafeInteger(concept_id)||concept_id<1||!RELATIONS.has(relation))reject('Relation invalide');
    if(!db.prepare('SELECT id FROM knowledge_concepts WHERE id=?').get(concept_id))reject('Concept absent');
    if(!store.getService(service_slug))reject('Service absent');
    try{const r=db.prepare('INSERT INTO knowledge_links(concept_id,service_slug,relation) VALUES(?,?,?)').run(concept_id,service_slug,relation);return db.prepare('SELECT * FROM knowledge_links WHERE id=?').get(r.lastInsertRowid)}catch(e){if(/UNIQUE constraint/.test(e.message))reject('Relation existante');throw e}
  }
  function reviewLink(id,state){if(!['draft','approved','archived'].includes(state))reject('Statut invalide');const r=db.prepare('UPDATE knowledge_links SET review_state=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(state,id);if(!r.changes)reject('Relation introuvable');return db.prepare('SELECT * FROM knowledge_links WHERE id=?').get(id)}
  function enrich(services){const aliasBySlug=new Map();const entries=db.prepare(`SELECT l.service_slug,c.fr,c.ar,c.aliases FROM knowledge_links l
    JOIN knowledge_concepts c ON c.id=l.concept_id
    WHERE l.review_state='approved' AND c.review_state='approved'`).all();
    for(const c of entries){const vals=[c.fr,c.ar,...JSON.parse(c.aliases)];aliasBySlug.set(c.service_slug,(aliasBySlug.get(c.service_slug)||'')+' '+vals.join(' '))}
    return services.map(s=>({...s,terms:s.terms+(aliasBySlug.get(s.slug)||''),curated_aliases:(aliasBySlug.get(s.slug)||'').trim()}));
  }
  return{createService,concepts,links,createConcept,updateConcept,reviewConcept,createLink,reviewLink,enrich};
}
module.exports={createStudio};

'use strict';
const path=require('node:path'),fs=require('node:fs');
const {DatabaseSync}=require('node:sqlite');
const file=path.resolve(process.env.DATA_DIR || path.join(__dirname,'.data'),'alloservix.sqlite');
fs.mkdirSync(path.dirname(file),{recursive:true});
const db=new DatabaseSync(file);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS services (slug TEXT PRIMARY KEY, category TEXT NOT NULL, fr TEXT NOT NULL, ar TEXT NOT NULL, description TEXT NOT NULL, desc_ar TEXT NOT NULL, terms TEXT NOT NULL, technologies TEXT NOT NULL, includes TEXT NOT NULL, problems TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Sur étude', published INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, visitor TEXT NOT NULL, kind TEXT NOT NULL, route TEXT NOT NULL, target TEXT NOT NULL DEFAULT '', campaign TEXT NOT NULL DEFAULT '', last_section TEXT NOT NULL DEFAULT '', depth INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_event_at ON events(at);CREATE INDEX IF NOT EXISTS idx_event_kind ON events(kind);
CREATE TABLE IF NOT EXISTS ai_usage (id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS inquiries (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', topic TEXT NOT NULL, message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'nouveau');
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, actor TEXT NOT NULL, action TEXT NOT NULL, resource TEXT NOT NULL, details TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS knowledge_candidates (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 reviewed_at TEXT,
 kind TEXT NOT NULL,
 proposal TEXT NOT NULL,
 corrected_value TEXT NOT NULL DEFAULT '',
 source TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending_review' CHECK(status IN ('pending_review','approved','rejected')),
 reviewer_note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_knowledge_candidates_status ON knowledge_candidates(status,created_at);
`);
const seeds=JSON.parse(fs.readFileSync(path.join(__dirname,'assets/services.json'),'utf8'));
const insert=db.prepare(`INSERT OR IGNORE INTO services(slug,category,fr,ar,description,desc_ar,terms,technologies,includes,problems,status,published) VALUES(?,?,?,?,?,?,?,?,?,?,?,1)`);
for(const s of seeds.services)insert.run(s.slug,s.category,s.fr,s.ar,s.desc,s.desc_ar,s.terms,JSON.stringify(s.technologies),JSON.stringify(s.includes),JSON.stringify(s.problems),'Sur étude');
const settings=db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)');
for(const [k,v] of Object.entries({site_title:'ALLOSERVIX',site_subtitle:'IT · CLOUD · SECURITY · SOFTWARE',contact_whatsapp:'',contact_email:'',contact_location:'Casablanca, Maroc'}))settings.run(k,v);
const fullRows=()=>db.prepare('SELECT * FROM services ORDER BY category,fr').all().map(fromRow);
function fromRow(r){return {...r,desc:r.description,technologies:JSON.parse(r.technologies),includes:JSON.parse(r.includes),problems:JSON.parse(r.problems),published:!!r.published};}
const getService=slug=>{const r=db.prepare('SELECT * FROM services WHERE slug=?').get(slug);return r?fromRow(r):null;};
const listSettings=()=>Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(x=>[x.key,x.value]));
function updateService(slug, updates){const current=getService(slug);if(!current)return null;
  const fields=['fr','ar','desc','desc_ar','terms','technologies','includes','problems','status','published'];
  const next={...current};for(const field of fields)if(Object.hasOwn(updates,field))next[field]=updates[field];
  const validStatuses=['Sur étude','Disponible','En préparation','Indisponible'];
  if(!validStatuses.includes(next.status))throw new Error('Statut non valide');
  for(const f of ['fr','ar','desc','desc_ar','terms'])if(typeof next[f]!=='string'||next[f].length>4000||!next[f].trim())throw new Error('Champ non valide: '+f);
  for(const f of ['technologies','includes','problems'])if(!Array.isArray(next[f])||next[f].length>40||next[f].some(x=>typeof x!=='string'||x.length>250))throw new Error('Liste non valide: '+f);
  if(typeof next.published!=='boolean')throw new Error('published doit être booléen');
  db.prepare(`UPDATE services SET fr=?,ar=?,description=?,desc_ar=?,terms=?,technologies=?,includes=?,problems=?,status=?,published=?,updated_at=CURRENT_TIMESTAMP WHERE slug=?`).run(next.fr,next.ar,next.desc,next.desc_ar,next.terms,JSON.stringify(next.technologies),JSON.stringify(next.includes),JSON.stringify(next.problems),next.status,Number(next.published),slug);
  return getService(slug);
}
const updateSetting=(key,value)=>{if(!['site_title','site_subtitle','contact_whatsapp','contact_email','contact_location'].includes(key))throw new Error('Clé non autorisée');if(typeof value!=='string'||value.length>180)throw new Error('Valeur non valide');db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value)};
const logAudit=(action,resource,details='')=>db.prepare('INSERT INTO audit(actor,action,resource,details) VALUES(?,?,?,?)').run('admin',action,resource,String(details).slice(0,300));
function recordEvent(ev){db.prepare('INSERT INTO events(visitor,kind,route,target,campaign,last_section,depth) VALUES(?,?,?,?,?,?,?)').run(ev.visitor,ev.kind,ev.route,ev.target,ev.campaign,ev.last_section,ev.depth);}
function analytics(days=30){const since=`-${days} days`;
  const n=db.prepare("SELECT count(*) as n FROM events WHERE at >= datetime('now',?)").get(since).n;
  const sessions=db.prepare("SELECT count(DISTINCT visitor) n FROM events WHERE at>=datetime('now',?)").get(since).n;
  const counts=db.prepare("SELECT kind,count(*) n FROM events WHERE at>=datetime('now',?) GROUP BY kind ORDER BY n DESC").all(since);
  const pages=db.prepare("SELECT route,count(*) n FROM events WHERE kind IN ('page_view','service_view') AND at>=datetime('now',?) GROUP BY route ORDER BY n DESC LIMIT 15").all(since);
  const searches=db.prepare("SELECT target,count(*) n FROM events WHERE kind='search' AND target<>'' AND at>=datetime('now',?) GROUP BY target ORDER BY n DESC LIMIT 15").all(since);
  const exits=db.prepare("SELECT last_section section,count(*) n FROM events WHERE kind='exit' AND last_section<>'' AND at>=datetime('now',?) GROUP BY last_section ORDER BY n DESC LIMIT 12").all(since);
  const depths=db.prepare("SELECT depth,count(*) n FROM events WHERE kind='exit' AND at>=datetime('now',?) GROUP BY depth ORDER BY depth").all(since);
  const campaigns=db.prepare("SELECT campaign,count(DISTINCT visitor) n FROM events WHERE campaign<>'' AND at>=datetime('now',?) GROUP BY campaign ORDER BY n DESC LIMIT 15").all(since);
  const daily=db.prepare("SELECT substr(at,1,10) date,count(DISTINCT visitor) visitors FROM events WHERE at>=datetime('now',?) GROUP BY substr(at,1,10) ORDER BY date").all(since);
  return {days,events:n,visitors:sessions,kinds:counts,pages,searches,exits,depths,campaigns,daily};
}
const cleanup=()=>db.prepare("DELETE FROM events WHERE at < datetime('now','-90 days')").run();
cleanup();
function proposeKnowledge(v){
 const row=db.prepare('SELECT id FROM knowledge_candidates WHERE kind=? AND proposal=? AND status=? LIMIT 1').get(v.kind,v.text,'pending_review');
 if(row)return row.id;
 const r=db.prepare('INSERT INTO knowledge_candidates(kind,proposal,corrected_value,source) VALUES(?,?,?,?)').run(v.kind,v.text,v.corrected_value,v.source);
 return Number(r.lastInsertRowid);
}
function reviewKnowledge(id,status,note=''){
 if(!['approved','rejected'].includes(status))throw Error('Invalid review status');
 const record=db.prepare('SELECT * FROM knowledge_candidates WHERE id=?').get(id);
 if(!record||record.status!=='pending_review')return null;
 db.prepare('UPDATE knowledge_candidates SET status=?,reviewed_at=CURRENT_TIMESTAMP,reviewer_note=? WHERE id=? AND status=?').run(status,String(note).slice(0,300),id,'pending_review');
 logAudit('review_knowledge',String(id),status);
 return db.prepare('SELECT * FROM knowledge_candidates WHERE id=?').get(id);
}
// Approval confirms a knowledge candidate, not a database change to a service.
// An administrator must separately publish a verified service edit.
const listKnowledge=(status='pending_review')=>db.prepare('SELECT * FROM knowledge_candidates WHERE status=? ORDER BY id DESC LIMIT 100').all(status);
module.exports={db,fullRows,getService,listSettings,updateService,updateSetting,logAudit,recordEvent,analytics,cleanup,proposeKnowledge,reviewKnowledge,listKnowledge};

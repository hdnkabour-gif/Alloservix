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
function ensureColumn(table,col,def){if(!db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name===col))db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`)}
for(const [col,def] of [['actor_id',"TEXT NOT NULL DEFAULT ''"],['actor_role',"TEXT NOT NULL DEFAULT ''"],['prev_hash',"TEXT NOT NULL DEFAULT ''"],['row_hash',"TEXT NOT NULL DEFAULT ''"]])ensureColumn('audit',col,def);
const sha256=x=>require('node:crypto').createHash('sha256').update(x).digest('hex');
const auditDigest=(prev,r)=>sha256([prev,r.at,r.actor,r.actor_id,r.actor_role,r.action,r.resource,r.details].join('\u241f'));
// Append-only audit with a hash chain: editing or deleting an old row is detectable (verifyAudit).
// actor: optional {email,id,role}; legacy callers keep the default label 'admin'.
function logAudit(action,resource,details='',actor=null){
  const row={at:new Date().toISOString().slice(0,19).replace('T',' '),actor:String(actor?.email||actor?.label||'admin').slice(0,160),actor_id:String(actor?.id||'').slice(0,64),actor_role:String(actor?.role||'').slice(0,20),action:String(action).slice(0,80),resource:String(resource).slice(0,160),details:String(details).slice(0,300)};
  const prev=db.prepare("SELECT row_hash FROM audit WHERE row_hash<>'' ORDER BY id DESC LIMIT 1").get()?.row_hash||'GENESIS';
  db.prepare('INSERT INTO audit(at,actor,actor_id,actor_role,action,resource,details,prev_hash,row_hash) VALUES(?,?,?,?,?,?,?,?,?)').run(row.at,row.actor,row.actor_id,row.actor_role,row.action,row.resource,row.details,prev,auditDigest(prev,row));
}
function verifyAudit(){let prev='GENESIS',checked=0;for(const r of db.prepare("SELECT * FROM audit WHERE row_hash<>'' ORDER BY id").all()){if(r.prev_hash!==prev||auditDigest(r.prev_hash,r)!==r.row_hash)return {ok:false,checked,first_bad_id:r.id};prev=r.row_hash;checked++}return {ok:true,checked,legacy_unchained:db.prepare("SELECT count(*) n FROM audit WHERE row_hash=''").get().n}}
function listAudit({limit=80,offset=0,action='',actor=''}={}){const lim=Math.max(1,Math.min(500,Math.floor(Number(limit))||80)),off=Math.max(0,Math.floor(Number(offset))||0);const where=[],args=[];if(action){where.push('action=?');args.push(String(action).slice(0,80))}if(actor){where.push('actor=?');args.push(String(actor).slice(0,160))}return db.prepare(`SELECT id,at,actor,actor_role,action,resource,details FROM audit ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args,lim,off)}
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
module.exports={db,file,fullRows,getService,listSettings,updateService,updateSetting,logAudit,verifyAudit,listAudit,recordEvent,analytics,cleanup};

'use strict';
// ALLOSERVIX V10 operations. No secrets or PII in public JSON responses.
const crypto=require('node:crypto');
const allowedStatus=['new','review','quoted','approved','assigned','in_progress','completed','cancelled'];
const transitions={new:['review','cancelled'],review:['quoted','approved','cancelled'],quoted:['approved','cancelled'],approved:['assigned','cancelled'],assigned:['in_progress','review','cancelled'],in_progress:['completed','review','cancelled'],completed:[],cancelled:[]};
const serviceTypes=['question','diagnostic','repair','installation','purchase','project','maintenance','other'];
const sectors=['home','villa','shop','workshop','office','company','factory','warehouse','other'];
const channels=['phone','whatsapp','email'];
const levels=['junior','confirmed','expert','specialist'];
const clean=(x,n=120)=>typeof x==='string'?x.trim().slice(0,n):'';
const fail=msg=>{const e=new Error(msg);e.public=true;throw e};
function createOperations(db, options={}) {
  const getKey=()=>{const h=process.env.ALLO_DATA_KEY||options.key||'';if(!/^[0-9a-f]{64}$/i.test(h))fail('Private data encryption is not configured');return Buffer.from(h,'hex')};
  const encrypt=v=>{const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',getKey(),iv);const data=Buffer.concat([cipher.update(JSON.stringify(v),'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64')};
  const decrypt=b=>{const a=Buffer.from(b,'base64');if(a.length<29)throw new Error('Invalid ciphertext');const d=crypto.createDecipheriv('aes-256-gcm',getKey(),a.subarray(0,12));d.setAuthTag(a.subarray(12,28));return JSON.parse(Buffer.concat([d.update(a.subarray(28)),d.final()]).toString('utf8'))};
  const hash=s=>crypto.createHash('sha256').update(String(s)).digest('hex');
  const now=()=>new Date().toISOString();
  db.exec(`
    CREATE TABLE IF NOT EXISTS service_requests (
      id TEXT PRIMARY KEY, tracking_code TEXT NOT NULL UNIQUE, secret_hash TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new',
      type TEXT NOT NULL, sector TEXT NOT NULL, city TEXT NOT NULL, zone TEXT NOT NULL DEFAULT '',
      service_slug TEXT NOT NULL DEFAULT '', title TEXT NOT NULL, description TEXT NOT NULL,
      answers_json TEXT NOT NULL DEFAULT '[]', budget TEXT NOT NULL DEFAULT '',
      preferred_channel TEXT NOT NULL DEFAULT 'phone', private_data TEXT NOT NULL,
      assigned_technician_id TEXT, version INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY(assigned_technician_id) REFERENCES technicians(id)
    );
    CREATE INDEX IF NOT EXISTS idx_requests_created ON service_requests(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_requests_city ON service_requests(city,status);
    CREATE TABLE IF NOT EXISTS technicians (
      id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      city TEXT NOT NULL, zones_json TEXT NOT NULL DEFAULT '[]', remote_available INTEGER NOT NULL DEFAULT 0,
      onsite_available INTEGER NOT NULL DEFAULT 1, years_experience INTEGER NOT NULL DEFAULT 0,
      level TEXT NOT NULL DEFAULT 'junior', verification_status TEXT NOT NULL DEFAULT 'pending',
      contract_status TEXT NOT NULL DEFAULT 'pending', availability_status TEXT NOT NULL DEFAULT 'unavailable',
      active INTEGER NOT NULL DEFAULT 0, capacity INTEGER NOT NULL DEFAULT 1,
      private_data TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_tech_city ON technicians(city,active,verification_status,availability_status);
    CREATE TABLE IF NOT EXISTS technician_skills (
      technician_id TEXT NOT NULL REFERENCES technicians(id), service_slug TEXT NOT NULL,
      level TEXT NOT NULL, verified INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(technician_id,service_slug)
    );
    CREATE TABLE IF NOT EXISTS request_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT NOT NULL REFERENCES service_requests(id),
      created_at TEXT NOT NULL, action TEXT NOT NULL, actor TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
      old_status TEXT NOT NULL DEFAULT '', new_status TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_req_events ON request_events(request_id,id);
  `);
  function isConfigured(){try{getKey();return true}catch{return false}}
  function checkString(x,name,max=200,required=true){const y=clean(x,max+1);if((required&&!y)||(y.length>max))fail('Invalid '+name);return y}
  function validChoice(x,name,arr){if(!arr.includes(x))fail('Invalid '+name);return x}
  const getRequest=id=>db.prepare('SELECT * FROM service_requests WHERE id=? OR tracking_code=?').get(id,id);
  const getTechnician=id=>db.prepare('SELECT * FROM technicians WHERE id=?').get(id);
  const event=(id,action,actor,note='',a='',b='')=>db.prepare('INSERT INTO request_events(request_id,created_at,action,actor,note,old_status,new_status) VALUES(?,?,?,?,?,?,?)').run(id,now(),action,actor,clean(note,500),a,b);
  function createRequest(b,validService){
    getKey();
    if(b.consent!==true)fail('Consent is required');
    const type=validChoice(b.type,'type',serviceTypes),sector=validChoice(b.sector,'sector',sectors),channel=validChoice(b.preferred_channel||'phone','preferred_channel',channels);
    const name=checkString(b.name,'name',100),phone=clean(b.phone,30),email=clean(b.email,160);
    if(!phone&&!email)fail('Phone or email is required');
    if(phone&&!/^\+?[0-9\s().-]{8,24}$/.test(phone))fail('Invalid phone');
    if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail('Invalid email');
    if(channel==='email'&&!email)fail('Email required for email contact');
    if(channel!=='email'&&!phone)fail('Phone required for phone contact');
    const city=checkString(b.city,'city',90),zone=clean(b.zone,100),title=checkString(b.title,'title',140),description=checkString(b.description,'description',2500);
    if(description.length<10)fail('Description too short');
    const service=clean(b.service_slug,100);
    if(service&&!validService(service))fail('Service is not in the catalogue');
    const answers=Array.isArray(b.answers)?b.answers:[];
    if(answers.length>3)fail('Maximum three answers');
    const sanitized=answers.map(a=>{if(!a||typeof a!=='object')fail('Invalid answers');return {question:checkString(a.question,'question',160),answer:checkString(a.answer,'answer',250)}});
    const budget=clean(b.budget,100),id=crypto.randomUUID(),secret=crypto.randomBytes(32).toString('hex');
    // Tracking code is not authentication. Secret is returned only once.
    const tracking_code='AS-'+new Date().toISOString().slice(0,10).replace(/-/g,'')+'-'+crypto.randomBytes(4).toString('hex').toUpperCase();
    const private_data=encrypt({name,phone,email,address:clean(b.address,240),notes:clean(b.notes,600)});
    db.prepare(`INSERT INTO service_requests(id,tracking_code,secret_hash,created_at,updated_at,status,type,sector,city,zone,service_slug,title,description,answers_json,budget,preferred_channel,private_data) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,tracking_code,hash(secret),now(),now(),'new',type,sector,city,zone,service,title,description,JSON.stringify(sanitized),budget,channel,private_data);
    event(id,'created','visitor','','','new');
    return {tracking_code,access_token:secret,status:'new',message:'Request registered for internal review. No appointment or price confirmed.'};
  }
  function publicStatus(code,token){
    if(!/^[A-Z0-9-]{14,40}$/.test(String(code||''))||!/^[a-f0-9]{64}$/.test(String(token||'')))fail('Invalid tracking credentials');
    const r=db.prepare('SELECT tracking_code,secret_hash,status,created_at,updated_at,title,city FROM service_requests WHERE tracking_code=?').get(code);
    const supplied=Buffer.from(hash(token),'hex'),stored=Buffer.from(r?.secret_hash||'0'.repeat(64),'hex');
    if(!crypto.timingSafeEqual(supplied,stored)||!r)fail('Invalid tracking credentials');
    return {tracking_code:r.tracking_code,status:r.status,created_at:r.created_at,updated_at:r.updated_at,title:r.title,city:r.city};
  }
  function adminRequest(r,detail=false){const {secret_hash,private_data,...safe}=r;return {...safe,answers:JSON.parse(r.answers_json),...(detail?{contact:decrypt(private_data),events:db.prepare('SELECT created_at,action,actor,note,old_status,new_status FROM request_events WHERE request_id=? ORDER BY id DESC').all(r.id)}:{})};}
  function listRequests(){return db.prepare('SELECT * FROM service_requests ORDER BY created_at DESC LIMIT 100').all().map(r=>adminRequest(r,false))}
  function requestDetail(id){const r=getRequest(id);return r?adminRequest(r,true):null}
  function changeStatus(id,status,reason='',expected_version){const r=getRequest(id);if(!r)fail('Request not found');validChoice(status,'status',allowedStatus);if(!transitions[r.status].includes(status))fail('Invalid status transition');if(expected_version!==r.version)fail('Record modified; refresh');if(status==='assigned'&&!r.assigned_technician_id)fail('Technician assignment required');db.prepare('UPDATE service_requests SET status=?,updated_at=?,version=version+1 WHERE id=?').run(status,now(),r.id);event(r.id,'status_changed','admin',reason,r.status,status);return requestDetail(r.id)}
  function classifyRequest(id,service_slug,expected_version,validService){
    const r=getRequest(id);if(!r)fail('Request not found');if(r.version!==expected_version)fail('Record modified; refresh');
    if(!validService(service_slug))fail('Service is not in the catalogue');
    if(['completed','cancelled'].includes(r.status))fail('Cannot classify closed request');
    db.prepare('UPDATE service_requests SET service_slug=?,version=version+1,updated_at=? WHERE id=?').run(service_slug,now(),r.id);
    event(r.id,'classified','admin','Service: '+service_slug,r.status,r.status);return requestDetail(r.id);
  }
  function validateSkills(arr,validService){if(!Array.isArray(arr)||arr.length>60)fail('Invalid skills');const ids=new Set();return arr.map(o=>{if(!o||!validService(clean(o.service_slug,100)))fail('Invalid skill');if(ids.has(o.service_slug))fail('Duplicate skill');ids.add(o.service_slug);return {service_slug:o.service_slug,level:validChoice(o.level||'junior','skill level',levels),verified:o.verified===true}})}
  function technicianData(t){const person=decrypt(t.private_data);return {id:t.id,created_at:t.created_at,updated_at:t.updated_at,city:t.city,zones:JSON.parse(t.zones_json),remote_available:!!t.remote_available,onsite_available:!!t.onsite_available,years_experience:t.years_experience,level:t.level,verification_status:t.verification_status,contract_status:t.contract_status,availability_status:t.availability_status,active:!!t.active,capacity:t.capacity,version:t.version,...person,skills:db.prepare('SELECT service_slug,level,verified FROM technician_skills WHERE technician_id=? ORDER BY service_slug').all(t.id).map(s=>({...s,verified:!!s.verified}))}}
  function validateTechnician(b,validService,old){
    if(b.privacy_consent!==true&&!old)fail('Technician privacy acknowledgement is required');
    const city=checkString(b.city,'city',90),name=checkString(b.name,'name',100),phone=clean(b.phone,30),email=clean(b.email,160);
    if(!phone&&!email)fail('Technician phone or email required');if(phone&&!/^\+?[0-9\s().-]{8,24}$/.test(phone))fail('Invalid phone');if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail('Invalid email');
    const zones=Array.isArray(b.zones)?b.zones.map(x=>checkString(x,'zone',90)):[];if(zones.length>40)fail('Too many zones');
    const years=Number(b.years_experience||0),capacity=Number(b.capacity||1);
    if(!Number.isInteger(years)||years<0||years>60||!Number.isInteger(capacity)||capacity<1||capacity>25)fail('Invalid experience or capacity');
    const isTrue=n=>b[n]===true;
    const verification=validChoice(b.verification_status||'pending','verification status',['pending','approved','rejected']),contract=validChoice(b.contract_status||'pending','contract status',['pending','signed','expired']),availability=validChoice(b.availability_status||'unavailable','availability',['available','unavailable','away']);
    const active=isTrue('active');if(active&&(verification!=='approved'||contract!=='signed'))fail('Cannot activate without approval and signed agreement');
    const skills=validateSkills(b.skills||[],validService);
    return {city,name,phone,email,zones,years,capacity,verification,contract,availability,active,level:validChoice(b.level||'junior','level',levels),remote_available:isTrue('remote_available'),onsite_available:isTrue('onsite_available'),skills,
      private_data:{name,phone,email,professional_title:clean(b.professional_title,140),languages:clean(b.languages,240),diplomas:clean(b.diplomas,1200),certifications:clean(b.certifications,1200),tools:clean(b.tools,1200),transport:clean(b.transport,300),working_hours:clean(b.working_hours,300),insurance_reference:clean(b.insurance_reference,200),contract_reference:clean(b.contract_reference,200),business_status:clean(b.business_status,140),internal_notes:clean(b.internal_notes,1200),privacy_consent_at:old?old.privacy_consent_at:now()}};
  }
  function writeSkills(id,skills){db.prepare('DELETE FROM technician_skills WHERE technician_id=?').run(id);const insert=db.prepare('INSERT INTO technician_skills(technician_id,service_slug,level,verified) VALUES(?,?,?,?)');for(const s of skills)insert.run(id,s.service_slug,s.level,Number(s.verified))}
  function saveTechnician(b,validService,id=null){getKey();const existing=id?getTechnician(id):null;if(id&&!existing)fail('Technician not found');if(existing&&b.version!==existing.version)fail('Record modified; refresh');const old=existing?decrypt(existing.private_data):null;const d=validateTechnician(b,validService,old);const private_data=encrypt(d.private_data),ts=now();
    if(existing){db.prepare('UPDATE technicians SET updated_at=?,city=?,zones_json=?,remote_available=?,onsite_available=?,years_experience=?,level=?,verification_status=?,contract_status=?,availability_status=?,active=?,capacity=?,private_data=?,version=version+1 WHERE id=?').run(ts,d.city,JSON.stringify(d.zones),Number(d.remote_available),Number(d.onsite_available),d.years,d.level,d.verification,d.contract,d.availability,Number(d.active),d.capacity,private_data,id)}
    else{id=crypto.randomUUID();db.prepare('INSERT INTO technicians(id,created_at,updated_at,city,zones_json,remote_available,onsite_available,years_experience,level,verification_status,contract_status,availability_status,active,capacity,private_data) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,ts,ts,d.city,JSON.stringify(d.zones),Number(d.remote_available),Number(d.onsite_available),d.years,d.level,d.verification,d.contract,d.availability,Number(d.active),d.capacity,private_data)}
    writeSkills(id,d.skills);return technicianData(getTechnician(id));
  }
  function listTechnicians(){getKey();return db.prepare('SELECT * FROM technicians ORDER BY created_at DESC LIMIT 150').all().map(technicianData)}
  function technicianDetail(id){const t=getTechnician(id);return t?technicianData(t):null}
  function recommend(id){const r=getRequest(id);if(!r)fail('Request not found');
    const t=db.prepare("SELECT * FROM technicians WHERE active=1 AND verification_status='approved' AND contract_status='signed' AND availability_status='available'").all();
    const svc=options.getService?.(r.service_slug);const safety=['fire','automation'].includes(svc?.category);
    return t.map(v=>{const skills=db.prepare('SELECT * FROM technician_skills WHERE technician_id=? AND verified=1').all(v.id);const matching=skills.find(s=>s.service_slug===r.service_slug);if(!matching)return null;const p=decrypt(v.private_data);if(safety&&(matching.level!=='specialist'||!p.certifications||!p.insurance_reference))return null;
      const workload=db.prepare("SELECT count(*) n FROM service_requests WHERE assigned_technician_id=? AND status IN ('assigned','in_progress')").get(v.id).n;if(workload>=v.capacity)return null;const zones=JSON.parse(v.zones_json);const local=v.city.toLocaleLowerCase()===r.city.toLocaleLowerCase()||zones.some(z=>z.toLocaleLowerCase()===r.city.toLocaleLowerCase()||z.toLocaleLowerCase()===r.zone.toLocaleLowerCase());const mode= r.sector==='company'||r.sector==='home'||r.sector==='villa'?v.onsite_available:v.onsite_available||v.remote_available;if(!mode||!local)return null;
      const competence={junior:10,confirmed:20,expert:30,specialist:35}[matching.level]||0,score=competence+(v.city.toLocaleLowerCase()===r.city.toLocaleLowerCase()?25:12)+Math.min(v.years_experience,20)+Math.min(v.capacity,10);
      const name=p.name;return {id:v.id,name,city:v.city,skill:matching.service_slug,skill_level:matching.level,score,reasons:['verified service skill','approved & signed agreement','available',local?'coverage matches':'']}}).filter(Boolean).sort((a,b)=>b.score-a.score);
  }
  function assign(id,technician_id,expected_version){const r=getRequest(id);if(!r)fail('Request not found');if(r.version!==expected_version)fail('Record modified; refresh');if(!['approved','review'].includes(r.status))fail('Request must be approved or in review before assignment');const approved=recommend(id).find(t=>t.id===technician_id);if(!approved)fail('Technician not eligible');db.prepare("UPDATE service_requests SET assigned_technician_id=?,status='assigned',version=version+1,updated_at=? WHERE id=?").run(technician_id,now(),r.id);event(r.id,'assigned','admin','Technician selected by ALLOSERVIX',r.status,'assigned');return requestDetail(r.id)}
  return {isConfigured,createRequest,publicStatus,listRequests,requestDetail,changeStatus,classifyRequest,saveTechnician,listTechnicians,technicianDetail,recommend,assign};
}
module.exports={createOperations,transitions,serviceTypes,sectors};

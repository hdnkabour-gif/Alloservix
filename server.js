'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const store=require('./storage');
const intentEngine=require('./intent-engine');
const aiIntent=require('./ai-intent-router');
const media=require('./media-understanding');
const studio=require('./knowledge-studio').createStudio(store.db,store,JSON.parse(fs.readFileSync(path.join(__dirname,'assets/services.json'),'utf8')).categories.map(c=>c.id));
const operations=require('./operations').createOperations(store.db,{getService:store.getService});
const rbac=require('./rbac');
const {createAuth,totpValid,passwordValid}=require('./auth');
const auth=createAuth(store.db,{audit:(action,resource,details,actor)=>store.logAudit(action,resource,details,actor)});
const catalogue=require('./catalogue-admin').createCatalogue({db:store.db,store,otherOwnerActive:email=>store.db.prepare("SELECT count(*) n FROM staff_accounts WHERE role='owner' AND status='active' AND lower(email)<>lower(?)").get(String(email)).n+(auth.envLoginAllowed()&&String(process.env.ADMIN_EMAIL||'').toLowerCase()!==String(email).toLowerCase()?1:0)>0,categories:JSON.parse(fs.readFileSync(path.join(__dirname,'assets/services.json'),'utf8')).categories});
const {createVault}=require('./auth');
const inquiryVault=createVault(process.env,'alloservix-inquiries-v1');
store.purgeInquiries(process.env.INQUIRY_RETENTION_DAYS);setInterval(()=>store.purgeInquiries(process.env.INQUIRY_RETENTION_DAYS),86400000).unref();
const brain=require('./brain-metrics').createBrainMetrics({db:store.db,intentEngine,languageOf:require('./language-understanding').language,redact:require('./monitor').redact,sanitize:aiIntent.sanitize,aiState:{enabled:aiIntent.enabled,configured:aiIntent.configured,order:aiIntent.order,breakers:()=>aiIntent.breakers()}});
const monitor=require('./monitor').createMonitor({db:store.db,dbFile:store.file,auth});
const root=__dirname,port=Number(process.env.PORT||3000),production=process.env.NODE_ENV==='production';
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.txt':'text/plain; charset=utf-8','.xml':'application/xml; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8'};
const rate=new Map(),rateScale=Math.max(1,Math.min(100,Number(process.env.ADMIN_RATE_SCALE)||1));
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const secureEqual=(a,b)=>{const aa=Buffer.from(String(a)),bb=Buffer.from(String(b));return aa.length===bb.length&&crypto.timingSafeEqual(aa,bb)};
const normalize=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f\u064b-\u065f\u0670\u0640]/g,'').replace(/[أإآ]/g,'ا').replace(/[ى]/g,'ي').replace(/[ة]/g,'ه').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const response=(res,status,obj)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(obj))};
const text=(res,status,body)=>{res.writeHead(status,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});res.end(body)};
async function bodyJson(req,maxBytes=16000){const chunks=[];let total=0;const declared=Number(req.headers['content-length']||0);if(declared>maxBytes)throw Error('Body too large');for await(const chunk of req){total+=chunk.length;if(total>maxBytes)throw Error('Body too large');chunks.push(chunk)}try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')}catch{throw Error('Invalid JSON')}}
// Paid third-party calls must come from our own pages: a browser always sends Origin (or Sec-Fetch-Site) on same-origin POSTs; scripts without it are refused.
function sameOriginStrict(req){const o=req.headers.origin;if(o){try{return new URL(o).host===req.headers.host}catch{return false}}return req.headers['sec-fetch-site']==='same-origin'}
const envInt=(name,def,min,max)=>{const n=Number(process.env[name]);return Number.isFinite(n)?Math.max(min,Math.min(max,Math.floor(n))):def};
// Budget for OUTGOING provider attempts (a single visitor request can try several providers): per-provider and global daily caps.
function providerAllowed(provider){const day=new Date().toISOString().slice(0,10),own=envInt('AI_PROVIDER_DAILY_LIMIT',200,0,5000),all=envInt('AI_DAILY_ATTEMPT_LIMIT',Math.min(1500,envInt('AI_DAILY_LIMIT',40,0,500)*3),0,5000);const q=(sql,...a)=>store.db.prepare(sql).get(...a).n;const base="FROM ai_provider_events WHERE day=? AND error NOT IN ('circuit_open','budget_exhausted')";return q('SELECT count(*) n '+base+' AND provider=?',day,provider)<own&&q('SELECT count(*) n '+base,day)<all}
function originOk(req){const origin=req.headers.origin;if(!origin)return true;try{return new URL(origin).host===req.headers.host}catch{return false}}
function checkRate(bucket,lim,ms){const now=Date.now(),v=rate.get(bucket)||{at:now,n:0};if(now-v.at>ms){v.at=now;v.n=0}v.n++;rate.set(bucket,v);if(rate.size>10000){for(const [k,x] of rate){if(now-x.at>86400000)rate.delete(k)}}return v.n<=lim}
function clientId(req){return String(req.socket.remoteAddress||'unknown').slice(0,80)}
function safeStr(s,max=120){return typeof s==='string'?s.trim().slice(0,max):''}
function safeEvent(body){if(body.consent!==true)return null;const valid=['page_view','service_view','search','assistant','cta','section','exit'];if(!valid.includes(body.kind))return null;
const visitor=safeStr(body.visitor,64);if(!/^[a-f0-9-]{16,64}$/i.test(visitor))return null;
let target=safeStr(body.target,100).replace(/(?:[\w.+-]+@[\w.-]+\.[a-z]{2,}|\+?\d[\d\s().-]{7,}\d)/gi,'[redacted]');
return {visitor,kind:body.kind,route:safeStr(body.route,140).replace(/[^\w\-/.]/g,''),target,campaign:safeStr(body.campaign,60).replace(/[^\w\-]/g,''),last_section:safeStr(body.last_section,70).replace(/[^\w\-]/g,''),depth:[0,25,50,75,100].includes(body.depth)?body.depth:0};}
function systemContext(){const n=q=>store.db.prepare(q).get().n;const configured=aiIntent.configured();return {vaultReady:auth.vaultReady(),ownerMigrated:auth.envConfigured()&&!auth.envLoginAllowed(),envOwnerActive:auth.envConfigured()&&auth.envLoginAllowed(),
  activeOwners:n("SELECT count(*) n FROM staff_accounts WHERE role='owner' AND status='active'")+(auth.envLoginAllowed()?1:0),activeStaff:n("SELECT count(*) n FROM staff_accounts WHERE status='active'")+(auth.envLoginAllowed()?1:0),
  contactEmail:Boolean(store.listSettings().contact_email?.trim()),contactWhatsapp:Boolean(store.listSettings().contact_whatsapp?.trim()),providersConfigured:configured.length,
  flags:{analytics:process.env.ENABLE_ANALYTICS==='true',inquiries:process.env.ENABLE_INQUIRIES==='true',requests:process.env.ENABLE_REQUESTS==='true'&&operations.isConfigured(),ai:aiIntent.enabled()},
  counts:{available:n("SELECT count(*) n FROM services WHERE published=1 AND status='Disponible'"),hidden:n('SELECT count(*) n FROM services WHERE published=0'),concept_approved:n("SELECT count(*) n FROM knowledge_concepts WHERE review_state='approved'"),technicians:n('SELECT count(*) n FROM technicians')}}}
const catalogueApi=require('./catalogue-api').createCatalogueApi({catalogue,store,helpers:{response,bodyJson}});
const brainApi=require('./brain-api').createBrainApi({brain,store,studio,helpers:{response,bodyJson}});
function encryptLegacyData(){const fail=(m,s)=>{const e=new Error(m);e.public=true;e.status=s;return e};if(!inquiryVault.ready()||!operations.isConfigured())throw fail('ALLO_DATA_KEY requise pour chiffrer les données',503);const last=monitor.listSnapshots()[0];if(!last||last.integrity!=='ok'||!last.present||Date.now()-Date.parse(last.at)>3600000)throw fail('Créez d’abord un instantané vérifié (moins d’une heure) : la migration réécrit les données',409);
  let inquiries=0;store.db.exec('SAVEPOINT enc_inquiries');try{for(const r of store.db.prepare("SELECT id,name,email,phone,topic,message FROM inquiries WHERE enc=''").all()){store.db.prepare("UPDATE inquiries SET enc=?,name='[chiffré]',email='',phone='',topic='',message='[chiffré]' WHERE id=?").run(inquiryVault.seal(JSON.stringify({name:r.name,email:r.email,phone:r.phone,topic:r.topic,message:r.message}),'inquiry'),r.id);inquiries++}store.db.exec('RELEASE enc_inquiries')}catch(e){store.db.exec('ROLLBACK TO enc_inquiries');store.db.exec('RELEASE enc_inquiries');throw e}
  return {inquiries,requests:operations.encryptLegacy()}}
const adminApi=require('./admin-api').createAdminApi({auth,store,monitor,systemContext,encryptLegacyData,probeDecrypt:{request:b=>operations.canDecrypt(b),inquiry:b=>{try{inquiryVault.open(b,'inquiry');return true}catch{return false}}},helpers:{response,bodyJson,checkRate,clientId,originOk,rateScale}});
function searchServices(query){return intentEngine.build(query,studio.enrich(store.fullRows())).matches;}
function escapeHtml(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function serviceHtml(s,requestedLang='fr'){
 const lang=['fr','ar','darija','en'].includes(requestedLang)?requestedLang:'fr';
 const arabic=lang==='ar'||lang==='darija';
 const labels={
  fr:{back:'← Retour aux services',subject:'Service à étudier',status:'Sur étude · disponibilité et prix à confirmer',scope:'Ce que nous pouvons étudier',technology:'Technologies possibles',examples:'Exemples de besoins',notice:'Le matériel, les tarifs, les licences et les conditions sont étudiés et confirmés par notre équipe.',help:'Décrire mon besoin →'},
  ar:{back:'العودة إلى الخدمات ←',subject:'خدمة تحتاج إلى دراسة',status:'الخدمة قيد الدراسة · التوفر والسعر غير مؤكدين',scope:'ما الذي يمكننا دراسته؟',technology:'التقنيات المحتملة',examples:'أمثلة على الاحتياجات',notice:'يؤكد الفريق التجهيزات والتكلفة والتراخيص وإمكانية التنفيذ بعد الدراسة.',help:'وصف احتياجي ←'},
  darija:{back:'رجع للخدمات ←',subject:'خدمة خاصها دراسة',status:'الخدمة خاصها دراسة · الثمن والتوفر مازال ما تأكدوش',scope:'شنو نقدروا ندرسو؟',technology:'التقنيات الممكنة',examples:'أمثلة على الاحتياجات',notice:'الفريق غادي يتأكد من المعدات والثمن والشروط والإمكانية من بعد الدراسة.',help:'شرح شنو محتاج ←'},
  en:{back:'← Back to services',subject:'Service requiring review',status:'Subject to review · availability and price not confirmed',scope:'What we can assess',technology:'Possible technologies',examples:'Common needs',notice:'Equipment, prices, licences and feasibility are confirmed by our team following a review.',help:'Describe my needs →'}
 };
 const tx=labels[lang],cats=JSON.parse(fs.readFileSync(path.join(root,'assets/services.json'),'utf8')).categories;
 const category=cats.find(c=>c.id===s.category),cat=arabic?(category?.ar||tx.subject):(category?.fr||tx.subject);
 const name=arabic?(s.ar||s.fr):s.fr,description=arabic?(s.desc_ar||''):s.desc;
 const lis=arr=>(Array.isArray(arr)?arr:[]).map(item=>'<li>'+escapeHtml(item)+'</li>').join('');
 const secondary=lang==='en'?'<p lang="fr"><small>Technical details in French:</small> '+escapeHtml(s.desc)+'</p>':'';
 const frenchLists=arabic||lang==='en'?'<p class="muted" lang="fr">Détails techniques en français / Technical details in French</p>':'';
 const pageDirection=arabic?'rtl':'ltr',pathBack='/constellation-v9/index.html',requestUrl='/request-v10/index.html';
 return `<!doctype html><html lang="${lang==='darija'?'ary':lang}" dir="${pageDirection}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="index,follow"><meta name="theme-color" content="#f7f3ff"><link rel="stylesheet" href="/solution-v8/style.css"><title>${escapeHtml(name)} — ALLOSERVIX</title></head><body class="service-detail-page"><main class="detail-body"><a href="${pathBack}" class="detail-back">${tx.back}</a><p class="detail-kicker">${escapeHtml(cat)}</p><h1>${escapeHtml(name)}</h1><p>${escapeHtml(description||tx.subject)}</p>${secondary}<div class="detail-sheet"><strong>${tx.status}</strong>${frenchLists}<h2>${tx.scope}</h2><ul lang="fr" dir="ltr">${lis(s.includes)}</ul><h2>${tx.technology}</h2><ul lang="fr" dir="ltr">${lis(s.technologies)}</ul><h2>${tx.examples}</h2><ul lang="fr" dir="ltr">${lis(s.problems)}</ul></div><p>${tx.notice}</p><a href="${requestUrl}" class="detail-back">${tx.help}</a></main></body></html>`;
}
function secureHeaders(res,req){res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');res.setHeader('Permissions-Policy','camera=(), microphone=(self), geolocation=()');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");if(production&&req.headers['x-forwarded-proto']==='https')res.setHeader('Strict-Transport-Security','max-age=31536000; includeSubDomains');}
function serveFile(req,res,p){let decoded;try{decoded=decodeURIComponent(p)}catch{return text(res,400,'Bad URL')};if(decoded.includes('\0')||decoded.includes('\\'))return text(res,400,'Invalid');if(/^\/[^/]+\.(?:js|json|py)$/.test(decoded))return text(res,404,'Not found');const dest=path.resolve(root,'.'+decoded);if(!dest.startsWith(root+path.sep))return text(res,403,'Forbidden');if(/(^|\/)(?:\.data|scripts|tests|node_modules)(\/|$)/.test(decoded)||decoded.startsWith('/.')||dest.endsWith('/server.js')||dest.endsWith('/storage.js')||dest.endsWith('/intent-engine.js')||dest.endsWith('/build.py')||dest.endsWith('/data.py')||dest.endsWith('/package.json')||dest.endsWith('/Dockerfile')||dest.endsWith('/README.md'))return text(res,404,'Not found');
if(decoded.startsWith('/admin/')&&!/^\/admin\/[a-z0-9-]+\.(?:html|js|css)$/.test(decoded))return text(res,404,'Not found');
if(decoded.startsWith('/services/')&&decoded.endsWith('.html')){const slug=path.basename(decoded,'.html'),svc=store.getService(slug);if(!svc||!svc.published||svc.status==='Indisponible')return text(res,404,'Not found');const requestedLang=new URL(req.url,'http://localhost').searchParams.get('lang')||'fr';if(['ar','darija','en'].includes(requestedLang)||!fs.existsSync(dest)){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return res.end(serviceHtml(svc,requestedLang));}}
fs.stat(dest,(err,stat)=>{if(err||!stat.isFile()||!types[path.extname(dest)])return text(res,404,'Not found');res.writeHead(200,{'Content-Type':types[path.extname(dest)],'Cache-Control':path.extname(dest)==='.html'?'no-store':'public,max-age=300'});fs.createReadStream(dest).pipe(res)});
}
const server=http.createServer(async(req,res)=>{secureHeaders(res,req);const t0=Date.now();res.on('finish',()=>{try{monitor.recordRequest(req.method,String(req.url||'/').split('?')[0],res.statusCode,Date.now()-t0)}catch{}});try{
  const u=new URL(req.url,'http://localhost'),p=u.pathname,method=req.method;res.setHeader('Cache-Control','no-store');
  if(p==='/health'&&method==='GET')return response(res,200,{ok:true});
  if(p==='/favicon.ico'&&method==='GET'){res.writeHead(302,{'Location':'/assets/favicon.svg','Cache-Control':'public,max-age=3600'});return res.end();}

  if(p==='/admin'&&method==='GET'){res.writeHead(308,{'Location':'/admin/','Cache-Control':'no-store'});return res.end();}
  // QR campaigns and domain homepage open the new guide; preserve /index.html legacy.
  if((p==='/'||p==='/index.html')&&method==='GET'){const src=u.searchParams.get('src');const campaign=['flyer','sticker','business-card'].includes(src)?'?src='+src:'';res.writeHead(302,{'Location':'/constellation-v9/index.html'+campaign,'Cache-Control':'no-store'});return res.end();}
  if(p==='/api/public/catalog'&&method==='GET')return response(res,200,{categories:JSON.parse(fs.readFileSync(path.join(root,'assets/services.json'))).categories,services:store.fullRows().filter(s=>s.published&&s.status!=='Indisponible'),settings:store.listSettings(),features:{analytics:process.env.ENABLE_ANALYTICS==='true',inquiries:process.env.ENABLE_INQUIRIES==='true',ai:aiIntent.enabled(),image_intent:media.imageEnabled(),audio_transcription:media.audioEnabled(),browser_voice:true}});
  if(p.startsWith('/api/public/service/')&&method==='GET'){let slug;try{slug=decodeURIComponent(p.split('/').at(-1))}catch{return response(res,400,{error:'Identifiant de service invalide'})}const s=store.getService(slug);return s&&s.published&&s.status!=='Indisponible'?response(res,200,s):response(res,404,{error:'Not found'});}
  if((p==='/api/public/assistant'||p==='/api/public/diagnose')&&method==='POST'){
    if(!checkRate('assist:'+clientId(req),40,3600000))return response(res,429,{error:'Trop de demandes'});
    const tStart=Date.now(),body=await bodyJson(req),query=safeStr(body.question,500);if(query.length<2)return response(res,400,{error:'Question trop courte'});
    const raw=body.answers&&typeof body.answers==='object'&&!Array.isArray(body.answers)?body.answers:{};
    const answers=Object.fromEntries(Object.entries(raw).filter(([key,val])=>/^(context|detail|goal)$/.test(key)&&typeof val==='string'&&/^[\w-]{1,30}$/.test(val)));
    const catalog=studio.enrich(store.fullRows());
    const analysis=intentEngine.build(query,catalog,answers);
    // Only interpretation goes to vendors, after separate visitor consent.
    // The customer-facing answer is always written by ALLOSERVIX.
    let result=analysis,ai={outcome:'not_requested',provider:''};
    if(body.allow_external_ai===true&&!aiIntent.enabled())ai.outcome='disabled';
    if(aiIntent.enabled()&&body.allow_external_ai===true){
      const day=new Date().toISOString().slice(0,10),requested=Number(process.env.AI_DAILY_LIMIT||40);
      const limit=Number.isFinite(requested)?Math.max(0,Math.min(500,Math.floor(requested))):40;
      const count=store.db.prepare('SELECT count(*) n FROM ai_usage WHERE day=?').get(day).n;
      if(count<limit){
        store.db.prepare('INSERT INTO ai_usage(day) VALUES(?)').run(day);
        const insight=await aiIntent.classify(query,catalog,{onEvent:brain.providerEvent('text'),allowProvider:providerAllowed});
        result=aiIntent.applySuggestion(analysis,insight,catalog,answers);
        ai={outcome:insight?'ok':'failed',provider:insight?.provider||''};
      }else ai.outcome='quota_exhausted';
    }
    brain.recordCall({kind:'text',query,analysis,answers,ai,ms:Date.now()-tStart,capture:body.allow_improvement===true});
    return response(res,200,{...result,engine:'catalogue-grounded'});
  }
  // Ephemeral media intake; the visitor must explicitly approve provider processing.
  if((p==='/api/public/understand-image'||p==='/api/public/transcribe-audio')&&method==='POST'){
    if(!sameOriginStrict(req))return response(res,403,{error:'Origin rejected'});
    const isImage=p==='/api/public/understand-image';
    if(!(isImage?media.imageEnabled():media.audioEnabled()))return response(res,503,{error:'Media assistance not enabled'});
    if(!checkRate((isImage?'image:':'audio:')+clientId(req),isImage?8:6,3600000)||!checkRate('media-global',envInt('MEDIA_HOURLY_LIMIT',60,1,2000),3600000))return response(res,429,{error:'Too many media requests'});
    const b=await bodyJson(req,isImage?1800000:2050000);
    if(b.allow_external_processing!==true)return response(res,400,{error:'Explicit media consent required'});
    try{media.parseDataUrl(b.data_url,isImage?'image':'audio')}catch{return response(res,400,{error:'Unsupported or oversized media'})}
    const day=new Date().toISOString().slice(0,10),n=Number(process.env.AI_DAILY_LIMIT||40),max=Number.isFinite(n)?Math.max(0,Math.min(500,Math.floor(n))):40;
    if(store.db.prepare('SELECT count(*) n FROM ai_usage WHERE day=?').get(day).n>=max)return response(res,429,{error:'Daily AI budget reached'});
    const kind=isImage?'image':'audio',kindMax=envInt(isImage?'AI_IMAGE_DAILY_LIMIT':'AI_AUDIO_DAILY_LIMIT',20,0,500);
    if(store.db.prepare('SELECT count(*) n FROM ai_usage WHERE day=? AND kind=?').get(day,kind).n>=kindMax)return response(res,429,{error:'Daily '+kind+' budget reached'});
    store.db.prepare('INSERT INTO ai_usage(day,kind) VALUES(?,?)').run(day,kind);
    const tMedia=Date.now(),onEvent=brain.providerEvent(kind);
    const result=isImage?await media.analyzeImage(b.data_url,{lang:b.lang==='ar'?'ar':'fr',onEvent,allowProvider:providerAllowed}):await media.transcribeAudio(b.data_url,{onEvent,allowProvider:providerAllowed});
    brain.recordMedia({kind:isImage?'image':'audio',ok:Boolean(result),provider:result?.provider||'',ms:Date.now()-tMedia,confidence:result?.observed?.confidence});
    return result?response(res,200,result):response(res,503,{error:'Media recognition unavailable; describe your need in text'});
  }
  if(p==='/api/public/event'&&method==='POST'){if(process.env.ENABLE_ANALYTICS!=='true')return response(res,503,{error:'Statistiques désactivées'});if(!checkRate('event:'+clientId(req),400,3600000))return response(res,429,{error:'Rate limit'});const obj=safeEvent(await bodyJson(req));if(!obj)return response(res,400,{error:'Invalid event or no consent'});store.recordEvent(obj);res.writeHead(204);return res.end();}
  // V10 customer request lifecycle. Disabled until explicit rollout + encrypted storage key.
  if(p==='/api/public/requests/config'&&method==='GET')return response(res,200,{enabled:process.env.ENABLE_REQUESTS==='true'&&operations.isConfigured(),max_questions:3,photo_upload:false,voice_browser_dependent:true});
  if(p==='/api/public/requests'&&method==='POST'){
    if(process.env.ENABLE_REQUESTS!=='true'||!operations.isConfigured())return response(res,503,{error:'Requests are not activated yet'});
    if(!originOk(req))return response(res,403,{error:'Origin rejected'});
    if(!checkRate('request:'+clientId(req),5,3600000))return response(res,429,{error:'Too many requests'});
    const body=await bodyJson(req);
    const created=operations.createRequest(body,slug=>{const s=store.getService(slug);return !!s&&s.published&&s.status!=='Indisponible'});
    if(created.replayed){store.logAudit('request_retry',created.tracking_code,'public form retry');return response(res,200,created)}
    store.logAudit('request_created',created.tracking_code,'public form');return response(res,201,created);
  }
  if(p.startsWith('/api/public/requests/')&&method==='GET'){
    if(process.env.ENABLE_REQUESTS!=='true'||!operations.isConfigured())return response(res,503,{error:'Requests are not activated yet'});
    if(!checkRate('tracking:'+clientId(req),50,3600000))return response(res,429,{error:'Too many requests'});
    try{return response(res,200,operations.publicStatus(p.split('/').at(-1),req.headers['x-request-token']))}
    catch{return response(res,404,{error:'Request not found or invalid tracking credentials'})}
  }
  if(p==='/api/public/inquiry'&&method==='POST'){if(process.env.ENABLE_INQUIRIES!=='true')return response(res,503,{error:'Collecte de demandes non activée'});if(!checkRate('lead:'+clientId(req),6,3600000))return response(res,429,{error:'Trop de demandes'});const b=await bodyJson(req);if(b.consent!==true)return response(res,400,{error:'Consentement requis'});const name=safeStr(b.name,100),message=safeStr(b.message,3000),email=safeStr(b.email,150),phone=safeStr(b.phone,40),topic=safeStr(b.topic,100);if(!name||message.length<12)return response(res,400,{error:'Nom et description requis'});if(!inquiryVault.ready())return response(res,503,{error:'Collecte indisponible : chiffrement non configuré'});store.db.prepare('INSERT INTO inquiries(name,email,phone,topic,message,enc) VALUES(?,?,?,?,?,?)').run('[chiffré]','','','','[chiffré]',inquiryVault.seal(JSON.stringify({name,email,phone,topic,message}),'inquiry'));return response(res,201,{ok:true});}
  // Security: no administration endpoint is accessible without authenticated session.
  if(p==='/api/admin/login'&&method==='POST'){if(!originOk(req))return response(res,403,{error:'Origin rejected'});if(!auth.anyLoginConfigured())return response(res,503,{error:'Administration non configurée'});const b=await bodyJson(req),email=safeStr(b.email,160).toLowerCase(),pass=typeof b.password==='string'?b.password:'',otp=safeStr(b.totp,10);if(!checkRate('login:'+clientId(req),7*rateScale,900000)||!checkRate('account:'+email,15,900000))return response(res,429,{error:'Trop de tentatives. Réessayez plus tard.'});const {principal}=auth.authenticate(email,pass,otp);const csrf=auth.startSession(principal,res,production);store.logAudit('login','session','',principal);return response(res,200,{authenticated:true,csrf,...auth.publicSession({principal,reauthAt:Date.now()})});}
  if(p==='/api/admin/session'&&method==='GET'){const s=auth.readSession(req);return response(res,200,{authenticated:!!s,csrf:s?.csrf||null,configured:auth.anyLoginConfigured(),...(s?auth.publicSession(s):{})});}
  if(await adminApi.handlePublic(req,res,p,method))return;
  if(p.startsWith('/api/admin/')){const s=auth.readSession(req);if(!s)return response(res,401,{error:'Unauthorized'});if(method!=='GET'&&(!originOk(req)||!secureEqual(req.headers['x-csrf-token']||'',s.csrf)))return response(res,403,{error:'CSRF rejected'});
    // Default deny: every admin route must be declared in rbac.js with the permission it needs.
    const need=rbac.permissionFor(method,p);if(need===null)return response(res,403,{error:'Route non autorisée',code:'forbidden'});
    if(need!=='session'&&!rbac.can(s.principal.role,need))return response(res,403,{error:'Permission refusée',code:'forbidden',required:need});
    if(rbac.needsReauth(method,p)&&!auth.isFresh(s))return response(res,403,{error:'Revérification d’identité requise (mot de passe + code)',code:'reauth_required'});
    const actor=s.principal,A=(action,resource,details)=>store.logAudit(action,resource,details,actor);
    if(await adminApi.handleAuthed(req,res,p,method,s))return;
    if(await catalogueApi.handle(req,res,p,method,s))return;
    if(await brainApi.handle(req,res,p,method,s))return;
    if(p==='/api/admin/logout'&&method==='POST'){auth.endSession(s.key);A('logout','session');res.setHeader('Set-Cookie',`allo_admin=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0${production?'; Secure':''}`);return response(res,200,{ok:true});}
    // Knowledge Studio V11. Only authenticated MFA admin, writes gated by CSRF above.
    if(p==='/api/admin/studio'&&method==='GET')return response(res,200,{categories:JSON.parse(fs.readFileSync(path.join(root,'assets/services.json'),'utf8')).categories,concepts:studio.concepts(),links:studio.links()});
    if(p==='/api/admin/studio/services'&&method==='POST'){
      const b=await bodyJson(req);catalogue.assertNotDuplicate({slug:b&&b.slug,fr:b&&b.fr,ar:b&&b.ar},{force:b&&b.force_duplicate===true&&actor.role==='owner'});const created=studio.createService(b);store.recordRevision(created.slug,{actor,source:'created',note:'Brouillon créé via Knowledge Studio'});
      A('studio_service_draft',created.slug);return response(res,201,{service:created});
    }
    if(p==='/api/admin/studio/concepts'&&method==='POST'){
      const b=await bodyJson(req),created=studio.createConcept(b);
      A('studio_concept_draft',String(created.id));return response(res,201,{concept:created});
    }
    if(p==='/api/admin/studio/links'&&method==='POST'){
      const b=await bodyJson(req),created=studio.createLink(b);
      A('studio_link_draft',String(created.id));return response(res,201,{link:created});
    }
    const studioRoute=/^\/api\/admin\/studio\/(concepts|links)\/([1-9][0-9]{0,8})(\/review)?$/.exec(p);
    if(studioRoute&&method==='PUT'){
      const [,kind,idString,review]=studioRoute,id=Number(idString),b=await bodyJson(req);
      if(kind==='concepts'&&!review){
        const result=studio.updateConcept(id,b);A('studio_concept_update',String(id));
        return response(res,200,{concept:result});
      }
      if(review){
        const result=kind==='concepts'?studio.reviewConcept(id,b.review_state):studio.reviewLink(id,b.review_state);
        A('studio_'+kind+'_review',String(id),String(b.review_state));
        return response(res,200,{result});
      }
    }
    if(p==='/api/admin/ai/status'&&method==='GET'){
      const day=new Date().toISOString().slice(0,10),used=store.db.prepare('SELECT count(*) n FROM ai_usage WHERE day=?').get(day).n;
      const providers=new Set(aiIntent.configured());
      return response(res,200,{providers:['openai','gemini','anthropic','deepseek'].map(name=>({name,key_configured:providers.has(name)})),
        features:{text_intent:aiIntent.enabled(),image_intent:media.imageEnabled(),audio_transcription:media.audioEnabled()},
        usage:{day,used,daily_limit:Math.max(0,Math.min(500,Number(process.env.AI_DAILY_LIMIT||40)||0))},
        note:'Only configuration presence is reported. API secrets are never returned.'});
    }
    // V10 operations and technician files: protected by existing admin session, MFA and CSRF.
    if(p==='/api/admin/ops/config'&&method==='GET')return response(res,200,{encryption_ready:operations.isConfigured(),requests_enabled:process.env.ENABLE_REQUESTS==='true',role:actor.role,can_manage_technicians:rbac.can(actor.role,'technicians.manage'),can_read_technicians:rbac.can(actor.role,'technicians.read'),can_assign:rbac.can(actor.role,'requests.manage')});
    const isTech=actor.role==='technician';
    const techScope=r=>!isTech||(r&&actor.technician_id&&r.assigned_technician_id===actor.technician_id);
    const redactFor=r=>{if(r&&r.contact&&!rbac.can(actor.role,'requests.pii')&&!(isTech&&['assigned','in_progress'].includes(r.status))){const {contact,...rest}=r;return rest}return r};
    if(p==='/api/admin/ops/requests'&&method==='GET')return response(res,200,{requests:operations.listRequests(isTech?{technician_id:actor.technician_id||'-'}:{})});
    if(/^\/api\/admin\/ops\/requests\/[^/]+$/.test(p)&&method==='GET'){
      const x=operations.requestDetail(p.split('/').at(-1));return x&&techScope(x)?response(res,200,{request:redactFor(x)}):response(res,404,{error:'Not found'});
    }
    if(/^\/api\/admin\/ops\/requests\/[^/]+\/classify$/.test(p)&&method==='PUT'){
      const b=await bodyJson(req),updated=operations.classifyRequest(p.split('/').at(-2),b.service_slug,b.version,slug=>!!store.getService(slug));
      A('request_classified',updated.tracking_code,b.service_slug);return response(res,200,{request:redactFor(updated)});
    }
    if(/^\/api\/admin\/ops\/requests\/[^/]+\/candidates$/.test(p)&&method==='GET')return response(res,200,{candidates:operations.recommend(p.split('/').at(-2))});
    if(/^\/api\/admin\/ops\/requests\/[^/]+\/status$/.test(p)&&method==='PUT'){
      const b=await bodyJson(req);if(isTech){const own=operations.requestDetail(p.split('/').at(-2));if(!techScope(own)||!['in_progress','completed'].includes(b.status))return response(res,403,{error:'Action non autorisée pour ce rôle',code:'forbidden'})}const updated=operations.changeStatus(p.split('/').at(-2),b.status,b.note,b.version);
      A('request_status',updated.tracking_code,b.status);return response(res,200,{request:redactFor(updated)});
    }
    if(/^\/api\/admin\/ops\/requests\/[^/]+\/assignment$/.test(p)&&method==='PUT'){
      const b=await bodyJson(req),updated=operations.assign(p.split('/').at(-2),b.technician_id,b.version);
      A('request_assignment',updated.tracking_code,b.technician_id);return response(res,200,{request:redactFor(updated)});
    }
    if(p==='/api/admin/ops/technicians'&&method==='GET')return response(res,200,{technicians:operations.listTechnicians()});
    if(p==='/api/admin/ops/technicians'&&method==='POST'){
      const b=await bodyJson(req),tech=operations.saveTechnician(b,slug=>!!store.getService(slug));
      A('technician_created',tech.id);return response(res,201,{technician:tech});
    }
    if(/^\/api\/admin\/ops\/technicians\/[^/]+$/.test(p)&&method==='GET'){
      const tech=operations.technicianDetail(p.split('/').at(-1));return tech?response(res,200,{technician:tech}):response(res,404,{error:'Not found'});
    }
    if(/^\/api\/admin\/ops\/technicians\/[^/]+$/.test(p)&&method==='PUT'){
      const b=await bodyJson(req),tech=operations.saveTechnician(b,slug=>!!store.getService(slug),p.split('/').at(-1));
      A('technician_updated',tech.id);return response(res,200,{technician:tech});
    }
    // Private unified command center: aggregate business data only; no tokens, PII or deployment secrets.
    if(p==='/api/admin/control-center'&&method==='GET'){
      const sql=store.db;
      const count=query=>sql.prepare(query).get().n;
      const serviceRows=sql.prepare(`SELECT category,COUNT(*) total,SUM(CASE WHEN published=1 THEN 1 ELSE 0 END) published,
          SUM(CASE WHEN status='Disponible' AND published=1 THEN 1 ELSE 0 END) available
          FROM services GROUP BY category ORDER BY total DESC,category`).all();
      const total=count('SELECT count(*) n FROM services');
      const publicServices=count("SELECT count(*) n FROM services WHERE published=1 AND status!='Indisponible'");
      const available=count("SELECT count(*) n FROM services WHERE published=1 AND status='Disponible'");
      const inStudy=count("SELECT count(*) n FROM services WHERE status='Sur étude'");
      const hidden=count("SELECT count(*) n FROM services WHERE published=0");
      const concepts=count('SELECT count(*) n FROM knowledge_concepts'),conceptApproved=count("SELECT count(*) n FROM knowledge_concepts WHERE review_state='approved'");
      const links=count('SELECT count(*) n FROM knowledge_links'),linkApproved=count("SELECT count(*) n FROM knowledge_links WHERE review_state='approved'");
      const requests=count('SELECT count(*) n FROM service_requests');
      const unresolved=count("SELECT count(*) n FROM service_requests WHERE status NOT IN ('completed','cancelled')");
      const technicians=count('SELECT count(*) n FROM technicians'),activeTechs=count("SELECT count(*) n FROM technicians WHERE active=1 AND verification_status='approved' AND contract_status='signed'");
      const inquiryCount=count('SELECT count(*) n FROM inquiries');
      const hasSetting=key=>Boolean(store.listSettings()?.[key]?.trim());
      const configuredAI=aiIntent.configured();
      const day=new Date().toISOString().slice(0,10),used=sql.prepare('SELECT count(*) n FROM ai_usage WHERE day=?').get(day).n;
      const daily=Number(process.env.AI_DAILY_LIMIT||40),limit=Number.isFinite(daily)?Math.max(0,Math.min(500,Math.floor(daily))):40;
      const flags={analytics:process.env.ENABLE_ANALYTICS==='true',
        inquiries:process.env.ENABLE_INQUIRIES==='true',requests:process.env.ENABLE_REQUESTS==='true'&&operations.isConfigured(),
        text_ai:aiIntent.enabled(),image_ai:media.imageEnabled(),audio_ai:media.audioEnabled()};
      return response(res,200,{
        generated_at:new Date().toISOString(),
        catalogue:{total,published:publicServices,available,in_study:inStudy,hidden,categories:serviceRows},
        knowledge:{concepts,concept_approved:conceptApproved,links,link_approved:linkApproved},
        work:{requests,unresolved,technicians,active_technicians:activeTechs,inquiries:inquiryCount},
        intelligence:{configured_providers:['openai','gemini','anthropic','deepseek'].map(name=>({name,key_configured:configuredAI.includes(name)})),
          usage:{day,used,daily_limit:limit},features:{text:flags.text_ai,image:flags.image_ai,audio:flags.audio_ai}},
        website:{public_contact_email_set:hasSetting('contact_email'),public_whatsapp_set:hasSetting('contact_whatsapp'),
          analytics_enabled:flags.analytics,inquiries_enabled:flags.inquiries,requests_enabled:flags.requests},
        security:{mfa_required:true,admin_configured:auth.anyLoginConfigured(),encrypted_requests_ready:operations.isConfigured(),session_hours:8,
          multiple_admin_accounts:(sql.prepare("SELECT count(*) n FROM staff_accounts WHERE status='active'").get().n+(auth.envLoginAllowed()?1:0))>1,rbac_enabled:true,staff_vault_ready:auth.vaultReady(),owner_migrated:auth.envConfigured()&&!auth.envLoginAllowed(),domain_ssl:'check_external_railway'},
        links:{public_site:'/constellation-v9/index.html',catalogue:'/admin/',operations:'/ops-v10/index.html',knowledge:'/brain-studio/index.html',requests:'/request-v10/index.html'}
      });
    }
    if(p==='/api/admin/overview'&&method==='GET')return response(res,200,{analytics:store.analytics(30),total_services:store.fullRows().length,published_services:store.fullRows().filter(x=>x.published).length,inquiries:store.db.prepare('SELECT count(*) n FROM inquiries').get().n,settings:store.listSettings(),features:{analytics:process.env.ENABLE_ANALYTICS==='true',inquiries:process.env.ENABLE_INQUIRIES==='true',ai:aiIntent.enabled()}});
    if(p==='/api/admin/services'&&method==='GET')return response(res,200,{services:store.fullRows()});
    if(p.startsWith('/api/admin/services/')&&method==='PUT'){let slug;try{slug=decodeURIComponent(p.split('/').at(-1))}catch{return response(res,400,{error:'Identifiant de service invalide'})}const body=await bodyJson(req);const current=store.getService(slug);if(current&&((Object.hasOwn(body,'published')&&body.published!==current.published)||(Object.hasOwn(body,'status')&&body.status!==current.status))&&!rbac.can(actor.role,'catalogue.publish'))return response(res,403,{error:'Seul un propriétaire peut publier ou changer la disponibilité',code:'forbidden',required:'catalogue.publish'});if((Object.hasOwn(body,'fr')||Object.hasOwn(body,'ar'))&&current)catalogue.assertNotDuplicate({fr:body.fr??current.fr,ar:body.ar??current.ar,slug},{excludeSlug:slug,force:body.force_duplicate===true});const result=store.updateService(slug,body,{actor,source:'direct-edit',note:typeof body.note==='string'?body.note.slice(0,200):''});if(!result)return response(res,404,{error:'Service introuvable'});A('update_service',slug,JSON.stringify(Object.keys(body)));return response(res,200,{service:result});}
    if(p==='/api/admin/settings'&&method==='PUT'){const b=await bodyJson(req);store.updateSettings(b,keys=>A('update_settings','website',keys.join(',')));return response(res,200,{settings:store.listSettings(),features:{analytics:process.env.ENABLE_ANALYTICS==='true',inquiries:process.env.ENABLE_INQUIRIES==='true',ai:aiIntent.enabled()}});}
    if(p==='/api/admin/inquiries'&&method==='GET')return response(res,200,{inquiries:store.db.prepare('SELECT * FROM inquiries ORDER BY id DESC LIMIT 80').all().map(({enc,...r})=>{if(!enc)return {...r,legacy_plaintext:true};try{return {...r,...JSON.parse(inquiryVault.open(enc,'inquiry')),legacy_plaintext:false}}catch{return {...r,name:'[illisible : clé différente ?]',message:'',legacy_plaintext:false}}})});
    if(p==='/api/admin/audit'&&method==='GET')return response(res,200,{audit:store.listAudit({limit:u.searchParams.get('limit')||80,offset:u.searchParams.get('offset')||0,action:u.searchParams.get('action')||'',actor:u.searchParams.get('actor')||''}),integrity:store.verifyAudit()});
    return response(res,404,{error:'Not found'});
  }
  if(p.startsWith('/api/'))return response(res,404,{error:'Not found'});
  if(method!=='GET'&&method!=='HEAD')return text(res,405,'Method not allowed');
  return serveFile(req,res,p==='/'?'/index.html':p==='/admin'||p==='/admin/'?'/admin/index.html':p);
}catch(e){if(/Body too large/.test(e.message))return response(res,413,{error:'Body too large'});if(e.public||/Invalid JSON|non valide|booléen/.test(e.message))return response(res,e.status||400,{error:e.message,...(e.code?{code:e.code}:{}),...(e.candidates?{candidates:e.candidates}:{}),...(e.conflicts?{conflicts:e.conflicts,current:e.current,base:e.base}:{})});console.error('Server request error',e.message);monitor.recordError(req.method,String(req.url||'/'),500,e);return response(res,500,{error:'Internal server error'});}});
server.listen(port,'0.0.0.0',()=>console.log('ALLOSERVIX V2 listening on',port));
module.exports={server,totpValid,passwordValid,searchServices};

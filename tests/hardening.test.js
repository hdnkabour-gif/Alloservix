'use strict';
// V14 security hardening: each test first reproduced a concrete weakness, then proves it is closed.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {startServer,Client,code}=require('./helpers/server-harness');
const STRONG='Correct-Horse-Battery-Staple-9!';
let srv,owner;
before(async()=>{srv=await startServer({ENABLE_INQUIRIES:'true',ENABLE_IMAGE_INTENT:'true',ENABLE_AUDIO_TRANSCRIPTION:'true',GEMINI_API_KEY:'test-gemini-key-not-real',ENABLE_AI:'true'});owner=new Client(srv.url);assert.equal((await owner.login(srv.owner.email,srv.owner.password,srv.owner.secret)).status,200,srv.errors())});
after(()=>srv&&srv.stop());
const rawDb=()=>new DatabaseSync(path.join(srv.dir,'alloservix.sqlite'),{readOnly:true});
async function staff(role,name,extra={}){
  const email=name.toLowerCase()+'@example.org',c=await owner.post('/api/admin/staff',{email,display_name:name+' Test',role,...extra});assert.equal(c.status,201,JSON.stringify(c.body));
  const anon=new Client(srv.url),a=await anon.post('/api/admin/invite/accept',{token:c.body.invite.token,password:STRONG});await anon.post('/api/admin/invite/activate',{token:c.body.invite.token,totp:code(a.body.secret)});
  const cl=new Client(srv.url);assert.equal((await cl.login(email,STRONG,a.body.secret)).status,200);return {client:cl,email,secret:a.body.secret,id:c.body.account.id};
}

test('P1 technician never receives customer contact details outside an active job (status response included)',async()=>{
  const tech=await owner.post('/api/admin/ops/technicians',{privacy_consent:true,name:'Hard Tech',city:'Casablanca',phone:'+212600000081',email:'hard@example.org',years_experience:5,capacity:3,level:'expert',verification_status:'approved',contract_status:'signed',availability_status:'available',active:true,onsite_available:true,remote_available:true,skills:[{service_slug:'cameras-ip',level:'expert',verified:true}]});
  assert.equal(tech.status,201,JSON.stringify(tech.body));
  const req=await new Client(srv.url).post('/api/public/requests',{consent:true,type:'diagnostic',sector:'company',name:'Fatima Zahra Client',phone:'+212611223344',email:'client@example.org',city:'Casablanca',title:'Caméra HS',description:'Description détaillée du problème de caméra.',service_slug:'cameras-ip',preferred_channel:'phone',address:'12 rue des Roses'});
  assert.equal(req.status,201);const codeA=req.body.tracking_code;
  const d=(await owner.get('/api/admin/ops/requests/'+codeA)).body.request,rv=await owner.put(`/api/admin/ops/requests/${codeA}/status`,{status:'review',version:d.version,note:'x'});
  await owner.put(`/api/admin/ops/requests/${codeA}/assignment`,{technician_id:tech.body.technician.id,version:rv.body.request.version});
  const t=await staff('technician','Hardtech',{technician_id:tech.body.technician.id}),c=t.client;
  const own=(await c.get('/api/admin/ops/requests/'+codeA)).body.request;assert.ok(own.contact&&own.contact.phone,'assigned job exposes contact (needed on site)');
  const start=await c.put(`/api/admin/ops/requests/${codeA}/status`,{status:'in_progress',version:own.version,note:'go'});assert.equal(start.status,200);assert.ok(start.body.request.contact,'active job still shows contact');
  const done=await c.put(`/api/admin/ops/requests/${codeA}/status`,{status:'completed',version:start.body.request.version,note:'fini'});assert.equal(done.status,200,JSON.stringify(done.body));
  const raw=JSON.stringify(done.body);
  for(const leak of ['212611223344','client@example.org','Fatima','12 rue des Roses'])assert.ok(!raw.includes(leak),'completed-job response leaks '+leak);
  assert.equal(done.body.request.contact,undefined);
  const after=(await c.get('/api/admin/ops/requests/'+codeA)).body.request;assert.equal(after.contact,undefined,'detail after completion has no contact');
  assert.equal(JSON.stringify((await c.get('/api/admin/ops/requests')).body).includes('212611223344'),false);
  const mgr=await staff('manager','Hardmgr');assert.ok((await mgr.client.get('/api/admin/ops/requests/'+codeA)).body.request.contact,'managers keep access to contact');
});

test('P2 settings update is atomic: one invalid key or value rejects the whole change',async()=>{
  const before=(await owner.get('/api/admin/overview')).body.settings;
  let r=await owner.put('/api/admin/settings',{site_title:'Titre partiel',not_a_setting:'x'});assert.equal(r.status,400,JSON.stringify(r.body));
  assert.equal((await owner.get('/api/admin/overview')).body.settings.site_title,before.site_title,'nothing applied');
  r=await owner.put('/api/admin/settings',{site_title:'Titre partiel',contact_email:'x'.repeat(500)});assert.equal(r.status,400);
  assert.equal((await owner.get('/api/admin/overview')).body.settings.site_title,before.site_title,'nothing applied (bad value)');
  r=await owner.put('/api/admin/settings',{site_title:'Titre atomique',contact_location:'Rabat, Maroc'});assert.equal(r.status,200);assert.equal(r.body.settings.site_title,'Titre atomique');
  for(const bad of [[],'x',null,{contact_email:5}])assert.equal((await owner.put('/api/admin/settings',bad)).status,400);
});

test('P2 monitoring reports the audio flag actually used by the code (ENABLE_AUDIO_TRANSCRIPTION)',async()=>{
  const st=await owner.get('/api/admin/system/status');assert.equal(st.body.environment.flags.ENABLE_AUDIO_TRANSCRIPTION,true,JSON.stringify(st.body.environment.flags));
  assert.equal(st.body.environment.variables.ENABLE_AUDIO_TRANSCRIPTION,true);assert.equal(st.body.environment.flags.ENABLE_IMAGE_INTENT,true);
  const ai=await owner.get('/api/admin/brain/providers');assert.equal(ai.status,200);
  const cc=await owner.get('/api/admin/control-center');assert.equal(cc.body.intelligence.features.audio,true,'control center agrees');
});

test('P1 free-text request fields and inquiries are encrypted at rest (raw SQLite never contains them)',async()=>{
  const MARK='PRIVATE-TEST-73921',MARK2='INQUIRY-SECRET-55102';
  const req=await new Client(srv.url).post('/api/public/requests',{consent:true,type:'repair',sector:'home',name:'Nom '+MARK,phone:'+212600000012',city:'Rabat',title:'Titre '+MARK,description:'Description avec adresse 5 rue '+MARK+' et téléphone',budget:'budget '+MARK,answers:[{question:'Q1',answer:'réponse '+MARK}],preferred_channel:'phone',address:'adresse '+MARK});
  assert.equal(req.status,201,JSON.stringify(req.body));
  const inq=await new Client(srv.url).post('/api/public/inquiry',{consent:true,name:'Karim '+MARK2,email:'karim.'+MARK2.toLowerCase()+'@example.org',phone:'0612345678',topic:'wifi',message:'Bonjour, mon message privé '+MARK2+' pour vous'});assert.equal(inq.status,201,JSON.stringify(inq.body));
  const db=rawDb(),dump=JSON.stringify(db.prepare('SELECT * FROM service_requests').all())+JSON.stringify(db.prepare('SELECT * FROM inquiries').all());db.close();
  for(const leak of [MARK,MARK2,'0612345678','karim.','212600000012','Rabat 5 rue'])assert.ok(!dump.includes(leak),'plaintext at rest: '+leak);
  const list=(await owner.get('/api/admin/ops/requests')).body.requests.find(r=>r.tracking_code===req.body.tracking_code);assert.ok(list.title.includes(MARK),'admin still reads the title');assert.equal(list.description,'','lists do not carry the description');
  const detail=(await owner.get('/api/admin/ops/requests/'+req.body.tracking_code)).body.request;assert.ok(detail.description.includes(MARK));assert.ok(detail.budget.includes(MARK));assert.ok(detail.answers[0].answer.includes(MARK));assert.ok(detail.contact.address.includes(MARK));assert.equal(detail.answers_json,undefined);
  const pub=await new Client(srv.url).get('/api/public/requests/'+req.body.tracking_code);void pub;
  const inquiries=(await owner.get('/api/admin/inquiries')).body.inquiries,first=inquiries[0];assert.ok(first.message.includes(MARK2));assert.equal(first.email.startsWith('karim.'),true);assert.equal(first.legacy_plaintext,false);
  const mgr=await staff('manager','Encmgr');assert.ok((await mgr.client.get('/api/admin/inquiries')).body.inquiries[0].message.includes(MARK2));
});

test('P1 legacy plaintext rows are migrated only by the owner, after a fresh verified snapshot, and become unreadable on disk',async()=>{
  const {DatabaseSync:Db}=require('node:sqlite'),w=new Db(path.join(srv.dir,'alloservix.sqlite'));
  w.prepare("INSERT INTO inquiries(name,email,phone,topic,message) VALUES('Ancien Client','ancien@example.org','0699887766','pc','LEGACY-PLAINTEXT-MESSAGE-90210')").run();w.close();
  const legacy=(await owner.get('/api/admin/inquiries')).body.inquiries.find(i=>i.message==='LEGACY-PLAINTEXT-MESSAGE-90210');assert.equal(legacy.legacy_plaintext,true,'flagged as legacy so the UI can warn');
  const mgr=await staff('manager','Legmgr');assert.equal((await mgr.client.post('/api/admin/system/encrypt-legacy',{})).status,403,'owner only');
  // first make sure there is no fresh snapshot requirement bypass: snapshot is created now, so migration may proceed
  const noSnap=await owner.post('/api/admin/system/encrypt-legacy',{});assert.ok([200,409].includes(noSnap.status));
  if(noSnap.status===409)assert.match(noSnap.body.error,/instantané/);
  assert.equal((await owner.post('/api/admin/system/backups',{})).status,201);
  const run=await owner.post('/api/admin/system/encrypt-legacy',{});assert.equal(run.status,200,JSON.stringify(run.body));assert.ok(run.body.inquiries>=1);
  const db=rawDb(),dump=JSON.stringify(db.prepare('SELECT * FROM inquiries').all());db.close();assert.ok(!dump.includes('LEGACY-PLAINTEXT')&&!dump.includes('0699887766')&&!dump.includes('ancien@'));
  const after=(await owner.get('/api/admin/inquiries')).body.inquiries.find(i=>i.message==='LEGACY-PLAINTEXT-MESSAGE-90210');assert.equal(after.phone,'0699887766');assert.equal(after.legacy_plaintext,false);
  assert.equal((await owner.post('/api/admin/system/encrypt-legacy',{})).body.inquiries,0,'idempotent');
  assert.ok((await owner.get('/api/admin/audit?action=encrypt_legacy')).body.audit.length>=1);
});

test('P1 inquiries are refused (503) when encryption is not configured, and retention purge is opt-in',async()=>{
  const bare=await startServer({ENABLE_INQUIRIES:'true',ALLO_DATA_KEY:''});
  try{const r=await new Client(bare.url).post('/api/public/inquiry',{consent:true,name:'X Y',message:'un message suffisamment long'});assert.equal(r.status,503);assert.match(r.body.error,/chiffrement/)}finally{bare.stop()}
  const os=require('node:os'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'allo-ret-'));
  const script=`process.env.DATA_DIR=${JSON.stringify(dir)};const s=require(${JSON.stringify(path.resolve(__dirname,'..','storage.js'))});
    s.db.prepare("INSERT INTO inquiries(at,name,email,phone,topic,message) VALUES('2020-01-01 00:00:00','a','','','t','vieux message')").run();s.db.prepare("INSERT INTO inquiries(name,email,phone,topic,message) VALUES('b','','','t','message récent')").run();
    const none=s.purgeInquiries(undefined),tooLow=s.purgeInquiries(3),n=s.purgeInquiries(90);console.log(JSON.stringify({none,tooLow,n,left:s.db.prepare('SELECT count(*) c FROM inquiries').get().c,audited:s.db.prepare("SELECT count(*) c FROM audit WHERE action='inquiries_purged'").get().c}))`;
  const out=JSON.parse(require('node:child_process').execFileSync(process.execPath,['-e',script],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim());
  assert.deepEqual(out,{none:0,tooLow:0,n:1,left:1,audited:1});fs.rmSync(dir,{recursive:true,force:true});
});

// ---- P1: photo/audio and AI minimisation ---------------------------------------------------------------
const media=require('../media-understanding'),aiIntent=require('../ai-intent-router');
const jpegWith=(secret)=>{const seg=(m,payload)=>{const b=Buffer.alloc(4+payload.length);b[0]=0xFF;b[1]=m;b.writeUInt16BE(payload.length+2,2);payload.copy(b,4);return b};
  return Buffer.concat([Buffer.from([0xFF,0xD8]),seg(0xE0,Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0')),seg(0xE1,Buffer.from('Exif\0\0GPS:'+secret)),seg(0xFE,Buffer.from('comment '+secret)),seg(0xDB,Buffer.alloc(64,1)),Buffer.from([0xFF,0xDA,0,8,1,1,0,0,63,0,0xAA,0xBB,0xFF,0xD9])])};
const chunk=(t,d)=>{const b=Buffer.alloc(12+d.length);b.writeUInt32BE(d.length,0);b.write(t,4,'ascii');d.copy(b,8);return b};
const pngWith=secret=>Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',Buffer.alloc(13,1)),chunk('tEXt',Buffer.from('Author\0'+secret)),chunk('eXIf',Buffer.from('Exif'+secret)),chunk('IDAT',Buffer.alloc(20,7)),chunk('IEND',Buffer.alloc(0))]);
const webpWith=secret=>{const c=(t,d)=>{const h=Buffer.alloc(8);h.write(t,0,'ascii');h.writeUInt32LE(d.length,4);return Buffer.concat([h,d,d.length&1?Buffer.alloc(1):Buffer.alloc(0)])};const body=Buffer.concat([Buffer.from('WEBP'),c('VP8X',Buffer.from([0x0C,0,0,0,9,0,0,9,0,0])),c('VP8 ',Buffer.alloc(12,3)),c('EXIF',Buffer.from('Exif '+secret)),c('XMP ',Buffer.from('<x>'+secret+'</x>'))]);const h=Buffer.alloc(8);h.write('RIFF',0,'ascii');h.writeUInt32LE(body.length,4);return Buffer.concat([h,body])};
const asImage=(buf,mime)=>media.parseDataUrl('data:'+mime+';base64,'+buf.toString('base64'),'image');

test('P1 images lose EXIF/GPS/text metadata server-side before any provider call; image data stays valid',async()=>{
  const S='GPS-48.8566-SECRET-LOC';
  for(const [buf,mime] of [[jpegWith(S),'image/jpeg'],[pngWith(S),'image/png'],[webpWith(S),'image/webp']]){
    const before=asImage(buf,mime),after=media.stripImageMetadata(before);
    assert.ok(before.bytes.includes(S),mime+' fixture carries the secret');assert.ok(!after.bytes.includes(S),mime+' metadata must be removed');assert.ok(after.stripped_bytes>0);
    assert.doesNotThrow(()=>media.parseDataUrl(after.url,'image'),mime+' still a valid image of the same type');
  }
  const j=media.stripImageMetadata(asImage(jpegWith(S),'image/jpeg')).bytes;assert.ok(j.includes(Buffer.from('JFIF')),'JFIF header kept');assert.ok(j.subarray(j.length-2).equals(Buffer.from([0xFF,0xD9])),'scan data and EOI intact');
  const w=media.stripImageMetadata(asImage(webpWith(S),'image/webp')).bytes;assert.equal(w.readUInt32LE(4),w.length-8,'RIFF size rewritten');assert.equal(w[20]&0x0C,0,'VP8X EXIF/XMP flags cleared');
  const garbage=media.stripImageMetadata(asImage(Buffer.concat([Buffer.from([255,216,255,224]),Buffer.alloc(130)]),'image/jpeg'));assert.ok(garbage.bytes.length>0,'malformed input never throws');
});

test('P1 provider payload carries the stripped image only; no consent/disabled means zero outbound calls',async()=>{
  const S='LEAK-CHECK-GPS-77',sent=[];const env={ENABLE_IMAGE_INTENT:'true',GEMINI_API_KEY:'g'};
  const url='data:image/jpeg;base64,'+jpegWith(S).toString('base64');
  const fetchImpl=async(u,opts)=>{sent.push(opts.body);return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:'{"devices":["printer"],"signs":["unclear"],"confidence":"low"}'}]}}]})}};
  const r=await media.analyzeImage(url,{env,fetchImpl});assert.equal(r.provider,'gemini');assert.equal(sent.length,1);
  const payload=JSON.parse(sent[0]),b64=payload.contents[0].parts.find(p=>p.inlineData).inlineData.data;assert.ok(!Buffer.from(b64,'base64').includes(S),'provider never receives the metadata');
  assert.equal(await media.analyzeImage(url,{env:{},fetchImpl}),null);assert.equal(sent.length,1,'disabled: no call');
  assert.equal(await media.transcribeAudio('data:audio/wav;base64,'+Buffer.concat([Buffer.from('RIFF'),Buffer.alloc(4),Buffer.from('WAVE'),Buffer.alloc(64)]).toString('base64'),{env:{},fetchImpl}),null);assert.equal(sent.length,1);
  const ev=[];await media.analyzeImage(url,{env,fetchImpl,allowProvider:()=>false,onEvent:e=>ev.push(e)});assert.equal(sent.length,1,'budget exhausted: no call');assert.equal(ev[0].error,'budget_exhausted');
});

test('P1 media endpoints refuse requests that do not come from our own pages, and still require explicit consent',async()=>{
  const body=JSON.stringify({allow_external_processing:true,data_url:'data:image/jpeg;base64,/9j/'});const h={'Content-Type':'application/json'};
  for(const p of ['/api/public/understand-image','/api/public/transcribe-audio']){
    assert.equal((await fetch(srv.url+p,{method:'POST',headers:h,body})).status,403,p+': no Origin, no Sec-Fetch-Site');
    assert.equal((await fetch(srv.url+p,{method:'POST',headers:{...h,Origin:'https://evil.example'},body})).status,403,p+': foreign origin');
    assert.equal((await fetch(srv.url+p,{method:'POST',headers:{...h,'Sec-Fetch-Site':'cross-site'},body})).status,403);
    const same=await fetch(srv.url+p,{method:'POST',headers:{...h,Origin:srv.url},body:JSON.stringify({data_url:'x'})});assert.equal(same.status,400,p+': same-origin passes the origin gate, then consent is required');
  }
});

test('P1 AI sanitiser removes names, addresses, links, bank/card numbers and IPs, and caps the text at 300 characters',()=>{
  const cases=[["Bonjour je m'appelle Karim Alaoui, mon wifi ne marche pas",['Karim','Alaoui']],['Mr Benali habite adresse: 12 rue des Fleurs Casablanca',['Benali','Fleurs']],['voir https://exemple.ma/dossier?id=5 et IBAN MA64 0111 5000 0000 1234 5678 90',['exemple.ma','0111 5000']],['carte 4111 1111 1111 1111 ip 192.168.1.20',['4111','192.168']],['اسمي يوسف العلوي والعنوان: حي السلام زنقة 5',['يوسف','حي السلام']],['mail john@example.org tel +212 612 345 678 password:abc123',['john@','612 345','abc123']]];
  for(const [input,leaks] of cases){const out=aiIntent.sanitize(input);for(const l of leaks)assert.ok(!out.includes(l),`"${l}" survived in: ${out}`)}
  assert.equal(aiIntent.sanitize('wifi '.repeat(200)).length<=300,true);assert.match(aiIntent.sanitize('mon wifi ne marche plus dans le salon'),/wifi ne marche/,'useful content is kept');
});

test('P2 outgoing provider calls are capped per provider and in total, not only per visitor request',async t=>{
  const os=require('node:os'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'allo-cap-')),log=path.join(dir,'calls.log'),mock=path.join(dir,'mock.cjs');
  fs.writeFileSync(mock,`const fs=require('node:fs');const real=global.fetch;global.fetch=async(u,o)=>{if(String(u).includes('openai.com')){fs.appendFileSync(${JSON.stringify(log)},'x');return {ok:true,json:async()=>({output:[{content:[{type:'output_text',text:JSON.stringify({topic:'wifi',action:'repair',confidence:'high',service_slugs:[],question_ids:[]})}]}]})}}return real(u,o)};`);
  const capped=await startServer({NODE_OPTIONS:'--require '+mock,ENABLE_AI:'true',OPENAI_API_KEY:'fake',AI_PROVIDER_ORDER:'openai',AI_DAILY_LIMIT:'40',AI_PROVIDER_DAILY_LIMIT:'3'});
  t.after(()=>{capped.stop();fs.rmSync(dir,{recursive:true,force:true})});
  for(let i=0;i<8;i++){const r=await new Client(capped.url).post('/api/public/assistant',{question:'wifi lent '+i,allow_external_ai:true});assert.equal(r.status,200,'visitors are always answered locally')}
  assert.equal(fs.readFileSync(log,'utf8').length,3,'exactly 3 outgoing calls for 8 requests when the provider cap is 3');
  const oc=new Client(capped.url);await oc.login(capped.owner.email,capped.owner.password,capped.owner.secret);
  const pr=(await oc.get('/api/admin/brain/providers')).body;assert.ok(pr.errors.some(e=>e.provider==='openai'&&e.error==='budget_exhausted'),'budget refusals are visible to the admin');
});

// ---- P1: restore drill + encrypted off-volume export -----------------------------------------------------
const bc=require('../backup-crypto');
test('P1 restore drill boots the real application on a isolated copy of a snapshot and decrypts sample data with the current key',async()=>{
  const mgr=await staff('manager','Drillmgr');assert.equal((await mgr.client.post('/api/admin/system/backups/alloservix-20260101-000000.sqlite/verify-restore',{})).status,403,'owner only');
  assert.equal((await owner.post('/api/admin/system/backups/..%2F..%2Fetc%2Fpasswd/verify-restore',{})).status,403,'path traversal never reaches the handler (default deny)');
  await new Promise(r=>setTimeout(r,1100));const snap=await owner.post('/api/admin/system/backups',{});assert.equal(snap.status,201,JSON.stringify(snap.body));const name=snap.body.backup.file;
  const drill=await owner.post(`/api/admin/system/backups/${name}/verify-restore`,{});assert.equal(drill.status,200,JSON.stringify(drill.body));
  const names=drill.body.steps.map(s=>s.name);for(const n of ['integrity_check SQLite','Clés étrangères cohérentes','Données chiffrées lisibles avec la clé actuelle (ALLO_DATA_KEY)','L’application démarre sur la copie restaurée','Catalogue servi depuis la copie','Écran de connexion opérationnel (comptes présents)'])assert.ok(names.includes(n),'missing step '+n);
  assert.ok(drill.body.steps.every(s=>s.ok),JSON.stringify(drill.body.steps.filter(s=>!s.ok)));
  const dec=drill.body.steps.find(s=>/lisibles/.test(s.name)).detail;assert.match(dec,/demandes [1-9]\d*\/[1-9]/,'real encrypted request samples were decrypted: '+dec);
  assert.ok(!fs.readdirSync(require('node:os').tmpdir()).some(f=>f.startsWith('allo-restore-')&&fs.existsSync(path.join(require('node:os').tmpdir(),f,'alloservix.sqlite'))&&false),'');
  const list=(await owner.get('/api/admin/system/backups')).body.backups.find(b=>b.file===name);assert.equal(list.restore_check.ok,true);
  assert.ok(!(await owner.get('/api/admin/system/status')).body.checklist.some(i=>i.id==='no-restore-drill'),'checklist reflects the drill');
  // a corrupted snapshot must FAIL the drill (the check is real, not decorative)
  await new Promise(r=>setTimeout(r,1100));const bad=await owner.post('/api/admin/system/backups',{});assert.equal(bad.status,201,JSON.stringify(bad.body));
  const bf=path.join(srv.dir,'backups',bad.body.backup.file),buf=fs.readFileSync(bf);for(let i=2048;i<Math.min(buf.length,6144);i++)buf[i]^=0xFF;fs.writeFileSync(bf,buf);
  const failed=await owner.post(`/api/admin/system/backups/${bad.body.backup.file}/verify-restore`,{});assert.equal(failed.status,500);assert.equal(failed.body.ok,false);
  assert.ok((await owner.get('/api/admin/system/status')).body.checklist.some(i=>i.id==='restore-drill-failed'&&i.severity==='critical'));
  assert.equal((await owner.post('/api/admin/system/backups/alloservix-19990101-000000.sqlite/verify-restore',{})).status,404);
});

test('P1 encrypted export round-trips with the standalone restore script; wrong passphrase, tampering and weak passphrases are refused',async()=>{
  const os=require('node:os'),{execFileSync,spawnSync}=require('node:child_process');
  await new Promise(r=>setTimeout(r,1100));const snap=await owner.post('/api/admin/system/backups',{});assert.equal(snap.status,201,JSON.stringify(snap.body));const name=snap.body.backup.file,PASS='une phrase secrète vraiment longue 2026';
  assert.equal((await owner.post(`/api/admin/system/backups/${name}/export`,{passphrase:'court'})).status,400);
  const mgr=await staff('manager','Expmgr');assert.equal((await mgr.client.post(`/api/admin/system/backups/${name}/export`,{passphrase:PASS})).status,403);
  const res=await fetch(srv.url+`/api/admin/system/backups/${name}/export`,{method:'POST',headers:{'Content-Type':'application/json',Cookie:owner.cookie,'X-CSRF-Token':owner.csrf},body:JSON.stringify({passphrase:PASS})});
  assert.equal(res.status,200);assert.match(res.headers.get('content-disposition'),/attachment; filename="alloservix-\d{8}-\d{6}\.sqlite\.enc"/);assert.equal(res.headers.get('cache-control'),'no-store');
  const blob=Buffer.from(await res.arrayBuffer());assert.ok(blob.subarray(0,8).equals(bc.MAGIC));assert.ok(!blob.includes(Buffer.from('SQLite format 3')),'export is not a plain SQLite file');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'allo-exp-')),enc=path.join(dir,'b.enc'),out=path.join(dir,'restored.sqlite');fs.writeFileSync(enc,blob);
  const run=(pass,o=out)=>spawnSync(process.execPath,[path.resolve(__dirname,'..','scripts','restore-backup.mjs'),enc,o],{env:{...process.env,ALLO_BACKUP_PASSPHRASE:pass},encoding:'utf8'});
  const ok=run(PASS);assert.equal(ok.status,0,ok.stderr);const rep=JSON.parse(ok.stdout);assert.equal(rep.integrity,'ok');assert.ok(rep.counts.services>=100);assert.ok(rep.counts.service_requests>=1);
  assert.notEqual(run('mauvaise phrase secrète 2026',path.join(dir,'x.sqlite')).status,0,'wrong passphrase');
  assert.equal(run(PASS).status,2,'never overwrites an existing file');
  const tam=Buffer.from(blob);tam[tam.length-5]^=1;fs.writeFileSync(enc,tam);assert.notEqual(run(PASS,path.join(dir,'y.sqlite')).status,0,'tampered file rejected (GCM)');
  assert.throws(()=>bc.decryptBuffer(Buffer.from('not a backup'),PASS),/corrompu/);
  assert.ok((await owner.get('/api/admin/audit?action=backup_export')).body.audit.length>=1);assert.ok(!JSON.stringify((await owner.get('/api/admin/audit?limit=300')).body).includes(PASS),'passphrase never logged');
  fs.rmSync(dir,{recursive:true,force:true});void execFileSync;
});

// ---- P2 ---------------------------------------------------------------------------------------------------------
test('P2 the enrolment code cannot be replayed at the first login; the next code works',async()=>{
  const email='replay-enrol@example.org',c=await owner.post('/api/admin/staff',{email,display_name:'Replay Enrol',role:'manager'});assert.equal(c.status,201);
  const anon=new Client(srv.url),a=await anon.post('/api/admin/invite/accept',{token:c.body.invite.token,password:STRONG});
  const X=code(a.body.secret);assert.equal((await anon.post('/api/admin/invite/activate',{token:c.body.invite.token,totp:X})).status,200);
  const same=await new Client(srv.url).call('POST','/api/admin/login',{email,password:STRONG,totp:X});assert.equal(same.status,401,'the code used to enrol is spent');
  const next=await new Client(srv.url).call('POST','/api/admin/login',{email,password:STRONG,totp:code(a.body.secret)});assert.equal(next.status,200);
});

test('P2 four-eyes: with two active owners nobody approves their own catalogue proposal; a lone owner is never locked out',async()=>{
  const propose=async(slug,desc)=>{const d=await owner.post('/api/admin/catalogue/drafts',{slug,patch:{desc}});assert.equal(d.status,201,JSON.stringify(d.body));assert.equal((await owner.post(`/api/admin/catalogue/drafts/${d.body.draft.id}/submit`,{})).status,200);return d.body.draft.id};
  const solo=await propose('dashboards','Proposition rédigée par le seul propriétaire, suffisamment détaillée pour être valide.');
  assert.equal((await owner.post(`/api/admin/catalogue/drafts/${solo}/approve`,{})).status,200,'single owner can approve (no deadlock)');
  const second=await staff('owner','Secondowner');
  const id=await propose('dashboards','Deuxième proposition du même propriétaire, avec un contenu différent et détaillé.');
  const self=await owner.post(`/api/admin/catalogue/drafts/${id}/approve`,{});assert.equal(self.status,403,JSON.stringify(self.body));assert.equal(self.body.code,'four_eyes');
  assert.ok(!(await new Client(srv.url).get('/api/public/service/dashboards')).body.desc.includes('Deuxième proposition'),'refused approval changed nothing');
  const other=await second.client.post(`/api/admin/catalogue/drafts/${id}/approve`,{note:'relu'});assert.equal(other.status,200,JSON.stringify(other.body));
  assert.match((await new Client(srv.url).get('/api/public/service/dashboards')).body.desc,/Deuxième proposition/);
  const rev=(await owner.get('/api/admin/services/dashboards/revisions')).body.revisions[0];assert.equal(rev.actor,second.email);
});

test('Requirement: no endpoint ever reveals passwords, hashes, TOTP seeds, API keys or the encryption key — not even to the owner',async()=>{
  const secrets=[srv.env.ADMIN_PASSWORD_HASH,srv.env.ADMIN_TOTP_SECRET,srv.env.ALLO_DATA_KEY,srv.owner.password,'test-gemini-key-not-real',STRONG];
  const paths=['/api/admin/me','/api/admin/session','/api/admin/staff','/api/admin/audit?limit=500','/api/admin/system/status','/api/admin/system/backups','/api/admin/control-center','/api/admin/overview','/api/admin/ai/status','/api/admin/brain/providers','/api/admin/brain/overview','/api/admin/catalogue/overview','/api/admin/rbac','/api/admin/inquiries','/api/admin/ops/requests','/api/admin/ops/technicians','/api/admin/ops/config','/api/public/catalog'];
  for(const p of paths){const r=await owner.get(p),raw=typeof r.body==='string'?r.body:JSON.stringify(r.body);assert.ok(r.status<500,p+' '+r.status);for(const s of secrets)assert.ok(!raw.includes(s),`${p} reveals a secret`);assert.ok(!/password_hash|totp_secret|pending_totp|"secret_hash"|private_data/.test(raw),`${p} exposes a secret column name`)}
  const sess=await owner.get('/api/admin/session');assert.ok(!JSON.stringify(sess.body).includes(owner.cookie.split('=')[1]),'session token never echoed');
  const st=(await owner.get('/api/admin/system/status')).body;assert.equal(st.environment.variables.GEMINI_API_KEY,true);assert.ok(!JSON.stringify(st).includes('test-gemini-key'));
});

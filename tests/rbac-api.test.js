'use strict';
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {startServer,Client,code,root}=require('./helpers/server-harness');
const STRONG='Correct-Horse-Battery-Staple-9!';
let srv,owner;
before(async()=>{srv=await startServer();owner=new Client(srv.url);const r=await owner.login(srv.owner.email,srv.owner.password,srv.owner.secret);assert.equal(r.status,200,srv.errors())});
after(()=>srv&&srv.stop());

// Creates an account through the real API (owner session) and completes the invite flow.
async function staff(role,name,extra={}){
  const email=name.toLowerCase()+'@example.org';
  const c=await owner.post('/api/admin/staff',{email,display_name:name+' Test',role,...extra});assert.equal(c.status,201,JSON.stringify(c.body));
  assert.match(c.body.invite.link,/^\/admin\/#invite=[0-9a-f]{64}$/);
  const token=c.body.invite.token,anon=new Client(srv.url);
  const a=await anon.post('/api/admin/invite/accept',{token,password:STRONG});assert.equal(a.status,200,JSON.stringify(a.body));
  assert.match(a.body.otpauth_uri,/^otpauth:\/\/totp\//);
  const v=await anon.post('/api/admin/invite/activate',{token,totp:code(a.body.secret,{peek:true})});assert.equal(v.status,200,JSON.stringify(v.body));
  const fresh=(await owner.get('/api/admin/staff')).body.accounts.find(x=>x.id===c.body.account.id);
  return {email,secret:a.body.secret,id:fresh.id,version:fresh.version};
}
const login=async(u)=>{const c=new Client(srv.url);const r=await c.login(u.email,STRONG,u.secret);assert.equal(r.status,200,JSON.stringify(r.body));return c};

test('owner session exposes identity, permissions and full role matrix',async()=>{
  const me=await owner.get('/api/admin/me');assert.equal(me.status,200);
  assert.equal(me.body.user.role,'owner');assert.equal(me.body.user.kind,'env');assert.ok(me.body.permissions.includes('staff.manage'));
  const rb=await owner.get('/api/admin/rbac');assert.deepEqual(Object.keys(rb.body.roles).sort(),['manager','owner','technician']);
  const s=await new Client(srv.url).get('/api/admin/session');assert.equal(s.body.authenticated,false);assert.equal(s.body.configured,true);
});

test('unauthenticated, wrong-origin and CSRF-less requests are rejected',async()=>{
  const anon=new Client(srv.url);
  for(const p of ['/api/admin/me','/api/admin/staff','/api/admin/audit','/api/admin/rbac','/api/admin/ops/requests'])assert.equal((await anon.get(p)).status,401,p);
  const noCsrf=new Client(srv.url);noCsrf.cookie=owner.cookie;
  assert.equal((await noCsrf.post('/api/admin/staff',{email:'x@example.org',display_name:'Xx',role:'manager'})).status,403,'CSRF required');
  for(const f of ['/auth.js','/rbac.js','/admin-api.js','/server.js','/storage.js','/tests/helpers/server-harness.js','/.data/alloservix.sqlite'])assert.equal((await anon.get(f)).status,404,'private source must not be served: '+f);
  assert.equal((await anon.get('/admin/core.js')).status,200);assert.equal((await anon.get('/admin/..%2Fserver.js')).status,404);
  const evil=await fetch(srv.url+'/api/admin/invite/accept',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://evil.example'},body:JSON.stringify({token:'0'.repeat(64),password:STRONG})});
  assert.equal(evil.status,403,'cross-origin invite refused');
  const evil2=await fetch(srv.url+'/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://evil.example'},body:'{}'});assert.equal(evil2.status,403);
});

test('default deny: an admin route with no RBAC entry is refused, and every server route is mapped',async()=>{
  assert.equal((await owner.get('/api/admin/does-not-exist')).status,403);
  assert.equal((await owner.call('DELETE','/api/admin/services/cameras-ip')).status,403);
  const src=fs.readFileSync(path.join(root,'server.js'),'utf8')+fs.readFileSync(path.join(root,'admin-api.js'),'utf8');
  const rbac=require('../rbac');
  const probes=[...src.matchAll(/p\s*===\s*'(\/api\/admin\/[a-z0-9\/-]+)'\s*&&\s*method\s*===\s*'(GET|POST|PUT)'/g)].map(m=>[m[2],m[1]]);
  assert.ok(probes.length>=20,'route scan found '+probes.length);
  for(const [method,p] of probes){
    if(['/api/admin/login','/api/admin/session'].includes(p)||p.startsWith('/api/admin/invite/'))continue;
    assert.notEqual(rbac.permissionFor(method,p),null,`${method} ${p} lacks an RBAC entry`);
  }
});

test('manager: can work on catalogue drafts and requests, but not publish, configure, administer or audit',async()=>{
  const m=await staff('manager','Manager');const c=await login(m);
  assert.equal((await c.get('/api/admin/me')).body.user.role,'manager');
  assert.equal((await c.get('/api/admin/control-center')).status,200);
  assert.equal((await c.get('/api/admin/services')).status,200);
  const direct=await c.put('/api/admin/services/cameras-ip',{fr:'Caméras IP — par le gestionnaire'});assert.equal(direct.status,403,'managers cannot edit live content directly');assert.equal(direct.body.required,'catalogue.publish');
  const draft=await c.post('/api/admin/catalogue/drafts',{slug:'cameras-ip',patch:{fr:'Caméras IP — proposé par le gestionnaire'}});assert.equal(draft.status,201,JSON.stringify(draft.body));
  const pub=await c.put('/api/admin/services/cameras-ip',{published:false});assert.equal(pub.status,403);assert.equal(pub.body.required,'catalogue.publish');
  assert.equal((await c.put('/api/admin/services/cameras-ip',{status:'Disponible'})).status,403,'availability change is owner-only');
  for(const [method,p,body] of [['PUT','/api/admin/settings',{site_title:'Hack'}],['POST','/api/admin/staff',{email:'z@example.org',display_name:'Zed',role:'manager'}],['GET','/api/admin/audit'],['GET','/api/admin/audit/verify'],['PUT','/api/admin/studio/concepts/1/review',{review_state:'approved'}]]){
    const r=await c.call(method,p,body);assert.equal(r.status,403,`${method} ${p} must be forbidden for manager (got ${r.status})`);
  }
  const list=await c.get('/api/admin/staff');assert.equal(list.status,200,'manager can see the team list');
  assert.equal((await c.post('/api/admin/staff/'+m.id+'/invite')).status,403);
  const cat=await new Client(srv.url).get('/api/public/catalog');
  assert.equal(cat.body.services.find(s=>s.slug==='cameras-ip').published,true,'manager did not unpublish');
});

test('services whose slug contains accents can be read and edited (URL-encoded)',async()=>{
  const slug='caméras-analogiques',enc=encodeURIComponent(slug);
  assert.equal((await new Client(srv.url).get('/api/public/service/'+enc)).status,200);
  const r=await owner.put('/api/admin/services/'+enc,{fr:'Caméras analogiques HD et DVR'});assert.equal(r.status,200,JSON.stringify(r.body));
  assert.equal((await owner.put('/api/admin/services/%E0%A4%A',{fr:'x'})).status,400,'malformed escape rejected cleanly');
});

test('catalogue workflow over HTTP: propose -> submit -> owner approves; duplicates, conflicts, history, taxonomy',async()=>{
  const m=await staff('manager','Catman'),c=await login(m);
  const slug='ocr-documents';
  const live=(await new Client(srv.url).get('/api/public/service/'+slug)).body;
  const d=await c.post('/api/admin/catalogue/drafts',{slug,patch:{desc:'Nouvelle description proposée pour la reconnaissance de documents, détaillée.'},note:'texte'});assert.equal(d.status,201,JSON.stringify(d.body));
  assert.equal((await c.post('/api/admin/catalogue/drafts',{slug,patch:{published:false}})).status,400,'publication flags cannot be proposed');
  assert.equal((await c.post(`/api/admin/catalogue/drafts/${d.body.draft.id}/approve`,{})).status,403,'manager cannot approve');
  assert.equal((await c.post(`/api/admin/catalogue/drafts/${d.body.draft.id}/submit`,{})).status,200);
  assert.equal((await new Client(srv.url).get('/api/public/service/'+slug)).body.desc,live.desc,'public site unchanged while pending');
  const pending=await owner.get('/api/admin/catalogue/drafts?status=pending_review');assert.ok(pending.body.drafts.some(x=>x.id===d.body.draft.id));
  const ok=await owner.post(`/api/admin/catalogue/drafts/${d.body.draft.id}/approve`,{note:'ok'});assert.equal(ok.status,200,JSON.stringify(ok.body));
  assert.match((await new Client(srv.url).get('/api/public/service/'+slug)).body.desc,/Nouvelle description proposée/);
  const revs=await c.get(`/api/admin/services/${slug}/revisions`);assert.equal(revs.status,200);assert.equal(revs.body.revisions[0].source,'draft#'+d.body.draft.id);assert.equal(revs.body.revisions[0].actor,srv.owner.email);
  const detail=await c.get(`/api/admin/services/${slug}/revisions/${revs.body.revisions[0].rev}`);assert.deepEqual(detail.body.revision.diff_vs_previous.map(x=>x.field),['desc']);
  const rest=await c.post(`/api/admin/services/${slug}/revisions/1/restore`,{});assert.equal(rest.status,201);assert.equal(rest.body.draft.status,'draft');
  // duplicates: direct edit and Knowledge-Studio creation both refuse a clone; owner can force creation
  const wifi=(await owner.get('/api/admin/services')).body.services.find(x=>x.slug==='wifi-professionnel');
  const dup=await owner.put('/api/admin/services/cameras-ip',{fr:wifi.fr});assert.equal(dup.status,409);assert.equal(dup.body.code,'duplicate');assert.equal(dup.body.candidates[0].slug,'wifi-professionnel');
  const clone={slug:'wifi-pro-clone',category:wifi.category,fr:wifi.fr,ar:'عنوان مختلف',desc:'Description',desc_ar:'وصف',terms:'wifi',technologies:[],includes:[],problems:[]};
  assert.equal((await owner.post('/api/admin/studio/services',clone)).status,409);
  assert.equal((await c.post('/api/admin/studio/services',{...clone,force_duplicate:true})).status,409,'manager cannot force');
  const forced=await owner.post('/api/admin/studio/services',{...clone,force_duplicate:true});assert.equal(forced.status,201,JSON.stringify(forced.body));
  assert.equal((await new Client(srv.url).get('/api/public/service/wifi-pro-clone')).status,404,'created hidden');
  assert.ok((await owner.get('/api/admin/services/wifi-pro-clone/revisions')).body.revisions[0].source==='created');
  const chk=await c.get('/api/admin/catalogue/duplicate-check?fr='+encodeURIComponent(wifi.fr));assert.ok(chk.body.candidates.length>=1);
  // analytics endpoints
  assert.ok((await c.get('/api/admin/catalogue/overview')).body.languages.ar.generic>=60);
  const tax=await c.get('/api/admin/catalogue/taxonomy');assert.ok(tax.body.inconsistent>=10);
  assert.equal((await c.post('/api/admin/catalogue/taxonomy/merge',{from:['a'],to:'b'})).status,403,'merging is owner-only');
  const t=tax.body.technologies.find(x=>x.inconsistent),names=t.variants.map(v=>v.name);
  const mg=await owner.post('/api/admin/catalogue/taxonomy/merge',{from:names,to:names[0]});assert.equal(mg.status,200,JSON.stringify(mg.body));assert.ok(mg.body.services_updated>=1);
  assert.ok((await owner.get('/api/admin/catalogue/quality')).body.checked>=100);
  // technicians see none of the governance data
  const tt=await owner.post('/api/admin/ops/technicians',{privacy_consent:true,name:'Cat Tech',city:'Fès',phone:'+212600000055',years_experience:1,capacity:1,level:'junior',verification_status:'pending',contract_status:'pending',availability_status:'unavailable',onsite_available:true,skills:[]});
  const tc=await login(await staff('technician','Cattech',{technician_id:tt.body.technician.id}));
  for(const p of ['/api/admin/catalogue/overview','/api/admin/catalogue/drafts','/api/admin/catalogue/taxonomy','/api/admin/services/ocr-documents/revisions'])assert.equal((await tc.get(p)).status,403,p);
  assert.equal((await tc.get('/api/admin/services')).status,200,'technicians keep read-only catalogue');
});

test('owner can publish; changing availability is audited',async()=>{
  assert.equal((await owner.put('/api/admin/services/cameras-ip',{status:'En préparation'})).status,200);
  assert.equal((await owner.put('/api/admin/services/cameras-ip',{status:'Sur étude'})).status,200);
  const audit=await owner.get('/api/admin/audit?action=update_service');assert.ok(audit.body.audit.some(a=>a.actor===srv.owner.email&&a.actor_role==='owner'));
});

test('sensitive actions require a fresh password+TOTP re-verification (short window server)',async()=>{
  const short=await startServer({ADMIN_REAUTH_SECONDS:'1'});
  try{
    const o=new Client(short.url);assert.equal((await o.login(short.owner.email,short.owner.password,short.owner.secret)).status,200);
    assert.equal((await o.put('/api/admin/settings',{site_title:'ALLOSERVIX'})).status,200,'fresh right after login');
    await new Promise(r=>setTimeout(r,1300));
    const stale=await o.post('/api/admin/staff',{email:'late@example.org',display_name:'Late',role:'manager'});
    assert.equal(stale.status,403);assert.equal(stale.body.code,'reauth_required');
    assert.equal((await o.put('/api/admin/settings',{site_title:'ALLOSERVIX'})).body.code,'reauth_required','settings change also needs fresh identity');
    assert.equal((await o.post('/api/admin/reauth',{password:'wrong-password-value',totp:'000000'})).status,401);
    const ok=await o.post('/api/admin/reauth',{password:short.owner.password,totp:code(short.owner.secret)});assert.equal(ok.status,200,JSON.stringify(ok.body));
    assert.equal((await o.post('/api/admin/staff',{email:'late@example.org',display_name:'Late',role:'manager'})).status,201);
    assert.equal((await o.get('/api/admin/me')).body.fresh_reauth,true);
  }finally{short.stop()}
});

test('technician: object-level access only to own assigned requests, no PII before assignment, no admin areas',async()=>{
  const tech=await owner.post('/api/admin/ops/technicians',{privacy_consent:true,name:'Karim Technicien',city:'Casablanca',phone:'+212600000001',email:'karim@example.org',years_experience:5,capacity:3,
    level:'expert',verification_status:'approved',contract_status:'signed',availability_status:'available',active:true,onsite_available:true,remote_available:true,
    skills:[{service_slug:'cameras-ip',level:'expert',verified:true}]});assert.equal(tech.status,201,JSON.stringify(tech.body));
  const mk=async(title)=>{const r=await new Client(srv.url).post('/api/public/requests',{consent:true,type:'diagnostic',sector:'company',name:'Client '+title,phone:'+212600000009',city:'Casablanca',title,description:'Description suffisamment longue pour valider',service_slug:'cameras-ip',preferred_channel:'phone'});assert.equal(r.status,201,JSON.stringify(r.body));return r.body.tracking_code};
  const codeA=await mk('Demande A'),codeB=await mk('Demande B');
  const detailA=(await owner.get('/api/admin/ops/requests/'+codeA)).body.request;
  const review=await owner.put(`/api/admin/ops/requests/${codeA}/status`,{status:'review',version:detailA.version,note:'triage'});assert.equal(review.status,200,JSON.stringify(review.body));
  const asg=await owner.put(`/api/admin/ops/requests/${codeA}/assignment`,{technician_id:tech.body.technician.id,version:review.body.request.version});assert.equal(asg.status,200,JSON.stringify(asg.body));
  const t=await staff('technician','Karim',{technician_id:tech.body.technician.id});const c=await login(t);
  const list=await c.get('/api/admin/ops/requests');assert.equal(list.status,200);
  assert.deepEqual(list.body.requests.map(r=>r.tracking_code),[codeA],'sees only the request assigned to them');
  const own=await c.get('/api/admin/ops/requests/'+codeA);assert.equal(own.status,200);assert.ok(own.body.request.contact,'assigned job exposes contact for the intervention');
  assert.equal((await c.get('/api/admin/ops/requests/'+codeB)).status,404,'other requests are invisible (404, not 403)');
  const forbidden=[['GET','/api/admin/ops/technicians'],['GET','/api/admin/staff'],['GET','/api/admin/inquiries'],['GET','/api/admin/audit'],['GET','/api/admin/control-center'],['GET','/api/admin/overview'],['GET','/api/admin/studio'],['GET','/api/admin/ai/status'],['PUT','/api/admin/settings',{site_title:'x'}],['PUT','/api/admin/services/cameras-ip',{fr:'Hacked by technician'}],
    ['PUT',`/api/admin/ops/requests/${codeA}/classify`,{service_slug:'cameras-ip',version:1}],['PUT',`/api/admin/ops/requests/${codeA}/assignment`,{technician_id:tech.body.technician.id,version:1}],['GET',`/api/admin/ops/requests/${codeA}/candidates`]];
  for(const [method,p,body] of forbidden)assert.equal((await c.call(method,p,body)).status,403,`${method} ${p}`);
  const wrongStatus=await c.put(`/api/admin/ops/requests/${codeA}/status`,{status:'approved',version:own.body.request.version});assert.equal(wrongStatus.status,403,'technician cannot approve');
  const otherStatus=await c.put(`/api/admin/ops/requests/${codeB}/status`,{status:'in_progress',version:1});assert.equal(otherStatus.status,403,'cannot touch a request assigned to nobody');
  const start=await c.put(`/api/admin/ops/requests/${codeA}/status`,{status:'in_progress',version:own.body.request.version,note:'sur place'});assert.equal(start.status,200,JSON.stringify(start.body));
  assert.equal(start.body.request.status,'in_progress');
  const audit=await owner.get('/api/admin/audit?action=request_status');assert.ok(audit.body.audit.some(a=>a.actor===t.email&&a.actor_role==='technician'),'audit records WHO changed it and with which role');
});

test('invalid technician links and role escalation attempts are refused',async()=>{
  assert.equal((await owner.post('/api/admin/staff',{email:'nolink@example.org',display_name:'No Link',role:'technician'})).status,400);
  assert.equal((await owner.post('/api/admin/staff',{email:'ghost@example.org',display_name:'Ghost',role:'technician',technician_id:'does-not-exist'})).status,400);
  const m=await staff('manager','Escalator');const c=await login(m);
  assert.equal((await c.put('/api/admin/staff/'+m.id,{role:'owner',version:m.version})).status,403,'manager cannot self-promote');
  assert.equal((await c.post('/api/admin/me/migrate/begin',{new_password:STRONG})).status,403,'only owners in env mode');
});

test('login security: uniform errors, TOTP replay, lockout by account',async()=>{
  const u=await staff('manager','Replayer');
  const a=await new Client(srv.url).call('POST','/api/admin/login',{email:u.email,password:'wrong-password-value',totp:code(u.secret,{peek:true})});
  const b=await new Client(srv.url).call('POST','/api/admin/login',{email:'nobody@example.org',password:STRONG,totp:'123456'});
  assert.equal(a.status,401);assert.equal(b.status,401);assert.deepEqual(a.body,b.body,'no account enumeration');
  const used=code(u.secret);
  const first=await new Client(srv.url).call('POST','/api/admin/login',{email:u.email,password:STRONG,totp:used});assert.equal(first.status,200);
  const replay=await new Client(srv.url).call('POST','/api/admin/login',{email:u.email,password:STRONG,totp:used});assert.equal(replay.status,401,'captured code cannot be replayed');
  const v=await staff('manager','Lockme');
  for(let i=0;i<8;i++)await new Client(srv.url).call('POST','/api/admin/login',{email:v.email,password:'bad-bad-bad-bad-bad',totp:'000000'});
  const locked=await new Client(srv.url).call('POST','/api/admin/login',{email:v.email,password:STRONG,totp:code(v.secret)});assert.equal(locked.status,429,'account locked even with correct credentials');
  const list=(await owner.get('/api/admin/staff')).body.accounts.find(x=>x.id===v.id);assert.equal(list.locked,true);
});

test('disabling an account immediately kills its live session',async()=>{
  const u=await staff('manager','Fired');const c=await login(u);assert.equal((await c.get('/api/admin/me')).status,200);
  assert.equal((await owner.put('/api/admin/staff/'+u.id,{status:'disabled',version:u.version})).status,200);
  assert.equal((await c.get('/api/admin/me')).status,401,'session dead at once');
  const again=await new Client(srv.url).call('POST','/api/admin/login',{email:u.email,password:STRONG,totp:code(u.secret,{peek:true})});assert.equal(again.status,401);
});

test('concurrent edits of the same account: exactly one wins (optimistic locking)',async()=>{
  const u=await staff('manager','Racer');
  const [r1,r2]=await Promise.all([owner.put('/api/admin/staff/'+u.id,{display_name:'Racer One',version:u.version}),owner.put('/api/admin/staff/'+u.id,{display_name:'Racer Two',version:u.version})]);
  assert.deepEqual([r1.status,r2.status].sort(),[200,409]);
});

test('password change and MFA rotation from inside the admin (self-service)',async()=>{
  const u=await staff('manager','Rotator');const c=await login(u);
  assert.equal((await c.post('/api/admin/me/password',{current_password:'wrong-password-value',totp:code(u.secret,{peek:true}),new_password:'Another-Strong-Pass-77!'})).status,401);
  assert.equal((await c.post('/api/admin/me/password',{current_password:STRONG,totp:code(u.secret,{peek:true}),new_password:'weak'})).status,400);
  assert.equal((await c.post('/api/admin/me/password',{current_password:STRONG,totp:code(u.secret,{peek:true}),new_password:STRONG})).status,400,'same password refused without burning the code');
  const ch=await c.post('/api/admin/me/password',{current_password:STRONG,totp:code(u.secret),new_password:'Another-Strong-Pass-77!'});assert.equal(ch.status,200,JSON.stringify(ch.body));
  assert.equal((await c.get('/api/admin/me')).status,200,'current session kept');
  const u2=await staff('manager','Rotator2');const c2=await login(u2);
  const begin=await c2.post('/api/admin/me/mfa/begin',{password:STRONG,totp:code(u2.secret)});assert.equal(begin.status,200,JSON.stringify(begin.body));assert.notEqual(begin.body.secret,u2.secret);
  assert.equal((await c2.post('/api/admin/me/mfa/confirm',{totp:'000000'})).status,400);
  assert.equal((await c2.post('/api/admin/me/mfa/confirm',{totp:code(begin.body.secret)})).status,200);
  assert.equal((await c2.get('/api/admin/me')).status,200);
  const oldMfa=await new Client(srv.url).call('POST','/api/admin/login',{email:u2.email,password:STRONG,totp:code(u2.secret,{peek:true})});assert.equal(oldMfa.status,401,'old authenticator dead');
  const newMfa=await new Client(srv.url).call('POST','/api/admin/login',{email:u2.email,password:STRONG,totp:code(begin.body.secret)});assert.equal(newMfa.status,200);
});

test('account reset invalidates credentials; the audit log names the actor and its hash chain verifies',async()=>{
  const u=await staff('manager','Resetme');const c=await login(u);
  const r=await owner.post('/api/admin/staff/'+u.id+'/invite');assert.equal(r.status,200);assert.match(r.body.invite.link,/#invite=/);
  assert.equal((await c.get('/api/admin/me')).status,401);
  const old=await new Client(srv.url).call('POST','/api/admin/login',{email:u.email,password:STRONG,totp:code(u.secret,{peek:true})});assert.equal(old.status,401);
  assert.equal((await owner.get('/api/admin/staff')).body.accounts.find(x=>x.id===u.id).status,'invited');
  const audit=await owner.get('/api/admin/audit?limit=200');
  assert.ok(audit.body.audit.some(a=>a.action==='staff_reset'&&a.actor===srv.owner.email&&a.actor_role==='owner'));
  assert.equal(audit.body.integrity.ok,true);
  const v=await owner.get('/api/admin/audit/verify');assert.equal(v.body.ok,true);assert.ok(v.body.checked>10);
  assert.ok(!JSON.stringify(audit.body).match(/password_hash|totp_secret|pending_totp|Correct-Horse/),'no secrets in the audit');
});

test('staff listing never exposes hashes, TOTP seeds or invite tokens',async()=>{
  const l=await owner.get('/api/admin/staff');assert.equal(l.status,200);assert.ok(l.body.vault_ready);
  const raw=JSON.stringify(l.body);assert.ok(!raw.match(/password_hash|totp_secret|pending_totp|token_hash|"token"/));
  assert.ok(l.body.accounts.length>=5);
});

test('system status: manager reads it, technician cannot, no secret value ever appears, snapshot is owner-only',async()=>{
  const m=await staff('manager','Sysmgr'),t=await owner.post('/api/admin/ops/technicians',{privacy_consent:true,name:'Sys Tech',city:'Rabat',phone:'+212600000077',years_experience:1,capacity:1,level:'junior',verification_status:'pending',contract_status:'pending',availability_status:'unavailable',onsite_available:true,skills:[]});
  const tech=await staff('technician','Systech',{technician_id:t.body.technician.id});
  const mc=await login(m),tc=await login(tech);
  const st=await mc.get('/api/admin/system/status');assert.equal(st.status,200);
  const raw=JSON.stringify(st.body);
  for(const secret of [srv.env.ADMIN_PASSWORD_HASH,srv.env.ADMIN_TOTP_SECRET,srv.env.ALLO_DATA_KEY,srv.owner.password])assert.ok(!raw.includes(secret),'secret leaked in system status');
  assert.equal(st.body.environment.variables.ALLO_DATA_KEY,true);assert.ok(st.body.storage.tables.services>=100);assert.equal(st.body.storage.integrity,'ok');
  assert.ok(Array.isArray(st.body.checklist)&&st.body.checklist.some(i=>i.id==='no-backup'));
  assert.equal((await tc.get('/api/admin/system/status')).status,403);
  assert.equal((await tc.post('/api/admin/system/domain-check',{})).status,403);
  assert.equal((await mc.post('/api/admin/system/backups',{})).status,403,'manager cannot snapshot');
  const snap=await owner.post('/api/admin/system/backups',{});assert.equal(snap.status,201,JSON.stringify(snap.body));assert.equal(snap.body.backup.integrity,'ok');assert.equal(snap.body.backup.present,true);
  const list=await mc.get('/api/admin/system/backups');assert.equal(list.body.backups[0].file,snap.body.backup.file);
  assert.ok(!(await mc.get('/api/admin/system/status')).body.checklist.some(i=>i.id==='no-backup'),'checklist updates after a verified snapshot');
  const audit=await owner.get('/api/admin/audit?action=backup_snapshot');assert.ok(audit.body.audit.length>=1);
  const dc=await mc.post('/api/admin/system/domain-check',{});assert.equal(dc.status,200);assert.ok(Array.isArray(dc.body.domains));
});

test('server errors are captured (redacted) and surface in the status page',async()=>{
  const bad=await fetch(srv.url+'/api/public/assistant',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"question":"x"'});assert.equal(bad.status,400);
  const st=await owner.get('/api/admin/system/status');
  assert.ok(st.body.metrics.totals.requests>10);assert.ok(st.body.metrics.totals.s4xx>=1);assert.equal(typeof st.body.errors_last_24h,'number');
  assert.ok(!JSON.stringify(st.body.errors).match(/@|password/i));
});

test('owner migrates from Railway bootstrap credentials to in-app credentials; old ones stop working',async()=>{
  const o=new Client(srv.url);assert.equal((await o.login(srv.owner.email,srv.owner.password,srv.owner.secret)).status,200);
  const NEW='Migrated-Passphrase-Of-The-Founder-1!';
  const begin=await o.post('/api/admin/me/migrate/begin',{new_password:NEW});assert.equal(begin.status,200,JSON.stringify(begin.body));
  assert.equal((await o.post('/api/admin/me/migrate/confirm',{totp:'000000'})).status,400);
  const done=await o.post('/api/admin/me/migrate/confirm',{totp:code(begin.body.secret)});assert.equal(done.status,200,JSON.stringify(done.body));
  assert.equal((await o.get('/api/admin/me')).status,401,'bootstrap session closed');
  assert.equal((await new Client(srv.url).call('POST','/api/admin/login',{email:srv.owner.email,password:srv.owner.password,totp:code(srv.owner.secret,{peek:true})})).status,401,'Railway credentials no longer work');
  const nw=new Client(srv.url),r=await nw.login(srv.owner.email,NEW,begin.body.secret);assert.equal(r.status,200,JSON.stringify(r.body));
  assert.equal((await nw.get('/api/admin/me')).body.user.kind,'staff');
  const cc=await nw.get('/api/admin/control-center');assert.equal(cc.body.security.owner_migrated,true);assert.equal(cc.body.security.multiple_admin_accounts,true);
  const info=await nw.get('/api/admin/staff');assert.equal(info.body.env_owner.migrated,true);
});

test('server logs contain no credentials',async()=>{
  const logs=srv.errors();assert.ok(!logs.includes(STRONG)&&!logs.includes(srv.owner.password)&&!logs.includes(srv.owner.secret));
});

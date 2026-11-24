'use strict';
// #31 launch gate (synthetic data only, isolated server, no e-mail/WhatsApp, no production variable).
// Proves what the CURRENT intake does end to end, and records, as `todo`, what the gate still requires
// but the code does not do yet. A todo that starts passing means the gap was closed.
const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const {startServer,Client}=require('./helpers/server-harness');
let srv,owner;
before(async()=>{srv=await startServer();owner=new Client(srv.url);const r=await owner.login(srv.owner.email,srv.owner.password,srv.owner.secret);assert.equal(r.status,200,srv.errors())});
after(()=>srv&&srv.stop());

const MOBILE={'User-Agent':'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Mobile Safari/537.36'};
const valid=(x={})=>({consent:true,type:'diagnostic',sector:'company',name:'TEST Client Synthétique',phone:'+212600000077',email:'test.client@example.org',
  city:'Casablanca',title:'TEST caméras bureau',description:'TEST synthétique : installer deux caméras IP au bureau',service_slug:'cameras-ip',preferred_channel:'phone',...x});
const submit=(body,headers=MOBILE)=>new Client(srv.url).call('POST','/api/public/requests',body,headers);

test('gate off: config says disabled and a submission is refused with 503',async()=>{
  const off=await startServer({ENABLE_REQUESTS:'false'});
  try{
    const c=new Client(off.url);
    assert.equal((await c.get('/api/public/requests/config')).body.enabled,false);
    assert.equal((await c.call('POST','/api/public/requests',valid(),MOBILE)).status,503);
  }finally{off.stop()}
});

test('gate on: consent is mandatory, invalid input creates no row, and the per-client limit (5/h) also counts refusals',async()=>{
  const own=await startServer();   // its own server: the public limit is per client address (all tests share 127.0.0.1)
  try{
    const adm=new Client(own.url);assert.equal((await adm.login(own.owner.email,own.owner.password,own.owner.secret)).status,200);
    const post=b=>new Client(own.url).call('POST','/api/public/requests',b,MOBILE);
    assert.equal((await new Client(own.url).get('/api/public/requests/config')).body.enabled,true);
    for(const bad of [valid({consent:false}),valid({consent:undefined}),valid({service_slug:'not-in-catalogue'}),valid({phone:'',email:''}),valid({description:'court'})])
      assert.equal((await post(bad)).status,400,JSON.stringify(bad));
    assert.equal((await adm.get('/api/admin/ops/requests')).body.requests.length,0);
    assert.equal((await post(valid())).status,429,'6th attempt within the hour is throttled');
  }finally{own.stop()}
});

test('one synthetic mobile request: private row, admin inbox shows exact service, status audited, tracking needs code AND token',async()=>{
  const r=await submit(valid());assert.equal(r.status,201,JSON.stringify(r.body));
  const {tracking_code,access_token}=r.body;
  assert.match(tracking_code,/^AS-\d{8}-[0-9A-F]{8}$/);assert.match(access_token,/^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(r.body).includes('+212600000077')&&!JSON.stringify(r.body).includes('example.org'),'confirmation exposes no contact data');

  assert.equal((await new Client(srv.url).get('/api/admin/ops/requests')).status,401,'inbox is not public');
  const row=(await owner.get('/api/admin/ops/requests')).body.requests.find(x=>x.tracking_code===tracking_code);
  assert.ok(row,'request visible in the protected inbox');
  assert.equal(row.service_slug,'cameras-ip');assert.equal(row.status,'new');assert.equal(row.preferred_channel,'phone');
  const detail=(await owner.get('/api/admin/ops/requests/'+tracking_code)).body.request;
  assert.equal(detail.contact.phone,'+212600000077');assert.match(detail.description,/deux caméras/);

  const upd=await owner.put(`/api/admin/ops/requests/${tracking_code}/status`,{status:'review',version:detail.version,note:'TEST triage'});
  assert.equal(upd.status,200,JSON.stringify(upd.body));
  assert.ok((await owner.get('/api/admin/audit?action=request_status')).body.audit.some(a=>a.resource===tracking_code),'status change audited');

  const track=(token)=>new Client(srv.url).call('GET','/api/public/requests/'+tracking_code,undefined,token?{'X-Request-Token':token}:{});
  assert.equal((await track(null)).status,404);assert.equal((await track('0'.repeat(64))).status,404);
  const ok=await track(access_token);assert.equal(ok.status,200);assert.equal(ok.body.status,'review');
  assert.ok(!('phone' in ok.body)&&!('email' in ok.body));
});

test('a retry of the SAME submission (lost response) returns the same reference and one row; a different request stays possible',async()=>{
  const sid='sub-'+'a'.repeat(28);
  const body=valid({title:'TEST double tap',phone:'+212600000078',submission_id:sid});
  const a=await submit(body),b=await submit(body);
  assert.equal(a.status,201,JSON.stringify(a.body));assert.equal(b.status,200,JSON.stringify(b.body));
  assert.equal(b.body.tracking_code,a.body.tracking_code,'same reference');
  assert.equal(b.body.replayed,true);
  const rows=(await owner.get('/api/admin/ops/requests')).body.requests.filter(x=>x.tracking_code===a.body.tracking_code);
  assert.equal(rows.length,1,'one row');
  const detail=(await owner.get('/api/admin/ops/requests/'+a.body.tracking_code)).body.request;
  assert.equal(detail.events.filter(e=>e.action==='created').length,1,'one creation event');
  // The response of the first call may never have arrived: the code returned by the retry works.
  const track=t=>new Client(srv.url).call('GET','/api/public/requests/'+a.body.tracking_code,undefined,{'X-Request-Token':t});
  assert.equal((await track(b.body.access_token)).status,200);
  // Same submission id with different content is refused (409), not silently merged.
  assert.equal((await submit({...body,description:'TEST autre contenu sous le même identifiant'})).status,409);
});

test('the inbox keeps language, allowlisted campaign source and a server-side consent record',async()=>{
  const r=await submit(valid({title:'TEST flyer',source:'flyer',language:'darija',submission_id:'sub-'+'b'.repeat(28)}));assert.equal(r.status,201,JSON.stringify(r.body));
  const row=(await owner.get('/api/admin/ops/requests')).body.requests.find(x=>x.tracking_code===r.body.tracking_code);
  assert.equal(row.campaign_source,'flyer');assert.equal(row.language,'darija');
  assert.match(row.consent_notice_version,/^\d{4}-\d{2}-\d{2}$/);assert.ok(row.consent_at);
  assert.ok(!('submission_hash' in row),'the retry key is never exposed');
});

test('a new request triggers one team alert through a (mock) notifier',{todo:'#31 gap: no notification adapter exists; nothing alerts the team'},async()=>{
  const r=await submit(valid({title:'TEST alerte'}));assert.equal(r.status,201);
  const notes=await owner.get('/api/admin/ops/notifications');
  assert.equal(notes.status,200);assert.ok(notes.body.notifications.some(n=>n.tracking_code===r.body.tracking_code));
});

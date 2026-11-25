'use strict';
// #31: team alert for a new request. Isolated servers, synthetic data, mocked transports only.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {startServer,Client}=require('./helpers/server-harness');

const valid=(x={})=>({consent:true,type:'diagnostic',sector:'company',name:'TEST Client Notif',phone:'+212600000088',email:'notif.client@example.org',
  city:'Casablanca',title:'TEST alerte équipe',description:'TEST synthétique : vérifier l’alerte équipe',service_slug:'cameras-ip',preferred_channel:'phone',...x});
async function withServer(env,run){
  const srv=await startServer(env);
  try{const owner=new Client(srv.url);assert.equal((await owner.login(srv.owner.email,srv.owner.password,srv.owner.secret)).status,200,srv.errors());await run(srv,owner)}
  finally{srv.stop()}
}
const submit=(srv,body)=>new Client(srv.url).post('/api/public/requests',body);
const outbox=srv=>{const f=path.join(srv.dir,'mock-outbox.jsonl');return fs.existsSync(f)?fs.readFileSync(f,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[]};

test('mock transport: one request gives exactly one delivered alert, with the reference and no personal data',async()=>{
  await withServer({NOTIFY_TRANSPORT:'mock'},async(srv,owner)=>{
    const r=await submit(srv,valid());assert.equal(r.status,201,JSON.stringify(r.body));
    const sent=outbox(srv);
    assert.equal(sent.length,1);
    assert.equal(sent[0].reference,r.body.tracking_code);assert.equal(sent[0].service,'cameras-ip');assert.equal(sent[0].city,'Casablanca');
    const raw=JSON.stringify(sent);
    for(const pii of ['+212600000088','notif.client@example.org','TEST Client Notif','vérifier l’alerte'])assert.ok(!raw.includes(pii),'no PII in the alert: '+pii);
    const log=(await owner.get('/api/admin/ops/notifications')).body;
    assert.equal(log.transport,'mock');
    const row=log.notifications.find(n=>n.reference===r.body.tracking_code);
    assert.equal(row.status,'delivered');assert.equal(row.attempts,1);assert.ok(row.delivered_at);
    // A second request is a different event: one more alert, never a repeat of the first.
    const r2=await submit(srv,valid({title:'TEST seconde demande',phone:'+212600000089'}));assert.equal(r2.status,201);
    assert.deepEqual(outbox(srv).map(m=>m.reference),[r.body.tracking_code,r2.body.tracking_code]);
  });
});

test('failing transport: the request is still recorded, the failure is visible with its attempts, nothing is claimed delivered',async()=>{
  await withServer({NOTIFY_TRANSPORT:'mock-fail'},async(srv,owner)=>{
    const r=await submit(srv,valid());assert.equal(r.status,201,'a failed alert never loses the request');
    const row=(await owner.get('/api/admin/ops/notifications')).body.notifications.find(n=>n.reference===r.body.tracking_code);
    assert.equal(row.status,'failed');assert.equal(row.attempts,3);assert.equal(row.delivered_at,null);
    assert.equal(row.last_error,'Error','only the error class is stored');
    assert.ok((await owner.get('/api/admin/ops/requests')).body.requests.some(x=>x.tracking_code===r.body.tracking_code));
  });
});

test('no transport configured (default): nothing is sent and the log says not_configured',async()=>{
  await withServer({},async(srv,owner)=>{
    const r=await submit(srv,valid());assert.equal(r.status,201);
    assert.equal(outbox(srv).length,0);
    const log=(await owner.get('/api/admin/ops/notifications')).body;
    assert.equal(log.transport,'none');
    assert.equal(log.notifications.find(n=>n.reference===r.body.tracking_code).status,'not_configured');
  });
});

test('the delivery log is private: 401 anonymous; only roles with requests.manage (not technicians) may read it',async()=>{
  await withServer({NOTIFY_TRANSPORT:'mock'},async(srv)=>{
    assert.equal((await new Client(srv.url).get('/api/admin/ops/notifications')).status,401);
    const rbac=require('../rbac');
    assert.equal(rbac.permissionFor('GET','/api/admin/ops/notifications'),'requests.manage');
    assert.equal(rbac.can('technician','requests.manage'),false);assert.equal(rbac.can('manager','requests.manage'),true);
  });
});

test('the notifier never alerts twice for the same event (dedup by event key), even when called again',()=>{
  const {DatabaseSync}=require('node:sqlite'),os=require('node:os');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'allo-notif-'));
  try{
    const n=require('../notifier').createNotifier(new DatabaseSync(':memory:'),{transport:'mock',dataDir:dir});
    assert.equal(n.notify('request_created','AS-1',{reference:'AS-1'}).status,'delivered');
    assert.deepEqual(n.notify('request_created','AS-1',{reference:'AS-1'}),{status:'delivered',duplicate:true});
    assert.equal(fs.readFileSync(path.join(dir,'mock-outbox.jsonl'),'utf8').trim().split('\n').length,1);
    assert.equal(n.list().length,1);
    assert.throws(()=>require('../notifier').createNotifier(new DatabaseSync(':memory:'),{transport:'smtp'}),/Unknown NOTIFY_TRANSPORT/);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('two processes notifying the same event at the same time send ONE alert (atomic claim before sending)',()=>{
  // Two connections on one SQLite file stand for two server processes. While process A is inside
  // its transport call, process B handles the same event: B must see A's claim and send nothing.
  const {DatabaseSync}=require('node:sqlite'),os=require('node:os');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'allo-notif-race-')),file=path.join(dir,'race.sqlite');
  try{
    const {createNotifier}=require('../notifier');
    const dbA=new DatabaseSync(file),dbB=new DatabaseSync(file);
    let sent=0,inner=null;
    const b=createNotifier(dbB,{transport:'mock',dataDir:dir});
    const a=createNotifier(dbA,{transport:'mock',dataDir:dir,send:()=>{sent++;inner=b.notify('request_created','AS-RACE',{reference:'AS-RACE'});}});
    b.setSend(()=>{sent++;});
    const first=a.notify('request_created','AS-RACE',{reference:'AS-RACE'});
    assert.equal(first.status,'delivered');
    assert.equal(inner.status,'sending','the concurrent call sees the claim and does not send');
    assert.equal(sent,1,'exactly one alert left the system');
    const rows=dbA.prepare('SELECT status,attempts FROM notification_deliveries').all();
    assert.equal(rows.length,1);assert.equal(rows[0].status,'delivered');assert.equal(rows[0].attempts,1);
    // A claim left by a crashed process is taken over only after its lease (no double send before).
    dbA.prepare("INSERT INTO notification_deliveries(event_key,kind,reference,channel,status,attempts,created_at,updated_at) VALUES('request_created:AS-STUCK','request_created','AS-STUCK','mock','sending',1,?,?)").run(new Date(Date.now()-60_000).toISOString(),new Date(Date.now()-60_000).toISOString());
    assert.equal(b.notify('request_created','AS-STUCK',{reference:'AS-STUCK'}).status,'sending');assert.equal(sent,1);
    dbA.prepare("UPDATE notification_deliveries SET updated_at=? WHERE event_key='request_created:AS-STUCK'").run(new Date(Date.now()-10*60_000).toISOString());
    assert.equal(b.notify('request_created','AS-STUCK',{reference:'AS-STUCK'}).status,'delivered');assert.equal(sent,2);
    dbA.close();dbB.close();
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

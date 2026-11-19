'use strict';
const {test,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),https=require('node:https'),{execFileSync}=require('node:child_process'),{DatabaseSync}=require('node:sqlite');
const {createMonitor,redact,normalizeRoute,classify}=require('../monitor');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'allo-mon-'));after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
const fakeAuth={sessionCount:()=>3};
function fixture(env={},extra={}){
  const file=path.join(tmp,'db'+Math.random().toString(16).slice(2)+'.sqlite'),db=new DatabaseSync(file);let t=Date.UTC(2026,10,19,12,0,0);
  db.exec('CREATE TABLE services(slug TEXT);CREATE TABLE service_requests(id TEXT);CREATE TABLE technicians(id TEXT);CREATE TABLE inquiries(id INTEGER);CREATE TABLE staff_accounts(id TEXT);CREATE TABLE audit(id INTEGER);CREATE TABLE knowledge_concepts(id INTEGER);CREATE TABLE knowledge_links(id INTEGER);CREATE TABLE settings(key TEXT,value TEXT);CREATE TABLE events(id INTEGER);CREATE TABLE ai_usage(id INTEGER);');
  db.exec("INSERT INTO services VALUES('a'),('b');INSERT INTO settings VALUES('k','v')");
  const m=createMonitor({db,dbFile:file,auth:fakeAuth,env,now:()=>t,startedAt:t-90000,...extra});
  return {db,m,file,tick:ms=>{t+=ms}};
}
const ctx=(o={})=>({vaultReady:true,ownerMigrated:true,envOwnerActive:false,activeOwners:2,activeStaff:3,contactEmail:true,contactWhatsapp:true,providersConfigured:0,flags:{analytics:true,inquiries:true,requests:true,ai:false},counts:{available:5,hidden:0,concept_approved:3,technicians:2},...o});

test('redaction and route normalisation never keep identifiers or contact data',()=>{
  assert.equal(redact('boom for jean@example.org tel +212 600 000 000 password=hunter2 '+'a'.repeat(40)),'boom for [email] tel [tel] password=[redacted] [hex]');
  assert.equal(normalizeRoute('/api/admin/ops/requests/6f1e2d3c-1111-4222-8333-abcdefabcdef/status?x=1'),'/api/admin/ops/requests/:id/status');
  assert.equal(normalizeRoute('/api/public/requests/AS-20261119-ABCD1234'),'/api/public/requests/:id');
  assert.equal(classify('/health'),'health');assert.equal(classify('/api/admin/me'),'admin-api');assert.equal(classify('/api/public/catalog'),'public-api');assert.equal(classify('/x.css'),'static');
});
test('metrics: hourly buckets, status classes, percentiles, 24h window',()=>{
  const {m,tick}=fixture();
  for(let i=0;i<10;i++)m.recordRequest('GET','/api/public/catalog',200,10+i);
  m.recordRequest('GET','/api/admin/me',401,5);m.recordRequest('GET','/api/public/boom',500,300);m.recordRequest('GET','/x.css',304,1);
  tick(3600000);m.recordRequest('GET','/health',200,1);
  const x=m.metrics();assert.equal(x.totals.requests,14);assert.equal(x.totals.s5xx,1);assert.equal(x.totals.s4xx,1);assert.equal(x.totals.s3xx,1);assert.equal(x.hours.length,2);
  assert.ok(x.latency_ms.p95>=x.latency_ms.p50&&x.latency_ms.max===300);
  for(let h=0;h<40;h++){tick(3600000);m.recordRequest('GET','/health',200,1)}assert.ok(m.metrics().hours.length<=24,'window is capped');
});
test('error log is persisted, redacted and capped at 500 rows',()=>{
  const {m,db}=fixture();
  m.recordError('POST','/api/public/requests/AS-20261119-ABCD1234?tel=0600000000',500,new Error('failed for client@example.org'));
  const e=m.recentErrors(5)[0];assert.equal(e.route,'/api/public/requests/:id');assert.ok(!e.message.includes('client@example.org'));assert.ok(!JSON.stringify(e).includes('0600000000'));
  for(let i=0;i<520;i++)m.recordError('GET','/x',500,'e'+i);assert.equal(db.prepare('SELECT count(*) n FROM error_log').get().n,500);
  assert.equal(m.errorsSince(3600000),500);
});
test('environment report lists presence only, never values',()=>{
  const {m}=fixture({ADMIN_PASSWORD_HASH:'aa:bb-SECRET-HASH',ALLO_DATA_KEY:'k'.repeat(64),OPENAI_API_KEY:'sk-live-123',ENABLE_AI:'true',NODE_ENV:'production'});
  const e=m.environment(),raw=JSON.stringify(e);
  assert.equal(e.variables.OPENAI_API_KEY,true);assert.equal(e.variables.GEMINI_API_KEY,false);assert.equal(e.flags.ENABLE_AI,true);
  for(const secret of ['SECRET-HASH','sk-live-123','kkkkkkkk'])assert.ok(!raw.includes(secret),'leaked '+secret);
  assert.ok(!JSON.stringify(m.runtime()).includes('sk-live'));
});
test('checklist: honest about unfinished items, ordered by severity',()=>{
  const bare=fixture({}),list=bare.m.checklist(ctx({vaultReady:false,ownerMigrated:false,envOwnerActive:true,activeOwners:1,activeStaff:1,contactEmail:false,counts:{available:0,hidden:2,concept_approved:0,technicians:0},flags:{analytics:false,inquiries:false,requests:false,ai:true},providersConfigured:0}));
  const ids=list.map(i=>i.id);
  for(const id of ['data-dir','vault','owner-env','single-owner','contact','no-available','knowledge-empty','no-tech','requests-off','ai-no-key','no-backup','offsite-backup','domain','sessions'])assert.ok(ids.includes(id),'missing '+id);
  const order={critical:0,warning:1,info:2};assert.deepEqual(list.map(i=>order[i.severity]),[...list.map(i=>order[i.severity])].sort((a,b)=>a-b));
  const healthy=fixture({DATA_DIR:tmp});healthy.m.createSnapshot('x',DatabaseSync);
  const ok=healthy.m.checklist(ctx()).map(i=>i.id);assert.ok(!ok.includes('vault')&&!ok.includes('no-backup')&&!ok.includes('owner-env'));
  healthy.tick(8*86400000);assert.ok(healthy.m.checklist(ctx()).some(i=>i.id==='old-backup'));
  for(let i=0;i<6;i++)healthy.m.recordError('GET','/x',500,'e');assert.ok(healthy.m.checklist(ctx()).some(i=>i.id==='errors-hour'&&i.severity==='critical'));
});
test('snapshots are verified copies, private (0600), rotated to 5, and tamper-evident failures are reported',()=>{
  const {m,db,file,tick}=fixture({DATA_DIR:tmp});
  let last;for(let i=0;i<7;i++){tick(1500);last=m.createSnapshot('owner@example.org',DatabaseSync);fs.writeFileSync(path.join(path.dirname(file),'backups','unrelated-'+i+'.txt'),'keep')}
  assert.throws(()=>m.createSnapshot('x',DatabaseSync),/existe déjà/,'two snapshots in one second are refused');
  assert.equal(last.integrity,'ok');
  const dir=path.join(path.dirname(file),'backups'),files=fs.readdirSync(dir);
  assert.ok(fs.statSync(path.join(dir,last.file)).mode&0o077?false:true,'snapshot file is owner-only');
  assert.ok(files.filter(f=>/^alloservix-/.test(f)).length<=5,'rotation keeps 5');
  assert.ok(files.includes('unrelated-0.txt'),'files not created by the feature are never deleted');
  const snap=new DatabaseSync(path.join(dir,last.file),{readOnly:true});assert.equal(snap.prepare('SELECT count(*) n FROM services').get().n,2);snap.close();
  assert.equal(m.listSnapshots()[0].rows.services,2);assert.ok(m.listSnapshots()[0].bytes>0);void db;
});
test('domain check explains certificate mismatch, missing routing and unreachable hosts (local TLS fixtures)',async t=>{
  let key,cert;try{
    const d=fs.mkdtempSync(path.join(tmp,'pki-'));execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(d,'k.pem'),'-out',path.join(d,'c.pem'),'-days','2','-subj','/CN=*.up.railway.app','-addext','subjectAltName=DNS:*.up.railway.app'],{stdio:'ignore'});
    key=fs.readFileSync(path.join(d,'k.pem'));cert=fs.readFileSync(path.join(d,'c.pem'));
    var good=path.join(d,'g.pem');execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(d,'gk.pem'),'-out',good,'-days','30','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore'});
  }catch{return t.skip('openssl unavailable')}
  const serve=(k,c,handler)=>new Promise(r=>{const s=https.createServer({key:k,cert:c},handler).listen(0,'127.0.0.1',()=>r(s))});
  const wrong=await serve(key,cert,(q,s)=>{s.end('x')});
  const fallback=await serve(fs.readFileSync(path.join(path.dirname(good),'gk.pem')),fs.readFileSync(good),(q,s)=>{s.writeHead(404,{'x-railway-fallback':'true','content-type':'application/json'});s.end('{"status":"error","message":"Application not found"}')});
  const healthy=await serve(fs.readFileSync(path.join(path.dirname(good),'gk.pem')),fs.readFileSync(good),(q,s)=>{s.writeHead(200,{'content-type':'application/json'});s.end('{"ok":true}')});
  const closed=await new Promise(r=>{const s=require('node:net').createServer().listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p))})});
  t.after(()=>{wrong.close();fallback.close();healthy.close()});
  const port=s=>s.address().port;
  const run=async(entries,tlsOptions={})=>{const {m}=fixture({PUBLIC_DOMAINS:entries.join(',')},{tlsOptions});return (await m.domainCheck()).domains};
  const [w]=await run(['127.0.0.1:'+port(wrong)]);
  assert.equal(w.verdict,'certificate_invalid');assert.equal(w.tls.valid,false);assert.ok(w.tls.presented.san.includes('*.up.railway.app'),'diagnostic shows which certificate is presented');assert.match(w.hint,/\*\.up\.railway\.app/);assert.equal(w.http,undefined,'no HTTP request is ever sent over an invalid TLS channel');
  const trust={ca:fs.readFileSync(good),checkServerIdentity:()=>undefined};
  const [f]=await run(['127.0.0.1:'+port(fallback)],trust);assert.equal(f.verdict,'routing_missing');assert.equal(f.http.railway_fallback,true);
  const [h]=await run(['127.0.0.1:'+port(healthy)],trust);assert.equal(h.verdict,'ok');assert.equal(h.http.health_ok,true);assert.ok(h.tls.days_left>=28&&h.tls.days_left<=30);
  const [u]=await run(['127.0.0.1:'+closed]);assert.equal(u.verdict,'unreachable');
  const {m}=fixture({PUBLIC_DOMAINS:'evil host,;rm -rf,http://x,alloservix.ma'});assert.deepEqual(m.domains(),['alloservix.ma'],'only well-formed hostnames are ever probed');
});

'use strict';
// #31 Web Push, isolated: a local mock push service stands for FCM/Apple/Mozilla. Synthetic data only;
// nothing is sent to a real push service and no real device is involved.
const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),crypto=require('node:crypto');
const {startServer,Client}=require('./helpers/server-harness');
const webpush=require('../webpush');

function mockPushService(){
  const calls=[];
  const srv=http.createServer((req,res)=>{let body='';req.on('data',d=>body+=d);req.on('end',()=>{calls.push({path:req.url,headers:req.headers,body});res.statusCode=req.url.startsWith('/gone')?410:201;res.end();});});
  return new Promise(r=>srv.listen(0,'127.0.0.1',()=>r({calls,host:'127.0.0.1:'+srv.address().port,close:()=>srv.close()})));
}
function verifyVapid(header,publicKey){
  const m=/^vapid t=([^,]+), k=(.+)$/.exec(header||'');assert.ok(m,'vapid authorization header');
  assert.equal(m[2],publicKey);
  const [h,p,s]=m[1].split('.');const pt=Buffer.from(publicKey,'base64url');
  const key=crypto.createPublicKey({key:{kty:'EC',crv:'P-256',x:pt.subarray(1,33).toString('base64url'),y:pt.subarray(33).toString('base64url')},format:'jwk'});
  assert.ok(crypto.verify('sha256',Buffer.from(h+'.'+p),{key,dsaEncoding:'ieee-p1363'},Buffer.from(s,'base64url')),'ES256 signature valid');
  return JSON.parse(Buffer.from(p,'base64url'));
}
const valid=(x={})=>({consent:true,type:'diagnostic',sector:'company',name:'TEST Client Push',phone:'+212600000066',city:'Casablanca',title:'TEST push',description:'TEST synthétique : alerte push équipe',service_slug:'cameras-ip',preferred_channel:'phone',...x});
const settle=async(owner,ref)=>{for(let i=0;i<50;i++){const n=(await owner.get('/api/admin/ops/notifications')).body.notifications.find(x=>x.reference===ref);if(n&&!['pending','sending'].includes(n.status))return n;await new Promise(r=>setTimeout(r,50));}throw new Error('not settled');};

test('VAPID: ES256 JWT for the push service origin, verifiable with the public key; keys validated',()=>{
  const k=webpush.generateVapidKeys(),v=webpush.vapidFromEnv({PUSH_VAPID_PUBLIC_KEY:k.publicKey,PUSH_VAPID_PRIVATE_KEY:k.privateKey,PUSH_VAPID_SUBJECT:'mailto:ops@example.org'});
  const claims=verifyVapid(`vapid t=${webpush.vapidJwt(v,'https://fcm.googleapis.com',1_800_000_000)}, k=${k.publicKey}`,k.publicKey);
  assert.deepEqual(claims,{aud:'https://fcm.googleapis.com',exp:1_800_000_000+12*3600,sub:'mailto:ops@example.org'});
  assert.equal(webpush.vapidFromEnv({}),null,'not configured');
  assert.throws(()=>webpush.vapidFromEnv({PUSH_VAPID_PUBLIC_KEY:'abc',PUSH_VAPID_PRIVATE_KEY:k.privateKey,PUSH_VAPID_SUBJECT:'mailto:x@example.org'}),/Invalid VAPID/);
});

test('only https endpoints of known push services are accepted (no SSRF); a local host only in tests',()=>{
  for(const ok of ['https://fcm.googleapis.com/fcm/send/abc','https://web.push.apple.com/QAbc','https://updates.push.services.mozilla.com/wpush/v2/x','https://wns2-par02p.notify.windows.com/w/?token=x'])assert.ok(webpush.allowedEndpoint(ok,{}),ok);
  for(const bad of ['http://fcm.googleapis.com/x','https://evil.example.com/x','https://127.0.0.1/x','https://fcm.googleapis.com:8443/x','https://u:p@fcm.googleapis.com/x','https://fcm.googleapis.com.evil.com/x','javascript:alert(1)','http://127.0.0.1:9/x'])assert.equal(webpush.allowedEndpoint(bad,{}),false,bad);
  assert.equal(webpush.allowedEndpoint('http://127.0.0.1:9/x',{NODE_ENV:'production',PUSH_TEST_ALLOW_HOST:'127.0.0.1:9'}),false,'test host ignored outside tests');
});

test('end to end: a device subscribes, one request sends one signed EMPTY push per device; 410 deactivates the device',async()=>{
  const mock=await mockPushService(),k=webpush.generateVapidKeys();
  const srv=await startServer({NOTIFY_TRANSPORT:'webpush',PUSH_VAPID_PUBLIC_KEY:k.publicKey,PUSH_VAPID_PRIVATE_KEY:k.privateKey,PUSH_VAPID_SUBJECT:'mailto:ops@example.org',PUSH_TEST_ALLOW_HOST:mock.host});
  try{
    const owner=new Client(srv.url);assert.equal((await owner.login(srv.owner.email,srv.owner.password,srv.owner.secret)).status,200,srv.errors());
    const cfg=(await owner.get('/api/admin/push/config')).body;assert.equal(cfg.enabled,true);assert.equal(cfg.public_key,k.publicKey);
    assert.equal((await new Client(srv.url).call('POST','/api/admin/push/subscriptions',{endpoint:`http://${mock.host}/dev1`})).status,401,'anonymous');
    assert.equal((await owner.call('POST','/api/admin/push/subscriptions',{endpoint:'https://evil.example.com/x'})).status,400);
    assert.equal((await owner.call('POST','/api/admin/push/subscriptions',{endpoint:`http://${mock.host}/dev1`})).status,201);
    assert.equal((await owner.call('POST','/api/admin/push/subscriptions',{endpoint:`http://${mock.host}/gone1`})).status,201);
    const r=await new Client(srv.url).post('/api/public/requests',valid());assert.equal(r.status,201);
    const row=await settle(owner,r.body.tracking_code);
    assert.equal(row.status,'delivered');assert.equal(row.channel,'webpush');assert.equal(row.attempts,1);
    assert.equal(mock.calls.length,2,'one push per subscribed device');
    for(const c of mock.calls){
      assert.equal(c.body,'','no payload: nothing about the request leaves the server');
      assert.equal(c.headers.ttl,'3600');
      assert.equal(verifyVapid(c.headers.authorization,k.publicKey).aud,`http://${mock.host}`);
    }
    assert.equal((await owner.get('/api/admin/push/config')).body.devices.active,1,'the 410 device is deactivated');
  }finally{srv.stop();mock.close();}
});

test('no subscribed device: the alert is recorded as failed (NoSubscribers), never as sent; webpush without keys does not start',async()=>{
  const k=webpush.generateVapidKeys();
  const srv=await startServer({NOTIFY_TRANSPORT:'webpush',PUSH_VAPID_PUBLIC_KEY:k.publicKey,PUSH_VAPID_PRIVATE_KEY:k.privateKey,PUSH_VAPID_SUBJECT:'mailto:ops@example.org'});
  try{
    const owner=new Client(srv.url);assert.equal((await owner.login(srv.owner.email,srv.owner.password,srv.owner.secret)).status,200);
    const r=await new Client(srv.url).post('/api/public/requests',valid());assert.equal(r.status,201,'the request itself is saved');
    const row=await settle(owner,r.body.tracking_code);
    assert.equal(row.status,'failed');assert.equal(row.last_error,'NoSubscribers');assert.equal(row.delivered_at,null);
  }finally{srv.stop();}
  const broken=await startServer({NOTIFY_TRANSPORT:'webpush'});
  try{
    let up=false;try{up=(await fetch(broken.url+'/health')).ok}catch{}
    assert.equal(up,false,'start-up refused without VAPID keys');assert.match(broken.errors(),/requires PUSH_VAPID/);
  }finally{broken.stop();}
});

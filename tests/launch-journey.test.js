'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net');
const {spawn}=require('node:child_process'),root=path.resolve(__dirname,'..');
async function start(t){
 const port=await new Promise((resolve,reject)=>{const s=net.createServer().listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))});s.on('error',reject)});
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'allo-launch-'));
 const child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,PORT:String(port),DATA_DIR:data,NODE_ENV:'test',ENABLE_REQUESTS:'false'},stdio:['ignore','pipe','pipe']});
 let errors='';child.stderr.on('data',b=>errors+=String(b));t.after(()=>{child.kill();fs.rmSync(data,{recursive:true,force:true})});
 const base='http://127.0.0.1:'+port;let ready=false;
 for(let i=0;i<80;i++){try{if((await fetch(base+'/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,50))}
 assert.ok(ready,errors||'server did not start');return base;
}
test('Marketing QR homepage preserves campaign and legacy page',async t=>{
 const base=await start(t);
 let r=await fetch(base+'/?src=flyer',{redirect:'manual'});assert.equal(r.status,302);assert.equal(r.headers.get('location'),'/constellation-v9/index.html?src=flyer');
 r=await fetch(base+'/?src=https://invalid.invalid',{redirect:'manual'});assert.equal(r.headers.get('location'),'/constellation-v9/index.html');
 r=await fetch(base+'/index.html');assert.equal(r.status,200);
 r=await fetch(base+'/constellation-v9/index.html');assert.equal(r.status,200);assert.match(await r.text(),/continue-v10/);
});
test('Every catalog service is reachable, requests stay gated and admin stays private',async t=>{
 const base=await start(t),catalog=await fetch(base+'/api/public/catalog').then(r=>r.json());
 assert.equal(catalog.services.length,100);
 for(const service of catalog.services){const r=await fetch(base+'/services/'+encodeURIComponent(service.slug)+'.html');assert.equal(r.status,200,service.slug);assert.match(await r.text(),/ALLOSERVIX/)}
 let r=await fetch(base+'/services/not-a-valid-service.html');assert.equal(r.status,404);
 r=await fetch(base+'/api/admin/ops/technicians');assert.equal(r.status,401);
 const config=await fetch(base+'/api/public/requests/config').then(r=>r.json());assert.equal(config.enabled,false);
});
test('Guided response carries context to request wizard without auto-sending contact',()=>{
 const v9=fs.readFileSync(path.join(root,'constellation-v9/app.js'),'utf8');
 const v10=fs.readFileSync(path.join(root,'request-v10/app.js'),'utf8');
 assert.match(v9,/allow_external_ai:false,answers:/);assert.match(v9,/sessionStorage\.setItem\('allo_request_draft'/);
 assert.match(v10,/sessionStorage\.removeItem\('allo_request_draft'/);
});
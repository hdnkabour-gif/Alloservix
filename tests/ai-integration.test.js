'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process'),net=require('node:net');
const root=path.join(__dirname,'..');
async function freePort(){return new Promise((resolve,reject)=>{const s=net.createServer().listen(0,'127.0.0.1',()=>{let p=s.address().port;s.close(()=>resolve(p))});s.on('error',reject)})}
test('API never sends model authored advice; dynamic catalogue remains accessible',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'allo-intent-'));
 const preload=path.join(dir,'fake-provider.cjs');
 fs.writeFileSync(preload,`global.fetch=async url=>{if (!String(url).includes('api.openai.com')) throw Error('unexpected external call');return {ok:true,json:async()=>({output:[{content:[{type:'output_text',text:JSON.stringify({topic:'software',action:'build',confidence:'high',service_slugs:['logiciel-stock','not-a-service'],question_ids:['goal'],answer:'HACKED 9999 MAD guaranteed'})}]}]})};};`);
 const port=await freePort(),base='http://127.0.0.1:'+port;
 const proc=spawn(process.execPath,['--require',preload,'server.js'],{cwd:root,env:{...process.env,PORT:String(port),DATA_DIR:dir,NODE_ENV:'test',ENABLE_AI:'true',OPENAI_API_KEY:'fake',AI_PROVIDER_ORDER:'openai'},stdio:['ignore','ignore','pipe']});
 let stderr='';proc.stderr.on('data',b=>stderr+=b.toString());t.after(()=>{proc.kill();fs.rmSync(dir,{recursive:true,force:true})});
 let ready=false;for(let i=0;i<75;i++){try{const r=await fetch(base+'/health');if(r.ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,70))}assert.ok(ready,'Startup failed: '+stderr);
 const r=await fetch(base+'/api/public/assistant',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:'بغيت برنامج المخزون',allow_external_ai:true})});
 assert.equal(r.status,200);const data=await r.json();assert.equal(data.engine,'catalogue-grounded');assert.equal(data.understanding?.provider,'openai');assert.doesNotMatch(JSON.stringify(data),/HACKED|9999/);assert.ok(data.matches.every(m=>m.slug!=='not-a-service'));
 const fallback=await fetch(base+'/api/public/assistant',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:'بغيت برنامج المخزون',allow_external_ai:false})});
 const y=await fallback.json();assert.equal(y.answer,data.answer);assert.equal(y.understanding,undefined);
 const page=await fetch(base+'/services/reinstallation-windows.html');assert.equal(page.status,200);assert.match(await page.text(),/Sur étude/);
});

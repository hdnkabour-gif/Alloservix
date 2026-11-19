'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),{spawn}=require('node:child_process');
const root=path.join(__dirname,'..');
const jpeg='data:image/jpeg;base64,'+Buffer.concat([Buffer.from([255,216,255,224]),Buffer.alloc(130)]).toString('base64');
const wav='data:audio/wav;base64,'+Buffer.concat([Buffer.from('RIFF'),Buffer.alloc(4),Buffer.from('WAVE'),Buffer.alloc(100)]).toString('base64');
async function freePort(){return new Promise((resolve,reject)=>{const s=net.createServer().listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))});s.on('error',reject)})}
test('API photo/audio strictly gates consent; no model-authored response leaks',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'allomedia-')),preload=path.join(dir,'mock.cjs');
 fs.writeFileSync(preload,`global.fetch=async u=>{if(String(u).includes('/audio/transcriptions'))return{ok:true,json:async()=>({text:'3ndi mochkil f lwifi'})};if(String(u).includes('/responses'))return{ok:true,json:async()=>({output:[{content:[{type:'output_text',text:JSON.stringify({devices:['printer'],signs:['error_screen'],confidence:'medium',answer:'Pay 8999 MAD'})}]}]})};throw Error('Unexpected provider')};`);
 const port=await freePort(),base='http://127.0.0.1:'+port;
 const child=spawn(process.execPath,['--require',preload,'server.js'],{cwd:root,env:{...process.env,PORT:String(port),DATA_DIR:dir,NODE_ENV:'test',OPENAI_API_KEY:'fake',AI_PROVIDER_ORDER:'openai',ENABLE_IMAGE_INTENT:'true',ENABLE_AUDIO_TRANSCRIPTION:'true',ENABLE_AI:'false'},stdio:['ignore','ignore','pipe']});
 let errs='';child.stderr.on('data',c=>errs+=String(c));t.after(()=>{child.kill();fs.rmSync(dir,{recursive:true,force:true})});
 let up=false;for(let n=0;n<90;n++){try{if((await fetch(base+'/health')).ok){up=true;break}}catch{}await new Promise(r=>setTimeout(r,50))}assert.ok(up,errs);
 let r=await fetch(base+'/api/public/catalog');const features=(await r.json()).features;assert.equal(features.image_intent,true);assert.equal(features.audio_transcription,true);
 async function post(url,value){const z=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify(value)});return{status:z.status,data:await z.json()}}
 r=await post('/api/public/understand-image',{data_url:jpeg});assert.equal(r.status,400);
 r=await post('/api/public/understand-image',{allow_external_processing:true,data_url:'data:image/png;base64,'+jpeg.split(',')[1]});assert.equal(r.status,400);
 r=await post('/api/public/understand-image',{allow_external_processing:true,data_url:jpeg});assert.equal(r.status,200);assert.equal(r.data.needs_confirmation,true);assert.match(r.data.suggested_text,/imprimante/);assert.doesNotMatch(JSON.stringify(r.data),/8999/);
 r=await post('/api/public/transcribe-audio',{data_url:wav});assert.equal(r.status,400);
 r=await post('/api/public/transcribe-audio',{allow_external_processing:true,data_url:wav});assert.equal(r.status,200);assert.match(r.data.transcript,/lwifi/);
});

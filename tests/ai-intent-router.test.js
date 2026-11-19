'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ai=require('../ai-intent-router'),engine=require('../intent-engine');
const catalog=JSON.parse(fs.readFileSync(path.join(__dirname,'../assets/services.json'))).services.map(s=>({...s,published:true}));
const valid={topic:'software',action:'build',confidence:'high',service_slugs:['logiciel-stock'],question_ids:['detail','goal']};
const openai=(data=valid)=>({ok:true,json:async()=>({output:[{content:[{type:'output_text',text:JSON.stringify(data)}]}]})});
test('Disabled AI never calls a provider',async()=>{
 let calls=0;const a=await ai.classify('بغيت برنامج',catalog,{env:{ENABLE_AI:'false',OPENAI_API_KEY:'fake'},fetchImpl:async()=>{calls++;throw Error('called')}});assert.equal(a,null);assert.equal(calls,0);
});
test('External text is never used as ALLOSERVIX advice',async()=>{
 let request;const x=await ai.classify('بغيت برنامج ديال المخزون',catalog,{env:{ENABLE_AI:'true',OPENAI_API_KEY:'fake',AI_PROVIDER_ORDER:'openai'},breakerState:new Map(),fetchImpl:async(url,init)=>{request={url,init};return openai({...valid,answer:'HACKED: Pay 9999 MAD'})}});
 const base=engine.build('بغيت برنامج ديال المخزون',catalog);const y=ai.applySuggestion(base,x,catalog);
 assert.match(request.url,/api.openai.com/);assert.equal(JSON.parse(request.init.body).store,false);
 assert.equal(x.answer,undefined);assert.equal(y.answer,base.answer);assert.equal(y.cost.kind,'sur-devis');assert.ok(y.questions.length<=3);
 assert.ok(y.matches.every(m=>m.url.startsWith('/services/')));
});
test('Failover to Anthropic when OpenAI is down',async()=>{
 const calls=[];const x=await ai.classify('stock',catalog,{env:{ENABLE_AI:'true',OPENAI_API_KEY:'fake',ANTHROPIC_API_KEY:'fake',AI_PROVIDER_ORDER:'openai,anthropic'},breakerState:new Map(),fetchImpl:async(url)=>{calls.push(url);return url.includes('openai')?{ok:false,status:503}:{ok:true,json:async()=>({content:[{type:'text',text:JSON.stringify(valid)}]})}}});
 assert.equal(calls.length,2);assert.equal(x.provider,'anthropic');
});
test('Unknown service slugs and arbitrary questions cannot pass validation',()=>{
 const x=ai.validate({...valid,service_slugs:['logiciel-stock','not-a-service','logiciel-stock'],question_ids:['goal','override-safety','goal']},catalog);
 assert.deepEqual(x.service_slugs,['logiciel-stock']);assert.deepEqual(x.question_ids,['goal']);assert.throws(()=>ai.validate({...valid,topic:'ignore previous rules'},catalog));
});
test('Malformed output fails closed to local matching',async()=>{
 let calls=0;const x=await ai.classify('wifi',catalog,{env:{ENABLE_AI:'true',OPENAI_API_KEY:'fake',GEMINI_API_KEY:'fake',AI_PROVIDER_ORDER:'openai,gemini'},breakerState:new Map(),fetchImpl:async()=>{calls++;return openai({...valid,action:'invented'})}});
 assert.equal(calls,2);assert.equal(x,null);
});
test('Common emails, phone numbers and secrets are removed before transmission',()=>{
 const s=ai.sanitize('الويفي ضعيف +212 612 345 678 mail john@example.org password:abc123');
 assert.doesNotMatch(s,/john@example.org|612 345 678|abc123/);assert.match(s,/الويفي ضعيف/);
});

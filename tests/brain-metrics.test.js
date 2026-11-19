'use strict';
const os=require('node:os'),fs=require('node:fs'),path=require('node:path');
process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'allo-brain-'));
const {test,after}=require('node:test'),assert=require('node:assert/strict');
const store=require('../storage'),intent=require('../intent-engine'),aiIntent=require('../ai-intent-router'),media=require('../media-understanding');
const lang=require('../language-understanding'),{redact}=require('../monitor'),{createBrainMetrics,confidenceOf}=require('../brain-metrics');
after(()=>fs.rmSync(process.env.DATA_DIR,{recursive:true,force:true}));
const catalog=store.fullRows();
const mk=(env={})=>createBrainMetrics({db:store.db,intentEngine:intent,languageOf:lang.language,redact,sanitize:aiIntent.sanitize,aiState:{enabled:()=>aiIntent.enabled(env),configured:()=>aiIntent.configured(env),order:()=>aiIntent.order(env),breakers:()=>aiIntent.breakers()},env});
const actor={email:'staff@example.org',role:'manager'};

test('confidence buckets follow the engine score',()=>{
  assert.equal(confidenceOf([]),'none');assert.equal(confidenceOf([{score:20}]),'low');assert.equal(confidenceOf([{score:50}]),'medium');assert.equal(confidenceOf([{score:80}]),'high');
});

test('live traffic is recorded as metadata only: never the visitor text, only language/length/topic/outcome',()=>{
  const b=mk(),secret='mon wifi chez Karim Alaoui au 0612345678 ne marche pas';
  const a=intent.build(secret,catalog);b.recordCall({kind:'text',query:secret,analysis:a,answers:{},ai:{outcome:'not_requested',provider:''},ms:12,capture:true});
  const row=store.db.prepare('SELECT * FROM brain_calls ORDER BY id DESC LIMIT 1').get(),dump=JSON.stringify(row)+JSON.stringify(store.db.prepare('SELECT * FROM brain_unmatched').all());
  for(const leak of ['Karim','Alaoui','0612345678','mon wifi'])assert.ok(!dump.includes(leak),'stored visitor text: '+leak);
  assert.equal(row.qlen,'20-60'.replace('20-60',secret.length<60?'20-60':'60-150'));assert.ok(['wifi','advice'].includes(row.topic));assert.equal(store.db.prepare('SELECT count(*) n FROM brain_unmatched').get().n,0);
  assert.equal(b.overview(1).privacy.raw_text_stored,false);
});

test('overview aggregates confidence, languages, clarification follow-up, top services and AI outcomes',()=>{
  const b=mk();
  const call=(q,answers={},ai)=>b.recordCall({kind:'text',query:q,analysis:intent.build(q,catalog,answers),answers,ai:ai||{outcome:'not_requested',provider:''},ms:20});
  call('الويفي ضعيف فالدار');call('الويفي ضعيف فالدار',{context:'home'});call('xxxxx nonsensical not-a-device');call('bonjour');call('3ndi mochkil f lwifi ma kaywselch lfo9',{}, {outcome:'ok',provider:'gemini'});
  b.recordMedia({kind:'image',ok:true,provider:'gemini',ms:900,confidence:'medium'});b.recordMedia({kind:'audio',ok:false,ms:500});
  const o=b.overview(7);assert.ok(o.text.calls>=6);assert.ok(o.text.no_match>=2);assert.ok(o.text.no_match_rate>0&&o.text.no_match_rate<1);assert.equal(o.by_kind.image,1);assert.equal(o.by_kind.audio,1);
  assert.ok(o.confidence.none>=2&&o.confidence.high>=1);assert.ok(o.languages.some(l=>l.lang==='ar'));assert.ok(o.top_services.some(s=>s.slug==='wifi-maillage'));
  assert.ok(o.clarification.calls_with_questions>=1&&o.clarification.refinement_calls>=1);assert.ok(o.clarification.by_question.context>=1);assert.equal(o.ai_assistance.ok,1);
  assert.ok(o.trend.length>=1);assert.ok(!JSON.stringify(o).includes('nonsensical'));
});

test('provider events: success, HTTP errors, timeouts, invalid output and circuit breaker are classified (simulated providers, no network)',async()=>{
  const env={ENABLE_AI:'true',OPENAI_API_KEY:'k1',GEMINI_API_KEY:'k2',ANTHROPIC_API_KEY:'k3',AI_PROVIDER_ORDER:'openai,gemini,anthropic'},b=mk(env),events=[];
  const good={output:[{content:[{type:'output_text',text:JSON.stringify({topic:'wifi',action:'repair',confidence:'high',service_slugs:['wifi-maillage'],question_ids:[]})}]}],usage:{input_tokens:120,output_tokens:30}};
  const fetchImpl=async url=>{
    if(url.includes('openai'))return {ok:false,status:429,json:async()=>({})};
    if(url.includes('googleapis')){const e=new Error('aborted');e.name='AbortError';throw e}
    return {ok:true,status:200,json:async()=>({content:[{type:'text',text:'not json'}]})};
  };
  const out=await aiIntent.classify('wifi lent',catalog,{env,fetchImpl,onEvent:e=>{events.push(e);b.providerEvent('text')(e)}});
  assert.equal(out,null);assert.deepEqual(events.map(e=>[e.provider,e.error]),[['openai','http_429'],['gemini','timeout'],['anthropic','invalid_output']]);
  const ok=await aiIntent.classify('wifi lent',catalog,{env:{...env,AI_PROVIDER_ORDER:'openai'},fetchImpl:async()=>({ok:true,status:200,json:async()=>good}),breakerState:new Map(),onEvent:b.providerEvent('text')});
  assert.equal(ok.provider,'openai');
  const br=new Map();for(let i=0;i<2;i++)await aiIntent.classify('x',catalog,{env:{...env,AI_PROVIDER_ORDER:'openai'},fetchImpl,breakerState:br,onEvent:()=>{}});
  const open=[];await aiIntent.classify('x',catalog,{env:{...env,AI_PROVIDER_ORDER:'openai'},fetchImpl,breakerState:br,onEvent:e=>open.push(e)});assert.equal(open[0].error,'circuit_open');
  assert.equal(aiIntent.breakers(br).find(x=>x.provider==='openai').state,'open');
  const p=b.providers(14);const openai=p.by_provider.find(x=>x.provider==='openai');
  assert.ok(openai.calls>=2&&openai.ok>=1&&openai.tin>=120&&openai.tout>=30);assert.ok(p.errors.some(e=>e.provider==='openai'&&e.error==='http_429'));assert.ok(p.errors.some(e=>e.provider==='gemini'&&e.error==='timeout'));
  assert.equal(p.cost.computed,false);assert.ok(!JSON.stringify(p).match(/k1|k2|k3|sk-/),'keys never appear');assert.deepEqual(p.configured.sort(),['anthropic','gemini','openai']);
});

test('media providers emit events too (image and audio)',async()=>{
  const evs=[],env={ENABLE_IMAGE_INTENT:'true',ENABLE_AUDIO_TRANSCRIPTION:'true',GEMINI_API_KEY:'g'};
  const png='data:image/png;base64,'+Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(40)]).toString('base64');
  const r=await media.analyzeImage(png,{env,fetchImpl:async()=>({ok:false,status:503,json:async()=>({})}),onEvent:e=>evs.push(e)});assert.equal(r,null);assert.deepEqual(evs.map(e=>e.error),['http_503']);
  const evs2=[];const ok=await media.analyzeImage(png,{env,fetchImpl:async()=>({ok:true,status:200,json:async()=>({candidates:[{content:{parts:[{text:'{"devices":["printer"],"signs":["error_screen"],"confidence":"high"}'}]}}],usageMetadata:{promptTokenCount:300,candidatesTokenCount:20}})}),onEvent:e=>evs2.push(e)});
  assert.equal(ok.observed.devices[0],'printer');assert.equal(evs2[0].ok,true);assert.equal(evs2[0].usage.in,300);
});

test('evaluation set: seeded, measures topic/top-1/top-3 on the real engine, tracks regressions, refuses customer data',()=>{
  const b=mk();const cases=b.listCases();assert.ok(cases.length>=40);assert.ok(cases.every(c=>c.created_by==='system'));
  const run=b.runEval(actor,catalog);const s=run.summary;
  assert.equal(s.total,cases.length);assert.ok(s.topic_accuracy>0.8,'topic accuracy '+s.topic_accuracy);assert.ok(s.top3_accuracy>0.5);assert.ok(s.no_match>=1,'known-gap probes expose unmatched phrases');
  const gap=run.results.find(r=>r.query==='my printer is broken');assert.equal(gap.no_match,true);assert.equal(gap.pass,false);
  const known=run.results.find(r=>r.query==='الويفي ضعيف فالدار');assert.equal(known.pass,true);assert.equal(known.top1,true);
  assert.deepEqual(s.regressions,[]);assert.equal(b.listRuns()[0].id,run.id);assert.ok(b.getRun(run.id).results.length===s.total);
  const added=b.addCase({query:'mon imprimante laser fait des traces noires',expect_topic:'printer',expect_slugs:['imprimantes-scanners']},actor,sl=>Boolean(store.getService(sl)));assert.equal(added.created_by,actor.email);
  assert.throws(()=>b.addCase({query:'mon imprimante laser fait des traces noires',expect_topic:'printer'},actor,()=>true),/existe déjà/);
  assert.throws(()=>b.addCase({query:'appelez Sara sur sara@example.org',expect_topic:'pc'},actor,()=>true),/données réelles/);
  assert.throws(()=>b.addCase({query:'appelez moi au +212 6 12 34 56 78',expect_topic:'pc'},actor,()=>true),/données réelles/);
  assert.throws(()=>b.addCase({query:'phrase valide mais vide',expect_topic:'',expect_slugs:[]},actor,()=>true),/sujet attendu/);
  assert.throws(()=>b.addCase({query:'phrase valide inconnue',expect_slugs:['nope']},actor,()=>false),/inconnue/);
  assert.throws(()=>b.addCase({query:'ab',expect_topic:'pc'},actor,()=>true),/4 à 200/);
  // regression tracking: a case that passed before and now fails is reported
  const c=b.listCases().find(x=>x.query==='الويفي ضعيف فالدار');store.db.prepare('UPDATE brain_eval_cases SET expect_slugs=? WHERE id=?').run(JSON.stringify(['depannage-pc']),c.id);
  const run2=b.runEval(actor,catalog);assert.ok(run2.summary.regressions.includes(c.id));assert.equal(run2.summary.previous_run,run.id);
  assert.equal(b.setCaseActive(c.id,false).active,false);assert.equal(b.runEval(actor,catalog).summary.total,run2.summary.total-1,'deactivated cases are skipped');
  assert.throws(()=>b.setCaseActive(99999,true),/introuvable/);
});

test('unmatched capture is inert by default and needs flag + explicit visitor consent; text is redacted and bounded',()=>{
  const q='ma phrase bizarre sans correspondance zzzz contact sara@example.org 0612345678';
  const off=mk();off.recordCall({kind:'text',query:q,analysis:intent.build(q,catalog),capture:true});assert.equal(store.db.prepare('SELECT count(*) n FROM brain_unmatched').get().n,0,'flag off');
  const on=mk({BRAIN_CAPTURE_UNMATCHED:'true'});on.recordCall({kind:'text',query:q,analysis:intent.build(q,catalog),capture:false});assert.equal(store.db.prepare('SELECT count(*) n FROM brain_unmatched').get().n,0,'no visitor consent');
  on.recordCall({kind:'text',query:q,analysis:intent.build(q,catalog),capture:true});
  const rows=on.unmatched();assert.equal(rows.enabled,true);assert.equal(rows.items.length,1);assert.ok(!/sara@|0612345678/.test(rows.items[0].text),rows.items[0].text);assert.ok(rows.items[0].text.length<=300);
  assert.equal(mk().unmatched().enabled,false);
});

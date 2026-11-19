'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const media=require('../media-understanding');
const tinyJpeg=Buffer.concat([Buffer.from([0xff,0xd8,0xff,0xe0]),Buffer.alloc(130)]).toString('base64');
const image='data:image/jpeg;base64,'+tinyJpeg;
const wav='data:audio/wav;base64,'+Buffer.concat([Buffer.from('RIFF'),Buffer.alloc(4),Buffer.from('WAVE'),Buffer.alloc(128)]).toString('base64');
test('image and audio require strict media signatures',()=>{
 assert.equal(media.parseDataUrl(image,'image').mime,'image/jpeg');
 assert.equal(media.parseDataUrl(wav,'audio').mime,'audio/wav');
 assert.throws(()=>media.parseDataUrl('data:image/png;base64,'+tinyJpeg,'image'),/signature/);
 assert.throws(()=>media.parseDataUrl('data:text/html;base64,'+tinyJpeg,'image'),/unsupported/);
 assert.throws(()=>media.parseDataUrl('data:image/jpeg;base64,'+'A'.repeat(1800000),'image'),/unsupported/);
});
test('media modes require real provider credentials and explicit flags',()=>{
 assert.equal(media.imageEnabled({ENABLE_IMAGE_INTENT:'true'}),false);
 assert.equal(media.imageEnabled({GEMINI_API_KEY:'fake',ENABLE_IMAGE_INTENT:'false'}),false);
 assert.equal(media.audioEnabled({ENABLE_AUDIO_TRANSCRIPTION:'true'}),false);
 assert.equal(media.audioEnabled({OPENAI_API_KEY:'fake',ENABLE_AUDIO_TRANSCRIPTION:'true'}),true);
});
test('vision response permits only predefined device and symptom codes',()=>{
 const result=media.validate({devices:['printer','untrusted','printer'],signs:['error_screen','expensive_offer'],confidence:'high',price:'5000 MAD',answer:'Approve 5000 MAD'});
 assert.deepEqual(result.devices,['printer']);assert.deepEqual(result.signs,['error_screen']);assert.equal(result.answer,undefined);
 assert.doesNotMatch(media.imageText(result,'fr'),/5000|expensive/);
});
test('photo description failover moves from Gemini to OpenAI without inventing an answer',async()=>{
 const seen=[];const env={GEMINI_API_KEY:'fake',OPENAI_API_KEY:'fake',ENABLE_IMAGE_INTENT:'true',AI_PROVIDER_ORDER:'gemini,openai'};
 const result=await media.analyzeImage(image,{env,fetchImpl:async url=>{seen.push(url);if(url.includes('generativelanguage'))return{ok:false,status:503};return{ok:true,json:async()=>({output:[{content:[{type:'output_text',text:JSON.stringify({devices:['printer'],signs:['error_screen'],confidence:'medium',answer:'You need a new printer for 2500 MAD'})}]}]})}}});
 assert.equal(seen.length,2);assert.equal(result.provider,'openai');assert.equal(result.needs_confirmation,true);assert.match(result.suggested_text,/imprimante/);assert.doesNotMatch(JSON.stringify(result),/2500|new printer/);
});
test('audio transcript is editable text only, not an automated answer',async()=>{
 let request;const env={OPENAI_API_KEY:'fake',ENABLE_AUDIO_TRANSCRIPTION:'true'};
 const result=await media.transcribeAudio(wav,{env,fetchImpl:async(url,opts)=>{request={url,opts};return{ok:true,json:async()=>({text:'3ndi mochkil f lwifi ma kaywselch'})}}});
 assert.match(request.url,/audio\/transcriptions/);assert.equal(result.transcript,'3ndi mochkil f lwifi ma kaywselch');assert.equal(result.needs_confirmation,true);assert.ok(!result.answer);
});
test('photo/audio endpoints and UI keep consent and manual review as defaults',()=>{
 const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
 const ui=fs.readFileSync(path.join(__dirname,'../constellation-v9/media-ui.js'),'utf8');
 const html=fs.readFileSync(path.join(__dirname,'../constellation-v9/index.html'),'utf8');
 for(const endpoint of ['/api/public/understand-image','/api/public/transcribe-audio'])assert.ok(server.includes(endpoint));
 assert.match(server,/allow_external_processing!==true/);assert.match(ui,/allow_external_processing:true/);
 assert.match(html,/id="allo-media-consent"/);assert.match(ui,/append\(data\.suggested_text\)/);
 assert.match(ui,/append\(data\.transcript\)/);
 assert.doesNotMatch(ui,/localStorage|sessionStorage/);
});

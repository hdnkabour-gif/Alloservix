// Production smoke: read-only requests, no credentials, no personal data.
const origin=process.env.ALLO_SMOKE_URL||'https://alloservix-web-production.up.railway.app';
const base=new URL(origin);
if(base.protocol!=='https:'||base.username||base.password||base.pathname!=='/'||base.search)throw Error('Smoke target must be an HTTPS origin');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const request=async(path,opts={})=>fetch(new URL(path,base),{...opts,redirect:'manual',signal:AbortSignal.timeout(8500)});
async function expectPublished(){
 const health=await request('/health');if(health.status!==200||(await health.json()).ok!==true)throw Error('Health not healthy');
 const home=await request('/constellation-v9/index.html');if(home.status!==200||!(await home.text()).includes('media-ui.js'))throw Error('Latest V13 home not available');
 const media=await request('/constellation-v9/media-ui.js');if(media.status!==200||!(await media.text()).includes('allo-media-consent'))throw Error('Photo/voice interface script missing');
 const css=await request('/constellation-v9/style.css');if(css.status!==200)throw Error('CSS missing');
 const catalog=await request('/api/public/catalog');if(catalog.status!==200)throw Error('Catalogue unavailable');
 const data=await catalog.json();if(!Array.isArray(data.services)||data.services.length<100)throw Error('Catalogue incomplete');
 if(typeof data.features?.browser_voice!=='boolean')throw Error('Multimodal configuration missing');
 return data.features;
}
let features,ready=false;
for(let i=0;i<20;i++){
 try{features=await expectPublished();ready=true;break}catch(e){console.log('Deploy readiness '+(i+1)+'/20:',e.message);if(i===19)throw e;await sleep(5000)}
}
if(!ready)throw Error('No deployed V13');
const examples=[['3ndi mochkil f lwifi ma kaywselch','wifi'],['bghit nssayb app dyal stock','software'],['scan vers dossier ما خدامش','printer']];
for(const [question,expected] of examples){
 const r=await request('/api/public/assistant',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question,allow_external_ai:false})});
 if(r.status!==200)throw Error('Assistant unavailable for '+expected+': '+r.status);
 const answer=await r.json();if(answer.intent?.topic!==expected)throw Error('Wrong topic for '+expected+': '+answer.intent?.topic);
 if(answer.engine!=='catalogue-grounded')throw Error('External model unexpectedly authored the answer');
}
const adminPage=await request('/admin/');if(adminPage.status!==200)throw Error('Admin login page not served');
const adminHtml=await adminPage.text();
for(const marker of ['id="control"','id="cmd-services"','id="cmd-knowledge"','id="intelligence"','id="security"'])
 if(!adminHtml.includes(marker))throw Error('Unified command center UI missing marker '+marker);
const adminJs=await request('/admin/admin.js');if(adminJs.status!==200||!(await adminJs.text()).includes('/api/admin/control-center'))throw Error('Admin center client script missing');
const adminCss=await request('/admin/admin.css');if(adminCss.status!==200||!(await adminCss.text()).includes('.control-hero'))throw Error('Admin command center CSS missing');
const admin=await request('/api/admin/ai/status');if(admin.status!==401)throw Error('Private AI status exposed: '+admin.status);
const privateCenter=await request('/api/admin/control-center');if(privateCenter.status!==401)throw Error('Control center is exposed without a session');
const adminSession=await request('/api/admin/session');if(adminSession.status!==200)throw Error('Admin session check unavailable');const sess=await adminSession.json();if(sess.configured!==true||sess.authenticated!==false)throw Error('Admin credentials not configured or session not protected');
const source=await request('/media-understanding.js');if(source.status!==404)throw Error('Private media source exposed');
const disabledMedia=await request('/api/public/understand-image',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({allow_external_processing:false})});
if(![400,503].includes(disabledMedia.status))throw Error('Media consent/feature gate failed: '+disabledMedia.status);
console.log('PRODUCTION SMOKE PASSED: health, V13 UI, catalog, mixed text intents, admin/source security and media gate; features:',JSON.stringify(features));

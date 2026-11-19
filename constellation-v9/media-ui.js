(()=>{
'use strict';
const $=id=>document.getElementById(id),status=$('allo-media-status'),input=$('quick-input');
const consent=$('allo-media-consent'),image=$('allo-photo'),photoButton=$('allo-analyze-photo'),voiceButton=$('allo-dictate'),cloudButton=$('allo-cloud-voice'),locale=$('allo-voice-lang');
let features={},recording=false;
const tell=(s,bad=false)=>{status.textContent=s;status.classList.toggle('is-error',bad)};
const isArabic=()=>document.documentElement.lang==='ar';
const append=t=>{const value=String(t||'').trim();if(!value)return;input.value=[input.value.trim(),value].filter(Boolean).join(' ').slice(0,500);input.focus();tell(isArabic()?'راجع النص، ثم اضغط تحليل الطلب.':'Relisez et corrigez le texte, puis lancez l’analyse.')};
async function load(){
 try{const res=await fetch('/api/public/catalog',{cache:'no-store'});if(!res.ok)throw Error('catalog');const c=await res.json();features=c.features||{}}
 catch{features={};tell('La reconnaissance média est momentanément indisponible; vous pouvez écrire.',true)}
 cloudButton.hidden=!features.audio_transcription;
 photoButton.hidden=!features.image_intent||!image.files.length;
}
function permitted(){if(consent.checked)return true;tell(isArabic()?'خاصك توافق قبل إرسال الصوت أو الصورة للتحليل.':'Cochez le consentement avant tout envoi ou dictée.',true);return false}
function readBase64(blob){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('file read'));reader.readAsDataURL(blob)})}
function canvasPhoto(file){return new Promise((resolve,reject)=>{
 const picture=new Image();
 picture.onload=()=>{try{const scale=Math.min(1,960/Math.max(picture.width,picture.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.floor(picture.width*scale));canvas.height=Math.max(1,Math.floor(picture.height*scale));canvas.getContext('2d').drawImage(picture,0,0,canvas.width,canvas.height);let data=canvas.toDataURL('image/jpeg',0.7);if(data.length>1500000)data=canvas.toDataURL('image/jpeg',0.48);if(data.length>1650000)throw Error('photo too big');resolve(data)}catch(e){reject(e)}};
 picture.onerror=()=>reject(Error('image invalid'));const reader=new FileReader();reader.onload=()=>{picture.src=reader.result};reader.onerror=()=>reject(Error('image read'));reader.readAsDataURL(file);
 })}
async function send(endpoint,data_url){const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),11000);
 try{const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({data_url,allow_external_processing:true,lang:isArabic()?'ar':'fr'})});
 const data=await response.json().catch(()=>({}));if(!response.ok)throw Error(data.error||'Service temporarily unavailable');return data}
 finally{clearTimeout(timeout)}}
image.addEventListener('change',()=>{const file=image.files[0];if(!file){photoButton.hidden=true;return}if(!/^image\/(?:jpeg|png|webp)$/.test(file.type)||file.size>6000000){image.value='';photoButton.hidden=true;tell('Photo invalide ou trop volumineuse (6 Mo maximum).',true);return}
 photoButton.hidden=!features.image_intent;tell(features.image_intent?'Photo sélectionnée. Vous pouvez demander son analyse.':'Photo sélectionnée, mais la reconnaissance visuelle n’est pas encore activée. Décrivez le besoin en texte.')});
photoButton.addEventListener('click',async()=>{
 if(!permitted()||!features.image_intent)return;const file=image.files[0];if(!file)return;
 photoButton.disabled=true;tell('Observation de la photo en cours…');
 try{const data=await send('/api/public/understand-image',await canvasPhoto(file));append(data.suggested_text);tell(isArabic()?'الوصف مبدئي: صحح النص قبل التحليل.':'Observation indicative, non un diagnostic. Corrigez le texte avant analyse.')}
 catch(e){tell('Image : '+e.message+'. Vous pouvez décrire le problème manuellement.',true)}
 finally{photoButton.disabled=false;image.value='';photoButton.hidden=true}
});
voiceButton.addEventListener('click',()=>{
 if(!permitted())return;const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
 if(!Recognition){tell('Dictée non disponible sur ce navigateur. Utilisez le texte ou la transcription IA si disponible.',true);return}
 if(voiceButton.disabled)return;const rec=new Recognition();rec.lang=locale.value;rec.continuous=false;rec.interimResults=false;rec.maxAlternatives=1;
 voiceButton.disabled=true;tell('Parlez maintenant… (le navigateur peut traiter la voix par son fournisseur).');
 rec.onresult=event=>append(event.results?.[0]?.[0]?.transcript||'');
 rec.onerror=event=>tell('Dictée non disponible ('+(event.error||'erreur')+'). Essayez une autre langue ou écrivez.',true);
 rec.onend=()=>{voiceButton.disabled=false};try{rec.start()}catch{voiceButton.disabled=false;tell('Micro non disponible.',true)}
});
cloudButton.addEventListener('click',async()=>{
 if(recording||!features.audio_transcription||!permitted())return;
 if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){tell('Enregistrement indisponible dans ce navigateur.',true);return}
 const mime=['audio/webm','audio/mp4','audio/ogg'].find(m=>MediaRecorder.isTypeSupported?.(m));if(!mime){tell('Format audio non pris en charge.',true);return}
 let stream;try{stream=await navigator.mediaDevices.getUserMedia({audio:true,video:false});recording=true;cloudButton.disabled=true;
 const parts=[],rec=new MediaRecorder(stream,{mimeType:mime});rec.ondataavailable=e=>{if(e.data.size)parts.push(e.data)};
 rec.onstop=async()=>{stream.getTracks().forEach(t=>t.stop());try{const blob=new Blob(parts,{type:mime});if(blob.size>1400000)throw Error('Taille audio excessive');tell('Transcription en cours…');const data=await send('/api/public/transcribe-audio',await readBase64(blob));append(data.transcript)}
 catch(e){tell('Transcription : '+e.message+'. Vous pouvez dicter via le navigateur ou écrire.',true)}
 finally{recording=false;cloudButton.disabled=false}};
 rec.onerror=()=>{stream.getTracks().forEach(t=>t.stop());recording=false;cloudButton.disabled=false;tell('Enregistrement interrompu.',true)};
 rec.start();tell('Enregistrement vocal de 10 secondes…');setTimeout(()=>{if(rec.state==='recording')rec.stop()},10000);
 }catch(e){stream?.getTracks().forEach(t=>t.stop());recording=false;cloudButton.disabled=false;tell('Autorisation microphone refusée ou indisponible.',true)}
});
load();
})();
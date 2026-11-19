(()=>{
'use strict';
const $=id=>document.getElementById(id),status=$('allo-media-status'),input=$('quick-input');
const consent=$('allo-media-consent'),image=$('allo-photo'),photoButton=$('allo-analyze-photo'),voiceButton=$('allo-dictate'),cloudButton=$('allo-cloud-voice'),locale=$('allo-voice-lang');
let features={},recording=false;
const tell=(s,bad=false)=>{status.textContent=s;status.classList.toggle('is-error',bad)};
const lang=()=>{const value=document.documentElement.lang;return value==='ary'?'darija':(['ar','fr','en'].includes(value)?value:'fr')};
const MSG={
 fr:{check:'Relisez et corrigez le texte, puis lancez l’analyse.',unavailable:'La reconnaissance photo et audio est indisponible pour le moment. Vous pouvez écrire.',consent:'Autorisez explicitement le traitement avant d’envoyer un son ou une image.',invalid:'Image non valide ou trop volumineuse (6 Mo maximum).',selected:'Photo sélectionnée. Vous pouvez demander son analyse.',photoOff:'La reconnaissance photo est désactivée. Décrivez votre besoin par écrit.',photoWorking:'Analyse de la photo en cours…',photoDone:'Observation indicative, pas un diagnostic. Vérifiez le texte avant analyse.',photoError:'Analyse de l’image impossible. Décrivez votre problème par écrit.',speechOff:'La dictée est indisponible dans ce navigateur. Utilisez le texte.',speak:'Parlez maintenant. Votre navigateur peut traiter la voix via son fournisseur.',speechError:'Dictée indisponible. Changez de langue ou écrivez votre demande.',micOff:'Microphone indisponible.',audioOff:'Enregistrement indisponible dans ce navigateur.',audioFormat:'Format audio non pris en charge.',audioWorking:'Transcription en cours…',audioError:'Transcription impossible. Vous pouvez écrire votre demande.',audioStopped:'Enregistrement interrompu.',audioRecording:'Enregistrement vocal pendant 10 secondes…',micDenied:'Autorisation du microphone refusée ou indisponible.'},
 ar:{check:'راجع النص وصححه قبل تحليل طلبك.',unavailable:'التعرف على الصور والصوت غير متاح حالياً. يمكنك كتابة طلبك.',consent:'يجب الموافقة صراحةً قبل إرسال صورة أو تسجيل صوتي للتحليل.',invalid:'الصورة غير صالحة أو يتجاوز حجمها 6 ميغابايت.',selected:'تم اختيار الصورة. يمكنك طلب تحليلها.',photoOff:'تحليل الصور غير مفعّل حالياً. يرجى وصف احتياجك كتابةً.',photoWorking:'جارٍ تحليل الصورة…',photoDone:'هذا وصف أولي وليس تشخيصاً نهائياً. راجع النص قبل التحليل.',photoError:'تعذر تحليل الصورة. اكتب وصف المشكلة بدلاً من ذلك.',speechOff:'الإملاء الصوتي غير متاح في هذا المتصفح. يمكنك الكتابة.',speak:'تحدث الآن. قد يعالج المتصفح الصوت من خلال مزوده.',speechError:'تعذر الإملاء الصوتي. جرّب لغة أخرى أو اكتب طلبك.',micOff:'الميكروفون غير متاح.',audioOff:'التسجيل الصوتي غير متاح في هذا المتصفح.',audioFormat:'صيغة الصوت غير مدعومة.',audioWorking:'جارٍ تحويل الصوت إلى نص…',audioError:'تعذر تحويل الصوت إلى نص. يمكنك كتابة طلبك.',audioStopped:'توقف التسجيل الصوتي.',audioRecording:'جارٍ تسجيل الصوت لمدة 10 ثوانٍ…',micDenied:'رُفض إذن استخدام الميكروفون أو تعذر الوصول إليه.'},
 darija:{check:'راجع الكلام وصححو قبل ما تحلل الطلب.',unavailable:'خدمة الصوت والصور ما خداماش دابا. تقدر تكتب الطلب.',consent:'خاصك توافق قبل ما تصيفط الصورة أو الصوت للتحليل.',invalid:'الصورة ما صالحةش أو الحجم ديالها كيتجاوز 6 ميغا.',selected:'تختارات الصورة، تقدر تطلب تحليلها.',photoOff:'تحليل الصور ما مفعلش دابا. شرح لينا بالكتابة.',photoWorking:'كنحللو الصورة…',photoDone:'هاد الوصف غير مبدئي، راجع النص قبل التحليل.',photoError:'ما قدرناش نحللو الصورة. كتب المشكل باليد.',speechOff:'الإملاء بالصوت ما متاحش فهاد المتصفح. كتب طلبك.',speak:'هضر دابا. المتصفح يقدر يعالج الصوت عند مزود خارجي.',speechError:'الإملاء ما خدمش. جرب لغة أخرى أو كتب.',micOff:'الميكروفون ما متاحش.',audioOff:'التسجيل ما متاحش فهاد المتصفح.',audioFormat:'صيغة الصوت ما مدعومةش.',audioWorking:'كنحولو الصوت لكتابة…',audioError:'ما قدرناش نحوّلو الصوت لنص. تقدر تكتب.',audioStopped:'التسجيل توقف.',audioRecording:'كنسجلو الصوت لمدة 10 ثواني…',micDenied:'ما تعطاش الإذن للميكروفون أو ما متاحش.'},
 en:{check:'Review and correct the text before analysing your request.',unavailable:'Photo and audio recognition are unavailable. You can still type your request.',consent:'Please consent before sending an image or recording for processing.',invalid:'Invalid image or over 6 MB.',selected:'Photo selected. You may request analysis.',photoOff:'Photo recognition is disabled. Please describe your needs in writing.',photoWorking:'Analysing the image…',photoDone:'This is an observation, not a diagnosis. Review the text.',photoError:'Image analysis failed. Please describe the issue in writing.',speechOff:'Speech dictation is unavailable in this browser. Please type instead.',speak:'Speak now. Your browser may process audio with a provider.',speechError:'Dictation failed. Try a different language or type.',micOff:'Microphone unavailable.',audioOff:'Recording is unavailable in this browser.',audioFormat:'Unsupported audio format.',audioWorking:'Transcribing audio…',audioError:'Transcription failed. Please type your request.',audioStopped:'Recording stopped.',audioRecording:'Recording for 10 seconds…',micDenied:'Microphone permission denied or unavailable.'}
};
const msg=key=>MSG[lang()]?.[key]||MSG.fr[key];
const isArabic=()=>['ar','darija'].includes(lang());
const append=t=>{const value=String(t||'').trim();if(!value)return;input.value=[input.value.trim(),value].filter(Boolean).join(' ').slice(0,500);input.focus();tell(msg('check'))};
async function load(){
 try{const res=await fetch('/api/public/catalog',{cache:'no-store'});if(!res.ok)throw Error('catalog');const c=await res.json();features=c.features||{}}
 catch{features={};tell(msg('unavailable'),true)}
 cloudButton.hidden=!features.audio_transcription;
 photoButton.hidden=!features.image_intent||!image.files.length;
}
function permitted(){if(consent.checked)return true;tell(msg('consent'),true);return false}
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
image.addEventListener('change',()=>{const file=image.files[0];if(!file){photoButton.hidden=true;return}if(!/^image\/(?:jpeg|png|webp)$/.test(file.type)||file.size>6000000){image.value='';photoButton.hidden=true;tell(msg('invalid'),true);return}
 photoButton.hidden=!features.image_intent;tell(msg(features.image_intent?'selected':'photoOff'))});
photoButton.addEventListener('click',async()=>{
 if(!permitted()||!features.image_intent)return;const file=image.files[0];if(!file)return;
 photoButton.disabled=true;tell(msg('photoWorking'));
 try{const data=await send('/api/public/understand-image',await canvasPhoto(file));append(data.suggested_text);tell(msg('photoDone'))}
 catch(e){tell(msg('photoError'),true)}
 finally{photoButton.disabled=false;image.value='';photoButton.hidden=true}
});
voiceButton.addEventListener('click',()=>{
 if(!permitted())return;const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
 if(!Recognition){tell(msg('speechOff'),true);return}
 if(voiceButton.disabled)return;const rec=new Recognition();rec.lang=locale.value;rec.continuous=false;rec.interimResults=false;rec.maxAlternatives=1;
 voiceButton.disabled=true;tell(msg('speak'));
 rec.onresult=event=>append(event.results?.[0]?.[0]?.transcript||'');
 rec.onerror=event=>tell(msg('speechError'),true);
 rec.onend=()=>{voiceButton.disabled=false};try{rec.start()}catch{voiceButton.disabled=false;tell(msg('micOff'),true)}
});
cloudButton.addEventListener('click',async()=>{
 if(recording||!features.audio_transcription||!permitted())return;
 if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){tell(msg('audioOff'),true);return}
 const mime=['audio/webm','audio/mp4','audio/ogg'].find(m=>MediaRecorder.isTypeSupported?.(m));if(!mime){tell(msg('audioFormat'),true);return}
 let stream;try{stream=await navigator.mediaDevices.getUserMedia({audio:true,video:false});recording=true;cloudButton.disabled=true;
 const parts=[],rec=new MediaRecorder(stream,{mimeType:mime});rec.ondataavailable=e=>{if(e.data.size)parts.push(e.data)};
 rec.onstop=async()=>{stream.getTracks().forEach(t=>t.stop());try{const blob=new Blob(parts,{type:mime});if(blob.size>1400000)throw Error('Taille audio excessive');tell(msg('audioWorking'));const data=await send('/api/public/transcribe-audio',await readBase64(blob));append(data.transcript)}
 catch(e){tell(msg('audioError'),true)}
 finally{recording=false;cloudButton.disabled=false}};
 rec.onerror=()=>{stream.getTracks().forEach(t=>t.stop());recording=false;cloudButton.disabled=false;tell(msg('audioStopped'),true)};
 rec.start();tell(msg('audioRecording'));setTimeout(()=>{if(rec.state==='recording')rec.stop()},10000);
 }catch(e){stream?.getTracks().forEach(t=>t.stop());recording=false;cloudButton.disabled=false;tell(msg('micDenied'),true)}
});
document.addEventListener('allo:language',()=>{if(lang()==='darija')locale.value='ar-MA';else if(lang()==='ar')locale.value='ar-SA';else if(lang()==='en')locale.value='en-US';else locale.value='fr-FR'});
load();
})();
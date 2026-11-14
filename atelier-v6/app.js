'use strict';
/* ALLOSERVIX Studio V6 — accessible, catalogue-grounded navigation.
   No tracking, visitor data storage, or network AI calls. */
(() => {
const $=(id)=>document.getElementById(id);
const all=(selector)=>[...document.querySelectorAll(selector)];
const I=(id)=>{const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('ico');const use=document.createElementNS('http://www.w3.org/2000/svg','use');use.setAttribute('href','#i-'+id);svg.append(use);return svg;};
const state={lang:'fr',page:'home',services:[],cats:[],query:'',selected:[],guideStep:0,guideProfile:null,guideNeed:null,guideDetail:null,category:'all',exploreQuery:'',exploreLimit:6,activeDetail:null};
const words={
 fr:{home:'Accueil',quick:'Réponse rapide',guide:'Accompagnement',explore:'Explorer',passport:'Mon projet',all:'Tous',any:'Tout',noMatches:'Aucune correspondance directe. Votre demande peut néanmoins être étudiée.',empty:'Décrivez votre besoin pour découvrir des pistes.',added:'Solution ajoutée à votre résumé.',copied:'Résumé copié.',error:'Impossible de copier. Sélectionnez puis copiez manuellement.',loading:'Chargement des solutions…',nothing:'Aucun service ne correspond au filtre choisi.',selected:'Sélectionné',guide0:'Où avez-vous besoin d’aide ?',guide1:'Qu’aimeriez-vous faire ?',guide2:'Quel est votre besoin principal ?',contextHome:'Maison / Villa',contextShop:'Commerce / Atelier',contextCompany:'Entreprise / Bureau',note:'Réponse indicative. Une étude est nécessaire.',detail:'Ouvrir les détails',service:'Service à étudier',noProfile:'Non précisé',notSet:'Pas encore renseigné',needHome:'Équipement et services pour domicile',needShop:'Outils et services pour mon commerce',needCompany:'Solutions pour mon entreprise',unknown:'Autre besoin',speakUnsupported:'Lecture vocale non disponible sur ce navigateur.',demo:'Prévisualisation',noVoice:'Votre navigateur ne propose pas de voix pour cette langue.',noPhone:'WhatsApp sera disponible lorsque le contact professionnel sera confirmé.',summaryReady:'Votre résumé est prêt.'},
 ar:{home:'الرئيسية',quick:'جواب سريع',guide:'مرافقة بالصور',explore:'اكتشف',passport:'مشروعي',all:'الكل',any:'أي مجال',noMatches:'ما لقيناش نتيجة مباشرة. ولكن نقدروا ندرسوا طلبك.',empty:'شرح لينا الحاجة باش نقترحو عليك الحلول.',added:'ضفنا هاد الحل لملخصك.',copied:'تنسخ الملخص.',error:'ما قدرناش ننسخو. تقدر تحددو وتنسخو.',loading:'كنحمّلو الخدمات…',nothing:'ما كايناش خدمات كتناسب هاد البحث.',selected:'مختار',guide0:'فين محتاج المساعدة؟',guide1:'شنو بغيتي تدير؟',guide2:'شنو هو الأهم عندك؟',contextHome:'دار / فيلا',contextShop:'محل / ورشة',contextCompany:'شركة / مكتب',note:'هاد معلومات أولية وكتحتاج دراسة قبل التنفيذ.',detail:'شوف التفاصيل',service:'خدمة للدراسة',noProfile:'ما تحددش',notSet:'مازال ما تحددش',needHome:'خدمات للدار',needShop:'خدمات للمحل',needCompany:'خدمات للشركة',unknown:'حاجة أخرى',speakUnsupported:'القراءة الصوتية ما متوفراش فهاد المتصفح.',demo:'نسخة تجريبية',noVoice:'ما لقيناش صوت مناسب لهاد اللغة فالجهاز.',noPhone:'واتساب غادي يكون متاح ملي نأكدوا رقم العمل.',summaryReady:'الملخص واجد.'}
};
const profiles=[{id:'home',fr:'Maison / Villa',ar:'دار / فيلا',hint_fr:'Votre espace de vie',hint_ar:'الدار ديالك',ico:'house'}, {id:'shop',fr:'Commerce / Atelier',ar:'محل / ورشة',hint_fr:'Votre activité au quotidien',hint_ar:'المحل ديالك',ico:'shop'}, {id:'company',fr:'Entreprise / Bureau',ar:'شركة / مكتب',hint_fr:'Votre équipe et vos opérations',hint_ar:'الخدمة ديال الشركة',ico:'building'}];
const needs=[{id:'wifi',fr:'Wi-Fi & réseau',ar:'الويفي والشبكة',ico:'wifi',query:'wifi réseaux connexion',keywords:['wifi','reseau','network']},{id:'camera',fr:'Caméras & accès',ar:'الكاميرات والدخول',ico:'camera',query:'cameras surveillance acces',keywords:['camera','videosurveillance','controle-acces']},{id:'software',fr:'Logiciel de gestion',ar:'برنامج التسيير',ico:'code',query:'logiciel gestion ventes stock',keywords:['logiciel','crm','ecommerce']},{id:'security',fr:'Protection & sauvegarde',ar:'الحماية والنسخ',ico:'shield',query:'securite sauvegarde cloud',keywords:['securite','backup','protection']},{id:'cloud',fr:'Cloud & collaboration',ar:'الكلاود والعمل الجماعي',ico:'cloud',query:'microsoft 365 cloud sharepoint',keywords:['microsoft','azure','sharepoint']},{id:'other',fr:'Autre besoin',ar:'حاجة أخرى',ico:'help',query:'besoin service',keywords:[]}];
const detailOptions=[{id:'advice',fr:'Comprendre les options',ar:'نفهم الاختيارات',ico:'compass',hint_fr:'Je cherche des explications',hint_ar:'بغيت نشرحولي'},{id:'plan',fr:'Préparer un projet',ar:'نوجد مشروع',ico:'grid',hint_fr:'Je veux une première proposition',hint_ar:'بغيت تصور أولي'},{id:'problem',fr:'Résoudre un problème',ar:'نصلح مشكل',ico:'bolt',hint_fr:'J’ai un problème à résoudre',hint_ar:'عندي مشكل خاصو حل'}];
const examples={fr:['Le Wi-Fi ne couvre pas ma maison','Je veux gérer mon stock et mes ventes','Installer des caméras au magasin'],ar:['الويفي ضعيف فالدار','بغيت برنامج للمبيعات والمخزون','بغيت كاميرات للمحل']};
const aliases={
 wifi:['wifi','wi fi','wireless','الويفي','الواي فاي','ويفي','connexion','connectivite','internet','lfoq','kaywselch','ضعيف','شبكه','ريزو','reseau'],
 cameras:['camera','caméra','cameras','كاميرات','كاميرا','video','vidéo','cctv','nvr','surveillance','مراقبه','حراسة','حراسه'],
 logiciel:['gestion','software','program','logiciel','تسيير','برنامج','application','تطبيق','systeme','stock','مخزون','المخزون','vente','ventes','مبيعات','فواتير','factures','erp','crm','commerce'],
 security:['securite','cyber','protection','backup','sauvegarde','حمايه','امن','بيانات','ضياع','نسخ'],
 cloud:['cloud','azure','microsoft','office','365','teams','sharepoint','onedrive','email','بريد'],
 printers:['scan','scanner','imprimante','print','طابعة','طابعه','سكانير','طبع'],
 garage:['garage','motorisation','portail','باب','كراج','بوابه'],
 computer:['pc','ordinateur','laptop','حاسوب','كمبيوتر','صيانة','صيان','ordinateur','ordinateur lent']
};
function norm(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f\u064b-\u065f\u0670\u0640]/g,'').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();}
const t=(id)=>words[state.lang][id]||id;
const label=(item,lang=state.lang)=>item?.[lang]||item?.fr||'';
const catLabel=(cat)=>cat?.[state.lang]||cat?.fr||cat?.id||'';
function setLanguage(lang){state.lang=lang==='ar'?'ar':'fr';document.documentElement.lang=state.lang;document.documentElement.dir=state.lang==='ar'?'rtl':'ltr';
 all('[data-fr][data-ar]').forEach(el=>{const text=el.dataset[state.lang];if(text.includes('<br>')||text.includes('<em>'))el.innerHTML=text;else el.textContent=text;});
 $('current-lang').textContent=state.lang==='fr'?'FR':'عربي';$('next-lang').textContent=state.lang==='fr'?'عربي':'FR';
 $('hero-input').placeholder=state.lang==='ar'?'مثلاً: الويفي ضعيف / برنامج للمخزون / كاميرات...':'Ex. wifi ma kaywselch / logiciel stock / caméra...';
 $('need-input').placeholder=state.lang==='ar'?'مثلاً: بغيت برنامج باش نسيّر المحل ديالي...':'Ex. Je veux gérer mon commerce…';
 $('explore-input').placeholder=state.lang==='ar'?'مثلاً: كاميرات، واي فاي، برامج...':'Caméras, Wi-Fi, gestion, Azure...';
 renderExamples();renderGuide();renderExplorer();updatePassport(); if(!$('quick-results').hidden)renderMatches(state.query);}
function route(page,{focus=true}={}){if(!['home','quick','guide','explore','passport'].includes(page))page='home';state.page=page;
 const activate=()=>{all('.screen').forEach(v=>{const active=v.id==='screen-'+page;v.hidden=!active;v.classList.toggle('active',active);if(active)v.scrollTop=0;});all('[data-route]').forEach(btn=>{const active=btn.dataset.route===page;btn.classList.toggle('active',active);if(active)btn.setAttribute('aria-current','page');else btn.removeAttribute('aria-current');});if(page==='passport')updatePassport(); if(page==='explore')renderExplorer(); if(page==='guide')renderGuide(); if(focus) $('screen-'+page).querySelector('h1')?.focus?.({preventScroll:true});};
 if(document.startViewTransition&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches){document.startViewTransition(activate);}else activate();
 try{history.replaceState(null,'','#'+page);}catch{}
}
function node(tag,cls,text){const el=document.createElement(tag);if(cls)el.className=cls;if(text!=null)el.textContent=text;return el;}
function notify(message){const toast=$('toast');toast.textContent=message;toast.hidden=false;clearTimeout(notify.timer);notify.timer=setTimeout(()=>toast.hidden=true,3400);}
function serviceText(s){return [s.fr,s.ar,s.desc,s.desc_ar,s.terms,...(s.problems||[]),...(s.technologies||[])].filter(Boolean).join(' ');}
function rankServices(query){const q=norm(query);if(!q)return[];const tokens=q.split(' ').filter(w=>w.length>1);const signals=Object.entries(aliases).filter(([_,arr])=>arr.some(w=>q.includes(norm(w)))).map(([key])=>key);return state.services.map(s=>{const title=norm(s.fr+' '+s.ar);const allText=norm(serviceText(s));const hay=norm(s.slug+' '+s.fr+' '+s.ar+' '+s.terms);let score=0;
 if(hay.includes(q))score+=18;
 for(const tok of tokens){if(title.includes(tok))score+=7;else if(hay.includes(tok))score+=4;else if(allText.includes(tok))score+=1;}
 for(const signal of signals){const targeted={wifi:['wifi','reseau','diagnostic-reseau','vpn'],cameras:['cameras','controle-acces'],logiciel:['logiciel','crm','ecommerce','sites-web','dashboards','automatisation'],security:['audit-securite','protection','backup','active-directory'],cloud:['microsoft','azure','sharepoint'],printers:['imprimantes','depannage-pc'],garage:['garage-motorisation'],computer:['depannage-pc','installation-systemes','maintenance-parc']};if((targeted[signal]||[]).some(w=>s.slug.includes(w)))score+=14;}
 return{s,score};}).filter(x=>x.score>1).sort((a,b)=>b.score-a.score).map(x=>x.s).slice(0,7);}
function getCategory(s){return state.cats.find(c=>c.id===s.category)}
function displayResults(query){state.query=query.trim();$('need-input').value=state.query;const list=rankServices(state.query);$('quick-results').hidden=false;const target=$('match-list');target.replaceChildren();const matches=list.slice(0,3);
 if(!matches.length){target.append(node('p','result-empty',t('noMatches')));}else matches.forEach((s,i)=>{const b=node('button','match-card');b.type='button';const number=node('span','',`0${i+1} / ${catLabel(getCategory(s))}`),title=node('strong','',label(s)),desc=node('small','',state.lang==='ar'?s.desc_ar:s.desc);b.append(number,title,desc);b.addEventListener('click',()=>openService(s));target.append(b);});return list;}
function renderMatches(query){return displayResults(query)}
function renderExamples(){const wrap=$('examples');wrap.replaceChildren();examples[state.lang].forEach(text=>{const b=node('button','example-chip',text);b.type='button';b.addEventListener('click',()=>{state.query=text;$('need-input').value=text;displayResults(text);});wrap.append(b);});}
function renderGuide(){const prompt=$('guide-prompt');prompt.textContent=t('guide'+state.guideStep);$('guide-number').textContent=`0${state.guideStep+1} / 03`;$('guide-progress').style.width=(100*(state.guideStep+1)/3)+'%';$('guide-previous').disabled=state.guideStep===0;$('guide-forward').disabled=state.guideStep===0?!state.guideProfile:state.guideStep===1?!state.guideNeed:!state.guideDetail;
 const list=state.guideStep===0?profiles:state.guideStep===1?needs:detailOptions;
 const selected=state.guideStep===0?state.guideProfile:state.guideStep===1?state.guideNeed:state.guideDetail;
 const wrap=$('guide-options');wrap.replaceChildren();list.forEach(item=>{const btn=node('button','guide-card'+(selected===item.id?' selected':''));btn.type='button';btn.setAttribute('aria-pressed',String(selected===item.id));const illustration=node('span','guide-illustration');illustration.append(I(item.ico));btn.append(illustration,node('strong','',label(item)));const hint=item['hint_'+state.lang];if(hint)btn.append(node('small','',hint));btn.addEventListener('click',()=>{if(state.guideStep===0){state.guideProfile=item.id;state.guideNeed=null;state.guideDetail=null;}if(state.guideStep===1){state.guideNeed=item.id;state.guideDetail=null;}if(state.guideStep===2)state.guideDetail=item.id;renderGuide();});wrap.append(btn);});}
function guideFinish(){const profile=profiles.find(p=>p.id===state.guideProfile);const need=needs.find(n=>n.id===state.guideNeed);const detail=detailOptions.find(d=>d.id===state.guideDetail);state.query=(need?.query||'')+' '+(state.guideDetail||'');
 const filtered=rankServices(need?.query||'').slice(0,3);
 state.selected=[...new Set([...state.selected,...filtered.map(s=>s.slug)])];state.guideLabel=[label(profile),label(need),label(detail)].filter(Boolean).join(' · ');
 route('passport');notify(t('summaryReady'));}
function renderExplorer(){const root=$('filter-chips');root.replaceChildren();const allOption=node('button','filter-chip'+(state.category==='all'?' active':''),t('all'));allOption.type='button';allOption.addEventListener('click',()=>{state.category='all';state.exploreLimit=6;renderExplorer();});root.append(allOption);
 state.cats.forEach(cat=>{const btn=node('button','filter-chip'+(state.category===cat.id?' active':''),catLabel(cat));btn.type='button';btn.addEventListener('click',()=>{state.category=cat.id;state.exploreLimit=6;renderExplorer();});root.append(btn);});
 const q=norm(state.exploreQuery);const list=state.services.filter(s=>(state.category==='all'||s.category===state.category)&&(!q||norm(serviceText(s)).includes(q)||rankServices(q).some(x=>x.slug===s.slug)));$('service-count').textContent=String(state.services.length);
 const grid=$('explore-list');grid.replaceChildren();list.slice(0,state.exploreLimit).forEach(s=>{const btn=node('button','service-tile');btn.type='button';btn.append(node('span','',catLabel(getCategory(s))),node('strong','',label(s)),node('small','',state.lang==='ar'?s.desc_ar:s.desc),node('span','tile-arrow','↗'));btn.addEventListener('click',()=>openService(s));grid.append(btn);});if(!list.length)grid.append(node('p','result-empty',t('nothing')));
 $('load-more').hidden=list.length<=state.exploreLimit;}
function openService(s){state.activeDetail=s;$('detail-category').textContent=catLabel(getCategory(s));$('detail-title').textContent=label(s);$('detail-desc').textContent=state.lang==='ar'&&s.desc_ar?s.desc_ar:s.desc||'';
 const ul=$('detail-includes');ul.replaceChildren();(s.includes||[]).slice(0,8).forEach(v=>ul.append(node('li','',v)));
 const tech=$('detail-tech');tech.replaceChildren();(s.technologies||[]).slice(0,12).forEach(v=>tech.append(node('span','',v)));
 if($('detail-dialog').showModal)$('detail-dialog').showModal();else $('detail-dialog').setAttribute('open','');}
function closeService(){if($('detail-dialog').close)$('detail-dialog').close();else $('detail-dialog').removeAttribute('open');}
function addService(s){if(!s)return;if(!state.selected.includes(s.slug))state.selected.push(s.slug);closeService();updatePassport();notify(t('added'));}
function passportText(){const services=state.services.filter(s=>state.selected.includes(s.slug));const title=state.lang==='ar'?'ملخص مشروع ALLOSERVIX':'ALLOSERVIX / Passeport Solution';const need=state.query||t('notSet');const profile=state.guideLabel||t('noProfile');return [title,'',`${state.lang==='ar'?'الحاجة':'BESOIN'} : ${need}`,`${state.lang==='ar'?'النشاط':'CONTEXTE'} : ${profile}`,'',`${state.lang==='ar'?'الحلول الأولية':'SERVICES À ÉTUDIER'} :`,...services.map(s=>'- '+label(s)),'',t('note')].join('\n');}
function updatePassport(){const selected=state.services.filter(s=>state.selected.includes(s.slug));$('passport-need').textContent=state.query||t('notSet');$('passport-context').textContent=state.guideLabel||t('noProfile');const ul=$('passport-services');ul.replaceChildren();if(!selected.length)ul.append(node('li','',t('notSet')));selected.forEach(s=>ul.append(node('li','',label(s))));
 const config=window.ALLO_CONFIG||{};let phone=String(config.whatsappNumber||'').replace(/\D/g,'');if(config.contactReady===true&&/^\d{10,15}$/.test(phone)){const a=$('passport-whatsapp');a.href='https://wa.me/'+phone+'?text='+encodeURIComponent(passportText());a.hidden=false;}else $('passport-whatsapp').hidden=true;
}
function speak(text){const tts=window.speechSynthesis;if(!tts){notify(t('speakUnsupported'));return;}try{tts.cancel();const utterance=new SpeechSynthesisUtterance(text);utterance.lang=state.lang==='ar'?'ar-MA':'fr-FR';utterance.rate=.85;tts.speak(utterance);}catch{notify(t('speakUnsupported'));}}
async function loadServices(){let d;try{const r=await fetch('/api/public/catalog',{credentials:'omit',cache:'no-store'});if(!r.ok)throw Error('API');d=await r.json();}catch{try{const r=await fetch('/assets/services.json',{cache:'no-store'});if(!r.ok)throw Error('Catalog');d=await r.json();}catch{d={categories:[],services:[]};}}state.cats=d.categories||[];state.services=(d.services||[]).filter(s=>s&&s.slug&&s.fr&&s.status!=='Indisponible');renderExplorer();}
function bind(){all('[data-route]').forEach(btn=>btn.addEventListener('click',()=>route(btn.dataset.route)));
 $('lang-toggle').addEventListener('click',()=>setLanguage(state.lang==='fr'?'ar':'fr'));
 $('hero-search').addEventListener('submit',e=>{e.preventDefault();const value=$('hero-input').value.trim();state.query=value;route('quick');$('need-input').value=value;if(value)displayResults(value);else $('need-input').focus();});
 $('quick-form').addEventListener('submit',e=>{e.preventDefault();const value=$('need-input').value.trim();if(!value){notify(t('empty'));return;}displayResults(value);});
 $('read-question').addEventListener('click',()=>speak(state.lang==='ar'?'شرح لينا شنو المشكل ولا شنو بغيتي تدير.':'Décrivez votre problème ou votre projet, avec vos mots.'));
 $('to-passport').addEventListener('click',()=>{state.selected=[...new Set([...state.selected,...rankServices(state.query).slice(0,3).map(s=>s.slug)])];route('passport')});
 $('guide-speak').addEventListener('click',()=>speak(t('guide'+state.guideStep)));
 $('guide-previous').addEventListener('click',()=>{if(state.guideStep>0)state.guideStep--;renderGuide();});
 $('guide-forward').addEventListener('click',()=>{if(state.guideStep<2){state.guideStep++;renderGuide();}else guideFinish();});
 $('explore-input').addEventListener('input',e=>{state.exploreQuery=e.target.value;state.exploreLimit=6;renderExplorer();});
 $('load-more').addEventListener('click',()=>{state.exploreLimit+=6;renderExplorer();});
 $('close-detail').addEventListener('click',closeService);$('detail-dialog').addEventListener('click',e=>{if(e.target===$('detail-dialog'))closeService();});
 $('choose-detail').addEventListener('click',()=>addService(state.activeDetail));
 $('passport-copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(passportText());notify(t('copied'));}catch{const ta=node('textarea');ta.value=passportText();document.body.append(ta);ta.select();try{document.execCommand('copy');notify(t('copied'));}catch{notify(t('error'));}ta.remove();}});
 $('passport-print').addEventListener('click',()=>window.print());
 window.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();route('quick', {focus:false});$('need-input').focus();}if(e.key==='Escape'&&!$('detail-dialog').open){if(state.page!=='home')route('home');}});
 window.addEventListener('hashchange',()=>{const dest=location.hash.slice(1);if(['home','quick','guide','explore','passport'].includes(dest)&&dest!==state.page)route(dest,{focus:false});});
 const param=new URLSearchParams(location.search).get('src');const allowed={flyer:{fr:'Bienvenue depuis notre flyer',ar:'مرحبا من الفلاير'},sticker:{fr:'Bienvenue depuis notre autocollant',ar:'مرحبا من الملصق'},card:{fr:'Bienvenue depuis notre carte',ar:'مرحبا من البطاقة'}};if(param&&allowed[param]){const banner=$('campaign-hint');banner.textContent=allowed[param][state.lang];banner.hidden=false;}
}
async function boot(){bind();setLanguage('fr');renderGuide();await loadServices();const hash=location.hash.substring(1);route(['home','quick','guide','explore','passport'].includes(hash)?hash:'home',{focus:false});}
boot();
})();
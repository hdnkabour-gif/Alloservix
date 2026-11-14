'use strict';
// Deterministic bilingual intent engine. Never treats a keyword match as a confirmed diagnosis or quotation.
const clean = value => String(value || '').normalize('NFKD')
  .replace(/[\u0300-\u036f\u064B-\u065F\u0670\u0640]/g, '')
  .replace(/[أإآ]/g, 'ا').replace(/[ى]/g,'ي').replace(/[ة]/g,'ه')
  .toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const groups = [
  {id:'wifi',label:'Wi-Fi & réseau sans fil',keywords:'wifi wi fi wireless wi-fi internet routeur router mesh borne point d acces tp link box انترنت ويفي واي فاي الويفي روتر راوتر موديم reseau sans fil ماكيوصلش faible coverage poor signal ma kaywselch',related:['network']},
  {id:'pc',label:'Ordinateurs & systèmes',keywords:'ordinateur laptop pc windows mac macos linux ubuntu mint fedora debian desktop logiciel formatage format reinstall installation reinstallation reset فورمات فرمتة ويندوز لينكس حاسوب كومبيوتر بي سي بيسي طابعة disque ssd ram slow بطيء restart redemarre boot écran noir',related:['it']},
  {id:'printer',label:'Impression & scan',keywords:'scanner scan numérisation imprimante printer print bizhub konica hp epson brother طابعة سكاني سكانير طبع impression photocopieur photocopie smb',related:['it']},
  {id:'software',label:'Logiciel métier & applications',keywords:'application apps app logiciel programme erp crm stock facturation commande commandes ventes inventaire boutique caisse point de vente gestion catalogue web api logiciel custom automation automatise ابليكاسيون تطبيق برنامج مخزون مبيعات فواتير زبناء كريدي تسيير برمجة commandes',related:['software','ai']},
  {id:'camera',label:'Vidéosurveillance',keywords:'cctv caméras camera ip nvr dvr surveillance video sécurité vidéo مراقبة كاميرا كاميرات تسجيل تصوير مايشوفش appareil enregistrement',related:['physical']},
  {id:'cloud',label:'Cloud & Microsoft',keywords:'microsoft azure 365 office onedrive sharepoint teams entra intune mail exchange migration aws gcp cloud serveur virtuel email professionnel سحابة كلاود مايكروسوفت',related:['cloud']},
  {id:'servers',label:'Serveurs, virtualisation & armoires',keywords:'serveur servers vmware esxi hyper-v hyperv proxmox vm vmr vrm docker kubernetes rack baie armoire switch patch panel nas ups linux windows server vcenter vm virtualisation سيرفر خادم راك ارموار شبكة cablage câblage datacenter',related:['servers','network']},
  {id:'network',label:'Câblage & infrastructure réseau',keywords:'lan wan ethernet rj45 fibre cablage câblage patch panel rack baie armoire switch routeur router dns dhcp vlan lan network networker reseau réseau سويتش كابلاج كابل شبكة انترنيت fibre optique câble',related:['network','servers']},
  {id:'satellite',label:'TV, antennes & satellite',keywords:'satellite parabole parabolique lnb décodeur decodeur dvb receiver tv télévision tele télé écran signal reception astra nilesat badr télévision iptv هوائي بارابول طبق استقبال ستالايت ريسيفر تلفاز تيليفزيون دش صحن',related:['audiovisual']},
  {id:'fire',label:'Détection incendie & alarmes',keywords:'incendie feu smoke fire fumee fumée détecteur detector alarme centrale securite urgence extinction اطفاء حريق حرائق دخان كاشف انذار حساس حريق',related:['fire']},
  {id:'automation',label:'Portes & domotique',keywords:'domotique smart home maison connectee motorisation moteur garage portail porte automatique volets interphone visiophone control acces sensor capteur maison intelligent باب موتور محرك باب كراج اوتوماتيك حساسات سمارت interphone',related:['automation','physical']},
  {id:'security',label:'Cybersécurité & sauvegardes',keywords:'securite sécurité cybersecurity firewall vpn backup sauvegarde restauration ransomware virus malware antivirus pirate piratage hacking mots de passe protection donnees confidentialité حماية اختراق نسخ احتياطي فايروس باسورد حماية بيانات',related:['security','servers']},
  {id:'advice',label:'Conseil & accompagnement',keywords:'conseil etude étude audit choisir acheter prix tarif budget devis quotation comparatif fournisseur maintenance contrat assistance support formation solution diagnostic diagnostic estimation استشارة ثمن تكلفة سعر دراسة اقتراح شراء جهاز معدات اختيار',related:['consulting']}
];
const actions = [
  {id:'repair',words:'panne problem problème ne marche pas ne fonctionne pas lent cassé erreur souci réparer dépanner fixer troubleshoot مشكل مشكلة معطل مكيخدمش ماكيخدمش ما كيخدمش خاسر تصلح تصليح صيانة ضعف ضعيف بطيء عطب ma kaywselch error'},
  {id:'install',words:'installer installation pose monter mise en place config configurer setup deployer paramétrer paramétrage formatage reinstaller reinstall فورمات فرمتة نثبت تثبيت تركيب تنصيب تثبيت إعداد'},
  {id:'choose',words:'acheter choix choisir prix tarif coût cout budget devis fournisseur comparer comparatif equipement matériel équipements matériel مواصفات ثمن سعر التكلفة شحال نختار شراء نشتري معدات devis'},
  {id:'build',words:'developper développement construire creer créer site application logiciel projet app sur mesure web custom automatisation برمجة تصميم تطوير بناء إنشاء نبني نوجد برنامج'},
  {id:'learn',words:'comment pourquoi c est quoi qu est ce que peut on savoir explication question information conseil كيفاش كيف لماذا علاش شنو ماهي واش ممكن استفسار بغيت نعرف شرح فرق'},
  {id:'followup',words:'suivi maintenance surveillance monitor monitoring sauvegarde supervision support contrat evolution update mise a jour مساعدة متابعة مراقبة مراقبتها دعم تحديث صيانة دورية'}
];
const actionLabels={repair:['Dépannage / réparation','إصلاح عطل'],install:['Installation / configuration','تركيب أو إعداد'],choose:['Choix du matériel / étude de prix','اختيار معدات أو دراسة الثمن'],build:['Nouveau projet / développement','مشروع جديد أو تطوير'],learn:['Question / conseil','استشارة أو استفسار'],followup:['Suivi / maintenance','المتابعة والصيانة']};
const genericWords=new Set(['sans','avec','pour','un','une','de','du','la','le','les','et','des','sur','en','dans','point','ma','mon','pas','on','au','par','is','the']);
function phrases(words){return clean(words).split(' ').filter(w=>w&&!genericWords.has(w))}
function contains(q,part){const w=clean(part);return w && (' '+q+' ').includes(' '+w+' ')}
function tokenOverlap(q,terms){const txt=' '+clean(terms)+' ';return q.split(' ').filter(w=>w.length>2||w==='tv'||w==='ip').reduce((acc,w)=>acc+(txt.includes(' '+w+' ')?1:0),0)}
function detect(query){
 const queryText=clean(query),hits=[];
 // Explicit specialist signals take priority over generic words such as installation, conseil or maintenance.
 const signals=[
  ['fire',/(?:incendie|detecteur.*(?:incendie|fumee)|حريق|حرائق|كاشف.*(?:حريق|دخان)|الانذار.*الحريق)/u],
  ['satellite',/(?:parabole|satellite|recepteur|decodeur|t[eé]l[eé]viseur|\btv\b|بارابول|ريسيفر|تلفاز|اشاره.*طبق)/u],
  ['servers',/(?:serveur|servers?|vmware|proxmox|esxi|hyper\s*v|hyperv|virtualis|vcenter|\bvmr\b|\bvrm\b|nas|سيرفر|خادم)/u],
  ['automation',/(?:porte automatique|portail|motorisation|domotique|باب.*(?:اوتوماتيك|المراب|الكراج)|كراج|garage|interphone|باب الي)/u],
  ['software',/(?:logiciel|\berp\b|\bcrm\b|application|programme de gestion|stock|factur|inventair|مخزون|مبيعات|برمجه|ابليكاسيون|برنامج|تسيير|فواتير)/u],
  ['camera',/(?:cam[eé]ra|\bcctv\b|\bnvr\b|\bdvr\b|كاميرا|كاميرات|مراقبه بالفيديو)/u],
  ['printer',/(?:imprimant|scanner|scan vers|numeris|طابعه|طابعة|سكانير|سكان|الطابعه)/u],
  ['security',/(?:sauvegard|backup|ransomware|firewall|cybers[eé]curit|نسخ.*احتياط|النسخ.*احتياط|استرجاع.*(?:بيانات|ملفات)|اختراق|فايروس)/u],
  ['cloud',/(?:microsoft|azure|office 365|sharepoint|onedrive|intune|exchange|cloud|مايكروسوفت|السحابه)/u],
  ['wifi',/(?:\bwi\s?fi\b|wifi|الويفي|واي\s?فاي|راوتر|روتر|wireless|\bmesh\b)/u],
  ['network',/(?:cablage|câblage|\brj45\b|fibre|ethernet|switch|\bvlan\b|armoire|كابلاج|كابل|راك|ارموار|شبكه|الشبكة)/u],
  ['pc',/(?:ordinateur|laptop|\bpc\b|windows|formatage|reinstall|\bmac\b|\bubuntu\b|لينكس|ويندوز|فورمات|حاسوب|كومبيوتر|بيسي)/u],
 ];
 const special=signals.find(([,reg])=>reg.test(queryText));
 for(const g of groups){let score=0;for(const term of phrases(g.keywords))if(contains(queryText,term))score+=term.length>=5?2:1;if(g.id===special?.[0])score+=30;if(score)hits.push({...g,score})}
 hits.sort((a,b)=>b.score-a.score);
 const scored=actions.map(a=>({...a,score:phrases(a.words).reduce((sum,w)=>sum+(contains(queryText,w)?1:0),0)})).sort((a,b)=>b.score-a.score);
 // High-confidence action wording, including natural Moroccan phrasing.
 const actionHints=[
  ['choose',/(?:\bprix\b|combien|devis|budget|شحال|ثمن|التكلفه|تكلفه|نقارن|نختار|اشري)/u],
  ['repair',/(?:معطل|مكيخدم|ماكيخدم|ضعيف|ماكيوصل|مشكل|panne|bloqu|lent|erreur|bug|لا تعمل)/u],
  ['install',/(?:نركب|بغيت نثبت|فورمات|فرمت|installer|install|reinstall|configur|mise en place)/u],
  ['build',/(?:بغيت برنامج|بغيت تطبيق|تطوير|برمجه|developp|cr[eé]er une application|site web sur mesure)/u],
  ['learn',/(?:كيفاش|كيف|pourquoi|comment|c est quoi|بغيت نعرف|ما معنى|شنو هو)/u]
 ];
 const hinted=actionHints.find(([,re])=>re.test(queryText));
 const kind=hinted?.[0]||(scored[0]?.score?scored[0].id:(['software','ai'].includes(hits[0]?.id)?'build':'learn'));
 return {topic:hits[0]?.id||'advice',topicLabel:hits[0]?.label||'Conseil technique',action:kind,actionFr:actionLabels[kind][0],actionAr:actionLabels[kind][1],topics:hits.slice(0,3).map(x=>x.id),confidence:hits[0]?.score>=4?'probable':'à confirmer'};
}
const specificServices=[
 [/\bformatage\b|\bwindows\b.*(?:reinstall|format)|فورمات|فرمت|ويندوز.*تنصيب/u,['reinstallation-windows','installation-systemes']],
 [/wifi|wi fi|الويفي|واي فاي|mesh/u,['wifi-maillage','wifi-professionnel','diagnostic-reseau']],
 [/\bvmware\b|\bproxmox\b|\besxi\b|\bvmr\b|\bvrm\b/u,['vmware-proxmox','virtualisation','serveurs-windows-linux']],
 [/نسخ.*احتياط|sauvegarde|backup/u,['backup-restauration','sauvegarde-pme','nas-partage']],
 [/\bportail\b|porte automatique|باب.*اوتوماتيك/u,['motorisation-portail','garage-motorisation']],
 [/كراج|garage/u,['garage-motorisation','motorisation-portail']],
 [/حريق|incendie|fumee|détecteur|detecteur/u,['detection-incendie','alarme-incendie-centrale','maintenance-detecteurs']],
 [/بارابول|parabole|satellite/u,['antenne-parabole','reception-tv']],
 [/كاميرا|كاميرات|camera|caméra|cctv/u,['cameras-ip','caméras-analogiques','stockage-video']],
 [/مخزون|stock|inventaire|ventes/u,['logiciel-stock','logiciel-stock-multisite']],
 [/\blinux\b|لينكس/u,['serveur-linux-web','installation-linux-desktop','serveurs-windows-linux']]
];
function rank(query,all,intent){
 const raw=clean(query),tokens=raw.split(' ').filter(w=>w.length>1);
 const group=groups.find(x=>x.id===intent.topic),related=new Set(group?.related||[]);
 if(intent.topic==='advice')related.add('consulting');
 const rules=specificServices.filter(([pattern])=>pattern.test(raw));
 const boosts=new Map();for(const [,slugs] of rules)slugs.forEach((slug,i)=>boosts.set(slug,Math.max(boosts.get(slug)||0,40-i*7)));
 const generic=new Set('je veux un une le la les mon ma pour du de et ou en sur avec des the pour مع بغيت ديال عندي اريد بغيتي بغيت اليوم تركيب installation installer service besoin عندي نريد'.split(' '));
 const scored=all.filter(s=>s.published!==false&&s.status!=='Indisponible').map(s=>{
   const title=clean(s.fr+' '+s.ar),terms=clean([s.terms,...s.technologies,...s.problems].join(' ')),desc=clean(s.desc+' '+s.desc_ar);
   let evidence=0;for(const w of tokens){if(generic.has(w))continue;
     if((' '+title+' ').includes(' '+w+' '))evidence+=10;
     else if((' '+terms+' ').includes(' '+w+' '))evidence+=5;
     else if((' '+desc+' ').includes(' '+w+' '))evidence+=2;
   }
   const highlight=boosts.get(s.slug)||0;
   const sameDomain=related.has(s.category);
   const score=evidence+highlight+(sameDomain?12:-12)+(intent.topic==='advice'&&s.category==='consulting'?5:0);
   return {s,score,evidence,highlight,sameDomain};
 }).filter(x=>x.highlight>0||(x.evidence>0&&(x.sameDomain||x.evidence>=16)))
   .sort((a,b)=>b.score-a.score||b.evidence-a.evidence||a.s.fr.localeCompare(b.s.fr,'fr'));
 return scored.slice(0,6).map(x=>({...x.s,score:x.score,url:'/services/'+x.s.slug+'.html'}));
}
const q=(id,fr,ar,options)=>({id,fr,ar,options:options.map(([value,f,a])=>({value,fr:f,ar:a}))});
function questionsFor(intent,answers={}){
 let list=[];
 const context=q('context','Où se situe votre besoin ?','فين كاين هاد الاحتياج؟', [['home','Maison / villa','دار / فيلا'],['shop','Commerce / atelier','محل / ورشة'],['company','Entreprise / bureau','شركة / مكتب'],['other','Autre','مكان آخر']]);
 const detail={
 wifi:q('detail','Quel est le problème principal ?','شنو المشكل بالضبط؟', [['coverage','Le signal ne couvre pas tout','الإشارة ماكتوصلش لكلشي'],['speed','Internet lent','الانترنت بطيء'],['new','Nouvelle installation','تركيب جديد'],['unknown','Je ne sais pas','ماعارفش']]),
 pc:q('detail','Quel système ou appareil ?','شنو الجهاز أو النظام؟',[['windows','PC / Windows','حاسوب / ويندوز'],['linux','Linux','لينكس'],['mac','Mac / macOS','ماك'],['unknown','Je ne sais pas','ماعارفش']]),
 printer:q('detail','Quelle intervention souhaitez-vous ?','شنو باغي بالضبط؟',[['scan','Scan / numérisation','السكانير'],['print','Impression','الطباعة'],['connect','Connexion au réseau','ربط بالشبكة'],['unknown','Je ne sais pas','ماعارفش']]),
 software:q('detail','Quel type de solution ?','شنو نوع الحل؟',[['stock','Ventes / stock / factures','مبيعات / مخزون / فواتير'],['web','Site web / application','موقع / تطبيق'],['crm','Clients / CRM','الزبناء / CRM'],['other','Autre idée','فكرة أخرى']]),
 camera:q('detail','Quelles zones souhaitez-vous couvrir ?','فين باغي المراقبة؟',[['inside','À l’intérieur','الداخل'],['outside','À l’extérieur','الخارج'],['both','Les deux','بجوج'],['unsure','Besoin d’une étude','باغي دراسة']]),
 servers:q('detail','Quelle infrastructure ?','شنو البنية اللي عندك؟',[['linux','Serveur Linux','سيرفر Linux'],['windows','Windows Server','Windows Server'],['vm','VMware / Proxmox / VM','Virtualisation / VM'],['rack','Baie / armoire / câblage','باية / كابلاج']]),
 cloud:q('detail','Quel service cloud ?','شنو الخدمة السحابية؟',[['m365','Microsoft 365 / Teams','Microsoft 365'],['azure','Azure','Azure'],['identity','Identités / accès','الحسابات والصلاحيات'],['other','Autre / étude','آخر / دراسة']]),
 satellite:q('detail','Quelle installation ?','شنو الجهاز؟',[['dish','Parabole / récepteur','بارابول / ريسيفر'],['tv','TV / réception','تلفاز / استقبال'],['signal','Signal faible / absent','إشارة ضعيفة أو غائبة'],['other','Autre','آخر']]),
 fire:q('detail','Quel type de besoin ?','شنو نوع الحاجة؟',[['study','Étude / conformité','دراسة / مطابقة'],['detection','Détection / alarme','كواشف / إنذار'],['maintenance','Vérification / maintenance','فحص / صيانة'],['unknown','Je ne sais pas','ماعارفش']]),
 automation:q('detail','De quel équipement s’agit-il ?','شنو الجهاز؟',[['garage','Porte de garage','باب كراج'],['access','Portail / contrôle d’accès','باب / تحكم الولوج'],['home','Domotique','منزل ذكي'],['other','Autre','آخر']]),
 security:q('detail','Quel enjeu principal ?','شنو الأولوية ديالك؟',[['protection','Protéger les accès','حماية الحسابات'],['backup','Sauvegarde / récupération','نسخ / استرجاع'],['audit','Audit / état des lieux','تدقيق'],['unknown','Besoin de conseil','محتاج استشارة']]),
 network:q('detail','Quel besoin réseau ?','شنو حاجة الشبكة؟',[['cabling','Câblage RJ45 / fibre','كابلاج / فايبر'],['router','Routeur / switch','راوتر / سويتش'],['rack','Baie / armoire réseau','أرموار شبكة'],['trouble','Réseau en panne','عطل فالشبكة']]),
 advice:q('detail','Comment souhaitez-vous être aidé ?','كيفاش نعاونوك؟',[['understand','Comprendre le problème','نفهم المشكل'],['equipment','Choisir un équipement','اختيار جهاز'],['estimate','Étudier le budget','دراسة الميزانية'],['project','Monter un projet','إنجاز مشروع']])
 };
 const eq=detail[intent.topic]||detail.advice;
 list=[context,eq];if(intent.action==='choose'){list=[eq,q('budget','Quel niveau de budget envisagez-vous ?','شنو الميزانية اللي مفكر فيها؟',[['eco','Économique','اقتصادية'],['balanced','Équilibrée','متوسطة'],['premium','Professionnelle','احترافية'],['unknown','À définir','مازال']])];}
 return list.filter(x=>!answers[x.id]).slice(0,2);
}
const equipment={
 wifi:['Point d’accès Wi-Fi / mesh','Routeur et switch PoE (si nécessaire)','Plan de couverture et câblage'],
 camera:['Caméras adaptées à la scène','Enregistreur NVR/DVR et stockage','Câbles, alimentation, accès distant'],
 printer:['Connexion réseau / pilote','Paramètres SMTP / SMB (si scan)','Diagnostic consommables et appareil'],
 pc:['Diagnostic matériel et logiciels','Système et pilotes compatibles','Sauvegarde avant intervention'],
 network:['Câbles et prises RJ45/fibre selon site','Switch, routeur, panneaux de brassage','Tests de liens et étiquetage'],
 servers:['Serveur, hyperviseur ou stockage selon usage','Système Linux/Windows et licences','Onduleur, supervision et sauvegarde'],
 cloud:['Abonnements/licences à vérifier','Identités et authentification MFA','Sauvegarde, migration et formation'],
 software:['Fonctions et flux métier','Accès PC/mobile et rôles','Hébergement, sécurité et maintenance'],
 satellite:['Parabole/antenne et LNB compatibles','Décodeur / téléviseur / connectiques','Réglage signal et essais'],
 fire:['Diagnostic et étude réglementaire','Détecteurs et centrale certifiés selon usage','Installation/essais par professionnel qualifié'],
 automation:['Motorisation adaptée au mécanisme','Capteurs de sécurité et commandes','Essais et maintenance'],
 security:['Inventaire des accès et équipements','MFA, sauvegarde, mises à jour','Tests et politique de récupération'],
 advice:['Diagnostic de l’existant','Comparaison de solutions compatibles','Devis détaillé après vérification']
};
const steps={
 fr:['Comprendre le besoin','Diagnostiquer et étudier le site','Comparer les équipements et le coût total','Installer, configurer ou développer','Tester, expliquer et assurer le suivi'],
 ar:['فهم الحاجة','تشخيص الوضع ودراسة المكان','مقارنة المعدات والتكلفة الكاملة','التركيب أو الإعداد أو البرمجة','الاختبار والشرح والمتابعة']
};
function build(query,all,answers={}){
 const intent=detect(query),matches=rank(query,all,intent),pending=questionsFor(intent,answers),ar=/[\u0600-\u06ff]/.test(query);
 const title=matches.length? (ar?matches[0].ar:matches[0].fr):intent.topicLabel;
 const answer=matches.length?ar?`فهمت أنك كتقلب على ${intent.actionAr} فمجال ${title}. نقدرو نوضحو الخيارات التقنية والخطوات والمعدات الممكنة، ولكن خاص الفريق يتأكد من التنفيذ والثمن بعد دراسة الحاجة.`:`Votre demande concerne ${intent.actionFr.toLowerCase()} : ${title}. Nous pouvons expliquer les options, les étapes et le matériel possible. Faisabilité et prix doivent être confirmés après étude.`:ar?'ما لقيتش تطابق كافي، لكن نقدر نعاونك نفهم الاحتياج ونهيّئ طلب دراسة للفريق، حتى لو غير استفسار صغير.':'Je ne trouve pas de correspondance fiable. Décrivez-nous votre besoin : même une petite question peut être étudiée.';
 return {intent,answer,matches:matches.map(({slug,fr,ar,desc,status,url,score,category})=>({slug,title:fr,arabic:ar,description:desc,status,url,score,category})),questions:pending,equipment:equipment[intent.topic]||equipment.advice,steps,examples:matches.slice(0,4).map(s=>({slug:s.slug,title:ar?s.ar:s.fr})),cost:{kind:'sur-devis',message:ar?'الثمن كيتحدد حسب التشخيص والمعدات ووقت الخدمة؛ نعطيوك اختيارات اقتصادية أو متوسطة أو احترافية بعد الدراسة.':'Prix sur devis selon diagnostic, matériel, licences et intervention ; options économiques, équilibrées et professionnelles à comparer.'},disclaimer:'Les suggestions ne sont ni un diagnostic garanti, ni un engagement contractuel. Toute prestation est sur étude.'};
}
module.exports={clean,detect,rank,questionsFor,build};

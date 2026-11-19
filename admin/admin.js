(()=>{'use strict';const $=id=>document.getElementById(id);const ctx={csrf:null,services:[],settings:{}};
async function api(route,opts={}){const method=opts.method||'GET';const res=await fetch(route,{method,credentials:'same-origin',headers:{'Content-Type':'application/json',...(method!=='GET'?{'X-CSRF-Token':ctx.csrf||''}:{})},body:opts.data?JSON.stringify(opts.data):undefined});let data={};try{data=await res.json()}catch{}if(!res.ok)throw Error(data.error||`HTTP ${res.status}`);return data}
function msg(s,bad=false){$('alert').textContent=s;$('alert').classList.toggle('error',bad)}
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=String(text);return n};
function renderLines(id,rows,key,val){const root=$(id);root.replaceChildren();if(!rows||!rows.length){root.append(el('p','muted','Aucune donnée pour le moment.'));return}for(const item of rows){const line=el('div','line');line.append(el('span','name',item[key]||'—'),el('b','',item[val]));root.append(line)}}
// Read-only, server-grounded unified control plane. No secret values or sensitive customer details.
const put=(id,value)=>{const target=$(id);if(target)target.textContent=String(value??'—')};
const tinyLine=(container,label,value)=>{const parent=$(container),row=el('div','mini-line');row.append(el('span','',label),el('strong','',value));parent.append(row)};
function displayCommand(data){
 const c=data.catalogue,k=data.knowledge,w=data.work,ai=data.intelligence,site=data.website,sec=data.security;
 put('control-time','Actualisé : '+new Date(data.generated_at).toLocaleString('fr-MA'));
 put('cmd-services',c.total);put('cmd-service-sub',c.published+' publiées · '+c.available+' disponibles confirmées');
 put('cmd-requests',w.requests);put('cmd-request-sub',w.unresolved+' ouvertes');
 put('cmd-technicians',w.technicians);put('cmd-technician-sub',w.active_technicians+' actifs et vérifiés');
 put('cmd-knowledge',k.concept_approved+' / '+k.concepts);put('cmd-knowledge-sub',k.link_approved+' relations approuvées sur '+k.links);
 put('cmd-service-review',c.in_study+' en étude, '+c.hidden+' fiches masquées. Le catalogue ne garantit pas la disponibilité.');
 $('cmd-categories').replaceChildren();for(const item of c.categories)tinyLine('cmd-categories',item.category,item.total+' prestations · '+item.available+' disponibles');
 $('cmd-ops').replaceChildren();tinyLine('cmd-ops','Dossiers à traiter',w.unresolved);tinyLine('cmd-ops','Techniciens vérifiés et actifs',w.active_technicians);tinyLine('cmd-ops','Formulaires de contact',w.inquiries);
 $('cmd-ai').replaceChildren();tinyLine('cmd-ai','Classification externe',ai.features.text?'Activée':'Désactivée');
 tinyLine('cmd-ai','Images / audio',(ai.features.image?'Images actives':'Images inactives')+' · '+(ai.features.audio?'Audio actif':'Audio inactif'));
 tinyLine('cmd-ai','Clés de fournisseurs disponibles',ai.configured_providers.filter(p=>p.key_configured).length+' / '+ai.configured_providers.length);
 $('cmd-publish').replaceChildren();tinyLine('cmd-publish','Email professionnel',site.public_contact_email_set?'Renseigné':'À renseigner');
 tinyLine('cmd-publish','WhatsApp',site.public_whatsapp_set?'Renseigné':'À renseigner');
 tinyLine('cmd-publish','Statistiques visiteurs',site.analytics_enabled?'Activées (avec consentement)':'Non activées');
 tinyLine('cmd-publish','Demandes clients',site.requests_enabled?'Activées':'Non activées');
 put('ai-usage',ai.usage.used);put('ai-quota','Limite quotidienne : '+ai.usage.daily_limit);
 put('ai-text',ai.features.text?'Actif':'Inactif');put('ai-image',ai.features.image?'Actif':'Inactif');put('ai-audio',ai.features.audio?'Actif':'Inactif');
 $('ai-providers').replaceChildren();for(const provider of ai.configured_providers)tinyLine('ai-providers',provider.name,provider.key_configured?'Clé présente':'Clé absente');
 $('security-checks').replaceChildren();
 tinyLine('security-checks','Accès administrateur + authentification à deux facteurs',sec.admin_configured&&sec.mfa_required?'Configurés':'À configurer');
 tinyLine('security-checks','Plusieurs administrateurs avec rôles',sec.multiple_admin_accounts?'En place':'Pas encore disponibles');
 tinyLine('security-checks','Protection chiffrée des demandes',sec.encrypted_requests_ready?'Clé présente':'À configurer');
 tinyLine('security-checks','Collecte des contacts',site.inquiries_enabled?'Activée':'Non activée');
 tinyLine('security-checks','Demandes d’intervention',site.requests_enabled?'Activées':'Non activées');
 tinyLine('security-checks','Certificats de domaines et routage', 'Contrôle externe requis sur Railway');
 tinyLine('security-checks','Sauvegardes et restaurations','Contrôle externe requis');
}
async function loadCommand(){try{const data=await api('/api/admin/control-center');displayCommand(data)}catch(e){msg('Centre de contrôle indisponible : '+e.message,true)}}
$('control-refresh').addEventListener('click',loadCommand);
document.querySelectorAll('[data-control-tab]').forEach(b=>b.addEventListener('click',()=>{
 const target=document.querySelector('[data-tab="'+b.dataset.controlTab+'"]');if(target)target.click();
}));

async function showAdmin(){ $('login-wrap').hidden=true;$('dashboard').hidden=false;$('logout').hidden=false;await Promise.all([refresh(),loadCommand()]) }
async function refresh(){try{const o=await api('/api/admin/overview');ctx.settings=o.settings;$('stat-visitors').textContent=o.analytics.visitors;$('stat-events').textContent=o.analytics.events;$('stat-services').textContent=o.published_services+' / '+o.total_services;$('stat-inquiries').textContent=o.inquiries;renderLines('popular-pages',o.analytics.pages,'route','n');renderLines('popular-searches',o.analytics.searches,'target','n');renderLines('last-section',o.analytics.exits,'section','n');renderLines('popular-campaigns',o.analytics.campaigns,'campaign','n');renderLines('event-types',o.analytics.kinds,'kind','n');$('last-updated').textContent='Statistiques : 30 derniers jours';for(const input of $('settings-form').elements){if(input.name)input.value=ctx.settings[input.name]||''}await loadServices();}catch(e){msg(e.message,true)}}
async function loadServices(){const data=await api('/api/admin/services');ctx.services=data.services;renderServices()}
function renderServices(){const term=normalize($('admin-search').value);const list=$('services-list');list.replaceChildren();for(const service of ctx.services.filter(s=>normalize(s.fr+' '+s.ar+' '+s.category).includes(term))){const row=el('div','line');const label=el('span','name',service.fr+' — '+service.category+' ');label.append(el('span','muted-badge',service.status+(service.published?'':' · Masqué')));row.append(label);const edit=el('button','','Modifier');edit.type='button';edit.addEventListener('click',()=>openService(service));row.append(edit);list.append(row)}}
function normalize(s){return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()}
function openService(s){$('edit-card').hidden=false;$('edit-title').textContent='Modifier : '+s.fr;$('edit-slug').value=s.slug;for(const [k,id] of Object.entries({fr:'edit-fr',ar:'edit-ar',desc:'edit-desc',desc_ar:'edit-desc-ar',terms:'edit-terms',status:'edit-status'}))$(id).value=s[k];for(const [k,id] of Object.entries({technologies:'edit-technologies',includes:'edit-includes',problems:'edit-problems'}))$(id).value=s[k].join('\n');$('edit-published').checked=s.published;$('edit-card').scrollIntoView({behavior:'smooth',block:'start'})}
$('admin-search').addEventListener('input',renderServices);$('cancel-edit').addEventListener('click',()=>{$('edit-card').hidden=true});
$('edit-service').addEventListener('submit',async e=>{e.preventDefault();const data={published:$('edit-published').checked};for(const [k,id]of Object.entries({fr:'edit-fr',ar:'edit-ar',desc:'edit-desc',desc_ar:'edit-desc-ar',terms:'edit-terms',status:'edit-status'}))data[k]=$(id).value;for(const [k,id] of Object.entries({technologies:'edit-technologies',includes:'edit-includes',problems:'edit-problems'}))data[k]=$(id).value.split('\n').map(x=>x.trim()).filter(Boolean);try{await api('/api/admin/services/'+encodeURIComponent($('edit-slug').value),{method:'PUT',data});msg('Service enregistré.');$('edit-card').hidden=true;await Promise.all([loadServices(),loadCommand()])}catch(err){msg(err.message,true)}});
$('settings-form').addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(e.target),settings=Object.fromEntries(fd.entries());try{await api('/api/admin/settings',{method:'PUT',data:settings});msg('Paramètres enregistrés.');await loadCommand()}catch(err){msg(err.message,true)}});
$('login').addEventListener('submit',async e=>{e.preventDefault();$('login-message').textContent='';const fd=new FormData(e.target);try{const r=await api('/api/admin/login',{method:'POST',data:Object.fromEntries(fd.entries())});ctx.csrf=r.csrf;e.target.reset();await showAdmin()}catch(err){$('login-message').textContent=err.message;$('login-message').className='message error'}});
$('logout').addEventListener('click',async()=>{try{await api('/api/admin/logout',{method:'POST'});}catch{}location.reload()});
document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',async()=>{if(b.dataset.tab==='control'||b.dataset.tab==='intelligence'||b.dataset.tab==='security')await loadCommand();document.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.panel').forEach(x=>x.hidden=x.id!==b.dataset.tab);if(b.dataset.tab==='inquiries'){try{const r=await api('/api/admin/inquiries');const root=$('inquiries-list');root.replaceChildren();if(!r.inquiries.length)root.append(el('p','muted','Aucune demande enregistrée.'));for(const q of r.inquiries){const item=el('article','line');item.append(el('span','name',`${q.at} · ${q.name} · ${q.topic}: ${q.message} · ${q.email} ${q.phone}`));root.append(item)}}catch(e){msg(e.message,true)}}if(b.dataset.tab==='audit'){try{const r=await api('/api/admin/audit');const root=$('audit-list');root.replaceChildren();for(const a of r.audit){const item=el('div','line');item.append(el('span','',`${a.at} · ${a.action} · ${a.resource}`));root.append(item)}}catch(e){msg(e.message,true)}}}));
api('/api/admin/session').then(r=>{if(r.authenticated){ctx.csrf=r.csrf;showAdmin()}else if(!r.configured){$('login-message').textContent='Administration désactivée : configurer ADMIN_EMAIL, ADMIN_PASSWORD_HASH et ADMIN_TOTP_SECRET sur le serveur.'}}).catch(()=>{});
})();

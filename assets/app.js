(function () {
  'use strict';
  const config = window.ALLO_CONFIG || {};
  const search = document.getElementById('service-search');
  const grid = document.getElementById('service-grid');
  const categories = document.querySelectorAll('.filter-chip');
  let searchItems = [...document.querySelectorAll('.service-card')];
  const countEl = document.getElementById('result-count');
  const noResults = document.getElementById('no-results');
  const clear = document.getElementById('clear-search');
  let activeCategory = 'all';
  function normalize(str) {
    return String(str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[\u064b-\u065f\u0670\u0640]/g, '').replace(/[أإآ]/g,'ا')
      .replace(/[ى]/g,'ي').replace(/[ة]/g,'ه').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  }
  let indexed = searchItems.map(el => ({el, query: normalize(el.getAttribute('data-search')), category:el.dataset.category}));
  const texts = {
    fr:{expertises:'Expertises',prestations:'Prestations',method:'Notre approche',contact:'Contact',quote:'Demander un devis',searchPlaceholder:'Ex. Wi-Fi faible, caméra IP, stock, Microsoft 365, طابعة...',noResults:'Votre demande mérite une étude.',count:'prestations'},
    ar:{expertises:'التخصصات',prestations:'الخدمات',method:'طريقة العمل',contact:'الاتصال',quote:'اطلب عرض سعر',searchPlaceholder:'ابحث عن خدمة أو تقنية أو اكتب مشكلتك: واي فاي، كاميرا، المخزون...',noResults:'لم نعثر على خدمة مطابقة، يمكنك شرح طلبك.',count:'خدمة'}
  };
  function runFilter() {
    if (!search) return;
    const query = normalize(search.value);
    const words = query.split(' ').filter(Boolean);
    let visible = 0;
    indexed.forEach(({el,query:hay,category})=>{
      const match = (activeCategory==='all'||category===activeCategory) && words.every(w=>hay.includes(w));
      el.hidden=!match;
      if(match) visible++;
    });
    if(countEl)countEl.textContent=visible+' '+(document.documentElement.lang==='ar'?'خدمة':'prestations');
    if(noResults)noResults.hidden=visible!==0;
    if(clear)clear.hidden=!search.value;
  }
  document.addEventListener('allo-catalog-updated',()=>{searchItems=[...document.querySelectorAll('.service-card')];indexed=searchItems.map(el=>({el,query:normalize(el.getAttribute('data-search')),category:el.dataset.category}));runFilter()});
  search?.addEventListener('input',runFilter);
  clear?.addEventListener('click',()=>{search.value='';runFilter();search.focus();});
  categories.forEach(button=>button.addEventListener('click',()=>{
    activeCategory=button.dataset.category;
    categories.forEach(b=>b.classList.toggle('active',b===button));
    runFilter();
  }));
  document.querySelectorAll('[data-search-example]').forEach(button=>button.addEventListener('click',()=>{
    if(search){search.value=button.dataset.searchExample;runFilter();search.focus();}
  }));
  document.querySelectorAll('[data-go-category]').forEach(a=>a.addEventListener('click',()=>{
    activeCategory=a.dataset.goCategory;
    categories.forEach(b=>b.classList.toggle('active',b.dataset.category===activeCategory));
    if(search){search.value='';runFilter();}
  }));
  const langToggle=document.getElementById('lang-toggle');
  langToggle?.addEventListener('click',()=>{
    const ar=document.documentElement.lang!=='ar';
    document.documentElement.lang=ar?'ar':'fr';
    document.body.setAttribute('dir',ar?'rtl':'ltr');
    langToggle.textContent=ar?'Français':'العربية';
    if(search)search.placeholder=ar?texts.ar.searchPlaceholder:texts.fr.searchPlaceholder;
    const navKeys=['expertises','prestations','method','contact'];
    const navEls=[...document.querySelectorAll('.nav-links a')];
    navKeys.forEach((key,i)=>{if(navEls[i])navEls[i].textContent=ar?texts.ar[key]:texts.fr[key];});
    runFilter();
  });
  const form=document.getElementById('request-form');
  const help=document.getElementById('form-help');
  const sendButton=document.getElementById('send-request');
  if(config.contactReady){
    const warn=document.getElementById('contact-warning');if(warn)warn.hidden=true;
    if(help)help.textContent='Votre demande sera préparée dans votre application de messagerie. Aucun envoi automatique.';
    if(sendButton)sendButton.textContent='Continuer vers le contact ↗';
  }
  form?.addEventListener('submit',async event=>{
    event.preventDefault();
    const fd=new FormData(form);
    const msg='Bonjour ALLOSERVIX,\nNom / société : '+fd.get('name')+'\nDomaine : '+(fd.get('category')||'Non précisé')+'\nDemande : '+fd.get('message');
    if(config.contactReady && /^\d{10,15}$/.test(config.whatsappNumber||'')){
      window.location.href='https://wa.me/'+config.whatsappNumber+'?text='+encodeURIComponent(msg);return;
    }
    if(config.contactReady && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(config.businessEmail||'')){
      window.location.href='mailto:'+config.businessEmail+'?subject='+encodeURIComponent('Demande de devis ALLOSERVIX')+'&body='+encodeURIComponent(msg);return;
    }
    try{await navigator.clipboard.writeText(msg);if(help)help.textContent='Message copié. Aucun message n’a été envoyé — les coordonnées officielles ne sont pas encore configurées.';}
    catch{if(help){help.textContent='Copiez manuellement ce message : '+msg;help.style.whiteSpace='pre-line';}}
  });
})();

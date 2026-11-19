'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('Four accurate public privacy notices, never claim the live request flow cannot transmit data',()=>{
 const html=read('mentions.html');
 for(const [id,lang] of [['fr','fr'],['ar','ar'],['ary','ary'],['en','en']])assert.match(html,new RegExp('<section id="'+id+'" lang="'+lang+'">'));
 assert.doesNotMatch(html,/le formulaire ne transmet aucune donnée à un serveur/i);
 assert.match(html,/transmises au serveur/);
 assert.match(html,/عبره/);
 assert.match(html,/legal entity information/);
 assert.match(html,/noindex,nofollow/);
});
test('Public and admin share one real brand icon and a visible privacy link',()=>{
 const files=['constellation-v9/index.html','request-v10/index.html','admin/index.html'];
 for(const p of files){const html=read(p);assert.match(html,/\/assets\/favicon\.svg/);assert.match(html,/\/assets\/site\.webmanifest/)}
 assert.match(read('constellation-v9/index.html'),/\/assets\/logo-mark\.svg/);
 assert.match(read('request-v10/index.html'),/\/assets\/logo-mark\.svg/);
 assert.match(read('admin/index.html'),/\/assets\/logo-mark\.svg/);
 assert.match(read('constellation-v9/index.html'),/href="\/mentions\.html"/);
 for(const p of ['assets/favicon.svg','assets/logo-mark.svg','assets/logo-wordmark.svg']){const s=read(p);assert.match(s,/<svg[^>]*xmlns=/);assert.match(s,/<\/svg>/)}
 const manifest=JSON.parse(read('assets/site.webmanifest'));
 assert.equal(manifest.name,'ALLOSERVIX');
 assert.equal(manifest.icons[0].src,'/assets/favicon.svg');
});
test('Darija catalogue uses available Arabic service descriptions rather than a silent French fallback',()=>{
 const js=read('constellation-v9/app.js');
 assert.match(js,/title\.textContent=isArabic\(\)&&s\.ar\?s\.ar:s\.fr/);
 assert.match(js,/isArabic\(\)\?\(s\.desc_ar/);
 assert.match(js,/state\.lang==='en'\?'Technical description available in French/);
 assert.match(js,/privacy\.href='\/mentions\.html#'/);
});
test('Canonical redirects, asset manifest and translated dynamic service details are handled safely',()=>{
 const js=read('server.js');
 assert.match(js,/p==='\/favicon\.ico'/);
 assert.match(js,/application\/manifest\+json/);
 assert.match(js,/p==='\/index\.html'/);
 assert.match(js,/\['ar','darija','en'\]\.includes\(requestedLang\)/);
 assert.match(js,/if\(!svc\|\|!svc\.published/);
 assert.match(js,/escapeHtml\(name\)/);
});
test('Search robots restriction remains until the legal owner and official contact are verified',()=>{
 assert.match(read('robots.txt'),/^Disallow: \/$/m);
 assert.match(read('mentions.html'),/responsable de publication/);
});

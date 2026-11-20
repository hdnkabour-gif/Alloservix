'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const html=read('constellation-v9/index.html');
const js=read('constellation-v9/app.js');
const css=read('constellation-v9/brand-refresh.css');
test('approved identity has one coherent scalable SVG mark, wordmark and favicon',()=>{
 for(const p of ['assets/logo-mark.svg','assets/logo-wordmark.svg','assets/favicon.svg','constellation-v9/assets/favicon.svg']){
  const s=read(p);assert.match(s,/<svg\s+[^>]*viewBox=/);assert.match(s,/<\/svg>/);assert.match(s,/#(?:0B1F44|092148|FF8808|FF8408|FF7700|FF9133|0B315F)/i);
 }
 assert.match(html,/class="brand-wordmark"[^>]+src="\/assets\/logo-wordmark\.svg"/);
 assert.match(html,/brand-refresh\.css/);
});
test('small and large mobile breakpoints, desktop grid, touch targets and reduced motion are defined',()=>{
 for(const pattern of [/@media\(max-width:375px\)/,/@media\(max-width:780px\)/,/@media\(max-width:1100px\)/,/@media\(prefers-reduced-motion:reduce\)/,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/,/grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/,/min-height:42px/])assert.match(css,pattern);
 assert.match(css,/\.lang-switch button/);
 assert.match(css,/\.search-hero \.primary-btn/);
 assert.match(css,/html\[dir="rtl"\]/);
});
test('nine popular service tiles link to real catalogue search, not invented content',()=>{
 const labels=['Wi-Fi','caméra','ordinateur','imprimante','site web','portail','interphone','TV','routeur'];
 for(const label of labels)assert.ok(html.includes('data-service-search="'+label+'"'),label);
 assert.match(js,/closest\('\[data-service-search\]'\)/);
 assert.match(js,/transition\('explore'\)/);
 assert.match(js,/renderCatalog\(\)/);
 for(const locale of ['fr','ar','darija','en'])for(const key of ['popularTitle','serviceWifi','serviceCameras','servicePc','servicePrinters','serviceWeb','serviceGates','serviceIntercom','serviceTv','serviceRouter','mediaConsent','mediaTitle','availabilityNote'])assert.match(js,new RegExp(key+':'));
});
test('users keep guided, quick and full catalogue routes',()=>{
 for(const route of ['quick','guide','explore'])assert.match(html,new RegExp('data-go="'+route+'"'));
 for(const id of ['hero-form','quick-form','catalog-search','allo-media-consent'])assert.match(html,new RegExp('id="'+id+'"'));
 for(const lang of ['fr','ar','darija','en'])assert.match(html,new RegExp('data-lang="'+lang+'"'));
 for(const key of ['mediaVoice','mediaPhoto','mediaCloud','mediaAnalyze','mediaLabel'])assert.match(html,new RegExp('data-i18n="'+key+'"'));
});
test('no new fabricated proof, promises, prices, or data collection activation',()=>{
 assert.doesNotMatch(html,/\d{2,}\s+(?:clients satisfaits|avis vérifiés)|garantie\s+100\s*%/i);
 assert.match(read('robots.txt'),/^Disallow: \/$/m);
 assert.doesNotMatch(js,/ENABLE_REQUESTS\s*=|ADMIN_PASSWORD_HASH/);
 new vm.Script(js);
 new vm.Script(read('constellation-v9/media-ui.js'));
});

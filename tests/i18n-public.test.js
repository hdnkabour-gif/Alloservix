'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'constellation-v9/app.js'),'utf8');
const html=fs.readFileSync(path.join(root,'constellation-v9/index.html'),'utf8');
const media=fs.readFileSync(path.join(root,'constellation-v9/media-ui.js'),'utf8');
const services=JSON.parse(fs.readFileSync(path.join(root,'assets/services.json'),'utf8'));
function dictionaries(){
 const match=app.match(/const TEXT=(\{[\s\S]*?\n\});/);
 assert.ok(match,'Translation dictionary must exist');
 return vm.runInNewContext('('+match[1]+')',{});
}
test('Four separate visible locales and RTL/LTR direction, without ambiguous Arabic/Darija toggle',()=>{
 const txt=dictionaries();
 assert.deepEqual(Object.keys(txt).sort(),['ar','darija','en','fr']);
 for(const lang of ['fr','ar','darija','en'])assert.match(html,new RegExp('data-lang="'+lang+'"'));
 assert.match(app,/lang==='darija'\?'ary':lang/);
 assert.match(app,/document\.documentElement\.dir=isArabic\(\)\?'rtl':'ltr'/);
 assert.match(app,/localStorage\.setItem\('allo-ui-lang',lang\)/);
 assert.doesNotMatch(html,/id="lang-switch"/);
});
test('Translation keys are complete and user-visible interface labels are covered',()=>{
 const txt=dictionaries();
 const keys=Object.keys(txt.fr);
 for(const lang of ['ar','darija','en']){
  assert.deepEqual(Object.keys(txt[lang]).sort(),keys.slice().sort(),'Missing '+lang+' translations');
  for(const key of keys)if(typeof txt.fr[key]==='string')assert.ok(txt[lang][key].trim(),'Empty '+lang+':'+key);
 }
 const attrs=[...html.matchAll(/data-i18n(?:-html)?="([A-Za-z][\w]*)"/g)].map(x=>x[1]);
 for(const key of attrs)assert.ok(key in txt.fr,'Missing UI translation key: '+key);
});
test('Modern Standard Arabic stays separate from Moroccan Darija',()=>{
 const txt=dictionaries();
 assert.equal(txt.ar.navHow,'كيف نعمل');
 assert.equal(txt.darija.navHow,'كيف نخدمو');
 assert.match(txt.ar.heroSubtitle,/احتياجك/);
 assert.match(txt.darija.heroSubtitle,/شرح لينا/);
 for(const key of ['heroSubtitle','quickTitle','quickDesc','navHow','fallback','requestRequired']){
  assert.doesNotMatch(txt.ar[key],/(بغيت|شنو|ديالك|نعاونوك|كتحتاج|ماشي|كنديرو)/,'Colloquial expression in Arabic '+key);
 }
});
test('Service catalogue has comprehensible, separate Arabic and French descriptions',()=>{
 assert.equal(services.services.length,100);
 assert.equal(services.categories.length,13);
 const slugs=new Set();
 for(const s of services.services){
  assert.ok(s.slug&&!slugs.has(s.slug),'Duplicate or missing slug '+s.slug);
  slugs.add(s.slug);
  assert.ok(s.fr?.length>3&&s.ar?.length>3,'Name missing: '+s.slug);
  assert.ok(s.desc?.length>12&&s.desc_ar?.length>12,'Explanation missing: '+s.slug);
 }
 assert.match(app,/service-category-icon/);
});
test('Media language respects Modern Standard Arabic, Moroccan Darija and English independently',()=>{
 assert.match(media,/value==='ary'\?'darija'/);
 assert.match(media,/locale\.value='ar-MA'/);
 assert.match(media,/locale\.value='ar-SA'/);
 assert.match(media,/locale\.value='en-US'/);
 assert.match(html,/option value="ar-SA"/);
 assert.match(html,/option value="ar-MA"/);
});
test('No invented customer ratings, client numbers or guarantees in homepage',()=>{
 assert.doesNotMatch(html,/(?:\+\s?\d{2,}\s+clients|4[,.]9\s*\/\s*5|qualité garantie|100% garanti)/i);
 assert.match(html,/href="\/admin\/"/);
 assert.match(html,/name="robots" content="index,follow"/);
});

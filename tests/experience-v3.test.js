'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'experience/index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'experience/experience.css'),'utf8');
const js=fs.readFileSync(path.join(root,'experience/experience.js'),'utf8');
const catalogue=JSON.parse(fs.readFileSync(path.join(root,'assets/services.json'),'utf8'));
function engine(){
  const code=js.replace(/\binit\(\);\s*\}\)\(\);\s*$/, 'globalThis.__test={state,matchServices,normalize,translations};\n})();');
  const context={};vm.createContext(context);vm.runInContext(code,context,{timeout:1000});
  context.__test.state.loaded=true;context.__test.state.catalog=catalogue.services.map(s=>({...s,published:true}));context.__test.state.categories=catalogue.categories;
  return context.__test;
}
test('V3 is isolated, responsive, and noindexed',()=>{
  assert.match(html,/name="robots" content="noindex,nofollow"/);
  assert.match(html,/href="\/experience\/experience\.css"/);
  assert.match(html,/src="\/experience\/experience\.js"/);
  assert.doesNotMatch(html,/<script[^>]+src="https?:/i);
  assert.match(css,/@media\(max-width:450px\)/);assert.match(css,/prefers-reduced-motion:reduce/);
  assert.match(html,/id="language"/);assert.match(html,/id="need"/);
});
test('Moroccan Arabic/Darija/French matching gives relevant categories',()=>{
  const e=engine();for(const [q,category] of [
    ['الويفي ضعيف فالدار','network'],
    ['بغيت برنامج للمبيعات والمخزون','software'],
    ['كاميرات مراقبة للمحل','physical'],
    ['Microsoft 365 pour notre équipe','cloud'],
    ['بغيت باب الكراج أوتوماتيكي','automation'],
    ['الطابعة ما بقاتش كتسكانيني','it']
  ])assert.ok(e.matchServices(q).some(s=>s.category===category),q);
  assert.ok(e.translations.fr.heroLineOne && e.translations.ar.heroLineOne);
});
test('Contact and analytics are not silently activated',()=>{
  assert.match(js,/state\.settings\.contact_whatsapp/);
  assert.match(js,/NO tracking sent or stored/);
  assert.doesNotMatch(html,/create-account|inscription|s'inscrire/i);
  assert.ok(catalogue.services.every(s=>s.status==='Sur étude'));
});

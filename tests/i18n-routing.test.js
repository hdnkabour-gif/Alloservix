'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const main=read('constellation-v9/app.js'),media=read('constellation-v9/media-ui.js'),request=read('request-v10/app.js'),server=read('server.js'),form=read('request-v10/index.html');
test('All affected JavaScript files parse without syntax errors',()=>{
 for(const [p,s] of [['homepage',main],['media',media],['request',request],['server',server]])assert.doesNotThrow(()=>new vm.Script(s,{filename:p+'.js'}));
});
test('Request form uses same four named locales and remembers the choice',()=>{
 for(const lang of ['fr','ar','darija','en'])assert.match(form,new RegExp('<option value="'+lang+'">'));
 assert.match(request,/localizations=\{/);
 assert.match(request,/setItem\('allo-ui-lang',lang\)/);
 assert.match(request,/getItem\('allo-ui-lang'\)/);
 assert.match(request,/lang==='darija'\?'ary':lang/);
 assert.match(request,/locale|langSelect\(\)/);
});
test('Language is carried into service detail pages but never interpolated without allowlist',()=>{
 assert.match(main,/encodeURIComponent\(state\.lang\)/);
 assert.match(server,/\['fr','ar','darija','en'\]\.includes\(requestedLang\)/);
 assert.match(server,/escapeHtml\(name\)/);
 assert.match(server,/escapeHtml\(description\|\|tx\.subject\)/);
 assert.match(server,/serviceHtml\(svc,new URL\(req\.url/);
});
test('Service details identify unreviewed prices and availability without fabricated claims',()=>{
 assert.match(server,/availability and price not confirmed/);
 assert.match(server,/السعر غير مؤكدين/);
 assert.match(server,/Technical details in French/);
 assert.doesNotMatch(form,/Avis clients|Clients satisfaits|Garantie à vie/);
});

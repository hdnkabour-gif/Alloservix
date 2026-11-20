'use strict';
// Every browser script must at least LOAD: a load-time exception (e.g. using a const before its declaration) silently kills the whole page.
// This boots each script in a sandbox with a universal DOM stub. It is a smoke test, not a behaviour test.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const stub=()=>new Proxy(function(){},{get:(t,k)=>k===Symbol.toPrimitive?()=>'':k==='length'?0:k==='then'?undefined:stub(),apply:()=>stub(),construct:()=>stub(),set:()=>true,has:()=>true});
const DIRS=['assets','admin','atelier-v6','brain-studio','constellation-v9','experience','flow','lab','ops-v10','prisme-v7','request-v10','solution-v8'];
const scripts=[];for(const d of DIRS)(function walk(dir){for(const f of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,f.name);if(f.isDirectory())walk(p);else if(f.name.endsWith('.js')&&!f.name.endsWith('.test.js'))scripts.push(p)}})(path.join(root,d));
const sandbox=()=>{const location={href:'https://www.alloservix.ma/',origin:'https://www.alloservix.ma',protocol:'https:',host:'www.alloservix.ma',hostname:'www.alloservix.ma',pathname:'/',search:'',hash:''};
  const win=new Proxy(function(){},{get:(t,k)=>k==='location'?location:k==='Intl'?Intl:k===Symbol.toPrimitive?()=>'':k==='then'?undefined:stub(),apply:()=>stub(),construct:()=>stub(),set:()=>true,has:()=>true});
  const c={document:stub(),window:win,navigator:stub(),localStorage:stub(),sessionStorage:stub(),location,history:stub(),fetch:()=>Promise.resolve(stub()),setTimeout:()=>0,setInterval:()=>0,clearTimeout(){},requestAnimationFrame:()=>0,console:{log(){},warn(){},error(){}},URL,URLSearchParams,FormData:function(){},AbortController,Intl,JSON,Math,Date,Promise,Array,Object,String,Number,Boolean,RegExp,Map,Set,Error,encodeURIComponent,decodeURIComponent,IntersectionObserver:function(){},MutationObserver:function(){},ResizeObserver:function(){},matchMedia:()=>stub(),speechSynthesis:stub(),crypto:{randomUUID:()=>'x',getRandomValues:a=>a},CSS:stub(),Event:function(){},CustomEvent:function(){}};c.self=c;c.globalThis=c;return c};
test('there are front-end scripts to check',()=>assert.ok(scripts.length>=20,'found '+scripts.length));
for(const file of scripts)test('boots without a load-time exception: '+path.relative(root,file),()=>{
  assert.doesNotThrow(()=>vm.runInNewContext(fs.readFileSync(file,'utf8'),sandbox(),{timeout:2000,filename:file}));
});
test('request page: the translator is declared before any use (regression: TDZ crash that disabled the whole form)',()=>{
  const src=fs.readFileSync(path.join(root,'request-v10/app.js'),'utf8'),decl=src.indexOf('const t=');assert.ok(decl>0);
  assert.equal(/\bt\('/.test(src.slice(0,decl)),false,'t() is called before `const t` is initialised');
  for(const k of ['short','copied'])assert.equal(new RegExp(k+":t\\(").test(src),false,k+' must be a literal string in each locale');
});

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const engine=require('../intent-engine'),root=path.resolve(__dirname,'..');
const services=JSON.parse(fs.readFileSync(path.join(root,'assets/services.json'))).services.map(s=>({...s,published:true}));
const expected=[
 ['الويفي ضعيف فالدار','wifi','wifi-maillage'],
 ['بغيت فورمات للحاسوب Windows','pc','reinstallation-windows'],
 ['ثمن كاميرا للمحل','camera','cameras-ip'],
 ['VMware Proxmox virtualisation','servers','vmware-proxmox'],
 ['parabole لا توجد إشارة','satellite','antenne-parabole'],
 ['جهاز كشف الحريق','fire','detection-incendie'],
 ['كيفاش ندير النسخ الاحتياطي','security','backup-restauration'],
 ['بغيت برنامج ديال المخزون','software','logiciel-stock'],
 ['بغيت نركب porte automatique','automation','motorisation-portail'],
 ['شنو هو Microsoft Azure','cloud','azure-migration']
];
for(const [query,topic,slug] of expected){test('Intent V8: '+query,()=>{const x=engine.build(query,services);assert.equal(x.intent.topic,topic);assert.ok(x.matches.some(y=>y.slug===slug),`Missing ${slug}, got ${x.matches.map(y=>y.slug)}`);assert.equal(x.cost.kind,'sur-devis');assert.equal(x.questions.length,2);});}
test('No invented certainty or fabricated prices',()=>{const x=engine.build('ثمن كاميرات للدار',services);assert.doesNotMatch(x.answer,/\b\d{2,}\s?(?:dh|mad|درهم)/i);assert.match(x.disclaimer,/étude/);});
test('Missing service: a helpful non-committal fallback',()=>{const x=engine.build('cette demande sans mot technique inconnu',services);assert.ok(x.answer);assert.ok(x.matches.every(s=>s.category==='consulting'), 'Vague requests should remain in advisory services');});
test('Service catalogue exactly 100, no repeats, sensitive services require study',()=>{assert.equal(services.length,100);assert.equal(new Set(services.map(s=>s.slug)).size,100);for(const s of services)assert.equal(s.status,'Sur étude');});
test('Two-question ceiling even after previous answers',()=>{const x=engine.build('wifi ضعيف',services,{context:'home'});assert.ok(x.questions.length<=1);});
test('Marketing team claim is scoped to the professional experience of members',()=>{const content=fs.readFileSync(path.join(root,'solution-v8/index.html'),'utf8');assert.match(content,/12 ans d’expérience professionnelle chacun/);assert.match(content,/3 spécialistes IT/);assert.doesNotMatch(content,/partenaire officiel Microsoft|certifié Microsoft/);});

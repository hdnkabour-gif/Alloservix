'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const intent=require('../intent-engine'),lang=require('../language-understanding');
const catalog=JSON.parse(fs.readFileSync(path.join(__dirname,'../assets/services.json'))).services;
const corpus=[
 ['3ndi mochkil f lwifi ma kaywselch lfo9','wifi'],
 ['l wifi dyal dar kayt9ta3','wifi'],
 ['wifi ضعيف f bureau','wifi'],
 ['laptop ma kaykhdemch','pc'],
 ['7assoub ma khdamch windows','pc'],
 ['camra ma katssjlech l video','camera'],
 ['n9ad camera surveillance','camera'],
 ['skaner makaykhdemch','printer'],
 ['scan vers dossier ما خدامش','printer'],
 ['kablaj RJ45 dyal bureau','network'],
 ['switsh VLAN configuration','network'],
 ['NAS partage dossiers','servers'],
 ['ms365 teams email company','cloud'],
 ['bghit nssayb app dyal stock','software'],
 ['je veux un logiciel de facturation','software'],
 ['paraboll ma kaykhdemch','satellite'],
 ['bab lgarage motor','automation'],
 ['Détecteur incendie مطلع انذار','fire'],
 ['how to install CCTV cameras','camera'],
 ['imprimante ne scanne pas en SMB','printer'],
 ['محتاج serveur Linux للمكتب','servers'],
 ['كيطيح ليا الويفي كل نهار','wifi'],
 ['je veux protéger mon entreprise contre ransomware','security'],
 ['ربط جوج bureaux site to site VPN','security']
];
for(const [phrase,topic] of corpus)test('Multilingual intent: '+phrase,()=>{
 const r=intent.build(phrase,catalog);
 assert.equal(r.intent.topic,topic,JSON.stringify({got:r.intent.topic,matches:r.matches.map(x=>x.slug)}));
 assert.ok(r.matches.length>0,'No catalogue match for '+phrase);
 assert.ok(r.matches.every(s=>catalog.some(x=>x.slug===s.slug)));
 assert.ok(r.questions.length<=3);
});
test('Language fingerprint handles Darija Latin, Arabic, English and mixed text',()=>{
 assert.equal(lang.language('3ndi mochkil f lwifi'),'darija-latin');
 assert.equal(lang.language('الويفي ضعيف f bureau'),'mixed');
 assert.equal(lang.language('Je veux installer des caméras'),'fr');
 assert.equal(lang.language('My laptop is broken'),'en');
});
test('Unknown requests do not fabricate a product or price',()=>{
 const r=intent.build('xxxxx nonsensical not-a-device',catalog);
 assert.ok(r.questions.length>0);assert.doesNotMatch(r.answer,/\d{3,}\s*(?:MAD|DH)/i);
});

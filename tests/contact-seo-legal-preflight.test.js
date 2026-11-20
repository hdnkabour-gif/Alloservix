'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('public email and phone come from supplied project contact, private email is absent',()=>{
 const homepage=read('constellation-v9/index.html'),legal=read('mentions.html');
 for(const html of [homepage,legal]){assert.match(html,/mailto:alloservix@gmail\.com/);assert.match(html,/tel:\+212649200188/);assert.doesNotMatch(html,/abdellatif\.hadana@gmail\.com/)}
 assert.doesNotMatch(homepage,/contact@alloservix\.ma/);
 assert.match(legal,/projet collectif en préparation/i);
 assert.match(legal,/adresse postale complète à préciser/i);
});
test('legal presentation respects CSP: styles are external, no inline style tag',()=>{
 const legal=read('mentions.html'),css=read('assets/legal.css');
 assert.match(legal,/href="\/assets\/legal\.css"/);
 assert.doesNotMatch(legal,/<style\b/i);
 assert.match(css,/section\[lang\]\{display:none\}/);
 for(const lang of ['fr','ar','ary','en'])assert.match(legal,new RegExp('<section id="'+lang+'" lang="'+lang+'">'));
});
test('staged SEO respects indexability gate and canonical host',()=>{
 const home=read('constellation-v9/index.html'),legal=read('mentions.html'),robots=read('robots.txt'),sitemap=read('sitemap.xml'),server=read('server.js');
 assert.match(home,/rel="canonical" href="https:\/\/www\.alloservix\.ma\/"/);
 assert.match(home,/property="og:title"/);
 assert.match(home,/property="og:url"/);
 assert.match(legal,/noindex,nofollow/);
 assert.match(robots,/^Disallow: \/$/m);
 assert.match(sitemap,/<loc>https:\/\/www\.alloservix\.ma\/<\/loc>/);
 assert.doesNotMatch(sitemap,/\/admin|\/request-v10|\/mentions/);
 assert.match(server,/application\/xml; charset=utf-8/);
});

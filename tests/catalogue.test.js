const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');const data=JSON.parse(fs.readFileSync(path.join(root,'assets/services.json'),'utf8'));
test('Unique slugs and static details for every service',()=>{
 const ids=data.services.map(s=>s.slug);assert.equal(new Set(ids).size,ids.length);
 for(const s of data.services){assert.ok(fs.existsSync(path.join(root,'services',s.slug+'.html')));assert.ok(s.fr&&s.ar&&s.terms);}
});
test('Every service has a category and explicit study status',()=>{
 const cats=new Set(data.categories.map(c=>c.id));for(const s of data.services){assert.ok(cats.has(s.category));assert.equal(s.status,'Sur étude');}
});
test('No unverified contact published',()=>{
 const config=fs.readFileSync(path.join(root,'assets/config.js'),'utf8');assert.match(config,/contactReady: false/);
 assert.doesNotMatch(fs.readFileSync(path.join(root,'index.html'),'utf8'),/\+212\s*6\d{8}/);
});
test('Staging pages are set noindex',()=>{
 assert.match(fs.readFileSync(path.join(root,'index.html'),'utf8'),/noindex,nofollow/);
 assert.match(fs.readFileSync(path.join(root,'robots.txt'),'utf8'),/Disallow: \/$/m);
});
test('All service links in the index exist',()=>{
 const content=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const paths=[...content.matchAll(/href="(services\/[\w-]+\.html)"/g)].map(m=>m[1]);
 assert.equal(paths.length,data.services.length);
 for(const p of paths)assert.ok(fs.existsSync(path.join(root,p)));
});

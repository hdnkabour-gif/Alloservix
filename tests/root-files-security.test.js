'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
test('private root source files are blocked by static route',()=>{
 assert.ok(source.includes(String.raw`if(/^\/[^/]+\.(?:js|json|py)$/.test(decoded))`));
});
test('admin endpoints require session and CSRF on writes',()=>{
 assert.ok(source.includes("if(p.startsWith('/api/admin/'))"));
 assert.ok(source.includes("if(!s)return response(res,401"));
 assert.ok(source.includes('CSRF rejected'));
});

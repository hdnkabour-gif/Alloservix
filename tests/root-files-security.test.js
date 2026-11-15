'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
test('private root source files are not web assets',()=>{
 assert.match(source,/\^\\\/\[\^\/\]\+\\\.\(\?:js\|json\|py\)/);
 assert.match(source,/return text\(res,404,'Not found'\)/);
});
test('admin endpoints require a validated session and CSRF for writes',()=>{
 assert.match(source,/if\(p\.startsWith\('\/api\/admin\/'\)\)/);
 assert.match(source,/if\(!s\)return response\(res,401/);
 assert.match(source,/CSRF rejected/);
});

import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import fs from 'node:fs';
const base='http://127.0.0.1:8099';
const browser=await chromium.launch({headless:true});
const sizes=[320,375,430,768,1440];
fs.mkdirSync('qa-screenshots',{recursive:true});
try{
 for(const width of sizes){
   const page=await browser.newPage({viewport:{width,height:900},deviceScaleFactor:1});
   const pageErrors=[];
   page.on('pageerror',e=>pageErrors.push(e.message));
   const response=await page.goto(base+'/constellation-v9/index.html',{waitUntil:'networkidle'});
   assert.equal(response.status(),200,'HTML must respond 200 at '+width);
   await page.locator('.brand-wordmark').waitFor();
   assert.equal(await page.locator('.popular-grid button').count(),9,'nine useful service cards at '+width);
   const metrics=await page.evaluate(()=>({width:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth,brand:document.querySelector('.brand-wordmark').getBoundingClientRect().width,cta:document.querySelector('.search-hero .primary-btn').getBoundingClientRect().height}));
   assert.ok(metrics.document<=width+2,JSON.stringify({width,metrics})+' horizontal page overflow');
   assert.ok(metrics.body<=width+2,JSON.stringify({width,metrics})+' horizontal body overflow');
   assert.ok(metrics.brand>=140,'brand must remain readable at '+width);
   assert.ok(metrics.cta>=42,'primary action must remain touchable at '+width);
   const visual=await page.evaluate(()=>{
     const cards=['home','shop','company'].map(sector=>{const el=document.querySelector('.sector-card[data-sector="'+sector+'"]');return {sector,background:getComputedStyle(el).getPropertyValue('--sector-image').trim(),box:el.getBoundingClientRect().width}});
     const icons=[...document.querySelectorAll('.popular-grid svg use')].map(x=>x.getAttribute('href'));
     return {cards,icons,logoImage:document.querySelector('.brand-wordmark')?.complete};
   });
   for(const card of visual.cards)assert.match(card.background,/assets\/(home|shop|company)\.svg/, 'sector image missing: '+card.sector);
   assert.equal(visual.logoImage,true,'logo failed to load');
   assert.notEqual(visual.icons[0],visual.icons[8],'Wi-Fi and router icons must differ');
   assert.ok(visual.icons.includes('#i-intercom')&&visual.icons.includes('#i-tv'),'intercom and TV icons should differ');

   const btn=page.locator('[data-lang="ar"]');
   await btn.click();
   assert.equal(await page.locator('html').getAttribute('dir'),'rtl','Arabic must be RTL');
   assert.match(await page.locator('#main-title').innerText(),/احتياجك/);
   await page.locator('[data-lang="fr"]').click();
   assert.equal(await page.locator('html').getAttribute('dir'),'ltr');
   await page.locator('[data-service-search="Wi-Fi"]').click();
   await page.locator('[data-screen="explore"].is-visible').waitFor();
   assert.equal(await page.locator('#catalog-search').inputValue(),'Wi-Fi');
   await page.screenshot({path:'qa-screenshots/home-'+width+'.png',fullPage:true});
   assert.deepEqual(pageErrors,[],'browser errors at '+width);
   console.log('PASS '+width+'px',metrics);
   await page.close();
 }
}catch(e){console.error(e);process.exitCode=1}finally{await browser.close()}

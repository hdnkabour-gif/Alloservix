// #31 review: lost response + page reload must not create a second request (Playwright + Chromium, phone).
//   usage: node scripts/e2e-request-retry.mjs
// Isolated server, synthetic data. The first POST reaches the server but its response is dropped
// before the page sees it; the visitor reloads the tab, fills the same form and sends again.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const { startServer, Client } = require('../tests/helpers/server-harness.js');
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok: Boolean(ok) }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  — ' + extra : '')); };
const srv = await startServer();
const browser = await chromium.launch();
async function fill(p) {
  await p.waitForFunction(() => !document.getElementById('submit-request').disabled);
  await p.fill('#description', 'TEST synthétique : réponse perdue puis rechargement');
  await p.click('#next-1'); await p.fill('#city', 'Casablanca'); await p.click('#next-2');
  await p.fill('#customer_name', 'TEST Client Reprise'); await p.fill('#phone', '+212600000055'); await p.check('#consent');
}
try {
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  const p = await ctx.newPage();
  let dropped = 0;
  await p.route('**/api/public/requests', async route => {
    if (route.request().method() === 'POST' && dropped === 0) { dropped++; await route.fetch(); return route.abort('connectionreset'); }   // written server-side, response lost
    return route.continue();
  });
  await p.goto(srv.url + '/request-v10/index.html');
  await fill(p);
  await p.click('#submit-request');
  await p.waitForFunction(() => document.getElementById('notice').textContent.length > 0);
  check('first attempt: the visitor sees an error, no confirmation', await p.isHidden('#success'));
  const keptBefore = await p.evaluate(() => sessionStorage.getItem('allo_pending_submission'));
  await p.reload();
  await fill(p);
  const keptAfter = await p.evaluate(() => sessionStorage.getItem('allo_pending_submission'));
  check('the pending submission id survives the reload in this tab', keptBefore && keptBefore === keptAfter);
  await p.click('#submit-request');
  await p.waitForSelector('#success:not([hidden])');
  const reference = (await p.textContent('#reference')).trim();
  const owner = new Client(srv.url); await owner.login(srv.owner.email, srv.owner.password, srv.owner.secret);
  const rows = (await owner.get('/api/admin/ops/requests')).body.requests;
  check('one request only, and the confirmation shows ITS reference', rows.length === 1 && rows[0].tracking_code === reference, `rows=${rows.length}`);
  check('the pending id is cleared after the acknowledgement', (await p.evaluate(() => sessionStorage.getItem('allo_pending_submission'))) === null);
  const track = await new Client(srv.url).call('GET', '/api/public/requests/' + reference, undefined, { 'X-Request-Token': (await p.textContent('#access-code')).trim() });
  check('the tracking code returned by the retry works', track.status === 200);
} finally { await browser.close(); srv.stop(); }
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);

// #31 isolated real-browser acceptance of the request journey (Playwright + Chromium, phone emulation).
//   usage: node scripts/e2e-request-mobile.mjs [screenshot-dir]
// Isolated server (temp data dir, provider keys blanked, mock notification transport), synthetic data
// only. Nothing is sent to the real site, no e-mail/WhatsApp. Not part of `npm test` (needs a browser).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const { startServer } = require('../tests/helpers/server-harness.js');
const shots = path.resolve(process.argv[2] || 'e2e-request-shots');
fs.mkdirSync(shots, { recursive: true });
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok: Boolean(ok), extra }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  — ' + extra : '')); };
const srv = await startServer({ NOTIFY_TRANSPORT: 'mock' });
const outbox = () => { const f = path.join(srv.dir, 'mock-outbox.jsonl'); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : []; };
const browser = await chromium.launch();
const problems = [];
const watch = (page, label) => { page.on('pageerror', e => problems.push(`${label} pageerror: ${e.message}`)); page.on('requestfailed', r => problems.push(`${label} requestfailed: ${r.url()}`)); };
try {
  const phone = await browser.newContext({ ...devices['Pixel 7'] });
  const p = await phone.newPage(); watch(p, 'phone');
  await p.goto(srv.url + '/request-v10/index.html?src=flyer');
  await p.waitForFunction(() => !document.getElementById('submit-request').disabled || document.getElementById('notice').textContent.length > 0);
  check('phone: request form enabled when intake is on', !(await p.isDisabled('#submit-request')));
  const scroll = await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  check('phone: no horizontal scroll', scroll);
  await p.fill('#description', 'TEST synthétique : deux caméras IP pour le bureau');
  await p.click('#next-1');
  await p.fill('#city', 'Casablanca');
  await p.selectOption('#service_slug', 'cameras-ip').catch(() => {});
  await p.click('#next-2');
  await p.fill('#customer_name', 'TEST Client Mobile'); await p.fill('#phone', '+212600000099');
  await p.screenshot({ path: path.join(shots, '01-phone-step3.png') });
  // Without consent: nothing is sent.
  await p.click('#submit-request');
  await p.waitForTimeout(300);
  check('phone: no submission without consent', outbox().length === 0 && (await p.isHidden('#success')));
  await p.check('#consent');
  // Double tap: two quick taps on the submit button.
  await Promise.all([p.click('#submit-request'), p.click('#submit-request').catch(() => {})]);
  await p.waitForSelector('#success:not([hidden])');
  const reference = (await p.textContent('#reference')).trim();
  check('phone: confirmation shows a reference', /^AS-\d{8}-[0-9A-F]{8}$/.test(reference), reference);
  const confirmation = await p.textContent('#success');
  check('phone: confirmation shows no contact data', !confirmation.includes('+212600000099'));
  await p.screenshot({ path: path.join(shots, '02-phone-confirmation.png') });
  await p.click('#tracking-form button');
  await p.waitForFunction(() => /AS-/.test(document.getElementById('tracking-result').textContent));
  check('phone: tracking with reference + private code works', (await p.textContent('#tracking-result')).includes(reference));

  // Admin (isolated owner account) reads the request in the protected console.
  const desk = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const a = await desk.newPage(); watch(a, 'admin');
  const { code } = require('../tests/helpers/server-harness.js');
  await a.goto(srv.url + '/admin/'); await a.waitForSelector('#login');
  await a.fill('#login [name=email]', srv.owner.email); await a.fill('#login [name=password]', srv.owner.password); await a.fill('#login [name=totp]', code(srv.owner.secret));
  await a.click('#login button[type=submit]'); await a.waitForSelector('#app:not([hidden])');
  const list = await a.evaluate(async () => (await (await fetch('/api/admin/ops/requests')).json()).requests);
  const mine = list.filter(r => r.service_slug === 'cameras-ip' && r.city === 'Casablanca');
  check('admin: exactly one request recorded for the double tap', mine.length === 1, `rows=${mine.length}`);
  const ops = await desk.newPage(); watch(ops, 'ops');
  await ops.goto(srv.url + '/ops-v10/index.html'); await ops.waitForSelector('#request-list .entry');
  await ops.click('#request-list .entry');
  await ops.waitForFunction(ref => document.getElementById('request-details').textContent.includes(ref), reference);
  const details = await ops.textContent('#request-details');
  check('admin: detail shows the exact service and the contact', details.includes('cameras-ip') && details.includes('+212600000099'));
  await ops.screenshot({ path: path.join(shots, '03-admin-detail.png') });
  const log = await a.evaluate(async () => (await (await fetch('/api/admin/ops/notifications')).json()));
  const delivered = log.notifications.filter(n => n.status === 'delivered');
  check('team alert: exactly one mock alert delivered for this request', outbox().length === 1 && delivered.length === 1 && delivered[0].reference === reference,
    `outbox=${outbox().length} delivered=${delivered.length}`);
  check('no page errors or failed requests', problems.length === 0, problems.join(' ; '));
} finally { await browser.close(); srv.stop(); }
const failed = results.filter(r => !r.ok);
fs.writeFileSync(path.join(shots, 'result.json'), JSON.stringify({ ok: failed.length === 0, results }, null, 1));
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);

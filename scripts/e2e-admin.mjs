// Real-browser QA for the admin console (Playwright + Chromium). Not part of `npm test` (needs a browser).
//   usage: node scripts/e2e-admin.mjs [screenshot-dir]
// Starts an isolated server (temp data dir, provider keys blanked) and drives the actual UI.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { startServer, code } = require('../tests/helpers/server-harness.js');
const shots = path.resolve(process.argv[2] || 'e2e-shots');
fs.mkdirSync(shots, { recursive: true });
const STRONG = 'Correct-Horse-Battery-Staple-9!';
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok: Boolean(ok), extra }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  — ' + extra : '')); };

const srv = await startServer();
const browser = await chromium.launch();
const problems = [];
function watch(page, label) {
  page.on('pageerror', e => problems.push(`${label} pageerror: ${e.message}`));
  page.on('console', m => { if (['error', 'warning'].includes(m.type()) && !/favicon/.test(m.text())) problems.push(`${label} console.${m.type()}: ${m.text()}`); });
  page.on('requestfailed', r => problems.push(`${label} requestfailed: ${r.url()}`));
}
async function login(page, email, password, secret) {
  await page.goto(srv.url + '/admin/'); await page.waitForSelector('#login');
  await page.fill('#login [name=email]', email); await page.fill('#login [name=password]', password); await page.fill('#login [name=totp]', code(secret));
  await page.click('#login button[type=submit]'); await page.waitForSelector('#app:not([hidden])');
}
const navLabels = async page => (await page.$$eval('#nav .nav-label', n => n.map(x => x.textContent.trim())));
try {
  // ---------- Owner ----------
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage(); watch(page, 'owner');
  await page.goto(srv.url + '/admin/'); await page.waitForSelector('#login:visible');
  check('login screen visible, app hidden', await page.isHidden('#app'));
  await page.screenshot({ path: path.join(shots, '01-login.png') });
  await page.fill('#login [name=email]', srv.owner.email); await page.fill('#login [name=password]', 'wrong-password-value'); await page.fill('#login [name=totp]', '123456');
  await page.click('#login button[type=submit]'); await page.waitForFunction(() => document.getElementById('login-message').textContent.length > 0);
  check('bad credentials show a uniform error', /invalides/.test(await page.textContent('#login-message')));
  await page.fill('#login [name=password]', srv.owner.password); await page.fill('#login [name=totp]', code(srv.owner.secret));
  await page.click('#login button[type=submit]'); await page.waitForSelector('#app:not([hidden])');
  const ownerNav = await navLabels(page);
  check('owner sees full navigation', ['Centre de contrôle', 'Équipe & accès', 'Journal d’audit', 'Paramètres du site', 'Mon compte', 'Prestations'].every(l => ownerNav.includes(l)), ownerNav.join(' | '));
  await page.waitForSelector('.control-hero'); await page.screenshot({ path: path.join(shots, '02-control-center.png'), fullPage: true });
  check('control center shows real KPI values', (await page.textContent('.kpis')).includes('100'));
  for (const label of ['Statistiques', 'Sécurité & lancement', 'Prestations', 'Intelligence IA', 'Demandes', 'Contacts reçus', 'Paramètres du site', 'Journal d’audit', 'Équipe & accès', 'État du système', 'Mon compte']) {
    await page.click(`#nav .nav-item:has(.nav-label:text-is("${label}"))`); await page.waitForTimeout(350);
    const err = await page.$('.error-box'); check(`view renders: ${label}`, !err, err ? await err.textContent() : '');
    await page.screenshot({ path: path.join(shots, `03-${label.replace(/[^a-z]/gi, '').toLowerCase()}.png`), fullPage: true });
  }
  check('account page offers Railway→in-app migration for the initial owner', (await page.textContent('#view')).includes('Passer à des identifiants'));

  // system status: checklist, domain check, snapshot
  await page.click('#nav .nav-item:has(.nav-label:text-is("État du système"))'); await page.waitForSelector('.kpis');
  check('system page shows an honest checklist', (await page.textContent('#view')).includes('Points à traiter') && (await page.textContent('#view')).includes('Aucun instantané vérifié'));
  await page.click('button:has-text("Lancer le contrôle")'); await page.waitForSelector('.invite-box', { timeout: 30000 });
  check('domain check renders a verdict per configured domain', (await page.$$('.invite-box')).length >= 1 && /Certificat valide/.test(await page.textContent('#view')));
  await page.screenshot({ path: path.join(shots, '03b-system-domain.png'), fullPage: true });
  await page.click('button:has-text("Créer un instantané")'); await page.waitForSelector('#toast.show'); await page.waitForTimeout(600);
  check('verified snapshot created from the UI', /Instantané créé et vérifié/.test(await page.textContent('#toast')) || (await page.textContent('#view')).includes('Vérifié'));

  // service edit through the UI (owner can publish)
  await page.click('#nav .nav-item:has(.nav-label:text-is("Prestations"))'); await page.waitForSelector('.service-list .line');
  await page.fill('input[type=search]', 'cameras'); await page.click('.service-list .line button:has-text("Modifier")'); await page.waitForSelector('form.form-grid textarea');
  await page.waitForSelector('#toast:not(.show)', { state: 'attached', timeout: 15000 });
  await page.click('form.form-grid button[type=submit]'); await page.waitForSelector('#toast.show'); check('service saved from the UI', /enregistr/i.test(await page.textContent('#toast')));

  // create a manager through the UI
  await page.click('#nav .nav-item:has(.nav-label:text-is("Équipe & accès"))'); await page.waitForSelector('form.form-grid');
  const form = page.locator('section.card:has(h2:text-is("Inviter un membre")) form');
  await form.locator('input[type=email]').fill('ui-manager@example.org'); await form.locator('input[maxlength="100"]').fill('Salma Gestion'); await form.locator('select').selectOption('manager');
  await form.locator('button[type=submit]').click(); await page.waitForSelector('.invite-box code');
  const inviteUrl = (await page.textContent('.invite-box code')).trim();
  check('invitation link shown once with a 64-hex fragment token', /\/admin\/#invite=[0-9a-f]{64}$/.test(inviteUrl));
  await page.screenshot({ path: path.join(shots, '04-staff-invite.png'), fullPage: true });
  const staffText = await page.textContent('#view'); check('team table lists the new invited account', staffText.includes('ui-manager@example.org'));

  // ---------- Invitee flow in a clean browser context ----------
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 860 } }); const p2 = await ctx2.newPage(); watch(p2, 'invitee');
  await p2.goto(inviteUrl); await p2.waitForSelector('#invite-wrap:visible');
  check('invite token removed from the address bar immediately', !p2.url().includes('invite='), p2.url());
  await p2.fill('#invite-password [name=password]', STRONG); await p2.fill('#invite-password [name=confirm]', 'different-password-xyz'); await p2.click('#invite-password button');
  check('mismatched passwords rejected client-side', /correspondent pas/.test(await p2.textContent('#invite-message')));
  await p2.fill('#invite-password [name=password]', 'short'); await p2.fill('#invite-password [name=confirm]', 'short'); await p2.click('#invite-password button');
  await p2.screenshot({ path: path.join(shots, '05-invite-step1.png') });
  await p2.fill('#invite-password [name=password]', STRONG); await p2.fill('#invite-password [name=confirm]', STRONG); await p2.click('#invite-password button');
  await p2.waitForSelector('#invite-mfa:visible'); const secret = (await p2.textContent('#invite-secret')).trim();
  check('TOTP secret displayed for enrollment', /^[A-Z2-7]{32}$/.test(secret));
  await p2.screenshot({ path: path.join(shots, '06-invite-step2.png') });
  await p2.fill('#invite-mfa [name=totp]', '000000'); await p2.click('#invite-mfa button[type=submit]'); await p2.waitForFunction(() => /invalide/.test(document.getElementById('invite-message').textContent));
  await p2.fill('#invite-mfa [name=totp]', code(secret, { peek: true })); await p2.click('#invite-mfa button[type=submit]'); await p2.waitForSelector('#login-wrap:visible');
  check('activation succeeds and returns to login', /Compte activé/.test(await p2.textContent('#login-message')));
  await p2.fill('#login [name=email]', 'ui-manager@example.org'); await p2.fill('#login [name=password]', STRONG); await p2.fill('#login [name=totp]', code(secret)); await p2.click('#login button[type=submit]'); await p2.waitForSelector('#app:not([hidden])');
  const mgrNav = await navLabels(p2);
  check('manager sees operational views', ['Centre de contrôle', 'Prestations', 'Demandes'].every(l => mgrNav.includes(l)), mgrNav.join(' | '));
  check('manager does NOT see settings, audit', !mgrNav.includes('Paramètres du site') && !mgrNav.includes('Journal d’audit'));
  check('manager sees team list but no invite form', mgrNav.includes('Équipe & accès'));
  await p2.click('#nav .nav-item:has(.nav-label:text-is("Équipe & accès"))'); await p2.waitForSelector('.kpis');
  check('manager has no invitation form / actions', !(await p2.textContent('#view')).includes('Inviter un membre') && (await p2.$$('button:has-text("Réinitialiser")')).length === 0);
  await p2.click('#nav .nav-item:has(.nav-label:text-is("Prestations"))'); await p2.waitForSelector('.service-list .line'); await p2.fill('input[type=search]', 'cameras'); await p2.click('.service-list .line button:has-text("Modifier")'); await p2.waitForSelector('form.form-grid');
  check('manager: availability/publish controls disabled', await p2.isDisabled('form.form-grid select') && await p2.isDisabled('form.form-grid input[type=checkbox]'));
  await p2.screenshot({ path: path.join(shots, '07-manager-services.png'), fullPage: true });
  const direct = await p2.evaluate(async () => (await fetch('/api/admin/audit', { credentials: 'same-origin' })).status);
  check('manager API call to audit is refused (403) even from the page', direct === 403);

  // ---------- Dark mode + mobile ----------
  const dark = await browser.newContext({ viewport: { width: 1360, height: 900 }, colorScheme: 'dark' }); const pd = await dark.newPage(); watch(pd, 'dark');
  await pd.goto(srv.url + '/admin/'); await pd.waitForSelector('#login:visible'); await pd.screenshot({ path: path.join(shots, '08-dark-login.png') });
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); const pm = await mobile.newPage(); watch(pm, 'mobile');
  await pm.goto(srv.url + '/admin/'); await pm.waitForSelector('#login:visible'); await pm.screenshot({ path: path.join(shots, '09-mobile-login.png') });
  await pm.fill('#login [name=email]', 'ui-manager@example.org'); await pm.fill('#login [name=password]', STRONG); await pm.fill('#login [name=totp]', code(secret));
  await pm.click('#login button[type=submit]'); await pm.waitForSelector('#app:not([hidden])');
  const overflow = await pm.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check('mobile: no horizontal page scroll', !overflow);
  await pm.click('#menu-toggle'); await pm.waitForTimeout(300); await pm.screenshot({ path: path.join(shots, '10-mobile-nav.png') });
  check('mobile: navigation drawer opens', await pm.evaluate(() => document.body.classList.contains('nav-open')));

  // ---------- Re-authentication dialog (short window) ----------
  const short = await startServer({ ADMIN_REAUTH_SECONDS: '1' });
  const rc = await browser.newContext({ viewport: { width: 1280, height: 860 } }); const pr = await rc.newPage(); watch(pr, 'reauth');
  await pr.goto(short.url + '/admin/'); await pr.fill('#login [name=email]', short.owner.email); await pr.fill('#login [name=password]', short.owner.password); await pr.fill('#login [name=totp]', code(short.owner.secret));
  await pr.click('#login button[type=submit]'); await pr.waitForSelector('#app:not([hidden])'); await pr.waitForTimeout(1400);
  await pr.click('#nav .nav-item:has(.nav-label:text-is("Paramètres du site"))'); await pr.waitForSelector('form.form-grid');
  await pr.click('form.form-grid button[type=submit]'); await pr.waitForSelector('#reauth[open]');
  await pr.screenshot({ path: path.join(shots, '11-reauth-dialog.png') });
  await pr.fill('#reauth-form [name=password]', 'wrong-password-value'); await pr.fill('#reauth-form [name=totp]', '000000'); await pr.click('#reauth-form button[type=submit]');
  await pr.waitForFunction(() => document.getElementById('reauth-message').textContent.length > 0); check('wrong re-auth keeps the dialog open with an error', await pr.isVisible('#reauth[open]'));
  await pr.fill('#reauth-form [name=password]', short.owner.password); await pr.fill('#reauth-form [name=totp]', code(short.owner.secret)); await pr.click('#reauth-form button[type=submit]');
  await pr.waitForSelector('#toast.show'); check('after re-auth the pending action completes automatically', /enregistr/i.test(await pr.textContent('#toast')));
  short.stop();

  // ---------- Hygiene ----------
  const csp = problems.filter(p => /Content Security Policy|Refused to/i.test(p));
  check('no CSP violations in any page', csp.length === 0, csp.join(' ; '));
  const bad = problems.filter(p => !/401|403|Failed to load resource/.test(p));
  check('no uncaught page errors or failed requests', bad.length === 0, bad.join(' ; '));
} catch (e) {
  check('script completed without exception', false, e.stack || e.message);
} finally {
  await browser.close(); srv.stop();
  const failed = results.filter(r => !r.ok).length;
  fs.writeFileSync(path.join(shots, 'results.json'), JSON.stringify({ total: results.length, failed, results }, null, 2));
  console.log(`\n${results.length - failed}/${results.length} checks passed; screenshots in ${shots}`);
  process.exit(failed ? 1 : 0);
}

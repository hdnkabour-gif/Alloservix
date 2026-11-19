// Real-browser QA for the admin console (Playwright + Chromium). Not part of `npm test` (needs a browser).
//   usage: node scripts/e2e-admin.mjs [screenshot-dir]
// Starts an isolated server (temp data dir, provider keys blanked) and drives the actual UI.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { startServer, code, Client } = require('../tests/helpers/server-harness.js');
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
  check('owner sees full navigation', ['Centre de contrôle', 'Équipe & accès', 'Journal d’audit', 'Paramètres du site', 'Mon compte', 'Catalogue'].every(l => ownerNav.includes(l)), ownerNav.join(' | '));
  await page.waitForSelector('.control-hero'); await page.screenshot({ path: path.join(shots, '02-control-center.png'), fullPage: true });
  check('control center shows real KPI values', (await page.textContent('.kpis')).includes('100'));
  for (const label of ['Statistiques', 'Sécurité & lancement', 'Catalogue', 'Cerveau & IA', 'Demandes', 'Contacts reçus', 'Paramètres du site', 'Journal d’audit', 'Équipe & accès', 'État du système', 'Mon compte']) {
    await page.click(`#nav .nav-item:has(.nav-label:text-is("${label}"))`); await page.waitForTimeout(350);
    const err = await page.$('.error-box'); check(`view renders: ${label}`, !err, err ? await err.textContent() : '');
    await page.screenshot({ path: path.join(shots, `03-${label.replace(/[^a-z]/gi, '').toLowerCase()}.png`), fullPage: true });
  }
  check('account page offers Railway→in-app migration for the initial owner', (await page.textContent('#view')).includes('Passer à des identifiants'));

  // brain monitoring: real assistant traffic -> metrics; evaluation run from the UI
  for (const q of ['الويفي ضعيف فالدار', 'mon wifi ne marche pas', 'xxxxx nonsensical not-a-device']) await fetch(srv.url + '/api/public/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: q }) });
  await page.click('#nav .nav-item:has(.nav-label:text-is("Cerveau & IA"))'); await page.waitForSelector('.tabbar'); await page.waitForSelector('.kpis');
  check('brain overview counts the live assistant calls and states the privacy rule', /Demandes analysées/.test(await page.textContent('#view')) && /texte des visiteurs n’est jamais conservé/.test(await page.textContent('#view')));
  await page.screenshot({ path: path.join(shots, '03c-brain-overview.png'), fullPage: true });
  await page.click('.tabbar button[data-t=eval]'); await page.waitForSelector('button:has-text("Lancer l’évaluation maintenant")');
  await page.click('button:has-text("Lancer l’évaluation maintenant")'); await page.waitForSelector('text=Cas en échec', { timeout: 15000 });
  check('evaluation run shows accuracy and the weak spots', /Bonne prestation en 1er/.test(await page.textContent('#view')) && /my printer is broken/.test(await page.textContent('#view')));
  await page.screenshot({ path: path.join(shots, '03d-brain-eval.png'), fullPage: true });
  await page.click('.tabbar button[data-t=providers]'); await page.waitForSelector('text=Disjoncteurs'); check('providers tab explains cost is not invented', /Aucun tarif n’est codé/.test(await page.textContent('#view')));
  await page.click('.tabbar button[data-t=unmatched]'); await page.waitForSelector('text=capture volontaire'); check('unmatched capture shows as disabled', /Désactivée/.test(await page.textContent('#view')));

  // system status: checklist, domain check, snapshot
  await page.click('#nav .nav-item:has(.nav-label:text-is("État du système"))'); await page.waitForSelector('.kpis');
  check('system page shows an honest checklist', (await page.textContent('#view')).includes('Points à traiter') && (await page.textContent('#view')).includes('Aucun instantané vérifié'));
  await page.click('button:has-text("Lancer le contrôle")'); await page.waitForSelector('.invite-box', { timeout: 30000 });
  check('domain check renders a verdict per configured domain', (await page.$$('.invite-box')).length >= 1 && /Certificat valide/.test(await page.textContent('#view')));
  await page.screenshot({ path: path.join(shots, '03b-system-domain.png'), fullPage: true });
  await page.click('button:has-text("Créer un instantané")'); await page.waitForSelector('#toast.show'); await page.waitForTimeout(600);
  await page.waitForSelector('button:has-text("Tester la restauration")'); await page.click('button:has-text("Tester la restauration")'); await page.waitForSelector('text=Test de restauration —', { timeout: 40000 });
  check('restore drill from the UI boots the app on the copy and reports success', /L’application démarre sur la copie restaurée/.test(await page.textContent('#view')) && /Réussi/.test(await page.textContent('#view')));
  await page.screenshot({ path: path.join(shots, '03e-restore-drill.png'), fullPage: true });
  check('verified snapshot created from the UI', /Instantané créé et vérifié/.test(await page.textContent('#toast')) || (await page.textContent('#view')).includes('Vérifié'));

  // service edit through the UI (owner can publish)
  await page.click('#nav .nav-item:has(.nav-label:text-is("Catalogue"))'); await page.waitForSelector('.tabbar'); await page.click('.tabbar button[data-t=services]'); await page.waitForSelector('.service-list .line');
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
  await p2.fill('#invite-mfa [name=totp]', code(secret)); await p2.click('#invite-mfa button[type=submit]'); await p2.waitForSelector('#login-wrap:visible');
  check('activation succeeds and returns to login', /Compte activé/.test(await p2.textContent('#login-message')));
  await p2.fill('#login [name=email]', 'ui-manager@example.org'); await p2.fill('#login [name=password]', STRONG); await p2.fill('#login [name=totp]', code(secret)); await p2.click('#login button[type=submit]'); await p2.waitForSelector('#app:not([hidden])');
  const mgrNav = await navLabels(p2);
  check('manager sees operational views', ['Centre de contrôle', 'Catalogue', 'Demandes'].every(l => mgrNav.includes(l)), mgrNav.join(' | '));
  check('manager does NOT see settings, audit', !mgrNav.includes('Paramètres du site') && !mgrNav.includes('Journal d’audit'));
  check('manager sees team list but no invite form', mgrNav.includes('Équipe & accès'));
  await p2.click('#nav .nav-item:has(.nav-label:text-is("Équipe & accès"))'); await p2.waitForSelector('.kpis');
  check('manager has no invitation form / actions', !(await p2.textContent('#view')).includes('Inviter un membre') && (await p2.$$('button:has-text("Réinitialiser")')).length === 0);
  await p2.click('#nav .nav-item:has(.nav-label:text-is("Catalogue"))'); await p2.waitForSelector('.tabbar'); await p2.click('.tabbar button[data-t=services]'); await p2.waitForSelector('.service-list .line'); await p2.fill('input[type=search]', 'cameras');
  check('manager sees Proposer, not direct edit', (await p2.$$('.service-list .line button:has-text("Proposer")')).length >= 1 && (await p2.$$('.service-list .line button:has-text("Modifier")')).length === 0);
  await p2.click('.service-list .line button:has-text("Proposer")'); await p2.waitForSelector('form.form-grid');
  check('manager: availability/publish controls disabled', await p2.isDisabled('form.form-grid select:has(option[value="Indisponible"])') && await p2.isDisabled('form.form-grid input[type=checkbox]'));
  await p2.fill('form.form-grid input[maxlength="200"] >> nth=0', 'Caméras IP — proposition UI'); await p2.fill('form.form-grid input[placeholder^="Pourquoi"]', 'test navigateur');
  await p2.click('form.form-grid button[type=submit]'); await p2.waitForSelector('.card:has-text("Caméras IP — proposition UI")', { timeout: 10000 });
  const liveText = await (await fetch(srv.url + '/api/public/catalog')).text();
  check('manager proposal lands in Brouillons and is not live', (await p2.textContent('#view')).includes('Brouillon') && !liveText.includes('proposition UI'));
  await p2.click('button:has-text("Soumettre pour validation")'); await p2.waitForSelector('#toast.show');
  check('manager cannot approve (no approve button)', (await p2.$$('button:has-text("Approuver")')).length === 0);
  await page.click('#nav .nav-item:has(.nav-label:text-is("Catalogue"))'); await page.waitForSelector('.tabbar'); await page.click('.tabbar button[data-t=drafts]');
  await page.waitForSelector('.card:has-text("proposition UI")'); await page.screenshot({ path: path.join(shots, '07b-owner-drafts.png'), fullPage: true });
  page.once('dialog', d => d.accept('validé en test'));
  await page.click('.card:has-text("proposition UI") button:has-text("Approuver et publier")'); await page.waitForSelector('#toast.show:has-text("approuvé")', { timeout: 10000 });
  const liveAfter = await (await fetch(srv.url + '/api/public/catalog')).text();
  check('owner approval publishes the proposal to the live site', liveAfter.includes('proposition UI'));
  await page.click('.tabbar button[data-t=services]'); await page.waitForSelector('.service-list .line'); await page.fill('input[type=search]', 'cameras'); await page.click('.service-list .line:has-text("proposition UI") button:has-text("Historique")');
  await page.waitForSelector('table:has-text("draft#")'); check('revision history shows the approved draft with its author', (await page.textContent('#view')).includes('draft#'));
  await page.screenshot({ path: path.join(shots, '07c-history.png'), fullPage: true });
  await page.click('.tabbar button[data-t=overview]'); await page.waitForSelector('.kpis'); await page.screenshot({ path: path.join(shots, '07d-catalogue-overview.png'), fullPage: true });
  check('catalogue overview reports the generic Arabic descriptions', /générique/.test(await page.textContent('#view')));
  await page.click('.tabbar button[data-t=taxo]'); await page.waitForSelector('table'); check('taxonomy tab lists inconsistent spellings', /plusieurs graphies/.test(await page.textContent('#view')));
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

  // ---------- Linked pages (owner session): dispatch, Knowledge Studio, customer portal ----------
  const ops = await ctx.newPage(); watch(ops, 'ops'); await ops.goto(srv.url + '/ops-v10/index.html'); await ops.waitForSelector('#app:not([hidden])');
  check('dispatch page opens for the owner with technician tabs', await ops.isVisible('#show-techs') && await ops.isVisible('#show-new-tech'));
  await ops.screenshot({ path: path.join(shots, '12-ops-owner.png'), fullPage: true });
  const bs = await ctx.newPage(); watch(bs, 'brain-studio'); await bs.goto(srv.url + '/brain-studio/index.html'); await bs.waitForSelector('#studio:not([hidden])');
  check('Knowledge Studio opens and shows catalogue counts', /services/.test(await bs.textContent('#stats')));
  await bs.screenshot({ path: path.join(shots, '13-brain-studio.png'), fullPage: true });
  const portal = await ctx.newPage(); watch(portal, 'portal'); await portal.goto(srv.url + '/request-v10/index.html'); await portal.waitForSelector('#request-form');
  check('customer request portal renders (public page)', (await portal.textContent('#heading')).length > 3);
  await portal.screenshot({ path: path.join(shots, '14-request-portal.png'), fullPage: true });

  // ---------- Technician role in the real UI ----------
  const api = new Client(srv.url); await api.login(srv.owner.email, srv.owner.password, srv.owner.secret);
  const tech = await api.post('/api/admin/ops/technicians', { privacy_consent: true, name: 'Youssef Tech', city: 'Casablanca', phone: '+212600000042', email: 'youssef@example.org', years_experience: 6, capacity: 3, level: 'expert', verification_status: 'approved', contract_status: 'signed', availability_status: 'available', active: true, onsite_available: true, remote_available: true, skills: [{ service_slug: 'cameras-ip', level: 'expert', verified: true }] });
  const mkReq = async title => (await new Client(srv.url).post('/api/public/requests', { consent: true, type: 'diagnostic', sector: 'company', name: 'Client ' + title, phone: '+212600000009', city: 'Casablanca', title, description: 'Description suffisamment longue pour valider', service_slug: 'cameras-ip', preferred_channel: 'phone' })).body.tracking_code;
  const mine = await mkReq('Mission du technicien'), other = await mkReq('Mission des autres');
  const det = (await api.get('/api/admin/ops/requests/' + mine)).body.request, rev = await api.put(`/api/admin/ops/requests/${mine}/status`, { status: 'review', version: det.version, note: 'triage' });
  await api.put(`/api/admin/ops/requests/${mine}/assignment`, { technician_id: tech.body.technician.id, version: rev.body.request.version });
  const inv = await api.post('/api/admin/staff', { email: 'ui-tech@example.org', display_name: 'Youssef Technicien', role: 'technician', technician_id: tech.body.technician.id });
  const anon = new Client(srv.url), acc = await anon.post('/api/admin/invite/accept', { token: inv.body.invite.token, password: STRONG });
  await anon.post('/api/admin/invite/activate', { token: inv.body.invite.token, totp: code(acc.body.secret) });
  const tctx = await browser.newContext({ viewport: { width: 1280, height: 860 } }), tp = await tctx.newPage(); watch(tp, 'technician');
  await login(tp, 'ui-tech@example.org', STRONG, acc.body.secret);
  const techNav = await navLabels(tp);
  check('technician navigation is minimal', techNav.every(l => ['Catalogue', 'Demandes', 'Demandes & techniciens', 'Mon compte'].includes(l)) && techNav.includes('Demandes'), techNav.join(' | '));
  await tp.waitForSelector('.card:has-text("Mes interventions")'); const jobs = await tp.textContent('#view');
  check('technician sees only the request assigned to them', jobs.includes(mine) && !jobs.includes(other));
  await tp.screenshot({ path: path.join(shots, '15-technician-home.png'), fullPage: true });
  await tp.goto(srv.url + '/admin/#staff'); await tp.waitForSelector('#app:not([hidden])'); await tp.waitForTimeout(500);
  check('technician cannot reach the team page by URL', !(await tp.textContent('#view')).includes('Matrice des rôles'));
  await tp.click('#nav .nav-item:has(.nav-label:text-is("Catalogue"))'); await tp.waitForSelector('.service-list .line');
  check('technician catalogue is read-only (no edit/propose buttons, no governance tabs)', (await tp.$$('.service-list .line button')).length === 0 && (await tp.$$('.tabbar button')).length <= 1);
  const top = await tctx.newPage(); watch(top, 'tech-ops'); await top.goto(srv.url + '/ops-v10/index.html'); await top.waitForSelector('#app:not([hidden])'); await top.waitForSelector('#request-list .entry');
  check('dispatch page for a technician hides the technician directory and lists only own job', !(await top.isVisible('#show-techs')) && (await top.$$('#request-list .entry')).length === 1);
  await top.screenshot({ path: path.join(shots, '16-ops-technician.png'), fullPage: true });
  const forbidden = await tp.evaluate(async () => { const r = []; for (const p of ['/api/admin/staff', '/api/admin/audit', '/api/admin/control-center', '/api/admin/ops/technicians']) r.push((await fetch(p, { credentials: 'same-origin' })).status); return r; });
  check('technician API calls to admin areas are all refused (403)', forbidden.every(s => s === 403), forbidden.join(','));

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

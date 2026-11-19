'use strict';
// Operational monitoring for the admin console. Aggregate, secret-free, no customer data.
// - request metrics (in memory, last 24 h) and a persisted, redacted error log
// - environment *presence* flags only (never values)
// - honest checklist of unfinished / unverified items
// - domain check: what the outside world sees (DNS, TLS certificate, Railway routing)
// - owner-triggered, verified SQLite snapshots (same volume, no download endpoint)
const fs = require('node:fs'), path = require('node:path'), tls = require('node:tls'), https = require('node:https'), dns = require('node:dns').promises;

const HOUR = 3600000;
const ENV_PRESENCE = ['NODE_ENV', 'DATA_DIR', 'ALLO_DATA_KEY', 'ADMIN_EMAIL', 'ADMIN_PASSWORD_HASH', 'ADMIN_TOTP_SECRET', 'ENABLE_ANALYTICS', 'ENABLE_INQUIRIES', 'ENABLE_REQUESTS', 'ENABLE_AI',
  'ENABLE_IMAGE_INTENT', 'ENABLE_AUDIO_INTENT', 'AI_PROVIDER_ORDER', 'AI_DAILY_LIMIT', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'DEEPSEEK_API_KEY', 'PUBLIC_DOMAINS', 'RAILWAY_PUBLIC_DOMAIN'];
const BOOLEAN_FLAGS = ['ENABLE_ANALYTICS', 'ENABLE_INQUIRIES', 'ENABLE_REQUESTS', 'ENABLE_AI', 'ENABLE_IMAGE_INTENT', 'ENABLE_AUDIO_INTENT'];

function redact(text) {
  return String(text || '')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[email]').replace(/\+?\d[\d ()\-.]{7,}\d/g, '[tel]')
    .replace(/\b[0-9a-f]{24,}\b/gi, '[hex]').replace(/(password|token|secret|key)\s*[:=]\s*\S+/gi, '$1=[redacted]').slice(0, 240);
}
function normalizeRoute(p) {
  return String(p || '/').split('?')[0].split('/').map(seg => (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(seg) || /^\d{3,}$/.test(seg) || /^[0-9a-f]{24,}$/i.test(seg) || /^AS-\d{8}-[0-9A-F]{8}$/.test(seg) ? ':id' : seg)).join('/').slice(0, 140);
}
function classify(p) {
  if (p === '/health') return 'health';
  if (p.startsWith('/api/admin/')) return 'admin-api';
  if (p.startsWith('/api/public/')) return 'public-api';
  if (p.startsWith('/api/')) return 'other-api';
  return 'static';
}
const hourKey = t => new Date(t).toISOString().slice(0, 13);
const percentile = (arr, q) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

function createMonitor({ db, dbFile, auth, env = process.env, now = Date.now, startedAt = now(), tlsOptions = {} }) {
  db.exec(`CREATE TABLE IF NOT EXISTS error_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, method TEXT NOT NULL, route TEXT NOT NULL, status INTEGER NOT NULL, message TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_error_log_at ON error_log(at);
    CREATE TABLE IF NOT EXISTS backup_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, file TEXT NOT NULL, bytes INTEGER NOT NULL, integrity TEXT NOT NULL, rows_json TEXT NOT NULL, actor TEXT NOT NULL);`);
  const buckets = new Map(), latencies = [];
  const dataDir = path.dirname(dbFile), backupDir = path.join(dataDir, 'backups');

  // ---- metrics --------------------------------------------------------------------------------
  function recordRequest(method, pathname, status, ms) {
    const k = hourKey(now()), cls = classify(pathname);
    let b = buckets.get(k); if (!b) { b = { total: 0, s2: 0, s3: 0, s4: 0, s5: 0, classes: {} }; buckets.set(k, b); }
    b.total++; b[`s${Math.floor(status / 100)}`] = (b[`s${Math.floor(status / 100)}`] || 0) + 1; b.classes[cls] = (b.classes[cls] || 0) + 1;
    if (buckets.size > 30) for (const key of [...buckets.keys()].sort().slice(0, buckets.size - 30)) buckets.delete(key);
    if (cls !== 'static' && cls !== 'health') { latencies.push(ms); if (latencies.length > 1000) latencies.shift(); }
  }
  function recordError(method, pathname, status, err) {
    try {
      db.prepare('INSERT INTO error_log(at,method,route,status,message) VALUES(?,?,?,?,?)').run(new Date(now()).toISOString(), String(method).slice(0, 8), normalizeRoute(pathname), status, redact(err && err.message ? err.message : err));
      db.prepare("DELETE FROM error_log WHERE id NOT IN (SELECT id FROM error_log ORDER BY id DESC LIMIT 500)").run();
    } catch { /* monitoring must never break a request */ }
  }
  function metrics() {
    const keys = [...buckets.keys()].sort().slice(-24), hours = keys.map(k => ({ hour: k + ':00Z', ...buckets.get(k) }));
    const sum = f => hours.reduce((a, h) => a + (h[f] || 0), 0);
    return { window_hours: 24, hours, totals: { requests: sum('total'), s2xx: sum('s2'), s3xx: sum('s3'), s4xx: sum('s4'), s5xx: sum('s5') },
      latency_ms: { samples: latencies.length, p50: percentile(latencies, .5), p95: percentile(latencies, .95), max: latencies.length ? Math.max(...latencies) : 0 },
      note: 'Compteurs en mémoire : remis à zéro à chaque redémarrage du serveur.' };
  }
  const recentErrors = (limit = 50) => db.prepare('SELECT id,at,method,route,status,message FROM error_log ORDER BY id DESC LIMIT ?').all(Math.max(1, Math.min(200, limit)));
  const errorsSince = ms => db.prepare('SELECT count(*) n FROM error_log WHERE at>=?').get(new Date(now() - ms).toISOString()).n;

  // ---- runtime / storage -----------------------------------------------------------------------
  let integrityCache = { at: 0, value: null };
  function integrity() {
    if (now() - integrityCache.at < 60000 && integrityCache.value) return integrityCache.value;
    let value; try { value = db.prepare('PRAGMA quick_check').get().quick_check; } catch (e) { value = 'error: ' + redact(e.message); }
    integrityCache = { at: now(), value }; return value;
  }
  const size = f => { try { return fs.statSync(f).size; } catch { return 0; } };
  function storage() {
    let free = null, total = null; try { const s = fs.statfsSync(dataDir); free = Number(s.bavail) * Number(s.bsize); total = Number(s.blocks) * Number(s.bsize); } catch { /* unsupported */ }
    let writable = false; try { fs.accessSync(dataDir, fs.constants.W_OK); writable = true; } catch { /* read-only */ }
    const count = t => { try { return db.prepare(`SELECT count(*) n FROM ${t}`).get().n; } catch { return null; } };
    return { database_bytes: size(dbFile), wal_bytes: size(dbFile + '-wal'), disk_free_bytes: free, disk_total_bytes: total, writable, data_dir_configured: Boolean(env.DATA_DIR), integrity: integrity(),
      tables: Object.fromEntries(['services', 'service_requests', 'technicians', 'inquiries', 'events', 'audit', 'staff_accounts', 'knowledge_concepts', 'knowledge_links', 'ai_usage', 'error_log'].map(t => [t, count(t)])) };
  }
  function runtime() {
    const m = process.memoryUsage();
    return { uptime_seconds: Math.floor((now() - startedAt) / 1000), node: process.version, environment: env.NODE_ENV || 'development', rss_bytes: m.rss, heap_used_bytes: m.heapUsed,
      started_at: new Date(startedAt).toISOString(), active_sessions: auth.sessionCount(), railway: Boolean(env.RAILWAY_PUBLIC_DOMAIN || env.RAILWAY_ENVIRONMENT_NAME) };
  }
  const environment = () => ({ variables: Object.fromEntries(ENV_PRESENCE.map(k => [k, Boolean(env[k])])), flags: Object.fromEntries(BOOLEAN_FLAGS.map(k => [k, env[k] === 'true'])),
    note: 'Seule la présence est indiquée. Aucune valeur n’est jamais renvoyée.' });

  // ---- checklist of unfinished / unverified items ------------------------------------------------
  // item: { id, severity: critical|warning|info, area, title, detail, action, link }
  function checklist(ctx) {
    const items = [], add = (id, severity, area, title, detail, link) => items.push({ id, severity, area, title, detail, link: link || null });
    const st = storage(), c = ctx.counts;
    if (!st.writable) add('data-readonly', 'critical', 'Données', 'Le dossier de données n’est pas inscriptible', 'Aucune modification ne sera conservée.');
    if (st.integrity !== 'ok') add('db-integrity', 'critical', 'Données', 'Contrôle d’intégrité SQLite en échec', String(st.integrity));
    if (!env.DATA_DIR) add('data-dir', 'critical', 'Données', 'DATA_DIR non défini', 'Sans volume monté, les données disparaissent à chaque déploiement.');
    if (st.disk_free_bytes !== null && st.disk_total_bytes && st.disk_free_bytes / st.disk_total_bytes < 0.1) add('disk-low', 'warning', 'Données', 'Moins de 10 % d’espace disque libre', 'Prévoir une extension du volume.');
    if (!ctx.vaultReady) add('vault', 'critical', 'Sécurité', 'ALLO_DATA_KEY absente', 'Comptes équipe, demandes clients et fiches techniciens ne peuvent pas être protégés.');
    if (!ctx.ownerMigrated && ctx.envOwnerActive) add('owner-env', 'warning', 'Sécurité', 'Identifiants initiaux Railway encore actifs', 'Passez à des identifiants gérés dans « Mon compte ».', 'account');
    if (ctx.activeOwners < 2) add('single-owner', 'warning', 'Sécurité', 'Un seul propriétaire actif', 'Sans second propriétaire, la perte de l’authentificateur bloque l’administration (récupération via Railway uniquement).', 'staff');
    if (ctx.activeStaff < 2) add('single-account', 'info', 'Sécurité', 'Aucun gestionnaire ni technicien invité', 'Invitez les membres de l’équipe avec le rôle adapté.', 'staff');
    if (!ctx.contactEmail || !ctx.contactWhatsapp) add('contact', 'warning', 'Site', 'Coordonnées publiques non confirmées', 'Email / WhatsApp absents : les actions de contact restent limitées.', 'settings');
    if (c.available === 0) add('no-available', 'warning', 'Catalogue', 'Aucune prestation confirmée « Disponible »', 'Les 100 fiches restent « Sur étude » tant qu’elles ne sont pas validées.', 'services');
    if (c.hidden > 0) add('hidden-services', 'info', 'Catalogue', `${c.hidden} fiche(s) masquée(s)`, 'Brouillons ou fiches retirées.', 'services');
    if (c.concept_approved === 0) add('knowledge-empty', 'info', 'Intelligence', 'Aucun concept approuvé', 'Le moteur reste 100 % déterministe ; enrichir via Knowledge Studio.', 'brain');
    if (c.technicians === 0) add('no-tech', 'info', 'Opérations', 'Aucun technicien enregistré', 'Aucune affectation possible tant qu’un technicien vérifié et sous contrat n’existe pas.');
    if (!ctx.flags.requests) add('requests-off', 'info', 'Opérations', 'Demandes clients désactivées', 'ENABLE_REQUESTS non activé ou clé de chiffrement absente.');
    if (!ctx.flags.inquiries) add('inquiries-off', 'info', 'Conformité', 'Collecte de contacts désactivée', 'Normal tant que la politique de confidentialité n’est pas validée (CNDP).');
    if (!ctx.flags.analytics) add('analytics-off', 'info', 'Conformité', 'Statistiques visiteurs désactivées', 'Aucune donnée de fréquentation n’est collectée.');
    if (!ctx.flags.ai) add('ai-off', 'info', 'Intelligence', 'IA externe désactivée', 'Le site fonctionne avec le moteur local uniquement.');
    if (ctx.flags.ai && ctx.providersConfigured === 0) add('ai-no-key', 'warning', 'Intelligence', 'IA activée sans clé de fournisseur', 'ENABLE_AI=true mais aucune clé n’est configurée.');
    if (errorsSince(HOUR) >= 5) add('errors-hour', 'critical', 'Fiabilité', `${errorsSince(HOUR)} erreurs serveur sur la dernière heure`, 'Consulter la liste des erreurs récentes.');
    else if (errorsSince(24 * HOUR) > 0) add('errors-day', 'warning', 'Fiabilité', `${errorsSince(24 * HOUR)} erreur(s) serveur sur 24 h`, 'Consulter la liste des erreurs récentes.');
    const lastBackup = db.prepare('SELECT at,integrity FROM backup_log ORDER BY id DESC LIMIT 1').get();
    if (!lastBackup) add('no-backup', 'warning', 'Données', 'Aucun instantané vérifié de la base', 'Créez un instantané (propriétaire) et configurez aussi les sauvegardes du volume Railway.');
    else if (now() - Date.parse(lastBackup.at) > 7 * 24 * HOUR) add('old-backup', 'warning', 'Données', 'Dernier instantané vérifié de plus de 7 jours', lastBackup.at);
    add('offsite-backup', 'info', 'Données', 'Sauvegarde hors volume non vérifiable depuis l’application', 'Les instantanés restent sur le même volume : ils protègent contre une erreur logique, pas contre la perte du volume.');
    add('domain', 'info', 'Domaine', 'Certificat HTTPS et DNS : lancer le contrôle de domaine', 'Le serveur peut vérifier ce que voit l’extérieur ; aucune certitude sans ce contrôle.', 'system');
    add('sessions', 'info', 'Sécurité', 'Sessions en mémoire', 'Un redémarrage Railway déconnecte tout le monde.');
    return items.sort((a, b) => ({ critical: 0, warning: 1, info: 2 }[a.severity] - { critical: 0, warning: 1, info: 2 }[b.severity]));
  }

  // ---- domain check ------------------------------------------------------------------------------
  const domains = () => String(env.PUBLIC_DOMAINS || 'alloservix.ma,www.alloservix.ma').split(',').map(s => s.trim().toLowerCase()).filter(s => /^[a-z0-9.-]{3,120}(?::\d{2,5})?$/.test(s)).slice(0, 6);
  const certInfo = c => c && c.subject ? { subject: c.subject.CN || '', san: String(c.subjectaltname || '').replace(/DNS:/g, '').split(', ').filter(Boolean).slice(0, 12), issuer: (c.issuer && (c.issuer.O || c.issuer.CN)) || '', valid_to: c.valid_to || '', days_left: c.valid_to ? Math.floor((Date.parse(c.valid_to) - now()) / 86400000) : null } : null;
  const handshake = (host, port, reject) => new Promise(resolve => {
    const s = tls.connect({ host, port, servername: host, rejectUnauthorized: reject, timeout: 6000, ...tlsOptions }, () => { const cert = certInfo(s.getPeerCertificate()), protocol = s.getProtocol(); s.end(); resolve({ ok: true, protocol, cert }); });
    s.on('error', e => resolve({ ok: false, code: e.code || 'ERR', message: redact(e.message) })); s.on('timeout', () => { s.destroy(); resolve({ ok: false, code: 'ETIMEDOUT', message: 'timeout' }); });
  });
  const httpsHealth = (host, port) => new Promise(resolve => {
    const t0 = now(), req = https.request({ host, port, servername: host, path: '/health', method: 'GET', timeout: 6000, ...tlsOptions, headers: { Host: port === 443 ? host : `${host}:${port}`, 'User-Agent': 'alloservix-domain-check' } }, res => {
      let body = ''; res.on('data', d => { if (body.length < 400) body += d; }); res.on('end', () => resolve({ status: res.statusCode, ms: now() - t0, railway_fallback: res.headers['x-railway-fallback'] === 'true', via_cloudflare: Boolean(res.headers['cf-ray']), server: String(res.headers.server || '').slice(0, 40), health_ok: /"ok"\s*:\s*true/.test(body) }));
    });
    req.on('error', e => resolve({ error: e.code || 'ERR', message: redact(e.message) })); req.on('timeout', () => { req.destroy(); resolve({ error: 'ETIMEDOUT' }); }); req.end();
  });
  async function dnsView(host) {
    const out = {}; for (const [k, fn] of [['a', () => dns.resolve4(host)], ['cname', () => dns.resolveCname(host)], ['caa', () => dns.resolveCaa(host).then(r => r.map(x => `${x.critical ? '!' : ''}${x.issue || x.iodef || x.issuewild || ''}`))]]) { try { out[k] = await fn(); } catch { out[k] = []; } }
    return out;
  }
  async function checkDomain(entry) {
    const [host, p] = entry.split(':'), port = Number(p) || 443, r = { host, port, dns: await dnsView(host) };
    const strict = await handshake(host, port, true);
    r.tls = strict.ok ? { valid: true, protocol: strict.protocol, ...strict.cert } : { valid: false, error: strict.code, message: strict.message };
    if (!strict.ok) { // diagnostic only: complete a handshake WITHOUT sending any HTTP request, to read which certificate is presented
      const d = await handshake(host, port, false); if (d.ok) r.tls.presented = d.cert;
    }
    if (strict.ok) r.http = await httpsHealth(host, port);
    const presentedNames = r.tls.presented ? [r.tls.presented.subject, ...r.tls.presented.san] : [];
    let verdict = 'ok', hint = 'Certificat valide et /health répond.';
    if (!strict.ok) {
      if (/ALTNAME|CERT_HAS_EXPIRED|SELF_SIGNED|UNABLE_TO_VERIFY|HOSTNAME/i.test(strict.code || '')) { verdict = 'certificate_invalid'; hint = presentedNames.length ? `Le serveur présente un certificat pour : ${presentedNames.join(', ')} (≠ ${host}). Problème d’émission de certificat / de routage de l’hôte côté Railway ou Cloudflare.` : 'Certificat non valide.'; }
      else if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT/.test(strict.code || '')) { verdict = 'unreachable'; hint = 'Hôte injoignable depuis le serveur (DNS ou réseau).'; }
      else { verdict = 'tls_error'; hint = 'Échec de la négociation TLS.'; }
    } else if (r.http && r.http.railway_fallback) { verdict = 'routing_missing'; hint = 'La requête atteint Railway mais aucun service n’est routé pour ce domaine (réponse « fallback »).'; }
    else if (r.http && r.http.error) { verdict = 'http_error'; hint = 'TLS valide mais /health injoignable.'; }
    else if (r.http && !(r.http.status === 200 && r.http.health_ok)) { verdict = 'unexpected_response'; hint = `/health a répondu ${r.http.status} sans {"ok":true}.`; }
    else if (r.tls.days_left !== null && r.tls.days_left < 14) { verdict = 'expiring'; hint = `Le certificat expire dans ${r.tls.days_left} jours.`; }
    return { ...r, verdict, hint };
  }
  const domainCheck = async () => ({ checked_at: new Date(now()).toISOString(), vantage: 'serveur ALLOSERVIX (réseau Railway) — ce qu’un client externe voit peut différer légèrement', domains: await Promise.all(domains().map(checkDomain)) });

  // ---- verified snapshots ---------------------------------------------------------------------------
  const KEY_TABLES = ['services', 'service_requests', 'technicians', 'inquiries', 'staff_accounts', 'audit', 'knowledge_concepts', 'knowledge_links', 'settings'];
  const rowCounts = conn => Object.fromEntries(KEY_TABLES.map(t => { try { return [t, conn.prepare(`SELECT count(*) n FROM ${t}`).get().n]; } catch { return [t, null]; } }));
  const SNAP_RE = /^alloservix-\d{8}-\d{6}\.sqlite$/;
  function createSnapshot(actor, DatabaseSync) {
    fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    const d = new Date(now()), stamp = d.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-'), name = `alloservix-${stamp}.sqlite`, file = path.join(backupDir, name);
    if (fs.existsSync(file)) throw Object.assign(new Error('Un instantané existe déjà pour cette seconde'), { public: true, status: 409 });
    const before = rowCounts(db);
    db.prepare('VACUUM INTO ?').run(file); fs.chmodSync(file, 0o600);
    const copy = new DatabaseSync(file, { readOnly: true });
    let integrityResult, after; try { integrityResult = copy.prepare('PRAGMA integrity_check').get().integrity_check; after = rowCounts(copy); } finally { copy.close(); }
    const sameRows = KEY_TABLES.every(t => before[t] === after[t] || (before[t] !== null && after[t] !== null && after[t] >= before[t]));
    const verdict = integrityResult === 'ok' && sameRows ? 'ok' : `échec: integrity=${integrityResult} rows=${sameRows ? 'ok' : 'divergent'}`;
    db.prepare('INSERT INTO backup_log(at,file,bytes,integrity,rows_json,actor) VALUES(?,?,?,?,?,?)').run(d.toISOString(), name, size(file), verdict, JSON.stringify(after), String(actor || '').slice(0, 160));
    // keep the 5 newest snapshots created by this feature (exact filename pattern only)
    const mine = fs.readdirSync(backupDir).filter(f => SNAP_RE.test(f)).sort();
    for (const old of mine.slice(0, Math.max(0, mine.length - 5))) { try { fs.unlinkSync(path.join(backupDir, old)); } catch { /* ignore */ } }
    return listSnapshots()[0];
  }
  const listSnapshots = () => db.prepare('SELECT id,at,file,bytes,integrity,rows_json,actor FROM backup_log ORDER BY id DESC LIMIT 20').all().map(r => ({ ...r, rows: JSON.parse(r.rows_json), rows_json: undefined, present: fs.existsSync(path.join(backupDir, r.file)) }));

  return { recordRequest, recordError, metrics, recentErrors, errorsSince, storage, runtime, environment, checklist, domainCheck, createSnapshot, listSnapshots, domains, redact, normalizeRoute, classify };
}

module.exports = { createMonitor, redact, normalizeRoute, classify };

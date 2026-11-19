'use strict';
// Monitoring of the ALLOSERVIX "brain" (deterministic intent engine + optional external intent providers).
// PRIVACY: live traffic is recorded as *metadata only* (language, length bucket, topic, confidence, matched slug, outcome, timing).
// Visitor text is NEVER stored by default. Accuracy is measured on a staff-authored evaluation set, not on customer messages.
// An opt-in capture of unmatched phrasing exists but is inert unless BRAIN_CAPTURE_UNMATCHED=true AND the visitor consented.
const DAY = 86400000;
const CONF = { none: 'none', low: 'low', medium: 'medium', high: 'high' };
const confidenceOf = (matches) => !matches.length ? CONF.none : matches[0].score >= 70 ? CONF.high : matches[0].score >= 45 ? CONF.medium : CONF.low;
const lenBucket = n => n < 20 ? '<20' : n < 60 ? '20-60' : n < 150 ? '60-150' : '150+';

// Staff-authored evaluation cases (derived from the repository's regression tests + known gaps). No customer data.
const SEED_CASES = [
  ['3ndi mochkil f lwifi ma kaywselch lfo9', 'wifi'], ['l wifi dyal dar kayt9ta3', 'wifi'], ['wifi ضعيف f bureau', 'wifi'], ['laptop ma kaykhdemch', 'pc'], ['7assoub ma khdamch windows', 'pc'],
  ['camra ma katssjlech l video', 'camera'], ['n9ad camera surveillance', 'camera'], ['skaner makaykhdemch', 'printer'], ['scan vers dossier ما خدامش', 'printer'], ['kablaj RJ45 dyal bureau', 'network'],
  ['switsh VLAN configuration', 'network'], ['NAS partage dossiers', 'servers'], ['ms365 teams email company', 'cloud'], ['bghit nssayb app dyal stock', 'software'], ['je veux un logiciel de facturation', 'software'],
  ['paraboll ma kaykhdemch', 'satellite'], ['bab lgarage motor', 'automation'], ['Détecteur incendie مطلع انذار', 'fire'], ['how to install CCTV cameras', 'camera'], ['imprimante ne scanne pas en SMB', 'printer'],
  ['محتاج serveur Linux للمكتب', 'servers'], ['كيطيح ليا الويفي كل نهار', 'wifi'], ['je veux protéger mon entreprise contre ransomware', 'security'], ['ربط جوج bureaux site to site VPN', 'security'],
  ['الويفي ضعيف فالدار', 'wifi', ['wifi-maillage']], ['بغيت فورمات للحاسوب Windows', 'pc', ['reinstallation-windows']], ['ثمن كاميرا للمحل', 'camera', ['cameras-ip']], ['VMware Proxmox virtualisation', 'servers', ['vmware-proxmox']],
  ['parabole لا توجد إشارة', 'satellite', ['antenne-parabole']], ['جهاز كشف الحريق', 'fire', ['detection-incendie']], ['كيفاش ندير النسخ الاحتياطي', 'security', ['backup-restauration']], ['بغيت برنامج ديال المخزون', 'software', ['logiciel-stock']],
  ['بغيت نركب porte automatique', 'automation', ['motorisation-portail']], ['شنو هو Microsoft Azure', 'cloud', ['azure-migration']],
  // known-gap probes (kept on purpose: they make weaknesses visible instead of hiding them)
  ['my printer is broken', 'printer', ['imprimantes-scanners']], ['عندي مشكل في الطابعة', 'printer', ['imprimantes-scanners']], ['tbe3a ma kat tba3ch', 'printer', ['imprimantes-scanners']],
  ['I need a website for my shop', 'software', ['sites-web']], ['mon imprimante ne scanne plus', 'printer', ['imprimantes-scanners']], ['wifi keeps disconnecting', 'wifi', ['wifi-maillage']], ['mon ordinateur est très lent', 'pc', ['depannage-pc']]
];

function usageOf(provider, data) {
  try {
    if (provider === 'gemini') return { in: data.usageMetadata?.promptTokenCount ?? null, out: data.usageMetadata?.candidatesTokenCount ?? null };
    if (provider === 'deepseek') return { in: data.usage?.prompt_tokens ?? null, out: data.usage?.completion_tokens ?? null };
    return { in: data.usage?.input_tokens ?? null, out: data.usage?.output_tokens ?? null };
  } catch { return { in: null, out: null }; }
}
function errorCode(e) {
  if (!e) return 'unknown';
  if (e.name === 'AbortError') return 'timeout';
  if (e.code && /^http_\d{3}$/.test(e.code)) return e.code;
  if (e instanceof TypeError) return 'network';
  return 'invalid_output';
}

function createBrainMetrics({ db, intentEngine, languageOf, catalogue, redact, sanitize, aiState, env = process.env, now = Date.now }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS brain_calls (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, lang TEXT NOT NULL, qlen TEXT NOT NULL,
      topic TEXT NOT NULL, action TEXT NOT NULL, n_matches INTEGER NOT NULL, top_slug TEXT NOT NULL DEFAULT '', top_score INTEGER NOT NULL DEFAULT 0, confidence TEXT NOT NULL,
      questions TEXT NOT NULL DEFAULT '[]', answers_given INTEGER NOT NULL DEFAULT 0, ai_outcome TEXT NOT NULL DEFAULT 'not_requested', provider TEXT NOT NULL DEFAULT '', ms INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS idx_brain_calls_day ON brain_calls(day,kind);
    CREATE TABLE IF NOT EXISTS ai_provider_events (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, provider TEXT NOT NULL, ok INTEGER NOT NULL,
      error TEXT NOT NULL DEFAULT '', ms INTEGER NOT NULL DEFAULT 0, tokens_in INTEGER, tokens_out INTEGER);
    CREATE INDEX IF NOT EXISTS idx_ai_events_day ON ai_provider_events(day,provider);
    CREATE TABLE IF NOT EXISTS brain_eval_cases (id INTEGER PRIMARY KEY AUTOINCREMENT, query TEXT NOT NULL UNIQUE, expect_topic TEXT NOT NULL DEFAULT '', expect_slugs TEXT NOT NULL DEFAULT '[]',
      note TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS brain_eval_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT NOT NULL, summary TEXT NOT NULL, results TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS brain_unmatched (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, lang TEXT NOT NULL, text TEXT NOT NULL, topic TEXT NOT NULL);`);
  const iso = () => new Date(now()).toISOString(), today = () => iso().slice(0, 10);
  if (!db.prepare('SELECT 1 x FROM brain_eval_cases LIMIT 1').get()) {
    const ins = db.prepare('INSERT OR IGNORE INTO brain_eval_cases(query,expect_topic,expect_slugs,note,active,created_by,created_at) VALUES(?,?,?,?,1,?,?)');
    for (const [q, topic, slugs] of SEED_CASES) ins.run(q, topic, JSON.stringify(slugs || []), 'jeu initial (tests de non-régression)', 'system', iso());
  }

  // ---- live metadata ----------------------------------------------------------------------------
  function recordCall({ kind = 'text', query = '', analysis, answers = {}, ai = { outcome: 'not_requested', provider: '' }, ms = 0, capture = false }) {
    try {
      const matches = analysis?.matches || [], conf = confidenceOf(matches), lang = analysis?.input_language || languageOf(query);
      db.prepare('INSERT INTO brain_calls(at,day,kind,lang,qlen,topic,action,n_matches,top_slug,top_score,confidence,questions,answers_given,ai_outcome,provider,ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(iso(), today(), kind, String(lang).slice(0, 20), lenBucket(String(query).length), analysis?.intent?.topic || 'advice', analysis?.intent?.action || '', matches.length, matches[0]?.slug || '', matches[0]?.score || 0, conf,
          JSON.stringify((analysis?.questions || []).map(q => q.id)), Object.keys(answers || {}).length, ai.outcome, ai.provider || '', Math.max(0, Math.min(60000, Math.round(ms))));
      if (capture && env.BRAIN_CAPTURE_UNMATCHED === 'true' && (conf === CONF.none || conf === CONF.low)) {
        const text = redact(sanitize(query)).slice(0, 300);
        if (text.trim().length >= 4) db.prepare('INSERT INTO brain_unmatched(at,lang,text,topic) VALUES(?,?,?,?)').run(iso(), String(lang).slice(0, 20), text, analysis?.intent?.topic || 'advice');
      }
    } catch { /* monitoring must never break the assistant */ }
  }
  function recordMedia({ kind, ok, provider = '', ms = 0, confidence = 'none' }) {
    try { db.prepare('INSERT INTO brain_calls(at,day,kind,lang,qlen,topic,action,n_matches,top_slug,top_score,confidence,questions,answers_given,ai_outcome,provider,ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(iso(), today(), kind, '-', '-', 'media', '', 0, '', 0, ['low', 'medium', 'high'].includes(confidence) ? confidence : 'none', '[]', 0, ok ? 'ok' : 'failed', provider, Math.max(0, Math.min(60000, Math.round(ms)))); } catch { /* ignore */ }
  }
  const providerEvent = kind => ev => {
    try { db.prepare('INSERT INTO ai_provider_events(at,day,kind,provider,ok,error,ms,tokens_in,tokens_out) VALUES(?,?,?,?,?,?,?,?,?)').run(iso(), today(), kind, String(ev.provider).slice(0, 20), ev.ok ? 1 : 0, ev.ok ? '' : String(ev.error || 'unknown').slice(0, 30), Math.round(ev.ms || 0), ev.usage?.in ?? null, ev.usage?.out ?? null); } catch { /* ignore */ }
  };
  function cleanup() {
    const cut = new Date(now() - 90 * DAY).toISOString();
    db.prepare('DELETE FROM brain_calls WHERE at<?').run(cut); db.prepare('DELETE FROM ai_provider_events WHERE at<?').run(cut);
    db.prepare('DELETE FROM brain_unmatched WHERE at<?').run(new Date(now() - 30 * DAY).toISOString());
  }
  cleanup();

  // ---- overview -----------------------------------------------------------------------------------
  const since = days => new Date(now() - days * DAY).toISOString();
  function overview(days = 7) {
    days = Math.max(1, Math.min(90, Math.floor(Number(days)) || 7)); const s = since(days), all = (sql, ...a) => db.prepare(sql).all(...a), one = (sql, ...a) => db.prepare(sql).get(...a);
    const total = one('SELECT count(*) n FROM brain_calls WHERE at>=?', s).n;
    const byKind = Object.fromEntries(all('SELECT kind,count(*) n FROM brain_calls WHERE at>=? GROUP BY kind', s).map(r => [r.kind, r.n]));
    const text = one("SELECT count(*) n, sum(CASE WHEN confidence='none' THEN 1 ELSE 0 END) none, sum(CASE WHEN confidence='low' THEN 1 ELSE 0 END) low, avg(ms) ms, avg(n_matches) matches FROM brain_calls WHERE at>=? AND kind='text'", s);
    const confidence = Object.fromEntries(['high', 'medium', 'low', 'none'].map(c => [c, one("SELECT count(*) n FROM brain_calls WHERE at>=? AND kind='text' AND confidence=?", s, c).n]));
    const langs = all("SELECT lang,count(*) n, sum(CASE WHEN confidence='none' THEN 1 ELSE 0 END) none FROM brain_calls WHERE at>=? AND kind='text' GROUP BY lang ORDER BY n DESC", s);
    const topics = all("SELECT topic,count(*) n FROM brain_calls WHERE at>=? AND kind='text' GROUP BY topic ORDER BY n DESC LIMIT 12", s);
    const slugs = all("SELECT top_slug slug,count(*) n, round(avg(top_score)) score FROM brain_calls WHERE at>=? AND kind='text' AND top_slug<>'' GROUP BY top_slug ORDER BY n DESC LIMIT 10", s);
    const trend = all("SELECT day, count(*) n, sum(CASE WHEN confidence='none' THEN 1 ELSE 0 END) none FROM brain_calls WHERE at>=? AND kind='text' GROUP BY day ORDER BY day", s);
    // clarification questions: initial calls that offered questions vs refinement calls that carried answers
    const qRows = all("SELECT questions,answers_given FROM brain_calls WHERE at>=? AND kind='text'", s);
    const qById = {}; let offered = 0, refinements = 0;
    for (const r of qRows) { const ids = JSON.parse(r.questions); if (r.answers_given === 0 && ids.length) { offered++; for (const id of ids) qById[id] = (qById[id] || 0) + 1; } if (r.answers_given > 0) refinements++; }
    const aiOutcomes = Object.fromEntries(all("SELECT ai_outcome o,count(*) n FROM brain_calls WHERE at>=? AND kind='text' GROUP BY ai_outcome", s).map(r => [r.o, r.n]));
    return { days, since: s, total, by_kind: byKind,
      text: { calls: text.n, no_match: text.none || 0, low_confidence: text.low || 0, no_match_rate: text.n ? +((text.none || 0) / text.n).toFixed(3) : null, avg_latency_ms: Math.round(text.ms || 0), avg_matches: +(text.matches || 0).toFixed(2) },
      confidence, languages: langs, topics, top_services: slugs, trend,
      clarification: { calls_with_questions: offered, refinement_calls: refinements, follow_up_rate: offered ? +(refinements / offered).toFixed(3) : null, by_question: qById,
        note: 'Estimation : les appels ne sont pas reliés entre eux (aucun identifiant visiteur). Un taux > 100 % ou très bas est à lire avec prudence.' },
      ai_assistance: aiOutcomes, privacy: { raw_text_stored: false, unmatched_capture_enabled: env.BRAIN_CAPTURE_UNMATCHED === 'true' } };
  }

  // ---- providers and consumption ---------------------------------------------------------------------
  function providers(days = 14) {
    days = Math.max(1, Math.min(90, Math.floor(Number(days)) || 14)); const s = since(days);
    const rows = db.prepare('SELECT provider,kind,count(*) calls,sum(ok) ok,round(avg(ms)) ms,sum(coalesce(tokens_in,0)) tin,sum(coalesce(tokens_out,0)) tout FROM ai_provider_events WHERE at>=? GROUP BY provider,kind ORDER BY provider,kind').all(s);
    const errs = db.prepare("SELECT provider,error,count(*) n FROM ai_provider_events WHERE at>=? AND ok=0 GROUP BY provider,error ORDER BY n DESC").all(s);
    const perDay = db.prepare('SELECT day, count(*) calls FROM ai_usage WHERE day>=? GROUP BY day ORDER BY day').all(since(days).slice(0, 10));
    const daily = db.prepare('SELECT day, provider, count(*) calls, sum(1-ok) failed FROM ai_provider_events WHERE at>=? GROUP BY day,provider ORDER BY day').all(s);
    const limit = Math.max(0, Math.min(500, Number(env.AI_DAILY_LIMIT || 40) || 0)), todayUsed = db.prepare('SELECT count(*) n FROM ai_usage WHERE day=?').get(today()).n;
    return { days, enabled: aiState.enabled(), configured: aiState.configured(), order: aiState.order(), by_provider: rows.map(r => ({ ...r, failed: r.calls - r.ok, success_rate: r.calls ? +(r.ok / r.calls).toFixed(3) : null })), errors: errs, daily, ai_usage_per_day: perDay,
      today: { used: todayUsed, limit, remaining: Math.max(0, limit - todayUsed) }, circuit_breakers: aiState.breakers(),
      cost: { computed: false, note: 'Aucun tarif n’est codé : le coût dépend du contrat de chaque fournisseur. Les jetons ne sont comptés que si le fournisseur les renvoie.' } };
  }

  // ---- evaluation (accuracy on staff-authored cases) --------------------------------------------------
  const parseCase = r => ({ ...r, expect_slugs: JSON.parse(r.expect_slugs), active: Boolean(r.active) });
  const listCases = () => db.prepare('SELECT * FROM brain_eval_cases ORDER BY id').all().map(parseCase);
  function fail(message, status = 400) { const e = new Error(message); e.public = true; e.status = status; return e; }
  function addCase({ query, expect_topic = '', expect_slugs = [], note = '' }, actor, validSlug) {
    query = String(query || '').trim();
    if (query.length < 4 || query.length > 200) throw fail('Phrase de test : 4 à 200 caractères');
    if (/[\w.+-]+@[\w.-]+\.[a-z]{2,}|\+?\d[\d ()\-.]{7,}\d/i.test(query)) throw fail('N’utilisez jamais de données réelles de clients (email/téléphone détecté) : écrivez un exemple fictif');
    if (!expect_topic && !(expect_slugs || []).length) throw fail('Indiquez le sujet attendu et/ou au moins une prestation attendue');
    if (!Array.isArray(expect_slugs) || expect_slugs.length > 5 || expect_slugs.some(s => !validSlug(s))) throw fail('Prestation attendue inconnue');
    try { const r = db.prepare('INSERT INTO brain_eval_cases(query,expect_topic,expect_slugs,note,created_by,created_at) VALUES(?,?,?,?,?,?)').run(query, String(expect_topic).slice(0, 20), JSON.stringify(expect_slugs), String(note).slice(0, 200), actor.email, iso()); return parseCase(db.prepare('SELECT * FROM brain_eval_cases WHERE id=?').get(r.lastInsertRowid)); }
    catch (e) { if (/UNIQUE/.test(e.message)) throw fail('Cette phrase existe déjà', 409); throw e; }
  }
  function setCaseActive(id, active) { const r = db.prepare('UPDATE brain_eval_cases SET active=? WHERE id=?').run(active ? 1 : 0, id); if (!r.changes) throw fail('Cas introuvable', 404); return parseCase(db.prepare('SELECT * FROM brain_eval_cases WHERE id=?').get(id)); }
  function runEval(actor, catalog) {
    const cases = listCases().filter(c => c.active), results = [], t0 = now();
    for (const c of cases) {
      const a = intentEngine.build(c.query, catalog), slugs = a.matches.map(m => m.slug);
      const topicOk = c.expect_topic ? a.intent.topic === c.expect_topic : null;
      const top1 = c.expect_slugs.length ? c.expect_slugs.includes(slugs[0]) : null, top3 = c.expect_slugs.length ? slugs.slice(0, 3).some(s => c.expect_slugs.includes(s)) : null;
      results.push({ id: c.id, query: c.query, lang: a.input_language, expect_topic: c.expect_topic, expect_slugs: c.expect_slugs, got_topic: a.intent.topic, got: slugs.slice(0, 3), score: a.matches[0]?.score || 0, no_match: !slugs.length, topic_ok: topicOk, top1, top3, pass: (topicOk !== false) && (top1 !== false) });
    }
    const rate = (f) => { const rel = results.filter(r => f(r) !== null); return rel.length ? +(rel.filter(r => f(r)).length / rel.length).toFixed(3) : null; };
    const prev = db.prepare('SELECT id,results FROM brain_eval_runs ORDER BY id DESC LIMIT 1').get(), prevMap = prev ? Object.fromEntries(JSON.parse(prev.results).map(r => [r.id, r.pass])) : {};
    const regressions = results.filter(r => prevMap[r.id] === true && !r.pass).map(r => r.id), fixes = results.filter(r => prevMap[r.id] === false && r.pass).map(r => r.id);
    const byLang = {}; for (const r of results) { const l = byLang[r.lang] || (byLang[r.lang] = { total: 0, pass: 0 }); l.total++; if (r.pass) l.pass++; }
    const summary = { total: results.length, pass: results.filter(r => r.pass).length, pass_rate: results.length ? +(results.filter(r => r.pass).length / results.length).toFixed(3) : null, topic_accuracy: rate(r => r.topic_ok), top1_accuracy: rate(r => r.top1), top3_accuracy: rate(r => r.top3),
      no_match: results.filter(r => r.no_match).length, by_language: byLang, regressions, fixes, previous_run: prev?.id || null, duration_ms: now() - t0, engine: 'déterministe local (aucun appel externe)' };
    const r = db.prepare('INSERT INTO brain_eval_runs(at,actor,summary,results) VALUES(?,?,?,?)').run(iso(), actor.email, JSON.stringify(summary), JSON.stringify(results));
    return { id: Number(r.lastInsertRowid), at: iso(), actor: actor.email, summary, results };
  }
  const listRuns = () => db.prepare('SELECT id,at,actor,summary FROM brain_eval_runs ORDER BY id DESC LIMIT 30').all().map(r => ({ ...r, summary: JSON.parse(r.summary) }));
  const getRun = id => { const r = db.prepare('SELECT * FROM brain_eval_runs WHERE id=?').get(id); return r ? { id: r.id, at: r.at, actor: r.actor, summary: JSON.parse(r.summary), results: JSON.parse(r.results) } : null; };
  const unmatched = () => ({ enabled: env.BRAIN_CAPTURE_UNMATCHED === 'true', items: db.prepare('SELECT id,at,lang,text,topic FROM brain_unmatched ORDER BY id DESC LIMIT 100').all(),
    note: 'Désactivé par défaut. Même activé, seul un visiteur ayant explicitement accepté l’amélioration (allow_improvement) est enregistré ; texte expurgé, 300 caractères, conservé 30 jours.' });

  return { recordCall, recordMedia, providerEvent, overview, providers, listCases, addCase, setCaseActive, runEval, listRuns, getRun, unmatched, cleanup, confidenceOf, SEED_CASES };
}
module.exports = { createBrainMetrics, confidenceOf, usageOf, errorCode, SEED_CASES };

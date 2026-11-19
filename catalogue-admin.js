'use strict';
// Catalogue governance: quality checks, duplicate prevention, taxonomy, drafts with approval, revision diffs.
// Works on the existing `services` table; live content only changes through store.updateService (which keeps revisions).
const DRAFT_FIELDS = ['category', 'fr', 'ar', 'desc', 'desc_ar', 'terms', 'technologies', 'includes', 'problems'];
const LIST_FIELDS = ['technologies', 'includes', 'problems'];
const ARABIC = /[؀-ۿ]/, LATIN = /[A-Za-zÀ-ÿ]/;
const BOILERPLATE_AR = /الخدمة متاحة للدراسة بعد التحقق/;
const STOP = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'pour', 'en', 'd', 'l', 'au', 'aux', 'un', 'une', 'sur', 'avec', 'a', 'و', 'في', 'من', 'ل', 'ال', 'على']);

function fail(message, status = 400, extra = {}) { const e = new Error(message); e.public = true; e.status = status; Object.assign(e, extra); return e; }
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ًͯ-ٰٟـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const tokens = s => new Set(norm(s).split(' ').filter(t => t && !STOP.has(t) && t.length > 1));
function jaccard(a, b) { if (!a.size || !b.size) return 0; let inter = 0; for (const t of a) if (b.has(t)) inter++; return inter / (a.size + b.size - inter); }
const techKey = s => norm(s).replace(/ /g, '');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function createCatalogue({ db, store, categories, otherOwnerActive = () => false }) {
  db.exec(`CREATE TABLE IF NOT EXISTS service_drafts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL REFERENCES services(slug),
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_review','published','rejected','withdrawn')),
    patch_json TEXT NOT NULL, base_json TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
    author TEXT NOT NULL, author_role TEXT NOT NULL DEFAULT '', reviewer TEXT NOT NULL DEFAULT '', review_note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);
    CREATE INDEX IF NOT EXISTS idx_service_drafts_status ON service_drafts(status,slug);`);
  const now = () => new Date().toISOString();
  const catName = Object.fromEntries(categories.map(c => [c.id, c.fr]));
  const rows = () => store.fullRows();

  // ---- duplicates ---------------------------------------------------------------------------
  function similarity(a, b) {
    const fr = jaccard(tokens(a.fr), tokens(b.fr)), ar = jaccard(tokens(a.ar), tokens(b.ar));
    const exact = norm(a.fr) === norm(b.fr) || (norm(a.ar) && norm(a.ar) === norm(b.ar));
    return { score: exact ? 1 : Math.max(fr, ar), exact };
  }
  function findDuplicates(candidate, excludeSlug = '', min = 0.6) {
    const out = [];
    for (const s of rows()) {
      if (s.slug === excludeSlug) continue;
      const sim = similarity(candidate, s);
      const slugEq = candidate.slug && norm(candidate.slug) === norm(s.slug);
      if (slugEq || sim.score >= min) out.push({ slug: s.slug, fr: s.fr, ar: s.ar, category: s.category, score: slugEq ? 1 : Number(sim.score.toFixed(2)), exact: sim.exact || Boolean(slugEq) });
    }
    return out.sort((x, y) => y.score - x.score).slice(0, 8);
  }
  const BLOCK = 0.85;
  function assertNotDuplicate(candidate, { excludeSlug = '', force = false } = {}) {
    const hits = findDuplicates(candidate, excludeSlug, BLOCK);
    if (hits.length && !force) throw fail('Prestation probablement en doublon : ' + hits.map(h => h.fr).join(' ; '), 409, { code: 'duplicate', candidates: hits });
    return findDuplicates(candidate, excludeSlug, 0.6).filter(h => !hits.includes(h));
  }
  function duplicatePairs(min = 0.6) {
    const list = rows(), pairs = [];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const sim = similarity(list[i], list[j]);
      if (sim.score >= min) pairs.push({ a: { slug: list[i].slug, fr: list[i].fr }, b: { slug: list[j].slug, fr: list[j].fr }, score: Number(sim.score.toFixed(2)), exact: sim.exact });
    }
    return pairs.sort((x, y) => y.score - x.score).slice(0, 100);
  }

  // ---- quality and language coverage ---------------------------------------------------------
  function issuesFor(s) {
    const out = [], add = (code, severity, detail) => out.push({ code, severity, detail });
    if (!ARABIC.test(s.ar)) add('ar_title_missing', 'warning', 'Le titre arabe ne contient pas de caractères arabes');
    if (!ARABIC.test(s.desc_ar)) add('ar_desc_missing', 'warning', 'La description arabe ne contient pas de caractères arabes');
    else if (BOILERPLATE_AR.test(s.desc_ar)) add('ar_desc_generic', 'info', 'Description arabe générique (titre + formule standard) à rédiger');
    if (ARABIC.test(s.fr) && !LATIN.test(s.fr)) add('fr_title_arabic', 'warning', 'Le titre français est en écriture arabe');
    if (s.desc.trim().length < 40) add('fr_desc_short', 'warning', 'Description française très courte (< 40 caractères)');
    if (!s.technologies.length) add('no_technologies', 'info', 'Aucune technologie renseignée');
    if (!s.includes.length) add('no_includes', 'info', 'Rien n’est listé dans « ce qui est inclus »');
    if (!s.problems.length) add('no_problems', 'info', 'Aucun problème fréquent renseigné');
    if (!s.terms.trim()) add('no_terms', 'warning', 'Aucun mot-clé de recherche');
    if (s.status === 'Disponible' && !s.published) add('available_hidden', 'warning', '« Disponible » mais fiche masquée');
    return out;
  }
  function quality() {
    const list = rows(), byCode = {}, services = [];
    for (const s of list) { const is = issuesFor(s); for (const i of is) byCode[i.code] = (byCode[i.code] || 0) + 1; if (is.length) services.push({ slug: s.slug, fr: s.fr, category: s.category, issues: is }); }
    return { checked: list.length, with_issues: services.length, by_code: byCode, services: services.sort((a, b) => b.issues.length - a.issues.length).slice(0, 300) };
  }
  function overview() {
    const list = rows(), by = (f, v) => list.filter(s => s[f] === v).length;
    const cats = {}; for (const s of list) { const c = cats[s.category] || (cats[s.category] = { id: s.category, name: catName[s.category] || s.category, total: 0, published: 0, available: 0 }); c.total++; if (s.published) c.published++; if (s.status === 'Disponible' && s.published) c.available++; }
    const arOk = list.filter(s => ARABIC.test(s.ar) && ARABIC.test(s.desc_ar)).length, arReal = list.filter(s => ARABIC.test(s.desc_ar) && !BOILERPLATE_AR.test(s.desc_ar)).length;
    const q = quality();
    return { total: list.length, published: list.filter(s => s.published).length, hidden: by('published', false),
      status: Object.fromEntries(['Sur étude', 'Disponible', 'En préparation', 'Indisponible'].map(x => [x, by('status', x)])),
      categories: Object.values(cats).sort((a, b) => b.total - a.total),
      languages: { fr: { complete: list.filter(s => s.fr.trim() && s.desc.trim().length >= 40).length }, ar: { present: arOk, written: arReal, generic: arOk - arReal }, unsupported: ['en', 'darija'], total: list.length },
      drafts: Object.fromEntries(['draft', 'pending_review', 'rejected'].map(x => [x, db.prepare('SELECT count(*) n FROM service_drafts WHERE status=?').get(x).n])),
      quality: { with_issues: q.with_issues, by_code: q.by_code }, duplicates: duplicatePairs(0.85).length };
  }

  // ---- taxonomy -------------------------------------------------------------------------------
  function taxonomy() {
    const map = new Map();
    for (const s of rows()) for (const t of s.technologies) { const k = techKey(t); if (!k) continue; const e = map.get(k) || { key: k, count: 0, variants: new Map(), services: [] }; e.count++; e.variants.set(t, (e.variants.get(t) || 0) + 1); e.services.push(s.slug); map.set(k, e); }
    const technologies = [...map.values()].map(e => ({ key: e.key, count: e.count, variants: [...e.variants].map(([name, n]) => ({ name, count: n })).sort((a, b) => b.count - a.count), inconsistent: e.variants.size > 1 })).sort((a, b) => b.count - a.count);
    const cats = overview().categories;
    return { technologies, inconsistent: technologies.filter(t => t.inconsistent).length, categories: cats, available_categories: categories.map(c => ({ id: c.id, fr: c.fr })) };
  }
  // Merge/rename technology spellings across services; every touched service gets a revision.
  function mergeTechnologies({ from, to }, actor) {
    if (!Array.isArray(from) || !from.length || from.length > 20 || from.some(x => typeof x !== 'string' || !x.trim())) throw fail('Variantes à fusionner invalides');
    if (typeof to !== 'string' || !to.trim() || to.length > 250) throw fail('Libellé cible invalide');
    const fromKeys = new Set(from.map(techKey)), target = to.trim(); let touched = 0;
    db.exec('SAVEPOINT tech_merge');
    try {
      for (const s of rows()) {
        if (!s.technologies.some(t => fromKeys.has(techKey(t)) || techKey(t) === techKey(target))) continue;
        const next = []; for (const t of s.technologies) { const v = fromKeys.has(techKey(t)) ? target : t; if (!next.some(x => techKey(x) === techKey(v))) next.push(v); }
        if (same(next, s.technologies)) continue;
        store.updateService(s.slug, { technologies: next }, { actor, source: 'taxonomy-merge', note: `« ${from.join(' / ')} » → « ${target} »` }); touched++;
      }
      db.exec('RELEASE tech_merge');
    } catch (e) { db.exec('ROLLBACK TO tech_merge'); db.exec('RELEASE tech_merge'); throw e; }
    return { services_updated: touched, target };
  }

  // ---- revisions ------------------------------------------------------------------------------
  function diff(a, b) {
    const out = [];
    for (const f of store.EDITABLE) { if (same(a[f], b[f])) continue; out.push({ field: f, before: a[f], after: b[f] }); }
    return out;
  }
  function revisionDetail(slug, rev) {
    const r = store.revision(slug, rev); if (!r) throw fail('Révision introuvable', 404);
    const cur = store.getService(slug), prev = rev > 0 ? store.revision(slug, rev - 1) : null;
    return { rev: r.rev, at: r.at, actor: r.actor, actor_role: r.actor_role, source: r.source, note: r.note, snapshot: r.snapshot, diff_vs_previous: prev ? diff(prev.snapshot, r.snapshot) : [], diff_vs_current: diff(r.snapshot, store.snapshotOf(cur)) };
  }

  // ---- drafts and approval ----------------------------------------------------------------------
  const parse = d => ({ ...d, patch: JSON.parse(d.patch_json), base: JSON.parse(d.base_json), patch_json: undefined, base_json: undefined });
  const getDraftRow = id => { const d = db.prepare('SELECT * FROM service_drafts WHERE id=?').get(id); if (!d) throw fail('Brouillon introuvable', 404); return d; };
  function cleanPatch(slug, patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw fail('Modifications requises');
    const out = {}, cur = store.getService(slug);
    for (const [k, v] of Object.entries(patch)) {
      if (!DRAFT_FIELDS.includes(k)) throw fail(`Le champ « ${k} » ne peut pas être proposé (publication et disponibilité sont réservées au propriétaire)`);
      if (!same(v, cur[k])) out[k] = LIST_FIELDS.includes(k) && Array.isArray(v) ? v.map(x => String(x).trim()).filter(Boolean) : v;
    }
    if (!Object.keys(out).length) throw fail('Aucune différence avec la fiche actuelle');
    store.validateService(cur, out); // same validation as a live edit
    return out;
  }
  const isAuthor = (d, actor) => d.author === actor.email;
  function createDraft({ slug, patch, note }, actor) {
    const cur = store.getService(String(slug || '')); if (!cur) throw fail('Prestation introuvable', 404);
    const p = cleanPatch(cur.slug, patch), base = Object.fromEntries(Object.keys(p).map(k => [k, cur[k]])), t = now();
    const r = db.prepare('INSERT INTO service_drafts(slug,status,patch_json,base_json,note,author,author_role,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(cur.slug, 'draft', JSON.stringify(p), JSON.stringify(base), String(note || '').slice(0, 300), actor.email, actor.role, t, t);
    return listDrafts({ id: Number(r.lastInsertRowid) })[0];
  }
  function updateDraft(id, { patch, note, version }, actor) {
    const d = getDraftRow(id);
    if (!['draft', 'rejected'].includes(d.status)) throw fail('Seul un brouillon ou une proposition rejetée peut être modifié', 409);
    if (!isAuthor(d, actor) && actor.role !== 'owner') throw fail('Seul l’auteur (ou un propriétaire) peut modifier ce brouillon', 403);
    if (version !== d.version) throw fail('Brouillon modifié entre-temps — actualisez', 409);
    const cur = store.getService(d.slug), p = cleanPatch(d.slug, patch), base = Object.fromEntries(Object.keys(p).map(k => [k, Object.hasOwn(JSON.parse(d.base_json), k) ? JSON.parse(d.base_json)[k] : cur[k]]));
    const r = db.prepare("UPDATE service_drafts SET patch_json=?,base_json=?,note=?,status='draft',updated_at=?,version=version+1 WHERE id=? AND version=?").run(JSON.stringify(p), JSON.stringify(base), String(note ?? d.note).slice(0, 300), now(), id, d.version);
    if (r.changes !== 1) throw fail('Brouillon modifié entre-temps — actualisez', 409);
    return listDrafts({ id })[0];
  }
  function submit(id, actor) {
    const d = getDraftRow(id);
    if (d.status !== 'draft' && d.status !== 'rejected') throw fail('Seul un brouillon peut être soumis', 409);
    if (!isAuthor(d, actor) && actor.role !== 'owner') throw fail('Seul l’auteur peut soumettre ce brouillon', 403);
    const patch = JSON.parse(d.patch_json), cur = store.getService(d.slug), warnings = [];
    if (patch.fr || patch.ar) warnings.push(...assertNotDuplicate({ fr: patch.fr ?? cur.fr, ar: patch.ar ?? cur.ar, slug: d.slug }, { excludeSlug: d.slug, force: false }));
    db.prepare("UPDATE service_drafts SET status='pending_review',updated_at=?,version=version+1 WHERE id=?").run(now(), id);
    return { draft: listDrafts({ id })[0], duplicate_warnings: warnings };
  }
  function withdraw(id, actor) {
    const d = getDraftRow(id);
    if (!['draft', 'pending_review', 'rejected'].includes(d.status)) throw fail('Ce brouillon est clos', 409);
    if (!isAuthor(d, actor) && actor.role !== 'owner') throw fail('Seul l’auteur peut retirer ce brouillon', 403);
    db.prepare("UPDATE service_drafts SET status='withdrawn',updated_at=?,version=version+1 WHERE id=?").run(now(), id);
    return listDrafts({ id })[0];
  }
  function reject(id, { note }, actor) {
    const d = getDraftRow(id);
    if (d.status !== 'pending_review') throw fail('Seule une proposition en attente peut être rejetée', 409);
    if (!String(note || '').trim()) throw fail('Un motif de rejet est requis');
    db.prepare("UPDATE service_drafts SET status='rejected',reviewer=?,review_note=?,updated_at=?,version=version+1 WHERE id=?").run(actor.email, String(note).slice(0, 300), now(), id);
    return listDrafts({ id })[0];
  }
  function approve(id, { note, force = false, force_duplicate = false } = {}, actor) {
    const d = getDraftRow(id);
    if (d.status !== 'pending_review') throw fail('Seule une proposition en attente peut être approuvée', 409);
    // Four-eyes: only the owner approves, and a non-owner author can never approve their own proposal.
    if (actor.role !== 'owner') throw fail('Seul un propriétaire peut approuver', 403);
    // Four-eyes: as soon as a second active owner exists, nobody approves their own proposal. A lone owner is never locked out.
    if (d.author === actor.email && otherOwnerActive(actor.email)) throw fail('Double contrôle : un autre propriétaire doit approuver ce brouillon', 403, { code: 'four_eyes' });
    const patch = JSON.parse(d.patch_json), base = JSON.parse(d.base_json), cur = store.getService(d.slug);
    if (!cur) throw fail('Prestation introuvable', 404);
    const conflicts = Object.keys(patch).filter(k => !same(cur[k], base[k]));
    if (conflicts.length && !force) throw fail('La fiche a changé depuis la rédaction du brouillon sur : ' + conflicts.join(', '), 409, { code: 'conflict', conflicts, current: Object.fromEntries(conflicts.map(k => [k, cur[k]])), base: Object.fromEntries(conflicts.map(k => [k, base[k]])) });
    if (patch.fr || patch.ar) assertNotDuplicate({ fr: patch.fr ?? cur.fr, ar: patch.ar ?? cur.ar, slug: d.slug }, { excludeSlug: d.slug, force: force_duplicate });
    db.exec('SAVEPOINT draft_approve');
    try {
      store.updateService(d.slug, patch, { actor, source: 'draft#' + d.id, note: `Brouillon de ${d.author}${note ? ' — ' + String(note).slice(0, 200) : ''}` });
      db.prepare("UPDATE service_drafts SET status='published',reviewer=?,review_note=?,updated_at=?,version=version+1 WHERE id=?").run(actor.email, String(note || '').slice(0, 300), now(), id);
      db.exec('RELEASE draft_approve');
    } catch (e) { db.exec('ROLLBACK TO draft_approve'); db.exec('RELEASE draft_approve'); throw e; }
    return listDrafts({ id })[0];
  }
  function restoreAsDraft(slug, rev, actor) {
    const r = store.revision(slug, rev); if (!r) throw fail('Révision introuvable', 404);
    const cur = store.getService(slug), patch = {};
    for (const f of DRAFT_FIELDS) if (!same(r.snapshot[f], cur[f])) patch[f] = r.snapshot[f];
    if (!Object.keys(patch).length) throw fail('Cette révision est identique à la fiche actuelle');
    return createDraft({ slug, patch, note: `Restauration de la révision ${rev}` }, actor);
  }
  function listDrafts({ id, status, slug, mine, actor } = {}) {
    const where = [], args = [];
    if (id) { where.push('id=?'); args.push(id); }
    if (status) { where.push('status=?'); args.push(status); }
    if (slug) { where.push('slug=?'); args.push(slug); }
    if (mine && actor) { where.push('author=?'); args.push(actor.email); }
    return db.prepare(`SELECT d.*, s.fr AS service_fr FROM service_drafts d JOIN services s ON s.slug=d.slug ${where.length ? 'WHERE ' + where.map(w => 'd.' + w).join(' AND ') : ''} ORDER BY d.id DESC LIMIT 200`).all(...args).map(parse);
  }
  return { overview, quality, issuesFor, findDuplicates, assertNotDuplicate, duplicatePairs, taxonomy, mergeTechnologies, diff, revisionDetail, createDraft, updateDraft, submit, withdraw, reject, approve, restoreAsDraft, listDrafts, DRAFT_FIELDS };
}
module.exports = { createCatalogue, norm, jaccard };

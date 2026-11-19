'use strict';
// Admin API for catalogue governance. Permissions are enforced centrally (rbac.js) before these handlers run.
function createCatalogueApi({ catalogue, store, helpers }) {
  const { response, bodyJson } = helpers;
  const int = v => { const n = Number(v); return Number.isSafeInteger(n) && n >= 0 ? n : NaN; };
  const bad = (res, msg) => { response(res, 400, { error: msg }); return true; };

  async function handle(req, res, p, method, s) {
    if (!p.startsWith('/api/admin/catalogue/') && !/^\/api\/admin\/services\/[^/]+\/revisions/.test(p)) return false;
    const me = s.principal, url = new URL(req.url, 'http://x'), q = url.searchParams;
    const audit = (a, r, d) => store.logAudit(a, r, d, me);
    if (p === '/api/admin/catalogue/overview' && method === 'GET') { response(res, 200, catalogue.overview()); return true; }
    if (p === '/api/admin/catalogue/quality' && method === 'GET') { response(res, 200, catalogue.quality()); return true; }
    if (p === '/api/admin/catalogue/duplicates' && method === 'GET') { response(res, 200, { pairs: catalogue.duplicatePairs(Number(q.get('min')) || 0.6) }); return true; }
    if (p === '/api/admin/catalogue/duplicate-check' && method === 'GET') {
      response(res, 200, { candidates: catalogue.findDuplicates({ fr: q.get('fr') || '', ar: q.get('ar') || '', slug: q.get('slug') || '' }, q.get('exclude') || '', 0.6) }); return true;
    }
    if (p === '/api/admin/catalogue/taxonomy' && method === 'GET') { response(res, 200, catalogue.taxonomy()); return true; }
    if (p === '/api/admin/catalogue/taxonomy/merge' && method === 'POST') {
      const b = await bodyJson(req), r = catalogue.mergeTechnologies({ from: b.from, to: b.to }, me);
      audit('taxonomy_merge', String(b.to).slice(0, 80), `${r.services_updated} fiche(s)`); response(res, 200, r); return true;
    }
    if (p === '/api/admin/catalogue/drafts' && method === 'GET') {
      response(res, 200, { drafts: catalogue.listDrafts({ status: q.get('status') || undefined, slug: q.get('slug') || undefined, mine: q.get('mine') === '1', actor: me }) }); return true;
    }
    if (p === '/api/admin/catalogue/drafts' && method === 'POST') {
      const b = await bodyJson(req), d = catalogue.createDraft({ slug: b.slug, patch: b.patch, note: b.note }, me);
      audit('draft_created', `${d.slug}#${d.id}`, Object.keys(d.patch).join(',')); response(res, 201, { draft: d }); return true;
    }
    const m = /^\/api\/admin\/catalogue\/drafts\/([1-9][0-9]{0,8})(?:\/(submit|withdraw|approve|reject))?$/.exec(p);
    if (m) {
      const id = Number(m[1]), act = m[2];
      if (!act && method === 'PUT') { const b = await bodyJson(req), d = catalogue.updateDraft(id, { patch: b.patch, note: b.note, version: b.version }, me); audit('draft_updated', `${d.slug}#${id}`, ''); response(res, 200, { draft: d }); return true; }
      if (act === 'submit' && method === 'POST') { const r = catalogue.submit(id, me); audit('draft_submitted', `${r.draft.slug}#${id}`, ''); response(res, 200, r); return true; }
      if (act === 'withdraw' && method === 'POST') { const d = catalogue.withdraw(id, me); audit('draft_withdrawn', `${d.slug}#${id}`, ''); response(res, 200, { draft: d }); return true; }
      if (act === 'reject' && method === 'POST') { const b = await bodyJson(req), d = catalogue.reject(id, { note: b.note }, me); audit('draft_rejected', `${d.slug}#${id}`, String(b.note).slice(0, 120)); response(res, 200, { draft: d }); return true; }
      if (act === 'approve' && method === 'POST') {
        const b = await bodyJson(req), d = catalogue.approve(id, { note: b.note, force: b.force === true, force_duplicate: b.force_duplicate === true }, me);
        audit('draft_approved', `${d.slug}#${id}`, Object.keys(d.patch).join(',')); response(res, 200, { draft: d, service: store.getService(d.slug) }); return true;
      }
    }
    const r = /^\/api\/admin\/services\/([^/]+)\/revisions(?:\/([0-9]{1,6})(\/restore)?)?$/.exec(p);
    if (r) {
      let slug; try { slug = decodeURIComponent(r[1]); } catch { return bad(res, 'Identifiant de service invalide'); }
      if (!store.getService(slug)) { response(res, 404, { error: 'Prestation introuvable' }); return true; }
      if (!r[2] && method === 'GET') { response(res, 200, { revisions: store.revisions(slug) }); return true; }
      const n = int(r[2]);
      if (r[2] && !r[3] && method === 'GET') { response(res, 200, { revision: catalogue.revisionDetail(slug, n) }); return true; }
      if (r[2] && r[3] && method === 'POST') { const d = catalogue.restoreAsDraft(slug, n, me); audit('revision_restore_draft', `${slug}@${n}`, `brouillon #${d.id}`); response(res, 201, { draft: d }); return true; }
    }
    return false;
  }
  return { handle };
}
module.exports = { createCatalogueApi };

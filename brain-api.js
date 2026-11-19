'use strict';
// Admin API for brain monitoring and the evaluation set. Authorization is enforced centrally (rbac.js).
function createBrainApi({ brain, store, studio, helpers }) {
  const { response, bodyJson } = helpers;
  async function handle(req, res, p, method, s) {
    if (!p.startsWith('/api/admin/brain/')) return false;
    const me = s.principal, q = new URL(req.url, 'http://x').searchParams, audit = (a, r, d) => store.logAudit(a, r, d, me);
    if (p === '/api/admin/brain/overview' && method === 'GET') { response(res, 200, brain.overview(q.get('days'))); return true; }
    if (p === '/api/admin/brain/providers' && method === 'GET') { response(res, 200, brain.providers(q.get('days'))); return true; }
    if (p === '/api/admin/brain/unmatched' && method === 'GET') { response(res, 200, brain.unmatched()); return true; }
    if (p === '/api/admin/brain/eval/cases' && method === 'GET') { response(res, 200, { cases: brain.listCases() }); return true; }
    if (p === '/api/admin/brain/eval/cases' && method === 'POST') {
      const b = await bodyJson(req), c = brain.addCase({ query: b.query, expect_topic: b.expect_topic, expect_slugs: b.expect_slugs, note: b.note }, me, slug => Boolean(store.getService(slug)));
      audit('brain_case_added', '#' + c.id, c.expect_topic); response(res, 201, { case: c }); return true;
    }
    const m = /^\/api\/admin\/brain\/eval\/cases\/([1-9][0-9]{0,8})$/.exec(p);
    if (m && method === 'PUT') { const b = await bodyJson(req), c = brain.setCaseActive(Number(m[1]), b.active === true); audit('brain_case_toggled', '#' + c.id, String(c.active)); response(res, 200, { case: c }); return true; }
    if (p === '/api/admin/brain/eval/runs' && method === 'GET') { response(res, 200, { runs: brain.listRuns() }); return true; }
    const r = /^\/api\/admin\/brain\/eval\/runs\/([1-9][0-9]{0,8})$/.exec(p);
    if (r && method === 'GET') { const run = brain.getRun(Number(r[1])); response(res, run ? 200 : 404, run ? { run } : { error: 'Exécution introuvable' }); return true; }
    if (p === '/api/admin/brain/eval/run' && method === 'POST') {
      const run = brain.runEval(me, studio.enrich(store.fullRows())); audit('brain_eval_run', '#' + run.id, `${run.summary.pass}/${run.summary.total}`); response(res, 201, { run }); return true;
    }
    return false;
  }
  return { handle };
}
module.exports = { createBrainApi };

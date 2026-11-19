(() => {
  'use strict';
  const App = window.AllosApp, { el } = App;
  const TOPICS = ['wifi', 'pc', 'printer', 'software', 'camera', 'cloud', 'servers', 'network', 'satellite', 'fire', 'automation', 'security', 'advice'];
  const pct = v => v === null || v === undefined ? '—' : Math.round(v * 100) + ' %';
  const CONF = { high: ['Haute', 'ok'], medium: ['Moyenne', 'info'], low: ['Faible', 'warn'], none: ['Aucune correspondance', 'bad'] };
  const AI = { not_requested: 'Non demandée', ok: 'Réussie', failed: 'Échec fournisseurs', quota_exhausted: 'Quota quotidien atteint', disabled: 'Demandée mais désactivée' };
  const ERR = { timeout: 'Délai dépassé', network: 'Réseau', invalid_output: 'Réponse invalide', circuit_open: 'Circuit ouvert (suspendu)', budget_exhausted: 'Budget du fournisseur atteint (appel évité)', http_429: 'HTTP 429 (limite)', http_401: 'HTTP 401 (clé refusée)', http_403: 'HTTP 403', http_500: 'HTTP 500', http_503: 'HTTP 503' };
  const bar = (v, max, bad) => { const b = el('div', 'bar'), i = el('i'); i.style.width = Math.max(2, Math.round(100 * v / Math.max(1, max))) + '%'; if (bad) i.classList.add('bad'); b.append(i); return b; };

  async function render(root) {
    const tabs = [['overview', 'Vue d’ensemble'], ['eval', 'Précision (jeu d’évaluation)'], ['providers', 'Fournisseurs & consommation'], ['unmatched', 'Phrases non comprises']];
    if (!App.can('inquiries.read')) tabs.pop();
    const bar2 = el('div', 'toolbar tabbar'), body = el('div'); root.append(bar2, body); let current = 'overview';
    const open = async id => { current = id; bar2.querySelectorAll('button').forEach(b => b.classList.toggle('primary', b.dataset.t === id)); body.replaceChildren(el('p', 'muted', 'Chargement…')); try { const h = el('div'); await views[id](h); body.replaceChildren(h); } catch (e) { body.replaceChildren(el('p', 'error-box', e.message)); } };
    for (const [id, label] of tabs) { const b = App.btn(label, () => open(id)); b.dataset.t = id; bar2.append(b); }
    const reopen = () => open(current);

    const views = {
      async overview(host) {
        const days = Number(sessionStorage.getItem('brain-days')) || 7, sel = App.select([['1', '24 heures'], ['7', '7 jours'], ['30', '30 jours'], ['90', '90 jours']], String(days));
        sel.addEventListener('change', () => { sessionStorage.setItem('brain-days', sel.value); reopen(); });
        const o = await App.api('/api/admin/brain/overview?days=' + days), t = o.text, tools = el('div', 'toolbar'); tools.append(el('span', 'muted', 'Période :'), sel); host.append(tools);
        host.append(el('div', 'banner', 'Confidentialité : seules des métadonnées sont enregistrées (langue, longueur, sujet, confiance, prestation proposée, issue, durée). Le texte des visiteurs n’est jamais conservé ; la précision réelle se mesure sur le jeu d’évaluation rédigé par l’équipe.'));
        const kp = el('div', 'kpis'), hi = o.confidence.high + o.confidence.medium + o.confidence.low + o.confidence.none;
        kp.append(App.kpi('Demandes analysées', t.calls, `${o.by_kind.image || 0} photo(s) · ${o.by_kind.audio || 0} audio`), App.kpi('Sans correspondance', pct(t.no_match_rate), `${t.no_match} demande(s) → question de clarification`, t.no_match_rate > 0.25 ? 'bad' : t.no_match_rate > 0.1 ? 'warn' : 'ok'),
          App.kpi('Confiance haute', hi ? pct(o.confidence.high / hi) : '—', `${o.confidence.high} sur ${hi}`), App.kpi('Latence moyenne du moteur', t.avg_latency_ms + ' ms', 'Moteur local, hors fournisseurs'),
          App.kpi('Questions de clarification', o.clarification.calls_with_questions, 'Taux de suite donnée : ' + pct(o.clarification.follow_up_rate)));
        host.append(kp);
        const g = el('div', 'grid cols-2'), conf = App.card('Confiance du moteur', 'RECONNAISSANCE');
        conf.append(App.rows(['high', 'medium', 'low', 'none'].map(k => { const h = el('div', 'toolbar'); h.append(bar(o.confidence[k], hi, k === 'none'), el('strong', '', String(o.confidence[k]))); return [CONF[k][0], h]; })));
        conf.append(el('p', 'muted small', 'Haute ≥ 70, moyenne ≥ 45, faible < 45 (score du meilleur résultat). Les phrases sans correspondance reçoivent des questions guidées, jamais une réponse inventée.'));
        const lang = App.card('Langues détectées', 'LANGUES'); lang.append(o.languages.length ? App.table(['Langue', 'Demandes', 'Sans correspondance'], o.languages.map(l => [l.lang, l.n, `${l.none} (${pct(l.n ? l.none / l.n : 0)})`])) : App.empty('Aucune donnée sur la période.'));
        const top = App.card('Prestations les plus proposées', 'TOP 10'); top.append(o.top_services.length ? App.table(['Prestation (slug)', 'Fois', 'Score moyen'], o.top_services.map(s => [s.slug, s.n, s.score])) : App.empty('Aucune donnée.'));
        const topics = App.card('Sujets détectés', 'THÈMES'); topics.append(o.topics.length ? App.table(['Sujet', 'Demandes'], o.topics.map(s => [s.topic, s.n])) : App.empty('Aucune donnée.'));
        g.append(conf, lang, top, topics); host.append(g);
        const qc = App.card('Questions de clarification', 'DIALOGUE'); qc.append(App.rows([['Demandes ayant reçu des questions', String(o.clarification.calls_with_questions)], ['Demandes affinées (avec réponses)', String(o.clarification.refinement_calls)], ['Taux de suite (estimation)', pct(o.clarification.follow_up_rate)]]));
        qc.append(Object.keys(o.clarification.by_question).length ? App.table(['Question', 'Posée'], Object.entries(o.clarification.by_question).map(([k, n]) => [{ context: 'Contexte (où ?)', detail: 'Détail du problème', goal: 'Objectif', budget: 'Budget' }[k] || k, n])) : App.empty('Aucune question posée.'));
        qc.append(el('p', 'muted small', o.clarification.note)); host.append(qc);
        const ai = App.card('Assistance IA externe (par demande)', 'FOURNISSEURS'); ai.append(Object.keys(o.ai_assistance).length ? App.rows(Object.entries(o.ai_assistance).map(([k, n]) => [AI[k] || k, String(n)])) : App.empty('Aucune demande.')); host.append(ai);
        const tr = App.card('Évolution quotidienne', 'TENDANCE'), mx = Math.max(1, ...o.trend.map(x => x.n)); tr.append(o.trend.length ? App.table(['Jour', 'Demandes', '', 'Sans correspondance'], o.trend.map(x => [x.day, x.n, bar(x.n, mx), x.none])) : App.empty('Aucune donnée.')); host.append(tr);
      },
      async eval(host) {
        const [runs, cases, pub] = await Promise.all([App.api('/api/admin/brain/eval/runs'), App.api('/api/admin/brain/eval/cases'), fetch('/api/public/catalog').then(r => r.json())]);
        const last = runs.runs[0], head = el('div', 'toolbar');
        head.append(App.btn('Lancer l’évaluation maintenant', App.guard(async () => { const r = await App.api('/api/admin/brain/eval/run', { method: 'POST', data: {} }); App.toast(`${r.run.summary.pass}/${r.run.summary.total} cas réussis`); reopen(); }), 'primary'), el('span', 'muted small', 'Moteur local déterministe : aucun appel externe, aucun coût, aucune donnée client.'));
        host.append(head);
        if (!last) host.append(App.empty('Aucune exécution. Lancez l’évaluation pour mesurer la précision.'));
        else {
          const s = last.summary, full = await App.api('/api/admin/brain/eval/runs/' + last.id), kp = el('div', 'kpis');
          kp.append(App.kpi('Cas réussis', `${s.pass} / ${s.total}`, pct(s.pass_rate), s.pass_rate >= 0.9 ? 'ok' : 'warn'), App.kpi('Sujet exact', pct(s.topic_accuracy), 'Thème correctement détecté'), App.kpi('Bonne prestation en 1er', pct(s.top1_accuracy)), App.kpi('Bonne prestation dans le top 3', pct(s.top3_accuracy)),
            App.kpi('Sans correspondance', s.no_match, 'Phrases du jeu sans aucun résultat', s.no_match ? 'warn' : 'ok'), App.kpi('Régressions', s.regressions.length, s.previous_run ? `vs exécution n°${s.previous_run}` : 'Première exécution', s.regressions.length ? 'bad' : 'ok'));
          host.append(kp);
          const lg = App.card('Par langue', 'RÉSULTATS'); lg.append(App.table(['Langue', 'Cas', 'Réussis'], Object.entries(s.by_language).map(([k, v]) => [k, v.total, `${v.pass} (${pct(v.pass / v.total)})`]))); host.append(lg);
          const fails = full.run.results.filter(r => !r.pass), fc = App.card(`Cas en échec (${fails.length})`, 'POINTS FAIBLES');
          fc.append(el('p', 'muted small', 'Ces phrases montrent où le moteur se trompe. Corrigez-les via Knowledge Studio (concepts et relations approuvés) — jamais en laissant un modèle externe décider.'));
          fc.append(fails.length ? App.table(['Phrase', 'Attendu', 'Obtenu', 'Score'], fails.map(r => [r.query, `${r.expect_topic || '—'} ${r.expect_slugs.length ? '→ ' + r.expect_slugs.join(', ') : ''}`, r.no_match ? App.chip('aucune correspondance', 'bad') : `${r.got_topic} → ${r.got.join(', ')}`, r.score])) : App.empty('Tous les cas réussissent.')); host.append(fc);
          if (s.regressions.length) host.append(el('div', 'banner bad', 'Régressions depuis la précédente exécution : cas n° ' + s.regressions.join(', ')));
        }
        // add case
        const add = App.card('Ajouter un cas de test', 'JEU D’ÉVALUATION'), f = el('form', 'form-grid');
        add.append(el('p', 'muted', 'Écrivez des exemples fictifs ou anonymisés. Les phrases contenant un email ou un téléphone sont refusées.'));
        const q = App.input({ required: '', maxlength: '200', placeholder: 'ex. mon imprimante ne scanne plus' }), topic = App.select([['', '— sujet attendu —'], ...TOPICS.map(x => [x, x])]), slug = App.select([['', '— prestation attendue (facultatif) —'], ...pub.services.map(x => [x.slug, x.fr])]);
        f.append(App.field('Phrase', q), App.field('Sujet attendu', topic), App.field('Prestation attendue', slug)); const b = el('button', 'btn primary', 'Ajouter'); b.type = 'submit'; const act = el('div', 'full'); act.append(b); f.append(act);
        f.addEventListener('submit', App.guard(async ev => { ev.preventDefault(); await App.api('/api/admin/brain/eval/cases', { method: 'POST', data: { query: q.value, expect_topic: topic.value, expect_slugs: slug.value ? [slug.value] : [] } }); App.toast('Cas ajouté'); reopen(); }));
        add.append(f); host.append(add);
        const cc = App.card(`Jeu d’évaluation (${cases.cases.filter(c => c.active).length} actifs / ${cases.cases.length})`, 'CAS');
        cc.append(App.table(['Phrase', 'Sujet', 'Prestation', 'Auteur', 'Actif'], cases.cases.map(c => { const t = App.btn(c.active ? 'Désactiver' : 'Activer', App.guard(async () => { await App.api('/api/admin/brain/eval/cases/' + c.id, { method: 'PUT', data: { active: !c.active } }); reopen(); }), 'small'); return [c.query, c.expect_topic || '—', c.expect_slugs.join(', ') || '—', c.created_by, t]; })));
        host.append(cc);
        host.append((() => { const c = App.card('Historique des exécutions', 'SUIVI'); c.append(runs.runs.length ? App.table(['N°', 'Date', 'Par', 'Réussis', 'Top 1', 'Top 3', 'Régressions'], runs.runs.map(r => [r.id, App.fmtDate(r.at), r.actor, `${r.summary.pass}/${r.summary.total}`, pct(r.summary.top1_accuracy), pct(r.summary.top3_accuracy), r.summary.regressions.length])) : App.empty('—')); return c; })());
      },
      async providers(host) {
        const p = await App.api('/api/admin/brain/providers?days=14'), kp = el('div', 'kpis');
        kp.append(App.kpi('Appels IA aujourd’hui', p.today.used, `Limite quotidienne ${p.today.limit} · reste ${p.today.remaining}`, p.today.limit && p.today.remaining === 0 ? 'bad' : ''), App.kpi('IA externe', p.enabled ? 'Activée' : 'Désactivée', p.enabled ? 'Avec consentement visiteur à chaque demande' : 'Moteur local uniquement', p.enabled ? 'warn' : 'ok'), App.kpi('Fournisseurs avec clé', `${p.configured.length} / 4`, p.order.length ? 'Ordre : ' + p.order.join(' → ') : 'Aucun ordre actif'));
        host.append(kp);
        const c = App.card('Santé des fournisseurs (14 jours)', 'APPELS'); c.append(p.by_provider.length ? App.table(['Fournisseur', 'Usage', 'Appels', 'Réussite', 'Latence moy.', 'Jetons entrée', 'Jetons sortie'], p.by_provider.map(r => [r.provider, r.kind, r.calls, App.chip(pct(r.success_rate), r.success_rate >= 0.95 ? 'ok' : r.success_rate >= 0.8 ? 'warn' : 'bad'), r.ms + ' ms', r.tin || '—', r.tout || '—'])) : App.empty('Aucun appel à un fournisseur depuis la mise en place du suivi.')); host.append(c);
        const e = App.card('Erreurs par fournisseur', 'INCIDENTS'); e.append(p.errors.length ? App.table(['Fournisseur', 'Erreur', 'Occurrences'], p.errors.map(x => [x.provider, ERR[x.error] || x.error, x.n])) : App.empty('Aucune erreur enregistrée.')); host.append(e);
        const br = App.card('Disjoncteurs (circuit breakers)', 'RÉSILIENCE'); br.append(App.table(['Fournisseur', 'État', 'Échecs consécutifs', 'Réouverture'], p.circuit_breakers.map(x => [x.provider, App.chip(x.state === 'open' ? 'Suspendu' : 'Normal', x.state === 'open' ? 'bad' : 'ok'), x.consecutive_failures, x.reopens_in_seconds ? x.reopens_in_seconds + ' s' : '—']))); br.append(el('p', 'muted small', 'Après 2 échecs consécutifs un fournisseur est suspendu 60 s ; le moteur local répond toujours.')); host.append(br);
        const u = App.card('Consommation quotidienne', 'API'), mx = Math.max(1, p.today.limit, ...p.ai_usage_per_day.map(x => x.calls));
        u.append(p.ai_usage_per_day.length ? App.table(['Jour', 'Appels', ''], p.ai_usage_per_day.map(x => [x.day, x.calls, bar(x.calls, mx, p.today.limit && x.calls >= p.today.limit)])) : App.empty('Aucun appel.')); u.append(el('p', 'muted small', p.cost.note)); host.append(u);
      },
      async unmatched(host) {
        const u = await App.api('/api/admin/brain/unmatched'), c = App.card('Phrases non comprises (capture volontaire)', 'AMÉLIORATION');
        c.append(App.rows([['État', u.enabled ? 'Activée' : 'Désactivée', u.enabled ? 'warn' : 'ok']]));
        c.append(el('p', 'muted', u.note));
        c.append(el('p', 'muted small', 'Pour l’activer : BRAIN_CAPTURE_UNMATCHED=true sur Railway, après validation de la politique de confidentialité (CNDP), ET ajout côté site d’une case de consentement qui envoie allow_improvement=true. Tant que ce n’est pas fait, rien n’est enregistré.'));
        c.append(u.items.length ? App.table(['Date', 'Langue', 'Sujet', 'Texte (expurgé)'], u.items.map(x => [App.fmtDate(x.at), x.lang, x.topic, x.text])) : App.empty(u.enabled ? 'Aucune phrase capturée.' : 'Aucune donnée : fonction inactive.')); host.append(c);
      }
    };
    await open('overview');
  }
  App.register({ id: 'intelligence', label: 'Cerveau & IA', icon: '🧠', group: 'content', perm: 'ai.monitor', render });
})();

(() => {
  'use strict';
  const App = window.AllosApp, { el } = App;
  const FIELD = { category: 'Catégorie', fr: 'Nom FR', ar: 'Nom AR', desc: 'Description FR', desc_ar: 'Description AR', terms: 'Mots-clés', technologies: 'Technologies', includes: 'Inclus', problems: 'Problèmes', status: 'Disponibilité', published: 'Publication' };
  const STATE = { draft: ['Brouillon', 'neutral'], pending_review: ['À valider', 'warn'], published: ['Publié', 'ok'], rejected: ['Rejeté', 'bad'], withdrawn: ['Retiré', 'neutral'] };
  const ISSUE = { ar_title_missing: 'Titre arabe absent', ar_desc_missing: 'Description arabe absente', ar_desc_generic: 'Description arabe générique', fr_title_arabic: 'Titre FR en arabe', fr_desc_short: 'Description FR trop courte', no_technologies: 'Sans technologies', no_includes: 'Sans « inclus »', no_problems: 'Sans problèmes', no_terms: 'Sans mots-clés', available_hidden: 'Disponible mais masquée' };
  const show = v => Array.isArray(v) ? (v.length ? v.join(' • ') : '(vide)') : typeof v === 'boolean' ? (v ? 'Publiée' : 'Masquée') : String(v ?? '');
  const lines = a => a.join('\n'), split = t => t.value.split('\n').map(x => x.trim()).filter(Boolean);
  const arrEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  function diffTable(rows) { // rows: [{field,before,after}]
    return App.table(['Champ', 'Avant', 'Après'], rows.map(r => [FIELD[r.field] || r.field, el('span', 'muted', show(r.before)), el('strong', '', show(r.after))]));
  }

  async function render(root) {
    const canHistory = App.can('catalogue.history'), canEdit = App.can('catalogue.edit'), canPublish = App.can('catalogue.publish');
    const tabs = [['overview', 'Aperçu & qualité', canHistory], ['services', 'Prestations', true], ['drafts', 'Brouillons & approbations', canHistory], ['dups', 'Doublons', canHistory], ['taxo', 'Technologies & catégories', canHistory]].filter(t => t[2]);
    const bar = el('div', 'toolbar tabbar'), body = el('div'); root.append(bar, body);
    let current = '';
    const open = async id => { current = id; bar.querySelectorAll('button').forEach(b => b.classList.toggle('primary', b.dataset.t === id)); body.replaceChildren(el('p', 'muted', 'Chargement…')); try { const host = el('div'); await views[id](host); body.replaceChildren(host); } catch (e) { body.replaceChildren(el('p', 'error-box', e.message)); } };
    for (const [id, label] of tabs) { const b = App.btn(label, () => open(id)); b.dataset.t = id; bar.append(b); }
    const reopen = () => open(current);
    const sub = sessionStorage.getItem('catalogue-tab'); sessionStorage.removeItem('catalogue-tab');

    const views = {
      // ---------------------------------------------------------------- overview
      async overview(host) {
        const [o, q] = await Promise.all([App.api('/api/admin/catalogue/overview'), App.api('/api/admin/catalogue/quality')]);
        const kp = el('div', 'kpis');
        kp.append(App.kpi('Prestations', o.total, `${o.published} publiées · ${o.hidden} masquées`), App.kpi('Disponibles confirmées', o.status['Disponible'], `${o.status['Sur étude']} sur étude · ${o.status['En préparation']} en préparation`),
          App.kpi('Brouillons à valider', o.drafts.pending_review, `${o.drafts.draft} en rédaction · ${o.drafts.rejected} rejetés`, o.drafts.pending_review ? 'warn' : ''),
          App.kpi('Fiches avec défauts', o.quality.with_issues, 'Voir le détail ci-dessous', o.quality.with_issues ? 'warn' : 'ok'), App.kpi('Doublons probables', o.duplicates, 'Similarité ≥ 85 %', o.duplicates ? 'bad' : 'ok'));
        host.append(kp);
        const lang = App.card('Langues', 'COUVERTURE LINGUISTIQUE');
        lang.append(App.rows([['Français complet (titre + description ≥ 40 car.)', `${o.languages.fr.complete} / ${o.total}`, o.languages.fr.complete === o.total ? 'ok' : 'warn'],
          ['Arabe rédigé (description propre)', `${o.languages.ar.written} / ${o.total}`, o.languages.ar.written === o.total ? 'ok' : 'warn'], ['Arabe générique (titre + formule standard)', String(o.languages.ar.generic), o.languages.ar.generic ? 'warn' : 'ok'],
          ['Anglais / Darija', 'Non gérés par le modèle de données actuel', 'neutral']]));
        host.append(lang);
        const cat = App.card('Par catégorie', 'RÉPARTITION'); cat.append(App.table(['Catégorie', 'Prestations', 'Publiées', 'Disponibles'], o.categories.map(c => [c.name, c.total, c.published, c.available]))); host.append(cat);
        const iss = App.card('Qualité du contenu', 'À CORRIGER'); iss.append(el('p', 'muted', `${q.with_issues} fiche(s) sur ${q.checked} présentent au moins un défaut.`));
        iss.append(App.rows(Object.entries(q.by_code).map(([k, n]) => [ISSUE[k] || k, String(n), 'warn'])));
        iss.append(q.services.length ? App.table(['Prestation', 'Défauts'], q.services.slice(0, 40).map(s => [s.fr, s.issues.map(i => ISSUE[i.code] || i.code).join(' · ')])) : App.empty('Aucun défaut détecté.')); host.append(iss);
      },
      // ---------------------------------------------------------------- services list/edit
      async services(host) {
        const [data, pub] = await Promise.all([App.api('/api/admin/services'), fetch('/api/public/catalog').then(r => r.json()).catch(() => ({ categories: [] }))]);
        const catName = Object.fromEntries(pub.categories.map(c => [c.id, c.fr])), norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
        const c = App.card('Catalogue des prestations', 'CONTENU');
        c.append(el('p', 'muted', canPublish ? 'En tant que propriétaire vous modifiez la fiche en direct (chaque changement crée une révision). Les propositions des gestionnaires apparaissent dans « Brouillons ».' : 'Vos modifications sont des propositions : elles ne changent le site qu’après approbation d’un propriétaire.'));
        const f = el('div', 'toolbar'), search = App.input({ type: 'search', placeholder: 'Nom ou catégorie…' }), cs = App.select([['', 'Toutes catégories'], ...pub.categories.map(x => [x.id, x.fr])]), ss = App.select([['', 'Tous statuts'], ...['Sur étude', 'Disponible', 'En préparation', 'Indisponible'].map(x => [x, x])]);
        f.append(search, cs, ss); c.append(f); const list = el('div', 'service-list'); c.append(list); host.append(c); const editor = el('div'); host.append(editor);
        const paint = () => { list.replaceChildren(); const t = norm(search.value); for (const s of data.services.filter(x => (!cs.value || x.category === cs.value) && (!ss.value || x.status === ss.value) && norm(x.fr + ' ' + x.ar + ' ' + x.slug).includes(t))) {
          const line = el('div', 'line'), label = el('span'); label.append(el('strong', '', s.fr), document.createTextNode(' — ' + (catName[s.category] || s.category) + ' '), App.chip(s.status, s.status === 'Disponible' ? 'ok' : s.status === 'Indisponible' ? 'bad' : 'neutral')); if (!s.published) label.append(document.createTextNode(' '), App.chip('Masqué', 'warn'));
          const act = el('div', 'toolbar'); if (canEdit) act.append(App.btn(canPublish ? 'Modifier' : 'Proposer', () => edit(s), 'small')); if (canHistory) act.append(App.btn('Historique', () => history(s), 'small')); line.append(label, act); list.append(line); } };
        [search, cs, ss].forEach(x => x.addEventListener('input', paint)); paint();
        function edit(s) {
          editor.replaceChildren(); const card = App.card((canPublish ? 'Modifier : ' : 'Proposer une modification : ') + s.fr, canPublish ? 'ÉDITION DIRECTE' : 'BROUILLON'), form = el('form', 'form-grid');
          const T = (v, rows = 3, rtl) => { const t = el('textarea'); t.rows = rows; t.value = v; if (rtl) t.dir = 'rtl'; return t; };
          const fr = App.input({ value: s.fr, required: '', maxlength: '200' }), ar = App.input({ value: s.ar, required: '', maxlength: '200', dir: 'rtl' }), desc = T(s.desc), descAr = T(s.desc_ar, 3, true), terms = T(s.terms), tech = T(lines(s.technologies), 4), inc = T(lines(s.includes), 4), prob = T(lines(s.problems), 4);
          const category = App.select(pub.categories.map(x => [x.id, x.fr]), s.category), status = App.select(['Sur étude', 'Disponible', 'En préparation', 'Indisponible'].map(x => [x, x]), s.status); status.disabled = !canPublish;
          const published = App.input({ type: 'checkbox' }); published.checked = s.published; published.disabled = !canPublish; const pl = el('label', 'check'); pl.append(published, document.createTextNode(' Publier la fiche' + (canPublish ? '' : ' (propriétaire)')));
          const note = App.input({ maxlength: '200', placeholder: canPublish ? 'Note de révision (facultatif)' : 'Pourquoi cette modification ?' });
          const dupBox = el('div', 'full'); let t; const checkDup = () => { clearTimeout(t); t = setTimeout(async () => { try { const r = await App.api('/api/admin/catalogue/duplicate-check?exclude=' + encodeURIComponent(s.slug) + '&fr=' + encodeURIComponent(fr.value) + '&ar=' + encodeURIComponent(ar.value)); dupBox.replaceChildren(); if (r.candidates.length) dupBox.append(el('div', 'banner warn', 'Ressemble à : ' + r.candidates.map(x => `${x.fr} (${Math.round(x.score * 100)} %)`).join(' ; '))); } catch { /* optional */ } }, 400); };
          fr.addEventListener('input', checkDup); ar.addEventListener('input', checkDup);
          form.append(App.field('Nom FR', fr), App.field('Nom AR', ar), dupBox, App.field('Description FR', desc), App.field('Description AR', descAr), App.field('Mots-clés', terms), App.field('Catégorie', category), App.field('Technologies (une par ligne)', tech), App.field('Ce qui est inclus', inc), App.field('Problèmes concernés', prob), App.field('Disponibilité', status), pl, App.field('Note', note));
          const ok = el('button', 'btn primary', canPublish ? 'Enregistrer en direct' : 'Enregistrer le brouillon'); ok.type = 'submit'; const act = el('div', 'full toolbar'); act.append(ok, App.btn('Annuler', () => editor.replaceChildren())); form.append(act);
          form.addEventListener('submit', App.guard(async ev => { ev.preventDefault();
            const vals = { fr: fr.value, ar: ar.value, desc: desc.value, desc_ar: descAr.value, terms: terms.value, category: category.value, technologies: split(tech), includes: split(inc), problems: split(prob) };
            if (canPublish) {
              const body = { ...vals, status: status.value, published: published.checked, note: note.value };
              try { await App.api('/api/admin/services/' + encodeURIComponent(s.slug), { method: 'PUT', data: body }); } catch (e) { if (e.code === 'duplicate' && confirm(e.message + '\n\nEnregistrer quand même ?')) await App.api('/api/admin/services/' + encodeURIComponent(s.slug), { method: 'PUT', data: { ...body, force_duplicate: true } }); else throw e; }
              App.toast('Fiche enregistrée (révision créée)'); reopen();
            } else {
              const patch = {}; for (const [k, v] of Object.entries(vals)) if (Array.isArray(v) ? !arrEq(v, s[k]) : v !== s[k]) patch[k] = v;
              if (!Object.keys(patch).length) return App.toast('Aucune différence avec la fiche actuelle', 'error');
              await App.api('/api/admin/catalogue/drafts', { method: 'POST', data: { slug: s.slug, patch, note: note.value } }); App.toast('Brouillon enregistré — soumettez-le pour validation'); sessionStorage.setItem('draft-filter', 'draft'); open('drafts');
            } }));
          card.append(form); editor.append(card); card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        async function history(s) {
          editor.replaceChildren(); const card = App.card('Historique : ' + s.fr, 'RÉVISIONS'), r = await App.api(`/api/admin/services/${encodeURIComponent(s.slug)}/revisions`), detail = el('div');
          card.append(r.revisions.length ? App.table(['Rév.', 'Date', 'Auteur', 'Origine', 'Champs', 'Note', ''], r.revisions.map(v => [v.rev, App.fmtDate(v.at), `${v.actor}${v.actor_role ? ' (' + v.actor_role + ')' : ''}`, v.source, v.changed.map(x => FIELD[x] || x).join(', ') || '—', v.note || '',
            (() => { const b = el('div', 'toolbar'); b.append(App.btn('Voir', App.guard(async () => { const d = (await App.api(`/api/admin/services/${encodeURIComponent(s.slug)}/revisions/${v.rev}`)).revision; detail.replaceChildren(el('h3', '', `Révision ${d.rev} — changements vs précédente`), d.diff_vs_previous.length ? diffTable(d.diff_vs_previous) : App.empty('Révision de référence (état initial).'), el('h3', '', 'Écart avec la fiche actuelle'), d.diff_vs_current.length ? diffTable(d.diff_vs_current) : App.empty('Identique à la fiche actuelle.')); }), 'small'));
              if (canEdit && v.rev < r.revisions[0].rev) b.append(App.btn('Restaurer en brouillon', App.guard(async () => { await App.api(`/api/admin/services/${encodeURIComponent(s.slug)}/revisions/${v.rev}/restore`, { method: 'POST', data: {} }); App.toast('Brouillon de restauration créé'); sessionStorage.setItem('draft-filter', 'draft'); open('drafts'); }), 'small')); return b; })()])) : App.empty('Aucune modification suivie depuis la mise en place de l’historique.'));
          card.append(detail); card.append(App.btn('Fermer', () => editor.replaceChildren())); editor.append(card); card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      },
      // ---------------------------------------------------------------- drafts & approvals
      async drafts(host) {
        const bar2 = el('div', 'toolbar'), st = App.select([['', 'Tous'], ['pending_review', 'À valider'], ['draft', 'Brouillons'], ['rejected', 'Rejetés'], ['published', 'Publiés'], ['withdrawn', 'Retirés']], sessionStorage.getItem('draft-filter') || 'pending_review');
        bar2.append(st); host.append(bar2); const list = el('div'); host.append(list);
        const load = async () => { sessionStorage.setItem('draft-filter', st.value); const r = await App.api('/api/admin/catalogue/drafts' + (st.value ? '?status=' + st.value : '')); list.replaceChildren(); if (!r.drafts.length) return list.append(App.empty('Aucun brouillon dans cet état.'));
          const mine = App.ctx.user.email;
          for (const d of r.drafts) {
            const c = App.card(`${d.service_fr}`, `#${d.id} · ${d.slug}`), head = el('div', 'toolbar'); head.append(App.chip(STATE[d.status][0], STATE[d.status][1]), el('span', 'muted small', `par ${d.author} (${d.author_role}) · ${App.fmtDate(d.updated_at)}`)); c.append(head);
            if (d.note) c.append(el('p', 'muted', 'Note : ' + d.note)); if (d.review_note) c.append(el('p', 'muted', `Relecture (${d.reviewer}) : ${d.review_note}`));
            c.append(diffTable(Object.keys(d.patch).map(k => ({ field: k, before: d.base[k], after: d.patch[k] }))));
            const act = el('div', 'toolbar'), reload = () => load();
            const call = (p, data, msg) => App.guard(async () => { await App.api(`/api/admin/catalogue/drafts/${d.id}/${p}`, { method: 'POST', data: data || {} }); App.toast(msg); reload(); });
            if (['draft', 'rejected'].includes(d.status) && (d.author === mine || canPublish)) act.append(App.btn('Soumettre pour validation', call('submit', {}, 'Soumis pour validation'), 'primary'));
            if (['draft', 'pending_review', 'rejected'].includes(d.status) && (d.author === mine || canPublish)) act.append(App.btn('Retirer', call('withdraw', {}, 'Brouillon retiré')));
            if (d.status === 'pending_review' && canPublish) {
              act.append(App.btn('Approuver et publier', App.guard(async () => { const note = prompt('Note d’approbation (facultatif) :') ?? ''; try { await App.api(`/api/admin/catalogue/drafts/${d.id}/approve`, { method: 'POST', data: { note } }); } catch (e) {
                if (e.code === 'conflict' && confirm(e.message + '\n\nÉcraser les changements récents avec ce brouillon ?')) await App.api(`/api/admin/catalogue/drafts/${d.id}/approve`, { method: 'POST', data: { note, force: true } });
                else if (e.code === 'duplicate' && confirm(e.message + '\n\nApprouver quand même ?')) await App.api(`/api/admin/catalogue/drafts/${d.id}/approve`, { method: 'POST', data: { note, force_duplicate: true } }); else throw e; } App.toast('Brouillon approuvé et publié'); reload(); }), 'primary'));
              act.append(App.btn('Rejeter', App.guard(async () => { const note = prompt('Motif du rejet (obligatoire) :'); if (!note) return; await App.api(`/api/admin/catalogue/drafts/${d.id}/reject`, { method: 'POST', data: { note } }); App.toast('Brouillon rejeté'); reload(); }), 'danger'));
            }
            c.append(act); list.append(c);
          } };
        st.addEventListener('change', load); await load();
      },
      // ---------------------------------------------------------------- duplicates
      async dups(host) {
        const r = await App.api('/api/admin/catalogue/duplicates?min=0.5'), c = App.card('Doublons et prestations très proches', 'PRÉVENTION'); c.append(el('p', 'muted', 'Comparaison des titres FR/AR normalisés (accents, casse, mots vides). Au-delà de 85 %, la création ou le renommage est refusé sauf décision explicite du propriétaire.'));
        c.append(r.pairs.length ? App.table(['Prestation A', 'Prestation B', 'Similarité'], r.pairs.map(p => [p.a.fr, p.b.fr, App.chip(Math.round(p.score * 100) + ' %', p.score >= 0.85 ? 'bad' : 'warn')])) : App.empty('Aucune paire suspecte.')); host.append(c);
      },
      // ---------------------------------------------------------------- taxonomy
      async taxo(host) {
        const t = await App.api('/api/admin/catalogue/taxonomy');
        const tc = App.card('Technologies', 'VOCABULAIRE'), incons = t.technologies.filter(x => x.inconsistent);
        tc.append(el('p', 'muted', `${t.technologies.length} technologies distinctes. ${incons.length} ont plusieurs graphies (casse, espaces, ponctuation) : unifiez-les pour de meilleures recherches.${canPublish ? '' : ' (Fusion réservée au propriétaire.)'}`));
        tc.append(incons.length ? App.table(['Graphies', 'Fiches', ''], incons.map(x => { const pick = App.select(x.variants.map(v => [v.name, v.name]), x.variants[0].name), b = App.btn('Unifier', App.guard(async () => { if (!confirm(`Remplacer toutes les graphies de « ${x.variants.map(v => v.name).join(' / ')} » par « ${pick.value} » ?`)) return; const r = await App.api('/api/admin/catalogue/taxonomy/merge', { method: 'POST', data: { from: x.variants.map(v => v.name), to: pick.value } }); App.toast(r.services_updated + ' fiche(s) mises à jour'); reopen(); }), 'small'); b.disabled = !canPublish; const w = el('div', 'toolbar'); w.append(pick, b); return [x.variants.map(v => `${v.name} (${v.count})`).join('  |  '), x.count, w]; })) : App.empty('Vocabulaire cohérent.'));
        host.append(tc);
        const top = App.card('Technologies les plus utilisées', 'TOP 20'); top.append(App.table(['Technologie', 'Fiches'], t.technologies.slice(0, 20).map(x => [x.variants[0].name, x.count]))); host.append(top);
        const cc = App.card('Catégories', 'CLASSEMENT'); cc.append(el('p', 'muted', 'Les catégories sont définies dans le référentiel du site ; une fiche peut changer de catégorie via l’édition (ou un brouillon).')); cc.append(App.table(['Catégorie', 'Prestations', 'Publiées', 'Disponibles'], t.categories.map(c => [c.name, c.total, c.published, c.available]))); host.append(cc);
      }
    };
    await open(sub && tabs.some(x => x[0] === sub) ? sub : (canHistory ? 'overview' : 'services'));
  }
  App.register({ id: 'services', label: 'Catalogue', icon: '🧩', group: 'content', perm: 'catalogue.read', render });
})();

(() => {
  'use strict';
  const App = window.AllosApp, { el } = App;

  // ---- Centre de contrôle (read-only aggregate, no PII) --------------------------------------
  async function control(root) {
    const [d, pub0] = await Promise.all([App.api('/api/admin/control-center'), fetch('/api/public/catalog').then(r => r.json()).catch(() => ({ categories: [] }))]);
    const catName = Object.fromEntries((pub0.categories || []).map(x => [x.id, x.fr]));
    const c = d.catalogue, k = d.knowledge, w = d.work, ai = d.intelligence, site = d.website, sec = d.security;
    const hero = el('section', 'control-hero'), left = el('div');
    left.append(el('p', 'eyebrow', 'ALLOSERVIX / COMMAND CENTER'), el('h2', '', 'Tout votre univers. Une seule console.'),
      el('p', '', 'Services, demandes, techniciens, intelligence, sécurité et configuration. Chiffres issus de votre base, jamais fictifs.'));
    const right = el('div'); right.append(App.btn('Actualiser', () => App.navigate('control')), el('p', 'small', 'Actualisé : ' + App.fmtDate(d.generated_at)));
    hero.append(left, right); root.append(hero);

    if (!sec.owner_migrated && App.ctx.user.kind === 'env') {
      const b = el('div', 'banner warn'); b.append(el('span', '', 'Identifiants initiaux Railway encore actifs : passez à des identifiants gérés ici.'));
      b.append(App.btn('Sécuriser mon compte', () => App.navigate('account'))); root.append(b);
    }
    const kp = el('div', 'kpis');
    kp.append(App.kpi('Prestations référencées', c.total, `${c.published} publiées · ${c.available} disponibles confirmées`),
      App.kpi('Demandes d’intervention', w.requests, `${w.unresolved} ouvertes`, w.unresolved ? 'warn' : ''),
      App.kpi('Équipe technique', w.technicians, `${w.active_technicians} actifs et vérifiés`),
      App.kpi('Connaissance approuvée', `${k.concept_approved} / ${k.concepts}`, `${k.link_approved} relations approuvées sur ${k.links}`));
    root.append(kp);

    const g = el('div', 'grid cols-2');
    const cat = App.card('Catalogue', 'CATALOGUE');
    cat.append(el('p', 'muted', `${c.in_study} en étude, ${c.hidden} fiches masquées. Le catalogue ne garantit pas la disponibilité.`));
    cat.append(App.rows(c.categories.map(x => [catName[x.category] || x.category, `${x.total} prestations · ${x.available} disponibles`])));
    const ops = App.card('Opérations', 'DEMANDES & DISPATCH');
    ops.append(App.rows([['Dossiers à traiter', String(w.unresolved)], ['Techniciens vérifiés et actifs', String(w.active_technicians)], ['Formulaires de contact', String(w.inquiries)]]));
    const intel = App.card('Intelligence', 'ASSISTANT & MODÈLES');
    intel.append(App.rows([['Classification externe', ai.features.text ? 'Activée' : 'Désactivée', ai.features.text ? 'warn' : 'ok'],
      ['Images', ai.features.image ? 'Actives' : 'Inactives', 'neutral'], ['Audio', ai.features.audio ? 'Actif' : 'Inactif', 'neutral'],
      ['Clés fournisseurs présentes', `${ai.configured_providers.filter(p => p.key_configured).length} / ${ai.configured_providers.length}`]]));
    const pub = App.card('Publication & sécurité', 'SITE, CONTACT & ACCÈS');
    pub.append(App.rows([['Email professionnel', site.public_contact_email_set ? 'Renseigné' : 'À renseigner', site.public_contact_email_set ? 'ok' : 'warn'],
      ['WhatsApp', site.public_whatsapp_set ? 'Renseigné' : 'À renseigner', site.public_whatsapp_set ? 'ok' : 'warn'],
      ['Statistiques visiteurs', site.analytics_enabled ? 'Activées (avec consentement)' : 'Non activées', 'neutral'],
      ['Demandes clients', site.requests_enabled ? 'Activées' : 'Non activées', 'neutral'],
      ['Plusieurs comptes avec rôles', sec.multiple_admin_accounts ? 'En place' : 'Un seul compte', sec.multiple_admin_accounts ? 'ok' : 'warn'],
      ['Certificats de domaine', 'Contrôle externe requis', 'warn']]));
    g.append(cat, ops, intel, pub); root.append(g);

    const mods = App.card('Accès rapides', 'VOS ESPACES ALLOSERVIX'), grid = el('div', 'module-grid');
    for (const [label, sub, id, href] of [['Catalogue & contenus', 'Modifier, publier', 'services'], ['Knowledge Studio', 'Concepts et relations', '', '/brain-studio/index.html'],
      ['Techniciens & demandes', 'Dispatch validé', '', '/ops-v10/index.html'], ['Contacts reçus', 'Formulaires', 'inquiries'], ['Analyse des visiteurs', 'Statistiques consenties', 'stats'],
      ['Configuration du site', 'Contact et identité', 'settings'], ['Journal d’audit', 'Qui a fait quoi', 'audit'], ['Parcours client', 'Aperçu du portail', '', '/request-v10/index.html']]) {
      const n = href ? el('a', 'module') : el('button', 'module'); if (href) n.href = href; else { n.type = 'button'; n.addEventListener('click', () => App.navigate(id)); }
      n.append(el('strong', '', label), el('small', '', sub)); if (!href && !App.views.some(v => v.id === id && (!v.perm || App.can(v.perm)))) continue; grid.append(n);
    }
    mods.append(grid); root.append(mods);
  }

  // ---- Sécurité & lancement ------------------------------------------------------------------
  async function security(root) {
    const d = await App.api('/api/admin/control-center'), sec = d.security, site = d.website;
    const c = App.card('Protection des données et préparation du site', 'GOUVERNANCE & LANCEMENT');
    c.append(App.rows([
      ['Accès administrateur + authentification à deux facteurs', sec.admin_configured && sec.mfa_required ? 'Configurés' : 'À configurer', sec.admin_configured ? 'ok' : 'bad'],
      ['Comptes multiples avec rôles (RBAC)', sec.rbac_enabled ? 'Disponible' : 'Non disponible', sec.rbac_enabled ? 'ok' : 'bad'],
      ['Plusieurs comptes actifs', sec.multiple_admin_accounts ? 'Oui' : 'Non', sec.multiple_admin_accounts ? 'ok' : 'warn'],
      ['Identifiants initiaux Railway', sec.owner_migrated ? 'Désactivés (migrés)' : 'Encore actifs', sec.owner_migrated ? 'ok' : 'warn'],
      ['Chiffrement des secrets MFA et demandes', sec.staff_vault_ready && sec.encrypted_requests_ready ? 'Clé présente' : 'À configurer', sec.staff_vault_ready ? 'ok' : 'bad'],
      ['Collecte des contacts', site.inquiries_enabled ? 'Activée' : 'Non activée', 'neutral'],
      ['Demandes d’intervention', site.requests_enabled ? 'Activées' : 'Non activées', 'neutral'],
      ['Certificats de domaine et routage', 'Contrôle externe requis (Railway / Cloudflare)', 'warn'],
      ['Sauvegardes et restaurations', 'Contrôle externe requis', 'warn']]));
    c.append(el('p', 'muted', 'L’état des certificats HTTPS, du DNS, des sauvegardes et des déploiements se vérifie sur Railway/Cloudflare. La présence d’un lien n’est pas une preuve de réussite.'));
    const links = el('div', 'toolbar');
    for (const [t, h] of [['Ouvrir Railway', 'https://railway.com/project/649dcba3-91d2-43d8-916c-e6d10278f51f'], ['Ouvrir Cloudflare', 'https://dash.cloudflare.com/']]) { const a = el('a', 'btn', t); a.href = h; a.target = '_blank'; a.rel = 'noopener noreferrer'; links.append(a); }
    c.append(links); root.append(c);
  }

  // ---- Statistiques consenties ---------------------------------------------------------------
  async function stats(root) {
    const o = await App.api('/api/admin/overview'), a = o.analytics;
    const kp = el('div', 'kpis'); kp.append(App.kpi('Visiteurs ayant consenti (30 j)', a.visitors), App.kpi('Événements enregistrés', a.events),
      App.kpi('Services publiés', `${o.published_services} / ${o.total_services}`), App.kpi('Demandes reçues', o.inquiries)); root.append(kp);
    if (!o.features.analytics) root.append(el('div', 'banner', 'Les statistiques visiteurs sont désactivées (ENABLE_ANALYTICS). Aucune donnée n’est collectée.'));
    const g = el('div', 'grid cols-2');
    const block = (title, rows, k) => { const c = App.card(title); c.append(rows.length ? App.rows(rows.map(r => [String(r[k] || '—'), String(r.n)])) : App.empty('Aucune donnée pour le moment.')); return c; };
    g.append(block('Pages les plus consultées', a.pages, 'route'), block('Recherches populaires', a.searches, 'target'), block('Dernière section vue', a.exits, 'section'),
      block('Campagnes QR & sources', a.campaigns, 'campaign'), block('Volume par type d’interaction', a.kinds, 'kind'));
    root.append(g);
  }

  // ---- Intelligence IA (configuration only; detailed brain monitoring lands in its own view) ---
  async function intelligence(root) {
    const [ai, d] = await Promise.all([App.api('/api/admin/ai/status'), App.api('/api/admin/control-center').catch(() => null)]);
    const kp = el('div', 'kpis'); kp.append(App.kpi('Appels IA aujourd’hui', ai.usage.used, 'Limite quotidienne : ' + ai.usage.daily_limit),
      App.kpi('Classification de texte', ai.features.text_intent ? 'Actif' : 'Inactif'), App.kpi('Compréhension d’images', ai.features.image_intent ? 'Actif' : 'Inactif'), App.kpi('Transcription audio', ai.features.audio_transcription ? 'Actif' : 'Inactif'));
    root.append(kp);
    const c = App.card('Fournisseurs d’IA', 'ALLOSERVIX INTELLIGENCE');
    c.append(el('p', 'muted', 'Chaque modèle est seulement un outil d’interprétation. Aucun modèle ne peut approuver une prestation, envoyer un devis ou affecter un technicien. Clés, budgets et contrats se configurent dans Railway ; aucune clé n’est affichée ici.'));
    c.append(App.rows(ai.providers.map(p => [p.name, p.key_configured ? 'Clé présente' : 'Clé absente', p.key_configured ? 'ok' : 'neutral'])));
    root.append(c); void d;
  }

  // ---- Prestations ---------------------------------------------------------------------------
  async function services(root) {
    const data = await App.api('/api/admin/services'), canPublish = App.can('catalogue.publish'), canEdit = App.can('catalogue.edit');
    const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const c = App.card('Catalogue des prestations', 'CONTENU');
    c.append(el('p', 'muted', 'Les fiches sont visibles après publication. Une prestation n’est jamais automatiquement marquée « Disponible ». ' + (canPublish ? '' : 'Seul un propriétaire peut publier ou changer la disponibilité.')));
    const search = App.input({ type: 'search', placeholder: 'Nom ou catégorie…' }); c.append(App.field('Rechercher', search));
    const list = el('div', 'service-list'); c.append(list); root.append(c);
    const editor = el('div'); root.append(editor);
    const paint = () => {
      list.replaceChildren(); const t = norm(search.value);
      for (const s of data.services.filter(x => norm(x.fr + ' ' + x.ar + ' ' + x.category).includes(t))) {
        const line = el('div', 'line'), label = el('span'); label.append(el('strong', '', s.fr), document.createTextNode(' — ' + s.category + ' '),
          App.chip(s.status, s.status === 'Disponible' ? 'ok' : s.status === 'Indisponible' ? 'bad' : 'neutral'));
        if (!s.published) label.append(document.createTextNode(' '), App.chip('Masqué', 'warn'));
        line.append(label); if (canEdit) line.append(App.btn('Modifier', () => open(s), 'small')); list.append(line);
      }
    };
    search.addEventListener('input', paint); paint();
    function open(s) {
      editor.replaceChildren();
      const card = App.card('Modifier : ' + s.fr, 'ÉDITION'), f = el('form', 'form-grid');
      const lines = v => v.join('\n'), T = (v, rows = 3, rtl) => { const t = el('textarea'); t.rows = rows; t.value = v; if (rtl) t.dir = 'rtl'; return t; };
      const fr = App.input({ value: s.fr, required: '', maxlength: '200' }), ar = App.input({ value: s.ar, required: '', maxlength: '200', dir: 'rtl' });
      const desc = T(s.desc), descAr = T(s.desc_ar, 3, true), terms = T(s.terms), tech = T(lines(s.technologies), 4), inc = T(lines(s.includes), 4), prob = T(lines(s.problems), 4);
      const status = App.select(['Sur étude', 'Disponible', 'En préparation', 'Indisponible'].map(x => [x, x]), s.status); status.disabled = !canPublish;
      const pub = App.input({ type: 'checkbox' }); pub.checked = s.published; pub.disabled = !canPublish;
      const pubLabel = el('label', 'check'); pubLabel.append(pub, document.createTextNode(' Publier la fiche' + (canPublish ? '' : ' (réservé au propriétaire)')));
      f.append(App.field('Nom FR', fr), App.field('Nom AR', ar), App.field('Description FR', desc), App.field('Description AR', descAr), App.field('Mots-clés', terms),
        App.field('Technologies (une par ligne)', tech), App.field('Ce qui est inclus', inc), App.field('Problèmes concernés', prob), App.field('Disponibilité', status), pubLabel);
      const ok = el('button', 'btn primary', 'Enregistrer'); ok.type = 'submit'; const act = el('div', 'full toolbar'); act.append(ok, App.btn('Annuler', () => editor.replaceChildren())); f.append(act);
      f.addEventListener('submit', App.guard(async ev => {
        ev.preventDefault(); const split = t => t.value.split('\n').map(x => x.trim()).filter(Boolean);
        const body = { fr: fr.value, ar: ar.value, desc: desc.value, desc_ar: descAr.value, terms: terms.value, technologies: split(tech), includes: split(inc), problems: split(prob) };
        if (canPublish) { body.status = status.value; body.published = pub.checked; }
        await App.api('/api/admin/services/' + encodeURIComponent(s.slug), { method: 'PUT', data: body }); App.toast('Service enregistré'); App.navigate('services');
      }));
      card.append(f); editor.append(card); card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  // ---- Paramètres ----------------------------------------------------------------------------
  async function settings(root) {
    const o = await App.api('/api/admin/overview'), s = o.settings;
    const c = App.card('Informations publiques du site', 'PARAMÈTRES');
    c.append(el('p', 'muted', 'Aucun numéro, email ou identité professionnelle n’est publié tant qu’ils ne sont pas confirmés. La modification exige une re-vérification de votre identité.'));
    const f = el('form', 'form-grid'), fields = {};
    for (const [k, label, attrs] of [['site_title', 'Nom du site', { maxlength: '180' }], ['site_subtitle', 'Sous-titre', { maxlength: '180' }], ['contact_whatsapp', 'WhatsApp (indicatif + numéro, sans espaces)', { maxlength: '20' }],
      ['contact_email', 'Email professionnel', { type: 'email', maxlength: '150' }], ['contact_location', 'Ville / zone d’intervention', { maxlength: '180' }]]) {
      const i = App.input(attrs); i.value = s[k] || ''; fields[k] = i; f.append(App.field(label, i));
    }
    const b = el('button', 'btn primary', 'Enregistrer'); b.type = 'submit'; const act = el('div', 'full'); act.append(b); f.append(act);
    f.addEventListener('submit', App.guard(async ev => { ev.preventDefault(); await App.api('/api/admin/settings', { method: 'PUT', data: Object.fromEntries(Object.entries(fields).map(([k, i]) => [k, i.value])) }); App.toast('Paramètres enregistrés'); }));
    c.append(f); root.append(c);
  }

  // ---- Contacts reçus ------------------------------------------------------------------------
  async function inquiries(root) {
    const r = await App.api('/api/admin/inquiries'), c = App.card('Demandes clients', 'CONTACTS REÇUS');
    c.append(el('p', 'muted', 'La réception de demandes personnelles est désactivée par défaut jusqu’à publication de la politique de confidentialité et activation de ENABLE_INQUIRIES. Ces données sont personnelles.'));
    c.append(r.inquiries.length ? App.table(['Date', 'Nom', 'Sujet', 'Message', 'Email', 'Téléphone'], r.inquiries.map(q => [App.fmtDate(q.at), q.name, q.topic, q.message, q.email, q.phone])) : App.empty('Aucune demande enregistrée.'));
    root.append(c);
  }

  // ---- Journal d'audit -----------------------------------------------------------------------
  async function audit(root) {
    const bar = el('div', 'toolbar'), action = App.input({ placeholder: 'Filtrer par action (ex. login)' }), actor = App.input({ placeholder: 'Filtrer par acteur (email)' });
    const go = App.btn('Filtrer', () => load(), 'primary'); bar.append(action, actor, go);
    const integrity = el('div'), host = el('div'); root.append(integrity, bar, host);
    async function load() {
      const q = new URLSearchParams({ limit: '150' }); if (action.value.trim()) q.set('action', action.value.trim()); if (actor.value.trim()) q.set('actor', actor.value.trim());
      const r = await App.api('/api/admin/audit?' + q);
      integrity.replaceChildren(el('div', 'banner ' + (r.integrity.ok ? '' : 'bad'), r.integrity.ok
        ? `Intégrité de la chaîne d’audit vérifiée : ${r.integrity.checked} entrées chaînées${r.integrity.legacy_unchained ? ` (+ ${r.integrity.legacy_unchained} anciennes entrées non chaînées)` : ''}.`
        : `ALERTE : la chaîne d’audit est rompue à l’entrée n°${r.integrity.first_bad_id}. Des lignes ont pu être modifiées ou supprimées.`));
      host.replaceChildren(r.audit.length ? App.table(['Date', 'Acteur', 'Rôle', 'Action', 'Ressource', 'Détails'], r.audit.map(a => [App.fmtDate(a.at), a.actor, a.actor_role || '—', a.action, a.resource, a.details])) : App.empty('Aucune entrée.'));
    }
    await load();
  }

  // ---- Demandes (aperçu, périmètre selon le rôle : un technicien ne voit que ses affectations) ----
  async function requests(root) {
    const r = await App.api('/api/admin/ops/requests'), mine = App.ctx.user.role === 'technician';
    const c = App.card(mine ? 'Mes interventions' : 'Demandes récentes', mine ? 'AFFECTATIONS' : 'DEMANDES CLIENTS', (() => { const a = el('a', 'btn primary', 'Ouvrir le centre de dispatch'); a.href = '/ops-v10/index.html'; return a; })());
    c.append(el('p', 'muted', mine ? 'Vous ne voyez que les demandes qui vous sont affectées. Les coordonnées du client ne sont visibles que pour une intervention affectée ou en cours.' : 'Une demande n’est pas automatiquement une réservation. Les coordonnées clients sont chiffrées et visibles dans le dossier.'));
    const tone = { new: 'info', review: 'warn', approved: 'info', assigned: 'info', in_progress: 'warn', completed: 'ok', cancelled: 'neutral', quoted: 'info' };
    c.append(r.requests.length ? App.table(['Code', 'Titre', 'Ville', 'Statut', 'Créée'], r.requests.map(x => [x.tracking_code, x.title, x.city, App.chip(x.status, tone[x.status] || 'neutral'), App.fmtDate(x.created_at)])) : App.empty(mine ? 'Aucune intervention affectée.' : 'Aucune demande enregistrée.'));
    root.append(c);
  }

  const V = (id, label, icon, group, perm, render) => App.register({ id, label, icon, group, perm, render });
  V('control', 'Centre de contrôle', '◈', 'pilotage', 'dashboard.view', control);
  V('stats', 'Statistiques', '📈', 'pilotage', 'analytics.read', stats);
  V('security', 'Sécurité & lancement', '🛡', 'pilotage', 'dashboard.view', security);
  V('services', 'Prestations', '🧩', 'content', 'catalogue.read', services);
  V('intelligence', 'Intelligence IA', '🧠', 'content', 'ai.monitor', intelligence);
  App.register({ id: 'brain', label: 'Knowledge Studio', icon: '📚', group: 'content', perm: 'knowledge.read', external: '/brain-studio/index.html' });
  V('requests', 'Demandes', '📥', 'ops', 'requests.view', requests);
  App.register({ id: 'ops', label: 'Demandes & techniciens', icon: '🛠', group: 'ops', perm: 'requests.view', external: '/ops-v10/index.html' });
  V('inquiries', 'Contacts reçus', '✉', 'ops', 'inquiries.read', inquiries);
  App.register({ id: 'portal', label: 'Portail client (aperçu)', icon: '🌐', group: 'ops', perm: 'requests.manage', external: '/request-v10/index.html' });
  V('settings', 'Paramètres du site', '⚙', 'gov', 'settings.write', settings);
  V('audit', 'Journal d’audit', '🧾', 'gov', 'audit.read', audit);
})();

(() => {
  'use strict';
  const App = window.AllosApp, { el } = App;
  const bytes = n => n === null || n === undefined ? '—' : n > 1e9 ? (n / 1e9).toFixed(2) + ' Go' : n > 1e6 ? (n / 1e6).toFixed(1) + ' Mo' : (n / 1e3).toFixed(0) + ' Ko';
  const dur = s => s >= 86400 ? Math.floor(s / 86400) + ' j ' + Math.floor(s % 86400 / 3600) + ' h' : s >= 3600 ? Math.floor(s / 3600) + ' h ' + Math.floor(s % 3600 / 60) + ' min' : Math.floor(s / 60) + ' min';
  const SEV = { critical: ['Critique', 'bad'], warning: ['À traiter', 'warn'], info: ['Info', 'info'] };
  const VERDICT = { ok: ['Opérationnel', 'ok'], expiring: ['Expire bientôt', 'warn'], certificate_invalid: ['Certificat invalide', 'bad'], routing_missing: ['Routage absent', 'bad'], unreachable: ['Injoignable', 'bad'], tls_error: ['Erreur TLS', 'bad'], http_error: ['HTTP en échec', 'bad'], unexpected_response: ['Réponse inattendue', 'warn'] };

  async function render(root) {
    const d = await App.api('/api/admin/system/status'), rt = d.runtime, st = d.storage, mt = d.metrics, canBackup = App.can('system.backup');
    const crit = d.checklist.filter(i => i.severity === 'critical');
    if (crit.length) root.append(el('div', 'banner bad', `${crit.length} point(s) critique(s) : ` + crit.map(i => i.title).join(' · ')));

    const kp = el('div', 'kpis'), diskPct = st.disk_total_bytes ? Math.round(100 * st.disk_free_bytes / st.disk_total_bytes) : null;
    kp.append(App.kpi('Disponibilité (depuis le démarrage)', dur(rt.uptime_seconds), 'Démarré : ' + App.fmtDate(rt.started_at)),
      App.kpi('Base de données', bytes(st.database_bytes), `Intégrité : ${st.integrity}${st.wal_bytes ? ' · WAL ' + bytes(st.wal_bytes) : ''}`, st.integrity === 'ok' ? 'ok' : 'bad'),
      App.kpi('Espace disque libre', bytes(st.disk_free_bytes), diskPct === null ? 'Non mesurable' : diskPct + ' % libre', diskPct !== null && diskPct < 10 ? 'bad' : ''),
      App.kpi('Erreurs serveur (24 h)', d.errors_last_24h, d.errors_last_hour + ' sur la dernière heure', d.errors_last_hour >= 5 ? 'bad' : d.errors_last_24h ? 'warn' : 'ok'),
      App.kpi('Requêtes (24 h)', mt.totals.requests, `p95 ${mt.latency_ms.p95} ms · ${mt.totals.s5xx} en 5xx`),
      App.kpi('Sessions admin actives', rt.active_sessions, 'En mémoire'));
    root.append(kp);

    // ---- checklist
    const cl = App.card('Points à traiter', 'MISE EN PRODUCTION', App.btn('Actualiser', () => App.navigate('system')));
    cl.append(el('p', 'muted', 'Liste calculée à partir de l’état réel de l’application. Ce qui dépend de Railway / Cloudflare n’est jamais présenté comme réussi sans contrôle.'));
    const rows = d.checklist.map(i => { const act = el('div', 'toolbar'); if (i.link && App.views.some(v => v.id === i.link && (!v.perm || App.can(v.perm)))) act.append(App.btn('Ouvrir', () => App.navigate(i.link), 'small'));
      const t = el('div'); t.append(el('strong', '', i.title), el('br'), el('small', 'muted', i.detail)); return [App.chip(SEV[i.severity][0], SEV[i.severity][1]), i.area, t, act]; });
    cl.append(App.table(['Niveau', 'Domaine', 'Constat', ''], rows)); root.append(cl);

    // ---- domain check
    const dom = App.card('Contrôle du domaine (DNS · HTTPS · routage)', 'CE QUE VOIT L’EXTÉRIEUR');
    dom.append(el('p', 'muted', 'Interroge ' + (d.domains_configured.join(', ') || '—') + ' depuis le serveur : enregistrements DNS, certificat présenté (avec vérification stricte, aucune erreur n’est ignorée), puis /health. Aucune requête HTTP n’est envoyée sur un canal TLS invalide.'));
    const out = el('div'), go = App.btn('Lancer le contrôle', App.guard(async () => {
      go.disabled = true; go.textContent = 'Contrôle en cours…'; out.replaceChildren(App.empty('Interrogation DNS et TLS…'));
      try {
        const r = await App.api('/api/admin/system/domain-check', { method: 'POST', data: {} }); out.replaceChildren(el('p', 'muted small', 'Contrôle du ' + App.fmtDate(r.checked_at) + ' — ' + r.vantage));
        for (const x of r.domains) {
          const v = VERDICT[x.verdict] || [x.verdict, 'neutral'], c = el('div', 'invite-box');
          const head = el('div', 'toolbar'); head.append(el('strong', '', x.host + (x.port !== 443 ? ':' + x.port : '')), App.chip(v[0], v[1])); c.append(head, el('p', '', x.hint));
          const items = [['DNS A', (x.dns.a || []).join(', ') || '—'], ['DNS CNAME', (x.dns.cname || []).join(', ') || '— (aplati ou absent)'], ['CAA', (x.dns.caa || []).join(', ') || 'aucune restriction'],
            ['Certificat valide', x.tls.valid ? 'Oui' : 'Non (' + (x.tls.error || '') + ')', x.tls.valid ? 'ok' : 'bad']];
          const cert = x.tls.valid ? x.tls : x.tls.presented; if (cert) { items.push([x.tls.valid ? 'Certificat pour' : 'Certificat PRÉSENTÉ (diagnostic)', [cert.subject, ...cert.san].filter(Boolean).join(', ') || '—'], ['Émetteur', cert.issuer || '—'], ['Expire', cert.valid_to ? `${cert.valid_to} (${cert.days_left} j)` : '—']); }
          if (x.http) items.push(['/health', x.http.error ? 'Erreur ' + x.http.error : `HTTP ${x.http.status} · ${x.http.ms} ms${x.http.railway_fallback ? ' · fallback Railway' : ''}${x.http.via_cloudflare ? ' · via Cloudflare' : ''}`, x.http.status === 200 && !x.http.railway_fallback ? 'ok' : 'bad']);
          c.append(App.rows(items)); out.append(c);
        }
      } finally { go.disabled = false; go.textContent = 'Relancer le contrôle'; }
    }), 'primary');
    dom.append(go, out); root.append(dom);

    // ---- traffic
    const tr = App.card('Trafic et fiabilité (24 h)', 'REQUÊTES'), hours = mt.hours.slice(-12), peak = Math.max(1, ...hours.map(h => h.total));
    tr.append(el('p', 'muted small', mt.note));
    tr.append(hours.length ? App.table(['Heure (UTC)', 'Requêtes', '', '4xx', '5xx'], hours.map(h => { const bar = el('div', 'bar'); const f = el('i'); f.style.width = Math.max(2, Math.round(100 * h.total / peak)) + '%'; if (h.s5) f.classList.add('bad'); bar.append(f); return [h.hour.slice(5, 16).replace('T', ' ') + ' h', h.total, bar, h.s4 || 0, h.s5 || 0]; })) : App.empty('Aucune requête enregistrée depuis le démarrage.'));
    root.append(tr);

    // ---- errors
    const er = App.card('Erreurs serveur récentes', 'FIABILITÉ');
    er.append(el('p', 'muted small', 'Messages expurgés (emails, téléphones, identifiants et secrets masqués). Conservées sur disque, 500 maximum.'));
    er.append(d.errors.length ? App.table(['Date', 'Méthode', 'Route', 'Code', 'Message'], d.errors.map(e => [App.fmtDate(e.at), e.method, e.route, e.status, e.message])) : App.empty('Aucune erreur enregistrée.'));
    root.append(er);

    // ---- backups
    const bk = App.card('Instantanés vérifiés de la base', 'DONNÉES', canBackup ? App.btn('Créer un instantané', App.guard(async () => { const r = await App.api('/api/admin/system/backups', { method: 'POST', data: {} }); App.toast(r.backup.integrity === 'ok' ? 'Instantané créé et vérifié' : 'Instantané en échec : ' + r.backup.integrity, r.backup.integrity === 'ok' ? 'ok' : 'error'); App.navigate('system'); }), 'primary') : null);
    bk.append(el('p', 'muted', 'Copie cohérente (VACUUM INTO) contrôlée par PRAGMA integrity_check et comparaison des comptages, stockée sur le même volume (accès propriétaire seul, 5 conservées). Aucun téléchargement n’est proposé. Elle protège d’une erreur logique, pas de la perte du volume : activez aussi les sauvegardes Railway. La restauration reste une opération manuelle.'));
    bk.append(d.backups.length ? App.table(['Date', 'Fichier', 'Taille', 'Contrôle', 'Présent', 'Par'], d.backups.map(b => [App.fmtDate(b.at), b.file, bytes(b.bytes), App.chip(b.integrity === 'ok' ? 'Vérifié' : b.integrity, b.integrity === 'ok' ? 'ok' : 'bad'), b.present ? 'Oui' : 'Supprimé (rotation)', b.actor])) : App.empty('Aucun instantané.'));
    root.append(bk);

    // ---- config presence + tables
    const g = el('div', 'grid cols-2'), ev = App.card('Configuration (présence uniquement)', 'VARIABLES');
    ev.append(el('p', 'muted small', d.environment.note));
    ev.append(App.rows(Object.entries(d.environment.variables).map(([k, v]) => [k, v ? 'Définie' : 'Absente', v ? 'ok' : 'neutral'])));
    const tb = App.card('Contenu de la base', 'TABLES');
    tb.append(App.rows(Object.entries(st.tables).map(([k, v]) => [k, v === null ? '—' : String(v)])));
    g.append(ev, tb); root.append(g);
  }
  App.register({ id: 'system', label: 'État du système', icon: '📡', group: 'pilotage', perm: 'system.status', render });
})();

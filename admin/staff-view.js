(() => {
  'use strict';
  const App = window.AllosApp, { el } = App;
  const ROLE_LABEL = { owner: 'Propriétaire', manager: 'Gestionnaire', technician: 'Technicien' };
  const STATUS = { active: ['Actif', 'ok'], invited: ['Invité', 'info'], pending_mfa: ['MFA à finaliser', 'warn'], disabled: ['Désactivé', 'bad'] };

  let pending = null; // invitation survives the re-render that refreshes the table
  function showInvite(host, account, invite) {
    host.replaceChildren();
    const url = location.origin + invite.link;
    const box = el('div', 'invite-box');
    box.append(el('strong', '', 'Invitation pour ' + account.email));
    box.append(el('p', 'muted small', 'Lien à usage unique, valable jusqu’au ' + App.fmtDate(invite.expires_at) + '. Il n’est affiché qu’une fois : transmettez-le par un canal sûr (en main propre, messagerie chiffrée). Aucun email n’est envoyé automatiquement.'));
    box.append(el('code', '', url));
    const row = el('div', 'toolbar'); row.append(App.btn('Copier le lien', () => App.copy(url, 'Lien copié')), App.btn('Masquer', () => host.replaceChildren())); box.append(row);
    host.append(box);
  }

  async function render(root) {
    const canManage = App.can('staff.manage');
    const data = await App.api('/api/admin/staff');
    const roles = await App.api('/api/admin/rbac');
    const inviteHost = el('div');
    if (pending) { showInvite(inviteHost, pending.account, pending.invite); pending = null; }

    if (!data.vault_ready) root.append(el('div', 'banner bad', 'Clé de chiffrement ALLO_DATA_KEY absente : la création de comptes est désactivée (les secrets MFA ne peuvent pas être protégés).'));
    if (data.env_owner.active && canManage) {
      const b = el('div', 'banner warn'); b.append(el('span', '', 'Le propriétaire utilise encore les identifiants initiaux de Railway.'));
      b.append(App.btn('Passer à un compte intégré', () => App.navigate('account'))); root.append(b);
    }

    const kp = el('div', 'kpis'), a = data.accounts;
    kp.append(App.kpi('Comptes actifs', a.filter(x => x.status === 'active').length + (data.env_owner.active ? 1 : 0)),
      App.kpi('Invitations en attente', a.filter(x => ['invited', 'pending_mfa'].includes(x.status)).length),
      App.kpi('Désactivés / verrouillés', a.filter(x => x.status === 'disabled' || x.locked).length),
      App.kpi('Propriétaires', a.filter(x => x.role === 'owner' && x.status === 'active').length + (data.env_owner.active ? 1 : 0)));
    root.append(kp, inviteHost);

    // --- accounts table
    const list = App.card('Équipe & accès', 'COMPTES');
    const reload = () => App.navigate('staff');
    const rows = [];
    if (data.env_owner.configured) rows.push([el('strong', '', 'Propriétaire (Railway)'), ROLE_LABEL.owner, App.chip(data.env_owner.active ? 'Actif' : 'Remplacé', data.env_owner.active ? 'warn' : 'neutral'), '—', 'Identifiants initiaux', '']);
    for (const acc of a) {
      const st = STATUS[acc.status] || [acc.status, 'neutral'], actions = el('div', 'toolbar');
      if (canManage) {
        const edit = App.btn('Modifier', () => openEditor(acc), 'small');
        const reset = App.btn('Réinitialiser', App.guard(async () => {
          if (!confirm(`Réinitialiser ${acc.email} ? Son mot de passe et son MFA seront invalidés, ses sessions fermées et une nouvelle invitation créée.`)) return;
          const r = await App.api(`/api/admin/staff/${acc.id}/invite`, { method: 'POST', data: {} }); pending = r; App.toast('Compte réinitialisé'); reload();
        }), 'small');
        const kill = App.btn('Fermer les sessions', App.guard(async () => { const r = await App.api(`/api/admin/staff/${acc.id}/revoke-sessions`, { method: 'POST', data: {} }); App.toast(`${r.revoked} session(s) fermée(s)`); }), 'small');
        actions.append(edit, reset, kill);
      }
      const name = el('div'); name.append(el('strong', '', acc.display_name), el('br'), el('small', 'muted', acc.email));
      rows.push([name, ROLE_LABEL[acc.role] || acc.role, App.chip(acc.locked ? 'Verrouillé' : st[0], acc.locked ? 'bad' : st[1]), acc.mfa_enrolled ? App.chip('MFA ✓', 'ok') : App.chip('MFA ✗', 'warn'), App.fmtDate(acc.last_login_at), actions]);
    }
    const tableHost = el('div'); list.append(tableHost);
    tableHost.append(rows.length ? App.table(['Compte', 'Rôle', 'Statut', 'MFA', 'Dernière connexion', 'Actions'], rows) : App.empty('Aucun compte.'));
    root.append(list);

    // --- editor (role/status/name) with optimistic concurrency
    const editorHost = el('div'); root.append(editorHost);
    function openEditor(acc) {
      editorHost.replaceChildren();
      const c = App.card('Modifier ' + acc.email, 'ÉDITION'), f = el('form', 'form-grid');
      const name = App.input({ value: acc.display_name, maxlength: '100', required: '' });
      const role = App.select(Object.keys(roles.roles).map(r => [r, roles.roles[r].label]), acc.role);
      const status = App.select([['active', 'Actif'], ['disabled', 'Désactivé']], acc.status === 'disabled' ? 'disabled' : 'active');
      status.disabled = !['active', 'disabled'].includes(acc.status);
      const tech = App.input({ value: acc.technician_id || '', placeholder: 'Identifiant de la fiche technicien', maxlength: '64' });
      f.append(App.field('Nom affiché', name), App.field('Rôle', role), App.field('Statut', status), App.field('Fiche technicien (rôle Technicien)', tech));
      const matrix = el('div', 'full muted small'); const upd = () => { matrix.textContent = 'Permissions du rôle : ' + roles.roles[role.value].permissions.join(', '); }; role.addEventListener('change', upd); upd(); f.append(matrix);
      const save = el('button', 'btn primary', 'Enregistrer'); save.type = 'submit';
      const cancel = App.btn('Annuler', () => editorHost.replaceChildren());
      const act = el('div', 'full toolbar'); act.append(save, cancel); f.append(act);
      f.addEventListener('submit', App.guard(async ev => {
        ev.preventDefault();
        const patch = { display_name: name.value, role: role.value, technician_id: tech.value, version: acc.version };
        if (!status.disabled) patch.status = status.value;
        await App.api('/api/admin/staff/' + acc.id, { method: 'PUT', data: patch }); App.toast('Compte mis à jour'); reload();
      }));
      c.append(f); editorHost.append(c); c.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // --- creation
    if (canManage) {
      const c = App.card('Inviter un membre', 'NOUVEAU COMPTE'), f = el('form', 'form-grid');
      const email = App.input({ type: 'email', required: '', maxlength: '160', placeholder: 'prenom@societe.ma' });
      const name = App.input({ required: '', maxlength: '100', placeholder: 'Prénom Nom' });
      const role = App.select(Object.keys(roles.roles).map(r => [r, roles.roles[r].label]), 'manager');
      const tech = App.input({ maxlength: '64', placeholder: 'ID fiche technicien (si rôle Technicien)' });
      f.append(App.field('Email', email), App.field('Nom affiché', name), App.field('Rôle', role), App.field('Fiche technicien', tech, 'Un technicien ne voit que les interventions qui lui sont affectées.'));
      const info = el('div', 'full muted small'); const upd = () => { info.textContent = 'Permissions : ' + roles.roles[role.value].permissions.join(', '); }; role.addEventListener('change', upd); upd(); f.append(info);
      const b = el('button', 'btn primary', 'Créer l’invitation'); b.type = 'submit'; const act = el('div', 'full'); act.append(b); f.append(act);
      f.addEventListener('submit', App.guard(async ev => {
        ev.preventDefault();
        const r = await App.api('/api/admin/staff', { method: 'POST', data: { email: email.value, display_name: name.value, role: role.value, technician_id: tech.value } });
        pending = r; App.toast('Invitation créée'); reload(); window.scrollTo({ top: 0, behavior: 'smooth' });
      }));
      c.append(f); root.append(c);
    }

    // --- role matrix (transparency)
    const m = App.card('Matrice des rôles', 'MOINDRE PRIVILÈGE');
    const perms = Object.keys(roles.permissions);
    m.append(App.table(['Permission', ...Object.keys(roles.roles).map(r => roles.roles[r].label)],
      perms.map(p => [el('span', '', roles.permissions[p]), ...Object.keys(roles.roles).map(r => roles.roles[r].permissions.includes(p) ? '✓' : '—')])));
    root.append(m);
  }
  App.register({ id: 'staff', label: 'Équipe & accès', icon: '👥', group: 'gov', perm: 'staff.read', render });
})();

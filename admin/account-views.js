(() => {
  'use strict';
  const App = window.AllosApp, { el } = App;
  const POLICY = 'Au moins 16 caractères, pas d’identifiant dans le mot de passe. Une phrase de passe est idéale.';

  function secretBlock(secret, uri) {
    const box = el('div', 'invite-box');
    box.append(el('strong', '', 'Nouvelle clé Authenticator — affichée une seule fois'));
    const code = el('code', '', secret); box.append(code);
    const row = el('div', 'toolbar');
    row.append(App.btn('Copier la clé', () => App.copy(secret, 'Clé copiée')), App.btn('Copier le lien otpauth', () => App.copy(uri, 'Lien copié')));
    box.append(row);
    return box;
  }

  async function render(root) {
    const s = await App.api('/api/admin/me');
    const u = s.user, env = u.kind === 'env';
    root.append(App.card('Mon compte', 'IDENTITÉ').appendChild(App.rows([
      ['Nom', u.name], ['Email de connexion', u.email], ['Rôle', u.role_label, 'info'],
      ['Type de compte', env ? 'Identifiants Railway (initiaux)' : 'Compte intégré', env ? 'warn' : 'ok'],
      ['Permissions', String(s.permissions.length) + ' accordées', 'neutral']
    ])).parentNode);

    if (env) {
      const c = App.card('Passer à des identifiants gérés dans l’administration', 'ROTATION DES IDENTIFIANTS INITIAUX');
      c.append(el('p', 'muted', 'Votre mot de passe et votre secret Authenticator actuels viennent des variables Railway. Cette opération crée un compte propriétaire intégré avec un nouveau mot de passe et une nouvelle clé MFA, puis désactive définitivement les identifiants Railway. L’ancienne connexion cesse de fonctionner immédiatement.'));
      c.append(el('p', 'muted small', 'Récupération : en cas de perte de l’application d’authentification, définir ADMIN_FORCE_ENV_LOGIN=true sur Railway réactive temporairement les anciens identifiants (à retirer ensuite).'));
      const stage1 = el('form'); stage1.autocomplete = 'off';
      const pw = App.input({ type: 'password', required: '', minlength: '16', maxlength: '200', autocomplete: 'new-password' });
      const pw2 = App.input({ type: 'password', required: '', minlength: '16', maxlength: '200', autocomplete: 'new-password' });
      stage1.append(App.field('Nouveau mot de passe', pw, POLICY), App.field('Confirmer', pw2));
      const go = el('button', 'btn primary', 'Générer la nouvelle clé MFA'); go.type = 'submit'; stage1.append(go);
      const stage2 = el('form'); stage2.hidden = true; stage2.autocomplete = 'off';
      const code = App.input({ inputmode: 'numeric', pattern: '[0-9]{6}', maxlength: '6', required: '', autocomplete: 'one-time-code' });
      stage2.append(App.field('Code affiché par la nouvelle application', code));
      const fin = el('button', 'btn primary', 'Confirmer et désactiver les identifiants Railway'); fin.type = 'submit'; stage2.append(fin);
      stage1.addEventListener('submit', App.guard(async ev => {
        ev.preventDefault();
        if (pw.value !== pw2.value) return App.toast('Les mots de passe ne correspondent pas', 'error');
        const r = await App.api('/api/admin/me/migrate/begin', { method: 'POST', data: { new_password: pw.value } });
        stage1.hidden = true; c.append(secretBlock(r.secret, r.otpauth_uri)); stage2.hidden = false; code.focus();
      }));
      stage2.addEventListener('submit', App.guard(async ev => {
        ev.preventDefault();
        const r = await App.api('/api/admin/me/migrate/confirm', { method: 'POST', data: { totp: code.value } });
        App.toast(r.message); setTimeout(() => location.reload(), 1800);
      }));
      c.append(stage1, stage2); root.append(c);
      return;
    }

    // Password change
    const pc = App.card('Changer mon mot de passe', 'SÉCURITÉ');
    const f = el('form'); f.autocomplete = 'off';
    const cur = App.input({ type: 'password', required: '', autocomplete: 'current-password' });
    const n1 = App.input({ type: 'password', required: '', minlength: '16', maxlength: '200', autocomplete: 'new-password' });
    const n2 = App.input({ type: 'password', required: '', minlength: '16', maxlength: '200', autocomplete: 'new-password' });
    const otp = App.input({ inputmode: 'numeric', pattern: '[0-9]{6}', maxlength: '6', required: '', autocomplete: 'one-time-code' });
    f.append(App.field('Mot de passe actuel', cur), App.field('Nouveau mot de passe', n1, POLICY), App.field('Confirmer le nouveau mot de passe', n2),
      App.field('Code Authenticator actuel', otp, 'Si vous venez de vous connecter, attendez le code suivant.'));
    const b = el('button', 'btn primary', 'Changer le mot de passe'); b.type = 'submit'; f.append(b);
    f.addEventListener('submit', App.guard(async ev => {
      ev.preventDefault();
      if (n1.value !== n2.value) return App.toast('Les mots de passe ne correspondent pas', 'error');
      const r = await App.api('/api/admin/me/password', { method: 'POST', data: { current_password: cur.value, new_password: n1.value, totp: otp.value } });
      f.reset(); App.toast(`Mot de passe changé. ${r.sessions_revoked} autre(s) session(s) fermée(s).`);
    }));
    pc.append(f); root.append(pc);

    // MFA rotation
    const mc = App.card('Remplacer mon application d’authentification', 'AUTHENTIFICATION À DEUX FACTEURS');
    mc.append(el('p', 'muted', 'Génère une nouvelle clé. L’ancienne application cesse de fonctionner dès que vous confirmez le premier code de la nouvelle.'));
    const f1 = el('form'); f1.autocomplete = 'off';
    const pw = App.input({ type: 'password', required: '', autocomplete: 'current-password' });
    const code1 = App.input({ inputmode: 'numeric', pattern: '[0-9]{6}', maxlength: '6', required: '', autocomplete: 'one-time-code' });
    f1.append(App.field('Mot de passe', pw), App.field('Code actuel', code1));
    const g = el('button', 'btn', 'Générer une nouvelle clé'); g.type = 'submit'; f1.append(g);
    const f2 = el('form'); f2.hidden = true; f2.autocomplete = 'off';
    const code2 = App.input({ inputmode: 'numeric', pattern: '[0-9]{6}', maxlength: '6', required: '', autocomplete: 'one-time-code' });
    f2.append(App.field('Code de la NOUVELLE application', code2));
    const k = el('button', 'btn primary', 'Confirmer le remplacement'); k.type = 'submit'; f2.append(k);
    f1.addEventListener('submit', App.guard(async ev => {
      ev.preventDefault();
      const r = await App.api('/api/admin/me/mfa/begin', { method: 'POST', data: { password: pw.value, totp: code1.value } });
      f1.hidden = true; mc.append(secretBlock(r.secret, r.otpauth_uri)); f2.hidden = false; code2.focus();
    }));
    f2.addEventListener('submit', App.guard(async ev => {
      ev.preventDefault();
      const r = await App.api('/api/admin/me/mfa/confirm', { method: 'POST', data: { totp: code2.value } });
      App.toast(`Application remplacée. ${r.sessions_revoked} autre(s) session(s) fermée(s).`); setTimeout(() => location.reload(), 1500);
    }));
    mc.append(f1, f2); root.append(mc);
  }
  App.register({ id: 'account', label: 'Mon compte', icon: '◉', group: 'gov', perm: null, render });
})();

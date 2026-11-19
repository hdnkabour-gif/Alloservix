(() => {
  'use strict';
  const App = window.AllosApp, { $ } = App;
  const show = id => { for (const s of ['login-wrap', 'invite-wrap', 'unconfigured']) $(s).hidden = s !== id; };
  const msg = (id, text, bad = true) => { const m = $(id); m.textContent = text; m.className = 'message' + (bad ? ' error' : ''); };
  async function raw(path, data) {
    const r = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(App.ctx.csrf ? { 'X-CSRF-Token': App.ctx.csrf } : {}) }, body: JSON.stringify(data) });
    let b = {}; try { b = await r.json(); } catch { /* empty */ }
    if (!r.ok) throw new Error(b.error || `Erreur HTTP ${r.status}`);
    return b;
  }

  function enter(session) {
    App.ctx.csrf = session.csrf; App.ctx.user = session.user; App.ctx.permissions = session.permissions;
    $('auth').hidden = true; $('app').hidden = false;
    $('user-name').textContent = session.user.name; $('user-role').textContent = session.user.role_label + (session.user.kind === 'env' ? ' · identifiants initiaux' : '');
    $('user-avatar').textContent = (session.user.name || '?').trim().charAt(0).toUpperCase();
    App.buildNav();
    const allowed = v => v && !v.external && (!v.perm || App.can(v.perm));
    const wanted = location.hash.slice(1), first = ['control', 'requests', 'services', 'account'].map(id => App.views.find(v => v.id === id)).find(allowed);
    const target = App.views.find(v => v.id === wanted && !v.external && (!v.perm || App.can(v.perm))) || first;
    if (target) App.navigate(target.id);
  }

  // ---- Login ----------------------------------------------------------------------------------
  $('login').addEventListener('submit', async ev => {
    ev.preventDefault(); msg('login-message', '', false);
    try {
      const fd = Object.fromEntries(new FormData(ev.target).entries());
      const r = await raw('/api/admin/login', fd); ev.target.reset();
      enter(r);
    } catch (e) { msg('login-message', e.message); }
  });
  $('logout').addEventListener('click', async () => { try { await raw('/api/admin/logout', {}); } catch { /* ignore */ } location.reload(); });
  $('menu-toggle').addEventListener('click', () => document.body.classList.toggle('nav-open'));

  // ---- Invitation (token travels in the URL fragment: never sent to servers or logs) ---------
  let inviteToken = '';
  function startInvite(token) {
    inviteToken = token; history.replaceState(null, '', '/admin/'); // remove the token from the address bar and history
    $('auth').hidden = false; $('app').hidden = true; show('invite-wrap');
  }
  $('invite-password').addEventListener('submit', async ev => {
    ev.preventDefault(); msg('invite-message', '', false);
    const fd = Object.fromEntries(new FormData(ev.target).entries());
    if (fd.password !== fd.confirm) return msg('invite-message', 'Les mots de passe ne correspondent pas.');
    try {
      const r = await raw('/api/admin/invite/accept', { token: inviteToken, password: fd.password });
      $('invite-secret').textContent = r.secret; $('invite-uri').textContent = r.otpauth_uri;
      $('invite-password').hidden = true; $('invite-mfa').hidden = false; $('invite-step-label').textContent = '2 / 2'; ev.target.reset();
    } catch (e) { msg('invite-message', e.message); }
  });
  $('invite-copy').addEventListener('click', () => App.copy($('invite-secret').textContent, 'Clé copiée'));
  $('invite-mfa').addEventListener('submit', async ev => {
    ev.preventDefault(); msg('invite-message', '', false);
    try {
      await raw('/api/admin/invite/activate', { token: inviteToken, totp: new FormData(ev.target).get('totp') });
      inviteToken = ''; ev.target.reset(); $('invite-mfa').hidden = true; $('invite-password').hidden = false; $('invite-step-label').textContent = '1 / 2';
      show('login-wrap'); msg('login-message', 'Compte activé. Connectez-vous avec votre mot de passe et un code de l’application.', false);
    } catch (e) { msg('invite-message', e.message); }
  });

  // ---- Boot ----------------------------------------------------------------------------------
  (async () => {
    const m = /^#invite=([0-9a-f]{64})$/.exec(location.hash);
    if (m) return startInvite(m[1]);
    try {
      const r = await fetch('/api/admin/session', { credentials: 'same-origin' }).then(x => x.json());
      if (r.authenticated) return enter(r);
      $('auth').hidden = false; show(r.configured ? 'login-wrap' : 'unconfigured');
    } catch { $('auth').hidden = false; show('login-wrap'); msg('login-message', 'Serveur injoignable.'); }
  })();
  window.addEventListener('hashchange', () => { const m = /^#invite=([0-9a-f]{64})$/.exec(location.hash); if (m) startInvite(m[1]); else if (App.ctx.user) { const id = location.hash.slice(1); if (id && id !== App.current) App.navigate(id); } });
})();

'use strict';
// Admin API for staff accounts, self-service security and audit integrity.
// Authorization (permission + re-authentication) is enforced centrally in server.js before these run.
const rbac = require('./rbac');
const { fail } = require('./auth');

function createAdminApi({ auth, store, helpers, monitor, systemContext }) {
  const { response, bodyJson, checkRate, clientId, originOk, rateScale = 1 } = helpers;
  const technicianExists = id => Boolean(store.db.prepare('SELECT 1 x FROM technicians WHERE id=?').get(id));
  const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
  const inviteLink = token => `/admin/#invite=${token}`;

  // Unauthenticated endpoints: the one-time invitation token is the credential.
  async function handlePublic(req, res, p, method) {
    if (method !== 'POST' || !/^\/api\/admin\/invite\/(?:accept|activate)$/.test(p)) return false;
    if (!originOk(req)) { response(res, 403, { error: 'Origin rejected' }); return true; }
    if (!checkRate('invite:' + clientId(req), 12 * rateScale, 900000)) { response(res, 429, { error: 'Trop de tentatives. Réessayez plus tard.' }); return true; }
    const b = await bodyJson(req);
    if (p.endsWith('/accept')) response(res, 200, auth.acceptInvite(str(b.token, 80), typeof b.password === 'string' ? b.password : ''));
    else response(res, 200, auth.activateInvite(str(b.token, 80), str(b.totp, 10)));
    return true;
  }

  async function handleAuthed(req, res, p, method, s) {
    const me = s.principal;
    if (p === '/api/admin/me' && method === 'GET') { response(res, 200, auth.publicSession(s)); return true; }
    if (p === '/api/admin/rbac' && method === 'GET') {
      response(res, 200, {
        permissions: rbac.PERMISSIONS,
        roles: Object.fromEntries(Object.keys(rbac.ROLES).map(r => [r, { label: rbac.ROLE_LABELS[r], permissions: rbac.permissionsFor(r) }]))
      });
      return true;
    }
    if (p === '/api/admin/reauth' && method === 'POST') {
      if (!checkRate('reauth:' + me.id, 8, 900000)) { response(res, 429, { error: 'Trop de tentatives. Réessayez plus tard.' }); return true; }
      const b = await bodyJson(req);
      if (!auth.reverify(me, typeof b.password === 'string' ? b.password : '', str(b.totp, 10))) { response(res, 401, { error: 'Mot de passe ou code invalide' }); return true; }
      auth.markReauth(s.key);
      store.logAudit('reauth', 'session', '', me);
      response(res, 200, { fresh_reauth: true, valid_for_seconds: auth.constants.REAUTH_MS / 1000 });
      return true;
    }
    if (p === '/api/admin/me/password' && method === 'POST') {
      if (!checkRate('pwchange:' + me.id, 6, 900000)) { response(res, 429, { error: 'Trop de tentatives. Réessayez plus tard.' }); return true; }
      const b = await bodyJson(req);
      response(res, 200, auth.changePassword(me, typeof b.current_password === 'string' ? b.current_password : '', str(b.totp, 10),
        typeof b.new_password === 'string' ? b.new_password : '', s.key));
      return true;
    }
    if (p === '/api/admin/me/mfa/begin' && method === 'POST') {
      if (!checkRate('mfabegin:' + me.id, 6, 900000)) { response(res, 429, { error: 'Trop de tentatives. Réessayez plus tard.' }); return true; }
      const b = await bodyJson(req);
      response(res, 200, auth.beginMfaRotation(me, typeof b.password === 'string' ? b.password : '', str(b.totp, 10)));
      return true;
    }
    if (p === '/api/admin/me/mfa/confirm' && method === 'POST') {
      if (!checkRate('mfaconfirm:' + me.id, 10, 900000)) { response(res, 429, { error: 'Trop de tentatives. Réessayez plus tard.' }); return true; }
      const b = await bodyJson(req);
      response(res, 200, auth.confirmMfaRotation(me, str(b.totp, 10), s.key));
      return true;
    }
    if (p === '/api/admin/me/migrate/begin' && method === 'POST') {
      const b = await bodyJson(req);
      response(res, 200, auth.beginOwnerMigration(me, typeof b.new_password === 'string' ? b.new_password : ''));
      return true;
    }
    if (p === '/api/admin/me/migrate/confirm' && method === 'POST') {
      if (!checkRate('migrate:' + me.id, 10, 900000)) { response(res, 429, { error: 'Trop de tentatives. Réessayez plus tard.' }); return true; }
      const b = await bodyJson(req);
      const r = auth.confirmOwnerMigration(me, str(b.totp, 10));
      response(res, 200, { ...r, message: 'Les identifiants Railway ne fonctionnent plus. Reconnectez-vous avec le nouveau mot de passe et la nouvelle application d’authentification.' });
      return true;
    }
    if (p === '/api/admin/system/status' && method === 'GET') {
      response(res, 200, { generated_at: new Date().toISOString(), runtime: monitor.runtime(), storage: monitor.storage(), metrics: monitor.metrics(), environment: monitor.environment(),
        checklist: monitor.checklist(systemContext()), errors: monitor.recentErrors(20), errors_last_hour: monitor.errorsSince(3600000), errors_last_24h: monitor.errorsSince(86400000),
        backups: monitor.listSnapshots(), domains_configured: monitor.domains() });
      return true;
    }
    if (p === '/api/admin/system/errors' && method === 'GET') { response(res, 200, { errors: monitor.recentErrors(Number(new URL(req.url, 'http://x').searchParams.get('limit')) || 50) }); return true; }
    if (p === '/api/admin/system/backups' && method === 'GET') { response(res, 200, { backups: monitor.listSnapshots() }); return true; }
    if (p === '/api/admin/system/backups' && method === 'POST') {
      if (!checkRate('backup:' + me.id, 4, 3600000)) { response(res, 429, { error: 'Trop d’instantanés. Réessayez plus tard.' }); return true; }
      const snap = monitor.createSnapshot(me.email, require('node:sqlite').DatabaseSync);
      store.logAudit('backup_snapshot', snap.file, snap.integrity === 'ok' ? 'vérifié' : snap.integrity, me);
      response(res, snap.integrity === 'ok' ? 201 : 500, { backup: snap }); return true;
    }
    if (p === '/api/admin/system/domain-check' && method === 'POST') {
      if (!checkRate('domaincheck:' + me.id, 6, 600000)) { response(res, 429, { error: 'Contrôle lancé trop souvent. Patientez quelques minutes.' }); return true; }
      response(res, 200, await monitor.domainCheck()); return true;
    }
    if (p === '/api/admin/audit/verify' && method === 'GET') { response(res, 200, store.verifyAudit()); return true; }
    if (p === '/api/admin/staff' && method === 'GET') {
      response(res, 200, {
        accounts: auth.listAccounts(), vault_ready: auth.vaultReady(),
        env_owner: { configured: auth.envConfigured(), active: auth.envLoginAllowed(), migrated: auth.envConfigured() && !auth.envLoginAllowed() }
      });
      return true;
    }
    if (p === '/api/admin/staff' && method === 'POST') {
      const b = await bodyJson(req);
      const r = auth.createAccount(b, me, { technicianExists });
      response(res, 201, { account: r.account, invite: { ...r.invite, link: inviteLink(r.invite.token) } });
      return true;
    }
    const m = /^\/api\/admin\/staff\/([A-Za-z0-9-]{8,64})(\/invite|\/revoke-sessions)?$/.exec(p);
    if (m) {
      const id = m[1], sub = m[2];
      if (!sub && method === 'PUT') {
        const b = await bodyJson(req);
        const patch = {};
        for (const k of ['display_name', 'role', 'technician_id', 'status']) if (Object.hasOwn(b, k)) patch[k] = b[k];
        response(res, 200, { account: auth.updateAccount(id, patch, b.version, me, { technicianExists }) });
        return true;
      }
      if (sub === '/invite' && method === 'POST') {
        const r = auth.resetAccount(id, me);
        response(res, 200, { account: r.account, invite: { ...r.invite, link: inviteLink(r.invite.token) } });
        return true;
      }
      if (sub === '/revoke-sessions' && method === 'POST') {
        if (!auth.getAccount(id)) throw fail('Compte introuvable', 404);
        const n = auth.revokeAccountSessions(id);
        store.logAudit('sessions_revoked', 'account:' + id, String(n), me);
        response(res, 200, { revoked: n });
        return true;
      }
    }
    return false;
  }
  return { handlePublic, handleAuthed };
}

module.exports = { createAdminApi };

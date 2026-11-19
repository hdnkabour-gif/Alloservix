'use strict';
// ALLOSERVIX staff authentication: accounts, sessions, MFA (TOTP), invitations, rotation.
// Uses the application's existing SQLite database. No secrets are ever returned by list endpoints.
const crypto = require('node:crypto');
const rbac = require('./rbac');

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const SCRYPT = { N: 16384, r: 8, p: 1 };
const MAX_FAILS = 8;
const LOCK_MS = 15 * 60 * 1000;
const INVITE_MS = 72 * 3600 * 1000;
const SESSION_ABSOLUTE_MS = 8 * 3600 * 1000;
const SESSION_IDLE_MS = 30 * 60 * 1000;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

const secureEqual = (a, b) => {
  const aa = Buffer.from(String(a)), bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
};
function fail(message, status = 400, code) {
  const e = new Error(message);
  e.public = true; e.status = status; if (code) e.code = code;
  return e;
}

// ---- TOTP / base32 ---------------------------------------------------------------------------
function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
    value &= (1 << bits) - 1;
  }
  if (bits) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(s) {
  let bits = 0, value = 0; const out = [];
  for (const c of String(s || '').replace(/\s|=/g, '').toUpperCase()) {
    const d = B32.indexOf(c);
    if (d < 0) throw new Error('TOTP invalid');
    value = (value << 5) | d; bits += 5;
    if (bits >= 8) { bits -= 8; out.push((value >> bits) & 255); value &= (1 << bits) - 1; }
  }
  return Buffer.from(out);
}
const newTotpSecret = () => base32Encode(crypto.randomBytes(20));
function otpAt(key, step) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
  const digest = crypto.createHmac('sha1', key).update(msg).digest();
  const off = digest.at(-1) & 15;
  return String((digest.readUInt32BE(off) & 0x7fffffff) % 1000000).padStart(6, '0');
}
// Returns the matched 30-second step (anti-replay needs it), or null. Window: previous, current, next.
function totpMatch(code, secret, now = Date.now(), minStep = 0, window = 1) {
  if (!/^\d{6}$/.test(String(code || ''))) return null;
  let key;
  try { key = base32Decode(secret); if (key.length < 10) return null; } catch { return null; }
  const current = Math.floor(now / 30000);
  let matched = null;
  for (let i = -window; i <= window; i++) {
    const step = current + i;
    if (secureEqual(code, otpAt(key, step)) && step > minStep) matched = matched === null ? step : Math.max(matched, step);
  }
  return matched;
}
const totpValid = (code, secret, now = Date.now()) => totpMatch(code, secret, now, 0) !== null;
const otpauthUri = (email, secret) =>
  `otpauth://totp/ALLOSERVIX:${encodeURIComponent(email)}?secret=${secret}&issuer=ALLOSERVIX&algorithm=SHA1&digits=6&period=30`;

// ---- Passwords --------------------------------------------------------------------------------
function hashPassword(password) {
  const salt = crypto.randomBytes(24);
  const key = crypto.scryptSync(password, salt, 64, SCRYPT);
  return salt.toString('hex') + ':' + key.toString('hex');
}
function passwordValid(entered, stored) {
  try {
    const [saltHex, keyHex] = String(stored || '').split(':');
    if (!/^[0-9a-f]{32,128}$/i.test(saltHex) || !/^[0-9a-f]{128}$/i.test(keyHex)) return false;
    const test = crypto.scryptSync(String(entered), Buffer.from(saltHex, 'hex'), 64, SCRYPT);
    return crypto.timingSafeEqual(test, Buffer.from(keyHex, 'hex'));
  } catch { return false; }
}
const DUMMY_HASH = hashPassword('dummy-password-for-constant-time-comparison');
function passwordPolicy(password, email = '') {
  if (typeof password !== 'string') return 'Mot de passe invalide';
  if (password.length < 16) return 'Le mot de passe doit contenir au moins 16 caractères';
  if (password.length > 200) return 'Le mot de passe est trop long (200 caractères maximum)';
  if (new Set(password).size < 6) return 'Le mot de passe est trop répétitif';
  const local = String(email).split('@')[0].toLowerCase();
  if (local.length >= 4 && password.toLowerCase().includes(local)) return 'Le mot de passe ne doit pas contenir l’identifiant';
  if (/^(?:password|motdepasse|azerty|qwerty|123456|alloservix)/i.test(password)) return 'Mot de passe trop prévisible';
  return null;
}

// ---- Encryption of TOTP secrets (derived key, bound to the account id) -----------------------
function createVault(env, info = 'alloservix-staff-totp-v1') {
  const raw = () => {
    const h = env.ALLO_DATA_KEY || '';
    if (!/^[0-9a-f]{64}$/i.test(h)) return null;
    return Buffer.from(h, 'hex');
  };
  const key = () => {
    const master = raw();
    if (!master) throw fail('Clé de chiffrement des données non configurée (ALLO_DATA_KEY)', 503, 'vault_unavailable');
    return Buffer.from(crypto.hkdfSync('sha256', master, Buffer.alloc(0), info, 32));
  };
  return {
    ready: () => raw() !== null,
    seal(plain, accountId) {
      const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key(), iv);
      c.setAAD(Buffer.from(accountId));
      const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), data]).toString('base64');
    },
    open(blob, accountId) {
      const a = Buffer.from(blob, 'base64');
      if (a.length < 29) throw new Error('bad ciphertext');
      const d = crypto.createDecipheriv('aes-256-gcm', key(), a.subarray(0, 12));
      d.setAAD(Buffer.from(accountId)); d.setAuthTag(a.subarray(12, 28));
      return Buffer.concat([d.update(a.subarray(28)), d.final()]).toString('utf8');
    }
  };
}

function createAuth(db, { env = process.env, audit = () => {}, now = Date.now } = {}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS staff_accounts (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, display_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('owner','manager','technician')), technician_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','pending_mfa','active','disabled')),
      password_hash TEXT NOT NULL DEFAULT '', totp_secret TEXT NOT NULL DEFAULT '', pending_totp TEXT NOT NULL DEFAULT '',
      last_totp_step INTEGER NOT NULL DEFAULT 0, failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_login_at TEXT NOT NULL DEFAULT '',
      password_changed_at TEXT NOT NULL DEFAULT '', mfa_enrolled_at TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS staff_invites (
      token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES staff_accounts(id),
      expires_at INTEGER NOT NULL, used_at INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_staff_invites_account ON staff_invites(account_id);
    CREATE TABLE IF NOT EXISTS security_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  const vault = createVault(env);
  // Sensitive actions need a fresh password+TOTP check within this window (default 5 min; overridable 1..900 s).
  // Accepted clock drift in 30 s steps (default 1). Test-only knob, clamped 1..5; never raise it in production.
  const TOTP_WINDOW = Math.max(1, Math.min(5, Math.floor(Number(env.ADMIN_TOTP_WINDOW)) || 1));
  const REAUTH_MS = Math.max(1, Math.min(900, Number(env.ADMIN_REAUTH_SECONDS) || 300)) * 1000;
  const iso = () => new Date(now()).toISOString();
  const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
  const normEmail = e => String(e || '').trim().toLowerCase().slice(0, 254);
  const tx = fn => {
    db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { try { db.exec('ROLLBACK'); } catch { /* ignore */ } throw e; }
  };
  const getState = k => db.prepare('SELECT value FROM security_state WHERE key=?').get(k)?.value;
  const setState = (k, v) => db.prepare('INSERT INTO security_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v));

  // ---- Environment (bootstrap) owner ---------------------------------------------------------
  const envEmail = () => String(env.ADMIN_EMAIL || '').trim().toLowerCase();
  const envConfigured = () => Boolean(env.ADMIN_EMAIL && env.ADMIN_PASSWORD_HASH && env.ADMIN_TOTP_SECRET);
  const dbAccountByEmail = email => db.prepare('SELECT * FROM staff_accounts WHERE email=?').get(email);
  const dbAccountById = id => db.prepare('SELECT * FROM staff_accounts WHERE id=?').get(id);
  // Once the owner migrated to in-app credentials, the Railway bootstrap credentials stop working
  // (unless ADMIN_FORCE_ENV_LOGIN=true is set deliberately as a break-glass recovery).
  function envLoginAllowed() {
    if (!envConfigured()) return false;
    if (env.ADMIN_FORCE_ENV_LOGIN === 'true') return true;
    const a = dbAccountByEmail(envEmail());
    return !(a && a.status === 'active');
  }
  const anyLoginConfigured = () => envConfigured() || db.prepare("SELECT count(*) n FROM staff_accounts WHERE status='active'").get().n > 0;

  const principalOf = a => ({ kind: 'staff', id: a.id, email: a.email, name: a.display_name, role: a.role, technician_id: a.technician_id || '' });
  const envPrincipal = () => ({ kind: 'env', id: 'env-owner', email: envEmail(), name: 'Propriétaire (configuration Railway)', role: 'owner', technician_id: '' });

  // ---- Sessions ------------------------------------------------------------------------------
  const sessions = new Map();
  function startSession(principal, res, production) {
    const token = crypto.randomBytes(32).toString('hex'), csrf = crypto.randomBytes(24).toString('hex'), t = now();
    sessions.set(sha(token), { principal, csrf, created: t, last: t, reauthAt: t });
    res.setHeader('Set-Cookie', `allo_admin=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=28800${production ? '; Secure' : ''}`);
    return csrf;
  }
  function readSession(req) {
    const cookie = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('allo_admin='));
    if (!cookie) return null;
    const token = cookie.split('=').slice(1).join('=');
    if (!/^[0-9a-f]{64}$/.test(token)) return null;
    const key = sha(token), s = sessions.get(key), t = now();
    if (!s) return null;
    if (t - s.created > SESSION_ABSOLUTE_MS || t - s.last > SESSION_IDLE_MS) { sessions.delete(key); return null; }
    if (s.principal.kind === 'staff') { // account state is re-checked on every request
      const a = dbAccountById(s.principal.id);
      if (!a || a.status !== 'active') { sessions.delete(key); return null; }
      s.principal = principalOf(a); // role changes apply immediately
    }
    s.last = t;
    return { key, ...s };
  }
  const endSession = key => sessions.delete(key);
  function revokeAccountSessions(accountId, exceptKey = null) {
    let n = 0;
    for (const [k, s] of sessions) if (s.principal.id === accountId && k !== exceptKey) { sessions.delete(k); n++; }
    return n;
  }
  const markReauth = key => { const s = sessions.get(key); if (s) s.reauthAt = now(); };
  const isFresh = s => now() - s.reauthAt <= REAUTH_MS;
  const sessionCount = () => sessions.size;

  // ---- Credential verification ---------------------------------------------------------------
  // Always performs password and TOTP checks so timing does not reveal which factor failed.
  function checkStaffCredentials(a, password, totp, { consume }) {
    const pwOk = passwordValid(password, a.password_hash || DUMMY_HASH);
    let secret = '';
    try { secret = a.totp_secret ? vault.open(a.totp_secret, a.id) : ''; } catch { secret = ''; }
    const step = secret ? totpMatch(totp, secret, now(), a.last_totp_step, TOTP_WINDOW) : null;
    const ok = pwOk && step !== null && a.status === 'active';
    if (ok && consume) db.prepare('UPDATE staff_accounts SET last_totp_step=? WHERE id=?').run(step, a.id);
    return ok;
  }
  function checkEnvCredentials(password, totp, { consume }) {
    const pwOk = passwordValid(password, env.ADMIN_PASSWORD_HASH || DUMMY_HASH);
    const last = Number(getState('env_totp_step') || 0);
    const step = totpMatch(totp, env.ADMIN_TOTP_SECRET || '', now(), last, TOTP_WINDOW);
    const ok = pwOk && step !== null;
    if (ok && consume) setState('env_totp_step', step);
    return ok;
  }
  function recordFailure(a) {
    const fails = a.failed_attempts + 1;
    if (fails >= MAX_FAILS) {
      db.prepare('UPDATE staff_accounts SET failed_attempts=0, locked_until=? WHERE id=?').run(now() + LOCK_MS, a.id);
      audit('login_locked', 'account:' + a.id, 'verrouillage temporaire après échecs répétés');
    } else db.prepare('UPDATE staff_accounts SET failed_attempts=? WHERE id=?').run(fails, a.id);
  }

  // Returns {principal} or throws a uniform 401 (no hint about which factor or whether the account exists).
  function authenticate(email, password, totp) {
    email = normEmail(email);
    const uniform = () => fail('Identifiants ou code de vérification invalides', 401);
    const acc = email ? dbAccountByEmail(email) : null;
    if (acc && acc.status === 'active') {
      if (acc.locked_until > now()) { checkStaffCredentials(acc, password, totp, { consume: false }); throw fail('Trop de tentatives. Réessayez plus tard.', 429); }
      if (checkStaffCredentials(acc, password, totp, { consume: true })) {
        db.prepare('UPDATE staff_accounts SET failed_attempts=0, last_login_at=? WHERE id=?').run(iso(), acc.id);
        return { principal: principalOf(acc) };
      }
      recordFailure(acc);
      audit('login_failed', 'account:' + acc.id, '');
      throw uniform();
    }
    if (email && email === envEmail() && envLoginAllowed()) {
      if (checkEnvCredentials(password, totp, { consume: true })) return { principal: envPrincipal() };
      audit('login_failed', 'account:env-owner', '');
      throw uniform();
    }
    // Unknown, invited, disabled: same work, same answer.
    passwordValid(password, DUMMY_HASH); totpMatch(totp, 'JBSWY3DPEHPK3PXP', now(), 0, TOTP_WINDOW);
    if (acc) audit('login_failed', 'account:' + acc.id, 'compte non actif');
    throw uniform();
  }

  // Fresh re-verification for a signed-in principal (does not create a session).
  function reverify(principal, password, totp) {
    if (principal.kind === 'env') {
      if (!envLoginAllowed()) return false;
      return checkEnvCredentials(password, totp, { consume: true });
    }
    const a = dbAccountById(principal.id);
    if (!a || a.status !== 'active' || a.locked_until > now()) return false;
    const ok = checkStaffCredentials(a, password, totp, { consume: true });
    if (!ok) { recordFailure(a); audit('reauth_failed', 'account:' + a.id, '', principal); }
    return ok;
  }

  // ---- Accounts ------------------------------------------------------------------------------
  const safeAccount = a => ({
    id: a.id, email: a.email, display_name: a.display_name, role: a.role, technician_id: a.technician_id || '',
    status: a.status, created_at: a.created_at, updated_at: a.updated_at, last_login_at: a.last_login_at,
    password_changed_at: a.password_changed_at, mfa_enrolled: Boolean(a.mfa_enrolled_at), locked: a.locked_until > now(),
    version: a.version, created_by: a.created_by
  });
  const listAccounts = () => db.prepare('SELECT * FROM staff_accounts ORDER BY created_at DESC LIMIT 200').all().map(safeAccount);
  const getAccount = id => { const a = dbAccountById(id); return a ? safeAccount(a) : null; };

  function validateProfile({ email, display_name, role, technician_id }, { technicianExists } = {}) {
    email = normEmail(email);
    if (!EMAIL_RE.test(email)) throw fail('Adresse email invalide');
    display_name = String(display_name || '').trim().slice(0, 100);
    if (display_name.length < 2) throw fail('Nom affiché requis');
    if (!rbac.ROLES[role]) throw fail('Rôle inconnu');
    technician_id = String(technician_id || '').trim();
    if (role === 'technician') {
      if (!technician_id) throw fail('Un compte technicien doit être lié à une fiche technicien');
      if (technicianExists && !technicianExists(technician_id)) throw fail('Fiche technicien introuvable');
    } else technician_id = '';
    return { email, display_name, role, technician_id };
  }
  function otherActiveOwnerExists(excludeId) {
    const n = db.prepare("SELECT count(*) n FROM staff_accounts WHERE role='owner' AND status='active' AND id<>?").get(excludeId).n;
    return n > 0 || envLoginAllowed();
  }
  function makeInvite(accountId, actor) {
    db.prepare('UPDATE staff_invites SET used_at=? WHERE account_id=? AND used_at=0').run(now(), accountId);
    const token = crypto.randomBytes(32).toString('hex'), expires = now() + INVITE_MS;
    db.prepare('INSERT INTO staff_invites(token_hash,account_id,expires_at,created_at,created_by) VALUES(?,?,?,?,?)')
      .run(sha(token), accountId, expires, iso(), actor?.email || '');
    return { token, expires_at: new Date(expires).toISOString() };
  }

  function createAccount(input, actor, opts = {}) {
    if (!vault.ready()) throw fail('Clé de chiffrement des données non configurée (ALLO_DATA_KEY)', 503, 'vault_unavailable');
    const p = validateProfile(input, opts);
    if (p.role === 'owner' && actor.role !== 'owner') throw fail('Seul un propriétaire peut créer un propriétaire', 403);
    return tx(() => {
      if (dbAccountByEmail(p.email) || p.email === envEmail()) throw fail('Un compte existe déjà avec cet email', 409);
      const id = crypto.randomUUID(), t = iso();
      db.prepare('INSERT INTO staff_accounts(id,email,display_name,role,technician_id,status,created_at,updated_at,created_by) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(id, p.email, p.display_name, p.role, p.technician_id, 'invited', t, t, actor.email);
      const invite = makeInvite(id, actor);
      audit('staff_created', 'account:' + id, p.role, actor);
      return { account: getAccount(id), invite };
    });
  }

  function updateAccount(id, patch, expectedVersion, actor, opts = {}) {
    return tx(() => {
      const a = dbAccountById(id);
      if (!a) throw fail('Compte introuvable', 404);
      if (!Number.isInteger(expectedVersion) || expectedVersion !== a.version) throw fail('Compte modifié par quelqu’un d’autre — actualisez', 409);
      if (id === actor.id) throw fail('Vous ne pouvez pas modifier votre propre rôle ou statut', 403);
      const next = {
        display_name: patch.display_name ?? a.display_name, role: patch.role ?? a.role,
        technician_id: patch.technician_id ?? a.technician_id, status: patch.status ?? a.status
      };
      if (!['active', 'disabled', 'invited', 'pending_mfa'].includes(next.status)) throw fail('Statut inconnu');
      if (patch.status && patch.status !== a.status && !['active', 'disabled'].includes(patch.status)) throw fail('Seuls les statuts actif/désactivé sont modifiables');
      if (patch.status === 'active' && a.status !== 'disabled') throw fail('Seul un compte désactivé peut être réactivé');
      const p = validateProfile({ email: a.email, ...next }, opts);
      if ((p.role === 'owner' || a.role === 'owner') && actor.role !== 'owner') throw fail('Seul un propriétaire peut gérer un propriétaire', 403);
      const losesOwner = a.role === 'owner' && a.status === 'active' && (p.role !== 'owner' || next.status !== 'active');
      if (losesOwner && !otherActiveOwnerExists(id)) throw fail('Impossible : il doit rester au moins un propriétaire actif', 409);
      const r = db.prepare('UPDATE staff_accounts SET display_name=?,role=?,technician_id=?,status=?,updated_at=?,version=version+1 WHERE id=? AND version=?')
        .run(p.display_name, p.role, p.technician_id, next.status, iso(), id, a.version);
      if (r.changes !== 1) throw fail('Compte modifié par quelqu’un d’autre — actualisez', 409);
      if (next.status !== 'active' || p.role !== a.role) revokeAccountSessions(id);
      const changed = [p.role !== a.role && `role ${a.role}→${p.role}`, next.status !== a.status && `statut ${a.status}→${next.status}`,
        p.display_name !== a.display_name && 'nom'].filter(Boolean).join(', ');
      audit('staff_updated', 'account:' + id, changed, actor);
      return getAccount(id);
    });
  }

  // Reset: invalidates password + MFA + sessions and issues a fresh single-use invitation.
  function resetAccount(id, actor) {
    return tx(() => {
      const a = dbAccountById(id);
      if (!a) throw fail('Compte introuvable', 404);
      if (id === actor.id) throw fail('Utilisez « Mon compte » pour changer vos propres identifiants', 403);
      if (a.role === 'owner' && actor.role !== 'owner') throw fail('Seul un propriétaire peut réinitialiser un propriétaire', 403);
      if (a.role === 'owner' && a.status === 'active' && !otherActiveOwnerExists(id)) throw fail('Impossible : dernier propriétaire actif', 409);
      db.prepare("UPDATE staff_accounts SET status='invited',password_hash='',totp_secret='',pending_totp='',last_totp_step=0,failed_attempts=0,locked_until=0,mfa_enrolled_at='',updated_at=?,version=version+1 WHERE id=?")
        .run(iso(), id);
      revokeAccountSessions(id);
      const invite = makeInvite(id, actor);
      audit('staff_reset', 'account:' + id, 'identifiants invalidés, nouvelle invitation', actor);
      return { account: getAccount(id), invite };
    });
  }

  // ---- Invitation acceptance (token is the credential; two steps: password, then TOTP proof) --
  function inviteByToken(token) {
    if (!/^[0-9a-f]{64}$/.test(String(token || ''))) throw fail('Invitation invalide ou expirée', 400);
    const inv = db.prepare('SELECT * FROM staff_invites WHERE token_hash=?').get(sha(token));
    if (!inv || inv.used_at || inv.expires_at < now()) throw fail('Invitation invalide ou expirée', 400);
    const a = dbAccountById(inv.account_id);
    if (!a || !['invited', 'pending_mfa'].includes(a.status)) throw fail('Invitation invalide ou expirée', 400);
    return { inv, a };
  }
  function acceptInvite(token, password) {
    if (!vault.ready()) throw fail('Service temporairement indisponible', 503, 'vault_unavailable');
    return tx(() => {
      const { a } = inviteByToken(token);
      const bad = passwordPolicy(password, a.email);
      if (bad) throw fail(bad);
      const secret = newTotpSecret();
      db.prepare("UPDATE staff_accounts SET password_hash=?,pending_totp=?,status='pending_mfa',updated_at=?,version=version+1 WHERE id=?")
        .run(hashPassword(password), vault.seal(secret, a.id), iso(), a.id);
      audit('invite_password_set', 'account:' + a.id, '', { id: a.id, email: a.email, role: a.role });
      return { email: a.email, secret, otpauth_uri: otpauthUri(a.email, secret) };
    });
  }
  function activateInvite(token, totp) {
    return tx(() => {
      const { inv, a } = inviteByToken(token);
      if (a.status !== 'pending_mfa' || !a.pending_totp) throw fail('Définissez d’abord le mot de passe', 400);
      const secret = vault.open(a.pending_totp, a.id), step = totpMatch(totp, secret, now(), 0, TOTP_WINDOW);
      if (step === null) throw fail('Code de vérification invalide', 400);
      // Enrollment consumes the step it used: the same code cannot be replayed at the first login (wait for the next code).
      db.prepare("UPDATE staff_accounts SET status='active',totp_secret=?,pending_totp='',last_totp_step=?,mfa_enrolled_at=?,password_changed_at=?,failed_attempts=0,locked_until=0,updated_at=?,version=version+1 WHERE id=?")
        .run(vault.seal(secret, a.id), step, iso(), iso(), iso(), a.id);
      db.prepare('UPDATE staff_invites SET used_at=? WHERE token_hash=?').run(now(), inv.token_hash);
      audit('staff_activated', 'account:' + a.id, 'MFA enrôlée', { id: a.id, email: a.email, role: a.role });
      return { activated: true, email: a.email };
    });
  }

  // ---- Self-service rotation (password and MFA) ---------------------------------------------
  function changePassword(principal, currentPassword, totp, newPassword, currentKey) {
    if (principal.kind !== 'staff') throw fail('Le propriétaire configuré dans Railway doit d’abord migrer vers un compte intégré', 409, 'migrate_required');
    const bad = passwordPolicy(newPassword, principal.email);
    if (bad) throw fail(bad);
    // Cheap, side-effect-free validation first so a rejected request does not burn the one-time code.
    if (passwordValid(newPassword, dbAccountById(principal.id).password_hash)) throw fail('Le nouveau mot de passe doit être différent');
    if (!reverify(principal, currentPassword, totp)) throw fail('Mot de passe actuel ou code invalide', 401);
    db.prepare('UPDATE staff_accounts SET password_hash=?,password_changed_at=?,updated_at=?,version=version+1 WHERE id=?')
      .run(hashPassword(newPassword), iso(), iso(), principal.id);
    const revoked = revokeAccountSessions(principal.id, currentKey);
    audit('password_changed', 'account:' + principal.id, `${revoked} autre(s) session(s) fermée(s)`, principal);
    return { changed: true, sessions_revoked: revoked };
  }
  function beginMfaRotation(principal, password, totp) {
    if (principal.kind !== 'staff') throw fail('Migrez d’abord vers un compte intégré', 409, 'migrate_required');
    if (!reverify(principal, password, totp)) throw fail('Mot de passe ou code invalide', 401);
    const secret = newTotpSecret();
    db.prepare('UPDATE staff_accounts SET pending_totp=?,updated_at=? WHERE id=?').run(vault.seal(secret, principal.id), iso(), principal.id);
    audit('mfa_rotation_started', 'account:' + principal.id, '', principal);
    return { secret, otpauth_uri: otpauthUri(principal.email, secret) };
  }
  function confirmMfaRotation(principal, totp, currentKey) {
    if (principal.kind !== 'staff') throw fail('Migrez d’abord vers un compte intégré', 409, 'migrate_required');
    return tx(() => {
      const a = dbAccountById(principal.id);
      if (!a || !a.pending_totp) throw fail('Aucune rotation en cours', 400);
      const secret = vault.open(a.pending_totp, a.id), step = totpMatch(totp, secret, now(), 0, TOTP_WINDOW);
      if (step === null) throw fail('Code de vérification invalide', 400);
      db.prepare("UPDATE staff_accounts SET totp_secret=?,pending_totp='',last_totp_step=?,mfa_enrolled_at=?,updated_at=?,version=version+1 WHERE id=?")
        .run(vault.seal(secret, a.id), step, iso(), iso(), a.id);
      const revoked = revokeAccountSessions(a.id, currentKey);
      audit('mfa_rotated', 'account:' + a.id, `${revoked} autre(s) session(s) fermée(s)`, principal);
      return { rotated: true, sessions_revoked: revoked };
    });
  }

  // ---- Owner migration: Railway bootstrap credentials -> in-app credentials ------------------
  function beginOwnerMigration(principal, newPassword) {
    if (principal.kind !== 'env') throw fail('Réservé au propriétaire configuré dans Railway', 403);
    if (!vault.ready()) throw fail('Clé de chiffrement des données non configurée (ALLO_DATA_KEY)', 503, 'vault_unavailable');
    const bad = passwordPolicy(newPassword, principal.email);
    if (bad) throw fail(bad);
    if (passwordValid(newPassword, env.ADMIN_PASSWORD_HASH)) throw fail('Le nouveau mot de passe doit être différent de l’ancien');
    return tx(() => {
      const secret = newTotpSecret(), t = iso();
      let a = dbAccountByEmail(principal.email);
      if (a && a.status === 'active') throw fail('Déjà migré', 409);
      if (!a) {
        const id = crypto.randomUUID();
        db.prepare("INSERT INTO staff_accounts(id,email,display_name,role,status,created_at,updated_at,created_by) VALUES(?,?,?,?,?,?,?,?)")
          .run(id, principal.email, 'Propriétaire', 'owner', 'pending_mfa', t, t, 'env-owner');
        a = dbAccountById(id);
      }
      db.prepare("UPDATE staff_accounts SET password_hash=?,pending_totp=?,status='pending_mfa',updated_at=? WHERE id=?")
        .run(hashPassword(newPassword), vault.seal(secret, a.id), t, a.id);
      audit('owner_migration_started', 'account:' + a.id, '', principal);
      return { secret, otpauth_uri: otpauthUri(principal.email, secret) };
    });
  }
  function confirmOwnerMigration(principal, totp) {
    if (principal.kind !== 'env') throw fail('Réservé au propriétaire configuré dans Railway', 403);
    return tx(() => {
      const a = dbAccountByEmail(principal.email);
      if (!a || a.status !== 'pending_mfa' || !a.pending_totp) throw fail('Aucune migration en cours', 400);
      const secret = vault.open(a.pending_totp, a.id), step = totpMatch(totp, secret, now(), 0, TOTP_WINDOW);
      if (step === null) throw fail('Code de vérification invalide', 400);
      db.prepare("UPDATE staff_accounts SET status='active',totp_secret=?,pending_totp='',last_totp_step=?,mfa_enrolled_at=?,password_changed_at=?,updated_at=?,version=version+1 WHERE id=?")
        .run(vault.seal(secret, a.id), step, iso(), iso(), iso(), a.id);
      revokeAccountSessions('env-owner');
      audit('owner_migrated', 'account:' + a.id, 'identifiants Railway désactivés', principal);
      return { migrated: true };
    });
  }

  const publicSession = s => ({
    user: { id: s.principal.id, email: s.principal.email, name: s.principal.name, role: s.principal.role,
      role_label: rbac.ROLE_LABELS[s.principal.role], kind: s.principal.kind, technician_id: s.principal.technician_id },
    permissions: rbac.permissionsFor(s.principal.role),
    fresh_reauth: isFresh(s)
  });

  return {
    authenticate, reverify, startSession, readSession, endSession, revokeAccountSessions, markReauth, isFresh, sessionCount, publicSession,
    listAccounts, getAccount, createAccount, updateAccount, resetAccount, acceptInvite, activateInvite,
    changePassword, beginMfaRotation, confirmMfaRotation, beginOwnerMigration, confirmOwnerMigration,
    canOpenSecret: (blob, id) => { try { vault.open(blob, id); return true; } catch { return false; } },
    envConfigured, envLoginAllowed, anyLoginConfigured, vaultReady: vault.ready,
    constants: { MAX_FAILS, LOCK_MS, INVITE_MS, REAUTH_MS, SESSION_IDLE_MS, SESSION_ABSOLUTE_MS }
  };
}

module.exports = { createVault, createAuth, totpValid, totpMatch, passwordValid, hashPassword, passwordPolicy, base32Encode, base32Decode, newTotpSecret, otpauthUri, secureEqual, fail };

# ALLOSERVIX V15 — Team accounts, RBAC and credential rotation

Everything lives in the application's existing SQLite database (`staff_accounts`, `staff_invites`, `security_state`, and extra columns on `audit`). No second database, no external service, no new dependency.

## Roles (least privilege, default deny)
`rbac.js` is the single source of truth. Every `/api/admin/*` route must be declared there; an undeclared route answers **403** (a test scans `server.js` so a forgotten route fails CI).

| Role | Can | Cannot |
|---|---|---|
| **owner** | everything, incl. staff, settings, publication/availability, approvals, audit | — |
| **manager** | catalogue text edits (drafts), knowledge drafts, requests (incl. decrypted contact), technicians, stats, contact forms, AI monitor, team list (read) | publish / change availability, approve knowledge, change site settings, manage staff, read audit |
| **technician** | read catalogue; see **only requests assigned to them**; move own job `assigned → in_progress → completed` | everything else. Customer contact is visible only while the job is assigned/in progress |

Object-level rules are enforced server-side (a technician asking for another request gets 404). Role changes apply to live sessions immediately.

## Accounts and MFA
- Owner invites a member → one-time link `/admin/#invite=<token>` (72 h, token in the URL *fragment*, removed from the address bar). **No email is sent**: hand the link over through a safe channel.
- Invitee sets a password (≥ 16 chars) then enrolls TOTP (secret shown once). Account becomes `active` only after a valid code.
- TOTP seeds are encrypted with AES‑256‑GCM using a key derived (HKDF) from `ALLO_DATA_KEY` and bound to the account id. **Without `ALLO_DATA_KEY` account creation is refused.**
- Passwords: scrypt (same format as before). Login errors are uniform (no account enumeration); each used TOTP step is remembered (**no replay**); 8 failures lock the account 15 min; per-IP and per-account rate limits remain.
- Disabling, resetting or changing the role of an account closes its sessions at once. The last active owner cannot be demoted, disabled or reset. Edits use optimistic locking (`version`).

## Rotation from inside the admin
- **My account → change password** (current password + fresh code; other sessions are closed).
- **My account → replace authenticator** (old one stops working when the new one is confirmed).
- **Initial owner (Railway variables) → migrate**: creates an in-app owner with a new password and new TOTP seed, then **disables the Railway credentials**. Break‑glass: set `ADMIN_FORCE_ENV_LOGIN=true` on Railway to re-enable them temporarily, then remove it.
- Step-up: staff management, site settings and migration need a fresh password+TOTP check (≤ 5 min; override `ADMIN_REAUTH_SECONDS`, 1–900). The UI prompts automatically and resumes the action.

## Audit
Every admin write records actor email, actor id and role. Rows are hash-chained (`prev_hash`/`row_hash`): `GET /api/admin/audit/verify` (and the audit page) detects edited or deleted rows. Entries created before V15 stay readable but are unchained.

## Known limits (do not present as done)
- Sessions are in memory: a Railway restart signs everybody out.
- No e-mail delivery of invitations, no recovery codes (recovery = owner reset, or `ADMIN_FORCE_ENV_LOGIN` for the owner), no QR image (manual key / otpauth link).
- Brain Studio and the dispatch pages keep their own UI; their routes are now permission-checked server-side, but their buttons are not hidden per role yet.
- `ADMIN_RATE_SCALE` multiplies login/invite rate limits and exists only for automated tests; never set it in production.

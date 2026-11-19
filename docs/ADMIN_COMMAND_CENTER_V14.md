# ALLOSERVIX V14 — Admin Command Center

## Scope and factual capabilities

The private console at `/admin/` is the **single navigation and monitoring entry point** for the existing ALLOSERVIX website, not an unsafe superuser terminal.

All dashboard aggregates are read from the application's existing SQLite data through `GET /api/admin/control-center`. The endpoint requires the existing owner session with password + 6-digit TOTP; **no keys, password hashes, TOTP secrets, customer contact details, raw diagnostic text, or technician private records** appear in its JSON.

### Available and editable now
- Homepage: enterprise-wide status and links to the main customer site.
- Services: edit French/Arabic titles, descriptions, technologies, inclusion lists, status, visibility, and keywords. Use `/brain-studio/` for creating new hidden service drafts or reviewed language concepts.
- Knowledge: approve human-written concepts and concept–service links; an external LLM cannot approve or publish them.
- Operations: `/ops-v10/` for technician verification, availability, eligibility, customer requests and manually approved dispatch.
- Website: publish-confirmed contact details (WhatsApp/email/coverage), subtitle and site name.
- Consented analytics and inquiries: existing tabs, enabled through Railway only after privacy decisions.
- Audit: view the existing content/update/request logs.

### Read-only and visible in V14
- Total/publicly listed/available/hidden/in-study services by category.
- Knowledge concept/link draft and approved counts.
- Request, unresolved request, technician, active verified technician and inquiry counts, **not** customer PII.
- Four supported intent-classification providers; only whether each key exists and whether external text/image/audio are enabled, with daily usage count.
- MFA, existence of customer-encryption key, current data-collection switches.
- Railway and Cloudflare links with *explicit unverified TLS status*: app runtime cannot know the edge certificate state without the provider connectors.

### Not implemented — must not be presented as ready
- ~~Multi-user staff accounts, RBAC, invitation flows, password/TOTP rotation~~ — **implemented in V15**, see `docs/ADMIN_ACCESS_CONTROL_V15.md`. Still missing: e-mail delivery of invitations, recovery codes, per-action approval workflows.
- Domain SSL and Cloudflare administration inside the site.
- Verified backup/restore dashboard, billing/payments, inventory or customer CRM.
- Production monitoring alerts, real-time incidents, long-term anonymous usage graph and GDPR/CNDP governance work.
- External provider APIs without real credentials, privacy/legal review and opt-in.

## Temporary owner onboarding

- Admin login identifier: `owner@alloservix.ma` (login only; this does **not** create a mail inbox).
- The site requires a **separate** strong password and TOTP authenticator code. The password and TOTP seed are not committed to this repository or logged by the site.
- They are present only as private Railway variables. The password is stored as a scrypt hash.
- User must rotate the bootstrap credentials immediately after first login by generating a fresh `scrypt` hash and fresh TOTP seed, updating Railway variables, redeploying, and verifying that the old credentials fail. A secure in-app rotation feature is not yet implemented.
- Admin security details: HttpOnly SameSite=Strict cookie, session expiry, CSRF on writes, TOTP rate limits. The single owner session is not durable across Railway restarts.
- Do not configure or display old credentials as examples in the repository, screenshots, issue reports or assistant messages.

## Suggested model responsibilities

### Claude Code: implementation/verification
1. Inspect `main` SHA, all `/api/admin/*` routes, `storage.js`, `operations.js`, `knowledge-studio.js`, current tests and Railway infrastructure before making changes. Preserve existing terminology and data relations.
2. Build missing **RBAC / owner–manager–technician** permissions with least privilege, secure invitation, MFA, recovery and auditable account rotation; write tests before changes.
3. Implement approved settings and features through the app's current backend; never create a parallel database, copy client PII to external services, or add a superuser shell.
4. End-to-end QA across modules and mobile/desktop; test success and denial paths and reconciliation after restart. Use PR branches and staged deploys.
5. Never turn on `ENABLE_REQUESTS`, `ENABLE_AI`, `ENABLE_INQUIRIES`, or publish services without the owner's explicit approval and verified compliance.

### Astra: independent architecture and security review
1. Audit Claude's PR diffs and current `main` independently: authorization scope, session fixation/CSRF, TOTP replay and brute force, secrets hygiene, unsafe API surface, SQLite concurrency, stale state and backup/restore.
2. Test all roles and object-level authorization with negative abuse cases; verify no privilege escalation, SSRF, XSS, prompt injection control, sensitive logs, or disclosure of customer data.
3. Independently validate the AI boundary (interpret intent only, do not author final answer), input privacy and vendor failover/cost controls.
4. Produce severity-ranked report P0/P1/P2 with **file, function, test, observed evidence, and reproducible steps**. Never declare production-safe from code review alone.
5. Avoid merging, deploying, deleting or changing Railway secrets. Request approval for any potentially destructive remediation.

### Owner / ChatGPT: integration gate
- Compare both reports and PR diff, run CI on the exact SHA, perform HTTPS-independent Railway preview smoke, validate real browser UI, then merge only passing verified changes and inspect production deployment/health.
- Keep Railway/Cloudflare custom domain certificate work as a separate ticket and do not claim the SSL certificate is valid based on application health.

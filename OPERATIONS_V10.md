# ALLOSERVIX V10 — Requests, technician profiles & dispatch

## Scope
- A **request** is a non-binding request to study a need, not a confirmed order, booking, appointment, or quote.
- Visitors can browse existing services anonymously. Request creation additionally requires affirmative consent and contact data; tracking uses a random 256-bit token only returned on successful submission.
- Request fields: type, context, city/zone, service, description, up to three answers, requester contact, preferred communication method. Free-text data is not forwarded to external AI by these workflows.
- Technicians are managed by the ALLOSERVIX administrator, never directly selected by a customer.
- Technician fields: name, communication, city/zones, professional title, years experience, levels, education/certifications, languages, equipment/tools, transportation, working hours, business status, contract and insurance references, notes, onsite/remote support, availability, verification, service-specific skills & verification, workload/capacity.
- Recommendations reject unapproved technicians, unsigned agreements, unavailable profiles, unverified service skill, unsupported areas or full capacities. Fire and automation categories require documented specialist certification and insurance reference before candidates qualify.
- A manager alone accepts/assigns a technician. The dispatch ranking is a planning aid, not automatic adjudication.

## New pages
- `/request-v10/index.html` — public pilot request wizard, browser voice dictation optional, request tracking, no account required.
- `/ops-v10/index.html` — staff area, uses existing server-side administrator session, MFA and CSRF.
- Existing `/admin` contains a link to operations.

## V10 API
- `GET /api/public/requests/config`
- `POST /api/public/requests` — disabled unless `ENABLE_REQUESTS=true` and encryption key present. JSON body limit 16KB; 5/hour/IP.
- `GET /api/public/requests/:tracking_code` — requires `X-Request-Token` header. Returns *only* status, code, title, city and timestamps; no contact data.
- Admin after MFA: `/api/admin/ops/{config,requests,technicians}` plus detail/status/classify/assignment and technician detail/update endpoints.
- Admin writes require existing session and CSRF token.

## Production setup (not safe to skip)
1. Verify CNDP / privacy notice and customer contact policy for Morocco, plus a retention and incident-handling plan.
2. Configure existing admin: `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, `ADMIN_TOTP_SECRET` using `npm run admin:setup`; don't enter secrets in frontend code or chat.
3. Generate a **persistent** key `ALLO_DATA_KEY` as **64 hexadecimal characters**, generated from 32 secure random bytes. Add as protected Railway variable. Back up securely; changing it will make encrypted records unreadable. Never commit the key.
4. Start with `ENABLE_REQUESTS=false` while checking legal documents and admin access. Change it to `true` only when ready to receive personal data. Confirm Railway `/data` volume persists across deploys, and backup/restore key+database.
5. First technicians should be entered with their documented consent. Activate only after checking credentials, skills, work-area eligibility, signed agreement and applicable insurance.
6. Before real paid work: finalize quote, customer acceptance, tax/invoicing, guarantees and labor/contract responsibilities.

## Privacy and security decisions
- Customer and technician contact and notes are AES-256-GCM encrypted at rest with the server-side key.
- Public tracking is not identity verification; possession of a secret code gives status access only. OTP phone verification is a future feature.
- The user interface never leaks technicians' direct contact details to visitors.
- Restricted admin routes, rate limiting, request validation, audit trail of operations and version-checked updates.
- Images/file uploads are **not implemented in this version**. Avoid collecting sensitive screenshots and images until an authenticated/private attachment storage, image metadata removal and retention policy exist.
- Browser voice input is optional and its implementation may transfer audio to the browser provider; avoid sensitive dictation.
- Existing AI may still respond to ordinary service questions when enabled, but V10 request and technician modules do not transfer personal data to the AI provider.

## Limits / follow-up backlog
- Single-admin login; team-specific RBAC, technician accounts, verified OTP, quotes, client approvals, messaging, signed documents, billing, photo ingestion and exact-distance routing are not yet implemented.
- No technician is automatically assigned by AI. Scores are illustrative/heuristic; skill verification and management review are mandatory.
- Matching works by explicit city/zone strings for pilot, not GPS travel times; no real-time availability or SLA verification.
- No actual names, customer details or live technician records seeded in code.
- All 100 published services remain **Sur étude** until ALLOSERVIX validates availability.

## Test
`npm test` + `node --test tests/operations-v10.test.js`
Test covers consent, encrypted PII, rate/CSRF gates, tracking token, admin auth, technician profile onboarding, eligibility, state transitions and assignment. `tests/catalogue.test.js` expects all service HTML pages which already exist on the live main repository; locally reconstructed workspace needed missing V8 legacy pages added as local fixtures, not part of this commit.

# ALLOSERVIX V14 — Security hardening (response to the independent audit)

Each finding was first reproduced by a failing test (or confirmed in the code), then closed. Tests live in `tests/hardening.test.js` (+ `tests/media-api.test.js`, `tests/rbac-api.test.js`).

| # | Finding | Status | What changed | Proof |
|---|---|---|---|---|
| P1‑1 | Status-change response leaked customer contact to a technician | **Closed** | classify/status/assignment responses go through the same role redaction as the detail route | test "technician never receives customer contact … (status response included)" |
| P1‑2 | `title`, `description`, `answers`, `budget` stored in clear | **Closed for new data; legacy by owner migration** | all four live inside the AES‑GCM blob; lists never carry the description | raw SQLite scanned for unique markers |
| P1‑3 | Inquiries stored in clear | **Closed for new data; legacy by owner migration** | `inquiries.enc` (HKDF‑derived key, AAD bound); submissions are refused (503) without `ALLO_DATA_KEY`; optional retention `INQUIRY_RETENTION_DAYS` (off by default, 30–3650) | raw SQLite scan, 503 test, retention test |
| P1‑4 | Media sent whole to providers; endpoints callable by scripts | **Reduced (not eliminated)** | same-origin only (Origin or `Sec-Fetch-Site`), EXIF/GPS/XMP/text/ICC stripped server-side for JPEG/PNG/WebP, AI text sanitiser extended (names, addresses, links, IBAN/cards, IPs, 300 chars), global hourly media cap, per-kind daily caps | payload test proves providers get the stripped image; no consent/disabled/budget ⇒ zero outbound calls |
| P1‑5 | Snapshots on the same volume, no restore proof | **Partly closed** | **restore drill**: copy → integrity/FK/counts → decrypt samples with the current key → *boot the real app on the copy* → query it; **passphrase-encrypted export** for an off-volume copy + `scripts/restore-backup.mjs` | drill test (and a corrupted snapshot makes it FAIL), export round-trip, tamper/wrong-passphrase tests, browser run |
| P2‑6 | Settings update partially applied, audit after the loop | **Closed** | all keys/values validated first; write + audit in one savepoint; invalid ⇒ 400, nothing changed | atomicity test |
| P2‑7 | Enrolment TOTP could be replayed at first login | **Closed** | enrolment/rotation/migration record the step they used | replay test |
| P2‑8 | Status page looked for `ENABLE_AUDIO_INTENT` | **Closed** | uses `ENABLE_AUDIO_TRANSCRIPTION` | flag test |
| P2‑9 | Owner could approve their own catalogue proposal | **Closed** | with ≥ 2 active owners, self-approval is refused (`four_eyes`); a lone owner is not locked out | two-owner test |
| P2‑10 | `AI_DAILY_LIMIT` counted requests, not provider calls | **Closed** | `providerAllowed()` caps *attempts* per provider (`AI_PROVIDER_DAILY_LIMIT`, 200) and in total (`AI_DAILY_ATTEMPT_LIMIT`, 3× the daily limit); refusals are visible as `budget_exhausted` | spawned server with a counted fetch mock: 8 requests ⇒ exactly 3 outgoing calls |

Requirement "nobody, not even the owner, can see original passwords or provider keys": a test fetches ~18 admin/public endpoints as the owner and asserts that none contains the password, hashes, TOTP seeds, the encryption key, provider keys or the session token, nor secret column names. Passwords/keys can only be **changed or rotated**.

## Not closed — be explicit
- **Automatic off-site backups are not possible from the application.** The owner can export an encrypted copy by hand and Railway volume backups must be configured separately. A scheduled off-site copy needs storage credentials that were not provided.
- **Images/audio**: metadata is stripped, but what is *visible or audible* is still sent once the visitor consents. Client-side cropping/blurring, refusing documents, and audio redaction are not implemented. The consent text must tell visitors not to photograph IDs, screens with passwords or faces.
- The AI sanitiser is pattern-based (best effort), not a guarantee.
- Old snapshots taken before the legacy migration still contain plaintext; delete them after verifying.
- Not tested against real providers or the production Railway environment.

## Deployment notes
New optional variables: `AI_PROVIDER_DAILY_LIMIT`, `AI_DAILY_ATTEMPT_LIMIT`, `AI_IMAGE_DAILY_LIMIT`, `AI_AUDIO_DAILY_LIMIT`, `MEDIA_HOURLY_LIMIT`, `INQUIRY_RETENTION_DAYS`. Behaviour changes: media endpoints need a same-origin browser request; inquiries need `ALLO_DATA_KEY`; the first login after enrolment needs the *next* authenticator code. Test-only knobs (never in production): `ADMIN_RATE_SCALE`, `ADMIN_TOTP_WINDOW`.
Order after deploy: create a verified snapshot → run the restore drill → "Chiffrer les données héritées" → export an encrypted copy off Railway.

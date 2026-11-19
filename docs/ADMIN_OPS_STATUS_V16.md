# ALLOSERVIX V16 — Operational status ("État du système")

Page `/admin/#system`, permission `system.status` (owner, manager). Everything is derived from the running application; **no secret value, no customer data** is ever returned (a test asserts this against the real environment values).

## What it shows
- **Runtime/storage**: uptime, Node version, memory, DB + WAL size, free disk, writable data dir, `PRAGMA quick_check`, table row counts.
- **Traffic (last 24 h)**: requests per hour, 2xx/3xx/4xx/5xx, p50/p95 latency. *In memory — reset on every restart.*
- **Errors**: 5xx are persisted (max 500 rows) with route normalised (ids → `:id`) and message redacted (emails, phones, hex ids, `password=`/`token=` values).
- **Environment**: presence flags only (`ALLO_DATA_KEY`, `OPENAI_API_KEY`, …), never values.
- **Checklist of unfinished/unverified items** (critical / to do / info): missing data volume, missing encryption key, bootstrap credentials still active, single owner, unconfirmed public contacts, no service confirmed "Disponible", no technicians, features switched off (requests, inquiries, analytics, AI), AI enabled without a key, error bursts, no/old verified snapshot, off-volume backup not verifiable, sessions in memory.
- **Domain check**: for `PUBLIC_DOMAINS` (default `alloservix.ma,www.alloservix.ma`) the server reports DNS A/CNAME/CAA, performs a **strict** TLS handshake and, only if it is valid, requests `/health` (status, `x-railway-fallback`, Cloudflare presence). If the certificate is invalid it completes a *diagnostic* handshake (no HTTP request sent, nothing trusted) to show which certificate is presented. Verdicts: `ok`, `expiring`, `certificate_invalid`, `routing_missing`, `unreachable`, `tls_error`, `http_error`, `unexpected_response`. The vantage point is the server's own network.
- **Snapshots** (owner, step-up re-authentication): `VACUUM INTO` copy in `DATA_DIR/backups`, mode 0600, verified with `integrity_check` and row-count comparison, 5 newest kept (only files matching `alloservix-YYYYMMDD-HHMMSS.sqlite` are ever deleted). No download endpoint. Restore is a manual operation (stop service, replace the file, restart).

## Limits (do not present as done)
- Snapshots live on the same volume: they protect from logical mistakes, **not** from loss of the volume. Railway volume backups remain necessary and cannot be verified from the app.
- No push alerts / e-mail / on-call integration; alerts are visible only when someone opens the page.
- Domain check cannot see the edge's internal certificate-issuance state ("Validating Ownership"); it reports only what a client would observe.
- Metrics are per process (single replica with SQLite).

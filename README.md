# ALLOSERVIX — V2 preview (private beta)

A mobile-friendly French-first services site with Arabic service summaries, searchable catalogue (32 services / 10 groups), private administrator dashboard, opt-in analytics and catalogue-grounded visitor assistant.

**Staging only. This is NOT an approved public launch.** All services start `Sur étude` until the team confirms capabilities and availability. Never describe the project as a registered company before it exists.

## Included features

- 32 service pages plus a public keyword catalogue and client search.
- Administrative panel at `/admin`, gated server-side by a password and TOTP authenticator code. Only **one administrator** is currently supported; team roles and account recovery are a future iteration.
- Editable service descriptions, statuses, publication flags, contact details, and audit log.
- Catalogue-matched visitor helper answers in French/Arabic. AI vendor integration requires opt-in and explicit environment configuration; off by default. The default engine is deterministic matching, not a generative model.
- Analytics, consent banner, campaign codes, top viewed pages and last section (approximate) **only if ENABLE_ANALYTICS=true and the visitor consents**. Search/event metrics record coarse event labels, **not free-form questions**. Analytics off by default.
- Inquiry storage off by default until privacy disclosure and retention plan are approved.

## Develop and test

Requires Node 22+ (built-in SQLite). Run:

```sh
npm test
npm start
```

Open `http://localhost:3000`. Do **not** publish without review. Static service pages are placeholders and are updated in the browser from the database; if JavaScript is disabled, placeholder content may be shown. This is not a final SEO or SSR implementation.

## Railway preview deploy

1. Create an independent Railway project and deploy this repository using the included `Dockerfile`.
2. Set `NODE_ENV=production` and `DATA_DIR=/data` and attach a persistent volume mounted at `/data` **before** editing any content. Do not use multiple replicas with a SQLite file.
3. Do not set `ENABLE_ANALYTICS`, `ENABLE_INQUIRIES`, or `ENABLE_AI` initially: they default to disabled. Do not point `alloservix.ma` here until content, legal pages, verified contact details and security review are approved.
4. The management interface returns `administration non configurée` until the three secrets `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, `ADMIN_TOTP_SECRET` are installed in Railway's private Variables settings. Generate these locally with `npm run admin:setup`; never commit, paste into ChatGPT, screenshot, or email secrets. Add TOTP secret to an authenticator app. The initial admin is intentionally disabled for public previews.
5. To enable optional external AI after review, add `ENABLE_AI=true`, `OPENAI_API_KEY` and optionally `OPENAI_MODEL` (default `gpt-4.1-mini`). It requires a separate visitor opt-in. Never send passwords or confidential client information in the question box.

## Limitations and prerequisites

- No user roles / multi-user management, email notifications, file uploads, passwords resets, invoicing, or full bilingual UI yet.
- Data persists only with Railway storage volume. In-memory sessions are invalidated on restart.
- Analytics are opt-in estimates, not exact visitor identification. No raw search questions are persisted as events.
- Contact data has not been verified; public quote requests and WhatsApp actions stay limited.
- `robots.txt` disallows crawling and pages carry `noindex` until final publication.
- Perform security, privacy, accessibility, mobile, load, backup/restore, DNS and SSL checks before production launch.

## V3 Moroccan experience — isolated preview

**New preview path:** `/experience/index.html` (does **not** replace `/`). Modern solution-navigation experiment designed for Moroccan visitors: choose type of need, describe it in FR / Arabic / Darija / EN, review catalogue-matched suggestions, then prepare a request locally. It uses the same protected V2 backend and the existing catalogue, without exposing the admin. No automatic visitor analytics or external AI in the V3 page. The preview is `noindex`.

Full scope, what works, constraints, QR marketing scenarios and prioritized roadmap: [`experience/V3_PLAN.md`](experience/V3_PLAN.md).

Run `npm test` before any release. A full real-browser visual QA remains required prior to replacing the home page; a previous environment blocked Playwright browser navigation to localhost, and no mobile visual QA should be claimed as complete.
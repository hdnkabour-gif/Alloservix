# ALLOSERVIX – Intelligence V12: intent-only provider routing

## Principle (enforced in server.js)

ALLOSERVIX is the **only** source of final customer guidance, service titles, descriptions, URLs, follow-up workflow and budget disclaimers. Outside models may **not** author any visitor-facing answer, set a price, assign a technician, add a service, promise availability or approve a request.

External providers can only offer structured intent classification (`topic`, `action`, `confidence`), candidate slugs from the live published catalogue and identifiers of ALLOSERVIX-controlled questions (`context`, `detail`, `goal`). All fields are validated and unknown IDs discarded. Original catalogue-grounded answers remain unchanged.

## Provider setup

No API key and no `ENABLE_AI=true` means **100% deterministic, offline-from-model** operation. Existing site routes work normally without credentials.

To enable the optional feature after privacy and cost review, set private Railway variables:

- `ENABLE_AI=true`
- `AI_PROVIDER_ORDER=openai,gemini,anthropic,deepseek` (change order as desired)
- `OPENAI_API_KEY`, `OPENAI_MODEL` (default `gpt-4.1-mini`)
- `GEMINI_API_KEY`, `GEMINI_MODEL` (default `gemini-2.5-flash`)
- `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (default `claude-haiku-4-5`)
- `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL` (default `deepseek-chat`)
- `AI_DAILY_LIMIT=40` (0 disables calls; hard cap 500)

Only configure providers with verified API billing/limits. This is **API usage**, not ChatGPT/Claude consumer subscription access. Secrets must never appear in source code, client JavaScript or public pages.

## Request flow

1. Visitor describes need (French/Arabic/Darija/English); ALLOSERVIX runs its local deterministic engine.
2. External model call happens **only if** site feature is enabled, at least one provider key is configured, daily quota remains and visitor deliberately consents to transmitting their description.
3. Server redacts common contact information and secrets before transfer; this is best-effort, **not a guarantee** that arbitrary personal/sensitive information cannot be transmitted. Do not request identity documents, passwords, medical data, or confidential content in the assistant.
4. Try configured providers in order, with per-provider 4.5-second timeout, failure isolation and a short circuit-breaker. If all fail or produce invalid JSON, use local ALLOSERVIX matching.
5. Validate every external field, match service slugs against approved/published catalogue, offer up to 3 questions only from curated wording and answer options.
6. Final answer, services, costs, human-validation statement and dispatch policies remain ALLOSERVIX-owned.

The V9 landing page offers optional consent-based refinement after showing local results. V8 also supports opt-in refining and can display up to three questions. No upload/photo/audio goes to these model APIs.

## Test/rollout gates

- `npm test` must pass; CI should pass on the PR and `main`.
- Keep `ENABLE_AI=false` in Railway until CNDP/privacy review, provider DPA/retention review, billing alerts and user-consent UI review are approved.
- Validate Arabic/Darija/French, false matches, user refusal, provider outage/429/500/timeout, provider quota exhaustion and prompt injection; do real API sandbox checks with test keys before enabling production.
- Keep `ENABLE_REQUESTS=false` until existing admin/MFA, customer encryption key, retention, backups and legal notices are ready.
- ALLOSERVIX technician vetting, assignments, quotes, payment and completion remain human-governed.
- SSL/custom-domain troubleshooting is separate; no DNS or production deployment change is performed by this feature branch.

## Actual catalogue status and backlog

The checked-in catalogue has **100 draft services across 13 groups**, all marked `Sur étude`. This count is not a guarantee of availability. Before adding new services, admin must review duplicates, team capability and safety/regulatory requirements.

Remaining work: V11 Knowledge Studio draft/review flow for adding missing services and verified multilingual synonyms, role-based admin accounts, privacy-compliant uploads, fully unified V9 clarification UI, customer contact readiness, secure support workflow, backups/restore test, and custom-domain HTTPS.

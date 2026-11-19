# ALLOSERVIX V18 — Brain monitoring ("Cerveau & IA")

Page `/admin/#intelligence`, permission `ai.monitor` (owner, manager). The monitored "brain" is the deterministic intent engine plus the optional, consent-gated external *intent-only* providers (see `docs/AI_INTENT_ONLY.md`). Nothing here changes how the assistant answers.

## What is recorded, and what is not
Live traffic (`brain_calls`, 90 days): language, query-length bucket, detected topic/action, number of matches, top service slug + score, confidence bucket, clarification question ids offered, number of answers supplied, AI outcome (`not_requested | ok | failed | quota_exhausted | disabled`), provider, engine latency. Photo/audio calls: outcome and provider only.
**Never stored by default: the visitor's text.** A test inspects the SQLite file after real assistant calls and fails if the text (or the audit/error logs) contains it.

Provider calls (`ai_provider_events`, 90 days): provider, usage (text/image/audio), ok/error class (`http_429`, `http_5xx`, `timeout`, `network`, `invalid_output`, `circuit_open`), latency, tokens when the vendor returns them. Daily calls come from the existing `ai_usage` table. **Cost is not computed** (no price table is guessed).

## Accuracy: measured on an evaluation set, not on customers
`brain_eval_cases` holds staff-authored phrases with the expected topic and/or service. "Run evaluation" replays them through the real engine (with approved knowledge) — no external call, no cost — and stores topic accuracy, top‑1, top‑3, unmatched phrases, per-language results and **regressions vs the previous run**. Cases are added by staff (`knowledge.edit`); phrases containing an email/phone are refused; cases are deactivated, never deleted.
The initial 41 cases come from the repository's regression tests plus 7 deliberate *known‑gap probes*. First measured run (19 Nov 2026): 36/41 passed, topic 95 %, right service first 71 %, in top 3 77 %; failing: "my printer is broken", "tbe3a ma kat tba3ch", "I need a website for my shop" (no match), an Arabic printer phrase (wrong service ranked first), "شنو هو Microsoft Azure" (right service only 2nd). These are **not** customer accuracy figures.

## Confidence buckets
`high ≥ 70`, `medium ≥ 45`, `low < 45`, `none` = no match (the visitor then gets guided questions, never an invented answer).

## Clarification questions
Counts of calls that were offered `context` / `detail` / `goal` / `budget`, and refinement calls carrying answers. Calls are unlinked (no visitor id), so the follow-up rate is an estimate and the page says so.

## Opt-in capture of unmatched phrasing — OFF
Requires `BRAIN_CAPTURE_UNMATCHED=true` **and** `allow_improvement:true` sent by the visitor's client (the public site does not send it today). Text is redacted, ≤ 300 characters, kept 30 days, visible only to roles with `inquiries.read`. Do not enable before the CNDP/privacy review and a consent checkbox exist.

## Limits
- Metrics describe the deterministic engine; the answer quality of external models is not judged (they only classify).
- No alerting; the page must be opened. In-memory circuit breaker state resets on restart.
- The evaluation set is small and partly tests-derived: grow it with realistic, fictional phrases.

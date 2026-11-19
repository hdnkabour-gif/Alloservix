# ALLOSERVIX V13 — Multilingual, voice and photo understanding

**Core boundary:** ALLOSERVIX alone selects services, provides answers, asks questions from reviewed wording and manages the request. External models classify text, observe predefined device categories/signs in images, or transcribe audio. They never create services, assign technicians, invent guarantees or approve prices.

## Text (operational without external providers)
- Arabic, Darija (Arabic writing and Latin/Arabizi), French, English and mixed-input augmentation in `language-understanding.js`.
- Local matching still operates when external AI is off or every provider fails. No user input is automatically sent externally.
- Up to three clarification questions. Unknown/low-confidence situations should seek clarification, not invent diagnoses.
- See `tests/multilingual-intent.test.js` and add anonymized examples as new regression cases after observing real misunderstandings with explicit privacy permission.

## Voice
- Browser speech dictation on the V9 main page: user selects Arabic Moroccan, French or English. Browser support and accent accuracy vary; users must review/edit transcription.
- Optional Cloud audio transcription endpoint `POST /api/public/transcribe-audio`, explicitly consented. Uses OpenAI, then Gemini on outage (when configured); input formats WAV/WebM/MP4/Ogg, strictly checked, <=1.4 MB.
- Browser voice engines may use remote services; consent message explains this. A single short recording is processed ephemerally with no database/file storage.
- Voice may miss mixed-language and specialist names; manual correction is always available.

## Image
- Optional `POST /api/public/understand-image`, after explicit visitor opt-in. Selected photo is re-encoded through browser canvas to JPEG, removing usual EXIF metadata before upload.
- Gemini → OpenAI → Anthropic availability fallback (only configured providers; DeepSeek is not assumed vision-capable).
- Images are transient, allowed JPEG/PNG/WebP only, content signatures and base64 checked; server cap <=1.2 MB, at most 8 requests/hour/client. No raw image kept in SQLite.
- External model output is whitelisted: device codes, symptom sign codes and confidence only. It cannot send a customer-facing answer. The server generates an editable suggestion; the visitor confirms it before normal ALLOSERVIX search. Photos are not proof of a technical diagnosis.
- Avoid photographs containing personal IDs, faces, documents, addresses, passwords or business secrets.

## Railway safe non-secret variables
Required operational variables already present in production (verify without overwriting): `NODE_ENV`, `DATA_DIR`, `ALLO_DATA_KEY`, `ENABLE_REQUESTS`, `ENABLE_INQUIRIES`, `ENABLE_ANALYTICS`, `ENABLE_AI`. Preserve volume `/data`.

Additional configuration to add without inserting fake secrets:
- `AI_PROVIDER_ORDER=openai,gemini,anthropic,deepseek`
- `AI_DAILY_LIMIT=40` (shared text+photo+audio model calls; 0 disables)
- `ENABLE_IMAGE_INTENT=false`
- `ENABLE_AUDIO_TRANSCRIPTION=false`
- `OPENAI_MODEL=gpt-4.1-mini`
- `GEMINI_MODEL=gemini-2.5-flash`
- `ANTHROPIC_MODEL=claude-haiku-4-5`
- `DEEPSEEK_MODEL=deepseek-chat`
- `OPENAI_TRANSCRIBE_MODEL=gpt-4o-mini-transcribe`

**Secrets missing from the current Railway variable-name inventory**:
`OPENAI_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, plus `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, and `ADMIN_TOTP_SECRET` needed for the existing administrative panel. Never populate these with fake placeholders or copy secrets into source code / chats. Admin password hash/TOTP must be generated and stored with a secure onboarding procedure. Actual vendor API calls must be tested after verified keys, billing limits and user privacy disclosure.

The read-only admin endpoint `GET /api/admin/ai/status` (after MFA) reports only provider-key **presence**, feature enablement and aggregate daily usage. It never exposes credentials.

## Security, operational and legal rollout gates
1. Keep external features off by default. Confirm third-party processing agreements and Moroccan privacy/CNDP compliance and meaningful user consent before enabling.
2. Verify model accessibility, endpoint schema, account billing and real Darija/English/French accuracy with paid sandbox keys. Current automated tests mock providers; **real API calls have not been validated**.
3. Test Android/iOS camera permissions, browser dictation/MediaRecorder, large images, low-light/unclear photo, offline mode, expired API credit and multi-provider outage on real devices.
4. Test admin MFA, persistent data, backup/restore and safe admin creation before permitting real customer requests.
5. Do not claim 100% recognition; prefer uncertainty and human review for complex/unsafe cases.
6. The public domain HTTPS issue remains separate. Do not alter Cloudflare DNS as part of AI rollout.

## Acceptance tests
`npm test` (Node 22), GitHub Actions, Railway deploy and public HTTP health checks. For browser checks visit `/constellation-v9/index.html`. For protected admin use `/admin/`, then `/brain-studio/`. For requests use `/request-v10/` only after explicit activation.

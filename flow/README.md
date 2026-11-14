# ALLOSERVIX V5 — Parcours à votre rythme (preview)

**New isolated route:** `/flow/index.html`. The old home page, V3, V4 and `/admin` remain unchanged. This page is `noindex,nofollow` until approved.

## Three equally valid journeys
- **Express:** one short question, catalogue-grounded service results and an optional summary.
- **Guidé:** three small, picture-first steps that do not require typing; optional on-device text-to-speech for supported browsers/voices.
- **Découverte:** searchable and filterable catalogue with separate detail dialogs for deeper reading.
- **Passeport Solution:** local-only text draft. The visitor can choose to copy, save, print PDF or actively share to the verified configured WhatsApp number (if any).

The app uses a single visible scene, a persistent bottom navigation on mobile and desktop side navigation, back/forward browser history, and localized French/Arabic display. It accepts mixed Moroccan Darija keywords and technical terms, but uses deterministic matching, **not AI diagnosis**. The interface is accessible without an account.

## Security and privacy
- Fetches only the published service catalogue from `/api/public/catalog`.
- Never sends raw visitor needs to the server during the journey.
- Does not turn on analytics, cookies, external AI, microphone capture or lead collection.
- Does not invent service availability, engineering measurements, equipment quotes, or prices.
- Admin API remains server-side session-protected, separate from all public flows.
- Voice reading relies on the visitor's device and may be unavailable or imperfect in Moroccan Arabic. A text and image fallback always exists.

## Test plan
- `npm test` (Node built-in tests including V5 assertions).
- Browser smoke: desktop 1440×900, mobile 390×844, small mobile 320×640; initial state, Express search `بغيت برنامج للمبيعات والمخزون`, browser Back, guided pictogram journey, Arabic RTL switch, catalogue detail, unauthenticated admin returns 401.
- Confirm no horizontal overflow, no page-level scrolling, and no JS errors. Some scenes can scroll **inside their own content area** when the viewport is small or text is enlarged.

## Next improvements (not claimed complete)
- User validation of pictogram comprehension and on-device Arabic speech; improve voice accents and optional recording only with opt-in/consent.
- True semantic understanding/AI with guardrails and rigorous Darija testing, only with privacy notice and consent.
- Full-service coverage and content governance; safe team-managed taxonomy, FAQs and reading levels.
- Accessible field studies with real Moroccan users, including older adults, non-tech users and people with reading difficulties.
- Genuine lead request flows and consented marketing analytics, after legal/privacy setup.
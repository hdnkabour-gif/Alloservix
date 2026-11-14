# ALLOSERVIX Constellation V9 — private visual preview

Preview path: `/constellation-v9/index.html`. This is **not** the public homepage or a legally registered company announcement.

## Scope

- Responsive desktop/mobile experience using dedicated ALLOSERVIX artwork and original SVG emblem.
- FR and Moroccan-Arabic copy written for intent and tone (not word-by-word translation).
- One-screen navigation: Home, Express, Guided, Clarifying question, Results, Services catalogue and Approach.
- Real service catalogue from `GET /api/public/catalog`; no duplicate static service source.
- Grounded recommendations from existing `POST /api/public/assistant` with `allow_external_ai:false`.
- Question flow limited to at most two steps, with skip and back, and fallback if the server is unavailable.
- Exportable Passeport Solution by copy and browser print; **no request submitted or contact recorded automatically**.
- Existing staff login via `/admin`, with no new admin exposure.
- Campaign URL tag `?src=flyer`, `?src=sticker` or `?src=business-card` is parsed only locally in preview.

## Current boundaries

- This is a functional visual preview, not a completed AI diagnosis or a quoting/booking/payment system.
- When enabled, external AI should only classify intent and extract entities into a validated schema; the website must generate answers from verified internal services. V9 deliberately keeps external AI disabled.
- Service availability, equipment, prices, warranties and industrial/fire safety work require expert validation.
- Business phone/email are not confirmed. No live contact form or automated WhatsApp sending.
- Artwork is decorative; mockup photos are illustrative, not evidence of ALLOSERVIX client projects.
- Language toggle initially supports French and accessible Arabic; deeper Moroccan-Darija variations remain to test with local participants.
- Do not set as homepage until public contact details, legal notice, domain and permissions have been reviewed.

## Tests

- `node --check constellation-v9/app.js`
- `node --test constellation-v9/experience.test.js`
- Browser simulation with local API fixtures at desktop 1440px, mobile 390px and small 320px, ensuring no horizontal overflow, working inquiry/results/catalogue/language switching. Real production HTTPS URL still requires external verification after deployment.

## Safety

- User-input text is always added with `textContent`, never interpolated into HTML.
- No client-side API key or shared secret.
- API request body has only the question and `allow_external_ai:false`; the current backend performs grounded matching.
- Preview assets are same-origin, no tracking scripts.

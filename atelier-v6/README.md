# ALLOSERVIX — Atelier V6 (maquette interactive, déploiement d'essai)

A polished new visitor-facing experience for ALLOSERVIX, designed for Moroccan visitors, with a clear interface, no long mandatory scroll, and five compact scenes: Accueil, Express, Guidé, Explorer, and Passeport Solution.

## Route
`/atelier-v6/index.html` (intentionally distinct from the existing homepage, `/flow`, `/lab`, and `/admin`).

## Principles
- Responsive mobile-first progressive disclosure. Desktop brand stage with a contextual illustration; fixed bottom nav on mobile.
- Simple path for users seeking fast answers, pictogram-guided steps for low literacy/digital literacy, and in-depth catalogue for readers.
- French and Arabic RTL UI. Moroccan/Darija keyword aliases in catalogue matching; does **not** claim to be an AI chatbot or guarantee accurate diagnosis.
- Publishes content only from `/api/public/catalog` (with `/assets/services.json` fallback), respecting published-service status. No invented service availability.
- Client-only project summary (Passeport Solution), explicit clipboard/print actions. Professional WhatsApp button only when verified config enables it.
- No visitor events, analytics, microphone recording, geolocation, or personal-information collection in this preview.
- Spoken prompts on direct user click use device `speechSynthesis`; availability and pronunciation depend on device/browser voices.
- CSS-native animations, accessible reduced-motion support, keyboard interactions (Ctrl/Cmd+K to jump to quick search), focus outlines, and responsive layouts.
- `noindex,nofollow` on preview page; not a public claim that a company is already legally registered.

## Test
`node --test tests/*.test.js`; V6 statics run alongside existing API/security tests.
A Playwright test using injected HTML/CSS/JS and catalogue data is also run locally when `http://localhost` navigation is prohibited by the browser runner; verify real deployment separately.

## Before moving this to the main entry point
1. Validate actual contacts, firm status, real service capability and prices, legal pages and logo/brand.
2. Test accessibility with real Moroccan users, mobile networks, and voice availability. Arabizi/Darija aliases need expansion with real examples.
3. Add a genuine AI engine only after security review, source grounding, privacy disclosure, cost controls and explicit user action.
4. Confirm Railway deployment, secure admin setup, backups and correct Nindohost DNS before applying `alloservix.ma`.
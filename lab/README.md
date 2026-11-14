# ALLOSERVIX Solution Lab — V4 preview

**Status: preview only; public launch has not been approved.**

## What's usable now

- Original FR/AR responsive interface with progressive need discovery and intent/audience selection.
- Darija / Arabic / French / English-keyword matching against currently published service catalogue.
- Interactive educational scenes for Wi-Fi rooms/access points, CCTV areas, business-software modules, and generic project priorities.
- Context-aware related services and detailed service modal backed by `/api/public/catalog`.
- A locally generated `Passeport Solution` draft, downloadable as text, printable/savable via browser PDF, and copyable.
- WhatsApp or mail handoff only if verified professional contacts are configured in the protected admin dashboard.
- Contextual campaign landing: `/lab/index.html?src=flyer`, `?src=sticker`, `?src=carte`, with optional `need=` text, without automatic tracking.
- All operations above run in the visitor's browser; only the published catalogue is fetched from ALLOSERVIX server. The visitor's entered question is not posted or saved during the journey.
- Existing `/admin` and V2/V3 site paths are unchanged.

## Limitations / honest presentation

- The visual simulations are **illustrative only**. There are no validated camera placements, Wi-Fi measurements, hardware requirements, equipment quotes or guaranteed project results.
- The guidance is a deterministic, catalogue-grounded suggestion engine in this preview, **not a full generative AI assistant**. Future AI requires its own consent, evaluation against Moroccan Darija, quota control, content guardrails, privacy review, and monitoring.
- The passport is a locally generated draft reference, **not a real tracked ticket**.
- The team must verify each service's scope and current status before publishing it as available. Current seed entries use `Sur étude`.
- The contact links are intentionally hidden until genuine verified coordinates have been configured. No sample contacts or unverified employer logos.
- This page has `noindex,nofollow` so the production domain/home page cannot be replaced accidentally.

## Test cases

Desktop / mobile, FR / RTL Arabic, and at least these needs:

1. `بغيت برنامج للمبيعات والمخزون` → software modules and possible catalogue entries.
2. `الويفي ضعيف فالدار` → room-selectable Wi-Fi demonstration.
3. `بغيت كاميرات للمحل` → zone-selectable CCTV demonstration.
4. `Microsoft 365 pour notre équipe` → generic IT project map and cloud-related services.
5. Unmatched request → explicitly unconfirmed feasibility, never an invented service.
6. Copy/Print/Save Passeport. Verify text never auto-stored by the server.
7. QR campaign query and direct service search in the service universe.
8. Unauthorized `/api/admin/overview` stays HTTP 401; strong existing MFA/CSRF required for actual admin.

Commands: `npm test` (Node built-in test runner). Railway: existing service auto-deploys branch `main` and serves `/lab/index.html` as an additional route. The root `/` remains unchanged.
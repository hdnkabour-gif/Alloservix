# ALLOSERVIX — Knowledge Studio V11 and catalogue gap review

Status: technical feature delivered as a separate pull request; no new service becomes public automatically.

## Current verified catalogue

100 services, 13 categories; all currently labelled **Sur étude**. No service should be promised as available, nor presented as a formally qualified specialist service without business review. Existing services cover PC help, printers, Wi‑Fi, wired networks, virtualization, Microsoft/Azure, IT security, apps, OCR, surveillance, access control, garage automation, home automation, TV/satellite/audiovisual, fire-system study, and equipment procurement.

## Knowledge Studio operational flow

- Admin logs into `/admin/` with MFA, then opens `/brain-studio/index.html`.
- Admin can create a **new service as hidden draft**. The draft is not published and its status is **Sur étude**. Publishing is a separate, explicit choice through the existing service editor after capability/legal checks.
- Admin can add FR, AR and Darija technical concepts with aliases: devices, needs, common customer vocabulary and symptoms.
- Admin links a concept to one or more **existing** service slugs with one of: synonym, problem, device, requires, related, applies_to.
- Two approvals are necessary before an alias affects public recommendations: concept approved **and** relation approved. Editing a concept revokes its approval. Archiving a link also removes its influence.
- Only the existing MFA session can access these JSON APIs; updates require CSRF and are recorded in the audit trail.
- External models cannot approve/publish knowledge, assign technicians, set prices or author answers. Their only permitted influence remains validated service IDs/curated question IDs.

## Candidate gaps to review (NOT offers or ready-for-sale services)

The following are **candidate drafts**. Their names, descriptions, qualifications, demand, tools, partners, and costs require team verification in Morocco before publication. Check duplicates and scope against existing broader services before creating a new slug.

| Candidate slug | Category | Possible FR label | User situations / scope to validate | Priority |
|---|---|---|---|---|
| telephonie-ip-standard | network | Téléphonie IP et standard d’entreprise | PBX/VoIP, postes SIP, call routing, remote offices | P1 |
| wifi-invites-hotellerie | network | Réseau Wi‑Fi invités et portail d’accueil | Guest segmentation, hospitality/shops, captive portal | P1 |
| supervision-centralisee-it | servers | Supervision centralisée de l’infrastructure | Cross-site alerts, asset health, uptime, incident routing | P1 |
| gestion-parc-mdm | it | Gestion centralisée des appareils professionnels | MDM enrollment, onboarding, device policy | P1 |
| maintenance-systemes-video | physical | Maintenance des systèmes de vidéosurveillance | Regular NVR/DVR checks, storage, remote connectivity | P1 |
| gestion-sauvegarde-cloud | security | Sauvegarde cloud sécurisée et tests de reprise | SaaS backup, recovery playbooks, off-site retention | P1 |
| maintenance-visioconference | audiovisual | Maintenance des salles de visioconférence | Audio/video room setup, mics, codecs, camera peripherals | P2 |
| rfid-inventaire-actifs | software | Inventaire des actifs par RFID/NFC | Asset tracking, labels, authorized equipment sourcing | P2 |
| integration-power-automate | ai | Intégration de flux Microsoft Power Automate | Approved connectors, notifications, process audit | P2 |
| reseaux-industriels-audit | network | Étude de réseaux industriels et OT | Authorized segmentation and diagnostics; specialist qualifications mandatory | P2 |
| support-terminaux-point-vente | it | Support des terminaux et postes de point de vente | Printers, peripherals, software connectivity, no payment-data handling | P2 |
| gestion-tickets-support-pme | software | Portail tickets et support pour PME | Client issue tracking, support SLA planning, approval workflow | P2 |

Avoid extending fire safety, biometric access, electrical installation or industrial control into actual field services until applicable specialist competence and insurance are documented. No public promises or automatic publication.

## Test and release gates

- CI: `npm test` on Node 22. Include tests for knowledge approval, link approval, alias influence on search, admin session and CSRF.
- Test admin journey manually in a browser before enabling real content editing. Initial admin configuration may be absent in the Railway environment.
- Test SQLite volume persistence and backup/recovery with a separate rollback plan. New knowledge is persisted in the same application DB, not a copy in an external AI service.
- Keep `ENABLE_AI`, `ENABLE_REQUESTS` and personal-data features off until explicit privacy, legal, credential and budget reviews.
- Always validate new service offerings and their certifications, working area, liability and safety requirements.
- Domain SSL troubleshooting is intentionally postponed until the requested feature work is verified.

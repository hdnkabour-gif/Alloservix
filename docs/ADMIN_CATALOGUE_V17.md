# ALLOSERVIX V17 — Catalogue governance

Admin page `/admin/#services` ("Catalogue"). Same `services` table; nothing is duplicated, nothing is deleted.

## Who can do what
| Action | owner | manager | technician |
|---|---|---|---|
| Read the list | ✓ | ✓ | ✓ (read only) |
| Overview, quality, duplicates, taxonomy, history, drafts (`catalogue.history`) | ✓ | ✓ | — |
| Propose a change (draft), submit/withdraw own draft, restore a past revision **as a draft** (`catalogue.edit`) | ✓ | ✓ | — |
| Edit live, approve/reject drafts, merge technologies, publish, change availability (`catalogue.publish`) | ✓ | — | — |

Breaking change vs V15: a manager's `PUT /api/admin/services/:slug` is now **403**; managers use drafts. Publication flags (`published`, `status`) can never be part of a draft.

## Draft → approval
`draft → pending_review → published` (or `rejected` → edit → resubmit, or `withdrawn`). A draft stores only the changed fields and the values they replaced. Approving:
- needs an owner (step-up re-authentication) — a manager can never approve, not even their own draft;
- **refuses with 409 `conflict`** (listing fields, current and base values) if the live service changed on those fields since the draft was written; the owner may force;
- applies atomically through `store.updateService`, which writes a revision `source=draft#<id>` with the approver as actor and the author in the note.

## Revision history
Every change to a service (direct edit, draft, taxonomy merge, Knowledge Studio creation) stores a full snapshot with actor, role, source, note and changed fields. A baseline is stored the first time a service is touched. History shows the diff vs previous and vs current; "restore" creates a **draft**, it never overwrites live content. No-op saves create no revision.

## Duplicate prevention
Titles (FR and AR) are normalised (accents, Arabic letter variants, case, stop words) and compared by token overlap. ≥ 85 % (or same slug/exact title) is refused with `409 duplicate` + candidates on: direct edit, draft submit/approve, Knowledge Studio creation. Only an owner can force (`force_duplicate`). 60–85 % produces warnings (live while typing in the editor).

## Languages, technologies, categories
- Coverage report: FR complete, AR present vs **written** vs **generic** (title + the standard "available for study" sentence). Measured on the seeded catalogue: 100 services, **68 with a generic Arabic description**, 13 technologies with several spellings.
- English and Darija are **not** modelled in the database; the page says so instead of inventing coverage.
- Technology merge (`taxonomy/merge`, owner, step-up): rewrites the variants across services, one revision per touched service, idempotent.
- Categories come from `assets/services.json`; `category` is now editable per service (validated against that list).

## Not done
- No bulk import/export, no scheduled publication, no per-field translation workflow, no image/media management.
- Creating a brand-new service still goes through Knowledge Studio (hidden draft service, duplicate-checked, revision `created`).

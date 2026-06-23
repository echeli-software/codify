# 18 — Marketing, certificates, capstones, referrals (Phase 13)

Top-of-funnel + social proof: a public marketing site, certificates of
completion with a verifiable URL, capstone courses, and referral share links.

## Marketing site

Public, unauthenticated pages live **outside** the student app's auth-guarded
shell (siblings of `/login`):

- `/welcome` — landing: hero, feature highlights, pricing tiers, CTA into
  sign-up.
- `/verify` + `/verify/:serial` — public certificate verification.

(Served from the student SPA for this build; a dedicated marketing host can
take the same routes later without API changes.)

## Certificates of completion

Issued when a learner finishes **every** (non-deleted) lesson in a course.

- Data: `Certificate` snapshots `recipientName` + `courseTitle` at issue time
  (stable if the name/title later change), a unique public **serial**
  (`CDFY-XXXX-XXXX`, ambiguous I/O/L dropped), and `isCapstone`. One per
  user+course.
- Pure logic in `@codify/domain` (`certificates.ts`): `isCourseComplete`,
  `formatSerial`, `isValidSerial`.
- `POST /certificates/claim { courseId }` issues idempotently once complete
  (404 if not, 400 if incomplete); `GET /me/certificates` lists them.
- **Verifiable URL:** public `GET /certificates/:serial` (JSON) +
  `.../image.svg` (a branded, server-rendered SVG — shareable/printable).
- Student UX: a "Get your certificate" button appears on a 100%-complete
  course; earned certificates + their verify links show on the profile.

## Capstone courses

`Course.isCapstone` flags a curated, multi-lesson project; its certificate is
labelled a **Capstone Certificate**. Settable via the admin course API
(`PATCH /courses/:id { isCapstone }`).

## Referrals

Each user gets a lazily-generated `referralCode` and a share URL
(`/r/:code`); `GET /me/referral` returns the code, link, and how many users
joined with it (`User.referredById`).

## Verification

- `phase-13a-certificates.mjs` (12) — claim-before-complete → 400, issue on
  completion with snapshots, idempotent re-claim, public verify valid/invalid,
  SVG content-type + content, stable referral code.
- `phase-13-browser.mjs` (7) — public `/welcome` renders with no auth, a real
  certificate verifies at `/verify/:serial` (recipient + embedded image),
  bogus serial → "not found".
- 73 domain unit tests; 7 builds + 13 test projects green; drift-free.

## Deferred

- A dedicated marketing host/CMS, SEO/OG metadata, and real OG share images.
- Email/social referral attribution + rewards for successful referrals.
- PNG/PDF certificate rendering (the SVG is the canonical artifact here).

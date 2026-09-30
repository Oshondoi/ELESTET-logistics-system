# Frontend Shell

## Request workflow update — 30.09.2026

- Local request UI adds rejected-request reassignment, single-device correction drafts and flush-on-close. Intake catalog now searches actual selected-store products; HID/barcode entry and the camera/serial paths remain available.
- Invite password recovery uses an email OTP with `shouldCreateUser:false`, then changes the password of that same Auth account. SMTP remains an external deployment blocker; do not equate the mocked browser test with real email delivery.
- Party history defaults to `ConfirmedStepHistory` (confirmed snapshots); the pre-v42 row log remains available separately. Completed steps require explicit correction mode. Disabled steps stay hidden and future steps cannot be toggled via the progress bar.
- `tests/request-workflow.browser.mjs` passed with intercepted API responses. New frontend has not been published; current discussion is revision 67.

## Purpose
Defines the application frame:
- top header
- left sidebar
- main content switching
- creation modals mounting point

## Main File
- `src/App.tsx`

## Current Behavior
- React Router paths coexist with local active-page state; new request paths must not be redirected by general page synchronization.
- Sidebar switches among the application's current operational pages; it is not limited to `shipments` and `stores`.
- Main shell controls page selection and some modal mounting; request creation/editing belongs to the fulfillment panel.
- Local request routes: `/request-invite/:token` for the public link, `/my-requests` for independent pre-company reserves, and `/client-request` for the limited client mode. `App.tsx` holds pending-invite navigation across Auth/account loading. These local changes are not yet published to `elestet.net` (30.09.2026).
- layout includes:
  - left brand/sidebar area
  - company switcher block
  - flat top bar with current page title
  - content area with page-level action bars

## Page spacing rule (09.08.2026)
- The App content wrapper owns outer padding and vertical scrolling.
- Page roots should normally use layout gaps only, not duplicate `px-6/pt-*` and full-page `overflow-y-auto`.
- `/tz-prompts` was aligned with Diary/Admin/Finance by removing its duplicate page padding and nested scroll.

## Why It Matters
This shell is the UX backbone. If it becomes bloated or presentation-heavy, the app stops feeling like an operations system.

## Responsive sidebar rule (31.08.2026)

- Desktop keeps the left sidebar and allows the user to collapse it to an icon rail.
- Collapsed desktop mode shows `E`, navigation icons, and the bold short company ID (`C-{short_id}`).
- Desktop collapse has exactly one width owner: the explicit desktop wrapper in `App`. The inner `Sidebar` is always `width: 100%` and must not run a second width transition. The wrapper uses layout containment and `will-change: width`; labels animate only opacity/offset. Logo, company area, navigation rows, and footer actions keep identical heights in both states, so no block may jump or shrink vertically.
- Keep desktop navigation/footer rows at the original compact `34px`; mobile drawer rows stay `40px` for touch. Increasing desktop rows can force an internal scrollbar and make active buttons look narrower.
- Desktop labels stay mounted, use `white-space: nowrap`, are clipped by their containers, fade out before closing, and fade in only after the rail has opened far enough. Do not conditionally mount labels during the width transition.
- The collapse preference is persisted in local storage.
- Mobile hides the sidebar completely; a hamburger in the top bar opens it as an overlay drawer.
- The mobile drawer uses an opaque white background, `min(88vw, 340px)` width, and a compact logo/company header; page content must never show through the drawer surface.
- Page content uses the full available width whenever the sidebar is hidden or collapsed.

## Mobile dashboard rule (31.08.2026)

- Summary cards use a compact two-column grid on phones and return to four columns on wide desktop screens.
- Dashboard hints must be operational user-facing text. Database constraints, column names, and implementation notes never belong in dashboard cards.
- When there are no shipments, the dashboard says so instead of presenting a misleading next tracking number.

## Rules For Future Changes
- keep layout compact
- preserve the desktop sidebar and its collapsed mode
- avoid reintroducing giant page hero headers
- keep top bar flat, not card-like
- preserve the existing routing and visual shell when adding a page

# Frontend Shell

## Purpose
Defines the application frame:
- top header
- left sidebar
- main content switching
- creation modals mounting point

## Main File
- `src/App.tsx`

## Current Behavior
- local state chooses active page
- sidebar switches between `shipments` and `stores`
- modal visibility is controlled at app shell level
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
- if routing is added later, keep visual shell stable

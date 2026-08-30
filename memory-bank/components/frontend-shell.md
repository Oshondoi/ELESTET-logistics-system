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
- The collapse preference is persisted in local storage.
- Mobile hides the sidebar completely; a hamburger in the top bar opens it as an overlay drawer.
- Page content uses the full available width whenever the sidebar is hidden or collapsed.

## Rules For Future Changes
- keep layout compact
- preserve the desktop sidebar and its collapsed mode
- avoid reintroducing giant page hero headers
- keep top bar flat, not card-like
- if routing is added later, keep visual shell stable

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

## Why It Matters
This shell is the UX backbone. If it becomes bloated or presentation-heavy, the app stops feeling like an operations system.

## Rules For Future Changes
- keep layout compact
- preserve left sidebar
- avoid reintroducing giant page hero headers
- keep top bar flat, not card-like
- if routing is added later, keep visual shell stable

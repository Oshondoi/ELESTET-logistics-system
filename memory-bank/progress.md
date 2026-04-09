# Progress

## Current Status
Project is in early MVP stage.

## What Works
- Project scaffolding is complete
- Dev server runs successfully
- Tailwind styling is active
- Left sidebar navigation works
- Company switcher block and top bar layout exist
- Auth page works
- Session-gated app shell works
- Company creation works
- Company switching works
- Company deletion flow is wired
- Shipments page renders action bar, summary cards, and dense table
- Stores page renders action bar and store list
- Store and shipment flows are wired for Supabase reads/writes
- Supabase client bootstrap exists
- SQL schema exists for all requested entities and core logic

## What Is Not Yet Real
- No real role enforcement in UI
- No detail page for shipment
- Action bar search/filter controls are visual only

## Completed Decisions
- Use compact operational UI instead of oversized hero layout
- Supabase is the only runtime data source
- Use global unique `store_code`
- Use store-scoped `tracking_number`
- Record shipment status history
- Keep architecture ready for multi-account SaaS from the start

## Known Issues / Gaps
- Live Supabase still needs SQL verification in the user's project
- Some SQL patches now live outside `schema.sql` and must be applied manually in Supabase
- Current RLS design from `schema.sql` has recursion issues and is bypassed in dev
- UI polish is improving but not final
- No validation layer beyond simple field behavior

## Likely Next Milestone
Verify auth + company flow end-to-end, prepare deployment, and stabilize multi-company remote testing.

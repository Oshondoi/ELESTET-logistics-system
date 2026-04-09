# Active Context

## Current Focus
Refine the operational UI while keeping the app in strict Supabase-only mode and align auth/company flow with the real Supabase data model.

## What Was Recently Done
- Connected runtime to Supabase only; local mock fallback is no longer used in normal app flow
- Added working auth flow:
  - sign up
  - sign in
  - sign out
  - block app behind session
- Added company flow:
  - create company
  - company switcher in sidebar
  - active company persistence in `localStorage`
  - delete company RPC wiring and confirm modal
- Added SQL helper files:
  - `supabase/bootstrap.sql`
  - `supabase/dev_access.sql`
  - `supabase/disable_rls_dev.sql`
  - `supabase/delete_account.sql`
- Verified that the app can work against the real Supabase project after applying temporary dev SQL
- Reworked the UI toward a more mature SaaS look:
  - flat top bar
  - branded sidebar header
  - company switcher block in sidebar
  - denser action bars and metrics
  - more compact data tables

## Present UI State
- Left sidebar with:
  - brand area
  - company switcher block
  - primary nav for `Фулфилмент`, `Логистика`, `Магазины`, `Роли`
  - footer logout action
- Flat top bar with current section title and profile area
- `Поставки` page:
  - action bar
  - summary cards
  - dense operational table
- `Магазины` page:
  - action bar
  - compact stats block
  - store list table

## Immediate Next Steps
1. Finalize multi-company behavior and destructive actions UX
2. Verify real create flows for stores and shipments in Supabase with auth-based data access
3. Add true search/filter behavior to action bars
4. Prepare project for remote testing / deployment
5. Restore fully safe RLS after auth SQL patch is verified end-to-end

## Important Implementation Notes
- Runtime is Supabase-only
- `useAuth` handles session
- `useAccounts` handles company list and active company creation/deletion
- `useAppData` handles reads/writes scoped to active company
- The original RLS policies in `schema.sql` include a recursion issue around `account_members`; this is currently bypassed in dev using `disable_rls_dev.sql`
- Do not regress the compact operations-focused layout

## Active Risks
- The `create_shipment` SQL function should still be tested carefully for concurrency behavior
- RLS/auth design is not production-ready yet
- UI is materially better than before, but some controls may still need spacing and alignment polish

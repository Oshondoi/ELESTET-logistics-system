# Supabase Schema

## Main File
- `supabase/schema.sql`

## Covered Areas
- account-aware relational schema
- `store_code` generation
- shipment update timestamps
- arrival date auto-fill
- shipment creation RPC
- shipment status history trigger
- initial RLS policies
- FBS cached orders and sync metadata
- superadmin technical prompts and tasks

## `tz_tasks` (applied 09.08.2026)
- Patch: `supabase/patch_tz_tasks.sql`.
- Columns: `id uuid`, `text`, `is_done`, `position`, `completed_at`, `created_at`, `updated_at`.
- RLS enabled; CRUD requires `profiles.platform_role = 'superadmin'` for `auth.uid()`.
- Index keeps stable `position, created_at` ordering.
- Seed: `supabase/seed_tz_tasks_20260809.sql`, idempotent by exact task text.

## FBS tables
- `fbs_orders`: tenant/store cache of WB orders, unique `(store_id, wb_order_id)`; keeps raw data, WB statuses, supply relation and synchronized variant fields.
- `fbs_sync_log`: last successful store synchronization metadata.
- UI reads DB first; Edge Function `wb-fbs` refreshes from WB and upserts cache.

## Important SQL Patterns

### Store Code Generation
Implemented with `generate_store_code()` plus insert trigger logic.

### Shipment Numbering
Implemented through `create_shipment(...)` function:
- calculates next number per store
- inserts shipment
- writes initial history row

### Arrival Date Logic
`handle_arrival_date()` sets date only if:
- status is `Прибыл`
- `arrival_date` is null

This preserves manual editing.

### Status History Logging
`log_shipment_status_change()` writes append-only history when status changes on update.

## Risks To Revisit
- concurrency behavior of the shipment numbering strategy in live Supabase
- exact RLS coverage after auth is connected
- recursion issue in current `account_members`-based policies
- policy naming collisions if schema is rerun multiple times without guards

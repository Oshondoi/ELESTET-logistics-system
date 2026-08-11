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
- WMS warehouses, racks, sides, pallet positions, physical boxes and box contents
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

## WMS tables and RPC (applied 11.08.2026)
- Patches: `supabase/patch_wms.sql`, `patch_wms_boxes.sql`, `patch_wms_disabled.sql`, `patch_wms_rack_layout.sql`.
- `wms_warehouses`: account warehouse, FBS participation and optional WB warehouse link.
- `wms_zones`: one complete rack; stores pallet-position dimensions and visible upright configuration; database default is three tiers (`rows = 3`).
- `wms_zone_sides`: stable `code` (`S1`/`S2`), editable name and shared `slot_columns × slot_rows`; database allows at most two sides per rack.
- `wms_cells`: pallet positions such as `B3` with free/occupied/reserved/disabled state.
- `wms_cell_items`: product or physical box. A box has unique `barcode`, optional `side_id` and `slot_number`; uniqueness protects one box per K-place.
- `wms_box_contents`: products inside a physical box; moving the box does not rewrite this table.
- `save_wms_zone_layout`: atomically saves rack dimensions, uprights and sides; rejects removal/shrinking that would orphan occupied data.
- `move_or_swap_wms_box`: atomically moves a selected box to a free K-place or swaps two occupied K-places, including movement between the two sides of the same pallet position.
- Legacy boxes without `side_id`/`slot_number` remain valid and await manual placement.

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

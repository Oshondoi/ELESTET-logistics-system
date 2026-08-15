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

## WMS tables and RPC (applied through 15.08.2026)
- Patches: `supabase/patch_wms.sql`, `patch_wms_boxes.sql`, `patch_wms_disabled.sql`, `patch_wms_rack_layout.sql`, `patch_wms_scanning.sql`, `patch_wms_default_warehouse.sql`, `patch_wms_unassign_box.sql`, `patch_wms_operations.sql`.
- `wms_warehouses`: account warehouse, FBS participation and optional WB warehouse link.
- `wms_zones`: one complete rack; stores pallet-position dimensions and visible upright configuration; database default is three tiers (`rows = 3`).
- `wms_zone_sides`: stable `code` (`S1`/`S2`), editable name and shared `slot_columns × slot_rows`; database allows at most two sides per rack.
- `wms_cells`: pallet positions such as `B3`; `free/occupied` are derived from contents, while `disabled` is the only manual state. Legacy `reserved` is migrated to `disabled`.
- `wms_cell_items`: only an existing physical fulfillment box may be newly placed. A box has canonical `barcode`, required `fulfillment_box_id`, `side_id` and `slot_number`; uniqueness protects one box per K-place.
- `wms_box_contents`: products inside a physical box; moving the box does not rewrite this table.
- `save_wms_zone_layout`: atomically saves rack dimensions, uprights and sides; rejects removal/shrinking that would orphan occupied data.
- `move_or_swap_wms_box`: atomically moves a selected box to a free K-place or swaps two occupied K-places, including movement between the two sides of the same pallet position.
- `wms_movements`: append-only operational audit with actor, source and before/after addresses.
- `wms_inventory_sessions`, `wms_inventory_scans`: frozen expected-box snapshot and scan results for warehouse inventory.
- Operational RPC: `search_wms_locations`, `get_unaddressed_fulfillment_boxes`, `get_wms_supply_release_preview`, `set_wms_cell_disabled`, `start_wms_inventory`, `scan_wms_inventory_box`, `finish_wms_inventory`.
- `trg_release_wms_addresses_after_shipping` releases addresses when the linked Logistics line becomes `Отгружен`; it never deletes fulfillment boxes or contents.
- Legacy boxes without `side_id`/`slot_number` remain valid and await placement; cancelled or already shipped supplies cannot be newly addressed.

## Fulfillment supply numbers and box barcodes (applied 12.08.2026)
- Patch: `supabase/patch_fulfillment_box_barcodes.sql`.
- `fulfillment_supplies.supply_number`: positive, unique per `account_id`, allocated from one company-wide number space shared with logistics shipment numbers.
- `fulfillment_supplies.next_box_number`: next never-issued box number for that supply.
- `fulfillment_supply_number_registry`: permanent registry of issued company-wide supply numbers; deletion does not make a number reusable.
- `fulfillment_boxes.barcode`: required globally unique system code `EL_C{company}_P{batch}_S{supply}_B{box}`; maximum 30 characters is enforced during generation.
- `fulfillment_box_barcode_registry`: permanent tombstone registry of issued box numbers/barcodes. A deleted box code can never be assigned again.
- Database triggers generate both identifiers, validate tenant consistency and align `trip_lines.shipment_number` with the linked fulfillment supply.
- `add_trip_line(..., p_fulfillment_supply_id)` links the supply atomically and reuses its number; ordinary logistics lines continue receiving the next free number in the shared company sequence.
- Backfill verified in production: all 87 supplies numbered; all 1982 boxes have unique barcodes.

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

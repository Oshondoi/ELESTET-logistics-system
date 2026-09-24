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
- superadmin technical prompts, tasks and versioned discussions

## `tz_tasks` (applied 09.08.2026)
- Patch: `supabase/patch_tz_tasks.sql`.
- Columns: `id uuid`, `text`, `is_done`, `position`, `completed_at`, `created_at`, `updated_at`.
- RLS enabled; CRUD requires `profiles.platform_role = 'superadmin'` for `auth.uid()`.
- Index keeps stable `position, created_at` ordering.
- Seed: `supabase/seed_tz_tasks_20260809.sql`, idempotent by exact task text.

## `tz_discussions` and revisions (applied 24.09.2026)

- Patches: `supabase/patch_tz_discussions.sql` and `supabase/patch_tz_discussion_item_states.sql`.
- `tz_discussions` stores the current materialized answer: stable `discussion_key`, title, content, `active/completed` status, monotonically increasing `revision_no`, ordering, timestamps and `item_states jsonb`.
- A partial unique index permits at most one row with `status='active'` across the service.
- `tz_discussion_revisions` is the immutable history saved automatically before each material update. It keeps the previous revision number, title, content, status, completion time, saved time and exact agreement states.
- The archive trigger increments `revision_no` and preserves changes caused by text edits, completion/restoration and agreement toggles. The frontend therefore finds the prior **different content**, not merely revision `N-1`, when calculating which blocks/rows are new.
- `item_states` is constrained to a JSON object and maps deterministic UI keys to the value `agreed`; absence means `В обсуждении`.
- RLS is enabled on both tables. Read/write access requires `profiles.platform_role='superadmin'` for `auth.uid()`.
- Both patches were applied to production before the dependent frontend was pushed. The initial active architectural answer was seeded and later extended in revision 4 with the ready-box reception mode.

## FBS tables
- `fbs_orders`: tenant/store cache of WB orders, unique `(store_id, wb_order_id)`; keeps raw data, WB statuses, supply relation and synchronized variant fields.
- `fbs_sync_log`: last successful store synchronization metadata.
- UI reads DB first; Edge Function `wb-fbs` refreshes from WB and upserts cache.
- `get_fbs_product_locations(uuid, text[])`: пакетный read-only поиск точного товарного баркода по актуальным fulfillment-коробам. Актуальная сигнатура дополнительно возвращает `fbs_eligible`: legacy-короба без назначенного FBS-склада остаются видимыми, но недоступны для взятия/приёмки.

## FBS bound stock (applied 11.09.2026)

- Patch: `supabase/patch_zzzz_fbs_bound_stock.sql`.
- `fbs_stock_allocations`: активная единица уже удалена из `fulfillment_box_items.qty`; `reserved/awaiting_wb` означают подэтапы привязки, `consumed/released` — два закрывающих результата.
- Новые поля аудита: `stock_removed_at`, `source_wms_warehouse_id`, `returned_box_item_id`, `returned_box_id`, `returned_wms_warehouse_id`, `returned_by`, `return_note`, `requires_review`, `review_reason`.
- `reserve_fbs_order_from_box`: атомарное взятие/смена исходного короба с немедленным изменением `qty` и проверкой `fbs_enabled`.
- `receive_fbs_order_bound_stock`: идемпотентная ручная переприёмка активной единицы в выбранный или отсканированный целевой FBS-короб; поддерживает создание строки SKU в другом коробе.
- `reconcile_fbs_stock_allocation`: отмена не освобождает привязку, поштучная приёмка WB закрывает её без второго изменения `qty`, позднее подтверждение после ручного возврата создаёт флаг проверки.
- `get_fbs_stock_catalog_for_warehouse`: источник `Подставить из ELESTET` по точному внутреннему складу; возвращает количество в коробах, активные привязки и количество legacy-остатка без склада.
- Production conversion: 172 активные старые привязки имели существующие источники и достаточное количество, все получили `stock_removed_at`; отрицательных строк после применения — 0.

## WMS tables and RPC (applied through 15.08.2026)
- Patches: `supabase/patch_wms.sql`, `patch_wms_boxes.sql`, `patch_wms_disabled.sql`, `patch_wms_rack_layout.sql`, `patch_wms_scanning.sql`, `patch_wms_default_warehouse.sql`, `patch_wms_unassign_box.sql`, `patch_wms_operations.sql`.
- `wms_warehouses`: account warehouse, FBS participation and optional WB warehouse link.
- `wms_zones`: one complete rack; stores pallet-position dimensions and visible upright configuration; database default is three tiers (`rows = 3`).
- `wms_zone_sides`: stable `code` (`F1`/`F2`), editable name and shared `slot_columns × slot_rows`; database allows at most two sides per rack.
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
- `fulfillment_box_barcode_registry`: permanent history of issued box numbers/barcodes. An active number is unique inside its supply; after deleting a box, its registry row remains with `box_id = null` and can be reattached when that same number is recreated. Because the code is deterministic, the recreated box receives the same QR.
- Database triggers generate both identifiers, validate tenant consistency and align `trip_lines.shipment_number` with the linked fulfillment supply.
- `add_trip_line(..., p_fulfillment_supply_id)` links the supply atomically and reuses its number; ordinary logistics lines continue receiving the next free number in the shared company sequence.
- Backfill verified in production: all 87 supplies numbered; all 1982 boxes have unique barcodes.

## Fulfillment supply FBO/FBS destination (applied 12.09.2026)

- Patch: `supabase/patch_fulfillment_supply_destination_types.sql`.
- `fulfillment_supplies.destination_type` is required and accepts exactly `fbo` or `fbs`. Existing and legacy rows receive `fbo` without changing their warehouse link or historical name.
- FBO destination uses `fulfillment_supplies.warehouse_id`, which references the WB destination directory `warehouses`; the creation UI exposes only rows with `is_system=true`.
- FBS destination uses `fulfillment_supplies.destination_wms_warehouse_id`, which references the physical ELESTET directory `wms_warehouses`; the creation UI exposes only warehouses of the current stage executor with `fbs_enabled=true`.
- `fulfillment_supplies.warehouse_name` remains the historical name snapshot for both models. Business logic must use the model-specific UUID when exact identity matters; equal names do not make two warehouses identical.
- Database checks reject an FBS row without `destination_wms_warehouse_id`, an FBS row that also has `warehouse_id`, and an FBO row with `destination_wms_warehouse_id`. `validate_fulfillment_supply_destination` additionally verifies that a newly linked FBS warehouse is enabled and belongs to the owner/partner actually executing the pipeline stage.
- A WMS warehouse referenced by an FBS supply cannot be deleted: the FK uses `ON DELETE RESTRICT`. Renaming it is safe because the UUID remains exact and `warehouse_name` preserves the name that was shown when the supply was created.
- Production verification after migration: 143 existing rows classified as FBO, 0 FBS rows before first user-created FBS supply, 0 invalid destination types and 0 invalid FBS reference combinations.

## Fulfillment reception WMS warehouse (applied 31.08.2026)

- Patch: `supabase/patch_fulfillment_wms_warehouse.sql`.
- `batch_pipeline_stages` and legacy `fulfillment_batches`: `wms_warehouse_id`, immutable snapshot `wms_warehouse_name`, `warehouse_corrected_at`.
- `fulfillment_stage_stock.wms_warehouse_id`: physical location of the completed stage stock; it is inherited from the stage/batch instead of `fulfillment_items.notes`.
- `fulfillment_reception_history.is_correction`: distinguishes ordinary edits before reception completion from corrections after it.
- `fulfillment_stage_warehouse_history`: append-only old/new warehouse audit per stage or legacy batch.
- `fulfillment_reception_is_completed(batch, stage)`: the boundary for correction semantics. It does not complete a pipeline stage and does not transfer products.
- Triggers validate that the warehouse belongs to the stage executor/company, require it when reception completes, forbid physical item deletion after reception, and keep completed stock aligned after corrections.
- `get_wms_warehouse_products(uuid)`: account-scoped current active stock for the WMS warehouse, including pipeline stage stock and completed legacy batches.
- Safe backfill assigns only the sole WMS warehouse of an executor; ambiguous historical stages remain unassigned.
- Deployment status: applied through Supabase Management API after a full transactional `ROLLBACK` check. Structural verification, authenticated pipeline behavior and completed legacy/RPC rollback tests passed.

## Fulfillment Excel contents import (applied in production)

- Patch: `supabase/patch_fulfillment_box_excel_import.sql`.
- Excel is parsed and validated client-side, then the complete intended replacement is sent to a transactional RPC. A product barcode must contain exactly 13 digits; quantity and box number must be positive integers; duplicate `barcode + box` rows are aggregated.
- A row containing only a box number may create a missing empty box, but never clears an existing box. If a box has product rows in the file, the specified content fully replaces that box; boxes absent from the file remain unchanged.
- An active FBS stock allocation blocks unsafe replacement of the affected content.
- Active KIZ records of replaced contents are archived into history with the Excel-replacement reason instead of being silently deleted. Re-scanning an archived KIZ can bind it to the new item without incorrectly increasing already imported quantity.

## Fulfillment KIZ inventory and transgran (repository state 17–22.09.2026)

- `fulfillment_kiz_pairs` stores the physical `box + product barcode + original/normalized KIZ` relationship, GTIN/serial, product/hierarchy snapshots, operator and scanner identity, and `draft/committed/deleted/replaced` lifecycle. `fulfillment_kiz_events` is immutable audit history.
- KIZ intake preserves meaningful GS1 separators, rejects duplicate active codes and separates scanning from final box commit. Product/GTIN links can be prepared and confirmed, but physical intake does not require a currently available Teksher cabinet.
- Parent removal and Excel content replacement move affected KIZ to `deleted/replaced` through audited database paths. FBO shipping is blocked while the supply has unresolved `draft` pairs.
- `transgran_shipments`, `transgran_items`, `transgran_events` keep FBO and FBS as separate source kinds. Creation snapshots only confirmed source KIZ; one active transgran per source is protected by partial unique indexes; events cannot be edited or deleted.
- Teksher operation lifecycle and СПОТ lifecycle are distinct: diagnostic/create/sync/cancel belongs to Teksher, while СПОТ channel, carrier, vehicle, QR and customs declarations are stored separately.
- Relevant patches: `patch_fulfillment_kiz_inventory.sql`, `patch_fulfillment_kiz_gtin_links.sql`, `patch_fulfillment_kiz_independent_of_teksher.sql`, `patch_transgran_workflow.sql`, `patch_teksher_emission_product_groups.sql`.
- These migrations exist in `origin/main`; their exact deployed production version was not independently revalidated during the 24.09.2026 Memory Bank audit and must be checked before a future backend change.

## Fulfillment WB box-code registry (applied in production)

- Patch: `supabase/patch_fulfillment_wb_box_code_registry.sql`.
- `fulfillment_wb_box_code_registry` stores the verified pair `wb_barcode + wb_external_barcode` by stable business key `supply_id + box_number`; the pair is not identified by the temporary UUID of `fulfillment_boxes`.
- Creation/recreation trigger restores the deterministic system barcode and the saved WB pair when the same box number returns after deletion.
- The exact-set apply RPC validates the entire supply and writes atomically. Missing and extra numbers, duplicate codes, half-filled pairs and tenant/permission mismatches reject the whole operation; partial assignment is forbidden.
- Direct mutation of WB-code columns and old API-assignment functions are guarded/disabled. Changing `fulfillment_supplies.wb_supply_id` clears the old WB registry/mapping and cached WB metadata, while system barcodes and box contents remain intact.
- `wb-supply` may synchronize safe supply metadata, but package codes returned by WB API are not persisted as physical-box identity.

## Fulfillment Excel action history (local, not yet production)

- Pending patch: `supabase/patch_fulfillment_excel_action_history.sql`, paired with local commit `b86d7c9`.
- `fulfillment_excel_action_history` is append-only and records successful mutating imports of box contents and WB codes: actor, timestamp, source filename, action/result and exact before/after JSON snapshots.
- Re-uploading an identical WB mapping is recorded as `unchanged` without rewriting the registry. Excel downloads are not audit events; automatic rollback/restoration is deliberately absent.
- RPC access verifies `fulfillment_manage`, including the actual pipeline-stage executor; direct authenticated writes to the WB registry and legacy mutating bypasses are closed.
- Deployment order is mandatory: apply and verify this SQL/RLS/RPC patch first, then publish the frontend that calls it. Until both steps are complete, history and the strengthened permission layer are not production capabilities.

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

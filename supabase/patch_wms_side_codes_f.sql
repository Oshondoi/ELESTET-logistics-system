-- WMS side codes use F (face) so they cannot be confused with fulfillment
-- supply numbers, which intentionally keep the S prefix in box barcodes.
-- Apply this patch before reapplying the current WMS scanning, operations and
-- sensitive-search function definitions.

begin;

-- Move through collision-proof temporary values because code is unique inside
-- a rack. Side identity and all placements remain attached by UUID.
update public.wms_zone_sides
set code = '__F_SIDE_' || id::text,
    updated_at = now()
where position between 0 and 1
  and code is distinct from 'F' || (position + 1)::text;

update public.wms_zone_sides
set code = 'F' || (position + 1)::text,
    updated_at = now()
where position between 0 and 1
  and code is distinct from 'F' || (position + 1)::text;

commit;

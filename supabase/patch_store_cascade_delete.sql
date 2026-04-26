-- Fix cascade delete for stores
-- Previously had ON DELETE RESTRICT which blocks store deletion

-- shipments.store_id: RESTRICT → CASCADE
ALTER TABLE public.shipments
  DROP CONSTRAINT IF EXISTS shipments_store_id_fkey;

ALTER TABLE public.shipments
  ADD CONSTRAINT shipments_store_id_fkey
  FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;

-- trip_lines.store_id: RESTRICT → CASCADE (trips table has no store_id; store is linked via trip_lines)
ALTER TABLE public.trip_lines
  DROP CONSTRAINT IF EXISTS trip_lines_store_id_fkey;

ALTER TABLE public.trip_lines
  ADD CONSTRAINT trip_lines_store_id_fkey
  FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;

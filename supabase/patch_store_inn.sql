-- Add inn column to stores table
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS inn text;

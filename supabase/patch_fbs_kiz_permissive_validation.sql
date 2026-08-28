-- Accept all scanner representations of the serial/crypto part of a KIZ.
-- We intentionally validate only the stable GS1 identity envelope here:
-- AI 01 + valid GTIN-14 + AI 21 + a non-empty remainder. Wildberries remains
-- the source of truth for the serial number, separators and cryptographic tail.

begin;

create or replace function public.is_valid_fbs_kiz(p_value text)
returns boolean
language plpgsql
immutable
strict
set search_path = public
as $$
declare
  v_code text := public.normalize_fbs_kiz(p_value);
begin
  if char_length(v_code) not between 19 and 135 then return false; end if;
  if v_code !~ '^01[0-9]{14}21' then return false; end if;
  if not public.is_valid_fbs_gtin14(substring(v_code from 3 for 14)) then return false; end if;
  return char_length(substring(v_code from 19)) > 0;
end;
$$;

commit;

-- Allow a deleted fulfillment box number to be recreated inside the same supply.
-- The barcode is deterministic, so the recreated box receives the same QR value.
-- Supply numbers remain permanently reserved; only the last-level box is reusable.

create or replace function public.register_fulfillment_box_barcode()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- A deleted box leaves a registry tombstone (box_id = null). Reattach that
  -- exact historical number/barcode to the newly created box.
  update public.fulfillment_box_barcode_registry
  set box_id = new.id
  where barcode = new.barcode
    and account_id = new.account_id
    and supply_id = new.supply_id
    and box_number = new.box_number
    and box_id is null;

  if not found then
    insert into public.fulfillment_box_barcode_registry (
      barcode, account_id, supply_id, box_number, box_id
    ) values (
      new.barcode, new.account_id, new.supply_id, new.box_number, new.id
    );
  end if;

  update public.fulfillment_supplies
  set next_box_number = greatest(next_box_number, new.box_number + 1)
  where id = new.supply_id;

  return new;
exception
  when unique_violation then
    raise exception 'Короб №% уже существует в этой поставке', new.box_number;
end;
$$;

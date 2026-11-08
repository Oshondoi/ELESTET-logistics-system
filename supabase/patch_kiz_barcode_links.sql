-- Ручная связка баркода размера WB и GTIN Teksher.
-- Пишет в ту же таблицу, что и сканер фулфилмента, чтобы связь была одна.
-- Менять может только владелец или администратор компании.

create or replace function public.set_kiz_barcode_gtin_link(
  p_store_id uuid,
  p_barcode text,
  p_gtin text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account uuid;
  v_role text;
  v_barcode text := btrim(coalesce(p_barcode, ''));
  v_gtin text := regexp_replace(btrim(coalesce(p_gtin, '')), '\D', '', 'g');
  v_teksher public.teksher_products%rowtype;
  v_wb jsonb;
  v_link public.fulfillment_product_gtin_links%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Войдите в систему.';
  end if;
  select account_id into v_account from public.stores where id = p_store_id and deleted_at is null;
  if v_account is null then
    raise exception 'Магазин не найден.';
  end if;
  select role into v_role from public.account_members
  where account_id = v_account and user_id = auth.uid();
  if v_role is null or v_role not in ('owner', 'admin') then
    raise exception 'Связку баркода и GTIN меняет владелец или администратор компании.';
  end if;
  if v_barcode = '' or v_barcode = '—' then
    raise exception 'У этого размера нет баркода.';
  end if;
  if char_length(v_gtin) between 8 and 13 then
    v_gtin := lpad(v_gtin, 14, '0');
  end if;
  if v_gtin !~ '^[0-9]{14}$' then
    raise exception 'GTIN должен содержать от 8 до 14 цифр.';
  end if;

  select * into v_teksher from public.teksher_products
  where store_id = p_store_id and gtin = v_gtin
  limit 1;
  if v_teksher.id is null then
    raise exception 'GTIN % нет среди товаров Teksher этого магазина. Сначала обновите товары КИЗ.', v_gtin;
  end if;

  select jsonb_build_object(
    'nm_id', product.nm_id,
    'name', product.name,
    'vendor_code', product.vendor_code,
    'brand', product.brand,
    'color', product.color,
    'size', (
      select size_row->>'techSize'
      from jsonb_array_elements(
        case when jsonb_typeof(to_jsonb(product.sizes)) = 'array' then to_jsonb(product.sizes) else '[]'::jsonb end
      ) size_row
      where coalesce(size_row->'skus', '[]'::jsonb) ? v_barcode
      limit 1
    )
  ) into v_wb
  from public.products product
  where product.store_id = p_store_id
    and coalesce(to_jsonb(product.barcodes), '[]'::jsonb) @> jsonb_build_array(v_barcode)
  limit 1;
  if v_wb is null then
    raise exception 'Баркод % не найден в товарах этого магазина. Обновите товары WB.', v_barcode;
  end if;

  if exists (
    select 1 from public.fulfillment_product_gtin_links link
    where link.store_id = p_store_id
      and link.active
      and link.gtin = v_gtin
      and link.wb_barcode <> v_barcode
  ) then
    raise exception 'Этот GTIN уже связан с другим размером. Сначала снимите ту связку.';
  end if;

  update public.fulfillment_product_gtin_links
  set active = false, updated_at = now()
  where store_id = p_store_id
    and active
    and wb_barcode = v_barcode
    and gtin <> v_gtin;

  insert into public.fulfillment_product_gtin_links(
    account_id, store_id, wb_barcode, gtin, teksher_product_id,
    wb_product_snapshot, teksher_product_snapshot, active, confirmed_by, updated_at
  ) values (
    v_account, p_store_id, v_barcode, v_gtin, v_teksher.id,
    coalesce(v_wb, '{}'::jsonb),
    jsonb_build_object(
      'id', v_teksher.id,
      'gtin', v_teksher.gtin,
      'name', v_teksher.name,
      'full_name', v_teksher.full_name,
      'product_group_code', v_teksher.product_group_code
    ),
    true, auth.uid(), now()
  )
  on conflict (store_id, wb_barcode, gtin) do update set
    active = true,
    teksher_product_id = excluded.teksher_product_id,
    wb_product_snapshot = excluded.wb_product_snapshot,
    teksher_product_snapshot = excluded.teksher_product_snapshot,
    confirmed_by = auth.uid(),
    updated_at = now()
  returning * into v_link;

  return to_jsonb(v_link);
end;
$$;

create or replace function public.clear_kiz_barcode_gtin_link(
  p_store_id uuid,
  p_barcode text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account uuid;
  v_role text;
  v_barcode text := btrim(coalesce(p_barcode, ''));
begin
  if auth.uid() is null then
    raise exception 'Войдите в систему.';
  end if;
  select account_id into v_account from public.stores where id = p_store_id and deleted_at is null;
  if v_account is null then
    raise exception 'Магазин не найден.';
  end if;
  select role into v_role from public.account_members
  where account_id = v_account and user_id = auth.uid();
  if v_role is null or v_role not in ('owner', 'admin') then
    raise exception 'Связку баркода и GTIN меняет владелец или администратор компании.';
  end if;
  update public.fulfillment_product_gtin_links
  set active = false, updated_at = now()
  where store_id = p_store_id and wb_barcode = v_barcode and active;
end;
$$;

create or replace function public.guard_kiz_barcode_gtin_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.active is not true then
    return new;
  end if;
  if exists (
    select 1 from public.fulfillment_product_gtin_links link
    where link.store_id = new.store_id
      and link.active
      and link.gtin = new.gtin
      and link.wb_barcode <> new.wb_barcode
      and link.id is distinct from new.id
  ) then
    raise exception 'Этот GTIN уже связан с другим размером. Сначала снимите ту связку.';
  end if;
  update public.fulfillment_product_gtin_links
  set active = false, updated_at = now()
  where store_id = new.store_id
    and active
    and wb_barcode = new.wb_barcode
    and gtin <> new.gtin
    and id is distinct from new.id;
  return new;
end;
$$;

drop trigger if exists guard_kiz_barcode_gtin_link on public.fulfillment_product_gtin_links;
create trigger guard_kiz_barcode_gtin_link
before insert or update of active, gtin, wb_barcode on public.fulfillment_product_gtin_links
for each row execute function public.guard_kiz_barcode_gtin_link();

update public.fulfillment_product_gtin_links link
set active = false, updated_at = now()
where link.active
  and exists (
    select 1 from public.fulfillment_product_gtin_links newer
    where newer.store_id = link.store_id
      and newer.active
      and newer.id <> link.id
      and (
        (newer.wb_barcode = link.wb_barcode and newer.gtin <> link.gtin)
        or (newer.gtin = link.gtin and newer.wb_barcode <> link.wb_barcode)
      )
      and (newer.updated_at, newer.created_at, newer.id) > (link.updated_at, link.created_at, link.id)
  );

create unique index if not exists fulfillment_product_gtin_links_one_active_barcode
  on public.fulfillment_product_gtin_links (store_id, wb_barcode)
  where active;

create unique index if not exists fulfillment_product_gtin_links_one_active_gtin
  on public.fulfillment_product_gtin_links (store_id, gtin)
  where active;

revoke all on function public.guard_kiz_barcode_gtin_link() from public, anon;
revoke all on function public.set_kiz_barcode_gtin_link(uuid, text, text) from public, anon;
revoke all on function public.clear_kiz_barcode_gtin_link(uuid, text) from public, anon;
grant execute on function public.guard_kiz_barcode_gtin_link() to authenticated;
grant execute on function public.set_kiz_barcode_gtin_link(uuid, text, text) to authenticated;
grant execute on function public.clear_kiz_barcode_gtin_link(uuid, text) to authenticated;

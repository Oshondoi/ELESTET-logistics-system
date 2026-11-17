-- Право роли kiz_links_manage: сотрудник может сохранять связку баркода WB и GTIN.
-- Владелец и администратор компании по-прежнему могут это без галочки.
-- Существующим ролям ключ добавляется выключенным.

update public.roles
set permissions = permissions || '{"kiz_links_manage": false}'::jsonb
where not (permissions ? 'kiz_links_manage');

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
  if v_role is null
     or (
       v_role not in ('owner', 'admin')
       and not exists (
         select 1
         from public.role_assignments assignment
         join public.roles role
           on role.id = assignment.role_id
          and role.account_id = assignment.account_id
         where assignment.account_id = v_account
           and assignment.user_id = auth.uid()
           and coalesce((role.permissions->>'kiz_links_manage')::boolean, false)
       )
     ) then
    raise exception 'Связку баркода и GTIN меняет владелец, администратор или сотрудник с правом «Связка баркода и GTIN».';
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
  if v_role is null
     or (
       v_role not in ('owner', 'admin')
       and not exists (
         select 1
         from public.role_assignments assignment
         join public.roles role
           on role.id = assignment.role_id
          and role.account_id = assignment.account_id
         where assignment.account_id = v_account
           and assignment.user_id = auth.uid()
           and coalesce((role.permissions->>'kiz_links_manage')::boolean, false)
       )
     ) then
    raise exception 'Связку баркода и GTIN меняет владелец, администратор или сотрудник с правом «Связка баркода и GTIN».';
  end if;
  update public.fulfillment_product_gtin_links
  set active = false, updated_at = now()
  where store_id = p_store_id and wb_barcode = v_barcode and active;
end;
$$;

revoke all on function public.set_kiz_barcode_gtin_link(uuid, text, text) from public, anon;
revoke all on function public.clear_kiz_barcode_gtin_link(uuid, text) from public, anon;
grant execute on function public.set_kiz_barcode_gtin_link(uuid, text, text) to authenticated;
grant execute on function public.clear_kiz_barcode_gtin_link(uuid, text) to authenticated;

create or replace function public.delete_account_with_owner(p_account_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1
    from public.account_members am
    where am.account_id = p_account_id
      and am.user_id = auth.uid()
      and am.role = 'owner'
  ) then
    raise exception 'Only owner can delete company';
  end if;

  delete from public.shipment_status_history h
  using public.shipments s
  where h.shipment_id = s.id
    and s.account_id = p_account_id;

  delete from public.shipments
  where account_id = p_account_id;

  delete from public.stores
  where account_id = p_account_id;

  delete from public.account_members
  where account_id = p_account_id;

  delete from public.accounts
  where id = p_account_id;

  return true;
end;
$$;

grant execute on function public.delete_account_with_owner(uuid) to authenticated;

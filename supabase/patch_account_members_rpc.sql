-- RPC для получения участников компании с именами (обходит RLS через SECURITY DEFINER)
create or replace function get_account_members_with_names(p_account_id uuid)
returns table (user_id uuid, full_name text)
language sql
security definer
stable
as $$
  select am.user_id, coalesce(p.full_name, '') as full_name
  from account_members am
  left join profiles p on p.user_id = am.user_id
  where am.account_id = p_account_id
    and exists (
      select 1 from account_members am2
      where am2.account_id = p_account_id
        and am2.user_id = auth.uid()
    )
  order by p.full_name;
$$;

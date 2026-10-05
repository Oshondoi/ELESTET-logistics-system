begin;
alter table public.company_brand_assets
  add column if not exists square_path text,
  add column if not exists rectangle_path text;
alter table public.company_brand_assets drop constraint if exists brand_render_paths;
alter table public.company_brand_assets add constraint brand_render_paths check (
  (square_path is null or square_path like account_id::text||'/%.png') and
  (rectangle_path is null or rectangle_path like account_id::text||'/%.png')
);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('brand-renders','brand-renders',true,2097152,array['image/png'])
on conflict(id) do nothing;
drop policy if exists brand_renders_insert on storage.objects;
create policy brand_renders_insert on storage.objects for insert to authenticated with check (
  bucket_id='brand-renders' and exists(select 1 from public.accounts a
    where a.id::text=(storage.foldername(name))[1] and public.can_manage_company_brand(a.id))
);
-- Paid entitlement cannot be granted by an ordinary account update.
create or replace function public.guard_brand_entitlement()
returns trigger language plpgsql set search_path=public as $$
begin
  if current_user in ('anon','authenticated') and
    ((tg_op='INSERT' and new.logo_subscription_until is not null) or
     (tg_op='UPDATE' and new.logo_subscription_until is distinct from old.logo_subscription_until)) then
    raise exception 'Оплата опции изменяется только сервером';
  end if;
  return new;
end $$;
drop trigger if exists guard_brand_entitlement on public.accounts;
create trigger guard_brand_entitlement before insert or update on public.accounts
for each row execute function public.guard_brand_entitlement();

-- Return presentation only, never originals, billing details or membership.
-- A portal uses its bound invite's executor, not the request being viewed.
create or replace function public.resolve_company_brand(
  p_account_id uuid default null, p_invite_token uuid default null,
  p_client_portal boolean default false
) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  target uuid;
  a public.accounts%rowtype;
  b public.company_brand_assets%rowtype;
begin
  if p_invite_token is not null then
    select i.executor_account_id into target from public.service_request_invites i
    where i.token=p_invite_token and i.deleted_at is null and i.revoked_at is null and i.expires_at>now();
  elsif p_account_id is not null then
    if not exists(select 1 from public.account_members m where m.account_id=p_account_id and m.user_id=auth.uid()) then return null; end if;
    if p_client_portal then
      select i.executor_account_id into target from public.service_request_invites i
      where i.applicant_account_id=p_account_id and i.deleted_at is null and i.revoked_at is null and i.expires_at>now()
      order by i.bound_at desc nulls last,i.created_at desc limit 1;
    else target:=p_account_id;
    end if;
  end if;
  select * into a from public.accounts where id=target and deleted_at is null;
  if not found or a.logo_subscription_until is null or a.logo_subscription_until<=now()
    or a.plan is null or a.plan='none' or a.plan_until is null or a.plan_until<=now() then return null; end if;
  select * into b from public.company_brand_assets where account_id=target;
  return jsonb_build_object(
    'name',coalesce(nullif(b.brand_name,''),a.name),
    'title',coalesce(nullif(b.tab_title,''),nullif(b.brand_name,''),a.name),
    'square_path',b.square_path,'rectangle_path',b.rectangle_path,
    'expires_at',least(a.logo_subscription_until,a.plan_until)
  );
end $$;
revoke all on function public.resolve_company_brand(uuid,uuid,boolean) from public;
grant execute on function public.resolve_company_brand(uuid,uuid,boolean) to anon,authenticated;
notify pgrst,'reload schema';
commit;

begin;
create or replace function public.can_manage_company_brand(p_account_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.account_members m where m.account_id=p_account_id and m.user_id=auth.uid() and m.role='owner')
  or exists(select 1 from public.role_assignments ra
    join public.roles r on r.id=ra.role_id and r.account_id=ra.account_id
    join public.account_members m on m.account_id=ra.account_id and m.user_id=ra.user_id
    where ra.account_id=p_account_id and ra.user_id=auth.uid() and r.permissions->>'brand_manage'='true')
$$;
revoke all on function public.can_manage_company_brand(uuid) from public,anon;
grant execute on function public.can_manage_company_brand(uuid) to authenticated;
create table if not exists public.company_brand_assets (
  account_id uuid primary key references public.accounts(id),
  brand_name text not null default '' check(length(brand_name)<=100),
  tab_title text not null default '' check(length(tab_title)<=150),
  original_path text,
  square_crop jsonb not null default '{"x":50,"y":50,"zoom":1,"aspect":1}',
  rectangle_crop jsonb not null default '{"x":50,"y":50,"zoom":1,"aspect":3}',
  updated_at timestamptz not null default now(),
  check(original_path is null or original_path like account_id::text || '/%')
);
alter table public.company_brand_assets enable row level security;
revoke all on public.company_brand_assets from public,anon,authenticated;
grant select,insert,update on public.company_brand_assets to authenticated;
drop policy if exists company_brand_assets_manage on public.company_brand_assets;
create policy company_brand_assets_manage on public.company_brand_assets for all to authenticated
  using(public.can_manage_company_brand(account_id)) with check(public.can_manage_company_brand(account_id));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('brand-originals','brand-originals',false,2097152,array['image/png','image/jpeg','image/webp','image/svg+xml'])
on conflict(id) do nothing;
drop policy if exists brand_originals_read on storage.objects;
create policy brand_originals_read on storage.objects for select to authenticated using(
  bucket_id='brand-originals' and exists(select 1 from public.accounts a where a.id::text=(storage.foldername(name))[1] and public.can_manage_company_brand(a.id))
);
drop policy if exists brand_originals_insert on storage.objects;
create policy brand_originals_insert on storage.objects for insert to authenticated with check(
  bucket_id='brand-originals' and exists(select 1 from public.accounts a where a.id::text=(storage.foldername(name))[1] and public.can_manage_company_brand(a.id))
);
-- Originals are immutable. Re-cropping only updates parameters, never the source.
notify pgrst, 'reload schema';
commit;

-- «Управление стикерами» открывает сохранение полного кода и настроек печати.
-- Владелец, администратор, менеджер и оператор по-прежнему могут это без галочки.
-- Сотрудник с ролью остаётся зрителем: база смотрит на галочку роли.

create or replace function public.member_can_manage_stickers(p_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.account_members am
    where am.account_id = p_account_id
      and am.user_id = auth.uid()
      and (
        am.role in ('owner', 'admin', 'manager', 'operator')
        or exists (
          select 1
          from public.role_assignments assignment
          join public.roles role
            on role.id = assignment.role_id
           and role.account_id = assignment.account_id
          where assignment.account_id = p_account_id
            and assignment.user_id = auth.uid()
            and coalesce((role.permissions->>'stickers_manage')::boolean, false)
        )
      )
  );
$$;

revoke all on function public.member_can_manage_stickers(uuid) from public;
grant execute on function public.member_can_manage_stickers(uuid) to authenticated;

grant select, insert, update, delete on public.kiz_print_codes to authenticated;
grant select, insert, update, delete on public.sticker_print_settings to authenticated;
grant select, insert, update, delete on public.sticker_product_print_overrides to authenticated;

drop policy if exists "members_manage_kiz_print_codes" on public.kiz_print_codes;
create policy "members_manage_kiz_print_codes" on public.kiz_print_codes
for all
using (public.member_can_manage_stickers(account_id))
with check (public.member_can_manage_stickers(account_id));

drop policy if exists "members_manage_sticker_print_settings" on public.sticker_print_settings;
create policy "members_manage_sticker_print_settings" on public.sticker_print_settings
for all
using (public.member_can_manage_stickers(account_id))
with check (public.member_can_manage_stickers(account_id));

drop policy if exists "members_manage_sticker_product_overrides" on public.sticker_product_print_overrides;
create policy "members_manage_sticker_product_overrides" on public.sticker_product_print_overrides
for all
using (public.member_can_manage_stickers(account_id))
with check (public.member_can_manage_stickers(account_id));

notify pgrst, 'reload schema';

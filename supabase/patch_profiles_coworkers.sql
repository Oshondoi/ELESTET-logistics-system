-- Позволяет членам одной компании видеть профили коллег
-- (нужно для выбора исполнителя в ОТК и других подобных мест)
create policy "profiles_select_coworkers"
on public.profiles
for select
using (
  exists (
    select 1
    from public.account_members am1
    join public.account_members am2
      on am2.account_id = am1.account_id
    where am1.user_id = auth.uid()
      and am2.user_id = profiles.user_id
  )
);

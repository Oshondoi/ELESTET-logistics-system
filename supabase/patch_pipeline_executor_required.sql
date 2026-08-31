-- Настройку пайплайна разрешено хранить незавершённой, но создать по ней
-- партию можно только после явного выбора исполнителя каждой стадии.

create or replace function public.init_batch_pipeline(
  p_batch_id uuid,
  p_account_id uuid
)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_stage record;
  v_count integer := 0;
begin
  if not exists (
    select 1 from public.account_members
    where account_id = p_account_id and user_id = auth.uid()
  ) then
    return jsonb_build_object('error', 'Нет доступа');
  end if;

  if not exists (
    select 1 from public.fulfillment_batches
    where id = p_batch_id and account_id = p_account_id
  ) then
    return jsonb_build_object('error', 'Партия не найдена');
  end if;

  if not exists (
    select 1 from public.account_pipeline_stages
    where account_id = p_account_id
  ) then
    return jsonb_build_object('error', 'Пайплайн не настроен');
  end if;

  if exists (
    select 1 from public.account_pipeline_stages
    where account_id = p_account_id and partner_account_id is null
  ) then
    return jsonb_build_object('error', 'Для каждой стадии пайплайна нужно выбрать исполнителя');
  end if;

  delete from public.batch_pipeline_stages where batch_id = p_batch_id;

  for v_stage in
    select * from public.account_pipeline_stages
    where account_id = p_account_id
    order by order_index
  loop
    insert into public.batch_pipeline_stages (
      batch_id, owner_account_id, partner_account_id,
      order_index, name, current_stage, status,
      stage_otk, stage_packaging, stage_marking, stage_packing, stage_logistics
    ) values (
      p_batch_id, p_account_id, v_stage.partner_account_id,
      v_stage.order_index, v_stage.name, 'reception', 'pending',
      v_stage.stage_otk, v_stage.stage_packaging, v_stage.stage_marking,
      v_stage.stage_packing, v_stage.stage_logistics
    );
    v_count := v_count + 1;
  end loop;

  update public.batch_pipeline_stages
  set status = 'active', activated_at = now()
  where batch_id = p_batch_id and order_index = 0;

  return jsonb_build_object('ok', true, 'stages_count', v_count);
end;
$$;

create or replace function public.create_fulfillment_batch_with_pipeline(
  p_account_id uuid,
  p_name text,
  p_store_id uuid,
  p_stage_otk boolean,
  p_stage_packaging boolean,
  p_stage_marking boolean,
  p_stage_packing boolean,
  p_stage_logistics boolean
)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_batch public.fulfillment_batches%rowtype;
  v_pipeline_result jsonb;
begin
  if nullif(btrim(p_name), '') is null then
    raise exception 'Введите название партии';
  end if;
  if not exists (
    select 1 from public.account_members
    where account_id = p_account_id and user_id = auth.uid()
  ) then
    raise exception 'Нет доступа';
  end if;
  if not exists (
    select 1 from public.account_pipeline_stages
    where account_id = p_account_id
  ) then
    raise exception 'Пайплайн не настроен';
  end if;
  if exists (
    select 1 from public.account_pipeline_stages
    where account_id = p_account_id and partner_account_id is null
  ) then
    raise exception 'Для каждой стадии пайплайна нужно выбрать исполнителя';
  end if;

  insert into public.fulfillment_batches (
    account_id, store_id, name, stage_otk, stage_packaging,
    stage_marking, stage_packing, stage_logistics, created_by
  ) values (
    p_account_id, p_store_id, btrim(p_name), p_stage_otk, p_stage_packaging,
    p_stage_marking, p_stage_packing, p_stage_logistics, auth.uid()
  ) returning * into v_batch;

  v_pipeline_result := public.init_batch_pipeline(v_batch.id, p_account_id);
  if v_pipeline_result ? 'error' then
    raise exception '%', v_pipeline_result->>'error';
  end if;

  return to_jsonb(v_batch);
end;
$$;

revoke all on function public.create_fulfillment_batch_with_pipeline(uuid, text, uuid, boolean, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.create_fulfillment_batch_with_pipeline(uuid, text, uuid, boolean, boolean, boolean, boolean, boolean) to authenticated;

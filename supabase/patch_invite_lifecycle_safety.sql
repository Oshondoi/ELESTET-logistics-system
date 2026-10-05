-- Prevent reserve creation/replacement from obstructing another company's bound link.
-- Delete scoped box items before intersecting parent cascades; retain warehouse guards.
-- Existing grants and all data are preserved by these function-only updates.
begin;
CREATE OR REPLACE FUNCTION public.replace_service_request_invite_reserve(p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_new public.service_request_invites%rowtype;
  v_old public.service_request_invites%rowtype;
  v_reserve public.service_request_invite_reserves%rowtype;
begin
  if auth.uid() is null or not public.request_invite_recent_email_otp() then
    raise exception 'Подтвердите перенос кодом из почты';
  end if;
  select * into v_new from public.service_request_invites where token=p_token for update;
  if not found or v_new.deleted_at is not null or v_new.revoked_at is not null
     or v_new.expires_at<=now() then raise exception 'Новая ссылка недействительна'; end if;
  if v_new.applicant_account_id is not null and not public.request_invite_user_can_bind(v_new.applicant_account_id) then
    raise exception 'У вас нет права привязывать резерв к компании этой ссылки' using errcode='42501';
  end if;
  select * into v_reserve from public.service_request_invite_reserves
  where user_id=auth.uid() and invite_id<>v_new.id
  order by created_at desc limit 1 for update;
  if not found then raise exception 'Прежняя ссылка не найдена'; end if;
  select * into v_old from public.service_request_invites where id=v_reserve.invite_id for update;
  if v_old.deleted_at is null and v_old.revoked_at is null then
    insert into public.service_request_invite_admin_audit(
      invite_id,token_fingerprint,action,executor_account_id,applicant_account_id,actor_id,details
    ) values(
      v_old.id,encode(extensions.digest(v_old.token::text,'sha256'),'hex'),'replaced',
      v_old.executor_account_id,v_old.applicant_account_id,auth.uid(),
      jsonb_build_object('replacement_invite_id',v_new.id)
    );
    update public.service_request_invites
    set token=gen_random_uuid(),revoked_at=now(),deleted_at=now(),delete_reason='replaced_by_applicant'
    where id=v_old.id;
  end if;
  insert into public.service_request_invite_reserves(invite_id,user_id,email,full_name,draft,expires_at)
  values(v_new.id,auth.uid(),v_reserve.email,v_reserve.full_name,'{}'::jsonb,v_new.initial_expires_at)
  on conflict(invite_id) do nothing;
  if not exists(select 1 from public.service_request_invite_reserves
                where invite_id=v_new.id and user_id=auth.uid()) then
    raise exception 'Новая ссылка уже закреплена за другим пользователем';
  end if;
  update public.service_request_invites
  set claimed_by=auth.uid(),claimed_at=coalesce(claimed_at,now()),last_used_at=now()
  where id=v_new.id;
  return jsonb_build_object('ok',true,'expires_at',v_new.initial_expires_at);
end $function$
;
CREATE OR REPLACE FUNCTION public.reserve_service_request_invite(p_token uuid, p_full_name text, p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_invite public.service_request_invites%rowtype;
  v_reserve public.service_request_invite_reserves%rowtype;
  v_other uuid;
  v_other_token uuid;
  v_email text;
begin
  if auth.uid() is null then raise exception 'Сначала подтвердите почту'; end if;
  select lower(email) into v_email from auth.users where id=auth.uid() and email_confirmed_at is not null;
  if v_email is null or v_email is distinct from lower(btrim(p_email)) then
    raise exception 'Подтверждённая почта не совпадает с почтой аккаунта';
  end if;
  select * into v_invite from public.service_request_invites where token=p_token for update;
  if not found or v_invite.deleted_at is not null or v_invite.revoked_at is not null
     or v_invite.expires_at<=now() then raise exception 'Ссылка недействительна или истекла'; end if;
  if v_invite.applicant_account_id is not null and not public.request_invite_user_can_bind(v_invite.applicant_account_id) then
    raise exception 'У вас нет права привязывать резерв к компании этой ссылки' using errcode='42501';
  end if;
  select * into v_reserve from public.service_request_invite_reserves where invite_id=v_invite.id for update;
  if found and v_reserve.user_id<>auth.uid() then raise exception 'Ссылка уже закреплена за другим пользователем'; end if;
  select r.invite_id,i.token into v_other,v_other_token
  from public.service_request_invite_reserves r
  join public.service_request_invites i on i.id=r.invite_id
  where r.email=v_email and r.invite_id<>v_invite.id
    and i.deleted_at is null and i.revoked_at is null and i.expires_at>now()
  order by r.created_at desc limit 1;
  if v_other is not null then
    return jsonb_build_object('ok',false,'code','EMAIL_RESERVED','invite_id',v_other,'token',v_other_token);
  end if;
  insert into public.profiles(user_id,full_name) values(auth.uid(),btrim(p_full_name))
  on conflict(user_id) do update set full_name=excluded.full_name;
  insert into public.service_request_invite_reserves(invite_id,user_id,email,full_name,expires_at)
  values(v_invite.id,auth.uid(),v_email,btrim(p_full_name),v_invite.initial_expires_at)
  on conflict(invite_id) do update set full_name=excluded.full_name,updated_at=now();
  update public.service_request_invites set claimed_by=auth.uid(),claimed_at=coalesce(claimed_at,now()),last_used_at=now()
  where id=v_invite.id;
  return jsonb_build_object('ok',true,'expires_at',v_invite.initial_expires_at);
end $function$
;
CREATE OR REPLACE FUNCTION public.admin_delete_service_request_invite_data(p_invite_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v public.service_request_invites%rowtype;
  v_request_count integer;
  v_batch_count integer;
  v_request_ids uuid[];
  v_batch_ids uuid[];
begin
  if not public.is_platform_superadmin() then raise exception 'Недостаточно прав'; end if;
  select * into v from public.service_request_invites where id=p_invite_id for update;
  if not found then raise exception 'Ссылка не найдена'; end if;
  select count(*) into v_request_count from public.service_requests
  where invite_id=v.id and deleted_at is null;
  select count(*) into v_batch_count from public.fulfillment_batches
  where source_request_id in(select id from public.service_requests where invite_id=v.id)
    and deleted_at is null;
  select coalesce(array_agg(id),'{}'::uuid[]) into v_request_ids
  from public.service_requests where invite_id=v.id;
  select coalesce(array_agg(id),'{}'::uuid[]) into v_batch_ids
  from public.fulfillment_batches where source_request_id=any(v_request_ids);
  perform set_config('app.pipeline_internal','on',true);
  delete from public.batch_notifications where batch_id=any(v_batch_ids) or source_request_id=any(v_request_ids);
  -- Delete box children first: concurrent FK cascade paths through items and
  -- boxes otherwise try SET NULL on a row whose box has already disappeared.
  -- Keep ordinary reserved-stock and warehouse guards active.
  delete from public.fulfillment_box_items where box_id in
    (select b.id from public.fulfillment_boxes b join public.fulfillment_supplies s on s.id=b.supply_id where s.batch_id=any(v_batch_ids));
  delete from public.fulfillment_batch_documents where batch_id=any(v_batch_ids);
  delete from public.fulfillment_reception_history where batch_id=any(v_batch_ids);
  delete from public.fulfillment_stage_stock where batch_id=any(v_batch_ids);
  delete from public.fulfillment_stage_warehouse_history where batch_id=any(v_batch_ids);
  update public.fulfillment_batches set source_request_store_id=null where id=any(v_batch_ids);
  delete from public.service_request_stores where request_id=any(v_request_ids);
  delete from public.fulfillment_batches where id=any(v_batch_ids);
  delete from public.service_request_work_drafts where request_id=any(v_request_ids);
  delete from public.service_request_correction_drafts where request_id=any(v_request_ids);
  delete from public.service_request_events where request_id=any(v_request_ids);
  delete from public.service_request_versions where request_id=any(v_request_ids);
  delete from public.service_requests where id=any(v_request_ids);
  perform set_config('app.pipeline_internal','off',true);
  delete from public.service_request_invite_reserves where invite_id=v.id;
  insert into public.service_request_invite_admin_audit(
    invite_id,token_fingerprint,action,executor_account_id,applicant_account_id,actor_id,details
  ) values(
    v.id,encode(extensions.digest(v.token::text,'sha256'),'hex'),'delete_link_data',
    v.executor_account_id,v.applicant_account_id,auth.uid(),
    jsonb_build_object('requests_deleted',v_request_count,'batches_deleted',v_batch_count,'auth_user_deleted',false)
  );
  update public.service_request_invites
  set token=gen_random_uuid(),deleted_at=now(),delete_reason='data_deleted_by_superadmin',applicant_account_id=null
  where id=v.id;
  return jsonb_build_object('ok',true,'deleted_auth_user',false);
end $function$

;
commit;

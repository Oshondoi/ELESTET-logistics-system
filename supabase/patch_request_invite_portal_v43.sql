-- Qualify columns against RETURNS TABLE variables; preserve existing permissions.
begin;
create or replace function public.claim_service_request_invite(
  p_token uuid,p_applicant_account_id uuid default null,p_replace_existing boolean default false
) returns table(id uuid,short_id integer,name text,applicant_account_id uuid,invite_id uuid)
language plpgsql security definer set search_path=public as $$
declare
  v_i public.service_request_invites%rowtype;
  v_old public.service_request_invites%rowtype;
  v_account uuid:=p_applicant_account_id;
  v_count integer;
begin
  if auth.uid() is null then raise exception 'Сначала войдите'; end if;
  select i.* into v_i from public.service_request_invites i where i.token=p_token for update;
  if not found or v_i.deleted_at is not null or v_i.revoked_at is not null
     or v_i.expires_at<=now() then raise exception 'Ссылка недействительна или истекла'; end if;
  if exists(select 1 from public.service_request_invite_reserves r
            where r.invite_id=v_i.id and r.user_id<>auth.uid()) then
    raise exception 'Ссылка уже закреплена за другим пользователем';
  end if;
  if v_i.applicant_account_id is not null then
    if not public.request_invite_user_can_view(v_i.applicant_account_id) then
      raise exception 'У вас нет доступа к данным текущей ссылки';
    end if;
    v_account:=v_i.applicant_account_id;
  else
    if v_account is null then
      select count(*),(array_agg(am.account_id order by am.account_id))[1] into v_count,v_account
      from public.account_members am where am.user_id=auth.uid();
      if v_count>1 then raise exception 'Выберите компанию-заявителя'; end if;
    end if;
    if v_account is not null and not public.request_invite_user_can_bind(v_account) then
      raise exception 'Нужны права на заявки и управление партиями выбранной компании';
    end if;
    if v_account is not null then
      update public.service_request_invites i
      set deleted_at=now(),delete_reason='expired'
      where i.applicant_account_id=v_account and i.id<>v_i.id and i.expires_at<=now()
        and i.deleted_at is null and i.revoked_at is null;
      select i.* into v_old from public.service_request_invites i
      where i.applicant_account_id=v_account and i.id<>v_i.id
        and i.deleted_at is null and i.revoked_at is null for update;
      if found and not p_replace_existing then
        raise exception 'ACTIVE_LINK_EXISTS: у компании уже есть ссылка; подтвердите замену';
      end if;
      if found then
        if not public.request_invite_recent_email_otp() then
          raise exception 'Подтвердите замену кодом из почты';
        end if;
        insert into public.service_request_invite_admin_audit(
          invite_id,token_fingerprint,action,executor_account_id,applicant_account_id,actor_id,details
        ) values(
          v_old.id,encode(extensions.digest(v_old.token::text,'sha256'),'hex'),'replaced',
          v_old.executor_account_id,v_account,auth.uid(),
          jsonb_build_object('replacement_invite_id',v_i.id)
        );
        update public.service_request_invites i
        set token=gen_random_uuid(),revoked_at=now(),deleted_at=now(),
            delete_reason='replaced_by_applicant',applicant_account_id=null
        where i.id=v_old.id;
      end if;
      update public.service_request_invites i
      set applicant_account_id=v_account,bound_at=now() where i.id=v_i.id;
    end if;
  end if;
  update public.service_request_invites i
  set claimed_by=auth.uid(),claimed_at=coalesce(i.claimed_at,now()),last_used_at=now()
  where i.id=v_i.id;
  return query select a.id,a.short_id,a.name,v_account,v_i.id
  from public.accounts a where a.id=v_i.executor_account_id;
end $$;
commit;


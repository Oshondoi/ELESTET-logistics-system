begin;
CREATE OR REPLACE FUNCTION public.can_manage_brand_mail(p_account uuid, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 select public.implementation_access(p_account,p_user) or exists(select 1 from public.accounts a join public.account_members m on m.account_id=a.id
 where a.id=p_account and a.deleted_at is null and m.user_id=p_user and (m.role='owner' or exists(
 select 1 from public.role_assignments ra join public.roles r on r.id=ra.role_id and r.account_id=ra.account_id
 where ra.account_id=a.id and ra.user_id=p_user and r.permissions->>'brand_mail_manage'='true')))
$function$;
create or replace function public.can_manage_company_brand(p_account_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select public.implementation_access(p_account_id,auth.uid())
 or exists(select 1 from public.account_members m where m.account_id=p_account_id and m.user_id=auth.uid() and m.role='owner')
 or exists(select 1 from public.role_assignments ra join public.roles r on r.id=ra.role_id and r.account_id=ra.account_id
 join public.account_members m on m.account_id=ra.account_id and m.user_id=ra.user_id
 where ra.account_id=p_account_id and ra.user_id=auth.uid() and r.permissions->>'brand_manage'='true')
$$;
commit;

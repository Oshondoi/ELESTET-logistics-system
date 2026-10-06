CREATE OR REPLACE FUNCTION public.get_my_accounts()
 RETURNS TABLE(id uuid, name text, created_at timestamp with time zone, my_role text, short_id integer, logo_url text, logo_subscription_until timestamp with time zone, plan text, plan_until timestamp with time zone, trial_ends_at timestamp with time zone, grace_until timestamp with time zone, plan_features jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    a.id,
    a.name,
    a.created_at,
    case when am.role<>'owner' and public.implementation_access(a.id,auth.uid()) then 'implementation' else am.role end AS my_role,
    a.short_id,
    a.logo_url,
    a.logo_subscription_until,
    a.plan,
    a.plan_until,
    a.trial_ends_at,
    a.grace_until,
    a.plan_features
  FROM   public.accounts a
  JOIN   public.account_members am
         ON am.account_id = a.id AND am.user_id = auth.uid()
  WHERE  a.deleted_at IS NULL
  ORDER BY a.created_at DESC;
$function$;

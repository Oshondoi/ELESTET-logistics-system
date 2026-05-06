-- Backfill: create "Основная компания" for every auth user who has NO companies at all.
-- Users who already have 1+ companies (active or archived) are NOT touched.
-- Safe to run multiple times (idempotent via NOT EXISTS check).

DO $$
DECLARE
  v_user RECORD;
  v_account_id uuid;
BEGIN
  FOR v_user IN
    -- All confirmed auth users who have zero account_members rows
    SELECT au.id AS user_id
    FROM auth.users au
    WHERE au.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.account_members am
        WHERE am.user_id = au.id
      )
  LOOP
    -- Create the account
    INSERT INTO public.accounts (name, created_at)
    VALUES ('Основная компания', now())
    RETURNING id INTO v_account_id;

    -- Add the user as owner
    INSERT INTO public.account_members (account_id, user_id, role, created_at)
    VALUES (v_account_id, v_user.user_id, 'owner', now());

    RAISE NOTICE 'Created company for user %', v_user.user_id;
  END LOOP;
END;
$$;

-- Multiple AI prompts per account (system prompts) or per store (store prompts)

CREATE TABLE IF NOT EXISTS public.ai_prompts (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid        NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  store_id    uuid        REFERENCES public.stores(id) ON DELETE CASCADE,
  type        text        NOT NULL CHECK (type IN ('system', 'store')),
  title       text        NOT NULL DEFAULT '',
  content     text        NOT NULL DEFAULT '',
  sort_order  integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS ai_prompts_account_id_idx ON public.ai_prompts(account_id);
CREATE INDEX IF NOT EXISTS ai_prompts_store_id_idx   ON public.ai_prompts(store_id);

ALTER TABLE public.ai_prompts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members_can_view_ai_prompts"
ON public.ai_prompts FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.account_members am
    WHERE am.account_id = ai_prompts.account_id
      AND am.user_id = auth.uid()
  )
);

CREATE POLICY "members_manage_ai_prompts"
ON public.ai_prompts FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.account_members am
    WHERE am.account_id = ai_prompts.account_id
      AND am.user_id = auth.uid()
      AND am.role IN ('owner', 'admin', 'manager', 'operator')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.account_members am
    WHERE am.account_id = ai_prompts.account_id
      AND am.user_id = auth.uid()
      AND am.role IN ('owner', 'admin', 'manager', 'operator')
  )
);

-- Apply only after deploying process-numbered-mail and storing its dedicated token as
-- vault secret elestet_mail_worker. Never put the service-role key into a cron command.
begin;
create or replace function public.dispatch_numbered_mail_worker() returns void
language plpgsql security definer set search_path=public as $$
declare token text;
begin
 if not exists(select 1 from public.numbered_mail_queue where status in ('queued','sending','blocked') and available_at<=now()) then return; end if;
 select decrypted_secret into token from vault.decrypted_secrets where name='elestet_mail_worker' limit 1;
 if token is null then return; end if;
 perform net.http_post(
  url:='https://jzucxqakvgzpgtvagsnq.supabase.co/functions/v1/process-numbered-mail',
  headers:=jsonb_build_object('Authorization','Bearer '||token,'Content-Type','application/json'),body:='{}'::jsonb,timeout_milliseconds:=60000);
end $$;
revoke all on function public.dispatch_numbered_mail_worker() from public,anon,authenticated;
select cron.schedule('numbered-mail-worker','* * * * *','select public.dispatch_numbered_mail_worker();');
notify pgrst,'reload schema';
commit;

-- Peak Daily Shift Manpower Tracker: hardening (run ONCE in the Supabase SQL Editor, after 0001)
-- Safe to run more than once.

-- 1. Indexes that match the queries the app really runs (the tables grow every day)
create index if not exists outbox_sent_at_idx         on outbox (sent_at) where status = 'sent';
create index if not exists outbox_created_idx         on outbox (created_at desc);
create index if not exists login_codes_email_created  on login_codes (email, created_at desc);
create index if not exists link_tokens_parent_idx     on link_tokens (parent_token_id);
create index if not exists link_tokens_person_idx     on link_tokens (person_id);
create index if not exists alerts_created_idx         on alerts (created_at desc);
create index if not exists entries_created_idx        on entries (created_at);

-- 2. Automatic clean-up, so the free database never fills up.
--    Only throw-away data is removed: sent/failed emails (30 days), login codes, expired links.
--    Entries, rounds, alerts, audit and config history are business records and are kept.
create or replace function cleanup_old_data()
returns void
language plpgsql
as $$
begin
  delete from outbox      where created_at < now() - interval '30 days';
  delete from login_codes where expires_at < now() - interval '1 day';
  delete from link_tokens where expires_at < now() - interval '30 days';
  begin
    delete from cron.job_run_details where end_time < now() - interval '3 days';
  exception when others then
    null; -- pg_cron's own log table is not always reachable; never let that stop the clean-up
  end;
end;
$$;
revoke all on function cleanup_old_data() from public, anon, authenticated;

-- runs every day at 02:30 IST (21:00 UTC)
select cron.schedule('peak-cleanup', '0 21 * * *', 'select cleanup_old_data()');

-- 3. Settings added after the first release (existing values are never overwritten)
insert into app_config (key, value) values
  ('login_known_people_only', 'false'::jsonb),
  ('round_create_grace_min',  '60'::jsonb),
  ('poc3_report_enabled',     'true'::jsonb),
  ('poc3_report_time_ist',    '"06:00"'::jsonb)
on conflict (key) do nothing;

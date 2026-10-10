-- Peak Daily Shift Manpower Tracker: schema v1
-- Access model: every table has RLS enabled and NO policies, so the public
-- (publishable) key can read or write nothing. The app talks to the database only
-- from the server, with the secret/service-role key.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- master data
create table if not exists people (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text not null,
  created_at  timestamptz not null default now()
);
create unique index if not exists people_email_lower_uq on people (lower(email));

create table if not exists zones (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  rm_person_id  uuid not null references people(id),
  hr_person_id  uuid not null references people(id)
);

create table if not exists hubs (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  zone_id    uuid not null references zones(id),
  poc1_id    uuid not null references people(id),
  poc2_id    uuid not null references people(id),
  poc3_id    uuid not null references people(id),
  active     boolean not null default true
);

create table if not exists hub_shifts (
  id          uuid primary key default gen_random_uuid(),
  hub_id      uuid not null references hubs(id) on delete cascade,
  start_time  time not null,
  end_time    time not null,
  active      boolean not null default true,
  unique (hub_id, start_time, end_time)
);

create table if not exists global_contacts (
  id         uuid primary key default gen_random_uuid(),
  role       text not null check (role in ('OPS_HEAD', 'SYSTEM_ADMIN')),
  person_id  uuid not null references people(id),
  unique (role, person_id)
);

-- A date on which a hub (or one of its shifts) does not run.
create table if not exists skip_dates (
  id            uuid primary key default gen_random_uuid(),
  hub_id        uuid not null references hubs(id) on delete cascade,
  hub_shift_id  uuid references hub_shifts(id) on delete cascade,
  skip_date     date not null,
  reason        text
);

-- ---------------------------------------------------------------- config
create table if not exists app_config (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

create table if not exists config_override (
  hub_id  uuid not null references hubs(id) on delete cascade,
  key     text not null,
  value   jsonb not null,
  primary key (hub_id, key)
);

create table if not exists config_history (
  id          bigserial primary key,
  key         text not null,
  hub_id      uuid,
  old_value   jsonb,
  new_value   jsonb,
  changed_by  text,
  changed_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- rounds + entries
create table if not exists rounds (
  id            uuid primary key default gen_random_uuid(),
  hub_shift_id  uuid not null references hub_shifts(id) on delete cascade,
  round_date    date not null,
  shift_start   timestamptz not null,
  opens_at      timestamptz not null,
  cutoff_at     timestamptz not null,
  created_at    timestamptz not null default now(),
  unique (hub_shift_id, round_date)
);
create index if not exists rounds_opens_at_idx on rounds (opens_at);
create index if not exists rounds_date_idx on rounds (round_date);

-- Append-only: every save (and every edit) is a new row. The latest row wins.
create table if not exists entries (
  id                uuid primary key default gen_random_uuid(),
  round_id          uuid not null references rounds(id) on delete cascade,
  planned           integer not null check (planned >= 0),
  actual            integer not null check (actual >= 0),
  adhoc_needed      integer generated always as (planned - actual) stored,
  entered_by_email  text not null,
  source            text not null check (source in ('link', 'delegate', 'dashboard')),
  token_id          uuid,
  reason_code       text,
  is_late           boolean not null default false,
  plan_changed      boolean not null default false,
  ip                text,
  user_agent        text,
  created_at        timestamptz not null default now()
);
create index if not exists entries_round_idx on entries (round_id, created_at desc);

-- Secure links. Only the hash of the token is stored.
create table if not exists link_tokens (
  id               uuid primary key default gen_random_uuid(),
  token_hash       text not null unique,
  kind             text not null check (kind in ('poc', 'delegate', 'ack')),
  person_id        uuid references people(id),
  round_ids        uuid[] not null,
  alert_id         uuid,
  parent_token_id  uuid,
  created_by_email text,
  expires_at       timestamptz not null,
  revoked          boolean not null default false,
  created_at       timestamptz not null default now()
);

-- Which notification steps have already been planned for a round.
create table if not exists round_steps (
  round_id  uuid not null references rounds(id) on delete cascade,
  step      text not null,
  at        timestamptz not null default now(),
  primary key (round_id, step)
);

-- ---------------------------------------------------------------- alerts
create table if not exists alerts (
  id            uuid primary key default gen_random_uuid(),
  round_id      uuid not null references rounds(id) on delete cascade,
  class         text not null check (class in ('LOW', 'EXCESS')),
  adhoc_needed  integer not null,
  ack_required  boolean not null default false,
  acked_by      text,
  acked_at      timestamptz,
  ack_eta       text,
  ack_note      text,
  repeat_count  integer not null default 0,
  last_sent_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz
);
create index if not exists alerts_round_idx on alerts (round_id);
-- at most one open alert per round
create unique index if not exists alerts_one_open_per_round on alerts (round_id) where resolved_at is null;

-- ---------------------------------------------------------------- outbox (emails)
create table if not exists outbox (
  id           uuid primary key default gen_random_uuid(),
  dedupe_key   text not null unique,
  kind         text not null,
  round_id     uuid,
  to_name      text,
  to_email     text not null,
  subject      text not null,
  html         text not null,
  text_body    text not null,
  status       text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  attempts     integer not null default 0,
  send_after   timestamptz not null default now(),
  sent_at      timestamptz,
  last_error   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists outbox_pending_idx on outbox (status, send_after);

-- ---------------------------------------------------------------- login, audit, health
create table if not exists login_codes (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  code_hash   text not null,
  expires_at  timestamptz not null,
  attempts    integer not null default 0,
  used        boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists login_codes_email_idx on login_codes (lower(email), created_at desc);

create table if not exists audit_log (
  id           bigserial primary key,
  at           timestamptz not null default now(),
  actor_email  text,
  action       text not null,
  details      jsonb
);

create table if not exists heartbeat (
  id         integer primary key default 1 check (id = 1),
  last_tick  timestamptz not null default now(),
  info       jsonb
);
insert into heartbeat (id) values (1) on conflict do nothing;

-- ---------------------------------------------------------------- claim emails safely
create or replace function claim_outbox(p_limit integer)
returns setof outbox
language sql
as $$
  update outbox o
     set status = 'sending', attempts = o.attempts + 1, updated_at = now()
   where o.id in (
     select id from outbox
      where (status = 'pending' and send_after <= now())
         or (status = 'sending' and updated_at < now() - interval '5 minutes')
      order by (kind = 'low_alert') desc, created_at
      limit p_limit
      for update skip locked
   )
  returning o.*;
$$;

-- ---------------------------------------------------------------- lock everything down
alter table people          enable row level security;
alter table zones           enable row level security;
alter table hubs            enable row level security;
alter table hub_shifts      enable row level security;
alter table global_contacts enable row level security;
alter table skip_dates      enable row level security;
alter table app_config      enable row level security;
alter table config_override enable row level security;
alter table config_history  enable row level security;
alter table rounds          enable row level security;
alter table entries         enable row level security;
alter table link_tokens     enable row level security;
alter table round_steps     enable row level security;
alter table alerts          enable row level security;
alter table outbox          enable row level security;
alter table login_codes     enable row level security;
alter table audit_log       enable row level security;
alter table heartbeat       enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on function claim_outbox(integer) from public, anon, authenticated;

-- ---------------------------------------------------------------- default config
insert into app_config (key, value) values
  ('system_enabled',                    'true'::jsonb),
  ('enabled_since',                     to_jsonb(now())),
  ('dry_run',                           'true'::jsonb),
  ('dry_run_to',                        '""'::jsonb),
  ('app_base_url',                      '""'::jsonb),
  ('timezone_offset_min',               '330'::jsonb),
  ('low_threshold',                     '10'::jsonb),
  ('excess_threshold',                  '10'::jsonb),
  ('threshold_mode',                    '"percent"'::jsonb),
  ('low_pct',                           '10'::jsonb),
  ('excess_pct',                        '10'::jsonb),
  ('round_open_offset_min',             '30'::jsonb),
  ('reminder_offset_min',               '60'::jsonb),
  ('l3_escalation_offset_min',          '60'::jsonb),
  ('zone_rm_ops_escalation_offset_min', '120'::jsonb),
  ('cutoff_offset_min',                 '240'::jsonb),
  ('token_ttl_hours_after_cutoff',      '24'::jsonb),
  ('ack_required_low',                  'true'::jsonb),
  ('ack_window_min',                    '30'::jsonb),
  ('first_email_to',                    '["POC1","POC2"]'::jsonb),
  ('alert_recipients_low',              '["ZONE_HR","OPS_HEAD","ZONE_RM"]'::jsonb),
  ('alert_recipients_excess',           '[]'::jsonb),
  ('status_board_scope',                '"zone"'::jsonb),
  ('digest_time_ist',                   '"07:00"'::jsonb),
  ('allowed_email_domains',             '["xpressbees.com","xpressbees.in"]'::jsonb),
  ('sender_display_name',               '"XB Peak Shift Tracker"'::jsonb),
  ('reply_to',                          '""'::jsonb),
  ('daily_send_cap',                    '1500'::jsonb),
  ('cap_warn_pct',                      '80'::jsonb),
  ('sanity_max_headcount',              '2000'::jsonb),
  ('placeholder_emails',                '[]'::jsonb),
  ('poc3_report_enabled',               'true'::jsonb),
  ('poc3_report_time_ist',              '"06:00"'::jsonb)
on conflict (key) do nothing;

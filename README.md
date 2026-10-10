# Peak Daily Shift Manpower Tracker

Shift-level manpower tracking for hubs, built for peak season.

For every hub and shift, 30 minutes after the shift starts the system **emails the hub POCs a one-tap link**.
They enter **Planned** and **Actual Manpower – Hub Processing**. The system calculates
**AD-HOC MANPOWER NEEDED = Planned − Actual**, alerts HR and Ops when it crosses the thresholds,
reminds and escalates when nobody enters, and shows everything on a **Hub view** and a **Zone view**.

* **Stack:** Next.js (Vercel) · Supabase Postgres · Gmail SMTP · pg_cron. Free tiers only.
* **Version 1 is email only.** WhatsApp is planned for version 2.
* Design, flowcharts and requirement checks are in [`docs/`](docs/).

> **This repository is public. Never commit** employee data (the master-data Excel is git-ignored),
> `.env` files, passwords or keys.

## How it works

```
pg_cron (every minute) ──► /api/tick ──► creates rounds, queues emails, escalates, digest
                                          └─► sends via Gmail ──► POCs / HR / Ops
POC taps the emailed link ─► /e/<token> ─► enters numbers ─► alerts are raised if outside the limits
Anyone with an XB email ───► /dashboard ─► Hub view, Zone view, Missing entries, Alerts
Admins ────────────────────► /admin    ─► POC directory, Settings (every number is config), Emails
```

Default ladder (all editable in **Admin → Settings**): email at shift start + 30 min to POC1 and POC2 →
+60 min reminder and POC3 → +120 min Zone RM and Ops head → +240 min cut-off (late entries still accepted).
LOW (ad-hoc needed ≥ 10) alerts Zone HR (must acknowledge), Ops head and Zone RM. EXCESS (≤ −10) alerts Zone HR.

## Set-up (one time)

1. **Database.** In Supabase open *SQL Editor*, paste [`supabase/migrations/0001_schema.sql`](supabase/migrations/0001_schema.sql) and run it.
2. **Keys.** Copy `.env.example` to `.env.local` and fill it in. Supabase: *Project Settings → API Keys → Secret key*.
   Gmail: a Google **app password** for the sender mailbox. Generate `SESSION_SECRET` and `CRON_SECRET` with
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
3. **Master data.** Fill `templates/master_data_template.xlsx` (see its README sheet), then
   `npm run import:master -- --check` and, if clean, `npm run import:master`.
4. **Deploy.** Import this repo into Vercel and add the same variables (set `APP_BASE_URL` to the Vercel URL).
5. **Scheduler.** In the Supabase SQL Editor run [`supabase/cron.sql.template`](supabase/cron.sql.template) after filling in the URL and `CRON_SECRET`.
6. **Monitor.** Point a free uptime monitor at `/api/health` (returns 503 if the scheduler has stopped).

The system starts in **dry-run mode**: every email goes only to the admin address, so you can test safely.
When you are happy, switch **Dry run** off in Admin → Settings.

## Switching it off

| Level | How |
|---|---|
| Whole system | Admin → Settings → *System ON* = No (no rounds, no emails; data kept) |
| One hub | Admin → POC directory → set the hub to Off |
| Hard stop | Supabase SQL: `select cron.unschedule('peak-tick');` |

## Develop

```
npm install
npm run dev        # http://localhost:3000
npm test           # unit tests (time zones, thresholds, escalation ladder, emails, config)
npm run typecheck
npm run build
```

Backups: Supabase's free tier has none, so export the tables regularly (Table editor → export CSV).

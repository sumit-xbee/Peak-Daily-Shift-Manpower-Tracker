# Requisites Checklist

Add an Owner and Status (Open / Done) next to each item as you go.

## Requisites from you

### Group A: Master data = the Excel template (first deliverable)

I will generate `templates/master_data_template.xlsx`: **column headers are already set, one sheet per table, and you only type your data**. `*` = mandatory. Planned manpower is **not** here, since POCs enter it.

| Sheet | Columns (in this order) |
|---|---|
| `README` | How to fill, colour legend, rules, and an **automatic summary of errors per sheet** with a "Ready to send" tick |
| `Zones` | Zone*, Zone RM Name*, Zone RM Email*, Zone HR Name*, Zone HR Email*, **Row Check** (auto) |
| `Hubs` | Hub*, Zone*, POC1 Name*, POC1 Email*, POC2 Name*, POC2 Email*, POC3 Name*, POC3 Email*, Active* (Y/N), **Row Check** (auto). **Hub HR is not collected**; alerts go to the Zone HR. |
| `Shifts` | Hub*, Shift Start* (HH:MM 24h), Shift End* (HH:MM 24h), **Row Check** (auto) |
| `Global Contacts` | Role* (OPS_HEAD / SYSTEM_ADMIN), Name*, Email*, **Row Check** (auto) |
| `Example` | A filled sample showing a 1-shift hub, a 9-shift hub and an overnight shift (`22:00` to `06:00`). It is **not** read by the system. |

How the template helps you:
- Dropdowns: Zone in `Hubs` comes from the `Zones` sheet, Hub in `Shifts` from the `Hubs` sheet, plus `Active` and `Role`.
- Row Check column: shows `OK` or the exact problem, and the row turns red.
- Capacity: 30 zones, 200 hubs, 1,000 shift rows.
- Input sheets are empty (headers only). The samples are on `Example`, so nothing sample can be imported by mistake.
- Shifts run every day. A day when a shift doesn't run is handled by a "skip date" in the app's Admin screen, so there is no day column.

**Rules the Row Check enforces**
- All `*` columns are filled.
- Emails are valid and end in `@xpressbees.com` or `@xpressbees.in`.
- Zone in `Hubs` exists in `Zones`, and Hub in `Shifts` exists in `Hubs`.
- Hub names are unique.
- **POC1, POC2 and POC3 should be 3 different people.** If one person fills several slots (for example a placeholder during testing), the row shows `OK (warning: same person in more than one POC slot)` and is still accepted.
- `Active` is Y or N.
- Start and End are valid times. An end earlier than the start means an overnight shift.
- There is **no** duplicate-shift-timing check, as you asked.

**Importer behaviour:** people are de-duplicated by email, so a POC who covers five hubs is fixed in one place in the app.

**What `Global Contacts` (formerly `org_roles`) defines**
- It holds the people who don't belong to a single zone or hub.
- The **OPS_HEAD** receives every LOW alert, across all hubs.
- The **SYSTEM_ADMIN(s)** edit Admin Settings and receive system-failure alerts.
- Two or three rows in total.

Please also confirm: the number of hubs and total hub-shifts per day (I read "30 Hubs * 400 shifts" as roughly 30 hubs and up to about 400 hub-shifts).

### Group B: Remaining decisions (tick or change my default)

| # | Decision | My default |
|---|---|---|
| 1 | Entry-page status board scope | Hubs in the same zone, names only (config) |
| 2 | Dashboard visibility | Any logged-in XB user sees all hubs and zones, and can enter missing data |
| 3 | Zone RM on LOW alerts | Included, since they own the zone |
| 4 | HR acknowledgement on LOW | Required, with repeat at 30 min |
| 5 | Reason code on breach | Optional dropdown (absenteeism, vendor no-show, transport, other) |
| 6 | Daily digest | 07:00 IST next day |
| 7 | Mid-peak changes (POC replaced, shift time changed, no-run date) | Done by SYSTEM_ADMIN in the app or by re-uploading the sheet |

### Group C: Accounts and access (free)

| Item | What is needed |
|---|---|
| Sender mailbox (Gmail) | Do these on the sender mailbox (~5 minutes):<br/>1. Turn on **2-Step Verification** (Google Account, Security).<br/>2. Open **myaccount.google.com/apppasswords** and create an app password named "Peak Tracker". It is 16 characters.<br/>3. **Do not paste it in chat or in the Excel.** I will show you where to put it (a Supabase secret named `GMAIL_APP_PASSWORD`).<br/>4. If the App passwords page is missing, your Google Workspace admin has disabled it. Tell me and I switch to the OAuth route (5.2 #4). |
| Vercel | Free (Hobby) account and the default `*.vercel.app` URL |
| Supabase | Free project, ideally in the Mumbai region |
| Git | A private GitHub repo with main and staging branches |
| Free uptime monitor | UptimeRobot or Better Stack free tier |
| Pilot | 5-10 hubs, including a 1-shift hub, a 9-shift hub and 2+ zones |
| IT sign-off | **Received.** Nothing further. |

---

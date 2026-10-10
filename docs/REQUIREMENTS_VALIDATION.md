# Requirements Validation

## Review of your comments (systematic)

| # | Your comment | What I did |
|---|---|---|
| 1 | Planned is entered by the POC, not uploaded | Two boxes per hub-shift. No plan sheet and no lock. I added cross-check aids (history, "plan changed" badge, last-plan hint, CSV export). |
| 2 | Identity on the link is the XB email only | No name or mobile prompt. Stored as "entered by". |
| 3 | Domains are `@xpressbees.com` **and** `@xpressbees.in` | Config list `allowed_email_domains`, and the Excel checks both. |
| 4 | Thresholds and numbers must be configurable | One config table plus per-hub override (section 1b). |
| 5 | Add column "AD-HOC MANPOWER NEEDED" = Planned - Actual, with a Hub view and a Zone view | Section 1c. |
| 6 | Keep the methodology and add a dashboard entry point for late data | "Missing entries" panel with inline entry. |
| 7 | POC1 and POC2 **both** receive the first message | Confirmed. POC3 joins on escalation. |
| 8 | POC1, POC2 and POC3 must be 3 different people | Relaxed on 2026-10-10 to a warning, because placeholders (one person in all slots) are used during testing. |
| 20 | Hub HR name and email will not be provided; only Zone HRs need communication on Buffer / Low | `Hub HR` columns removed. LOW and EXCESS alerts and the acknowledgement go to the Zone HR. |
| 21 | Unassigned hubs use the placeholder POC (one named person) for now; POCs will change soon and need an easy view and edit | POC Directory admin page (design section 1e). Until the app exists, edit the `Hubs` sheet and re-upload. |
| 9 | Drop the duplicate-shift-timing check | Removed. |
| 10 | No peak dates, but a way to switch the whole system on and off | Section 1d. |
| 11 | Remove SMS | Removed. |
| 12 | Remove WhatsApp from v1, email only, from the sender mailbox, well structured with no fluff | WhatsApp deferred to v2. Email design in section 2, sender risks in 5.2. |
| 13 | No budget, so free tiers plus backup | Nightly export, uptime ping. |
| 14 | No Shift Code, no Zone Code, no City/State, no effective dates, POC chain folded into Hubs, no plan sheet | Applied in the Excel format (section 4). |
| 15 | What is `org_roles`? | Answered in section 4. It is now `Global Contacts`. |
| 16 | Mobiles | Dropped, since mobiles were only for WhatsApp. They come back in v2. |
| 17 | The sender mailbox is on **Gmail**, not Microsoft 365 | Sending is redesigned around Gmail (5.2 #4, Group C). The Microsoft Graph route is removed. |
| 18 | IT sign-off is received | Removed from the open items. |
| 19 | Mail stays inside the organisation and in limited volume | Recipients are all XB addresses. A daily send cap with a warning is added to config. |

---

## 5. Validation of your brief

### 5.1 Traceability

| Your requirement | Design response | Verdict |
|---|---|---|
| Plan at shift level, not daily | Round per hub x shift timing x date | Covered |
| 1 to 9 shifts per hub | `Shifts` sheet, one row per timing | Covered |
| Message at shift start + 30 min | Round opens at +30 (config), by email | Covered |
| POC enters planned and actual | Two boxes per hub-shift | Covered |
| Calculate shortfall | AD-HOC MANPOWER NEEDED = Planned - Actual | Covered |
| Dashboard graph per hub, plus Zone view | Section 1c | Covered |
| Alert beyond +-10, and make it configurable | Config-driven thresholds, diagram C | Covered |
| HR alerted strongly, plus Ops head | Email to Zone HR with acknowledgement, repeat and escalation to Ops head and Zone RM | Covered (Zone HR only, as Hub HR is not provided) |
| Sole link, one or many hubs, shareable | POC master link and one-hub delegate link | Covered |
| See who entered and who didn't, with POC name | Status board and dashboard | Covered |
| Reminder after 1 hour, escalate to L3 | T0+60 reminder and POC3 escalation | Covered |
| Late entry from the dashboard | Missing entries panel | Covered |
| Reliable, closed system | Idempotent outbox, watchdog, audit, XB-domain-only OTP | Covered |
| Email only, structured, from your mailbox | Email design, sender adapter | Covered, with the sender caveat below |
| On/off switch | Section 1d | Covered |
| No budget | Free tiers, nightly export | Covered, with caveats below |

**Added by me (strike any you don't want):** MISSED cut-off, Zone RM + Ops escalation at +120, HR acknowledgement loop, reason code, daily digest, readiness gate, dry-run mode, watchdog, last-plan hint, "plan changed" badge, CSV export, Zone RM on LOW alerts.

### 5.2 Risks and judgement calls

1. **Forwardable link vs trustworthy.** Anyone holding the link can submit, and the XB email is self-declared. I kept the convenience and added the domain check, an email log, a "delegate" label, edit history and a one-hub-only delegate scope. If you later need stricter control, a one-time code on the email would close the gap.
2. **POC-entered plan.** There is no lock, per your decision. The cross-check aids make your verification quick.
3. **Zone roll-up masking.** The Zone view shows shortfall-only and excess-only totals next to the net.
4. **Sending from your Gmail mailbox.** Mail goes through Google's own servers and the recipients are all inside XB, so deliverability is not a concern (SPF and DKIM are already Google's).
   - **Chosen route: Gmail SMTP** (`smtp.gmail.com`, **port 465, SSL**) with an **app password**. I believe Supabase Edge Functions block outbound ports 25 and 587 but allow 465, and I will confirm this with a send test at the start of the build.
   - **Fallback route: Gmail API with OAuth.** It is used only if your Workspace admin has disabled app passwords. It needs a one-time Google Cloud OAuth consent as you, and it takes about 30 minutes more to set up.
   - **Secret storage.** The app password lives only in a Supabase secret, never in code, Git or the Excel. If you change your Google password or revoke it, sending stops, so the watchdog emails the admin and the app shows a red "Sender not working" banner.
   - **Sending limits.** Google limits a Workspace account to roughly 2,000 emails a day (a free Gmail account to about 500). I set `daily_send_cap` to 1,500 with a warning at 80%. Please tell me whether this is a Workspace account. Volume is bounded by one email per POC per round, and by deduping.
   - **Dashboard login emails.** The OTP emails for dashboard login come from the same mailbox through Supabase Auth's custom SMTP, and they count towards the cap.
   - **Dependency.** If your mailbox is suspended or you leave the company, all emails stop. Please plan to move to a shared mailbox such as `peak-tracker@`, and it is one config change.
   - **Replies.** Replies land in your inbox, so the emails say "Do not reply", and an optional Reply-To is configurable.
5. **Vercel Hobby terms.** The free plan is for non-commercial use, and an internal company tool may not qualify. Please check with IT. The fallback is a free static host such as Cloudflare Pages, with the same Supabase backend.
6. **Supabase free tier.** The project pauses after a week of inactivity and has no point-in-time backups. The daily cron plus the monitor ping prevent pausing, and the nightly export covers backups.
7. **Email-only means no second channel.** If the email system is down or an email lands in spam, there is no fallback. The Missing entries panel and the escalation ladder mitigate this, and WhatsApp in v2 is the proper fix.
8. **Edge cases to fix the rule for:**
   - A shift that doesn't run on a given day.
   - A POC who is POC1 for one hub and POC2 for another.
   - A POC change in the middle of peak.
   - A late entry after cut-off.

---

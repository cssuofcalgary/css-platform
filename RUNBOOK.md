# CSS Platform: Runbook ("something broke")

Written so a non-developer can follow it. Everything is in the CSS Google account (`css.uofcalgary@gmail.com`).
Links and IDs are in `README.md` section 2.

## The pages don't load at all
The pages are hosted by GitHub Pages from https://github.com/cssuofcalgary/css-platform. Check repo **Settings → Pages** still says "Deploy from a branch: main / (root)". A bad push can break a page: on GitHub, open the repo's **commits**, find the last good one, and revert the newer one (or ask anyone who knows git).

## First: is the back end alive?
Open the **web app URL** (README section 2) in a browser.
- Shows `{"ok":true,"service":"CSS Platform API",...}` → the back end is fine. The problem is the page or the internet.
- Shows **"Access Denied"** or a Google sign-in page → it needs re-authorizing. See "Authorization" below.
- Shows **"Sorry, unable to open the file"** → the deployment was deleted. See "Redeploy" below.

## Common problems

| You see | Why | Fix |
|---|---|---|
| Someone says they never got the "Find my tickets" email | Wrong email/UCID/last name (the page never says), spam folder, it only covers paid tickets for upcoming events, or the daily cap (40) was hit | Check the order in Payments, use **Resend tickets**, or fix their email with Edit |
| "This link isn't valid" on the member portal tickets section | The private link was cut off, or `LINK_KEY` was deleted | Ask them to use "Email me my tickets link" (or "I forgot which email I used") for a new one |
| Want to cancel every emailed private link (a leak) | | Apps Script → Project Settings → Script Properties → delete `LINK_KEY`. A new key is made automatically and old links stop working |
| "Can't reach the CSS system" | No internet, or the back end is down | Check the internet, then do the "alive?" test above |
| "The system isn't set up yet" | A Script Property is missing | Editor → ⚙ Project Settings → Script Properties. `MEMBERSHIP_SHEET_ID` and `EXEC_PASSWORD` must exist |
| "That password isn't right" for everyone | The password was changed | Check `EXEC_PASSWORD` in Script Properties |
| "Too many wrong tries" | 10 wrong passwords in 10 min | Wait 10 minutes |
| "Connection is slow. Trying again…" (yellow bar) | Google was slow. The portal retries lookups by itself, up to 3 times | Wait a few seconds. Nothing to do. If a *change* (mark paid, edit) says "Google was slow", check the person's row before pressing again |
| "The system is busy" | Many changes at the same moment | Try again in a few seconds |
| Member info looks out of date | Search data refreshes every 5 min | Wait 5 min |
| Event image doesn't show | The image file was deleted or unshared in Drive | Edit the event and upload the image again |
| "Invalid Date" on a page | Someone typed into the data sheet by hand | Edit the event in the portal and save. Avoid editing the sheet directly |
| Old pages show old behaviour after a fix (e.g. a new tab is missing) | Browser/GitHub cache (up to 10 min) | Open in a private/incognito tab, or wait 10 min and refresh. Whoever published should bump the `?v=` numbers (README section 7) |
| Someone says they didn't get the "registration received" email | Daily email limit hit, typo in their email, or spam folder | Their payment screen already showed everything. Check the email they typed (Log / Orders tab). The limit resets daily |
| "Too many registrations from this email" | Same email registered 5 times in 10 min | Wait 10 minutes (anti-spam) |
| Registration says "closed" | Event is a draft or closed | Events tab → Publish / Reopen |
| Someone paid but has no ticket email | Spam folder, typo'd email, or daily limit | Payments → find the order → **Resend tickets**, or open **Ticket ↗** and show/send them the link. "Emails waiting" banner → **Send now** |
| Event picture shows as a green box with the event name | The picture link is broken (file deleted/moved in Drive) | Events → Edit → upload the picture again → Save |
| Public page stuck, then says "Something went wrong" | Google was slow or down (the page gives up after 30 s) | Reload. If it keeps happening, check the Apps Script **Executions** page for errors |
| Ticket link in an email doesn't open | The public site moved or isn't hosted yet | Host the `public/` folder, set `PUBLIC_SITE_URL` in `exec-portal/config.js` to its address, then **Resend tickets** |
| A volunteer's phone can't do walk-ins or see payments | That's the door scanner (phones open it on purpose) | Use the help desk laptop, or tap **Full portal** on the phone |
| Camera won't start on the Door tab | Camera permission denied, or not https | Allow camera for the site in the browser settings, reload. Or type names/ticket IDs instead |
| Everyone scans orange "entry is closed" | Entry wasn't opened | Door tab → tap the Entry button to open |
| Checked in the wrong person | Human mistake | Door tab → **Recent check-ins** → **Undo** |
| Everyone flagged gets orange "go to the help desk" | On purpose | Help desk: Door tab → "Please check" list → **Check in** after checking |
| Can't find the Archive button | Signed in with the exec password | Sign out, sign in with the **admin** password (`ADMIN_PASSWORD` in Script Properties) |
| Registration closed too early/late | The event's "Registration closes" time | Events → Edit → change or clear it |
| Marked the wrong order paid | Human mistake | **Refund / cancel** it (no money to return if none was received), and ask the person to register again. Everything stays in the Log |

## Authorization (Google permission prompt)
Needed after permissions change, or if Google revokes access.
1. Open the Apps Script editor (README section 2), signed in as the CSS account.
2. Open **Config.gs** → choose **checkSetup** in the function dropdown → **▶ Run**.
3. **Review permissions** → CSS account → **Advanced → Go to CSS Platform API (unsafe) → Allow.**
   ("unsafe" only means Google hasn't reviewed this private club script. It's normal.)
4. The log should say **✅ Setup OK**.

## Redeploy (keep the same URL)
Editor → **Deploy → Manage deployments** → ✏ → **Version: New version** → **Deploy**.
Only if the deployment is truly gone: **Deploy → New deployment** → Web app, Execute as **Me**, Access **Anyone** → copy the new URL → put it in `exec-portal/config.js` and `public/config.js` → re-upload those pages.

## Data went wrong (someone deleted rows, bad edit)
The data sheet ("CSS Platform Data", maybe renamed) keeps **version history**:
1. Open it → **File → Version history → See version history**.
2. Pick a time before the problem → **Restore this version**.
3. The **Log** tab shows who changed what and when, which helps find the right time.

If the sheet was **deleted**: restore it from Drive **Trash** (within 30 days). If it's gone for good, the system makes a **new empty one** automatically, but event data is lost (the old system still works as the fallback).

To point the system at a **restored copy** instead: copy the copy's ID (the long part of its link between `/d/` and `/edit`) → Script Properties → set `DATA_SHEET_ID` to it.

## Change passwords
Easiest: sign in with the admin password → **Settings** → Passwords. Everyone else is signed out and must use the new one. Tell execs in person.
**Lost the admin password?** Script Properties → edit `ADMIN_PASSWORD` → Save. Works immediately; no redeploy.

## Something feels off / errors
Settings → **Health check** shows what's reachable and the last error the system saw. Activity shows what changed and who did it.

## Emergency: switch back to the old system
The old system (`../CSS Ticketing System/`: Google Forms, the old scanner and pay page) was never changed and still works. Run the event with it.

## Last resort
Everything is plain JavaScript with comments. Any developer (or a future AI) can start from `README.md`.

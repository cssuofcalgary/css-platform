# CSS Platform (V2): Technical README

The Chinese Students' Society's own event, ticket and membership platform: a mini Luma/Eventbrite built on free Google tools.
**Execs:** you want `HANDBOOK.md`. **Something broke:** `RUNBOOK.md`.

Status: **v0.2 in progress.** Member search ✅ · Events + public pages ✅ · Registration ✅ · Payments/tickets ✅ · Door/scanner ✅
The old system (`../CSS Ticketing System/`) keeps running until this one is proven. Nothing here touches it.

---

## 1. How it fits together

```
 People                     Web pages (static files)              Back end                     Storage
 ─────────                  ───────────────────────              ─────────                    ─────────
 Public / attendees  ──►    public/        (event pages)   ──┐
 Execs               ──►    exec-portal/   (Exec Portal)   ──┼──► "CSS Platform API"   ──►   Google Sheets + Drive
                                                             │    (Google Apps Script
                                                             │     web app, api/)
```

- **Pages** are plain HTML/CSS/JS with no build step. Host them anywhere static (Vercel, GitHub Pages) or open them from disk.
- Every page talks to **one** back end: an Apps Script web app. The page sends `POST` with a JSON body `{ action, token, ...details }` and gets JSON back: `{ ok: true, ... }` or `{ ok: false, error: "CODE", message }`.
- **Storage:**
  - **Membership sheet** (the existing one): only **read** so far, for member search and member-price checks.
  - **"CSS Platform Data"**: a spreadsheet the back end created and owns. One tab per table (section 4).
  - **"CSS Platform/Event images"** Drive folder: uploaded event images, viewable by link.

## 2. Where everything lives

| Thing | Where |
|---|---|
| Google account that owns everything | `css.uofcalgary@gmail.com` |
| Apps Script project | "CSS Platform API", script ID `1xxpp4EJA-0uUhtwo9sOK9e1itomqN_29C6lwg3jzh35pabKJ-vOKnpMB`. Editor: https://script.google.com/d/1xxpp4EJA-0uUhtwo9sOK9e1itomqN_29C6lwg3jzh35pabKJ-vOKnpMB/edit |
| Web app deployment ID | `AKfycbxJ_a_cHyRXadK17ocIebhE2XDFcpEADCzSqOVXwdCgIQe1T-UPi-efzgla2mn7ML2d` |
| Web app URL (API) | `https://script.google.com/macros/s/<deployment ID>/exec`. Opening it in a browser shows `{"ok":true,...}` |
| Platform data sheet | "CSS Platform Data" (may be renamed/moved; the system finds it by ID, stored in Script Property `DATA_SHEET_ID`) |
| Event images | Drive folder "CSS Platform/Event images" (ID in Script Property `IMAGE_FOLDER_ID`) |
| Local code | `Chinese Student Society/CSS Ticketing System V2/` (OneDrive), a git repo |
| GitHub repo | https://github.com/cssuofcalgary/css-platform (public for now; can go private once it moves to Vercel) |
| **Public site (live)** | https://events.ucalgarycss.ca/ (event page: `/?e=<slug>`, ticket: `/ticket.html?t=<secret>`) |
| **Exec Portal (live)** | https://exec.ucalgarycss.ca/ (door scanner: `/scanner/`). Layout: `theme.css` is the look (sidebar, cards, Overview, help-desk Door); the JS files are unchanged logic. |
| Hosting | GitHub Pages (branch `main`, folder `/ (root)`, about a minute per push) until the Vercel move; then Vercel, see "Hosting on Vercel" below |

## 3. Files

| File | What it does |
|---|---|
| `api/appsscript.json` | Manifest: timezone, permissions (Sheets, Drive, send email), web app = run as owner, anyone can call |
| `api/Api.js` | Entry point. `doGet` = health check. `doPost` = routes every action. Login + sessions |
| `api/Config.js` | Reads Script Properties. `checkSetup()` = one-click setup test (run from the editor) |
| `api/Members.js` | Member model: turns Membership-sheet rows into Member objects, member search. Pure logic |
| `api/Store.js` | Reads the Membership sheet (cached 5 min; if Google fails, an older copy up to 6 h old is used instead of an error) |
| `api/Db.js` | The platform data sheet: creates tabs, reads rows, inserts/updates **by id**, change log, lock. `retry_()` repeats a Sheets call up to 3 times when Google has a momentary failure (reads and updates only, never inserts) |
| `api/Events.js` | Events: validation, save, publish/close, image upload, public event views |
| `api/Orders.js` | Registration: one Order (payment code) + one Ticket per person, membership check (flags, never blocks), duplicate check, anti-spam |
| `api/TestKit.js` | Stress-test kit, run **by hand from the Apps Script editor** (not reachable from the web): `buildStressTest()` makes two closed test events, 46 varied fake attendees (all @example.com) and emails a sheet of 50 QR codes with the expected result of each scan; `emailStressTestSheet()` re-sends it; `removeStressTest()` archives both events. Run `buildStressTest` once |
| `api/MyTickets.js` | "Find my tickets / pass" lookups (email or UCID + last name) and the private-link tickets for the member portal |
| `api/Payments.js` | Finance: list orders, mark paid (capacity check, `force` to override), refund/cancel (never deletes), resend tickets, send waiting emails. Public ticket lookup by secret. Remembers the public site address for email links (`PUBLIC_SITE_URL` property) |
| `api/EmailTemplates.js` | The standard wording of each email (`EMAIL_KINDS`), fill-ins like `{name} {event} {code} {amount} {when} {where}`, saved custom wording, preview and test send. To add a new kind of email: add it to `EMAIL_KINDS` and write its `build…Email_` in `Mail.js` |
| `api/Archive.js` | Moves finished events to the yearly archive and back. `archiveEvent_` (stop sign-ups → copy rows → check the copy → mark the event archived → delete the live rows; a crash in the middle is finished by the next nightly run), `restoreEvent_`, `archiveOldEvents_` (called by `nightlyJob`, 2 events per run), `eventRows_(table, event)` (reads an event's rows from the live sheet or its archive; used by Attendees and Payments), `assertNotArchived_` (blocks walk-ins, added registrations and the door list on archived events), `archiveStatus_` (health check line; Problem when live tickets pass 3,000 or an old event hasn't moved). `setEventStatus_` calls it when an admin presses Archive / Restore |
| `api/Jobs.js` | Background timers. `installJobs` (run once in the editor) takes a backup now; the timers are added by hand under Apps Script → Triggers: `nightlyJob` (about 3 am: backup copy of the data sheet into the Drive folder "CSS Platform Backups", keeps 14, older ones go to the Drive bin; then a health check; emails the CSS Gmail only if something is wrong, at most once a day) and `hourlyJob` (closes entry 4 hours after an event's end time if someone forgot). Both log as "system". Uses no extra permission (a script adding its own timers needs `script.scriptapp`, which broke the web app's authorization once, so the timers are added by hand) |
| `api/Settings.js` | Admin only: read/save settings (validated; a new Membership sheet is really read before it's accepted), passwords, "sign everyone out" (a session *epoch*: every session remembers the epoch it was made in, changing it invalidates them all), health check, last-error memory |
| `api/Activity.js` | Turns the Log tab into readable sentences, with filters (event, exec, group, text) |
| `api/Summary.js` | `eventSummary`: the numbers, money, per-type counts, answers to custom questions and the attendee list for one event. Read-only |
| `api/Door.js` | Door: entry open/closed, `scan` (ticket link / secret / TKT id → green / green-flag / orange / red, checks in under the lock), walk-ins (paid + checked in, always allowed), help-desk list |
| `api/Mail.js` | Emails from the CSS Gmail (checks the daily limit first). **Addresses @example.com/.org/.net are never emailed** (use them for testing) |
| `exec-portal/` | Exec Portal: `index.html`, `app.js` (sign-in + Members tab), `events.js` (Events tab), `payments.js` (Payments tab), `finance.js` (reminders, mark several paid, add a paid registration), `activity.js` (Activity tab, admin only), `settings.js` (Settings tab, admin only), `edit.js` (the Edit person panel), `attendees.js` (event numbers + attendee list), `door.js` (Door tab; camera via html5-qrcode from unpkg), `strings.js` (**all text**), `config.js` (API URL + public site URL), `mock.js` (demo mode when API URL is empty) |
| `public/` | Public site: `index.html`, `public.js` (event list, event page, registration form, payment screen), `ticket.html` + `ticket.js` (a person's ticket with QR; QR library from cdnjs), `public.css` (look copied from the member portal, member.ucalgarycss.ca: sage/clay/cream colours, Silkscreen + Source Serif 4 fonts from Google Fonts, zig-zag card, pandas; colours are variables at the top), `assets/` (pandas + CSS logo fallback; the banner and background pictures load from the CSS Google Drive), `strings.js` (**all text**), `config.js` (API URL, contact email, Instagram) |

### Hosting on Vercel (events.ucalgarycss.ca + exec.ucalgarycss.ca)
One GitHub repo, **two Vercel projects**, each serving one folder as a static site (no build step):

| Vercel project | Root Directory | Domain |
|---|---|---|
| `css-events` | `public` | `events.ucalgarycss.ca` |
| `css-exec` | `exec-portal` | `exec.ucalgarycss.ca` (and `/scanner/`) |

Framework preset **Other**, no build command, no output directory. Each folder has a `vercel.json` (always re-check for fresh files; the exec site is kept out of search engines). DNS (Akhil, who owns the domain): a CNAME for `events` and one for `exec`, pointing at the value Vercel shows for each project. Every push to `main` redeploys both automatically.
`exec-portal/config.js` picks the public site address by host name: on `exec.ucalgarycss.ca` it uses `https://events.ucalgarycss.ca/`, elsewhere (GitHub Pages, local) the sibling folder. Ticket links in emails follow it (the `PUBLIC_SITE_URL` Script Property is refreshed the next time Finance marks an order paid; press **Resend tickets** to send fresh links for existing orders). Old GitHub Pages links keep working while Pages stays on, and old QR codes keep scanning (the scanner reads only the secret after `t=`).
The API address (Apps Script) is the same from every site; nothing to change there.

### Layout modes (exec-portal)
- **Wide screens (960 px+):** sidebar navigation, a shared event picker in the top bar (Payments and Door follow it), a stat strip and a table-style order list on Payments. Pure CSS under `@media (min-width: 960px)` at the bottom of `styles.css`, plus `renderGlobalEvent()` in `events.js`.
- **Scanner mode:** `exec-portal/?mode=scanner` (also reachable at `scanner/`, which just redirects there). Shows only the Door tab: camera, "inside" counter, name/ticket search, Undo. Hides walk-ins, the unpaid and flagged lists, entry open/close and every other tab, and never lets an unpaid or flagged person in ("Send to help desk"). **Phones are sent here automatically**; `?full=1` on a phone opens the full portal. It is a *convenience view, not a security boundary*: the same exec password signs in and the API still allows exec actions. A real door-only role would need its own password and an action allow-list.
- When the site moves to Vercel with `exec.ucalgary.ca`, add a rewrite so `/scanner` opens `/exec-portal/?mode=scanner` (or keep the `scanner/` folder). A separate subdomain isn't needed.

## 4. Data tables ("CSS Platform Data")
Row 1 = column names. **Don't rename tabs or row-1 names.** Rows are matched by `id`, so sorting or filtering by hand is safe.
Lists (`ticketTypes`, `questions`, `answers`, `summary`) are stored as JSON text.

**Only current events live here.** Thirty days after an event, the nightly job moves that event's Tickets and Orders rows into a yearly archive spreadsheet (`CSS Platform Archive 2026-27`, September to August, in the Drive folder `CSS Platform Archive`; same tabs and columns) and writes the event's final numbers into the Events row: `archivedAt`, `archiveYear`, `summary` (totals, money, per ticket type, answer counts, spots taken) and `status = archived`. The Events tab always keeps every event. An admin can do the same by hand with **Archive** on the Events list, and **Restore** brings the rows back (status `closed`). Why: every request reads the whole Tickets and Orders tabs; with old events gone, those stay small and the shared table cache (limit about 4,800 tickets) keeps working. Nothing is deleted. Code: `api/Archive.js`.

| Tab | Columns |
|---|---|
| Events | id, slug, name, description, date (YYYY-MM-DD), startTime, endTime (HH:mm), registrationCloses (YYYY-MM-DDTHH:mm, Calgary time; blank = when the event starts), location, capacity (blank = no limit), capacityRule (`paid`/`all`), status (`draft`/`published`/`closed`/`archived`), entryOpen, imageFileId, imageUrl, ticketTypes, questions, codePrefix, createdBy, createdAt, updatedBy, updatedAt |
| Orders | id, code (payment code, e.g. MGN-4821), eventId, payerName, payerEmail, etransferName, total, status (`awaiting`/`paid`/`refunded`/`cancelled`; free orders start `paid`), createdAt, paidAt, paidBy, notes, remindedAt (when the last "please pay" reminder went out; text like "test address, not sent" for @example.com) |
| Tickets | id (`TKT` + 8 chars), secret (for the ticket link), orderId, eventId, name, email, ucid, memberId, ticketType (name), price, answers (question label → answer), flag (why the help desk should check, e.g. membership not found, duplicate email), status (same as its order), checkedInAt, checkedInBy, createdAt, emailedAt (when the ticket email went out; blank = waiting; "test address, not sent" for @example.com) |
| Log | time, who, action, target, details. Every change made through the portal |

`ticketTypes` item: `{ id, name, price, needsMembership }` · `questions` item: `{ id, label, type: "text"|"choice", options: [], required }`

## 5. API actions

| Action | Login? | Does |
|---|---|---|
| `publicEvents` | no | Upcoming published events (public fields only) |
| `publicEvent` `{slug}` | no | One published/closed event + registrationOpen, soldOut, spotsLeft, e-transfer email |
| `login` `{password, name}` | — | Exec password → role `exec`, admin password → role `admin`. Returns a token (valid 6 h). 30 wrong tries in 10 min → 10-min pause for new sign-ins |
| `register` `{slug, people[], etransferName, website}` | no | `people[0]` = payer, others = friends. Each: name, email, ucid?, memberId?, ticketTypeId, answers `{questionId: value}`. Max 10. `website` must be empty (bot trap). Same email max 5 registrations / 10 min. Returns payment code, total, e-transfer email, tickets + flags; emails the payer |
| `getTicket` `{secret}` | no | One ticket + its event, for the ticket page |
| `findMyTickets` `{email}` or `{ucid, lastName}` | no | "Find my tickets" (`public/tickets.html`, code in `api/MyTickets.js`). Never returns tickets: emails links for the person's paid tickets on upcoming events to the address on each ticket. Identical reply whether or not anything was found (no masked address, so nothing to probe). Limits: 4 tries and 1 sent email per search per 10 min, 40 emails a day (`FIND_TICKETS_*` constants), test addresses never emailed. Logged as `tickets.lookup` |
| `findMyPass` `{email}` or `{ucid, lastName}` | no | Same idea for the **member portal** (`member.ucalgarycss.ca`, whose lookup page calls this API): finds the person on the Membership sheet and emails a link `member.ucalgarycss.ca/?member=<ID>` to the email on file. Shares the same limits and the 40-a-day cap. Logged as `pass.lookup`. The email's link is a private link (`?member=ID&k=KEY`) |
| `myTickets` `{memberId, k}` or `{email, k}` | link key | For the member portal: a person's upcoming paid/awaiting tickets (with secrets, so it can draw QR codes). `k` is a signature (HMAC) of the member ID or email made with the Script Property `LINK_KEY`, so only someone who got the emailed private link can see tickets. Member IDs and emails alone never work. Members are matched to tickets by member ID, UCID or email; non-members by ticket email. Code in `api/MyTickets.js` (`linkKey_`, `memberPassLink_`, `ticketsLink_`, `myTickets_`) |
| `logout` | yes | Ends the session |
| `searchMembers` `{query}` | yes | Up to 25 members + `total` |
| `registerMember` `{name, ucid, email, method ("etransfer" or "cash"), when?, where?, who?, website?}` | no | **Join CSS** (`member.ucalgarycss.ca/create`, in the member portal repo). Adds one row to the Membership sheet (Paid Status `Awaiting E-transfer` / `Awaiting Cash`, Mail Status `Pending`, a new `CSS…` member ID). A UCID or email already on the sheet: paid gives `ALREADY_MEMBER`, unpaid gives `existing: true` and adds nothing. Limits: 5 tries per UCID and 40 sign-ups per 10 minutes in total. Logged as `member.signup` |
| `addMember` `{member: {name, ucid, email, method, when?, where?, who?}, paidNow}` | yes (exec) | The Members tab's **Add member** button. Same row as a web sign-up; with `paidNow` it is marked paid and the pass is emailed in the same step. An existing UCID or email is refused (`ALREADY_MEMBER` / `ALREADY_SIGNED_UP`). Logged as `member.add` |
| `listPendingMembers` `{offset?, limit?}` | yes | Members whose Paid Status starts with `Awaiting` (online sign-ups and unpaid Add member), newest first, 20 a page, plus `total` and `hasMore`. Feeds the Members tab's Pending list, the sidebar count and the Overview alert |
| `markMemberPaid` `{memberId}` | yes (exec) | Sets Paid Status to `PAID`, emails the member their pass (Mail Status `Sent`), logs `member.paid` with who confirmed it |
| `getMember` `{memberId}` | yes | One member |
| `listEvents` | yes | All events incl. drafts + `counts[eventId] = {awaiting, paid, checkedIn}` |
| `saveEvent` `{event}` | yes | Create (no id) or update (with id). The slug (public link) never changes after creation |
| `setEventStatus` `{eventId, status}` | yes | draft / published / closed / **archived** (archiving or restoring needs the **admin** password). Archived events vanish from the public site and the day-to-day tabs; nothing is deleted |
| `updateTicket` `{ticketId, changes, orderChanges?, siteUrl}` | yes | Edit a person. `changes`: `name`, `email` (any exec; new email on a paid ticket = ticket re-sent) and, **admin only**, `ucid`, `memberId`, `ticketTypeId` (changes the price and the order total), `answers {questionLabel: value}`, `flag`. `orderChanges` (**admin only**): `payerName`, `payerEmail`, `etransferName`, `notes`. Only fields that really differ count. Changing member ID / UCID / ticket type re-checks the Membership sheet (other flags stay) unless `flag` is sent. Everything is logged with old and new values. Replies `total {was, now}` when the price changed |
| `activityLog` `{filters: {eventId?, who?, group?, query?, limit?}}` (limit 50/100/200, default 50) | **admin** | The change log as sentences, newest first (max 300). `group`: payments / door / edits / events / settings |
| `getSettings` | **admin** | Current settings (never passwords; only whether each is set) |
| `saveSettings` `{settings}` | **admin** | Any of `etransferEmail`, `contactEmail`, `instagramUrl`, `membershipSheet`, `membershipTab`, `execPassword`, `adminPassword`. Passwords: 8+ characters, must differ. A password change signs everyone out and returns a fresh `token` for the caller. Logged by name only |
| `signOutAll` | **admin** | Signs everyone out; returns a fresh `token` for the caller |
| `openMyAccess` `{ucid, lastName}` | no | "I forgot which email I used": a UCID and last name that both match go straight in, no email step. Returns `{kind:"pass", memberId, k}` for a member (the portal opens the pass with the tickets under it) or `{kind:"tickets", ucid, k}` for someone whose tickets carry that UCID and name (tickets-only page). `k` is the private key (`tixu` key for UCID; `myTickets` accepts `{ucid, k}`). Wrong matches answer `NOT_FOUND`. Limits: 4 tries per UCID and 120 tries in total per 10 minutes. Logged as `access.open`. The events site's "Find my tickets" sends UCID + last name here too and then jumps to `member.ucalgarycss.ca/?member=…&k=…` or `?tucid=…&k=…` |
| `emailAttendees` `{eventId, audience, subject, message, dryRun?}` | exec | Email everyone registered for an event. `audience` = `all` (paid + unpaid), `paid` or `awaiting`. One email per address; @example.com skipped; needs `BROADCAST_QUOTA_SPARE` (10) emails of the day's allowance to spare; the same message to the same group within 10 minutes is refused (double taps). `dryRun` returns the counts and a preview. Message fill-ins: `{name} {event} {when} {where}`. Logged as `event.email`. Code in `api/Broadcast.js` |
| `loginDoor` `{name, password?}` | no | Door-only sign-in on the scanner page: a name, plus the door password if one is set (Script Property `SCANNER_PASSWORD`). Only works while some event has entry open. The session (role `door`) can only call `listEvents` (open events only), `doorList` (names and status only: no payment details, secrets or answers), `scan` (no help-desk override), `undoCheckIn` and `logout`. Every other action answers `DOOR_ONLY`; once entry is closed it answers `DOOR_CLOSED`. The check is in `requireSession_` (`checkDoorSession_` in `api/Door.js`) |
| `deleteEvent` `{eventId, confirmName, force?}` | **admin** | Deletes an event for good: the Events row and every ticket and order on it (live sheet or archive). `confirmName` must equal the event's name exactly. If any order was paid for money, answers `NEEDS_FORCE` until sent again with `force: true`. The Log keeps a line (`event.delete`) with the name and counts; old backups still hold a copy. Code: `deleteEvent_` in `api/Archive.js` |
| `getEmailTemplates`, `saveEmailTemplate` `{key, fields}`, `saveEmailBrand` `{brand}`, `previewEmail` `{key, fields}`, `sendTestEmail` `{key, to, fields}` | **admin** | Editable email wording (Settings → Email wording). `fields` = subject, title, subtitle, intro, closing; blank = standard wording, a lone `-` = show nothing. `previewEmail` builds the real email with sample data (and unsaved edits); `sendTestEmail` sends it to a real address (max 5 a day, never @example.com). Code in `api/EmailTemplates.js`; the emails themselves are built in `api/Mail.js` (`build*Email_` return `{subject, html, plain}`, `send*Email_` send them). Saved in the `Emails` tab of the data sheet |
| `healthCheck` | **admin** | Platform sheet, Membership sheet, email allowance, last error, whether the public site address is known |
| `eventSummary` `{eventId, filter?, q?, sort?, offset?, limit?, full?}` (the numbers always cover the whole event; `attendees` is one page of 50, `full:true` = everyone for the download) | yes | `totals` (registered, paid, awaiting, checkedIn, notArrived, flagged), `money {received, awaiting}`, `spotsLeft`, `byType`, `questions` (each answer counted), `attendees` (every ticket + its order; no secrets) |
| `undoCheckIn` `{ticketId}` | yes | Clears a check-in (logged) |
| `listOrders` `{eventId, filter?, q?, offset?, limit?}` (paged: 50 at a time; `filter` awaiting/overdue/paid/closed/all; replies with `counts`, `total`, `hasMore`) | yes | Orders with their tickets (incl. ticket secrets, for help-desk links), the event's ticket types and questions, `money {received, awaiting}`, `reminderHours`, spots taken, unsent email count |
| `markOrderPaid` `{orderId, force?, siteUrl}` | yes | Order + its tickets → paid, emails each ticket. Refuses with `OVER_CAPACITY` unless `force` |
| `markOrdersPaid` `{orderIds[], siteUrl}` | yes | Marks up to 10 orders paid in one call (the page sends them in groups of 8). Orders that would go over capacity are **skipped and reported**, never forced. Replies `results[]` (ok / error per order) + emails sent |
| `sendReminders` `{eventId, dryRun?}` | yes | Emails the payer of every order still unpaid after `REMINDER_AFTER_HOURS` (48, in `Config.js`), and again only after another 48 h. `dryRun` returns `due`, `toEmail`, `emailsLeftToday` without sending. Orders are claimed under the lock first, so two people pressing the button can't double-email. Refuses for events that are already over |
| `addOrder` `{eventId, order: {person: {name, email, ucid?, memberId?, ticketTypeId, answers?}, etransferName?, notes?}, force?, siteUrl}` | yes | Finance adds someone who paid without registering: a paid order + ticket, ticket emailed. Membership checked (flags, never blocks). `OVER_CAPACITY` unless `force`. Custom questions aren't required here |
| `refundOrder` `{orderId, reason}` | yes | Paid → refunded, awaiting → cancelled. Spot reopens. Refuses if anyone already checked in |
| `resendTickets` `{orderId, siteUrl}` | yes | Emails the paid tickets again |
| `sendPendingEmails` | yes | Sends ticket emails that were held back by the daily limit |
| `setEntryOpen` `{eventId, open}` | yes | Scanners only check people in while entry is open |
| `scan` `{eventId, code, atDesk?}` | yes | Returns `{result: {color, message, person}}`. Colors: `green`, `orange` (already in / not paid / entry closed / **flagged: go to the help desk**), `red` (not found / wrong event / refunded / member card). Flagged tickets only check in with `atDesk: true` (help desk buttons) |
| `walkIn` `{eventId, walkIn: {name, ucid?, memberId?, ticketTypeId, method: cash/etransfer}}` | yes | Creates a paid order + ticket, already checked in. Ignores capacity |
| `doorList` `{eventId, q?}` | yes | Counts for the whole event + the small lists (not paid, flagged, last 10 check-ins); `q` returns up to 20 name/code matches in `matches`. The full guest list is not sent |
| `uploadImage` `{dataUrl, filename}` | yes | JPG/PNG/WebP ≤ 5 MB → Drive, shared by link → `{fileId, url}` |

## 6. Settings (Apps Script → ⚙ Project Settings → Script Properties)

| Property | Meaning |
|---|---|
| `MEMBERSHIP_SHEET_ID` | Membership sheet (link or ID). Required |
| `EXEC_PASSWORD` | Exec sign-in. Required. Change any time; takes effect immediately |
| `ADMIN_PASSWORD` | Admin sign-in (admin-only tools, coming later). Optional |
| `MEMBERSHIP_TAB` | Default `Form Responses 1` |
| `ETRANSFER_EMAIL` | Default `css.uofcalgary@gmail.com` |
| `CONTACT_EMAIL`, `INSTAGRAM_URL` | Shown at the bottom of the public pages (the API sends them; `public/config.js` is only the fallback) |
| `LINK_KEY` | Set **by the system** the first time a private link is made. Signs the links in "Find my pass / tickets" emails. **Delete it to cancel every link ever sent** (a new one is made automatically; members just ask for a new link) |
| `SCANNER_PASSWORD` | Optional door password. Set/removed in Settings → Passwords. Blank = door volunteers sign in with just a name (only while entry is open) |
| `EMAIL_SIGNER_ROLE`, `EMAIL_BUTTON_COLOR` | Optional. Role line under the name and the button colour (like `#824a24`) in every email. Set from Settings → Email wording; blank = standard |
| `PRESIDENT_NAME` | Optional. Name in the signature of every email. Default "Gordon Chen". Change it when the President changes |
| `ARCHIVE_SHEETS`, `ARCHIVE_FOLDER_ID` | Set **by the system** the first time an event is archived: the archive spreadsheet of each school year (JSON, `{"2026-27": "sheetId"}`) and the Drive folder holding them. Don't edit; losing `ARCHIVE_SHEETS` just means the system can't find old rows until it's put back (the files are still in the folder `CSS Platform Archive`) |
| `BACKUP_FOLDER_ID`, `LAST_BACKUP`, `LAST_GOOD_BACKUP`, `ALERT_SENT_DAY` | Set **by the system** by the nightly job (backup folder, when the last backup ran, the once-a-day alert limit) |
| `SESSION_EPOCH`, `LAST_ERROR` | Set **by the system**. Changing `SESSION_EPOCH` signs everyone out. `LAST_ERROR` = the last unexpected error, shown in the health check |

Everything above except the automatic ones can be changed in the portal's **Settings** tab (admin). Script Properties is only needed if the admin password is lost.
| `PUBLIC_SITE_URL` | Set **by the system** from the Exec Portal (its `PUBLIC_SITE_URL` config) whenever Finance marks paid. Used for ticket links in emails. After moving the public site to a new address, use "Resend tickets" to send fresh links |
| `DATA_SHEET_ID`, `IMAGE_FOLDER_ID` | Set **by the system**. Only change if you deliberately point it at a restored copy (see RUNBOOK) |

## 7. Changing the code

**Option A: by hand, no tools needed**
1. Open the Apps Script editor (link in section 2), signed in as the CSS account.
2. Edit the file, or paste the new contents of `api/<File>.js` into the file of the same name. Ctrl+S.
3. **Deploy → Manage deployments → ✏ (edit) → Version: New version → Deploy.** The URL stays the same.
   (Using "New deployment" instead creates a **new URL**, and then every `config.js` has to be updated.)
4. If `appsscript.json` permissions changed: select `checkSetup` → Run → Allow.

**Option B: with clasp** (needs Node.js; run inside `api/`)
```
npm install -g @google/clasp      # once
clasp login                        # sign in as css.uofcalgary@gmail.com
clasp push --force                 # upload the files
clasp update-deployment AKfycbxJ_a_cHyRXadK17ocIebhE2XDFcpEADCzSqOVXwdCgIQe1T-UPi-efzgla2mn7ML2d --description "what changed"
```
`api/.clasp.json` already points at the project.

**Web pages:** edit the files, then publish (PowerShell, inside the V2 folder):
```
git add -A
git commit -m "what changed"
git push
```
GitHub Pages updates the live site in about a minute. **When you change a `.js`/`.css` file, bump the `?v=` number** on its `<script>`/`<link>` line in the page's `.html` (e.g. `?v=0.2.1` → `?v=0.2.2`). Otherwise phones may keep the old copy for a while. No git? Edit the file directly on github.com (✏ icon) and commit. Text changes only need `strings.js`.
**Moving to Vercel later:** import the GitHub repo in Vercel (no build step, output = root), add `events.` / `exec.` domains, then use "Resend tickets" if old links must change.

**Local testing:** serve the folder (e.g. `python -m http.server 8765` inside `CSS Ticketing System V2/`) and open `http://localhost:8765/exec-portal/` or `/public/`. Empty `API_URL` in `exec-portal/config.js` = demo mode with made-up members (password `demo` / `demo-admin`).

## 8. Design rules (keep these)
- **Never find rows by row number.** Always by `id`. (Row numbers were how the old pay page marked the wrong person paid after a sort.)
- **Anything that changes over time is data or a setting, never code** (prices, questions, passwords, emails).
- **All page text lives in `strings.js`**, so translating = adding a block.
- **Writes happen inside `withLock_`**, so two execs or two scanners can't clash.
- **Every change goes in the Log tab** with who did it.
- **Ticket QR codes hold the ticket page's address** (`ticket.html?t=<secret>`). The secret is long and random, so tickets can't be guessed. The scanner reads the `t=` part, so tickets keep working even if the site moves.
- **Test with @example.com emails:** the system never sends to them, so tests don't use the daily email limit or spam anyone.
- **Membership checks flag, never block:** a wrong *or unpaid* member ID still gets a ticket, flagged for the help desk (the scanner sends flagged people there).
- **Public pages match the member portal's look.** Change colours only via the variables at the top of `public/public.css`. Codes people must type (order codes) use the plain font, not the pixel font.
- **Keep it free:** Google Apps Script + Sheets + Drive + Gmail (about 100 emails/day on a regular Gmail account).

### Speed: table cache and paging (API 0.4.0)
- `api/Db.js` keeps Events, Tickets and Orders in Apps Script's shared cache under a **version number**. Every write bumps the version *after* the write, so the next read is always fresh; a cold or failed cache just reads the sheet. The Log is never cached. Edits made by hand in the data sheet can take up to 30 min to show (use the portal).
- A scan never trusts the cache for the decision: it re-reads that one ticket row from the sheet (`readRowFresh_`) under the lock.
- Signing in warms the cache (`warmCaches_`), so the first tab click afterwards is quick.
- Payments, Attendees and Door load one small page / summary first and fetch more on demand (see the API table).

# Offline tests

These run the API code (`api/*.js`) in Node with a fake Google (in-memory tables, no email sent), so nothing real is touched.

| File | What it covers |
|---|---|
| `core.test.js` | cancel requests, feedback, the event report, member history, the sign-up safety fixes (SEC-01, SEC-02), the per-person login lockout |
| `waitlist.test.js` | joining, offering a spot, removing |
| `partners.test.js` | partner deals and the redemption log |
| `emailclaim.test.js` | two execs pressing Send at once can't double-email |
| `emailhistory.test.js` | subject/recipient/time and sent/failed history, rolling 24-hour boundaries, no bodies or private links, unchanged send results when logging fails, attachments, and exec/admin/door permissions |
| `deskalert.test.js` | scanner results, the "send to desk" alerts, the scan log, member pass links |
| `payfix.test.js` | repairing a half-finished Mark paid, restoring a cancelled or refunded order |
| `registration.test.js` | registering (event site and member portal): ticket pages in the reply, member verification, name and ID checks, retries, a failed ticket write, resuming, the event read again inside the lock, locks, capacity |
| `hardening.test.js` | event input checks (real dates, capacity, prices, times), questions worded alike, paid-ticket count |
| `doorundo.test.js` | a door volunteer can undo only their own check-in from the last 10 minutes, Health warns about a blank door password |
| `emailsettings.test.js` | per-event email settings and their defaults, what counts as "waiting", the email indicator, reminders on/off, the "N confirmed, X emailed, Y waiting" numbers |
| `money.test.js` | invalidating one person or a whole order, refunds owed and returned, putting tickets back, and every awkward e-transfer (short, too much, several orders, cancelled order, full event, finding the order) |
| `archivehold.test.js` | the nightly archive leaves events with unpaid orders or refunds owed live; the health check names them |
| `mytickets.test.js` | My tickets: tickets belong to the attendee, ambiguous ones are not added, cancelled ones are shown as cancelled |
| `feedback.test.js` | a step-by-step walkthrough of star ratings: who can rate, changing a rating, bad input, member linking, what execs see in the results, report and member history |
| `duplicates.test.js` | repeat signups, shared email addresses, groups, retries, Finance additions, walk-ins and waitlist duplicate checks |
| `membershipmatch.test.js` | paid-status parsing, fresh membership reads and invalidating both cached copies after edits |
| `membershipedit.test.js` | manually rechecking stale membership warnings, preserving other flags, permissions and failed reads |
| `ticketpricing.test.js` | correcting free/member tickets before or after approval, preserving actual payments, collecting differences, disabled tickets and interrupted edits |
| `signup-validation.test.js` | server UCID/member-code requirements, email typo detection and refusing invalid registrations before writes |
| `signup-ui.test.js` | browser validation, the member-code exception, actionable email errors and retaining request IDs across retries |
| `ticket-actions-ui.test.js` | separate disable/enable and cancellation actions, retained registration visibility, and direct $0 confirmation for free orders |
| `ticketavailability.test.js` | disabled tickets free capacity and waitlist offers, keep payments, reject scans, and safely re-enable or cancel with retry protection |
| `ticket-status-ui.test.js` | disabled ticket pages and member lists show no QR, old QR copies are cleared, and the door shows Disabled |
| `eventnotes.test.js` | organizer notes, private attendee comments, draft/public behavior and preserving comments when waitlist places are offered |
| `announcements-ui.test.js` | Important Note placement, safe text rendering, optional per-person comments and preserving entered comments |
| `membershipform.test.js` | configurable membership questions, admin access, required/choice validation, original-answer snapshots and older sheets |
| `membershipform-ui.test.js` | Members question editor, stable question IDs, error handling and safe display of signup answers |
| `retry.test.js` | pressing a button twice or a retry: Add registration, Mark paid, waitlist offers, e-transfers, refunds owed and money returned give one record and the same answer (answer lost, busy email step, stopped halfway) |
| `membership.test.js` | the membership year (September to August), the membership fee in Settings and where it shows |
| `memberchanges.test.js` | shared member notes, author/time, sign-in and door permissions, successful/failed card sends, a row moving during a send, cached card status, and the different contents of Awaiting payment and Not paid |
| `questions.test.js` | questions limited to certain ticket types: who sees them, required only when they apply, answers dropped otherwise, walk-in ticket choice and answers, free walk-ins |
| `publicform.test.js` | the event site sign-up form offline: which questions show, what blocks Register, the "Choose tickets" total, the kept form, the ticket page's Find my tickets button |
| `attention.test.js` | the Needs attention list, membership/payment issues and manual actions without automatic changes |
| `eventedit.test.js` | event drafts and previews, editable fields and ticket order |
| `square.test.js` | card payments through Square (fake Square, no network): the payment page amount and capacity check, confirming and repeating, already paid by e-transfer, event full while paying, backing out, the ticket page and door scan finishing a payment after a closed tab, the webhook relay's signature check, odd card payments for Finance, Square not set up |
| `members.test.js` | member lists, filters, counts, member ID creation and signup QR links |

```
node tests/core.test.js
node tests/waitlist.test.js
node tests/partners.test.js
node tests/emailclaim.test.js
node tests/deskalert.test.js
node tests/payfix.test.js
node tests/registration.test.js
node tests/doorundo.test.js
node tests/hardening.test.js
node tests/emailsettings.test.js
node tests/money.test.js
node tests/archivehold.test.js
node tests/mytickets.test.js
node tests/feedback.test.js
node tests/duplicates.test.js
node tests/membershipmatch.test.js
node tests/membershipedit.test.js
node tests/ticketpricing.test.js
node tests/signup-validation.test.js
node tests/signup-ui.test.js
node tests/ticket-actions-ui.test.js
node tests/membership.test.js
node tests/retry.test.js
node tests/questions.test.js
node tests/publicform.test.js
node tests/attention.test.js
node tests/eventedit.test.js
node tests/members.test.js
node tests/memberchanges.test.js
node tests/emailhistory.test.js
node tests/ticketavailability.test.js
node tests/ticket-status-ui.test.js
node tests/eventnotes.test.js
node tests/announcements-ui.test.js
node tests/membershipform.test.js
node tests/membershipform-ui.test.js
node tests/square.test.js
```

`people.test.js` covers pasted rosters, admin permissions, the registration lock, personal-password setup and sign-in, authenticated Settings unlock, hashed storage, password resets, revoked sessions and deactivation. `execaccounts-ui.test.js` covers the first-time password screen, removal of device-saved name suggestions and phone Tasks/scanner landing pages. `signin-search-ui.test.js` covers the two-letter People search, keyboard and click selection, loading and retry, and keeping dismissed results closed.
`tasks-ui.test.js` covers adding/removing multiple assignees, saving typed names, editing shared tasks, My tasks for each assignee and escaping names. `tasks.test.js` also checks shared-task Discord posts, bot creation, manual/scheduled reminders and older single-owner tasks.

`audit-finance.test.js` checks returned and reserved refunds, safe restores, late-payment retries, actual receipts, verified membership identity and email quota. `ops-audit.test.js` checks overnight events, archives and backups, spreadsheet booleans, scan-log privacy, failed walk-ins and sign-in revocation. `audit-frontend.test.js` checks older Safari request timeouts, trusted event previews, email-counter refresh, camera shutdown, event navigation and Practice failure screens. `practice.test.js` checks batched fake-data creation, disabled emails, interrupted writes, archived practice events, permissions and removal without affecting real events.

Each prints PASS/FAIL lines and exits with an error if anything fails. Run every suite before a deploy:

```bash
for f in tests/*.test.js; do node "$f"; done
```
The fake Google replaces the spreadsheet, cache expiry and locks, so a pass here does not prove real Google concurrency or production settings: check Settings → System health after a deploy.

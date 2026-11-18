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
| `retry.test.js` | pressing a button twice or a retry: Add registration, Mark paid, waitlist offers, e-transfers, refunds owed and money returned give one record and the same answer (answer lost, busy email step, stopped halfway) |
| `membership.test.js` | the membership year (September to August), the membership fee in Settings and where it shows |
| `memberchanges.test.js` | shared member notes, author/time, sign-in and door permissions, successful/failed card sends, a row moving during a send, cached card status, and the different contents of Awaiting payment and Not paid |
| `questions.test.js` | questions limited to certain ticket types: who sees them, required only when they apply, answers dropped otherwise, walk-in ticket choice and answers, free walk-ins |
| `publicform.test.js` | the event site sign-up form offline: which questions show, what blocks Register, the "Choose tickets" total, the kept form, the ticket page's Find my tickets button |
| `feedback.test.js` | a step-by-step walkthrough of star ratings: who can rate, changing a rating, bad input, member linking, what execs see in the results, report and member history |

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
node tests/membership.test.js
node tests/retry.test.js
node tests/questions.test.js
node tests/publicform.test.js
```

Each prints PASS/FAIL lines and exits with an error if anything fails. Run every suite before a deploy:

```bash
for f in tests/*.test.js; do node "$f"; done
```
The fake Google replaces the spreadsheet, cache expiry and locks, so a pass here does not prove real Google concurrency or production settings: check Settings → System health after a deploy.

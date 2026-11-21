# Offline tests

These run the API code (`api/*.js`) in Node with a fake Google (in-memory tables, no email sent), so nothing real is touched.

| File | What it covers |
|---|---|
| `core.test.js` | cancel requests, feedback, the event report, member history, the sign-up safety fixes (SEC-01, SEC-02), the per-person login lockout |
| `waitlist.test.js` | joining, offering a spot, removing |
| `partners.test.js` | partner deals and the redemption log |
| `emailclaim.test.js` | two execs pressing Send at once can't double-email |
| `deskalert.test.js` | scanner results, the "send to desk" alerts, the scan log, member pass links |
| `payfix.test.js` | repairing a half-finished Mark paid, restoring a cancelled or refunded order |
| `registration.test.js` | registering (event site and member portal): ticket pages in the reply, member verification, name and ID checks, retries, a failed ticket write, resuming, the event read again inside the lock, locks, capacity |
| `hardening.test.js` | event input checks (real dates, capacity, prices, times), questions worded alike, paid-ticket count |
| `doorundo.test.js` | a door volunteer can undo only their own check-in from the last 10 minutes, Health warns about a blank door password |
| `emailsettings.test.js` | per-event email settings and their defaults, what counts as "waiting", the email indicator, reminders on/off, the "N confirmed, X emailed, Y waiting" numbers |
| `money.test.js` | invalidating one person or a whole order, refunds owed and returned, putting tickets back, and every awkward e-transfer (short, too much, several orders, cancelled order, full event, finding the order) |
| `mytickets.test.js` | My tickets: tickets belong to the attendee, ambiguous ones are not added, cancelled ones are shown as cancelled |
| `feedback.test.js` | a step-by-step walkthrough of star ratings: who can rate, changing a rating, bad input, member linking, what execs see in the results, report and member history |
| `duplicates.test.js` | repeat signups, shared email addresses, groups, retries, Finance additions, walk-ins and waitlist duplicate checks |
| `membershipmatch.test.js` | paid-status parsing, fresh membership reads and invalidating both cached copies after edits |
| `membershipedit.test.js` | manually rechecking stale membership warnings, preserving other flags, permissions and failed reads |
| `signup-validation.test.js` | server UCID/member-code requirements, email typo detection and refusing invalid registrations before writes |
| `signup-ui.test.js` | browser validation, the member-code exception, actionable email errors and retaining request IDs across retries |
| `ticket-actions-ui.test.js` | individual disabling from both lists, confirmation, sibling tickets, refund choices, original QR rejection and restoration |

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
node tests/mytickets.test.js
node tests/feedback.test.js
node tests/duplicates.test.js
node tests/membershipmatch.test.js
node tests/membershipedit.test.js
node tests/signup-validation.test.js
node tests/signup-ui.test.js
node tests/ticket-actions-ui.test.js
```

Each prints PASS/FAIL lines and exits with an error if anything fails. Run all nineteen before a deploy.
The fake Google replaces the spreadsheet, cache expiry and locks, so a pass here does not prove real Google concurrency or production settings: check Settings → System health after a deploy.

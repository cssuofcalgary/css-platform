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
```

Each prints PASS/FAIL lines and exits with an error if anything fails. Run all nine before a deploy.
The fake Google replaces the spreadsheet, cache expiry and locks, so a pass here does not prove real Google concurrency or production settings: check Settings → System health after a deploy.

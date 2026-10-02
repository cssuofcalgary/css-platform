# Offline tests

These run the API code (`api/*.js`) in Node with a fake Google (in-memory tables, no email sent).
They cover the waitlist, cancel requests, feedback, the event report, member history, the sign-up
safety fixes (SEC-01, SEC-02) and the per-person login lockout.

```
node tests/waitlist.test.js
node tests/core.test.js
```

Each prints PASS/FAIL lines and exits with an error if anything fails. Run both before a deploy.

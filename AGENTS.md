# Agent guide: CSS Platform V2

Read this first. It is the short version of how this repo works and the rules for changing it. The long versions are `README.md` (architecture, every API action), `HANDBOOK.md` (what execs do), `RUNBOOK.md` ("something broke") and `tests/README.md`.

Repo: `cssuofcalgary/css-platform` (branch `main`). It runs the Chinese Students' Society (University of Calgary) events, tickets, payments, door check-in and membership. Typical events have under 100 people; a few (Lunar New Year) are larger.

## WHO THE PROGRAMMER IS *IMPORTANT*
- Vibecoder with 0 technical experience. Please explain in PLAIN ENGLISH a way so that someone with ZERO technical knowledge would need to know.
- This SYSYEM is for INTERNAL use only within a university club. Do NOT over complicate things with terms and features that would be needed for typical production use.

## The people this is for
Future executives with **no technical background** run events through the dashboard. So:
- Plain wording, sensible defaults, and a clear way back from mistakes. Say what happens, what to do next, and what the person sees.
- **No unsolicited UI subtext:** Never add explanatory paragraphs, subtitles, or helper text beneath section headings, labels, checkboxes, or other controls unless Gordon explicitly requests it; this applies across the entire system and to every subagent.
- Don't add settings unless they solve a real problem. Routine operations must never need a code change.
- **Manual over automation:** actions happen when someone presses a button, not on timers. Don't add automatic jobs or emails.
- Registrations and payments must never be lost because an email failed.

## Layout
| Folder | What it is | Runs on |
|---|---|---|
| `api/` | The back end: one Google Apps Script project (`doPost` in `Api.js`) with the data in a Google Sheet that the code owns | Apps Script, deployed with `clasp` |
| `public/` | Event site: events list, sign-up, ticket page (offline copy via `sw.js`), guest "My tickets" | Vercel, `events.ucalgarycss.ca` |
| `exec-portal/` | Dashboard for execs: Overview, Members, Events, Payments, Door, Settings | Vercel, `exec.ucalgarycss.ca` |
| `scanner/` | Volunteer scanner page | Vercel |
| `tests/` | Offline tests (Node, fake Google) | your machine |
| `stress-test/` | Load experiments | your machine |

The **member portal** is a separate repo: `cssuofcalgary/member-portal`, in `..\CSS Ticketing System\CSS Member Portal` (`member.ucalgarycss.ca`). Its folder tree has its own `AGENTS.md` one level up. It calls this API (`myTickets`, `memberProfile`, `register`, `memberPartners`).

## Rules that always apply
1. **Never push or deploy without Gordon's explicit OK.** That means `git push`, `clasp push` and `clasp deploy`. Summarize the changes first (files, purpose, impact), then wait. "push it" approves that one push. The member-portal repo needs a file-by-file summary and an explicit OK.
2. **No attribution lines.** No `Co-Authored-By:` trailer on commits and no "Generated with" line on PRs, whatever a tool's default says.
3. **Prepare and test locally first.** Run all test suites before any publish.
4. **Never send email while developing.** Tests use a fake mailer. Addresses at `@example.com/.org/.net` are treated as test addresses and never emailed.
5. **Don't touch real attendees, real events or existing test records** unless asked. Test events are labelled TEST.
6. Don't use or print passwords, keys or tokens. Script Properties hold the secrets; the code never includes them.
7. Always say which folder and repo a file belongs to; there are several `index.html` files.

## Tests
```
node tests/<name>.test.js     # one suite
```
Thirteen suites: `core`, `waitlist`, `partners`, `emailclaim`, `deskalert`, `payfix`, `registration`, `doorundo`, `hardening`, `emailsettings`, `money`, `mytickets`, `feedback`. Each prints PASS/FAIL and exits non-zero on failure. `tests/harness.js` loads every `api/*.js` file into one Node `vm` with fake Google services and in-memory tables (`TBL.Events`, `TBL.Orders`, `TBL.Tickets`, `TBL.Refunds` …). Tests often need small stubs (`table_`, `withLock_`, `throttle_`, `sendTicketEmail_`). Add a suite or extend one for any change to payments, emails, tickets or permissions, and test what the attendee sees, what the exec sees, how it is fixed, and what happens on failure.
A pass does not prove real Google behaviour (concurrency, quotas, cache expiry). After a deploy check Settings → System health.

## Deploying (only after approval)
```
cd api
clasp push -f
clasp deploy -i AKfycbxJ_a_cHyRXadK17ocIebhE2XDFcpEADCzSqOVXwdCgIQe1T-UPi-efzgla2mn7ML2d -d "<label>"   # keeps the same web app URL
cd ..
git add <files> && git commit -m "…" && git push origin main
```
- Google serves the old version for 10 to 60 seconds after `clasp deploy`. Vercel takes 1 to 2 minutes; people then need a hard refresh.
- Bump the `?v=` numbers on changed scripts and stylesheets in the `index.html` files, or browsers keep the old file.
- Bump `API_VERSION` in `api/Config.js` whenever a table gains a column (column headers are cached per version). New columns and tables are created the first time they are read, so open the Payments tab once after such a deploy.
- Leave out untracked scratch files (`ROADMAP_UPDATE_FOR_CLAUDE.md`, `design/`) unless asked.

## How the back end works
- **Routing:** `Api.js` has one `switch` on `req.action`. Exec actions call `requireSession_(req.token)`; admin-only actions call `requireAdmin_`. Door volunteers only get `DOOR_ACTIONS` (`Door.js`). Sessions live in the cache (`session_<token>`, with a `sid`); roles are `admin`, `exec`, `door`.
- **Data:** tables are declared in `TABLES` (`Db.js`): Events, Orders, Tickets, Waitlist, Refunds, Partners, Redemptions, Emails, Feedback, Log and more. Rows are found by `id`, never by row number. Lists/objects are JSON columns (`JSON_COLUMNS`). Always use `readRows_`, `insertRow_`, `updateRow_`.
- **Locks:** `withLock_` (script lock) for changes to payments and tickets. `withIntakeLock_` for sign-ups. Anything that creates **paid** tickets (free sign-up, Finance add, waitlist offer) uses `withIntakeAndScriptLock_`, always in that order. Never nest `withLock_` inside itself; use the `...Locked_` helpers (`markPaidLocked_`, `restoreLocked_`). Send emails after the lock is released. Re-read data inside the lock before deciding.
- **Money** (`Payments.js`, `Refunds.js`, `Transfers.js`): the platform never moves money, it only records it. `Orders.total` is what the still-valid tickets cost; `Orders.received` is what actually arrived (blank on older paid orders means "exactly the total"). Cancelling an unpaid order, invalidating paid tickets, and recording a refund are three separate steps; money owed back is a row in `Refunds`. Odd payments (short, over, wrong name, cancelled order, full event) always need an explicit choice from Finance; the API refuses to guess. Check cents with `cents_`, not floats. `moneyText_(0)` says "Free": use `usd_` in money messages.
- **Email** (`Mail.js`, `EmailTemplates.js`): events choose what they send (`eventMails_`: registration confirmation off, ticket on payment on, reminders off by default; a blank cell means the default). "Off" is a choice, not a queue: suppressed tickets get `TICKET_EMAIL_OFF_NOTE` in `emailedAt` so they are not counted as waiting. A ticket's `emailedAt` is blank (waiting), `claim:<time>` (being sent), a time (sent) or a note. Gmail allows about 100 sends a day over a rolling day; never promise a reset time. Failed sends keep the payment and leave the ticket waiting.
- **Link keys:** `linkKey_`/`linkKeyOk_` (HMAC, kinds `pass`, `tix`, `tixu`) protect private ticket and pass links. A busy server must never be treated as a bad key.
- **Tickets belong to the attendee**, not the payer. A ticket is added to a member's My tickets only when the email matches, or the ID/UCID matches and the name fits (`namesRelated_`).
- **Cache-only features** (`deskalerts_`, `scanlog_`, `ci_<ticketId>`) are best-effort conveniences, never the source of truth.

## Front-end conventions
- Strings live in `strings.js` (`T.xxx`), not inline. Exec portal pages are plain scripts sharing globals; scripts load in the order listed in `index.html`.
- `api(action, details)` shows the panda while waiting; reads are retried, anything that changes data is never retried on a guess. Don't use the browser's `confirm()`/`prompt()` for new flows: use `askConfirm` or a `<dialog>`.
- Dark mode and phone widths both matter. Check them.
- Door and scanner screens: volunteers see short messages ("Go to the help desk."); the help desk sees the reason.

## Windows and tooling traps
- Run shell commands in Git Bash or PowerShell; there is no Python.
- Many files use CRLF. Patch scripts must normalise line endings, and nested template literals/backslashes in one-off Node patch scripts break easily: write the script to a file, or use the Edit tool.
- Big heredocs in one tool call sometimes fail; write the file with the file tool instead.
- `appendRow` coerces booleans: the code stores `"TRUE"`/`"FALSE"` strings through `toCell_`.

## Product decisions already made (don't reopen unless asked)
- No individual exec accounts or roles; shared passwords (department permissions are an open question for Gordon).
- Authentication trade-offs stay as they are.
- New email defaults apply to all upcoming events. Refunds work per person. Old refunded orders show "return not recorded" in grey. The full payment-exception workflow exists.
- Offline ticket copy, help-desk alerts, scan log, undo for volunteers (own check-in, 10 minutes) are in.

## Still open
Department permissions (needs Gordon's decision), a reusable question builder and standalone surveys, load measurement for bigger events, a plain-language handover guide, real-device checks of the newest flows.

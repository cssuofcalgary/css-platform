# CSS Exec Portal: Handbook

For execs. No tech knowledge needed.

## Signing in
1. Open the **Exec Portal**: https://exec.ucalgarycss.ca/ (bookmark it). It opens on the **Overview**: what needs attention, upcoming events and recent activity. The menu is on the left.
2. Type the **exec password** (ask the President) and **your name**. Your name goes next to every change you make.
3. You stay signed in for about 6 hours. **Sign out** on shared computers.

Wrong password 30 times → sign-in pauses for 10 minutes.

## Members tab: find a member
- Type part of a **name**, a **UCID**, a **member ID** (CSS…), or an **email**.
- Tap a person to see their details: paid or not, membership card sent or not, when they signed up.
- This tab is **view only** for now.

## Events tab: make an event
1. **+ New event.**
2. Fill in:
   - **Name, date, start/end time, location, description.** A blank line in the description starts a new paragraph.
   - **Event image:** tap and pick a photo. It uploads by itself; wait for "Image uploaded."
   - **Capacity:** leave blank for no limit. "Paid tickets only" = only people who've paid take up a spot.
   - **Ticket types & prices:** starts with *Member* and *Non-member*. Set the prices. Tick **"Members only"** on a ticket to check the buyer's membership. Add more types with **+ Add ticket type** (e.g. Early bird). Price 0 = Free.
   - **Extra questions:** name, email and UCID are always asked. Add others like "Drink choice". "Choose one" = a list of options, separated by commas.
   - **Registration closes:** leave blank and it closes by itself when the event starts. Or pick an earlier date/time.
   - **Payment code letters:** the start of the code people put in their e-transfer message (e.g. MGN-4821). Leave it blank and it uses the event's initials.
3. **Save draft** keeps it private. **Save & publish** puts it online.

## After publishing
In the Events list, each event has:
- **Attendees:** the numbers for that event (registered, paid, checked in, money received, spots left), how many of each ticket type, and **how many picked each answer** (e.g. "Milk tea 32, Taro 18", handy for ordering). Below is everyone registered: search, filter (Paid, Awaiting, Checked in, Not arrived, Flagged…) and sort. **Edit** works here too.
- **Edit:** change anything. The public link never changes.
- **Duplicate:** starts a new event with the same prices, questions, capacity and picture. Pick the new date, check the details, save.
- **Close registration:** the page stays up but says registration is closed. **Reopen** undoes it.
- **Archive** *(admin password only)*: hides a finished or test event everywhere. Nothing is deleted. **Show archived events** → **Restore** brings it back.
- **Public page ↗:** the link to share (Instagram, group chats). All upcoming events: https://events.ucalgarycss.ca/

## What people see when they register
1. They open the event's **public page** and tap **Register**.
2. They fill in their name, email, UCID (optional), ticket type and your extra questions. They can **add friends** and pay for everyone at once.
3. Picking a **Member** ticket asks for their member ID or UCID. We check it automatically. If it isn't found, they can still register, but they're **flagged** so the help desk checks at the door.
4. They see (and get emailed) **exactly how much to send**, **where** (css.uofcalgary@gmail.com), and a **payment code** like MGN-4821 to put in the e-transfer message.
5. Their spot is confirmed once Finance marks the payment received (Payments tab, below). Then **each person gets their own ticket by email**: a QR code plus a link to their ticket page.

The Events list shows how many people have **paid** and how many are **awaiting payment** for each event.

## Payments tab (Finance)
1. Check the CSS Gmail for the Interac e-transfer.
2. In **Payments**, pick the event and search the **payment code** from the e-transfer message (e.g. MGN-4821). No code? Search the sender's **name**; the "E-transfer name" people typed helps here.
3. Check the amount is **exactly** the total shown. Then **Mark paid**. Everyone in that order gets their ticket email automatically.
   - Amount wrong? Don't mark it paid. Reply to them.
   - "Over capacity" warning? The event is full of paid tickets. Only continue if you really want to go over.
4. Filters: **Awaiting** (still to pay), **Waiting too long** (unpaid for over 2 days), **Paid**, **Refunded / cancelled**, **All**. The line at the top shows **money received of money expected**, handy for matching the bank.
   - **Send reminders** (yellow bar): emails everyone who's waited over 2 days. It tells you how many first and asks before sending. Nobody is reminded more than once every 2 days.
   - **Mark several paid:** tick the boxes next to orders (or **Select all shown**), check the amounts in the pop-up, and confirm once. Orders that would go over capacity are skipped and listed.
   - **+ Add paid registration:** someone paid (e-transfer or cash) without registering online. Enter their name, email, ticket type; they're added as paid and emailed their ticket. For a group, add each person separately.
5. ⚠ yellow notes = something to check at the door (membership not found, duplicate email).

**Refund / cancel:** opens the spot again. For a paid order, send the money back by e-transfer yourself; the system only records it. Nothing is ever deleted.
**Resend tickets:** someone lost their email, or it went to spam.
**Ticket ↗:** opens that person's ticket (handy at the help desk).
**Edit** (next to a person, here and in Attendees): opens a form.
- **Any exec:** name and email. A new email gets their ticket sent again automatically.
- **Admin password only:** UCID, member ID (the membership is checked again), **ticket type** (the price and the order total change; the message tells you whether to collect or refund the difference), answers to the event's questions, the help-desk warning (clear it if it was sorted out), and the order's payer name/email, e-transfer name and notes. Everything is saved in the change log with the old and new values.
If you see "ticket emails waiting (daily email limit)", press **Send now** later, or the next day. Gmail allows about 100 emails a day.

## The portal on a laptop vs a phone
- **Laptop or tablet (help desk, Finance):** the full portal with a menu on the left. Pick the event once at the top and Payments and Door both follow it.
- **Phone (door volunteers):** opens the **door scanner** by itself: just the camera, how many are inside, a name search and Undo. It has no payments, walk-ins or other tabs. Anyone unpaid or flagged shows **Send to help desk**. The help desk person on a laptop deals with everything else. Address for volunteers: `…/css-platform/scanner/` (later `exec.ucalgary.ca/scanner`). A help-desk person on a phone can tap **Full portal** at the top.

## What the emails look like
All system emails (registration, payment reminder, ticket, find-my-tickets, find-my-pass) share one look: the same paper-ticket design as the member pass email, with a sage header, the CSS banner, pandas and a signature. It lives in `emailShell_()` in `api/Mail.js`. The signature name is the Script Property `PRESIDENT_NAME` (default "Gordon Chen"); change it when the President changes.

### What members see under My tickets
Pressing **My tickets** on the member portal swaps the screen: the pass and its QR code go away and a list of the person's tickets takes over (one card per ticket: event, date, place, name, QR code, and Paid / Payment pending / Checked in). **Back to my pass** swaps it back. Someone with several tickets (for friends, or for different events) sees them all. Tickets leave the list by themselves once the event date has passed, and refunded or cancelled tickets never show. To take a ticket off someone's list early: Payments tab → refund or cancel the order. Archiving an event also hides its tickets.

### UCID and last name go straight in
On the member portal and on the events site's "Find my tickets", "I forgot which email I used" takes a UCID and last name and opens the member pass (with the tickets under it) right away, with no email. Someone who only has tickets (not a member) gets a tickets-only page. Entering just an email still emails a private link instead, because an email address alone proves nothing. This is less strict than the email route: anyone who knows a classmate's UCID and last name could open their page. The limits (4 tries per UCID, 120 in total per 10 minutes) stop guessing. If that ever worries the team, say so and it can go back to email-only.

### Emailing everyone registered
Payments tab → **Email everyone**. Choose who (everyone, only people who paid, or only people who haven't), write a subject and message, press **Preview** to see it, then **Send**. Each person gets their own copy; someone with two tickets gets one email. It asks you to confirm the number of people, and can't be undone. Good for a venue change, a reminder the day before, or a thank-you. Your daily email allowance is about 100 and some is kept back for tickets, so a big event may need to be split across two days.

### Deleting an event for good
Events list → **Delete** (admin only, on every event). You type the event's exact name, and if real payments were collected it asks a second time. It removes the event and all its tickets and orders and **can't be undone** (older backups in Drive "CSS Platform Backups" still have a copy). Use it for tests and mistakes. For a real event you want to keep the record of, use **Archive** instead.

### Old events are archived by themselves
Thirty days after an event, the system moves its tickets and orders out of the everyday sheet into a yearly archive spreadsheet (Drive → **CSS Platform Archive** → "CSS Platform Archive 2026-27", one per school year, September to August). This keeps the system fast. You don't need to do anything. On the Events list the event shows **Archived**; its numbers stay on the list, and **Attendees** still opens its full list (read only) and **Download list (CSV)** still works. Admins can archive early with **Archive**, or bring an event back with **Restore** (everything moves back and it shows as Closed). Old tickets stop working at the door and on the ticket page once archived, which is fine because the event is over. Settings → Health check has an **Archive** line: how many tickets are in the everyday sheet and how many events are archived. It says Problem if an old event wasn't moved (check the timers in Apps Script).

### Door volunteers
On the scanner page (`exec.ucalgarycss.ca/scanner/`, or any phone) there is a second button, **Door sign-in (name only)**. A volunteer types their name and presses it. It only works while an exec has **entry open** for an event, and it can only scan tickets, undo a check-in and see who's inside (no payments, no member search, no help-desk override). When entry closes, their session stops working. To add a password for door volunteers: Settings → Passwords → Door password (optional). Execs still sign in with the exec password as before.

### Changing the words in emails
Settings (admin) → **Email wording**. Pick an email, change the subject, heading, or the text at the top and bottom, then press **Preview** to see it, **Send test email** to get it in your own inbox, and **Save**. Leave a box empty to use the standard wording; type just a dash (-) to show nothing there. You can put `{name}` `{event}` `{code}` `{amount}` `{when}` `{where}` in the text (the box tells you which ones work) and they fill in for each person. The same change applies to every event. The same card sets the name and role in the signature and the button colour. The look of the email (banner, pandas, layout) isn't editable.

## Members finding their own tickets
People who lost their ticket email don't need the help desk: the footer of every events page has **My tickets** (`events.ucalgarycss.ca/tickets.html`). They enter their email, or their UCID and last name, and the ticket links are emailed to the address on the ticket. Nothing is shown on screen. The Activity tab records each use (admin only). Walk-ins without an email can't use it; look them up in Payments or Door.
The **member portal** works the same way now: members enter their email (or tap "I forgot which email I used" and enter UCID + last name) and get their pass link by email. Their pass page links back to Upcoming events and My tickets.

## Door tab (event night)
1. Pick the event (tonight's is picked automatically). The big number at the top is **how many are inside / how many have paid**.
2. Tap **Entry CLOSED** to **open entry** when doors open. Scanners only let people in while it's open.
3. **📷 Start scanning** and allow the camera. Point it at the QR on the person's phone (a screenshot is fine).
   - 🟢 **Green:** let them in. Their answers (e.g. drink) show underneath.
   - 🟠 **Orange:** already checked in, **not paid yet**, entry closed, or **"Please go to the help desk"** (something to check, e.g. membership not found). Send them to the help desk.
   - 🔴 **Red:** not a valid ticket for this event. Send them to the help desk.
   After each result the scanner pauses for a moment. **Tap the result** to scan the next person straight away.
   Two people can scan at once on two phones. The same ticket can never get in twice.
   **On a phone, the portal opens straight to the Door tab.**
4. **QR won't scan?** Type their name or ticket ID (on their ticket, TKT…) in the box → **Find** → **Check in**.
5. **+ Walk-in:** name, UCID if they have one, ticket type, cash or e-transfer → **Add & check in**. Walk-ins are always allowed, even when sold out.
6. **Help desk lists** at the bottom:
   - **Not paid yet:** check their e-transfer, then **Mark paid** → **Check in**.
   - **Please check:** people flagged at registration (membership not found, duplicate email). The scanner won't let them in. Check it with them, then tap **Check in** here.
   - **Recent check-ins:** the last people let in. **Undo** if someone was scanned by mistake.

No signal? Things get slow, not broken. Before the event, keep the Payments tab open or print the list.

## Activity tab (admin password only)
A plain list of what happened, newest first: "Kevin marked TNM-4408 paid · 6:02 pm". Filter by **event**, by **person**, by kind (Payments, Door, Edits, Events, Settings), or search a code or name. Use it to settle "I paid!" or "who checked them in?".

## Settings tab (admin password only)
- **Payments and contact:** the e-transfer email, the contact email and the Instagram link shown on the public pages.
- **Membership sheet:** each year, paste the new sheet's link and press **Test and save**. It reads the sheet first and tells you how many members it found, so a wrong link can't break anything.
- **Passwords:** type the new one twice. Everyone else is signed out and needs the new password. Never write a password in a document or chat.
- **Sign everyone else out:** if a phone or laptop was left signed in.
- **Backups and alerts:** every night the system copies the data sheet into a Drive folder called "CSS Platform Backups" (in the CSS Gmail's Drive) and keeps the last 14. If a check fails, it emails the CSS Gmail (once a day at most). Health check shows the time of the last backup. To restore, open the newest backup, copy the tabs you need back into "CSS Platform Data". Entry also closes by itself 4 hours after an event ends.
- **Health check:** shows whether the data sheet and Membership sheet are reachable, how many emails are left today, and the last error the system saw. Run it if something feels off.

## Good to know
- Everything you do is saved in a change log with your name.
- You never need to open Google Sheets or Google Drive. If you think you have to, ask the President first.
- Something looks wrong? See **RUNBOOK.md**, or message the President.

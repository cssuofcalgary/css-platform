# CSS Exec Portal: Handbook

For execs. No tech knowledge needed.

## Signing in
1. Open the **Exec Portal**: https://exec.ucalgarycss.ca/ (bookmark it). It opens on the **Overview**: what needs attention, upcoming events and recent activity. The menu is on the left.
2. Type the **exec password** (ask the President) and **your name**. Your name goes next to every change you make.
3. You stay signed in for about 6 hours. **Sign out** on shared computers.

Wrong password 30 times → sign-in pauses for 10 minutes.
The **sun/moon button** (bottom of the menu) switches light and dark. Tap the **CSS logo** to refresh the page.

## Members tab: sign-ups, payments and search
Membership is **$12 for the school year**. People join on their own at **member.ucalgarycss.ca/create** (this replaces the Google Form), or an exec adds them here. Both end up as one row on the Membership sheet.

**Pending** (opens first when someone is waiting): everyone who signed up and hasn't been confirmed yet. A red number on **Members** in the left menu, and a line on the Overview, show how many.
- Each card shows how they said they'd pay. **Cash:** when, where, and who took it. **E-transfer:** when they signed up, their email and UCID.
- Check the payment (the CSS Gmail for an e-transfer, or the exec who took the cash), then tap **Mark paid ($12)**. They get their member pass by email and the card slides away. **Details** opens their full page.
- Only sign-ups from the website and **Add member** show here. Older members who are not marked paid are under **Search**.

**Add member** (top right): for someone joining at the table. Enter name, UCID (8 digits), email, and cash or e-transfer. Leave **Payment received ($12)** ticked if you have the money: they're marked paid and emailed their pass in one step. Untick it to add them as unpaid and confirm later from Pending. Someone already on the sheet is refused, and it tells you who they are.

**Search:** type part of a **name**, a **UCID**, a **member ID** (CSS…) or an **email**, then tap a person to see their details. Anyone not marked paid also has a **Mark paid ($12)** button on their page.

If the pass email can't be sent (the daily email limit), the person is still marked paid and the message tells you the email did not go. They can get their pass later from **member.ucalgarycss.ca → Find my pass**. See **RUNBOOK.md**.

Every sign-up, add and Mark paid is written to the **Activity** tab (admin) with your name.

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
**Delete order** *(admin only, inside Edit)*: removes ONE order and its tickets for good. For test purchases and dummy data. It asks first and **can't be undone** (the nightly backup still has a copy). For a real payment, use **Refund / cancel** instead so there is a record.
**Edit** (next to a person, here and in Attendees): opens a form.
- **Any exec:** name and email. A new email gets their ticket sent again automatically.
- **Admin password only:** UCID, member ID (the membership is checked again), **ticket type** (the price and the order total change; the message tells you whether to collect or refund the difference), answers to the event's questions, the help-desk warning (clear it if it was sorted out), and the order's payer name/email, e-transfer name and notes. Everything is saved in the change log with the old and new values.
If you see "ticket emails waiting", the daily email limit was reached. The bar shows how many are waiting and **how many emails are left today**. Press **Send now**: it asks how many to send (it suggests the smaller of the two numbers) and sends the oldest first. You can send fewer to keep some allowance for reminders. Gmail allows about 100 emails a day and resets about a day after the first send.
**Search by amount:** type `$25` (orders totalling exactly $25) or just `25` (that amount, or that text) in the Payments search. Handy when a parent e-transfers under another name with no message.

## Waitlist (when an event is full)
- Turn it on per event: **Events → Edit → Waitlist**. It is off by default.
- When the event is full, the public page shows **Join the waitlist** instead of "sold out". People give the same details as when registering. They get one short email. They have **no ticket and take no spot**.
- **Payments → Waitlist** lists them, oldest first. When a spot opens (a cancel or refund), press **Offer a spot** next to the next name. That makes a normal registration and emails them the payment details (or the ticket, if it is free). If no spot looks free the portal asks before offering anyway.
- Nothing moves by itself. An offer is held for 48 hours as a guide: if they have not paid by then, cancel their order (Refund / cancel) and offer the next person. **Remove** takes someone off the list.

## Cancel requests
On the ticket page of an **unpaid** ticket there is a **Cancel my registration** button. It does **not** cancel anything: it records that the person asked. Payments shows **Asked to cancel (n)** (and an alert on Overview). Press **Refund / cancel** to cancel the order, or **Dismiss request** to keep it. Nobody is emailed.

## Partner deals and the redemption log (Members tab)
At the bottom of **Members**: the partners and their offers. Any exec can **Add a partner**, **Edit**, or switch one **On/Off** (Off hides it from members without deleting it). Only the admin can **Delete**. Members see the On partners on their pass page (when they opened it from their emailed link or signed in with UCID + last name).
**Redemption log:** each time a member shows a deal it is recorded (who, which partner, when). The latest 25 show here with a count per partner; **Download all (CSV)** gives everything. Members who opened their pass some other way are not in this log (they are in the old one).

## Feedback, the event report and member history
- After someone is checked in, their ticket page shows five stars and an optional comment. Open an event's **Attendees** page to see the average, the spread and the comments.
- **Event report** (button on the Attendees page): turnout, money, members vs non-members, walk-ins, sign-ups per day, answers to the questions and feedback. **Copy as text** or **Download .txt** to paste into a message.
- A member's page now shows their **History** (events registered for, showed up, rating) and has **Edit member** (name, email, UCID, paid/unpaid) and **Resend membership pass**.
- At the door, **scanning a member pass** finds that member's ticket for the open event and checks it in. No ticket? It says so and sends them to the desk.

## The portal on a laptop vs a phone
- **Laptop or tablet (help desk, Finance):** the full portal with a menu on the left. Pick the event once at the top and Payments and Door both follow it.
- **Phone (door volunteers):** opens the **door scanner** by itself (see "The scanner page" below). A help-desk person on a phone can tap **Full portal** at the top.

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

### Changing the words in emails
Settings (admin) → **Email wording**. Pick an email, change the subject, heading, or the text at the top and bottom, then press **Preview** to see it, **Send test email** to get it in your own inbox, and **Save**. Leave a box empty to use the standard wording; type just a dash (-) to show nothing there. You can put `{name}` `{event}` `{code}` `{amount}` `{when}` `{where}` in the text (the box tells you which ones work) and they fill in for each person. The same change applies to every event. The same card sets the name and role in the signature and the button colour. The look of the email (banner, pandas, layout) isn't editable.

## Members finding their own tickets
People who lost their ticket email don't need the help desk: the footer of every events page has **My tickets** (`events.ucalgarycss.ca/tickets.html`). They enter their email, or their UCID and last name, and the ticket links are emailed to the address on the ticket. Nothing is shown on screen. The Activity tab records each use (admin only). Walk-ins without an email can't use it; look them up in Payments or Door.
The **member portal** works the same way now: members enter their email (or tap "I forgot which email I used" and enter UCID + last name) and get their pass link by email. Their pass page links back to Upcoming events and My tickets.

## Door tab = the help desk (event night)
The **Door** tab is for whoever runs the help desk on a laptop. The people scanning use the separate scanner page (below), and the Door tab shows who is inside as it happens.

1. **Entry switch** (top): **Entry CLOSED / OPEN** for the event shown, with its name next to it. **Only one event can be open at a time.** Opening a second one closes the first, and scanners switch to the new one by themselves. Every event starts closed; you open it when doors open.
2. **Counts and scanners online:** "47 / 92 inside", and how many scanner phones are signed in right now.
3. **Find person:** type a name or ticket ID (TKT…) → **Find** → **Check in**. Use it when a QR won't scan.
4. **Walk-in:** name, UCID if they have one, ticket type, cash or e-transfer → **Add & check in**. Walk-ins are always allowed, even when sold out.
5. **Lists** (they update by themselves, newest scan slides in at the top):
   - **Not paid yet:** check their e-transfer, then **Mark paid** → **Check in**.
   - **Please check:** people flagged at registration (membership not found, duplicate email). The scanner won't let them in. Sort it out with them, then **Check in**.
   - **Recent check-ins:** the latest people let in, **Undo** if someone was scanned by mistake. **View all check-ins** opens the full list, 10 at a time, with Undo.
6. On a laptop the camera button is hidden. A help-desk person on a phone still gets it.

## The scanner page (volunteers' phones)
`exec.ucalgarycss.ca/scanner` shows only the camera, the "inside" counter, a name search and Undo. Nothing else.
- **Execs** sign in with the exec password and their name. **Volunteers** use **Door sign-in (name only)**. It only works while entry is open, and it only scans, undoes and sees who is inside (no payments, no member search). When entry closes their session stops. A door password is optional (Settings → Security).
- Point the camera at the QR on the person's phone (a screenshot is fine).
  - 🟢 **Green:** let them in. Their answers (e.g. drink) show underneath.
  - 🟠 **Orange:** already checked in, **not paid yet**, entry closed, or **"Please go to the help desk"** (something to check). Send them to the help desk.
  - 🔴 **Red:** not a valid ticket for this event. Send them to the help desk.
- After each result it pauses a moment. **Tap the result** to scan the next person straight away.
- Two phones can scan at once. The same ticket can never get in twice.
- Tap the **CSS logo** to refresh the page.

No signal? Things get slow, not broken. Before the event, keep the Payments tab open or print the list.

## Activity tab (admin password only)
A plain list of what happened, newest first: "Kevin marked TNM-4408 paid · 6:02 pm". Filter by **event**, by **person**, by kind (Payments, Door, Edits, Events, Settings), or search a code or name. Use it to settle "I paid!" or "who checked them in?".

## Settings tab (admin only)
**Admin mode:** sign in with the exec password as usual. To get admin tools, tap the **gear** next to the light/dark switch at the bottom of the left menu and enter the admin password. The Activity and Settings tabs then appear. To leave, tap the gear and press **Leave admin mode**; that also signs you out.

Settings has six sections down the left. Pick one to open it:
- **General:** the e-transfer email, the contact email and the Instagram link shown on the public pages.
- **Membership:** each year, paste the new sheet's link and press **Test and save**. It reads the sheet first and tells you how many members it found, so a wrong link can't break anything.
- **Security:** the exec password, the admin password and the optional door password, each on its own row. Press **Change**, type the new one twice, save. Everyone else is signed out and needs the new password. Never write a password in a document or chat.
- **Emails:** change the wording of each email (see "Changing the words in emails" below).
- **Sessions:** **Online now** lists everyone signed in (name, role, scanner or not, last seen; yours says "This device"). **Sign out** next to a name signs just that person out, handy for a lost phone. **Sign everyone else out** does it for all.
- **Health:** press **Run health check**. It checks the data sheet, the Membership sheet, the nightly backup, the archive, **how many emails are left today**, and the last error the system saw. Each run is listed with its time and written to Activity.
  - **Email allowance:** the CSS Gmail can send about **100 emails a day**. At 0, nothing sends until Google resets it (about a day). Mark paid still works, but the pass email waits. Tickets sit as "waiting" until someone presses **Send now**.
  - **Last error** stays until a newer one replaces it. An old one is not a current problem if everything else says OK.

**Backups and alerts:** every **Sunday** the system copies the data sheet and the Membership sheet into the Drive folder "CSS Platform Backups" (in the CSS Gmail's Drive), keeps the last 4 of each, and bins older ones (Drive bin). To take one now: in Apps Script run `installJobs`. Every night it also runs the health check. If a check fails, it emails the CSS Gmail (once a day at most). To restore, open the newest backup and copy the tabs you need back into "CSS Platform Data". Entry also closes by itself 4 hours after an event ends.

The **light/dark switch** is next to the gear. It remembers your choice on that device.

## Good to know
- Everything you do is saved in a change log with your name.
- You never need to open Google Sheets or Google Drive. If you think you have to, ask the President first.
- Something looks wrong? See **RUNBOOK.md**, or message the President.

# CSS Platform: Fresh setup from scratch (about 15 minutes)

> Already set up (Sept 2026). Only needed to rebuild the back end in a new Google account or project. See README.md for how everything fits together.

What you're setting up: a **new, separate** Google Apps Script back end. v0.1 only **reads** the Membership sheet, and none of its code writes anything.

## Folder
| Folder | What |
|---|---|
| `api/` | The back end. These 4 files + `appsscript.json` get pasted into Google Apps Script |
| `exec-portal/` | The Exec Portal page (sign in → search → member page) |

## 1. Create the project (CSS Google account)
1. Sign in to **script.google.com** with the **CSS Google account**.
2. **New project**. Click "Untitled project" at the top and rename it **CSS Platform API**.
3. Click the **gear** (Project Settings) on the left and tick **"Show 'appsscript.json' manifest file in editor"**.

## 2. Paste the code
Back in the **Editor** (`< >` on the left):
1. Click `appsscript.json`, delete everything, and paste in the contents of `api/appsscript.json`.
2. Click `Code.gs`, delete everything, and paste in `api/Api.js`. Rename the file to **Api** (⋮ → Rename).
3. Click **+ → Script** to make a file for every other `.js` file in `api/` (**Config, Members, Store, Db, Events**…), same names, and paste each one in.
4. Press **Ctrl + S**.

## 3. Settings (Script Properties)
Gear (Project Settings) → scroll to **Script Properties** → **Add script property**:
| Property | Value |
|---|---|
| `MEMBERSHIP_SHEET_ID` | The Membership sheet's link (the full link is fine) |
| `EXEC_PASSWORD` | A **new** exec password. Don't reuse the old door/pay passcodes |
| `ADMIN_PASSWORD` | *(optional)* A different, stronger password for admin-only tools (settings, change log, deleting, year rollover) |

Click **Save script properties**.

## 4. Deploy
1. **Deploy → New deployment** → the gear next to "Select type" → **Web app**.
2. Description: `v0.1`. Execute as: **Me**. Who has access: **Anyone**.
3. **Deploy → Authorize access** → pick the CSS account → **Advanced → Go to CSS Platform API (unsafe) → Allow**.
   It asks for **Google Sheets**, **Google Drive** and **Send email as you**. That's expected (data sheet, event images, ticket emails).
4. Copy the **Web app URL** (ends in `/exec`).
5. Check it: open that URL in a browser tab. You should see `{"ok":true,"service":"CSS Platform API","version":"0.1.0"}`.

## 5. Connect the page
People type their own name at sign-in (used for the change log later).

Open `exec-portal/config.js` and paste the URL between the quotes:
```js
const API_URL = "https://script.google.com/macros/s/…/exec";
```
Then open `exec-portal/index.html` in Chrome and sign in with the new exec password.
(With `API_URL` left empty, the page runs in **demo mode**: made-up people, password `demo`, or `demo-admin` for admin.)

## 6. Test checklist
- [ ] Wrong password → "That password isn't right."
- [ ] Right password + name → the search screen
- [ ] Search by first name, full name, UCID, member ID and email → the right person
- [ ] Member page matches the sheet
- [ ] Nonsense search → "No member matches"
- [ ] The current portal, scanner and pay page still work as before

## If something breaks
| You see | Do this |
|---|---|
| "Can't reach the CSS system" | Check your internet. Open the Web app URL: if it doesn't show `"ok":true`, the deployment was removed or changed. Redeploy (step 4) and update `config.js` |
| "The system isn't set up yet" | A Script Property is missing (step 3) |
| "Too many wrong tries" | Wait 10 minutes |
| A member looks out of date | The search data refreshes every 5 minutes |
| Changed a password | Just edit `EXEC_PASSWORD` / `ADMIN_PASSWORD` in Script Properties. No redeploy needed |

**To remove v0.1 completely:** delete the "CSS Platform API" project. Nothing else is affected.

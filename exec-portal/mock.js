// Demo mode (used only when API_URL in config.js is empty).
// Runs the real member logic from ../api/Members.js on made-up people, laid out
// exactly like the Membership sheet, so the page can be tried without touching CSS data.

const MockApi = (() => {
  const DEMO_PASSWORD = "demo";
  const DEMO_ADMIN_PASSWORD = "demo-admin";
  const HEADERS = ["Timestamp", "Full Name", "UCID", "Email", "Payment method", "When", "Where", "Who",
    "", "", "", "", "", "", "Paid Status", "Member ID", "Portal Link", "Mail Status"];
  const blanks = ["", "", "", "", "", ""];
  const ROWS = [
    [new Date("2026-09-10T12:04:00"), "Alex Wong", "30100001", "alex.wong@example.com", "E-transfer", "", "", "", ...blanks, true, "CSS0021234", "", "Sent"],
    [new Date("2026-09-10T12:31:00"), "Bella Chen", "30100002", "bella.c@example.com", "Cash", "Sep 10 clubs week", "MacHall booth", "Treasurer", ...blanks, true, "CSS0034821", "", "Sent"],
    [new Date("2026-09-11T09:15:00"), "Chris Li", "30100003", "chrisli@example.com", "E-transfer", "", "", "", ...blanks, "", "", "", ""],
    [new Date("2026-09-12T18:40:00"), "Daniel Zhang", "", "dz.guest@example.com", "E-transfer", "", "", "", ...blanks, "YES", "CSS0051177", "", ""],
    [new Date("2026-09-14T14:02:00"), "Emily Chan", "30100005", "emily.chan@example.com", "Cash", "", "", "", ...blanks, "TRUE", "CSS0066402", "", "Sent"],
    [new Date("2026-09-15T10:20:00"), "Emily Cheng", "30100006", "e.cheng@example.com", "E-transfer", "", "", "", ...blanks, false, "", "", ""]
  ];

  let ready = null;
  function loadLogic() {
    ready = ready || Promise.all(["Members.js", "People.js", "Bcrypt.js", "Practice.js"].map((file) => new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "../api/" + file;
      s.onload = resolve;
      s.onerror = () => reject(new Error("Could not load " + file));
      document.head.appendChild(s);
    })));
    return ready;
  }

  const sessions = new Set();
  const sessionNames = {};
  const sessionPeople = {};
  const accountHashes = {}, accountVersions = {}, setupTokens = {};
  let peopleLocked = false;
  let demoPractice = null;
  function practiceReply(req) {
    if (req.action === "removePracticeEvent") { demoPractice = null; return { ok: true, removed: true }; }
    if (req.action === "createPracticeEvent" && !demoPractice) {
      const event = { id: "DEMO-PRACTICE", name: PRACTICE_NAME, slug: "practice-not-real", date: new Date().toISOString().slice(0, 10), status: "closed", entryOpen: false,
        ticketTypes: [], questions: [], summary: { practice: true }, mailRegistration: false, mailTickets: false, mailReminders: false };
      const cards = PRACTICE_PEOPLE.map((person, i) => {
        const link = new URL("ticket.html", new URL(PUBLIC_SITE_URL, location.href));
        link.searchParams.set("t", "demo-practice-" + (i + 1));
        return { n: i + 1, name: person.name, ticketType: { m: "Member", n: "Non-member", f: "Free" }[person.type], ticketId: "DEMO-" + (i + 1), expect: person.expect, note: person.note, link: link.href };
      });
      cards.push({ n: cards.length + 1, name: "Not a real ticket", ticketType: "", ticketId: "", expect: "RED", note: "A made-up code: should say the ticket wasn't found.", link: new URL("ticket.html?t=demo-missing", new URL(PUBLIC_SITE_URL, location.href)).href });
      demoPractice = { ok: true, exists: true, archived: false, eventId: event.id, eventName: event.name, event, cards };
    }
    return demoPractice || { ok: true, exists: false };
  }
  async function demoPasswordInput(password, salt) {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", encoder.encode(salt), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(password)));
    return btoa(String.fromCharCode(...digest));
  }
  async function demoHashPassword(password) {
    const salt = bcrypt.genSaltSync(12);
    const hash = bcrypt.hashSync(await demoPasswordInput(password, salt.slice(7)), salt);
    return "$bcrypt-sha256$v=2,t=2b,r=12$" + hash.slice(7, 29) + "$" + hash.slice(29);
  }
  async function demoVerifyPassword(password, stored) {
    const match = stored.match(/^\$bcrypt-sha256\$v=2,t=2b,r=12\$([./A-Za-z0-9]{22})\$([./A-Za-z0-9]{31})$/);
    return match ? bcrypt.compareSync(await demoPasswordInput(password, match[1]), "$2b$12$" + match[1] + match[2])
      : !bcrypt.truncates(password) && bcrypt.compareSync(password, stored);
  }

  // ---- Tasks (made-up team and tasks, kept in memory until the page reloads) ----
  const day = (n) => { const d = new Date(new Date().toLocaleDateString("en-CA", { timeZone: "America/Edmonton" }) + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const ago = (mins) => new Date(Date.now() - mins * 60000).toISOString();
  let taskTeam = [
    { id: "tm1", name: "Gordon", department: "Internal", departments: ["Internal"], discordId: "123456789012345678", active: true, sort: 1 },
    { id: "tm2", name: "Bella Chen", department: "Events", departments: ["Events", "Marketing"], discordId: "223456789012345678", active: true, sort: 2 },
    { id: "tm3", name: "Chris Li", department: "Marketing", departments: ["Marketing"], discordId: "", active: true, sort: 3 },
    { id: "tm4", name: "Emily Chan", department: "Finance", departments: ["Finance"], discordId: "323456789012345678", active: true, sort: 4 }
  ];
  // Departments: the five built in, any added in Settings → People, then General
  let addedDepts = [];
  const demoDepts = () => ["Events", "Marketing", "Internal", "External", "Finance", ...addedDepts, "General"];
  const deptName = (d) => demoDepts().find((x) => x.toLowerCase() === String(d || "").trim().toLowerCase()) || "";
  let taskSeq = 10;
  const mkTask = (id, title, owner, department, status, due, mins, updates, extra) => ({
    id, title, owner, owners: [owner], department, status, due, notes: "", link: "", remind: [], nextReminder: "", checklist: [], labels: [],
    createdBy: owner, createdAt: ago(mins), updatedAt: ago(mins), doneAt: status === "done" ? ago(60) : "", updates: updates || [], ...(extra || {})
  });
  let tasks = [
    mkTask("tk1", "Book MacHall room for AGM", "Gordon", "Internal", "doing", day(-2), 6000,
      [{ id: "u1", text: "Emailed the booking office, waiting to hear back", by: "Gordon", source: "discord", status: "doing", createdAt: ago(180) }]),
    mkTask("tk2", "Make reel for badminton night", "Chris Li", "Marketing", "todo", day(0), 3000, [], { remind: [{ n: 1, unit: "days", at: "09:00" }] }),
    mkTask("tk3", "Order snacks for Lunar New Year", "Bella Chen", "Events", "blocked", day(3), 4000,
      [{ id: "u2", text: "Stuck: waiting on the budget sign-off", by: "Bella Chen", source: "discord", status: "blocked", createdAt: ago(45) }],
      { remind: [{ n: 2, unit: "days", at: "09:00" }, { n: 0, unit: "days", at: "18:00" }], labels: ["Lunar New Year", "Budget"],
        checklist: [{ id: "c1", text: "Get quotes from 2 stores", done: true }, { id: "c2", text: "Budget sign-off", done: false }, { id: "c3", text: "Place the order", done: false }] }),
    mkTask("tk7", "Print posters for the AGM", "Bella Chen", "Events", "todo", day(3), 2000, [], { labels: ["AGM"], owners: ["Bella Chen", "Chris Li"] }),
    mkTask("tk8", "Confirm DJ for the formal", "Gordon", "Events", "doing", day(3), 2500, []),
    mkTask("tk9", "Send sponsor thank-you emails", "Emily Chan", "External", "todo", day(3), 2600, []),
    mkTask("tk4", "Reimburse Clubs Week receipts", "Emily Chan", "Finance", "todo", day(12), 1000, []),
    mkTask("tk5", "Update the sponsor deck", "Gordon", "External", "todo", "", 500,
      [{ id: "u3", text: "Started a draft in the shared drive", by: "Gordon", source: "portal", status: "doing", createdAt: ago(20) }]),
    mkTask("tk6", "Post Halloween recap on Instagram", "Chris Li", "Marketing", "done", day(-5), 9000,
      [{ id: "u4", text: "done ✅", by: "Chris Li", source: "discord", status: "done", createdAt: ago(60) }])
  ];
  const plain = (t) => { const { updates, ...rest } = withReminders(t); return rest; };

  // People: one list for sign-in names and "Who" (matched ignoring case and extra spaces)
  const nameKey = (s) => String(s || "").trim().replace(/\s+/g, " ").toLowerCase();
  const findPerson = (name) => taskTeam.find((p) => nameKey(p.name) === nameKey(name));
  const demoTeam = () => taskTeam.map((p) => {
    const departments = (p.departments || (p.department ? [p.department] : [])).filter((d) => demoDepts().includes(d));
    return { ...p, department: departments[0] || "", departments, passwordSet: !!accountHashes[p.id] };
  });
  function demoSignIn(name, role, person) {
    const token = (role === "admin" ? "demo-admin-" : "demo-") + Math.random().toString(36).slice(2);
    sessions.add(token);
    sessionNames[token] = name;
    if (person) sessionPeople[token] = { id: person.id, version: accountVersions[person.id] };
    return { ok: true, token, name, role };
  }
  function demoImport(text, save) {
    const parsed = parsePeoplePaste_(text, demoDepts());
    if (parsed.error) return { ok: false, error: "BAD_REQUEST", message: parsed.error };
    const seen = new Set(taskTeam.map((p) => nameKey(p.name)));
    let added = 0;
    const rows = parsed.rows.map((p) => {
      const add = !seen.has(nameKey(p.name));
      seen.add(nameKey(p.name));
      if (add) { added++; if (save) addPerson(p.name, p.department); }
      return { ...p, add };
    });
    return { ok: true, rows, added, skipped: rows.length - added, ...(save ? { team: demoTeam() } : {}) };
  }
  function addPerson(name, department) {
    const clean = String(name || "").trim().replace(/\s+/g, " ");
    if (!clean || findPerson(clean)) return;
    taskTeam.push({ id: "tm" + (++taskSeq), name: clean, department: department || "", departments: department ? [department] : [], discordId: "", active: true, sort: taskTeam.length + 1 });
  }

  // Reminders: [{ n, unit: "days"|"weeks", at: "HH:MM" }] before the due date, Calgary time
  const nowMountain = () => new Date().toLocaleString("sv-SE", { timeZone: "America/Edmonton" }).replace(" ", "T").slice(0, 16);
  function withReminders(t) {
    const list = Array.isArray(t.remind) ? t.remind : [];
    const now = nowMountain();
    t.reminders = list.map((r) => {
      let when = "";
      if (t.due) { const d = new Date(t.due + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - r.n * (r.unit === "weeks" ? 7 : 1)); when = d.toISOString().slice(0, 10) + "T" + r.at; }
      return { n: r.n, unit: r.unit, at: r.at, when, sent: !!when && when < now };
    });
    t.nextReminder = t.status === "done" ? "" : t.reminders.filter((r) => r.when && !r.sent).map((r) => r.when).sort()[0] || "";
    return t;
  }
  function cleanRemind(list) {
    if (!Array.isArray(list)) return [];
    return list.slice(0, 5).map((r) => ({ n: Math.max(0, Math.min(60, parseInt(r.n, 10) || 0)), unit: r.unit === "weeks" ? "weeks" : "days", at: /^\d{2}:\d{2}$/.test(r.at) ? r.at : "09:00" }));
  }

  function taskReply(req) {
    const me = sessionNames[req.token] || "Demo";
    const find = (id) => tasks.find((t) => t.id === id);
    const isAdmin = String(req.token || "").startsWith("demo-admin");
    switch (req.action) {
      case "listTasks":
        tasks.forEach(withReminders);
        return { ok: true, tasks: JSON.parse(JSON.stringify(tasks)), team: demoTeam(), departments: demoDepts(),
          discord: { ready: true, posting: true, reading: true, synced: 0, error: "" } };
      case "saveTask": {
        const input = req.task || {};
        const title = String(input.title === undefined && input.id ? (find(input.id) || {}).title || "" : input.title || "").trim();
        if (!title) return { ok: false, error: "BAD_REQUEST", message: "Say what the task is." };
        if (title.length > 140) return { ok: false, error: "BAD_REQUEST", message: "Keep the task under 140 characters." };
        const owners = [];
        (Array.isArray(input.owners) ? input.owners : [input.owner || ""]).forEach((raw) => {
          const typed = String(raw).trim().replace(/\s+/g, " ");
          if (!typed) return;
          let person = findPerson(typed);
          if (!person && !peopleLocked) { addPerson(typed, input.department && input.department !== "General" ? input.department : ""); person = findPerson(typed); }
          const name = person ? person.name : typed;
          if (!owners.some((n) => n.toLowerCase() === name.toLowerCase())) owners.push(name);
        });
        const person = findPerson(owners[0] || "");
        const fields = { title, owner: owners[0] || "", owners, due: input.due || "", department: input.department || (person && person.department) || "General",
          notes: input.notes || "", link: input.link || "", remind: cleanRemind(input.remind), updatedBy: me, updatedAt: new Date().toISOString(),
          checklist: (Array.isArray(input.checklist) ? input.checklist : []).slice(0, 60).map((c, i) => ({ id: c.id || "ck" + (++taskSeq), text: String(c.text || "").trim().slice(0, 200), done: c.done === true })).filter((c) => c.text),
          labels: [...new Set((Array.isArray(input.labels) ? input.labels : []).map((l) => String(l).trim().slice(0, 24)).filter(Boolean))].slice(0, 6) };
        if (input.id) {
          const t = find(input.id);
          if (!t) return { ok: false, error: "NOT_FOUND", message: "That task isn't there any more." };
          ["owner", "owners", "due", "department", "notes", "link", "remind", "checklist", "labels"].forEach((k) => { if (input[k] === undefined && !(k === "owner" && input.owners)) delete fields[k]; });
          if (input.department === undefined) delete fields.department;
          if (input.status && input.status !== t.status && !(input.from && input.from !== t.status)) {
            t.status = input.status;
            t.doneAt = input.status === "done" ? new Date().toISOString() : "";
            t.updates.unshift({ id: "u" + (++taskSeq), text: "", by: me, source: "portal", status: input.status, createdAt: new Date().toISOString() });
          }
          Object.assign(t, fields);
          return { ok: true, task: { ...plain(t), updates: t.updates }, discordPosted: false };
        }
        const again = input.clientId && find(input.clientId);
        if (again) return { ok: true, task: { ...plain(again), updates: again.updates }, discordPosted: true, repeated: true };
        const t = { id: input.clientId || "tk" + (++taskSeq), status: input.status || "todo", createdBy: me, createdAt: new Date().toISOString(), doneAt: "", updates: [], ...fields };
        tasks.push(t);
        return { ok: true, task: plain(t), discordPosted: true };
      }
      case "savePerson": {
        if (!isAdmin) return { ok: false, error: "ADMIN_ONLY" };
        const p = req.person || {};
        const name = String(p.name || "").trim().replace(/\s+/g, " ");
        if (!name) return { ok: false, error: "BAD_REQUEST", message: "Type a name." };
        const clash = findPerson(name);
        if (clash && clash.id !== p.id) return { ok: false, error: "BAD_REQUEST", message: `${clash.name} is already on the list.` };
        const discordId = String(p.discordId || "").replace(/\s+/g, "");
        if (discordId && !/^\d{17,20}$/.test(discordId)) return { ok: false, error: "BAD_REQUEST", message: "A Discord ID is 17 to 20 digits." };
        let row = p.id && taskTeam.find((x) => x.id === p.id);
        if (p.id && !row) return { ok: false, error: "NOT_FOUND", message: "That person isn't on the list any more." };
        if (!row) { row = { id: "tm" + (++taskSeq), sort: taskTeam.length + 1 }; taskTeam.push(row); }
        const departments = [...new Set((Array.isArray(p.departments) ? p.departments : p.department ? [p.department] : []).map(deptName).filter(Boolean))];
        Object.assign(row, { name, department: departments[0] || "", departments, discordId, active: p.active !== false });
        return { ok: true, person: demoTeam().find((x) => x.id === row.id), team: demoTeam() };
      }
      case "previewPeopleImport": case "importPeople":
        if (!isAdmin) return { ok: false, error: "ADMIN_ONLY" };
        return demoImport(req.text, req.action === "importPeople");
      case "resetPersonPassword": {
        if (!isAdmin) return { ok: false, error: "ADMIN_ONLY" };
        const row = taskTeam.find((p) => p.id === req.id);
        if (!row) return { ok: false, error: "NOT_FOUND" };
        delete accountHashes[row.id];
        accountVersions[row.id] = Math.random().toString(36);
        return { ok: true, team: demoTeam() };
      }
      case "removePerson":
        if (!isAdmin) return { ok: false, error: "ADMIN_ONLY" };
        taskTeam = taskTeam.filter((p) => p.id !== req.id);
        return { ok: true, team: demoTeam() };
      case "addDepartment": {
        if (!isAdmin) return { ok: false, error: "ADMIN_ONLY" };
        const name = String(req.name || "").trim().replace(/\s+/g, " ");
        if (!name || name.length > 24) return { ok: false, error: "BAD_REQUEST", message: "Write the department's name (up to 24 characters)." };
        if (deptName(name)) return { ok: false, error: "BAD_REQUEST", message: deptName(name) + " is already a department." };
        addedDepts.push(name);
        return { ok: true, departments: demoDepts(), team: demoTeam() };
      }
      case "removeDepartment": {
        if (!isAdmin) return { ok: false, error: "ADMIN_ONLY" };
        const left = addedDepts.filter((d) => d.toLowerCase() !== String(req.name || "").trim().toLowerCase());
        if (left.length === addedDepts.length) return { ok: false, error: "BAD_REQUEST", message: "The main departments can't be removed. Only ones that were added can." };
        addedDepts = left;
        return { ok: true, departments: demoDepts(), team: demoTeam() };
      }
      case "setTaskStatus": {
        const t = find(req.id);
        if (!t) return { ok: false, error: "NOT_FOUND", message: "That task isn't there any more." };
        if (t.status === req.status) return { ok: true, task: { ...plain(t), updates: t.updates } };
        if (req.from && req.from !== t.status) return { ok: true, stale: true, task: { ...plain(t), updates: t.updates } };
        t.status = req.status;
        t.doneAt = req.status === "done" ? new Date().toISOString() : "";
        const last = t.updates[0];
        if (last && !last.text && last.by === me && last.source === "portal" && Date.now() - Date.parse(last.createdAt) < 600000) Object.assign(last, { status: req.status, createdAt: new Date().toISOString() });
        else t.updates.unshift({ id: "u" + (++taskSeq), text: "", by: me, source: "portal", status: req.status, createdAt: new Date().toISOString() });
        return { ok: true, task: { ...plain(t), updates: t.updates } };
      }
      case "addTaskUpdate": {
        const t = find(req.id);
        if (!t) return { ok: false, error: "NOT_FOUND", message: "That task isn't there any more." };
        const seen = req.clientId && t.updates.find((u) => u.id === req.clientId);
        if (seen) return { ok: true, update: seen, task: { ...plain(t), updates: t.updates }, repeated: true };
        const update = { id: req.clientId || "u" + (++taskSeq), text: String(req.text || "").trim().slice(0, 1000), by: me, source: "portal", status: req.status || "", createdAt: new Date().toISOString() };
        t.updates.unshift(update);
        const lower = update.text.toLowerCase();
        const mentioned = taskTeam.filter((p) => lower.includes("@" + nameKey(p.name)) || lower.includes("@" + nameKey(p.name).split(" ")[0])).map((p) => p.name);
        return { ok: true, update, task: { ...plain(t), updates: t.updates }, mentioned, discordPosted: mentioned.length > 0 };
      }
      case "removeTask":
        tasks = tasks.filter((t) => t.id !== req.id);
        return { ok: true };
      case "remindTasksOnDiscord": {
        const soon = day(7);
        const count = tasks.filter((t) => t.status !== "done" && (t.status === "blocked" || (t.due && t.due <= soon))).length;
        return { ok: true, posted: count > 0, count };
      }
      case "saveTeam":
        if (!req.token.startsWith("demo-admin")) return { ok: false, error: "ADMIN_ONLY" };
        if (!(req.team || []).length) return { ok: false, error: "BAD_REQUEST", message: "The team list can't be empty. Add at least one person." };
        taskTeam = (req.team || []).map((p, i) => ({ id: p.id || "tm" + (++taskSeq), name: p.name, department: p.department, discordId: p.discordId, active: p.active, sort: i + 1 }));
        return { ok: true, team: taskTeam };
      case "taskBotStatus":
        if (!req.token.startsWith("demo-admin")) return { ok: false, error: "ADMIN_ONLY" };
        return { ok: true, timer: true, lastTick: new Date().toISOString(), posting: true, reading: true, botName: "taskbot" };
    }
    return { ok: false, error: "UNKNOWN_ACTION" };
  }

  // Comments on a payment. The demo has no payments list, so only the comment actions themselves are here.
  const payNotes = [];
  function paymentNoteReply(req) {
    const me = sessionNames[req.token] || "Demo";
    const isAdmin = String(req.token || "").startsWith("demo-admin");
    const view = (n) => ({ id: n.id, orderId: n.orderId, text: n.text, by: n.by, createdAt: n.createdAt });
    const showing = (orderId) => payNotes.filter((n) => n.orderId === orderId && !n.removedAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const summary = (orderId) => {
      const last = showing(orderId)[0];
      const flat = last ? last.text.replace(/\s+/g, " ").trim() : "";
      return { noteCount: showing(orderId).length, latestNote: last ? { text: flat.length > 120 ? flat.slice(0, 119).trim() + "…" : flat, by: last.by, createdAt: last.createdAt } : null };
    };
    switch (req.action) {
      case "listPaymentNotes":
        if (!req.orderId) return { ok: false, error: "BAD_REQUEST", message: "Which payment?" };
        return { ok: true, notes: showing(req.orderId).map(view), ...summary(req.orderId) };
      case "addPaymentNote": {
        const text = String(req.text ?? "").trim();
        if (!text || text.length > 1000) return { ok: false, error: "BAD_REQUEST", message: "Write a comment of up to 1000 characters." };
        if (!req.orderId) return { ok: false, error: "NOT_FOUND", message: "That payment isn't there any more." };
        const again = req.clientId && payNotes.find((n) => n.id === req.clientId);
        if (again) return { ok: true, repeated: true, note: view(again), ...summary(again.orderId) };
        const note = { id: req.clientId || "pn" + (++taskSeq), orderId: req.orderId, text, by: me, createdAt: new Date().toISOString(), removedAt: "" };
        payNotes.push(note);
        return { ok: true, note: view(note), ...summary(note.orderId) };
      }
      case "removePaymentNote": {
        const note = payNotes.find((n) => n.id === (req.id || req.noteId) && !n.removedAt);
        if (!note) return { ok: false, error: "NOT_FOUND", message: "That comment is no longer there." };
        if (!isAdmin && note.by !== me) return { ok: false, error: "ADMIN_ONLY", message: `Only ${note.by} or an admin can remove this comment.` };
        note.removedAt = new Date().toISOString();
        return { ok: true, orderId: note.orderId, ...summary(note.orderId) };
      }
    }
    return { ok: false, error: "UNKNOWN_ACTION" };
  }

  async function handle(req) {
    await loadLogic();
    await new Promise((r) => setTimeout(r, 250));   // feel like a real network call
    const members = rowsToMembers_([HEADERS, ...ROWS]);
    const signedPerson = sessionPeople[req.token];
    if (signedPerson) {
      const person = taskTeam.find((p) => p.id === signedPerson.id);
      if (!person || person.active === false || signedPerson.version !== accountVersions[person.id]) {
        sessions.delete(req.token);
        return { ok: false, error: "NOT_LOGGED_IN" };
      }
    }

    switch (req.action) {
      case "loginDoor":   // door volunteers: name only (demo has no door password)
        if (!String(req.name || "").trim()) return { ok: false, error: "NAME_NEEDED" };
        return demoSignIn(String(req.name).trim(), "door");
      case "signInNames":
        return { ok: true, names: taskTeam.filter((p) => p.active !== false).map((p) => p.name) };
      case "login": {
        if (!String(req.name || "").trim()) return { ok: false, error: "NAME_NEEDED" };
        let known = findPerson(req.name);
        if (!known) {
          const key = nameKey(req.name);
          const matches = taskTeam.filter((p) => p.active !== false && (nameKey(p.name).split(" ")[0] === key || nameKey(p.name).startsWith(key + " ")));
          if (matches.length > 1) return { ok: false, error: "NAME_AMBIGUOUS", message: `More than one person is called that: ${matches.map((p) => p.name).join(", ")}. Type your full name.` };
          known = matches[0];
        }
        if (known && known.active === false) return { ok: false, error: "WRONG_PASSWORD" };
        if (known && accountHashes[known.id]) return await demoVerifyPassword(String(req.password || ""), accountHashes[known.id])
          ? demoSignIn(known.name, "exec", known) : { ok: false, error: "WRONG_PASSWORD" };
        if (req.password !== DEMO_PASSWORD) return { ok: false, error: "WRONG_PASSWORD" };
        if (!known && peopleLocked) return { ok: false, error: "PERSON_NOT_LISTED", message: "Your name isn't on the People list. Ask an admin to add you first." };
        const setupToken = Math.random().toString(36);
        setupTokens[setupToken] = { name: known ? known.name : req.name.trim(), id: known?.id || "", version: known ? accountVersions[known.id] : undefined, at: Date.now() };
        return { ok: true, needsPasswordSetup: true, setupToken, name: known ? known.name : req.name.trim() };
      }
      case "finishExecSetup": {
        const setup = setupTokens[req.setupToken];
        if (!setup || Date.now() - setup.at > 600000) return { ok: false, error: "PASSWORD_SETUP_EXPIRED", message: "Sign in with the club password again." };
        const password = String(req.password || "");
        if (!password) return { ok: false, error: "BAD_REQUEST", message: "Enter a password." };
        let known = findPerson(setup.name);
        if ((setup.id && (!known || setup.id !== known.id)) || (known && (known.active === false || accountHashes[known.id] || accountVersions[known.id] !== setup.version))) return { ok: false, error: "PASSWORD_SETUP_EXPIRED", message: "Your sign-in details changed. Sign in again." };
        if (!known && peopleLocked) return { ok: false, error: "PERSON_NOT_LISTED", message: "Ask an admin to add your name first." };
        if (!known) { addPerson(setup.name); known = findPerson(setup.name); }
        accountHashes[known.id] = await demoHashPassword(password);
        accountVersions[known.id] = Math.random().toString(36);
        delete setupTokens[req.setupToken];
        return demoSignIn(known.name, "exec", known);
      }
      case "unlockSettings": {
        if (!sessions.has(req.token)) return { ok: false, error: "NOT_LOGGED_IN" };
        if (req.password !== DEMO_ADMIN_PASSWORD) return { ok: false, error: "WRONG_PASSWORD" };
        const person = signedPerson && taskTeam.find((p) => p.id === signedPerson.id);
        return demoSignIn(sessionNames[req.token], "admin", person);
      }
      case "logout":
        sessions.delete(req.token);
        return { ok: true };
      case "practiceSheet": case "createPracticeEvent": case "removePracticeEvent":
        if (!sessions.has(req.token)) return { ok: false, error: "NOT_LOGGED_IN" };
        return practiceReply(req);
      case "listEvents":
        if (!sessions.has(req.token)) return { ok: false, error: "NOT_LOGGED_IN" };
        return { ok: true, events: demoPractice ? [demoPractice.event] : [], counts: {} };
      case "getSettings":
        if (!sessions.has(req.token)) return { ok: false, error: "NOT_LOGGED_IN" };
        if (!String(req.token).startsWith("demo-admin-")) return { ok: false, error: "ADMIN_ONLY" };
        return { ok: true, settings: {
          etransferEmail: "payments@example.com", contactEmail: "club@example.com", instagramUrl: "",
          membershipSheetId: "", membershipTab: "Members", membershipYear: "", membershipFee: 10,
          execPasswordSet: true, adminPasswordSet: true, doorPasswordSet: false, publicSiteUrl: "../public/", peopleLocked,
          squareConfigured: false, squareEnvironment: "production", squareLocationId: "", squareTokenSet: false,
          squarePassFee: false, squareFeePercent: 0, squareFeeFixed: 0
        } };
      case "saveSettings":
        if (!sessions.has(req.token)) return { ok: false, error: "NOT_LOGGED_IN" };
        if (!String(req.token).startsWith("demo-admin-")) return { ok: false, error: "ADMIN_ONLY" };
        if (typeof req.settings?.peopleLocked === "boolean") peopleLocked = req.settings.peopleLocked;
        return { ok: true, changed: ["People list lock"] };
      case "searchMembers":
        if (!sessions.has(req.token)) return { ok: false, error: "NOT_LOGGED_IN" };
        const matches = searchMembers_(members, req.query, 100000);
        return { ok: true, results: matches.slice(0, 25), total: matches.length };
      case "getMember": {
        if (!sessions.has(req.token)) return { ok: false, error: "NOT_LOGGED_IN" };
        const member = findMemberById_(members, req.memberId);
        return member ? { ok: true, member } : { ok: false, error: "NOT_FOUND" };
      }
      case "listTasks": case "saveTask": case "setTaskStatus": case "addTaskUpdate": case "removeTask":
      case "remindTasksOnDiscord": case "saveTeam": case "taskBotStatus": case "savePerson": case "removePerson":
      case "previewPeopleImport": case "importPeople": case "resetPersonPassword": case "addDepartment": case "removeDepartment":
        if (!sessions.has(req.token)) return { ok: false, error: "NOT_LOGGED_IN" };
        return taskReply(req);
      case "listPaymentNotes": case "addPaymentNote": case "removePaymentNote":
        if (!sessions.has(req.token)) return { ok: false, error: "NOT_LOGGED_IN" };
        return paymentNoteReply(req);
      case "clearTicketFlag":   // the demo has no tickets, so there is never a flag to clear
        if (!sessions.has(req.token)) return { ok: false, error: "NOT_LOGGED_IN" };
        return { ok: false, error: "NOT_FOUND", message: "Ticket not found." };
      default:
        return { ok: false, error: "UNKNOWN_ACTION" };
    }
  }

  return { handle };
})();

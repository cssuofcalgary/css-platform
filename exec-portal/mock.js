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
    ready = ready || Promise.all(["Members.js", "People.js", "Bcrypt.js"].map((file) => new Promise((resolve, reject) => {
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

  // ---- Tasks (made-up team and tasks, kept in memory until the page reloads) ----
  const day = (n) => { const d = new Date(new Date().toLocaleDateString("en-CA", { timeZone: "America/Edmonton" }) + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const ago = (mins) => new Date(Date.now() - mins * 60000).toISOString();
  let taskTeam = [
    { id: "tm1", name: "Gordon", department: "Internal", discordId: "123456789012345678", active: true, sort: 1 },
    { id: "tm2", name: "Bella Chen", department: "Events", discordId: "223456789012345678", active: true, sort: 2 },
    { id: "tm3", name: "Chris Li", department: "Marketing", discordId: "", active: true, sort: 3 },
    { id: "tm4", name: "Emily Chan", department: "Finance", discordId: "323456789012345678", active: true, sort: 4 }
  ];
  let taskSeq = 10;
  const mkTask = (id, title, owner, department, status, due, mins, updates, extra) => ({
    id, title, owner, department, status, due, notes: "", link: "", remind: [], nextReminder: "",
    createdBy: owner, createdAt: ago(mins), updatedAt: ago(mins), doneAt: status === "done" ? ago(60) : "", updates: updates || [], ...(extra || {})
  });
  let tasks = [
    mkTask("tk1", "Book MacHall room for AGM", "Gordon", "Internal", "doing", day(-2), 6000,
      [{ id: "u1", text: "Emailed the booking office, waiting to hear back", by: "Gordon", source: "discord", status: "doing", createdAt: ago(180) }]),
    mkTask("tk2", "Make reel for badminton night", "Chris Li", "Marketing", "todo", day(0), 3000, [], { remind: [{ n: 1, unit: "days", at: "09:00" }] }),
    mkTask("tk3", "Order snacks for Lunar New Year", "Bella Chen", "Events", "blocked", day(3), 4000,
      [{ id: "u2", text: "Stuck: waiting on the budget sign-off", by: "Bella Chen", source: "discord", status: "blocked", createdAt: ago(45) }],
      { remind: [{ n: 2, unit: "days", at: "09:00" }, { n: 0, unit: "days", at: "18:00" }] }),
    mkTask("tk7", "Print posters for the AGM", "Bella Chen", "Events", "todo", day(3), 2000, []),
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
  const demoTeam = () => taskTeam.map((p) => ({ ...p, passwordSet: !!accountHashes[p.id] }));
  function demoSignIn(name, role, person) {
    const token = (role === "admin" ? "demo-admin-" : "demo-") + Math.random().toString(36).slice(2);
    sessions.add(token);
    sessionNames[token] = name;
    if (person) sessionPeople[token] = { id: person.id, version: accountVersions[person.id] };
    return { ok: true, token, name, role };
  }
  function demoImport(text, save) {
    const parsed = parsePeoplePaste_(text, TASK_DEPTS);
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
    taskTeam.push({ id: "tm" + (++taskSeq), name: clean, department: department || "", discordId: "", active: true, sort: taskTeam.length + 1 });
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
        return { ok: true, tasks: JSON.parse(JSON.stringify(tasks)), team: demoTeam(),
          discord: { ready: true, posting: true, reading: true, synced: 0, error: "" } };
      case "saveTask": {
        const input = req.task || {};
        const title = String(input.title || "").trim();
        if (!title) return { ok: false, error: "BAD_REQUEST", message: "Say what the task is." };
        if (title.length > 140) return { ok: false, error: "BAD_REQUEST", message: "Keep the task under 140 characters." };
        const typed = String(input.owner || "").trim().replace(/\s+/g, " ");
        let person = findPerson(typed);
        if (typed && !person && !peopleLocked) { addPerson(typed, input.department && input.department !== "General" ? input.department : ""); person = findPerson(typed); }
        const fields = { title, owner: person ? person.name : typed, due: input.due || "", department: input.department || (person && person.department) || "General",
          notes: input.notes || "", link: input.link || "", remind: cleanRemind(input.remind), updatedBy: me, updatedAt: new Date().toISOString() };
        if (input.id) {
          const t = find(input.id);
          if (!t) return { ok: false, error: "NOT_FOUND", message: "That task isn't there any more." };
          Object.assign(t, fields);   // editing never changes the status
          return { ok: true, task: plain(t), discordPosted: false };
        }
        const t = { id: "tk" + (++taskSeq), status: input.status || "todo", createdBy: me, createdAt: new Date().toISOString(), doneAt: "", updates: [], ...fields };
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
        Object.assign(row, { name, department: p.department || "", discordId, active: p.active !== false });
        return { ok: true, person: { ...row, passwordSet: !!accountHashes[row.id] }, team: demoTeam() };
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
      case "setTaskStatus": {
        const t = find(req.id);
        if (!t) return { ok: false, error: "NOT_FOUND", message: "That task isn't there any more." };
        t.status = req.status;
        t.doneAt = req.status === "done" ? new Date().toISOString() : "";
        t.updates.unshift({ id: "u" + (++taskSeq), text: "", by: me, source: "portal", status: req.status, createdAt: new Date().toISOString() });
        return { ok: true, task: plain(t) };
      }
      case "addTaskUpdate": {
        const t = find(req.id);
        if (!t) return { ok: false, error: "NOT_FOUND", message: "That task isn't there any more." };
        const update = { id: "u" + (++taskSeq), text: String(req.text || "").trim().slice(0, 1000), by: me, source: "portal", status: req.status || "", createdAt: new Date().toISOString() };
        t.updates.unshift(update);
        return { ok: true, update, task: plain(t) };
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
      case "login": {
        if (!String(req.name || "").trim()) return { ok: false, error: "NAME_NEEDED" };
        const known = findPerson(req.name);
        if (req.password === DEMO_ADMIN_PASSWORD) {
          if (!peopleLocked) addPerson(req.name);
          return demoSignIn(known ? known.name : req.name.trim(), "admin");
        }
        if (known && known.active === false) return { ok: false, error: "WRONG_PASSWORD" };
        if (known && accountHashes[known.id]) return bcrypt.compareSync(String(req.password || ""), accountHashes[known.id])
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
        if (password.length < 8 || bcrypt.truncates(password)) return { ok: false, error: "BAD_REQUEST", message: "Use at least 8 characters, up to 72 bytes, for your password." };
        if ([DEMO_PASSWORD, DEMO_ADMIN_PASSWORD].includes(password)) return { ok: false, error: "BAD_REQUEST", message: "Choose a password different from the club and settings passwords." };
        let known = findPerson(setup.name);
        if ((setup.id && (!known || setup.id !== known.id)) || (known && (known.active === false || accountHashes[known.id] || accountVersions[known.id] !== setup.version))) return { ok: false, error: "PASSWORD_SETUP_EXPIRED", message: "Your sign-in details changed. Sign in again." };
        if (!known && peopleLocked) return { ok: false, error: "PERSON_NOT_LISTED", message: "Ask an admin to add your name first." };
        if (!known) { addPerson(setup.name); known = findPerson(setup.name); }
        accountHashes[known.id] = bcrypt.hashSync(password, 12);
        accountVersions[known.id] = Math.random().toString(36);
        delete setupTokens[req.setupToken];
        return demoSignIn(known.name, "exec", known);
      }
      case "logout":
        sessions.delete(req.token);
        return { ok: true };
      case "getSettings":
        if (!sessions.has(req.token)) return { ok: false, error: "NOT_LOGGED_IN" };
        if (!String(req.token).startsWith("demo-admin-")) return { ok: false, error: "ADMIN_ONLY" };
        return { ok: true, settings: {
          etransferEmail: "payments@example.com", contactEmail: "club@example.com", instagramUrl: "",
          membershipSheetId: "", membershipTab: "Members", membershipYear: "", membershipFee: 10,
          execPasswordSet: true, adminPasswordSet: true, doorPasswordSet: false, publicSiteUrl: "../public/", peopleLocked
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
      case "previewPeopleImport": case "importPeople": case "resetPersonPassword":
        if (!sessions.has(req.token)) return { ok: false, error: "NOT_LOGGED_IN" };
        return taskReply(req);
      default:
        return { ok: false, error: "UNKNOWN_ACTION" };
    }
  }

  return { handle };
})();

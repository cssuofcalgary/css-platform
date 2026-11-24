/**
 * CSS Platform API — exec tasks (the Tasks tab), replacing the old task tracker sheet.
 *
 * A task is: what, who, when it's due. Everything else has a default. Each task can have updates (typed in the portal or
 * replied on Discord, see Discord.js). Removing a task only hides it: it stays in the sheet, marked removed.
 * Done tasks drop off the list 30 days after they were finished.
 */

const TASK_STATUSES = ["todo", "doing", "blocked", "done"];
const TASK_DEPARTMENTS = ["Events", "Marketing", "Internal", "External", "Finance", "General"];
const TASK_DONE_SHOWN_DAYS = 30;

// ---- Team (who tasks can be given to) ------------------------------------------------------------

function teamView_(r) {
  return { id: r.id, name: r.name, department: TASK_DEPARTMENTS.indexOf(r.department) !== -1 ? r.department : "", discordId: String(r.discordId || ""), active: isOn_(r.active), sort: Number(r.sort) || 0, passwordSet: !!r.passwordHash };
}

/** The whole team list (on and off), in its saved order. */
function taskTeam_() {
  return readRows_("Team").map(teamView_).sort(function (a, b) { return a.sort - b.sort || a.name.localeCompare(b.name); });
}

/** A name as it is compared: any capitals, extra spaces ignored ("  amy   LEE " = "Amy Lee"). */
function teamNameKey_(name) {
  return String(name || "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** The Team row with this name (any capitals or spacing), the active one first. */
function taskTeamByName_(name) {
  const key = teamNameKey_(name);
  if (!key) return null;
  const rows = readRows_("Team").filter(function (r) { return teamNameKey_(r.name) === key; });
  return rows.filter(function (r) { return isOn_(r.active); })[0] || rows[0] || null;
}

function teamNextSort_(rows) {
  return rows.reduce(function (max, r) { return Math.max(max, Number(r.sort) || 0); }, 0) + 1;
}

/** Puts a new person at the end of the People list. Returns the row. Callers check the name isn't there already. */
function teamInsert_(name, department) {
  const row = { id: newId_("TM"), name: memberText_(name, 60), department: TASK_DEPARTMENTS.indexOf(department) !== -1 && department !== "General" ? department : "",
    discordId: "", active: true, sort: teamNextSort_(readRows_("Team")) };
  insertRow_("Team", row);
  return row;
}

/**
 * Signing in with the exec or admin password (not the door one) puts the name on the People list, once: a name already
 * there with other capitals or spacing counts as the same. One read of the list when the name is there already. A new name
 * is added under the script lock (checked again inside it, so two sign-ins at once can't add it twice); if the lock is busy
 * for more than a second, it is skipped (the next sign-in adds it). Never throws: if anything goes wrong, signing in carries on.
 */
function teamAddOnSignIn_(name) {
  try {
    if (peopleLocked_()) return;
    const clean = memberText_(name, 60);
    const key = teamNameKey_(clean);
    if (!key) return;
    const there = function () { return readRows_("Team").some(function (r) { return teamNameKey_(r.name) === key; }); };
    if (there()) return;
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(1000)) return;
    let row = null;
    try {
      delete DB_.rows["Team"];
      if (!peopleLocked_() && !there()) row = teamInsert_(clean, "");
    } finally {
      lock.releaseLock();
    }
    if (row) log_(clean, "person.added", row.id, { name: clean, source: "sign-in" });
  } catch (err) { /* never stops anyone signing in */ }
}

/** Admin (Settings → People): add (no id) or edit one person. Names are unique, ignoring capitals and spacing. */
function savePerson_(session, input) {
  input = input || {};
  const name = memberText_(input.name, 60);
  if (!name) throw new ApiError_("BAD_REQUEST", "Write the person's name.");
  const discordId = String(input.discordId === undefined || input.discordId === null ? "" : input.discordId).replace(/\s+/g, "");
  if (discordId && !/^\d{17,20}$/.test(discordId)) throw new ApiError_("BAD_REQUEST", "The Discord ID for " + name + " should be 17 to 20 digits (or left blank).");
  const department = TASK_DEPARTMENTS.indexOf(input.department) !== -1 ? input.department : "";
  const active = input.active === undefined || input.active === null ? true : (input.active === true || String(input.active).toLowerCase() === "true");
  const id = String(input.id || "");
  return withLock_(function () {
    delete DB_.rows["Team"];
    const rows = readRows_("Team");
    const row = id ? rows.filter(function (r) { return r.id === id; })[0] : null;
    if (id && !row) throw new ApiError_("NOT_FOUND", "That person is no longer on the list. Refresh the page.");
    const key = teamNameKey_(name);
    // Editing a person without changing their name always works, even if the list already had that name twice.
    const sameName = !(row && teamNameKey_(row.name) === key) && rows.filter(function (r) { return r.id !== id && teamNameKey_(r.name) === key; })[0];
    if (sameName) throw new ApiError_("BAD_REQUEST", String(sameName.name).trim() + " is already on the list.");
    const sameDiscord = discordId && rows.filter(function (r) { return r.id !== id && String(r.discordId || "") === discordId; })[0];
    if (sameDiscord) throw new ApiError_("BAD_REQUEST", "That Discord ID is already saved for " + String(sameDiscord.name).trim() + ".");
    const fields = { name: name, department: department, discordId: discordId, active: active };
    let saved;
    if (row) {
      updateRow_("Team", row.id, fields, row._row);
      saved = Object.assign({}, row, fields);
    } else {
      saved = Object.assign({ id: newId_("TM"), sort: teamNextSort_(rows) }, fields);
      insertRow_("Team", saved);
    }
    log_(session.name, "person.saved", saved.id, { name: name, added: !row });
    delete DB_.rows["Team"];
    return { ok: true, person: teamView_(saved), team: taskTeam_() };
  });
}

/** Admin: takes a person off the People list (the row is deleted; tasks keep their owner's name as written). */
function removePerson_(session, id) {
  return withLock_(function () {
    delete DB_.rows["Team"];
    const row = readRows_("Team").filter(function (r) { return r.id === String(id || ""); })[0];
    if (!row) throw new ApiError_("NOT_FOUND", "That person is no longer on the list. Refresh the page.");
    const gone = {};
    gone[row.id] = true;
    deleteTabRows_({ sheet: table_("Team"), header: headerFor_("Team") }, gone);
    delete DB_.rows["Team"];
    bumpTableVersion_("Team");
    log_(session.name, "person.removed", row.id, { name: String(row.name || "").trim() });
    return { ok: true, team: taskTeam_() };
  });
}

/** A Team row's Discord ID when it is a real one, otherwise "". */
function teamDiscordId_(person) {
  const id = String((person && person.discordId) || "");
  return /^\d{17,20}$/.test(id) ? id : "";
}

/** Who to @mention for a task: the Discord ID saved on the task, otherwise the owner's on the Team list. "" = nobody. */
function taskOwnerDiscordId_(task) {
  const saved = String(task.ownerDiscordId || "");
  return /^\d{17,20}$/.test(saved) ? saved : teamDiscordId_(taskTeamByName_(task.owner));
}

/** Older tasks have just owner/ownerDiscordId; keep reading those without a migration. */
function taskAssignees_(task) {
  const saved = taskList_(task.assignees);
  return saved.length ? saved : task.owner ? [{ name: task.owner, discordId: task.ownerDiscordId || "" }] : [];
}

function taskAssigneeDiscordId_(person) {
  return /^\d{17,20}$/.test(String(person.discordId || "")) ? String(person.discordId) : teamDiscordId_(taskTeamByName_(person.name));
}

function taskOwnerDiscordIds_(task) {
  return taskAssignees_(task).map(taskAssigneeDiscordId_).filter(function (id, i, ids) { return id && ids.indexOf(id) === i; });
}

function taskDiscordWho_(task) {
  return taskAssignees_(task).map(function (p) { return discordWho_(p.name, taskAssigneeDiscordId_(p)); }).join(", ") || discordWho_("", "");
}

/** Resolve portal names under the save lock; never accept Discord IDs from the browser. */
function taskResolveAssignees_(names, previous, session, department) {
  const seen = {}, old = taskAssignees_(previous || {});
  return names.map(function (name) { return memberText_(name, 60); }).filter(function (name) {
    const key = teamNameKey_(name);
    if (!key || seen["n:" + key]) return false;
    seen["n:" + key] = true;
    return true;
  }).map(function (name) {
    const person = taskTeamByName_(name);
    const saved = old.filter(function (p) { return teamNameKey_(p.name) === teamNameKey_(name); })[0];
    if (!person) taskAddOwner_(session, name, department);
    return { name: person ? String(person.name).trim() : name, discordId: teamDiscordId_(person) || (saved ? String(saved.discordId || "") : "") };
  });
}

/** Admin: replaces the team list. Rows left out are deleted from the Team tab (tasks keep the person's name). */
function saveTeam_(session, list) {
  if (!Array.isArray(list)) throw new ApiError_("BAD_REQUEST", "Send the team list.");
  if (list.length > 100) throw new ApiError_("BAD_REQUEST", "The team list can have up to 100 people.");
  const clean = [], names = {};
  list.forEach(function (input) {
    input = input || {};
    const name = memberText_(input.name, 60);
    const discordId = String(input.discordId === undefined || input.discordId === null ? "" : input.discordId).replace(/\s+/g, "");
    if (!name) {
      if (discordId) throw new ApiError_("BAD_REQUEST", "Every row with a Discord ID needs a name.");
      return;   // an empty row: skipped
    }
    if (discordId && !/^\d{17,20}$/.test(discordId)) throw new ApiError_("BAD_REQUEST", "The Discord ID for " + name + " should be 17 to 20 digits (or left blank).");
    if (names[name.toLowerCase()]) throw new ApiError_("BAD_REQUEST", name + " is on the list twice.");
    names[name.toLowerCase()] = true;
    const active = input.active === undefined || input.active === null ? true : (input.active === true || String(input.active).toLowerCase() === "true");
    clean.push({ id: String(input.id || ""), name: name, department: TASK_DEPARTMENTS.indexOf(input.department) !== -1 ? input.department : "General", discordId: discordId, active: active });
  });
  // An empty list would wipe the whole Team tab (for example if the page hadn't loaded the team yet): refuse it.
  if (!clean.length) throw new ApiError_("BAD_REQUEST", "The team list can't be empty. Add at least one person.");
  return withLock_(function () {
    delete DB_.rows["Team"];
    const existing = {};
    readRows_("Team").forEach(function (r) { existing[r.id] = r; });
    const keep = {};
    clean.forEach(function (t, i) {
      const fields = { name: t.name, department: t.department, discordId: t.discordId, active: t.active, sort: i + 1 };
      const row = t.id && existing[t.id];
      if (row) { updateRow_("Team", row.id, fields, row._row); keep[row.id] = true; }
      else insertRow_("Team", Object.assign({ id: newId_("TM") }, fields));
    });
    const gone = {};
    Object.keys(existing).forEach(function (id) { if (!keep[id]) gone[id] = true; });
    if (Object.keys(gone).length) {
      deleteTabRows_({ sheet: table_("Team"), header: headerFor_("Team") }, gone);
      delete DB_.rows["Team"];
      bumpTableVersion_("Team");
    }
    log_(session.name, "team.saved", "", { people: clean.length, removed: Object.keys(gone).length });
    delete DB_.rows["Team"];
    return { ok: true, team: taskTeam_() };
  });
}

// ---- Reading tasks -------------------------------------------------------------------------------

function taskUpdateView_(u) {
  return { id: u.id, taskId: u.taskId, text: String(u.text || "").replace(/^'/, ""), by: u.by, source: u.source || "portal", status: u.status || "", createdAt: u.createdAt };
}

/** A task as the portal sees it, with its updates (newest first) and when its next reminder goes out. */
function taskView_(t, updates) {
  const next = taskNextReminder_(t, Date.now());
  return {
    id: t.id, title: t.title, department: t.department || "General", owner: t.owner || "", owners: taskAssignees_(t).map(function (p) { return p.name; }), status: TASK_STATUSES.indexOf(t.status) !== -1 ? t.status : "todo",
    due: t.due || "", notes: String(t.notes || "").replace(/^'/, ""), link: t.link || "",
    remind: taskReminderItems_(t), reminders: taskRemindersView_(t), nextReminder: next ? taskStamp_(next) : "",
    createdBy: t.createdBy, createdAt: t.createdAt, updatedBy: t.updatedBy || "", updatedAt: t.updatedAt || "", doneAt: t.doneAt || "",
    discordMessageId: String(t.discordMessageId || ""),
    updates: (updates || []).slice().sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); }).map(taskUpdateView_)
  };
}

function taskUpdatesOf_(taskId) {
  return readRows_("TaskUpdates").filter(function (u) { return u.taskId === taskId; });
}

/** Exec: the task list. Reads new Discord replies first (best effort: Discord trouble shows as a warning, never an error). */
function listTasks_(session) {
  const sync = syncDiscordReplies_();
  const setup = discordSetup_();
  const byTask = {};
  readRows_("TaskUpdates").forEach(function (u) { (byTask[u.taskId] = byTask[u.taskId] || []).push(u); });
  const cutoff = Date.now() - TASK_DONE_SHOWN_DAYS * 86400000;
  const tasks = readRows_("Tasks").filter(function (t) {
    if (t.removedAt) return false;
    return !(t.status === "done" && t.doneAt && Date.parse(t.doneAt) < cutoff);
  }).map(function (t) { return taskView_(t, byTask[t.id]); })
    .sort(function (a, b) { return (a.due || "9999") .localeCompare(b.due || "9999") || String(a.createdAt).localeCompare(String(b.createdAt)); });
  return {
    ok: true, tasks: tasks, team: taskTeam_(),
    discord: { ready: setup.posting && setup.reading, posting: setup.posting, reading: setup.reading, synced: sync.synced, error: sync.error }
  };
}

// ---- Changing tasks -------------------------------------------------------------------------------

/**
 * The columns that change with a status: doneAt is set when it becomes done and cleared otherwise. A task taken out of
 * Done has the reminders whose time came while it was done marked as sent, so they don't all go out at once.
 */
function taskStatusChanges_(task, status, by) {
  const now = new Date().toISOString();
  const changes = { status: status, doneAt: status === "done" ? (task.status === "done" && task.doneAt ? task.doneAt : now) : "", updatedBy: by, updatedAt: now };
  if (task.status === "done" && status !== "done") changes.remindSent = taskSettledReminders_(Object.assign({}, task, changes), Date.now(), 0);
  return changes;
}

function taskCleanStatus_(value) {
  const status = String(value || "").toLowerCase();
  if (TASK_STATUSES.indexOf(status) === -1) throw new ApiError_("BAD_REQUEST", "Pick a status: To do, Doing, Blocked or Done.");
  return status;
}

function taskCleanDue_(value) {
  const due = String(value || "").trim();
  if (!due) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(due);
  if (!m || !ymdOf_(Number(m[1]), Number(m[2]), Number(m[3]))) throw new ApiError_("BAD_REQUEST", "That due date isn't a real date. Pick one, or No date.");
  return due;
}

/**
 * The reminders sent with a save: a list of up to 5 { n: 0-60, unit: "days"|"weeks", at: "HH:MM" } ([] = none). An older
 * page's word ("halfway", "daybefore", "both") or day is still accepted and kept as it is (it is read as the same list).
 */
function taskCleanRemind_(value) {
  if (value === undefined || value === null || value === "") return [];
  if (typeof value === "string") {
    const word = value.trim().toLowerCase();
    if (!word || word === "none") return [];
    if (["halfway", "daybefore", "both"].indexOf(word) !== -1) return word;
    if (isYmd_(word)) return taskCleanDue_(word);
    throw new ApiError_("BAD_REQUEST", "Each reminder needs a number from 0 to 60, days or weeks, and a time.");
  }
  if (!Array.isArray(value)) throw new ApiError_("BAD_REQUEST", "Each reminder needs a number from 0 to 60, days or weeks, and a time.");
  if (value.length > TASK_REMINDERS_MAX) throw new ApiError_("BAD_REQUEST", "A task can have up to " + TASK_REMINDERS_MAX + " reminders.");
  const items = value.map(taskReminderItem_);
  if (items.some(function (x) { return !x; })) throw new ApiError_("BAD_REQUEST", "Each reminder needs a number from 0 to 60, days or weeks, and a time.");
  return taskReminderDedupe_(items);
}

function taskCleanLink_(value) {
  const link = memberText_(value, 500);
  if (!link) return "";
  return /^https?:\/\//i.test(link) ? link : "https://" + link;
}

/** A new Tasks row. f: { title, owner, ownerDiscordId, due, department, status, notes, link, remind, by, discordMessageId, now (Date) }. */
function taskNewRow_(f) {
  const now = (f.now || new Date()).toISOString();
  const row = {
    id: newId_("TK"), title: memberText_(f.title, 140), department: f.department || "General", owner: memberText_(f.owner, 60),
    ownerDiscordId: /^\d{17,20}$/.test(String(f.ownerDiscordId || "")) ? String(f.ownerDiscordId) : "", assignees: f.assignees || [], status: f.status || "todo",
    due: f.due || "", notes: f.notes || "", link: f.link || "", remind: f.remind || [], remindSent: [], discordRefs: [],
    createdBy: f.by, createdAt: now, updatedBy: f.by, updatedAt: now, doneAt: f.status === "done" ? now : "",
    discordMessageId: f.discordMessageId || "", removedAt: "", removedBy: ""
  };
  row.remindSent = taskSettledReminders_(row, Date.now());
  return row;
}

/** CALL WHILE HOLDING THE SCRIPT LOCK. A task given to someone not on the People list adds them (department: the task's, unless General). */
function taskAddOwner_(session, name, department) {
  if (peopleLocked_()) return null;
  const row = teamInsert_(name, department);
  log_(session.name, "person.added", row.id, { name: name, source: "task" });
  return row;
}

/** Re-reads one task inside the lock. Throws when it's gone or removed. */
function taskFresh_(id) {
  delete DB_.rows["Tasks"];
  const task = readRows_("Tasks").filter(function (t) { return t.id === String(id || ""); })[0];
  if (!task || task.removedAt) throw new ApiError_("NOT_FOUND", "That task is no longer there. Refresh the list.");
  return task;
}

/**
 * Exec: add (no id) or edit a task. A new task is posted to Discord #tasks after it is saved, outside any lock; Discord
 * failing never fails the save (discordPosted says whether it went out). The status is only read for a new task: editing
 * never changes it (the status pill and updates do that).
 */
function saveTask_(session, input) {
  input = input || {};
  const has = function (k) { return input[k] !== undefined && input[k] !== null; };
  const editing = !!input.id;
  const clean = {};
  if (!editing || has("title")) {
    const raw = String(input.title || "").replace(/\s+/g, " ").trim();
    const title = memberText_(raw, 140);
    if (!title || raw.length > 140) throw new ApiError_("BAD_REQUEST", "Write what needs doing (up to 140 characters).");
    clean.title = title;
  }
  const assigning = !editing || has("owners") || has("owner");
  if (has("owners") && (!Array.isArray(input.owners) || input.owners.length > 200 || input.owners.some(function (n) { return typeof n !== "string"; }))) {
    throw new ApiError_("BAD_REQUEST", "Choose the people assigned to this task.");
  }
  const names = has("owners") ? input.owners : [String(input.owner || "")];
  if (assigning) clean.owner = memberText_(names[0], 60);
  if (!editing || has("due")) clean.due = taskCleanDue_(input.due);
  if (!editing) clean.status = has("status") && input.status !== "" ? taskCleanStatus_(input.status) : "todo";
  if (!editing || has("notes")) clean.notes = noteText_(String(input.notes || "").slice(0, 2000));
  if (!editing || has("link")) clean.link = taskCleanLink_(input.link);
  if (!editing || has("remind")) clean.remind = taskCleanRemind_(input.remind);
  const department = TASK_DEPARTMENTS.indexOf(input.department) !== -1 ? input.department : "";

  if (!editing) {
    const task = withLock_(function () {   // the lock keeps NEXT_TASK_REMINDER (and the People list) right when two changes happen at once
      delete DB_.rows["Team"];
      const owner = taskTeamByName_(clean.owner);
      clean.department = department || (owner && TASK_DEPARTMENTS.indexOf(owner.department) !== -1 ? owner.department : "General");
      clean.assignees = taskResolveAssignees_(names, null, session, clean.department);
      clean.owner = clean.assignees.length ? clean.assignees[0].name : "";
      clean.ownerDiscordId = clean.assignees.length ? clean.assignees[0].discordId : "";
      const row = taskNewRow_(Object.assign({ by: memberText_(session.name, 80) }, clean));
      insertRow_("Tasks", row);
      refreshNextReminder_();
      return row;
    });
    log_(session.name, "task.created", task.id, { title: task.title, owner: task.owner, due: task.due });
    // Discord, after the save and outside any lock.
    const post = discordSend_(discordTaskMessage_(task, task.ownerDiscordId), taskOwnerDiscordIds_(task));
    if (post.ok && post.id) {
      try { withLock_(function () { updateRow_("Tasks", task.id, { discordMessageId: post.id }); }); task.discordMessageId = post.id; }
      catch (err) { console.error("Posted to Discord but couldn't save its id: " + discordSafeError_(err)); }
    }
    return { ok: true, task: taskView_(task, []), discordPosted: !!post.ok };
  }

  return withLock_(function () {
    const task = taskFresh_(input.id);
    const changes = Object.assign({}, clean);
    delete DB_.rows["Team"];
    const owner = taskTeamByName_(assigning ? clean.owner : task.owner);
    changes.department = department || (input.department === undefined && task.department) || (owner && TASK_DEPARTMENTS.indexOf(owner.department) !== -1 ? owner.department : "General");
    if (assigning) {
      changes.assignees = taskResolveAssignees_(names, task, session, changes.department);
      changes.owner = changes.assignees.length ? changes.assignees[0].name : "";
      changes.ownerDiscordId = changes.assignees.length ? changes.assignees[0].discordId : "";
    }
    changes.updatedBy = session.name;
    changes.updatedAt = new Date().toISOString();
    const after = Object.assign({}, task, changes);
    if (JSON.stringify(after.remind) !== JSON.stringify(task.remind) || after.due !== task.due) changes.remindSent = after.remindSent = taskSettledReminders_(after, Date.now());
    updateRow_("Tasks", task.id, changes, task._row);
    log_(session.name, "task.updated", task.id, { title: after.title, owner: after.owner, due: after.due, status: after.status });
    refreshNextReminder_();
    return { ok: true, task: taskView_(after, taskUpdatesOf_(task.id)), discordPosted: false };
  });
}

/** Exec: one tap on the status pill. Also adds an update row saying what it was set to. */
function setTaskStatus_(session, id, status) {
  status = taskCleanStatus_(status);
  return withLock_(function () {
    const task = taskFresh_(id);
    if (task.status === status) return { ok: true, task: taskView_(task, taskUpdatesOf_(task.id)) };
    const changes = taskStatusChanges_(task, status, session.name);
    updateRow_("Tasks", task.id, changes, task._row);
    insertRow_("TaskUpdates", { id: newId_("TU"), taskId: task.id, text: "", by: memberText_(session.name, 80), source: "portal", status: status, createdAt: changes.updatedAt, discordMessageId: "" });
    log_(session.name, "task.status", task.id, { title: task.title, status: status, was: task.status });
    refreshNextReminder_();
    return { ok: true, task: taskView_(Object.assign({}, task, changes), taskUpdatesOf_(task.id)) };
  });
}

/** Exec: "Add an update" (optionally also changing the status). */
function addTaskUpdate_(session, id, text, status) {
  const raw = String(text === undefined || text === null ? "" : text).trim();
  if (!raw || raw.length > 1000) throw new ApiError_("BAD_REQUEST", "Write an update of up to 1000 characters.");
  const clean = noteText_(raw);
  if (!clean) throw new ApiError_("BAD_REQUEST", "Write an update of up to 1000 characters.");
  const newStatus = status ? taskCleanStatus_(status) : "";
  return withLock_(function () {
    const task = taskFresh_(id);
    const setStatus = newStatus && newStatus !== task.status ? newStatus : "";
    const now = new Date().toISOString();
    const update = { id: newId_("TU"), taskId: task.id, text: clean, by: memberText_(session.name, 80), source: "portal", status: setStatus, createdAt: now, discordMessageId: "" };
    insertRow_("TaskUpdates", update);
    const changes = setStatus ? taskStatusChanges_(task, setStatus, session.name) : { updatedBy: session.name, updatedAt: now };
    updateRow_("Tasks", task.id, changes, task._row);
    log_(session.name, "task.updated", task.id, { title: task.title, updateId: update.id, status: setStatus || undefined });
    if (setStatus) refreshNextReminder_();
    return { ok: true, update: taskUpdateView_(update), task: taskView_(Object.assign({}, task, changes), taskUpdatesOf_(task.id)) };
  });
}

/** Exec: anyone signed in can remove a task. It is kept in the sheet, marked removed. */
function removeTask_(session, id) {
  return withLock_(function () {
    const task = taskFresh_(id);
    updateRow_("Tasks", task.id, { removedAt: new Date().toISOString(), removedBy: session.name }, task._row);
    log_(session.name, "task.removed", task.id, { title: task.title });
    refreshNextReminder_();
    return { ok: true };
  });
}

/**
 * Exec: "Remind on Discord". ONE message listing the open tasks that are overdue, due within 7 days, or blocked, each
 * owner mentioned. { ok, posted, count } (plus error, in plain words, when it couldn't post).
 */
function remindTasksOnDiscord_(session) {
  const today = edmParts_(Date.now()).ymd;
  const soon = ymdAdd_(today, 7);
  const list = readRows_("Tasks").filter(function (t) {
    if (t.removedAt || t.status === "done") return false;
    return t.status === "blocked" || (t.due && t.due <= soon);
  }).sort(function (a, b) { return (a.due || "9999").localeCompare(b.due || "9999"); });
  if (!list.length) return { ok: true, posted: false, count: 0 };
  const ids = [];   // Only assigned people may be pinged.
  const lines = list.map(function (t) {
    taskOwnerDiscordIds_(t).forEach(function (id) { ids.push(id); });
    let when = "no due date";
    if (t.due && t.due < today) {
      const days = Math.round((edmAt_(today, 12, 0) - edmAt_(t.due, 12, 0)) / 86400000);
      when = "overdue " + days + "d";
    } else if (t.due === today) when = "due today";
    else if (t.due) when = "due " + taskDayText_(t.due);
    return "• **" + discordEscape_(t.title) + "** — " + taskDiscordWho_(t) + " · " + when + (t.status === "blocked" ? " · ⛔ blocked" : "");
  });
  let content = "⏰ **Task check-in** — reply to each task's own message with how it's going.";
  let shown = 0;
  for (let i = 0; i < lines.length; i++) {
    const more = "\n…and " + (lines.length - i) + " more";
    if ((content + "\n" + lines[i]).length + more.length > 1900) { content += more; break; }
    content += "\n" + lines[i];
    shown++;
  }
  const post = discordSend_(content, ids.slice(0, shown));   // only people whose line made it into the message are pinged
  log_(session.name, "task.remind", "", { count: list.length, posted: !!post.ok });
  const out = { ok: true, posted: !!post.ok, count: list.length };
  if (!post.ok) out.error = post.error;
  return out;
}

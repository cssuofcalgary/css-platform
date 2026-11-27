/**
 * CSS Platform API — exec tasks (the Tasks tab), replacing the old task tracker sheet.
 *
 * A task is: what, who, when it's due. Everything else has a default. Each task can have updates (typed in the portal or
 * replied on Discord, see Discord.js). Removing a task only hides it: it stays in the sheet, marked removed.
 * Done tasks drop off the list 30 days after they were finished.
 */

const TASK_STATUSES = ["todo", "doing", "blocked", "done"];
const TASK_PRIORITIES = ["urgent", "high", "normal", "low"];
const TASK_DEPARTMENTS_BUILT_IN = ["Events", "Marketing", "Internal", "External", "Finance"];   // always there; General is always last
const TASK_DEPARTMENTS_ADDED_MAX = 20;
const TASK_PERSON_DEPARTMENTS_MAX = 10;
const TASK_DONE_SHOWN_DAYS = 30;

// ---- Departments: the five built in, the ones added in Settings → People, then General ----------------

/** The departments added in Settings → People (Script Property TASK_DEPARTMENTS_EXTRA, a JSON list of names). */
function taskAddedDepartments_() {
  let list = [];
  try { list = JSON.parse(PropertiesService.getScriptProperties().getProperty("TASK_DEPARTMENTS_EXTRA") || "[]"); } catch (e) { list = []; }
  return Array.isArray(list) ? list.map(function (d) { return memberText_(d, 24); }).filter(Boolean) : [];
}

/** Every department, in order. */
function taskDepartments_() {
  return TASK_DEPARTMENTS_BUILT_IN.concat(taskAddedDepartments_(), ["General"]);
}

/** A department as the list spells it ("events" = "Events"), or "" when it isn't one. depts: taskDepartments_(), read once by the caller. */
function taskDepartmentName_(value, depts) {
  const key = teamNameKey_(value);
  return key ? (depts || taskDepartments_()).filter(function (d) { return d.toLowerCase() === key; })[0] || "" : "";
}

/** A person's departments (still on the list), the first one first. Older rows have just one, in the department column. */
function teamDepartmentsOf_(r, depts) {
  const saved = taskList_(r && r.departments);
  const out = [];
  (saved.length ? saved : r && r.department ? [r.department] : []).forEach(function (d) {
    const name = taskDepartmentName_(d, depts);
    if (name && out.indexOf(name) === -1) out.push(name);
  });
  return out;
}

/** The department a task gets from the person it's given to: their first one, otherwise General. */
function teamTaskDepartment_(r, depts) {
  return teamDepartmentsOf_(r, depts)[0] || "General";
}

/** Admin (Settings → People): adds a department of the club's own. */
function addDepartment_(session, name) {
  const raw = String(name === undefined || name === null ? "" : name).replace(/\s+/g, " ").trim();
  const clean = memberText_(raw, 24);
  if (!clean || raw.length > 24) throw new ApiError_("BAD_REQUEST", "Write the department's name (up to 24 characters).");
  if (/[,"]/.test(clean)) throw new ApiError_("BAD_REQUEST", "A department's name can't have a comma or quote marks in it.");
  if (["everyone", "mine", "all", "my tasks"].indexOf(clean.toLowerCase()) !== -1) throw new ApiError_("BAD_REQUEST", "\"" + clean + "\" can't be a department's name. Pick another name.");
  return withLock_(function () {
    const added = taskAddedDepartments_();
    const same = taskDepartmentName_(clean);
    if (same) throw new ApiError_("BAD_REQUEST", same + " is already a department.");
    if (added.length >= TASK_DEPARTMENTS_ADDED_MAX) throw new ApiError_("BAD_REQUEST", "You can add up to " + TASK_DEPARTMENTS_ADDED_MAX + " departments. Remove one you no longer use first.");
    added.push(clean);
    PropertiesService.getScriptProperties().setProperty("TASK_DEPARTMENTS_EXTRA", JSON.stringify(added));
    log_(session.name, "department.added", "", { name: clean });
    return { ok: true, departments: taskDepartments_(), team: taskTeam_() };
  });
}

/**
 * Admin: removes a department that was added in Settings → People (the five built in stay). People keep their other
 * departments, and tasks keep the department name they were saved with. Adding the same name again brings it back for
 * the people who had it.
 */
function removeDepartment_(session, name) {
  const key = teamNameKey_(name);
  if (TASK_DEPARTMENTS_BUILT_IN.concat(["General"]).some(function (d) { return d.toLowerCase() === key; })) {
    throw new ApiError_("BAD_REQUEST", "The main departments can't be removed. Only ones that were added can.");
  }
  return withLock_(function () {
    const added = taskAddedDepartments_();
    const left = added.filter(function (d) { return d.toLowerCase() !== key; });
    if (!key || left.length === added.length) throw new ApiError_("NOT_FOUND", "That department is no longer there. Refresh the page.");
    PropertiesService.getScriptProperties().setProperty("TASK_DEPARTMENTS_EXTRA", JSON.stringify(left));
    log_(session.name, "department.removed", "", { name: added.filter(function (d) { return d.toLowerCase() === key; })[0] });
    return { ok: true, departments: taskDepartments_(), team: taskTeam_() };
  });
}

// ---- Team (who tasks can be given to) ------------------------------------------------------------

function teamView_(r, depts) {
  const departments = teamDepartmentsOf_(r, depts);
  return { id: r.id, name: r.name, department: departments[0] || "", departments: departments, discordId: String(r.discordId || ""), active: isOn_(r.active), sort: Number(r.sort) || 0, passwordSet: !!r.passwordHash };
}

/** The whole team list (on and off), in its saved order. */
function taskTeam_() {
  const depts = taskDepartments_();
  return readRows_("Team").map(function (r) { return teamView_(r, depts); }).sort(function (a, b) { return a.sort - b.sort || a.name.localeCompare(b.name); });
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
  const dept = taskDepartmentName_(department);
  const row = { id: newId_("TM"), name: memberText_(name, 60), department: dept !== "General" ? dept : "", departments: dept && dept !== "General" ? [dept] : [],
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

/**
 * Admin (Settings → People): add (no id) or edit one person. Names are unique, ignoring capitals and spacing.
 * departments: the person's departments, the first one first (an older page sends one department). Unknown ones are left out.
 */
function savePerson_(session, input) {
  input = input || {};
  const name = memberText_(input.name, 60);
  if (!name) throw new ApiError_("BAD_REQUEST", "Write the person's name.");
  const discordId = String(input.discordId === undefined || input.discordId === null ? "" : input.discordId).replace(/\s+/g, "");
  if (discordId && !/^\d{17,20}$/.test(discordId)) throw new ApiError_("BAD_REQUEST", "The Discord ID for " + name + " should be 17 to 20 digits (or left blank).");
  const wanted = Array.isArray(input.departments) ? input.departments : input.department ? [input.department] : [];
  if (wanted.length > TASK_PERSON_DEPARTMENTS_MAX || wanted.some(function (d) { return typeof d !== "string"; })) {
    throw new ApiError_("BAD_REQUEST", "A person can be in up to " + TASK_PERSON_DEPARTMENTS_MAX + " departments.");
  }
  const departments = teamDepartmentsOf_({ departments: wanted }, taskDepartments_());
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
    const fields = { name: name, department: departments[0] || "", departments: departments, discordId: discordId, active: active };
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
    return { ok: true, person: teamView_(saved, taskDepartments_()), team: taskTeam_() };
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

/**
 * The assignees still to do it. A task given to everyone (or a department) has a checklist line with each person's name:
 * people who have ticked their name are left out of Discord pings and reminders. When every name is ticked (but the
 * task isn't Done yet), all of them, as for any other task.
 */
function taskAssigneesToDo_(task) {
  const people = taskAssignees_(task);
  const ticked = {};
  taskChecklistOf_(task).forEach(function (c) { if (c.done) ticked[teamNameKey_(c.text)] = true; });
  const left = people.filter(function (p) { return !ticked[teamNameKey_(p.name)]; });
  return left.length ? left : people;
}

/**
 * CALL WHILE HOLDING THE SCRIPT LOCK (or inside the Discord read). An assignee saying "done" on a task with their name in
 * the checklist ticks their name instead of finishing the task for everyone (saying it again changes nothing).
 * Returns { checklist, changed, allDone }, or null when their name isn't in the checklist (then "done" finishes the
 * task, as before).
 */
function taskTickName_(task, name) {
  const key = teamNameKey_(name);
  if (!key || !taskAssignees_(task).some(function (p) { return teamNameKey_(p.name) === key; })) return null;
  const list = taskChecklistOf_(task);
  const lines = list.filter(function (c) { return teamNameKey_(c.text) === key; });
  if (!lines.length) return null;
  const changed = lines.some(function (c) { return !c.done; });
  lines.forEach(function (c) { c.done = true; });
  return { checklist: list, changed: changed, allDone: list.every(function (c) { return c.done; }) };
}

function taskOwnerDiscordIds_(task) {
  return taskAssigneesToDo_(task).map(taskAssigneeDiscordId_).filter(function (id, i, ids) { return id && ids.indexOf(id) === i; });
}

function taskDiscordWho_(task) {
  return taskAssigneesToDo_(task).map(function (p) { return discordWho_(p.name, taskAssigneeDiscordId_(p)); }).join(", ") || discordWho_("", "");
}

/** Resolve portal names under the save lock; never accept Discord IDs from the browser. Saved A to Z. */
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
  }).sort(function (a, b) { return teamNameKey_(a.name).localeCompare(teamNameKey_(b.name)); });
}

/** Admin: replaces the team list. Rows left out are deleted from the Team tab (tasks keep the person's name). */
function saveTeam_(session, list) {
  if (!Array.isArray(list)) throw new ApiError_("BAD_REQUEST", "Send the team list.");
  if (list.length > 100) throw new ApiError_("BAD_REQUEST", "The team list can have up to 100 people.");
  const clean = [], names = {}, depts = taskDepartments_();
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
    const departments = teamDepartmentsOf_({ departments: Array.isArray(input.departments) ? input.departments.slice(0, TASK_PERSON_DEPARTMENTS_MAX) : [], department: input.department }, depts);
    clean.push({ id: String(input.id || ""), name: name, department: departments[0] || "General", departments: departments, discordId: discordId, active: active });
  });
  // An empty list would wipe the whole Team tab (for example if the page hadn't loaded the team yet): refuse it.
  if (!clean.length) throw new ApiError_("BAD_REQUEST", "The team list can't be empty. Add at least one person.");
  return withLock_(function () {
    delete DB_.rows["Team"];
    const existing = {};
    readRows_("Team").forEach(function (r) { existing[r.id] = r; });
    const keep = {};
    clean.forEach(function (t, i) {
      const fields = { name: t.name, department: t.department, departments: t.departments, discordId: t.discordId, active: t.active, sort: i + 1 };
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
    checklist: taskChecklistOf_(t), labels: taskLabelsOf_(t), priority: TASK_PRIORITIES.indexOf(t.priority) !== -1 ? t.priority : "normal",
    remind: taskReminderItems_(t), reminders: taskRemindersView_(t), nextReminder: next ? taskStamp_(next) : "",
    createdBy: t.createdBy, createdAt: t.createdAt, updatedBy: t.updatedBy || "", updatedAt: t.updatedAt || "", doneAt: t.doneAt || "",
    discordMessageId: String(t.discordMessageId || ""),
    // Newest first; two at the same moment: the one added later first.
    updates: (updates || []).map(function (u, i) { return { u: u, i: i }; }).sort(function (a, b) { return String(b.u.createdAt).localeCompare(String(a.u.createdAt)) || b.i - a.i; })
      .map(function (x) { return taskUpdateView_(x.u); })
  };
}

function taskUpdatesOf_(taskId) {
  return readRows_("TaskUpdates").filter(function (u) { return u.taskId === taskId; });
}

/** Exec: the task list. Reads new Discord replies first (best effort: Discord trouble shows as a warning, never an error). */
function listTasks_(session) {
  // When the task bot's 1-minute timer is running it already reads Discord, so the list doesn't wait on Discord (or the lock).
  const tick = Date.parse(String(PropertiesService.getScriptProperties().getProperty("TASKBOT_LAST_TICK") || ""));
  const botRunning = !isNaN(tick) && Date.now() - tick < TASKBOT_ALIVE_MS;
  const sync = botRunning ? { synced: 0, error: "" } : syncDiscordReplies_();
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
    ok: true, tasks: tasks, team: taskTeam_(), departments: taskDepartments_(),
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

/** Blank on older tasks means Normal; the browser may send a priority only when it changes. */
function taskCleanPriority_(value) {
  if (value !== undefined && value !== null && typeof value !== "string") throw new ApiError_("BAD_REQUEST", "Pick a priority: Urgent, High, Normal or Low.");
  const priority = String(value === undefined || value === null ? "" : value).trim().toLowerCase() || "normal";
  if (TASK_PRIORITIES.indexOf(priority) === -1) throw new ApiError_("BAD_REQUEST", "Pick a priority: Urgent, High, Normal or Low.");
  return priority;
}

function taskPriorityText_(task) {
  return task.priority === "urgent" ? "🔴 Urgent" : task.priority === "high" ? "🟠 High" : "";
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

const TASK_CHECKLIST_MAX = 60;   // room for a line per person on a task given to everyone
const TASK_LABELS_MAX = 6;

/** The saved checklist as [{ id, text, done }] (anything odd in the cell is skipped). */
function taskChecklistOf_(task) {
  return taskList_(task.checklist).filter(function (x) { return x && typeof x === "object" && String(x.text || "").trim(); }).map(function (x) {
    return { id: String(x.id || ""), text: String(x.text).replace(/^'/, ""), done: x.done === true || String(x.done).toLowerCase() === "true" };
  });
}

/** The saved labels as a list of words. */
function taskLabelsOf_(task) {
  return taskList_(task.labels).map(function (l) { return String(l || "").trim(); }).filter(Boolean);
}

/** A checklist sent with a save: up to 60 items of up to 200 characters. Items without an id get one. */
function taskCleanChecklist_(value) {
  if (value === undefined || value === null || value === "") return [];
  if (!Array.isArray(value) || value.length > TASK_CHECKLIST_MAX) throw new ApiError_("BAD_REQUEST", "A checklist can have up to " + TASK_CHECKLIST_MAX + " items.");
  const seen = {};
  return value.map(function (x) {
    x = x && typeof x === "object" ? x : { text: x };
    const raw = String(x.text === undefined || x.text === null ? "" : x.text).replace(/\s+/g, " ").trim();
    if (raw.length > 200) throw new ApiError_("BAD_REQUEST", "Keep each checklist item under 200 characters.");
    const text = memberText_(raw, 200);
    if (!text) return null;
    let id = /^[A-Za-z0-9_-]{1,24}$/.test(String(x.id || "")) ? String(x.id) : "";
    if (!id || seen[id]) id = newId_("CK");
    seen[id] = true;
    return { id: id, text: text, done: x.done === true };
  }).filter(Boolean);
}

/** Labels sent with a save: up to 6 short words, each once (any capitals). */
function taskCleanLabels_(value) {
  if (value === undefined || value === null || value === "") return [];
  if (!Array.isArray(value)) throw new ApiError_("BAD_REQUEST", "Choose the labels again.");
  const seen = {}, out = [];
  value.forEach(function (l) {
    const raw = String(l === undefined || l === null ? "" : l).replace(/\s+/g, " ").trim();
    if (raw.length > 24) throw new ApiError_("BAD_REQUEST", "Keep each label under 24 characters.");
    const label = memberText_(raw, 24);
    if (!label || seen[label.toLowerCase()]) return;
    seen[label.toLowerCase()] = true;
    out.push(label);
  });
  if (out.length > TASK_LABELS_MAX) throw new ApiError_("BAD_REQUEST", "A task can have up to " + TASK_LABELS_MAX + " labels.");
  return out;
}

/** A new Tasks row. f: { title, owner, ownerDiscordId, due, department, status, notes, link, remind, by, discordMessageId, now (Date) }. */
function taskNewRow_(f) {
  const now = (f.now || new Date()).toISOString();
  const row = {
    id: newId_("TK"), title: memberText_(f.title, 140), department: f.department || "General", owner: memberText_(f.owner, 60),
    ownerDiscordId: /^\d{17,20}$/.test(String(f.ownerDiscordId || "")) ? String(f.ownerDiscordId) : "", assignees: f.assignees || [], status: f.status || "todo",
    due: f.due || "", notes: f.notes || "", link: f.link || "", remind: f.remind || [], remindSent: [], discordRefs: [],
    checklist: f.checklist || [], labels: f.labels || [], priority: taskCleanPriority_(f.priority),
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
 * failing never fails the save (discordPosted says whether it went out). Editing can change the status too (the task
 * window saves everything with one press of Save); a changed status adds one "set it to …" line, like the status pill.
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
  if (!editing || has("checklist")) clean.checklist = taskCleanChecklist_(input.checklist);
  if (!editing || has("labels")) clean.labels = taskCleanLabels_(input.labels);
  if (!editing || has("priority")) clean.priority = taskCleanPriority_(input.priority);
  const newStatus = editing && has("status") && input.status !== "" ? taskCleanStatus_(input.status) : "";
  const depts = taskDepartments_();
  const department = taskDepartmentName_(input.department, depts);

  if (!editing) {
    // The page names a new task itself (saved in the background, and sent again if the connection dropped): the same name
    // twice is the same task, so a repeat never adds it twice.
    const clientId = /^TK[A-Za-z0-9_-]{8,40}$/.test(String(input.clientId || "")) ? String(input.clientId) : "";
    let repeat = null;
    const task = withLock_(function () {   // the lock keeps NEXT_TASK_REMINDER (and the People list) right when two changes happen at once
      if (clientId) {
        delete DB_.rows["Tasks"];
        repeat = readRows_("Tasks").filter(function (t) { return t.id === clientId; })[0] || null;
        if (repeat) return repeat;
      }
      delete DB_.rows["Team"];
      const owner = taskTeamByName_(clean.owner);
      clean.department = department || teamTaskDepartment_(owner, depts);
      clean.assignees = taskResolveAssignees_(names, null, session, clean.department);
      clean.owner = clean.assignees.length ? clean.assignees[0].name : "";
      clean.ownerDiscordId = clean.assignees.length ? clean.assignees[0].discordId : "";
      const row = taskNewRow_(Object.assign({ by: memberText_(session.name, 80) }, clean));
      if (clientId) row.id = clientId;
      insertRow_("Tasks", row);
      refreshNextReminder_();
      return row;
    });
    if (repeat) return { ok: true, task: taskView_(repeat, taskUpdatesOf_(repeat.id)), discordPosted: !!repeat.discordMessageId, repeated: true };
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
    // A department that was removed from the list since: the task keeps it while the page sends it back unchanged.
    const kept = input.department && task.department && teamNameKey_(input.department) === teamNameKey_(task.department) ? task.department : "";
    changes.department = department || kept || (input.department === undefined && task.department) || teamTaskDepartment_(owner, depts);
    if (assigning) {
      changes.assignees = taskResolveAssignees_(names, task, session, changes.department);
      changes.owner = changes.assignees.length ? changes.assignees[0].name : "";
      changes.ownerDiscordId = changes.assignees.length ? changes.assignees[0].discordId : "";
    }
    // from: the status the page showed. Someone else changed it since: their status stays (the rest still saves).
    const stale = !!(newStatus && has("from") && input.from !== "" && TASK_STATUSES.indexOf(String(input.from)) !== -1 && String(input.from) !== task.status);
    const statusChanged = newStatus && newStatus !== task.status && !stale;
    if (statusChanged) Object.assign(changes, taskStatusChanges_(task, newStatus, session.name));
    changes.updatedBy = session.name;
    changes.updatedAt = new Date().toISOString();
    const after = Object.assign({}, task, changes);
    if (JSON.stringify(after.remind) !== JSON.stringify(task.remind) || after.due !== task.due) changes.remindSent = after.remindSent = taskSettledReminders_(after, Date.now());
    updateRow_("Tasks", task.id, changes, task._row);
    if (statusChanged) taskRecordStatus_(task.id, newStatus, session.name, changes.updatedAt);
    log_(session.name, "task.updated", task.id, { title: after.title, owner: after.owner, due: after.due, status: after.status });
    refreshNextReminder_();
    const out = { ok: true, task: taskView_(after, taskUpdatesOf_(task.id)), discordPosted: false };
    if (stale) out.stale = true;
    return out;
  });
}

/**
 * Exec: quick add. One line ("make reel by friday @Kevin urgent") read like a message to @taskbot (parseQuickTask_), then
 * saved exactly like New task through saveTask_ (the lock, new names joining People, the page-made clientId so a repeat
 * adds it once, and the Discord post). Nobody @mentioned: it is given to the person adding it.
 * Reply: saveTask_'s, plus quick: what was understood { title, owners, due, priority, remindNeedsDue }.
 */
function quickAddTask_(session, text, clientId) {
  const raw = typeof text === "string" ? text.trim() : "";
  if (!raw || raw.length > 300) throw new ApiError_("BAD_REQUEST", "Write what needs doing (up to 300 characters).");
  const team = readRows_("Team");
  const parsed = parseQuickTask_(raw, new Date(), team);
  if (!parsed.title) throw new ApiError_("BAD_REQUEST", "Write what needs doing.");
  if (parsed.titleTooLong) throw new ApiError_("BAD_REQUEST", "Keep what needs doing under 140 characters.");
  let owners = parsed.owners;
  if (!owners.length) {
    const me = (session.personId && team.filter(function (r) { return r.id === session.personId; })[0]) || taskTeamByName_(session.name);
    owners = [me ? String(me.name).trim() : memberText_(session.name, 60)];
  }
  const reply = saveTask_(session, { title: parsed.title, owners: owners, due: parsed.due, remind: parsed.remind, priority: parsed.priority, clientId: clientId });
  reply.quick = { title: reply.task.title, owners: reply.task.owners, due: reply.task.due, priority: reply.task.priority, remindNeedsDue: !!parsed.remindNeedsDue };
  return reply;
}

const TASK_STATUS_MERGE_MS = 10 * 60000;   // the same person changing the status again within 10 minutes: one history line

/**
 * CALL WHILE HOLDING THE SCRIPT LOCK. Writes the "X set it to Doing" line. When the newest line of this task is the same
 * person's status-only line from the last 10 minutes, that line is changed instead of adding another, so flipping the
 * status back and forth leaves one line with the final status.
 */
function taskRecordStatus_(taskId, status, by, at) {
  const who = memberText_(by, 80);
  delete DB_.rows["TaskUpdates"];
  const last = taskUpdatesOf_(taskId).sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); })[0];
  const recent = last && !String(last.text || "").trim() && last.status && last.by === who && (last.source || "portal") === "portal" &&
    Date.parse(at) - Date.parse(last.createdAt) < TASK_STATUS_MERGE_MS;
  if (recent) {
    updateRow_("TaskUpdates", last.id, { status: status, createdAt: at }, last._row);
    delete DB_.rows["TaskUpdates"];
    return;
  }
  insertRow_("TaskUpdates", { id: newId_("TU"), taskId: taskId, text: "", by: who, source: "portal", status: status, createdAt: at, discordMessageId: "" });
}

/**
 * Exec: one tap on the status pill (or a drag on the board). from: the status the page showed before the tap. When the
 * task has changed since (someone else, or an older tap arriving late), nothing is changed and the current task is sent
 * back with stale: true, so a late or repeated request can never undo a newer change.
 */
function setTaskStatus_(session, id, status, from) {
  status = taskCleanStatus_(status);
  const expected = from ? taskCleanStatus_(from) : "";
  return withLock_(function () {
    const task = taskFresh_(id);
    const current = TASK_STATUSES.indexOf(task.status) !== -1 ? task.status : "todo";
    if (current === status) return { ok: true, task: taskView_(task, taskUpdatesOf_(task.id)) };
    if (expected && expected !== current) return { ok: true, stale: true, task: taskView_(task, taskUpdatesOf_(task.id)) };
    const changes = taskStatusChanges_(task, status, session.name);
    updateRow_("Tasks", task.id, changes, task._row);
    taskRecordStatus_(task.id, status, session.name, changes.updatedAt);
    log_(session.name, "task.status", task.id, { title: task.title, status: status, was: task.status });
    if (task.status === "done" || status === "done") refreshNextReminder_();
    return { ok: true, task: taskView_(Object.assign({}, task, changes), taskUpdatesOf_(task.id)) };
  });
}

/** Exec: "Add an update" (optionally also changing the status). */
/** clientId: the name the page gave this update (saved in the background, sent again after a dropped connection): a repeat is not added twice. */
function addTaskUpdate_(session, id, text, status, clientId) {
  const raw = String(text === undefined || text === null ? "" : text).trim();
  if (!raw || raw.length > 1000) throw new ApiError_("BAD_REQUEST", "Write an update of up to 1000 characters.");
  const clean = noteText_(raw);
  if (!clean) throw new ApiError_("BAD_REQUEST", "Write an update of up to 1000 characters.");
  const newStatus = status ? taskCleanStatus_(status) : "";
  const named = /^TU[A-Za-z0-9_-]{8,40}$/.test(String(clientId || "")) ? String(clientId) : "";
  const reply = withLock_(function () {
    const task = taskFresh_(id);
    if (named) {
      delete DB_.rows["TaskUpdates"];
      const before = readRows_("TaskUpdates").filter(function (u) { return u.id === named; })[0];
      if (before) return { ok: true, repeated: true, update: taskUpdateView_(before), task: taskView_(task, taskUpdatesOf_(task.id)), _row: task };
    }
    const setStatus = newStatus && newStatus !== task.status ? newStatus : "";
    const now = new Date().toISOString();
    const update = { id: named || newId_("TU"), taskId: task.id, text: clean, by: memberText_(session.name, 80), source: "portal", status: setStatus, createdAt: now, discordMessageId: "" };
    insertRow_("TaskUpdates", update);
    const changes = setStatus ? taskStatusChanges_(task, setStatus, session.name) : { updatedBy: session.name, updatedAt: now };
    updateRow_("Tasks", task.id, changes, task._row);
    log_(session.name, "task.updated", task.id, { title: task.title, updateId: update.id, status: setStatus || undefined });
    if (setStatus) refreshNextReminder_();
    return { ok: true, update: taskUpdateView_(update), task: taskView_(Object.assign({}, task, changes), taskUpdatesOf_(task.id)), _row: task };
  });
  // @Name in the update: those people are pinged on Discord, under the task's own message. After the save, outside the lock.
  const task = reply._row;
  delete reply._row;
  if (reply.repeated) return reply;   // already posted (and pinged) the first time
  const mentioned = taskMentions_(clean);
  reply.mentioned = mentioned.map(function (p) { return p.name; });
  const ids = mentioned.map(function (p) { return p.discordId; }).filter(Boolean);
  if (ids.length) {
    const content = "💬 **" + discordEscape_(memberText_(session.name, 80)) + "** on **" + discordEscape_(task.title) + "**: " +
      discordEscape_(clean.replace(/^'/, "")).slice(0, 1500) + "\n" + ids.map(function (i) { return "<@" + i + ">"; }).join(" ");
    const post = discordSend_(content, ids, task.discordMessageId);
    reply.discordPosted = !!post.ok;
  }
  return reply;
}

/**
 * The people an update mentions: "@Amy Lee" (the full name on the People list), or "@Amy" when only one active person's
 * first name is Amy. Any capitals. [{ name, discordId }], each once.
 */
function taskMentions_(text) {
  const lower = String(text || "").toLowerCase();
  if (lower.indexOf("@") === -1) return [];
  const people = taskTeam_().filter(function (p) { return p.active && String(p.name || "").trim(); });
  const firstCount = {};
  people.forEach(function (p) { const f = teamNameKey_(p.name).split(" ")[0]; firstCount[f] = (firstCount[f] || 0) + 1; });
  const said = function (words) {
    let at = lower.indexOf("@" + words);
    while (at !== -1) {
      const before = at ? lower.charAt(at - 1) : "", after = lower.charAt(at + 1 + words.length);
      const word = /[a-z0-9À-￿]/i;   // "bob@amy.com" is an email address, not a mention
      if ((!before || !word.test(before)) && (!after || !word.test(after))) return true;
      at = lower.indexOf("@" + words, at + 1);
    }
    return false;
  };
  return people.filter(function (p) {
    const key = teamNameKey_(p.name), first = key.split(" ")[0];
    return said(key) || (firstCount[first] === 1 && said(first));
  }).map(function (p) { return { name: String(p.name).trim(), discordId: teamDiscordId_(p) }; });
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
  const lineIds = [];   // Only assigned people may be pinged: the people on each line.
  const lines = list.map(function (t) {
    lineIds.push(taskOwnerDiscordIds_(t));
    let when = "no due date";
    if (t.due && t.due < today) {
      const days = Math.round((edmAt_(today, 12, 0) - edmAt_(t.due, 12, 0)) / 86400000);
      when = "overdue " + days + "d";
    } else if (t.due === today) when = "due today";
    else if (t.due) when = "due " + taskDayText_(t.due);
    const priority = taskPriorityText_(t);
    return "• " + (priority ? priority + " · " : "") + "**" + discordEscape_(t.title) + "** — " + taskDiscordWho_(t) + " · " + when + (t.status === "blocked" ? " · ⛔ blocked" : "");
  });
  let content = "⏰ **Task check-in** — reply to each task's own message with how it's going.";
  let shown = 0;
  for (let i = 0; i < lines.length; i++) {
    const more = "\n…and " + (lines.length - i) + " more";
    if ((content + "\n" + lines[i]).length + more.length > 1900) { content += more; break; }
    content += "\n" + lines[i];
    shown++;
  }
  // Only people whose line made it into the message are pinged (every person on those lines, however many share a task).
  const ids = [].concat.apply([], lineIds.slice(0, shown));
  const post = discordSend_(content, ids);
  log_(session.name, "task.remind", "", { count: list.length, posted: !!post.ok });
  const out = { ok: true, posted: !!post.ok, count: list.length };
  if (!post.ok) out.error = post.error;
  return out;
}

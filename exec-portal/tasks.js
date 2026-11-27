// CSS Exec Portal — Tasks tab: who is doing what, by when. Each new task is posted in Discord #tasks; the owner replies there
// and the replies show up here (they are pulled in when this tab opens or is refreshed).
// Two views: a list grouped by due date, and a month calendar. The list of people lives in Settings → People.

const TASK_STATUSES = ["todo", "doing", "blocked", "done"];
const TASK_DEPTS = ["Events", "Marketing", "Internal", "External", "Finance", "General"];   // replaced by the server's list (Settings → People can add more)
const TASK_FILTER_KEY = "css_task_filter";
const TASK_VIEW_KEY = "css_task_view";
const REM_MAX = 5;
const CHECK_MAX = 60;
const TASK_NOBODY = "__nobody__";
const PRIORITY_RANK = { urgent: 0, high: 1, normal: 2, low: 3 };
const taskPriority = (task) => Object.prototype.hasOwnProperty.call(PRIORITY_RANK, task && task.priority) ? task.priority : "normal";

/** The departments the server sent, General last. Changed in place, because Settings → People uses the same list. */
function setTaskDepts(list) {
  if (!Array.isArray(list) || !list.length) return;
  const clean = [...new Set(list.map((d) => String(d || "").trim()).filter((d) => d && d !== "General"))];
  TASK_DEPTS.splice(0, TASK_DEPTS.length, ...clean, "General");
}

/** A person's departments, the first one first (older lists have just one). */
const personDepts = (p) => (p && Array.isArray(p.departments) && p.departments.length ? p.departments : p && p.department ? [p.department] : []);

const taskState = {
  tasks: [], team: [], discord: {}, loaded: false, request: 0,
  filter: "mine", view: "list", doneOpen: false, nodateOpen: false, search: "", person: "", newStatus: "todo", formLabels: [],
  calMonth: "",       // "yyyy-mm" on show in the calendar
  calDay: "",         // the day listed under the calendar ("yyyy-mm-dd"), or ""
  editing: null,      // the task open in the New/Edit dialog (null = new)
  owners: [],         // selected people in the New/Edit dialog
  checklist: [],      // the New/Edit dialog's copy of the checklist (Everyone / a department adds a line per person)
  checklistBase: "[]",
  deptTouched: false, // the department was picked by hand, so changing Who no longer changes it
  openId: "",         // the task open in the detail dialog
  menuId: "",         // the task whose status menu is open
  combo: { names: [], active: -1 },  // the "Who" suggestions on show
  label: "",          // the label filter ("" = all labels)
  pending: {},        // status taps not saved yet, by task id: { want, confirmed, timer, busy }
  draft: null,        // what the task window shows and Save sends: { status, owners, labels, checklist }
  draftBase: "",      // the draft as it was opened, to tell whether anything changed
  formBase: "",       // the New/Edit form as it was opened
  dragId: "",         // the card being dragged on the board
  sortables: [],      // the board's drag lists (when the drag helper is on the page); remade with each board
  quick: "",          // the needs-attention chip picked ("" = none); not remembered between visits
  quickSend: null,    // the quick-add sentence that didn't go through, and its name: { text, clientId }
  mention: { names: [], active: -1, start: -1 }   // the @name suggestions under the update box
};
try { taskState.filter = localStorage.getItem(TASK_FILTER_KEY) || "mine"; } catch (e) { /* no storage: start on My tasks */ }
try { const v = localStorage.getItem(TASK_VIEW_KEY); taskState.view = ["cal", "board", "people"].includes(v) ? v : "list"; } catch (e) { /* no storage: start on the list */ }

// Listing is safe to repeat and runs quietly (the list on screen stays while it refreshes); a status tap changes the screen at once.
if (typeof READ_ACTIONS !== "undefined") READ_ACTIONS.push("listTasks");
if (typeof QUIET_ACTIONS !== "undefined") QUIET_ACTIONS.push("listTasks", "setTaskStatus", "taskBotStatus");

// ---- Dates (all "yyyy-mm-dd", Calgary days) ----------------------------------------------------------

function taskIso(value) {
  const m = String(value || "").match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : "";
}
function isoDate(iso) { return new Date(iso + "T12:00:00Z"); }
function isoAddDays(iso, n) { const d = isoDate(iso); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function isoDaysFrom(from, to) { return Math.round((isoDate(to) - isoDate(from)) / 86400000); }
function isoText(iso, opts) { return isoDate(iso).toLocaleDateString("en-CA", { timeZone: "UTC", ...opts }); }
function isoShort(iso) {
  const sameYear = iso.slice(0, 4) === todayMountain().slice(0, 4);
  return isoText(iso, sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}
function monthAdd(month, n) { const d = isoDate(month + "-01"); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7); }
/** "09:00" -> "9:00 AM" */
function clockText(hhmm) {
  const m = String(hhmm || "").match(/^(\d{1,2}):(\d{2})/);
  if (!m) return "";
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}
/** A time from the server (ISO) as a Calgary day. */
function mountainDay(value) {
  const iso = taskIso(value);
  if (!value || /^\d{4}-\d{2}-\d{2}$/.test(String(value))) return iso;
  const d = new Date(value);
  return isNaN(d) ? iso : d.toLocaleDateString("en-CA", { timeZone: "America/Edmonton" });
}

function quickDate(kind) {
  const today = todayMountain();
  if (kind === "today") return today;
  if (kind === "tomorrow") return isoAddDays(today, 1);
  if (kind === "fri") { const ahead = (5 - isoDate(today).getUTCDay() + 7) % 7; return isoAddDays(today, ahead || 7); }
  if (kind === "nextWeek") return isoAddDays(today, 7);
  return "";
}

/** The due chip: red overdue, orange today, yellow within the week, plain after that. */
function dueChip(task) {
  const due = taskIso(task.due);
  if (!due) return "";
  const days = isoDaysFrom(todayMountain(), due);
  if (task.status === "done") return `<span class="due-chip">${escapeHtml(isoShort(due))}</span>`;
  if (days < 0) return `<span class="due-chip overdue">${escapeHtml(T.taskOverdue(-days))}</span>`;
  if (days === 0) return `<span class="due-chip today">${escapeHtml(T.taskToday)}</span>`;
  if (days <= 6) return `<span class="due-chip soon">${escapeHtml(isoText(due, { weekday: "short" }))}</span>`;
  return `<span class="due-chip">${escapeHtml(isoShort(due))}</span>`;
}

/** "🔔 Wed, Dec 3" when a reminder is coming up (with the time too in the detail view). */
function reminderChip(task, withTime) {
  const day = taskIso(task.nextReminder);
  if (!day || task.status === "done") return "";
  const time = withTime ? clockText(String(task.nextReminder).slice(11, 16)) : "";
  return `<span class="task-bell">🔔 ${escapeHtml(isoText(day, { weekday: "short", month: "short", day: "numeric" }))}${time ? " " + escapeHtml(time) : ""}</span>`;
}

function taskAgo(value) {
  const when = new Date(value);
  if (isNaN(when)) return "";
  const mins = Math.floor((Date.now() - when) / 60000);
  if (mins < 1) return T.taskAgo.now;
  if (mins < 60) return T.taskAgo.m(mins);
  if (mins < 60 * 24) return T.taskAgo.h(Math.floor(mins / 60));
  if (mins < 60 * 24 * 7) return T.taskAgo.d(Math.floor(mins / 1440));
  return when.toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "America/Edmonton" });
}

// ---- Helpers ------------------------------------------------------------------------------------------

const normName = (s) => String(s || "").trim().replace(/\s+/g, " ").toLowerCase();
const sameName = (a, b) => normName(a) === normName(b);
const isActive = (v) => !(v === false || v === 0 || /^(false|no|0)$/i.test(String(v)));
const activeTeam = () => taskState.team.filter((p) => isActive(p.active) && String(p.name || "").trim());
const teamPerson = (name) => taskState.team.find((p) => sameName(p.name, name));
const taskById = (id) => taskState.tasks.find((t) => t.id === id);
const statusLabel = (s) => T.taskStatus[s] || T.taskStatus.todo;
const discordMark = () => `<svg class="discord-mark" role="img" aria-label="${escapeHtml(T.taskFromDiscord)}"><title>${escapeHtml(T.taskFromDiscord)}</title><use href="#i-chat"/></svg>`;
const isNarrow = () => matchMedia("(max-width: 600px)").matches;

/** True when the reply means "signed out" (and the sign-in page is showing now). */
function taskSignedOut(reply) {
  if (reply.error !== "NOT_LOGGED_IN") return false;
  document.querySelectorAll("#task-dialog, #task-detail-dialog").forEach((d) => { if (d.open) d.close(); });
  signOutLocally();
  showLogin(errorText(reply));
  return true;
}

function newestNote(task) {
  return (task.updates || []).find((u) => String(u.text || "").trim());
}

// ---- Loading ------------------------------------------------------------------------------------------

/** The server's list, plus whatever is still waiting to be sent from this device. */
function showTaskList(data) {
  taskState.tasks = data.tasks || [];
  taskState.team = data.team || [];
  setTaskDepts(data.departments);
  taskState.discord = data.discord || {};
  taskState.loaded = true;
  applyOutbox();
  // A status tap still waiting to be saved keeps showing what was tapped.
  Object.entries(taskState.pending).forEach(([id, p]) => { const t = taskById(id); if (t) showStatus(t, p.want); });
  renderTasks();
}

async function loadTasks() {
  const request = ++taskState.request;
  // First time: the copy kept on this device shows straight away; the fresh list follows quietly.
  if (!taskState.loaded) {
    const kept = deviceLoad("tasks");
    if (kept && Array.isArray(kept.tasks)) showTaskList(kept);
  }
  if (!taskState.loaded) { $("task-status").textContent = T.taskLoading; $("task-groups").innerHTML = ""; $("task-empty").hidden = true; }
  const reply = await api("listTasks");
  if (request !== taskState.request) return;
  if (!reply.ok) {
    if (taskSignedOut(reply)) return;
    if (NETWORK_ERRORS.includes(reply.error) && taskState.loaded) { taskState.outboxOffline = true; renderOutboxWarn(); return; }
    $("task-status").textContent = errorText(reply);
    return;
  }
  $("task-status").textContent = "";
  taskState.outboxOffline = false;
  renderOutboxWarn();
  deviceSave("tasks", { tasks: reply.tasks || [], team: reply.team || [], departments: reply.departments || [], discord: reply.discord || {} });
  showTaskList(reply);
  openLinkedTask();
  if (outboxCount()) flushOutbox();
  if (taskState.openId && $("task-detail-dialog").open) {
    if (taskById(taskState.openId)) renderTaskDetail(); else $("task-detail-dialog").close();
  }
}

function openTasksTab() {
  $("crumb").textContent = T.tabTasks;
  renderOutboxWarn();
  if (taskState.loaded) renderTasks();   // what we had, straight away; fresh data follows
  loadTasks();
}

// The Tasks tab button gets "active" from the shared tab switcher: show this tab when it does, hide it when another tab does.
(function watchTasksTab() {
  const button = document.querySelector('.tab[data-tab="tasks"]');
  if (!button) return;
  let wasActive = button.classList.contains("active");
  new MutationObserver(() => {
    const active = button.classList.contains("active");
    if (active === wasActive) return;
    wasActive = active;
    $("tab-tasks").hidden = !active;
    if (active) openTasksTab(); else closeStatusMenu();
  }).observe(button, { attributes: true, attributeFilter: ["class"] });
  // Tapping the tab while already on it refreshes the list.
  button.addEventListener("click", () => { if (wasActive && !$("tab-tasks").hidden) loadTasks(); });
})();

// ---- The list ------------------------------------------------------------------------------------------

function renderFilters() {
  const chips = [["mine", T.taskFilterMine], ["all", T.taskFilterAll], ...TASK_DEPTS.map((d) => [d, d])];
  if (!chips.some(([key]) => key === taskState.filter)) taskState.filter = "mine";
  $("task-filters").innerHTML = chips.map(([key, label]) =>
    `<button type="button" class="chip${key === "mine" ? " chip-mine" : ""}${key === taskState.filter ? " active" : ""}" data-task-filter="${escapeHtml(key)}">` +
    `${key === "mine" ? '<svg aria-hidden="true"><use href="#i-user"/></svg>' : ""}${escapeHtml(label)}</button>`).join("");
  document.querySelectorAll("#task-view [data-task-view]").forEach((b) => {
    const on = b.dataset.taskView === taskState.view;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", String(on));
  });
  // Labels: a drop-down of every label in use (hidden when no task has one).
  const labels = allLabels();
  if (taskState.label && !labels.some((l) => sameName(l, taskState.label))) taskState.label = "";
  const select = $("task-label-filter");
  select.hidden = !labels.length;
  select.innerHTML = `<option value="">${escapeHtml(T.taskAllLabels)}</option>` +
    labels.map((l) => `<option value="${escapeHtml(l)}"${sameName(l, taskState.label) ? " selected" : ""}>${escapeHtml(l)}</option>`).join("");
  const names = new Map();
  activeTeam().forEach((p) => names.set(normName(p.name), p.name));
  taskState.tasks.forEach((t) => taskOwners(t).forEach((n) => { if (!names.has(normName(n))) names.set(normName(n), n); }));
  const choices = [["", T.taskAllPeople], ...[...names.values()].sort(byName).map((n) => [n, n])];
  if (taskState.tasks.some((t) => !taskOwners(t).length)) choices.push([TASK_NOBODY, T.taskNobody]);
  if (taskState.person && !choices.some(([n]) => sameName(n, taskState.person))) taskState.person = "";
  $("task-person-filter").innerHTML = choices.map(([n, label]) => `<option value="${escapeHtml(n)}"${sameName(n, taskState.person) ? " selected" : ""}>${escapeHtml(label)}</option>`).join("");
  $("task-person-filter").disabled = taskState.view === "people";
  $("task-search").value = taskState.search;
}

/** Every label used on a task, once each, A to Z. */
function allLabels() {
  const seen = new Map();
  taskState.tasks.forEach((t) => taskLabels(t).forEach((l) => { if (!seen.has(normName(l))) seen.set(normName(l), l); }));
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/** opts: ignorePerson (or skipPerson) leaves out the Person menu; ignoreQuick leaves out the needs-attention chip. */
function filteredTasks(opts = {}) {
  const f = taskState.filter;
  const words = normName(taskState.search).split(" ").filter(Boolean);
  const skipPerson = opts.ignorePerson || opts.skipPerson;
  const quick = opts.ignoreQuick ? "" : taskState.quick;
  const today = todayMountain();
  return taskState.tasks.filter((t) => (f === "all" ? true : f === "mine" ? opts.ignoreMine || taskOwners(t).some((name) => sameName(name, state.name)) : t.department === f)
    && (!taskState.label || taskLabels(t).some((l) => sameName(l, taskState.label)))
    && (skipPerson || !taskState.person || (taskState.person === TASK_NOBODY ? !taskOwners(t).length : taskOwners(t).some((n) => sameName(n, taskState.person))))
    && (!quick || taskNeeds(quick, t, today))
    && words.every((word) => normName([t.title, t.notes, t.department, ...taskOwners(t), ...taskLabels(t), ...taskChecklist(t).map((c) => c.text)].join(" ")).includes(word)));
}

// ---- Needs attention: a chip per kind of task that needs a look (only the ones with any) ----------------

const TASK_ATTENTION = ["overdue", "week", "blocked", "nobody", "quiet"];
const QUIET_DAYS = 7;

/** The newest of: last changed, newest update, made. "" when the task has none of them. */
function taskLastTouched(t) {
  let best = -Infinity, value = "";
  [t.updatedAt, t.createdAt, ...(t.updates || []).map((u) => u && u.createdAt)].forEach((v) => {
    const ms = Date.parse(v);
    if (ms > best) { best = ms; value = v; }
  });
  return value;
}

/** Does an open task need this kind of attention? today = "yyyy-mm-dd". */
function taskNeeds(key, t, today) {
  if (!t || t.status === "done") return false;
  const due = taskIso(t.due);
  if (key === "overdue") return !!due && due < today;
  if (key === "week") return !!due && due >= today && due <= isoAddDays(today, 6);
  if (key === "blocked") return t.status === "blocked";
  if (key === "nobody") return !taskOwners(t).length;
  if (key === "quiet") { const last = taskLastTouched(t); return !!last && isoDaysFrom(mountainDay(last), today) >= QUIET_DAYS; }
  return false;
}

/** How many of the tasks passing the other filters need each kind of attention. */
function attentionCounts() {
  const today = todayMountain();
  const list = filteredTasks({ ignoreQuick: true, ignorePerson: taskState.view === "people" });
  const counts = {};
  TASK_ATTENTION.forEach((k) => { counts[k] = list.filter((t) => taskNeeds(k, t, today)).length; });
  return counts;
}

function renderAttention() {
  const box = $("task-attention");
  if (!box) return;
  const counts = attentionCounts();
  // The picked chip stays even with none left, so it can always be tapped off.
  const shown = TASK_ATTENTION.filter((k) => counts[k] > 0 || k === taskState.quick);
  box.hidden = !shown.length;
  box.innerHTML = shown.map((k) => {
    const on = k === taskState.quick;
    return `<button type="button" class="chip att-${k}${on ? " active" : ""}" data-task-quick="${k}" aria-pressed="${on}">${escapeHtml(T.taskAttention[k])} <span class="task-count">${counts[k]}</span></button>`;
  }).join("");
}

function pickAttention(key) {
  if (!TASK_ATTENTION.includes(key)) return;
  taskState.quick = taskState.quick === key ? "" : key;
  closeStatusMenu();
  renderTasks();
}

function showPersonTasks(name) {
  taskState.person = name;
  taskState.filter = "all";
  taskState.view = "list";
  try { localStorage.setItem(TASK_VIEW_KEY, "list"); } catch (e) { /* no storage */ }
  closeStatusMenu();
  renderTasks();
}

function clearTaskFilters() {
  taskState.search = ""; taskState.person = ""; taskState.label = ""; taskState.quick = ""; taskState.filter = "all";
  renderTasks();
}

const taskInitials = (name) => String(name || "").trim().split(/\s+/).filter(Boolean).map((s) => s[0]).slice(0, 2).join("").toUpperCase();
function avatarHtml(names) {
  const list = (Array.isArray(names) ? names : [names]).filter(Boolean).slice().sort(byName);
  if (!list.length) return `<span class="board-people">${escapeHtml(T.taskNobody)}</span>`;
  return `<span class="task-avatars" role="img" aria-label="${escapeHtml(list.join(", "))}" title="${escapeHtml(list.join(", "))}">${list.slice(0, 3).map((n) => `<span class="task-avatar" aria-hidden="true">${escapeHtml(taskInitials(n))}</span>`).join("")}${list.length > 3 ? `<span class="task-avatar-more" aria-hidden="true">+${list.length - 3}</span>` : ""}</span>`;
}
function priorityChip(task) {
  const p = taskPriority(task);
  return p === "normal" || task.status === "done" ? "" : `<span class="task-priority priority-${p}">${escapeHtml(T.taskPriorities[p])}</span>`;
}
const taskByPriorityDue = (a, b) => PRIORITY_RANK[taskPriority(a)] - PRIORITY_RANK[taskPriority(b)] || (taskIso(a.due) || "9999").localeCompare(taskIso(b.due) || "9999") || String(a.title).localeCompare(String(b.title));
/** Done: the most recently finished first. */
const doneTime = (t) => Date.parse(t.doneAt || t.updatedAt) || 0;
const taskByNewestDone = (a, b) => doneTime(b) - doneTime(a) || String(a.title).localeCompare(String(b.title));

function fillPrioritySelect(id, priority) {
  $(id).innerHTML = Object.keys(PRIORITY_RANK).map((p) => `<option value="${p}">${escapeHtml(T.taskPriorities[p])}</option>`).join("");
  $(id).value = taskPriority({ priority });
}

const taskLabels = (t) => Array.isArray(t.labels) ? t.labels.filter((l) => String(l || "").trim()) : [];
const taskChecklist = (t) => Array.isArray(t.checklist) ? t.checklist.filter((c) => c && String(c.text || "").trim()) : [];

/** A label's colour: one of six, always the same for the same word. */
function labelHue(label) {
  let h = 0;
  for (const ch of normName(label)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 6;
}
const labelChip = (l) => `<span class="task-label lab-${labelHue(l)}">${escapeHtml(l)}</span>`;

/** "Not sent yet" on a change still waiting on this device for the connection. */
const notSentChip = (t) => t.sending && taskState.outboxOffline ? `<span class="task-waiting">${escapeHtml(T.taskNotSent)}</span>` : "";

/** "☑ 2/5" when the task has a checklist. */
function checkChip(t) {
  const list = taskChecklist(t);
  if (!list.length) return "";
  const done = list.filter((c) => c.done).length;
  return `<span class="task-check${done === list.length ? " all" : ""}"><svg aria-hidden="true"><use href="#i-check"/></svg>${done}/${list.length}</span>`;
}

function taskGroupKey(task) {
  if (task.status === "done") return "done";
  const due = taskIso(task.due);
  if (!due) return "nodate";
  const days = isoDaysFrom(todayMountain(), due);
  return days < 0 ? "overdue" : days <= 6 ? "week" : "later";
}

function renderTasks() {
  renderFilters();
  renderAttention();
  const d = taskState.discord || {};
  const remind = $("task-remind-button");
  remind.disabled = !d.posting;
  remind.title = d.posting ? "" : T.taskRemindOff;
  $("task-remind-wrap").title = remind.title;
  $("task-discord-warn").hidden = !d.error;
  $("task-discord-warn").textContent = d.error || "";

  const cal = taskState.view === "cal", board = taskState.view === "board", people = taskState.view === "people";
  $("task-groups").hidden = cal || board || people;
  $("task-cal").hidden = !cal;
  $("task-board").hidden = !board;
  $("task-people").hidden = !people;
  $("task-no-match").hidden = true;
  if (!board) stopBoardSortables();
  if (people) { $("task-empty").hidden = true; if (typeof renderTaskPeople === "function") renderTaskPeople(); return; }
  if (cal) { $("task-empty").hidden = true; return renderCalendar(); }
  if (board) { $("task-empty").hidden = true; return renderBoard(); }

  const list = filteredTasks();
  const groups = { overdue: [], week: [], later: [], nodate: [], done: [] };
  list.forEach((t) => groups[taskGroupKey(t)].push(t));
  ["overdue", "week", "later", "nodate"].forEach((k) => groups[k].sort(taskByPriorityDue));
  groups.done.sort(taskByNewestDone);

  const filtersOn = !!(taskState.search || taskState.person || taskState.label || taskState.quick);
  $("task-empty").hidden = !taskState.loaded || list.length > 0 || filtersOn;
  $("task-no-match").hidden = !taskState.loaded || list.length > 0 || !filtersOn;
  $("task-groups").innerHTML = ["overdue", "week", "later", "nodate"].filter((k) => groups[k].length).map((k) => `
    <section class="task-group g-${k}">
      <h2 class="task-group-h">${escapeHtml(T.taskGroups[k])} <span class="task-count">${groups[k].length}</span></h2>
      <ul class="task-list">${groups[k].map(taskRow).join("")}</ul>
    </section>`).join("") + (groups.done.length ? `
    <details class="task-group task-done" id="task-done"${taskState.doneOpen ? " open" : ""}>
      <summary class="task-group-h">${escapeHtml(T.taskGroups.done)} <span class="task-count">${groups.done.length}</span></summary>
      <ul class="task-list">${groups.done.map(taskRow).join("")}</ul>
    </details>` : "");
}

function taskRow(t) {
  const note = newestNote(t);
  const status = TASK_STATUSES.includes(t.status) ? t.status : "todo";
  return `<li class="task-row st-${status}" data-task-id="${escapeHtml(t.id)}" tabindex="0">
    <div class="task-main">
      <div class="task-title">${escapeHtml(t.title)}</div>
      <div class="task-meta">${priorityChip(t)}${notSentChip(t)}<span>${escapeHtml(ownersShort(t) || T.taskNobody)}</span>${dueChip(t)}${reminderChip(t)}${checkChip(t)}${taskLabels(t).map(labelChip).join("")}</div>
      ${note ? `<div class="task-last">${note.source === "discord" ? discordMark() : ""}<span>${escapeHtml(note.text)}</span></div>` : ""}
    </div>
    <button type="button" class="task-status st-${status}" data-status-for="${escapeHtml(t.id)}" aria-haspopup="menu">${escapeHtml(statusLabel(status))}</button>
  </li>`;
}

// ---- Board: one column per status; drag a card to another column to change its status --------------------

function renderBoard() {
  const today = todayMountain();
  const cols = { todo: [], doing: [], blocked: [], done: [] };
  filteredTasks().forEach((t) => (cols[TASK_STATUSES.includes(t.status) ? t.status : "todo"]).push(t));
  ["todo", "doing", "blocked"].forEach((s) => cols[s].sort(taskByPriorityDue));
  cols.done.sort(taskByNewestDone);
  stopBoardSortables();
  $("task-board").innerHTML = TASK_STATUSES.map((s) => `
    <section class="board-col st-${s}" data-board-status="${s}">
      <h2 class="board-h"><span class="task-status st-${s} mini">${escapeHtml(statusLabel(s))}</span> <span class="task-count">${cols[s].length}</span></h2>
      <ul class="board-cards" data-board-list="${s}">${cols[s].map((t) => boardCard(t, today)).join("")}</ul>
      ${s !== "done" ? `<button class="board-add" type="button" data-add-status="${s}">+ ${escapeHtml(T.taskAdd)}</button>` : ""}
    </section>`).join("");
  startBoardSortables();
}

/*
 * Dragging cards. With the drag helper (Sortable) on the page, it does the dragging, on computers and phones alike: on a
 * phone, press and hold a card for a moment, then drag it (a quick swipe still scrolls the board). Without it, computers
 * use the browser's own dragging (setUpBoardDrag below). Never both at once, so a card can't be moved twice.
 */
const hasSortable = () => typeof Sortable === "function";

function stopBoardSortables() {
  taskState.sortables.forEach((s) => { try { s.destroy(); } catch (e) { /* already gone with the old board */ } });
  taskState.sortables = [];
}

function startBoardSortables() {
  if (!hasSortable()) return;
  const board = $("task-board");
  if (!board || typeof board.querySelectorAll !== "function") return;
  board.querySelectorAll("[data-board-list]").forEach((list) => {
    taskState.sortables.push(Sortable.create(list, {
      group: "task-board",
      sort: false,                 // the order in a column is set by priority and due date
      draggable: ".board-card",
      filter: ".board-add",
      preventOnFilter: false,      // "+ Add task" stays an ordinary button
      delay: 180,
      delayOnTouchOnly: true,
      animation: 150,
      ghostClass: "dragging",
      scrollSensitivity: 60,       // near the edge of a phone screen the board scrolls to the next column
      onStart: () => board.classList.add("board-dragging"),
      onEnd: (evt) => {
        board.classList.remove("board-dragging");
        if (!evt || evt.from === evt.to || !evt.item) return;
        const id = evt.item.getAttribute("data-task-id");
        const status = evt.to.getAttribute("data-board-list");
        // After the drag helper has finished; the board is then drawn again in the right order.
        setTimeout(() => changeTaskStatus(id, status), 0);
      }
    }));
  });
}

function boardCard(t, today) {
  const checklist = taskChecklist(t), complete = checklist.filter((c) => c.done).length;
  return `<li class="board-card st-${escapeHtml(t.status)}${taskIsOverdue(t, today) ? " overdue" : ""}" data-task-id="${escapeHtml(t.id)}" tabindex="0"${hasSortable() ? "" : ' draggable="true"'}>
    ${taskLabels(t).length ? `<div class="board-labels">${taskLabels(t).map(labelChip).join("")}</div>` : ""}
    <div class="task-title">${escapeHtml(t.title)}</div>
    <div class="task-meta">${priorityChip(t)}${notSentChip(t)}${dueChip(t)}${checkChip(t)}${avatarHtml(taskOwners(t))}</div>
    ${checklist.length ? `<div class="task-progress" role="progressbar" aria-label="${escapeHtml(T.taskChecklist)}" aria-valuemin="0" aria-valuemax="${checklist.length}" aria-valuenow="${complete}"><span style="width:${Math.round(complete / checklist.length * 100)}%"></span></div>` : ""}
  </li>`;
}

function setUpBoardDrag() {
  const board = $("task-board");
  const clearOver = () => board.querySelectorAll(".board-col.drop").forEach((c) => c.classList.remove("drop"));
  board.addEventListener("dragstart", (e) => {
    if (hasSortable()) return;   // the drag helper is moving it
    const card = e.target.closest(".board-card");
    if (!card) return;
    taskState.dragId = card.dataset.taskId;
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", taskState.dragId); } catch (err) { /* some browsers only */ }
    requestAnimationFrame(() => card.classList.add("dragging"));
  });
  board.addEventListener("dragend", () => {
    taskState.dragId = "";
    board.querySelectorAll(".dragging").forEach((c) => c.classList.remove("dragging"));
    clearOver();
  });
  board.addEventListener("dragover", (e) => {
    const col = e.target.closest("[data-board-status]");
    if (!col || !taskState.dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (!col.classList.contains("drop")) { clearOver(); col.classList.add("drop"); }
  });
  board.addEventListener("dragleave", (e) => {
    const col = e.target.closest("[data-board-status]");
    if (col && !col.contains(e.relatedTarget)) col.classList.remove("drop");
  });
  board.addEventListener("drop", (e) => {
    const col = e.target.closest("[data-board-status]");
    const id = taskState.dragId;
    clearOver();
    if (!col || !id || hasSortable()) return;
    e.preventDefault();
    taskState.dragId = "";
    changeTaskStatus(id, col.dataset.boardStatus);
  });
  board.addEventListener("click", (e) => {
    const add = e.target.closest("[data-add-status]");
    if (add) return openTaskDialog(null, "", add.dataset.addStatus);
    const card = e.target.closest("[data-task-id]");
    if (card) openTaskDetail(card.dataset.taskId);
  });
  board.addEventListener("keydown", onTaskListKey);
}

// ---- Calendar ------------------------------------------------------------------------------------------

const STATUS_ORDER = { blocked: 0, doing: 1, todo: 2, done: 3 };
const calSort = (a, b) => (STATUS_ORDER[a.status] ?? 2) - (STATUS_ORDER[b.status] ?? 2) || String(a.title).localeCompare(String(b.title));
const taskIsOverdue = (t, today) => t.status !== "done" && taskIso(t.due) && taskIso(t.due) < today;

function renderCalendar() {
  const today = todayMountain();
  const month = taskState.calMonth || today.slice(0, 7);
  taskState.calMonth = month;
  const first = month + "-01";
  const offset = (isoDate(first).getUTCDay() + 6) % 7;   // Monday first
  const daysInMonth = isoDaysFrom(first, monthAdd(month, 1) + "-01");
  const cells = Math.ceil((offset + daysInMonth) / 7) * 7;
  const start = isoAddDays(first, -offset);

  const byDay = {};
  const noDate = [];
  filteredTasks().forEach((t) => {
    const due = taskIso(t.due);
    if (!due) return noDate.push(t);
    (byDay[due] = byDay[due] || []).push(t);
  });
  Object.values(byDay).forEach((list) => list.sort(calSort));

  $("cal-month").textContent = isoText(first, { month: "long", year: "numeric" });
  const head = T.calWeekdays.map((d, i) => `<div class="cal-wd"><span class="wd-long">${escapeHtml(d)}</span><span class="wd-short" aria-hidden="true">${escapeHtml(T.calWeekdaysShort[i])}</span></div>`).join("");
  let days = "";
  for (let i = 0; i < cells; i++) {
    const iso = isoAddDays(start, i);
    const list = byDay[iso] || [];
    const cls = ["cal-day", iso.slice(0, 7) !== month ? "out" : "", iso === today ? "today" : "", iso === taskState.calDay ? "sel" : "", i >= cells - 7 ? "last-row" : ""].filter(Boolean).join(" ");
    const shown = list.length > 3 ? list.slice(0, 3) : list;
    const chips = shown.map((t) => `<button type="button" class="cal-chip st-${escapeHtml(t.status)}${taskIsOverdue(t, today) ? " overdue" : ""}" data-cal-task="${escapeHtml(t.id)}" title="${escapeHtml(t.title)}">${escapeHtml(t.title)}</button>`).join("")
      + (list.length > 3 ? `<button type="button" class="cal-more" data-day-open="${iso}">${escapeHtml(T.calMore(list.length - 3))}</button>` : "");
    const dots = list.slice(0, 4).map((t) => `<i class="st-${escapeHtml(t.status)}${taskIsOverdue(t, today) ? " overdue" : ""}"></i>`).join("");
    const label = isoText(iso, { weekday: "short", month: "short", day: "numeric" }) + (list.length ? ` · ${list.length}` : "");
    days += `<div class="${cls}" data-day="${iso}">
      <button type="button" class="cal-num" data-day-open="${iso}" aria-label="${escapeHtml(label)}">${Number(iso.slice(8))}</button>
      <div class="cal-chips">${chips}</div>
      <div class="cal-dots" aria-hidden="true">${dots}</div>
    </div>`;
  }
  $("cal-grid").innerHTML = head + days;

  // The picked day's tasks, under the grid
  const day = taskState.calDay;
  if (day) {
    const list = byDay[day] || [];
    $("cal-daylist").innerHTML = `<section class="task-group cal-daylist">
      <div class="section-h"><h2 class="task-group-h">${escapeHtml(isoText(day, { weekday: "short", month: "short", day: "numeric" }))} <span class="task-count">${list.length}</span></h2>
        <button type="button" class="link" data-cal-new="${day}">${escapeHtml(T.taskNew)}</button></div>
      ${list.length ? `<ul class="task-list">${list.map(taskRow).join("")}</ul>` : `<p class="muted small">${escapeHtml(T.calNothing)}</p>`}
    </section>`;
  } else $("cal-daylist").innerHTML = "";

  noDate.sort(calSort);
  $("cal-nodate").innerHTML = noDate.length ? `<details class="task-group task-done cal-nodate" id="cal-nodate-d"${taskState.nodateOpen ? " open" : ""}>
      <summary class="task-group-h">${escapeHtml(T.calNoDate)} <span class="task-count">${noDate.length}</span></summary>
      <ul class="task-list">${noDate.map(taskRow).join("")}</ul>
    </details>` : "";
}

function pickCalDay(iso) {
  taskState.calDay = taskState.calDay === iso ? "" : iso;
  renderCalendar();
  if (taskState.calDay) $("cal-daylist").scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function onCalendarClick(e) {
  const chip = e.target.closest("[data-cal-task]");
  if (chip) return openTaskDetail(chip.dataset.calTask);
  const open = e.target.closest("[data-day-open]");
  if (open) return pickCalDay(open.dataset.dayOpen);
  const add = e.target.closest("[data-cal-new]");
  if (add) return openTaskDialog(null, add.dataset.calNew);
  const cell = e.target.closest(".cal-day");
  if (cell) return isNarrow() ? pickCalDay(cell.dataset.day) : openTaskDialog(null, cell.dataset.day);
  onTaskListClick(e);
}

// ---- One-tap status ------------------------------------------------------------------------------------

function openStatusMenu(button) {
  const id = button.dataset.statusFor;
  const task = taskById(id);
  if (!task) return;
  if (taskState.menuId === id) return closeStatusMenu();
  const menu = $("task-status-menu");
  taskState.menuId = id;
  menu.innerHTML = TASK_STATUSES.map((s) =>
    `<button type="button" role="menuitem" class="task-status st-${s}${s === task.status ? " current" : ""}" data-set-status="${s}">${escapeHtml(statusLabel(s))}</button>`).join("");
  menu.hidden = false;
  const r = button.getBoundingClientRect();
  const w = menu.offsetWidth, h = menu.offsetHeight;
  const left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8));
  const top = r.bottom + 6 + h > window.innerHeight ? r.top - h - 6 : r.bottom + 6;
  menu.style.left = left + "px";
  menu.style.top = Math.max(8, top) + "px";
  menu.querySelector(".current, button").focus();
}

function closeStatusMenu() {
  taskState.menuId = "";
  $("task-status-menu").hidden = true;
}

/*
 * Status taps (the pill menu and dragging on the board) show at once, but are saved only after a short pause with no
 * further tap on that task, and only the last choice is sent: tapping To do → Doing → Done quickly saves once, as Done.
 * One save per task at a time; a tap during a save is sent when it finishes. The server is told what the status was
 * ("from"), so a late or repeated request can never undo a newer change.
 */
const STATUS_SAVE_PAUSE_MS = 800;

function showStatus(task, status) {
  if (task.status === status) return;
  task.status = status;
  task.doneAt = status === "done" ? (task.doneAt || new Date().toISOString()) : "";
}

function changeTaskStatus(id, status) {
  const task = taskById(id);
  if (!task || !TASK_STATUSES.includes(status)) return;
  const p = taskState.pending[id] || (taskState.pending[id] = { from: task.status, want: task.status, timer: 0 });
  if (p.want === status) return;
  p.want = status;
  showStatus(task, status);
  renderTasks();
  clearTimeout(p.timer);
  p.timer = setTimeout(() => { delete taskState.pending[id]; queueStatus(id, p.from, p.want); }, STATUS_SAVE_PAUSE_MS);
}

/** Puts a status change in the outbox. A change for the same task that hasn't gone out yet is updated instead. */
function queueStatus(id, from, status) {
  const list = outboxRead();
  const waiting = list.filter((x) => x.action === "setTaskStatus" && x.details.id === id && x.key !== taskState.outboxSending).pop();
  if (waiting) {
    waiting.details.status = status;
    if (status === waiting.details.from) list.splice(list.indexOf(waiting), 1);   // back where it started: nothing to send
    outboxWrite(list);
    renderOutboxWarn();
    return flushOutbox();
  }
  if (from !== status) outboxAdd({ action: "setTaskStatus", details: { id, status, from } });
}

// ---- Saving in the background ---------------------------------------------------------------------------
/*
 * Changes to tasks show at once and are saved in the background, one after another. Each waits in an "outbox" kept on
 * this device until the server has it, so nothing is lost if the connection drops or the page is closed: it is sent
 * again when the connection is back (the 30-second check, the browser going online, or opening Tasks). Only changes the
 * server can safely get twice are sent again: a new task or update carries its own name, so a repeat isn't added twice,
 * and a status carries the status it replaced, so an old one never undoes a newer one.
 */
const OUTBOX_PREFIX = "css_outbox_";
const outboxKey = () => OUTBOX_PREFIX + normName(state.name);
const NETWORK_ERRORS = ["NETWORK", "TEMPORARY", "BUSY"];

function outboxRead() {
  if (!state.name) return [];
  try { const list = JSON.parse(localStorage.getItem(outboxKey()) || "[]"); return Array.isArray(list) ? list : []; } catch (e) { return []; }
}
function outboxWrite(list) {
  try { if (list.length) localStorage.setItem(outboxKey(), JSON.stringify(list)); else localStorage.removeItem(outboxKey()); } catch (e) { /* can't keep it: still sent while the page is open */ }

}
function outboxCount() { return outboxRead().length; }
function newLocalId(prefix) { return prefix + newRequestId().replace(/[^A-Za-z0-9]/g, "").slice(0, 20); }

function outboxAdd(item) {
  const list = outboxRead();
  list.push({ key: newLocalId("OB"), at: new Date().toISOString(), ...item });
  outboxWrite(list);
  renderOutboxWarn();
  flushOutbox();
}

/** Shows a change still in the outbox on the task (after a refresh, or from the copy kept on this device). */
function applyLocal(item) {
  const d = item.details || {};
  if (item.action === "setTaskStatus") { const t = taskById(d.id); if (t) showStatus(t, d.status); return; }
  if (item.action === "addTaskUpdate") {
    const t = taskById(d.id);
    if (t && !(t.updates || []).some((u) => u.id === d.clientId)) t.updates = [{ id: d.clientId, text: d.text, by: state.name, source: "portal", status: "", createdAt: item.at, sending: true }, ...(t.updates || [])];
    return;
  }
  if (item.action === "saveTask") {
    const f = d.task || {};
    let t = taskById(f.id || f.clientId);
    if (!t) {
      if (!f.clientId) return;
      t = { id: f.clientId, status: f.status || "todo", priority: "normal", createdBy: state.name, createdAt: item.at, updates: [], doneAt: "", checklist: [], labels: [], remind: [] };
      taskState.tasks.push(t);
    }
    ["title", "due", "department", "priority", "notes", "link", "remind", "labels", "checklist"].forEach((k) => { if (f[k] !== undefined) t[k] = f[k]; });
    if (f.owners) { t.owners = f.owners.slice(); t.owner = f.owners[0] || ""; }
    if (f.status) showStatus(t, f.status);
    t.sending = true;
  }
}
function applyOutbox() { outboxRead().forEach(applyLocal); }

async function flushOutbox() {
  if (taskState.outboxBusy || !state.token) return;
  taskState.outboxBusy = true;
  try {
    for (;;) {
      const item = outboxRead()[0];
      if (!item) break;
      taskState.outboxSending = item.key;
      const reply = await api(item.action, item.details, { quiet: true });
      taskState.outboxSending = "";
      if (!reply.ok && NETWORK_ERRORS.includes(reply.error)) {   // kept; sent again later
        taskState.outboxOffline = true;
        if (taskState.loaded) { renderTasks(); if (taskState.openId && taskState.draft) renderTaskDetail(); }
        break;
      }
      if (!reply.ok && reply.error === "NOT_LOGGED_IN") { taskSignedOut(reply); break; }                   // kept for after signing in
      outboxWrite(outboxRead().filter((x) => x.key !== item.key));
      taskState.outboxOffline = false;
      if (reply.ok) outboxDone(item, reply); else outboxRefused(item, reply);
    }
  } finally {
    taskState.outboxBusy = false;
    taskState.outboxSending = "";
    renderOutboxWarn();
  }
}

/** The server has it: take its copy of the task (and keep showing whatever is still waiting). */
function outboxDone(item, reply) {
  const saved = reply.task;
  if (saved) {
    const t = taskById(saved.id);
    if (t) { delete t.sending; Object.assign(t, saved, { updates: saved.updates || t.updates }); }
    else if (item.action === "saveTask") taskState.tasks.push({ updates: [], ...saved });
  }
  if (Array.isArray(reply.team)) taskState.team = reply.team;
  applyOutbox();
  Object.entries(taskState.pending).forEach(([id, p]) => { const t = taskById(id); if (t) showStatus(t, p.want); });
  renderTasks();
  if (taskState.openId && taskState.draft) renderTaskDetail();
  if (reply.stale) showToast(T.taskStale);
  const d = taskState.discord || {};
  if (item.action === "saveTask" && item.details.task && item.details.task.clientId && !reply.repeated) {
    showToast(reply.discordPosted ? T.taskAddedPosted : d.posting ? T.taskAddedNotPosted : T.taskAddedOnly, "success");
  }
  if (item.action === "addTaskUpdate" && !reply.repeated) {
    const named = Array.isArray(reply.mentioned) ? reply.mentioned : [];
    const reachable = named.filter((n) => { const p = teamPerson(n); return p && /^\d{17,20}$/.test(String(p.discordId || "")); });
    const unreachable = named.filter((n) => !reachable.includes(n));
    if (reply.discordPosted && reachable.length) showToast(T.taskPinged(reachable), "success");
    else if (unreachable.length) showToast(T.taskMentionedNoDiscord(unreachable));
  }
}

/** The server said no (not a connection problem): say why and show what is really saved. */
function outboxRefused(item, reply) {
  showToast(T.taskNotSaved(errorText(reply)));
  const f = (item.details && item.details.task) || {};
  if (f.clientId) taskState.tasks = taskState.tasks.filter((t) => t.id !== f.clientId);
  loadTasks();
}

function renderOutboxWarn() {
  const box = $("task-outbox-warn");
  if (!box) return;
  const n = outboxCount();
  box.hidden = !(n && taskState.outboxOffline);
  box.textContent = n ? T.taskOutboxOffline(n) : "";
}

window.addEventListener("online", () => flushOutbox());

// ---- "Who": type a name, pick from suggestions (or keep a new name: it gets added to People) ----------

function taskOwners(task) {
  return Array.isArray(task.owners) ? task.owners : task.owner ? [task.owner] : [];
}

/** Names A to Z, ignoring capitals. */
const byName = (a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: "base" });

/** "Amy, Bella, Chris +9" (A to Z) on the list and the board, so a task given to everyone stays one line. */
function ownersShort(task) {
  const names = taskOwners(task).slice().sort(byName);
  return names.length > 3 ? T.taskOwnersMore(names.slice(0, 3).join(", "), names.length - 3) : names.join(", ");
}

function renderSelectedOwners() {
  $("tk-owners").innerHTML = taskState.owners.map((name, i) => `<button type="button" class="chip" data-remove-owner="${i}" aria-label="${escapeHtml(T.taskOwnerRemove + " " + name)}">${escapeHtml(name)} <span aria-hidden="true">×</span></button>`).join("");
  $("tk-groups").innerHTML = groupButtonsHtml(taskState.owners, taskState.checklist);
}

// ---- Everyone, or a whole department, at once -------------------------------------------------------------
// Each person added this way also gets a checklist line with their name, to tick when they've done their part.
// (A Discord "done" from them ticks their line; reminders only tag the people who haven't ticked theirs.)

/** "Everyone", then each department with someone active in it: [{ key, label, names }]. key "" = everyone. */
function taskGroups() {
  const people = activeTeam();
  const names = (list) => [...new Map(list.map((p) => { const n = p.name.trim().replace(/\s+/g, " "); return [normName(n), n]; })).values()];
  const groups = [{ key: "", label: T.taskEveryone, names: names(people) }];
  TASK_DEPTS.forEach((d) => groups.push({ key: d, label: d, names: names(people.filter((p) => personDepts(p).includes(d))) }));
  return groups.filter((g) => g.names.length);
}

/** The "+ Everyone", "+ Events"… buttons. One that would add nobody new is greyed out. */
function groupButtonsHtml(owners, checklist) {
  return taskGroups().map((g) => {
    const all = g.names.every((n) => owners.some((o) => sameName(o, n)) && checklist.some((c) => sameName(c.text, n)));
    return `<button type="button" class="chip" data-group="${escapeHtml(g.key)}"${all ? " disabled" : ""}>+ ${escapeHtml(g.label)}</button>`;
  }).join("");
}

/**
 * People A to Z, and the checklist's name lines A to Z too (other checklist items keep their places).
 * Changes both lists in place.
 */
function sortPeople(owners, checklist) {
  owners.sort(byName);
  if (!checklist) return;
  const slots = [];
  checklist.forEach((c, i) => { if (owners.some((o) => sameName(o, c.text))) slots.push(i); });
  const lines = slots.map((i) => checklist[i]).sort((a, b) => byName(a.text, b.text));
  slots.forEach((i, k) => { checklist[i] = lines[k]; });
}

/** Adds a group's people, and a checklist line with each one's name. */
function addGroup(owners, checklist, key) {
  const group = taskGroups().find((g) => g.key === key);
  if (!group) return;
  let full = false;
  group.names.forEach((n) => {
    if (!owners.some((o) => sameName(o, n))) owners.push(n);
    if (checklist.some((c) => sameName(c.text, n))) return;
    if (checklist.length < CHECK_MAX) checklist.push({ id: "", text: n, done: false }); else full = true;
  });
  sortPeople(owners, checklist);
  if (full) showToast(T.taskTooManyItems);
}

/** One more person on a task that already has a line per person gets a line too. Call before adding them. */
function addNameLine(owners, checklist, name) {
  const perPerson = checklist.some((c) => owners.some((o) => sameName(o, c.text)));
  if (perPerson && !checklist.some((c) => sameName(c.text, name)) && checklist.length < CHECK_MAX) checklist.push({ id: "", text: name, done: false });
}

/** Someone taken off the task: their name line goes too, unless they had already ticked it. */
function dropNameLine(checklist, name) {
  const i = checklist.findIndex((c) => !c.done && sameName(c.text, name));
  if (i >= 0) checklist.splice(i, 1);
}

function ownerSuggestions(query, picked = taskState.owners) {
  const seen = new Set();
  const names = [];
  activeTeam().forEach((p) => { const n = p.name.trim().replace(/\s+/g, " "); if (!seen.has(normName(n))) { seen.add(normName(n)); names.push(n); } });
  if (state.name && !seen.has(normName(state.name))) names.push(state.name.trim());
  const q = normName(query);
  const score = (n) => {
    const s = normName(n);
    if (!q) return 0;
    if (s === q) return 0;
    if (s.startsWith(q)) return 1;
    if (s.split(" ").some((w) => w.startsWith(q))) return 2;
    return s.includes(q) ? 3 : -1;
  };
  return names.filter((name) => !picked.some((p) => sameName(p, name))).map((n) => [n, score(n)]).filter(([, s]) => s >= 0)
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).slice(0, q ? 8 : 100).map(([n]) => n);
}

function showOwnerList(everyone) {
  const input = $("tk-owner");
  const names = ownerSuggestions(everyone ? "" : input.value);
  const box = $("tk-owner-list");
  taskState.combo = { names, active: -1 };
  if (!names.length) return hideOwnerList();
  const q = normName(input.value);
  box.innerHTML = names.map((n, i) => {
    const at = everyone || !q ? -1 : n.toLowerCase().indexOf(q);
    const label = at < 0 ? escapeHtml(n) : escapeHtml(n.slice(0, at)) + "<b>" + escapeHtml(n.slice(at, at + q.length)) + "</b>" + escapeHtml(n.slice(at + q.length));
    return `<li role="option" id="tk-owner-opt-${i}" data-name="${escapeHtml(n)}" aria-selected="false">${label}</li>`;
  }).join("");
  box.hidden = false;
  input.setAttribute("aria-expanded", "true");
}

function hideOwnerList() {
  $("tk-owner-list").hidden = true;
  $("tk-owner").setAttribute("aria-expanded", "false");
  $("tk-owner").removeAttribute("aria-activedescendant");
  taskState.combo.active = -1;
}

function moveOwnerActive(step) {
  const c = taskState.combo;
  if (!c.names.length) return;
  c.active = (c.active + step + c.names.length) % c.names.length;
  document.querySelectorAll("#tk-owner-list [role=option]").forEach((li, i) => {
    li.classList.toggle("active", i === c.active);
    li.setAttribute("aria-selected", String(i === c.active));
    if (i === c.active) li.scrollIntoView({ block: "nearest" });
  });
  $("tk-owner").setAttribute("aria-activedescendant", "tk-owner-opt-" + c.active);
}

function pickOwner(name) {
  const typed = String(name || "").trim().replace(/\s+/g, " ");
  if (!typed) return;
  const person = teamPerson(typed);
  const canonical = person ? person.name.trim() : typed;
  if (!taskState.owners.length && !taskState.deptTouched) $("tk-dept").value = deptFor(canonical);
  if (!taskState.owners.some((picked) => sameName(picked, canonical))) {
    addNameLine(taskState.owners, taskState.checklist, canonical);
    taskState.owners.push(canonical);
    sortPeople(taskState.owners, taskState.checklist);
  }
  $("tk-owner").value = "";
  renderSelectedOwners();
  hideOwnerList();
  $("tk-owner").focus();
}

function syncDeptFromOwner() {
  if (taskState.deptTouched || taskState.owners.length) return;
  const p = teamPerson($("tk-owner").value);
  if (p && TASK_DEPTS.includes(p.department)) $("tk-dept").value = p.department;
}

function onOwnerKeydown(e) {
  const open = !$("tk-owner-list").hidden;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if (!open) { showOwnerList(!!teamPerson($("tk-owner").value)); if ($("tk-owner-list").hidden) return; }
    moveOwnerActive(e.key === "ArrowDown" ? 1 : -1);
  } else if (e.key === "Enter" && (taskState.combo.active >= 0 || $("tk-owner").value.trim())) {
    e.preventDefault();
    e.stopPropagation();   // picks the name; doesn't save the task yet
    pickOwner(open && taskState.combo.active >= 0 ? taskState.combo.names[taskState.combo.active] : $("tk-owner").value);
  } else if (e.key === "Escape" && open) {
    e.preventDefault();
    e.stopPropagation();   // closes the suggestions, not the dialog
    hideOwnerList();
  } else if (e.key === "Tab") hideOwnerList();
}

// ---- Reminders: rows like Google Calendar ("1 day before at 09:00") ------------------------------------

function cleanReminder(r) {
  const n = Math.max(0, Math.min(60, Math.floor(Number(r && r.n)) || 0));
  return { n, unit: r && r.unit === "weeks" ? "weeks" : "days", at: /^\d{2}:\d{2}$/.test(String(r && r.at)) ? r.at : "09:00" };
}

/** The task's reminders as [{n, unit, at}], also reading the older one-word rules. */
function remindersOf(task) {
  let remind = task && task.remind;
  if (typeof remind === "string" && remind.trim().startsWith("[")) { try { remind = JSON.parse(remind); } catch (e) { remind = ""; } }
  if (Array.isArray(remind)) return remind.slice(0, REM_MAX).map(cleanReminder);
  if (task && Array.isArray(task.reminders) && task.reminders.length) return task.reminders.slice(0, REM_MAX).map(cleanReminder);
  const rule = String(remind || "").trim().toLowerCase();
  const due = taskIso(task && task.due);
  const out = [];
  const halfway = () => { const made = mountainDay(task.createdAt); if (due && made) out.push({ n: Math.max(0, Math.floor(isoDaysFrom(made, due) / 2)), unit: "days", at: "09:00" }); };
  if (rule === "halfway" || rule === "both") halfway();
  if (rule === "daybefore" || rule === "both") out.push({ n: 1, unit: "days", at: "09:00" });
  if (/^\d{4}-\d{2}-\d{2}$/.test(rule) && due) out.push({ n: Math.max(0, isoDaysFrom(rule, due)), unit: "days", at: "09:00" });
  return out.map(cleanReminder);
}

function unitOptions(n, unit) {
  const plural = Number(n) === 1 ? 0 : 1;
  return ["days", "weeks"].map((u) => `<option value="${u}"${u === unit ? " selected" : ""}>${escapeHtml(T.taskRemUnits[u][plural])}</option>`).join("");
}

function reminderRowHtml(r) {
  const x = cleanReminder(r);
  return `<div class="rem-row">
    <svg class="rem-bell" aria-hidden="true"><use href="#i-bell"/></svg>
    <input type="number" class="rem-n" min="0" max="60" step="1" inputmode="numeric" value="${x.n}" aria-label="${escapeHtml(T.taskRemNumber)}">
    <select class="rem-unit" aria-label="${escapeHtml(T.taskRemUnit)}">${unitOptions(x.n, x.unit)}</select>
    <span class="rem-text">${escapeHtml(T.taskRemBefore)}</span>
    <input type="time" class="rem-at" value="${x.at}" aria-label="${escapeHtml(T.taskRemTime)}">
    <button type="button" class="icon-btn rem-x" title="${escapeHtml(T.taskRemRemove)}" aria-label="${escapeHtml(T.taskRemRemove)}"><svg><use href="#i-x"/></svg></button>
  </div>`;
}

function readReminderRows() {
  return [...document.querySelectorAll("#tk-reminders .rem-row")].map((row) => ({
    n: row.querySelector(".rem-n").value.trim(),
    unit: row.querySelector(".rem-unit").value,
    at: row.querySelector(".rem-at").value
  }));
}

function syncReminderAdd() {
  $("tk-rem-add").hidden = document.querySelectorAll("#tk-reminders .rem-row").length >= REM_MAX;
}

function addReminderRow() {
  const have = readReminderRows().map((r) => `${Number(r.n)}${r.unit}`);
  const next = [{ n: 1, unit: "days" }, { n: 0, unit: "days" }, { n: 2, unit: "days" }, { n: 1, unit: "weeks" }, { n: 3, unit: "days" }]
    .find((r) => !have.includes(`${r.n}${r.unit}`)) || { n: 1, unit: "days" };
  $("tk-reminders").insertAdjacentHTML("beforeend", reminderRowHtml({ ...next, at: "09:00" }));
  syncReminderAdd();
  $("tk-reminders").lastElementChild.querySelector(".rem-n").focus();
}

// ---- New / edit ---------------------------------------------------------------------------------------

function deptFor(owner) {
  const first = personDepts(teamPerson(owner)).find((d) => TASK_DEPTS.includes(d));
  return first || "General";
}

/** The Department choices. A task whose department was removed from the list since keeps it as a choice. */
function fillDeptSelect(current) {
  const list = TASK_DEPTS.slice();
  if (current && !list.includes(current)) list.splice(Math.max(0, list.length - 1), 0, current);
  $("tk-dept").innerHTML = list.map((d) => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join("");
}

function syncQuickChips() {
  const value = $("tk-due").value;
  document.querySelectorAll("#tk-quick [data-quick]").forEach((b) => b.classList.toggle("active", quickDate(b.dataset.quick) === value));
}

/** task: the task to edit, or null for a new one. due: a starting due date for a new one (from the calendar). */
function openTaskDialog(task, due, status = "todo") {
  closeStatusMenu();
  taskState.editing = task || null;
  taskState.newStatus = TASK_STATUSES.includes(status) ? status : "todo";
  taskState.formLabels = task ? taskLabels(task).slice() : [];
  taskState.deptTouched = !!task;
  $("task-dialog-title").textContent = task ? T.taskDialogEdit : T.taskDialogNew;
  $("tk-save").textContent = task ? T.taskSave : T.taskAdd;
  $("tk-save").disabled = false;
  $("tk-error").hidden = true;
  $("tk-title").value = task ? task.title || "" : "";
  fillPrioritySelect("tk-priority", taskPriority(task));
  const deptFilter = TASK_DEPTS.includes(taskState.filter) ? taskState.filter : "";
  const me = teamPerson(state.name);
  taskState.owners = task ? taskOwners(task).slice() : [me ? me.name.trim() : String(state.name || "").trim()].filter(Boolean);
  // The checklist isn't shown here, but Everyone / a department adds a line per person to it.
  taskState.checklist = task ? taskChecklist(task).map((c) => ({ id: c.id || "", text: c.text, done: !!c.done })) : [];
  sortPeople(taskState.owners, taskState.checklist);   // shown A to Z; only sent when something else changes them
  taskState.checklistBase = JSON.stringify(taskState.checklist);
  $("tk-owner").value = "";
  renderSelectedOwners();
  hideOwnerList();
  $("tk-due").value = task ? taskIso(task.due) : taskIso(due);
  fillDeptSelect(task && task.department);
  $("tk-dept").value = task ? task.department || "General" : (deptFilter || deptFor(taskState.owners[0]));
  if (!task && deptFilter) taskState.deptTouched = true;
  $("tk-reminders").innerHTML = (task ? remindersOf(task) : []).map(reminderRowHtml).join("");
  syncReminderAdd();
  $("tk-notes").value = task ? task.notes || "" : "";
  $("tk-link").value = task ? task.link || "" : "";
  $("tk-more").open = !!(task && (task.notes || task.link));
  syncQuickChips();
  $("task-dialog").showModal();
  taskState.formBase = taskFormSnapshot();
  $("tk-title").focus();
}

/** Everything in the New/Edit form, to tell whether something was changed. */
function taskFormSnapshot() {
  return JSON.stringify([$("tk-title").value.trim(), taskState.owners, taskState.checklist, $("tk-owner").value.trim(), $("tk-due").value, $("tk-dept").value,
    readReminderRows(), $("tk-notes").value.trim(), $("tk-link").value.trim(), $("tk-priority").value]);
}

/** Cancel, Escape or a tap outside the New/Edit form: closes it, asking first when something was changed. */
async function closeTaskDialog() {
  if ($("tk-save").disabled) return;   // saving
  if (taskFormSnapshot() !== taskState.formBase && !(await askConfirm(T.taskDiscardConfirm, T.taskDiscard))) return;
  hideOwnerList();
  $("task-dialog").close();
}

async function onTaskSubmit(event) {
  event.preventDefault();
  if ($("tk-save").disabled) return;
  hideOwnerList();
  const showError = (text) => { $("tk-error").textContent = text; $("tk-error").hidden = false; };
  $("tk-error").hidden = true;
  const title = $("tk-title").value.trim();
  if (!title) { $("tk-title").focus(); return showError(T.taskTitleNeeded); }
  const rows = readReminderRows();
  const bad = rows.findIndex((r) => !/^\d{1,2}$/.test(r.n) || Number(r.n) > 60 || !/^\d{2}:\d{2}$/.test(r.at));
  if (bad >= 0) { document.querySelectorAll("#tk-reminders .rem-row")[bad].querySelector(".rem-n").focus(); return showError(T.taskRemBad); }
  const editing = taskState.editing;
  // Typed the name in a different case? Use the spelling on the People list.
  if ($("tk-owner").value.trim()) pickOwner($("tk-owner").value);
  const task = {
    id: editing ? editing.id : "",
    title,
    owners: taskState.owners.slice(),
    due: $("tk-due").value,
    department: $("tk-dept").value,
    notes: $("tk-notes").value.trim(),
    link: $("tk-link").value.trim(),
    remind: rows.map(cleanReminder)
  };
  if (!editing || $("tk-priority").value !== taskPriority(editing)) task.priority = $("tk-priority").value;
  if (!editing) { task.status = taskState.newStatus; task.labels = taskState.formLabels.slice(); }
  // Name lines added with Everyone / a department (or taken off with a person): sent only when they changed.
  if (editing ? JSON.stringify(taskState.checklist) !== taskState.checklistBase : taskState.checklist.length) task.checklist = taskState.checklist.map((c) => ({ ...c }));
  // A new task gets its name here, so it can show straight away and a repeat send is never added twice.
  if (!editing) { delete task.id; task.clientId = newLocalId("TK"); }
  task.owners.forEach((name) => { if (!teamPerson(name)) taskState.team.push({ id: "", name, department: task.department, discordId: "", active: true }); });
  $("task-dialog").close();
  // Shown at once; saved in the background (and kept on this device until the server has it).
  const item = { action: "saveTask", details: { task } };
  applyLocal({ ...item, at: new Date().toISOString() });
  renderTasks();
  if (editing && taskState.openId === editing.id && $("task-detail-dialog").open) renderTaskDetail();
  if (editing) showToast(T.taskSaved, "success");   // a new task says whether it reached Discord once the server has it
  outboxAdd(item);
}

// ---- Detail ---------------------------------------------------------------------------------------------

/*
 * The task window. Status, people, labels and the checklist can be changed right here, but nothing is saved until Save.
 * Closing it any other way (Close, Escape, a tap outside it) with changes asks first. Posting an update is saved at once.
 */
function draftOf(task) {
  const draft = { status: task.status, priority: taskPriority(task), owners: taskOwners(task).slice(), labels: taskLabels(task).slice(),
    checklist: taskChecklist(task).map((c) => ({ id: c.id || "", text: c.text, done: !!c.done })) };
  sortPeople(draft.owners, draft.checklist);   // shown A to Z (the draft's starting point is sorted too, so this alone isn't a change)
  return draft;
}
const draftChanged = () => !!taskState.draft && JSON.stringify(taskState.draft) !== taskState.draftBase;

function openTaskDetail(id) {
  closeStatusMenu();
  const task = taskById(id);
  if (!task) return;
  taskState.openId = id;
  taskState.draft = draftOf(task);
  taskState.draftBase = JSON.stringify(taskState.draft);
  $("td-update-text").value = "";
  hideMentions();
  $("td-error").hidden = true;
  $("td-post").disabled = false;
  $("td-post").textContent = T.taskPost;
  $("td-close").disabled = false;
  $("td-person-add").hidden = true;
  $("td-label-add").hidden = true;
  $("td-person").value = "";
  $("td-label").value = "";
  $("td-check-new").value = "";
  $("td-copy-link").textContent = T.taskCopyLink;
  $("td-link-fallback").hidden = true;
  renderTaskDetail();
  $("task-detail-dialog").showModal();
  // Ready to type an update on a computer; on a touch screen don't pop the keyboard up.
  (matchMedia("(pointer: coarse)").matches ? $("td-close") : $("td-update-text")).focus();
}

/** Close the task window; with unsaved changes, ask first. Answers whether it closed. */
async function closeTaskDetail() {
  if (draftChanged() && !(await askConfirm(T.taskDiscardConfirm, T.taskDiscard))) return false;
  $("task-detail-dialog").close();
  return true;
}

function renderDraftButton() {
  const changed = draftChanged();
  $("td-close").textContent = changed ? T.taskSave : T.taskClose;
  $("td-close").classList.toggle("changed", changed);
}

function renderTaskDetail() {
  const t = taskById(taskState.openId);
  const d = taskState.draft;
  if (!t || !d) return;
  $("td-title").textContent = t.title;
  const link = /^https?:\/\//i.test(t.link || "") ? `<a class="link" href="${escapeHtml(t.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(T.taskLink)}</a>` : "";
  $("td-meta").innerHTML = [dueChip({ ...t, status: d.status }), reminderChip({ ...t, status: d.status }, true),
    `<span class="muted">${escapeHtml(t.department || "General")}</span>`, link].filter(Boolean).join("");
  $("td-notes").hidden = !t.notes;
  $("td-notes").textContent = t.notes || "";
  let here = "";
  try { here = taskLink(t.id); } catch (e) { /* no address to link back to */ }
  const gcal = googleCalendarUrl(t.title, taskIso(t.due), here);
  $("td-gcal").hidden = !gcal;
  if (gcal) $("td-gcal").href = gcal; else $("td-gcal").removeAttribute("href");
  $("td-status").innerHTML = TASK_STATUSES.map((s) =>
    `<button type="button" class="chip${s === d.status ? " active" : ""}" data-detail-status="${s}" aria-pressed="${s === d.status}">${escapeHtml(statusLabel(s))}</button>`).join("");
  fillPrioritySelect("td-priority", d.priority);
  // People and labels: a chip each (× takes it off), then "+ Add"
  $("td-people").innerHTML = d.owners.map((n, i) =>
    `<button type="button" class="chip td-chip" data-remove-person="${i}" aria-label="${escapeHtml(T.taskOwnerRemove + " " + n)}">${escapeHtml(n)} <span aria-hidden="true">×</span></button>`).join("") +
    `<button type="button" class="chip td-add-chip" id="td-person-open">+ ${escapeHtml(T.taskAddPerson)}</button>`;
  $("td-labels").innerHTML = d.labels.map((l, i) =>
    `<button type="button" class="task-label lab-${labelHue(l)} td-chip" data-remove-label="${i}" aria-label="${escapeHtml(T.taskOwnerRemove + " " + l)}">${escapeHtml(l)} <span aria-hidden="true">×</span></button>`).join("") +
    (d.labels.length < 6 ? `<button type="button" class="chip td-add-chip" id="td-label-open">+ ${escapeHtml(T.taskAddLabel)}</button>` : "");
  const people = ownerSuggestions("", d.owners);
  $("td-people-names").innerHTML = people.map((n) => `<option value="${escapeHtml(n)}"></option>`).join("");
  $("td-groups").innerHTML = groupButtonsHtml(d.owners, d.checklist);
  $("td-label-names").innerHTML = allLabels().filter((l) => !d.labels.some((x) => sameName(x, l))).map((l) => `<option value="${escapeHtml(l)}"></option>`).join("");
  // Checklist
  const done = d.checklist.filter((c) => c.done).length;
  $("td-check-count").textContent = d.checklist.length ? `${done}/${d.checklist.length}` : "";
  $("td-check-count").hidden = !d.checklist.length;
  $("td-checklist").innerHTML = d.checklist.map((c, i) => `<li class="td-check${c.done ? " done" : ""}">
    <label><input type="checkbox" data-check="${i}"${c.done ? " checked" : ""}> <span>${escapeHtml(c.text)}</span></label>
    <button type="button" class="icon-btn" data-uncheck-item="${i}" title="${escapeHtml(T.taskChecklistRemove)}" aria-label="${escapeHtml(T.taskChecklistRemove)}"><svg><use href="#i-x"/></svg></button>
  </li>`).join("");
  $("td-check-new").hidden = d.checklist.length >= CHECK_MAX;
  renderDraftButton();
  const updates = t.updates || [];
  $("td-updates").innerHTML = updates.length ? updates.map((u) => {
    const mark = u.source === "discord" ? discordMark() : "";
    const when = u.sending ? escapeHtml(taskState.outboxOffline ? T.taskNotSent : T.taskSending) : escapeHtml(taskAgo(u.createdAt));
    const statusPill = u.status ? `<span class="task-status st-${escapeHtml(u.status)} mini">${escapeHtml(statusLabel(u.status))}</span>` : "";
    if (!String(u.text || "").trim()) {
      return `<li class="task-update quiet"><span>${escapeHtml(T.taskSetTo(u.by || "", statusLabel(u.status)))}</span>${mark}<span class="muted">${when}</span></li>`;
    }
    return `<li class="task-update"><div class="task-update-h"><strong>${escapeHtml(u.by || "")}</strong>${mark}<span class="muted">${when}</span>${statusPill}</div>
      <p>${escapeHtml(u.text)}</p></li>`;
  }).join("") : `<li class="muted small">${escapeHtml(T.taskNoUpdates)}</li>`;
}

/** A typed name as the People list spells it: the exact name, or the one person whose first name it is. */
function personByTyped(typed) {
  const exact = teamPerson(typed);
  if (exact) return exact.name.trim();
  const key = normName(typed);
  const matches = activeTeam().filter((p) => normName(p.name).split(" ")[0] === key || normName(p.name).startsWith(key + " "));
  return matches.length === 1 ? matches[0].name.trim() : String(typed || "").trim().replace(/\s+/g, " ");
}

function draftAddPerson(typed) {
  const d = taskState.draft;
  if (!d || !String(typed || "").trim()) return;
  const name = personByTyped(typed);
  if (!d.owners.some((n) => sameName(n, name))) {
    addNameLine(d.owners, d.checklist, name);
    d.owners.push(name);
    sortPeople(d.owners, d.checklist);
  }
  $("td-person").value = "";
  renderTaskDetail();
  $("td-person").focus();
}

function draftAddLabel(typed) {
  const d = taskState.draft;
  const raw = String(typed || "").trim().replace(/\s+/g, " ").slice(0, 24);
  if (!d || !raw) return;
  if (d.labels.length >= 6) return showToast(T.taskTooManyLabels);
  const existing = allLabels().find((l) => sameName(l, raw));   // the spelling already in use
  if (!d.labels.some((l) => sameName(l, raw))) d.labels.push(existing || raw);
  $("td-label").value = "";
  renderTaskDetail();
  if (d.labels.length < 6) $("td-label").focus(); else $("td-label-add").hidden = true;
}

function draftAddCheck() {
  const d = taskState.draft;
  const text = $("td-check-new").value.trim().replace(/\s+/g, " ").slice(0, 200);
  if (!d || !text) return;
  if (d.checklist.length >= CHECK_MAX) return showToast(T.taskTooManyItems);
  d.checklist.push({ id: "", text, done: false });
  $("td-check-new").value = "";
  renderTaskDetail();
  $("td-check-new").focus();
}

/** Save: sends only what changed in the task window, in one request. */
async function saveTaskDetail() {
  const id = taskState.openId;
  const t = taskById(id);
  const d = taskState.draft;
  if (!t || !d) return;
  // Something typed in an "add" box but not added yet counts too.
  if ($("td-person").value.trim()) draftAddPerson($("td-person").value);
  if ($("td-label").value.trim()) draftAddLabel($("td-label").value);
  if ($("td-check-new").value.trim()) draftAddCheck();
  if (!draftChanged()) return $("task-detail-dialog").close();
  const base = JSON.parse(taskState.draftBase);
  const task = { id };
  ["status", "priority", "owners", "labels", "checklist"].forEach((k) => { if (JSON.stringify(d[k]) !== JSON.stringify(base[k])) task[k] = d[k]; });
  if (task.status) {
    task.from = base.status;   // so it can't undo someone else's newer change
    const p = taskState.pending[id];
    if (p) { clearTimeout(p.timer); delete taskState.pending[id]; }
  }
  (task.owners || []).forEach((name) => { if (!teamPerson(name)) taskState.team.push({ id: "", name, department: t.department, discordId: "", active: true }); });
  taskState.draftBase = JSON.stringify(taskState.draft);   // closing no longer asks
  $("task-detail-dialog").close();
  // Shown at once; saved in the background (and kept on this device until the server has it).
  const item = { action: "saveTask", details: { task } };
  applyLocal(item);
  renderTasks();
  showToast(T.taskSaved, "success");
  outboxAdd(item);
}

// ---- @name in an update: suggestions while typing ---------------------------------------------------------

/** The "@na" being typed just before the cursor, or null. */
function mentionQuery() {
  const box = $("td-update-text");
  const before = box.value.slice(0, box.selectionStart);
  const m = before.match(/(^|\s)@([^\s@]*(?: [^\s@]*)?)$/);
  return m ? { start: before.length - m[2].length - 1, text: m[2] } : null;
}

function showMentions() {
  const q = mentionQuery();
  if (!q) return hideMentions();
  const names = ownerSuggestions(q.text, []).slice(0, 6);
  if (!names.length) return hideMentions();
  taskState.mention = { names, active: 0, start: q.start };
  $("td-mention-list").innerHTML = names.map((n, i) => `<li role="option" data-mention="${escapeHtml(n)}" class="${i === 0 ? "active" : ""}" aria-selected="${i === 0}">${escapeHtml(n)}</li>`).join("");
  $("td-mention-list").hidden = false;
}

function hideMentions() {
  $("td-mention-list").hidden = true;
  taskState.mention = { names: [], active: -1, start: -1 };
}

function pickMention(name) {
  const box = $("td-update-text");
  const m = taskState.mention;
  if (m.start < 0) return;
  const after = box.value.slice(box.selectionStart);
  const text = box.value.slice(0, m.start) + "@" + name + " ";
  box.value = text + after.replace(/^\S*/, "");
  box.setSelectionRange(text.length, text.length);
  hideMentions();
  box.focus();
}

function onMentionKey(e) {
  const m = taskState.mention;
  if ($("td-mention-list").hidden || !m.names.length) return false;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    m.active = (m.active + (e.key === "ArrowDown" ? 1 : -1) + m.names.length) % m.names.length;
    document.querySelectorAll("#td-mention-list li").forEach((li, i) => { li.classList.toggle("active", i === m.active); li.setAttribute("aria-selected", String(i === m.active)); });
    return true;
  }
  if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pickMention(m.names[Math.max(0, m.active)]); return true; }
  if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); hideMentions(); return true; }
  return false;
}

async function onUpdateSubmit(event) {
  event.preventDefault();
  hideMentions();
  const id = taskState.openId;
  const text = $("td-update-text").value.trim();
  if (!id || !text) return;
  if (text.length > 1000) { $("td-error").textContent = T.taskUpdateTooLong; $("td-error").hidden = false; return; }
  $("td-error").hidden = true;
  const item = { action: "addTaskUpdate", details: { id, text, clientId: newLocalId("TU") } };
  applyLocal({ ...item, at: new Date().toISOString() });
  $("td-update-text").value = "";
  renderTaskDetail();
  renderTasks();
  outboxAdd(item);
}

async function removeOpenTask() {
  const t = taskById(taskState.openId);
  if (!t || !(await askConfirm(T.taskRemoveConfirm(t.title), T.taskRemove))) return;
  const reply = await api("removeTask", { id: t.id });
  if (!reply.ok) {
    if (taskSignedOut(reply)) return;
    $("td-error").textContent = errorText(reply);
    $("td-error").hidden = false;
    return;
  }
  $("task-detail-dialog").close();
  taskState.tasks = taskState.tasks.filter((x) => x.id !== t.id);
  renderTasks();
  showToast(T.taskRemoved);
}

// ---- Quick add: one sentence ("posters for AGM by friday @Chris") that the server reads ------------------
// It needs the server to read the sentence, so it is not kept on this device and never sent again on a guess: if it
// doesn't go through, the sentence stays in the box. (New task works without a connection.)

async function sendQuickAdd(event) {
  if (event && event.preventDefault) event.preventDefault();
  const box = $("task-quick-add");
  const text = String(box.value || "").trim().replace(/\s+/g, " ");
  if (!text || box.disabled) return;
  // The same sentence sent again after a failure keeps its name, so the server can never add it twice.
  const again = taskState.quickSend && taskState.quickSend.text === text;
  const clientId = again ? taskState.quickSend.clientId : newLocalId("TK");
  taskState.quickSend = { text, clientId };
  box.disabled = true;
  let reply;
  try { reply = await api("quickAddTask", { text, clientId }); } catch (e) { reply = null; } finally { box.disabled = false; }
  reply = reply || { ok: false, error: "DEFAULT" };
  if (!reply.ok) {
    if (taskSignedOut(reply)) return;
    showToast(reply.error === "NETWORK" ? T.taskQuickOffline : errorText(reply));
    box.focus();
    return;
  }
  taskState.quickSend = null;
  box.value = "";
  const saved = reply.task;
  if (saved && saved.id) {
    const i = taskState.tasks.findIndex((t) => t.id === saved.id);
    const task = { updates: [], ...saved };
    if (i >= 0) taskState.tasks[i] = task; else taskState.tasks.push(task);
  }
  if (Array.isArray(reply.team)) taskState.team = reply.team;
  renderTasks();
  showToast(quickAddedText(reply), "success");
  if (!matchMedia("(pointer: coarse)").matches) box.focus();   // ready for the next one (a phone keeps its keyboard down)
}

/** "Task added: Posters for AGM · Chris · Fri, Nov 28. Posted on Discord." */
function quickAddedText(reply) {
  const q = reply.quick || {}, t = reply.task || {};
  const title = String(q.title || t.title || "").trim();
  const owners = Array.isArray(q.owners) ? q.owners : taskOwners(t);
  const due = taskIso(q.due !== undefined ? q.due : t.due);
  const when = due ? isoText(due, { weekday: "short", month: "short", day: "numeric" }) : T.taskQuickNoDate;
  const parts = [T.taskQuickAdded(title, ownersShort({ owners }) || T.taskNobody, when)];
  if (reply.discordPosted) parts.push(T.taskQuickPosted);
  else if ((taskState.discord || {}).posting) parts.push(T.taskQuickNotPosted);
  if (q.remindNeedsDue) parts.push(T.taskQuickRemindNeedsDue);
  return parts.join(" ");
}

// ---- Remind on Discord ---------------------------------------------------------------------------------

/**
 * The New task window filled in from a task-like object (Duplicate, or a preset from Teams): a NEW task, To do, with
 * the checklist unticked. Nothing is saved until Add task. keepDept: the department stays when people are picked.
 */
function openNewTaskFrom(source, keepDept = true) {
  openTaskDialog(source);
  taskState.editing = null;
  taskState.newStatus = "todo";
  taskState.deptTouched = keepDept;
  taskState.checklist = taskChecklist(source).map((c) => ({ id: "", text: c.text, done: false }));
  sortPeople(taskState.owners, taskState.checklist);
  taskState.checklistBase = "[]";
  $("task-dialog-title").textContent = T.taskDialogNew;
  $("tk-save").textContent = T.taskAdd;
  syncQuickChips();
  taskState.formBase = taskFormSnapshot();   // closing it untouched doesn't ask
}

/** Duplicate saved details into a new task (no due date, "(copy)" on the name); nothing is saved until Add task. */
async function duplicateOpenTask() {
  const t = taskById(taskState.openId);
  if (!t || !(await closeTaskDetail())) return;
  openNewTaskFrom({ ...t, title: String(t.title || "").slice(0, 140 - T.taskCopySuffix.length) + T.taskCopySuffix, due: "", remind: remindersOf(t) });
}

/**
 * For other tabs (Teams): go to Tasks and open the New task window filled in from
 * preset { title, due, owners, department, notes, priority, labels, checklist } (any can be left out).
 * Nothing is saved until Add task. Answers whether the window opened (not when leaving the other tab was cancelled).
 */
async function newTaskFrom(preset) {
  const p = preset && typeof preset === "object" ? preset : {};
  const tab = document.querySelector('.tab[data-tab="tasks"]');
  if (typeof switchTab === "function") await switchTab("tasks");
  else if (tab && typeof tab.click === "function") tab.click();
  if (tab && tab.classList && typeof tab.classList.contains === "function" && !tab.classList.contains("active")) return false;
  const clean = (v, max) => String(v == null ? "" : v).trim().replace(/\s+/g, " ").slice(0, max);
  const unique = (list) => [...new Map(list.map((x) => [normName(x), x])).values()];
  // The people given (spelled as on People), A to Z. Nobody given: you, as with New task.
  const me = teamPerson(state.name);
  const given = unique((Array.isArray(p.owners) ? p.owners : []).map((n) => clean(n, 60)).filter(Boolean)
    .map((n) => { const person = teamPerson(n); return person ? person.name.trim() : n; }));
  const owners = given.length ? given : [me ? me.name.trim() : clean(state.name, 60)].filter(Boolean);
  const deptGiven = clean(p.department, 60) !== "";
  const deptFilter = TASK_DEPTS.includes(taskState.filter) ? taskState.filter : "";
  const department = deptGiven ? TASK_DEPTS.find((d) => sameName(d, p.department)) || "General" : deptFilter || deptFor(owners[0]);
  const labels = unique((Array.isArray(p.labels) ? p.labels : []).map((l) => clean(l, 24)).filter(Boolean)
    .map((l) => allLabels().find((x) => sameName(x, l)) || l)).slice(0, 6);
  const checklist = (Array.isArray(p.checklist) ? p.checklist : []).map((c) => clean(c && typeof c === "object" ? c.text : c, 200))
    .filter(Boolean).slice(0, CHECK_MAX).map((text) => ({ id: "", text, done: false }));
  openNewTaskFrom({ title: clean(p.title, 140), due: taskIso(p.due), owners, department, notes: String(p.notes == null ? "" : p.notes).trim().slice(0, 1000),
    link: "", remind: [], priority: taskPriority(p), labels, checklist }, deptGiven || !!deptFilter);
  return true;
}

/** A Google Calendar "add event" link: an all-day event on that day ("yyyy-mm-dd"), or "" for anything else. Teams uses it too. */
function googleCalendarUrl(title, day, details) {
  const iso = String(day == null ? "" : day);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  const start = isoDate(iso);
  if (isNaN(start) || start.toISOString().slice(0, 10) !== iso) return "";   // e.g. Feb 30
  const dates = iso.replace(/-/g, "") + "/" + isoAddDays(iso, 1).replace(/-/g, "");
  return "https://calendar.google.com/calendar/render?action=TEMPLATE&text=" + encodeURIComponent(String(title == null ? "" : title)) +
    "&dates=" + encodeURIComponent(dates) + (details ? "&details=" + encodeURIComponent(String(details)) : "");
}

function taskLink(id) {
  const url = new URL(location.href);
  url.search = ""; url.hash = "";
  url.searchParams.set("task", id);
  return url.href;
}
async function copyTaskLink() {
  if (!taskState.openId) return;
  const url = taskLink(taskState.openId);
  try {
    await navigator.clipboard.writeText(url);
    $("td-copy-link").textContent = T.taskLinkCopied;
  } catch (e) {
    $("td-link-fallback").value = url;
    $("td-link-fallback").hidden = false;
    $("td-link-fallback").focus();
    if ($("td-link-fallback").select) $("td-link-fallback").select();
    $("td-copy-link").textContent = T.taskLinkSelect;
  }
}

/** Only called after a fresh successful list, so a stale saved copy cannot say a task is gone. */
function openLinkedTask() {
  let id = "";
  try { id = new URLSearchParams(location.search).get("task") || ""; } catch (e) { return; }
  if (!id) return;
  try { const url = new URL(location.href); url.searchParams.delete("task"); history.replaceState(null, "", url.href); } catch (e) { /* still opens the task */ }
  if (taskById(id)) openTaskDetail(id);
  else showToast(T.taskGone);
}

async function remindOnDiscord() {
  if (!(await askConfirm(T.taskRemindConfirm, T.taskRemindYes))) return;
  const button = $("task-remind-button");
  button.disabled = true;
  const reply = await api("remindTasksOnDiscord");
  button.disabled = !(taskState.discord || {}).posting;
  if (!reply.ok) { if (taskSignedOut(reply)) return; return showToast(errorText(reply)); }
  showToast(reply.posted ? T.taskReminded(reply.count || 0) : reply.count ? T.taskRemindFailed : T.taskRemindNothing, reply.posted ? "success" : undefined);
}

// ---- Wiring ---------------------------------------------------------------------------------------------

/** Clicks in a list of task rows (the list view, and the lists under the calendar). */
function onTaskListClick(e) {
  const pill = e.target.closest("[data-status-for]");
  if (pill) { e.stopPropagation(); return openStatusMenu(pill); }
  if (e.target.closest("summary")) return;
  const row = e.target.closest("[data-task-id]");
  if (row) openTaskDetail(row.dataset.taskId);
}
function onTaskListKey(e) {
  if ((e.key === "Enter" || e.key === " ") && e.target.matches("[data-task-id]")) { e.preventDefault(); openTaskDetail(e.target.dataset.taskId); }
}

(function setUpTasks() {
  $("task-refresh").title = T.taskRefresh;
  $("task-refresh").setAttribute("aria-label", T.taskRefresh);
  document.querySelectorAll("#tk-quick [data-quick]").forEach((b) => { b.textContent = T.taskQuick[b.dataset.quick]; });
  document.querySelectorAll("#task-view [data-task-view]").forEach((b) => { b.textContent = T.taskViews[b.dataset.taskView]; });
  $("task-view").setAttribute("aria-label", T.taskViewLabel);
  [["cal-prev", T.calPrev], ["cal-next", T.calNext]].forEach(([id, label]) => { $(id).title = label; $(id).setAttribute("aria-label", label); });
  fillDeptSelect("");
  $("td-update-text").placeholder = T.taskAddUpdate;

  $("task-new-button").addEventListener("click", () => openTaskDialog(null));
  $("task-empty-new").addEventListener("click", () => openTaskDialog(null));
  $("task-refresh").addEventListener("click", loadTasks);
  $("task-remind-button").addEventListener("click", remindOnDiscord);
  $("task-search").placeholder = T.taskSearch;
  $("task-search").setAttribute("aria-label", T.taskSearch);
  $("task-search").addEventListener("input", () => { taskState.search = $("task-search").value; closeStatusMenu(); renderTasks(); });
  $("task-person-filter").setAttribute("aria-label", T.taskPersonFilter);
  $("task-person-filter").addEventListener("change", () => {
    taskState.person = $("task-person-filter").value;
    if (taskState.person && taskState.filter === "mine") taskState.filter = "all";
    closeStatusMenu(); renderTasks();
  });
  $("task-clear-filters").addEventListener("click", clearTaskFilters);
  $("task-quick-add").placeholder = T.taskQuickPlaceholder;
  $("task-quick-add").setAttribute("aria-label", T.taskQuickLabel);
  $("task-quick-form").addEventListener("submit", sendQuickAdd);
  $("task-attention").setAttribute("aria-label", T.taskAttentionLabel);
  $("task-attention").addEventListener("click", (e) => {
    const chip = e.target.closest("[data-task-quick]");
    if (chip) pickAttention(chip.dataset.taskQuick);
  });

  $("task-filters").addEventListener("click", (e) => {
    const chip = e.target.closest("[data-task-filter]");
    if (!chip) return;
    taskState.filter = chip.dataset.taskFilter;
    if (taskState.filter === "mine") taskState.person = "";
    try { localStorage.setItem(TASK_FILTER_KEY, taskState.filter); } catch (err) { /* not remembered: fine */ }
    closeStatusMenu();
    renderTasks();
  });
  $("task-view").addEventListener("click", (e) => {
    const b = e.target.closest("[data-task-view]");
    if (!b || b.dataset.taskView === taskState.view) return;
    taskState.view = b.dataset.taskView;
    try { localStorage.setItem(TASK_VIEW_KEY, taskState.view); } catch (err) { /* not remembered: fine */ }
    closeStatusMenu();
    renderTasks();
  });

  $("task-label-filter").setAttribute("aria-label", T.taskLabelFilter);
  $("task-label-filter").addEventListener("change", () => { taskState.label = $("task-label-filter").value; closeStatusMenu(); renderTasks(); });
  setUpBoardDrag();

  $("task-groups").addEventListener("click", onTaskListClick);
  $("task-groups").addEventListener("keydown", onTaskListKey);
  $("task-groups").addEventListener("toggle", (e) => { if (e.target.id === "task-done") taskState.doneOpen = e.target.open; }, true);

  // Calendar
  $("task-cal").addEventListener("click", (e) => { if (!e.target.closest(".cal-head")) onCalendarClick(e); });
  $("task-cal").addEventListener("keydown", onTaskListKey);
  $("task-cal").addEventListener("toggle", (e) => { if (e.target.id === "cal-nodate-d") taskState.nodateOpen = e.target.open; }, true);
  const goMonth = (month) => { taskState.calMonth = month; taskState.calDay = ""; closeStatusMenu(); renderCalendar(); };
  $("cal-prev").addEventListener("click", () => goMonth(monthAdd(taskState.calMonth || todayMountain().slice(0, 7), -1)));
  $("cal-next").addEventListener("click", () => goMonth(monthAdd(taskState.calMonth || todayMountain().slice(0, 7), 1)));
  $("cal-today").addEventListener("click", () => { goMonth(todayMountain().slice(0, 7)); if (isNarrow()) pickCalDay(todayMountain()); });

  $("task-status-menu").addEventListener("click", (e) => {
    const b = e.target.closest("[data-set-status]");
    if (!b) return;
    const id = taskState.menuId;
    closeStatusMenu();
    changeTaskStatus(id, b.dataset.setStatus);
  });
  document.addEventListener("click", (e) => { if (taskState.menuId && !e.target.closest("#task-status-menu, [data-status-for]")) closeStatusMenu(); });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !taskState.menuId) return;
    const id = taskState.menuId;
    closeStatusMenu();
    const pill = document.querySelector(`[data-status-for="${CSS.escape(id)}"]`);
    if (pill) pill.focus();
  });
  window.addEventListener("resize", closeStatusMenu);
  window.addEventListener("scroll", closeStatusMenu, { passive: true });

  // New / edit
  $("task-form").addEventListener("submit", onTaskSubmit);
  $("tk-cancel").addEventListener("click", closeTaskDialog);
  closeOnBackdrop($("task-dialog"), closeTaskDialog);
  $("tk-quick").addEventListener("click", (e) => {
    const b = e.target.closest("[data-quick]");
    if (!b) return;
    $("tk-due").value = quickDate(b.dataset.quick);
    syncQuickChips();
    $("tk-save").focus();   // What → Who → date → Enter
  });
  $("tk-due").addEventListener("input", syncQuickChips);
  $("tk-dept").addEventListener("change", () => { taskState.deptTouched = true; });

  // Who
  $("tk-owner-add").addEventListener("click", () => pickOwner($("tk-owner").value));
  $("tk-owners").addEventListener("click", (e) => {
    const button = e.target.closest("[data-remove-owner]");
    if (!button) return;
    taskState.owners.splice(Number(button.dataset.removeOwner), 1).forEach((name) => dropNameLine(taskState.checklist, name));
    renderSelectedOwners();
    hideOwnerList();
  });
  $("tk-groups").addEventListener("click", (e) => {
    const button = e.target.closest("[data-group]");
    if (!button || button.disabled) return;
    addGroup(taskState.owners, taskState.checklist, button.dataset.group);
    if (!taskState.deptTouched) $("tk-dept").value = button.dataset.group || "General";
    renderSelectedOwners();
    hideOwnerList();
  });
  $("tk-owner").addEventListener("input", () => { showOwnerList(false); syncDeptFromOwner(); });
  $("tk-owner").addEventListener("keydown", onOwnerKeydown);
  // Tapping the box opens the list: everyone when a full name is already there, otherwise the matches.
  $("tk-owner").addEventListener("click", () => { if ($("tk-owner-list").hidden) showOwnerList(!!teamPerson($("tk-owner").value) || !$("tk-owner").value.trim()); });
  // Tapping a name: the focus stays in the box (Firefox and iOS Safari move it on mousedown, so both are stopped), and the
  // list stays open until the tap's click picks the name. Leaving the box any other way hides the list a moment later.
  let ownerPressing = false;
  const ownerPressEnd = () => {
    if (!ownerPressing) return;
    setTimeout(() => { ownerPressing = false; if (document.activeElement !== $("tk-owner")) hideOwnerList(); }, 400);
  };
  $("tk-owner").addEventListener("blur", () => {
    setTimeout(() => { if (!ownerPressing && document.activeElement !== $("tk-owner")) hideOwnerList(); }, 150);
  });
  $("tk-owner-list").addEventListener("pointerdown", (e) => { e.preventDefault(); ownerPressing = true; });
  $("tk-owner-list").addEventListener("mousedown", (e) => e.preventDefault());
  document.addEventListener("pointerup", ownerPressEnd, true);
  document.addEventListener("pointercancel", ownerPressEnd, true);
  $("tk-owner-list").addEventListener("click", (e) => {
    const li = e.target.closest("[data-name]");
    if (li && !$("tk-owner-list").hidden) pickOwner(li.dataset.name);
  });
  // Escape while the suggestions are open closes only them; otherwise it closes the form (asking first if anything changed).
  $("task-dialog").addEventListener("cancel", (e) => {
    e.preventDefault();
    if (!$("tk-owner-list").hidden) return hideOwnerList();
    closeTaskDialog();
  });

  // Reminders
  $("tk-rem-add").addEventListener("click", addReminderRow);
  $("tk-reminders").addEventListener("click", (e) => {
    const x = e.target.closest(".rem-x");
    if (!x) return;
    const row = x.closest(".rem-row");
    const next = row.nextElementSibling || row.previousElementSibling;
    row.remove();
    syncReminderAdd();
    (next ? next.querySelector(".rem-n") : $("tk-rem-add")).focus();
  });
  $("tk-reminders").addEventListener("input", (e) => {
    if (!e.target.matches(".rem-n")) return;
    const select = e.target.closest(".rem-row").querySelector(".rem-unit");
    select.innerHTML = unitOptions(e.target.value, select.value);
  });

  // Enter saves from any field (not the notes box, and not while a button has focus: that presses the button).
  $("task-form").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
    if (e.target.matches("textarea, button, summary")) return;
    e.preventDefault();
    $("task-form").requestSubmit();
  });

  // Detail (the task window): changes are a draft until Save
  $("td-close").addEventListener("click", () => { if (!$("td-close").disabled) saveTaskDetail(); });
  $("task-detail-dialog").addEventListener("close", () => { taskState.openId = ""; taskState.draft = null; hideMentions(); });
  $("task-detail-dialog").addEventListener("cancel", (e) => {   // Escape
    e.preventDefault();
    if (!$("td-mention-list").hidden) return hideMentions();
    if (!$("td-person-add").hidden && document.activeElement === $("td-person")) { $("td-person-add").hidden = true; return; }
    if (!$("td-label-add").hidden && document.activeElement === $("td-label")) { $("td-label-add").hidden = true; return; }
    closeTaskDetail();
  });
  closeOnBackdrop($("task-detail-dialog"), closeTaskDetail);
  $("td-edit").addEventListener("click", async () => {
    const t = taskById(taskState.openId);
    if (!t || !(await closeTaskDetail())) return;
    openTaskDialog(t);
  });
  $("td-remove").addEventListener("click", removeOpenTask);
  $("td-duplicate").addEventListener("click", duplicateOpenTask);
  $("td-copy-link").addEventListener("click", copyTaskLink);
  $("td-link-fallback").setAttribute("aria-label", T.taskCopyLink);
  $("td-priority").addEventListener("change", () => { if (taskState.draft) { taskState.draft.priority = $("td-priority").value; renderDraftButton(); } });
  $("td-status").addEventListener("click", (e) => {
    const b = e.target.closest("[data-detail-status]");
    if (!b || !taskState.draft) return;
    taskState.draft.status = b.dataset.detailStatus;
    renderTaskDetail();
  });
  // People
  $("td-people").addEventListener("click", (e) => {
    const d = taskState.draft;
    if (!d) return;
    const x = e.target.closest("[data-remove-person]");
    if (x) { d.owners.splice(Number(x.dataset.removePerson), 1).forEach((name) => dropNameLine(d.checklist, name)); return renderTaskDetail(); }
    if (e.target.closest("#td-person-open")) { $("td-person-add").hidden = false; $("td-person").focus(); }
  });
  $("td-groups").addEventListener("click", (e) => {
    const d = taskState.draft;
    const button = e.target.closest("[data-group]");
    if (!d || !button || button.disabled) return;
    addGroup(d.owners, d.checklist, button.dataset.group);
    $("td-person-add").hidden = true;
    renderTaskDetail();
  });
  $("td-person").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); draftAddPerson($("td-person").value); }
  });
  // Picking a name from the suggestions adds it straight away.
  $("td-person").addEventListener("input", (e) => {
    if (e.inputType && e.inputType !== "insertReplacementText") return;
    if (teamPerson($("td-person").value)) draftAddPerson($("td-person").value);
  });
  // Labels
  $("td-labels").addEventListener("click", (e) => {
    const d = taskState.draft;
    if (!d) return;
    const x = e.target.closest("[data-remove-label]");
    if (x) { d.labels.splice(Number(x.dataset.removeLabel), 1); return renderTaskDetail(); }
    if (e.target.closest("#td-label-open")) { $("td-label-add").hidden = false; $("td-label").focus(); }
  });
  $("td-label").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); draftAddLabel($("td-label").value); }
  });
  $("td-label").addEventListener("input", (e) => {
    if (e.inputType && e.inputType !== "insertReplacementText") return;
    if (allLabels().some((l) => l === $("td-label").value)) draftAddLabel($("td-label").value);
  });
  // Checklist
  $("td-checklist").addEventListener("change", (e) => {
    const box = e.target.closest("[data-check]");
    if (!box || !taskState.draft) return;
    taskState.draft.checklist[Number(box.dataset.check)].done = box.checked;
    renderTaskDetail();
  });
  $("td-checklist").addEventListener("click", (e) => {
    const x = e.target.closest("[data-uncheck-item]");
    if (!x || !taskState.draft) return;
    taskState.draft.checklist.splice(Number(x.dataset.uncheckItem), 1);
    renderTaskDetail();
    $("td-check-new").focus();
  });
  $("td-check-new").placeholder = "+ " + T.taskChecklistAdd;
  $("td-check-new").setAttribute("aria-label", T.taskChecklistAdd);
  $("td-person").placeholder = T.taskPersonPlaceholder;
  $("td-person").setAttribute("aria-label", T.taskAddPerson);
  $("td-label").placeholder = T.taskLabelPlaceholder;
  $("td-label").setAttribute("aria-label", T.taskAddLabel);
  $("td-check-new").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); draftAddCheck(); }
  });
  // Updates, with @name suggestions
  $("td-update-form").addEventListener("submit", onUpdateSubmit);
  $("td-update-text").addEventListener("input", showMentions);
  $("td-update-text").addEventListener("click", showMentions);
  $("td-update-text").addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== $("td-update-text")) hideMentions(); }, 150));
  $("td-update-text").addEventListener("keydown", (e) => {
    if (onMentionKey(e)) return;
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("td-update-form").requestSubmit(); }
  });
  $("td-mention-list").addEventListener("pointerdown", (e) => e.preventDefault());
  $("td-mention-list").addEventListener("mousedown", (e) => e.preventDefault());
  $("td-mention-list").addEventListener("click", (e) => {
    const li = e.target.closest("[data-mention]");
    if (li) pickMention(li.dataset.mention);
  });
})();

// Signed in with task changes still waiting from last time: send them.
if (state.token && outboxCount()) flushOutbox();

/** A tap on the dark area around a dialog: run close (which may ask first). */
function closeOnBackdrop(dialog, close) {
  let downOutside = false;
  const outside = (e) => {
    if (e.target !== dialog) return false;
    const r = dialog.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };
  dialog.addEventListener("pointerdown", (e) => { downOutside = outside(e); });
  dialog.addEventListener("click", (e) => {
    const go = downOutside && outside(e);   // pressed and let go outside (dragging a text selection out doesn't count)
    downOutside = false;
    if (go) close();
  });
}

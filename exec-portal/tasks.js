// CSS Exec Portal — Tasks tab: who is doing what, by when. Each new task is posted in Discord #tasks; the owner replies there
// and the replies show up here (they are pulled in when this tab opens or is refreshed).
// Two views: a list grouped by due date, and a month calendar. The list of people lives in Settings → People.

const TASK_STATUSES = ["todo", "doing", "blocked", "done"];
const TASK_DEPTS = ["Events", "Marketing", "Internal", "External", "Finance", "General"];
const TASK_FILTER_KEY = "css_task_filter";
const TASK_VIEW_KEY = "css_task_view";
const REM_MAX = 5;

const taskState = {
  tasks: [], team: [], discord: {}, loaded: false, request: 0,
  filter: "mine", view: "list", doneOpen: false, nodateOpen: false,
  calMonth: "",       // "yyyy-mm" on show in the calendar
  calDay: "",         // the day listed under the calendar ("yyyy-mm-dd"), or ""
  editing: null,      // the task open in the New/Edit dialog (null = new)
  owners: [],         // selected people in the New/Edit dialog
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
  mention: { names: [], active: -1, start: -1 }   // the @name suggestions under the update box
};
try { taskState.filter = localStorage.getItem(TASK_FILTER_KEY) || "mine"; } catch (e) { /* no storage: start on My tasks */ }
try { const v = localStorage.getItem(TASK_VIEW_KEY); taskState.view = v === "cal" || v === "board" ? v : "list"; } catch (e) { /* no storage: start on the list */ }

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
  deviceSave("tasks", { tasks: reply.tasks || [], team: reply.team || [], discord: reply.discord || {} });
  showTaskList(reply);
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
}

/** Every label used on a task, once each, A to Z. */
function allLabels() {
  const seen = new Map();
  taskState.tasks.forEach((t) => taskLabels(t).forEach((l) => { if (!seen.has(normName(l))) seen.set(normName(l), l); }));
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

function filteredTasks() {
  const f = taskState.filter;
  return taskState.tasks.filter((t) => (f === "all" ? true : f === "mine" ? taskOwners(t).some((name) => sameName(name, state.name)) : t.department === f)
    && (!taskState.label || taskLabels(t).some((l) => sameName(l, taskState.label))));
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
  const d = taskState.discord || {};
  const remind = $("task-remind-button");
  remind.disabled = !d.posting;
  remind.title = d.posting ? "" : T.taskRemindOff;
  $("task-remind-wrap").title = remind.title;
  $("task-discord-warn").hidden = !d.error;
  $("task-discord-warn").textContent = d.error || "";

  const cal = taskState.view === "cal", board = taskState.view === "board";
  $("task-groups").hidden = cal || board;
  $("task-cal").hidden = !cal;
  $("task-board").hidden = !board;
  if (cal) { $("task-empty").hidden = true; return renderCalendar(); }
  if (board) { $("task-empty").hidden = true; return renderBoard(); }

  const list = filteredTasks();
  const groups = { overdue: [], week: [], later: [], nodate: [], done: [] };
  list.forEach((t) => groups[taskGroupKey(t)].push(t));
  const byDue = (a, b) => taskIso(a.due).localeCompare(taskIso(b.due)) || String(a.title).localeCompare(String(b.title));
  ["overdue", "week", "later"].forEach((k) => groups[k].sort(byDue));
  groups.nodate.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  groups.done.sort((a, b) => String(b.doneAt || b.updatedAt || "").localeCompare(String(a.doneAt || a.updatedAt || "")));

  $("task-empty").hidden = !taskState.loaded || list.length > 0;
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
      <div class="task-meta">${notSentChip(t)}<span>${escapeHtml(taskOwners(t).join(", ") || T.taskNobody)}</span>${dueChip(t)}${reminderChip(t)}${checkChip(t)}${taskLabels(t).map(labelChip).join("")}</div>
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
  const byDue = (a, b) => (taskIso(a.due) || "9999").localeCompare(taskIso(b.due) || "9999") || String(a.title).localeCompare(String(b.title));
  ["todo", "doing", "blocked"].forEach((s) => cols[s].sort(byDue));
  cols.done.sort((a, b) => String(b.doneAt || b.updatedAt || "").localeCompare(String(a.doneAt || a.updatedAt || "")));
  $("task-board").innerHTML = TASK_STATUSES.map((s) => `
    <section class="board-col st-${s}" data-board-status="${s}">
      <h2 class="board-h"><span class="task-status st-${s} mini">${escapeHtml(statusLabel(s))}</span> <span class="task-count">${cols[s].length}</span></h2>
      <ul class="board-cards">${cols[s].map((t) => boardCard(t, today)).join("")}</ul>
    </section>`).join("");
}

function boardCard(t, today) {
  const people = taskOwners(t);
  return `<li class="board-card st-${escapeHtml(t.status)}${taskIsOverdue(t, today) ? " overdue" : ""}" data-task-id="${escapeHtml(t.id)}" tabindex="0" draggable="true">
    ${taskLabels(t).length ? `<div class="board-labels">${taskLabels(t).map(labelChip).join("")}</div>` : ""}
    <div class="task-title">${escapeHtml(t.title)}</div>
    <div class="task-meta">${notSentChip(t)}${dueChip(t)}${checkChip(t)}<span class="board-people">${escapeHtml(people.join(", ") || T.taskNobody)}</span></div>
  </li>`;
}

function setUpBoardDrag() {
  const board = $("task-board");
  const clearOver = () => board.querySelectorAll(".board-col.drop").forEach((c) => c.classList.remove("drop"));
  board.addEventListener("dragstart", (e) => {
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
    if (!col || !id) return;
    e.preventDefault();
    taskState.dragId = "";
    changeTaskStatus(id, col.dataset.boardStatus);
  });
  board.addEventListener("click", (e) => {
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
      t = { id: f.clientId, status: "todo", createdBy: state.name, createdAt: item.at, updates: [], doneAt: "", checklist: [], labels: [], remind: [] };
      taskState.tasks.push(t);
    }
    ["title", "due", "department", "notes", "link", "remind", "labels", "checklist"].forEach((k) => { if (f[k] !== undefined) t[k] = f[k]; });
    if (f.owners) { t.owners = f.owners.slice(); t.owner = f.owners[0] || ""; }
    if (f.status && f.id) showStatus(t, f.status);
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

function renderSelectedOwners() {
  $("tk-owners").innerHTML = taskState.owners.map((name, i) => `<button type="button" class="chip" data-remove-owner="${i}" aria-label="${escapeHtml(T.taskOwnerRemove + " " + name)}">${escapeHtml(name)} <span aria-hidden="true">×</span></button>`).join("");
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
  if (!taskState.owners.some((picked) => sameName(picked, canonical))) taskState.owners.push(canonical);
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
  const p = teamPerson(owner);
  return p && TASK_DEPTS.includes(p.department) ? p.department : "General";
}

function syncQuickChips() {
  const value = $("tk-due").value;
  document.querySelectorAll("#tk-quick [data-quick]").forEach((b) => b.classList.toggle("active", quickDate(b.dataset.quick) === value));
}

/** task: the task to edit, or null for a new one. due: a starting due date for a new one (from the calendar). */
function openTaskDialog(task, due) {
  closeStatusMenu();
  taskState.editing = task || null;
  taskState.deptTouched = !!task;
  $("task-dialog-title").textContent = task ? T.taskDialogEdit : T.taskDialogNew;
  $("tk-save").textContent = task ? T.taskSave : T.taskAdd;
  $("tk-save").disabled = false;
  $("tk-error").hidden = true;
  $("tk-title").value = task ? task.title || "" : "";
  const deptFilter = TASK_DEPTS.includes(taskState.filter) ? taskState.filter : "";
  const me = teamPerson(state.name);
  taskState.owners = task ? taskOwners(task).slice() : [me ? me.name.trim() : String(state.name || "").trim()].filter(Boolean);
  $("tk-owner").value = "";
  renderSelectedOwners();
  hideOwnerList();
  $("tk-due").value = task ? taskIso(task.due) : taskIso(due);
  $("tk-dept").value = task ? (TASK_DEPTS.includes(task.department) ? task.department : "General") : (deptFilter || deptFor(taskState.owners[0]));
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
  return JSON.stringify([$("tk-title").value.trim(), taskState.owners, $("tk-owner").value.trim(), $("tk-due").value, $("tk-dept").value,
    readReminderRows(), $("tk-notes").value.trim(), $("tk-link").value.trim()]);
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
  return { status: task.status, owners: taskOwners(task).slice(), labels: taskLabels(task).slice(),
    checklist: taskChecklist(task).map((c) => ({ id: c.id || "", text: c.text, done: !!c.done })) };
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
  $("td-status").innerHTML = TASK_STATUSES.map((s) =>
    `<button type="button" class="chip${s === d.status ? " active" : ""}" data-detail-status="${s}" aria-pressed="${s === d.status}">${escapeHtml(statusLabel(s))}</button>`).join("");
  // People and labels: a chip each (× takes it off), then "+ Add"
  $("td-people").innerHTML = d.owners.map((n, i) =>
    `<button type="button" class="chip td-chip" data-remove-person="${i}" aria-label="${escapeHtml(T.taskOwnerRemove + " " + n)}">${escapeHtml(n)} <span aria-hidden="true">×</span></button>`).join("") +
    `<button type="button" class="chip td-add-chip" id="td-person-open">+ ${escapeHtml(T.taskAddPerson)}</button>`;
  $("td-labels").innerHTML = d.labels.map((l, i) =>
    `<button type="button" class="task-label lab-${labelHue(l)} td-chip" data-remove-label="${i}" aria-label="${escapeHtml(T.taskOwnerRemove + " " + l)}">${escapeHtml(l)} <span aria-hidden="true">×</span></button>`).join("") +
    (d.labels.length < 6 ? `<button type="button" class="chip td-add-chip" id="td-label-open">+ ${escapeHtml(T.taskAddLabel)}</button>` : "");
  const people = ownerSuggestions("", d.owners);
  $("td-people-names").innerHTML = people.map((n) => `<option value="${escapeHtml(n)}"></option>`).join("");
  $("td-label-names").innerHTML = allLabels().filter((l) => !d.labels.some((x) => sameName(x, l))).map((l) => `<option value="${escapeHtml(l)}"></option>`).join("");
  // Checklist
  const done = d.checklist.filter((c) => c.done).length;
  $("td-check-count").textContent = d.checklist.length ? `${done}/${d.checklist.length}` : "";
  $("td-check-count").hidden = !d.checklist.length;
  $("td-checklist").innerHTML = d.checklist.map((c, i) => `<li class="td-check${c.done ? " done" : ""}">
    <label><input type="checkbox" data-check="${i}"${c.done ? " checked" : ""}> <span>${escapeHtml(c.text)}</span></label>
    <button type="button" class="icon-btn" data-uncheck-item="${i}" title="${escapeHtml(T.taskChecklistRemove)}" aria-label="${escapeHtml(T.taskChecklistRemove)}"><svg><use href="#i-x"/></svg></button>
  </li>`).join("");
  $("td-check-new").hidden = d.checklist.length >= 30;
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
  if (!d.owners.some((n) => sameName(n, name))) d.owners.push(name);
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
  if (d.checklist.length >= 30) return showToast(T.taskTooManyItems);
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
  ["status", "owners", "labels", "checklist"].forEach((k) => { if (JSON.stringify(d[k]) !== JSON.stringify(base[k])) task[k] = d[k]; });
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

// ---- Remind on Discord ---------------------------------------------------------------------------------

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
  $("tk-dept").innerHTML = TASK_DEPTS.map((d) => `<option value="${d}">${d}</option>`).join("");
  $("td-update-text").placeholder = T.taskAddUpdate;

  $("task-new-button").addEventListener("click", () => openTaskDialog(null));
  $("task-empty-new").addEventListener("click", () => openTaskDialog(null));
  $("task-refresh").addEventListener("click", loadTasks);
  $("task-remind-button").addEventListener("click", remindOnDiscord);

  $("task-filters").addEventListener("click", (e) => {
    const chip = e.target.closest("[data-task-filter]");
    if (!chip) return;
    taskState.filter = chip.dataset.taskFilter;
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
    taskState.owners.splice(Number(button.dataset.removeOwner), 1);
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
    if (x) { d.owners.splice(Number(x.dataset.removePerson), 1); return renderTaskDetail(); }
    if (e.target.closest("#td-person-open")) { $("td-person-add").hidden = false; $("td-person").focus(); }
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

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
  deptTouched: false, // the department was picked by hand, so changing Who no longer changes it
  openId: "",         // the task open in the detail dialog
  menuId: "",         // the task whose status menu is open
  combo: { names: [], active: -1 }   // the "Who" suggestions on show
};
try { taskState.filter = localStorage.getItem(TASK_FILTER_KEY) || "mine"; } catch (e) { /* no storage: start on My tasks */ }
try { taskState.view = localStorage.getItem(TASK_VIEW_KEY) === "cal" ? "cal" : "list"; } catch (e) { /* no storage: start on the list */ }

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

async function loadTasks() {
  const request = ++taskState.request;
  if (!taskState.loaded) { $("task-status").textContent = T.taskLoading; $("task-groups").innerHTML = ""; $("task-empty").hidden = true; }
  const reply = await api("listTasks");
  if (request !== taskState.request) return;
  if (!reply.ok) {
    if (taskSignedOut(reply)) return;
    $("task-status").textContent = errorText(reply);
    return;
  }
  $("task-status").textContent = "";
  taskState.tasks = reply.tasks || [];
  taskState.team = reply.team || [];
  taskState.discord = reply.discord || {};
  taskState.loaded = true;
  renderTasks();
  if (taskState.openId && $("task-detail-dialog").open) {
    if (taskById(taskState.openId)) renderTaskDetail(); else $("task-detail-dialog").close();
  }
}

function openTasksTab() {
  $("crumb").textContent = T.tabTasks;
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
}

function filteredTasks() {
  const f = taskState.filter;
  return taskState.tasks.filter((t) => f === "all" ? true : f === "mine" ? sameName(t.owner, state.name) : t.department === f);
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

  const cal = taskState.view === "cal";
  $("task-groups").hidden = cal;
  $("task-cal").hidden = !cal;
  if (cal) { $("task-empty").hidden = true; return renderCalendar(); }

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
      <div class="task-meta"><span>${escapeHtml(t.owner || T.taskNobody)}</span>${dueChip(t)}${reminderChip(t)}</div>
      ${note ? `<div class="task-last">${note.source === "discord" ? discordMark() : ""}<span>${escapeHtml(note.text)}</span></div>` : ""}
    </div>
    <button type="button" class="task-status st-${status}" data-status-for="${escapeHtml(t.id)}" aria-haspopup="menu">${escapeHtml(statusLabel(status))}</button>
  </li>`;
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

async function changeTaskStatus(id, status) {
  const task = taskById(id);
  if (!task || task.status === status) return;
  const before = { status: task.status, doneAt: task.doneAt, updates: task.updates };
  // Show it straight away; put it back if the server says no.
  task.status = status;
  task.doneAt = status === "done" ? new Date().toISOString() : "";
  task.updates = [{ id: "local", text: "", status, by: state.name, source: "portal", createdAt: new Date().toISOString() }, ...(task.updates || [])];
  renderTasks();
  if (taskState.openId === id) renderTaskDetail();
  const reply = await api("setTaskStatus", { id, status });
  if (!reply.ok) {
    if (taskSignedOut(reply)) return;
    Object.assign(task, before);
    renderTasks();
    if (taskState.openId === id) renderTaskDetail();
    return showToast(errorText(reply));
  }
  Object.assign(task, reply.task || {}, { updates: (reply.task && reply.task.updates) || task.updates });
  renderTasks();
  if (taskState.openId === id) renderTaskDetail();
}

// ---- "Who": type a name, pick from suggestions (or keep a new name: it gets added to People) ----------

function ownerSuggestions(query) {
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
  return names.map((n) => [n, score(n)]).filter(([, s]) => s >= 0)
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).slice(0, 8).map(([n]) => n);
}

function showOwnerList(everyone) {
  const input = $("tk-owner");
  const names = ownerSuggestions(everyone ? "" : input.value);
  const box = $("tk-owner-list");
  taskState.combo = { names, active: -1 };
  // Nothing to suggest, or the only suggestion is exactly what's typed: no list.
  if (!names.length || (names.length === 1 && sameName(names[0], input.value))) return hideOwnerList();
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
  $("tk-owner").value = name;
  hideOwnerList();
  syncDeptFromOwner();
}

function syncDeptFromOwner() {
  if (taskState.deptTouched) return;
  const p = teamPerson($("tk-owner").value);
  if (p && TASK_DEPTS.includes(p.department)) $("tk-dept").value = p.department;
}

function onOwnerKeydown(e) {
  const open = !$("tk-owner-list").hidden;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if (!open) { showOwnerList(!!teamPerson($("tk-owner").value)); if ($("tk-owner-list").hidden) return; }
    moveOwnerActive(e.key === "ArrowDown" ? 1 : -1);
  } else if (e.key === "Enter" && open && taskState.combo.active >= 0) {
    e.preventDefault();
    e.stopPropagation();   // picks the name; doesn't save the task yet
    pickOwner(taskState.combo.names[taskState.combo.active]);
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
  $("tk-owner").value = task ? task.owner || "" : (me ? me.name.trim() : String(state.name || "").trim());
  hideOwnerList();
  $("tk-due").value = task ? taskIso(task.due) : taskIso(due);
  $("tk-dept").value = task ? (TASK_DEPTS.includes(task.department) ? task.department : "General") : (deptFilter || deptFor($("tk-owner").value));
  if (!task && deptFilter) taskState.deptTouched = true;
  $("tk-reminders").innerHTML = (task ? remindersOf(task) : []).map(reminderRowHtml).join("");
  syncReminderAdd();
  $("tk-notes").value = task ? task.notes || "" : "";
  $("tk-link").value = task ? task.link || "" : "";
  $("tk-more").open = !!(task && (task.notes || task.link));
  syncQuickChips();
  $("task-dialog").showModal();
  $("tk-title").focus();
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
  const typedOwner = $("tk-owner").value.trim().replace(/\s+/g, " ");
  const person = teamPerson(typedOwner);
  const task = {
    id: editing ? editing.id : "",
    title,
    owner: person ? person.name.trim() : typedOwner,
    due: $("tk-due").value,
    department: $("tk-dept").value,
    notes: $("tk-notes").value.trim(),
    link: $("tk-link").value.trim(),
    remind: rows.map(cleanReminder)
  };
  $("tk-save").disabled = true;
  $("tk-save").textContent = T.taskSaving;
  const reply = await api("saveTask", { task });
  if (!reply.ok) {
    if (taskSignedOut(reply)) return;
    $("tk-save").disabled = false;
    $("tk-save").textContent = editing ? T.taskSave : T.taskAdd;
    return showError(errorText(reply));
  }
  $("task-dialog").close();
  const saved = reply.task || task;
  const existing = taskById(saved.id);
  if (existing) Object.assign(existing, saved, { updates: saved.updates || existing.updates });
  else taskState.tasks.push({ updates: [], ...saved });
  if (Array.isArray(reply.team)) taskState.team = reply.team;
  else if (saved.owner && !teamPerson(saved.owner)) taskState.team.push({ id: "", name: saved.owner, department: saved.department, discordId: "", active: true });
  renderTasks();
  if (taskState.openId === saved.id && $("task-detail-dialog").open) renderTaskDetail();
  const d = taskState.discord || {};
  showToast(editing ? T.taskSaved : reply.discordPosted ? T.taskAddedPosted : d.posting ? T.taskAddedNotPosted : T.taskAddedOnly, "success");
}

// ---- Detail ---------------------------------------------------------------------------------------------

function openTaskDetail(id) {
  closeStatusMenu();
  taskState.openId = id;
  $("td-update-text").value = "";
  $("td-error").hidden = true;
  $("td-post").disabled = false;
  $("td-post").textContent = T.taskPost;
  renderTaskDetail();
  $("task-detail-dialog").showModal();
  // Ready to type an update on a computer; on a touch screen don't pop the keyboard up.
  (matchMedia("(pointer: coarse)").matches ? $("td-close") : $("td-update-text")).focus();
}

function renderTaskDetail() {
  const t = taskById(taskState.openId);
  if (!t) return;
  $("td-title").textContent = t.title;
  const link = /^https?:\/\//i.test(t.link || "") ? `<a class="link" href="${escapeHtml(t.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(T.taskLink)}</a>` : "";
  $("td-meta").innerHTML = [`<span>${escapeHtml(t.owner || T.taskNobody)}</span>`, dueChip(t), reminderChip(t, true),
    `<span class="muted">${escapeHtml(t.department || "General")}</span>`, link].filter(Boolean).join("");
  $("td-notes").hidden = !t.notes;
  $("td-notes").textContent = t.notes || "";
  $("td-status").innerHTML = TASK_STATUSES.map((s) =>
    `<button type="button" class="chip${s === t.status ? " active" : ""}" data-detail-status="${s}" aria-pressed="${s === t.status}">${escapeHtml(statusLabel(s))}</button>`).join("");
  const updates = t.updates || [];
  $("td-updates").innerHTML = updates.length ? updates.map((u) => {
    const mark = u.source === "discord" ? discordMark() : "";
    const when = escapeHtml(taskAgo(u.createdAt));
    const statusPill = u.status ? `<span class="task-status st-${escapeHtml(u.status)} mini">${escapeHtml(statusLabel(u.status))}</span>` : "";
    if (!String(u.text || "").trim()) {
      return `<li class="task-update quiet"><span>${escapeHtml(T.taskSetTo(u.by || "", statusLabel(u.status)))}</span>${mark}<span class="muted">${when}</span></li>`;
    }
    return `<li class="task-update"><div class="task-update-h"><strong>${escapeHtml(u.by || "")}</strong>${mark}<span class="muted">${when}</span>${statusPill}</div>
      <p>${escapeHtml(u.text)}</p></li>`;
  }).join("") : `<li class="muted small">${escapeHtml(T.taskNoUpdates)}</li>`;
}

async function onUpdateSubmit(event) {
  event.preventDefault();
  const id = taskState.openId;
  const text = $("td-update-text").value.trim();
  if (!id || !text || $("td-post").disabled) return;
  $("td-post").disabled = true;
  $("td-post").textContent = T.taskPosting;
  $("td-error").hidden = true;
  const reply = await api("addTaskUpdate", { id, text });
  $("td-post").disabled = false;
  $("td-post").textContent = T.taskPost;
  if (!reply.ok) {
    if (taskSignedOut(reply)) return;
    $("td-error").textContent = errorText(reply);
    $("td-error").hidden = false;
    return;
  }
  const task = taskById(id);
  if (task) {
    const updates = [reply.update || { text, by: state.name, source: "portal", createdAt: new Date().toISOString() }, ...(task.updates || [])];
    Object.assign(task, reply.task || {}, { updates: (reply.task && reply.task.updates) || updates });
  }
  if (taskState.openId === id) { $("td-update-text").value = ""; renderTaskDetail(); }
  renderTasks();
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
  $("tk-cancel").addEventListener("click", () => $("task-dialog").close());
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
  // Escape while the suggestions are open closes only them.
  $("task-dialog").addEventListener("cancel", (e) => { if (!$("tk-owner-list").hidden) { e.preventDefault(); hideOwnerList(); } });

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

  // Detail
  $("td-close").addEventListener("click", () => $("task-detail-dialog").close());
  $("task-detail-dialog").addEventListener("close", () => { taskState.openId = ""; });
  $("td-edit").addEventListener("click", () => {
    const t = taskById(taskState.openId);
    if (!t) return;
    $("task-detail-dialog").close();
    openTaskDialog(t);
  });
  $("td-remove").addEventListener("click", removeOpenTask);
  $("td-status").addEventListener("click", (e) => {
    const b = e.target.closest("[data-detail-status]");
    if (b && taskState.openId) changeTaskStatus(taskState.openId, b.dataset.detailStatus);
  });
  $("td-update-form").addEventListener("submit", onUpdateSubmit);
  $("td-update-text").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("td-update-form").requestSubmit(); }
  });
})();

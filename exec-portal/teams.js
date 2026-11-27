// CSS Exec Portal - president-only department workspaces and tracker editors.
if (typeof READ_ACTIONS !== "undefined") ["teamSpaces", "getTracker"].forEach((action) => { if (!READ_ACTIONS.includes(action)) READ_ACTIONS.push(action); });
const tmState = {
  access: false, token: "", generation: 0, departments: [], trackers: [], templates: [], team: [],
  department: "", tracker: null, rows: [], search: "", view: "table", queues: new Map(),
  record: null, columns: null, removed: null, spaceRequest: null, opening: 0, newClientId: "", renaming: false, renameRequest: null, viewRefreshPending: false
};
const tmCopy = (value) => JSON.parse(JSON.stringify(value));
const tmEsc = (value) => escapeHtml(String(value == null ? "" : value));
const tmId = (prefix) => prefix + newRequestId().replace(/[^a-zA-Z0-9]/g, "");
const tmNode = (id) => $(id);
const tmSame = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const tmFindRow = (id) => tmState.rows.find((row) => row.id === id);
function tmError(message, target = "tm-status") {
  const el = tmNode(target);
  if (!el) return;
  el.textContent = message || "";
  el.hidden = !message;
}
// Only "not a president" and "signed out" close Teams. A busy server or a dropped connection keeps what is on screen.
function tmReplyError(reply, target) {
  if (reply.error === "NOT_PRESIDENT") {
    tmHide(true);
    showToast(T.tmPresidentOnly);
    return new Error(T.tmPresidentOnly);
  }
  if (reply.error === "NOT_LOGGED_IN") {
    tmHide();
    if (typeof signOutLocally === "function") {
      signOutLocally();
      if (typeof showLogin === "function") showLogin(errorText(reply));
    }
  }
  const message = errorText(reply);
  tmError(message, target);
  return new Error(message);
}
function tmRun(work) { Promise.resolve().then(work).catch((error) => tmError(error.message || T.tmSaveFailed)); }
function tmDestroyView() { if (typeof tvDestroy === "function" && tmNode("tm-view")) tvDestroy(tmNode("tm-view")); }
function tmShowLoading() {
  tmDestroyView();
  if (tmNode("tm-workspace")) tmNode("tm-workspace").innerHTML = `<p class="tm-loading muted" role="status">${tmEsc(T.tmLoading)}</p>`;
}
// leave: Teams was taken away while open, so move to Tasks instead of leaving a blank page. Signing out does not pass it.
function tmHide(leave) {
  const showing = !!(tmNode("tab-teams") && !tmNode("tab-teams").hidden);
  tmState.generation++;
  tmState.opening++;
  tmDestroyView();
  Object.assign(tmState, { access: false, token: "", tracker: null, rows: [], trackers: [], team: [], record: null, columns: null, removed: null, spaceRequest: null, queues: new Map(), renaming: false, renameRequest: null, viewRefreshPending: false });
  ["teams-tab-button", "tab-teams", "tm-undo"].forEach((id) => { if (tmNode(id)) tmNode(id).hidden = true; });
  ["tm-new-dialog", "tm-record-dialog", "tm-columns-dialog"].forEach((id) => { if (tmNode(id) && tmNode(id).open) tmNode(id).close(); });
  if (tmNode("tm-workspace")) tmNode("tm-workspace").innerHTML = "";
  if (leave && showing && typeof switchTab === "function") switchTab("tasks");
}
// Departments that still have trackers keep a chip even after they leave the department list.
function tmSpaceDepartments() {
  const extra = [];
  tmState.trackers.forEach((tracker) => { if (tracker.department && !tmState.departments.includes(tracker.department) && !extra.includes(tracker.department)) extra.push(tracker.department); });
  return tmState.departments.concat(extra.sort((a, b) => a.localeCompare(b)));
}
async function tmCheckAccess() {
  if (!state.token || state.role === "door" || (typeof SCANNER_MODE !== "undefined" && SCANNER_MODE)) { tmHide(); return false; }
  const token = state.token;
  if (tmState.spaceRequest && tmState.spaceRequest.token === token) return tmState.spaceRequest.promise;
  const generation = tmState.generation;
  const promise = (async () => {
    const reply = await api("teamSpaces", {}, { quiet: true });
    if (token !== state.token || generation !== tmState.generation) return false;
    if (!reply.ok) {
      if (reply.error === "NOT_PRESIDENT") {
        const had = tmState.access;
        tmHide(true);
        if (had) showToast(T.tmPresidentOnly);
      } else if (reply.error === "NOT_LOGGED_IN") tmReplyError(reply);
      else tmError(errorText(reply));
      return false;
    }
    tmState.access = true;
    tmState.token = token;
    tmState.departments = (reply.departments || []).slice().sort((a, b) => a === "General" ? 1 : b === "General" ? -1 : a.localeCompare(b));
    tmState.trackers = reply.trackers || [];
    tmState.templates = reply.templates || [];
    tmState.team = reply.team || [];
    if (!tmSpaceDepartments().includes(tmState.department)) tmState.department = tmState.departments[0] || "General";
    if (tmNode("teams-tab-button")) tmNode("teams-tab-button").hidden = false;
    return true;
  })();
  const request = { token, promise };
  tmState.spaceRequest = request;
  try { return await promise; }
  catch (error) { if (token === state.token && generation === tmState.generation) tmError(error.message || errorText({})); return false; }
  finally { if (tmState.spaceRequest === request) tmState.spaceRequest = null; }
}
// The table and calendar libraries (~740 KB) load the first time Teams opens, never for door phones or other execs.
// The small drag library (SortableJS) is already on every page, for dragging Tasks cards on phones.
const TM_LIBRARIES = ["vendor/tabulator/tabulator.min.css?v=6.7.1", "vendor/tabulator/tabulator.min.js?v=6.7.1", "vendor/fullcalendar/index.global.min.js?v=6.1.22"];
let tmLibraries = null, tmLibrariesReady = false;
function tmLoadLibraries() {
  if (tmLibraries) return tmLibraries;
  const doc = typeof document === "undefined" ? null : document;
  if (!doc || typeof doc.createElement !== "function" || !doc.head) {
    tmLibrariesReady = true;
    return (tmLibraries = Promise.resolve());
  }
  // A library that fails (or never answers) still lets Teams open with its plain fallbacks.
  tmLibraries = Promise.all(TM_LIBRARIES.map((src) => new Promise((resolve) => {
    const css = /\.css(\?|$)/.test(src), el = doc.createElement(css ? "link" : "script");
    let timer = null;
    const done = () => { el.onload = el.onerror = null; if (timer) clearTimeout(timer); resolve(); };
    el.onload = done;
    el.onerror = done;
    if (typeof setTimeout === "function") timer = setTimeout(done, 20000);
    if (css) {
      el.rel = "stylesheet";
      el.href = src;
      // Before the Teams stylesheets, so their light and dark colours still win.
      const first = typeof doc.querySelector === "function" ? doc.querySelector('link[href^="teams"]') : null;
      if (first && first.parentNode) first.parentNode.insertBefore(el, first); else doc.head.appendChild(el);
    } else {
      el.src = src;
      el.async = false;
      doc.head.appendChild(el);
    }
  }))).then(() => { tmLibrariesReady = true; });
  return tmLibraries;
}
async function openTeamsTab() {
  if (!tmState.access || tmState.token !== state.token) {
    if (!(await tmCheckAccess())) return;
  }
  if (!tmLibrariesReady) {
    const generation = tmState.generation;
    tmShowLoading();
    await tmLoadLibraries();
    if (generation !== tmState.generation || !tmState.access) return;
  }
  if (tmState.tracker) tmRenderTracker(); else tmRenderSpaces();
}
function tmRenderSpaces() {
  tmDestroyView();
  tmState.tracker = null;
  tmState.rows = [];
  tmState.search = "";
  tmState.removed = null;
  if (tmNode("tm-undo")) tmNode("tm-undo").hidden = true;
  tmError("");
  const trackers = tmState.trackers.filter((tracker) => tracker.department === tmState.department);
  tmNode("tm-workspace").innerHTML = `<div class="head"><div class="grow"><h1>${tmEsc(T.tmTitle)}</h1></div><button type="button" class="secondary" data-tm-action="refresh">${tmEsc(T.tmRefresh)}</button><button type="button" class="primary" data-tm-action="new">+ ${tmEsc(T.tmNewTracker)}</button></div>` +
    `<div class="tm-departments chips" aria-label="${tmEsc(T.tmDepartment)}">${tmSpaceDepartments().map((department) => `<button type="button" class="chip${department === tmState.department ? " active" : ""}" data-tm-department="${tmEsc(department)}" aria-pressed="${department === tmState.department}">${tmEsc(department)}</button>`).join("")}</div>` +
    `<div class="tm-tracker-grid">${trackers.map((tracker) => `<button type="button" class="tm-tracker-card card" data-tm-tracker="${tmEsc(tracker.id)}"><strong>${tmEsc(tracker.name)}</strong><span class="muted">${tmEsc(T.tmRows(tracker.rowCount || 0))}</span></button>`).join("")}</div>` +
    (trackers.length ? "" : `<div class="tm-empty">${tmEsc(T.tmNoTrackers)}</div>`);
}
async function tmRefresh() {
  if (tmState.tracker) return tmOpenTracker(tmState.tracker.id);
  if (await tmCheckAccess()) tmRenderSpaces();
}
function tmOpenNew() {
  if (!tmState.access) return;
  tmState.newClientId = tmId("TT");
  const preferred = tmState.templates.find((template) => template.department === tmState.department) || tmState.templates[0];
  tmNode("tm-template").innerHTML = tmState.templates.map((template) => `<option value="${tmEsc(template.key)}">${tmEsc(template.name)}</option>`).join("");
  tmNode("tm-template").value = preferred ? preferred.key : "blank";
  tmNode("tm-new-dept").innerHTML = tmState.departments.map((department) => `<option value="${tmEsc(department)}">${tmEsc(department)}</option>`).join("");
  tmNode("tm-new-dept").value = tmState.departments.includes(tmState.department) ? tmState.department : tmState.departments[0] || "";
  tmNode("tm-new-name").value = preferred ? preferred.name : T.tmNewTracker;
  tmError("", "tm-new-error");
  tmNode("tm-new-save").disabled = false;
  tmNode("tm-new-dialog").showModal();
  tmNode("tm-new-name").focus();
}
async function tmCreate(event) {
  event.preventDefault();
  const name = tmNode("tm-new-name").value.trim();
  if (!name) return tmError(T.tmNameNeeded, "tm-new-error");
  const button = tmNode("tm-new-save");
  if (button.disabled) return;
  button.disabled = true;
  tmError("", "tm-new-error");
  const token = state.token;
  try {
    const reply = await api("saveTracker", { tracker: { clientId: tmState.newClientId, name, department: tmNode("tm-new-dept").value, template: tmNode("tm-template").value } });
    if (token !== state.token) return;
    if (!reply.ok) throw tmReplyError(reply, "tm-new-error");
    tmNode("tm-new-dialog").close();
    if (!tmState.trackers.some((item) => item.id === reply.tracker.id)) tmState.trackers.push({ id: reply.tracker.id, department: reply.tracker.department, name: reply.tracker.name, rowCount: 0 });
    await tmCheckAccess();
    if (tmState.access) await tmOpenTracker(reply.tracker.id);
  } catch (error) { tmError(error.message || T.tmSaveFailed, "tm-new-error"); }
  finally { button.disabled = false; }
}
async function tmWaitForRows() { await Promise.all([...tmState.queues.values(), ...(tmState.renameRequest ? [tmState.renameRequest] : [])]); }
async function tmOpenTracker(id) {
  if (!tmState.access) return;
  try { await tmWaitForRows(); } catch (error) { return; }
  const opening = ++tmState.opening, token = state.token;
  tmError("");
  tmShowLoading();
  const [reply] = await Promise.all([api("getTracker", { id }), tmLoadLibraries()]);
  if (token !== state.token || opening !== tmState.opening) return;
  if (!reply.ok) {
    if (tmState.tracker) tmRenderTracker(); else tmRenderSpaces();
    tmReplyError(reply);
    return;
  }
  tmDestroyView();
  tmState.tracker = reply.tracker;
  tmState.rows = reply.rows || [];
  tmState.department = reply.tracker.department;
  tmState.search = "";
  tmState.removed = null;
  tmNode("tm-undo").hidden = true;
  let saved = "";
  try { saved = localStorage.getItem("css_tracker_view_" + id) || ""; } catch (error) { /* optional device preference */ }
  const views = tmAvailableViews();
  tmState.view = views.includes(saved) ? saved : views.includes((reply.tracker.views || {}).default) ? reply.tracker.views.default : "table";
  tmError("");
  tmRenderTracker();
}
function tmAvailableViews() {
  return typeof tvAvailableViews === "function" ? tvAvailableViews(tmState.tracker) : ["table"];
}
function tmRenderTracker() {
  const tracker = tmState.tracker;
  if (!tracker) return;
  tmDestroyView();
  const views = tmAvailableViews();
  if (!views.includes(tmState.view)) tmState.view = "table";
  tmNode("tm-workspace").innerHTML = `<div class="head tm-tracker-head"><button type="button" class="link" data-tm-action="back">&#8592; ${tmEsc(T.tmBack)}</button><div class="grow"><input id="tm-tracker-name" class="tm-name" aria-label="${tmEsc(T.tmName)}" value="${tmEsc(tracker.name)}" maxlength="80"${tmState.renaming ? " disabled" : ""}></div><details class="tm-menu"><summary aria-label="${tmEsc(T.tmMenu)}">&#8943;</summary><div><button type="button" class="link" data-tm-action="csv">${tmEsc(T.tmDownload)}</button><button type="button" class="link danger" data-tm-action="remove-tracker">${tmEsc(T.tmRemoveTracker)}</button></div></details></div>` +
    `<div class="tm-toolbar"><div class="chips" aria-label="${tmEsc(T.tmDefaultView)}">${views.map((view) => `<button type="button" class="chip${view === tmState.view ? " active" : ""}" data-tm-view="${view}" aria-pressed="${view === tmState.view}">${tmEsc(T["tm" + view[0].toUpperCase() + view.slice(1)])}</button>`).join("")}</div><input type="search" id="tm-search" class="tm-search" aria-label="${tmEsc(T.tmSearch)}" placeholder="${tmEsc(T.tmSearch)}" value="${tmEsc(tmState.search)}"><button type="button" class="secondary" data-tm-action="columns">${tmEsc(T.tmColumns)}</button><button type="button" class="primary" data-tm-action="add">+ ${tmEsc(T.tmAdd)}</button></div><div id="tm-view" class="tm-view"></div>`;
  tmRenderView();
}
function tmVisibleRows() {
  const words = tmState.search.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!words.length) return tmState.rows;
  return tmState.rows.filter((row) => {
    const text = tmState.tracker.fields.map((field) => typeof tvCellText === "function" ? tvCellText(field, row.values[field.id], tmState.team) : String(row.values[field.id] || "")).join(" ").toLowerCase();
    return words.every((word) => text.includes(word));
  });
}
function tmRenderView() {
  const el = tmNode("tm-view");
  if (!el || !tmState.tracker) return;
  if (tmState.queues.size) { tmState.viewRefreshPending = true; return; }
  tmState.viewRefreshPending = false;
  const rows = tmVisibleRows(), emptyText = tmState.rows.length && !rows.length ? T.tmNoMatches : T.tmEmpty;
  if (typeof tvRender !== "function") { el.textContent = rows.length ? "" : emptyText; return; }
  tvRender(el, tmState.view, { tracker: tmState.tracker, rows, team: tmState.team, emptyText,
    onEdit: (rowId, fieldId, value) => tmSaveRow(rowId, { [fieldId]: value }),
    onMove: (rowId, fieldId, value) => tmSaveRow(rowId, { [fieldId]: value }),
    onOpen: tmOpenRecord, onAdd: (values) => tmOpenRecord(null, values || {}) });
}
async function tmSetView(view) {
  if (!tmAvailableViews().includes(view)) return;
  try { await tmWaitForRows(); } catch (error) { return; }
  if (!tmState.tracker) return;
  tmState.view = view;
  try { localStorage.setItem("css_tracker_view_" + tmState.tracker.id, view); } catch (error) { /* optional device preference */ }
  tmRenderTracker();
}
async function tmRename(name) {
  const tracker = tmState.tracker;
  if (!tracker || name === tracker.name || tmState.renaming) return;
  if (!name.trim()) { tmNode("tm-tracker-name").value = tracker.name; return tmError(T.tmNameNeeded); }
  const token = state.token;
  tmState.renaming = true;
  tmNode("tm-tracker-name").disabled = true;
  try {
    tmState.renameRequest = api("saveTracker", { tracker: { id: tracker.id, name: name.trim() } });
    const reply = await tmState.renameRequest;
    if (token !== state.token || !tmState.tracker || tmState.tracker.id !== tracker.id) return;
    if (!reply.ok) { tmNode("tm-tracker-name").value = tracker.name; tmReplyError(reply); return; }
    tmState.tracker = reply.tracker;
    tmNode("tm-tracker-name").value = reply.tracker.name;
    const card = tmState.trackers.find((item) => item.id === tracker.id);
    if (card) card.name = reply.tracker.name;
    tmError("");
  } catch (error) {
    if (token === state.token && tmState.tracker && tmState.tracker.id === tracker.id) tmNode("tm-tracker-name").value = tracker.name;
    tmError(error.message || T.tmSaveFailed);
  } finally {
    if (token === state.token) {
      tmState.renaming = false;
      tmState.renameRequest = null;
      if (tmState.tracker && tmState.tracker.id === tracker.id) tmNode("tm-tracker-name").disabled = false;
    }
  }
}
// Serialize each row's saves, sending only the changed cells. Failed saves never replace the saved row.
function tmSaveRow(id, values, clientId) {
  if (!tmState.access || !tmState.tracker) return Promise.reject(new Error(T.tmPresidentOnly));
  const trackerId = tmState.tracker.id, token = state.token, generation = tmState.generation;
  const key = id || clientId;
  const previous = tmState.queues.get(key) || Promise.resolve();
  const queues = tmState.queues;
  const promise = previous.catch(() => {}).then(async () => {
    if (state.token !== token || generation !== tmState.generation) throw new Error(T.tmSaveFailed);
    const reply = await api("saveTrackerRow", { trackerId, row: { ...(id ? { id } : { clientId }), values: tmCopy(values) } });
    if (state.token !== token || generation !== tmState.generation) throw new Error(T.tmSaveFailed);
    if (!reply.ok) throw tmReplyError(reply);
    if (tmState.tracker && tmState.tracker.id === trackerId) {
      const index = tmState.rows.findIndex((row) => row.id === reply.row.id);
      if (index < 0) tmState.rows.push(reply.row); else tmState.rows[index] = reply.row;
      const card = tmState.trackers.find((tracker) => tracker.id === trackerId);
      if (card) card.rowCount = tmState.rows.length;
      tmError("");
    }
    return reply.row;
  });
  queues.set(key, promise);
  // This handler only removes the settled queue entry; callers still receive the rejection.
  const settled = () => {
    if (queues.get(key) === promise) queues.delete(key);
    if (queues === tmState.queues && !queues.size && tmState.viewRefreshPending) tmRenderView();
  };
  promise.then(settled, settled);
  return promise;
}
function tmInput(field, value, index) {
  const id = "tm-value-" + index, label = `<label for="${id}">${tmEsc(field.name)}</label>`;
  if (field.type === "checkbox") return `<label class="tm-check"><input type="checkbox" id="${id}"${value === true ? " checked" : ""}> ${tmEsc(field.name)}</label>`;
  if (field.type === "longtext") return label + `<textarea id="${id}" rows="4" maxlength="5000">${tmEsc(value)}</textarea>`;
  if (field.type === "choice" || field.type === "person") {
    const options = field.type === "choice" ? (field.options || []).map((option) => [option.id, option.label]) : tmState.team.filter((person) => person.active !== false).map((person) => [person.name, person.name]);
    if (value && !options.some(([key]) => key === value)) options.push([value, value]);
    return label + `<select id="${id}"><option value="">${tmEsc(T.tmChoose)}</option>${options.map(([key, text]) => `<option value="${tmEsc(key)}"${key === value ? " selected" : ""}>${tmEsc(text)}</option>`).join("")}</select>`;
  }
  const type = { number: "number", money: "number", date: "date", link: "url" }[field.type] || "text";
  return label + `<input id="${id}" type="${type}" value="${tmEsc(value)}"${type === "number" ? ' step="any"' : type === "text" || type === "url" ? ' maxlength="500"' : ""}>`;
}
async function tmOpenRecord(id, initial = {}) {
  try { await tmWaitForRows(); } catch (error) { return; }
  if (!tmState.access || !tmState.tracker) return;
  const row = id ? tmFindRow(id) : null;
  if (id && !row) return;
  const values = tmCopy(row ? row.values : initial);
  tmState.record = { id: row ? row.id : "", clientId: row ? "" : tmId("TR"), baseline: tmCopy(values), values, trackerId: tmState.tracker.id };
  tmNode("tm-record-title").textContent = row ? T.tmRecord : T.tmNewRecord;
  tmNode("tm-record-fields").innerHTML = tmState.tracker.fields.map((field, index) => `<div class="tm-record-field">${tmInput(field, values[field.id] == null ? "" : values[field.id], index)}</div>`).join("");
  tmNode("tm-record-remove").hidden = !row;
  tmNode("tm-record-task").hidden = !row || typeof newTaskFrom !== "function";
  tmUpdateCalendarLink();
  tmNode("tm-record-save").disabled = false;
  tmError("", "tm-record-error");
  tmNode("tm-record-dialog").showModal();
}
// What a record hands to Tasks and Google Calendar: the first column as the title, the Calendar's date, and every Person named.
function tmRecordSummary(values) {
  const tracker = tmState.tracker, fields = tracker.fields || [];
  const first = fields[0], raw = first ? values[first.id] : "";
  const title = first ? (typeof tvCellText === "function" ? tvCellText(first, raw, tmState.team) : String(raw == null ? "" : raw)) : "";
  const dateField = typeof tvViewField === "function" ? tvViewField(tracker, "calendar") : fields.find((field) => field.type === "date");
  const date = dateField ? String(values[dateField.id] || "") : "";
  const owners = [];
  fields.forEach((field) => {
    const name = field.type === "person" ? String(values[field.id] || "").trim() : "";
    if (name && !owners.includes(name)) owners.push(name);
  });
  return { title: String(title).trim(), due: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "", owners };
}
function tmShowRecordLinks() {
  if (tmNode("tm-record-links")) tmNode("tm-record-links").hidden = tmNode("tm-record-task").hidden && tmNode("tm-record-calendar").hidden;
}
// Follows the date and title on screen, so a changed date goes to Google Calendar as typed.
function tmUpdateCalendarLink() {
  const link = tmNode("tm-record-calendar"), record = tmState.record;
  if (!link) return;
  let href = "";
  if (record && record.id && tmState.tracker && typeof googleCalendarUrl === "function") {
    let values = record.baseline;
    try { values = tmRecordValues(); } catch (error) { /* a half-typed number: use the saved values */ }
    const summary = tmRecordSummary(values);
    if (summary.due) href = googleCalendarUrl(summary.title || T.tmUntitled, summary.due, tmState.tracker.name) || "";
  }
  if (href) link.href = href;
  link.hidden = !href;
  tmShowRecordLinks();
}
async function tmMakeTask() {
  const record = tmState.record, tracker = tmState.tracker;
  if (!record || !record.id || !tracker || typeof newTaskFrom !== "function") return;
  const row = tmFindRow(record.id);
  if (!row) return;
  const summary = tmRecordSummary(row.values || {});
  const preset = { title: summary.title, due: summary.due, owners: summary.owners, department: tracker.department, notes: tracker.name };
  if (!(await tmCloseRecord())) return;
  newTaskFrom(preset);
}
function tmRecordValues() {
  const values = {};
  tmState.tracker.fields.forEach((field, index) => {
    const input = tmNode("tm-value-" + index);
    let value = field.type === "checkbox" ? input.checked : input.value;
    if (field.type === "number" || field.type === "money") {
      value = value === "" ? "" : Number(value);
      if (value !== "" && !Number.isFinite(value)) throw new Error(T.tmInvalidNumber);
    }
    values[field.id] = value;
  });
  return values;
}
function tmRecordChanges(values) {
  const baseline = tmState.record.baseline, changed = {};
  Object.keys(values).forEach((key) => { if (!tmSame(values[key], baseline[key] == null ? (typeof values[key] === "boolean" ? false : "") : baseline[key])) changed[key] = values[key]; });
  return changed;
}
async function tmCloseRecord() {
  if (tmNode("tm-record-save").disabled) return false;
  try {
    if (tmState.record && Object.keys(tmRecordChanges(tmRecordValues())).length && !(await askConfirm(T.tmDiscard, T.tmDiscardYes))) return false;
  } catch (error) { if (!(await askConfirm(T.tmDiscard, T.tmDiscardYes))) return false; }
  tmNode("tm-record-dialog").close();
  tmState.record = null;
  return true;
}
async function tmSaveRecord(event) {
  event.preventDefault();
  const record = tmState.record, button = tmNode("tm-record-save");
  if (!record || button.disabled) return;
  button.disabled = true;
  tmError("", "tm-record-error");
  try {
    const values = tmRecordValues(), changed = record.id ? tmRecordChanges(values) : values;
    if (!record.id || Object.keys(changed).length) await tmSaveRow(record.id, changed, record.clientId);
    if (tmState.record !== record) return;
    tmNode("tm-record-dialog").close();
    tmState.record = null;
    tmRenderView();
  } catch (error) { tmError(error.message || T.tmSaveFailed, "tm-record-error"); }
  finally { button.disabled = false; }
}
async function tmRemoveRecord() {
  const record = tmState.record;
  if (!record || !record.id || tmNode("tm-record-save").disabled || !(await askConfirm(T.tmRecordRemoveConfirm, T.tmRemove))) return;
  const row = tmFindRow(record.id), token = state.token;
  tmNode("tm-record-save").disabled = true;
  try {
    await tmWaitForRows();
    const reply = await api("removeTrackerRow", { id: record.id });
    if (token !== state.token) return;
    if (!reply.ok) throw tmReplyError(reply, "tm-record-error");
    tmState.rows = tmState.rows.filter((item) => item.id !== record.id);
    const card = tmState.trackers.find((item) => item.id === record.trackerId);
    if (card) card.rowCount = tmState.rows.length;
    tmState.removed = { row, trackerId: record.trackerId };
    tmNode("tm-undo").hidden = false;
    tmNode("tm-record-dialog").close();
    tmState.record = null;
    tmRenderView();
  } catch (error) { tmError(error.message || T.tmSaveFailed, "tm-record-error"); }
  finally { tmNode("tm-record-save").disabled = false; }
}
async function tmUndoRemove() {
  const removed = tmState.removed;
  if (!removed || tmNode("tm-undo-button").disabled) return;
  tmNode("tm-undo-button").disabled = true;
  const token = state.token;
  try {
    const reply = await api("removeTrackerRow", { id: removed.row.id, undo: true });
    if (token !== state.token) return;
    if (!reply.ok) throw tmReplyError(reply);
    if (tmState.tracker && tmState.tracker.id === removed.trackerId && !tmFindRow(removed.row.id)) {
      tmState.rows.push(reply.row || removed.row);
      const card = tmState.trackers.find((item) => item.id === removed.trackerId);
      if (card) card.rowCount = tmState.rows.length;
      tmState.rows.sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0));
      tmRenderView();
    }
    tmState.removed = null;
    tmNode("tm-undo").hidden = true;
  } catch (error) { tmError(error.message || T.tmSaveFailed); }
  finally { tmNode("tm-undo-button").disabled = false; }
}
async function tmRemoveTracker() {
  const tracker = tmState.tracker;
  if (!tracker || !(await askConfirm(T.tmTrackerRemoveConfirm(tracker.name), T.tmRemove))) return;
  try {
    await tmWaitForRows();
    const token = state.token, reply = await api("removeTracker", { id: tracker.id });
    if (token !== state.token) return;
    if (!reply.ok) throw tmReplyError(reply);
    tmState.trackers = tmState.trackers.filter((item) => item.id !== tracker.id);
    tmState.tracker = null;
    tmNode("tm-undo").hidden = true;
    tmRenderSpaces();
    showToast(T.tmTrackerRemoved);
  } catch (error) { tmError(error.message || T.tmSaveFailed); }
}
function tmCsvText() {
  const quote = (value) => '"' + String(value == null ? "" : value).replace(/^[=+@-]/, "'$&").replace(/"/g, '""') + '"';
  const fields = tmState.tracker.fields;
  return "\ufeff" + [fields.map((field) => field.name), ...tmVisibleRows().map((row) => fields.map((field) => typeof tvCellText === "function" ? tvCellText(field, row.values[field.id], tmState.team) : row.values[field.id]))].map((cells) => cells.map(quote).join(",")).join("\r\n");
}
function tmCsvName(name) { return (String(name || "").replace(/[\\/:*?"<>|]+/g, "").trim().replace(/\s+/g, "-") || "tracker") + ".csv"; }
function tmDownloadCsv() {
  if (!tmState.tracker) return;
  const url = URL.createObjectURL(new Blob([tmCsvText()], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = tmCsvName(tmState.tracker.name);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function tmOpenColumns() {
  tmState.columns = { fields: tmCopy(tmState.tracker.fields), views: tmCopy(tmState.tracker.views), baseline: JSON.stringify({ fields: tmState.tracker.fields, views: tmState.tracker.views }) };
  tmError("", "tm-columns-error");
  tmRenderColumns();
  tmNode("tm-columns-dialog").showModal();
}
function tmSelectOptions(items, selected) { return items.map(([key, label]) => `<option value="${tmEsc(key)}"${key === selected ? " selected" : ""}>${tmEsc(label)}</option>`).join(""); }
function tmRenderColumns() {
  const fields = tmState.columns.fields;
  tmNode("tm-columns-fields").innerHTML = fields.map((field, index) => `<section class="tm-column" data-tm-field="${tmEsc(field.id)}"><div class="tm-column-main"><input data-tm-column-name="${tmEsc(field.id)}" aria-label="${tmEsc(T.tmName)}" maxlength="60" value="${tmEsc(field.name)}"><select data-tm-column-type="${tmEsc(field.id)}" aria-label="${tmEsc(T.tmType)}">${tmSelectOptions(Object.entries(T.tmFieldTypes), field.type)}</select><button type="button" class="icon-btn" data-tm-column-up="${tmEsc(field.id)}" aria-label="${tmEsc(T.tmUp)}"${index === 0 ? " disabled" : ""}>&#8593;</button><button type="button" class="icon-btn" data-tm-column-down="${tmEsc(field.id)}" aria-label="${tmEsc(T.tmDown)}"${index === fields.length - 1 ? " disabled" : ""}>&#8595;</button><button type="button" class="link danger" data-tm-column-remove="${tmEsc(field.id)}"${fields.length === 1 ? " disabled" : ""}>${tmEsc(T.tmRemove)}</button></div>` +
    (field.type === "choice" ? `<div class="tm-choice-list">${(field.options || []).map((option) => `<div class="tm-choice"><input data-tm-option-label="${tmEsc(option.id)}" data-tm-parent="${tmEsc(field.id)}" aria-label="${tmEsc(T.tmName)}" maxlength="60" value="${tmEsc(option.label)}"><select data-tm-option-color="${tmEsc(option.id)}" data-tm-parent="${tmEsc(field.id)}" aria-label="${tmEsc(T.tmColor)}">${tmSelectOptions(Object.entries(T.tmColors), option.color)}</select><button type="button" class="link danger" data-tm-option-remove="${tmEsc(option.id)}" data-tm-parent="${tmEsc(field.id)}">${tmEsc(T.tmRemove)}</button></div>`).join("")}<button type="button" class="link" data-tm-option-add="${tmEsc(field.id)}">+ ${tmEsc(T.tmAddOption)}</button></div>` : "") + `</section>`).join("");
  tmNode("tm-column-add").disabled = fields.length >= 30;
  tmRenderColumnViews();
}
function tmRenderColumnViews() {
  const draft = tmState.columns, choices = draft.fields.filter((field) => field.type === "choice"), dates = draft.fields.filter((field) => field.type === "date");
  if (!choices.some((field) => field.id === draft.views.boardField)) draft.views.boardField = choices[0] ? choices[0].id : "";
  if (!dates.some((field) => field.id === draft.views.dateField)) draft.views.dateField = dates[0] ? dates[0].id : "";
  const views = [["table", T.tmTable], ...(choices.length ? [["board", T.tmBoard]] : []), ...(dates.length ? [["calendar", T.tmCalendar]] : [])];
  if (!views.some(([key]) => key === draft.views.default)) draft.views.default = "table";
  tmNode("tm-columns-views").innerHTML = `<label for="tm-board-field">${tmEsc(T.tmBoardField)}</label><select id="tm-board-field"${choices.length ? "" : " disabled"}>${tmSelectOptions(choices.length ? choices.map((field) => [field.id, field.name]) : [["", T.tmNoBoardField]], draft.views.boardField)}</select><label for="tm-date-field">${tmEsc(T.tmDateField)}</label><select id="tm-date-field"${dates.length ? "" : " disabled"}>${tmSelectOptions(dates.length ? dates.map((field) => [field.id, field.name]) : [["", T.tmNoDateField]], draft.views.dateField)}</select><label for="tm-default-view">${tmEsc(T.tmDefaultView)}</label><select id="tm-default-view">${tmSelectOptions(views, draft.views.default)}</select>`;
}
async function tmColumnsClick(event) {
  const target = event.target.closest("button");
  if (!target || !tmState.columns) return;
  const fields = tmState.columns.fields, data = target.dataset;
  if (data.tmColumnUp || data.tmColumnDown) {
    const index = fields.findIndex((field) => field.id === (data.tmColumnUp || data.tmColumnDown)), next = index + (data.tmColumnUp ? -1 : 1);
    if (index < 0 || next < 0 || next >= fields.length) return;
    [fields[index], fields[next]] = [fields[next], fields[index]];
  } else if (data.tmColumnRemove) {
    const index = fields.findIndex((field) => field.id === data.tmColumnRemove);
    if (index < 0 || fields.length === 1 || !(await askConfirm(T.tmRemoveColumnConfirm(fields[index].name), T.tmRemove))) return;
    fields.splice(index, 1);
  } else if (data.tmOptionAdd) {
    const field = fields.find((item) => item.id === data.tmOptionAdd);
    if (!field) return;
    if ((field.options || []).length >= 30) return tmError(T.tmOptionLimit, "tm-columns-error");
    (field.options ||= []).push({ id: tmId("O"), label: T.tmNewOption, color: "blue" });
  } else if (data.tmOptionRemove) {
    const field = fields.find((item) => item.id === data.tmParent);
    field.options = (field.options || []).filter((option) => option.id !== data.tmOptionRemove);
  } else return;
  tmRenderColumns();
}
function tmColumnsInput(event) {
  const data = event.target.dataset, fields = tmState.columns && tmState.columns.fields;
  if (!fields) return;
  if (data.tmColumnName) fields.find((field) => field.id === data.tmColumnName).name = event.target.value;
  if (data.tmOptionLabel || data.tmOptionColor) {
    const option = fields.find((field) => field.id === data.tmParent).options.find((item) => item.id === (data.tmOptionLabel || data.tmOptionColor));
    option[data.tmOptionLabel ? "label" : "color"] = event.target.value;
  }
}
// Choices stay in the draft while the type changes, so Choice > Text > Choice keeps them. The server keeps choices only on Choice columns.
async function tmColumnType(event) {
  const draft = tmState.columns, select = event.target;
  const field = draft && draft.fields.find((item) => item.id === select.dataset.tmColumnType);
  if (!field) return;
  const next = select.value, saved = tmState.tracker && tmState.tracker.fields.find((item) => item.id === field.id);
  if (next === field.type) return;
  if (saved && next !== saved.type && !(await askConfirm(T.tmTypeChangeConfirm(field.name || saved.name), T.tmChangeType))) {
    if (tmState.columns === draft) select.value = field.type;
    return;
  }
  if (tmState.columns !== draft) return;
  field.type = next;
  if (field.type === "choice" && !field.options) field.options = [];
  tmRenderColumns();
}
async function tmCloseColumns() {
  if (tmNode("tm-columns-save").disabled) return;
  const draft = tmState.columns;
  if (draft && JSON.stringify({ fields: draft.fields, views: draft.views }) !== draft.baseline && !(await askConfirm(T.tmDiscard, T.tmDiscardYes))) return;
  tmNode("tm-columns-dialog").close();
  tmState.columns = null;
}
async function tmSaveColumns(event) {
  event.preventDefault();
  const draft = tmState.columns, button = tmNode("tm-columns-save"), tracker = tmState.tracker, token = state.token;
  if (!draft || button.disabled) return;
  if (draft.fields.some((field) => !field.name.trim() || (field.type === "choice" ? field.options || [] : []).some((option) => !option.label.trim()))) return tmError(T.tmFieldNameNeeded, "tm-columns-error");
  button.disabled = true;
  tmError("", "tm-columns-error");
  try {
    await tmWaitForRows();
    const fields = draft.fields.map((field) => { const { options, ...rest } = field; return field.type === "choice" ? field : rest; });
    const reply = await api("saveTracker", { tracker: { id: tracker.id, fields, views: draft.views } });
    if (token !== state.token || tmState.columns !== draft) return;
    if (!reply.ok) throw tmReplyError(reply, "tm-columns-error");
    tmState.tracker = reply.tracker;
    tmState.columns = null;
    tmNode("tm-columns-dialog").close();
    await tmOpenTracker(tracker.id);
  } catch (error) { tmError(error.message || T.tmSaveFailed, "tm-columns-error"); }
  finally { button.disabled = false; }
}
async function tmLeave(name) {
  if (name === "teams" || !tmState.access) return true;
  if (tmState.queues.size) {
    try { await tmWaitForRows(); } catch (error) { return false; }
  }
  tmDestroyView();
  return true;
}
function tmBind(id, event, handler) { if (tmNode(id)) tmNode(id).addEventListener(event, handler); }
tmBind("tm-workspace", "click", (event) => {
  const target = event.target.closest("button");
  if (!target) return;
  const data = target.dataset;
  if (data.tmDepartment !== undefined) { tmState.department = data.tmDepartment; return tmRenderSpaces(); }
  if (data.tmTracker) return tmRun(() => tmOpenTracker(data.tmTracker));
  if (data.tmView) return tmRun(() => tmSetView(data.tmView));
  const actions = { new: tmOpenNew, refresh: tmRefresh, back: async () => { await tmWaitForRows(); tmRenderSpaces(); }, add: () => tmOpenRecord(null), columns: tmOpenColumns, csv: tmDownloadCsv, "remove-tracker": tmRemoveTracker };
  if (!actions[data.tmAction]) return;
  if (data.tmAction === "csv" || data.tmAction === "remove-tracker") tmCloseMenu();
  tmRun(actions[data.tmAction]);
});
function tmCloseMenu() {
  const workspace = tmNode("tm-workspace"), menu = workspace && typeof workspace.querySelector === "function" ? workspace.querySelector("details.tm-menu") : null;
  if (menu) menu.open = false;
}
tmBind("tm-workspace", "input", (event) => { if (event.target.id === "tm-search") { tmState.search = event.target.value; tmRenderView(); } });
tmBind("tm-workspace", "change", (event) => { if (event.target.id === "tm-tracker-name") tmRun(() => tmRename(event.target.value)); });
tmBind("tm-workspace", "keydown", (event) => { if (event.target.id === "tm-tracker-name" && event.key === "Enter") { event.preventDefault(); event.target.blur(); } });
tmBind("tm-template", "change", () => { const template = tmState.templates.find((item) => item.key === tmNode("tm-template").value); if (template) { tmNode("tm-new-name").value = template.name; if (tmState.departments.includes(template.department)) tmNode("tm-new-dept").value = template.department; } });
tmBind("tm-new-form", "submit", tmCreate);
tmBind("tm-new-cancel", "click", () => { if (!tmNode("tm-new-save").disabled) tmNode("tm-new-dialog").close(); });
tmBind("tm-record-form", "submit", tmSaveRecord);
tmBind("tm-record-close", "click", () => tmRun(tmCloseRecord));
tmBind("tm-record-remove", "click", () => tmRun(tmRemoveRecord));
tmBind("tm-record-task", "click", () => tmRun(tmMakeTask));
tmBind("tm-record-fields", "input", tmUpdateCalendarLink);
tmBind("tm-record-fields", "change", tmUpdateCalendarLink);
tmBind("tm-record-dialog", "cancel", (event) => { event.preventDefault(); tmRun(tmCloseRecord); });
tmBind("tm-columns-fields", "click", (event) => tmRun(() => tmColumnsClick(event)));
tmBind("tm-columns-fields", "input", (event) => { if (event.target.dataset.tmColumnName || event.target.dataset.tmOptionLabel) tmColumnsInput(event); });
tmBind("tm-columns-fields", "change", (event) => {
  if (event.target.dataset.tmColumnType) tmRun(() => tmColumnType(event));
  else if (event.target.dataset.tmOptionColor) tmColumnsInput(event);
});
tmBind("tm-columns-views", "change", (event) => { const keys = { "tm-board-field": "boardField", "tm-date-field": "dateField", "tm-default-view": "default" }; if (tmState.columns && keys[event.target.id]) tmState.columns.views[keys[event.target.id]] = event.target.value; });
tmBind("tm-column-add", "click", () => { if (!tmState.columns || tmState.columns.fields.length >= 30) return; tmState.columns.fields.push({ id: tmId("F"), name: T.tmNewColumn, type: "text" }); tmRenderColumns(); });
tmBind("tm-columns-form", "submit", tmSaveColumns);
tmBind("tm-columns-close", "click", () => tmRun(tmCloseColumns));
tmBind("tm-columns-dialog", "cancel", (event) => { event.preventDefault(); tmRun(tmCloseColumns); });
tmBind("tm-new-dialog", "cancel", (event) => { if (tmNode("tm-new-save").disabled) event.preventDefault(); });
tmBind("tm-undo-button", "click", () => tmRun(tmUndoRemove));

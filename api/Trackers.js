/** Department workspaces. Every route checks the signed-in person's Presidents department. */
const TRACKER_TYPES = ["text", "longtext", "number", "money", "date", "choice", "person", "link", "checkbox"];
const TRACKER_COLORS = ["blue", "green", "yellow", "red", "gold", "purple", "grey"];
const TRACKER_LIMITS = { fields: 30, options: 30, trackers: 30, rows: 2000 };

function trackerObject_(value) { return !!value && typeof value === "object" && !Array.isArray(value); }
function trackerBad_(message) { throw new ApiError_("BAD_REQUEST", message); }
function trackerHas_(o, key) { return Object.prototype.hasOwnProperty.call(o, key); }
/** Uses the live department list: removing the added Presidents department ends Teams access for everyone who had it. */
function trackerPresident_(session) {
  if (!session || session.role === "door") throw new ApiError_("NOT_PRESIDENT", "Only presidents can use Teams for now.");
  const team = readRows_("Team");
  const person = session.personId ? team.filter(function (p) { return p.id === session.personId; })[0] : taskTeamByName_(session.name);
  if (!person || !isOn_(person.active) || !teamDepartmentsOf_(person).some(function (d) { return teamNameKey_(d) === "presidents"; })) {
    throw new ApiError_("NOT_PRESIDENT", "Only presidents can use Teams for now.");
  }
  return session;
}
function requirePresident_(token) { return trackerPresident_(requireSession_(token)); }
function trackerLocked_(session, fn) {
  return withLock_(function () {
    ["Team", "Trackers", "TrackerRows"].forEach(function (name) { delete DB_.rows[name]; });
    trackerPresident_(session);
    return fn();
  });
}

/** Stable field and option IDs keep records intact when a column or choice is renamed. */
function trackerTemplates_() {
  function field(id, name, type, labels) {
    const result = { id: id, name: name, type: type };
    if (labels) result.options = labels.map(function (label, n) { return { id: "O" + id.slice(1) + n, label: label, color: ["grey", "blue", "yellow", "green", "red"][n % 5] }; });
    return result;
  }
  return [
    { key: "sponsorship", name: "Sponsorship tracker", department: "External", fields: [field("Fcompany", "Company", "text"), field("Fcontact", "Contact name", "text"), field("Femail", "Contact email", "text"), field("Fstatus", "Status", "choice", ["To contact", "Contacted", "In talks", "Confirmed", "Declined"]), field("Famount", "Amount", "money"), field("Fowner", "Owner", "person"), field("Ffollowup", "Next follow-up", "date"), field("Fnotes", "Notes", "longtext")], views: { default: "table", boardField: "Fstatus", dateField: "Ffollowup" } },
    { key: "content", name: "Content tracker", department: "Marketing", fields: [field("Fpost", "Post", "text"), field("Fplatform", "Platform", "choice", ["Instagram", "TikTok", "RedNote", "WeChat", "Discord"]), field("Fstatus", "Status", "choice", ["Idea", "Drafting", "Ready", "Posted"]), field("Fdate", "Post date", "date"), field("Fowner", "Owner", "person"), field("Flink", "Link", "link"), field("Fnotes", "Notes", "longtext")], views: { default: "board", boardField: "Fstatus", dateField: "Fdate" } },
    { key: "brainstorm", name: "Brainstorm", department: "Marketing", fields: [field("Fidea", "Idea", "text"), field("Fdetails", "Details", "longtext"), field("Fstatus", "Status", "choice", ["New", "Maybe", "Yes", "Used"]), field("Faddedby", "Added by", "person")], views: { default: "board", boardField: "Fstatus", dateField: "" } },
    { key: "events", name: "Tentative event dates", department: "Events", fields: [field("Fevent", "Event", "text"), field("Fdate", "Date", "date"), field("Fstatus", "Status", "choice", ["Idea", "Tentative", "Confirmed", "Cancelled"]), field("Fvenue", "Venue", "text"), field("Fowner", "Owner", "person"), field("Fnotes", "Notes", "longtext")], views: { default: "calendar", boardField: "Fstatus", dateField: "Fdate" } },
    { key: "blank", name: "Blank tracker", department: "General", fields: [field("Fname", "Name", "text"), field("Fstatus", "Status", "choice", ["To do", "Doing", "Done"]), field("Fnotes", "Notes", "longtext")], views: { default: "table", boardField: "Fstatus", dateField: "" } }
  ];
}
function trackerJson_(value, fallback) {
  if (typeof value === "string") { try { return JSON.parse(value); } catch (e) { return fallback; } }
  return value === undefined || value === null || value === "" ? fallback : value;
}
function trackerFields_(input) {
  if (!Array.isArray(input) || !input.length || input.length > TRACKER_LIMITS.fields) trackerBad_("A tracker needs 1 to 30 columns.");
  const seen = {};
  return input.map(function (f) {
    if (!trackerObject_(f) || !/^F[A-Za-z0-9_-]{1,60}$/.test(String(f.id || "")) || seen[f.id]) trackerBad_("Each column needs its own ID. Refresh and try again.");
    seen[f.id] = true;
    if (typeof f.name !== "string" || f.name.trim().length > 60 || !memberText_(f.name, 60)) trackerBad_("Give each column a name of up to 60 characters.");
    if (TRACKER_TYPES.indexOf(f.type) === -1) trackerBad_("Choose a valid column type.");
    const out = { id: f.id, name: memberText_(f.name, 60), type: f.type };
    if (f.type === "choice") {
      if (!Array.isArray(f.options) || f.options.length > TRACKER_LIMITS.options) trackerBad_("A Choice column can have up to 30 options.");
      const ids = {}, labels = {};
      out.options = f.options.map(function (o) {
        if (!trackerObject_(o) || !/^O[A-Za-z0-9_-]{1,60}$/.test(String(o.id || "")) || ids[o.id]) trackerBad_("Each choice needs its own ID.");
        if (typeof o.label !== "string" || o.label.trim().length > 60 || !memberText_(o.label, 60)) trackerBad_("Give each choice a name of up to 60 characters.");
        const label = memberText_(o.label, 60);
        if (labels[label.toLowerCase()]) trackerBad_("Choice names must be different.");
        if (TRACKER_COLORS.indexOf(o.color) === -1) trackerBad_("Choose a valid choice colour.");
        ids[o.id] = true; labels[label.toLowerCase()] = true;
        return { id: o.id, label: label, color: o.color };
      });
    }
    return out;
  });
}
function trackerViews_(input, fields, explicit) {
  if (!trackerObject_(input)) trackerBad_("Choose the tracker views again.");
  const choices = fields.filter(function (f) { return f.type === "choice"; });
  const dates = fields.filter(function (f) { return f.type === "date"; });
  const valid = function (key, list) { return list.some(function (f) { return f.id === key; }); };
  if (explicit && input.boardField && !valid(input.boardField, choices)) trackerBad_("The Board needs a Choice column.");
  if (explicit && input.dateField && !valid(input.dateField, dates)) trackerBad_("The Calendar needs a Date column.");
  let view = input.default || "table";
  if (["table", "board", "calendar"].indexOf(view) === -1) trackerBad_("Choose Table, Board or Calendar.");
  const boardField = valid(input.boardField, choices) ? input.boardField : choices.length ? choices[0].id : "";
  const dateField = valid(input.dateField, dates) ? input.dateField : dates.length ? dates[0].id : "";
  if ((view === "board" && !boardField) || (view === "calendar" && !dateField)) {
    if (explicit) trackerBad_(view === "board" ? "The Board needs a Choice column." : "The Calendar needs a Date column.");
    view = "table";
  }
  return { default: view, boardField: boardField, dateField: dateField };
}
function trackerView_(r) {
  return { id: r.id, department: r.department, name: r.name, template: r.template, fields: trackerJson_(r.trackerFields, []), views: trackerJson_(r.trackerViews, { default: "table" }), updatedAt: r.updatedAt };
}
function trackerRowView_(r, fields) {
  const stored = trackerJson_(r.rowValues, {}), values = {};
  (fields || []).forEach(function (f) {
    if (!trackerHas_(stored, f.id)) return;
    const value = stored[f.id];
    if (f.type === "checkbox") values[f.id] = value === true;
    else if (f.type === "number" || f.type === "money") values[f.id] = typeof value === "number" && isFinite(value) ? value : "";
    else if (f.type === "choice") values[f.id] = (f.options || []).some(function (o) { return o.id === value; }) ? value : "";
    else if (f.type === "date") values[f.id] = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && isFinite(Date.parse(value + "T12:00:00Z")) && new Date(value + "T12:00:00Z").toISOString().slice(0, 10) === value ? value : "";
    else values[f.id] = typeof value === "string" ? value : "";
  });
  return { id: r.id, values: fields ? values : stored, sort: Number(r.sort) || 0, createdBy: r.createdBy, createdAt: r.createdAt, updatedBy: r.updatedBy, updatedAt: r.updatedAt };
}
function trackerFind_(id) {
  const row = readRows_("Trackers").filter(function (r) { return r.id === String(id || ""); })[0];
  if (!row || row.removedAt) throw new ApiError_("NOT_FOUND", "That tracker is no longer there. Return to Teams.");
  return row;
}
function trackerRowsOf_(id) { return readRows_("TrackerRows").filter(function (r) { return r.trackerId === id && !r.removedAt; }); }
function teamSpaces_(session) {
  trackerPresident_(session);
  const rows = readRows_("TrackerRows"), depts = taskDepartments_();
  return { ok: true, departments: depts, trackers: readRows_("Trackers").filter(function (r) { return !r.removedAt; }).sort(function (a, b) { return (Number(a.sort) || 0) - (Number(b.sort) || 0) || String(a.name).localeCompare(String(b.name)); }).map(function (r) {
    return { id: r.id, department: r.department, name: r.name, template: r.template, rowCount: rows.filter(function (x) { return x.trackerId === r.id && !x.removedAt; }).length, updatedAt: r.updatedAt };
  }), templates: trackerTemplates_().map(function (t) { return { key: t.key, name: t.name, department: t.department }; }), team: readRows_("Team").map(function (p) { return { name: p.name, departments: teamDepartmentsOf_(p, depts), active: isOn_(p.active) }; }).sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); }) };
}
function getTracker_(session, id) {
  trackerPresident_(session);
  const tracker = trackerFind_(id);
  const fields = trackerJson_(tracker.trackerFields, []);
  return { ok: true, tracker: trackerView_(tracker), rows: trackerRowsOf_(tracker.id).sort(function (a, b) { return (Number(a.sort) || 0) - (Number(b.sort) || 0) || String(a.id).localeCompare(String(b.id)); }).map(function (r) { return trackerRowView_(r, fields); }) };
}
function trackerClientId_(input, prefix) {
  if (!input) return "";
  if (typeof input !== "string" || !new RegExp("^" + prefix + "[A-Za-z0-9_-]{8,60}$").test(input)) trackerBad_("Refresh and try adding it again.");
  return input;
}
function saveTracker_(session, input) {
  if (!trackerObject_(input)) trackerBad_("Choose a tracker to save.");
  return trackerLocked_(session, function () {
    const id = input.id ? String(input.id) : "";
    const clientId = id ? "" : trackerClientId_(input.clientId, "TT");
    if (clientId) {
      const repeat = readRows_("Trackers").filter(function (r) { return r.id === clientId; })[0];
      if (repeat) {
        if (repeat.removedAt) throw new ApiError_("NOT_FOUND", "That tracker was removed. Add a new tracker.");
        return { ok: true, tracker: trackerView_(repeat), repeated: true };
      }
    }
    const before = id ? trackerFind_(id) : null;
    const templateKey = before ? before.template : input.template || "blank";
    const template = trackerTemplates_().filter(function (t) { return t.key === templateKey; })[0];
    if (!template) trackerBad_("Choose one of the tracker templates.");
    if (before && trackerHas_(input, "template") && input.template !== before.template) trackerBad_("A tracker's template can't be changed after it is created.");
    const nameInput = trackerHas_(input, "name") ? input.name : before ? before.name : template.name;
    if (typeof nameInput !== "string" || !memberText_(nameInput, 80) || nameInput.trim().length > 80) trackerBad_("Give the tracker a name of up to 80 characters.");
    // An existing tracker keeps its department (even one removed from the list since) unless a different one is chosen.
    const keepDepartment = !!before && (!trackerHas_(input, "department") || teamNameKey_(input.department) === teamNameKey_(before.department));
    const department = keepDepartment ? before.department : taskDepartmentName_(trackerHas_(input, "department") ? input.department : template.department);
    if (!department) trackerBad_("Choose a department from Teams.");
    if ((!before || before.department !== department) && readRows_("Trackers").filter(function (r) { return !r.removedAt && r.department === department; }).length >= TRACKER_LIMITS.trackers) trackerBad_("A department can have up to 30 trackers. Remove one first.");
    const fields = trackerFields_(trackerHas_(input, "fields") ? input.fields : before ? trackerJson_(before.trackerFields, []) : template.fields);
    if (JSON.stringify(fields).length > 45000) trackerBad_("These columns have too many long choice names. Shorten the names or remove some choices.");
    const views = trackerViews_(trackerHas_(input, "views") ? input.views : before ? trackerJson_(before.trackerViews, {}) : template.views, fields, trackerHas_(input, "views"));
    const now = new Date().toISOString();
    const changes = { name: memberText_(nameInput, 80), department: department, trackerFields: fields, trackerViews: views, updatedBy: session.name, updatedAt: now };
    if (before) {
      const renamed = before.name !== changes.name || before.department !== department;
      updateRow_("Trackers", id, changes);
      if (renamed) log_(session.name, "tracker.renamed", id, { name: changes.name, department: department });
      return { ok: true, tracker: trackerView_(Object.assign({}, before, changes)) };
    }
    const row = Object.assign({ id: clientId || newId_("TT"), template: template.key, sort: teamNextSort_(readRows_("Trackers")), createdBy: session.name, createdAt: now, removedAt: "", removedBy: "" }, changes);
    insertRow_("Trackers", row);
    log_(session.name, "tracker.created", row.id, { name: row.name, department: row.department, template: row.template });
    return { ok: true, tracker: trackerView_(row) };
  });
}
function removeTracker_(session, id) {
  return trackerLocked_(session, function () {
    const row = readRows_("Trackers").filter(function (r) { return r.id === String(id || ""); })[0];
    if (!row) throw new ApiError_("NOT_FOUND", "That tracker is no longer there.");
    if (!row.removedAt) {
      const now = new Date().toISOString();
      updateRow_("Trackers", row.id, { removedAt: now, removedBy: session.name, updatedAt: now, updatedBy: session.name });
      log_(session.name, "tracker.removed", row.id, { name: row.name, department: row.department });
    }
    return { ok: true, id: row.id };
  });
}
function trackerCell_(field, value) {
  if (field.type === "checkbox") {
    if (typeof value !== "boolean") trackerBad_(field.name + ": choose checked or unchecked.");
    return value;
  }
  if (value === "") return "";
  if (field.type === "number" || field.type === "money") {
    if (typeof value !== "number" || !isFinite(value) || Math.abs(value) > 1000000000000) trackerBad_(field.name + ": enter a number.");
    return field.type === "money" ? Math.round(value * 100) / 100 : value;
  }
  if (typeof value !== "string") trackerBad_(field.name + ": enter text.");
  if (field.type === "date") {
    const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value + "T12:00:00Z") : null;
    if (!d || !isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== value) trackerBad_(field.name + ": choose a real date.");
    return value;
  }
  if (field.type === "choice") {
    if (!(field.options || []).some(function (o) { return o.id === value; })) trackerBad_(field.name + ": choose one of the options.");
    return value;
  }
  // Records are kept inside a JSON cell, so a Sheet never reads them as formulas: "=SUM(A1)", "@handle" and "'quoted" stay as typed.
  if (field.type === "person") {
    const person = taskTeamByName_(trackerLine_(value));
    if (!person || !isOn_(person.active)) trackerBad_(field.name + ": choose an active person from People.");
    return person.name;
  }
  const limit = field.type === "longtext" ? 5000 : 500;
  if (value.length > limit) trackerBad_(field.name + ": keep this under " + limit + " characters.");
  if (field.type === "link") {
    const text = trackerLine_(value);
    if (text && !/^https?:\/\/[^\s<>"']+$/i.test(text)) trackerBad_(field.name + ": use a link starting with https:// or http://.");
    return text;
  }
  if (field.type === "longtext") {
    return value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ").split("\n")
      .map(function (line) { return line.replace(/\s+/g, " ").replace(/ $/, ""); }).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  return trackerLine_(value);
}
/** One line of text: control characters and runs of spaces become one space, trimmed. */
function trackerLine_(value) { return String(value).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim(); }
function saveTrackerRow_(session, trackerId, input) {
  if (!trackerObject_(input) || !trackerObject_(input.values)) trackerBad_("Choose a record to save.");
  return trackerLocked_(session, function () {
    const tracker = trackerFind_(trackerId);
    const id = input.id ? String(input.id) : "";
    const clientId = id ? "" : trackerClientId_(input.clientId, "TR");
    const before = id || clientId ? readRows_("TrackerRows").filter(function (r) { return r.id === (id || clientId); })[0] : null;
    if (before && before.trackerId !== tracker.id) trackerBad_("That record belongs to another tracker.");
    if (before && before.removedAt) throw new ApiError_("NOT_FOUND", "That record was removed. Use Undo to bring it back.");
    if (id && !before) throw new ApiError_("NOT_FOUND", "That record is no longer there. Refresh the tracker.");
    if (clientId && before) return { ok: true, row: trackerRowView_(before, trackerJson_(tracker.trackerFields, [])), repeated: true };
    if (!before && trackerRowsOf_(tracker.id).length >= TRACKER_LIMITS.rows) trackerBad_("A tracker can have up to 2000 records. Remove some first.");
    const fields = trackerJson_(tracker.trackerFields, []);
    const values = Object.assign({}, before ? trackerJson_(before.rowValues, {}) : {});
    Object.keys(input.values).forEach(function (key) {
      const field = fields.filter(function (f) { return f.id === key; })[0];
      if (!field) trackerBad_("A column changed. Refresh the tracker before saving.");
      values[key] = trackerCell_(field, input.values[key]);
    });
    if (JSON.stringify(values).length > 45000) trackerBad_("This record is too long. Shorten some of its text before saving.");
    const now = new Date().toISOString();
    const changes = { rowValues: values, updatedBy: session.name, updatedAt: now };
    if (trackerHas_(input, "sort")) {
      if (typeof input.sort !== "number" || !isFinite(input.sort) || Math.abs(input.sort) > 1000000000) trackerBad_("Refresh before moving this record.");
      changes.sort = input.sort;
    }
    let saved;
    if (before) {
      updateRow_("TrackerRows", before.id, changes);
      saved = Object.assign({}, before, changes);
    } else {
      saved = Object.assign({ id: clientId || newId_("TR"), trackerId: tracker.id, sort: teamNextSort_(trackerRowsOf_(tracker.id)), createdBy: session.name, createdAt: now, removedAt: "", removedBy: "" }, changes);
      insertRow_("TrackerRows", saved);
      log_(session.name, "tracker.row.added", saved.id, { trackerId: tracker.id });
    }
    updateRow_("Trackers", tracker.id, { updatedAt: now, updatedBy: session.name });
    return { ok: true, row: trackerRowView_(saved, fields) };
  });
}
function removeTrackerRow_(session, id, undo) {
  return trackerLocked_(session, function () {
    const row = readRows_("TrackerRows").filter(function (r) { return r.id === String(id || ""); })[0];
    if (!row) throw new ApiError_("NOT_FOUND", "That record is no longer there.");
    const tracker = trackerFind_(row.trackerId);
    const wasRemoved = !!row.removedAt;
    if (undo && wasRemoved && trackerRowsOf_(tracker.id).length >= TRACKER_LIMITS.rows) trackerBad_("A tracker can have up to 2000 records. Remove one before using Undo.");
    if (wasRemoved !== !undo) {
      const now = new Date().toISOString();
      const changes = { removedAt: undo ? "" : now, removedBy: undo ? "" : session.name, updatedAt: now, updatedBy: session.name };
      updateRow_("TrackerRows", row.id, changes);
      updateRow_("Trackers", tracker.id, { updatedAt: now, updatedBy: session.name });
      log_(session.name, undo ? "tracker.row.restored" : "tracker.row.removed", row.id, { trackerId: tracker.id });
      return { ok: true, row: trackerRowView_(Object.assign({}, row, changes), trackerJson_(tracker.trackerFields, [])), removed: !undo };
    }
    return { ok: true, row: trackerRowView_(row, trackerJson_(tracker.trackerFields, [])), removed: !undo };
  });
}

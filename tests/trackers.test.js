// Teams workspaces: permissions, templates, typed records, safe concurrent edits, and undo. No network or real sheets.
const { run } = require("./harness.js");
let fails = 0;
const ok = (value, message) => { console.log((value ? "PASS " : "FAIL ") + message); if (!value) fails++; };
const attempt = (code) => { try { return { value: run(code) }; } catch (e) { return { error: e.code, message: e.message }; } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
run(`
var __logs = [], __held = false, __checkInside = false;
function log_(who, action, id, details) { __logs.push({ who, action, id, details }); }
function withLock_(fn) { if (__held) throw new Error("nested lock"); __held = true; try { if (__checkInside) { __checkInside = false; TBL.Team[0].departments = ["Events"]; } return fn(); } finally { __held = false; } }
// Presidents is a department added in Settings → People (like the real club), and so is TEST Club.
PropertiesService.getScriptProperties().setProperty("TASK_DEPARTMENTS_EXTRA", JSON.stringify(["Presidents", "TEST Club"]));
TBL.Team = [
 { id: "TMpresident", name: "TEST President", departments: ["Internal", "pReSiDeNtS"], active: true },
 { id: "TMexec", name: "TEST Exec", department: "Events", active: true },
 { id: "TMadmin", name: "TEST Admin", departments: ["Finance"], active: true },
 { id: "TMold", name: "TEST Older", department: "PRESIDENTS", active: true },
 { id: "TMoff", name: "TEST Inactive", departments: ["Presidents"], active: false }
];
TBL.Trackers = []; TBL.TrackerRows = [];
TBL.Team.slice(0, 3).forEach(function (p) { p.passwordHash = "TEST fake hash"; p.authVersion = "v1"; });
var __presToken = startSession_("TEST President", "exec", TBL.Team[0]);
var __execToken = startSession_("TEST Exec", "exec", TBL.Team[1]);
var __adminToken = startSession_("TEST Admin", "admin", TBL.Team[2]);
var __oldToken = startSession_(" TEST   Older ", "exec");
var __offToken = startSession_("TEST Inactive", "exec");
var __goneIdToken = startSession_("TEST President", "admin", { id: "TMgone" });
var PS = { name: "TEST President", role: "exec", personId: "TMpresident" };
`);
const route = (action, details = {}, token = "__presToken") => run(`route_(Object.assign(${JSON.stringify({ action, ...details })}, {token:${token}}))`);
const routeTry = (action, details = {}, token = "__presToken") => attempt(`route_(Object.assign(${JSON.stringify({ action, ...details })}, {token:${token}}))`);
const actions = ["teamSpaces", "getTracker", "saveTracker", "removeTracker", "saveTrackerRow", "removeTrackerRow"];
for (const action of actions) {
  ok(attempt(`route_({action:${JSON.stringify(action)}})`).error === "NOT_LOGGED_IN", `${action}: signed-out requests refused`);
  ok(routeTry(action, {}, "__execToken").error === "NOT_PRESIDENT", `${action}: other executives refused`);
  ok(routeTry(action, {}, "__adminToken").error === "NOT_PRESIDENT", `${action}: Settings access does not grant Teams access`);
}
ok(route("teamSpaces").ok && route("teamSpaces", {}, "__oldToken").ok, "Presidents in any capitals, multiple departments and older one-department rows work");
ok(routeTry("teamSpaces", {}, "__offToken").error === "NOT_LOGGED_IN", "inactive presidents refused and signed out");
ok(routeTry("teamSpaces", {}, "__goneIdToken").error === "NOT_LOGGED_IN", "a missing signed-in person ID cannot borrow a matching president's name");
const spaces = route("teamSpaces");
ok(spaces.departments.at(-1) === "General" && spaces.templates.length === 5, "spaces return department order and all five templates");
ok(spaces.team.every((p) => !Object.keys(p).some((k) => /hash|password|discord|token/i.test(k))), "Teams receives only names, departments and active flags");
const created = {};
for (const template of spaces.templates) {
  const reply = route("saveTracker", { tracker: { clientId: "TTtest_" + template.key + "001", template: template.key } });
  created[template.key] = reply.tracker;
  ok(reply.ok && reply.tracker.name === template.name && reply.tracker.fields.length > 0, `${template.key}: creates named template with typed columns`);
}
const content = created.content, id = content.id;
ok(content.views.default === "board" && created.events.views.default === "calendar" && created.sponsorship.views.default === "table", "templates choose sensible initial views");
ok(route("saveTracker", { tracker: { clientId: id, template: "content" } }).repeated && run("TBL.Trackers.length") === 5, "retrying tracker creation returns the same tracker");
ok(routeTry("saveTracker", { tracker: { template: "made-up" } }).error === "BAD_REQUEST", "unknown templates refused");
ok(routeTry("saveTracker", { tracker: { name: "TEST", department: "No such team" } }).error === "BAD_REQUEST", "unknown departments refused");
ok(routeTry("saveTracker", { tracker: { name: "x".repeat(81) } }).error === "BAD_REQUEST", "tracker names capped at 80 characters");
let reply = route("saveTracker", { tracker: { id, name: "TEST Renamed" } });
ok(reply.tracker.name === "TEST Renamed" && same(reply.tracker.fields, content.fields), "renaming retains stable field IDs and schema");
ok(run(`__logs.some((l) => l.action === "tracker.renamed" && l.id === ${JSON.stringify(id)})`), "tracker renames logged");

const fields = [
  { id: "Ftitle", name: "Title", type: "text" }, { id: "Fnotes", name: "Notes", type: "longtext" },
  { id: "Fnumber", name: "Count", type: "number" }, { id: "Fmoney", name: "Money", type: "money" },
  { id: "Fdate", name: "Date", type: "date" }, { id: "Fstatus", name: "Status", type: "choice", options: [{ id: "Otodo", label: "To do", color: "blue" }, { id: "Odone", label: "Done", color: "green" }] },
  { id: "Fperson", name: "Owner", type: "person" }, { id: "Flink", name: "Link", type: "link" }, { id: "Fcheck", name: "Tick", type: "checkbox" }
];
const schema = { id, fields, views: { default: "board", boardField: "Fstatus", dateField: "Fdate" } };
route("saveTracker", { tracker: schema });
for (const bad of [[], new Array(31).fill(fields[0]), [fields[0], fields[0]], [{ id: "Fbad", name: "Bad", type: "formula" }]]) {
  ok(routeTry("saveTracker", { tracker: { id, fields: bad } }).error === "BAD_REQUEST", "invalid, empty, excessive or duplicate columns refused");
}
for (const options of [new Array(31).fill(fields[5].options[0]), [{ id: "Oone", label: "A", color: "pink" }], [{ id: "Oone", label: "A", color: "blue" }, { id: "Otwo", label: "a", color: "red" }]]) {
  ok(routeTry("saveTracker", { tracker: { id, fields: [fields[0], { ...fields[5], options }] } }).error === "BAD_REQUEST", "excessive options, invalid colours or repeated labels refused");
}
ok(routeTry("saveTracker", { tracker: { id, views: { default: "board", boardField: "Ftitle" } } }).error === "BAD_REQUEST", "Board cannot use a text column");
ok(routeTry("saveTracker", { tracker: { id, views: { default: "calendar", dateField: "Ftitle" } } }).error === "BAD_REQUEST", "Calendar cannot use a text column");
const values = { Ftitle: "  TEST   Company ", Fnotes: "First\r\nSecond", Fnumber: 7, Fmoney: 12.345, Fdate: "2026-11-25", Fstatus: "Otodo", Fperson: "test   exec", Flink: "https://example.org/test", Fcheck: true };
reply = route("saveTrackerRow", { trackerId: id, row: { clientId: "TRtest_record001", values, createdBy: "Fake", trackerId: "wrong" } });
const rowId = reply.row.id;
ok(reply.ok && reply.row.values.Ftitle === "TEST Company" && reply.row.values.Fnotes === "First\nSecond" && reply.row.values.Fmoney === 12.35 && reply.row.values.Fperson === "TEST Exec" && reply.row.values.Fcheck === true, "all nine cell types saved, text tidied, money rounded and person matched");
ok(reply.row.createdBy === "TEST President", "record author and tracker come from the server, not forged input");
ok(route("teamSpaces").trackers.find((t) => t.id === id).rowCount === 1, "tracker cards count active records");
ok(route("saveTrackerRow", { trackerId: id, row: { clientId: rowId, values: { Ftitle: "retry" } } }).repeated && run("TBL.TrackerRows.length") === 1, "retrying record creation returns same record without replaying old cells");
for (const [key, value] of [["Fnumber", "7"], ["Fnumber", null], ["Fmoney", 1e20], ["Fdate", "2026-02-30"], ["Fdate", "11/25/2026"], ["Fstatus", "Posted"], ["Fperson", "TEST Inactive"], ["Fperson", "No one"], ["Flink", "javascript:alert(1)"], ["Fcheck", "false"], ["Ftitle", "x".repeat(501)], ["Fnotes", "x".repeat(5001)], ["missing", "x"]]) {
  ok(routeTry("saveTrackerRow", { trackerId: id, row: { id: rowId, values: { [key]: value } } }).error === "BAD_REQUEST", `${key}: invalid cell value refused`);
}
route("saveTrackerRow", { trackerId: id, row: { id: rowId, values: { Ftitle: "TEST First editor" } } });
reply = route("saveTrackerRow", { trackerId: id, row: { id: rowId, values: { Fnotes: "TEST Second editor" } } });
ok(reply.row.values.Ftitle === "TEST First editor" && reply.row.values.Fnotes === "TEST Second editor", "two editors changing different cells retain both changes");
route("saveTrackerRow", { trackerId: id, row: { id: rowId, values: { Fnumber: "", Fmoney: "", Fperson: "", Fdate: "", Fstatus: "", Fcheck: false } } });
reply = route("saveTrackerRow", { trackerId: id, row: { id: rowId, values: { Ftitle: "  @ucalgarycss  ", Fnotes: "@ucalgarycss\r\n+1   idea  \n\n\n\n- last\tline" } } });
ok(reply.row.values.Ftitle === "@ucalgarycss" && reply.row.values.Fnotes === "@ucalgarycss\n+1 idea\n\n- last line", "a leading @, + or - stays as typed; spaces are tidied and line breaks kept");
reply = route("saveTrackerRow", { trackerId: id, row: { id: rowId, values: { Ftitle: "=SUM(A1)", Fnotes: "=SUM(A1)" } } });
ok(reply.row.values.Ftitle === "=SUM(A1)" && reply.row.values.Fnotes === "=SUM(A1)", "formula-looking text and long text stay as typed inside safe JSON");
ok(route("getTracker", { id }).rows[0].values.Fnotes === "=SUM(A1)" && run(`toCell_("rowValues", TBL.TrackerRows.find((r) => r.id === ${JSON.stringify(rowId)}).rowValues).startsWith("{")`), "saved and reloaded long text has no extra apostrophe, and the Sheet cell is JSON");
route("saveTrackerRow", { trackerId: id, row: { id: rowId, values: { Fnotes: "'=SUM(A1)" } } });
ok(route("getTracker", { id }).rows[0].values.Fnotes === "'=SUM(A1)", "a person's own leading apostrophe stays intact");
route("saveTrackerRow", { trackerId: id, row: { id: rowId, values: { Fnotes: "=SUM(A1)" } } });
ok(routeTry("saveTrackerRow", { trackerId: created.blank.id, row: { id: rowId, values: {} } }).error === "BAD_REQUEST", "record IDs cannot cross into a different tracker");
ok(routeTry("saveTrackerRow", { trackerId: created.blank.id, row: { clientId: rowId, values: {} } }).error === "BAD_REQUEST", "retry IDs cannot cross into a different tracker");

route("saveTrackerRow", { trackerId: id, row: { id: rowId, values: { Fstatus: "Otodo" } } });
const changed = fields.map((f) => f.id === "Fstatus" ? { ...f, options: [{ id: "Odone", label: "Finished", color: "gold" }] } : f.id === "Ftitle" ? { ...f, name: "Renamed title" } : f);
route("saveTracker", { tracker: { id, fields: changed } });
reply = route("getTracker", { id });
ok(reply.rows[0].values.Fstatus === "" && reply.rows[0].values.Ftitle === "=SUM(A1)", "removing an option gives No status, and column rename keeps title data");
ok(run(`TBL.TrackerRows.find((r) => r.id === ${JSON.stringify(rowId)}).rowValues.Fstatus`) === "Otodo", "schema changes preserve stored values for recovery");
route("saveTracker", { tracker: { id, fields: [fields[0]] } });
reply = route("getTracker", { id });
ok(reply.tracker.views.default === "table" && !reply.tracker.views.boardField && !reply.tracker.views.dateField && !Object.hasOwn(reply.rows[0].values, "Fnotes"), "removing view columns falls back to Table and hides removed cells");
route("saveTracker", { tracker: schema });

route("removeTrackerRow", { id: rowId });
ok(route("getTracker", { id }).rows.length === 0 && route("teamSpaces").trackers.find((t) => t.id === id).rowCount === 0, "record removal hides it from tracker and card counts");
ok(run(`!!TBL.TrackerRows.find((r) => r.id === ${JSON.stringify(rowId)}).removedAt`), "removed record stays stored");
ok(routeTry("saveTrackerRow", { trackerId: id, row: { id: rowId, values: { Ftitle: "stale save" } } }).error === "NOT_FOUND", "late saves cannot silently restore a removed row");
route("removeTrackerRow", { id: rowId });
reply = route("removeTrackerRow", { id: rowId, undo: true });
ok(reply.ok && reply.row.values.Fnotes === "=SUM(A1)" && route("getTracker", { id }).rows.length === 1, "Undo restores the same full record");
ok(route("removeTrackerRow", { id: rowId, undo: true }).ok, "repeating Undo is harmless");

run("__checkInside = true");
ok(routeTry("saveTrackerRow", { trackerId: id, row: { id: rowId, values: {} } }).error === "NOT_PRESIDENT", "president membership is checked again inside the write lock");
run('TBL.Team[0].departments = ["Presidents"]');
route("removeTracker", { id });
ok(routeTry("getTracker", { id }).error === "NOT_FOUND" && !route("teamSpaces").trackers.some((t) => t.id === id), "tracker removal hides it from reads and spaces");
ok(routeTry("saveTrackerRow", { trackerId: id, row: { values: {} } }).error === "NOT_FOUND" && routeTry("removeTrackerRow", { id: rowId, undo: true }).error === "NOT_FOUND", "removed trackers refuse record writes and undo");
ok(routeTry("saveTracker", { tracker: { clientId: id } }).error === "NOT_FOUND", "old create retries cannot revive removed trackers");

// Limits use made-up stored rows: avoid thousands of repetitive calls.
const blankId = created.blank.id;
run(`for (var n = 0; n < 2000; n++) TBL.TrackerRows.push({ id: "TRlimit" + n, trackerId: ${JSON.stringify(blankId)}, rowValues: {}, sort:n });`);
ok(routeTry("saveTrackerRow", { trackerId: blankId, row: { values: {} } }).error === "BAD_REQUEST", "2000 active records per tracker");
route("removeTrackerRow", { id: "TRlimit0" });
ok(route("saveTrackerRow", { trackerId: blankId, row: { values: {} } }).ok, "removing a record frees a place");
ok(routeTry("removeTrackerRow", { id: "TRlimit0", undo: true }).error === "BAD_REQUEST", "Undo also respects the record limit");
run(`for (var n = 0; n < 29; n++) TBL.Trackers.push({id:"TTlimit" + n,department:"General",name:"TEST limit",trackerFields:[],trackerViews:{}});`);
ok(routeTry("saveTracker", { tracker: { department: "General" } }).error === "BAD_REQUEST", "30 active trackers per department");
route("removeTracker", { id: "TTlimit0" });
ok(route("saveTracker", { tracker: { department: "General" } }).ok, "removing a tracker frees a place");
ok(run('__logs.some((l) => l.action === "tracker.created") && __logs.some((l) => l.action === "tracker.removed") && __logs.some((l) => l.action === "tracker.row.added") && __logs.some((l) => l.action === "tracker.row.removed")'), "tracker and record create/remove actions logged");
ok(run("JSON_COLUMNS.trackerFields && JSON_COLUMNS.trackerViews && JSON_COLUMNS.rowValues && TABLES.Trackers.includes('trackerFields') && TABLES.TrackerRows.includes('rowValues')"), "new tables and unique JSON columns registered");
ok(same(run('fromCell_("rowValues", "")'), {}) && same(run('fromCell_("trackerViews", "broken")'), {}), "empty or damaged object columns read as objects");
ok(same(run('fromCell_("rowValues", toCell_("rowValues", { Fcheckbox: true, Fcount: 8, Ftext: "TEST" }))'), { Fcheckbox: true, Fcount: 8, Ftext: "TEST" }), "typed values survive the Sheets JSON round trip");
const largeFields = Array.from({ length: 10 }, (_, n) => ({ id: "Flong" + n, name: "Notes " + n, type: "longtext" }));
const largeTracker = route("saveTracker", { tracker: { department: "External", name: "TEST Long record", fields: largeFields } }).tracker;
ok(routeTry("saveTrackerRow", { trackerId: largeTracker.id, row: { values: Object.fromEntries(largeFields.map((f) => [f.id, "x".repeat(5000)])) } }).error === "BAD_REQUEST", "a record larger than one Sheet cell is refused before any write");

// Departments removed in Settings → People
run('TBL.Team[2].departments = ["Finance", "TEST Club"]');
const clubTracker = route("saveTracker", { tracker: { department: "test club", name: "TEST Club tracker" } }).tracker;
ok(clubTracker.department === "TEST Club", "an added department can hold trackers (spelled as on the list)");
run('removeDepartment_({ name: "TEST Admin" }, "TEST Club")');
ok(!route("teamSpaces").team.find((p) => p.name === "TEST Admin").departments.includes("TEST Club"), "Teams lists only departments still on the list");
reply = route("saveTracker", { tracker: { id: clubTracker.id, name: "TEST Club tracker renamed" } });
ok(reply.ok && reply.tracker.department === "TEST Club" && reply.tracker.name === "TEST Club tracker renamed", "saving a tracker without a department keeps its own, even one removed since");
ok(route("saveTracker", { tracker: { id: clubTracker.id, department: "test club" } }).tracker.department === "TEST Club", "sending its removed department back unchanged keeps it too");
ok(routeTry("saveTracker", { tracker: { id: clubTracker.id, department: "No such team" } }).error === "BAD_REQUEST", "moving it to a department that isn't on the list is refused");
ok(routeTry("saveTracker", { tracker: { name: "TEST new", department: "TEST Club" } }).error === "BAD_REQUEST", "a new tracker can't use a removed department");
ok(route("saveTracker", { tracker: { id: clubTracker.id, department: "Events" } }).tracker.department === "Events", "it can still move to a department on the list");
run('removeDepartment_({ name: "TEST Admin" }, "Presidents")');
ok(routeTry("teamSpaces").error === "NOT_PRESIDENT" && routeTry("teamSpaces", {}, "__oldToken").error === "NOT_PRESIDENT", "Presidents department removed: former presidents no longer get Teams");
ok(routeTry("saveTracker", { tracker: { id: clubTracker.id, name: "TEST late" } }).error === "NOT_PRESIDENT", "…and can't change trackers either");
run('addDepartment_({ name: "TEST Admin" }, "Presidents")');
ok(route("teamSpaces").ok && route("teamSpaces", {}, "__oldToken").ok, "adding Presidents back brings Teams back for the people who had it");
if (fails) { console.error(`${fails} failure(s)`); process.exit(1); }

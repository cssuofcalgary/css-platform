// Departments: adding the club's own (Settings → People), people in more than one department, and what tasks do with them.
// Offline only: fake Google, in-memory tables.
const { run } = require("./harness.js");
let fails = 0;
const ok = (value, message) => { console.log((value ? "PASS " : "FAIL ") + message); if (!value) fails++; };
const attempt = (code) => { try { return { value: run(code) }; } catch (e) { return { error: e.code, message: e.message }; } };
const SAME = (a, b) => JSON.stringify(a) === JSON.stringify(b);
run(`
var __logs = [], __held = false;
function log_(who, action, target, details) { __logs.push({ who, action, target, details }); }
function withLock_(fn) { if (__held) throw new Error("nested lock"); __held = true; try { return fn(); } finally { __held = false; } }
function table_() { return {}; }
function headerFor_() { return []; }
function deleteTabRows_(tab, ids) { TBL.Team = TBL.Team.filter((p) => !ids[p.id]); }
function discordSend_() { return { ok: false, error: "not set up" }; }
function refreshNextReminder_() {}
TBL.Team = []; TBL.Tasks = []; TBL.TaskUpdates = [];
var __adminToken = startSession_("TEST Admin", "admin"), __execToken = startSession_("TEST Exec", "exec");
var A = requireAdmin_(__adminToken), S = requireSession_(__execToken);
`);
const route = (action, details = {}, admin = true) => run(`route_(Object.assign(${JSON.stringify({ action, ...details })}, { token: ${admin ? "__adminToken" : "__execToken"} }))`);
const routeTry = (action, details = {}, admin = true) => attempt(`route_(Object.assign(${JSON.stringify({ action, ...details })}, { token: ${admin ? "__adminToken" : "__execToken"} }))`);

// ---- Who can change the list -------------------------------------------------------------------------
for (const action of ["addDepartment", "removeDepartment"]) {
  ok(attempt(`route_({ action: "${action}", name: "TEST Dept" })`).error === "NOT_LOGGED_IN", `${action}: signed-out requests denied`);
  ok(routeTry(action, { name: "TEST Dept" }, false).error === "ADMIN_ONLY", `${action}: normal execs denied (admin only)`);
}
ok(SAME(run("taskDepartments_()"), ["Events", "Marketing", "Internal", "External", "Finance", "General"]), "to start with: the five built in, then General");

// ---- Adding ------------------------------------------------------------------------------------------
let reply = route("addDepartment", { name: "  Photo   Team " });
ok(reply.ok && SAME(reply.departments, ["Events", "Marketing", "Internal", "External", "Finance", "Photo Team", "General"]), "an added department goes before General, extra spaces tidied");
ok(Array.isArray(reply.team), "the reply includes the People list, to redraw it");
ok(run("__logs.some((l) => l.action === 'department.added' && l.details.name === 'Photo Team')"), "adding a department is written to the Activity log");
ok(SAME(route("listTasks", {}, false).departments, reply.departments), "the Tasks tab gets the same list (any exec)");
ok(/already a department/.test(routeTry("addDepartment", { name: "photo team" }).message || ""), "the same name again (any capitals) is refused");
ok(/Events is already a department/.test(routeTry("addDepartment", { name: "events" }).message || ""), "a built-in name is refused");
ok(/General is already a department/.test(routeTry("addDepartment", { name: "General" }).message || ""), "General is refused");
for (const bad of ["Everyone", "all", "Mine", "my tasks"]) ok(routeTry("addDepartment", { name: bad }).error === "BAD_REQUEST", `"${bad}" is refused (used by the Tasks filters)`);
ok(/comma/.test(routeTry("addDepartment", { name: "Photo, Video" }).message || ""), "a comma is refused (pasting people uses Name, Department)");
ok(routeTry("addDepartment", { name: "x".repeat(25) }).error === "BAD_REQUEST", "over 24 characters is refused");
ok(routeTry("addDepartment", { name: "   " }).error === "BAD_REQUEST" && routeTry("addDepartment", {}).error === "BAD_REQUEST", "a blank name is refused");
ok(routeTry("addDepartment", { name: "=SUM(A1)" }).value.departments.includes("SUM(A1)"), "a name that looks like a sheet formula is made safe");
route("removeDepartment", { name: "SUM(A1)" });
for (let i = 1; i <= 19; i++) route("addDepartment", { name: "TEST D" + i });
ok(/up to 20/.test(routeTry("addDepartment", { name: "TEST D20" }).message || ""), "up to 20 added departments");
for (let i = 1; i <= 19; i++) route("removeDepartment", { name: "TEST D" + i });
ok(SAME(run("taskAddedDepartments_()"), ["Photo Team"]), "removing them leaves the others");

// ---- People in more than one department --------------------------------------------------------------
reply = route("savePerson", { person: { name: "TEST Amy", departments: ["Events", "photo team", "Nope", "Events"], active: true } });
ok(SAME(reply.person.departments, ["Events", "Photo Team"]) && reply.person.department === "Events", "a person can be in several departments (spelled as the list spells them; unknown or repeated ones left out)");
const amy = reply.person.id;
ok(SAME(run(`taskTeamByName_("TEST Amy").departments`), ["Events", "Photo Team"]) && run(`taskTeamByName_("TEST Amy").department`) === "Events", "saved in the sheet: the list, and the first one in the old Department column");
reply = route("savePerson", { person: { id: amy, name: "TEST Amy", department: "Finance", active: true } });
ok(SAME(reply.person.departments, ["Finance"]), "an older page sending one department still works");
reply = route("savePerson", { person: { id: amy, name: "TEST Amy", departments: [], active: true } });
ok(SAME(reply.person.departments, []) && reply.person.department === "", "every department can be taken off");
ok(routeTry("savePerson", { person: { id: amy, name: "TEST Amy", departments: new Array(11).fill("Events") } }).error === "BAD_REQUEST", "up to 10 departments each");
ok(routeTry("savePerson", { person: { id: amy, name: "TEST Amy", departments: [{ name: "Events" }] } }).error === "BAD_REQUEST", "departments must be names");
run(`TBL.Team.push({ id: "TM-old", name: "TEST Old Row", department: "Marketing", discordId: "", active: true, sort: 99 })`);
ok(SAME(run(`taskTeam_().filter((p) => p.id === "TM-old")[0].departments`), ["Marketing"]), "an older row with just one department reads as a list of one, without a migration");
route("savePerson", { person: { id: amy, name: "TEST Amy", departments: ["Photo Team", "Events"], active: true } });

// ---- Tasks -------------------------------------------------------------------------------------------
let task = run(`saveTask_(S, { title: "TEST Shoot the gala", owners: ["TEST Amy"] }).task`);
ok(task.department === "Photo Team", "a new task gets its person's first department (an added one too)");
task = run(`saveTask_(S, { title: "TEST Edit photos", owners: ["TEST Amy"], department: "photo team" }).task`);
ok(task.department === "Photo Team", "an added department can be picked for a task (any capitals)");
ok(run(`saveTask_(S, { title: "TEST Odd department", owners: ["TEST Amy"], department: "Nope" }).task.department`) === "Photo Team", "an unknown department falls back to the person's");

// ---- Removing ----------------------------------------------------------------------------------------
ok(/can't be removed/.test(routeTry("removeDepartment", { name: "events" }).message || "") && /can't be removed/.test(routeTry("removeDepartment", { name: "General" }).message || ""), "the built-in departments and General can't be removed");
ok(routeTry("removeDepartment", { name: "Nope" }).error === "NOT_FOUND", "removing one that isn't there: NOT_FOUND, refresh");
reply = route("removeDepartment", { name: "PHOTO TEAM" });
ok(reply.ok && !reply.departments.includes("Photo Team"), "an added department can be removed (any capitals)");
ok(SAME(reply.team.filter((p) => p.id === amy)[0].departments, ["Events"]), "people in it keep their other departments");
ok(run("__logs.some((l) => l.action === 'department.removed' && l.details.name === 'Photo Team')"), "removing is written to the Activity log");
ok(run(`readRows_("Tasks").filter((t) => t.id === "${task.id}")[0].department`) === "Photo Team", "tasks keep the department they were saved with");
ok(run(`saveTask_(S, { id: "${task.id}", title: "TEST Edit photos again", department: "Photo Team" }).task.department`) === "Photo Team", "editing such a task without changing its department keeps it");
ok(run(`saveTask_(S, { id: "${task.id}", department: "Finance" }).task.department`) === "Finance", "…and it can still be moved to another department");
ok(run(`saveTask_(S, { title: "TEST After removal", owners: ["TEST Amy"] }).task.department`) === "Events", "new tasks use the person's remaining department");
reply = route("addDepartment", { name: "Photo Team" });
ok(SAME(reply.team.filter((p) => p.id === amy)[0].departments, ["Photo Team", "Events"]), "adding the same name again brings it back for the people who had it");

// ---- Pasting a list of people ------------------------------------------------------------------------
const preview = route("previewPeopleImport", { text: "TEST Zed, photo team\nTEST Yan, Finance" });
ok(preview.ok && preview.rows[0].department === "Photo Team", "pasted lists accept added departments");
route("importPeople", { text: "TEST Zed, photo team" });
ok(SAME(run(`taskTeam_().filter((p) => p.name === "TEST Zed")[0].departments`), ["Photo Team"]), "an imported person gets their department in the list");
ok(/Photo Team/.test(routeTry("previewPeopleImport", { text: "TEST Q, Accounting" }).message || ""), "an unknown department's message lists the added ones too");

console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);

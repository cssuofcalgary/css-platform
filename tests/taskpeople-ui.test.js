// Exercise People workload using the actual Tasks filters and person navigation contract.
const fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
let fails = 0;
const ok = (value, message) => { console.log((value ? "PASS " : "FAIL ") + message); if (!value) fails++; };
const elements = {};
function element(id) {
  return elements[id] ||= { value: "", hidden: true, disabled: false, innerHTML: "", listeners: {},
    addEventListener(type, fn) { this.listeners[type] = fn; }, setAttribute() {}, removeAttribute() {}, focus() {},
    classList: { add() {}, remove() {}, toggle() {} }, showModal() { this.open = true; }, close() { this.open = false; } };
}
const context = vm.createContext({ console, setTimeout, clearTimeout, $: element,
  document: { querySelector() { return null; }, querySelectorAll() { return []; }, addEventListener() {} },
  window: { addEventListener() {} },
  localStorage: { store: {}, getItem(k) { return this.store[k] || null; }, setItem(k, v) { this.store[k] = String(v); }, removeItem(k) { delete this.store[k]; } },
  escapeHtml: (value) => String(value).replace(/[&<>"']/g, (s) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[s])) });
const run = (code) => vm.runInContext(code, context);
run(fs.readFileSync(path.join(__dirname, "../exec-portal/strings.js"), "utf8"));
run(`var state = { name: 'Kevin', token: 'test' };
  function todayMountain() { return '2026-11-23'; }
  function setConnectionNotice() {} function deviceLoad() { return null; } function deviceSave() {}
  function matchMedia() { return { matches: false }; } function newRequestId() { return 'reqabcdefgh'; }
  function askConfirm() { return Promise.resolve(true); } function showToast() {} function errorText(r) { return r.error; }
  function api() { return Promise.resolve({ ok: true }); }`);
run(fs.readFileSync(path.join(__dirname, "../exec-portal/tasks.js"), "utf8"));
run(fs.readFileSync(path.join(__dirname, "../exec-portal/taskpeople.js"), "utf8"));
run(`taskState.loaded = true; taskState.filter = 'all'; taskState.person = 'Kevin';
  taskState.team = [
    { name: 'Kevin', departments: ['Events', 'Marketing'], active: true },
    { name: 'Marcus', department: 'Internal', active: true },
    { name: 'Zoe', department: 'Marketing', active: true },
    { name: 'Inactive', department: 'Marketing', active: false }
  ];
  taskState.tasks = [
    { id: 'over', title: 'Book room', department: 'Events', owners: ['Kevin', 'Marcus', ' marcus '], status: 'blocked', due: '2026-11-22', labels: ['LNY'] },
    { id: 'soon', title: 'Post reel', department: 'Marketing', owners: ['Marcus'], status: 'doing', due: '2026-11-29', labels: ['LNY'] },
    { id: 'later', title: 'Draft poster', department: 'Marketing', owners: ['Marcus'], status: 'todo', due: '2026-11-30' },
    { id: 'legacy', title: 'Old format', department: 'Marketing', owner: 'Kevin', status: 'todo', due: '2026-11-23' },
    { id: 'noowner', title: 'Find sponsor', department: 'Marketing', owners: [], status: 'todo' },
    { id: 'recent', title: 'Recent', department: 'Marketing', owners: ['Kevin'], status: 'done', doneAt: '2026-11-17T19:00:00Z' },
    { id: 'old', title: 'Old completion', department: 'Marketing', owners: ['Kevin', 'Historical'], status: 'done', doneAt: '2026-11-16T19:00:00Z' },
    { id: 'future', title: 'Future completion', department: 'Marketing', owners: ['Kevin'], status: 'done', doneAt: '2026-11-24T19:00:00Z' },
    { id: 'fallback', title: 'Older completion data', department: 'Marketing', owners: ['Marcus'], status: 'done', updatedAt: '2026-11-23T19:00:00Z' }
  ];`);
const rows = () => JSON.parse(run("JSON.stringify(tpRows())"));
let list = rows();
ok(list[0].name === "Marcus" && list[0].open === 3 && list.find((p) => p.name === "Kevin").open === 2, "busiest first; a shared task counts once per person, including older one-owner tasks");
let kevin = list.find((p) => p.name === "Kevin"), marcus = list.find((p) => p.name === "Marcus");
ok(kevin.overdue === 1 && kevin.blocked === 1 && kevin.dueWeek === 1 && marcus.dueWeek === 1, "overdue, blocked and due in the coming week are counted separately on open tasks");
ok(kevin.doneWeek === 1 && marcus.doneWeek === 1, "last seven days includes the sixth prior day, excludes older/future completions, and supports older updatedAt data");
ok(list.some((p) => p.name === "Zoe" && p.open === 0) && !list.some((p) => p.name === "Inactive" || p.name === "Historical"), "active people with zero tasks are shown; inactive and irrelevant historical people are left out");
ok(list.find((p) => p.nobody).open === 1 && list.find((p) => p.nobody).key === run("TASK_NOBODY"), "unassigned open tasks have a Nobody yet row");
ok(list.length === 4, "People ignores the Person menu");
run("renderTaskPeople()");
ok(element("task-people").innerHTML.includes("3 open") && element("task-people").innerHTML.includes("1 blocked") && !element("task-people").innerHTML.includes("0 overdue"), "rows show the open count and only nonzero extra counts");
ok(element("task-people").innerHTML.includes('width:100%') && element("task-people").innerHTML.includes('aria-hidden="true"'), "the busiest person's load fills the bar while counts remain readable to assistive technology");

run("taskState.filter='mine'");
list = rows();
ok(list.length === 1 && list[0].name === "Kevin" && list[0].open === 2, "My tasks shows only the signed-in person, including their shared tasks");
run("taskState.filter='Marketing'");
list = rows();
ok(list.some((p) => p.name === "Zoe" && p.open === 0) && list.some((p) => p.name === "Kevin"), "a department includes its people with zero tasks and people belonging to several departments");
ok(list.find((p) => p.name === "Marcus").open === 2 && list.find((p) => p.name === "Kevin").open === 1, "department counts include only that department's tasks, even when assigned outside the department");
run("taskState.filter='all'; taskState.search='reel'; taskState.label='LNY'");
list = rows();
ok(list.find((p) => p.name === "Marcus").open === 1 && list.find((p) => p.name === "Kevin").open === 0 && !list.some((p) => p.nobody), "search and labels filter the counted tasks and hide irrelevant unassigned tasks");

run("taskState.search=''; taskState.label=''; taskState.team.push({name:'A <b> & \\\"C\\\"',active:true,department:'Events'}); renderTaskPeople()");
ok(element("task-people").innerHTML.includes("A &lt;b&gt; &amp; &quot;C&quot;") && !element("task-people").innerHTML.includes("A <b>"), "names are escaped in visible text and row attributes");
element("task-people").listeners.click({ target: { closest() { return { getAttribute() { return "Marcus"; } }; } } });
ok(run("taskState.view === 'list' && taskState.filter === 'all' && taskState.person === 'Marcus'") && run("filteredTasks().length") === 4, "clicking a person uses the actual Tasks navigation and opens their list");
element("task-people").listeners.click({ target: { closest() { return { getAttribute() { return run("TASK_NOBODY"); } }; } } });
ok(run("filteredTasks().map(t=>t.id).join()") === "noowner", "clicking Nobody yet opens the unassigned tasks");

run("taskState.tasks=[]; taskState.team=[]; taskState.filter='all'; renderTaskPeople()");
ok(element("task-people").innerHTML.includes("No tasks here."), "an empty roster shows the usual empty state");
run("taskState.filter='mine'; renderTaskPeople()");
ok(rows().length === 1 && rows()[0].open === 0, "My tasks keeps your row when you have no open tasks");
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);

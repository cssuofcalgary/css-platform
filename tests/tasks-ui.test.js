// Exercise the real task editor and My tasks filter using a fake DOM and API.
const fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
let fails = 0;
const ok = (value, message) => { console.log((value ? "PASS " : "FAIL ") + message); if (!value) fails++; };
const elements = {};
function element(id) {
  return elements[id] ||= { value: "", hidden: true, disabled: false, innerHTML: "", listeners: {},
    addEventListener(type, fn) { this.listeners[type] = fn; }, setAttribute() {}, removeAttribute() {}, focus() {},
    classList: {add(){},remove(){},toggle(){}}, showModal() {this.open=true;}, close(){this.open=false;} };
}
const context = vm.createContext({ console, $: element, document: {querySelector(){return null;},querySelectorAll(){return [];},addEventListener(){}},
  window: {addEventListener(){}}, localStorage: {getItem(){return null;}},
  escapeHtml: (value) => String(value).replace(/[&<>"']/g, (s) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s])) });
const run = (code) => vm.runInContext(code, context);
run(fs.readFileSync(path.join(__dirname,"../exec-portal/strings.js"),"utf8"));
run(`var state={name:'Kevin'}, calls=[];
  function todayMountain(){return '2026-11-23';}
  function showToast(){}
  function errorText(r){return r.error;}
  function api(action,details){calls.push({action,details}); return Promise.resolve({ok:true,discordPosted:true,task:{id:'shared',...details.task}});}`);
run(fs.readFileSync(path.join(__dirname,"../exec-portal/tasks.js"),"utf8"));
run(`renderTasks=()=>{}; taskState.team=[{name:'Kevin',department:'Events',active:true},{name:'Marcus',department:'Internal',active:true}];`);
async function main() {
  run("openTaskDialog(null)");
  ok(run("taskState.owners.join()") === "Kevin" && element("tk-owner").value === "", "new tasks select yourself and leave space to add another person");
  run("pickOwner(' marcus '); pickOwner('MARCUS')");
  ok(run("taskState.owners.join()") === "Kevin,Marcus", "choosing another name adds an assignee without replacing or duplicating anyone");
  ok(!run("ownerSuggestions('').includes('Marcus')"), "already selected people are excluded from suggestions");
  element("tk-owners").listeners.click({target:{closest(){return {dataset:{removeOwner:'0'}};}}});
  ok(run("taskState.owners.join()") === "Marcus", "the remove button only removes the selected person");
  element("tk-owner").value = "Kevin";
  element("tk-title").value = "Shared task";
  await run("onTaskSubmit({preventDefault(){}})");
  ok(run("calls[0].details.task.owners.join()") === "Marcus,Kevin", "saving includes a typed name even if Add was not pressed");
  run(`taskState.tasks=[{id:'both',owners:['Kevin','Marcus']},{id:'old',owner:'Kevin'},{id:'other',owners:['Someone else']}];taskState.filter='mine';`);
  ok(run("filteredTasks().map(t=>t.id).join()") === "both,old", "My tasks includes shared and legacy tasks for the first person");
  run("state.name=' marcus '");
  ok(run("filteredTasks().map(t=>t.id).join()") === "both", "My tasks includes a task for another assignee, regardless of case or spacing");
  run("openTaskDialog({id:'both',title:'Shared task',owners:['Kevin','Marcus'],department:'Events'})");
  ok(run("taskState.owners.join()") === "Kevin,Marcus", "editing loads every saved assignee");
  run("taskState.owners=[]");
  element("tk-owner").value = "A < B";
  run("pickOwner($('tk-owner').value)");
  ok(element("tk-owners").innerHTML.includes("A &lt; B") && !element("tk-owners").innerHTML.includes("A < B"), "assignee names are escaped in labels and remove buttons");
  console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
  process.exit(fails ? 1 : 0);
}
main().catch((error) => {console.error(error);process.exit(1);});

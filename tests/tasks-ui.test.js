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
const context = vm.createContext({ console, setTimeout, clearTimeout, $: element, document: {querySelector(){return null;},querySelectorAll(){return [];},addEventListener(){}},
  window: {addEventListener(){}}, localStorage: { store: {}, getItem(k){return k in this.store ? this.store[k] : null;}, setItem(k,v){this.store[k]=String(v);}, removeItem(k){delete this.store[k];} },
  escapeHtml: (value) => String(value).replace(/[&<>"']/g, (s) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s])) });
const run = (code) => vm.runInContext(code, context);
run(fs.readFileSync(path.join(__dirname,"../exec-portal/strings.js"),"utf8"));
run(`var state={name:'Kevin',token:'test'}, calls=[];
  function todayMountain(){return '2026-11-23';}
  var __n = 0; function newRequestId(){ return 'req' + (++__n) + 'abcdefgh'; }
  function setConnectionNotice(){} function deviceLoad(){ return null; } function deviceSave(){} function matchMedia(){ return { matches: false }; }
  function askConfirm(){ return Promise.resolve(true); }
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
  await new Promise((r) => setTimeout(r, 0));
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
  await background();
  console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
  process.exit(fails ? 1 : 0);
}
main().catch((error) => {console.error(error);process.exit(1);});

// Background saving: shown at once, sent in the background, kept on the device while there's no connection.
async function background() {
  let failNext = 0;
  context.__fail = () => failNext;
  run("taskState.tasks=[{id:'bg',title:'Background',owners:['Kevin'],status:'todo',updates:[]}]; calls.length=0; localStorage.store={}; taskState.pending={};");
  run("api=function(action,details){ calls.push({action,details}); if (__fail()) return Promise.resolve({ok:false,error:'NETWORK'}); return Promise.resolve({ok:true,task:Object.assign({}, taskById(details.id || (details.task||{}).id)||{}, details.task||{}, details.status?{status:details.status}:{})}); }");
  failNext = 1;
  run("openTaskDetail('bg'); taskState.draft.status='done'; taskState.draft.labels=['AGM']; saveTaskDetail();");
  ok(run("taskById('bg').status") === "done" && run("taskById('bg').labels.join()") === "AGM", "Save shows the change at once");
  await new Promise((r) => setTimeout(r, 0));
  ok(run("outboxCount()") === 1 && run("taskState.outboxOffline") === true, "no connection: the change stays in the outbox on this device");
  ok(run("calls[0].details.task.from") === "todo" && run("calls[0].details.task.status") === "done", "the save says which status it replaced");
  run("taskState.tasks=[{id:'bg',title:'Background',owners:['Kevin'],status:'todo',updates:[]}]; applyOutbox();");
  ok(run("taskById('bg').status") === "done", "after a refresh, a change still waiting keeps showing");
  failNext = 0;
  await run("flushOutbox()");
  ok(run("outboxCount()") === 0 && run("taskState.outboxOffline") === false && run("calls.length") === 2, "connection back: the waiting change is sent once and the outbox is empty");
  run("changeTaskStatus('bg','doing'); changeTaskStatus('bg','blocked'); changeTaskStatus('bg','done');");
  ok(run("calls.length") === 2, "quick status taps aren't sent straight away");
  await new Promise((r) => setTimeout(r, 900));
  ok(run("calls.length") === 2 && run("outboxCount()") === 0, "tapping back to the saved status sends nothing");
  run("changeTaskStatus('bg','doing'); changeTaskStatus('bg','blocked');");
  await new Promise((r) => setTimeout(r, 900));
  ok(run("calls.length") === 3 && run("calls[2].details.status") === "blocked" && run("calls[2].details.from") === "done", "several taps send one status, with the one it replaced");
  run("taskState.openId='bg'; taskState.draft=draftOf(taskById('bg')); $('td-update-text').value='hello'; onUpdateSubmit({preventDefault(){}})");
  await new Promise((r) => setTimeout(r, 0));
  ok(run("taskById('bg').updates[0].text") === "hello" && /^TU/.test(run("calls[3].details.clientId")), "an update shows at once and is sent with its own name");
}

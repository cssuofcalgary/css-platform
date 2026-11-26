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
  ok(run("calls[0].details.task.owners.join()") === "Kevin,Marcus", "saving includes a typed name even if Add was not pressed (people A to Z)");
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
  await everyone();
  await background();
  console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
  process.exit(fails ? 1 : 0);
}
main().catch((error) => {console.error(error);process.exit(1);});

// Everyone / a department at once: everyone in it is added, with a checklist line per person to tick.
async function everyone() {
  const press = (id, group) => element(id).listeners.click({ target: { closest: (sel) => sel === "[data-group]" ? { dataset: { group }, disabled: false } : null } });
  const removeOwner = (i) => element("tk-owners").listeners.click({ target: { closest: (sel) => sel === "[data-remove-owner]" ? { dataset: { removeOwner: String(i) } } : null } });
  const texts = (list) => list.map((c) => c.text + (c.done ? "✓" : "")).join();
  run(`state.name='Kevin'; calls.length=0; taskState.filter='mine';
    taskState.team=[{name:'Kevin',department:'Events',departments:['Events','Finance'],active:true},{name:'Marcus',department:'Internal',active:true},{name:'Old Exec',department:'Events',active:false}];
    setTaskDepts(['Events','Marketing','Internal','External','Finance','Photo Team','General']);`);
  ok(run("TASK_DEPTS.join()") === "Events,Marketing,Internal,External,Finance,Photo Team,General", "the department list comes from the server, General last");
  ok(run("taskGroups().map(g=>g.label+':'+g.names.join('+')).join('|')") === "Everyone:Kevin+Marcus|Events:Kevin|Internal:Marcus|Finance:Kevin",
    "buttons: Everyone, then each department with someone active in it (people in two departments count in both; inactive people left out)");

  run("openTaskDialog(null)");
  ok(element("tk-groups").innerHTML.includes('data-group=""') && element("tk-groups").innerHTML.includes("+ Everyone") && element("tk-groups").innerHTML.includes("+ Finance"), "the New task window shows the buttons");
  press("tk-groups", "");
  ok(run("taskState.owners.join()") === "Kevin,Marcus" && texts(run("taskState.checklist")) === "Kevin,Marcus", "Everyone adds every active person, and a checklist line with each name");
  ok(element("tk-dept").value === "General", "…and the task's department becomes General");
  ok(/data-group="" disabled/.test(element("tk-groups").innerHTML), "Everyone is greyed out once everyone is on it");
  removeOwner(1);
  ok(run("taskState.owners.join()") === "Kevin" && texts(run("taskState.checklist")) === "Kevin", "taking someone off also takes their name line away");
  run("pickOwner('marcus')");
  ok(texts(run("taskState.checklist")) === "Kevin,Marcus", "adding one person to such a task gives them a name line too");
  element("tk-title").value = "Fill out availability";
  await run("onTaskSubmit({preventDefault(){}})");
  await new Promise((r) => setTimeout(r, 0));
  let sent = run("calls.filter(c=>c.action==='saveTask').pop().details.task");
  ok(sent.owners.join() === "Kevin,Marcus" && texts(sent.checklist) === "Kevin,Marcus", "saving sends the people and their name lines");

  run("openTaskDialog(null)");
  press("tk-groups", "Internal");
  ok(run("taskState.owners.join()") === "Kevin,Marcus" && texts(run("taskState.checklist")) === "Marcus" && element("tk-dept").value === "Internal",
    "a department button adds its people with a line each, and sets the department");
  run("openTaskDialog(null)");
  ok(run("taskState.checklist.length") === 0, "a new task window starts with no name lines");

  run("calls.length=0; openTaskDialog({id:'plain',title:'Plain',owners:['Kevin'],department:'Events',checklist:[{id:'c1',text:'Book room',done:false}]})");
  run("pickOwner('Marcus')");
  await run("onTaskSubmit({preventDefault(){}})");
  sent = run("calls.filter(c=>c.action==='saveTask').pop().details.task");
  ok(sent.checklist === undefined && sent.owners.join() === "Kevin,Marcus", "an ordinary task: adding a person adds no line, and the checklist isn't sent");

  run("openTaskDialog({id:'ticked',title:'Ticked',owners:['Kevin','Marcus'],department:'Events',checklist:[{id:'a',text:'Kevin',done:true},{id:'b',text:'Marcus',done:false}]})");
  removeOwner(0); removeOwner(0);
  ok(texts(run("taskState.checklist")) === "Kevin✓", "taking off someone who already ticked their name keeps their ticked line");

  run("openTaskDialog({id:'old',title:'Old department',owners:['Kevin'],department:'Gone Dept'})");
  ok(element("tk-dept").innerHTML.includes("Gone Dept") && element("tk-dept").value === "Gone Dept", "a task whose department was removed keeps it as a choice");
  run("openTaskDialog({id:'odd',title:'Odd',owners:['Kevin'],department:'A <b>'})");
  ok(element("tk-dept").innerHTML.includes("A &lt;b&gt;"), "department names are escaped in the choices");
  ok(run("ownersShort({owners:['A','B','C','D','E']})") === "A, B, C +2" && run("ownersShort({owners:['A','B']})") === "A, B", "the list shows up to three names, then +N");
  ok(run("ownersShort({owners:['zed','Amy','bob','Cara']})") === "Amy, bob, Cara +1", "the list and board show names A to Z (any capitals), even on older tasks");
  ok(/class="board-people">Amy, bob, Cara \+1</.test(run("boardCard({id:'b1',title:'Board',status:'todo',owners:['zed','Amy','bob','Cara']},'2026-11-23')")), "Board cards use the short A to Z names too, so they fit their column");

  // A to Z as people are added, and the name lines with them (other checklist items keep their places)
  run(`taskState.team.push({name:'Aaron',department:'Internal',active:true});
    openTaskDialog({id:'az',title:'A to Z',owners:['Marcus','Kevin'],department:'Events',checklist:[{id:'x',text:'Book room',done:false},{id:'m',text:'Marcus',done:false},{id:'k',text:'Kevin',done:true}]})`);
  ok(run("taskState.owners.join()") === "Kevin,Marcus" && texts(run("taskState.checklist")) === "Book room,Kevin✓,Marcus", "opening a task shows its people and name lines A to Z");
  ok(run("taskFormSnapshot()") === run("taskState.formBase"), "…which alone doesn't count as a change");
  run("pickOwner('Aaron')");
  ok(run("taskState.owners.join()") === "Aaron,Kevin,Marcus" && texts(run("taskState.checklist")) === "Book room,Aaron,Kevin✓,Marcus", "someone added goes in A to Z order, with their name line");
  run("taskState.team.pop()");

  // The task window: the same buttons under "+ Add person"
  run(`calls.length=0; taskState.tasks=[{id:'tw',title:'Window',owners:['Kevin'],department:'Events',status:'todo',checklist:[],labels:[],updates:[]}];
    dueChip=()=>''; reminderChip=()=>''; openTaskDetail('tw');`);
  ok(element("td-groups").innerHTML.includes("+ Everyone"), "the task window shows the buttons too");
  press("td-groups", "");
  ok(run("taskState.draft.owners.join()") === "Kevin,Marcus" && texts(run("taskState.draft.checklist")) === "Kevin,Marcus", "Everyone in the task window adds everyone and their name lines");
  element("td-people").listeners.click({ target: { closest: (sel) => sel === "[data-remove-person]" ? { dataset: { removePerson: "0" } } : null } });
  ok(texts(run("taskState.draft.checklist")) === "Marcus", "taking someone off in the task window takes their line away");
  run("saveTaskDetail()");
  sent = run("calls.length ? calls[calls.length-1].details.task : null") || run("outboxRead().pop().details.task");
  ok(sent && texts(sent.checklist) === "Marcus" && sent.owners.join() === "Marcus", "Save sends the people and the checklist");
}

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

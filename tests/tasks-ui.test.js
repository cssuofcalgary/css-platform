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
const context = vm.createContext({ console, setTimeout, clearTimeout, URL, URLSearchParams, location:{href:'https://exec.example.org/?task=linked&keep=yes',search:'?task=linked&keep=yes'}, history:{replaceState(a,b,url){ context.location.href=url; context.location.search=new URL(url).search; }}, navigator:{clipboard:{async writeText(value){context.copied=value;}}}, $: element, document: {querySelector(){return null;},querySelectorAll(){return [];},addEventListener(){}},
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
run(`var renderTasksReal=renderTasks; renderTasks=()=>{}; taskState.team=[{name:'Kevin',department:'Events',active:true},{name:'Marcus',department:'Internal',active:true}];`);
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
  await upgrades();
  await background();
  await sorting();
  await quickAdd();
  await attention();
  await calendarLink();
  await fromPreset();
  await boardDrag();
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
  const card = run("boardCard({id:'b1',title:'Board',status:'todo',owners:['zed','Amy','bob','Cara']},'2026-11-23')");
  ok(card.includes('aria-label="Amy, bob, Cara, zed"') && card.includes('>+1</span>') && card.includes('>A</span>'), "Board avatars use A to Z names, show up to three initials and keep all names accessible");

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

// The upgraded task controls exercise the real handlers, rather than HTML snapshots alone.
async function upgrades() {
  run(`state.name='Kevin'; localStorage.store={}; calls.length=0; taskState.tasks=[]; taskState.filter='all'; taskState.search=''; taskState.person=''; taskState.label='';
    api=function(action,details){calls.push({action,details});return Promise.resolve({ok:true,task: action==='saveTask'?{...details.task,id:details.task.id||details.task.clientId}:undefined});};
    $('task-dialog').open=false;`);
  // "+ Add task" under the Blocked column, pressed on the board itself
  element("task-board").listeners.click({ target: { closest: (sel) => sel === "[data-add-status]" ? { dataset: { addStatus: "blocked" } } : null } });
  ok(element("task-dialog").open === true && run("taskState.editing===null && taskState.newStatus") === "blocked", "pressing + Add task in a Board column opens a new task for that column");
  run("$('tk-title').value='Call sponsor'; $('tk-priority').value='urgent';");
  ok(run("taskFormSnapshot() !== taskState.formBase"), "priority counts as a form change");
  await run("onTaskSubmit({preventDefault(){}})");
  await new Promise((r) => setTimeout(r, 0));
  ok(run("calls[0].details.task.status==='blocked' && calls[0].details.task.priority==='urgent' && taskState.tasks[0].status==='blocked'"), "Add task in a Board column sends and immediately shows its status and priority");
  run(`taskState.tasks=[{id:'urgent',title:'Book room',status:'todo',priority:'urgent',due:'2026-12-01',department:'Events',owners:['Kevin'],labels:['LNY'],notes:'Ask Campus',checklist:[{text:'Call office',done:false}]},
    {id:'normal',title:'Call campus',status:'doing',due:'2026-11-24',department:'Events',owners:['Marcus']},
    {id:'nobody',title:'Flyers',status:'todo',due:'2026-11-24',department:'Marketing',owners:[]}];
    taskState.search='LNY office campus';`);
  ok(run("filteredTasks().map(t=>t.id).join()") === "urgent", "every search word must match across notes, labels and checklist text");
  run("taskState.search=''; taskState.person='Marcus'; taskState.filter='mine'");
  element("task-person-filter").value = "Marcus";
  element("task-person-filter").listeners.change();
  ok(run("taskState.filter==='all' && filteredTasks()[0].id==='normal'") && run("localStorage.getItem(TASK_FILTER_KEY)") !== "all", "choosing a person on My tasks shows Everyone without remembering that change");
  run("taskState.person=TASK_NOBODY");
  ok(run("filteredTasks().map(t=>t.id).join()") === "nobody", "Nobody yet finds tasks without assignees");
  run("taskState.person='Marcus'; taskState.search=''; taskState.filter='Events'");
  ok(run("filteredTasks({ignorePerson:true}).length") === 2, "People view can ignore Person while keeping the department");
  element("task-filters").listeners.click({ target: { closest() { return {dataset:{taskFilter:"mine"}}; } } });
  ok(run("taskState.person") === "", "clicking My tasks clears Person");
  run("taskState.filter='all'; taskState.search='nothing matches'; taskState.loaded=true; renderTasksReal()");
  ok(element("task-no-match").hidden === false && element("task-empty").hidden === true, "an empty filtered List shows No tasks match and Clear filters");
  element("task-clear-filters").listeners.click();
  ok(run("taskState.search==='' && taskState.person==='' && taskState.label==='' && taskState.filter==='all'"), "Clear filters restores all tasks");
  run("renderBoard()");
  ok(element("task-board").innerHTML.indexOf('data-task-id="urgent"') < element("task-board").innerHTML.indexOf('data-task-id="nobody"'), "Board sorts priority before due date and title (an Urgent task due later comes before a Normal one due sooner)");
  ok((element("task-board").innerHTML.match(/data-add-status=/g) || []).length === 3, "Board offers Add task for To do, Doing and Blocked");
  ok(!run("priorityChip({priority:'high',status:'done'})") && !run("priorityChip({status:'todo'})"), "Normal and completed tasks have no priority pill");
  const progress = run("boardCard({id:'progress',title:'Progress',status:'todo',checklist:[{text:'A',done:true},{text:'B',done:false}]},'2026-11-23')");
  ok(progress.includes('aria-valuenow="1"') && progress.includes('width:50%'), "Board checklist progress shows the completed fraction");
  run("calls.length=0; openTaskDetail('urgent'); taskState.draft.priority='low'; saveTaskDetail()");
  await new Promise((r) => setTimeout(r, 0));
  ok(run("calls[0].details.task.priority==='low' && Object.keys(calls[0].details.task).length===2 && taskById('urgent').priority==='low'"), "task-window priority saves only the changed field and applies locally");
  run(`taskState.tasks=[{id:'copy',title:'X'.repeat(140),status:'doing',priority:'high',due:'2026-12-01',department:'Events',owners:['Marcus','Kevin'],labels:['LNY'],notes:'Keep notes',link:'https://example.org',remind:[{days:2,at:'09:00'}],checklist:[{id:'c1',text:'Book room',done:true}]}];openTaskDetail('copy');`);
  await run("duplicateOpenTask()");
  ok(run("taskState.editing===null && $('tk-title').value.length===140 && $('tk-title').value.endsWith(T.taskCopySuffix) && $('tk-due').value==='' && taskState.checklist.every(c=>!c.done&&!c.id) && taskState.formLabels[0]==='LNY' && $('tk-priority').value==='high'"), "Duplicate starts a new task with preserved details, fitted copy title, no due date and an unticked checklist");
  await run("onTaskSubmit({preventDefault(){}})");
  await new Promise((r) => setTimeout(r, 0));
  ok(run("calls[calls.length-1].details.task.labels[0]==='LNY' && calls[calls.length-1].details.task.checklist[0].done===false && calls[calls.length-1].details.task.status==='todo'"), "adding the duplicate keeps labels and starts To do");
  run("openTaskDetail('copy')");
  await run("copyTaskLink()");
  ok(context.copied === "https://exec.example.org/?task=copy" && element("td-copy-link").textContent === "Link copied", "Copy link writes a direct task URL and confirms inside the window");
  run("taskState.tasks=[{id:'linked',title:'Direct task',status:'todo'}]; openLinkedTask()");
  ok(run("taskState.openId") === "linked" && context.location.search === "?keep=yes", "a linked task opens after loading and removes only task from the address");
  run("showPersonTasks('Marcus')");
  ok(run("taskState.view==='list' && taskState.filter==='all' && taskState.person==='Marcus'"), "a People row opens that person's List");
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

// An empty My tasks, and Done lists the most recently finished first (List and Board).
async function sorting() {
  run(`taskState.view='list'; taskState.loaded=true; taskState.filter='mine'; taskState.search=''; taskState.person=''; taskState.label=''; taskState.quick='';
    state.name='Kevin'; taskState.tasks=[{id:'m1',title:'Marcus only',owners:['Marcus'],status:'todo'}]; renderTasksReal();`);
  ok(element("task-empty").hidden === false && element("task-no-match").hidden === true, "an empty My tasks says No tasks here with New task, not No tasks match");
  run(`taskState.filter='all'; taskState.tasks=[
      {id:'d-old',title:'A old',owners:['Kevin'],status:'done',priority:'urgent',doneAt:'2026-11-20T18:00:00Z'},
      {id:'d-new',title:'B new',owners:['Kevin'],status:'done',priority:'low',doneAt:'2026-11-22T18:00:00Z'},
      {id:'d-mid',title:'C mid',owners:['Kevin'],status:'done',updatedAt:'2026-11-21T18:00:00Z'}]; renderTasksReal();`);
  const order = (html) => ["d-new", "d-mid", "d-old"].map((id) => html.indexOf(`data-task-id="${id}"`));
  const inOrder = (a) => a.every((x) => x >= 0) && a[0] < a[1] && a[1] < a[2];
  ok(inOrder(order(element("task-groups").innerHTML)), "the Done group lists the most recently finished first (older tasks without a finish time use their last change)");
  run("renderBoard()");
  ok(inOrder(order(element("task-board").innerHTML)), "the Board's Done column lists the most recently finished first");
}

// Quick add: one sentence, read by the server. Never kept on the device, never sent again on a guess.
async function quickAdd() {
  run(`var toasts=[]; showToast=function(text,kind){toasts.push({text,kind});}; var release=null;
    taskState.tasks=[{id:'keep',title:'Keep',owners:['Kevin'],status:'todo'}]; taskState.discord={posting:true}; taskState.quickSend=null;
    calls.length=0; localStorage.store={};
    api=function(action,details){calls.push({action,details}); return new Promise((r)=>{release=r;});};`);
  const box = element("task-quick-add");
  ok(run("T.taskQuickPlaceholder").startsWith("Quick add") && box.placeholder === run("T.taskQuickPlaceholder"), "the quick add box shows an example sentence");
  box.value = "  posters for AGM   by friday @Chris ";
  const sending = element("task-quick-form").listeners.submit({ preventDefault() {} });
  ok(box.disabled === true && run("calls.length") === 1 && run("calls[0].action") === "quickAddTask", "Enter sends the sentence once, and the box is locked while it sends");
  ok(run("calls[0].details.text") === "posters for AGM by friday @Chris" && /^TK/.test(run("calls[0].details.clientId")), "the sentence goes with its own name, so the server never adds it twice");
  run(`release({ok:true,discordPosted:true,task:{id:'Q1',title:'Posters for AGM',owners:['Chris'],due:'2026-11-27',status:'todo',department:'Marketing'},
    quick:{title:'Posters for AGM',owners:['Chris'],due:'2026-11-27',priority:'normal',remindNeedsDue:false}})`);
  await sending;
  const toast = run("toasts[toasts.length-1]");
  ok(box.value === "" && box.disabled === false && run("taskById('Q1').title") === "Posters for AGM" && run("taskState.tasks.length") === 2, "on success the box is cleared and the new task shows straight away");
  ok(toast.kind === "success" && toast.text.includes("Posters for AGM") && toast.text.includes("Chris") && toast.text.includes(run("isoText('2026-11-27',{weekday:'short',month:'short',day:'numeric'})")) && toast.text.includes(run("T.taskQuickPosted")),
    "the confirmation says the title, who, the due date, and that it was posted on Discord");
  ok(run("outboxCount()") === 0, "quick add is never put in the waiting-to-send list");

  // The server already had it (same name): replaced, not shown twice. No date, nobody, not posted.
  run(`api=function(action,details){calls.push({action,details}); return Promise.resolve({ok:true,repeated:true,discordPosted:false,task:{id:'Q1',title:'Posters',owners:[],status:'todo'},quick:{title:'Posters',owners:[],due:'',remindNeedsDue:true}});};`);
  box.value = "posters";
  await run("sendQuickAdd({preventDefault(){}})");
  const toast2 = run("toasts[toasts.length-1].text");
  ok(run("taskState.tasks.filter(t=>t.id==='Q1').length") === 1 && run("taskById('Q1').title") === "Posters", "a task already on the list is replaced, not shown twice");
  ok(toast2.includes(run("T.taskQuickNoDate")) && toast2.includes(run("T.taskNobody")) && toast2.includes(run("T.taskQuickNotPosted")) && toast2.includes(run("T.taskQuickRemindNeedsDue")),
    "no date, nobody on it, not posted on Discord, and a reminder without a date are all said plainly");

  // No connection: the sentence stays, nothing is kept or sent again, and New task is suggested.
  run(`calls.length=0; api=function(action,details){calls.push({action,details}); return Promise.resolve({ok:false,error:'NETWORK'});};`);
  box.value = "call the venue tomorrow";
  await run("sendQuickAdd({preventDefault(){}})");
  await new Promise((r) => setTimeout(r, 30));
  ok(box.value === "call the venue tomorrow" && box.disabled === false && run("calls.length") === 1, "no connection: the sentence stays in the box and isn't sent again on a guess");
  ok(run("toasts[toasts.length-1].text") === run("T.taskQuickOffline") && run("outboxCount()") === 0 && run("taskState.tasks.length") === 2, "…it says it couldn't reach the server and to use New task, and nothing is queued");
  const firstId = run("calls[0].details.clientId");
  run(`api=function(action,details){calls.push({action,details}); return Promise.resolve({ok:false,error:'Quick add needs a task name.'});};`);
  await run("sendQuickAdd({preventDefault(){}})");
  ok(run("calls[1].details.clientId") === firstId && run("toasts[toasts.length-1].text") === "Quick add needs a task name." && box.value === "call the venue tomorrow",
    "pressing Enter again on the same sentence keeps its name; other problems show the server's message");
  box.value = "   ";
  await run("sendQuickAdd({preventDefault(){}})");
  ok(run("calls.length") === 2, "an empty box sends nothing");
  box.value = "";
}

// Needs attention: chips counting what needs a look, under the filters; tapping one shows just those.
async function attention() {
  run(`state.name='Kevin'; taskState.view='list'; taskState.loaded=true; taskState.filter='all'; taskState.search=''; taskState.person=''; taskState.label=''; taskState.quick='';
    var recent='2026-11-22T18:00:00Z';
    taskState.tasks=[
      {id:'late',title:'Late',owners:['Kevin'],status:'todo',due:'2026-11-20',updatedAt:recent},
      {id:'lateNobody',title:'Late nobody',owners:[],status:'todo',due:'2026-11-21',createdAt:recent},
      {id:'soon',title:'Soon',owners:['Kevin'],status:'doing',due:'2026-11-29',updatedAt:recent},
      {id:'nextWeek',title:'Next week',owners:[],status:'todo',due:'2026-11-30',createdAt:recent},
      {id:'stuck',title:'Stuck',owners:['Marcus'],status:'blocked',createdAt:'2026-11-01T18:00:00Z',updatedAt:'2026-11-10T18:00:00Z',updates:[{text:'asked',createdAt:'2026-11-18T18:00:00Z'}]},
      {id:'quiet',title:'Quiet',owners:['Marcus'],status:'todo',createdAt:'2026-11-01T18:00:00Z',updatedAt:'2026-11-16T18:00:00Z',updates:[{text:'old',createdAt:'2026-11-12T18:00:00Z'}]},
      {id:'finished',title:'Finished',owners:[],status:'done',due:'2026-11-01',createdAt:'2026-10-01T18:00:00Z'}];
    renderTasksReal();`);
  ok(run("JSON.stringify(attentionCounts())") === JSON.stringify({ overdue: 2, week: 1, blocked: 1, nobody: 2, quiet: 1 }),
    "counts open tasks only: overdue, due today to 6 days ahead, blocked, nobody on it, and no change or update for 7+ days");
  const strip = element("task-attention");
  ok(strip.hidden === false && ["overdue", "week", "blocked", "nobody", "quiet"].every((k) => strip.innerHTML.includes(`data-task-quick="${k}"`)) && !strip.innerHTML.includes('aria-pressed="true"'),
    "the strip shows a chip for each kind that has any, none pressed");
  const tap = (key) => strip.listeners.click({ target: { closest: (sel) => sel === "[data-task-quick]" ? { dataset: { taskQuick: key } } : null } });
  tap("quiet");
  ok(run("taskState.quick") === "quiet" && run("filteredTasks().map(t=>t.id).join()") === "quiet", "tapping No update in 7+ days shows just those tasks (an older change but a newer update doesn't count)");
  run("renderTasksReal()");
  ok(/class="chip att-quiet active" data-task-quick="quiet" aria-pressed="true"/.test(strip.innerHTML), "…and that chip shows as pressed");
  tap("nobody");
  ok(run("taskState.quick") === "nobody" && run("filteredTasks().map(t=>t.id).join()") === "lateNobody,nextWeek", "one chip at a time: Nobody on it takes over, and a finished task never counts");
  tap("nobody");
  ok(run("taskState.quick") === "" && run("filteredTasks().length") === 7, "tapping it again shows everything again");
  run("taskState.person='Marcus'; renderTasksReal()");
  ok(run("JSON.stringify(attentionCounts())") === JSON.stringify({ overdue: 0, week: 0, blocked: 1, nobody: 0, quiet: 1 }) && !strip.innerHTML.includes('data-task-quick="overdue"') && strip.innerHTML.includes('data-task-quick="blocked"'),
    "the counts follow the other filters, and chips with nothing are left out");
  run("taskState.view='people'");
  ok(run("attentionCounts().overdue") === 2, "on the People view the counts leave out the Person menu, like the view itself");
  run("taskState.view='list'; taskState.person=''; taskState.search='zzz nothing'; renderTasksReal()");
  ok(strip.hidden === true && strip.innerHTML === "", "with nothing needing attention the strip is hidden");
  run("taskState.search=''; taskState.quick='nobody'; taskState.filter='mine'; renderTasksReal()");
  ok(run("taskState.quick") === "nobody" && /data-task-quick="nobody" aria-pressed="true">[^<]*<span class="task-count">0</.test(strip.innerHTML) && strip.hidden === false,
    "a picked chip with none left (My tasks has no task without people) stays, pressed, so it can be tapped off");
  ok(element("task-no-match").hidden === false && element("task-empty").hidden === true, "…and the empty list says No tasks match, with Clear filters");
  run("taskState.filter='all'; taskState.quick='overdue'; renderTasksReal()");
  ok(run("filteredTasks().map(t=>t.id).join()") === "late,lateNobody" && element("task-groups").innerHTML.includes('data-task-id="late"') && !element("task-groups").innerHTML.includes('data-task-id="soon"'), "Overdue shows only open overdue tasks in the list");
  run("taskState.search='Soon'; renderTasksReal()");
  ok(element("task-no-match").hidden === false && element("task-empty").hidden === true, "a chip and a search that match nothing say No tasks match, with Clear filters");
  element("task-clear-filters").listeners.click();
  ok(run("taskState.quick") === "" && run("taskState.search") === "" && run("taskState.filter") === "all", "Clear filters also turns off the chip");
  run("taskState.quick='blocked'; taskState.person='Kevin'");
  ok(run("filteredTasks({skipPerson:true}).map(t=>t.id).join()") === "stuck" && run("filteredTasks({ignorePerson:true}).map(t=>t.id).join()") === "stuck" && run("filteredTasks().length") === 0,
    "the People view can still leave out the Person menu, and the chip applies there too");
  run("taskState.quick=''; taskState.person=''");
  ok(!Object.keys(run("localStorage.store")).some((k) => /quick|attention/i.test(k)), "the picked chip isn't remembered on this device");
}

// Add to Google Calendar: an all-day event on the due date, with a link back to the task.
async function calendarLink() {
  ok(run("googleCalendarUrl('AGM & posters #1','2026-11-30','https://exec.example.org/?task=T1')") ===
    "https://calendar.google.com/calendar/render?action=TEMPLATE&text=AGM%20%26%20posters%20%231&dates=20261130%2F20261201&details=https%3A%2F%2Fexec.example.org%2F%3Ftask%3DT1",
    "the Google Calendar link is an all-day event (that day to the next), with everything encoded");
  const nye = run("googleCalendarUrl('New year','2026-12-31','')");
  ok(nye.includes("dates=20261231%2F20270101") && !nye.includes("details="), "…New Year's Eve ends on the next year's first day; no details when there are none");
  ok(["''", "null", "undefined", "'2026-11-3'", "'2026-11-30T10:00'", "'2026-02-30'", "'Nov 30'"].every((v) => run(`googleCalendarUrl('X',${v},'d')`) === ""), "…and there's no link for anything that isn't a real yyyy-mm-dd date");
  run(`taskState.tasks=[{id:'cal1',title:'Book room',owners:['Kevin'],status:'todo',due:'2026-12-02',updates:[]},{id:'cal2',title:'No date',owners:['Kevin'],status:'todo',updates:[]}];
    $('task-detail-dialog').open=false; openTaskDetail('cal1');`);
  const link = element("td-gcal");
  ok(link.hidden === false && link.href.includes("dates=20261202%2F20261203") && link.href.includes("text=Book%20room") && link.href.includes(encodeURIComponent("?task=cal1")),
    "the task window offers Add to Google Calendar for a task with a due date, linking back to the task");
  run("openTaskDetail('cal2')");
  ok(link.hidden === true, "…and not for a task without a due date");
  run("$('task-detail-dialog').close()");
}

// newTaskFrom: what Teams uses to start a task from a record. A NEW task, nothing saved until Add task.
async function fromPreset() {
  run(`var switched=[]; switchTab=async function(name){switched.push(name);};
    state.name='Kevin'; calls.length=0; localStorage.store={}; taskState.filter='all';
    api=function(action,details){calls.push({action,details});return Promise.resolve({ok:true,task: action==='saveTask'?{...details.task,id:details.task.id||details.task.clientId}:undefined});};
    taskState.team=[{name:'Kevin',department:'Events',active:true},{name:'Marcus',department:'Internal',active:true}];
    setTaskDepts(['Events','Marketing','Internal','External','Finance','General']);
    taskState.tasks=[{id:'lab',title:'Has label',owners:['Kevin'],status:'todo',labels:['LNY']}];
    $('task-dialog').open=false;`);
  const opened = await run(`newTaskFrom({title:'  Book   venue ', due:'2026-12-05T00:00:00', owners:['zed','marcus'], department:'finance', notes:'From the AGM tracker', priority:'high', labels:['lny','Venue'], checklist:['Call', {id:'x1', text:'Pay deposit', done:true}, '']})`);
  ok(opened === true && run("switched.join()") === "tasks" && element("task-dialog").open === true, "a preset (from Teams) switches to Tasks and opens the New task window");
  ok(run("taskState.editing") === null && element("task-dialog-title").textContent === run("T.taskDialogNew") && element("tk-save").textContent === run("T.taskAdd"), "…as a new task");
  ok(element("tk-title").value === "Book venue" && element("tk-due").value === "2026-12-05" && element("tk-dept").value === "Finance" && element("tk-priority").value === "high" && element("tk-notes").value === "From the AGM tracker",
    "…with the title, due date, department, priority and notes filled in");
  ok(run("taskState.owners.join()") === "Marcus,zed" && run("taskState.formLabels.join()") === "LNY,Venue", "…the people A to Z (spelled as on People), and labels matched to the ones in use");
  ok(run("JSON.stringify(taskState.checklist)") === JSON.stringify([{ id: "", text: "Call", done: false }, { id: "", text: "Pay deposit", done: false }]), "…and the checklist unticked, without old ids");
  ok(run("calls.length") === 0 && run("outboxCount()") === 0 && run("taskFormSnapshot()") === run("taskState.formBase"), "nothing is saved until Add task (and closing it untouched doesn't ask)");
  await run("onTaskSubmit({preventDefault(){}})");
  await new Promise((r) => setTimeout(r, 0));
  const sent = run("(calls.filter(c=>c.action==='saveTask').pop()||{details:{}}).details.task");
  ok(!!sent && !sent.id && /^TK/.test(sent.clientId) && sent.status === "todo" && sent.title === "Book venue" && sent.department === "Finance" && sent.checklist.every((c) => !c.done && !c.id) && sent.labels.join() === "LNY,Venue",
    "Add task saves it as a new task, To do");

  run(`switchTab=undefined; $('task-dialog').open=false;`);
  const plain = await run("newTaskFrom({title:'Other', department:'Nope', owners:[]})");
  ok(plain === true && element("tk-dept").value === "General" && run("taskState.owners.join()") === "Kevin" && element("tk-due").value === "" && run("taskState.checklist.length") === 0,
    "an unknown department becomes General, and with nobody given it's yours (and it works without the tab switcher)");
  run(`$('task-dialog').open=false; var realQS=document.querySelector; switchTab=async function(){};
    document.querySelector=function(sel){ return sel === '.tab[data-tab="tasks"]' ? { classList: { contains: function(){ return false; } } } : null; };`);
  const stayed = await run("newTaskFrom({title:'Not now'})");
  ok(stayed === false && element("task-dialog").open === false, "if leaving the other tab was cancelled, nothing opens");
  run("document.querySelector=realQS; switchTab=undefined;");
}

// Dragging on the Board: the drag helper (Sortable) when it's on the page, the browser's own dragging otherwise; never both.
async function boardDrag() {
  context.requestAnimationFrame = (fn) => fn();
  run(`taskState.tasks=[{id:'drag1',title:'Drag me',owners:['Kevin'],status:'todo'},{id:'drag2',title:'Other',owners:['Kevin'],status:'doing'}];
    taskState.filter='all'; taskState.search=''; taskState.person=''; taskState.label=''; taskState.quick=''; taskState.view='board';
    var moved=[]; var realChange=changeTaskStatus; changeTaskStatus=function(id,status){moved.push(id+':'+status);};`);
  const board = element("task-board");
  ok(run("typeof Sortable") === "undefined", "(this test page starts without the drag helper)");
  let drew = true;
  try { run("renderBoard(); renderTasksReal();"); } catch (e) { drew = false; console.error(e); }
  ok(drew && board.innerHTML.includes('draggable="true"') && run("taskState.sortables.length") === 0, "without the drag helper the board draws with no errors, using the browser's own dragging");
  const card = { dataset: { taskId: "drag1" }, classList: { add() {}, remove() {} } };
  const dragOnto = (status) => {
    board.listeners.dragstart({ target: { closest: (sel) => sel === ".board-card" ? card : null }, dataTransfer: { setData() {} } });
    board.listeners.drop({ target: { closest: (sel) => sel === "[data-board-status]" ? { dataset: { boardStatus: status } } : null }, preventDefault() {} });
  };
  board.querySelectorAll = () => [];
  dragOnto("done");
  ok(run("moved.join()") === "drag1:done", "…dropping a card on another column changes its status once");

  const made = []; let destroyed = 0;
  const lists = ["todo", "doing", "blocked", "done"].map((s) => ({ getAttribute: (name) => name === "data-board-list" ? s : null }));
  board.querySelectorAll = (sel) => sel === "[data-board-list]" ? lists : [];
  board.classList = { add(c) { this[c] = true; }, remove(c) { delete this[c]; }, toggle() {} };
  context.Sortable = function () {};
  context.Sortable.create = (el, opts) => { made.push({ el, opts }); return { destroy() { destroyed++; } }; };
  run("moved.length=0; renderBoard()");
  const o = made[0] ? made[0].opts : {};
  ok(made.length === 4 && made.every((m, i) => m.el === lists[i] && m.opts.group === o.group) && o.delay === 180 && o.delayOnTouchOnly === true && o.draggable === ".board-card",
    "with the drag helper, each column's cards can be dragged to the others (press and hold first on a phone)");
  ok(!board.innerHTML.includes('draggable="true"'), "…and the browser's own dragging is off, so a card can't move twice");
  o.onStart();
  ok(board.classList["board-dragging"] === true, "…while dragging, the board stops snapping so it can scroll to the next column");
  o.onEnd({ from: lists[0], to: lists[3], item: { getAttribute: () => "drag1" } });
  ok(!board.classList["board-dragging"] && run("moved.length") === 0, "…the status changes only after the drag helper has finished");
  await new Promise((r) => setTimeout(r, 0));
  ok(run("moved.join()") === "drag1:done", "dropping a card in another column changes its status");
  o.onEnd({ from: lists[0], to: lists[0], item: { getAttribute: () => "drag1" } });
  await new Promise((r) => setTimeout(r, 0));
  ok(run("moved.length") === 1, "dropping it back in its own column changes nothing");
  dragOnto("blocked");
  ok(run("moved.length") === 1 && run("taskState.dragId") === "", "the browser's own drop does nothing while the drag helper is on");
  run("renderBoard()");
  ok(destroyed === 4 && made.length === 8 && run("taskState.sortables.length") === 4, "drawing the board again replaces the old drag lists");
  run("taskState.view='list'; renderTasksReal()");
  ok(destroyed === 8 && run("taskState.sortables.length") === 0, "leaving the Board removes them");
  delete context.Sortable;
  run("changeTaskStatus=realChange");
}

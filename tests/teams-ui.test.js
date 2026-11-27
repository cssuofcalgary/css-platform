// Real Teams shell and view helpers, with an offline DOM/API. No live records or mail.
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
let failed = 0;
function ok(value, message) { console.log((value ? "PASS " : "FAIL ") + message); if (!value) failed++; }
function node(id = "") {
  return { id, value: "", textContent: "", innerHTML: "", hidden: true, disabled: false, checked: false, open: false,
    dataset: {}, children: [], listeners: {}, classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(event, callback) { this.listeners[event] = callback; }, removeEventListener() {},
    setAttribute() {}, focus() {}, blur() {}, click() {}, showModal() { this.open = true; }, close() { this.open = false; },
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
    querySelector() { return null; }, querySelectorAll() { return []; }, remove() {},
    setCustomValidity() {}, reportValidity() { return true; } };
}
const elements = {}, element = (id) => elements[id] ||= node(id), timers = [];
const context = vm.createContext({ console, Promise, Map, WeakMap, Set, Intl, Blob, URL, $: element,
  setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: () => {},
  document: { createElement: () => node(), querySelectorAll: () => [], getElementById: element },
  matchMedia: () => ({ matches: false }), localStorage: { values: {}, getItem(key) { return this.values[key] || null; }, setItem(key, value) { this.values[key] = value; } },
  escapeHtml: (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])) });
const run = (code) => vm.runInContext(code, context);
for (const file of ["strings.js", "teams-views.js"]) run(fs.readFileSync(path.join(__dirname, "../exec-portal", file), "utf8"));
run(`var state={token:'test-president',name:'Gordon',role:'exec'}, READ_ACTIONS=[], calls=[], count=0, handler=null;
  function newRequestId(){return 'request000000'+(++count);}
  function errorText(reply){return reply.message||reply.error;}
  var confirms=[], confirmAnswer=true, toasts=[], switched=[];
  function askConfirm(message){confirms.push(message);return Promise.resolve(confirmAnswer);}
  function showToast(message){toasts.push(message);}
  function switchTab(name){switched.push(name);}
  function api(action,details={},options={}){calls.push({action,details:JSON.parse(JSON.stringify(details)),options});return Promise.resolve().then(()=>handler(action,details,options));}
  var tracker={id:'TTfixture0001',name:'Sponsors <spring>',department:'External',template:'sponsorship',fields:[
    {id:'Fname',name:'Company',type:'text'},{id:'Fstatus',name:'Status',type:'choice',options:[{id:'Otodo',label:'To contact',color:'blue'},{id:'Odone',label:'Confirmed',color:'green'}]},
    {id:'Fdate',name:'Follow-up',type:'date'},{id:'Famount',name:'Amount',type:'money'},{id:'Fcheck',name:'Ready',type:'checkbox'}],views:{default:'table',boardField:'Fstatus',dateField:'Fdate'}};
  var rows=[{id:'TRfixture0001',values:{Fname:'Company A',Fstatus:'Otodo',Fdate:'2026-12-01',Famount:25,Fcheck:false},sort:1}];
  var spaces={ok:true,departments:['General','External','Presidents'],trackers:[{id:tracker.id,department:'External',name:tracker.name,rowCount:1}],templates:[{key:'sponsorship',name:'Sponsorship tracker',department:'External'}],team:[{name:'Gordon',active:true,departments:['Presidents']}]};
  function ordinary(action,details){
    if(action==='teamSpaces')return JSON.parse(JSON.stringify(spaces));
    if(action==='getTracker')return {ok:true,tracker:JSON.parse(JSON.stringify(tracker)),rows:JSON.parse(JSON.stringify(rows))};
    if(action==='saveTrackerRow') {let row=rows.find(r=>r.id===details.row.id);if(!row){row={id:details.row.clientId,values:{},sort:rows.length+1};rows.push(row);} Object.assign(row.values,details.row.values);return {ok:true,row:JSON.parse(JSON.stringify(row))};}
    if(action==='saveTracker'){Object.assign(tracker,details.tracker);return {ok:true,tracker:JSON.parse(JSON.stringify(tracker))};}
    if(action==='removeTrackerRow')return {ok:true};
    return {ok:true};
  }
  handler=ordinary;`);
run(fs.readFileSync(path.join(__dirname, "../exec-portal/teams.js"), "utf8"));
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function main() {
  ok(run("READ_ACTIONS.includes('teamSpaces')&&READ_ACTIONS.includes('getTracker')"), "Teams lookups use the existing safe-read retry policy");
  run("handler=()=>({ok:false,error:'NOT_PRESIDENT'})");
  await run("tmCheckAccess()");
  ok(element("teams-tab-button").hidden && !run("tmState.access"), "a non-president sees no Teams entry or data");
  ok(run("toasts.length") === 0 && run("switched.length") === 0, "an exec who was never in Teams gets no message and stays where they are");
  run("handler=ordinary"); await run("tmCheckAccess()");
  ok(!element("teams-tab-button").hidden && run("tmState.access"), "the server's president response reveals Teams");
  ok(run("calls.filter(c=>c.action==='teamSpaces').every(c=>c.options.quiet)"), "the sign-in access lookup stays quiet");
  ok(run("tmState.departments.join(',')") === "External,Presidents,General", "department spaces keep General last");
  run("tmRenderSpaces()");
  ok(element("tm-workspace").innerHTML.includes("Sponsors &lt;spring&gt;") && !element("tm-workspace").innerHTML.includes("Sponsors <spring>"), "tracker card names are escaped");
  await run("tmOpenTracker('TTfixture0001')");
  ok(run("tmAvailableViews().join(',')") === "table,board,calendar" && element("tm-view").children.length > 0, "the shell renders the real view module with all available view types");
  run("tmState.search='company contact'");
  ok(run("tmVisibleRows().length") === 1, "search requires every word and searches Choice labels");
  run("tmState.search='company declined'"); ok(run("tmVisibleRows().length") === 0, "unmatched search words hide a record");
  run("tmState.search=''; calls=[]; handler=(a,d)=>a==='saveTrackerRow'?{ok:false,error:'NETWORK',message:'Offline'}:ordinary(a,d)");
  let rejected = false; try { await run("tmSaveRow('TRfixture0001',{Fname:'Unsaved'})"); } catch (error) { rejected = true; }
  ok(rejected && run("tmFindRow('TRfixture0001').values.Fname") === "Company A", "failed cell saves reject so the view can revert, and never alter the saved row");
  run("var release; handler=(a,d)=>a==='saveTrackerRow'?new Promise(resolve=>{release=()=>resolve(ordinary(a,d));}):ordinary(a,d);calls=[];var p1=tmSaveRow('TRfixture0001',{Fname:'Renamed'});var p2=tmSaveRow('TRfixture0001',{Famount:50});");
  await tick();
  ok(run("calls.filter(c=>c.action==='saveTrackerRow').length") === 1, "two edits to the same row are sent one at a time");
  run("tmState.search='renamed';tmRenderView()");
  ok(run("tmState.viewRefreshPending"), "search waits for pending edits before rebuilding the view");
  run("release()"); await tick();
  ok(run("calls.filter(c=>c.action==='saveTrackerRow').length") === 2, "the second row edit follows the first response");
  run("release()"); await run("Promise.all([p1,p2])");
  ok(run("tmFindRow('TRfixture0001').values.Fname==='Renamed'&&tmFindRow('TRfixture0001').values.Famount===50"), "changed-cell saves keep both edits");
  ok(!run("tmState.viewRefreshPending"), "the deferred search renders after the queue settles");
  ok(run("Object.keys(calls.filter(c=>c.action==='saveTrackerRow')[1].details.row.values).join(',')") === "Famount", "a later cell save sends no unrelated values");
  run("handler=ordinary;tmState.search=''");
  await run("tmOpenRecord('TRfixture0001')");
  const fieldValues = ["Renamed", "Otodo", "2026-12-01", "75", ""];
  fieldValues.forEach((value, index) => { element("tm-value-" + index).value = value; });
  element("tm-value-4").checked = false;
  run("calls=[];handler=(a,d)=>a==='saveTrackerRow'?{ok:false,error:'NETWORK',message:'Offline'}:ordinary(a,d)");
  await run("tmSaveRecord({preventDefault(){}})");
  ok(element("tm-record-dialog").open && element("tm-value-3").value === "75" && element("tm-record-error").textContent === "Offline", "a failed record save keeps the window and entered values for retry");
  ok(run("Object.keys(calls[0].details.row.values).join(',')") === "Famount", "record Save sends only fields changed since opening");
  run("handler=ordinary"); await run("tmSaveRecord({preventDefault(){}})");
  ok(!element("tm-record-dialog").open && run("tmFindRow('TRfixture0001').values.Famount") === 75, "record retry saves and closes after success");
  run("tmOpenColumns();var originalId=tmState.columns.fields[0].id;tmColumnsInput({target:{dataset:{tmColumnName:originalId},value:'Partner'}})");
  ok(run("tmState.columns.fields[0].id===originalId&&tmState.columns.fields[0].name==='Partner'"), "renaming a column keeps its stable ID and saved cells");
  await run("tmColumnsClick({target:{closest(){return {dataset:{tmColumnDown:originalId}};}}})");
  ok(run("tmState.columns.fields[1].id===originalId"), "Columns can reorder the title column without changing its ID");
  run("tmState.columns.fields=tmState.columns.fields.filter(f=>f.type!=='date');tmRenderColumnViews()");
  ok(run("tmState.columns.views.dateField") === "", "removing the Date column clears the Calendar selection");
  run("tmState.columns=null;tmNode('tm-columns-dialog').close();tmState.rows=[{id:'TRcsv00000001',values:{Fname:'=HYPERLINK(\"bad\")\\nSecond line',Fstatus:'Otodo',Famount:3,Fcheck:false}}]");
  const csv = run("tmCsvText()");
  ok(csv.includes("'=") && csv.includes('""bad""') && csv.includes("To contact") && !csv.includes("Otodo"), "CSV escapes formulas and quotes and exports Choice labels");
  await run("tmOpenTracker('TTfixture0001')");
  await run("tmOpenRecord('TRfixture0001')");
  await run("tmRemoveRecord()");
  ok(run("tmState.rows.length") === 0 && !element("tm-undo").hidden, "removing a record hides it and exposes Undo");
  await run("tmUndoRemove()");
  ok(run("tmState.rows.length") === 1 && element("tm-undo").hidden, "Undo restores the removed record in the current tracker");

  // A connection blip keeps Teams open; only "not a president" or "signed out" closes it.
  run("handler=ordinary"); await run("tmOpenTracker('TTfixture0001')");
  for (const error of ["NETWORK", "BUSY", "TEMPORARY"]) {
    const before = element("tm-workspace").innerHTML;
    run(`handler=()=>({ok:false,error:'${error}',message:'Trouble ${error}'})`);
    const answer = await run("tmCheckAccess()");
    ok(answer === false && run("tmState.access") && run("tmState.tracker") && !element("teams-tab-button").hidden && element("tm-workspace").innerHTML === before &&
      element("tm-status").textContent === "Trouble " + error && !element("tm-status").hidden, `a ${error} reply keeps Teams and the open tracker, and shows the reason`);
  }
  run("handler=ordinary;tmRenderSpaces();handler=()=>({ok:false,error:'NETWORK',message:'Offline'})");
  await run("tmRefresh()");
  ok(element("tm-workspace").innerHTML.includes("tm-tracker-card") && element("tm-status").textContent === "Offline", "Refresh during a connection blip keeps the tracker cards and says why");
  run("handler=()=>({ok:false,error:'NOT_PRESIDENT'});toasts=[];switched=[]");
  element("tab-teams").hidden = false;
  await run("tmCheckAccess()");
  ok(!run("tmState.access") && element("teams-tab-button").hidden && element("tab-teams").hidden && run("switched.join()") === "tasks" && run("toasts.join()") === run("T.tmPresidentOnly"),
    "losing president access while on Teams moves to Tasks with a short message instead of a blank page");
  run("handler=ordinary;toasts=[];switched=[]"); await run("tmCheckAccess()"); await run("tmOpenTracker('TTfixture0001')");
  element("tab-teams").hidden = false;
  run("handler=(a,d)=>a==='saveTrackerRow'?{ok:false,error:'NOT_PRESIDENT'}:ordinary(a,d)");
  let refused = false; try { await run("tmSaveRow('TRfixture0001',{Fname:'Not saved'})"); } catch (error) { refused = true; }
  ok(refused && !run("tmState.access") && run("switched.join()") === "tasks" && run("toasts.join()") === run("T.tmPresidentOnly"), "a save refused as not-a-president closes Teams and says why");
  run("handler=ordinary;toasts=[];switched=[]"); await run("tmCheckAccess()");

  // Loading shows in the page in grey; the red box is only for problems.
  run("tmRenderSpaces();var releaseTracker;handler=(a,d)=>a==='getTracker'?new Promise(resolve=>{releaseTracker=()=>resolve(ordinary(a,d));}):ordinary(a,d)");
  const opening = run("tmOpenTracker('TTfixture0001')");
  await tick();
  ok(element("tm-workspace").innerHTML.includes('class="tm-loading muted"') && element("tm-workspace").innerHTML.includes(run("T.tmLoading")) && element("tm-status").hidden && element("tm-status").textContent === "",
    "opening a tracker shows Loading in the page, not in the error box");
  run("releaseTracker()"); await opening;
  ok(element("tm-workspace").innerHTML.includes("tm-tracker-name") && !element("tm-workspace").innerHTML.includes("tm-loading"), "the tracker replaces the Loading line");
  ok(element("tm-workspace").innerHTML.includes('<summary aria-label="More">') && !element("tm-workspace").innerHTML.includes('<summary aria-label="Columns">'), "the three-dot menu is read out as More, not Columns");
  run("tmRenderSpaces();handler=(a,d)=>a==='getTracker'?{ok:false,error:'NOT_FOUND',message:'That tracker is no longer there.'}:ordinary(a,d)");
  await run("tmOpenTracker('TTgone000001')");
  ok(element("tm-workspace").innerHTML.includes("tm-tracker-card") && element("tm-status").textContent === "That tracker is no longer there." && run("tmState.access"), "a tracker that cannot open puts the cards back with the reason");
  run("handler=ordinary"); await run("tmOpenTracker('TTfixture0001')");

  // Empty views say whether nothing exists or the search hid everything.
  run("var lastCtx=null, realRender=tvRender; tvRender=function(el,view,ctx){lastCtx=ctx;return realRender(el,view,ctx);}");
  run("tmState.search='nothing-like-this';tmRenderView()");
  const viewChildren = element("tm-view").children;
  ok(run("lastCtx.rows.length") === 0 && run("lastCtx.emptyText") === run("T.tmNoMatches") && viewChildren[viewChildren.length - 1].textContent === "No records match.", "a search that hides every record says No records match");
  run("tmState.search='';tmRenderView()");
  ok(run("lastCtx.emptyText") === run("T.tmEmpty") && run("lastCtx.rows.length") === 1, "with no search the empty message stays No records yet");
  run("var keptRows=tmState.rows;tmState.rows=[];tmState.search='anything';tmRenderView()");
  ok(run("lastCtx.emptyText") === run("T.tmEmpty"), "a tracker with no records at all says No records yet even while searching");
  run("tmState.rows=keptRows;tmState.search='';tmRenderView()");

  // Changing a column's type asks first and never loses its choices.
  run("confirms=[];confirmAnswer=true;tmOpenColumns()");
  await run("tmColumnType({target:{dataset:{tmColumnType:'Fstatus'},value:'text'}})");
  ok(run("confirms.length") === 1 && run("confirms[0]") === run("T.tmTypeChangeConfirm('Status')") && run("tmState.columns.fields.find(f=>f.id==='Fstatus').type") === "text" &&
    run("tmState.columns.fields.find(f=>f.id==='Fstatus').options.length") === 2, "changing a saved column's type asks first and keeps its choices in the window");
  await run("tmColumnType({target:{dataset:{tmColumnType:'Fstatus'},value:'choice'}})");
  ok(run("confirms.length") === 1 && run("tmState.columns.fields.find(f=>f.id==='Fstatus').options.map(o=>o.id+':'+o.label).join()") === "Otodo:To contact,Odone:Confirmed", "Choice to Text and back to Choice gets the same choices back, without asking again");
  run("confirmAnswer=false;var typeSelect={dataset:{tmColumnType:'Fdate'},value:'text'}");
  await run("tmColumnType({target:typeSelect})");
  ok(run("typeSelect.value") === "date" && run("tmState.columns.fields.find(f=>f.id==='Fdate').type") === "date", "Cancel leaves the column type as it was");
  run("confirms=[];confirmAnswer=true;tmState.columns.fields.push({id:'Fnew00000001',name:'Extra',type:'text'})");
  await run("tmColumnType({target:{dataset:{tmColumnType:'Fnew00000001'},value:'choice'}})");
  ok(run("confirms.length") === 0 && run("tmState.columns.fields.find(f=>f.id==='Fnew00000001').type") === "choice", "a column that has not been saved yet changes type without a question");
  await run("tmColumnType({target:{dataset:{tmColumnType:'Fstatus'},value:'text'}})");
  run("tmState.columns.fields.find(f=>f.id==='Fstatus').options[0].label='';calls=[];handler=(a,d)=>a==='saveTracker'?{ok:false,error:'NETWORK',message:'Offline'}:ordinary(a,d)");
  await run("tmSaveColumns({preventDefault(){}})");
  const sentStatus = run("calls.find(c=>c.action==='saveTracker').details.tracker.fields.find(f=>f.id==='Fstatus')");
  ok(sentStatus.type === "text" && !("options" in sentStatus) && run("tmState.columns.fields.find(f=>f.id==='Fstatus').options.length") === 2 && element("tm-columns-error").textContent === "Offline",
    "a column saved as Text sends no choices (hidden blank choices don't block it), and a failed save keeps them in the window");
  run("handler=ordinary;tmState.columns=null;tmNode('tm-columns-dialog').close()");

  // Download CSV: a real link in the page, released after the download starts; names keep any language.
  ok(run("tmCsvName('春节 晚会: 2026/27')") === "春节-晚会-202627.csv" && run("tmCsvName('<<>>')") === "tracker.csv" && run("tmCsvName('Sponsors <spring>')") === "Sponsors-spring.csv", "CSV file names keep non-English letters and fall back to tracker.csv");
  run(`var revoked=[]; URL={createObjectURL(){return 'blob:tracker';},revokeObjectURL(url){revoked.push(url);}};
    document.body={children:[],appendChild(child){this.children.push(child);child.parentNode=this;return child;}};
    var baseCreate=document.createElement, made=[];
    document.createElement=function(tag){var n=baseCreate(tag);n.tag=tag;n.clicked=0;
      n.click=function(){this.clicked++;this.inBody=document.body.children.includes(this);};
      n.remove=function(){var i=document.body.children.indexOf(this);if(i>=0)document.body.children.splice(i,1);this.removed=true;};
      made.push(n);return n;};`);
  const menu = { open: true };
  element("tm-workspace").querySelector = (selector) => selector === "details.tm-menu" ? menu : null;
  timers.length = 0;
  element("tm-workspace").listeners.click({ target: { closest: () => ({ dataset: { tmAction: "csv" } }) } });
  await tick();
  const link = run("made.filter(n=>n.tag==='a').pop()");
  ok(!menu.open && link && link.clicked === 1 && link.inBody && link.removed && run("document.body.children.length") === 0 && link.download === "Sponsors-spring.csv",
    "Download CSV closes the menu and uses a link that is added to the page, clicked and removed");
  const revoke = timers.find((timer) => timer.ms === 2000);
  ok(run("revoked.length") === 0 && revoke, "the file stays available for 2 seconds so the download can start");
  if (revoke) revoke.fn();
  ok(run("revoked.join()") === "blob:tracker", "then the file is released");
  menu.open = true;
  run("confirms=[];confirmAnswer=false");
  element("tm-workspace").listeners.click({ target: { closest: () => ({ dataset: { tmAction: "remove-tracker" } }) } });
  await tick();
  ok(!menu.open && run("confirms[0]") === run("T.tmTrackerRemoveConfirm(tmState.tracker.name)") && run("tmState.tracker.id") === "TTfixture0001", "Remove tracker closes the menu before asking, and Cancel keeps the tracker");
  run("confirmAnswer=true");

  // Going back to the tracker list clears an old Undo.
  await run("tmOpenRecord('TRfixture0001')");
  await run("tmRemoveRecord()");
  const undoShown = !element("tm-undo").hidden;
  run("tmRenderSpaces()");
  ok(undoShown && run("tmState.removed") === null && element("tm-undo").hidden, "going back to the tracker list clears the old Undo");

  // Departments that left the list keep their trackers visible.
  run("handler=(a,d)=>{if(a==='teamSpaces'){const s=ordinary(a,d);s.trackers.push({id:'TTold0000001',department:'Old Dept',name:'Old list',rowCount:2});return s;}return ordinary(a,d);}");
  run("tmState.department='Old Dept'"); await run("tmCheckAccess()"); run("tmRenderSpaces()");
  ok(run("tmState.department") === "Old Dept" && element("tm-workspace").innerHTML.includes('data-tm-department="Old Dept"') && element("tm-workspace").innerHTML.includes("Old list") && !run("tmState.departments.includes('Old Dept')"),
    "a department that left the list keeps its chip while it still has trackers");
  run("tmOpenNew()");
  ok(element("tm-new-dept").value === "External", "New tracker starts in a current department when an old one is showing");
  element("tm-new-dialog").close();
  run("handler=ordinary;tmState.department='External'"); await run("tmCheckAccess()");

  // The table, board and calendar libraries load the first time Teams opens, once.
  const pageVendor = (fs.readFileSync(path.join(__dirname, "../exec-portal/index.html"), "utf8").match(/(src|href)="vendor\/[^"]+"/g) || []).join();
  ok(pageVendor === 'src="vendor/sortablejs/Sortable.min.js?v=1.15.7"', "the page itself loads only the small drag library, not the big Teams table and calendar libraries");
  run(`tmLibraries=null;tmLibrariesReady=false;
    var head={added:[],appendChild(el){this.added.push(el);el.parentNode=this;return el;},insertBefore(el,before){this.added.push(el);el.before=before;el.parentNode=this;return el;}};
    var teamsCss={parentNode:head}; document.head=head;
    document.querySelector=function(selector){return selector==='link[href^="teams"]'?teamsCss:null;};
    tmRenderSpaces();`);
  timers.length = 0;
  const firstOpen = run("openTeamsTab()");
  await tick();
  ok(element("tm-workspace").innerHTML.includes("tm-loading") && run("head.added.length") === 3, "the first Teams visit shows Loading while the three library files load (the drag library is already on the page)");
  ok(run("head.added[0].rel") === "stylesheet" && run("head.added[0].href") === "vendor/tabulator/tabulator.min.css?v=6.7.1" && run("head.added[0].before===teamsCss"), "the table stylesheet goes before the Teams styles so their dark colours still win");
  ok(run("head.added.slice(1).map(s=>s.src).join()") === "vendor/tabulator/tabulator.min.js?v=6.7.1,vendor/fullcalendar/index.global.min.js?v=6.1.22" && run("head.added.slice(1).every(s=>s.async===false)"),
    "the two library scripts are added with their version numbers");
  run("head.added[0].onload();head.added[1].onerror()"); await tick();
  ok(element("tm-workspace").innerHTML.includes("tm-loading"), "Teams waits until every library has answered");
  run("head.added[2].onerror()"); await firstOpen;
  ok(!element("tm-workspace").innerHTML.includes("tm-loading") && element("tm-workspace").innerHTML.includes('data-tm-action="new"'), "a library that fails still lets Teams open with its plain views");
  await run("openTeamsTab()");
  ok(run("head.added.length") === 3, "the libraries load only once");
  run("tmLibraries=null;tmLibrariesReady=false;head.added=[];tmRenderSpaces()");
  timers.length = 0;
  const stalled = run("openTeamsTab()");
  await tick();
  timers.filter((timer) => timer.ms === 20000).forEach((timer) => timer.fn());
  await stalled;
  ok(!element("tm-workspace").innerHTML.includes("tm-loading") && element("tm-workspace").innerHTML.includes('data-tm-action="new"'), "a library that never answers stops the wait after 20 seconds");
  run("document.head=undefined");

  // Make a task and Add to Google Calendar from a saved record.
  // newTaskFrom and googleCalendarUrl come from tasks.js (the Tasks builder); simple stand-ins are used here.
  run(`var taskTracker={id:'TTtask000001',name:'Event plan',department:'Events',fields:[
      {id:'Fevent',name:'Event',type:'text'},{id:'Fdate',name:'Booked',type:'date'},{id:'Fwhen',name:'Event day',type:'date'},
      {id:'Fowner',name:'Lead',type:'person'},{id:'Fhelp',name:'Helper',type:'person'},{id:'Fextra',name:'Backup',type:'person'}],
      views:{default:'table',boardField:'',dateField:'Fwhen'}};
    var taskRows=[{id:'TRtask000001',values:{Fevent:'Spring Gala',Fdate:'2027-01-05',Fwhen:'2027-02-14',Fowner:'Kevin',Fhelp:'Marcus',Fextra:'Kevin'},sort:1},
      {id:'TRtask000002',values:{Fevent:'',Fdate:'',Fwhen:'',Fowner:'',Fhelp:'',Fextra:''},sort:2}];
    handler=(a,d)=>a==='getTracker'&&d.id===taskTracker.id?{ok:true,tracker:JSON.parse(JSON.stringify(taskTracker)),rows:JSON.parse(JSON.stringify(taskRows))}:ordinary(a,d);`);
  await run("tmOpenTracker('TTtask000001')");
  const fillRecord = (values) => values.forEach((value, index) => { element("tm-value-" + index).value = value; });
  const gala = ["Spring Gala", "2027-01-05", "2027-02-14", "Kevin", "Marcus", "Kevin"];
  fillRecord(gala);
  await run("tmOpenRecord('TRtask000001')");
  ok(element("tm-record-task").hidden && element("tm-record-calendar").hidden && element("tm-record-links").hidden, "without the Tasks helpers, the record window shows neither Make a task nor Add to Google Calendar");
  await run("tmCloseRecord()");
  run(`var presets=[]; function newTaskFrom(preset){presets.push(JSON.parse(JSON.stringify(preset)));}
    function googleCalendarUrl(title,date,details){return /^\\d{4}-\\d{2}-\\d{2}$/.test(String(date))?'https://calendar.google.com/calendar/render?action=TEMPLATE&text='+encodeURIComponent(title)+'&dates='+String(date).replace(/-/g,'')+'&details='+encodeURIComponent(details):'';}`);
  await run("tmOpenRecord('TRtask000001')");
  const href = element("tm-record-calendar").href;
  ok(!element("tm-record-task").hidden && !element("tm-record-links").hidden, "a saved record offers Make a task");
  ok(!element("tm-record-calendar").hidden && href.includes("text=Spring%20Gala") && href.includes("dates=20270214") && href.includes("details=Event%20plan"), "Add to Google Calendar uses the record's title, the Calendar's date column and the tracker name");
  element("tm-value-2").value = "2027-03-01"; run("tmUpdateCalendarLink()");
  ok(element("tm-record-calendar").href.includes("dates=20270301"), "changing the date in the window updates the calendar link");
  run("confirms=[];confirmAnswer=false"); await run("tmMakeTask()");
  ok(run("presets.length") === 0 && element("tm-record-dialog").open && run("confirms[0]") === run("T.tmDiscard"), "Make a task asks before throwing away unsaved changes, and Cancel keeps the window");
  run("confirmAnswer=true"); await run("tmMakeTask()");
  ok(!element("tm-record-dialog").open && run("tmState.record") === null && run("JSON.stringify(presets[0])") === JSON.stringify({ title: "Spring Gala", due: "2027-02-14", owners: ["Kevin", "Marcus"], department: "Events", notes: "Event plan" }),
    "Make a task closes the record and hands Tasks the title, Calendar date, every person, the department and the tracker name");
  fillRecord(gala);
  run("confirms=[];presets=[]"); await run("tmOpenRecord('TRtask000001')"); await run("tmMakeTask()");
  ok(run("confirms.length") === 0 && run("presets.length") === 1 && !element("tm-record-dialog").open, "with nothing changed, Make a task goes straight to Tasks");
  fillRecord(["", "", "", "", "", ""]);
  await run("tmOpenRecord('TRtask000002')");
  ok(element("tm-record-calendar").hidden && !element("tm-record-task").hidden && !element("tm-record-links").hidden, "a record with no date has no calendar link");
  await run("tmMakeTask()");
  ok(run("JSON.stringify(presets[1])") === JSON.stringify({ title: "", due: "", owners: [], department: "Events", notes: "Event plan" }), "an empty record still makes a task with the department and tracker name");
  run("tmState.tracker.views.dateField=''");
  fillRecord(gala);
  await run("tmOpenRecord('TRtask000001')");
  ok(element("tm-record-calendar").href.includes("dates=20270105"), "without a chosen Calendar column, the first Date column is used");
  run("var realCalendarUrl=googleCalendarUrl;googleCalendarUrl=()=>''");
  run("tmUpdateCalendarLink()");
  ok(element("tm-record-calendar").hidden && !element("tm-record-links").hidden, "a date the calendar helper can't use hides only the calendar link");
  run("googleCalendarUrl=realCalendarUrl"); await run("tmCloseRecord()");
  fillRecord(["", "", "2027-04-01", "", "", ""]);
  await run("tmOpenRecord(null,{Fwhen:'2027-04-01'})");
  ok(element("tm-record-task").hidden && element("tm-record-calendar").hidden && element("tm-record-links").hidden, "a record that has not been saved yet offers neither");
  await run("tmCloseRecord()");
  const recordHtml = fs.readFileSync(path.join(__dirname, "../exec-portal/index.html"), "utf8").match(/<a id="tm-record-calendar"[^>]*>/);
  ok(recordHtml && recordHtml[0].includes('target="_blank"') && recordHtml[0].includes('rel="noopener noreferrer"'), "the calendar link opens in a new tab without sharing this page");
  run("handler=ordinary"); await run("tmOpenTracker('TTfixture0001')");

  run("var late;handler=()=>new Promise(resolve=>late=resolve);var accessPending=tmCheckAccess()");
  await tick();run("tmHide();state.token='someone-else';late(spaces)"); await run("accessPending");
  ok(!run("tmState.access") && element("teams-tab-button").hidden, "an old access reply cannot reopen Teams after sign-out or a different sign-in");

  // Make a task waits for the Tasks tab: the email counter's switchTab wrapper (emailstatus.js) must hand back the real switch.
  const mailSrc = fs.readFileSync(path.join(__dirname, "../exec-portal/emailstatus.js"), "utf8");
  const wrapStart = mailSrc.indexOf('if (typeof switchTab === "function") {');
  const wrapper = mailSrc.slice(wrapStart, mailSrc.indexOf("\n}", wrapStart) + 2);
  const tabs = vm.createContext({ Promise, setTimeout, refreshed: 0, active: "" });
  vm.runInContext("var refreshMailStatus=function(){refreshed++;}; var switchTab=async function(name){await new Promise(r=>setTimeout(r,5)); active=name;};", tabs);
  vm.runInContext(wrapper, tabs);
  await vm.runInContext("switchTab('tasks')", tabs);
  ok(vm.runInContext("active", tabs) === "tasks" && vm.runInContext("refreshed", tabs) === 1,
    "waiting for a tab switch really waits until the new tab is showing (so Make a task can open New task)");
  console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED"); process.exitCode = failed ? 1 : 0;
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

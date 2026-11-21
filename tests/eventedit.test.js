// Event drafts, publishing, ticket identity, navigation protection and preview. No real Google services or network.
const fs = require("fs"), vm = require("vm"), path = require("path");
const { run } = require("./harness.js");
let fails = 0;
const ok = (value, message) => { console.log((value ? "PASS " : "FAIL ") + message); if (!value) fails++; };
const attempt = (code) => { try { return run(code); } catch (e) { return { error: e.code, message: e.message }; } };
run(`
function withLock_(fn) { return fn(); }
function withIntakeLock_(fn) { return fn(); }
function withIntakeAndScriptLock_(fn) { return fn(); }
function table_() {}
function insertRows_(name, rows) { rows.forEach(function (r) { insertRow_(name, r); }); }
function throttle_() {}
function sendRegistrationEmail_() { return true; }
function sendPendingTicketEmails_() { return { sent:0, waiting:0 }; }
function emailsAfterSave_() { return { sent:0, waiting:0 }; }
var SESSION = { name:"TEST Exec", role:"exec" };
var original = { name:"TEST Public night", date:"2099-06-12", description:"Public summary", location:"Public room", capacity:20,
  ticketTypes:[{id:"A",name:"With drink",price:8},{id:"B",name:"No drink",price:5}],
  questions:[{id:"Q",label:"Drink",type:"choice",options:["Tea","Coffee"],required:true,forTickets:["A"]}] };
var created = saveEvent_(SESSION, original).event;
var eventId = created.id;
setEventStatus_(SESSION, eventId, "published");
var live = findEvent_(function (e) { return e.id === eventId; });
var publicBefore = JSON.stringify(publicEvent_(live.slug));
var draft = Object.assign({}, live, { name:"TEST Secret draft", description:"Private unfinished description", date:"", saveDraft:true,
  ticketTypes:[live.ticketTypes[1], live.ticketTypes[0]], mailTickets:false, capacity:1 });
var saved = saveEvent_(SESSION, draft).event;
`);
ok(run(`JSON.stringify(publicEvent_(live.slug)) === publicBefore`), "saving an incomplete published-event draft leaves every public field unchanged");
ok(run(`!JSON.stringify(publicEvents_()).includes("Secret draft") && !JSON.stringify(publicEvents_()).includes("unfinished")`), "public list never includes draft contents");
ok(run(`saved.status === "published" && saved.editDraft.name === draft.name && saved.editDraft.date === ""`), "exec can reopen the saved incomplete draft and the event stays published");
ok(run(`saved.capacity === 20 && saved.mailTickets === true`), "draft capacity and email changes do not affect live operations");
ok(attempt(`saveEvent_(SESSION, Object.assign({}, draft, {saveDraft:false,publish:true}))`).error === "BAD_REQUEST", "publishing an incomplete draft is refused");
ok(run(`JSON.stringify(publicEvent_(live.slug)) === publicBefore && !!findEvent_(e => e.id === eventId).editDraft`), "failed publication preserves both live version and saved draft");

run(`
var beforeReg = register_({slug:live.slug,people:[{name:"TEST Before",email:"before@example.com",ucid:"30123456",ticketTypeId:"A",answers:{Q:"Tea"}}]});
var bookedBefore = JSON.stringify(TBL.Tickets);
var ordersBefore = JSON.stringify(TBL.Orders);
var published = saveEvent_(SESSION, Object.assign({}, draft, {date:original.date,capacity:20,saveDraft:false,publish:true})).event;
`);
ok(run(`published.status === "published" && !published.editDraft && !published.summary.editDraft && published.slug === live.slug`), "publish changes clears the saved draft and preserves the public link");
ok(run(`publicEvent_(live.slug).event.name === "TEST Secret draft"`), "public sees edits only after Publish changes");
ok(run(`publicEvent_(live.slug).event.ticketTypes.map(t => t.id).join() === "B,A"`), "public ticket order is exactly the saved order");
ok(run(`JSON.stringify(TBL.Tickets) === bookedBefore && JSON.stringify(TBL.Orders) === ordersBefore`), "reordering leaves all existing tickets, prices, answers and orders untouched");
ok(run(`published.ticketTypes.find(t => t.name === TBL.Tickets[0].ticketType).id === "A" && TBL.Tickets[0].price === 8`), "an existing registered ticket still matches the same type after reorder");
ok(run(`published.questions[0].forTickets.join() === "A" && questionApplies_(published.questions[0], "A") && !questionApplies_(published.questions[0], "B")`), "Only for these tickets question links still point to the same ID");
run(`var afterReg = register_({slug:live.slug,people:[{name:"TEST After",email:"after@example.com",ucid:"30123457",ticketTypeId:"A",answers:{Q:"Coffee"}}]});`);
ok(run(`TBL.Tickets[1].ticketType === TBL.Tickets[0].ticketType && TBL.Tickets[1].price === TBL.Tickets[0].price && TBL.Tickets[1].answers.Drink === "Coffee"`), "new registration by the same ID still gets the same ticket and price after reorder");
ok(attempt(`cleanEventInput_(Object.assign({}, original, {ticketTypes:[original.ticketTypes[0],original.ticketTypes[0]]}))`).error === "BAD_REQUEST", "duplicate ticket IDs are refused");
run(`var incomplete = saveEvent_(SESSION, {name:"TEST Unfinished",saveDraft:true,ticketTypes:[]}).event;`);
ok(run(`incomplete.status === "draft"`), "new unfinished events can still be saved as drafts");
ok(attempt(`saveEvent_(SESSION, {name:"",saveDraft:true,publish:true,ticketTypes:[]})`).error === "BAD_REQUEST", "conflicting flags cannot publish an incomplete draft");
ok(attempt(`setEventStatus_(SESSION, incomplete.id, "published")`).error === "BAD_REQUEST", "list Publish cannot bypass validation of an incomplete draft");
run(`var direct = saveEvent_(SESSION, Object.assign({}, original, {publish:true})).event;`);
ok(run(`direct.status === "published" && publicEvent_(direct.slug).event.name === original.name`), "new Save & publish creates a published event in one operation");
run(`setEventStatus_(SESSION, eventId, "closed"); saveEvent_(SESSION, Object.assign({}, published, {name:"TEST Closed draft",saveDraft:true}));`);
ok(run(`findEvent_(e => e.id === eventId).status === "closed" && publicEvent_(live.slug).event.name === published.name`), "saving a closed-event draft does not reopen registration or replace live details");

// Small fake DOM for the real editor functions. Browser checks exercise the full DOM separately.
const elements = {}, listeners = {};
const el = (id) => elements[id] ||= { value:"", checked:false, hidden:false, textContent:"", innerHTML:"", disabled:false,
  querySelectorAll:() => [], focus() {}, classList:{toggle(){},remove(){}} };
const editor = { console, URL, URLSearchParams, Uint8Array, crypto:require("crypto").webcrypto,
  document:{ querySelectorAll:() => [], body:{classList:{remove(){}}} }, $:el,
  window:{ addEventListener:(name, fn) => { listeners[name] = fn; }, scrollTo() {} },
  updateEditorStep() {}, SCANNER_MODE:false, sessionStorage:{setItem(){}}, doorState:{},
  openOverview(){}, openMembersTab(){}, openPaymentsTab(){}, openDoorTab(){}, openSettingsTab(){}, openActivityTab(){},
  errorText:() => "TEST error", setTimeout:() => 1, clearTimeout(){} };
editor.escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
vm.createContext(editor);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../exec-portal/strings.js"), "utf8"), editor);
const editorSource = fs.readFileSync(path.join(__dirname, "../exec-portal/events.js"), "utf8");
vm.runInContext(editorSource.split("// ---- Wire up")[0], editor);
const erun = (code) => vm.runInContext(code, editor);
editor.event = JSON.parse(JSON.stringify(run("saved")));
erun(`openEditor(event);`);
ok(el("ev-name").value === "TEST Secret draft" && el("ev-date").value === "", "editor loads the saved draft rather than public fields");
ok(!erun("eventEditorDirty()"), "opening a draft starts with no unsaved changes");
el("ev-location").value = "Unsaved room";
ok(erun("eventEditorDirty()"), "typing in an ordinary field is tracked");
let warning = { preventDefault() { this.prevented = true; } };
listeners.beforeunload(warning);
ok(warning.prevented && warning.returnValue === "", "closing or refreshing a dirty browser tab requests its native warning");
erun(`var asks = 0; askConfirm = async () => { asks++; return false; };`);

(async () => {
  await erun("showEventsList()");
  ok(!el("event-editor-view").hidden && erun("asks") === 1, "Back to events can be cancelled without losing edits");
  await erun(`switchTab("members")`);
  ok(!el("event-editor-view").hidden && erun("asks") === 2, "switching dashboard tabs can be cancelled");
  erun(`eventsState.savedEditor = JSON.stringify(readEventEditor()); moveTicketType(0, 1);`);
  ok(erun(`eventsState.editing.ticketTypes.map(t => t.id).join() === "A,B" && eventsState.editing.questions[0].forTickets.join() === "A" && eventEditorDirty()`), "move buttons reorder objects, preserve IDs and question links, and mark the editor dirty");
  let sent;
  editor.api = async (action, payload) => { sent = {action, payload}; return {ok:false,error:"NETWORK"}; };
  await erun("saveEvent(false)");
  ok(sent.action === "saveEvent" && sent.payload.event.saveDraft === true && !sent.payload.event.publish, "Save draft explicitly requests a separate draft");
  ok(erun("eventEditorDirty() && !eventsState.saving") && !el("editor-error").hidden, "failed save keeps edits dirty and available to retry");
  erun(`askConfirm = async () => true;`);
  await erun("saveEvent(true)");
  ok(sent.payload.event.publish && !sent.payload.event.saveDraft, "Publish changes uses one validated save request");
  await erun("showEventsList()");
  warning = {preventDefault(){this.prevented=true;}};
  listeners.beforeunload(warning);
  ok(el("event-editor-view").hidden && !warning.prevented, "confirmed discard leaves and removes the unload warning");
  erun(`openEditor(event); eventsState.uploading = true;`);
  ok(!(await erun("leaveEventEditor()")), "navigation waits for an image upload to finish");
  erun(`eventsState.uploading = false; var duplicate = copyOfEvent(event);`);
  ok(erun(`!duplicate.id && !duplicate.editDraft && !duplicate.summary && duplicate.ticketTypes.every(t => !event.ticketTypes.some(old => old.id === t.id))`), "Duplicate gets fresh ticket IDs and never copies a hidden draft");

  const page = {innerHTML:""};
  let requests = 0;
  const pub = {console,URLSearchParams, location:{hash:"#preview=TEST"}, document:{querySelectorAll:() => [],getElementById:(id) => id === "page" ? page : null},
    fetch:() => {requests++; throw new Error("No network allowed");} };
  vm.createContext(pub);
  vm.runInContext(fs.readFileSync(path.join(__dirname,"../public/strings.js"),"utf8"),pub);
  vm.runInContext(fs.readFileSync(path.join(__dirname,"../public/public.js"),"utf8").replace(/\bstart\(\);\s*$/,""),pub);
  pub.event = JSON.parse(JSON.stringify(run("publicEvent_(live.slug).event")));
  vm.runInContext("renderEvent(event)",pub);
  ok(page.innerHTML.indexOf('class="description"') < page.innerHTML.indexOf('class="tickets"'), "public summary appears before tickets");
  ok(page.innerHTML.indexOf("No drink") < page.innerHTML.indexOf("With drink"), "public detail preserves the editor's saved ticket order");
  ok(vm.runInContext("personFields(event, 0)",pub).indexOf('value="B"') < vm.runInContext("personFields(event, 0)",pub).indexOf('value="A"'), "registration form keeps that same order");
  pub.event.previewLabel = "TEST Preview";
  vm.runInContext("renderEvent(event)",pub);
  ok(page.innerHTML.includes("TEST Preview") && page.innerHTML.includes('class="register" disabled') && !page.innerHTML.includes('id="open-register"'), "preview is clearly marked and registration is disabled");
  await vm.runInContext(`api("register", {})`,pub);
  ok(requests === 0, "preview mode refuses API calls, including registration");
  console.log(fails ? `${fails} FAILED` : "ALL PASSED");
  process.exitCode = fails ? 1 : 0;
})().catch((error) => { console.error(error); process.exitCode = 1; });

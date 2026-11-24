// Browser audit regressions: no real server, camera, email or attendee data.
const fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
let failures = 0;
const ok = (condition, message) => { console.log((condition ? "PASS " : "FAIL ") + message); if (!condition) failures++; };
const store = () => { const data = new Map(); return { getItem: (key) => data.get(key) || null, setItem: (key, value) => data.set(key, value), removeItem: (key) => data.delete(key) }; };
function page(extra = {}) {
  const elements = {};
  const el = (id) => elements[id] ||= { value: "", textContent: "", innerHTML: "", hidden: false, attributes: {},
    setAttribute(key, value) { this.attributes[key] = value; }, removeAttribute(key) { delete this.attributes[key]; }, focus() {}, addEventListener() {} };
  const context = vm.createContext({ console, URL, URLSearchParams, AbortController, setTimeout, clearTimeout, clearInterval,
    location: { search: "", hash: "", hostname: "events.ucalgarycss.ca" }, localStorage: store(), sessionStorage: store(),
    document: { getElementById: el, querySelectorAll: () => [], querySelector: () => null, addEventListener() {}, readyState: "complete" },
    window: { matchMedia: () => ({ matches: false }) }, ...extra });
  return { context, el, run: (code) => vm.runInContext(code, context) };
}
async function main() {
  for (const file of ["public/public.js", "public/ticket.js", "public/tickets.js"]) {
    const timers = [], cleared = [], requests = [];
    const p = page({ API_URL: "https://test.invalid", setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout(id) { cleared.push(id); },
      fetch: async (url, request) => { requests.push(request); return { json: async () => ({ ok: true }) }; } });
    // Load the actual API helper without starting the page.
    const source = read(file), end = source.indexOf("\nfunction applySite");
    p.run(source.slice(0, end));
    const reply = await p.run("api('readTest')");
    ok(reply.ok && requests.length === 1 && requests[0].signal instanceof AbortSignal, file + ": works when AbortSignal.timeout is unavailable");
    ok(cleared.length === 1, file + ": successful requests clear their timeout");
    p.context.fetch = (_url, request) => new Promise((_resolve, reject) => request.signal.addEventListener("abort", () => reject(new Error("TEST timeout"))));
    const pending = p.run("api('slowTest')");
    timers[1]();
    ok((await pending).error === "NETWORK" && cleared.length === 2, file + ": a timed-out request ends with the existing connection error");
  }

  const handlers = {}, editor = { postMessage() {} };
  const preview = page({ CONTACT_EMAIL: "club@example.com", INSTAGRAM_URL: "", setTimeout: () => 1, clearTimeout() {},
    location: { hash: "#preview=TEST-preview", hostname: "events.ucalgarycss.ca" },
    window: { opener: editor, addEventListener(name, fn) { handlers[name] = fn; }, removeEventListener() {} } });
  preview.run(read("public/strings.js"));
  preview.run(read("public/public.js").replace(/\bstart\(\);\s*$/, ""));
  preview.run("var rendered=null; renderEvent=(event)=>{rendered=event;}; start();");
  const message = { source: editor, origin: "https://attacker.example", data: { previewKey: "TEST-preview", event: { name: "TEST Preview" } } };
  handlers.message(message);
  ok(preview.run("rendered===null"), "an untrusted opener cannot display a spoofed event preview");
  handlers.message({ ...message, origin: "https://exec.ucalgarycss.ca", data: { ...message.data, previewKey: "wrong" } });
  ok(preview.run("rendered===null"), "the trusted preview still requires the matching one-use key");
  handlers.message({ ...message, origin: "https://exec.ucalgarycss.ca" });
  ok(preview.run("rendered.name==='TEST Preview'"), "the club's event editor can still preview its draft");
  ok(!preview.run("trustedPreviewOrigin('http://localhost:8766')"), "the live site does not accept a random local editor");
  preview.run("location.hostname='localhost'");
  ok(preview.run("trustedPreviewOrigin('http://127.0.0.1:8766')"), "local development can preview from another local port");

  const portal = page();
  portal.run(read("exec-portal/strings.js"));
  portal.run(read("exec-portal/app.js"));
  portal.run("var refreshed=0; apiRequest=async()=>({ok:true}); pandaBusy=()=>{}; function refreshMailStatus(){refreshed++;}");
  const mailActions = ["markOrderPaid", "markOrdersPaid", "sendPendingEmails", "resendTickets", "addOrder", "sendReminders", "updateTicket", "offerWaitlistSpot", "emailAttendees", "applyTransfer", "markMemberPaid", "resendMemberPass", "addMember", "updateMember"];
  for (const action of mailActions) await portal.run(`api(${JSON.stringify(action)})`);
  ok(portal.run("refreshed") === mailActions.length, "every actual email-producing action refreshes the quota indicator");
  portal.run("apiRequest=async()=>({ok:false,error:'TEST'});");
  await portal.run("api('updateTicket')");
  ok(portal.run("refreshed") === mailActions.length, "a rejected action does not claim to have used email quota");
  portal.run("var stopped=0; function stopCamera(){stopped++;} state.token='TEST'; signOutLocally();");
  ok(portal.run("stopped===1 && state.token===''"), "local sign-out stops the camera for both logout and expired sessions");

  const scanner = page({ location: { search: "?mode=scanner" } });
  scanner.run(read("exec-portal/app.js"));
  scanner.run("showSearch=()=>{}; switchTab=()=>{}; state.name='TEST'; state.role='door'; showApp();");
  ok(scanner.el("full-portal-link").hidden, "door-only sessions cannot use Full portal");
  scanner.run("state.role='exec'; showApp();");
  ok(!scanner.el("full-portal-link").hidden, "an exec signing in after a volunteer regains the Full portal link");

  const camera = page();
  camera.run(read("exec-portal/strings.js"));
  camera.run(read("exec-portal/app.js"));
  camera.run("var doorState={scanner:null,cameraGeneration:0}, finishedStart, cameraStops=0; state.token='TEST'; function showIdle(){} function showResult(){} function onCode(){}; class Html5Qrcode { start(){return new Promise(resolve=>{finishedStart=resolve;});} async stop(){cameraStops++;} }");
  const doorCode = read("exec-portal/door.js");
  camera.run(doorCode.slice(doorCode.indexOf("async function toggleCamera()"), doorCode.indexOf("const PAUSE_AFTER_RESULT_MS")));
  const starting = camera.run("toggleCamera()");
  camera.run("signOutLocally(); finishedStart();");
  await starting;
  ok(camera.run("cameraStops===2 && doorState.scanner===null") && camera.el("camera").hidden, "a camera that finishes starting after sign-out is stopped again");

  const nav = page();
  nav.context.$ = nav.el;
  nav.run(read("exec-portal/overview.js").split('document.addEventListener("click"')[0]);
  nav.run("var globalEventId='', payState={}, doorState={}, switched=''; function switchTab(tab){switched=tab;}");
  nav.el("global-event").options = [];
  nav.run("goToTab('door','TEST-CLICKED')");
  ok(nav.run("doorState.eventId==='TEST-CLICKED' && doorState.picked && switched==='door'"), "Open in Door preserves the event that was clicked");

  const practice = page();
  practice.context.$ = practice.el;
  practice.context.escapeHtml = portal.run("escapeHtml");
  practice.run(read("exec-portal/strings.js"));
  practice.run("var eventsState={loaded:true}, reloads=0, sheets=0, signedOut=0, loginMessage='', apiReply={ok:false,error:'NETWORK'}; function api(action){ return Promise.resolve(action==='practiceSheet'?{ok:true,exists:false}:apiReply); } function loadEvents(){reloads++;} function askConfirm(){return Promise.resolve(true);} function errorText(r){return r.error;} function showToast(){} function signOutLocally(){signedOut++;} function showLogin(message){loginMessage=message;}");
  practice.run(read("exec-portal/practice.js"));
  practice.run("var actualShowSheet=showPracticeSheet; showPracticeSheet=()=>{sheets++;};");
  await practice.run("openPractice()");
  ok(practice.run("reloads===0 && sheets===0 && !practiceState.busy"), "a rejected Practice creation does not refresh Events or open a fake sheet");
  practice.run("apiReply={ok:true,exists:true,cards:[]};");
  await practice.run("openPractice()");
  ok(practice.run("reloads===1 && sheets===1 && !eventsState.loaded"), "successful Practice creation refreshes Events and opens its sheet");
  practice.el("practice-dialog").close = () => { practice.el("practice-dialog").hidden = true; };
  practice.run("apiReply={ok:false,error:'NOT_LOGGED_IN'};");
  await practice.run("removePracticeEvent()");
  ok(practice.run("signedOut===1 && loginMessage==='NOT_LOGGED_IN'") && practice.el("practice-dialog").hidden, "an expired session while removing Practice closes the sheet and returns to sign-in");
  practice.run("var fakeDialog={open:false,scrollTop:80,showModal(){this.open=true;}}; practiceDialog=()=>fakeDialog; actualShowSheet({archived:true,cards:[{name:'TEST',expect:'RED',qr:'data:image/png;base64,TEST'}]});");
  ok(practice.el("practice-print").disabled && !practice.el("practice-error").hidden && !practice.el("practice-remove").disabled,
    "an archived practice sheet offers removal and does not print unusable tickets");
  ok(practice.run("fakeDialog.open && fakeDialog.scrollTop===0"), "the Practice dialog opens at its heading instead of jumping to its bottom buttons");

  const entryUi = page();
  entryUi.context.$ = entryUi.el;
  entryUi.run(read("exec-portal/strings.js"));
  entryUi.run(`var SCANNER_MODE=false, doorCalls=[], toasted='', renderedEvents=0, renderedDoor=0,
    doorState={eventId:'EV2',data:{event:{id:'EV2',entryOpen:false}}},
    eventsState={events:[{id:'EV1',name:'First Event',entryOpen:true},{id:'EV2',name:'Second Event',entryOpen:false}]};
    async function api(action,details){doorCalls.push({action,details});return {ok:true,entryOpen:true,closedEvents:[{id:'EV1',name:'First Event'}]};}
    function showToast(text){toasted=text;} function renderEvents(){renderedEvents++;} function renderDoor(){renderedDoor++;} function showResult(){} function errorText(r){return r.error;}`);
  entryUi.run(doorCode.slice(doorCode.indexOf("async function toggleEntry()"), doorCode.indexOf("// ---- View all check-ins")));
  await entryUi.run("toggleEntry()");
  ok(entryUi.run("doorCalls.length===1 && doorCalls[0].action==='setEntryOpen' && !eventsState.events[0].entryOpen && eventsState.events[1].entryOpen && toasted.includes('First Event')"),
    "opening entry uses one atomic setEntryOpen call and updates closed events from the reply");

  console.log(failures ? `${failures} FAILED` : "ALL PASSED");
  process.exitCode = failures ? 1 : 0;
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

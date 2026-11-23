// Organizer important notes and attendee comments in the actual page/editor code. No network or real records.
const fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
let fails = 0;
const ok = (value, message) => { console.log((value ? "PASS " : "FAIL ") + message); if (!value) fails++; };
const source = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
function element() { return { value: "", innerHTML: "", textContent: "", disabled: false, hidden: false, childNodes: [], classList: { toggle() {}, remove() {} }, addEventListener() {}, focus() {}, querySelectorAll: () => [], querySelector: () => null,
  replaceChildren(...nodes) { this.childNodes = nodes; } }; }

async function main() {
  const els = {};
  const el = (id) => els[id] ||= element();
  let people = [];
  const page = {
    console, URL, URLSearchParams, AbortSignal,
    document: { getElementById: el, querySelectorAll: (selector) => selector === "#register-form .person" ? people : [] },
    window: { scrollTo() {}, crypto: require("node:crypto").webcrypto }, crypto: require("node:crypto").webcrypto,
    location: { href: "https://example.com/?e=test", search: "?e=test", hash: "" }, setTimeout, clearTimeout
  };
  vm.createContext(page);
  vm.runInContext(source("public/strings.js"), page);
  vm.runInContext(source("public/public.js").replace(/\bstart\(\);\s*$/, ""), page);
  const run = (code) => vm.runInContext(code, page);
  page.testEvent = { id: "EV", slug: "test", name: "TEST Note Night", date: "2099-01-01", location: "Room", startTime: "18:00", endTime: "20:00", imageUrl: "https://example.com/cover.jpg", description: "Summary", announcement: "Bring a jacket.\nUse the west entrance.", registrationOpen: true, spotsLeft: null, ticketTypes: [{ id: "G", name: "General", price: 5 }], questions: [] };
  ok(run("eventAnnouncement({})") === "" && run("eventAnnouncement({announcement:'  '})") === "", "events without an important note show no empty announcement card");
  const unsafe = run("eventAnnouncement({announcement:'<img src=x onerror=alert(1)>\\nSecond line & details'})");
  ok(unsafe.includes("💡 Important Note") && unsafe.includes("&lt;img") && !unsafe.includes("<img") && unsafe.includes("<br>Second line &amp; details"), "important note has the requested heading and safely preserves plain-text line breaks");
  run("renderEvent(testEvent)");
  ok(el("page").innerHTML.indexOf('class="important-note"') < el("page").innerHTML.indexOf('class="hero"'), "the organizer's important note appears above the event image");
  run("updateMemberFields = function() {}; updateQuestions = function() {}; updateTotal = function() {}; showRegisterForm(testEvent)");
  ok(el("page").innerHTML.includes("Bring a jacket.<br>Use the west entrance.") && el("page").innerHTML.indexOf('class="important-note"') < el("page").innerHTML.indexOf('<form'), "the same important note remains visible before the signup form");
  const selfFields = run("personFields(testEvent, 0)");
  const friendFields = run("personFields(testEvent, 1)");
  ok(selfFields.includes('id="p0-note" data-f="note" maxlength="1000"') && friendFields.includes('id="p1-note" data-f="note" maxlength="1000"'), "each attendee and friend gets a separate note/comment box");
  ok(selfFields.includes("Note/comment (optional)") && !/<textarea[^>]*required/.test(selfFields), "the attendee comment is optional");
  run("showWaitlistForm(testEvent)");
  ok(el("page").innerHTML.includes('data-f="note"') && el("page").innerHTML.includes("💡 Important Note"), "waitlist signup includes both the organizer note and the attendee comment");

  const note = { dataset: { f: "note" }, value: "  My friend is arriving later.\nPlease keep our seats together.  " };
  const fields = [
    { dataset: { f: "name" }, value: "Test Attendee" }, { dataset: { f: "email" }, value: "attendee@example.com" },
    { dataset: { f: "ucid" }, value: "30123456" }, { dataset: { f: "memberId" }, value: "" },
    { dataset: { f: "ticketTypeId" }, type: "radio", value: "G", checked: true }, note
  ];
  people = [{ querySelectorAll: (selector) => selector === "[data-f]" ? fields : [] }];
  run("currentEvent = testEvent");
  const expected = note.value.trim();
  ok(run("readPeople()[0].note") === expected, "reading attendee details includes their complete multiline comment");
  page.requests = [];
  run("api = async function(action, details) { requests.push({action, details}); return {ok:false,error:'BAD_REQUEST',message:'TEST stop'}; }");
  await run("onSubmit({preventDefault(){}})");
  ok(page.requests.length === 1 && page.requests[0].details.people[0].note === expected, "the registration request sends the comment under the correct attendee");

  el("page").childNodes = [note];
  run("showEvent = function() { document.getElementById('page').childNodes = []; }; backToEvent(testEvent)");
  run("testEvent.announcement = 'Updated entrance: north door.'; showRegisterForm(testEvent)");
  ok(el("page").childNodes[0] === note && run("readPeople()[0].note") === expected, "Back to event and returning to signup preserve the comment in the same form field");
  ok(el("registration-announcement").innerHTML.includes("Updated entrance: north door."), "restoring a signup draft also refreshes the organizer's latest important note");

  const editorEls = {}, listeners = {};
  const editorEl = (id) => editorEls[id] ||= element();
  const previewWindow = { postMessage(data) { editor.previewMessage = data; } };
  const editor = {
    console, URL, URLSearchParams, Uint8Array, crypto: require("node:crypto").webcrypto, $: editorEl,
    document: { querySelectorAll: () => [], body: { classList: { remove() {} } } },
    window: { scrollTo() {}, addEventListener: (name, fn) => { listeners[name] = fn; }, removeEventListener() {}, open(url) { editor.previewUrl = url; return previewWindow; } },
    location: { href: "https://exec.example.com/" }, PUBLIC_SITE_URL: "https://events.example.com/", updateEditorStep() {}, setTimeout: () => 1, clearTimeout() {},
    escapeHtml: (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]))
  };
  vm.createContext(editor);
  vm.runInContext(source("exec-portal/strings.js"), editor);
  vm.runInContext(source("exec-portal/events.js").split("// ---- Wire up")[0], editor);
  const erun = (code) => vm.runInContext(code, editor);
  editor.testEvent = { ...page.testEvent, announcement: "Bring ID.\nUse west entrance." };
  erun("openEditor(testEvent)");
  ok(editorEl("ev-announcement").value === editor.testEvent.announcement, "the event editor loads the existing organizer note");
  editorEl("ev-announcement").value = "New arrival instructions.\nBring a jacket.";
  ok(erun("readEventEditor().announcement") === editorEl("ev-announcement").value && erun("eventEditorDirty()"), "editing the organizer note is included in the save and marks the draft unsaved");
  erun("previewEvent()");
  const previewKey = new URL(editor.previewUrl).hash.slice("#preview=".length);
  listeners.message({ source: previewWindow, origin: "https://events.example.com", data: { previewReady: previewKey } });
  ok(editor.previewMessage.event.announcement === editorEl("ev-announcement").value, "the public preview receives the unsaved organizer note without publishing it");
  erun("openEditor(null)");
  ok(editorEl("ev-announcement").value === "", "a new event starts with an empty optional important note");
  console.log(fails ? fails + " FAILED" : "ALL PASSED");
  process.exitCode = fails ? 1 : 0;
}
main().catch((err) => { console.error(err); process.exitCode = 1; });

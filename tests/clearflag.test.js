// "Checked it": an exec clears a help-desk flag (e.g. a member-price ticket for someone in a partner club).
// Who may do it, what is kept (a comment on the payment + the Log), that the flag is gone from the door and the
// attendee counts, that the payment itself is untouched, and the refusals. All services are fake.
const { run } = require("./harness.js");
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) fails++; };
const attempt = (code) => { try { return { value: run(code) }; } catch (e) { return { error: e.code || "ERROR", message: e.message }; } };

const FLAG = "Member price, but no membership found";

run(`
function table_() { return {}; }
var __locks = 0, __inLock = 0;
function withLock_(f) { __locks++; __inLock++; try { return f(); } finally { __inLock--; } }
var __logs = [];
function log_(who, action, target, details) { __logs.push({ who: who, action: action, target: target, details: details, locked: __inLock > 0 }); }
var __ticketEmails = 0;
function sendPendingTicketEmails_() { __ticketEmails++; return { sent: 1, waiting: 0 }; }
function findTicketFresh_(kind, value) { return TBL.Tickets.filter(function (t) { return (kind === "secret" ? t.secret : t.id) === value; })[0] || null; }
function resetFlagTest_() {
  __locks = 0; __logs = []; __ticketEmails = 0;
  TBL.Events = [
    { id:"EV1", slug:"mj", name:"TEST Mahjong", description:"", date:"2099-01-01", startTime:"18:00", endTime:"21:00", location:"MSC", capacity:"",
      capacityRule:"paid", waitlist:"FALSE", status:"published", entryOpen:"TRUE", ticketTypes:[{ id:"MEM", name:"Member", price:0, needsMembership:true }, { id:"T5", name:"Member $5", price:5, needsMembership:true }],
      questions:[], codePrefix:"MJ", registrationCloses:"", archivedAt:"", archiveYear:"", summary:{}, createdAt:"", updatedAt:"" },
    { id:"EV2", slug:"old", name:"TEST Old", description:"", date:"2020-01-01", startTime:"18:00", endTime:"21:00", location:"MSC", capacity:"",
      capacityRule:"paid", waitlist:"FALSE", status:"archived", entryOpen:"FALSE", ticketTypes:[{ id:"MEM", name:"Member", price:0, needsMembership:true }],
      questions:[], codePrefix:"OL", registrationCloses:"", archivedAt:"2021-01-01T00:00:00Z", archiveYear:"2020", summary:{}, createdAt:"", updatedAt:"" }];
  TBL.Orders = [
    { id:"O1", code:"MJ-1111", eventId:"EV1", payerName:"Mia Mahjong", payerEmail:"mia@example.com", total:5, status:"paid", createdAt:"2026-11-20T10:00:00Z", notes:"" },
    { id:"O0", code:"MJ-0000", eventId:"EV1", payerName:"Zed Zero", payerEmail:"zed@example.com", total:0, status:"awaiting", createdAt:"2026-11-20T11:00:00Z", notes:"Requires exec verification of member status" },
    { id:"OX", code:"OL-1", eventId:"EV2", payerName:"Old Guest", payerEmail:"old@example.com", total:0, status:"paid", createdAt:"2020-01-01T00:00:00Z", notes:"" }];
  TBL.Tickets = [
    { id:"TKTMIA0001", secret:"mia00000000000000000000000000000", orderId:"O1", eventId:"EV1", name:"Mia Mahjong", email:"mia@example.com", ucid:"", memberId:"", ticketType:"Member $5", price:5, answers:{}, flag:"${FLAG}", status:"paid", checkedInAt:"", createdAt:"2026-11-20T10:00:00Z", emailedAt:"x" },
    { id:"TKTZED0001", secret:"zed00000000000000000000000000000", orderId:"O0", eventId:"EV1", name:"Zed Zero", email:"zed@example.com", ucid:"", memberId:"", ticketType:"Member", price:0, answers:{}, flag:"${FLAG}", status:"awaiting", checkedInAt:"", createdAt:"2026-11-20T11:00:00Z", emailedAt:"" },
    { id:"TKTOLD0001", secret:"old00000000000000000000000000000", orderId:"OX", eventId:"EV2", name:"Old Guest", email:"old@example.com", ucid:"", memberId:"", ticketType:"Member", price:0, answers:{}, flag:"${FLAG}", status:"paid", checkedInAt:"", createdAt:"2020-01-01T00:00:00Z", emailedAt:"x" }];
  TBL.Refunds = []; TBL.Waitlist = []; TBL.PaymentNotes = [];
}
resetFlagTest_();
var __exec = startSession_("TEST Exec Ann", "exec");
var __door = startSession_("TEST Door", "door");
`);
const reset = () => run("resetFlagTest_()");
const clear = (token, ticketId, reason) => run(`route_({ action:"clearTicketFlag", token:${token}, ticketId:${JSON.stringify(ticketId)}, reason:${JSON.stringify(reason)} })`);
const ticket = (id) => run(`TBL.Tickets.filter(function (t) { return t.id === "${id}"; })[0]`);

// ---- Before: the scanner sends a flagged person to the help desk, and the attendee list counts them
let before = run('scan_({ name:"Volunteer", role:"door" }, "EV1", "TKTMIA0001", false).result');
ok(before.color === "orange" && /help desk/.test(before.message) && !ticket("TKTMIA0001").checkedInAt, "before: a flagged ticket is sent to the help desk (orange)");
ok(run('eventSummary_("EV1").totals.flagged') === 2, "before: the attendee list counts 2 flagged people");

// ---- An exec clears it, with a reason
let reply = clear("__exec", "TKTMIA0001", "  Mahjong club member  ");
ok(reply.ok && !reply.already && reply.ticketId === "TKTMIA0001" && reply.orderId === "O1", "any exec can clear a flag");
ok(ticket("TKTMIA0001").flag === "", "the ticket's flag is now blank");
ok(run('TBL.PaymentNotes.length') === 1, "one comment was added to the payment");
const note = run('TBL.PaymentNotes[0]');
ok(note.orderId === "O1" && note.by === "TEST Exec Ann" && note.text === "Flag checked for Mia Mahjong: " + FLAG + ". Mahjong club member",
  "the comment says who, the old flag and the reason: " + note.text);
ok(reply.noteCount === 1 && reply.latestNote && reply.latestNote.by === "TEST Exec Ann", "the reply carries the card's new comment count and newest comment");
const logged = run('__logs.filter(function (l) { return l.action === "ticket.flagCleared"; })');
ok(logged.length === 1 && logged[0].who === "TEST Exec Ann" && logged[0].target === "TKTMIA0001" && logged[0].details.was === FLAG
  && logged[0].details.reason === "Mahjong club member" && logged[0].details.order === "MJ-1111" && logged[0].locked, "it is written to the Log (inside the lock)");
ok(run('__logs.filter(function (l) { return l.action === "payment.note"; }).length') === 0, "no separate 'commented' log line for the automatic comment");
ok(run('activityGroup_("ticket.flagCleared")') === "payments", "the Activity log files it under Payments");
ok(/cleared the help-desk flag for Mia Mahjong \(MJ-1111\): Mahjong club member/.test(run(`activitySummary_({ action:"ticket.flagCleared", target:"TKTMIA0001", details:${JSON.stringify(JSON.stringify(logged[0].details))} }, {})`)),
  "the Activity log has a plain sentence");
ok(run('TBL.Orders[0].status') === "paid" && ticket("TKTMIA0001").status === "paid" && run('__ticketEmails') === 0, "the payment and ticket status are untouched, no email");
ok(reply.markPaidHint === false, "a paid order gets no 'Mark paid' hint");

// ---- Pressing again does nothing
run('__logs = [];');
reply = clear("__exec", "TKTMIA0001", "again");
ok(reply.ok && reply.already === true, "pressing again says it was already cleared");
ok(run('TBL.PaymentNotes.length') === 1 && run('__logs.length') === 0, "…and adds no second comment and no log line");

// ---- Afterwards: gone from the door and the counts
let after = run('scan_({ name:"Volunteer", role:"door" }, "EV1", "TKTMIA0001", false).result');
ok(after.color === "green" && !!ticket("TKTMIA0001").checkedInAt, "a scan afterwards is green and checks them in (not orange)");
ok(run('eventSummary_("EV1").totals.flagged') === 1, "the attendee list's flagged count dropped to 1");
const door = attempt('doorList_("EV1", { name:"TEST Exec Ann", role:"exec" })');
ok(door.value && door.value.counts.flagged === 0, "the help desk 'please check' count no longer includes them");

// ---- A $0 order waiting for the check: cleared, but still waits for Mark paid
reset();
reply = clear("__exec", "TKTZED0001", "");
ok(reply.ok && ticket("TKTZED0001").flag === "", "a $0 held ticket's flag is cleared");
ok(reply.markPaidHint === true, "the reply asks the page to say 'Now press Mark paid ($0)'");
ok(run('TBL.Orders[1].status') === "awaiting" && ticket("TKTZED0001").status === "awaiting" && run('__ticketEmails') === 0, "the order stays awaiting and no ticket is emailed yet");
ok(run('TBL.PaymentNotes[0].text') === "Flag checked for Zed Zero: " + FLAG + ".", "with no reason, the comment is just who and the old flag");
const paid = run('markOrderPaid_({ name:"TEST Exec Ann", role:"exec" }, "O0", false, "")');
ok(paid.ok !== false && run('TBL.Orders[1].status') === "paid" && ticket("TKTZED0001").status === "paid", "Mark paid then confirms it as usual");

// ---- Two flagged people on one $0 order: no hint until both are checked
reset();
run('TBL.Tickets.push({ id:"TKTZED0002", secret:"zed00000000000000000000000000002", orderId:"O0", eventId:"EV1", name:"Zoe Zero", email:"zoe@example.com", ucid:"", memberId:"", ticketType:"Member", price:0, answers:{}, flag:"' + FLAG + '", status:"awaiting", checkedInAt:"", createdAt:"2026-11-20T11:00:00Z", emailedAt:"" });');
ok(clear("__exec", "TKTZED0001", "").markPaidHint === false, "no 'Mark paid' hint while someone else on the order is still flagged");
ok(clear("__exec", "TKTZED0002", "").markPaidHint === true, "…the hint comes once the last one is checked");

// ---- Long reasons are cut to 200 characters
reset();
clear("__exec", "TKTMIA0001", "r".repeat(500));
ok(run('__logs[0].details.reason.length') === 200, "a reason is kept to 200 characters");

// ---- Refusals
reset();
let r = attempt('route_({ action:"clearTicketFlag", token:__door, ticketId:"TKTMIA0001" })');
ok(r.error === "DOOR_ONLY", "a door sign-in can't clear flags: " + r.error);
r = attempt('clearTicketFlag_({ name:"Volunteer", role:"door" }, "TKTMIA0001", "")');
ok(r.error === "DOOR_ONLY", "…not even when called directly");
ok(ticket("TKTMIA0001").flag === FLAG, "…and the flag is still there");
r = attempt('route_({ action:"clearTicketFlag", ticketId:"TKTMIA0001" })');
ok(r.error === "NOT_LOGGED_IN", "signed out: refused");
r = attempt('route_({ action:"clearTicketFlag", token:"not-a-real-token", ticketId:"TKTMIA0001" })');
ok(r.error === "NOT_LOGGED_IN", "an old sign-in: refused");
r = attempt('route_({ action:"clearTicketFlag", token:__exec, ticketId:"TKTNOPE000" })');
ok(r.error === "NOT_FOUND", "a ticket that isn't there: NOT_FOUND");
r = attempt('route_({ action:"clearTicketFlag", token:__exec })');
ok(r.error === "BAD_REQUEST", "no ticket given: refused");
r = attempt('route_({ action:"clearTicketFlag", token:__exec, ticketId:"TKTOLD0001" })');
ok(r.error === "BAD_REQUEST" && /archived/.test(r.message), "an archived event's ticket: refused");
ok(ticket("TKTOLD0001").flag === FLAG && run('TBL.PaymentNotes.length') === 0, "…nothing changed and no comment was added");

// ---- The shared comment helper still works for ordinary comments
reset();
const plain = run('route_({ action:"addPaymentNote", token:__exec, orderId:"O1", text:"Paid cash at the door" })');
ok(plain.ok && plain.noteCount === 1 && run('__logs.filter(function (l) { return l.action === "payment.note"; }).length') === 1, "ordinary payment comments still save and log as before");

// ---- What the exec sees in the Exec Portal (strings.js + edit.js + payments.js + attendees.js in a fake page)
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function page(role) {
  const elements = {};
  const element = (id) => elements[id] || (elements[id] = {
    hidden: false, disabled: false, value: "", textContent: "", open: false, html: "",
    addEventListener() {}, focus() {}, showModal() { this.open = true; }, close() { this.open = false; },
    set innerHTML(h) { this.html = h; }, get innerHTML() { return this.html; }
  });
  const context = vm.createContext({
    console, URL, Set, $: element, requests: [], toasts: [], nextReply: null,
    escapeHtml: (v) => String(v || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    money: (n) => "$" + Number(n).toFixed(2), dollars: (n) => "$" + Number(n).toFixed(2), shortTime: () => "now", ticketUrl: () => "https://example.com/t",
    eventsState: { loaded: true }, state: { role }, SCANNER_MODE: false, showEventsList() {},
    location: { href: "https://example.com/" }, PUBLIC_SITE_URL: "https://example.com/",
    setInterval() {}, setTimeout() {}, clearTimeout() {},
    document: { querySelectorAll: () => [], querySelector: () => null },
    showToast(message) { context.toasts.push(message); }, handleEventError() {}, errorText: (r) => r.message || r.error,
    api: async (action, details) => { context.requests.push({ action, details }); return context.nextReply; }
  });
  context.apiOnce = context.api;
  context.askConfirm = async () => false;
  for (const file of ["strings.js", "payments.js", "edit.js", "money.js", "attendees.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../exec-portal", file), "utf8"), context);
  }
  vm.runInContext(`
    var testOrder = { id:"O0", code:"MJ-0000", eventId:"EV1", payerName:"Zed Zero", payerEmail:"zed@example.com", status:"awaiting", total:0, received:0, noteCount:0, latestNote:null,
      refund:{ state:"none", records:[] }, tickets:[{ id:"TKTZED0001", name:"Zed Zero", ticketType:"Member", price:0, status:"awaiting", answers:{}, flag:${JSON.stringify(FLAG)}, emailedAt:"" }] };
    payState.data = { orders:[testOrder], event:{ id:"EV1" } };
    attState.event = { id:"EV1" };
    attState.data = { event:{ id:"EV1", archived:false }, attendees:[Object.assign({}, testOrder.tickets[0], { order:{ id:"O0", code:"MJ-0000" } })] };
    loadAttendees = function () { attendeeLoads++; }; var attendeeLoads = 0;
  `, context);
  return { context, elements, run: (code) => vm.runInContext(code, context) };
}

async function ui() {
  const p = page("exec");
  const card = p.run("orderCard(testOrder)");
  ok(card.includes(FLAG) && card.includes('data-clear-flag="TKTZED0001"') && card.includes("Checked it"), "the payment card shows the flag with a 'Checked it' link");
  ok(p.run("attendeeCard(attState.data.attendees[0])").includes('data-clear-flag="TKTZED0001"'), "the attendee row shows 'Checked it' too");
  ok(!page("door").run("orderCard(testOrder)").includes("data-clear-flag"), "a door sign-in never sees 'Checked it'");
  p.run("attState.data.event.archived = true");
  ok(!p.run("attendeeCard(attState.data.attendees[0])").includes("data-clear-flag"), "an archived event's attendee has no 'Checked it'");
  p.run("attState.data.event.archived = false");

  // Pressing it opens the small window; nothing is sent yet
  p.run('onOrdersClick({ target: { closest: (s) => s === "button[data-clear-flag]" ? { dataset: { clearFlag: "TKTZED0001" } } : null } })');
  ok(p.elements["clear-flag-dialog"].open && p.elements["cf-title"].textContent === "Clear this flag for Zed Zero?" && p.elements["cf-flag"].textContent === FLAG,
    "the window asks 'Clear this flag for Zed Zero?' and shows the flag");
  ok(p.context.requests.length === 0, "opening the window sends nothing");

  // Clear flag: one request with the reason, toast, the card loses its flag and shows the new comment
  p.elements["cf-reason"].value = "  Mahjong club member ";
  p.context.nextReply = { ok: true, ticketId: "TKTZED0001", orderId: "O0", noteCount: 1, latestNote: { text: "Flag checked for Zed Zero", by: "Ann", createdAt: "2026-11-24T00:00:00Z" }, markPaidHint: true };
  await p.run("onClearFlagSubmit({ preventDefault() {} })");
  const sent = p.context.requests[0];
  ok(p.context.requests.length === 1 && sent.action === "clearTicketFlag" && sent.details.ticketId === "TKTZED0001" && sent.details.reason === "Mahjong club member",
    "Clear flag sends one request with the ticket and the reason");
  ok(!p.elements["clear-flag-dialog"].open && p.context.toasts[0] === "Flag cleared. Now press Mark paid ($0) in Payments.", "the window closes and the toast says what to do next");
  ok(p.run("testOrder.tickets[0].flag") === "" && p.run("testOrder.noteCount") === 1 && !p.run("orderCard(testOrder)").includes("data-clear-flag"),
    "the payment card no longer shows the flag and counts the new comment");

  // A failure keeps the window open with the reason
  const f = page("exec");
  f.run("openClearFlagDialog(testOrder.tickets[0], function () { throw new Error('should not refresh'); })");
  f.context.nextReply = { ok: false, error: "TEMPORARY", message: "Google was slow for a moment. Try again." };
  await f.run("onClearFlagSubmit({ preventDefault() {} })");
  ok(f.elements["clear-flag-dialog"].open && !f.elements["cf-error"].hidden && /Try again/.test(f.elements["cf-error"].textContent) && !f.elements["cf-save"].disabled,
    "if it fails, the window stays open with the reason and the button works again");

  // From the attendee list: clearing reloads the list
  const a = page("exec");
  a.run('onAttendeeClick({ target: { closest: (s) => s === "button[data-clear-flag]" ? { dataset: { clearFlag: "TKTZED0001" } } : null } })');
  a.context.nextReply = { ok: true, already: true };
  await a.run("onClearFlagSubmit({ preventDefault() {} })");
  ok(a.run("attendeeLoads") === 1 && a.context.toasts[0] === "Someone already cleared this flag.", "from Attendees: the list reloads (and says if someone else got there first)");
}

ui().catch((e) => { console.log("FAIL the page test crashed: " + e.message); fails++; }).then(() => {
  console.log(fails ? `\n${fails} FAILED` : "\nAll clear-flag tests passed");
  process.exit(fails ? 1 : 0);
});

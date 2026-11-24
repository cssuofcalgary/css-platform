// Practice mode: one button makes a clearly fake event to rehearse the door, the sheet says what each scan should do,
// and one button removes it all, without touching real events.
const { run } = require("./harness.js");
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) fails++; };
const fn = (code) => { try { return { v: run(code) }; } catch (e) { return { err: e.code || "ERROR", msg: e.message }; } };

run(`
function withLock_(f) { return f(); }
function withIntakeLock_(f) { return f(); }
function withIntakeAndScriptLock_(f) { return f(); }
function table_(name) { return name; }
function headerFor_() { return []; }
function deleteTabRows_(tab, ids) { TBL[tab.sheet] = (TBL[tab.sheet] || []).filter(function (row) { return !ids[row.id]; }); }
var __batches = [];
function insertRows_(name, rows) { __batches.push({ name: name, count: rows.length }); rows.forEach(function (row) { insertRow_(name, row); }); }
var __deleted = [];
function deleteEvent_(session, id, name, force) {   // the real one deletes sheet rows; here: drop that event's rows from the tables
  if (name !== "PRACTICE (not real)" || !force) throw new Error("TEST wrong delete call");
  __deleted.push(id);
  ["Events", "Orders", "Tickets"].forEach(function (t) { TBL[t] = TBL[t].filter(function (r) { return (t === "Events" ? r.id : r.eventId) !== id; }); });
  return { ok: true };
}
TBL.Events = [{ id:"REAL", slug:"real", name:"Tiles & Tales", date:"2099-01-01", status:"published", ticketTypes:[{ id:"G", name:"General", price:5 }], questions:[], summary:{}, archivedAt:"", entryOpen:"FALSE" }];
TBL.Orders = [{ id:"RO", code:"TT-1", eventId:"REAL", status:"paid", total:5 }];
TBL.Tickets = [{ id:"RT", orderId:"RO", eventId:"REAL", status:"paid", name:"Real Person", email:"real@ucalgary.ca", secret:"realsecret" }];
TBL.Refunds = []; TBL.Waitlist = []; TBL.Requests = []; TBL.__members = [];
var S = { name: "TEST Exec", role: "exec" };
function findTicketFresh_(kind, value) { return TBL.Tickets.filter(function (t) { return (kind === "secret" ? t.secret : t.id) === value; })[0] || null; }
`);

ok(run("practiceSheet_().exists") === false, "before anything: no practice event");
const sheet = run("createPracticeEvent_(S)");
ok(sheet.ok && sheet.exists && sheet.eventName === "PRACTICE (not real)", "Practice event creates a clearly named event");
const ev = run("practiceEvent_()");
ok(ev.status === "closed" && !ev.entryOpen && ev.summary.practice === true, "it's closed (not on the public site, no sign-ups) and marked as practice");
ok(!ev.mailRegistration && !ev.mailTickets && !ev.mailReminders, "all practice-event emails are explicitly off");
ok(run("__batches.length === 2 && __batches[0].name === 'Orders' && __batches[1].name === 'Tickets' && __batches[1].count === 16"), "orders and tickets are each saved in one batch instead of dozens of locked writes");
ok(run('publicEvents_().events.length') === 1 && run('publicEvents_().events[0].name') === "Tiles & Tales", "the public events list doesn't show it");
const tickets = run(`TBL.Tickets.filter(function (t) { return t.eventId === "${ev.id}"; })`);
ok(tickets.length === 16 && tickets.every((t) => /@example\.com$/.test(t.email) && /^Practice /.test(t.name)), "16 fake attendees, all named Practice … with @example.com addresses (never emailed)");
ok(sheet.cards.length === 17 && sheet.cards.every((c) => /t=[0-9a-f]{20,}/.test(c.link)), "the sheet has a code for each, plus one made-up code");
const exp = (n) => sheet.cards.filter((c) => c.expect === n).length;
ok(exp("GREEN") === 8 && exp("ORANGE") === 6 && exp("RED") === 3, `the sheet says what to expect: ${exp("GREEN")} green, ${exp("ORANGE")} orange, ${exp("RED")} red`);
ok(run(`TBL.Orders.filter(function (o) { return o.eventId === "${ev.id}"; }).length`) === 13, "groups share one order (13 orders for 16 people)");
const unpaidGroup = run(`TBL.Orders.filter(function (o) { return o.eventId === "${ev.id}" && o.status === "awaiting"; }).map(function (o) { return o.total; })`);
ok(unpaidGroup.sort().join(",") === "16,8", "the unpaid single owes $8 and the unpaid group of 2 owes $16");
ok(tickets.some((t) => t.checkedInAt) && tickets.some((t) => t.flag) && tickets.some((t) => t.answers["Which drink would you like?"]), "someone is already inside, someone is flagged, someone chose a drink");

// The door treats them as the sheet says
run(`updateRow_("Events", "${ev.id}", { entryOpen: true }); var __ev = practiceEvent_(); __ev.entryOpen = true;`);
const card = (name) => tickets.find((t) => t.name === name);
let r = fn(`scan_({ name: "TEST Desk", role: "exec", sid: "s1" }, "${ev.id}", "${card("Practice Paige Paid").id}")`);
ok(r.v && r.v.result.color === "green", "scanning the paid ticket at the door: green");
r = fn(`scan_({ name: "TEST Desk", role: "exec", sid: "s1" }, "${ev.id}", "${card("Practice Rex Refunded").id}")`);
ok(r.v && r.v.result.color === "red", "scanning the refunded ticket: red");

ok(run("createPracticeEvent_(S).cards.length") === 17 && run('TBL.Events.length') === 2, "pressing it again just shows the same sheet (no second practice event)");
ok(run("attentionList_().items").every((x) => x.eventId !== ev.id), "practice data never shows in Needs attention");

const removed = run("removePracticeEvent_(S)");
ok(removed.removed && run("practiceEvent_()") === null, "Remove practice event deletes it");
ok(run('TBL.Events.length') === 1 && run('TBL.Orders.length') === 1 && run('TBL.Tickets.length') === 1 && run('TBL.Tickets[0].id') === "RT", "…and only it: the real event, order and ticket are untouched");
ok(run("removePracticeEvent_(S).removed") === false, "removing when there's nothing to remove is harmless");

run("var __savedInsertRows=insertRows_; insertRows_=function(name, rows) { if(name==='Tickets') { __savedInsertRows(name, rows.slice(0,1)); throw new Error('TEST interrupted ticket write'); } return __savedInsertRows(name,rows); };");
const interrupted = fn("createPracticeEvent_(S)");
ok(interrupted.err && run("TBL.Events.length === 1 && TBL.Orders.length === 1 && TBL.Tickets.length === 1"), "a partially written ticket batch rolls back only its own fake rows");
run("insertRows_=__savedInsertRows; createPracticeEvent_(S); var archivedPractice=practiceEvent_(); updateRow_('Events',archivedPractice.id,{status:'archived'});");
ok(run("practiceSheet_().exists && practiceSheet_().archived"), "an archived practice event remains visible for removal");
ok(run("createPracticeEvent_(S).archived && TBL.Events.length===2"), "an archived practice event does not create a second hidden copy");
run("removePracticeEvent_(S)");
ok(run("TBL.Events.length===1 && TBL.Orders.length===1 && TBL.Tickets.length===1"), "removing archived practice data still preserves the real event");
run("var __doorToken=startSession_('TEST Door','door');");
for (const action of ["practiceSheet", "createPracticeEvent", "removePracticeEvent"]) {
  ok(fn(`route_({action:${JSON.stringify(action)}})`).err === "NOT_LOGGED_IN", action + ": signed-out requests are denied");
  ok(fn(`route_({action:${JSON.stringify(action)},token:__doorToken})`).err === "DOOR_ONLY", action + ": scanner-only volunteers cannot manage practice events");
}

console.log(fails ? "\n" + fails + " FAILED" : "\nALL PASSED");
process.exit(fails ? 1 : 0);

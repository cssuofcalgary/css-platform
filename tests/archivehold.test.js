// The nightly archive leaves an old event alone while money is still open; the health check names it instead of raising a Problem.
const { run } = require("./harness.js");
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) fails++; };

run(`
function ev(id, name, date) { return { id:id, slug:id, name:name, date:date, startTime:"18:00", endTime:"21:00", location:"MSC", capacity:"", capacityRule:"paid", waitlist:"FALSE", status:"closed", ticketTypes:[], questions:[], codePrefix:id, archivedAt:"", summary:{} }; }
TBL.Events = [ev("CLEAN", "All Sorted", "2020-01-01"), ev("UNPAID", "Unpaid Night", "2020-01-02"), ev("OWED", "Refund Night", "2020-01-03"), ev("DONE", "Refund Finished", "2020-01-04"), ev("NEW", "Next Week", "2099-01-01")];
TBL.Orders = [
  { id:"O1", eventId:"CLEAN", status:"paid", total:10 },
  { id:"O2", eventId:"UNPAID", status:"awaiting", total:10 },
  { id:"O3", eventId:"OWED", status:"refunded", total:10 },
  { id:"O4", eventId:"DONE", status:"refunded", total:10 }
];
TBL.Tickets = [];
TBL.Refunds = [
  { id:"R1", orderId:"O3", eventId:"OWED", kind:"refund", owed:10, returns:[], status:"owed" },
  { id:"R2", orderId:"O4", eventId:"DONE", kind:"refund", owed:10, returns:[{ amount:10 }], status:"returned" }
];
var __archived = [];
function archiveEvent_(session, id) { __archived.push(id); }
`);

ok(run("moneyOpen_(findEvent_(function (e) { return e.id === 'CLEAN'; }))") === false, "an event with everything paid has no open money");
ok(run("moneyOpen_(findEvent_(function (e) { return e.id === 'UNPAID'; }))") === true, "an unpaid order counts as open money");
ok(run("moneyOpen_(findEvent_(function (e) { return e.id === 'OWED'; }))") === true, "a refund still owed counts as open money");
ok(run("moneyOpen_(findEvent_(function (e) { return e.id === 'DONE'; }))") === false, "a refund fully returned does not");

run("archiveOldEvents_()");
const moved = run("__archived.join()");
ok(moved.includes("CLEAN"), "the sorted old event is archived: " + moved);
ok(!moved.includes("UNPAID") && !moved.includes("OWED"), "events with open money stay live");
ok(!moved.includes("NEW"), "an upcoming event is left alone");

// Only held events left: the health line names them and is not a Problem, so no nightly alert email
run("TBL.Events = TBL.Events.filter(function (e) { return e.id === 'UNPAID' || e.id === 'OWED' || e.id === 'NEW'; });");
const text = run("archiveStatus_()");
ok(/Unpaid Night/.test(text) && /Refund Night/.test(text), "the health check names the held events: " + text);

// A held event doesn't use up the two places in a nightly run
run(`TBL.Events.push(ev("A", "Old A", "2020-02-01"), ev("B", "Old B", "2020-02-02")); __archived = []; archiveOldEvents_();`);
ok(run("__archived.slice().sort().join()") === "A,B", "held events don't block other old events: " + run("__archived.join()"));

console.log(fails ? "\n" + fails + " FAILED" : "\nALL PASSED");
process.exit(fails ? 1 : 0);

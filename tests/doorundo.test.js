// Door volunteers can only undo their own recent check-in; execs can undo any. Health warns when the door password is blank.
const { run } = require("./harness.js");
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "PASS " : "FAIL ") + msg); if (!cond) fails++; };

run(`
TBL.Events = [
  { id:"EV1", slug:"a", name:"Open Night", date:"2099-01-01", startTime:"18:00", endTime:"21:00", location:"MSC", capacity:"", capacityRule:"paid", waitlist:"FALSE", status:"published", entryOpen:"TRUE", ticketTypes:[], questions:[], codePrefix:"OP", archivedAt:"", summary:{} },
  { id:"EV2", slug:"b", name:"Closed Night", date:"2099-01-02", startTime:"18:00", endTime:"21:00", location:"MSC", capacity:"", capacityRule:"paid", waitlist:"FALSE", status:"published", entryOpen:"FALSE", ticketTypes:[], questions:[], codePrefix:"CL", archivedAt:"", summary:{} }
];
TBL.Orders = []; TBL.Tickets = [];
function tk(id, eventId, name) { insertRow_("Tickets", { id:id, secret:(id + "00000000000000000000000000000000").slice(0,32).toLowerCase(), orderId:"O", eventId:eventId, name:name, email:"", ucid:"", memberId:"", ticketType:"G", price:0, answers:{}, flag:"", status:"paid", checkedInAt:"", createdAt:"2026-10-01T00:00:00Z", emailedAt:"x" }); }
tk("TKTAAAA01", "EV1", "Ann"); tk("TKTBBBB01", "EV1", "Ben"); tk("TKTCCCC01", "EV1", "Cy"); tk("TKTDDDD01", "EV2", "Dee");
function table_() {}
function withLock_(fn) { return fn(); }
function findTicketFresh_(kind, value) { return TBL.Tickets.filter(function (t) { return (kind === "secret" ? t.secret : t.id) === value; })[0] || null; }
// two volunteers who typed the SAME name, an exec, and a volunteer with no session id (an old sign-in)
var V1 = { name: "Sam", role: "door", sid: "sid-one-111" };
var V2 = { name: "Sam", role: "door", sid: "sid-two-222" };
var OLD = { name: "Sam", role: "door" };
var EXEC = { name: "Gordon", role: "exec", sid: "sid-exec-3" };
`);
const checkIn = (who, id) => run(`REQ_SCANNER_ = true; scan_(${who}, "EV1", "${id}", false).result.color`);
const undo = (who, id) => { try { return run(`undoCheckIn_(${who}, "${id}")`); } catch (e) { return { error: e.code || String(e) }; } };
const isIn = (id) => !!run(`TBL.Tickets.filter(function (t) { return t.id === "${id}"; })[0].checkedInAt`);

// sessions get a stable id
const started = run('JSON.parse(CacheService.getScriptCache().get("session_" + startSession_("Vol", "door"))).sid');
ok(/^[a-f0-9]{12}$/.test(started), "a new sign-in gets its own session id: " + started);

ok(checkIn("V1", "TKTAAAA01") === "green" && isIn("TKTAAAA01"), "volunteer one checks Ann in");
ok(undo("V2", "TKTAAAA01").error === "UNDO_LIMITED" && isIn("TKTAAAA01"), "another volunteer with the same typed name can't undo it (different sign-in)");
ok(undo("OLD", "TKTAAAA01").error === "UNDO_LIMITED", "a sign-in without a session id can't undo either");
ok(undo("V1", "TKTAAAA01").ok === true && !isIn("TKTAAAA01"), "the volunteer who did it can take it back");

// ten-minute window
checkIn("V1", "TKTBBBB01");
run(`CacheService.getScriptCache().put("ci_TKTBBBB01", JSON.stringify({ sid: "sid-one-111", at: Date.now() - 11 * 60 * 1000 }), 600)`);
ok(undo("V1", "TKTBBBB01").error === "UNDO_LIMITED" && isIn("TKTBBBB01"), "after ten minutes even their own check-in is the help desk's to undo");
ok(undo("EXEC", "TKTBBBB01").ok === true && !isIn("TKTBBBB01"), "an exec can undo any check-in, any time");

// entry must be open for the ticket's event
run(`updateRow_("Tickets", "TKTDDDD01", { checkedInAt: "2026-10-02T00:00:00Z", checkedInBy: "Sam" }); CacheService.getScriptCache().put("ci_TKTDDDD01", JSON.stringify({ sid: "sid-one-111", at: Date.now() }), 600)`);
ok(undo("V1", "TKTDDDD01").error === "UNDO_LIMITED" && isIn("TKTDDDD01"), "a volunteer can't undo for an event whose entry is closed");
ok(undo("EXEC", "TKTDDDD01").ok === true, "an exec still can");

// nothing recorded (cache gone): the help desk does it
checkIn("V1", "TKTCCCC01");
run('CacheService.getScriptCache().remove("ci_TKTCCCC01")');
ok(undo("V1", "TKTCCCC01").error === "UNDO_LIMITED", "with no record of the check-in, a volunteer asks the help desk");

// ---- A door volunteer's screen has no list of recent check-ins (the help desk does)
run(`TBL.Tickets.forEach(function (t) { if (t.id === "TKTAAAA01") { t.checkedInAt = "2026-10-02T00:00:00Z"; t.checkedInBy = "Ann"; } })`);
const volunteerList = run('doorList_("EV1", V1, {})');
ok(!volunteerList.tickets.some((t) => t.checkedInAt), "a door volunteer is not sent the recent check-ins");
ok(volunteerList.counts.checkedIn >= 1, "but the counts are still right");
const execList = run('doorList_("EV1", EXEC, {})');
ok(execList.tickets.some((t) => t.checkedInAt), "the help desk still gets them");

// ---- Health: door password
const doorCheck = () => run('healthCheck_().checks.filter(function (c) { return c.name === "Door password"; })[0]');
let c = doorCheck();
ok(c && c.ok === false && c.warning === true && /Not set/.test(c.detail), "Health warns when the door password is blank: " + (c && c.detail));
run('PropertiesService.getScriptProperties().setProperty("SCANNER_PASSWORD", "secret")');
c = doorCheck();
ok(c.ok === true && c.detail === "Set", "and is happy once one is set");

console.log(fails ? fails + " FAILED" : "ALL PASSED");
process.exit(fails ? 1 : 0);
